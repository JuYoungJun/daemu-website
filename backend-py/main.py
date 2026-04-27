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

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_ATTACHMENTS = 12
CAMPAIGN_THROTTLE_SECONDS = 0.25

EXT_TO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

# F-06: only allow raster image formats. Block SVG (active script container)
# and PDF (JS-capable). Each whitelisted extension is paired with a magic
# byte signature so a renamed payload (`evil.exe` → `evil.png`) is rejected.
UPLOAD_MAGIC: dict[str, list[bytes]] = {
    ".jpg":  [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png":  [b"\x89PNG\r\n\x1a\n"],
    ".gif":  [b"GIF87a", b"GIF89a"],
    ".webp": [b"RIFF"],  # also requires "WEBP" at offset 8 — checked below
}


def magic_byte_ok(buf: bytes, ext: str) -> bool:
    sigs = UPLOAD_MAGIC.get(ext.lower())
    if not sigs:
        return False
    if not any(buf.startswith(s) for s in sigs):
        return False
    if ext.lower() == ".webp":
        return len(buf) >= 12 and buf[8:12] == b"WEBP"
    return True

if not RESEND_API_KEY:
    print("[daemu-backend-py] RESEND_API_KEY not set — emails will be simulated.")


# ---------------------------------------------------------------------------
# Lifespan: create tables + seed default admin

async def _retention_cron(stop_event: asyncio.Event) -> None:
    """N2-06 / N2-17 / PIPA §21 fix: periodically delete personal data past
    the retention window declared in /privacy.

    - inquiries older than INQUIRY_RETENTION_DAYS (default 1095 = 3y)
    - outbox older than OUTBOX_RETENTION_DAYS (default 365 = 1y)

    Runs every 6h. First sweep happens 5 minutes after boot so cold-starts
    don't fire it instantly under load."""
    from datetime import timedelta
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
    async with SessionLocal() as session:
        await ensure_default_users(session)
    print(f"[daemu-backend-py] DB ready ({engine.url.render_as_string(hide_password=True)})")

    # Background retention task — PIPA §21 compliance.
    stop_event = asyncio.Event()
    cron_task = asyncio.create_task(_retention_cron(stop_event))
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
    version="3.1",
    lifespan=lifespan,
    docs_url=None if PROD else "/docs",
    redoc_url=None if PROD else "/redoc",
    openapi_url=None if PROD else "/openapi.json",
)

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

@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "runtime": "python-fastapi",
        "version": "3.0",
        "resendConfigured": bool(RESEND_API_KEY),
        "database": engine.url.render_as_string(hide_password=True),
        "from": FROM_EMAIL,
        "allowedOrigins": ALLOWED_ORIGINS,
        "uploadEndpoint": "/api/upload",
        "publicBase": PUBLIC_BASE or "(auto from request host)",
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
    """Image upload — restricted to admin/developer roles. Public Contact form
    no longer needs uploads; auto-reply attachments are server-managed."""
    # N2-05 DoS fix: reject pre-decode if the base64 string itself is
    # already larger than the post-decode cap by a comfortable margin.
    # base64 expands by ~4/3, so cap the input at ~12 MB (8 MB output max).
    if len(payload.content) > MAX_UPLOAD_BYTES * 4 // 3 + 256:
        raise HTTPException(413, detail="file too large (8MB cap)")
    if not payload.filename or not payload.content:
        raise HTTPException(400, detail="filename + content required")

    safe = safe_filename(payload.filename)
    ext_match = re.search(r"\.[a-z0-9]+$", safe, re.IGNORECASE)
    ext = ext_match.group(0).lower() if ext_match else ".bin"

    try:
        buf = base64.b64decode(payload.content, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(400, detail="invalid base64 content") from None

    if len(buf) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, detail="file too large (8MB cap)")
    if not buf:
        raise HTTPException(400, detail="empty file")

    if ext.lower() not in UPLOAD_MAGIC:
        raise HTTPException(415, detail="이미지 파일(.jpg, .png, .gif, .webp)만 업로드할 수 있습니다.")
    if not magic_byte_ok(buf, ext):
        raise HTTPException(415, detail="파일 내용이 이미지 형식과 일치하지 않습니다.")

    file_id = format(int(time.time() * 1000), "x") + "-" + secrets.token_hex(4)
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

    if not RESEND_API_KEY:
        sim_id = f"sim-{int(time.time() * 1000)}"
        await log_outbox(
            session, type_=log_type, to=payload.to, subject=payload.subject,
            body=payload.body or "", status="simulated",
            payload={"hasHtml": bool(payload.html), "attachments": len(safe_attachments or [])},
        )
        return {"ok": True, "simulated": True, "id": sim_id}

    body: dict[str, Any] = {
        "from": FROM_EMAIL,
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
    if safe_attachments:
        body["attachments"] = safe_attachments

    async with httpx.AsyncClient() as client:
        result = await send_via_resend(client, body)

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

    if not RESEND_API_KEY:
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

    async with httpx.AsyncClient() as client:
        for recipient in payload.recipients:
            if not recipient.email:
                failed += 1
                continue

            personal_vars = {"name": recipient.name or ""}
            body: dict[str, Any] = {
                "from": FROM_EMAIL,
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
            if safe_attachments:
                body["attachments"] = safe_attachments

            try:
                result = await send_via_resend(client, body)
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
