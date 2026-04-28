"""PIPA §29 §6 접속기록 / 보안이벤트 로깅 헬퍼.

Usage:
    from audit import log_event
    await log_event(session, request, action="login.success",
                    actor_user=user, target_type="auth", detail={...})

Retention: AuditLog rows are NEVER auto-deleted by the inquiry/outbox cron.
A separate retention task (default 5 years) handles them — implement when
the team has a clear policy. Until then keep all rows for forensics.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from models import AdminUser, AuditLog


def _client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        chain = [p.strip() for p in fwd.split(",") if p.strip()]
        if chain:
            return chain[-1][:45]
    return (request.client.host if request.client else "")[:45]


def _user_agent(request: Request | None) -> str:
    if request is None:
        return ""
    return (request.headers.get("user-agent", "") or "")[:255]


def _request_id(request: Request | None) -> str:
    if request is None:
        return ""
    return getattr(request.state, "request_id", "") if hasattr(request, "state") else ""


async def log_event(
    session: AsyncSession,
    request: Request | None,
    *,
    action: str,
    actor_user: AdminUser | None = None,
    actor_email: str = "",
    target_type: str = "",
    target_id: str | int = "",
    detail: dict[str, Any] | None = None,
) -> None:
    """Append one audit row in the request's session. Caller's transaction
    commit propagates the write. Errors are swallowed so audit logging
    never breaks the user-facing operation."""
    try:
        row = AuditLog(
            actor_user_id=actor_user.id if actor_user else None,
            actor_email=(actor_email or (actor_user.email if actor_user else ""))[:190],
            action=action[:60],
            target_type=target_type[:40],
            target_id=str(target_id)[:60],
            ip=_client_ip(request),
            user_agent=_user_agent(request),
            request_id=_request_id(request),
            detail=detail or {},
        )
        session.add(row)
        await session.flush()
    except Exception as exc:  # noqa: BLE001
        # Never let audit failure break the actual request path.
        import logging
        logging.getLogger("daemu").warning("audit log failed: %r", exc)
