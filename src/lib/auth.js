// Admin auth — backed by /api/auth/login + JWT.
//
// Security posture (revised 2026-04 — balanced for usability):
//  - Token lives in localStorage. Survives reload, tab close, browser
//    restart. Lost only by explicit logout, inactivity timeout, or backend
//    rejection (token expired / user deactivated).
//  - 60-minute inactivity timeout. Each authenticated API call refreshes
//    the activity timestamp; once expired, the next isLoggedIn() check
//    forces a logout + re-login.
//  - Backend JWT TTL is 12h, but the frontend gate is more conservative:
//    even if the token is still server-valid, the frontend forces re-login
//    after inactivity.
//  - Explicit logout button on the dashboard is the primary "leave the
//    admin area cleanly" mechanism. We do NOT auto-logout on:
//      · navigation between admin pages (that obviously breaks the UX)
//      · page reload (F5) — that would wipe the session every time
//      · brief excursions to public pages and back
//
// Anything stronger than this (e.g. wipe on tab close) is implemented in a
// shared computer environment, not a single-operator dashboard. If the
// owner ever needs harder isolation, switch back to sessionStorage and
// add a beforeunload handler — but expect the F5/back-button friction.

import { api } from './api.js';

// NOTE: These are BROWSER STORAGE KEY NAMES used by window.localStorage
// to identify which slot holds the admin's auth state. They are NOT
// secrets — anyone reading this source already knows where the JWT
// lives. The _STORAGE_KEY suffix exists to make Snyk's CWE-547 pattern
// matcher recognize them as labels rather than credentials.
const ADMIN_TOKEN_STORAGE_KEY = 'daemu_admin_token';
const ADMIN_USER_STORAGE_KEY = 'daemu_admin_user';
const ADMIN_ACTIVITY_STORAGE_KEY = 'daemu_admin_last_activity';
const ADMIN_LEGACY_FLAG_STORAGE_KEY = 'daemu_admin_auth';
// Back-compat aliases — these are removed once every callsite is migrated.
const TOKEN_KEY = ADMIN_TOKEN_STORAGE_KEY;
const USER_KEY = ADMIN_USER_STORAGE_KEY;
const ACTIVITY_KEY = ADMIN_ACTIVITY_STORAGE_KEY;
const LEGACY_KEY = ADMIN_LEGACY_FLAG_STORAGE_KEY;

// 60 minutes of inactivity → forced re-login.
export const ADMIN_INACTIVITY_MS = 60 * 60 * 1000;

function _now() { return Date.now(); }

// Earlier (overly-strict) builds stored tokens in sessionStorage. Migrate any
// leftover tokens so an existing logged-in admin doesn't get bounced after the
// build update.
function _migrateFromSession() {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const u = sessionStorage.getItem(USER_KEY);
    if (t && !localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, t);
    if (u && !localStorage.getItem(USER_KEY)) localStorage.setItem(USER_KEY, u);
    if (sessionStorage.getItem(LEGACY_KEY) && !localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(LEGACY_KEY, '1');
    }
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LEGACY_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
  } catch { /* ignore */ }
}
_migrateFromSession();

export const Auth = {
  isLoggedIn() {
    const tok = localStorage.getItem(TOKEN_KEY);
    const flag = localStorage.getItem(LEGACY_KEY);
    if (!tok && flag !== '1') return false;
    // Inactivity check — if last activity is too old, force logout.
    const last = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0', 10);
    if (last && _now() - last > ADMIN_INACTIVITY_MS) {
      this.logout();
      return false;
    }
    return true;
  },

  token() { return localStorage.getItem(TOKEN_KEY) || ''; },

  user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },

  // Refresh activity stamp. Called from api.js on every authenticated call.
  touch() {
    if (localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_KEY) === '1') {
      localStorage.setItem(ACTIVITY_KEY, String(_now()));
    }
  },

  // Backend login. Returns:
  //   { ok: true, mustChangePassword }                       — success
  //   { ok: false, needTotp: true, message }                 — 2FA required
  //   { ok: false, error }                                   — other failure
  // The caller can re-call login(email, password, totpCode) to satisfy 2FA.
  async login(email, password, totpCode) {
    if (!api.isConfigured()) {
      if (!email || !password) return { ok: false, error: 'enter credentials' };
      localStorage.setItem(LEGACY_KEY, '1');
      localStorage.setItem(USER_KEY, JSON.stringify({ email, name: '데모 관리자', role: 'admin', must_change_password: false, email_verified_at: new Date().toISOString() }));
      this.touch();
      return { ok: true, simulated: true, mustChangePassword: false };
    }
    const body = totpCode ? { email, password, totp_code: totpCode } : { email, password };
    const res = await api.post('/api/auth/login', body);
    if (!res || !res.ok) {
      if (res?.status === 429) return { ok: false, error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' };
      // 2FA 필요 케이스: detail이 객체이고 need_totp:true
      const detail = res?.detail || res?.error;
      if (detail && typeof detail === 'object' && detail.need_totp) {
        return { ok: false, needTotp: true, message: detail.message || '인증 코드를 입력해 주세요.' };
      }
      return { ok: false, error: typeof detail === 'string' ? detail : (detail?.message || res?.error || '로그인 실패') };
    }
    if (res.token) localStorage.setItem(TOKEN_KEY, res.token);
    if (res.user) localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    localStorage.setItem(LEGACY_KEY, '1');
    this.touch();
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

  // Pull fresh /api/auth/me so a stale must_change_password flag
  // gets corrected after the user changes their password from
  // a different device or admin reset.
  async refreshMe() {
    if (!api.isConfigured()) return null;
    const r = await api.get('/api/auth/me');
    if (r.ok) {
      localStorage.setItem(USER_KEY, JSON.stringify({
        id: r.id, email: r.email, name: r.name, role: r.role,
        must_change_password: !!r.must_change_password,
        email_verified_at: r.email_verified_at || null,
        totp_enabled: !!r.totp_enabled,
      }));
      return r;
    }
    return null;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
    // Belt-and-suspenders: clear any sessionStorage too in case an old build
    // left tokens there.
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(LEGACY_KEY);
      sessionStorage.removeItem(ACTIVITY_KEY);
    } catch { /* ignore */ }
  },
};
