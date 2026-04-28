// Privacy-respecting analytics layer.
//
// Two providers, both optional:
//   - Plausible (cookieless, no consent needed under GDPR/PIPA) — default.
//   - Google Analytics 4 (consent-gated; gtag.js only loads after the user
//     accepts the analytics banner). PIPA Art. 22 compliance.
//
// If neither VITE_PLAUSIBLE_DOMAIN nor VITE_GA4_ID is set, this module is
// a no-op and the bundle pays nothing for it.

import { CONFIG, isAnalyticsEnabled, isGa4Configured } from './config.js';

const GA4_CONSENT_KEY = 'daemu_ga_consent';

let plausibleInjected = false;
let ga4Injected = false;

/* ----------------------------------------------------------------------- */
/* Plausible — cookieless, no consent banner required                       */

function injectPlausible() {
  if (plausibleInjected || !isAnalyticsEnabled() || typeof window === 'undefined') return;
  plausibleInjected = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = `${CONFIG.plausible.apiHost}/js/script.js`;
  s.setAttribute('data-domain', CONFIG.plausible.domain);
  document.head.appendChild(s);
  window.plausible = window.plausible || function () {
    (window.plausible.q = window.plausible.q || []).push(arguments);
  };
}

/* ----------------------------------------------------------------------- */
/* GA4 — consent-gated                                                      */

export function ga4ConsentStatus() {
  if (typeof window === 'undefined') return 'unknown';
  return localStorage.getItem(GA4_CONSENT_KEY) || 'unknown';
}

export function setGa4Consent(value /* 'granted' | 'denied' */) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GA4_CONSENT_KEY, value);
  if (value === 'granted') injectGa4();
  // If denied: do nothing now; if gtag was already loaded, calling
  // gtag('consent','update') with denied would suppress further events.
  if (value === 'denied' && typeof window.gtag === 'function') {
    window.gtag('consent', 'update', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }
}

function injectGa4() {
  if (ga4Injected || !isGa4Configured() || typeof window === 'undefined') return;
  ga4Injected = true;
  const id = CONFIG.ga4.measurementId;

  // Bootstrap dataLayer + gtag with default-deny consent.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });

  // User has already opted in (we only call injectGa4 after that), so update.
  gtag('consent', 'update', {
    analytics_storage: 'granted',
  });

  gtag('js', new Date());
  gtag('config', id, {
    anonymize_ip: true,
    send_page_view: false, // we'll fire SPA pageviews manually
  });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

/* ----------------------------------------------------------------------- */
/* Public API                                                               */

export function initAnalytics() {
  injectPlausible();
  // GA4 is consent-gated; auto-inject only if the user already opted in.
  if (ga4ConsentStatus() === 'granted') injectGa4();
}

export function trackPageview() {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible === 'function') window.plausible('pageview');
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_path: window.location.pathname + window.location.search,
      page_title: document.title,
    });
  }
}

export function trackEvent(name, props = {}) {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible === 'function') window.plausible(name, { props });
  if (typeof window.gtag === 'function') window.gtag('event', name, props);
}
