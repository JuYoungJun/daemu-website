// Vite exposes import.meta.env.VITE_* to client code.
// Backend endpoints are reached via VITE_API_BASE_URL (e.g. https://api.daemu.kr).
// Keys are optional — without them, related features fall back to demo mode.

export const CONFIG = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
  plausible: {
    domain: import.meta.env.VITE_PLAUSIBLE_DOMAIN || '',
    apiHost: import.meta.env.VITE_PLAUSIBLE_API_HOST || 'https://plausible.io'
  }
};

export function isApiConfigured() {
  return Boolean(CONFIG.apiBaseUrl);
}

export function isAnalyticsEnabled() {
  return Boolean(CONFIG.plausible.domain);
}
