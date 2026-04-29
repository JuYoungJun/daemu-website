// 발주번호(PO) / 상품번호(SKU) 자동 생성 — 일반적인 ERP 식별자 패턴.
//
// PO  : DM-PO-YYYY-NNNN (예: DM-PO-2026-0042)
// SKU : <CATEGORY>-NNN  (예: BAKERY-001, EVENT-005)
//
// 일련번호는 같은 prefix 의 기존 발주/상품을 스캔해 다음 빈 번호를 찾는다.
// 충돌 시(동시 입력) 다음 번호를 시도하므로 lock-free.

import { DB } from './db.js';

const PO_PREFIX = 'DM-PO';
const PO_RE = /^DM-PO-(\d{4})-(\d{4})$/i;

// 다음 발주번호 — 같은 해의 마지막 일련번호 + 1.
//
// 사용 예: DB.add('orders', { po_no: nextPoNumber(), ... })
// existingOrders 인자 생략 시 DB.get('orders') 자동 사용.
export function nextPoNumber(existingOrders) {
  const orders = existingOrders ?? (DB.get('orders') || []);
  const year = String(new Date().getFullYear());
  let maxSeq = 0;
  for (const o of orders) {
    const m = PO_RE.exec(String(o?.po_no || ''));
    if (!m) continue;
    if (m[1] !== year) continue;
    const seq = parseInt(m[2], 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${PO_PREFIX}-${year}-${nextSeq}`;
}

// 상품 카테고리명을 영문 prefix 로 변환. 한국어 카테고리도 첫 글자만 ASCII 매칭
// 시 정상적인 prefix 가 나오도록 매핑 테이블 + fallback 'PRD'.
const CATEGORY_PREFIX = {
  '베이커리': 'BAKERY', 'bakery': 'BAKERY',
  '음료': 'BEVERAGE', '커피': 'BEVERAGE', 'beverage': 'BEVERAGE',
  '디저트': 'DESSERT', 'dessert': 'DESSERT',
  '메뉴': 'MENU', 'menu': 'MENU',
  '굿즈': 'GOODS', 'goods': 'GOODS',
  '이벤트': 'EVENT', 'event': 'EVENT',
  '쿠폰': 'COUPON', 'coupon': 'COUPON',
  '재료': 'INGREDIENT', '원료': 'INGREDIENT',
  '포장': 'PACKAGING', 'packaging': 'PACKAGING',
};

export function categoryPrefix(categoryName) {
  if (!categoryName) return 'PRD';
  const key = String(categoryName).trim();
  if (CATEGORY_PREFIX[key]) return CATEGORY_PREFIX[key];
  if (CATEGORY_PREFIX[key.toLowerCase()]) return CATEGORY_PREFIX[key.toLowerCase()];
  // ASCII 만 추출 → 대문자 → 5자 컷
  const ascii = key.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
  return ascii || 'PRD';
}

// 다음 SKU — 같은 카테고리(prefix) 의 마지막 일련번호 + 1.
//
// products: [{ category, items: [{ sku, ... }] }, ...] 또는 평탄화된 list.
// 생략 시 DB.get('products') 자동 사용.
export function nextSku(categoryName, products) {
  const prefix = categoryPrefix(categoryName);
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$', 'i');

  const source = products ?? (DB.get('products') || []);
  const items = [];
  if (Array.isArray(source)) {
    for (const c of source) {
      if (Array.isArray(c?.items)) items.push(...c.items);
      else if (c?.sku) items.push(c);
    }
  }

  let maxSeq = 0;
  for (const it of items) {
    const m = re.exec(String(it?.sku || ''));
    if (!m) continue;
    const seq = parseInt(m[1], 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}-${nextSeq}`;
}

// PO 번호인지 검사 — 형식 검증.
export function isPoNumber(value) {
  return PO_RE.test(String(value || ''));
}
