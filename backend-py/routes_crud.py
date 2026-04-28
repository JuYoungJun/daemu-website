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
    def __init__(self, max_calls: int, window_seconds: float, max_keys: int = 5000):
        self.max_calls = max_calls
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: dict[str, list[float]] = defaultdict(list)

    def _gc(self) -> None:
        """N2-26: bound dict size by dropping entries with the oldest
        last-hit timestamp."""
        if len(self._hits) <= self.max_keys:
            return
        scored = sorted(self._hits.items(), key=lambda kv: kv[1][-1] if kv[1] else 0)
        for k, _ in scored[: len(self._hits) - self.max_keys]:
            self._hits.pop(k, None)

    def check(self, key: str) -> bool:
        now = time.time()
        bucket = self._hits[key]
        cutoff = now - self.window
        bucket[:] = [t for t in bucket if t >= cutoff]
        if not bucket:
            self._hits.pop(key, None)
            bucket = self._hits[key]
        if len(bucket) >= self.max_calls:
            return False
        bucket.append(now)
        self._gc()
        return True


_inquiry_limiter = RateLimiter(max_calls=8, window_seconds=600)  # 8 req / 10 min / IP

# V3-13: hold strong references to fire-and-forget background tasks so
# they can't be garbage-collected mid-flight (Python docs explicitly warn).
_PENDING_TASKS: set = set()


def _client_ip(request: Request) -> str:
    """Re-uses the auth module's X-Forwarded-For policy so the rate-limit
    key matches the login-throttle key (so neither can be bypassed by
    rotating the header)."""
    from auth import _client_ip as auth_client_ip  # noqa: WPS433
    return auth_client_ip(request)


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


async def _send_auto_reply_async(
    *,
    to_email: str,
    to_name: str,
    category: str,
    message: str,
) -> None:
    """N2-03 fix: auto-reply runs as a fire-and-forget asyncio task with
    its OWN DB session, AFTER the inquiry POST has already returned. This
    keeps the public Contact endpoint's response fast (~5 ms) and the
    DB writer lock short.
    The function MUST be defensive — it may run after the FastAPI request
    context is gone, so any exception must be caught and logged, never
    bubbled."""
    try:
        async with SessionLocal() as session:
            await _send_auto_reply_inline(
                session,
                to_email=to_email, to_name=to_name,
                category=category, message=message,
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        print(f"[auto-reply] background failure for {to_email}: {exc!r}")


async def _send_auto_reply_inline(
    session: AsyncSession,
    *,
    to_email: str,
    to_name: str,
    category: str,
    message: str,
) -> None:
    """Internal: shared logic. Used by both the async fire-and-forget and
    by the unit-test path that wants deterministic ordering."""
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

# DB-06 fix: any column whose name appears here is dropped from API
# responses across every CRUD model — e.g. the `password_hash` field
# would leak if the AdminUser model were ever wired into the generic
# CRUD factory. Centralized so the next maintainer can extend it.
_SENSITIVE_COLUMNS = frozenset({
    "password_hash", "password", "secret", "token", "api_key",
})


def model_to_dict(obj, *, exclude: frozenset | set | None = None) -> dict[str, Any]:
    drop = _SENSITIVE_COLUMNS | (exclude or set())
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        if col.name in drop:
            continue
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
    # PIPA (개인정보보호법) — explicit consent required before storing any
    # personal data. Frontend must surface a checkbox; this server flag is
    # the durable record of consent.
    privacy_consent: bool = False


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
    if not payload.privacy_consent:
        raise HTTPException(400, detail="개인정보 수집·이용에 동의해 주세요.")

    data = payload.model_dump(exclude={"privacy_consent"})
    inq = Inquiry(**data, privacy_consent_at=datetime.now(timezone.utc))
    session.add(inq)
    await session.flush()
    inquiry_dict = model_to_dict(inq)
    # Capture values BEFORE returning — the inq instance becomes detached.
    auto_args = dict(
        to_email=inq.email,
        to_name=inq.name,
        category=inq.category or "상담 문의",
        message=inq.message or "",
    )

    # N2-03 + V3-13: fire-and-forget so the public Contact endpoint isn't
    # held by the (up to 15 s) Resend HTTP call. asyncio.create_task can be
    # GC'd if the reference is dropped — keep them in module-level set.
    task = asyncio.create_task(_send_auto_reply_async(**auto_args))
    _PENDING_TASKS.add(task)
    task.add_done_callback(_PENDING_TASKS.discard)

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
        # DB-08 DoS guard: bounded so an attacker can't force a
        # gigabyte-scan via the LIKE %x...x% pattern.
        q = q[:80]
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
