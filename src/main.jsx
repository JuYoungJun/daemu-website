import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';

// 공개 페이지의 raw-page 폼(전화·이메일 입력) 자동 포맷터 — eager 로드.
// 가볍고(약 2KB), 모든 페이지에서 즉시 동작해야 하므로 lazy 로 둘 수 없음.
import { installInputFormatHandler } from './lib/inputFormatGlobal.js';
installInputFormatHandler();

// Render free tier 슬립 방어 — 사이트 방문자가 있는 시간대에 백엔드를
// 5분 간격으로 ping 해 dyno 가 깨어 있게 유지. 외부 cron(UptimeRobot 등)
// + GitHub Actions cron 과 함께 3중 방어. 백엔드 미연결 시 자동 skip.
import { startKeepAlive } from './lib/keepAlive.js';
startKeepAlive();

// FR-01 fix: defer the legacy form handler until a `data-consult-form`
// submission actually fires. Until then, db.js / email.js / api.js stay
// out of the public visitor's main bundle.
function installLazyConsultBridge() {
  if (typeof document === 'undefined' || window.__daemuConsultLazy) return;
  window.__daemuConsultLazy = true;
  document.addEventListener('submit', async (e) => {
    if (!e.target.closest || !e.target.closest('form[data-consult-form]')) return;
    e.preventDefault();
    e.stopPropagation();
    const mod = await import('./lib/consultForms.js');
    mod.installConsultFormHandler();
    // Re-dispatch so the now-installed handler picks up the original event.
    e.target.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, { once: true, capture: true });
}
installLazyConsultBridge();

// V3-02: globals.js 는 email/upload/csv/db 를 메인 번들에 끌어들임(~70KB).
// 어드민 페이지와 legacy 폼 핸들러만 필요로 하므로 해당 경로에서만 dynamic
// import 한다.
//   - /admin/* → 즉시 로드 (어드민 셸이 window.DB / Auth / escHtml / send*
//                를 raw script 진입 시점에 이미 사용)
//   - legacy 폼 → consultForms.js 가 ./db.js 등을 통해 자체 해소
//   - 일반 공개 방문 → 절대 로드하지 않음
//
// **GitHub Pages basename 정규화** (이전 버그: `/daemu-website/admin/partners`
// 같은 path 가 startsWith('/admin/') 매칭에 실패해 globals.js 가 로드되지
// 않아 raw script 의 DB.get 이 ReferenceError 를 던졌음)
function adminPathFromLocation() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  let p = (typeof window !== 'undefined' && window.location.pathname) || '/';
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  return p;
}
{
  const p = adminPathFromLocation();
  if (p === '/admin' || p.startsWith('/admin/')) {
    import('./lib/globals.js');
  }
}

// Pre-React: 어드민 경로로 직접 진입하면 splash-pending visibility:hidden 규칙
// 이 어드민 컨텐츠를 가리는 일을 막기 위해 body class 를 동기적으로 교체.
(function () {
  const p = adminPathFromLocation();
  if (p === '/admin' || p.startsWith('/admin/')) {
    document.body.classList.remove('splash-pending');
    document.body.classList.add('splash-ready');
  }
})();

// import.meta.env.BASE_URL is injected by Vite based on `base` config.
// Strip trailing slash for React Router basename.
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

// Expose base URL as a window global so inline raw-page scripts (public/*.js)
// can use it for navigation in subpath deployments (e.g. GitHub Pages).
// Always ends with trailing slash, e.g. '/daemu-website/' or '/'.
if (typeof window !== 'undefined') {
  window.DAEMU_BASE = import.meta.env.BASE_URL || '/';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>
);
