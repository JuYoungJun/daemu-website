"""계약서·발주서 (Contract / Purchase Order) 라우트.

- /api/document-templates  (admin CRUD)
- /api/documents           (admin CRUD, 변수 치환된 최종 문서)
- /api/documents/{id}/send (이메일 발송 + sign_token 발급)
- /api/sign/{token}        (공개 서명 페이지에서 호출 — 인증 없음, 토큰만)

결제(PG) 처리는 본 모듈의 책임이 아닙니다. 문서 워크플로 + 상태 추적만 다룹니다.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_perm, _client_ip
from db import get_session
from models import (
    AdminUser,
    CrmCustomer,
    Document,
    DocumentSignature,
    DocumentTemplate,
    Order,
    Partner,
    Work,
)

router = APIRouter(prefix="/api", tags=["documents"])


# ---------------------------------------------------------------------------
# Helpers

_VAR_RE = re.compile(r"\{\{\s*([\w-]+)\s*\}\}")


def render_template(text: str | None, variables: dict[str, Any]) -> str:
    if not text:
        return ""
    def sub(m: re.Match) -> str:
        key = m.group(1)
        return str(variables.get(key, ""))
    return _VAR_RE.sub(sub, str(text))


def template_to_dict(t: DocumentTemplate) -> dict[str, Any]:
    return {
        "id": t.id,
        "name": t.name,
        "kind": t.kind,
        "subject": t.subject,
        "body": t.body,
        "variables": t.variables or [],
        "active": t.active,
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _public_doc_dict(d: Document, *, include_body: bool = True) -> dict[str, Any]:
    """공개 서명 페이지용 — 민감 메타데이터(history, created_by 등)는 빼고 보냅니다."""
    return {
        "id": d.id,
        "kind": d.kind,
        "title": d.title,
        "subject": d.subject,
        "body": d.body if include_body else "",
        "status": d.status,
        "recipients": d.recipients or [],
        "signed_at": d.signed_at.isoformat() if d.signed_at else None,
    }


def doc_to_dict(d: Document) -> dict[str, Any]:
    return {
        "id": d.id,
        "template_id": d.template_id,
        "kind": d.kind,
        "title": d.title,
        "subject": d.subject,
        "body": d.body,
        "variables": d.variables or {},
        "recipients": d.recipients or [],
        "crm_id": d.crm_id,
        "partner_id": d.partner_id,
        "order_id": d.order_id,
        "work_id": d.work_id,
        "status": d.status,
        "sign_token": d.sign_token,
        "sent_at": d.sent_at.isoformat() if d.sent_at else None,
        "first_viewed_at": d.first_viewed_at.isoformat() if d.first_viewed_at else None,
        "signed_at": d.signed_at.isoformat() if d.signed_at else None,
        "canceled_at": d.canceled_at.isoformat() if d.canceled_at else None,
        "canceled_reason": d.canceled_reason,
        "history": d.history or [],
        "created_by": d.created_by,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def push_history(d: Document, action: str, *, by: str = "", detail: dict | None = None) -> None:
    h = list(d.history or [])
    h.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "by": by or "",
        **({"detail": detail} if detail else {}),
    })
    d.history = h[-100:]  # bound the audit trail size


# ---------------------------------------------------------------------------
# Templates

class TemplateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=190)
    kind: str = Field("contract", pattern=r"^(contract|purchase_order)$")
    subject: str = ""
    body: str = ""
    variables: list[str] = []
    active: bool = True


@router.get("/document-templates")
async def list_templates(
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("document-templates", "read")),
):
    rows = (await session.execute(
        select(DocumentTemplate).order_by(desc(DocumentTemplate.updated_at))
    )).scalars().all()
    return {"ok": True, "items": [template_to_dict(r) for r in rows]}


@router.post("/document-templates", status_code=201)
async def create_template(
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    user: AdminUser = Depends(require_perm("document-templates", "write")),
):
    t = DocumentTemplate(
        name=payload.name,
        kind=payload.kind,
        subject=payload.subject,
        body=payload.body,
        variables=payload.variables,
        active=payload.active,
        created_by=user.id,
    )
    session.add(t)
    await session.flush()
    return {"ok": True, "item": template_to_dict(t)}


@router.patch("/document-templates/{tid}")
async def update_template(
    tid: int,
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("document-templates", "write")),
):
    t = await session.get(DocumentTemplate, tid)
    if not t:
        raise HTTPException(404, detail="template not found")
    for k in ("name", "kind", "subject", "body", "variables", "active"):
        setattr(t, k, getattr(payload, k))
    await session.flush()
    return {"ok": True, "item": template_to_dict(t)}


@router.delete("/document-templates/{tid}", status_code=204)
async def delete_template(
    tid: int,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("document-templates", "delete")),
):
    t = await session.get(DocumentTemplate, tid)
    if not t:
        raise HTTPException(404, detail="template not found")
    await session.delete(t)


# ---------------------------------------------------------------------------
# Documents

class RecipientIn(BaseModel):
    name: str = ""
    email: EmailStr
    role: str = "signer"  # signer | cc


class DocumentIn(BaseModel):
    template_id: int | None = None
    kind: str = Field("contract", pattern=r"^(contract|purchase_order)$")
    title: str = Field(..., min_length=1, max_length=255)
    subject: str = ""
    body: str = ""
    variables: dict[str, Any] = {}
    recipients: list[RecipientIn] = []
    crm_id: int | None = None
    partner_id: int | None = None
    order_id: int | None = None
    work_id: int | None = None
    render_from_template: bool = True


@router.get("/documents")
async def list_documents(
    page: int = 1,
    page_size: int = 100,
    status: str | None = None,
    kind: str | None = None,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("documents", "read")),
):
    stmt = select(Document).order_by(desc(Document.created_at))
    if status:
        stmt = stmt.where(Document.status == status)
    if kind:
        stmt = stmt.where(Document.kind == kind)
    total = (await session.execute(select(func.count()).select_from(Document))).scalar_one()
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).scalars().all()
    return {"ok": True, "total": total, "page": page, "items": [doc_to_dict(r) for r in rows]}


@router.get("/documents/{did}")
async def get_document(
    did: int,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("documents", "read")),
):
    d = await session.get(Document, did)
    if not d:
        raise HTTPException(404, detail="document not found")
    sigs = (await session.execute(
        select(DocumentSignature).where(DocumentSignature.document_id == did).order_by(DocumentSignature.signed_at)
    )).scalars().all()
    return {
        "ok": True,
        "item": doc_to_dict(d),
        "signatures": [
            {
                "id": s.id,
                "signer_name": s.signer_name,
                "signer_email": s.signer_email,
                "signed_at": s.signed_at.isoformat() if s.signed_at else None,
                "ip": s.ip,
                "user_agent": s.user_agent,
                "consented": s.consented,
                "has_signature_image": bool(s.signature_data),
            } for s in sigs
        ],
    }


@router.post("/documents", status_code=201)
async def create_document(
    payload: DocumentIn,
    session: AsyncSession = Depends(get_session),
    user: AdminUser = Depends(require_perm("documents", "write")),
):
    body = payload.body
    subject = payload.subject
    if payload.render_from_template and payload.template_id:
        t = await session.get(DocumentTemplate, payload.template_id)
        if t:
            body = render_template(t.body, payload.variables)
            subject = render_template(t.subject, payload.variables) or subject

    d = Document(
        template_id=payload.template_id,
        kind=payload.kind,
        title=payload.title,
        subject=subject,
        body=body,
        variables=payload.variables,
        recipients=[r.model_dump() for r in payload.recipients],
        crm_id=payload.crm_id,
        partner_id=payload.partner_id,
        order_id=payload.order_id,
        work_id=payload.work_id,
        status="draft",
        created_by=user.id,
    )
    push_history(d, "created", by=user.email)
    session.add(d)
    await session.flush()
    return {"ok": True, "item": doc_to_dict(d)}


@router.patch("/documents/{did}")
async def update_document(
    did: int,
    payload: DocumentIn,
    session: AsyncSession = Depends(get_session),
    user: AdminUser = Depends(require_perm("documents", "write")),
):
    d = await session.get(Document, did)
    if not d:
        raise HTTPException(404, detail="document not found")
    if d.status in ("signed", "canceled"):
        raise HTTPException(409, detail="이미 서명·취소된 문서는 수정할 수 없습니다.")

    body = payload.body
    subject = payload.subject
    if payload.render_from_template and payload.template_id:
        t = await session.get(DocumentTemplate, payload.template_id)
        if t:
            body = render_template(t.body, payload.variables)
            subject = render_template(t.subject, payload.variables) or subject

    d.template_id = payload.template_id
    d.kind = payload.kind
    d.title = payload.title
    d.subject = subject
    d.body = body
    d.variables = payload.variables
    d.recipients = [r.model_dump() for r in payload.recipients]
    d.crm_id = payload.crm_id
    d.partner_id = payload.partner_id
    d.order_id = payload.order_id
    d.work_id = payload.work_id
    push_history(d, "edited", by=user.email)
    await session.flush()
    return {"ok": True, "item": doc_to_dict(d)}


@router.delete("/documents/{did}", status_code=204)
async def delete_document(
    did: int,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("documents", "delete")),
):
    d = await session.get(Document, did)
    if not d:
        raise HTTPException(404, detail="document not found")
    await session.delete(d)


class CancelIn(BaseModel):
    reason: str = ""


@router.post("/documents/{did}/cancel")
async def cancel_document(
    did: int,
    payload: CancelIn,
    session: AsyncSession = Depends(get_session),
    user: AdminUser = Depends(require_perm("documents", "write")),
):
    d = await session.get(Document, did)
    if not d:
        raise HTTPException(404, detail="document not found")
    if d.status == "signed":
        raise HTTPException(409, detail="이미 서명된 문서는 취소할 수 없습니다.")
    d.status = "canceled"
    d.canceled_at = datetime.now(timezone.utc)
    d.canceled_reason = (payload.reason or "")[:255]
    push_history(d, "canceled", by=user.email, detail={"reason": d.canceled_reason})
    await session.flush()
    return {"ok": True, "item": doc_to_dict(d)}


# ---------------------------------------------------------------------------
# Send — generate sign token + email recipients

class SendIn(BaseModel):
    sign_required: bool = True
    extra_message: str = ""


@router.post("/documents/{did}/send")
async def send_document_doc(
    did: int,
    payload: SendIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: AdminUser = Depends(require_perm("documents", "write")),
):
    d = await session.get(Document, did)
    if not d:
        raise HTTPException(404, detail="document not found")
    if d.status == "canceled":
        raise HTTPException(409, detail="취소된 문서는 발송할 수 없습니다.")
    recipients = d.recipients or []
    if not recipients:
        raise HTTPException(400, detail="수신자가 없습니다.")

    if payload.sign_required and not d.sign_token:
        d.sign_token = secrets.token_urlsafe(32)

    # Build the public sign URL based on the request origin so admins can
    # forward this to clients.
    origin = request.headers.get("origin") or ""
    if not origin:
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
        host_hdr = request.headers.get("host") or request.url.netloc
        origin = f"{scheme}://{host_hdr}"
    sign_url = f"{origin.rstrip('/')}/sign/{d.sign_token}" if payload.sign_required else ""

    # Reuse the unified email sender from main.py — single source of truth
    # for Resend / SMTP fallback. Imported here to avoid circular import.
    from main import send_email, log_outbox, FROM_EMAIL, RESEND_API_KEY, SMTP_FROM, email_provider

    sent = 0
    failed = 0
    errors: list[dict[str, Any]] = []
    KIND_LABEL = {"contract": "계약서", "purchase_order": "발주서"}
    label = KIND_LABEL.get(d.kind, "문서")

    for r in recipients:
        email = r.get("email")
        if not email:
            failed += 1
            continue
        name = r.get("name") or ""
        subject = d.subject or f"[대무] {label} — {d.title}"
        intro = f"안녕하세요{(' ' + name) if name else ''},\n\n"
        if payload.extra_message:
            intro += payload.extra_message.strip() + "\n\n"
        sign_block = (
            f"\n\n아래 링크에서 서명해 주시기 바랍니다:\n{sign_url}\n"
            if sign_url else ""
        )
        text_body = (
            intro
            + f"대무에서 보내드린 {label}입니다.\n\n"
            + d.body
            + sign_block
        )
        body_payload = {
            "from": FROM_EMAIL if RESEND_API_KEY else (SMTP_FROM or FROM_EMAIL),
            "to": [email],
            "subject": subject,
            "text": text_body,
        }
        if email_provider() == "none":
            await log_outbox(session, type_=d.kind, to=email, subject=subject, body=text_body, status="simulated",
                             payload={"documentId": d.id, "signUrl": sign_url})
            sent += 1
            continue
        result = await send_email(body_payload)
        if result.get("ok"):
            sent += 1
            await log_outbox(session, type_=d.kind, to=email, subject=subject, body=text_body, status="sent",
                             payload={"documentId": d.id, "signUrl": sign_url})
        else:
            failed += 1
            err = str(result.get("error", "send failed"))
            errors.append({"email": email, "error": err})
            await log_outbox(session, type_=d.kind, to=email, subject=subject, body=text_body, status="failed",
                             error=err, payload={"documentId": d.id})

    if sent:
        d.status = "sent"
        d.sent_at = datetime.now(timezone.utc)
        push_history(d, "sent", by=user.email,
                     detail={"sent": sent, "failed": failed, "sign_required": payload.sign_required})
    await session.flush()
    return {
        "ok": True,
        "sent": sent,
        "failed": failed,
        "errors": errors[:10],
        "sign_url": sign_url,
        "item": doc_to_dict(d),
    }


# ---------------------------------------------------------------------------
# Public sign endpoints — no admin auth, but the sign_token must match

@router.get("/sign/{token}")
async def public_get_signdoc(
    token: str,
    session: AsyncSession = Depends(get_session),
):
    if not token or len(token) < 16:
        raise HTTPException(404, detail="invalid token")
    res = await session.execute(select(Document).where(Document.sign_token == token))
    d = res.scalar_one_or_none()
    if not d:
        raise HTTPException(404, detail="document not found")
    if d.status == "canceled":
        raise HTTPException(410, detail="이 문서는 취소되었습니다.")
    if not d.first_viewed_at:
        d.first_viewed_at = datetime.now(timezone.utc)
        if d.status == "sent":
            d.status = "viewed"
        push_history(d, "viewed")
        await session.flush()
    return {"ok": True, "document": _public_doc_dict(d)}


class PublicSignIn(BaseModel):
    signer_name: str = Field(..., min_length=1, max_length=120)
    signer_email: EmailStr
    signature_data: str = Field(..., min_length=64)  # data:image/png;base64,... — minimum length sanity
    consented: bool = False
    consent_text: str = ""


@router.post("/sign/{token}", status_code=201)
async def public_post_signdoc(
    token: str,
    payload: PublicSignIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    if not token or len(token) < 16:
        raise HTTPException(404, detail="invalid token")
    if not payload.consented:
        raise HTTPException(400, detail="서명 전 약관 동의가 필요합니다.")
    if not payload.signature_data.startswith("data:image/"):
        raise HTTPException(400, detail="signature_data는 data:image/* base64 이어야 합니다.")
    # Cap signature payload at ~512KB (canvas PNG is usually << 100KB)
    if len(payload.signature_data) > 700_000:
        raise HTTPException(413, detail="서명 이미지가 너무 큽니다.")

    res = await session.execute(select(Document).where(Document.sign_token == token))
    d = res.scalar_one_or_none()
    if not d:
        raise HTTPException(404, detail="document not found")
    if d.status == "canceled":
        raise HTTPException(410, detail="취소된 문서에는 서명할 수 없습니다.")
    if d.status == "signed":
        raise HTTPException(409, detail="이미 서명이 완료된 문서입니다.")

    sig = DocumentSignature(
        document_id=d.id,
        signer_name=payload.signer_name.strip(),
        signer_email=str(payload.signer_email).lower(),
        signature_data=payload.signature_data,
        consented=True,
        consent_text=payload.consent_text[:1000],
        ip=_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:255],
    )
    session.add(sig)

    d.status = "signed"
    d.signed_at = datetime.now(timezone.utc)
    push_history(d, "signed", by=sig.signer_email,
                 detail={"signer_name": sig.signer_name, "ip": sig.ip})
    await session.flush()
    return {"ok": True, "document": _public_doc_dict(d, include_body=False)}
