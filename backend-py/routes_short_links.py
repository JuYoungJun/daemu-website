"""ShortLink — QR 캠페인 보안 단축 URL.

QR_SECURITY.md Stage 2 의 백엔드 구현. 도메인 확정 전엔 Render URL
(`https://daemu-py.onrender.com/r/{short_id}`) 을 short link prefix 로
사용. 도메인 확정 시 SHORT_LINK_BASE env 만 갈아끼우면 됨.

흐름:
  1. POST /api/short-links {target_url, label, expires_at?, max_clicks?}
     → 8자 short_id 생성, HMAC 서명, DB insert
     → 응답에 short_url 포함
  2. GET  /r/{short_id}
     → 만료/취소/할당량 검증 → click_count++ → 302 redirect
  3. GET  /api/short-links → 어드민 목록
  4. PATCH /api/short-links/{id} {revoke?: bool, ...}
  5. GET  /api/short-links/{id}/stats → 일자별 클릭 추이

보안:
  - short_id 는 secrets.token_urlsafe(6) — ~50bit 엔트로피.
  - sig 는 HMAC-SHA256(target_url + short_id) — server secret.
  - target_url 검증: http(s)/mailto/tel 만, validateOutboundUrl 패턴.
  - 클릭 로그 PII 최소화: ip 는 hash, ua 는 family 만, referer 는 host.
  - rate limit: IP당 분당 60회 (간단 in-memory bucket).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_user, require_admin
from db import get_session, session_scope
from models import AdminUser, ShortLink, ShortLinkClick


# ── 설정 ──────────────────────────────────────────────────────────
SHORT_LINK_HMAC_SECRET = os.environ.get("SHORT_LINK_HMAC_SECRET", "").encode("utf-8")
SHORT_LINK_BASE = os.environ.get(
    "SHORT_LINK_BASE",
    "https://daemu-py.onrender.com/r/",
)
DEFAULT_TTL_DAYS = int(os.environ.get("SHORT_LINK_DEFAULT_TTL_DAYS", "365"))


# ── 보안 헬퍼 ─────────────────────────────────────────────────────
SAFE_URL_RE = re.compile(r"^(https?|mailto|tel):", re.IGNORECASE)


def validate_target_url(url: str) -> str:
    """target_url 화이트리스트. javascript: 등 차단."""
    if not url:
        raise HTTPException(400, "target_url 이 비어있습니다.")
    url = url.strip()
    if not SAFE_URL_RE.match(url):
        raise HTTPException(400, "허용되지 않은 URL 스키마입니다 (http/https/mailto/tel 만).")
    if len(url) > 2000:
        raise HTTPException(400, "target_url 이 너무 깁니다 (최대 2000자).")
    return url


def make_short_id() -> str:
    return secrets.token_urlsafe(6)  # 8글자


def make_signature(target_url: str, short_id: str) -> str:
    if not SHORT_LINK_HMAC_SECRET:
        # secret 미설정 시 임의 32자 — 보안 약하지만 fail-open 보다는 나음.
        return hashlib.sha256((target_url + short_id).encode("utf-8")).hexdigest()
    return hmac.new(
        SHORT_LINK_HMAC_SECRET,
        (target_url + short_id).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_signature(short: ShortLink) -> bool:
    expected = make_signature(short.target_url, short.short_id)
    return hmac.compare_digest(expected, short.sig or "")


def hash_ip(ip: str) -> str:
    if not ip:
        return ""
    secret = SHORT_LINK_HMAC_SECRET or b"daemu-fallback-salt"
    return hmac.new(secret, ip.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def ua_family(ua: str) -> str:
    if not ua:
        return ""
    s = ua.lower()
    is_mobile = "mobile" in s or "android" in s or "iphone" in s or "ipad" in s
    family = (
        "edge" if "edg/" in s
        else "firefox" if "firefox" in s
        else "chrome" if "chrome" in s or "chromium" in s
        else "safari" if "safari" in s
        else "other"
    )
    return ("mobile-" + family) if is_mobile else family


def extract_host(referer: str) -> str:
    if not referer:
        return ""
    m = re.match(r"^https?://([^/?#]+)", referer, re.IGNORECASE)
    return (m.group(1) if m else "")[:120]


# ── 단순 in-memory rate limit ─────────────────────────────────────
_RATE_BUCKETS: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW_SEC = 60
_RATE_MAX_PER_WINDOW = 60


def rate_limit_ok(ip: str) -> bool:
    if not ip:
        return True
    now = datetime.now(timezone.utc).timestamp()
    bucket = _RATE_BUCKETS[ip]
    # 60초 이전 항목 정리
    cutoff = now - _RATE_WINDOW_SEC
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= _RATE_MAX_PER_WINDOW:
        return False
    bucket.append(now)
    return True


# ── Schemas ───────────────────────────────────────────────────────
class CreateShortLinkIn(BaseModel):
    target_url: str
    label: str = ""
    expires_at: datetime | None = None
    max_clicks: int | None = Field(default=None, ge=1, le=1_000_000)


class ShortLinkOut(BaseModel):
    id: int
    short_id: str
    short_url: str
    target_url: str
    label: str
    expires_at: datetime | None
    max_clicks: int | None
    click_count: int
    last_clicked_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str
    created_at: datetime


class UpdateShortLinkIn(BaseModel):
    revoke: bool | None = None
    revoked_reason: str | None = None
    label: str | None = None
    expires_at: datetime | None = None
    max_clicks: int | None = None


def to_out(row: ShortLink) -> dict[str, Any]:
    return {
        "id": row.id,
        "short_id": row.short_id,
        "short_url": SHORT_LINK_BASE + row.short_id,
        "target_url": row.target_url,
        "label": row.label or "",
        "expires_at": row.expires_at,
        "max_clicks": row.max_clicks,
        "click_count": row.click_count or 0,
        "last_clicked_at": row.last_clicked_at,
        "revoked_at": row.revoked_at,
        "revoked_reason": row.revoked_reason or "",
        "created_at": row.created_at,
    }


# ── Router ────────────────────────────────────────────────────────
admin_router = APIRouter(prefix="/api/short-links", tags=["short-links"])


@admin_router.get("")
async def list_links(
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_user),
):
    res = await session.execute(
        select(ShortLink).order_by(desc(ShortLink.created_at)).limit(500)
    )
    rows = res.scalars().all()
    return {"ok": True, "items": [to_out(r) for r in rows]}


@admin_router.post("", status_code=201)
async def create_link(
    payload: CreateShortLinkIn,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_user),
):
    target_url = validate_target_url(payload.target_url)
    # short_id 충돌 방지 — 최대 5번 retry.
    short_id = ""
    for _ in range(5):
        candidate = make_short_id()
        exists = await session.execute(
            select(ShortLink).where(ShortLink.short_id == candidate)
        )
        if not exists.scalar_one_or_none():
            short_id = candidate
            break
    if not short_id:
        raise HTTPException(500, "short_id 생성 실패 — 잠시 후 재시도하세요.")

    expires_at = payload.expires_at
    if expires_at is None and DEFAULT_TTL_DAYS > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(days=DEFAULT_TTL_DAYS)

    row = ShortLink(
        short_id=short_id,
        target_url=target_url,
        sig=make_signature(target_url, short_id),
        expires_at=expires_at,
        max_clicks=payload.max_clicks,
        label=(payload.label or "")[:120],
        created_by=me.id,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return {"ok": True, "item": to_out(row)}


@admin_router.patch("/{link_id}")
async def update_link(
    link_id: int,
    payload: UpdateShortLinkIn,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_user),
):
    row = await session.get(ShortLink, link_id)
    if not row:
        raise HTTPException(404, "short link not found")
    if payload.revoke is True and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_reason = (payload.revoked_reason or "운영자 무효화")[:255]
    elif payload.revoke is False:
        row.revoked_at = None
        row.revoked_reason = ""
    if payload.label is not None:
        row.label = payload.label[:120]
    if payload.expires_at is not None:
        row.expires_at = payload.expires_at
    if payload.max_clicks is not None:
        row.max_clicks = payload.max_clicks
    await session.flush()
    await session.refresh(row)
    return {"ok": True, "item": to_out(row)}


@admin_router.delete("/{link_id}", status_code=204)
async def delete_link(
    link_id: int,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_admin),
):
    row = await session.get(ShortLink, link_id)
    if not row:
        return
    await session.delete(row)


@admin_router.get("/{link_id}/stats")
async def link_stats(
    link_id: int,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_user),
):
    row = await session.get(ShortLink, link_id)
    if not row:
        raise HTTPException(404, "short link not found")
    # 일자별 클릭 (last 30 days).
    since = datetime.now(timezone.utc) - timedelta(days=30)
    daily_q = await session.execute(
        select(
            func.date(ShortLinkClick.clicked_at).label("d"),
            func.count(ShortLinkClick.id).label("n"),
        )
        .where(ShortLinkClick.short_link_id == link_id)
        .where(ShortLinkClick.clicked_at >= since)
        .group_by(func.date(ShortLinkClick.clicked_at))
    )
    daily = [{"date": str(r.d), "count": r.n} for r in daily_q.all()]

    # ua 집계
    ua_q = await session.execute(
        select(ShortLinkClick.ua_family, func.count(ShortLinkClick.id))
        .where(ShortLinkClick.short_link_id == link_id)
        .group_by(ShortLinkClick.ua_family)
    )
    ua = [{"family": r[0] or "unknown", "count": r[1]} for r in ua_q.all()]

    # 최근 클릭 10건
    recent_q = await session.execute(
        select(ShortLinkClick)
        .where(ShortLinkClick.short_link_id == link_id)
        .order_by(desc(ShortLinkClick.clicked_at))
        .limit(10)
    )
    recent = [
        {
            "clicked_at": c.clicked_at,
            "ua_family": c.ua_family,
            "referer_host": c.referer_host,
        }
        for c in recent_q.scalars().all()
    ]
    return {
        "ok": True,
        "link": to_out(row),
        "daily": daily,
        "ua_breakdown": ua,
        "recent": recent,
    }


# ── Public redirect ───────────────────────────────────────────────
public_router = APIRouter(tags=["short-links-public"])


@public_router.get("/r/{short_id}")
async def follow_short_link(short_id: str, request: Request):
    """단축링크 redirect — 클릭 카운트/이력 기록 후 target_url 로 302.

    설계 원칙: redirect 자체는 절대 500 으로 막혀선 안 된다. 그래서
      - lookup/검증 단계와 click 기록 단계를 **별도 세션** 으로 분리.
      - lookup 세션이 깨끗하게 닫힌 뒤 click 기록을 시도하므로 INSERT
        실패가 redirect 의 outer commit 을 오염시킬 수 없다.
      - 모든 예외에 request_id 동봉 logs.
    """
    rid = getattr(request.state, "request_id", "no-id")

    if len(short_id) > 16 or not re.match(r"^[A-Za-z0-9_\-]+$", short_id):
        raise HTTPException(404, "invalid short_id")

    # ── Phase 1: lookup + 검증 (별도 세션, 깨끗하게 commit/close) ──
    target_url: str | None = None
    row_id: int | None = None
    revoke_signature_mismatch = False
    try:
        async with session_scope() as session:
            res = await session.execute(
                select(ShortLink).where(ShortLink.short_id == short_id)
            )
            row = res.scalar_one_or_none()
            if not row:
                raise HTTPException(404, "short link not found")
            if row.revoked_at is not None:
                raise HTTPException(410, "이 링크는 더 이상 사용할 수 없습니다.")
            if row.expires_at and row.expires_at < datetime.now(timezone.utc):
                raise HTTPException(410, "만료된 링크입니다.")
            if row.max_clicks is not None and (row.click_count or 0) >= row.max_clicks:
                raise HTTPException(410, "사용 가능 횟수가 소진된 링크입니다.")
            if not verify_signature(row):
                row.revoked_at = datetime.now(timezone.utc)
                row.revoked_reason = "signature mismatch"
                revoke_signature_mismatch = True
            else:
                target_url = row.target_url
                row_id = row.id
                row.click_count = (row.click_count or 0) + 1
                row.last_clicked_at = datetime.now(timezone.utc)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        import traceback
        print(f"[short-links] rid={rid} lookup phase failed: {e!r}")
        traceback.print_exc()
        raise HTTPException(503, "단축 링크 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.")

    if revoke_signature_mismatch:
        raise HTTPException(410, "링크 서명 검증 실패 — 자동 무효화되었습니다.")

    if not target_url:
        # 도달 불가 — 위 분기에서 다 raise 했어야 함. 안전망.
        raise HTTPException(404, "short link not found")

    # ── Rate limit (DB 무관) ─────────────────────────────────────
    ip = request.client.host if request.client else ""
    if not rate_limit_ok(ip):
        raise HTTPException(429, "rate limit exceeded — 잠시 후 다시 시도해 주세요.")

    # ── Phase 2: click 기록 (best-effort; 실패해도 redirect 진행) ──
    try:
        async with session_scope() as click_session:
            click_session.add(ShortLinkClick(
                short_link_id=row_id,
                ip_hash=hash_ip(ip)[:64],
                ua_family=ua_family(request.headers.get("user-agent", ""))[:40],
                referer_host=extract_host(request.headers.get("referer", ""))[:120],
            ))
    except Exception as e:  # noqa: BLE001
        import traceback
        print(f"[short-links] rid={rid} click record INSERT failed (redirect 진행): {e!r}")
        traceback.print_exc()

    return RedirectResponse(url=target_url, status_code=302)
