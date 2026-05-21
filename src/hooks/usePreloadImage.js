import { useEffect } from 'react';

// 페이지 진입 시 LCP 이미지 preload. <link rel="preload" as="image"
// fetchpriority="high"> 를 동적으로 head 에 삽입하고 unmount 시 cleanup.
// HTML 정적 preload 와 달리 페이지 진입 시점에만 fetch — SPA 의 다른 라우트
// 에선 unused 비용 0.
//
// path: BASE_URL prefix 없는 자산 경로 (예: 'assets/about-team.webp').
//       Vite base (`/daemu-website/` 또는 `/`) 가 자동 prefix.
export function usePreloadImage(path) {
  useEffect(() => {
    if (!path) return undefined;
    const base = (import.meta.env.BASE_URL || '/');
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = base + (path.startsWith('/') ? path.slice(1) : path);
    // fetchPriority — Chrome / Edge 만 지원. 미지원 브라우저는 무시.
    link.fetchPriority = 'high';
    document.head.appendChild(link);
    return () => { try { link.remove(); } catch { /* ignore */ } };
  }, [path]);
}
