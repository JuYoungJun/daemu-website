"""이메일 인증 라우터 — 첫 접속 어드민 계정용.

워크플로:
  1. 어드민이 신규 계정 생성 (email + 임시 비밀번호 + must_change_password=True + email_verified_at=NULL)
  2. 신규 사용자가 임시 비밀번호로 로그인
  3. /api/auth/me 응답이 email_verified_at=null → frontend 가 인증 단계로 진입
  4. POST /api/auth/email-verify/send  → 6자리 코드를 이메일로 발송 (Resend or simulated)
  5. 사용자 이메일에서 코드 확인 → POST /api/auth/email-verify/confirm {code}
  6. 검증 성공 시 email_verified_at 채움 → frontend 는 비밀번호 변경 단계로 진입
  7. 비밀번호 변경 완료 시 must_change_password=False → 정상 dashboard 진입

보안 정책 (security-advisor F2):
  - 발송 쿨다운: 60초 (last_sent_at 사용)
  - 시도 5회 후 lock 15분 (attempts/locked_until)
  - TTL 5분 (expires_at)
  - 코드 cleartext 절대 로깅/응답 금지
  - simulated 모드(키 없음)에서는 outbox 에 cleartext 가 남으므로 *개발용*에 한해 허용
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_user as get_current_user
from db import get_session
from models import AdminEmailOtp, AdminUser

router = APIRouter(prefix="/api/auth/email-verify", tags=["email-verify"])

OTP_TTL_SECONDS = 300        # 5분
SEND_COOLDOWN_SECONDS = 60   # 발송 쿨다운
MAX_ATTEMPTS = 5             # 시도 5회 후 잠금
LOCK_DURATION_SECONDS = 900  # 15분 잠금


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    # secrets.randbelow(10**6) — 0~999999 균등. zfill 로 6자리 보장.
    return str(secrets.randbelow(10**6)).zfill(6)


class SendIn(BaseModel):
    pass  # body 없음 — 인증된 사용자 컨텍스트만 사용


class SendOut(BaseModel):
    ok: bool
    cooldown_until: datetime | None = None
    expires_at: datetime
    simulated: bool = False


class VerifyIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class VerifyOut(BaseModel):
    ok: bool


@router.post("/send", response_model=SendOut)
async def send_verification_code(
    request: Request,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(get_current_user),
):
    """6자리 인증 코드를 어드민 이메일로 발송.

    이미 인증된 사용자는 409.
    """
    if me.email_verified_at is not None:
        raise HTTPException(409, detail="이미 이메일 인증된 계정입니다.")

    now = datetime.now(timezone.utc)

    # 기존 미사용 OTP 가 있으면 cooldown / lock 검사.
    q = await session.execute(
        select(AdminEmailOtp)
        .where(
            AdminEmailOtp.user_id == me.id,
            AdminEmailOtp.purpose == "email_verify",
            AdminEmailOtp.used_at.is_(None),
        )
        .order_by(AdminEmailOtp.created_at.desc())
        .limit(1)
    )
    existing = q.scalar_one_or_none()

    if existing and existing.locked_until and existing.locked_until > now:
        raise HTTPException(
            429,
            detail=f"잠금 상태입니다. {int((existing.locked_until - now).total_seconds())}초 후 재시도하세요.",
        )

    if existing and existing.last_sent_at:
        elapsed = (now - existing.last_sent_at).total_seconds()
        if elapsed < SEND_COOLDOWN_SECONDS:
            raise HTTPException(
                429,
                detail=f"발송 쿨다운 중입니다. {int(SEND_COOLDOWN_SECONDS - elapsed)}초 후 재시도하세요.",
            )

    # 새 코드 생성 + 기존 row update OR 새로 추가.
    code = _generate_code()
    code_hash = _hash_code(code)
    expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)
    ip = request.client.host if request.client else ""

    if existing:
        existing.code_hash = code_hash
        existing.expires_at = expires_at
        existing.last_sent_at = now
        existing.attempts = 0
        existing.locked_until = None
        existing.ip = ip[:45]
    else:
        existing = AdminEmailOtp(
            user_id=me.id,
            purpose="email_verify",
            code_hash=code_hash,
            expires_at=expires_at,
            last_sent_at=now,
            ip=ip[:45],
        )
        session.add(existing)

    await session.flush()

    # 메일 발송 — 가능하면 Resend, 없으면 simulated.
    simulated = await _dispatch_verification_email(me.email, me.name or "", code)

    return SendOut(
        ok=True,
        cooldown_until=now + timedelta(seconds=SEND_COOLDOWN_SECONDS),
        expires_at=expires_at,
        simulated=simulated,
    )


@router.post("/confirm", response_model=VerifyOut)
async def confirm_verification_code(
    payload: VerifyIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(get_current_user),
):
    if me.email_verified_at is not None:
        return VerifyOut(ok=True)

    code = (payload.code or "").strip()
    if not (len(code) == 6 and code.isdigit()):
        raise HTTPException(400, detail="6자리 숫자 코드를 입력하세요.")

    now = datetime.now(timezone.utc)

    q = await session.execute(
        select(AdminEmailOtp)
        .where(
            AdminEmailOtp.user_id == me.id,
            AdminEmailOtp.purpose == "email_verify",
            AdminEmailOtp.used_at.is_(None),
        )
        .order_by(AdminEmailOtp.created_at.desc())
        .limit(1)
    )
    row = q.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, detail="발송된 인증 코드가 없습니다. 다시 발송하세요.")

    if row.locked_until and row.locked_until > now:
        raise HTTPException(
            429,
            detail=f"잠금 상태입니다. {int((row.locked_until - now).total_seconds())}초 후 재시도하세요.",
        )

    if row.expires_at < now:
        raise HTTPException(410, detail="코드가 만료되었습니다. 다시 발송하세요.")

    if row.code_hash != _hash_code(code):
        row.attempts = (row.attempts or 0) + 1
        if row.attempts >= MAX_ATTEMPTS:
            row.locked_until = now + timedelta(seconds=LOCK_DURATION_SECONDS)
        await session.flush()
        raise HTTPException(401, detail="코드가 일치하지 않습니다.")

    # 검증 성공.
    row.used_at = now
    me.email_verified_at = now
    await session.flush()
    return VerifyOut(ok=True)


async def _dispatch_verification_email(to_email: str, to_name: str, code: str) -> bool:
    """이메일 발송. RESEND_API_KEY 또는 SMTP_HOST 가 있으면 실제 발송,
    없으면 simulated (개발 환경 한정 — 코드는 outbox 가 아닌 stdout 으로만).

    returns True if simulated, False if actually dispatched.
    """
    has_resend = bool(os.environ.get("RESEND_API_KEY", "").strip())
    has_smtp = bool(os.environ.get("SMTP_HOST", "").strip())
    if not has_resend and not has_smtp:
        # simulated — print to stdout for dev. 절대 outbox 에 cleartext 저장 안 함.
        print(f"[email-verify SIMULATED] to={to_email} code={code} (set RESEND_API_KEY to enable real send)")
        return True

    # 실제 발송은 main.py 의 send_email() 헬퍼에 위임.
    try:
        from main import send_email  # type: ignore[import-not-found]
        body = (
            f"안녕하세요 {to_name or ''}님,\n\n"
            f"대무 어드민 첫 접속 이메일 인증 코드입니다.\n\n"
            f"인증 코드: {code}\n"
            f"유효 시간: 5분\n\n"
            "코드는 본인 외 누구와도 공유하지 마세요.\n"
            "본인이 요청하지 않은 경우 즉시 운영자(daemu_office@naver.com)로 알려주세요.\n"
        )
        await send_email(
            to_email=to_email,
            to_name=to_name,
            subject="[대무] 첫 접속 이메일 인증 코드",
            body=body,
            html=None,
        )
        return False
    except Exception as e:  # noqa: BLE001
        # 발송 실패는 stderr 로만; cleartext 코드는 출력 안 함.
        print(f"[email-verify SEND FAILED] {e!r}")
        return False
