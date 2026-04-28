// 사용자 페이지(메인 등)에 노출되는 활성 프로모션 배너.
//   - DB('coupons') / DB('promotions')에서 status=active 인 항목을 가져옴
//   - valid_from/valid_to 사이에 있으며 사용 한도가 남은 프로모션만 표시
//   - 운영자가 프로모션을 활성화하면 자동 노출되어 admin↔frontend 연결 검증

import { useEffect, useState } from 'react';
import { DB } from '../lib/db.js';

function isWithin(p) {
  const now = Date.now();
  const from = p.from || p.valid_from;
  const to = p.to || p.valid_to;
  if (from && new Date(from).getTime() > now) return false;
  if (to && new Date(to).getTime() < now) return false;
  if (p.usage_limit && p.usage_count >= p.usage_limit) return false;
  if (p.max && p.uses && Number(p.uses) >= Number(p.max)) return false;
  return true;
}

function isActive(p) {
  const status = (p.status || (p.active ? 'active' : 'paused') || 'active').toLowerCase();
  if (status === 'paused' || status === 'inactive' || status === '비활성' || status === '일시중지') return false;
  return isWithin(p);
}

function loadPromotions() {
  const a = DB.get('coupons') || [];
  const b = DB.get('promotions') || [];
  const merged = [...a, ...b].filter(isActive);
  // De-dupe by code
  const seen = new Set();
  const out = [];
  for (const p of merged) {
    const k = (p.code || p.title || '').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.slice(0, 3);
}

export default function PromotionBanner() {
  const [items, setItems] = useState(() => loadPromotions());

  useEffect(() => {
    const refresh = () => setItems(loadPromotions());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  if (!items.length) return null;
  return (
    <aside aria-label="진행 중인 프로모션" style={{
      background: '#231815', color: '#f6f4f0',
      padding: '10px 24px', fontSize: 13, lineHeight: 1.5,
      display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap',
      letterSpacing: '.02em',
    }}>
      {items.map((p, i) => (
        <span key={i}>
          <strong style={{ color: '#e6c891', marginRight: 6 }}>{(p.title || p.desc || '프로모션')}</strong>
          {p.code && <code style={{ background: 'rgba(255,255,255,.08)', padding: '2px 6px', marginRight: 6, fontSize: 12 }}>{p.code}</code>}
          {p.discount_type === 'percent' || p.type === 'percent'
            ? <span>{p.discount_value || p.value}% 할인</span>
            : (p.discount_type === 'amount' || p.type === 'amount'
              ? <span>{Number(p.discount_value || p.value || 0).toLocaleString('ko')}원 할인</span>
              : null)}
        </span>
      ))}
    </aside>
  );
}
