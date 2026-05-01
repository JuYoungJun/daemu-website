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
    NewsletterSubscriber,
    Order,
    Outbox,
    Partner,
    PartnerBrand,
    Promotion,
    SitePopup,
    Work,
)

router = APIRouter(prefix="/api", tags=["crud"])


# ---------------------------------------------------------------------------
# Simple per-IP rate limiter (in-memory, sliding window).
# Good enough for a single backend instance (Render dyno / Cafe24 single VPS);
# multi-instance 배포 시 Redis/Cloudflare 기반으로 교체 필요.

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

    # Use the unified send_email() from main.py so auto-reply also benefits
    # from the SMTP fallback (Gmail App Password) when RESEND_API_KEY is not
    # configured. Imported lazily to avoid a circular import at module load.
    from main import send_email, email_provider, SMTP_FROM
    status = "simulated"
    error = ""
    rid = None
    if email_provider() != "none":
        result = await send_email({
            "from": FROM_EMAIL if RESEND_API_KEY else (SMTP_FROM or FROM_EMAIL),
            "to": [to_email],
            "reply_to": DEFAULT_REPLY_TO,
            "subject": subject,
            "text": body,
            **({"html": html_body} if RESEND_API_KEY else {}),
        })
        if result.get("ok"):
            status = "sent"
            rid = result.get("id")
        else:
            status = "failed"
            error = str(result.get("error", "send failed"))[:200]

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

def _crud(
    model,
    prefix: str,
    allowed_fields: set[str],
    create_fields: set[str] | None = None,
    *,
    pre_create=None,
    post_create=None,
    pre_update=None,
    post_update=None,
):
    """Generic CRUD route factory.

    Optional async hooks (signature `async (session, obj, payload, request) -> None`):
      - pre_create: payload 만 들어옴, raise HTTPException 으로 차단 가능
      - post_create / pre_update / post_update: obj 와 payload 가 같이
    pre_create/pre_update 에서 HTTPException 던지면 정상적으로 클라이언트에 전달.
    """
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
        request: Request,
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_perm(prefix, "write")),
    ):
        if pre_create:
            await pre_create(session, payload, request, _u)
        data = {k: v for k, v in payload.items() if k in create_fields}
        obj = model(**data)
        session.add(obj)
        await session.flush()
        if post_create:
            await post_create(session, obj, payload, request, _u)
        return {"ok": True, "item": model_to_dict(obj)}

    @router.patch(f"/{prefix}/{{item_id}}")
    async def update_(
        item_id: int,
        payload: dict[str, Any],
        request: Request,
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_perm(prefix, "write")),
    ):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        if pre_update:
            await pre_update(session, obj, payload, request, _u)
        prev_values = {k: getattr(obj, k, None) for k in allowed_fields}
        for k, v in payload.items():
            if k in allowed_fields:
                setattr(obj, k, v)
        await session.flush()
        if post_update:
            await post_update(session, obj, payload, request, _u, prev_values)
        return {"ok": True, "item": model_to_dict(obj)}

    @router.delete(f"/{prefix}/{{item_id}}", status_code=204)
    async def delete_(item_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_perm(prefix, "delete"))):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        await session.delete(obj)


# ── Partner: 승인 시 환영 메일 자동 발송 ────────────────────────────────
async def _partner_post_update(session, obj, payload, request, _u, prev_values):
    """status 가 '대기' / 'pending' / 'review' → '승인' / 'approved' 로 바뀐
    경우 신규파트너 환영 메일 자동 발송. 발송 실패해도 partner 상태 변경은
    그대로 진행 (best-effort, audit log 에 결과 기록)."""
    APPROVED = {"승인", "approved", "active", "활성"}
    PENDING = {"대기", "pending", "review", "검토중", ""}
    new_status = (obj.status or "").strip().lower()
    prev_status = (str(prev_values.get("status") or "")).strip().lower()
    if new_status in {s.lower() for s in APPROVED} and prev_status in {s.lower() for s in PENDING}:
        # approved_at 도 함께 채움 (없으면)
        if hasattr(obj, "approved_at") and not obj.approved_at:
            from datetime import datetime as _dt, timezone as _tz
            obj.approved_at = _dt.now(_tz.utc)
            await session.flush()
        try:
            await _send_partner_welcome_email(session, obj)
            from audit import log_event
            await log_event(session, request, action="partner.welcome_email_sent",
                            actor_user=_u, target_id=obj.id,
                            detail={"partner_id": obj.id, "to": obj.email})
        except Exception as e:  # noqa: BLE001
            import traceback as _tb
            print(f"[partner-welcome] send failed for {obj.email}: {e!r}")
            _tb.print_exc()
            try:
                from audit import log_event
                await log_event(session, request, action="partner.welcome_email_failed",
                                actor_user=_u, target_id=obj.id,
                                detail={"partner_id": obj.id, "error": str(e)[:200]})
            except Exception:
                pass


async def _send_partner_welcome_email(session, partner):
    """mail_template_lib (또는 mail_templates) 의 'partner_welcome' kind 를
    사용. 없으면 기본 본문으로 발송."""
    from main import send_email, FROM_EMAIL
    # 우선 mail_template_lib 에서 partner_welcome kind 찾기. 없으면 fallback.
    subject = "[대무] 파트너 가입 승인 안내"
    body = (
        f"{partner.company_name or partner.contact_name or '파트너'}님,\n\n"
        f"DAEMU 베이커리·카페 컨설팅 파트너 가입이 승인되었습니다.\n"
        f"이제 파트너 포털 (/partner-portal) 에서 발주 및 자료 다운로드를\n"
        f"이용하실 수 있습니다.\n\n"
        f"문의: daemu_office@naver.com\n"
        f"감사합니다.\n"
    )
    try:
        from models import MailTemplateLib
        q = await session.execute(
            select(MailTemplateLib).where(MailTemplateLib.kind == "partner_welcome").limit(1)
        )
        tpl = q.scalar_one_or_none()
        if tpl:
            subject = tpl.subject or subject
            body_tpl = tpl.body or body
            body = body_tpl.replace("{{company}}", partner.company_name or "")\
                           .replace("{{contact}}", partner.contact_name or "")\
                           .replace("{{email}}", partner.email or "")
    except Exception:
        pass
    await send_email({
        "from": FROM_EMAIL,
        "to": [partner.email],
        "subject": subject,
        "text": body,
    })


_crud(Partner, "partners",
      allowed_fields={"company_name", "contact_name", "email", "phone", "category", "intro", "status"},
      post_update=_partner_post_update)


# ── Order: 발주 생성/수정 시 SKU 별 재고 차단 ──────────────────────────
async def _order_pre_create(session, payload, request, _u):
    """발주 items 의 SKU + qty 가 가용 재고를 초과하면 400 차단. items 는
    [{sku, qty, ...}, ...] 형태로 가정. SKU 없으면 검사 skip."""
    items = payload.get("items") or []
    if not isinstance(items, list):
        return
    await _validate_stock_for_items(session, items)


async def _order_pre_update(session, obj, payload, request, _u):
    items = payload.get("items")
    if items is None:
        return  # items 변경 안 하는 update 는 skip
    if not isinstance(items, list):
        return
    await _validate_stock_for_items(session, items)


async def _validate_stock_for_items(session, items: list):
    """각 item 의 sku 별 가용 재고를 합계로 검증. Product.stock_count 사용
    (StockLot 까지는 V2 에서 FIFO 차감으로 확장)."""
    from models import Product
    for it in items:
        if not isinstance(it, dict):
            continue
        sku = (it.get("sku") or "").strip()
        qty = int(it.get("qty") or it.get("quantity") or 0)
        if not sku or qty <= 0:
            continue
        q = await session.execute(select(Product).where(Product.sku == sku).limit(1))
        prod = q.scalar_one_or_none()
        if not prod:
            # 등록 안 된 SKU 는 통과 (legacy 발주 호환)
            continue
        available = int(prod.stock_count or 0)
        if qty > available:
            raise HTTPException(
                400,
                detail=f"재고 부족 — {sku} 의 가용 재고는 {available}개입니다 (요청: {qty}개).",
            )


_crud(Order, "orders",
      allowed_fields={"partner_id", "title", "status", "amount", "items", "due_date", "note"},
      pre_create=_order_pre_create, pre_update=_order_pre_update)

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

_crud(NewsletterSubscriber, "newsletter",
      allowed_fields={"email", "name", "source", "status"})

# 함께하는 파트너사 — Home 페이지의 로고 디스플레이.
# (Partner 모델은 파트너 *로그인 계정* 이고, 이건 별도 노출용 디스플레이.)
_crud(PartnerBrand, "partner-brands",
      allowed_fields={"name", "logo", "url", "sort_order", "active"})


# ---------------------------------------------------------------------------
# Public newsletter subscription — open POST, rate-limited per IP (8/10min).
# This is the only public mutation aside from /api/inquiries.

class NewsletterSubscribeIn(BaseModel):
    email: EmailStr
    name: str = ""
    source: str = "partners-page"
    privacy_consent: bool = False  # PIPA: explicit consent, durable record


_newsletter_limiter = RateLimiter(max_calls=5, window_seconds=600)


@router.post("/newsletter/subscribe", status_code=201)
async def newsletter_subscribe(
    payload: NewsletterSubscribeIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Public — Partners/Contact page subscribe form posts here."""
    ip = _client_ip(request)
    if not _newsletter_limiter.check(ip):
        raise HTTPException(429, detail="구독 시도가 너무 빠르게 발생했습니다. 잠시 후 다시 시도해 주세요.")
    if not payload.privacy_consent:
        raise HTTPException(400, detail="개인정보 수집·이용 동의가 필요합니다.")

    email = str(payload.email).strip().lower()
    res = await session.execute(select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
    existing = res.scalar_one_or_none()
    if existing:
        # Reactivate if previously unsubscribed; otherwise idempotent success.
        if existing.status != "active":
            existing.status = "active"
            existing.unsubscribed_at = None
            await session.flush()
        return {"ok": True, "already": True}

    sub = NewsletterSubscriber(
        email=email,
        name=str(payload.name or "").strip()[:120],
        source=str(payload.source or "")[:60],
        status="active",
        consent_at=datetime.now(timezone.utc),
    )
    session.add(sub)
    await session.flush()
    return {"ok": True, "id": sub.id}


@router.post("/newsletter/unsubscribe", status_code=200)
async def newsletter_unsubscribe(
    payload: NewsletterSubscribeIn,
    session: AsyncSession = Depends(get_session),
):
    """Public — soft-unsubscribe (sets status=unsubscribed but keeps the row
    for compliance evidence)."""
    email = str(payload.email).strip().lower()
    res = await session.execute(select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
    sub = res.scalar_one_or_none()
    if not sub:
        return {"ok": True, "not_found": True}
    sub.status = "unsubscribed"
    sub.unsubscribed_at = datetime.now(timezone.utc)
    await session.flush()
    return {"ok": True}


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
