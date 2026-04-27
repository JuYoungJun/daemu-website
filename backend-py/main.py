"""DAEMU backend — FastAPI port of the original Express service.

Endpoints (same contract as backend/server.js so the frontend doesn't change):
    GET  /api/health
    POST /api/upload          -> save base64 image, return public URL
    POST /api/email/send      -> single email via Resend REST
    POST /api/email/campaign  -> bulk email with throttle
    GET  /uploads/{name}      -> public static serve

Run locally:
    uvicorn main:app --reload --port 3000
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

PORT = int(os.environ.get("PORT", "3000"))
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
FROM_EMAIL = os.environ.get("FROM_EMAIL", "DAEMU <onboarding@resend.dev>")
PUBLIC_BASE = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:8765,http://localhost:5173",
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
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}

if not RESEND_API_KEY:
    print("[daemu-backend-py] RESEND_API_KEY not set — emails will be simulated.")


app = FastAPI(title="DAEMU API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=None,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=600,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_req: Request, exc: Exception):
    print(f"[daemu-backend-py] unhandled: {exc!r}")
    return JSONResponse({"ok": False, "error": "internal"}, status_code=500)


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
# Models

class UploadIn(BaseModel):
    filename: str
    content: str  # base64
    contentType: str | None = None


class Attachment(BaseModel):
    filename: str
    content: str  # base64
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
# Routes

@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "runtime": "python-fastapi",
        "resendConfigured": bool(RESEND_API_KEY),
        "from": FROM_EMAIL,
        "allowedOrigins": ALLOWED_ORIGINS,
        "uploadEndpoint": "/api/upload",
        "publicBase": PUBLIC_BASE or "(auto from request host)",
    }


# Static uploads (cache 7 days, immutable)
class CachedStatic(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=604800, immutable"
        return response


app.mount("/uploads", CachedStatic(directory=str(UPLOAD_DIR)), name="uploads")


@app.post("/api/upload")
async def upload(payload: UploadIn, request: Request):
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

    file_id = format(int(time.time() * 1000), "x") + "-" + secrets.token_hex(4)
    final_name = f"{file_id}{ext}"
    final_path = UPLOAD_DIR / final_name
    # Final guard against path traversal — resolved path must stay under UPLOAD_DIR
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
            # Triple-name to maximize Resend compatibility across versions.
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


@app.post("/api/email/send")
async def email_send(payload: EmailSendIn):
    if not payload.to or not payload.subject:
        raise HTTPException(400, detail="to and subject are required")

    safe_attachments = normalize_attachments(payload.attachments)

    if not RESEND_API_KEY:
        print(f"[email/send simulated] to={payload.to} subject={payload.subject!r} html={bool(payload.html)} att={len(safe_attachments or [])}")
        return {"ok": True, "simulated": True, "id": f"sim-{int(time.time() * 1000)}"}

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
        return JSONResponse(
            {"ok": False, "error": result.get("error", "send failed")},
            status_code=502,
        )
    return result


@app.post("/api/email/campaign")
async def email_campaign(payload: CampaignIn):
    if not payload.recipients:
        raise HTTPException(400, detail="recipients[] required")

    safe_attachments = normalize_attachments(payload.attachments)

    if not RESEND_API_KEY:
        print(f"[email/campaign simulated] count={len(payload.recipients)} subject={payload.subject!r}")
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
                else:
                    failed += 1
                    errors.append({"email": recipient.email, "error": result.get("error", "send failed")})
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
