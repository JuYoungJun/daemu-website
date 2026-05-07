// 재고(stock) 추적 — 상품의 stock 필드를 기준으로 차감/증감을 관리.
//
// 데이터 위치:
//   localStorage 'daemu_products' = [{ category, items: [{ sku, name, stock, ... }] }]
//
// 정책:
//   · 음수 재고 허용 안 함. 차감 시 재고가 부족하면 실패 반환(요청 수량은 차감 안 됨).
//   · 모든 변경은 'daemu_stock_ledger' 에 한 줄씩 기록 — 어떤 사용자가 언제
//     어떤 SKU 를 얼마만큼 차감/충전했는지 추적 가능. 마지막 500건 보관.
//   · 변경 후 'daemu-db-change' 이벤트 dispatch 로 모니터링/상품 페이지 자동 갱신.

import { DB } from './db.js';

const PRODUCTS_KEY = 'products';
const LEDGER_KEY = 'daemu_stock_ledger';
const LEDGER_MAX = 500;

// 재고 부족 임계 — 이 값보다 적으면 "재고 부족" 으로 분류.
export const LOW_STOCK_THRESHOLD = 10;

function loadProducts() { return DB.get(PRODUCTS_KEY) || []; }
function saveProducts(catalog) { DB.set(PRODUCTS_KEY, catalog); }

function logLedger(entry) {
  try {
    const log = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
    log.unshift({ ts: new Date().toISOString(), ...entry });
    localStorage.setItem(LEDGER_KEY, JSON.stringify(log.slice(0, LEDGER_MAX)));
  } catch { /* ignore */ }
}

// 한 SKU 의 현재 재고 조회. 없으면 null.
export function getStock(sku) {
  if (!sku) return null;
  for (const cat of loadProducts()) {
    const it = (cat.items || []).find((x) => x.sku === sku);
    if (it) return Number(it.stock) || 0;
  }
  return null;
}

// 차감 — sku 의 stock 을 qty 만큼 감소. 재고 부족이면 false 반환.
// reason 은 ledger 에 기록되는 사유(예: 'order:#0042', 'shrinkage', ...).
export function decrementStock(sku, qty, reason = '') {
  const n = Math.max(0, Number(qty) || 0);
  if (!sku || n <= 0) return { ok: false, error: 'invalid input' };
  const catalog = loadProducts();
  for (const cat of catalog) {
    const it = (cat.items || []).find((x) => x.sku === sku);
    if (!it) continue;
    const current = Number(it.stock) || 0;
    if (current < n) {
      return { ok: false, error: 'insufficient stock', sku, current, requested: n };
    }
    it.stock = current - n;
    saveProducts(catalog);
    logLedger({ kind: 'decrement', sku, qty: n, before: current, after: it.stock, reason });
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch { /* ignore */ }
    return { ok: true, sku, before: current, after: it.stock };
  }
  return { ok: false, error: 'sku not found', sku };
}

// 증감(충전·재입고). 음수도 허용해 +/- 양방향 조정.
export function adjustStock(sku, delta, reason = '') {
  const d = Math.trunc(Number(delta));
  if (!sku || !Number.isFinite(d) || d === 0) return { ok: false, error: 'invalid input' };
  const catalog = loadProducts();
  for (const cat of catalog) {
    const it = (cat.items || []).find((x) => x.sku === sku);
    if (!it) continue;
    const current = Number(it.stock) || 0;
    const next = Math.max(0, current + d);
    it.stock = next;
    saveProducts(catalog);
    logLedger({ kind: d > 0 ? 'restock' : 'adjust', sku, qty: Math.abs(d), before: current, after: next, reason });
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch { /* ignore */ }
    return { ok: true, sku, before: current, after: next };
  }
  return { ok: false, error: 'sku not found', sku };
}

// 사이트 전체 재고 요약 — 모니터링 KPI 용.
//
// 정책 (2026-05): backend Aiven `products` 가 source of truth. 운영에서
// localStorage 'products' 카탈로그는 비어있어 옛 동기 stockSummary() 가 항상
// 0 만 반환했음 → backend `/api/products` 로 전환.
// async 함수 — 호출자는 await 필요. backend 미설정(dev/demo) 시는 옛
// localStorage fallback 그대로 동작.
export async function stockSummary() {
  // dynamic import — 운영 외 페이지 로드 시 api 모듈 로드 회피.
  let api;
  try { ({ api } = await import('./api.js')); } catch { /* ignore */ }
  if (api && api.isConfigured && api.isConfigured()) {
    const r = await api.get('/api/products?page_size=500');
    if (r && r.ok && Array.isArray(r.items)) {
      let total = 0;
      const low = [];
      const out = [];
      for (const p of r.items) {
        const s = Number(p.stock_count || 0);
        total += s;
        const cat = String(p.category_code || p.category || '');
        const entry = { sku: p.sku, name: p.name, category: cat };
        if (s === 0) out.push(entry);
        else if (s < (Number(p.low_stock_threshold) || LOW_STOCK_THRESHOLD)) low.push({ ...entry, stock: s });
      }
      return { totalUnits: total, lowStock: low, outOfStock: out };
    }
    // backend 호출 실패 — 빈 통계 반환 (옛 localStorage 무시).
    return { totalUnits: 0, lowStock: [], outOfStock: [] };
  }
  // dev / demo (api 미설정) 옛 localStorage fallback.
  const catalog = loadProducts();
  let total = 0;
  const lowStockSkus = [];
  const outOfStockSkus = [];
  for (const cat of catalog) {
    for (const it of (cat.items || [])) {
      const s = Number(it.stock) || 0;
      total += s;
      if (s === 0) outOfStockSkus.push({ sku: it.sku, name: it.name, category: cat.category });
      else if (s < LOW_STOCK_THRESHOLD) lowStockSkus.push({ sku: it.sku, name: it.name, category: cat.category, stock: s });
    }
  }
  return { totalUnits: total, lowStock: lowStockSkus, outOfStock: outOfStockSkus };
}

// 최근 ledger 항목 — 모니터링 활동 타임라인 용.
export function recentLedger(limit = 30) {
  try {
    const log = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
    return log.slice(0, limit);
  } catch { return []; }
}
