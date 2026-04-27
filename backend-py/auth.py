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

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import AdminUser

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALG = "HS256"
JWT_TTL_HOURS = int(os.environ.get("JWT_TTL_HOURS", "12"))

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@daemu.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "daemu1234")
TESTER_EMAIL = os.environ.get("TESTER_EMAIL", "tester@daemu.local")
TESTER_PASSWORD = os.environ.get("TESTER_PASSWORD", "tester1234")
DEVELOPER_EMAIL = os.environ.get("DEVELOPER_EMAIL", "dev@daemu.local")
DEVELOPER_PASSWORD = os.environ.get("DEVELOPER_PASSWORD", "dev1234")

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


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str


class LoginOut(BaseModel):
    token: str
    user: UserOut


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
        raise HTTPException(401, detail="missing bearer token")
    token = authorization[7:].strip()
    claims = decode_token(token)
    user = await session.get(AdminUser, int(claims["sub"]))
    if not user or not user.active:
        raise HTTPException(401, detail="user inactive")
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
    """Seed one user per role on first boot if no admin exists.
    Existing users are NEVER overwritten — env passwords only matter on the very
    first deploy. Update credentials via /api/users (admin) afterwards."""
    res = await session.execute(select(AdminUser).limit(1))
    if res.scalar_one_or_none():
        return

    weak_defaults = {"daemu1234", "tester1234", "dev1234"}
    seeds = [
        (ADMIN_EMAIL, ADMIN_PASSWORD, "Default Admin", ROLE_ADMIN),
        (TESTER_EMAIL, TESTER_PASSWORD, "Tester", ROLE_TESTER),
        (DEVELOPER_EMAIL, DEVELOPER_PASSWORD, "Developer", ROLE_DEVELOPER),
    ]
    for email, password, name, role in seeds:
        if not email or not password:
            continue
        if password in weak_defaults:
            print(f"[auth] WARNING: '{role}' is being seeded with the default demo password. "
                  "Set {ROLE}_PASSWORD env var (admin/tester/developer) before opening the demo to anyone.")
        session.add(AdminUser(
            email=email,
            password_hash=hash_password(password),
            name=name,
            role=role,
            active=True,
        ))
    await session.commit()
    print(f"[auth] seeded default users: {ADMIN_EMAIL}, {TESTER_EMAIL}, {DEVELOPER_EMAIL}")


# Back-compat alias used by main.py before the rename.
ensure_default_admin = ensure_default_users


@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn, session: AsyncSession = Depends(get_session)):
    res = await session.execute(select(AdminUser).where(AdminUser.email == payload.email))
    user = res.scalar_one_or_none()
    if not user or not user.active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, detail="invalid credentials")
    return LoginOut(
        token=issue_token(user),
        user=UserOut(id=user.id, email=user.email, name=user.name, role=user.role),
    )


@router.get("/me", response_model=UserOut)
async def me(user: AdminUser = Depends(require_user)):
    return UserOut(id=user.id, email=user.email, name=user.name, role=user.role)


# ---------------------------------------------------------------------------
# User management (admin only)

class UserCreateIn(BaseModel):
    email: EmailStr
    password: str
    name: str = ""
    role: str  # admin | tester | developer


class UserUpdateIn(BaseModel):
    name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = None


users_router = APIRouter(prefix="/api/users", tags=["users"])


@users_router.get("")
async def list_users(session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    res = await session.execute(select(AdminUser).order_by(AdminUser.id))
    rows = res.scalars().all()
    return {
        "ok": True,
        "items": [
            {"id": r.id, "email": r.email, "name": r.name, "role": r.role, "active": r.active,
             "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows
        ],
    }


@users_router.post("", status_code=201)
async def create_user(payload: UserCreateIn, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    if payload.role not in ALL_ROLES:
        raise HTTPException(400, detail=f"role must be one of {ALL_ROLES}")
    if len(payload.password) < 8:
        raise HTTPException(400, detail="password must be at least 8 characters")
    exists = await session.execute(select(AdminUser).where(AdminUser.email == payload.email))
    if exists.scalar_one_or_none():
        raise HTTPException(409, detail="email already in use")
    user = AdminUser(
        email=payload.email,
        password_hash=hash_password(payload.password),
        name=payload.name or "",
        role=payload.role,
        active=True,
    )
    session.add(user)
    await session.flush()
    return {"ok": True, "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "active": user.active}}


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
        if len(payload.password) < 8:
            raise HTTPException(400, detail="password must be at least 8 characters")
        target.password_hash = hash_password(payload.password)
    await session.flush()
    return {"ok": True, "user": {"id": target.id, "email": target.email, "name": target.name, "role": target.role, "active": target.active}}


@users_router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, session: AsyncSession = Depends(get_session), me_user: AdminUser = Depends(require_admin)):
    target = await session.get(AdminUser, user_id)
    if not target:
        raise HTTPException(404, detail="user not found")
    if target.id == me_user.id:
        raise HTTPException(400, detail="cannot delete yourself")
    await session.delete(target)
