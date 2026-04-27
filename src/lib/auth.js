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

  // Backend login. Returns { ok, error?, mustChangePassword? }.
  async login(email, password) {
    if (!api.isConfigured()) {
      if (!email || !password) return { ok: false, error: 'enter credentials' };
      localStorage.setItem(LEGACY_KEY, '1');
      localStorage.setItem(USER_KEY, JSON.stringify({ email, name: '데모 관리자', role: 'admin', must_change_password: false }));
      return { ok: true, simulated: true, mustChangePassword: false };
    }
    const res = await api.post('/api/auth/login', { email, password });
    if (!res || !res.ok) {
      if (res?.status === 429) return { ok: false, error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' };
      return { ok: false, error: res?.error || '로그인 실패' };
    }
    if (res.token) localStorage.setItem(TOKEN_KEY, res.token);
    if (res.user) localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    localStorage.setItem(LEGACY_KEY, '1');
    return { ok: true, mustChangePassword: !!res.user?.must_change_password };
  },

  async changePassword(currentPassword, newPassword) {
    if (!api.isConfigured()) {
      const u = this.user();
      if (u) localStorage.setItem(USER_KEY, JSON.stringify({ ...u, must_change_password: false }));
      return { ok: true, simulated: true };
    }
    const res = await api.post('/api/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    if (res.ok) {
      const u = this.user();
      if (u) localStorage.setItem(USER_KEY, JSON.stringify({ ...u, must_change_password: false }));
    }
    return res;
  },

  // Pull fresh /api/auth/me so a stale must_change_password flag in
  // localStorage gets corrected after the user changes their password from
  // a different device or admin reset.
  async refreshMe() {
    if (!api.isConfigured()) return null;
    const r = await api.get('/api/auth/me');
    if (r.ok) {
      localStorage.setItem(USER_KEY, JSON.stringify({
        id: r.id, email: r.email, name: r.name, role: r.role,
        must_change_password: !!r.must_change_password,
      }));
      return r;
    }
    return null;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_KEY);
  },
};
