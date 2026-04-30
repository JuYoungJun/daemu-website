"""JWT-based auth + role-based access control.

Roles
-----
    admin     관리자  — full access (only role that can manage users, customers, partners)
    tester    테스트  — read-only access to most data + can flip popup/inquiry status
    developer 개발    — read/write technical config (works, popups, mail templates,
                       content blocks, outbox); no access to customer PII

Endpoints
---------
- POST /api/auth/login {email, password} -> {token, user}
- GET  /api/auth/me   (Authorization: Bearer ...) -> {user}

Dependencies for routes
-----------------------
    require_user        -> any logged-in role (admin/tester/developer)
    require_admin       -> admin only
    require_perm(R,A)   -> permission matrix lookup (resource, action)

Default users are seeded from env on first startup. Set the *_PASSWORD env to
your own values before opening to anyone outside your team.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import AdminUser


# F-12: per-IP login throttle. 5 wrong attempts in 15 minutes locks that IP
# from /api/auth/login (any account) for the rest of the window.
class _LoginThrottle:
    def __init__(self, max_failures: int = 5, window_seconds: int = 900, max_keys: int = 5000):
        self.max = max_failures
        self.win = window_seconds
        self.max_keys = max_keys
        self._fails: dict[str, list[float]] = defaultdict(list)

    def _prune(self, key: str, now: float) -> None:
        cutoff = now - self.win
        self._fails[key][:] = [t for t in self._fails[key] if t >= cutoff]
        if not self._fails[key]:
            self._fails.pop(key, None)

    def _gc(self, now: float) -> None:
        """N2-26: bound dict size — drop the entries whose newest hit is
        the oldest. Triggered when the dict grows past max_keys."""
        if len(self._fails) <= self.max_keys:
            return
        scored = [(k, v[-1] if v else 0) for k, v in self._fails.items()]
        scored.sort(key=lambda kv: kv[1])
        for k, _ in scored[: len(self._fails) - self.max_keys]:
            self._fails.pop(k, None)

    def is_locked(self, key: str) -> bool:
        now = time.time()
        self._prune(key, now)
        return len(self._fails.get(key, [])) >= self.max

    def record_failure(self, key: str) -> None:
        now = time.time()
        self._fails[key].append(now)
        self._gc(now)

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)


_login_throttle = _LoginThrottle()


_TRUST_FORWARDED = os.environ.get("TRUST_FORWARDED_FOR", "1").lower() not in {"0", "false", "no"}


def _client_ip(request: Request) -> str:
    """N2-01 fix: only trust X-Forwarded-For when we know we're behind a
    proxy that sets it (Render, Cloudflare). The header is a comma-
    separated chain; the LAST entry is the trusted proxy's view of the
    client. Take the rightmost-non-trusted entry, not the leftmost."""
    if _TRUST_FORWARDED:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            # Strip whitespace, drop empty entries.
            chain = [p.strip() for p in fwd.split(",") if p.strip()]
            if chain:
                # The rightmost entry is what the immediate trusted proxy
                # observed as the connecting peer — closer to the truth than
                # the leftmost (which the client controls).
                return chain[-1]
    return request.client.host if request.client else "unknown"

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALG = "HS256"
JWT_TTL_HOURS = int(os.environ.get("JWT_TTL_HOURS", "12"))

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@daemu.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "daemu1234")
TESTER_EMAIL = os.environ.get("TESTER_EMAIL", "tester@daemu.local")
TESTER_PASSWORD = os.environ.get("TESTER_PASSWORD", "tester1234")
DEVELOPER_EMAIL = os.environ.get("DEVELOPER_EMAIL", "dev@daemu.local")
DEVELOPER_PASSWORD = os.environ.get("DEVELOPER_PASSWORD", "dev1234")

# ⚠️ TEMPORARY TEST SUPER-ADMIN ⚠️
# Created only when both TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are set.
# This account is admin-role + bypasses must_change_password so QA can run
# end-to-end without going through the rotation flow on every fresh deploy.
#
# REMOVE AFTER TESTING:
#   1) Render Dashboard → daemu-py → Environment → unset both vars
#   2) Trigger redeploy. The DB row remains until explicitly deleted —
#      log into the regular admin account and DELETE this user from
#      /admin/users (or via DELETE /api/users/{id}).
#   3) Confirm via /api/users (admin) that the row is gone.
TEST_ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "")
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "")

ROLE_ADMIN = "admin"
ROLE_TESTER = "tester"
ROLE_DEVELOPER = "developer"
ALL_ROLES = (ROLE_ADMIN, ROLE_TESTER, ROLE_DEVELOPER)

# Permission matrix.
#   ALL  = read + write + delete
#   READ = list / get only
#   None = forbidden
# Resource keys correspond to URL prefixes under /api/.
_ALL = "all"
_READ = "read"
PERMISSIONS: dict[str, dict[str, str]] = {
    "users":         {ROLE_ADMIN: _ALL},
    "inquiries":     {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
    "partners":      {ROLE_ADMIN: _ALL},
    "orders":        {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
    "works":         {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _ALL, ROLE_TESTER: _READ},
    "popups":        {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _ALL, ROLE_TESTER: _ALL},
    "crm":           {ROLE_ADMIN: _ALL},
    "campaigns":     {ROLE_ADMIN: _ALL},
    "promotions":    {ROLE_ADMIN: _ALL},
    "outbox":        {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ, ROLE_DEVELOPER: _READ},
    "mail-template": {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _ALL, ROLE_TESTER: _READ},
    "content":       {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _ALL},
    # Partner brand logos shown on the public Home page (display only,
    # different from partner login accounts under "partners" key).
    "partner-brands": {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _ALL, ROLE_TESTER: _READ},
    "newsletter":    {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
    # Operational health / error monitoring page (read-only).
    "monitoring":    {ROLE_ADMIN: _READ, ROLE_DEVELOPER: _READ},
    # Contract / PO documents — only super admin can write/send/cancel.
    # Sub-admin (tester) gets read-only so they can monitor signing status.
    "documents":     {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
    "document-templates": {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _READ},
    # Order catalog — admin can write, tester reads (e.g. for QA).
    # Currently localStorage-only on the client; permission key reserved
    # for the eventual backend Product table.
    "products":      {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
    # 감사 로그 — 보안 관제 페이지(/admin/security) 가 사용. PII(IP, email)
    # 노출이라 admin / developer 만 read.
    "audit-logs":    {ROLE_ADMIN: _READ, ROLE_DEVELOPER: _READ},
    # Analytics — IP geolocation / 사용자 분석. 마케팅 분석 페이지.
    "analytics":     {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ, ROLE_DEVELOPER: _READ},
    # Contracts — PDF rasterize endpoint 권한.
    "contracts":     {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
    # 공지/프로모션 — 어드민 작성, 공개 사이트 + 파트너 포털 노출.
    "announcements": {ROLE_ADMIN: _ALL, ROLE_DEVELOPER: _ALL, ROLE_TESTER: _READ},
    # 재고 / SKU / LOT / 유통기한 관리.
    "inventory":     {ROLE_ADMIN: _ALL, ROLE_TESTER: _READ},
}


def role_can(role: str, resource: str, action: str) -> bool:
    """action is one of: read | write | delete"""
    cell = PERMISSIONS.get(resource, {}).get(role)
    if cell == _ALL:
        return True
    if cell == _READ:
        return action == "read"
    return False

if not JWT_SECRET:
    # Generate an ephemeral secret per-process; tokens won't survive restart
    # but the demo doesn't require persistent sessions. Set JWT_SECRET in env
    # for production.
    import secrets
    JWT_SECRET = secrets.token_hex(32)
    print("[auth] JWT_SECRET not set — using ephemeral secret. Set JWT_SECRET env for production.")

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str
    # 2FA가 활성화된 사용자면 첫 호출에선 401 + need_totp:true 응답.
    # 사용자가 인증 앱 코드를 입력해 다시 호출할 때 totp_code 채워서 보냄.
    totp_code: str | None = None


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    must_change_password: bool = False
    totp_enabled: bool = False
    # 사용자가 등록한 인증 앱 — 분실/잘못 등록 시 본인이 어떤 앱 다시 깔아야
    # 하는지 즉시 식별 가능. 빈 문자열 = 라벨 미등록 (구버전 사용자).
    totp_app_label: str = ""
    # 첫 접속 시 이메일 인증 필요 여부 — frontend 가 이 필드를 보고
    # 인증 화면을 먼저 띄울지 결정. None 이면 미인증, 있으면 인증된 시각.
    email_verified_at: datetime | None = None


class LoginOut(BaseModel):
    token: str
    user: UserOut


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


PASSWORD_MIN_LENGTH = 8


def validate_password_strength(password: str) -> str | None:
    """Returns an error message if the password is too weak, else None."""
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"비밀번호는 최소 {PASSWORD_MIN_LENGTH}자 이상이어야 합니다."
    classes = sum([
        any(c.isdigit() for c in password),
        any(c.isalpha() for c in password),
        any(not c.isalnum() for c in password),
    ])
    if classes < 2:
        return "비밀번호는 영문/숫자/특수문자 중 2종류 이상을 포함해야 합니다."
    weak = {"daemu1234", "tester1234", "dev1234", "password", "12345678", "admin1234"}
    if password.lower() in weak:
        return "너무 자주 사용되는 비밀번호입니다. 더 강한 비밀번호로 설정해 주세요."
    return None


def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(plain, hashed)
    except Exception:
        return False


def issue_token(user: AdminUser) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="token expired") from None
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid token") from None


async def _resolve_user(authorization: str | None, session: AsyncSession) -> AdminUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="인증이 필요합니다. 로그인 후 다시 시도해 주세요.")
    token = authorization[7:].strip()
    claims = decode_token(token)
    user = await session.get(AdminUser, int(claims["sub"]))
    if not user or not user.active:
        raise HTTPException(401, detail="비활성화된 계정입니다. 운영자에게 문의하세요.")
    if user.role not in ALL_ROLES:
        raise HTTPException(403, detail="unknown role")
    return user


async def require_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AdminUser:
    """Any of the three roles."""
    return await _resolve_user(authorization, session)


async def require_admin(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AdminUser:
    """Admin role only."""
    user = await _resolve_user(authorization, session)
    if user.role != ROLE_ADMIN:
        raise HTTPException(403, detail="admin role required")
    return user


def require_perm(resource: str, action: str):
    """Returns a FastAPI dependency that checks the permission matrix."""
    async def _dep(
        authorization: str | None = Header(default=None),
        session: AsyncSession = Depends(get_session),
    ) -> AdminUser:
        user = await _resolve_user(authorization, session)
        if not role_can(user.role, resource, action):
            raise HTTPException(403, detail=f"role '{user.role}' cannot {action} {resource}")
        return user
    return _dep


async def ensure_default_users(session: AsyncSession) -> None:
    """Seed users on first boot.
    - admin/tester/developer trio (force-change on first login).
    - Optional test super-admin (no force-change) gated by TEST_ADMIN_*.

    Existing users are NEVER overwritten — env passwords only matter on the
    very first deploy. Update credentials via /api/users afterwards."""

    # FR-03 prod fail-closed: refuse to seed/keep a test super-admin in
    # production. If ENV=prod AND TEST_ADMIN_* still set, surface a loud
    # error so the deploy doesn't silently leave a bypass account.
    is_prod = os.environ.get("ENV", "").lower() in {"prod", "production"}
    if is_prod and TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD:
        raise RuntimeError(
            "TEST_ADMIN_EMAIL/PASSWORD must NOT be set when ENV=prod. "
            "Unset both env vars on the deploy host and redeploy."
        )

    # FA-01 collision guard + FA-03 password strength validation —
    # decide once whether the test super-admin seed is valid for THIS boot.
    seed_test = bool(TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD)
    if seed_test:
        if TEST_ADMIN_EMAIL.lower() in {ADMIN_EMAIL.lower(), TESTER_EMAIL.lower(), DEVELOPER_EMAIL.lower()}:
            print(f"[auth] ⚠️ TEST_ADMIN_EMAIL ({TEST_ADMIN_EMAIL}) collides with a default seed — skipping.")
            seed_test = False
        else:
            err = validate_password_strength(TEST_ADMIN_PASSWORD)
            if err:
                print(f"[auth] ⚠️ TEST_ADMIN_PASSWORD too weak: {err} — skipping.")
                seed_test = False

    res = await session.execute(select(AdminUser).limit(1))
    if res.scalar_one_or_none():
        # FA-02 tombstone: if the test user exists in DB but TEST_ADMIN_*
        # is unset, deactivate it on every boot. The row stays for audit
        # forensics but cannot log in.
        if not (TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD):
            tomb = await session.execute(
                select(AdminUser).where(AdminUser.name.like("%TEMPORARY%REMOVE AFTER TESTING%"))
            )
            for ghost in tomb.scalars().all():
                if ghost.active:
                    ghost.active = False
                    print(f"[auth] ⚠️ test super-admin {ghost.email} auto-deactivated (env vars cleared)")
            await session.commit()
        # Existing DB + valid env: seed the test super-admin if not present.
        elif seed_test:
            existing = await session.execute(
                select(AdminUser).where(AdminUser.email == TEST_ADMIN_EMAIL)
            )
            if not existing.scalar_one_or_none():
                session.add(AdminUser(
                    email=TEST_ADMIN_EMAIL,
                    password_hash=hash_password(TEST_ADMIN_PASSWORD),
                    name="Test Super-Admin (TEMPORARY — REMOVE AFTER TESTING)",
                    role=ROLE_ADMIN,
                    active=True,
                    must_change_password=False,
                ))
                await session.commit()
                print(f"[auth] ⚠️ TEMPORARY test super-admin seeded: {TEST_ADMIN_EMAIL}")
                print("[auth] ⚠️ REMOVE BEFORE GOING LIVE — see auth.py header comment.")
        return

    weak_defaults = {"daemu1234", "tester1234", "dev1234"}
    seeds = [
        (ADMIN_EMAIL, ADMIN_PASSWORD, "Default Admin", ROLE_ADMIN, True),
        (TESTER_EMAIL, TESTER_PASSWORD, "Tester", ROLE_TESTER, True),
        (DEVELOPER_EMAIL, DEVELOPER_PASSWORD, "Developer", ROLE_DEVELOPER, True),
    ]
    for email, password, name, role, force_change in seeds:
        if not email or not password:
            continue
        is_weak = password in weak_defaults
        if is_weak:
            print(f"[auth] WARNING: '{role}' seeded with default demo password — "
                  "user will be forced to change it on first login.")
        session.add(AdminUser(
            email=email,
            password_hash=hash_password(password),
            name=name,
            role=role,
            active=True,
            must_change_password=is_weak and force_change,
        ))

    # ⚠️ TEMPORARY test super-admin — REMOVE BEFORE GOING LIVE.
    # FA-01: only seed when seed_test passed the collision + strength check.
    # See header comment for cleanup procedure.
    if seed_test:
        session.add(AdminUser(
            email=TEST_ADMIN_EMAIL,
            password_hash=hash_password(TEST_ADMIN_PASSWORD),
            name="Test Super-Admin (TEMPORARY — REMOVE AFTER TESTING)",
            role=ROLE_ADMIN,
            active=True,
            must_change_password=False,
        ))
        print(f"[auth] ⚠️ TEMPORARY test super-admin seeded: {TEST_ADMIN_EMAIL}")
        print("[auth] ⚠️ REMOVE BEFORE GOING LIVE — see auth.py header comment.")

    await session.commit()
    print(f"[auth] seeded default users: {ADMIN_EMAIL}, {TESTER_EMAIL}, {DEVELOPER_EMAIL}")


# Back-compat alias used by main.py before the rename.
ensure_default_admin = ensure_default_users


def _verify_totp_or_recovery(user: AdminUser, code: str) -> tuple[bool, str | None]:
    """returns (ok, recovery_used_code). Lazy import pyotp so the module
    keeps loading on environments where it's not yet installed."""
    if not code:
        return False, None
    try:
        import pyotp
    except ImportError:
        return False, None
    code_clean = code.strip().replace(' ', '')
    # Try the live TOTP first
    if user.totp_secret:
        try:
            if pyotp.TOTP(user.totp_secret).verify(code_clean, valid_window=1):
                return True, None
        except Exception:
            pass
    # Fall back to recovery codes (single-use, hashed in DB)
    rcs = list(user.recovery_codes or [])
    for h in rcs:
        if isinstance(h, str) and verify_password(code_clean, h):
            return True, h
    return False, None


@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn, request: Request, session: AsyncSession = Depends(get_session)):
    from audit import log_event  # local import to avoid circular at module load
    # DB unreachable 인 경우 — 인증 자체가 불가능하므로 즉시 503 으로 응답.
    # 그렇지 않으면 SQLAlchemy 의 connection timeout (수십 초) 을 기다리다
    # 브라우저 fetch 가 끊기고 사용자에게는 raw "Failed to fetch" 가 노출됨.
    # 8s — Aiven 의 cold-start (SSL handshake + 인증) 시 첫 연결이 3~5s
    # 걸릴 수 있어 충분한 여유.
    try:
        from sqlalchemy import text as _sa_text
        await asyncio.wait_for(session.execute(_sa_text("SELECT 1")), timeout=8.0)
    except asyncio.TimeoutError:
        print("[auth] login DB ping timeout (8s) — Aiven 응답 지연")
        raise HTTPException(
            503,
            detail="데이터베이스 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
        )
    except Exception as _e:  # noqa: BLE001
        print(f"[auth] login DB ping failed: {_e!r}")
        raise HTTPException(
            503,
            detail="데이터베이스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        )
    ip = _client_ip(request)
    if _login_throttle.is_locked(ip):
        await log_event(session, request, action="login.throttled",
                        actor_email=payload.email, detail={"ip": ip})
        # B2 — brute force 의심 이벤트 기록 (high severity, 90일 보존).
        try:
            from suspicious import record_async as _suspicious_record
            rid = getattr(request.state, "request_id", "") if request else ""
            await _suspicious_record(
                session,
                reason="brute_force_login",
                severity="high",
                ip=ip,
                user_agent=request.headers.get("user-agent", "") if request else "",
                path=str(request.url.path) if request else "",
                method=request.method if request else "",
                status_code=429,
                request_id=rid,
                detail={"email": payload.email},
            )
        except Exception:
            pass
        raise HTTPException(429, detail="로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.")

    res = await session.execute(select(AdminUser).where(AdminUser.email == payload.email))
    user = res.scalar_one_or_none()
    if not user:
        # 사용자 자체가 DB 에 없음 — 진단용 logs (이메일 자체는 logs 에 OK,
        # 비밀번호는 절대 X). PII 라 production logs aggregator 에 들어갈 때
        # masking 정책 필요 — 현재는 raw stdout 로만 가니 운영자가 직접 검토.
        print(f"[auth] login: no such user → email='{payload.email}' (DB에 등록되지 않은 계정)")
    elif not user.active:
        print(f"[auth] login: inactive user → email='{payload.email}'")
    elif not verify_password(payload.password, user.password_hash):
        print(f"[auth] login: password mismatch → email='{payload.email}'")
    if not user or not user.active or not verify_password(payload.password, user.password_hash):
        _login_throttle.record_failure(ip)
        await log_event(session, request, action="login.failure",
                        actor_email=payload.email,
                        detail={"reason": "bad-credentials" if user else "no-such-user"})
        raise HTTPException(401, detail="이메일 또는 비밀번호가 일치하지 않습니다.")

    # 2FA gate — only if the user opted in.
    if user.totp_enabled:
        if not payload.totp_code:
            # 비밀번호는 정확하므로 throttle 카운터는 올리지 않음.
            await log_event(session, request, action="login.totp.required", actor_user=user)
            raise HTTPException(
                status_code=401,
                detail={"need_totp": True, "message": "인증 앱의 6자리 코드를 입력해 주세요."},
            )
        ok, used_recovery_hash = _verify_totp_or_recovery(user, payload.totp_code)
        if not ok:
            _login_throttle.record_failure(ip)
            await log_event(session, request, action="login.totp.failure", actor_user=user)
            raise HTTPException(
                status_code=401,
                detail={"need_totp": True, "message": "잘못된 인증 코드입니다."},
            )
        if used_recovery_hash:
            # Burn the used recovery code so it can't be replayed.
            user.recovery_codes = [h for h in (user.recovery_codes or []) if h != used_recovery_hash]
            await log_event(session, request, action="login.totp.recovery_used", actor_user=user)

    _login_throttle.reset(ip)
    user.last_login_at = datetime.now(timezone.utc)
    await log_event(session, request, action="login.success", actor_user=user)
    await session.flush()
    return LoginOut(
        token=issue_token(user),
        user=UserOut(
            id=user.id, email=user.email, name=user.name, role=user.role,
            must_change_password=user.must_change_password,
            totp_enabled=user.totp_enabled,
            totp_app_label=user.totp_app_label or "",
            email_verified_at=user.email_verified_at,
        ),
    )


@router.get("/me", response_model=UserOut)
async def me(user: AdminUser = Depends(require_user)):
    return UserOut(
        id=user.id, email=user.email, name=user.name, role=user.role,
        must_change_password=user.must_change_password,
        totp_enabled=user.totp_enabled,
        totp_app_label=user.totp_app_label or "",
        email_verified_at=user.email_verified_at,
    )


# ---------------------------------------------------------------------------
# 2FA / TOTP setup endpoints (admin enables it for their own account)

class TotpEnableIn(BaseModel):
    code: str  # 6-digit code from authenticator app to verify the secret
    # 사용자가 등록한 인증 앱 라벨 — Google Authenticator / Authy / 1Password /
    # Microsoft Authenticator / 기타. 분실 시 어떤 앱에서 복구해야 하는지
    # 운영자가 식별 가능. 임의 입력은 40자로 절단.
    app_label: str = ""


class TotpDisableIn(BaseModel):
    password: str  # re-auth before turning off the second factor


@router.post("/totp/setup")
async def totp_setup(user: AdminUser = Depends(require_user), session: AsyncSession = Depends(get_session)):
    """새 secret + provisioning URI 발급. QR PNG dataURL 도 함께 반환해
    프론트가 별도 라이브러리 없이 바로 표시 가능. totp_enabled 는 여전히
    False — /totp/enable 에서 사용자가 인증 앱 코드 검증 후 활성화.

    QR 변조 방지: secret 은 base32 random, provisioning URI 는 RFC 6238
    표준. URI 자체에 secret + issuer + algorithm + period 가 모두 들어가
    있어 QR 만 보고 알고리즘 변조가 불가하다.
    """
    try:
        import pyotp
    except ImportError:
        raise HTTPException(500, detail="pyotp가 설치되지 않았습니다.")
    secret = pyotp.random_base32()
    user.totp_secret = secret
    await session.flush()
    issuer = "DAEMU Admin"
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=issuer)

    # QR PNG dataURL — qrcode 패키지가 있으면 즉시 생성. 없어도 secret/uri
    # 는 그대로 반환되니 프론트가 자체 QR 라이브러리로 처리 가능.
    qr_data_url = ""
    try:
        import qrcode  # type: ignore
        import io as _io
        import base64 as _b64
        img = qrcode.make(uri)
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        qr_data_url = "data:image/png;base64," + _b64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        pass

    return {
        "ok": True,
        "secret": secret,
        "otpauth_uri": uri,
        "issuer": issuer,
        "qr_png_data_url": qr_data_url,
    }


@router.post("/totp/enable")
async def totp_enable(
    payload: TotpEnableIn,
    user: AdminUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    if not user.totp_secret:
        raise HTTPException(400, detail="먼저 /totp/setup 으로 시크릿을 발급받아 주세요.")
    try:
        import pyotp
    except ImportError:
        raise HTTPException(500, detail="pyotp가 설치되지 않았습니다.")
    code = (payload.code or '').strip().replace(' ', '')
    if not pyotp.TOTP(user.totp_secret).verify(code, valid_window=1):
        raise HTTPException(401, detail="인증 코드가 일치하지 않습니다.")
    user.totp_enabled = True
    # 인증 앱 라벨 기록 — 추후 분실/잘못 등록 시 운영자가 식별 가능.
    user.totp_app_label = (payload.app_label or "").strip()[:40]

    # Generate 8 single-use recovery codes (returned to caller ONCE; stored
    # hashed). Format: XXXX-XXXX (uppercase alphanumeric, easy to type).
    import secrets as _secrets
    raw_codes = []
    hashed = []
    for _ in range(8):
        code_raw = _secrets.token_hex(4).upper()
        formatted = code_raw[:4] + '-' + code_raw[4:]
        raw_codes.append(formatted)
        hashed.append(hash_password(formatted))
    user.recovery_codes = hashed
    await session.flush()

    from audit import log_event
    await log_event(session, None, action="totp.enabled", actor_user=user)
    return {"ok": True, "recovery_codes": raw_codes}


@router.post("/totp/disable")
async def totp_disable(
    payload: TotpDisableIn,
    user: AdminUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, detail="비밀번호가 일치하지 않습니다.")
    user.totp_enabled = False
    user.totp_secret = ""
    user.recovery_codes = []
    await session.flush()
    from audit import log_event
    await log_event(session, None, action="totp.disabled", actor_user=user)
    return {"ok": True}


class UnlockIn(BaseModel):
    ip: str | None = None  # 비우면 본인이 호출한 IP(=어드민 자신) 해제


@router.post("/unlock")
async def admin_unlock_throttle(
    payload: UnlockIn,
    request: Request,
    _u: AdminUser = Depends(require_admin),
):
    """Admin-only: 특정 IP의 로그인 throttle을 즉시 해제합니다.
    비밀번호를 잊어 락에 걸린 다른 관리자 계정을 풀어주거나,
    QA 도중 락 걸린 IP를 즉시 풀 때 사용합니다.

    payload.ip 가 비어 있으면 어드민이 현재 호출하고 있는 IP를 풉니다."""
    target_ip = (payload.ip or _client_ip(request)).strip()
    _login_throttle.reset(target_ip)
    return {"ok": True, "ip": target_ip}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: AdminUser = Depends(require_user),
):
    """Any logged-in user can change their own password. Requires current
    password (re-auth). Clears must_change_password after a successful change."""
    from audit import log_event
    if not verify_password(payload.current_password, user.password_hash):
        await log_event(session, request, action="password.change.failure",
                        actor_user=user, detail={"reason": "wrong-current"})
        raise HTTPException(401, detail="현재 비밀번호가 일치하지 않습니다.")
    err = validate_password_strength(payload.new_password)
    if err:
        raise HTTPException(400, detail=err)
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(400, detail="새 비밀번호가 기존 비밀번호와 동일합니다.")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.password_changed_at = datetime.now(timezone.utc)
    await log_event(session, request, action="password.change.success", actor_user=user)
    await session.flush()
    return {"ok": True}


# ---------------------------------------------------------------------------
# User management (admin only)

class UserCreateIn(BaseModel):
    email: EmailStr
    password: str
    name: str = ""
    role: str  # admin | tester | developer
    # When true (default), the new user is forced to change the password on
    # first login. Set to false for short-lived test/QA accounts that the
    # super-admin will tear down later anyway.
    must_change_password: bool = True


class UserUpdateIn(BaseModel):
    name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = None
    # Allow super-admin to clear/set the must_change_password flag without
    # going through the full password reset flow (useful for QA accounts).
    must_change_password: bool | None = None
    # 어드민이 사용자 이메일 인증 상태를 강제로 토글:
    #   true  → email_verified_at 을 utcnow() 로 채움 (인증 우회)
    #   false → null 로 초기화 (다음 로그인 시 인증 다시 요구)
    email_verified: bool | None = None
    # 어드민이 사용자 2FA 를 강제 비활성화 (사용자가 디바이스 분실 시 사용).
    # totp_secret/recovery_codes 모두 비움. 활성화는 사용자 본인 절차로만 가능.
    reset_totp: bool | None = None


users_router = APIRouter(prefix="/api/users", tags=["users"])


@users_router.get("")
async def list_users(session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    res = await session.execute(select(AdminUser).order_by(AdminUser.id))
    rows = res.scalars().all()
    return {
        "ok": True,
        "items": [
            {
                "id": r.id, "email": r.email, "name": r.name, "role": r.role, "active": r.active,
                "must_change_password": bool(r.must_change_password),
                "totp_enabled": bool(r.totp_enabled),
                "totp_app_label": r.totp_app_label or "",
                "email_verified_at": r.email_verified_at.isoformat() if r.email_verified_at else None,
                "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None,
                "password_changed_at": r.password_changed_at.isoformat() if r.password_changed_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                # recovery_codes 개수만 노출 — 코드 자체는 절대 안 노출.
                "recovery_codes_count": len(r.recovery_codes or []) if hasattr(r, "recovery_codes") else 0,
            }
            for r in rows
        ],
    }


@users_router.post("", status_code=201)
async def create_user(payload: UserCreateIn, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    if payload.role not in ALL_ROLES:
        raise HTTPException(400, detail=f"role must be one of {ALL_ROLES}")
    err = validate_password_strength(payload.password)
    if err:
        raise HTTPException(400, detail=err)
    exists = await session.execute(select(AdminUser).where(AdminUser.email == payload.email))
    if exists.scalar_one_or_none():
        raise HTTPException(409, detail="email already in use")
    user = AdminUser(
        email=payload.email,
        password_hash=hash_password(payload.password),
        name=payload.name or "",
        role=payload.role,
        active=True,
        # Default forces a password change on first login. The caller may
        # opt out for short-lived test accounts.
        must_change_password=bool(payload.must_change_password),
    )
    session.add(user)
    await session.flush()
    return {"ok": True, "user": {
        "id": user.id, "email": user.email, "name": user.name, "role": user.role,
        "active": user.active, "must_change_password": user.must_change_password,
    }}


@users_router.patch("/{user_id}")
async def update_user(user_id: int, payload: UserUpdateIn, session: AsyncSession = Depends(get_session), me_user: AdminUser = Depends(require_admin)):
    target = await session.get(AdminUser, user_id)
    if not target:
        raise HTTPException(404, detail="user not found")
    if payload.role is not None:
        if payload.role not in ALL_ROLES:
            raise HTTPException(400, detail="invalid role")
        # Prevent the last admin from demoting themselves.
        if target.role == ROLE_ADMIN and payload.role != ROLE_ADMIN and target.id == me_user.id:
            other_admins = await session.execute(
                select(AdminUser).where(AdminUser.role == ROLE_ADMIN, AdminUser.active == True, AdminUser.id != target.id)  # noqa: E712
            )
            if not other_admins.scalars().first():
                raise HTTPException(400, detail="cannot demote the last active admin")
        target.role = payload.role
    if payload.name is not None:
        target.name = payload.name
    if payload.active is not None:
        if not payload.active and target.id == me_user.id:
            raise HTTPException(400, detail="cannot deactivate yourself")
        target.active = payload.active
    if payload.password is not None:
        err = validate_password_strength(payload.password)
        if err:
            raise HTTPException(400, detail=err)
        target.password_hash = hash_password(payload.password)
        target.password_changed_at = datetime.now(timezone.utc)
        # Admin reset → force the target user to change at next login,
        # unless the caller explicitly opts out via must_change_password=false.
        if payload.must_change_password is not None:
            target.must_change_password = bool(payload.must_change_password)
        elif target.id != me_user.id:
            target.must_change_password = True
        else:
            target.must_change_password = False
    elif payload.must_change_password is not None:
        # Standalone toggle of the flag (no password change).
        target.must_change_password = bool(payload.must_change_password)
    if payload.email_verified is not None:
        # true → 인증된 것으로 표시 / false → 다음 로그인 시 재인증 요구.
        target.email_verified_at = (
            datetime.now(timezone.utc) if payload.email_verified else None
        )
    if payload.reset_totp:
        # 디바이스 분실 등으로 2FA 잠긴 사용자를 어드민이 강제 해제.
        # 활성화는 사용자 본인이 다시 설정해야 함. PATCH 호출 자체는 기존
        # audit middleware 가 endpoint.access 로 기록하므로 별도 log_event
        # 호출은 생략 — 그래도 reset_totp 액션은 PATCH body 에 남음.
        target.totp_enabled = False
        target.totp_secret = ""
        target.recovery_codes = []
        target.totp_app_label = ""
    await session.flush()
    return {"ok": True, "user": {
        "id": target.id, "email": target.email, "name": target.name, "role": target.role,
        "active": target.active, "must_change_password": target.must_change_password,
        "totp_enabled": target.totp_enabled,
        "totp_app_label": target.totp_app_label or "",
        "email_verified_at": target.email_verified_at.isoformat() if target.email_verified_at else None,
    }}


@users_router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, session: AsyncSession = Depends(get_session), me_user: AdminUser = Depends(require_admin)):
    target = await session.get(AdminUser, user_id)
    if not target:
        raise HTTPException(404, detail="user not found")
    if target.id == me_user.id:
        raise HTTPException(400, detail="cannot delete yourself")
    await session.delete(target)
