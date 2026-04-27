// Global HTML / attribute escapers used by every admin-*-page.js script
// to prevent stored-XSS via user-controlled fields (inquiry name, popup
// CTA URLs, partner intro, etc).
//
// Loaded once from main.jsx via setGlobals(); see src/lib/globals.js.
//
// escHtml() — escape for use in element text content / attribute values.
// escAttr() — same semantics; alias for clarity at attribute call sites.
// escUrl()  — only allow http(s):, mailto:, tel:, /relative paths.
//             Falls back to '#' for javascript:/data:/vbscript:/etc.
(function () {
  if (typeof window === 'undefined') return;
  const HTML_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;' };
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => HTML_MAP[c]);
  }
  function escAttr(s) { return escHtml(s); }
  function escUrl(s) {
    const v = String(s == null ? '' : s).trim();
    if (!v) return '';
    // Relative path or fragment is fine
    if (v.startsWith('/') || v.startsWith('#') || v.startsWith('?')) return escAttr(v);
    // Allowed schemes (case-insensitive)
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
    if (!m) return escAttr(v); // no scheme = treat as relative
    const scheme = m[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') {
      return escAttr(v);
    }
    return '#'; // javascript:, data:, vbscript:, file: etc.
  }
  window.escHtml = escHtml;
  window.escAttr = escAttr;
  window.escUrl = escUrl;
})();
