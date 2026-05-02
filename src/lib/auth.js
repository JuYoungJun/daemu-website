// 어드민 인증 — /api/auth/login + JWT.
//
// 보안 정책:
//  · 토큰은 localStorage 보관 — reload/탭 종료/브라우저 재시작 후에도 유지.
//    명시적 logout, 60분 inactivity 타임아웃, 백엔드 거절(토큰 만료·계정 비활성)
//    셋 중 하나로만 끊긴다.
//  · 인증 호출마다 활동 타임스탬프 갱신. 60분 지나면 isLoggedIn() 이 강제 logout.
//  · 백엔드 JWT TTL 은 12h 지만 프론트가 더 보수적으로 60분 inactivity 적용.
//  · 페이지 이동/F5/공개 페이지 왕복 시에는 자동 logout 하지 않음 — 1인 운영
//    대시보드의 UX 우선. 공용 PC 환경이 필요하면 sessionStorage + beforeunload 로
//    교체.

import { api } from './api.js';

// 브라우저 storage 슬롯 식별자(값 자체가 비밀 아님). _STORAGE_KEY 접미는
// Snyk CWE-547 의 "KEY" 패턴 매칭이 credential 로 오인하지 않게 의도 명시.
const ADMIN_TOKEN_STORAGE_KEY = 'daemu_admin_token';
const ADMIN_USER_STORAGE_KEY = 'daemu_admin_user';
const ADMIN_ACTIVITY_STORAGE_KEY = 'daemu_admin_last_activity';
const ADMIN_LEGACY_FLAG_STORAGE_KEY = 'daemu_admin_auth';
const TOKEN_KEY = ADMIN_TOKEN_STORAGE_KEY;
const USER_KEY = ADMIN_USER_STORAGE_KEY;
const ACTIVITY_KEY = ADMIN_ACTIVITY_STORAGE_KEY;
const LEGACY_KEY = ADMIN_LEGACY_FLAG_STORAGE_KEY;

export const ADMIN_INACTIVITY_MS = 60 * 60 * 1000;

function _now() { return Date.now(); }

// 과거 빌드는 sessionStorage 에 토큰을 보관했음. 빌드 업데이트로 로그인 세션이
// 끊기는 일을 막기 위해 1회 마이그레이션.
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

  touch() {
    if (localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_KEY) === '1') {
      localStorage.setItem(ACTIVITY_KEY, String(_now()));
    }
  },

  // 반환:
  //   { ok: true, mustChangePassword }      — 성공
  //   { ok: false, needTotp: true, message } — 2FA 필요. 호출자가 totpCode 같이 재호출.
  //   { ok: false, error }                   — 그 외 실패
  async login(email, password, totpCode) {
    if (!api.isConfigured()) {
      // 보안 (코드 리뷰 F-3.3, High): production build 에서는 시뮬레이션 admin
      // 진입 차단 — VITE_API_BASE_URL 미설정 = 잘못된 배포로 간주하고 실패.
      // 옛 버전은 아무 값이나 입력하면 admin role 로 진입되는 구조라 외부에
      // URL 노출 시 사고 가능. dev/demo 빌드 (import.meta.env.DEV) 에서만 허용.
      if (import.meta.env.PROD) {
        return {
          ok: false,
          error: '백엔드 연결이 설정되지 않았습니다. 운영자에게 문의하세요.',
        };
      }
      if (!email || !password) return { ok: false, error: 'enter credentials' };
      localStorage.setItem(LEGACY_KEY, '1');
      localStorage.setItem(USER_KEY, JSON.stringify({ email, name: '데모 관리자 (DEV ONLY)', role: 'admin', must_change_password: false, email_verified_at: new Date().toISOString() }));
      this.touch();
      return { ok: true, simulated: true, mustChangePassword: false };
    }
    const body = totpCode ? { email, password, totp_code: totpCode } : { email, password };
    const res = await api.post('/api/auth/login', body);
    if (!res || !res.ok) {
      if (res?.status === 429) return { ok: false, error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' };
      // 2FA 필요 케이스: detail 이 객체이고 need_totp:true.
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
  //
  // Return shape:
  //   { ok: true, ...user }                       — 정상
  //   { ok: false, authFailed: true }             — 401/403 (토큰 만료/무효 → logout)
  //   { ok: false, transient: true, status }      — 5xx / 네트워크 에러
  //                                                 (백엔드 cold-start / 일시 단절 등 → 세션 유지)
  // 호출자는 authFailed 일 때만 logout 해야 함. transient 는 retry 또는 무시.
  async refreshMe() {
    if (!api.isConfigured()) return { ok: false, transient: true };
    const r = await api.get('/api/auth/me');
    if (r.ok) {
      localStorage.setItem(USER_KEY, JSON.stringify({
        id: r.id, email: r.email, name: r.name, role: r.role,
        must_change_password: !!r.must_change_password,
        email_verified_at: r.email_verified_at || null,
        totp_enabled: !!r.totp_enabled,
      }));
      return { ok: true, ...r };
    }
    // 401/403 = 진짜 인증 실패 (토큰 만료/위조/계정 비활성)
    if (r.status === 401 || r.status === 403) {
      return { ok: false, authFailed: true, status: r.status };
    }
    // 그 외 (5xx, 네트워크 에러, status undefined) = 일시적 — 세션 유지
    return { ok: false, transient: true, status: r.status || 0 };
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
