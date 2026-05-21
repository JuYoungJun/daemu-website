"""파트너 인증 — `/api/partner-auth/*`.

어드민 JWT 와 분리된 partner-scoped 인증. JWT payload 의 `scope: 'partner'`
클레임으로 admin-scoped 엔드포인트(`/api/users` 등) 와 자동 격리.

흐름:
  1) `POST /api/partner-auth/login` { email, password } → 200 { token, partner }
  2) frontend 가 token 을 localStorage `daemu_partner_token` 에 저장 (어드민
     `daemu_admin_token` 과 분리)
  3) `GET /api/partner-auth/me` (Bearer token) → 200 { partner }
  4) `POST /api/partner-auth/logout` (단순 stateless — 클라가 token 삭제)
  5) partner-scoped 엔드포인트 (`/api/partner/orders` 등) 가 require_partner_token
     의존성으로 token 의 scope 검증.

보안:
  · password_hash 는 admin 과 동일한 bcrypt + passlib (auth.pwd_ctx).
  · JWT_SECRET 공유 — payload 의 scope 로 admin/partner 구분.
  · 로그인 throttle — admin login 의 _LoginThrottle 와 별도 인스턴스.
  · 비활성/대기 상태 파트너는 로그인 거부.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text as _sa_text
from sqlalchemy.ext.asyncio import AsyncSession

import jwt as _jwt

from auth import (
    JWT_ALG, JWT_SECRET, JWT_TTL_HOURS,
    hash_password, verify_password,
    validate_password_strength,
    _LoginThrottle, _client_ip, _DUMMY_BCRYPT_HASH,
)
from db import get_session
from models import Partner


router = APIRouter(prefix="/api/partner-auth", tags=["partner-auth"])

# admin 과 별도 throttle — 파트너 로그인 brute force 가 admin throttle 잠금에
# 영향 주지 않도록 분리.
_partner_login_throttle = _LoginThrottle()


def issue_partner_token(partner: Partner) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(partner.id),
        "email": partner.email,
        "scope": "partner",  # admin JWT 와 격리하는 핵심 클레임
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    return _jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_partner_token(token: str) -> dict[str, Any]:
    try:
        claims = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except _jwt.ExpiredSignatureError:
        raise HTTPException(401, detail="token expired") from None
    except _jwt.InvalidTokenError:
        raise HTTPException(401, detail="invalid token") from None
    if claims.get("scope") != "partner":
        # admin token 으로 partner-scoped 호출 차단 (역도 동일).
        raise HTTPException(403, detail="partner-scoped token이 필요합니다.")
    return claims


async def require_partner_token(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> Partner:
    """partner-scoped 엔드포인트의 의존성. 어드민 JWT 또는 만료/위조 토큰은 거부."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="파트너 로그인이 필요합니다.")
    token = authorization[7:].strip()
    claims = decode_partner_token(token)
    partner = await session.get(Partner, int(claims["sub"]))
    if not partner:
        raise HTTPException(401, detail="파트너 계정이 없습니다.")
    if partner.status == "비활성":
        raise HTTPException(403, detail="비활성 처리된 파트너 계정입니다.")
    return partner


# ---------------------------------------------------------------------------
# 요청 / 응답 schema

class PartnerLoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PartnerOut(BaseModel):
    id: int
    email: str
    company_name: str
    contact_name: str
    phone: str
    category: str
    status: str
    last_login_at: datetime | None = None
    must_change_password: bool = False
    # partner 본인이 마지막으로 비밀번호를 교체한 시각. None 이면 초기 비번
    # 사용 중 (UI: "미변경 (초기 비번 사용 중)" 표시).
    password_changed_at: datetime | None = None


class PartnerLoginOut(BaseModel):
    token: str
    partner: PartnerOut


class PartnerChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# 라우트

@router.post("/login", response_model=PartnerLoginOut)
async def partner_login(
    payload: PartnerLoginIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    # DB cold-start ping (Aiven 첫 연결 지연 회피).
    try:
        await asyncio.wait_for(session.execute(_sa_text("SELECT 1")), timeout=8.0)
    except asyncio.TimeoutError:
        raise HTTPException(503, detail="데이터베이스 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.")
    except Exception:
        raise HTTPException(503, detail="데이터베이스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.")

    ip = _client_ip(request)
    if _partner_login_throttle.is_locked(ip):
        raise HTTPException(429, detail="로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.")

    email = str(payload.email).strip().lower()
    res = await session.execute(select(Partner).where(Partner.email == email))
    partner = res.scalar_one_or_none()

    # pentest F-2 timing 평탄화 — partner 부재 / inactive / 비번 불일치 케이스가
    # 동일한 bcrypt cost 를 부담. 옛 코드는 partner 미존재 시 ~1.5s, 존재 시
    # ~3.0s 로 갈려 user enumeration 가능했음.
    if not partner or not partner.password_hash:
        verify_password(payload.password, _DUMMY_BCRYPT_HASH)  # timing 평탄화
        _partner_login_throttle.record_failure(ip)
        raise HTTPException(401, detail="이메일 또는 비밀번호가 일치하지 않습니다.")
    if partner.status not in {"승인", "active", "approved"}:
        # 옛 시드는 status='active' / 새 schema 는 '승인'. 둘 다 허용.
        verify_password(payload.password, _DUMMY_BCRYPT_HASH)  # timing 평탄화
        _partner_login_throttle.record_failure(ip)
        raise HTTPException(401, detail="이메일 또는 비밀번호가 일치하지 않습니다.")
    if not verify_password(payload.password, partner.password_hash):
        _partner_login_throttle.record_failure(ip)
        raise HTTPException(401, detail="이메일 또는 비밀번호가 일치하지 않습니다.")

    _partner_login_throttle.reset(ip)
    partner.last_login_at = datetime.now(timezone.utc)
    await session.flush()

    return PartnerLoginOut(
        token=issue_partner_token(partner),
        partner=PartnerOut(
            id=partner.id,
            email=partner.email,
            company_name=partner.company_name,
            contact_name=partner.contact_name,
            phone=partner.phone,
            category=partner.category,
            status=partner.status,
            last_login_at=partner.last_login_at,
            must_change_password=bool(getattr(partner, "must_change_password", False)),
            password_changed_at=getattr(partner, "password_changed_at", None),
        ),
    )


@router.get("/me", response_model=PartnerOut)
async def partner_me(partner: Partner = Depends(require_partner_token)):
    return PartnerOut(
        id=partner.id,
        email=partner.email,
        company_name=partner.company_name,
        contact_name=partner.contact_name,
        phone=partner.phone,
        category=partner.category,
        status=partner.status,
        last_login_at=partner.last_login_at,
        must_change_password=bool(getattr(partner, "must_change_password", False)),
        password_changed_at=getattr(partner, "password_changed_at", None),
    )


@router.post("/change-password")
async def partner_change_password(
    payload: PartnerChangePasswordIn,
    partner: Partner = Depends(require_partner_token),
    session: AsyncSession = Depends(get_session),
):
    """파트너 본인이 자기 비밀번호 변경. ForcePasswordChange 화면 + 일반 변경 모두.
    current_password 검증 → bcrypt 해시 갱신 → must_change_password=False.
    """
    if not partner.password_hash or not verify_password(payload.current_password, partner.password_hash):
        raise HTTPException(401, detail="현재 비밀번호가 일치하지 않습니다.")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, detail="새 비밀번호는 기존 비밀번호와 달라야 합니다.")
    # admin 측 set_partner_password 가 이미 validate_password_strength 를
    # 호출하지만 partner 본인의 change-password 는 길이만 (min=8) 검증되어
    # 약한 비밀번호 (예: 12345678) 가능. admin 정책과 동일하게 강도 검증 적용.
    weak = validate_password_strength(payload.new_password)
    if weak:
        raise HTTPException(400, detail=weak)
    partner.password_hash = hash_password(payload.new_password)
    partner.must_change_password = False
    partner.password_changed_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(partner)
    return {
        "ok": True,
        "partner_id": partner.id,
        "must_change_password": partner.must_change_password,
        "password_changed_at": partner.password_changed_at.isoformat() if partner.password_changed_at else None,
    }


@router.post("/logout", status_code=200)
async def partner_logout():
    """Stateless — 서버 측 token 무효화 없음. 클라이언트가 storage 에서 token 제거."""
    return {"ok": True}
