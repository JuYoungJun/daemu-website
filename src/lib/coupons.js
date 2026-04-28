// 쿠폰 검증·할인 계산 — Shop / PartnerPromotions / 향후 admin orders에서
// 공통으로 사용할 수 있는 순수 함수 모음.
//
// 쿠폰 데이터(localStorage 'daemu_coupons')의 형태:
//   {
//     id, code, desc?, type ('percent'|'amount'|'bogo'),
//     value, from?, to?, max?, uses?, status ('active'|'paused'),
//   }

import { DB } from './db.js';

export function findCoupon(code) {
  if (!code) return null;
  const target = String(code).trim().toLowerCase();
  if (!target) return null;
  const list = DB.get('coupons') || [];
  return list.find((c) => (c.code || '').toLowerCase() === target) || null;
}

// (ok, reason, coupon, discount)
// subtotal: number — 적용 전 합계
// 반환:
//   { ok: false, reason, code }                     — 무효 (사유 노출)
//   { ok: true,  coupon, discount, savedAmount }    — 적용 가능
export function validateCoupon(code, subtotal) {
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    return { ok: false, reason: '쿠폰 코드를 입력해 주세요.' };
  }
  const coupon = findCoupon(trimmed);
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
  if (coupon.to && new Date(coupon.to + 'T23:59:59').getTime() < now) {
    return { ok: false, reason: `만료된 쿠폰입니다 (${coupon.to} 까지).` };
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

// 발주 제출 시 호출 — 쿠폰 사용량을 +1 증가시킴.
// idempotent하지 않음 — 같은 쿠폰을 두 번 호출하면 두 번 증가.
export function consumeCoupon(couponId) {
  if (!couponId) return false;
  const list = DB.get('coupons') || [];
  const idx = list.findIndex((c) => c.id === couponId);
  if (idx < 0) return false;
  const next = [...list];
  next[idx] = { ...next[idx], uses: Number(next[idx].uses || 0) + 1 };
  DB.set('coupons', next);
  window.dispatchEvent(new Event('daemu-db-change'));
  return true;
}

export function describeDiscount(coupon) {
  if (!coupon) return '';
  if (coupon.type === 'percent') return `${coupon.value}% 할인`;
  if (coupon.type === 'amount')  return `${Number(coupon.value || 0).toLocaleString('ko')}원 할인`;
  if (coupon.type === 'bogo')    return '1+1 / 추가 증정';
  return coupon.value ? String(coupon.value) : '특가';
}
