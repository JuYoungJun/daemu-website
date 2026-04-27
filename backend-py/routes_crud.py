"""CRUD endpoints for core entities.

Public endpoints (no auth):
    POST /api/inquiries        — Contact form submission (rate-limited per-IP)

Admin-only (Bearer JWT required):
    GET  /api/inquiries        — list with pagination + status filter
    GET  /api/inquiries/{id}
    PATCH /api/inquiries/{id}  — update status / note / mark replied
    DELETE /api/inquiries/{id}
    (same shape for: partners, orders, works, mail-template, popups, crm,
     campaigns, promotions, outbox)
"""

from __future__ import annotations

import asyncio
import html
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin, require_perm
from db import get_session, SessionLocal
from models import (
    AdminUser,
    Campaign,
    ContentBlock,
    CrmCustomer,
    Inquiry,
    MailTemplate,
    Order,
    Outbox,
    Partner,
    Promotion,
    SitePopup,
    Work,
)

router = APIRouter(prefix="/api", tags=["crud"])


# ---------------------------------------------------------------------------
# Simple per-IP rate limiter (in-memory, sliding window).
# Good enough for a single Render dyno; replace with Redis/Cloudflare if scaling.

class RateLimiter:
    def __init__(self, max_calls: int, window_seconds: float):
        self.max_calls = max_calls
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> bool:
        now = time.time()
        bucket = self._hits[key]
        # drop entries older than window
        cutoff = now - self.window
        bucket[:] = [t for t in bucket if t >= cutoff]
        if len(bucket) >= self.max_calls:
            return False
        bucket.append(now)
        return True


_inquiry_limiter = RateLimiter(max_calls=8, window_seconds=600)  # 8 req / 10 min / IP


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------
# Email helpers (server-side auto-reply, no public mail relay)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
FROM_EMAIL = os.environ.get("FROM_EMAIL", "DAEMU <onboarding@resend.dev>")
DEFAULT_REPLY_TO = "daemu_office@naver.com"


def _esc(s: Any) -> str:
    return html.escape(str(s or ""))


def _apply_vars(text: str | None, vars_: dict[str, Any]) -> str:
    if not text:
        return ""
    pattern = re.compile(r"\{\{\s*([\w-]+)\s*\}\}")
    return pattern.sub(lambda m: str(vars_.get(m.group(1), "")), str(text))


def _wrap_html(inner_text: str) -> str:
    """Wrap a plain-text body into the DAEMU email envelope."""
    safe = _esc(inner_text).replace("\n", "<br>")
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f4f0;font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#222;line-height:1.7">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f4f0">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #d7d4cf">
    <tr><td style="padding:32px 28px 28px 28px;font-size:14px;line-height:1.7;color:#222">{safe}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #e6e3dd;font-size:11px;letter-spacing:.06em;color:#8c867d">
      <strong style="color:#111">대무 (DAEMU)</strong> · 061-335-1239 · daemu_office@naver.com<br>
      전라남도 나주시 황동 3길 8
    </td></tr>
  </table>
</td></tr></table></body></html>"""


async def _send_auto_reply_inline(
    session: AsyncSession,
    *,
    to_email: str,
    to_name: str,
    category: str,
    message: str,
) -> None:
    """Server-side auto-reply, run inline within the request's DB session.
    Avoids SQLite WAL writer contention from spawning a separate background
    transaction. Latency cost: ~50ms (DB) + up to 30s (Resend HTTP) — accept-
    able since the Contact form submission is a single user action."""
    from models import MailTemplate, Outbox  # local import to avoid cycle

    res = await session.execute(select(MailTemplate).where(MailTemplate.kind == "auto-reply"))
    tpl = res.scalar_one_or_none()
    if tpl and tpl.active is False:
        return

    subject_tpl = tpl.subject if tpl else "[대무] 문의가 접수되었습니다"
    body_tpl = (tpl.body if tpl else
        "{{name}} 님,\n\n대무에 문의해 주셔서 감사합니다.\n"
        "접수하신 내용을 확인하여 1-2 영업일 내 담당자가 회신드리겠습니다.\n\n"
        "─ 카테고리: {{category}}\n─ 문의 내용:\n{{message}}\n\n감사합니다.\n대무 (DAEMU)")
    vars_ = {"name": to_name, "category": category, "message": message,
             "email": to_email, "phone": ""}
    subject = _apply_vars(subject_tpl, vars_)
    body = _apply_vars(body_tpl, vars_)
    html_body = _wrap_html(body)

    status = "simulated"
    error = ""
    rid = None
    if RESEND_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                http_res = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {RESEND_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": FROM_EMAIL,
                        "to": [to_email],
                        "reply_to": DEFAULT_REPLY_TO,
                        "subject": subject,
                        "text": body,
                        "html": html_body,
                    },
                )
            if http_res.status_code >= 400:
                status = "failed"
                error = f"HTTP {http_res.status_code}"
            else:
                status = "sent"
                try:
                    rid = http_res.json().get("id")
                except Exception:
                    pass
        except Exception as e:  # noqa: BLE001
            status = "failed"
            error = str(e)[:200]

    session.add(Outbox(
        type="auto-reply",
        recipient=to_email,
        subject=subject[:255],
        body=body[:8000],
        status=status,
        error=error,
        payload={"resendId": rid, "trigger": "inquiry"},
    ))
    # No explicit commit — get_session() commits on yield exit.


# ---------------------------------------------------------------------------
# Helpers

def model_to_dict(obj) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, datetime):
            out[col.name] = val.isoformat()
        else:
            out[col.name] = val
    return out


# ---------------------------------------------------------------------------
# Inquiries

class InquiryIn(BaseModel):
    name: str
    email: EmailStr
    phone: str = ""
    brand_name: str = ""
    location: str = ""
    expected_open: str = ""
    category: str = ""
    message: str = ""


class InquiryUpdate(BaseModel):
    status: str | None = None
    note: str | None = None
    replied: bool | None = None


@router.post("/inquiries", status_code=201)
async def create_inquiry(
    payload: InquiryIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Public — Contact form posts here. Rate-limited per IP, then triggers
    server-side auto-reply inline (no public email endpoint exposure, no
    SQLite writer contention with background tasks)."""
    ip = _client_ip(request)
    if not _inquiry_limiter.check(ip):
        raise HTTPException(429, detail="문의가 너무 빠르게 접수되었습니다. 잠시 후 다시 시도해 주세요.")

    inq = Inquiry(**payload.model_dump())
    session.add(inq)
    await session.flush()
    inquiry_dict = model_to_dict(inq)

    # Auto-reply runs inline so it shares the request's transaction.
    await _send_auto_reply_inline(
        session,
        to_email=inq.email,
        to_name=inq.name,
        category=inq.category or "상담 문의",
        message=inq.message or "",
    )
    return {"ok": True, "id": inq.id, "inquiry": inquiry_dict}


@router.get("/inquiries")
async def list_inquiries(
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
    session: AsyncSession = Depends(get_session),
    _user: AdminUser = Depends(require_perm("inquiries", "read")),
):
    stmt = select(Inquiry).order_by(desc(Inquiry.created_at))
    count_stmt = select(func.count(Inquiry.id))
    if status and status != "all":
        stmt = stmt.where(Inquiry.status == status)
        count_stmt = count_stmt.where(Inquiry.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Inquiry.name.ilike(like))
            | (Inquiry.email.ilike(like))
            | (Inquiry.brand_name.ilike(like))
            | (Inquiry.message.ilike(like))
        )
    total = (await session.execute(count_stmt)).scalar_one()
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).scalars().all()
    return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": [model_to_dict(r) for r in rows]}


@router.get("/inquiries/{inquiry_id}")
async def get_inquiry(inquiry_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm("inquiries", "read"))):
    obj = await session.get(Inquiry, inquiry_id)
    if not obj:
        raise HTTPException(404, detail="inquiry not found")
    return {"ok": True, "inquiry": model_to_dict(obj)}


@router.patch("/inquiries/{inquiry_id}")
async def update_inquiry(inquiry_id: int, payload: InquiryUpdate, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm("inquiries", "write"))):
    obj = await session.get(Inquiry, inquiry_id)
    if not obj:
        raise HTTPException(404, detail="inquiry not found")
    if payload.status is not None:
        obj.status = payload.status
    if payload.note is not None:
        obj.note = payload.note
    if payload.replied:
        obj.replied_at = datetime.now(timezone.utc)
        if obj.status == "신규":
            obj.status = "답변완료"
    await session.flush()
    return {"ok": True, "inquiry": model_to_dict(obj)}


@router.delete("/inquiries/{inquiry_id}", status_code=204)
async def delete_inquiry(inquiry_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm("inquiries", "delete"))):
    obj = await session.get(Inquiry, inquiry_id)
    if not obj:
        raise HTTPException(404, detail="inquiry not found")
    await session.delete(obj)


# ---------------------------------------------------------------------------
# Generic admin-only CRUD for the simpler entities

def _crud(model, prefix: str, allowed_fields: set[str], create_fields: set[str] | None = None):
    create_fields = create_fields or allowed_fields

    @router.get(f"/{prefix}")
    async def list_(
        page: int = 1,
        page_size: int = 100,
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_perm(prefix, "read")),
    ):
        stmt = select(model).order_by(desc(getattr(model, "created_at", model.id)))
        total = (await session.execute(select(func.count()).select_from(model))).scalar_one()
        page = max(1, page)
        page_size = min(max(1, page_size), 500)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
        rows = (await session.execute(stmt)).scalars().all()
        return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": [model_to_dict(r) for r in rows]}

    @router.get(f"/{prefix}/{{item_id}}")
    async def get_(item_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm(prefix, "read"))):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        return {"ok": True, "item": model_to_dict(obj)}

    @router.post(f"/{prefix}", status_code=201)
    async def create_(
        payload: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_perm(prefix, "write")),
    ):
        data = {k: v for k, v in payload.items() if k in create_fields}
        obj = model(**data)
        session.add(obj)
        await session.flush()
        return {"ok": True, "item": model_to_dict(obj)}

    @router.patch(f"/{prefix}/{{item_id}}")
    async def update_(
        item_id: int,
        payload: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_perm(prefix, "write")),
    ):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        for k, v in payload.items():
            if k in allowed_fields:
                setattr(obj, k, v)
        await session.flush()
        return {"ok": True, "item": model_to_dict(obj)}

    @router.delete(f"/{prefix}/{{item_id}}", status_code=204)
    async def delete_(item_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm(prefix, "delete"))):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        await session.delete(obj)


_crud(Partner, "partners",
      allowed_fields={"company_name", "contact_name", "email", "phone", "category", "intro", "status"})

_crud(Order, "orders",
      allowed_fields={"partner_id", "title", "status", "amount", "items", "due_date", "note"})

_crud(Work, "works",
      allowed_fields={"slug", "title", "category", "summary", "content_md", "hero_image_url",
                      "gallery", "tags", "location", "year", "size_label", "floor_label",
                      "published", "sort_order"})

_crud(SitePopup, "popups",
      allowed_fields={"page_key", "title", "body", "image_url", "cta_label", "cta_href",
                      "placement", "frequency", "schedule_start", "schedule_end", "active"})

_crud(CrmCustomer, "crm",
      allowed_fields={"name", "email", "phone", "source", "status", "estimated_amount",
                      "tags", "notes", "last_contact_at"})

_crud(Campaign, "campaigns",
      allowed_fields={"name", "channel", "subject", "body", "images", "recipient_filter",
                      "status", "scheduled_at"})

_crud(Promotion, "promotions",
      allowed_fields={"title", "code", "discount_type", "discount_value",
                      "valid_from", "valid_to", "usage_limit", "active"})

_crud(Outbox, "outbox",
      allowed_fields={"type", "recipient", "subject", "body", "status", "error", "payload"})


# ---------------------------------------------------------------------------
# Mail template — keyed by 'kind', special upsert behavior

class MailTemplateUpsert(BaseModel):
    kind: str = Field(pattern=r"^(auto-reply|admin-reply|document)$")
    subject: str
    body: str = ""
    html: str | None = None
    images: list = []
    active: bool = True
    category: str = "all"


@router.get("/mail-template/auto-reply")
async def get_auto_reply_template(session: AsyncSession = Depends(get_session)):
    """Auto-reply template is publicly readable so the Contact form can show
    a preview. admin-reply and document templates are NOT — see admin endpoint."""
    res = await session.execute(select(MailTemplate).where(MailTemplate.kind == "auto-reply"))
    tpl = res.scalar_one_or_none()
    if not tpl:
        return {"ok": True, "template": None}
    return {"ok": True, "template": model_to_dict(tpl)}


@router.get("/mail-template/{kind}", dependencies=[Depends(require_perm("mail-template", "read"))])
async def get_mail_template_admin(kind: str, session: AsyncSession = Depends(get_session)):
    if kind == "auto-reply":
        # Routed by the public endpoint above; this is a fallback if anything
        # bypassed FastAPI's path resolution order.
        res = await session.execute(select(MailTemplate).where(MailTemplate.kind == "auto-reply"))
    else:
        res = await session.execute(select(MailTemplate).where(MailTemplate.kind == kind))
    tpl = res.scalar_one_or_none()
    if not tpl:
        return {"ok": True, "template": None}
    return {"ok": True, "template": model_to_dict(tpl)}


@router.put("/mail-template/{kind}")
async def upsert_mail_template(
    kind: str,
    payload: MailTemplateUpsert,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("mail-template", "write")),
):
    if payload.kind != kind:
        raise HTTPException(400, detail="kind in path and body must match")
    res = await session.execute(select(MailTemplate).where(MailTemplate.kind == kind))
    tpl = res.scalar_one_or_none()
    if tpl is None:
        tpl = MailTemplate(**payload.model_dump())
        session.add(tpl)
    else:
        for k, v in payload.model_dump().items():
            setattr(tpl, k, v)
    await session.flush()
    return {"ok": True, "template": model_to_dict(tpl)}


# ---------------------------------------------------------------------------
# Site content blocks (key/value)

class ContentBlockIn(BaseModel):
    value: dict | list


@router.get("/content/{key}")
async def get_content(key: str, session: AsyncSession = Depends(get_session)):
    res = await session.execute(select(ContentBlock).where(ContentBlock.key == key))
    block = res.scalar_one_or_none()
    if not block:
        return {"ok": True, "value": None}
    return {"ok": True, "value": block.value, "updated_at": block.updated_at.isoformat() if block.updated_at else None}


@router.put("/content/{key}")
async def put_content(key: str, payload: ContentBlockIn, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm("content", "write"))):
    res = await session.execute(select(ContentBlock).where(ContentBlock.key == key))
    block = res.scalar_one_or_none()
    if block is None:
        block = ContentBlock(key=key, value=payload.value)
        session.add(block)
    else:
        block.value = payload.value
    await session.flush()
    return {"ok": True, "value": block.value}
