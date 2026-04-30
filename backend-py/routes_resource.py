"""실시간 리소스 모니터링 — admin 콘솔 /admin/monitoring 의 'maintenance' 탭이 30초마다 호출.

stdlib 만 사용 (psutil 미설치 환경에서도 동작) — resource.getrusage + os.

수집 항목:
- process memory (RSS)
- DB connection pool: size / checked-out / overflow
- DB latency (SELECT 1)
- uptime
- 활성 background task count (라이프스팬 retention 등)

운영 임계치 권고:
- memory_rss > 80% (Cafe24 1GB 기준 800MB) → red
- db_latency_ms > 1000 → red
- pool checkedout >= pool size → red (포화)
"""

from __future__ import annotations

import asyncio
import os
import resource
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_user
from db import engine, get_session
from models import AdminUser

router = APIRouter(prefix="/api/health", tags=["health"])

_BOOT_TS = time.time()


def _ru_max_rss_bytes() -> int:
    """getrusage().ru_maxrss — Linux 는 KB, macOS 는 bytes."""
    ru = resource.getrusage(resource.RUSAGE_SELF)
    val = ru.ru_maxrss
    # Linux platforms report KB; macOS bytes. 휴리스틱: 백만 미만이면 KB.
    if val < 10_000_000:
        return val * 1024
    return val


@router.get("/resource")
async def resource_snapshot(
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_user),
):
    rss_bytes = _ru_max_rss_bytes()

    # DB 연결 pool 상태
    pool_info = {"size": 0, "checked_out": 0, "overflow": 0}
    try:
        pool = engine.pool
        pool_info["size"] = pool.size() if hasattr(pool, "size") else 0
        pool_info["checked_out"] = pool.checkedout() if hasattr(pool, "checkedout") else 0
        pool_info["overflow"] = pool.overflow() if hasattr(pool, "overflow") else 0
    except Exception:
        pass

    # DB latency — SELECT 1 round-trip
    db_latency_ms = -1
    try:
        t0 = time.perf_counter()
        await session.execute(text("SELECT 1"))
        db_latency_ms = round((time.perf_counter() - t0) * 1000, 2)
    except Exception:
        pass

    # Uptime
    uptime_seconds = int(time.time() - _BOOT_TS)

    # 활성 task 개수 (asyncio)
    try:
        all_tasks = [t for t in asyncio.all_tasks() if not t.done()]
        task_count = len(all_tasks)
    except Exception:
        task_count = -1

    # 임계치 평가
    rss_mb = round(rss_bytes / (1024 * 1024), 1)
    cap_mb = int(os.environ.get("DAEMU_MEMORY_CAP_MB", "1024"))
    rss_ratio = rss_mb / cap_mb if cap_mb > 0 else 0
    alerts: list[str] = []
    if rss_ratio > 0.8:
        alerts.append(f"메모리 {int(rss_ratio*100)}% (cap {cap_mb} MB) — Cafe24 1GB 인스턴스 임박")
    if db_latency_ms > 1000:
        alerts.append(f"DB 응답 {db_latency_ms} ms — 1초 초과")
    if pool_info["size"] and pool_info["checked_out"] >= pool_info["size"]:
        alerts.append(f"DB pool 포화 ({pool_info['checked_out']}/{pool_info['size']})")

    return {
        "ok": True,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": uptime_seconds,
        "memory": {
            "rss_bytes": rss_bytes,
            "rss_mb": rss_mb,
            "cap_mb": cap_mb,
            "ratio": round(rss_ratio, 3),
        },
        "db": {
            "latency_ms": db_latency_ms,
            "pool_size": pool_info["size"],
            "pool_checked_out": pool_info["checked_out"],
            "pool_overflow": pool_info["overflow"],
        },
        "tasks": {"active": task_count},
        "alerts": alerts,
    }
