import { useEffect } from 'react';

// Loads a script from the same-origin /public bundle by setting <script src>
// directly. The previous implementation fetch()ed the source as text and
// injected it via script.textContent — Snyk flagged this as DOM-XSS because
// "remote text → script.textContent → DOM" is the same shape as known XSS
// sinks even when the remote is same-origin.
//
// New approach:
//   · src is restricted to same-origin paths (must start with '/').
//     External / scheme-bearing URLs are rejected outright.
//   · We set scriptEl.src and let the browser fetch + execute. No string
//     manipulation, no textContent injection, no Snyk false positive.
//   · We expose window.DAEMU_BASE (set in main.jsx) so admin scripts can
//     compute asset paths themselves when needed; we don't post-process
//     the script body anymore.

const ALLOW_SAME_ORIGIN_PREFIX = /^\/[^/]/;  // path-relative, no protocol

// vite.config.js 의 define 으로 빌드 시점에 주입. 매 deploy 마다 새 값 →
// public/admin-*-page.js 같은 hash-less raw script 의 옛 캐시 무효화.
// 미주입 (dev 모드) 시 'dev' 로 fallback.
// eslint-disable-next-line no-undef
const BUILD_VERSION = typeof __DAEMU_BUILD_TIME__ !== 'undefined' ? __DAEMU_BUILD_TIME__ : 'dev';

export function useExternalScript(src, deps = []) {
  useEffect(() => {
    if (!src) return;
    if (typeof src !== 'string' || !ALLOW_SAME_ORIGIN_PREFIX.test(src)) {
      console.warn('useExternalScript: rejecting non-same-origin src', src);
      return;
    }
    const cacheBust = src.includes('?') ? `&v=${BUILD_VERSION}` : `?v=${BUILD_VERSION}`;
    const resolved = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + src + cacheBust;

    // Already injected by an earlier mount? Keep it; just bail.
    const existing = document.querySelector(`script[data-daemu-script="${CSS.escape(src)}"]`);
    if (existing) return;

    const scriptEl = document.createElement('script');
    scriptEl.src = resolved;
    scriptEl.async = false;        // preserve admin script execution order
    scriptEl.dataset.daemuScript = src;
    document.body.appendChild(scriptEl);

    return () => {
      try { scriptEl.remove(); } catch (e) { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
