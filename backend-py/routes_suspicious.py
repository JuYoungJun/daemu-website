"""의심 이벤트 list API — 어드민 보안 관제 페이지의 실시간 이벤트 스트림 보조.

audit_logs 가 인증 / 어드민 행동의 정형 이벤트라면, suspicious_events 는
자동 탐지된 위협 / 비정상 패턴 (brute_force_login 등) 의 보존소다.

엔드포인트:
    GET /api/suspicious-events?limit=200&since=ISO&reason=brute_force_login&severity=high

권한:
    monitoring read — admin / developer 만. 다른 권한은 거부 (PII: IP).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_perm
from db import get_session
from models import SuspiciousEvent

router = APIRouter(prefix="/api/suspicious-events", tags=["suspicious"])


@router.get("")
async def list_suspicious(
    limit: int = Query(200, ge=1, le=500),
    reason: str | None = Query(None, description="brute_force_login 등 정확 일치"),
    severity: str | None = Query(None, description="low/medium/high/critical"),
    ip: str | None = Query(None),
    since: str | None = Query(None, description="ISO datetime — 그 이후 항목만"),
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_perm("monitoring", action="read")),
):
    q = select(SuspiciousEvent).order_by(SuspiciousEvent.id.desc()).limit(limit)
    if reason:
        q = q.where(SuspiciousEvent.reason == reason)
    if severity:
        q = q.where(SuspiciousEvent.severity == severity)
    if ip:
        q = q.where(SuspiciousEvent.ip == ip)
    if since:
        try:
            ts = datetime.fromisoformat(since.replace("Z", "+00:00"))
            q = q.where(SuspiciousEvent.detected_at >= ts)
        except ValueError:
            pass
    res = await session.execute(q)
    rows = res.scalars().all()
    return {
        "ok": True,
        "items": [
            {
                "id": r.id,
                "ts": r.detected_at.isoformat() if r.detected_at else None,
                "reason": r.reason,
                "severity": r.severity,
                "ip": r.ip,
                "path": r.path,
                "method": r.method,
                "status_code": r.status_code,
                "request_id": r.request_id,
                "evidence": bool(r.evidence),
                "sealed_at": r.sealed_at.isoformat() if r.sealed_at else None,
                "detail": r.detail or {},
            }
            for r in rows
        ],
        "count": len(rows),
    }
