"""감사 로그 API — 어드민 보안 관제 페이지가 실시간 이벤트 스트림을 받기 위한 endpoint.

엔드포인트:
    GET /api/audit-logs?limit=200&since=ISO&action=login.failure
    GET /api/audit-logs/summary  ─ 24h 분포 + 시간대별 카운트(보안 차트용)

권한:
    어드민(admin role) 만 — 다른 권한은 거부. 감사 로그 자체에 PII(IP, email)
    가 들어가므로 노출 권한을 좁힘.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_perm
from db import get_session
from models import AuditLog

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


@router.get("")
async def list_audit_logs(
    limit: int = Query(200, ge=1, le=500),
    action: str | None = Query(None, description="필터 — login.failure 등 정확 일치"),
    actor_email: str | None = Query(None),
    ip: str | None = Query(None),
    since: str | None = Query(None, description="ISO datetime — 그 이후 항목만"),
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_perm("audit-logs", action="read")),
):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action == action)
    if actor_email:
        q = q.where(AuditLog.actor_email == actor_email.lower())
    if ip:
        q = q.where(AuditLog.ip == ip)
    if since:
        try:
            ts = datetime.fromisoformat(since.replace("Z", "+00:00"))
            q = q.where(AuditLog.created_at >= ts)
        except ValueError:
            pass
    res = await session.execute(q)
    rows = res.scalars().all()
    return {
        "ok": True,
        "items": [
            {
                "id": r.id,
                "ts": r.created_at.isoformat() if r.created_at else None,
                "actor_email": r.actor_email,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "ip": r.ip,
                "user_agent": r.user_agent[:120] if r.user_agent else "",
                "detail": r.detail or {},
            }
            for r in rows
        ],
        "count": len(rows),
    }


@router.get("/summary")
async def audit_summary(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_perm("audit-logs", action="read")),
):
    """24시간 분포 — 시간대별 인증 실패 카운트 + action 별 count."""
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    # action 별 24h count.
    res = await session.execute(
        select(AuditLog.action, func.count())
        .where(AuditLog.created_at >= since_24h)
        .group_by(AuditLog.action)
    )
    by_action = {action: count for action, count in res.all()}

    # 시간대별 인증 실패 — backend SQLite/MySQL 호환: 그냥 raw row 가져와서 파이썬에서 bucket.
    res2 = await session.execute(
        select(AuditLog.created_at, AuditLog.action)
        .where(AuditLog.created_at >= since_24h)
        .where(AuditLog.action.like("login.%"))
    )
    buckets: dict[int, dict[str, int]] = {h: {"failure": 0, "success": 0, "totp_failure": 0} for h in range(24)}
    for created_at, action in res2.all():
        if not created_at:
            continue
        # 24시간 전 시점에서 몇 시간 떨어졌는지 → 0(가장 오래) ~ 23(현재)
        diff_sec = (now - created_at).total_seconds()
        bucket = 23 - int(diff_sec // 3600)
        if 0 <= bucket < 24:
            if action == "login.failure":
                buckets[bucket]["failure"] += 1
            elif action == "login.success":
                buckets[bucket]["success"] += 1
            elif "totp" in action and "failure" in action:
                buckets[bucket]["totp_failure"] += 1

    # 최근 1시간 unique IP
    since_1h = now - timedelta(hours=1)
    res3 = await session.execute(
        select(func.count(func.distinct(AuditLog.ip)))
        .where(AuditLog.created_at >= since_1h)
        .where(AuditLog.action == "login.failure")
        .where(AuditLog.ip != "")
    )
    unique_failed_ips_1h = res3.scalar() or 0

    return {
        "ok": True,
        "byAction24h": by_action,
        "hourlyBuckets": [
            {"hour": h, **v}
            for h, v in sorted(buckets.items())
        ],
        "uniqueFailedIps1h": unique_failed_ips_1h,
        "generated_at": now.isoformat(),
    }
