// Partner accounts live in localStorage keys:
//  - daemu_partners        : partner records (admin-managed)
//  - daemu_partner_session : currently logged-in partner id

import { DB } from './db.js';

const SESSION_KEY = 'daemu_partner_session';

// 데모/QA 편의를 위해 첫 방문 시 테스트 파트너 계정을 1회만 시드합니다.
// 본 시드는 idempotent — 같은 이메일이 이미 있으면 다시 만들지 않음.
// 운영 환경에서는 시드된 계정을 admin /admin/partners 에서 삭제하거나
// 비활성으로 두면 됩니다.
function ensureTestPartner() {
  try {
    const partners = DB.get('partners') || [];
    const TEST_EMAIL = 'testpartner@daemu.kr';
    if (partners.some((p) => (p.email || '').toLowerCase() === TEST_EMAIL)) return;
    DB.add('partners', {
      name: '테스트 파트너',
      person: '테스트 담당자',
      phone: '010-1234-5678',
      email: TEST_EMAIL,
      type: '원두 납품',
      role: '발주 전용',
      active: 'active',                           // 즉시 로그인 가능
      note: '테스트용 임시 파트너 계정 — 운영 시 /admin/partners 에서 비활성화/삭제하세요.',
      password: 'daemu1234',                      // QA 편의를 위한 명시 비번
      passwordChanged: true,                      // 첫 로그인 강제 변경 화면 우회
      passwordUpdatedAt: new Date().toISOString(),
    });
  } catch (e) { /* ignore — DB 미설정 환경 */ }
}
ensureTestPartner();

// Default password is phone last 4 digits — fallback "daemu" if no phone.
function defaultPasswordOf(p) {
  if (!p) return 'daemu';
  if (p.phone) return String(p.phone).replace(/\D/g, '').slice(-4) || 'daemu';
  return 'daemu';
}

export const PartnerAuth = {
  login({ id, password }) {
    const partners = DB.get('partners');
    const match = partners.find((p) => {
      if ((p.active || 'active') !== 'active') return false;
      const candidates = [p.email, p.phone, p.person, p.name].filter(Boolean).map(String);
      return candidates.includes(String(id || '').trim());
    });
    if (!match) return { ok: false, reason: 'not-found' };

    const expected = match.password || defaultPasswordOf(match);
    if (String(password) !== String(expected)) return { ok: false, reason: 'bad-password' };

    localStorage.setItem(SESSION_KEY, String(match.id));
    // Determine if this is still the default password (no custom set yet)
    const stillDefault = !match.password || String(match.password) === defaultPasswordOf(match);
    return { ok: true, partner: match, mustChangePassword: stillDefault || match.mustChangePassword !== false };
  },

  logout() { localStorage.removeItem(SESSION_KEY); },

  current() {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    const p = DB.get('partners').find((x) => String(x.id) === String(id));
    if (!p || (p.active || 'active') !== 'active') {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return p;
  },

  // Returns true if partner needs to change password before continuing.
  needsPasswordChange(partner) {
    if (!partner) return false;
    if (partner.passwordChanged === true) return false;
    // No custom password set, or password equals default
    return !partner.password || String(partner.password) === defaultPasswordOf(partner);
  },

  changePassword(partnerId, newPassword) {
    if (!newPassword || String(newPassword).length < 4) {
      return { ok: false, reason: 'too-short' };
    }
    DB.update('partners', Number(partnerId), {
      password: String(newPassword),
      passwordChanged: true,
      passwordUpdatedAt: new Date().toISOString()
    });
    window.dispatchEvent(new Event('daemu-db-change'));
    return { ok: true };
  },

  signup(application) {
    const phone4 = application.phone ? String(application.phone).replace(/\D/g, '').slice(-4) : '';
    DB.add('partners', {
      name: application.company || application.name || '',
      person: application.person || '',
      phone: application.phone || '',
      email: application.email || '',
      type: application.type || '',
      role: '발주 전용',
      active: 'inactive', // pending approval
      note: application.message || '',
      password: phone4 || 'daemu',
      passwordChanged: false,
      pendingSignup: true
    });
  }
};

export function defaultPasswordHint(partner) {
  return defaultPasswordOf(partner);
}
