// Partner accounts live in localStorage keys:
//  - daemu_partners        : partner records (admin-managed)
//  - daemu_partner_session : currently logged-in partner id

import { DB } from './db.js';

const SESSION_KEY = 'daemu_partner_session';

// 데모/QA 편의를 위해 첫 방문 시 테스트 파트너 계정을 시드합니다.
// 본 시드는 두 단계로 동작합니다:
//   1) 이메일이 일치하는 행이 없으면 새로 추가 (필수 필드 모두 채움)
//   2) 이미 있으면 password / passwordChanged를 강제로 갱신해 비번 변경
//      화면이 뜨지 않도록 보장. 이전 빌드에서 시드된 행이
//      passwordChanged 플래그 없이 들어가 있던 케이스를 매 부팅마다 정상화.
// 운영 환경에서는 시드된 계정을 admin /admin/partners 에서 비활성화하면 됩니다.
function ensureTestPartner() {
  try {
    const TEST_EMAIL = 'testpartner@daemu.kr';
    const TEST_PW = 'daemu1234';
    const partners = DB.get('partners') || [];
    const idx = partners.findIndex((p) => (p.email || '').toLowerCase() === TEST_EMAIL);

    if (idx < 0) {
      DB.add('partners', {
        name: '테스트 파트너',
        person: '테스트 담당자',
        phone: '010-1234-5678',
        email: TEST_EMAIL,
        type: '원두 납품',
        role: '발주 전용',
        active: 'active',
        note: '테스트용 임시 파트너 계정 — 운영 시 /admin/partners 에서 비활성화/삭제하세요.',
        password: TEST_PW,
        passwordChanged: true,
        // PartnerAuth.login() 의 83번째 줄이 `mustChangePassword !== false`를
        // 검사하므로 반드시 명시적 false 가 필요. undefined 면 true 로 평가됨.
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString(),
      });
      return;
    }

    // 기존 행의 비번/플래그를 강제 정상화 — 이전 빌드 시드된 잔존 데이터에
    // passwordChanged / mustChangePassword 플래그가 빠져 있어 매 로그인마다
    // 변경 화면이 뜨던 문제 해결.
    const existing = partners[idx];
    const needsRepair =
      existing.password !== TEST_PW ||
      existing.passwordChanged !== true ||
      existing.mustChangePassword !== false ||
      existing.active !== 'active';
    if (needsRepair) {
      DB.update('partners', existing.id, {
        password: TEST_PW,
        passwordChanged: true,
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString(),
        active: 'active',
      });
      window.dispatchEvent(new Event('daemu-db-change'));
    }
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
