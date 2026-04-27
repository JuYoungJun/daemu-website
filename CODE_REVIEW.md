# DAEMU Website — Engineering Review

_Reviewer: senior staff engineer / acting CTO_
_Scope: architecture, maintainability, performance, DX, accessibility, SEO, observability, tests, i18n, DB ops_
_Out of scope: security (covered separately by `SECURITY_AUDIT.md`)_
_Date: 2026-04-27_

## Executive summary

This is an unusually polished demo. The visual layer, the splash/popup orchestration, and the role-based admin scaffolding all show real care. Two engineering decisions, however, will start hurting as soon as the project moves past "demo on Render free tier" toward paying customers: (1) twelve admin pages are still implemented as legacy IIFEs (`public/admin-*-page.js`, ~2,150 LOC) that mutate `window.*`, render via `innerHTML`, and bind via inline `onclick=` handlers — they are wrapped in a thin React shell (`RawPage`/`useExternalScript`) that fetches the script as text, rewrites paths, and `document.body.appendChild`s a `<script>` tag, which is a working but very fragile bridge that bypasses React's lifecycle entirely; and (2) the data layer is split between a real FastAPI backend and a parallel `localStorage` "DB" (`src/lib/db.js`) that every admin and the public Contact form _both_ write to, with merge logic only in `AdminInquiries.jsx`. This dual-write pattern means "the admin saw a record disappear" is a real bug class. The frontend has zero tests, no linting, no TypeScript, no error reporting, no structured logging, and no SEO metadata beyond a single static `<title>`. The backend is small, readable, and mostly correct, but `dict[str, Any]` create/update payloads in the generic CRUD factory (`backend-py/routes_crud.py:357-383`) means any field validation lives only in the allowlist set — fine while you control the admin UI, painful the first time someone POSTs `{"created_at": "1970-01-01"}`. None of this is unsalvageable; the work to harden it is bounded. **The team's posture is "we built it fast and it works"; the next phase is "make it survive the second developer."**

---

## Findings

| ID | Severity | Title | Where | Effort |
|---|---|---|---|---|
| F-01 | Critical | Public Footer links bypass React Router and rely on the global LinkInterceptor | `src/components/Footer.jsx:24-31, 51` | S |
| F-02 | Critical | Frontend dual-writes to `localStorage` "DB" and the FastAPI backend; merge is incomplete | `src/pages/Contact.jsx:64`, `src/lib/consultForms.js:73-76`, `src/admin/AdminInquiries.jsx:30-36` | M |
| F-03 | Critical | Admin pages mix React state with legacy `window.*` IIFE state; no clean teardown | `src/components/RawPage.jsx`, `src/hooks/useExternalScript.js`, `src/lib/globals.js`, `public/admin-*-page.js` | L |
| F-04 | Critical | No tests anywhere; critical paths (Contact submit, login, role gate, popup overlay) can break silently | repo-wide | L |
| F-05 | High | Bundle ships `browser-image-compression` to every public visitor | `src/lib/imageOptim.js:10`, `dist/assets/index-C39UX7Hv.js` (479 KB) | S |
| F-06 | High | No lint, no formatter, no type checker, no pre-commit hook | `package.json:18-21`, `.github/workflows/ci.yml` | S |
| F-07 | High | FastAPI generic exception handler swallows error detail | `backend-py/main.py:183-186` | S |
| F-08 | High | Generic CRUD accepts `dict[str, Any]` body — no Pydantic validation | `backend-py/routes_crud.py:357-383` | M |
| F-09 | High | No DB migrations — `Base.metadata.create_all` only adds new tables; column type/constraint changes go un-applied | `backend-py/db.py:6-9`, `backend-py/main.py:120-124` | M |
| F-10 | High | SEO is a wasteland — single static `<title>`, no per-route metadata, no OG tags, no sitemap, no robots.txt | `index.html:6-7`, `src/App.jsx`, `public/` | S |
| F-11 | High | `useFadeUp` only observes elements present at first render; pages with content rendered later (raw-page scripts, async lists) miss the trigger | `src/hooks/useFadeUp.js:5-19` | S |
| F-12 | High | No error boundary below `<App>` — one bad raw-page script tears down the whole tree | `src/App.jsx:127-170`, `src/components/ErrorBoundary.jsx` | S |
| F-13 | High | No structured logging, no error reporting (Sentry/etc.), no request IDs in FastAPI | repo-wide | M |
| F-14 | High | Korean strings are inlined in JSX; no i18n layer means English version requires touching ~70 files | `src/pages/*`, `src/components/*`, all admin pages | L |
| F-15 | Medium | `splash-pending` body class hides admin/error pages on initial paint without the `useLayoutEffect` workaround in `App.jsx:97-118` — fragile | `src/App.jsx:97-118`, `src/main.jsx:13-19` | M |
| F-16 | Medium | `JSON.parse(localStorage.getItem(...))` without try/catch in two places | `src/admin/AdminOutbox.jsx:105` (has try), `src/hooks/useSitePopups.js:89` (no try in caller chain — actually wrapped in try, OK), `src/hooks/useSitePopups.js:88-95` ✓ — **but** `useSitePopups.js:24` calls `DB.get('popups')` which catches; `useSitePopups.js:89` is wrapped. Real offenders: `public/admin-content-page.js:4` — runs on script load, no try | `public/admin-content-page.js:4` | S |
| F-17 | Medium | `consultForms.js` global submit handler and `Contact.jsx` React form duplicate validation, PIPA consent UI, and email-fallback logic | `src/lib/consultForms.js:14-115`, `src/pages/Contact.jsx:35-110` | M |
| F-18 | Medium | `useEffect` dependency arrays disabled or incomplete in 3 hooks | `src/hooks/useFadeUp.js:18`, `src/hooks/useExternalScript.js:48`, `src/admin/AdminUsers.jsx:39` | S |
| F-19 | Medium | No `useMemo`/`useCallback` in dashboard render path; `AdminGate` recomputes `DB.get('inquiries').filter(...)` every render | `src/admin/AdminGate.jsx:115-122` | S |
| F-20 | Medium | Permission map duplicated between `auth.py:100-113` and `AdminGate.jsx:126-141` with a comment "keep in sync" — drift is a matter of when, not if | `backend-py/auth.py:100-113`, `src/admin/AdminGate.jsx:126-141` | M |
| F-21 | Medium | `ScrollToTop` resets to (0,0) on _every_ pathname change including `/work/:slug` → back-button users lose position | `src/App.jsx:71-75` | S |
| F-22 | Medium | `partnerAuth.js` stores plaintext passwords in `localStorage` and does login client-side | `src/lib/partnerAuth.js:17-67` | M (deferred — flagged as security; called out here for architecture only: it's a parallel auth system unrelated to the JWT one) |
| F-23 | Medium | Splash duration (3000 ms initial / 2600 ms transition) blocks first interaction on every navigation | `src/hooks/useSplash.js:25-34` | S |
| F-24 | Medium | `unhandled_exception_handler` uses `print()` not a logger; no traceback emitted | `backend-py/main.py:184-186` | S |
| F-25 | Medium | Footer has a `<Link to="/privacy">` but everything else uses `<a href="*.html">` — inconsistency | `src/components/Footer.jsx:24-51` | S |
| F-26 | Medium | `RateLimiter._hits` and `_LoginThrottle._fails` are unbounded dicts — leak across keys forever | `backend-py/routes_crud.py:56-71`, `backend-py/auth.py:46-65` | S |
| F-27 | Medium | JSON columns mix `list \| dict \| None` typing — MySQL JSON sorts/indexes differently than SQLite TEXT | `backend-py/models.py:101, 121, 122, 142, 159, 193, 207, 208, 239` | M |
| F-28 | Medium | No accessibility for popup overlay: no `role="dialog"`, no focus trap, no ESC handler, decorative `alt=""` on hero image is OK but content image alts like `alt="bakery project"` are weak | `src/hooks/useSitePopups.js:54-85`, `src/pages/Home.jsx:144,162,174,186` | M |
| F-29 | Medium | `<form data-consult-form>` submission uses `window.alert()` for both success and validation errors — no inline ARIA-live announcements for screen readers | `src/lib/consultForms.js:48-104` | S |
| F-30 | Low | `nextId()` in `db.js` resets on page reload — collisions possible across tabs | `src/lib/db.js:2-7` | S |
| F-31 | Low | `useExternalScript` script cache is never invalidated even on hot reload during dev | `src/hooks/useExternalScript.js:4` | S |
| F-32 | Low | `console.log` in production: 4 sites in frontend + ~6 `print()` in Python | `src/`, `public/`, `backend-py/main.py` | S |
| F-33 | Low | Vite config has zero optimizations (manualChunks, sourcemap policy, asset inlining threshold) | `vite.config.js` | S |
| F-34 | Low | `index.html` loads GSAP from cdnjs — single point of failure, no SRI | `index.html:18-19` | S |
| F-35 | Low | `EXPORTS` table inside `AdminShell.jsx` is 130 lines of CSV column definitions that belong in a registry per page | `src/components/AdminShell.jsx:8-138` | S |
| F-36 | Low | `package.json:1` declares `"version": "1.0.0"` with no release process | `package.json:4` | S |
| F-37 | Info | `.idea/` and `_backup-static-2026-04-27/` committed | `.gitignore`, repo root | S |

---

## Critical / High recommendations (concrete fixes)

### F-01 — Footer hardcodes `*.html` hrefs

`src/components/Footer.jsx:24-31` and `:51` use `<a href="service.html">` etc. They _work_ today only because `LinkInterceptor.jsx:39-57` intercepts every click in the document and re-routes via `navigate()`. But:

- Search engines and link previews (Slack, KakaoTalk) follow the literal href, not the click handler.
- Right-click → "Copy link" gives users a broken `https://daemu.kr/service.html`.
- Middle-click / Cmd-click bypass the listener (the code only `e.preventDefault()`s — it doesn't intercept `auxclick`).

Fix: replace every `<a href="*.html">` with `<Link to="/path">`. The `LinkInterceptor` should remain only as a safety net for raw-page HTML strings (where you can't easily use Router primitives).

```jsx
<li><Link to="/service">SERVICE</Link></li>
<li><Link to="/about">ABOUT US</Link></li>
// ...etc
```

### F-02 — Dual-write between localStorage DB and backend

`Contact.jsx:64` calls `DB.add('inquiries', inquiry)` _and then_ `api.post('/api/inquiries', ...)`. `consultForms.js:73-76` does the same. Result: the local row gets a client-generated `id`, the server returns a different one, and only `AdminInquiries.jsx:30-36` ever merges them — and only by listing local rows that happen to have no `serverId`. If the backend POST succeeds but `AdminInquiries` was never opened, the local row stays as a phantom forever and gets exported in CSVs.

Fix: make backend the source of truth when configured, fall back to local _only_ when `!api.isConfigured()`. One code path, not two:

```js
// Contact.jsx
if (api.isConfigured()) {
  const r = await api.post('/api/inquiries', {...});
  // do NOT call DB.add — let admin pages re-fetch from server.
} else {
  DB.add('inquiries', inquiry); // demo only
}
```

Then `AdminInquiries.jsx` should always fetch from backend on mount and only fall back to `DB.get('inquiries')` if `!api.isConfigured()`. Drop the `srv-${id}` prefix gymnastics.

### F-03 — Legacy IIFE bridge is the single biggest maintenance liability

`useExternalScript.js` fetches `/admin-inquiries-page.js` as text, runs it through `fixAssetPaths`, and injects it as a `<script>` tag into `<body>`. The script lives in IIFE scope, captures `document.getElementById(...)` references, and binds inline `onclick="updateStatus(123,'신규')"` handlers (see `public/admin-inquiries-page.js:34-40`). When the user navigates away, React unmounts the wrapper, but the `<script>` tag was appended to `body`, not `#root`, so `useEffect`'s cleanup `scriptEl.remove()` fires while the tag's globals are still bound. Stale event handlers reference DOM nodes that no longer exist; clicking a select after re-mount calls `updateStatus` which references a `KEY` from the new IIFE — works by accident.

Bigger issue: `globals.js` shoves `DB`, `Auth`, `escHtml`, `escUrl`, `sendAutoReply`, `uploadImage`, etc. onto `window` because the raw scripts assume those are global. Twelve admin pages reach into `window.*`. There is no reasonable refactor short of porting each one to a real React component.

Concrete plan (do this in order, not all at once):
1. **First pass — make the bridge safer**: in `useExternalScript`, scope the IIFE inside a uniquely-named container so global state doesn't leak. Or wrap each script's body: `(function(host){ ...IIFE... }).call(window.__daemuPageHost = {...})`. This buys you isolation without a rewrite.
2. **Second pass — port high-churn pages first**: `admin-inquiries`, `admin-mail`, `admin-popup` change most often (per git log). Port them to React + use `api.get/post` directly. Delete the corresponding `public/*.js` and `raw/*.html.js`.
3. **Third pass — eliminate `globals.js`**: once no raw page reads `window.DB`, delete the file.

Estimate: 2 days per page → ~3 weeks for all twelve. Realistic only if it becomes a quarterly priority.

### F-04 — Zero tests

Critical paths that can break silently and cost real money:

| Path | Failure mode | Test priority |
|---|---|---|
| `POST /api/inquiries` happy path | inquiry lost, customer ghosted | **P0** — write today |
| `POST /api/inquiries` rate limiter | DDoS via the public form, Resend quota burned | P0 |
| Auto-reply email send | customer thinks no one's listening | P0 |
| Admin login + JWT refresh | nobody can manage incoming leads | P0 |
| Role-based permission check | `tester` deletes a customer | P0 |
| Image upload magic-byte validation | someone uploads an `.svg` payload | P1 (security agent) |
| Popup frequency rules | popup shows every page load forever | P1 |
| Contact PIPA consent gate | regulator complaint | P1 |

Recommended: pytest + httpx for the backend (5 files, ~200 lines for the P0 list above). Vitest + React Testing Library for the frontend Contact and AdminGate flows. Don't try to test the legacy IIFE pages — that's the porting carrot.

### F-05 — `browser-image-compression` in the public bundle

`src/lib/imageOptim.js` is imported by `src/lib/upload.js`, which is imported by `src/lib/globals.js` (line 5) — and `globals.js` is imported by `main.jsx:4` for its side effect of decorating `window`. So every visitor to `/` downloads ~140 KB of image-compression code they will never use. Fix:

```js
// upload.js
export async function uploadImage(rawFile) {
  const { optimizeImage } = await import('./imageOptim.js');
  const file = await optimizeImage(rawFile);
  // ...
}
```

Also remove the `window.uploadImage` wiring from `globals.js` and import `uploadImage` directly in the admin pages that actually need it. After this, the public bundle should drop to ~290 KB raw / ~90 KB gzipped.

### F-06 — DX baseline missing

The smallest set with the highest payoff:

1. `eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`. Catches `F-18` (effect deps), missing `key`s, accidental `var`. Gate CI on it.
2. `prettier` with a 3-line config. End the bikeshed.
3. `husky` + `lint-staged` running prettier --write + eslint --fix on staged JS/JSX.
4. Optional but high-leverage: convert `src/lib/*.js` → TypeScript first (lib code has the most reuse, least JSX). Don't migrate the whole tree day one.

Add to CI:
```yaml
- run: npm run lint
- run: npm run typecheck   # if TS
```

### F-07 — Backend exception handler swallows everything

```python
# main.py:183-186
@app.exception_handler(Exception)
async def unhandled_exception_handler(_req: Request, exc: Exception):
    print(f"[daemu-backend-py] unhandled: {exc!r}")
    return JSONResponse({"ok": False, "error": "internal"}, status_code=500)
```

`print(exc!r)` gives you the repr of the exception — no traceback. When the FastAPI app crashes on Render with a SQL constraint violation, you get one line in the log saying `IntegrityError(...)` and no idea where. Fix:

```python
import logging, traceback
log = logging.getLogger("daemu")

@app.exception_handler(Exception)
async def unhandled_exception_handler(req: Request, exc: Exception):
    log.exception("unhandled at %s %s", req.method, req.url.path)
    return JSONResponse(
        {"ok": False, "error": "internal", "request_id": req.headers.get("x-request-id", "-")},
        status_code=500,
    )
```

Combine with a `request_id` middleware that adds `uuid4().hex[:12]` to every request, attaches it to logs, and echoes it in the response. Now when a customer reports "the form gave me an error", they can paste the ID and you can grep.

### F-08 — Generic CRUD takes `dict[str, Any]`

`routes_crud.py:357-383`:

```python
@router.post(f"/{prefix}", status_code=201)
async def create_(payload: dict[str, Any], ...):
    data = {k: v for k, v in payload.items() if k in create_fields}
    obj = model(**data)
```

Allowlist filtering is the only validation. Send `{"amount": "not a number"}` to `/api/orders` and you get a 500 from SQLAlchemy when it tries to coerce. Send `{"created_at": "2099-01-01"}` and you've forged a record date. The fix is one Pydantic model per entity (you have them already for `Inquiry`, `MailTemplate`); the factory should accept a Pydantic class:

```python
def _crud(model, prefix, create_schema, update_schema, allowed_fields):
    @router.post(f"/{prefix}", status_code=201)
    async def create_(payload: create_schema, ...):
        obj = model(**payload.model_dump())
        ...
```

This is mechanical and low-risk; do it as one PR per resource.

### F-09 — No migrations

`db.py:6-9` and `main.py:120-124`: `Base.metadata.create_all` only creates tables that don't exist. The first time you change `Inquiry.message` from `Text` to `String(2000)`, or add an index, or rename a column — _nothing happens_. SQLite users will silently see the old schema; MySQL users will see whichever schema the first deploy created. This will bite you the first time you ship column changes to a paying customer.

Fix: introduce Alembic before the first paying customer. Initial migration auto-generated from the current models, then every PR that touches `models.py` includes an alembic revision. Migration runs on Render deploy via a release hook.

### F-10 — SEO

Single `<title>` in `index.html:6` for every route. A bakery consultancy that's invisible in Google → no inbound leads → no business case for any of the rest of this. Concrete:

1. Use `react-helmet-async` (or write a 30-line `useDocumentMeta` hook) to set per-route `<title>`, `<meta description>`, `<meta og:*>`, `<link rel="canonical">`.
2. Add `public/robots.txt`:
   ```
   User-agent: *
   Allow: /
   Disallow: /admin
   Sitemap: https://daemu.kr/sitemap.xml
   ```
3. Generate `public/sitemap.xml` at build time from a static route list (the routes are known — they're in `App.jsx`).
4. Add OG image: 1200×630 export of the hero. Single biggest thing that improves Slack/Kakao/iMessage previews.

For the dynamic `/work/:slug` page, fetch the work record and set per-work title and description. Without SSR you won't get crawled metadata for those, but Google does execute JS now — it'll work for the homepage and the static routes immediately.

### F-11 — `useFadeUp` race

```js
// src/hooks/useFadeUp.js:5-19
useEffect(() => {
  const els = document.querySelectorAll('.fade-up:not(.is-visible)');
  if (!els.length) return;
  const observer = new IntersectionObserver(...);
  els.forEach((el) => observer.observe(el));
  return () => observer.disconnect();
}, deps);
```

The selector runs once when the effect runs. On pages where content is loaded by the raw-page IIFE _after_ React's render (which is most of the public pages — `home.js`, `about.js` etc. mount their own DOM after the `useExternalScript` fetch completes), the IntersectionObserver doesn't see those `.fade-up` nodes. That's the "fade-in not triggering on some loads" symptom.

Fix: make `useFadeUp` use a `MutationObserver` to also watch newly-added `.fade-up` nodes:

```js
const seen = new WeakSet();
function arm(el) {
  if (seen.has(el)) return;
  seen.add(el);
  observer.observe(el);
}
document.querySelectorAll('.fade-up:not(.is-visible)').forEach(arm);
const mo = new MutationObserver((muts) => {
  for (const m of muts) {
    m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches?.('.fade-up:not(.is-visible)')) arm(n);
      n.querySelectorAll?.('.fade-up:not(.is-visible)').forEach(arm);
    });
  }
});
mo.observe(document.body, { childList: true, subtree: true });
return () => { mo.disconnect(); observer.disconnect(); };
```

### F-12 — One ErrorBoundary, one chance

`src/App.jsx:127-170` wraps all routes in a single `<ErrorBoundary>`. When any component on any route throws, the whole app falls back to `<ServerError>` and the user can't navigate elsewhere without a hard reload. `componentDidCatch` only logs to console (`ErrorBoundary.jsx:11-15`).

Fix: nest a route-level boundary that resets on `pathname` change:

```jsx
function RouteBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}
// Wrap each <Route element={<PublicRoute><RouteBoundary><Home/></RouteBoundary></PublicRoute>}/>
```

Plus pipe `componentDidCatch` to whatever error reporter you adopt (F-13).

### F-13 — Observability

Right now if a customer says "I submitted at 3pm and never got a confirmation email":

- No way to find their request in Render logs unless you grep by email and the inquiry actually got committed
- No traceback if the auto-reply HTTP call to Resend failed (you only have `_send_auto_reply_inline:182` setting `error = str(e)[:200]` on the Outbox row — better than nothing, but not surfaced)
- No metrics: how many inquiries/day? What's the auto-reply success rate?

Minimum viable observability stack:

1. **Frontend error reporting**: Sentry (free tier covers this scale) wired into `ErrorBoundary.componentDidCatch` and the `unhandled_exception_handler` on the backend.
2. **Backend structured logs**: `logging.basicConfig(format='%(asctime)s %(levelname)s %(name)s %(message)s')` + JSON formatter when `ENV=prod`. Render log search works fine on JSON.
3. **Request IDs**: middleware adds `X-Request-ID` to every response.
4. **One dashboard metric**: count of inquiries per day, auto-reply success rate. Plausible can do the first; the second needs you to query `Outbox` (`SELECT status, COUNT(*) FROM outbox WHERE type='auto-reply' AND created_at > ...`).

### F-14 — i18n migration

If English is ever needed, the path is:

1. Wrap every Korean string in `t('key')`. ~70 files. Most of the work is in `src/admin/raw/*.html.js` (huge HTML strings with embedded Korean) and `public/admin-*-page.js` (DOM-built admin tables).
2. Use `react-i18next`. Initial dictionary auto-extractable.
3. Defer the raw-page admin pages — those are internal tools, English is unlikely to matter.

If you know English is coming, **port the public pages first** (Home, About, Service, Team, Process, Work, Partners, Contact, Privacy) — that's where customers see strings. ~30 files, 1 sprint.

---

## Top 5 things to do _before client demo_

These are small and visible.

1. **Fix Footer links (F-01)** — 30 min. Replace `<a href="*.html">` with `<Link to="/...">`. Stops the "I right-clicked and got a 404" embarrassment.
2. **Add per-route titles + OG meta (F-10 lite)** — 2 hours. Even just static per-route `<title>` and a single OG image. The first thing the client does is paste the URL into KakaoTalk; right now the preview is "DAEMU — Bakery & Cafe Business Partner" with no image regardless of which page they share.
3. **Lazy-load `browser-image-compression` (F-05)** — 20 min. Drops public bundle from 479 KB to ~290 KB. Lighthouse score visibly improves.
4. **Surface real backend errors (F-07)** — 30 min. Add traceback to logger. The first time the demo breaks, you'll thank yourself.
5. **Fix the `useFadeUp` race (F-11)** — 1 hour. The MutationObserver patch. The "fade-in doesn't trigger sometimes" complaint goes away.

Total: less than a day. All five are committed-and-deployable independently.

---

## Top 5 things to do _before real customer launch_

These are bigger, infrastructural, and gate the next stage.

1. **Adopt Alembic and stop using `create_all` (F-09)** — 1 day to set up + 1 day to author the initial migration + revisit any model field that's wrong (e.g. the `String(8)` `year` field — you'll regret that soon). Without this, every schema change is a foot-gun.
2. **Port the 3 most-touched admin pages to React (F-03)** — `admin-inquiries`, `admin-mail`, `admin-popup`. ~1 week. After this you can stop pretending the legacy IIFE bridge is fine. The remaining 9 pages can be ported as they need changes.
3. **Add Pydantic schemas to the generic CRUD factory (F-08)** — 2 days. One schema per entity. Closes the "send any JSON, hope SQLAlchemy coerces" hole.
4. **Stand up tests for P0 paths (F-04)** — 3 days. pytest backend + Vitest frontend for the table above. Wire into CI so the build red-flags regressions.
5. **Adopt observability stack (F-13)** — 2 days. Sentry, structured logs, request IDs, one dashboard. Without this the first production incident is a "huh, weird" with no signal.

Total: ~3 weeks of focused work for one engineer. None of it is research — every step is a known-good pattern.

---

## What's already good (don't change this)

These are working well. Resist the urge to refactor them:

- **`db.py` SQLite WAL setup** (`backend-py/db.py:46-56`) — busy_timeout=10s, journal_mode=WAL, synchronous=NORMAL is exactly the right tuning for a single-dyno demo. Don't touch it until you actually move to MySQL.
- **`auth.py` permission matrix** (`backend-py/auth.py:100-113`) — a flat dict of `{resource: {role: cell}}` is far more readable than the typical `is_admin or has_permission(...)` spaghetti. Keep this pattern as you add resources.
- **`require_perm(resource, action)` factory** (`backend-py/auth.py:244-254`) — clean FastAPI dependency factory. Idiomatic.
- **`_send_auto_reply_inline`** (`backend-py/routes_crud.py:120-193`) — running auto-reply inline within the request's session was the right call. The comment explaining _why_ (SQLite WAL writer contention) is exactly the kind of context future-you will thank past-you for.
- **`Splash` portal pattern** (`src/components/Splash.jsx`) — rendering through `createPortal` so the `body.splash-pending > *:not(...)` rule keys off direct-child relationship is a clever solution, well-commented. The `splash-pending`/`splash-ready` body class management in `App.jsx:97-118` with `useLayoutEffect` to avoid first-paint flash is a real understanding of the React rendering model.
- **`DialogHost`** (`src/components/DialogHost.jsx`) — overriding `window.alert/confirm` to provide site-styled modals while keeping native `confirm` synchronous for legacy IIFE callers is pragmatic. Don't try to make `confirm` async without porting all the IIFEs first.
- **`escHtml` / `escUrl`** (`src/lib/globals.js:10-23`) — `escUrl` correctly blocks `javascript:`, `data:`, `vbscript:`, `file:` schemes. The XSS surface in the admin pages is enormous (admin-managed strings rendered via `innerHTML`); the fact that every IIFE consistently uses these helpers is the only reason this isn't a bigger problem.
- **`ChangePasswordForm` flow + `must_change_password` gate** (`src/admin/AdminGate.jsx:52-88`, `backend-py/auth.py:267-285`) — forcing default-password users through a change-password screen on first login is a non-obvious thing to get right, and you got it right.
- **`CachedStatic` upload server** (`backend-py/main.py:285-292`) — adding `Cache-Control: max-age=604800, immutable` to `/uploads/` is a small touch that takes load off the dyno on every page that includes uploaded images.
- **Error pages** (`src/pages/errors/`, `src/components/ErrorPage.jsx`) — the croissant illustration is delightful and the `goBack` fallback to `/` when `history.length <= 1` is the right behavior. Keep this.
- **`render.yaml`, `RENDER_SETUP.md`, `PROJECT_GUIDE.md`** — having operational docs in the repo at this stage is unusual and welcome.
- **`browser-image-compression` is async-Web-Worker** (`src/lib/imageOptim.js:34`) — even when it ships in the wrong bundle (F-05), at least the compression itself doesn't block the main thread.

---

## Closing

You have a demo-stage product that already does more than most demo-stage products. The next 4 weeks of focused work — not refactor weeks, _focused_ — are the difference between "we lose the deal because the form doesn't send the confirmation" and "we close the deal and the customer thinks they're working with a real software team." The ordering above (demo prep → launch prep) is sequential and small enough that one engineer can ship it. Don't try to do the legacy IIFE port before the demo; do it after, when the client is paying you to keep building.

The single most important architectural decision _not yet made_ is whether `localStorage` "DB" is a demo crutch or a permanent offline-mode feature. Right now it's both, and that ambiguity is the source of every Critical-rated finding above except F-04. Pick one, document it, code accordingly.
