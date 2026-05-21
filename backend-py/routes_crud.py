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
from sqlalchemy import desc, func, or_, select
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
    PromotionConsumption,
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


def _task_done(task):
    """N-4: fire-and-forget task 의 done_callback. (1) strong reference 해제,
    (2) exception 발생 시 traceback 을 stdout 으로 명시 출력. 옛 코드는
    set.discard 만 호출 → exception 이 silent. Resend / SMTP / Aiven 일시
    장애로 auto-reply 발송 실패해도 운영자가 발견 못 하는 회귀 차단.
    """
    _PENDING_TASKS.discard(task)
    try:
        exc = task.exception()
    except Exception:
        return
    if exc is None:
        return
    try:
        import traceback as _tb
        print(f"[task] background task failed: {type(exc).__name__}: {exc!r}")
        _tb.print_exception(type(exc), exc, exc.__traceback__)
    except Exception:
        pass


async def _record_rate_limit(session, request, *, endpoint: str) -> None:
    """Step 7-extended — rate_limit_exceeded wire site. /admin/security 의
    보안 자동 도구 카드가 🟠 활성 (24h 내 발생) 으로 전환되어 운영자가
    spike 감지 가능. best-effort (실패 silent — record 가 본 흐름 막지 않음).
    """
    try:
        from suspicious import record_async as _sus
        await _sus(
            session,
            reason="rate_limit_exceeded",
            severity="low",
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            path=str(request.url.path),
            method=request.method,
            status_code=429,
            request_id=getattr(getattr(request, "state", None), "request_id", ""),
            detail={"endpoint": endpoint},
        )
    except Exception:
        pass


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


# Mail body 의 inline image placeholder. AdminMail 편집기가 [[img:cid...]] 형태로
# 본문에 삽입 — frontend send 경로(`src/lib/email.js bodyToHtml`)는 image URL 로
# 변환해서 보내지만, backend 가 자체 발송하는 경로(`_send_partner_mail` /
# auto-reply 등)는 변환을 안 해서 recipient 가 raw `[[img:cid...]]` 텍스트를
# 그대로 받던 incident. 본 helper 가 동일 변환을 backend python 으로 포팅.
_IMG_CID_RE = re.compile(r"\[\[img:([\w-]+)\]\]")


def _strip_image_placeholders(text: str | None) -> str:
    """text/plain 본문에서 [[img:cid...]] 마커를 *제거*. recipient 가 plain
    text 클라이언트로 메일을 열어도 raw 마커가 보이지 않게 한다."""
    if not text:
        return ""
    return _IMG_CID_RE.sub("", str(text))


def _build_html_with_images(inner_text: str | None, images: list | None) -> str:
    """text 안의 [[img:cid...]] 마커를 images 메타에서 url 매핑해 <img> 로 변환.
    매핑 실패한 cid 는 *제거* (recipient 가 raw 마커 안 보게). 그 외 텍스트는
    HTML escape + 줄바꿈을 <br> 로.
    """
    by_cid: dict[str, dict] = {}
    for img in images or []:
        if not isinstance(img, dict):
            continue
        cid = img.get("contentId") or img.get("content_id")
        if cid:
            by_cid[str(cid)] = img
    parts = _IMG_CID_RE.split(str(inner_text or ""))
    # split 결과: [text, cid, text, cid, ..., text] — 짝수 인덱스가 일반 텍스트.
    rendered: list[str] = []
    for idx, chunk in enumerate(parts):
        if idx % 2 == 0:
            rendered.append(_esc(chunk).replace("\n", "<br>"))
        else:
            img = by_cid.get(chunk)
            url = img.get("url") if isinstance(img, dict) else None
            if url:
                alt = _esc(img.get("filename") or "")
                rendered.append(
                    f'<div style="margin:14px 0">'
                    f'<img src="{_esc(url)}" alt="{alt}" '
                    f'style="max-width:100%;height:auto;display:block;border-radius:2px">'
                    f'</div>'
                )
            # url 없음 → silent drop (raw 마커 노출 차단)
    return "".join(rendered)


def _wrap_html(inner_text: str, images: list | None = None) -> str:
    """plain-text body 를 DAEMU email envelope 로 wrap. images 가 주어지면
    inline [[img:cid...]] 마커도 url 매핑해 <img> 로 변환. images 없으면
    매핑 실패 처리 (마커 제거).
    """
    body_html = _build_html_with_images(inner_text, images)
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f4f0;font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#222;line-height:1.7">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f4f0">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #d7d4cf">
    <tr><td style="padding:32px 28px 28px 28px;font-size:14px;line-height:1.7;color:#222">{body_html}</td></tr>
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
    raw_body = _apply_vars(body_tpl, vars_)
    # MailTemplate.images JSON 의 inline image 메타. text 측에는 placeholder
    # 제거, html 측에는 url 매핑된 <img> 삽입. recipient 가 raw [[img:cid...]]
    # 마커를 절대 보지 않게 보장.
    images = list(getattr(tpl, "images", None) or [])
    body = _strip_image_placeholders(raw_body)
    html_body = _wrap_html(raw_body, images=images)

    # Use the unified send_email() from main.py — provider 선택은 main.py
    # 의 email_provider() 가 EMAIL_PROVIDER / SENDGRID_API_KEY /
    # RESEND_API_KEY / SMTP_HOST 기반으로 처리. SMTP/SendGrid/Resend 모두
    # HTML body 정상 발송. Imported lazily to avoid a circular import at module load.
    from main import send_email, email_provider, SMTP_FROM, SENDGRID_FROM
    status = "simulated"
    error = ""
    rid = None
    provider_now = email_provider()
    if provider_now != "none":
        if provider_now == "sendgrid":
            from_addr = SENDGRID_FROM or FROM_EMAIL
        elif provider_now == "smtp":
            from_addr = SMTP_FROM or FROM_EMAIL
        else:
            from_addr = FROM_EMAIL
        result = await send_email({
            "from": from_addr,
            "to": [to_email],
            "reply_to": DEFAULT_REPLY_TO,
            "subject": subject,
            "text": body,
            "html": html_body,
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
        await _record_rate_limit(session, request, endpoint="/api/inquiries")
        raise HTTPException(429, detail="문의가 너무 빠르게 접수되었습니다. 잠시 후 다시 시도해 주세요.")
    if not payload.privacy_consent:
        raise HTTPException(400, detail="개인정보 수집·이용에 동의해 주세요.")

    data = payload.model_dump(exclude={"privacy_consent"})
    inq = Inquiry(**data, privacy_consent_at=datetime.now(timezone.utc))
    session.add(inq)
    await session.flush()
    await session.refresh(inq)
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
    task.add_done_callback(_task_done)  # N-4: exception 도 stdout 에 명시

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
        # LIKE wildcard escape — 사용자 입력의 `%`/`_`/`\` 을 literal 로 처리.
        # escape 안 하면 사용자가 `%` 입력 시 모든 row 매칭 (의도 외 결과).
        q_escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{q_escaped}%"
        stmt = stmt.where(
            (Inquiry.name.ilike(like, escape="\\"))
            | (Inquiry.email.ilike(like, escape="\\"))
            | (Inquiry.brand_name.ilike(like, escape="\\"))
            | (Inquiry.message.ilike(like, escape="\\"))
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
    await session.refresh(obj)
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
        # SQLAlchemy 2.x async: flush() 후 server-side default 가 적용된 컬럼
        # (created_at, updated_at, JSON default 등) 은 expired 상태. 직후
        # model_to_dict 의 attribute 접근이 lazy-load 를 트리거하면 async
        # session 에서 sync IO 시도 → MissingGreenlet 500. refresh 로 해결.
        await session.refresh(obj)
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
        # ON UPDATE CURRENT_TIMESTAMP 인 updated_at 도 server-side 라 동일 이유로 refresh.
        await session.refresh(obj)
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
    그대로 진행 (best-effort, audit log 에 결과 기록).

    N-3: prev_values 는 DB raw 값이라 _PARTNER_STATUS_NORMALIZE 적용 전.
    set membership 비교 시 옛 variant (예: 'rejected', '거절' 등 PENDING 외)
    이 누락되면 환영 메일 silent miss. 비교 전 정규화 적용해 silent bug 차단.
    """
    APPROVED_NORMALIZED = {"승인"}
    PENDING_NORMALIZED = {"대기"}
    # 정규화 표 적용 — pre_update 와 동일 dict 사용 (단일 source).
    def _norm(s):
        v = (str(s) if s is not None else "").strip().lower()
        return _PARTNER_STATUS_NORMALIZE.get(v, v)
    new_status = _norm(obj.status)
    prev_status = _norm(prev_values.get("status"))
    if new_status in APPROVED_NORMALIZED and prev_status in PENDING_NORMALIZED:
        # approved_at 도 함께 채움 (없으면)
        if hasattr(obj, "approved_at") and not obj.approved_at:
            from datetime import datetime as _dt, timezone as _tz
            obj.approved_at = _dt.now(_tz.utc)
            await session.flush()
        # 통합 helper 사용 — Outbox + mail_status 일관 기록.
        try:
            res = await _send_partner_mail(session, kind="partner-approved", partner=obj)
            from audit import log_event
            await log_event(session, request,
                            action=("partner.welcome_email_sent" if res["status"] == "sent" else "partner.welcome_email_failed"),
                            actor_user=_u, target_id=obj.id,
                            detail={"partner_id": obj.id, "to": obj.email,
                                    "mail_status": res["status"],
                                    "error": res.get("error", "")})
        except Exception as e:  # noqa: BLE001
            import traceback as _tb
            print(f"[partner-approved] send failed for {obj.email}: {e!r}")
            _tb.print_exc()


# Partner.status 표준값 정규화 — 다양한 표기 (pending/대기/review 등) 가 DB 에
# 섞이지 않도록 PATCH 시점에 표준 set 으로 강제 변환. 미허용 값은 400.
_PARTNER_STATUS_NORMALIZE = {
    "대기": "대기", "pending": "대기", "review": "대기", "검토중": "대기", "": "대기",
    "승인": "승인", "approved": "승인", "active": "승인", "활성": "승인",
    "비활성": "비활성", "inactive": "비활성", "rejected": "비활성", "거절": "비활성", "정지": "비활성",
}


async def _partner_pre_update(session, obj, payload, request, _u):
    # B-2: status 가 None 외 빈 문자열도 skip — admin 이 다른 필드만 PATCH 했는데
    # form 이 status="" 를 함께 전송하는 케이스에서 _PARTNER_STATUS_NORMALIZE[""]
    # 가 "대기" 로 강제 변경하던 회귀 차단. 명시적 status 변경만 처리.
    if "status" in payload and payload["status"] is not None and str(payload["status"]).strip() != "":
        s = str(payload["status"]).strip().lower()
        normalized = _PARTNER_STATUS_NORMALIZE.get(s)
        if normalized is None:
            raise HTTPException(400, detail=f"허용되지 않은 status 값: {payload['status']!r}")
        payload["status"] = normalized


async def _partner_pre_create(session, payload, request, _u):
    # B-2: status 가 None 외 빈 문자열도 skip — admin 이 다른 필드만 PATCH 했는데
    # form 이 status="" 를 함께 전송하는 케이스에서 _PARTNER_STATUS_NORMALIZE[""]
    # 가 "대기" 로 강제 변경하던 회귀 차단. 명시적 status 변경만 처리.
    if "status" in payload and payload["status"] is not None and str(payload["status"]).strip() != "":
        s = str(payload["status"]).strip().lower()
        normalized = _PARTNER_STATUS_NORMALIZE.get(s)
        if normalized is None:
            raise HTTPException(400, detail=f"허용되지 않은 status 값: {payload['status']!r}")
        payload["status"] = normalized


# email 은 update 시 제거 — admin 이 PATCH 로 partner 이메일을 변경하면 partner 가
# 로그인 불가능해지는 계정 탈취 시나리오. 이메일 변경이 필요하면 별도 endpoint
# (current password 검증 + 본인 알림) 로 분리. 단 생성 시점에는 필요하므로
# create_fields 에만 포함.
_crud(Partner, "partners",
      allowed_fields={"company_name", "contact_name", "phone", "category", "intro", "status"},
      create_fields={"company_name", "contact_name", "email", "phone", "category", "intro", "status"},
      pre_create=_partner_pre_create,
      pre_update=_partner_pre_update,
      post_update=_partner_post_update)


# Partner 비밀번호 시드 — 어드민 전용 별도 엔드포인트.
# `password_hash` 자체는 `_crud(Partner)` allowed_fields 에 의도적으로 빼두었으므로
# 외부에서 hash 를 직접 PATCH 할 수 없음. 본 엔드포인트는 plaintext 를 받아
# bcrypt 로 해시한 후 저장 — 어드민(admin/developer) 권한 필요.
class PartnerSetPasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=128)


@router.post("/partners/{partner_id}/set-password", status_code=200)
async def set_partner_password(
    partner_id: int,
    payload: PartnerSetPasswordIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("partners", "write")),
):
    from auth import hash_password as _hash_pw, validate_password_strength
    from audit import log_event
    # 강도 검증 — Pydantic min_length=8 외에 admin 비번 설정과 동일한 정책 적용
    # (영문 대소문자/숫자/특수문자 포함). 약한 비번 차단.
    err = validate_password_strength(payload.password)
    if err:
        raise HTTPException(400, detail=err)
    partner = await session.get(Partner, partner_id)
    if not partner:
        raise HTTPException(404, detail="해당 파트너를 찾을 수 없습니다.")
    was_pending = partner.status == "대기"
    partner.password_hash = _hash_pw(payload.password)
    # admin 이 직접 set-password 한 경우는 운영자가 신청자에게 별도 안내한
    # 비밀번호이므로 강제 변경 플래그를 False 로 (휴대폰 끝 4자리 → 강한 비밀번호
    # 로 이미 한 단계 진행됐다는 의미).
    partner.must_change_password = False
    if was_pending:
        # 신규 시드 — 자동 승인 (운영자가 명시적으로 비밀번호를 설정 = 로그인 가능 의도).
        partner.status = "승인"
        partner.approved_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(partner)
    # 새로 '승인' 으로 전환된 경우만 안내 메일 발송 — 비밀번호 재발급 (이미 승인 상태) 은 안내 X.
    mail_result = {"status": "skipped", "error": "", "outbox_id": None}
    if was_pending:
        mail_result = await _send_partner_mail(session, kind="partner-approved", partner=partner)
    # audit — admin 이 어느 파트너의 비번을 set 했는지 추적 (forensic).
    # 비밀번호 자체는 절대 로깅 안 함 (detail 에 partner 식별 정보만).
    try:
        await log_event(
            session, request,
            action="partner.password.set",
            actor_user=_u,
            target_type="partner",
            target_id=str(partner.id),
            detail={
                "partner_email": partner.email,
                "was_pending": was_pending,
                "status_after": partner.status,
            },
        )
    except Exception as _e:  # noqa: BLE001
        # audit 실패가 비번 설정 자체를 막지 않게 silent fail.
        pass
    return {
        "ok": True,
        "partner_id": partner.id,
        "status": partner.status,
        "mail_status": mail_result["status"],
        "mail_error": mail_result.get("error", ""),
    }


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


async def _order_post_create(session, obj, payload, request, _u):
    """admin /api/orders POST 후 실제 LOT 차감. _order_pre_create 가 검증만
    했고 차감은 안 했으므로 여기서 reserve_stock_for_order 호출."""
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        return
    from routes_inventory import reserve_stock_for_order
    actor_id = getattr(_u, "id", None) if _u else None
    await reserve_stock_for_order(
        session, items=items, order_id=obj.id, actor_user_id=actor_id,
    )


async def _order_post_update(session, obj, payload, request, _u, prev_values):
    """admin 이 발주 status 를 '취소' 로 바꾸면 stock 복구. 다른 status
    변경은 stock 영향 없음."""
    new_status = payload.get("status")
    if not new_status:
        return
    prev_status = prev_values.get("status") if isinstance(prev_values, dict) else None
    if prev_status == "취소":
        return  # 이미 취소된 발주 — 중복 release 안 함.
    if new_status != "취소":
        return
    from routes_inventory import release_stock_for_order
    actor_id = getattr(_u, "id", None) if _u else None
    await release_stock_for_order(session, order_id=obj.id, actor_user_id=actor_id)


async def _validate_stock_for_items(session, items: list):
    """각 item 의 sku 별 가용 재고를 합계로 검증. Product.stock_count 사용
    (StockLot 까지는 V2 에서 FIFO 차감으로 확장).

    perf: items 마다 SELECT 1개씩 → N+1. items 의 SKU 들을 1번의 IN 쿼리로
    묶어 검증 → DB 왕복 1회. 발주 항목 10개면 10→1.
    """
    from models import Product
    # items 의 (sku, qty) 추출 — 같은 sku 가 여러 item 으로 들어오면 합산.
    requested: dict[str, int] = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        sku = (it.get("sku") or "").strip()
        qty = int(it.get("qty") or it.get("quantity") or 0)
        if not sku or qty <= 0:
            continue
        requested[sku] = requested.get(sku, 0) + qty
    if not requested:
        return

    # 1회 IN 쿼리 — N+1 → 1.
    q = await session.execute(
        select(Product.sku, Product.stock_count).where(Product.sku.in_(requested.keys()))
    )
    available_map = {sku: int(stock or 0) for sku, stock in q.all()}

    for sku, qty in requested.items():
        # 등록 안 된 SKU 는 legacy 호환 (skip).
        if sku not in available_map:
            continue
        available = available_map[sku]
        if qty > available:
            raise HTTPException(
                400,
                detail=f"재고 부족 — {sku} 의 가용 재고는 {available}개입니다 (요청: {qty}개).",
            )


# ---------------------------------------------------------------------------
# 공개 read 엔드포인트 — 어드민 인증 없이 사용자 페이지에서 호출.
# `_crud(Work)` / `_crud(SitePopup)` / `_crud(PartnerBrand)` 가 등록하는
# `/works/{item_id}` 같은 catch-all 패턴이 `/works/public` 을 가로채지 않도록
# *_crud(...) 호출들 전에* 더 specific 한 path 를 먼저 등록.

@router.get("/works/public")
async def list_public_works(session: AsyncSession = Depends(get_session)):
    """공개 사이트의 `/work` / `/work/{slug}` 가 호출. published=True 만 반환."""
    res = await session.execute(
        select(Work).where(Work.published == True).order_by(Work.sort_order, desc(Work.created_at))  # noqa: E712
    )
    rows = res.scalars().all()
    return {"ok": True, "items": [model_to_dict(r) for r in rows]}


@router.get("/popups/visible")
async def list_visible_popups(session: AsyncSession = Depends(get_session)):
    """공개 사이트의 `useSitePopups` 가 호출. active=True 만 반환."""
    res = await session.execute(
        select(SitePopup).where(SitePopup.active == True).order_by(desc(SitePopup.created_at))  # noqa: E712
    )
    rows = res.scalars().all()
    return {"ok": True, "items": [model_to_dict(r) for r in rows]}


@router.get("/partner-brands/visible")
async def list_visible_partner_brands(session: AsyncSession = Depends(get_session)):
    """공개 사이트의 `Home` 페이지 '함께하는 파트너사' 섹션이 호출. active=True 만."""
    res = await session.execute(
        select(PartnerBrand).where(PartnerBrand.active == True).order_by(PartnerBrand.sort_order, PartnerBrand.id)  # noqa: E712
    )
    rows = res.scalars().all()
    return {"ok": True, "items": [model_to_dict(r) for r in rows]}


@router.get("/promotions/visible")
async def list_visible_promotions(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """파트너 포털 의 PartnerPromotions 가 호출. **partner-scoped JWT 필수.**

    정책 (2026-05): 쿠폰/공지는 partner portal 로그인 후만 노출. 공개 사이트
    (Home, About 등) 에는 표시 금지. backend = source of truth.

    노출 조건:
      · active = True
      · valid_from 미설정 또는 현재 시각 이후
      · valid_to   미설정 또는 현재 시각 이전
      · usage_limit > 0 인 경우 usage_count < usage_limit
    응답 필드는 *공개 가시 항목만* (id/title/code/discount_*/valid_*). usage_count
    같은 운영 메타는 미노출.
    """
    # partner-scoped JWT 검증 — 비로그인 호출은 401.
    from routes_partner_auth import decode_partner_token
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else ""
    try:
        claims = decode_partner_token(token) if token else None
    except Exception:
        claims = None
    if not claims:
        raise HTTPException(status_code=401, detail="partner token required")

    now = datetime.now(timezone.utc)
    stmt = select(Promotion).where(Promotion.active == True)  # noqa: E712
    stmt = stmt.where(or_(Promotion.valid_from.is_(None), Promotion.valid_from <= now))
    stmt = stmt.where(or_(Promotion.valid_to.is_(None), Promotion.valid_to >= now))
    stmt = stmt.order_by(desc(Promotion.created_at)).limit(50)
    rows = (await session.execute(stmt)).scalars().all()
    items = []
    for p in rows:
        if p.usage_limit and p.usage_count >= p.usage_limit:
            continue
        items.append({
            "id": p.id,
            "title": p.title,
            "code": p.code,
            "discount_type": p.discount_type,
            "discount_value": p.discount_value,
            "valid_from": p.valid_from.isoformat() if p.valid_from else None,
            "valid_to": p.valid_to.isoformat() if p.valid_to else None,
            "active": p.active,
        })
    return {"ok": True, "items": items}


# 쿠폰 사용량 +1 — partner 가 발주 제출 시 호출. atomic UPDATE 로 race
# condition 차단 + PromotionConsumption row INSERT 로 멱등 보장.
class ConsumePromotionIn(BaseModel):
    promotion_id: int
    client_event_id: str = Field(min_length=1, max_length=80)
    quantity: int = Field(1, ge=1, le=10)


@router.post("/promotions/consume")
async def consume_promotion(
    payload: ConsumePromotionIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """쿠폰 사용량 atomic 증가. **partner-scoped JWT 필수** — 익명 DoS
    (attacker 가 임의 promotion_id 를 한도까지 부풀리기) 차단.

    동시성: `UPDATE ... WHERE usage_count < usage_limit` 으로 race-safe.
    멱등성: `PromotionConsumption(promotion_id, client_event_id)` UniqueConstraint
    가 같은 발주 제출의 재시도를 +1 한 번만 카운트.
    """
    # partner-scoped JWT 필수 — 미인증 호출은 401 (보안 감사 P0 권고).
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, detail="partner token required")
    try:
        from routes_partner_auth import decode_partner_token
        claims = decode_partner_token(auth.split(" ", 1)[1].strip())
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        claims = None
    if not claims or claims.get("scope") != "partner":
        raise HTTPException(401, detail="partner token required")
    try:
        partner_id = int(claims["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(401, detail="invalid partner token") from None

    # 1) 멱등 가드 — 같은 client_event_id 가 이미 있으면 그대로 200.
    existing = await session.execute(
        select(PromotionConsumption).where(
            PromotionConsumption.promotion_id == payload.promotion_id,
            PromotionConsumption.client_event_id == payload.client_event_id,
        )
    )
    if existing.scalar_one_or_none():
        promo = await session.get(Promotion, payload.promotion_id)
        return {
            "ok": True,
            "idempotent": True,
            "usage_count": (promo.usage_count if promo else 0),
            "remaining": (
                max(0, (promo.usage_limit or 0) - (promo.usage_count or 0))
                if promo and promo.usage_limit else None
            ),
        }

    # 2) atomic UPDATE — race condition 차단. usage_limit=0 (무제한) 도 +1 허용.
    from sqlalchemy import update as _update
    stmt = (
        _update(Promotion)
        .where(Promotion.id == payload.promotion_id)
        .where(Promotion.active == True)  # noqa: E712
        .where(
            (Promotion.usage_limit == 0) |
            (Promotion.usage_count < Promotion.usage_limit)
        )
        .values(usage_count=Promotion.usage_count + 1)
    )
    res = await session.execute(stmt)
    if (getattr(res, "rowcount", 0) or 0) == 0:
        # 한도 초과 / inactive / not found — 어느 쪽이든 사용 불가.
        promo = await session.get(Promotion, payload.promotion_id)
        if not promo:
            raise HTTPException(404, detail="해당 쿠폰을 찾을 수 없습니다.")
        if not promo.active:
            raise HTTPException(409, detail="비활성 쿠폰입니다.")
        raise HTTPException(409, detail="쿠폰 사용 한도를 초과했습니다.")

    # 3) 멱등 키 INSERT — UniqueConstraint 가 race 시점에 중복 INSERT 차단.
    try:
        session.add(PromotionConsumption(
            promotion_id=payload.promotion_id,
            client_event_id=payload.client_event_id,
            partner_id=partner_id,
        ))
        await session.flush()
    except Exception:  # noqa: BLE001
        # UniqueConstraint 충돌 = 동시 race 의 다른 worker 가 먼저 처리 = 멱등.
        # 그러나 우리는 이미 usage_count +1 했으므로 -1 보정 필요.
        await session.rollback()
        # rollback 후 다시 멱등 응답.
        promo2 = await session.get(Promotion, payload.promotion_id)
        return {
            "ok": True,
            "idempotent": True,
            "usage_count": (promo2.usage_count if promo2 else 0),
        }

    promo3 = await session.get(Promotion, payload.promotion_id)
    return {
        "ok": True,
        "usage_count": (promo3.usage_count if promo3 else 0),
        "remaining": (
            max(0, (promo3.usage_limit or 0) - (promo3.usage_count or 0))
            if promo3 and promo3.usage_limit else None
        ),
    }


# partner_id 는 update 시 제거 — admin 이 PATCH 로 Order 의 partner_id 를 변경하면
# cross-tenant leak (A 파트너 발주가 B 로 reassign → B 가 자기 발주가 아닌 것을
# 봄). 발주 소유권 변경이 필요하면 별도 명시적 endpoint (감사 강화) 로. 단
# 생성 시점에는 필요하므로 create_fields 에만 포함.
_crud(Order, "orders",
      allowed_fields={"title", "status", "amount", "items", "due_date", "note"},
      create_fields={"partner_id", "title", "status", "amount", "items", "due_date", "note"},
      pre_create=_order_pre_create, post_create=_order_post_create,
      pre_update=_order_pre_update, post_update=_order_post_update)

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

# /admin/mail-templates 라이브러리 (다중 템플릿). 옛 localStorage source-of-truth
# 를 대체 — 다른 브라우저/디바이스에서 동일 템플릿 표시. body 는 LONGTEXT 매핑
# (base64 inline 이미지 수용). variables 는 {{var}} placeholder 목록 JSON.
from models import MailTemplateLib as _MailTemplateLib_for_crud  # noqa: E402
_crud(_MailTemplateLib_for_crud, "mail-templates",
      allowed_fields={"name", "category", "subject", "body", "variables", "active", "created_by"})

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


# ── 파트너 가입 신청 (공개 POST) ─────────────────────────────────────────
# `/partners` 가입 신청 폼이 호출. status='대기' 로 Partner 행 생성 → admin 이
# `/admin/partners` 에서 승인 + 비밀번호 시드 후 partner 가 로그인 가능.
# 이미 존재 (email 매치) 시 idempotent — 기존 행 그대로 두고 200 반환.

class PartnerApplyIn(BaseModel):
    company_name: str
    contact_name: str = ""
    email: EmailStr
    phone: str = ""
    category: str = ""
    intro: str = ""
    privacy_consent: bool = False


_partner_apply_limiter = RateLimiter(max_calls=4, window_seconds=600)


# ── 파트너 메일 — 접수 회신 / 승인 안내 공통 helper ─────────────────────
# kind = "partner-application-received" → 신청 직후 자동 회신
# kind = "partner-approved"             → admin 이 승인/비밀번호 시드 후 안내
# 비밀번호 평문은 본문에 절대 포함 X — `partner_url` + `email` 로만 안내.

_PARTNER_MAIL_FALLBACK = {
    "partner-application-received": {
        "subject": "[DAEMU] 파트너 신청이 접수되었습니다",
        "body": (
            "{{company}} 담당자 {{person}} 님,\n\n"
            "DAEMU 파트너 신청이 정상 접수되었습니다.\n"
            "관리자 검토 후 승인되면 별도 안내 메일이 발송됩니다 (영업일 1–2일).\n\n"
            "─ 회사명: {{company}}\n"
            "─ 담당자: {{person}}\n"
            "─ 이메일: {{email}}\n"
            "─ 연락처: {{phone}}\n"
            "─ 신청 시각: {{submitted_at}}\n"
            "─ 현재 상태: {{status}}\n\n"
            "파트너 페이지: {{partner_url}}\n"
            "사이트: {{site_url}}\n\n"
            "본 메일은 자동 발송된 안내입니다. 비밀번호 같은 민감 정보는 포함하지 않습니다.\n"
            "감사합니다.\nDAEMU"
        ),
    },
    "partner-approved": {
        "subject": "[DAEMU] 파트너 계정이 활성화되었습니다",
        "body": (
            "{{company}} 담당자 {{person}} 님,\n\n"
            "DAEMU 파트너 계정이 승인/활성화되었습니다.\n"
            "이제 파트너 포털에 로그인해 발주, 자료 다운로드 등을 이용하실 수 있습니다.\n\n"
            "─ 로그인 이메일: {{email}}\n"
            "─ 처음 비밀번호: 신청 시 입력하신 휴대폰 번호의 끝 4자리 ({{phone_last4}})\n"
            "─ 첫 로그인 후 비밀번호 변경을 안내드립니다.\n"
            "─ 승인 시각: {{approved_at}}\n"
            "─ 상태: {{status}}\n\n"
            "파트너 페이지: {{partner_url}}\n"
            "사이트: {{site_url}}\n\n"
            "감사합니다.\nDAEMU"
        ),
    },
}


async def _send_partner_mail(
    session: AsyncSession,
    *,
    kind: str,
    partner: "Partner",
    extra_vars: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """파트너 자동 메일 발송 — Outbox 에 결과 기록 + mail_status 반환.

    반환: {"status": "sent"|"failed"|"simulated"|"skipped",
           "error": "...", "outbox_id": int|None}
    DB 트랜잭션 자체는 caller (apply / set-password endpoint) 의 session_scope 가
    commit. 본 함수는 outbox row 만 add() — 발송 실패해도 상위 트랜잭션 영향 X.
    """
    from models import MailTemplate, MailTemplateLib, Outbox
    from main import send_email, email_provider, SMTP_FROM, SENDGRID_FROM

    # 1) DB 템플릿 조회 — 우선순위:
    #    (a) `mail_templates.kind == kind` → /admin/mail 카테고리 dropdown 이
    #        편집하는 단일 row. 운영자가 가장 자주 보는 화면이라 우선.
    #    (b) `mail_template_lib.name == kind` → /admin/mail-templates 라이브러리
    #        의 partner 카테고리 row.
    #    (c) hardcoded fallback (`_PARTNER_MAIL_FALLBACK`) — 둘 다 없을 때.
    subject_tpl = _PARTNER_MAIL_FALLBACK[kind]["subject"]
    body_tpl = _PARTNER_MAIL_FALLBACK[kind]["body"]
    try:
        # (a) /admin/mail 의 단일 row.
        tres1 = await session.execute(
            select(MailTemplate).where(MailTemplate.kind == kind).limit(1)
        )
        tpl1 = tres1.scalar_one_or_none()
        if tpl1 and getattr(tpl1, "active", True) is not False:
            subject_tpl = tpl1.subject or subject_tpl
            body_tpl = tpl1.body or body_tpl
        else:
            # (b) /admin/mail-templates 라이브러리 row.
            tres2 = await session.execute(
                select(MailTemplateLib).where(MailTemplateLib.name == kind).limit(1)
            )
            tpl2 = tres2.scalar_one_or_none()
            if tpl2 and getattr(tpl2, "active", True) is not False:
                subject_tpl = tpl2.subject or subject_tpl
                body_tpl = tpl2.body or body_tpl
    except Exception:  # noqa: BLE001
        # mail_template_lib 가 없거나 schema 문제여도 fallback 으로 계속.
        pass

    site_url = os.environ.get("PUBLIC_SITE_URL", "https://juyoungjun.github.io/daemu-website").rstrip("/")
    partner_url = site_url + "/partners"
    submitted_at = (partner.created_at.isoformat() if partner.created_at else "")
    approved_at = (partner.approved_at.isoformat() if getattr(partner, "approved_at", None) else "")
    # 처음 비밀번호 정책: 휴대폰 번호 끝 4자리 (숫자만 추출). frontend partnerAuth
    # 의 default password 와 동일 — 신청자가 본 메일을 받고 즉시 로그인 가능.
    phone_digits = re.sub(r"\D+", "", str(partner.phone or ""))
    phone_last4 = phone_digits[-4:] if len(phone_digits) >= 4 else phone_digits

    vars_ = {
        "company": partner.company_name or "",
        "name": partner.contact_name or partner.company_name or "",
        "person": partner.contact_name or "",
        "email": partner.email or "",
        "phone": partner.phone or "",
        "phone_last4": phone_last4,
        "status": partner.status or "",
        "submitted_at": submitted_at,
        "approved_at": approved_at,
        "site_url": site_url,
        "partner_url": partner_url,
    }
    if extra_vars:
        vars_.update({k: str(v) for k, v in extra_vars.items()})

    subject = _apply_vars(subject_tpl, vars_)
    raw_body = _apply_vars(body_tpl, vars_)
    # MailTemplate.images / MailTemplateLib (현재 images 컬럼 없음 — None 처리).
    # text 측 placeholder 제거 + html 측 url 매핑. raw 마커가 recipient 메일에
    # 노출되지 않게 보장.
    tpl_images: list = []
    try:
        tpl_images = list(getattr(tpl1, "images", None) or [])
    except Exception:
        tpl_images = []
    body = _strip_image_placeholders(raw_body)
    html_body = _wrap_html(raw_body, images=tpl_images)

    to_email = (partner.email or "").strip()
    if not to_email:
        return {"status": "skipped", "error": "no recipient", "outbox_id": None}

    status = "simulated"
    error = ""
    rid = None
    provider_now = email_provider()
    if provider_now != "none":
        if provider_now == "sendgrid":
            from_addr = SENDGRID_FROM or FROM_EMAIL
        elif provider_now == "smtp":
            from_addr = SMTP_FROM or FROM_EMAIL
        else:
            from_addr = FROM_EMAIL
        try:
            result = await send_email({
                "from": from_addr,
                "to": [to_email],
                "reply_to": DEFAULT_REPLY_TO,
                "subject": subject,
                "text": body,
                "html": html_body,
            })
            if result.get("ok"):
                status = "sent"
                rid = result.get("id")
            else:
                status = "failed"
                error = str(result.get("error", "send failed"))[:200]
        except Exception as e:  # noqa: BLE001
            status = "failed"
            error = (f"{type(e).__name__}: {e!r}")[:200]

    ob = Outbox(
        type=kind,
        recipient=to_email,
        subject=subject[:255],
        body=body[:8000],
        status=status,
        error=error,
        payload={"trigger": kind, "partner_id": partner.id, "messageId": rid},
    )
    session.add(ob)
    try:
        await session.flush()
    except Exception:  # noqa: BLE001
        # outbox INSERT 실패해도 caller 의 본 트랜잭션 (partner 행 INSERT/UPDATE) 은 유지.
        pass
    return {"status": status, "error": error, "outbox_id": getattr(ob, "id", None)}


@router.post("/partners/apply", status_code=201)
async def partner_apply(
    payload: PartnerApplyIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """공개 — 파트너 가입 신청. 인증 필요 X. status='대기' 로 신규 Partner 행
    추가. admin 이 `/admin/partners` 에서 승인 + 비밀번호 시드 후 로그인 가능.

    응답에 `mail_status` 포함 — 신청 접수 자동회신 메일 발송 결과를 명시적으로
    노출 (sent / failed / simulated / skipped). 메일이 실패해도 신청 row 자체는
    저장 — 운영자가 outbox 에서 재발송 또는 대안 처리 가능.
    """
    ip = _client_ip(request)
    if not _partner_apply_limiter.check(ip):
        await _record_rate_limit(session, request, endpoint="/api/partners/apply")
        raise HTTPException(429, detail="신청이 너무 빠르게 접수되었습니다. 잠시 후 다시 시도해 주세요.")
    if not payload.privacy_consent:
        raise HTTPException(400, detail="개인정보 수집·이용 동의가 필요합니다.")
    email = str(payload.email).strip().lower()
    if not email:
        raise HTTPException(400, detail="이메일이 필요합니다.")
    res = await session.execute(select(Partner).where(Partner.email == email))
    existing = res.scalar_one_or_none()
    if existing:
        # 멱등 — 중복 신청 시 메일 재발송 안 함 (남용 방지). admin 화면에서 status 확인.
        return {
            "ok": True, "already": True,
            "partner_id": existing.id, "status": existing.status,
            "mail_status": "skipped",
            "message": "이미 등록된 이메일입니다. 관리자 안내를 기다려 주세요.",
        }
    # 신청 시점에 *처음 비밀번호 = 휴대폰 끝 4자리* 자동 시드.
    # 휴대폰 4자리 미만 → 신청 자체는 받되 비밀번호는 비워두고 admin 이 별도 set.
    # 처음 비밀번호 정책은 partner-approved 메일 본문에 동일하게 안내.
    # status='대기' 라 login 은 admin 이 '승인' 으로 status 변경 후에만 가능 — 안전.
    from auth import hash_password as _hash_pw
    phone_digits = re.sub(r"\D+", "", str(payload.phone or ""))
    init_pw = phone_digits[-4:] if len(phone_digits) >= 4 else ""
    partner = Partner(
        company_name=str(payload.company_name).strip()[:190],
        contact_name=str(payload.contact_name or "").strip()[:120],
        email=email,
        phone=str(payload.phone or "").strip()[:40],
        category=str(payload.category or "").strip()[:60],
        intro=str(payload.intro or "")[:2000],
        status="대기",
        password_hash=_hash_pw(init_pw) if init_pw else "",
        # 휴대폰 끝 4자리 일회용 비밀번호 — 첫 로그인 시 강제 변경 (frontend 가 분기).
        must_change_password=True,
    )
    session.add(partner)
    await session.flush()
    await session.refresh(partner)
    # 자동 접수 회신. 실패해도 신청 자체는 유지.
    mail_result = await _send_partner_mail(session, kind="partner-application-received", partner=partner)
    return {
        "ok": True,
        "partner_id": partner.id,
        "status": partner.status,
        "mail_status": mail_result["status"],
        "mail_error": mail_result.get("error", ""),
        "message": "파트너 신청이 접수되었습니다.",
    }


@router.post("/newsletter/subscribe", status_code=201)
async def newsletter_subscribe(
    payload: NewsletterSubscribeIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Public — Partners/Contact page subscribe form posts here."""
    ip = _client_ip(request)
    if not _newsletter_limiter.check(ip):
        await _record_rate_limit(session, request, endpoint="/api/newsletter/subscribe")
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
    # `/admin/mail` 화면이 카테고리 dropdown 으로 다음 kind 들을 직접 편집:
    #   · auto-reply                       — Contact 폼 자동회신 (공개 GET)
    #   · admin-reply                      — admin 측 1:1 답신
    #   · document                         — 견적/계약 첨부 메일
    #   · partner-application-received     — 파트너 가입 신청 자동회신
    #   · partner-approved                 — 파트너 승인/활성화 안내
    kind: str = Field(pattern=r"^(auto-reply|admin-reply|document|partner-application-received|partner-approved)$")
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
    # SQLAlchemy 2.x async: server-side default (updated_at ON UPDATE
    # CURRENT_TIMESTAMP) 가 flush 후 expired 상태 → 직후 model_to_dict 가
    # attribute lazy-load 시도 → MissingGreenlet 500. _crud factory 가 이미
    # 같은 사유로 session.refresh 를 사용 — 본 단건 라우트도 동일하게 보강.
    # (라이브 incident 2026-05-07 02:49:05 traceback 의 직접 원인.)
    await session.refresh(tpl)
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


# ---------------------------------------------------------------------------
# Promotion consume — increment usage_count when a coupon is redeemed.
#
# Public POST: paired with the partner shop / order checkout. Validation:
#   · code or id 둘 중 하나로 식별
#   · active=True 여야 함
#   · usage_limit > 0 일 때 usage_count >= usage_limit 면 410 Gone
#   · valid_from / valid_to 범위 외면 422
# 멱등성: client_event_id (UUID) 가 같이 오면 같은 이벤트의 재호출은 +0.
# 재호출 추적은 outbox(또는 별도 promotion_consume_log) 테이블 없이도 동작.
# 본 demo 단계에서는 Redis 등 분산 멱등 캐시 없이 단일 DB 트랜잭션 + 재호출
# 시 같은 client_event_id 라면 무시하는 in-memory dict 로 보강 (best-effort).
# 운영 단계에서 promotion_consume_log 테이블을 추가해 강한 멱등 가능.

class PromotionConsumeIn(BaseModel):
    code: str | None = None
    promotion_id: int | None = None
    client_event_id: str | None = None  # 멱등성 token (UUID)
    quantity: int = 1


_promotion_consume_seen: set[str] = set()  # 단일 프로세스 내 best-effort 멱등 캐시
_promotion_consume_seen_max = 5000


@router.post("/promotions/consume", status_code=200)
async def consume_promotion(
    payload: PromotionConsumeIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Public — 쿠폰 적용 시 usage_count +n.
    인증 미요구 (파트너 포털이 어드민 토큰 없이 호출). 동일 client_event_id 의
    재호출은 in-memory dedup 으로 한 번만 +n 처리.
    """
    if not payload.code and not payload.promotion_id:
        raise HTTPException(400, detail="code 또는 promotion_id 가 필요합니다.")

    # in-memory dedup — 동일 프로세스/세션 안에서만 효과. 운영 단계 강화 예정.
    if payload.client_event_id:
        evt = str(payload.client_event_id)[:64]
        if evt in _promotion_consume_seen:
            # 이미 처리됨 — 현재 상태만 반환.
            stmt = select(Promotion)
            if payload.promotion_id:
                stmt = stmt.where(Promotion.id == payload.promotion_id)
            else:
                stmt = stmt.where(Promotion.code == (payload.code or "").strip())
            res = await session.execute(stmt)
            promo = res.scalar_one_or_none()
            if promo:
                return {"ok": True, "already": True, "promotion": model_to_dict(promo)}
            return {"ok": True, "already": True}

    stmt = select(Promotion)
    if payload.promotion_id:
        stmt = stmt.where(Promotion.id == payload.promotion_id)
    else:
        stmt = stmt.where(Promotion.code == (payload.code or "").strip())
    res = await session.execute(stmt)
    promo = res.scalar_one_or_none()
    if not promo:
        raise HTTPException(404, detail="해당 쿠폰을 찾을 수 없습니다.")
    if not promo.active:
        raise HTTPException(409, detail="비활성 처리된 쿠폰입니다.")
    now = datetime.now(timezone.utc)
    if promo.valid_from and now < promo.valid_from:
        raise HTTPException(422, detail="아직 사용 시작일 이전인 쿠폰입니다.")
    if promo.valid_to and now > promo.valid_to:
        raise HTTPException(410, detail="만료된 쿠폰입니다.")
    qty = max(1, int(payload.quantity or 1))
    if promo.usage_limit and (promo.usage_count + qty) > promo.usage_limit:
        raise HTTPException(410, detail="사용 한도가 모두 소진된 쿠폰입니다.")

    promo.usage_count = int(promo.usage_count or 0) + qty
    await session.flush()

    if payload.client_event_id:
        evt = str(payload.client_event_id)[:64]
        _promotion_consume_seen.add(evt)
        if len(_promotion_consume_seen) > _promotion_consume_seen_max:
            # naive eviction — 가장 오래된 N 개 정리.
            for _ in range(1000):
                _promotion_consume_seen.pop()

    return {"ok": True, "promotion": model_to_dict(promo)}


# ---------------------------------------------------------------------------
# 어드민 KPI 집계 — `/admin/stats` 페이지가 backend GET 한 번으로 KPI 위젯
# 전체를 채울 수 있도록. localStorage 다중 read 의존 제거.

@router.get("/admin/stats")
async def admin_stats(
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("monitoring", "read")),
):
    """모든 어드민 데이터셋의 행 수 집계. monitoring read 권한 (admin / developer).
    각 카운트는 SELECT COUNT 한 번씩 — 무거운 페이지 스캔 없음.
    """
    from models import (
        Inquiry, Partner, Order, Work, MailTemplate, Outbox, SitePopup,
        CrmCustomer, Campaign, Promotion, ContentBlock, NewsletterSubscriber,
        PartnerBrand, Announcement, Document, DocumentTemplate, ShortLink,
        AdminUser as AdminUserModel,
    )

    async def _count(model):
        try:
            r = await session.execute(select(func.count()).select_from(model))
            return int(r.scalar_one() or 0)
        except Exception:
            return 0

    # 일부 옛 schema 의 partner.password_hash 누락 / media_assets 미생성 등
    # 실패 시 0 반환 — 페이지가 깨지지 않도록.
    try:
        from models import MediaAsset  # noqa: WPS433
        media_count = await _count(MediaAsset)
    except Exception:
        media_count = 0

    # Promotion / Campaign 의 active 여부 또는 sent 등 상태별 분리.
    promo_active = (await session.execute(
        select(func.count()).select_from(Promotion).where(Promotion.active.is_(True))
    )).scalar_one()
    sub_active = (await session.execute(
        select(func.count()).select_from(NewsletterSubscriber).where(NewsletterSubscriber.status == "active")
    )).scalar_one()
    pop_active = (await session.execute(
        select(func.count()).select_from(SitePopup).where(SitePopup.active.is_(True))
    )).scalar_one()

    counts = {
        "works": await _count(Work),
        "inquiries": await _count(Inquiry),
        "partners": await _count(Partner),
        "orders": await _count(Order),
        "crm": await _count(CrmCustomer),
        "campaigns": await _count(Campaign),
        "promotions": await _count(Promotion),
        "promotions_active": int(promo_active or 0),
        "popups": await _count(SitePopup),
        "popups_active": int(pop_active or 0),
        "mail_templates": await _count(MailTemplate),
        "outbox": await _count(Outbox),
        "newsletter_subscribers": await _count(NewsletterSubscriber),
        "newsletter_active": int(sub_active or 0),
        "partner_brands": await _count(PartnerBrand),
        "announcements": await _count(Announcement),
        "documents": await _count(Document),
        "document_templates": await _count(DocumentTemplate),
        "short_links": await _count(ShortLink),
        "media": media_count,
        "admin_users": await _count(AdminUserModel),
    }
    return {"ok": True, "counts": counts}
