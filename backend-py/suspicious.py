"""B2 — 의심행위 수집·보존·삭제 정책.

설계 원칙
---------
1. **수집 최소화** — 익명 식별자(IP, UA 해시)와 요청 메타만 저장.
   원본 페이로드, 비밀번호, 토큰, body 본문은 절대 저장하지 않음.

2. **보존 기간**
   - 기본: 90일 후 자동 삭제 (cron이 detected_at 기준 sweep)
   - evidence=true (운영자가 명시적으로 "고소용/법적 절차"로 표시): 365일
   - sealed_at 채워진 row는 변경 불가 — 위변조 방지

3. **개인정보 보호법 안내**
   - IP는 한국 개인정보보호법상 개인정보. 보존 시 처리방침에 명시 필요.
   - 본 모듈을 활성화하면 사이트 처리방침에 다음 항목 추가 의무:
     * 수집 항목: IP, User-Agent (해시), 요청 메타
     * 수집 목적: 보안 위협 탐지·차단·법적 대응
     * 보존 기간: 의심 행위 90일, 증거 보존 365일
     * 처리 위탁/제3자 제공: 없음 (자체 서버 보관)
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models import SuspiciousEvent

# 보존 기간 — env로 override 가능
RETENTION_DAYS_DEFAULT = int(os.environ.get("SUSPICIOUS_RETENTION_DAYS", "90"))
RETENTION_DAYS_EVIDENCE = int(os.environ.get("SUSPICIOUS_EVIDENCE_RETENTION_DAYS", "365"))


REASON_LABELS = {
    "brute_force_login": "단시간 다수 인증 실패",
    "scrape_pattern": "스크래핑 의심 트래픽",
    "csrf_violation": "CSRF 토큰 불일치",
    "unauthorized_admin_attempt": "비인가 어드민 접근 시도",
    "abnormal_payload": "비정상 페이로드 패턴",
    "rate_limit_exceeded": "rate limit 초과",
    "geo_anomaly": "비정상 지리 변화",
    "uploaded_malware_signature": "업로드 파일 악성 시그니처",
}

SEVERITY_VALID = ("low", "medium", "high", "critical")


def hash_ua(ua: str) -> str:
    """UA를 sha256으로 해시 — 원본 UA는 PII이므로 직접 저장 안 함.
    해시는 동일 클라이언트 식별 + 패턴 분석용.
    """
    if not ua:
        return ""
    return hashlib.sha256(ua.encode("utf-8")).hexdigest()


async def record_async(
    session,
    *,
    reason: str,
    severity: str = "medium",
    ip: str = "",
    user_agent: str = "",
    path: str = "",
    method: str = "",
    status_code: int = 0,
    request_id: str = "",
    actor_user_id: int | None = None,
    detail: dict[str, Any] | None = None,
):
    """Async session 호환 record. auth.py / FastAPI route 에서 호출."""
    if severity not in SEVERITY_VALID:
        severity = "medium"
    ev = SuspiciousEvent(
        reason=reason,
        severity=severity,
        ip=(ip or "")[:45],
        user_agent_hash=hash_ua(user_agent),
        path=(path or "")[:255],
        method=(method or "")[:10],
        status_code=status_code or 0,
        request_id=(request_id or "")[:40],
        actor_user_id=actor_user_id,
        detail=detail or {},
        evidence=False,
    )
    session.add(ev)
    try:
        await session.flush()
    except Exception as _e:  # noqa: BLE001
        # SuspiciousEvent INSERT 실패는 보안 모듈 자체에서 silent fail —
        # 호출자(login handler 등) 의 본 흐름을 막아선 안 됨.
        try:
            await session.rollback()
        except Exception:
            pass
        return None
    return ev


def record(
    session: Session,
    *,
    reason: str,
    severity: str = "medium",
    ip: str = "",
    user_agent: str = "",
    path: str = "",
    method: str = "",
    status_code: int = 0,
    request_id: str = "",
    actor_user_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> SuspiciousEvent:
    """의심 이벤트 1건 기록.

    호출 위치 예:
    - main.py login 핸들러: 5분 내 5회 실패 → reason="brute_force_login"
    - audit middleware: 인증되지 않은 /admin/* 호출 → "unauthorized_admin_attempt"
    - upload 핸들러: 파일 시그니처 거부 → "uploaded_malware_signature"
    """
    if severity not in SEVERITY_VALID:
        severity = "medium"
    ev = SuspiciousEvent(
        reason=reason,
        severity=severity,
        ip=ip[:45],
        user_agent_hash=hash_ua(user_agent),
        path=path[:255],
        method=method[:10],
        status_code=status_code or 0,
        request_id=request_id[:40],
        actor_user_id=actor_user_id,
        detail=detail or {},
        evidence=False,
    )
    session.add(ev)
    session.flush()
    return ev


def mark_as_evidence(
    session: Session,
    *,
    event_id: int,
    note: str,
    sealed_by_email: str,
) -> SuspiciousEvent | None:
    """운영자가 특정 이벤트를 '법적 증거'로 봉인.
    봉인된 row는 자동 삭제 cron에서 제외되며, sealed_at 이후 수정 불가.
    """
    ev = session.get(SuspiciousEvent, event_id)
    if ev is None or ev.sealed_at is not None:
        return ev
    ev.evidence = True
    ev.evidence_note = (note or "")[:255]
    ev.sealed_at = datetime.now(timezone.utc)
    ev.sealed_by = (sealed_by_email or "")[:190]
    session.flush()
    return ev


def sweep_expired(session: Session) -> tuple[int, int]:
    """보존 기간이 지난 이벤트 자동 삭제. cron에서 1일 1회 호출.

    returns (deleted_normal, deleted_evidence_after_long_window)
    """
    now = datetime.now(timezone.utc)
    cutoff_normal = now - timedelta(days=RETENTION_DAYS_DEFAULT)
    cutoff_evidence = now - timedelta(days=RETENTION_DAYS_EVIDENCE)

    # 1) evidence=false 이고 cutoff_normal보다 오래된 row 삭제
    res1 = session.execute(
        delete(SuspiciousEvent).where(
            SuspiciousEvent.evidence == False,  # noqa: E712
            SuspiciousEvent.detected_at < cutoff_normal,
        )
    )
    # 2) evidence=true 이지만 365일 초과한 row도 삭제 (영구 보존 금지)
    res2 = session.execute(
        delete(SuspiciousEvent).where(
            SuspiciousEvent.evidence == True,  # noqa: E712
            SuspiciousEvent.detected_at < cutoff_evidence,
        )
    )
    session.commit()
    return (res1.rowcount or 0, res2.rowcount or 0)


def list_recent(
    session: Session,
    *,
    limit: int = 100,
    severity: str | None = None,
    only_open: bool = False,
) -> list[SuspiciousEvent]:
    q = select(SuspiciousEvent).order_by(SuspiciousEvent.detected_at.desc()).limit(limit)
    if severity:
        q = q.where(SuspiciousEvent.severity == severity)
    if only_open:
        q = q.where(SuspiciousEvent.sealed_at.is_(None))
    return list(session.execute(q).scalars())
