"""중앙화된 secret / PII 마스킹 + 안전한 에러 응답 헬퍼.

모든 logs / API 에러 응답이 본 모듈을 거쳐서 secret / 자격증명 / 내부 경로 /
exception detail 노출을 차단한다 (외부 코드 리뷰 F-3.10, Phase 2 hardening).

원칙:
  - production (ENV=prod) 에서는 더 aggressive 하게 마스킹.
  - dev/demo 에서는 디버깅 가능한 메시지 유지 (단, secret 패턴은 항상 제거).
  - email/IP 같은 PII 는 마스킹 후 로깅 (forensic 추적 가능 + 노출 최소화).

호출자:
  - main.py 의 unhandled_exception_handler — error 응답에 stack trace 누설 차단
  - main.py 의 admin_health — DB error 메시지 마스킹
  - auth.py 의 login.failure logs — email 부분 마스킹
  - log_outbox / audit_logs 의 detail dict 정리

본 모듈은 stdlib 만 사용해 의존성 미증가.
"""
from __future__ import annotations

import os
import re
from typing import Any


# 민감 키 — 본 단어가 dict key 에 포함되면 값을 [REDACTED] 로 대체.
# (case-insensitive, substring 매칭)
_SECRET_KEY_PATTERNS = (
    "password", "passwd", "pwd",
    "token", "access_token", "refresh_token", "bearer",
    "secret", "api_key", "apikey", "api-key",
    "authorization", "auth", "cookie", "session",
    "jwt", "totp", "otp", "code",
    "database_url", "db_url", "dbpassword",
    "smtp_pass", "smtp_password", "resend_api_key",
    "private_key", "credential",
)


# 정규식 — 값 안에 직접 secret 패턴이 포함되면 마스킹.
_INLINE_SECRET_PATTERNS = (
    # bcrypt hash
    re.compile(r"\$2[ayb]\$\d{1,2}\$[./A-Za-z0-9]{53}"),
    # JWT token (3 segments dot-separated, base64url)
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"),
    # Resend API key
    re.compile(r"\bre_[A-Za-z0-9_]{20,}\b"),
    # SendGrid / Stripe / generic sk_ keys
    re.compile(r"\bsk_(live|test)_[A-Za-z0-9]{20,}\b"),
    # 64-char hex (likely JWT_SECRET / HMAC secret)
    re.compile(r"\b[a-f0-9]{64}\b"),
    # Authorization header value
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{20,}"),
    # DB connection string passwords (mysql+aiomysql://user:PASS@host)
    re.compile(r"(?i)(mysql|postgresql|postgres|mongodb|redis)(\+\w+)?://[^:@/\s]+:([^@/\s]+)@"),
    # Aiven password format
    re.compile(r"\bAVNS_[A-Za-z0-9]{15,}\b"),
)


def is_prod() -> bool:
    return os.environ.get("ENV", "").strip().lower() in {"prod", "production"}


def mask_email(email: str) -> str:
    """이메일 부분 마스킹 — local 부분의 첫 1자만 노출.

    >>> mask_email("admin@daemu.kr")
    'a***@daemu.kr'
    >>> mask_email("a@b.kr")
    'a***@b.kr'
    """
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    if not local:
        return "***@" + domain
    return f"{local[0]}***@{domain}"


def mask_ip(ip: str) -> str:
    """IP 부분 마스킹 — IPv4 의 마지막 octet, IPv6 의 마지막 segment 만 hide.
    forensic 추적용 prefix 는 보존.
    """
    if not ip:
        return ""
    if "." in ip:  # IPv4
        parts = ip.split(".")
        if len(parts) == 4:
            return f"{parts[0]}.{parts[1]}.{parts[2]}.***"
    if ":" in ip:  # IPv6
        parts = ip.split(":")
        if len(parts) >= 3:
            return ":".join(parts[:-2]) + ":***:***"
    return ip[:6] + "***" if len(ip) > 6 else ip


def _scrub_inline_secrets(text: str) -> str:
    """문자열 안의 secret 패턴을 [REDACTED] 로 치환.
    DB connection string 의 password 부분만 redact (host 는 보존)."""
    if not text:
        return text
    for pat in _INLINE_SECRET_PATTERNS:
        if pat.pattern.startswith("(?i)(mysql"):
            # connection string — password group 만 redact
            text = pat.sub(r"\1\2://[REDACTED_USER]:[REDACTED]@", text)
        else:
            text = pat.sub("[REDACTED]", text)
    return text


def mask_value(key: str, value: Any) -> Any:
    """key 가 민감 패턴이면 [REDACTED], 아니면 inline secret 만 제거.
    재귀적으로 dict / list 적용."""
    if value is None:
        return None
    key_lower = str(key).lower()
    if any(p in key_lower for p in _SECRET_KEY_PATTERNS):
        return "[REDACTED]"
    if isinstance(value, str):
        return _scrub_inline_secrets(value)
    if isinstance(value, dict):
        return {k: mask_value(k, v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [mask_value(key, v) for v in value]
    return value


def mask_dict(payload: Any) -> Any:
    """공개용 dict 마스킹. 재귀적 처리."""
    if isinstance(payload, dict):
        return {k: mask_value(k, v) for k, v in payload.items()}
    if isinstance(payload, (list, tuple)):
        return [mask_dict(v) for v in payload]
    return payload


def safe_error_message(exc: Exception, *, max_len: int = 200) -> str:
    """예외 메시지를 응답 / log 에 안전하게 노출.

    - production: 일반 안내문만 ("internal error"). exc detail 누설 차단.
    - dev/demo: 메시지 유지 (단 inline secret 제거).
    """
    if is_prod():
        return "internal error"
    raw = f"{type(exc).__name__}: {exc}"
    return _scrub_inline_secrets(raw)[:max_len]


def safe_db_error(exc: Exception | str, *, max_len: int = 200) -> str:
    """DB 에러를 admin/health 응답 / log 에 안전하게 표시.

    - production: 카테고리만 ("connection failed" / "timeout" / "auth failed" /
      "internal db error"). connection string / 자격증명 누설 차단.
    - dev/demo: 메시지 유지 (단 inline secret 제거).
    """
    raw = str(exc) if not isinstance(exc, str) else exc
    if is_prod():
        s = raw.lower()
        if "timeout" in s or "timed out" in s:
            return "DB timeout"
        if "access denied" in s or "authentication" in s or "1045" in s:
            return "DB auth failed"
        if "can't connect" in s or "connection refused" in s or "2003" in s or "no such host" in s:
            return "DB connection failed"
        if "unknown database" in s or "1049" in s:
            return "DB schema misconfigured"
        return "DB internal error"
    return _scrub_inline_secrets(raw)[:max_len]


def safe_db_url(url: str | object) -> str:
    """admin/health 의 database 표시. production 에선 호스트도 redact.

    - production: 'mysql+aiomysql://[redacted]/db_name' (driver + db name 만).
    - dev/demo: hide_password 만 적용 (host/port 보존).
    """
    s = str(url)
    if is_prod():
        # mysql+aiomysql://user:***@host:port/dbname → mysql+aiomysql://[redacted]/dbname
        m = re.match(r"^([^:]+://)[^/]*/(.*)$", s)
        if m:
            return f"{m.group(1)}[redacted]/{m.group(2)}"
        return "[redacted]"
    return s
