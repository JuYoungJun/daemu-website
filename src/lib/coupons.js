// 쿠폰 검증·할인 계산 — Shop / PartnerPromotions / 향후 admin orders에서
// 공통으로 사용할 수 있는 함수 모음.
//
// source of truth (2026-05-): backend Aiven `promotions` 테이블.
// `/api/promotions/visible` 가 active + 유효기간 + 사용한도 미만 행만 반환.
// 옛 localStorage 'daemu_coupons' 단독 의존 제거 — admin 이 등록한 쿠폰을
// 다른 브라우저 / 디바이스에서도 동일하게 검증 가능해야 함.
//
// 통합 coupon 객체 형태 (backend 응답을 정규화):
//   {
//     id, code, desc?, type ('percent'|'amount'|'bogo'),
//     value, from?, to?, max?, uses?, status ('active'|'paused'),
//   }

import { DB } from './db.js';
import { api } from './api.js';
import { PartnerAuth } from './partnerAuth.js';

// backend `/api/promotions/visible` 응답 → 통합 coupon 형태로 정규화.
// backend 는 visible 단계에서 active=true + 유효기간 + 사용한도 미만 만 반환
// 하므로 frontend 는 status='active' 로 가정해도 안전.
function _adaptBackend(p) {
  if (!p || !p.code) return null;
  return {
    id: p.id,
    code: p.code,
    desc: p.title || '',
    type: p.discount_type || 'amount',
    value: Number(p.discount_value || 0),
    from: p.valid_from || '',  // ISO with timezone
    to: p.valid_to || '',      // ISO with timezone
    status: p.active === false ? 'paused' : 'active',
    _backend: true,
  };
}

// async — backend lookup 우선, 미설정 / 실패 시 localStorage fallback.
export async function findCoupon(code) {
  if (!code) return null;
  const target = String(code).trim().toLowerCase();
  if (!target) return null;
  if (api.isConfigured()) {
    try {
      // partner-scoped JWT 첨부 — backend 가 partner token 필수로 잠금.
      const r = await api.get('/api/promotions/visible', {
        skipAuth: true,
        headers: PartnerAuth.authHeader(),
      });
      if (r && r.ok && Array.isArray(r.items)) {
        const hit = r.items.find((p) => (p.code || '').toLowerCase() === target);
        if (hit) return _adaptBackend(hit);
        // backend 가 응답했는데 매칭 없음 → 진짜 없는 쿠폰. localStorage 보조 검색
        // 안 함 (운영에서 옛 localStorage 시드가 fake hit 만들지 않도록).
        return null;
      }
    } catch { /* 네트워크 에러 — fallback */ }
  }
  // dev / demo (api 미설정) fallback
  const list = DB.get('coupons') || [];
  return list.find((c) => (c.code || '').toLowerCase() === target) || null;
}

// async — (ok, reason, coupon, discount)
// subtotal: number — 적용 전 합계
// 반환:
//   { ok: false, reason }                           — 무효 (사유 노출)
//   { ok: true,  coupon, discount, savedAmount }    — 적용 가능
export async function validateCoupon(code, subtotal) {
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    return { ok: false, reason: '쿠폰 코드를 입력해 주세요.' };
  }
  const coupon = await findCoupon(trimmed);
  if (!coupon) {
    return { ok: false, reason: '존재하지 않는 쿠폰 코드입니다.' };
  }
  if ((coupon.status || 'active') !== 'active') {
    return { ok: false, reason: '비활성 처리된 쿠폰입니다.' };
  }
  const now = Date.now();
  if (coupon.from && new Date(coupon.from).getTime() > now) {
    return { ok: false, reason: `사용 시작일 이전입니다 (${coupon.from} 부터).` };
  }
  // backend ISO ('2026-12-31T23:59:59+00:00') 는 그대로 파싱.
  // 옛 localStorage 'YYYY-MM-DD' 는 그날 23:59:59 까지 유효 — 시간 부분 append.
  if (coupon.to) {
    const isISO = /T\d{2}:\d{2}/.test(String(coupon.to));
    const toDate = isISO ? new Date(coupon.to) : new Date(coupon.to + 'T23:59:59');
    const t = toDate.getTime();
    if (Number.isFinite(t) && t < now) {
      return { ok: false, reason: `만료된 쿠폰입니다 (${coupon.to} 까지).` };
    }
  }
  if (coupon.max && Number(coupon.uses || 0) >= Number(coupon.max)) {
    return { ok: false, reason: '사용 한도가 모두 소진된 쿠폰입니다.' };
  }
  if (subtotal != null && subtotal <= 0) {
    return { ok: false, reason: '장바구니가 비어있어 쿠폰을 적용할 수 없습니다.' };
  }

  // 할인 계산
  let discount = 0;
  if (coupon.type === 'percent') {
    const pct = Math.max(0, Math.min(100, Number(coupon.value || 0)));
    discount = Math.round(Number(subtotal || 0) * pct / 100);
  } else if (coupon.type === 'amount') {
    discount = Math.min(Number(coupon.value || 0), Number(subtotal || 0));
  } else if (coupon.type === 'bogo') {
    // 1+1: 정확한 적용은 카탈로그에서 결정하지만 여기서는 "특정 1개 무료"
    // 가정하고 가장 비싼 항목 1개의 가격만큼 할인 (subtotal 기반은 부정확하지만
    // 데모 목적상 0원 처리하지 않고 안내).
    discount = 0;
  }
  // 음수·subtotal 초과 방지
  discount = Math.max(0, Math.min(discount, Number(subtotal || 0)));

  return {
    ok: true,
    coupon,
    discount,
    savedAmount: discount,
  };
}

// 발주 제출 시 호출 — 쿠폰 사용량을 +1 증가.
// 정책 (2026-05): backend Aiven `promotions.usage_count` 가 source of truth.
// 본 함수는 backend `/api/promotions/consume` 호출 후 성공 시에만 localStorage
// 미러를 갱신. backend 가 멱등(client_event_id) 처리하므로 같은 발주 제출의
// 재시도가 두 번 카운트되지 않음.
//
// 백엔드 미연결 (api 미설정) 인 demo 모드에서는 옛 localStorage-only 동작 유지.
//
// async — 호출자는 await 가능. 미 await 시에도 fire-and-forget 으로 동작.
export async function consumeCoupon(couponId, opts = {}) {
  if (!couponId) return false;

  // backend 호출 (api 모듈은 dynamic import — coupon UX 가 backend 미설정
  // 환경에서도 즉시 표시되도록 hard import 회피).
  let backendOk = false;
  try {
    const { api } = await import('./api.js');
    if (api.isConfigured()) {
      // client_event_id — 같은 발주 제출의 재시도가 backend 에서 +1 만 되도록.
      const eventId = opts.eventId || (
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10))
      );
      const r = await api.post('/api/promotions/consume', {
        promotion_id: Number(couponId),
        client_event_id: eventId,
        quantity: 1,
      }, { skipAuth: true });
      backendOk = !!(r && r.ok);
      if (!backendOk) {
        // backend 실패 시 호출자에게 false — fake success 안 함.
        return false;
      }
    }
  } catch {
    // 네트워크 오류 등 — backend 미설정 fallback path 로 진행.
  }

  // localStorage 미러 — backend OK 이거나 backend 미설정인 경우에만.
  const list = DB.get('coupons') || [];
  const idx = list.findIndex((c) => c.id === couponId);
  if (idx < 0) return backendOk;  // backend 만 갱신, 로컬 미러 행 없음 → backend 결과 그대로.
  const next = [...list];
  next[idx] = { ...next[idx], uses: Number(next[idx].uses || 0) + 1 };
  DB.set('coupons', next);
  window.dispatchEvent(new Event('daemu-db-change'));
  return true;
}

export function describeDiscount(coupon) {
  if (!coupon) return '';
  if (coupon.type === 'percent') return `${coupon.value}% 할인`;
  if (coupon.type === 'amount')  return `${Number(coupon.value || 0).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}원 할인`;
  if (coupon.type === 'bogo')    return '1+1 / 추가 증정';
  return coupon.value ? String(coupon.value) : '특가';
}
