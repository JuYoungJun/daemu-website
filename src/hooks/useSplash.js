import { useEffect, useState, useRef } from 'react';

// Splash plays on initial mount AND on every route change (matching the
// original static behavior where every page load — including navigations
// that triggered a full reload — re-played the splash).
//
// Args:
//   pathname  — current location.pathname (re-runs whenever it changes)
//   skip      — when true (e.g. on admin routes), splash is suppressed
//
// Timings mirror script.js: 2600ms on transition, 3000ms on initial,
// reduced-motion shortcut to ~80ms.
export function useSplash(pathname, skip) {
  const isFirst = useRef(true);
  const [showSplash, setShowSplash] = useState(() => !skip);

  useEffect(() => {
    if (skip) {
      setShowSplash(false);
      return;
    }

    setShowSplash(true);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let duration;
    if (reduced) {
      duration = 80;
    } else if (isFirst.current) {
      duration = 3000;
      isFirst.current = false;
    } else {
      duration = 2600;
    }

    const t = setTimeout(() => setShowSplash(false), duration);
    return () => clearTimeout(t);
  }, [pathname, skip]);

  return showSplash;
}
