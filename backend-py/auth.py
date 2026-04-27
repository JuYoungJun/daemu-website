"""JWT-based admin auth.

- POST /api/auth/login {email, password} -> {token, user}
- GET  /api/auth/me   (Authorization: Bearer ...) -> {user}
- Dependency `require_admin` for protected routes.

Default admin is seeded from env on first startup if no admin user exists:
    ADMIN_EMAIL, ADMIN_PASSWORD (defaults: admin@daemu.local / daemu1234)
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import AdminUser

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALG = "HS256"
JWT_TTL_HOURS = int(os.environ.get("JWT_TTL_HOURS", "12"))

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@daemu.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "daemu1234")

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


async def require_admin(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AdminUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="missing bearer token")
    token = authorization[7:].strip()
    claims = decode_token(token)
    user = await session.get(AdminUser, int(claims["sub"]))
    if not user or not user.active:
        raise HTTPException(401, detail="user inactive")
    if claims.get("role") != "admin":
        raise HTTPException(403, detail="admin role required")
    return user


async def ensure_default_admin(session: AsyncSession) -> None:
    """Seed a default admin if none exists."""
    res = await session.execute(select(AdminUser).limit(1))
    if res.scalar_one_or_none():
        return
    user = AdminUser(
        email=ADMIN_EMAIL,
        password_hash=hash_password(ADMIN_PASSWORD),
        name="Default Admin",
        role="admin",
        active=True,
    )
    session.add(user)
    await session.commit()
    print(f"[auth] seeded default admin: {ADMIN_EMAIL}")


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
async def me(user: AdminUser = Depends(require_admin)):
    return UserOut(id=user.id, email=user.email, name=user.name, role=user.role)
