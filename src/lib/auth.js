// Admin auth — backed by /api/auth/login + JWT.
// Token is stored in localStorage so the AdminGate stays logged in across reloads.
// If no backend is configured (`VITE_API_BASE_URL` empty), falls back to a
// localStorage flag for offline demo.

import { api } from './api.js';

const TOKEN_KEY = 'daemu_admin_token';
const USER_KEY = 'daemu_admin_user';
const LEGACY_KEY = 'daemu_admin_auth';

export const Auth = {
  isLoggedIn() {
    if (localStorage.getItem(TOKEN_KEY)) return true;
    return localStorage.getItem(LEGACY_KEY) === '1';
  },

  token() { return localStorage.getItem(TOKEN_KEY) || ''; },

  user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },

  // Backend login. Returns { ok, error? }.
  async login(email, password) {
    if (!api.isConfigured()) {
      // Demo fallback: any non-empty creds work, no real verification.
      if (!email || !password) return { ok: false, error: 'enter credentials' };
      localStorage.setItem(LEGACY_KEY, '1');
      localStorage.setItem(USER_KEY, JSON.stringify({ email, name: '데모 관리자', role: 'admin' }));
      return { ok: true, simulated: true };
    }
    const res = await api.post('/api/auth/login', { email, password });
    if (!res || !res.ok) {
      return { ok: false, error: res?.error || '로그인 실패' };
    }
    if (res.token) localStorage.setItem(TOKEN_KEY, res.token);
    if (res.user) localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    localStorage.setItem(LEGACY_KEY, '1');
    return { ok: true };
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_KEY);
  },
};
