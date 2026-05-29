import { useEffect, useState, useRef } from 'react';

// 클라이언트 피드백 PDF p.3: "스플래시 스크린은 메인 화면에만 적용".
// 옛 동작: 모든 라우트 진입 시마다 3s/2.6s 재생 → 페이지 전환 효과처럼 작동.
// 신 동작: 메인(/) 첫 진입 시 한 번만 재생. 내부 라우트 이동 + 같은 세션 안에서
//          / 재진입 시 모두 skip. 새 탭/새 세션은 마커 없으므로 다시 재생.
const SPLASH_SHOWN_KEY = 'daemu_splash_shown';

export function useSplash(pathname, skip) {
  const isFirst = useRef(true);
  const [showSplash, setShowSplash] = useState(() => {
    if (skip) return false;
    if (pathname !== '/') return false;
    try { if (sessionStorage.getItem(SPLASH_SHOWN_KEY)) return false; } catch { /* ignore */ }
    return true;
  });

  useEffect(() => {
    if (skip || pathname !== '/') {
      setShowSplash(false);
      return;
    }
    try {
      if (sessionStorage.getItem(SPLASH_SHOWN_KEY)) {
        setShowSplash(false);
        return;
      }
    } catch { /* ignore */ }

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

    const t = setTimeout(() => {
      setShowSplash(false);
      try { sessionStorage.setItem(SPLASH_SHOWN_KEY, '1'); } catch { /* ignore */ }
    }, duration);
    return () => clearTimeout(t);
  }, [pathname, skip]);

  return showSplash;
}
