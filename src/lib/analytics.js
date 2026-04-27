import { CONFIG, isAnalyticsEnabled } from './config.js';

let injected = false;

export function initAnalytics() {
  if (injected || !isAnalyticsEnabled() || typeof window === 'undefined') return;
  injected = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = `${CONFIG.plausible.apiHost}/js/script.js`;
  s.setAttribute('data-domain', CONFIG.plausible.domain);
  document.head.appendChild(s);
  // Plausible queue helper for SPA route changes
  window.plausible = window.plausible || function () {
    (window.plausible.q = window.plausible.q || []).push(arguments);
  };
}

export function trackPageview() {
  if (!isAnalyticsEnabled()) return;
  if (typeof window.plausible === 'function') window.plausible('pageview');
}
