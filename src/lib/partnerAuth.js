// 파트너 인증 — backend Aiven 기반 (`/api/partner-auth/*`).
//
// 정책 (2026-05): 파트너 로그인은 backend Aiven `partners` 테이블 + bcrypt
// password_hash + partner-scoped JWT 로 동작. 어드민 JWT (`daemu_admin_token`) 와
// 완전히 분리되며, 같은 파트너 계정으로 다른 PC / 다른 브라우저에서 들어오면
// 동일한 발주 / 본인 정보를 본다.
//
// localStorage 사용:
//   · daemu_partner_token       — backend 가 발급한 JWT (어드민 token 과 분리)
//   · daemu_partner_session     — 세션 마커 (legacy, 호환)
//   · daemu_partner_logins      — DEV/DEMO 백엔드 미설정 fallback 시드만 보관
//
// 운영(VITE_API_BASE_URL 설정됨)에서는 backend 를 source of truth 로 삼고
// localStorage 시드는 사용하지 않음. 백엔드 미연결 dev/demo 모드에만 옛
// 시드 fallback (`testpartner@daemu.kr` / `daemu1234`) 가 동작.

import { DB } from './db.js';
import { api } from './api.js';

// NOTE: 브라우저 storage key 들 — secret 아님.
const PARTNER_TOKEN_STORAGE_KEY = 'daemu_partner_token';
const PARTNER_USER_STORAGE_KEY = 'daemu_partner_user';
const PARTNER_SESSION_STORAGE_KEY = 'daemu_partner_session';  // legacy alias
const PARTNER_LOGIN_STORAGE_KEY = 'partner_logins';  // dev/demo fallback only

const SESSION_KEY = PARTNER_SESSION_STORAGE_KEY;

function authHeader() {
  try {
    const t = localStorage.getItem(PARTNER_TOKEN_STORAGE_KEY);
    if (!t) return {};
    return { Authorization: `Bearer ${t}` };
  } catch { return {}; }
}

// dev/demo (api 미설정) 모드에서만 사용되는 옛 testpartner 시드.
// 운영에서는 호출되지 않으며 backend 가 source of truth.
function ensureTestPartnerLocalDemo() {
  try {
    const TEST_EMAIL = 'testpartner@daemu.kr';
    const TEST_PW = 'daemu1234';
    const partners = DB.get(PARTNER_LOGIN_STORAGE_KEY) || [];
    const idx = partners.findIndex((p) => (p.email || '').toLowerCase() === TEST_EMAIL);
    if (idx < 0) {
      DB.add(PARTNER_LOGIN_STORAGE_KEY, {
        name: '테스트 파트너',
        person: '테스트 담당자',
        phone: '010-1234-5678',
        email: TEST_EMAIL,
        type: '원두 납품',
        role: '발주 전용',
        active: 'active',
        password: TEST_PW,
        passwordChanged: true,
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString(),
      });
      return;
    }
    const existing = partners[idx];
    const needsRepair =
      existing.password !== TEST_PW ||
      existing.passwordChanged !== true ||
      existing.mustChangePassword !== false ||
      existing.active !== 'active';
    if (needsRepair) {
      DB.update(PARTNER_LOGIN_STORAGE_KEY, existing.id, {
        password: TEST_PW,
        passwordChanged: true,
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString(),
        active: 'active',
      });
      try { window.dispatchEvent(new Event('daemu-db-change')); } catch { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

// dev/demo fallback 시드는 backend 미설정인 경우에만 활성화.
if (!api.isConfigured()) {
  ensureTestPartnerLocalDemo();
}

function defaultPasswordOf(p) {
  if (!p) return 'daemu';
  if (p.phone) return String(p.phone).replace(/\D/g, '').slice(-4) || 'daemu';
  return 'daemu';
}

export const PartnerAuth = {
  /** Backend partner 로그인. backend 미설정 시에만 옛 localStorage fallback 사용. */
  async login({ id, password }) {
    const idTrim = String(id || '').trim();
    if (!idTrim || !password) return { ok: false, reason: 'missing-credentials' };

    if (api.isConfigured()) {
      // backend 가 source of truth.
      const r = await api.post('/api/partner-auth/login', {
        email: idTrim,
        password: String(password),
      }, { skipAuth: true });
      if (r && r.ok && r.token && r.partner) {
        try {
          localStorage.setItem(PARTNER_TOKEN_STORAGE_KEY, r.token);
          localStorage.setItem(PARTNER_USER_STORAGE_KEY, JSON.stringify(r.partner));
          localStorage.setItem(SESSION_KEY, String(r.partner.id));
        } catch { /* ignore */ }
        // adapter shape — Partners.jsx 가 partner.name / partner.email 등 사용.
        const mustChange = !!r.partner.must_change_password;
        const partner = {
          id: r.partner.id,
          name: r.partner.company_name || r.partner.email || '',
          person: r.partner.contact_name || '',
          email: r.partner.email || '',
          phone: r.partner.phone || '',
          type: r.partner.category || '',
          status: r.partner.status || '',
          active: 'active',
          must_change_password: mustChange,
          _backend: true,
        };
        // 옛 캐시된 sync LoginForm 회귀 방어 — 호출자가 await 안 해도 backend
        // 가 200 받은 시점에 Partners.jsx 의 useEffect onChange 가 발화해
        // 자동으로 ForcePasswordChange / Portal 화면으로 진입하도록.
        try { window.dispatchEvent(new Event('daemu-db-change')); } catch { /* ignore */ }
        return { ok: true, partner, mustChangePassword: mustChange };
      }
      const reason = r && r.status === 401 ? 'bad-credentials'
        : r && r.status === 429 ? 'throttled'
        : r && r.status === 503 ? 'db-unavailable'
        : 'login-failed';
      return { ok: false, reason, error: r && r.error };
    }

    // backend 미설정 — 옛 localStorage 시드만 사용 (dev/demo).
    const partners = DB.get(PARTNER_LOGIN_STORAGE_KEY);
    const match = partners.find((p) => {
      if ((p.active || 'active') !== 'active') return false;
      const candidates = [p.email, p.phone, p.person, p.name].filter(Boolean).map(String);
      return candidates.includes(idTrim);
    });
    if (!match) return { ok: false, reason: 'not-found' };
    const expected = match.password || defaultPasswordOf(match);
    if (String(password) !== String(expected)) return { ok: false, reason: 'bad-password' };
    try { localStorage.setItem(SESSION_KEY, String(match.id)); } catch { /* ignore */ }
    const stillDefault = !match.password || String(match.password) === defaultPasswordOf(match);
    return { ok: true, partner: match, mustChangePassword: stillDefault || match.mustChangePassword !== false };
  },

  logout() {
    try {
      localStorage.removeItem(PARTNER_TOKEN_STORAGE_KEY);
      localStorage.removeItem(PARTNER_USER_STORAGE_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
    // backend 측 logout 은 stateless 라 별도 호출 불필요.
  },

  /** 현재 로그인된 파트너 정보. backend token 우선, 없으면 dev/demo localStorage. */
  current() {
    try {
      const token = localStorage.getItem(PARTNER_TOKEN_STORAGE_KEY);
      const userStr = localStorage.getItem(PARTNER_USER_STORAGE_KEY);
      if (token && userStr) {
        const u = JSON.parse(userStr);
        return {
          id: u.id,
          name: u.company_name || u.email || '',
          person: u.contact_name || '',
          email: u.email || '',
          phone: u.phone || '',
          type: u.category || '',
          status: u.status || '',
          active: 'active',
          // 새로고침 후에도 첫 로그인 강제 변경 화면이 자동으로 뜨도록
          // login 응답에서 받은 must_change_password 를 그대로 surface.
          must_change_password: !!u.must_change_password,
          _backend: true,
        };
      }
    } catch { /* ignore */ }

    // backend 토큰 없음 → dev/demo localStorage 시드 fallback.
    try {
      const id = localStorage.getItem(SESSION_KEY);
      if (!id) return null;
      const p = DB.get(PARTNER_LOGIN_STORAGE_KEY).find((x) => String(x.id) === String(id));
      if (!p || (p.active || 'active') !== 'active') {
        try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
        return null;
      }
      return p;
    } catch { return null; }
  },

  /** 비밀번호 변경 화면이 떠야 하는지.
   *  · backend partner — login 응답 / /me 의 must_change_password 사용.
   *  · dev/demo 시드 — 옛 passwordChanged 플래그 + default phone-last4 비교. */
  needsPasswordChange(partner) {
    if (!partner) return false;
    if (partner._backend) return !!partner.must_change_password;
    if (partner.passwordChanged === true) return false;
    return !partner.password || String(partner.password) === defaultPasswordOf(partner);
  },

  /** 본인 비밀번호 변경.
   *  backend partner: POST /api/partner-auth/change-password (partner JWT 필요).
   *  dev/demo: 옛 localStorage 시드 직접 갱신.
   */
  async changePassword({ partnerId, currentPassword, newPassword }) {
    if (!newPassword || String(newPassword).length < 8) {
      return { ok: false, reason: 'too-short', error: '새 비밀번호는 8자 이상이어야 합니다.' };
    }
    if (api.isConfigured()) {
      const r = await api.post('/api/partner-auth/change-password', {
        current_password: String(currentPassword || ''),
        new_password: String(newPassword),
      });
      if (r && r.ok) {
        // 캐시된 partner user 의 must_change_password 도 false 로 갱신.
        try {
          const raw = localStorage.getItem(PARTNER_USER_STORAGE_KEY);
          if (raw) {
            const u = JSON.parse(raw);
            u.must_change_password = false;
            localStorage.setItem(PARTNER_USER_STORAGE_KEY, JSON.stringify(u));
          }
        } catch { /* ignore */ }
        try { window.dispatchEvent(new Event('daemu-db-change')); } catch { /* ignore */ }
        return { ok: true };
      }
      return {
        ok: false,
        reason: r && r.status === 401 ? 'bad-current' : 'change-failed',
        error: (r && r.error) || '비밀번호 변경에 실패했습니다.',
      };
    }
    // dev/demo fallback
    DB.update(PARTNER_LOGIN_STORAGE_KEY, Number(partnerId), {
      password: String(newPassword),
      passwordChanged: true,
      passwordUpdatedAt: new Date().toISOString(),
    });
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch { /* ignore */ }
    return { ok: true };
  },

  signup(application) {
    // 신규 파트너 신청 — 어드민이 `/admin/partners` 에서 승인 후 backend
    // partner-auth 비밀번호를 별도 발급. 본 함수는 dev/demo 시드로만 동작.
    const phone4 = application.phone ? String(application.phone).replace(/\D/g, '').slice(-4) : '';
    DB.add(PARTNER_LOGIN_STORAGE_KEY, {
      name: application.company || application.name || '',
      person: application.person || '',
      phone: application.phone || '',
      email: application.email || '',
      type: application.type || '',
      role: '발주 전용',
      active: 'inactive',
      note: application.message || '',
      password: phone4 || 'daemu',
      passwordChanged: false,
      pendingSignup: true
    });
  },

  /** partner-scoped Authorization header — partner-scoped 엔드포인트 호출에 사용. */
  authHeader,
};

export function defaultPasswordHint(partner) {
  return defaultPasswordOf(partner);
}
