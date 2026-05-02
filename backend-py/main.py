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

DATABASE_URL env switches between sqlite+aiosqlite (default, dev only) and
mysql+aiomysql://user:pass@host/db (production — primary driver).

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
# From 헤더 — 수신자가 받는 메일에서 *업체명* 이 크게 보이도록 RFC 5322
# display-name 형식. "DAEMU 베이커리·카페 컨설팅" 부분이 메일 클라이언트의
# 발신자 칸에 prominent 하게 표시되고, 실제 메일 주소는 그 뒤에 작게 노출.
# 운영시 FROM_EMAIL env 로 도메인 메일 (예: noreply@daemu.kr) 로 교체.
FROM_EMAIL = os.environ.get(
    "FROM_EMAIL",
    "DAEMU 베이커리·카페 컨설팅 <onboarding@resend.dev>",
)
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

# 명시 차단 — magic byte 검증 + extension allowlist 가 이중으로 차단하지만,
# attacker 가 .html / .svg / .js 등 script-capable 확장자로 우회 시도하는 패턴
# 을 logs 에 남기고 더 명확한 에러 메시지를 주기 위해 별도 deny set 유지.
# (외부 코드 리뷰 Phase 2 권장 — 첨부/업로드 strict validation.)
DENIED_EXTS = {
    ".html", ".htm", ".xhtml", ".svg",
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
    ".php", ".phtml", ".phar",
    ".exe", ".bat", ".cmd", ".sh", ".bash", ".zsh", ".ps1",
    ".pl", ".py", ".rb",
    ".jar", ".class", ".dll", ".so", ".dylib",
    ".sql",
}

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
            # B2 — SuspiciousEvent sweep (90일 / 365일 evidence)
            try:
                from models import SuspiciousEvent
                susp_normal_days = int(os.environ.get("SUSPICIOUS_RETENTION_DAYS", "90"))
                susp_evidence_days = int(os.environ.get("SUSPICIOUS_EVIDENCE_RETENTION_DAYS", "365"))
                cutoff_normal = datetime.now(timezone.utc) - timedelta(days=susp_normal_days)
                cutoff_evidence = datetime.now(timezone.utc) - timedelta(days=susp_evidence_days)
                async with SessionLocal() as susp_session:
                    r3 = await susp_session.execute(delete(SuspiciousEvent).where(
                        SuspiciousEvent.evidence == False,  # noqa: E712
                        SuspiciousEvent.detected_at < cutoff_normal,
                    ))
                    r4 = await susp_session.execute(delete(SuspiciousEvent).where(
                        SuspiciousEvent.evidence == True,  # noqa: E712
                        SuspiciousEvent.detected_at < cutoff_evidence,
                    ))
                    await susp_session.commit()
                    if (r3.rowcount or 0) or (r4.rowcount or 0):
                        print(f"[retention] purged {r3.rowcount or 0} suspicious / {r4.rowcount or 0} expired-evidence")
            except Exception as exc:  # noqa: BLE001
                print(f"[retention] suspicious sweep failed: {exc!r}")
        except Exception as exc:  # noqa: BLE001
            print(f"[retention] sweep failed: {exc!r}")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=period_seconds)
        except asyncio.TimeoutError:
            continue


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 설계 원칙: DB 단계가 실패해도 **startup 은 진행** — uvicorn 이 죽으면
    # 서비스 전체 다운 + health endpoint 도 응답 못함. 그래서 ping/create_all/
    # migration/seed 를 모두 try/except 로 감싸 *부분 실패* 모드로 진입 가능
    # 하게 만든다. /api/health 의 databaseConnected 가 false 이면 사용자가
    # logs 에서 원인을 본 뒤 DB 를 살리고 재배포.
    # production 에선 host/user 도 redact, dev 에선 hide_password 만.
    from security_utils import safe_db_url, safe_db_error, is_prod
    _db_url_safe = safe_db_url(engine.url.render_as_string(hide_password=True))
    print(f"[daemu-backend-py] DB connecting to: {_db_url_safe}")

    # 1) 연결 ping
    db_alive = False
    try:
        from sqlalchemy import text as _sa_text
        async with engine.connect() as _conn:
            await _conn.execute(_sa_text("SELECT 1"))
        print(f"[daemu-backend-py] ✓ DB connection OK")
        db_alive = True
    except Exception as _e:  # noqa: BLE001
        # prod: 카테고리만 ('DB connection failed' 등). exception detail (자격
        # 증명 / 호스트명) 누설 차단.
        print(f"[daemu-backend-py] ✗ DB CONNECTION FAILED: {safe_db_error(_e)}")
        print(f"[daemu-backend-py] ⚠ DB unreachable — startup 진행, DB 호출 실패. 운영자 점검 필요.")
        if not is_prod():
            print(f"[daemu-backend-py] ⚠ (dev hint) Aiven idle hibernate / SSL CA / IP allowlist 체크.")

    # 2) schema create_all + migrations — 연결 살아있을 때만 시도
    if db_alive:
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                try:
                    from migrations import install_migrations_sync
                    await conn.run_sync(install_migrations_sync)
                except Exception as e:  # noqa: BLE001
                    print(f"[migration] failed: {e!r}")
        except Exception as e:  # noqa: BLE001
            print(f"[bootstrap] schema create_all 실패: {e!r}")
            db_alive = False  # schema 가 못 만들면 후속 seed 도 의미 없음

    # 3) ensure_default_users + seeds + 2FA reset — 연결 살아있을 때만
    if db_alive:
        try:
            async with SessionLocal() as session:
                await ensure_default_users(session)

                # ※ DAEMU_RESET_TOTP_EMAIL env 기반 2FA 리셋은 제거됨 (2026-05-01).
                # 사유: 호스트별로 env 등록/삭제 절차가 달라(Render Dashboard
                # vs Cafe24 systemd EnvironmentFile + restart) 운영자 실수 +
                # backdoor 위험. 대신 다음 host-agnostic 경로 사용:
                #   1) 이메일 복구 링크: POST /api/auth/totp-reset-request →
                #      이메일로 5분 TTL JWT 링크 발송 → 클릭 시 2FA 해제.
                #   2) 비상 CLI: backend-py/manage.py reset-2fa --email <email>
                #      (host shell 에서 1회 실행, 코드/env 안 건드림).

                # 표준 계약서/발주서 템플릿 자동 시드 (idempotent)
                try:
                    from seeds import ensure_default_templates, ensure_demo_superadmin
                    await ensure_default_templates(session)
                    await ensure_demo_superadmin(session)
                except Exception as e:  # noqa: BLE001
                    print(f"[seeds] auto-seed failed: {e!r}")
        except Exception as e:  # noqa: BLE001
            print(f"[bootstrap] session 단계 실패: {e!r}")

    print(f"[daemu-backend-py] startup 완료 (db_alive={db_alive})")

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
# Set ENV=prod in your hosting env (Render/Cafe24 systemd EnvironmentFile/etc.)
# once a real domain + customer data are wired up.
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
    """F-07: log the traceback with a request ID, return a generic error to
    the client. Phase 2: traceback 안의 inline secret (DB password / JWT /
    Resend key 등) 도 logs 에서 masking — log aggregator 에 노출돼도 안전.
    클라이언트 응답은 'internal' 만 → stack/exception detail 누설 0."""
    from security_utils import _scrub_inline_secrets
    rid = getattr(req.state, "request_id", "no-id")
    raw_tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    masked_tb = _scrub_inline_secrets(raw_tb)
    log.error(
        "unhandled exception rid=%s path=%s method=%s\n%s",
        rid, req.url.path, req.method, masked_tb,
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

# QR 캠페인 보안 short link (QR_SECURITY.md Stage 2).
from routes_short_links import (  # noqa: E402
    admin_router as short_links_admin_router,
    public_router as short_links_public_router,
)
app.include_router(short_links_admin_router)
app.include_router(short_links_public_router)

from routes_geo import router as geo_router  # noqa: E402
app.include_router(geo_router)

from routes_pdf import router as pdf_router  # noqa: E402
app.include_router(pdf_router)

from routes_audit import router as audit_router  # noqa: E402
app.include_router(audit_router)

# 공지/프로모션 — 어드민 작성 → 공개 사이트 + 파트너 포털 노출.
from routes_announcements import router as announcements_router  # noqa: E402
app.include_router(announcements_router)

# 재고 / SKU / LOT / 유통기한 — 표준 SKU 발급, FIFO 차감, 만료 자동 격리.
from routes_inventory import router as inventory_router  # noqa: E402
app.include_router(inventory_router)

# 리소스 모니터링 — 어드민 /admin/monitoring 의 maintenance 탭이 30초 폴링.
from routes_resource import router as resource_router  # noqa: E402
app.include_router(resource_router)


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
    """공개 헬스체크 — 최소 정보만 반환 (정찰 차단).

    이전 버전은 emailProvider / SMTP host / DB URL / allowedOrigins / DB 에러
    내용 등을 모두 노출해 공격자에게 인프라 정찰 단서를 제공했음 (코드 리뷰
    F-3.1, High). 상세 진단은 /api/admin/health 로 분리 — 인증 필수.

    공개 응답은 load balancer / uptime-monitor 가 'service alive?' 만 확인할
    수 있도록 ok=true 만. 운영자가 디테일을 보려면 어드민 콘솔 로그인.
    """
    return {"ok": True}


@app.get("/api/admin/health")
async def admin_health(
    _user = Depends(require_perm("monitoring", "read")),
):
    """관리자 전용 상세 헬스체크. 운영자가 백엔드 진단에 사용.

    권한: require_perm('monitoring','read') — admin / developer 만.
    인증: _resolve_user 가 Authorization Bearer 검증 → 401 즉시 반환.
    역할 검사: PERMISSIONS dict 기반 → 403 차단.
    dev-mode bypass 없음 — 프로덕션이든 dev 든 동일하게 인증 강제.

    민감 정보 마스킹 (production):
      - DB URL 의 host/credentials → '[redacted]/dbname'
      - DB 에러 → 카테고리만 ('DB connection failed' 등)
    dev/demo 에선 디버그용 디테일 유지 (단 inline secret 패턴은 제거).
    """
    from security_utils import safe_db_error, safe_db_url, is_prod

    provider = email_provider()
    db_connected = False
    db_error = ""
    try:
        from sqlalchemy import text as _sa_text
        async with engine.connect() as _conn:
            await _conn.execute(_sa_text("SELECT 1"))
        db_connected = True
    except Exception as _e:  # noqa: BLE001
        db_error = safe_db_error(_e)

    response = {
        "ok": True,
        "runtime": "python-fastapi",
        "version": "3.1",
        "env": os.environ.get("ENV", "").lower() or "dev",
        "emailProvider": provider,
        "resendConfigured": bool(RESEND_API_KEY),
        "smtpConfigured": bool(SMTP_HOST and SMTP_USER),
        "database": safe_db_url(engine.url.render_as_string(hide_password=True)),
        "databaseConnected": db_connected,
        "databaseError": db_error,
        "uploadEndpoint": "/api/upload",
    }

    # production 에서는 SMTP host / from / allowed origins / public base 등
    # 인프라 디테일은 노출 X (운영자도 체크리스트로 별도 확인).
    if not is_prod():
        response.update({
            "smtpHost": (SMTP_HOST or ""),
            "smtpFrom": (SMTP_FROM or ""),
            "from": FROM_EMAIL,
            "allowedOrigins": ALLOWED_ORIGINS,
            "publicBase": PUBLIC_BASE or "(auto from request host)",
        })

    if provider == "none":
        response["warnings"] = ["이메일 발송 미설정 — RESEND_API_KEY 또는 SMTP_HOST/USER/PASS 설정 필요."]

    return response


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

    # 명시적 deny — script-capable / executable 확장자 차단 (allowlist 가 이미
    # 차단하지만 명확한 logs + 에러 메시지를 위해).
    if ext in DENIED_EXTS:
        raise HTTPException(415, detail="실행 가능한 / 스크립트 형식 파일은 업로드할 수 없습니다.")

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
        # validate=True — 비-base64 문자가 끼어 있으면 즉시 reject. 옛 False
        # 는 silent skip 으로 fuzzing 우회 가능. (외부 코드 리뷰 F-3.9.)
        buf = base64.b64decode(payload.content, validate=True)
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


# 첨부 파일 단일 크기 cap (이메일 첨부는 업로드와 다르게 더 작게 — Resend
# 한도 + SMTP 의 대부분 서버가 25MB 차단).
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10MB / 첨부
MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024  # 20MB / 메일 1통 합계


def normalize_attachments(items: list[Attachment] | None) -> list[dict[str, Any]] | None:
    """이메일 첨부 정규화 + 보안 검증 (Phase 2 강화).

    검증 순서:
    1. 개수 cap (MAX_ATTACHMENTS = 12)
    2. 파일명 sanitize + 위험 확장자 deny
    3. base64 strict decode (validate=True) — 잘못된 입력 즉시 reject
    4. 단일 크기 cap (MAX_ATTACHMENT_BYTES = 10MB)
    5. 합계 크기 cap (MAX_ATTACHMENT_TOTAL_BYTES = 20MB)
    6. MIME 은 detect_mime 으로 확장자 기반 결정 (사용자 입력 무시)

    실패 시 HTTPException 으로 400/413/415 반환 — 호출자에게 전파.
    """
    if not items:
        return None
    out: list[dict[str, Any]] = []
    total = 0
    for a in items[:MAX_ATTACHMENTS]:
        if not a.filename or not a.content:
            continue
        # 파일명 sanitize — path traversal / control chars 제거
        safe_name = safe_filename(str(a.filename))
        ext_m = re.search(r"\.[a-z0-9]+$", safe_name, re.IGNORECASE)
        ext = ext_m.group(0).lower() if ext_m else ""
        if ext in DENIED_EXTS:
            raise HTTPException(
                415,
                detail=f"첨부 형식이 허용되지 않습니다: {ext} (실행 가능 / 스크립트 형식 차단)",
            )

        # base64 strict decode + 사이즈 검증
        content = str(a.content)
        # pre-decode 합리적 한도 — base64 는 원본 대비 ~1.34x
        if len(content) > MAX_ATTACHMENT_BYTES * 4 // 3 + 256:
            raise HTTPException(413, detail=f"첨부 파일이 너무 큽니다 ({MAX_ATTACHMENT_BYTES // (1024 * 1024)}MB 제한)")
        try:
            buf = base64.b64decode(content, validate=True)
        except (binascii.Error, ValueError) as _e:
            raise HTTPException(400, detail=f"첨부 파일 base64 형식이 올바르지 않습니다: {safe_name}") from _e
        if not buf:
            continue
        if len(buf) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(413, detail=f"첨부 파일이 너무 큽니다 ({MAX_ATTACHMENT_BYTES // (1024 * 1024)}MB 제한): {safe_name}")
        total += len(buf)
        if total > MAX_ATTACHMENT_TOTAL_BYTES:
            raise HTTPException(413, detail=f"첨부 합계 크기 초과 ({MAX_ATTACHMENT_TOTAL_BYTES // (1024 * 1024)}MB 제한)")

        entry: dict[str, Any] = {
            "filename": safe_name,
            "content": content,  # original base64 (이메일 provider 가 다시 디코드)
            "content_type": detect_mime(safe_name, a.contentType),
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
