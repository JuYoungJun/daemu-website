// Global HTML / attribute escapers used by every admin-*-page.js script
// to prevent stored-XSS via user-controlled fields (inquiry name, popup
// CTA URLs, partner intro, etc).
//
// Loaded once from main.jsx via setGlobals(); see src/lib/globals.js.
//
// escHtml() — escape for use in element text content / attribute values.
// escAttr() — same semantics; alias for clarity at attribute call sites.
// escUrl()  — only allow http(s):, mailto:, tel:, /relative paths,
//             data:image|video|audio/...;base64,... (inline media).
//             Falls back to '#' for javascript:/vbscript:/file:/data:text 등.
(function () {
  if (typeof window === 'undefined') return;
  const HTML_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;' };
  // /api/upload 의 base64 inline 응답 (Render 휘발 디스크 회피용) 을 admin
  // raw page 의 <img src="${escUrl(...)}"> 에서 직접 사용 가능하도록 허용.
  // text/html, application/javascript 등 위험 MIME 는 거부.
  const SAFE_DATA_RE = /^data:(image|video|audio)\/[a-z0-9+.\-]+;base64,[A-Za-z0-9+/=\s]+$/i;
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => HTML_MAP[c]);
  }
  function escAttr(s) { return escHtml(s); }
  function escUrl(s) {
    const v = String(s == null ? '' : s).trim();
    if (!v) return '';
    // Relative path or fragment is fine
    if (v.startsWith('/') || v.startsWith('#') || v.startsWith('?')) return escAttr(v);
    // data:image|video|audio base64 — escHtml 만 통과 (& 등 인코딩) 안 함.
    // base64 alphabet (A-Z a-z 0-9 + / =) + : / ; , 만 들어있어 HTML escape
    // 필요 없음. 그러나 안전성 위해 그대로 attribute 에 들어갈 수 있도록 escAttr.
    if (v.toLowerCase().startsWith('data:')) {
      return SAFE_DATA_RE.test(v) ? escAttr(v) : '#';
    }
    // Allowed schemes (case-insensitive)
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
    if (!m) {
      // SPA sub-path 배포 (GitHub Pages: /daemu-website/) 에서 상대 path
      // (예: `assets/work-...png`) 가 현재 라우트 기준으로 해석되어 깨지는
      // 회귀 차단 — window.DAEMU_BASE prefix 자동 부착.
      const base = (typeof window !== 'undefined' && window.DAEMU_BASE) || '/';
      return escAttr(base.replace(/\/+$/, '') + '/' + v.replace(/^\/+/, ''));
    }
    const scheme = m[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') {
      return escAttr(v);
    }
    return '#'; // javascript:, vbscript:, file:, data:text 등.
  }
  window.escHtml = escHtml;
  window.escAttr = escAttr;
  window.escUrl = escUrl;
})();
