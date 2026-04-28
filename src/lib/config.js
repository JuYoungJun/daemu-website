// Vite exposes import.meta.env.VITE_* to client code.
// Backend endpoints are reached via VITE_API_BASE_URL (e.g. https://api.daemu.kr).
// Keys are optional — without them, related features fall back to demo mode.

export const CONFIG = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
  // Privacy-first analytics (no cookies, GDPR/PIPA exempt).
  plausible: {
    domain: import.meta.env.VITE_PLAUSIBLE_DOMAIN || '',
    apiHost: import.meta.env.VITE_PLAUSIBLE_API_HOST || 'https://plausible.io',
  },
  // Google Analytics 4 — opt-in only, requires explicit user consent
  // before the gtag.js script is loaded. PIPA Art. 22 (정보주체 동의).
  ga4: {
    measurementId: import.meta.env.VITE_GA4_ID || '',
  },
};

export function isApiConfigured() {
  return Boolean(CONFIG.apiBaseUrl);
}

export function isAnalyticsEnabled() {
  return Boolean(CONFIG.plausible.domain);
}

export function isGa4Configured() {
  return Boolean(CONFIG.ga4.measurementId);
}
