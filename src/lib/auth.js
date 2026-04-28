// Admin auth — backed by /api/auth/login + JWT.
//
// Security posture (2026-04 hardening):
//  - Token lives in sessionStorage, not localStorage. Closing the tab/browser
//    clears it. No long-lived admin sessions.
//  - 30-minute inactivity timeout. Each authenticated API call refreshes
//    the activity timestamp; once expired, the next isLoggedIn() check
//    forces a logout + re-login.
//  - The admin shell additionally clears the session when the admin
//    navigates away from /admin/* (RequireAuth + AdminShell unmount path).
//
// Backend JWT TTL is 12h, but the frontend gate is more conservative:
// even if the token is still server-valid, the frontend forces re-login
// after inactivity or tab close.

import { api } from './api.js';

const TOKEN_KEY = 'daemu_admin_token';
const USER_KEY = 'daemu_admin_user';
const ACTIVITY_KEY = 'daemu_admin_last_activity';
const LEGACY_KEY = 'daemu_admin_auth';

// 30 minutes of inactivity → forced re-login.
export const ADMIN_INACTIVITY_MS = 30 * 60 * 1000;

function _now() { return Date.now(); }

function _purgeLegacy() {
  // Older builds stored tokens in localStorage. Wipe any leftovers so
  // they can never be reused after upgrade.
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
  } catch { /* ignore */ }
}

export const Auth = {
  isLoggedIn() {
    _purgeLegacy();
    const tok = sessionStorage.getItem(TOKEN_KEY);
    const flag = sessionStorage.getItem(LEGACY_KEY);
    if (!tok && flag !== '1') return false;
    // Inactivity check — if last activity is too old, force logout.
    const last = parseInt(sessionStorage.getItem(ACTIVITY_KEY) || '0', 10);
    if (last && _now() - last > ADMIN_INACTIVITY_MS) {
      this.logout();
      return false;
    }
    return true;
  },

  token() { return sessionStorage.getItem(TOKEN_KEY) || ''; },

  user() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },

  // Refresh activity stamp. Called from api.js on every authenticated call.
  touch() {
    if (sessionStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(LEGACY_KEY) === '1') {
      sessionStorage.setItem(ACTIVITY_KEY, String(_now()));
    }
  },

  // Backend login. Returns { ok, error?, mustChangePassword? }.
  async login(email, password) {
    if (!api.isConfigured()) {
      if (!email || !password) return { ok: false, error: 'enter credentials' };
      sessionStorage.setItem(LEGACY_KEY, '1');
      sessionStorage.setItem(USER_KEY, JSON.stringify({ email, name: '데모 관리자', role: 'admin', must_change_password: false }));
      this.touch();
      return { ok: true, simulated: true, mustChangePassword: false };
    }
    const res = await api.post('/api/auth/login', { email, password });
    if (!res || !res.ok) {
      if (res?.status === 429) return { ok: false, error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' };
      return { ok: false, error: res?.error || '로그인 실패' };
    }
    if (res.token) sessionStorage.setItem(TOKEN_KEY, res.token);
    if (res.user) sessionStorage.setItem(USER_KEY, JSON.stringify(res.user));
    sessionStorage.setItem(LEGACY_KEY, '1');
    this.touch();
    return { ok: true, mustChangePassword: !!res.user?.must_change_password };
  },

  async changePassword(currentPassword, newPassword) {
    if (!api.isConfigured()) {
      const u = this.user();
      if (u) sessionStorage.setItem(USER_KEY, JSON.stringify({ ...u, must_change_password: false }));
      return { ok: true, simulated: true };
    }
    const res = await api.post('/api/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    if (res.ok) {
      const u = this.user();
      if (u) sessionStorage.setItem(USER_KEY, JSON.stringify({ ...u, must_change_password: false }));
    }
    return res;
  },

  // Pull fresh /api/auth/me so a stale must_change_password flag
  // gets corrected after the user changes their password from
  // a different device or admin reset.
  async refreshMe() {
    if (!api.isConfigured()) return null;
    const r = await api.get('/api/auth/me');
    if (r.ok) {
      sessionStorage.setItem(USER_KEY, JSON.stringify({
        id: r.id, email: r.email, name: r.name, role: r.role,
        must_change_password: !!r.must_change_password,
      }));
      return r;
    }
    return null;
  },

  logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LEGACY_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
    _purgeLegacy();
  },
};
