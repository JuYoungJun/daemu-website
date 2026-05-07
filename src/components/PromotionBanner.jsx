// 사용자 페이지(메인 등) 상단의 활성 프로모션 배너.
//
// source of truth = backend Aiven `promotions` (active + valid_from/valid_to
// 범위 내 + usage_limit 미만) — `/api/promotions/visible` 가 인증 없이 공개
// 행만 반환. 옛 demo-mode 의 `DB.get('coupons')` / `DB.get('promotions')`
// localStorage 시드 의존은 완전 제거 — 다른 브라우저/디바이스에서도 동일 데이터.
//
// 갱신 트리거 (near real-time):
//   · mount 시 1회
//   · 같은 탭 내 mutation → daemu-db-change 이벤트
//   · 탭 복귀(visibilitychange) 시 즉시 1회
//   · visible 일 때만 60s 폴링
// 백엔드 미연결(VITE_API_BASE_URL 미설정) 또는 호출 실패 시 *직전 정상 값
// 유지* — fake 한 demo fall-back 없음.

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function PromotionBanner() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    const fetchPromotions = async () => {
      if (!api.isConfigured()) { if (alive) setItems([]); return; }
      const r = await api.get('/api/promotions/visible');
      if (!alive) return;
      if (r && r.ok && Array.isArray(r.items)) setItems(r.items.slice(0, 3));
      // 실패 시 setItems 호출 안 함 → 직전 정상 값 유지 (fake zero 방지).
    };
    fetchPromotions();
    const onChange = () => { if (alive) fetchPromotions(); };
    window.addEventListener('daemu-db-change', onChange);
    const id = setInterval(() => {
      if (alive && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchPromotions();
      }
    }, 60_000);
    const onVis = () => {
      if (alive && typeof document !== 'undefined' && !document.hidden) fetchPromotions();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.removeEventListener('daemu-db-change', onChange);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
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
      {items.map((p) => (
        <span key={p.id}>
          <strong style={{ color: '#e6c891', marginRight: 6 }}>{p.title || '프로모션'}</strong>
          {p.code && <code style={{ background: 'rgba(255,255,255,.08)', padding: '2px 6px', marginRight: 6, fontSize: 12 }}>{p.code}</code>}
          {p.discount_type === 'percent'
            ? <span>{Number(p.discount_value || 0)}% 할인</span>
            : (p.discount_type === 'amount'
              ? <span>{Number(p.discount_value || 0).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}원 할인</span>
              : null)}
        </span>
      ))}
    </aside>
  );
}
