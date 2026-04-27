import { useEffect } from 'react';
import { fixAssetPaths } from '../lib/assetPath.js';

const scriptCache = new Map();

// Fetches the script as text, rewrites /assets/ paths to honor Vite base,
// then injects as INLINE <script> for synchronous execution.
export function useExternalScript(src, deps = []) {
  useEffect(() => {
    if (!src) return;
    let scriptEl = null;
    let cancelled = false;

    const inject = (code) => {
      if (cancelled) return;
      scriptEl = document.createElement('script');
      scriptEl.textContent = code;
      scriptEl.dataset.daemuScript = src;
      document.body.appendChild(scriptEl);
    };

    const resolved = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + src;

    if (scriptCache.has(src)) {
      Promise.resolve().then(() => inject(scriptCache.get(src)));
    } else {
      fetch(resolved, { cache: 'no-cache' })
        .then((r) => {
          if (!r.ok) throw new Error('script ' + resolved + ' status ' + r.status);
          return r.text();
        })
        .then((code) => {
          const fixed = fixAssetPaths(code);
          scriptCache.set(src, fixed);
          inject(fixed);
        })
        .catch((err) => {
          console.error('useExternalScript load failed', err);
        });
    }

    return () => {
      cancelled = true;
      if (scriptEl) {
        try { scriptEl.remove(); } catch (e) { /* ignore */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
