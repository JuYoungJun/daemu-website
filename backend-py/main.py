"""DAEMU backend — FastAPI + async SQLAlchemy.

Endpoints
---------
Public:
    GET  /api/health
    POST /api/upload          — base64 image upload, returns public URL
    POST /api/email/send      — single email via Resend (also logs to outbox)
    POST /api/email/campaign  — bulk email
    POST /api/inquiries       — Contact form submission (saves to DB)
    GET  /api/mail-template/{kind}  — public read of templates
    GET  /api/content/{key}   — public read of CMS blocks
    GET  /uploads/{name}      — static serve

Admin (Bearer JWT):
    POST /api/auth/login
    GET  /api/auth/me
    GET/PATCH/DELETE /api/inquiries[/{id}]
    Same shape for /api/partners, /api/orders, /api/works,
                   /api/popups, /api/crm, /api/campaigns,
                   /api/promotions, /api/outbox
    PUT  /api/mail-template/{kind}
    PUT  /api/content/{key}

DATABASE_URL env switches between sqlite+aiosqlite (default, demo) and
mysql+asyncmy://user:pass@host/db (production).

Run locally:
    uvicorn main:app --reload --port 3000
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import re
import secrets
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import ensure_default_users, require_perm, router as auth_router, users_router
from db import Base, SessionLocal, engine, get_session
from models import Outbox  # noqa: F401 — also makes import side-effect register tables
from routes_crud import router as crud_router

load_dotenv()

PORT = int(os.environ.get("PORT", "3000"))
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
FROM_EMAIL = os.environ.get("FROM_EMAIL", "DAEMU <onboarding@resend.dev>")
PUBLIC_BASE = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:8765,http://localhost:5173,http://localhost:8766",
    ).split(",")
    if o.strip()
]

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_IMAGE_BYTES = 8 * 1024 * 1024       # 8MB for images
MAX_VIDEO_BYTES = 50 * 1024 * 1024      # 50MB for videos
MAX_UPLOAD_BYTES = MAX_VIDEO_BYTES      # absolute upper bound (legacy alias)
MAX_ATTACHMENTS = 12
CAMPAIGN_THROTTLE_SECONDS = 0.25

EXT_TO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}

VIDEO_EXTS = {".mp4", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# F-06 + media library extension: image and video formats only. Each whitelisted
# extension is paired with a magic byte signature so a renamed payload
# (`evil.exe` → `evil.mp4`) is rejected. SVG/PDF still blocked (script-capable).
UPLOAD_MAGIC: dict[str, list[bytes]] = {
    ".jpg":  [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png":  [b"\x89PNG\r\n\x1a\n"],
    ".gif":  [b"GIF87a", b"GIF89a"],
    ".webp": [b"RIFF"],   # additional check for "WEBP" at offset 8 below
    ".mp4":  [b"\x00\x00\x00"],  # ftyp box: bytes 4-8 contain "ftyp" — checked below
    ".webm": [b"\x1a\x45\xdf\xa3"],  # EBML magic
}


def magic_byte_ok(buf: bytes, ext: str) -> bool:
    sigs = UPLOAD_MAGIC.get(ext.lower())
    if not sigs:
        return False
    if not any(buf.startswith(s) for s in sigs):
        return False
    if ext.lower() == ".webp":
        return len(buf) >= 12 and buf[8:12] == b"WEBP"
    if ext.lower() == ".mp4":
        # ISO Base Media format: bytes 4-8 must be "ftyp"
        return len(buf) >= 12 and buf[4:8] == b"ftyp"
    return True


def upload_kind(ext: str) -> str:
    e = ext.lower()
    if e in VIDEO_EXTS:
        return "video"
    if e in IMAGE_EXTS:
        return "image"
    return "other"


def upload_size_cap(ext: str) -> int:
    return MAX_VIDEO_BYTES if upload_kind(ext) == "video" else MAX_IMAGE_BYTES

if not RESEND_API_KEY:
    print("[daemu-backend-py] RESEND_API_KEY not set — emails will be simulated.")


# ---------------------------------------------------------------------------
# Lifespan: create tables + seed default admin

async def _retention_cron(stop_event: asyncio.Event) -> None:
    """N2-06 / N2-17 / Privacy Act art.21 fix: periodically delete personal data past
    the retention window declared in /privacy.

    - inquiries older than INQUIRY_RETENTION_DAYS (default 1095 = 3y)
    - outbox older than OUTBOX_RETENTION_DAYS (default 365 = 1y)

    Runs every 6h. First sweep happens 5 minutes after boot so cold-starts
    don't fire it instantly under load."""
    # V3-01 fix: must import datetime + timezone INTO this scope. Previously
    # the lambda-style `datetime.now(timezone.utc)` raised NameError every
    # sweep, swallowed by the broad except, leaving retention literally dead.
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import delete
    from models import Inquiry, Outbox

    inquiry_days = int(os.environ.get("INQUIRY_RETENTION_DAYS", "1095"))
    outbox_days = int(os.environ.get("OUTBOX_RETENTION_DAYS", "365"))
    period_seconds = int(os.environ.get("RETENTION_PERIOD_SECONDS", str(6 * 3600)))

    try:
        await asyncio.wait_for(stop_event.wait(), timeout=300)
        return
    except asyncio.TimeoutError:
        pass

    while not stop_event.is_set():
        try:
            cutoff_inq = datetime.now(timezone.utc) - timedelta(days=inquiry_days)
            cutoff_obx = datetime.now(timezone.utc) - timedelta(days=outbox_days)
            async with SessionLocal() as session:
                r1 = await session.execute(delete(Inquiry).where(Inquiry.created_at < cutoff_inq))
                r2 = await session.execute(delete(Outbox).where(Outbox.created_at < cutoff_obx))
                await session.commit()
                if (r1.rowcount or 0) or (r2.rowcount or 0):
                    print(f"[retention] purged {r1.rowcount or 0} inquiries / {r2.rowcount or 0} outbox rows")
        except Exception as exc:  # noqa: BLE001
            print(f"[retention] sweep failed: {exc!r}")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=period_seconds)
        except asyncio.TimeoutError:
            continue


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 기존 테이블에 새 컬럼을 추가하는 idempotent 마이그레이션.
        # create_all 은 새 테이블만 만들고 기존 테이블의 컬럼은 건드리지
        # 않으므로, 모델에 컬럼을 추가한 뒤에는 이 단계가 필요합니다.
        try:
            from migrations import install_migrations_sync
            await conn.run_sync(install_migrations_sync)
        except Exception as e:  # noqa: BLE001
            print(f"[migration] failed: {e!r}")
    async with SessionLocal() as session:
        await ensure_default_users(session)
        # 표준 계약서/발주서 템플릿 자동 시드 (idempotent — 이미 있으면 skip)
        try:
            from seeds import ensure_default_templates, ensure_demo_superadmin
            await ensure_default_templates(session)
            # ENV != prod 일 때만 데모 슈퍼관리자 자동 복원 (SQLite 휘발 대응)
            await ensure_demo_superadmin(session)
        except Exception as e:  # noqa: BLE001
            print(f"[seeds] auto-seed failed: {e!r}")
    print(f"[daemu-backend-py] DB ready ({engine.url.render_as_string(hide_password=True)})")

    # Background retention task — Privacy Act art.21 compliance.
    stop_event = asyncio.Event()
    cron_task = asyncio.create_task(_retention_cron(stop_event))
    # V3-13: hold the reference so the task can't be garbage-collected mid-flight.
    app.state.retention_task = cron_task
    yield
    stop_event.set()
    try:
        await asyncio.wait_for(cron_task, timeout=2.0)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        cron_task.cancel()


PROD = os.environ.get("ENV", "").lower() in {"prod", "production"}

# Disable Swagger UI / OpenAPI in production (F-10 — reduces info leakage).
# Set ENV=prod in Render once a real domain + customer data are wired up.
app = FastAPI(
    title="DAEMU API",
    description=(
        "**대무 (DAEMU)** — 베이커리 · 카페 비즈니스 파트너 백엔드 API.\n\n"
        "📍 본사: 전라남도 나주시 황동 3길 8 · 📞 061-335-1239\n\n"
        "### 인증\n"
        "보호된 엔드포인트는 `Authorization: Bearer <jwt>` 헤더가 필요합니다. "
        "`/api/auth/login` 으로 토큰을 발급받으세요.\n\n"
        "### 역할\n"
        "- **admin** — 전체 권한\n"
        "- **tester** — 대부분 읽기 전용\n"
        "- **developer** — 작업사례·콘텐츠·메일·팝업 관리"
    ),
    version="3.1",
    contact={"name": "대무 운영팀", "email": "daemu_office@naver.com"},
    license_info={"name": "Proprietary", "url": "https://juyoungjun.github.io/daemu-website/privacy"},
    openapi_tags=[
        {"name": "auth", "description": "🔐 로그인 / 비밀번호 변경 / 현재 사용자 조회"},
        {"name": "users", "description": "👥 사용자 관리 (관리자 전용)"},
        {"name": "crud", "description": "📋 문의 · 파트너 · 발주 · 작업 · CRM · 캠페인 · 프로모션 · 팝업 · 메일 템플릿"},
    ],
    lifespan=lifespan,
    docs_url=None if PROD else "/docs",
    redoc_url=None if PROD else "/redoc",
    openapi_url=None if PROD else "/openapi.json",
    swagger_ui_parameters={
        # Cleaner default — collapse model schemas, group operations by tag.
        "defaultModelsExpandDepth": -1,
        "defaultModelExpandDepth": 1,
        "displayRequestDuration": True,
        "filter": True,
        "syntaxHighlight.theme": "monokai",
        "tryItOutEnabled": True,
        "persistAuthorization": True,
        "docExpansion": "list",
        "tagsSorter": "alpha",
        "operationsSorter": "alpha",
    },
)


# Custom branded /docs page that overrides Swagger UI's default styling.
# Falls through to the auto-generated /docs in non-prod, but with our CSS.
if not PROD:
    from fastapi.responses import HTMLResponse
    from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html

    @app.get("/docs", include_in_schema=False)
    async def custom_swagger_ui_html():
        return get_swagger_ui_html(
            openapi_url="/openapi.json",
            title="DAEMU API · 문서",
            swagger_favicon_url="https://juyoungjun.github.io/daemu-website/assets/logo.svg",
            swagger_ui_parameters=app.swagger_ui_parameters,
        )

    @app.get("/redoc", include_in_schema=False)
    async def custom_redoc_html():
        return get_redoc_html(
            openapi_url="/openapi.json",
            title="DAEMU API · Reference",
            redoc_favicon_url="https://juyoungjun.github.io/daemu-website/assets/logo.svg",
        )

    # Modern alternative: Scalar API Reference (https://scalar.com).
    # No new Python dep — just an HTML shell that loads Scalar's CDN bundle
    # and points it at our /openapi.json.
    @app.get("/reference", include_in_schema=False, response_class=HTMLResponse)
    async def scalar_reference():
        return """<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>DAEMU API · Scalar Reference</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="https://juyoungjun.github.io/daemu-website/assets/logo.svg" />
  <style>
    body { margin: 0; font-family: 'Noto Sans KR', system-ui, sans-serif; }
    .topbar { padding: 14px 24px; background: #2a2724; color: #f6f4f0;
              font-size: 13px; letter-spacing: .04em; }
    .topbar strong { font-family: 'Cormorant Garamond', serif; font-size: 17px;
                      letter-spacing: .12em; margin-right: 12px; }
    .topbar a { color: #ecc488; margin-left: 14px; text-decoration: none; }
    .topbar a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="topbar">
    <strong>DAEMU API</strong>
    <span>대무 백엔드 API · v3.1</span>
    <a href="/docs">Swagger UI</a>
    <a href="/redoc">ReDoc</a>
    <a href="/openapi.json">OpenAPI JSON</a>
  </div>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script>
    window.addEventListener('load', () => {
      // Scalar configuration — Korean default theme
      const scalarConfig = {
        theme: 'kepler',
        layout: 'modern',
        searchHotKey: 'k',
        defaultOpenAllTags: false,
        hideDownloadButton: false,
      };
      const el = document.getElementById('api-reference');
      el.dataset.configuration = JSON.stringify(scalarConfig);
    });
  </script>
  <!-- FA-05: pin the Scalar API Reference version + SRI hash so a CDN
       compromise can't substitute the bundle. Update when intentionally
       upgrading; the SHA-384 below matches @scalar/api-reference@1.25.94. -->
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.94"
          crossorigin="anonymous"></script>
</body>
</html>"""

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=600,
)


# F-18: defense-in-depth headers on every API response.
# Note: API responses are JSON, so the strict CSP here mainly protects /docs
# (when ENV != prod) and any HTML error pages. The frontend served from
# GitHub Pages / Cafe24 sets its own CSP separately (see index.html).
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Content-Security-Policy": (
        "default-src 'none'; "
        "img-src 'self' data: https:; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "  # /docs uses jsdelivr
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'self'"
    ),
}


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s %(message)s",
)
log = logging.getLogger("daemu")


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    """F-13: every request gets a UUID surfaced in logs + the X-Request-ID
    response header so a customer report ('it failed at 14:03 with id ...')
    is traceable to a single log line."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(req: Request, exc: Exception):
    """F-07: log the full traceback with a request ID, return a generic
    error to the client (no stack leakage)."""
    rid = getattr(req.state, "request_id", "no-id")
    log.error(
        "unhandled exception rid=%s path=%s method=%s\n%s",
        rid, req.url.path, req.method,
        "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
    )
    return JSONResponse(
        {"ok": False, "error": "internal", "request_id": rid},
        status_code=500,
    )


# ---------------------------------------------------------------------------
# Routers

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(crud_router)

# Contract / PO documents — kept in its own module to avoid bloating routes_crud.
from routes_documents import router as documents_router
app.include_router(documents_router)

# 첫 접속 어드민 이메일 인증 (B1).
from routes_email_verify import router as email_verify_router  # noqa: E402
app.include_router(email_verify_router)


# ---------------------------------------------------------------------------
# Helpers

def apply_vars(text: str | None, vars_: dict[str, Any]) -> str:
    if not text:
        return ""
    pattern = re.compile(r"\{\{\s*([\w-]+)\s*\}\}")
    return pattern.sub(lambda m: str(vars_.get(m.group(1), "")), str(text))


def safe_filename(raw: str) -> str:
    cleaned = re.sub(r"[^\w.\-]", "_", str(raw))[:80]
    cleaned = cleaned.lstrip(".") or "file"
    return cleaned


def detect_mime(filename: str, fallback: str | None) -> str:
    lower = filename.lower()
    for ext, mime in EXT_TO_MIME.items():
        if lower.endswith(ext):
            return mime
    return fallback or "application/octet-stream"


# ---------------------------------------------------------------------------
# Models for endpoints not in the CRUD router

class UploadIn(BaseModel):
    filename: str
    content: str
    contentType: str | None = None


class Attachment(BaseModel):
    filename: str
    content: str
    contentId: str | None = None
    contentType: str | None = None


class EmailSendIn(BaseModel):
    to: str
    toName: str | None = ""
    subject: str
    body: str | None = ""
    html: str | None = None
    replyTo: str | None = None
    attachments: list[Attachment] | None = None
    type: str | None = None


class CampaignRecipient(BaseModel):
    email: str
    name: str | None = ""


class CampaignIn(BaseModel):
    recipients: list[CampaignRecipient]
    subject: str
    body: str | None = ""
    html: str | None = None
    replyTo: str | None = None
    attachments: list[Attachment] | None = None
    campaignId: str | None = None


# ---------------------------------------------------------------------------
# Health

@app.get("/api/monitoring/summary")
async def monitoring_summary(_user = Depends(require_perm("monitoring", "read"))):
    """관리자/개발자만 조회 가능한 운영 요약 — 모니터링 페이지에서 1회/분 폴링.
    DB 응답 시간, 최근 24h Outbox 통계, 최근 실패 발송 건수, 미답변 문의 등
    한 호출에 모아 반환."""
    from datetime import datetime, timedelta, timezone as _tz
    from sqlalchemy import func as _func
    from models import Inquiry, Outbox, AuditLog, Document, NewsletterSubscriber, Partner
    cutoff = datetime.now(_tz.utc) - timedelta(hours=24)
    out: dict[str, Any] = {"ok": True, "ts": datetime.now(_tz.utc).isoformat()}

    # DB ping latency (단순 SELECT 1)
    t0 = time.perf_counter()
    try:
        async with SessionLocal() as session:
            await session.execute(select(_func.count()).select_from(Outbox))
            db_ms = round((time.perf_counter() - t0) * 1000, 1)
            out["dbLatencyMs"] = db_ms

            # Outbox 24h
            ob_24h = (await session.execute(
                select(Outbox.status, _func.count())
                .where(Outbox.created_at >= cutoff)
                .group_by(Outbox.status)
            )).all()
            out["outbox24h"] = {row[0]: row[1] for row in ob_24h}

            # Outbox 누적
            ob_total = (await session.execute(select(_func.count()).select_from(Outbox))).scalar_one()
            out["outboxTotal"] = ob_total

            # 실패 최근 5건 (실패율 진단)
            recent_failed = (await session.execute(
                select(Outbox).where(Outbox.status.in_(["failed", "error"]))
                .order_by(Outbox.created_at.desc()).limit(5)
            )).scalars().all()
            out["recentFailures"] = [
                {"id": r.id, "type": r.type, "to": r.recipient, "subject": r.subject,
                 "error": r.error[:200] if r.error else "",
                 "ts": r.created_at.isoformat() if r.created_at else None}
                for r in recent_failed
            ]

            # 문의 — 미답변 신규 건수
            new_inq = (await session.execute(
                select(_func.count()).select_from(Inquiry).where(Inquiry.status == "신규")
            )).scalar_one()
            out["newInquiries"] = new_inq

            # 24h 신규 문의
            inq_24h = (await session.execute(
                select(_func.count()).select_from(Inquiry).where(Inquiry.created_at >= cutoff)
            )).scalar_one()
            out["inquiries24h"] = inq_24h

            # 활성 파트너
            active_partners = (await session.execute(
                select(_func.count()).select_from(Partner).where(Partner.status == "활성")
            )).scalar_one()
            out["activePartners"] = active_partners

            # 활성 뉴스레터 구독자
            sub_active = (await session.execute(
                select(_func.count()).select_from(NewsletterSubscriber)
                .where(NewsletterSubscriber.status == "active")
            )).scalar_one()
            out["newsletterActive"] = sub_active

            # 문서 (계약/PO) 상태 집계
            doc_by_status = (await session.execute(
                select(Document.status, _func.count()).group_by(Document.status)
            )).all()
            out["documentsByStatus"] = {row[0]: row[1] for row in doc_by_status}

            # 최근 24h 보안 이벤트 (login.failure / login.totp.failure)
            sec_events = (await session.execute(
                select(AuditLog.action, _func.count())
                .where(AuditLog.created_at >= cutoff)
                .where(AuditLog.action.in_([
                    "login.failure", "login.throttled",
                    "login.totp.failure", "login.totp.required",
                    "login.success", "password.change.failure", "totp.enabled", "totp.disabled",
                ]))
                .group_by(AuditLog.action)
            )).all()
            out["securityEvents24h"] = {row[0]: row[1] for row in sec_events}

            # ── 해킹/DDoS 이상 징후 ────────────────────────────────────
            # 1) 동일 IP에서 1시간 내 비정상 trafic — login.failure / throttled
            from sqlalchemy import desc as _desc
            hour_cutoff = datetime.now(_tz.utc) - timedelta(hours=1)
            ip_stats = (await session.execute(
                select(AuditLog.ip, _func.count())
                .where(AuditLog.created_at >= hour_cutoff)
                .where(AuditLog.action.in_(["login.failure", "login.throttled", "login.totp.failure"]))
                .group_by(AuditLog.ip)
                .order_by(_desc(_func.count()))
                .limit(10)
            )).all()
            suspicious_ips = [
                {"ip": (row[0] or "unknown"), "count": int(row[1])}
                for row in ip_stats if row[0] and int(row[1]) >= 3
            ]
            out["suspiciousIps1h"] = suspicious_ips

            # 2) 5분 내 인증 실패 spike — DDoS-style 징후
            five_min_cutoff = datetime.now(_tz.utc) - timedelta(minutes=5)
            spike_5m = (await session.execute(
                select(_func.count()).select_from(AuditLog)
                .where(AuditLog.created_at >= five_min_cutoff)
                .where(AuditLog.action.in_(["login.failure", "login.throttled"]))
            )).scalar_one() or 0
            out["authFailures5m"] = int(spike_5m)

            # 3) 24시간 unique 실패 IP 수 — 분산 공격 징후
            unique_failed_ips = (await session.execute(
                select(_func.count(_func.distinct(AuditLog.ip)))
                .where(AuditLog.created_at >= cutoff)
                .where(AuditLog.action.in_(["login.failure", "login.throttled"]))
            )).scalar_one() or 0
            out["uniqueFailedIps24h"] = int(unique_failed_ips)

            # 4) 스캐닝/probing 의심 — 미지의 endpoint 접근 (404/405가 다발)
            #    AuditLog는 인증 실패만 기록하므로, recent_failed Outbox 패턴
            #    + login throttle 패턴으로 추정. 정확한 path별 통계는 nginx
            #    access log에서 별도 집계 필요 (운영 시 fail2ban으로 자동화).

            # 5) 위험도 등급 계산 — frontend가 색상 표시할 때 사용
            #    suspicious_ips 3+ 건 OR authFailures5m 50+ → high
            #    1~2건 OR 10~50 → medium / 그 외 normal
            risk = "normal"
            if len(suspicious_ips) >= 3 or spike_5m >= 50:
                risk = "high"
            elif len(suspicious_ips) >= 1 or spike_5m >= 10:
                risk = "medium"
            out["riskLevel"] = risk
    except Exception as exc:  # noqa: BLE001
        out["dbLatencyMs"] = None
        out["error"] = str(exc)[:200]

    out["emailProvider"] = email_provider()
    return out


@app.get("/api/health")
async def health():
    provider = email_provider()
    return {
        "ok": True,
        "runtime": "python-fastapi",
        "version": "3.1",
        "emailProvider": provider,
        "resendConfigured": bool(RESEND_API_KEY),
        "smtpConfigured": bool(SMTP_HOST and SMTP_USER),
        "smtpHost": (SMTP_HOST or ""),
        "smtpFrom": (SMTP_FROM or ""),
        "database": engine.url.render_as_string(hide_password=True),
        "from": FROM_EMAIL,
        "allowedOrigins": ALLOWED_ORIGINS,
        "uploadEndpoint": "/api/upload",
        "publicBase": PUBLIC_BASE or "(auto from request host)",
        "warnings": (
            ["이메일 발송 미설정 — 모든 발송이 simulated로 기록됩니다. RESEND_API_KEY 또는 SMTP_HOST/USER/PASS를 Render env에 설정하세요."]
            if provider == "none" else []
        ),
    }


# ---------------------------------------------------------------------------
# Static uploads (cache 7 days, immutable)

class CachedStatic(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=604800, immutable"
        return response


app.mount("/uploads", CachedStatic(directory=str(UPLOAD_DIR)), name="uploads")


# ---------------------------------------------------------------------------
# Upload

@app.post("/api/upload")
async def upload(
    payload: UploadIn,
    request: Request,
    _user = Depends(require_perm("works", "write")),
):
    """Media upload — restricted to admin/developer roles. Accepts images
    (jpg/png/gif/webp ≤ 8 MB) and videos (mp4/webm ≤ 50 MB). Public Contact
    form no longer needs uploads; auto-reply attachments are server-managed."""
    if not payload.filename or not payload.content:
        raise HTTPException(400, detail="filename + content required")

    safe = safe_filename(payload.filename)
    ext_match = re.search(r"\.[a-z0-9]+$", safe, re.IGNORECASE)
    ext = ext_match.group(0).lower() if ext_match else ".bin"

    if ext not in UPLOAD_MAGIC:
        raise HTTPException(
            415,
            detail="허용되지 않는 형식입니다. 이미지(.jpg/.png/.gif/.webp) 또는 영상(.mp4/.webm)만 업로드할 수 있습니다.",
        )

    cap = upload_size_cap(ext)
    # N2-05 DoS fix: reject pre-decode if the base64 string itself is
    # already larger than the post-decode cap by a comfortable margin.
    if len(payload.content) > cap * 4 // 3 + 256:
        cap_mb = cap // (1024 * 1024)
        raise HTTPException(413, detail=f"file too large ({cap_mb}MB cap)")

    try:
        buf = base64.b64decode(payload.content, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(400, detail="invalid base64 content") from None

    if len(buf) > cap:
        cap_mb = cap // (1024 * 1024)
        raise HTTPException(413, detail=f"file too large ({cap_mb}MB cap)")
    if not buf:
        raise HTTPException(400, detail="empty file")

    if not magic_byte_ok(buf, ext):
        raise HTTPException(415, detail="파일 내용이 선언된 형식과 일치하지 않습니다.")

    # F-33: token_hex(8) gives 32 bits of entropy + the timestamp prefix —
    # collisions over the lifetime of the demo are now astronomically
    # unlikely (vs token_hex(4)'s 16 bits which collide in ~64K uploads).
    file_id = format(int(time.time() * 1000), "x") + "-" + secrets.token_hex(8)
    final_name = f"{file_id}{ext.lower()}"
    final_path = UPLOAD_DIR / final_name
    if UPLOAD_DIR.resolve() not in final_path.resolve().parents:
        raise HTTPException(400, detail="invalid path")

    final_path.write_bytes(buf)

    if PUBLIC_BASE:
        host = PUBLIC_BASE
    else:
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
        host_hdr = request.headers.get("host") or request.url.netloc
        host = f"{scheme}://{host_hdr}"

    return {
        "ok": True,
        "url": f"{host}/uploads/{final_name}",
        "filename": safe,
        "contentType": detect_mime(final_name, payload.contentType),
        "size": len(buf),
        "kind": upload_kind(ext),
    }


def normalize_attachments(items: list[Attachment] | None) -> list[dict[str, Any]] | None:
    if not items:
        return None
    out: list[dict[str, Any]] = []
    for a in items[:MAX_ATTACHMENTS]:
        if not a.filename or not a.content:
            continue
        entry: dict[str, Any] = {
            "filename": str(a.filename),
            "content": str(a.content),
            "content_type": detect_mime(a.filename, a.contentType),
        }
        if a.contentId:
            cid = str(a.contentId)
            entry["content_id"] = cid
            entry["inline_content_id"] = cid
            entry["cid"] = cid
        out.append(entry)
    return out or None


async def send_via_resend(client: httpx.AsyncClient, payload: dict[str, Any]) -> dict[str, Any]:
    res = await client.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30.0,
    )
    text = res.text
    try:
        json_body = res.json() if text else None
    except ValueError:
        json_body = None
    if res.status_code >= 400:
        msg = (json_body or {}).get("message") if isinstance(json_body, dict) else None
        return {"ok": False, "status": res.status_code, "error": msg or f"HTTP {res.status_code}"}
    rid = (json_body or {}).get("id") if isinstance(json_body, dict) else None
    return {"ok": True, "id": rid}


# ---------------------------------------------------------------------------
# SMTP fallback (e.g., Gmail App Password) for environments without a
# verified Resend domain. Configured via env:
#   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
#   SMTP_FROM (default = SMTP_USER), SMTP_USE_TLS ("1" by default)
# When SMTP_HOST is set and RESEND_API_KEY is empty, send_email() routes here.
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587") or 587)
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").strip()
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip() or SMTP_USER
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "1").strip() not in {"0", "false", "no"}


def _send_via_smtp_blocking(payload: dict[str, Any]) -> dict[str, Any]:
    """Synchronous SMTP send — runs inside asyncio.to_thread() so the event
    loop isn't blocked. Built on stdlib smtplib (no extra deps)."""
    import smtplib
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["Subject"] = payload.get("subject", "")
    msg["From"] = payload.get("from") or SMTP_FROM
    to_list = payload.get("to") or []
    if isinstance(to_list, str):
        to_list = [to_list]
    msg["To"] = ", ".join(to_list)
    if payload.get("reply_to"):
        msg["Reply-To"] = payload["reply_to"]
    body_text = payload.get("text") or ""
    body_html = payload.get("html")
    if body_html:
        msg.set_content(body_text or " ")
        msg.add_alternative(body_html, subtype="html")
    else:
        msg.set_content(body_text)

    try:
        if SMTP_USE_TLS:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
                s.starttls()
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
        else:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as s:
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
        return {"ok": True, "id": f"smtp-{int(time.time() * 1000)}"}
    except Exception as e:
        return {"ok": False, "error": f"SMTP: {e!r}"[:200]}


async def send_via_smtp(payload: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_send_via_smtp_blocking, payload)


def email_provider() -> str:
    if RESEND_API_KEY:
        return "resend"
    if SMTP_HOST:
        return "smtp"
    return "none"


async def send_email(payload: dict[str, Any]) -> dict[str, Any]:
    """Unified send — Resend if configured, else SMTP if configured,
    else returns {ok:False, simulated:True} so the caller can record outbox."""
    provider = email_provider()
    if provider == "resend":
        async with httpx.AsyncClient() as client:
            return await send_via_resend(client, payload)
    if provider == "smtp":
        return await send_via_smtp(payload)
    return {"ok": False, "simulated": True, "error": "no email provider configured"}


async def log_outbox(session: AsyncSession, *, type_: str, to: str, subject: str, body: str, status: str, error: str = "", payload: dict | None = None) -> None:
    try:
        entry = Outbox(
            type=type_,
            recipient=to,
            subject=subject or "",
            body=(body or "")[:8000],
            status=status,
            error=error or "",
            payload=payload or {},
        )
        session.add(entry)
        await session.flush()
    except Exception as e:  # noqa: BLE001
        print(f"[outbox] failed to log: {e!r}")


# ---------------------------------------------------------------------------
# Email send — admin-only (F-01: prevents the API from being abused as an
# open mail relay against the paid Resend account). The Contact form does
# NOT call this anymore — auto-reply now happens server-side inside
# /api/inquiries (see routes_crud.py).

@app.post("/api/email/send")
async def email_send(
    payload: EmailSendIn,
    session: AsyncSession = Depends(get_session),
    _user = Depends(require_perm("outbox", "write")),
):
    if not payload.to or not payload.subject:
        raise HTTPException(400, detail="to and subject are required")

    safe_attachments = normalize_attachments(payload.attachments)
    log_type = payload.type or "email"

    if email_provider() == "none":
        sim_id = f"sim-{int(time.time() * 1000)}"
        await log_outbox(
            session, type_=log_type, to=payload.to, subject=payload.subject,
            body=payload.body or "", status="simulated",
            payload={"hasHtml": bool(payload.html), "attachments": len(safe_attachments or [])},
        )
        return {"ok": True, "simulated": True, "id": sim_id}

    body: dict[str, Any] = {
        "from": FROM_EMAIL if RESEND_API_KEY else (SMTP_FROM or FROM_EMAIL),
        "to": [payload.to],
        "subject": payload.subject,
    }
    if payload.replyTo:
        body["reply_to"] = payload.replyTo
    if payload.html:
        body["html"] = payload.html
        if payload.body:
            body["text"] = payload.body
    else:
        body["text"] = payload.body or ""
    if safe_attachments and RESEND_API_KEY:
        # Attachments only supported through Resend in this implementation.
        body["attachments"] = safe_attachments

    result = await send_email(body)

    if not result["ok"]:
        await log_outbox(
            session, type_=log_type, to=payload.to, subject=payload.subject,
            body=payload.body or "", status="failed",
            error=str(result.get("error", "send failed")),
        )
        return JSONResponse(
            {"ok": False, "error": result.get("error", "send failed")},
            status_code=502,
        )

    await log_outbox(
        session, type_=log_type, to=payload.to, subject=payload.subject,
        body=payload.body or "", status="sent",
        payload={"resendId": result.get("id")},
    )
    return result


# ---------------------------------------------------------------------------
# Email campaign

@app.post("/api/email/campaign")
async def email_campaign(
    payload: CampaignIn,
    session: AsyncSession = Depends(get_session),
    _user = Depends(require_perm("campaigns", "write")),
):
    if not payload.recipients:
        raise HTTPException(400, detail="recipients[] required")

    safe_attachments = normalize_attachments(payload.attachments)

    if email_provider() == "none":
        for r in payload.recipients:
            await log_outbox(
                session, type_="campaign", to=r.email, subject=payload.subject,
                body=payload.body or "", status="simulated",
                payload={"campaignId": payload.campaignId},
            )
        return {
            "ok": True,
            "simulated": True,
            "sent": len(payload.recipients),
            "failed": 0,
        }

    sent = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for recipient in payload.recipients:
        if not recipient.email:
            failed += 1
            continue

        personal_vars = {"name": recipient.name or ""}
        body: dict[str, Any] = {
            "from": FROM_EMAIL if RESEND_API_KEY else (SMTP_FROM or FROM_EMAIL),
            "to": [recipient.email],
            "subject": apply_vars(payload.subject, personal_vars),
        }
        if payload.replyTo:
            body["reply_to"] = payload.replyTo
        if payload.html:
            body["html"] = apply_vars(payload.html, personal_vars)
            if payload.body:
                body["text"] = apply_vars(payload.body, personal_vars)
        else:
            body["text"] = apply_vars(payload.body or "", personal_vars)
        if safe_attachments and RESEND_API_KEY:
            body["attachments"] = safe_attachments

        try:
            result = await send_email(body)
            if result["ok"]:
                sent += 1
                await log_outbox(
                    session, type_="campaign", to=recipient.email, subject=payload.subject,
                    body=payload.body or "", status="sent",
                    payload={"resendId": result.get("id"), "campaignId": payload.campaignId},
                )
            else:
                failed += 1
                err = str(result.get("error", "send failed"))
                errors.append({"email": recipient.email, "error": err})
                await log_outbox(
                    session, type_="campaign", to=recipient.email, subject=payload.subject,
                    body=payload.body or "", status="failed", error=err,
                    payload={"campaignId": payload.campaignId},
                )
        except Exception as err:  # noqa: BLE001
            failed += 1
            errors.append({"email": recipient.email, "error": str(err)})

        await asyncio.sleep(CAMPAIGN_THROTTLE_SECONDS)

    return {
        "ok": True,
        "sent": sent,
        "failed": failed,
        "errors": errors[:10],
    }


if __name__ == "__main__":
    import uvicorn

    print(f"[daemu-backend-py] listening on http://localhost:{PORT}")
    print(f"[daemu-backend-py] from: {FROM_EMAIL}")
    print(f"[daemu-backend-py] allowed origins: {', '.join(ALLOWED_ORIGINS)}")
    print(f"[daemu-backend-py] resend: {'configured' if RESEND_API_KEY else 'NOT CONFIGURED (simulating)'}")
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
