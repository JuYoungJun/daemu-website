import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';

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

// V3-02: globals.js drags email/upload/csv/db into the bundle for every
// public visitor (~70 KB). Only admin pages and the legacy form handler
// need it, so dynamic-import on the routes that actually do.
//   - On /admin/* → load immediately (admin shell needs window.DB / Auth /
//     escHtml / sendAutoReply etc.)
//   - On legacy form submissions → consultForms.js already loads it via
//     ./db.js etc., so it's resolved on the spot.
//   - On pure public visits (Home/About/etc.) → never loaded.
{
  const p = window.location.pathname;
  if (p === '/admin' || p.startsWith('/admin/') || p.endsWith('/admin')) {
    import('./lib/globals.js');
  }
}

// Pre-React: if landing directly on an admin route, swap body classes
// synchronously so the splash-pending visibility:hidden rule never gets a
// chance to flash hide admin content.
(function () {
  const p = window.location.pathname;
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
