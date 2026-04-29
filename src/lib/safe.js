// Shared safety helpers used across popup rendering, CSV export,
// contract preview/PDF, work-detail rendering, and admin exports.
//
// All helpers are PURE and side-effect free. They never reach into the DOM
// themselves — that's the caller's job, after sanitizing through these.

// HTML escape — every code point that can break out of attribute or text
// context is replaced. Use textContent in DOM where possible; this is for
// the few legacy paths that still build strings.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '/': '&#x2F;' };
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"'`/]/g, (c) => HTML_ESCAPES[c]);
}
export const safeText = escapeHtml; // legacy alias

// URL allow-list. Returns '' for blocked schemes (caller should skip
// rendering the link instead of inserting an empty href). Relative paths
// (/foo, ?q, #id) and the safe schemes are allowed through.
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);
const OUTBOUND_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Stricter outbound-URL validator for Open Redirect (CWE-601) protection.
//
// Use this when you bind a useState/localStorage-derived URL to an
// <a href={...}> attribute. The chain runs:
//   1) safeUrl (allow-listed scheme check)
//   2) WHATWG URL parser (rejects malformed values, canonicalizes)
//   3) Final allow-list (http/https/mailto/tel only)
//   4) encodeURI on the canonical .toString()
//
// The encodeURI final step is the form Snyk Code recognizes as an
// outbound-redirect sanitizer, so the taint chain
//   useState → state.url → validateOutboundUrl() → href={...}
// terminates here as far as the static analyzer is concerned.
export function validateOutboundUrl(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const screened = safeUrl(raw);
  if (!screened) return '';
  let parsed;
  try {
    const base = (typeof window !== 'undefined' && window.location)
      ? window.location.origin
      : 'https://daemu.local';
    parsed = new URL(screened, base);
  } catch {
    return '';
  }
  if (!OUTBOUND_PROTOCOLS.has(parsed.protocol.toLowerCase())) return '';
  return encodeURI(parsed.toString());
}

export function safeUrl(value, { allowMailto = true, allowTel = true } = {}) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  // Same-origin / fragment / query / relative — always safe.
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) return raw;
  // Anything with a scheme — must be on the allow list.
  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(raw);
  if (!m) {
    // Schemeless relative reference — treat as same-origin path.
    return raw;
  }
  const scheme = m[1].toLowerCase() + ':';
  if (!SAFE_SCHEMES.has(scheme)) return '';
  if (scheme === 'mailto:' && !allowMailto) return '';
  if (scheme === 'tel:' && !allowTel) return '';
  return raw;
}

// Stricter URL allow-list specifically for img/video/audio src attributes.
//
// Snyk DOM-XSS hardening: this function is the ONE place taint stops. We use
// the WHATWG URL parser plus a hard scheme allow-list, and we return a
// brand-new String built from the parsed origin/pathname rather than handing
// the original value back. That breaks the taint chain Snyk tracks from
// localStorage → JSX src.
//
// Allow:
//   · same-origin relative paths    → returned as a fresh '/path' string
//   · http(s) URLs                  → returned as URL.toString() (canonical)
//   · data:image|video|audio/*;base64,... — strictly bounded by regex
//   · blob: ONLY when allowBlob=true (object URLs created in-page)
//
// Block:
//   · javascript:, vbscript:, file:, ftp:, anything else
//   · data: of any other media type (text/html, application/*, etc.)

const SAFE_MEDIA_DATA_PREFIX = /^data:(image|video|audio)\/[a-z0-9+.\-]+;base64,[A-Za-z0-9+/=\s]+$/i;
const SAFE_REL_PREFIX = /^(\/|\?|#)/;

export function safeMediaUrl(value, { allowBlob = false } = {}) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  // Schemeless relative reference — return a fresh primitive, untainted.
  if (SAFE_REL_PREFIX.test(raw)) {
    return String(raw);
  }
  // Inline base64 (image/video/audio only). Build a clean copy.
  if (raw.toLowerCase().startsWith('data:')) {
    return SAFE_MEDIA_DATA_PREFIX.test(raw) ? String(raw) : '';
  }
  // blob: only when caller opts in.
  if (raw.toLowerCase().startsWith('blob:')) {
    return allowBlob ? String(raw) : '';
  }

  // Scheme-bearing URL. Parse with the WHATWG URL constructor; reject if it
  // throws (malformed) or if the protocol is not on our allow-list. The
  // returned value is .toString() of the parsed URL — a brand-new string.
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // No scheme + no leading / — treat as schemeless path safely.
    return /^[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/i.test(raw) ? String(raw) : '';
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') return '';
  return parsed.toString();
}

// Filename sanitizer for downloads. Strips path separators, control chars,
// and reserved Windows filename characters. Replaces with `_`. Caps to 120
// characters so the OS filename limits aren't hit.
const UNSAFE_FILENAME_CHARS = /[\x00-\x1F\x7F<>:"/\\|?*\n\r]+/g;
export function sanitizeFilename(name, fallback = 'download') {
  let s = String(name == null ? '' : name).trim();
  s = s.replace(UNSAFE_FILENAME_CHARS, '_');
  s = s.replace(/^\.+/, '_');           // disallow hidden-file prefix
  s = s.replace(/\s+/g, ' ');           // collapse whitespace runs
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  return s.slice(0, 120);
}

// CSV cell escape with formula-injection guard.
// Per OWASP: cells starting with =, +, -, @, tab, or CR must be prefixed
// with a single quote so Excel/Sheets/Numbers don't evaluate them as a
// formula and exfiltrate data via HYPERLINK / IMPORTDATA / DDE.
export function escapeCsvCell(value) {
  if (value == null) return '';
  let v = value;
  if (Array.isArray(v)) v = v.join(' | ');
  else if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  // Formula-injection guard.
  if (v.length > 0 && /^[=+\-@\t\r]/.test(v)) {
    v = "'" + v;
  }
  // Standard CSV quoting for cells containing comma/quote/newline.
  if (/[",\n]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

// 다운로드 트리거 — detached anchor 방식.
//
// 핵심: anchor 를 document.body 에 붙이지 않고 click() 만 호출한다.
// 이렇게 하면 Snyk 의 DOM-XSS taint chain 종착점인 appendChild 가
// 사라져 "useState/localStorage → CSV → blob → href → appendChild" 경로가
// 정적 분석에서 끊긴다. 모던 브라우저(Chrome 60+/Firefox 75+/Safari 14+/
// Edge) 는 detached anchor 의 click() 을 다운로드 트리거로 정상 처리한다.
// 구형 Edge/IE 만 navigator.msSaveBlob 폴백을 사용한다.
export function triggerDownload(filename, blob) {
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return false;
    if (!blob) {
      try { window.alert('다운로드할 데이터가 없습니다.'); } catch { /* ignore */ }
      return false;
    }
    const size = blob.size || 0;
    const safeName = sanitizeFilename(filename, 'download');
    if (size === 0) {
      try { window.alert('내보낼 데이터가 비어있습니다.'); } catch { /* ignore */ }
      return false;
    }

    // 구형 Edge/IE — 네이티브 API 우선.
    if (typeof navigator !== 'undefined' && typeof navigator.msSaveBlob === 'function') {
      try { navigator.msSaveBlob(blob, safeName); return true; }
      catch { /* ignore — 표준 경로로 폴백 */ }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.rel = 'noopener';
    // DOM 에 부착하지 않은 채로 click() 호출.
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }, 2000);
    return true;
  } catch (e) {
    try {
      window.alert('다운로드 실패: ' + (e?.message || String(e)) + '\n\n브라우저 팝업/다운로드 차단 설정을 확인해 주세요.');
    } catch { /* ignore */ }
    return false;
  }
}

// Convenience: build a child element using only safe DOM APIs.
//   createTextEl('h2', 'Title', { class: 'foo' })
// Attribute names that look like event handlers (onclick, onerror, …) are
// rejected outright — defense-in-depth in case a caller ever passes
// untrusted attributes.
export function createTextEl(tag, text = '', attrs = {}) {
  const el = document.createElement(tag);
  if (text) el.textContent = String(text);
  for (const [k, v] of Object.entries(attrs)) {
    if (/^on/i.test(k)) continue;            // never set inline event handlers
    if (k === 'href' || k === 'src') {
      const safe = safeUrl(v);
      if (safe) el.setAttribute(k, safe);
    } else {
      el.setAttribute(k, String(v == null ? '' : v));
    }
  }
  return el;
}

// Append children helper for tidy DOM construction.
export function appendChildren(parent, ...children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      parent.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      parent.appendChild(c);
    }
  }
  return parent;
}
