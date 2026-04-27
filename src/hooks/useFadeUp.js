import { useEffect } from 'react';

// IntersectionObserver-based fade-up — scans .fade-up under root after each render.
export function useFadeUp(deps = []) {
  useEffect(() => {
    const els = document.querySelectorAll('.fade-up:not(.is-visible)');
    if (!els.length) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
