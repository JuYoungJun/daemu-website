// 파트너 포털 상단에 노출되는 공지·이벤트·쿠폰·프로모션 패널.
//
// 데이터 출처:
//   · DB('events')    — 관리자 페이지의 "프로모션" 메뉴 → 이벤트/공지 탭에서 등록
//   · DB('coupons')   — 같은 페이지 → 쿠폰 코드
//   · DB('promotions')— backend 측 promotions(데모 모드는 미사용)
//
// 표시 규칙:
//   · status === 'active' 인 항목만
//   · 쿠폰: from~to 유효기간 내 + 사용량(uses < max) 미달
//   · 이벤트: period 텍스트 그대로 표시 (자유 형식)
//
// 모든 텍스트는 React가 자동 escape — XSS 위험 없음.

import { useEffect, useMemo, useState } from 'react';
import { DB } from '../lib/db.js';

function couponIsLive(c) {
  if ((c.status || 'active') !== 'active') return false;
  const now = Date.now();
  if (c.from && new Date(c.from).getTime() > now) return false;
  if (c.to && new Date(c.to + 'T23:59:59').getTime() < now) return false;
  if (c.max && Number(c.uses || 0) >= Number(c.max)) return false;
  return true;
}
function eventIsLive(e) {
  return (e.status || 'active') === 'active';
}
function promotionIsLive(p) {
  if ((p.status || (p.active ? 'active' : 'paused') || 'active') !== 'active') return false;
  const now = Date.now();
  const from = p.from || p.valid_from;
  const to = p.to || p.valid_to;
  if (from && new Date(from).getTime() > now) return false;
  if (to && new Date(to).getTime() < now) return false;
  if (p.usage_limit && Number(p.usage_count || 0) >= Number(p.usage_limit)) return false;
  return true;
}

function CouponDiscountText(c) {
  if (c.type === 'percent') return `${c.value}% 할인`;
  if (c.type === 'amount')  return `${Number(c.value || 0).toLocaleString('ko')}원 할인`;
  if (c.type === 'bogo')    return '1+1 / 추가 증정';
  return c.value ? `${c.value}` : '특가';
}

export default function PartnerPromotions() {
  const [events, setEvents] = useState(() => DB.get('events') || []);
  const [coupons, setCoupons] = useState(() => DB.get('coupons') || []);
  const [promotions, setPromotions] = useState(() => DB.get('promotions') || []);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const refresh = () => {
      setEvents(DB.get('events') || []);
      setCoupons(DB.get('coupons') || []);
      setPromotions(DB.get('promotions') || []);
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const liveEvents = useMemo(() => events.filter(eventIsLive), [events]);
  const liveCoupons = useMemo(() => coupons.filter(couponIsLive), [coupons]);
  const livePromos = useMemo(() => promotions.filter(promotionIsLive), [promotions]);

  // 모두 비어있으면 패널 자체를 숨김 — 깔끔한 빈 상태
  if (!liveEvents.length && !liveCoupons.length && !livePromos.length) return null;

  const copyCode = (code) => {
    if (!code) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(
        () => { setCopied(code); setTimeout(() => setCopied(''), 1800); },
        () => { /* ignore */ },
      );
    }
  };

  return (
    <div style={{
      background: 'linear-gradient(180deg,#fff8ec 0%,#fdfcfa 100%)',
      border: '1px solid #f0e3c4',
      padding: '20px 22px',
      marginBottom: 28,
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#8c6d2c', marginBottom: 14, fontWeight: 600 }}>
        🎁 파트너 혜택 / 진행 중인 안내
      </div>

      {/* 공지 / 이벤트 */}
      {liveEvents.length > 0 && (
        <div style={{ marginBottom: liveCoupons.length || livePromos.length ? 18 : 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            {liveEvents.slice(0, 6).map((e) => (
              <article key={e.id} style={{
                background: '#fff',
                border: '1px solid #e6e3dd',
                padding: '14px 16px',
                borderLeft: '3px solid ' + (e.type === '이벤트' ? '#b87333' : '#1f5e7c'),
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                  <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: e.type === '이벤트' ? '#b87333' : '#1f5e7c', fontWeight: 600 }}>
                    {e.type || '공지'}
                  </span>
                  {e.period && <span style={{ fontSize: 11, color: '#8c867d' }}>{e.period}</span>}
                </div>
                <div style={{ fontSize: 14, color: '#231815', fontWeight: 500, marginBottom: 4 }}>{e.title}</div>
                {e.body && (
                  <div style={{ fontSize: 12.5, color: '#5a534b', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>
                    {e.body}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {/* 쿠폰 */}
      {liveCoupons.length > 0 && (
        <div style={{ marginBottom: livePromos.length ? 18 : 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#5a534b', fontWeight: 600, marginBottom: 8 }}>
            🎟️ 사용 가능한 쿠폰
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            {liveCoupons.slice(0, 8).map((c) => (
              <button key={c.id} type="button" onClick={() => copyCode(c.code)}
                style={{
                  background: '#231815',
                  color: '#f6f4f0',
                  padding: '14px 16px',
                  border: 'none',
                  borderRadius: 4,
                  textAlign: 'left',
                  cursor: 'pointer',
                  position: 'relative',
                  fontFamily: 'inherit',
                  transition: 'transform .15s ease, box-shadow .15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(35,24,21,.18)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#e6c891', marginBottom: 6 }}>
                  COUPON
                </div>
                <div style={{ fontFamily: "'SF Mono', Menlo, monospace", fontSize: 16, letterSpacing: '.06em', marginBottom: 6 }}>
                  {c.code}
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 18 }}>
                  {CouponDiscountText(c)}
                </div>
                {c.desc && <div style={{ fontSize: 11.5, color: 'rgba(246,244,240,.7)', marginTop: 4, lineHeight: 1.5 }}>{c.desc}</div>}
                <div style={{ marginTop: 8, fontSize: 10.5, letterSpacing: '.04em', color: 'rgba(246,244,240,.55)' }}>
                  {c.to ? `~ ${c.to}까지` : '상시'}
                  {c.max ? ` · ${c.uses || 0}/${c.max} 사용` : ''}
                </div>
                {copied === c.code && (
                  <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 11, color: '#2e7d32', background: '#e7f4e8', padding: '2px 8px', borderRadius: 3 }}>
                    복사됨 ✓
                  </div>
                )}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: '#8c867d', marginTop: 8 }}>
            쿠폰 카드를 클릭하면 코드가 클립보드에 복사됩니다. 발주 시 비고란에 코드를 입력하면 본사 확인 후 적용됩니다.
          </p>
        </div>
      )}

      {/* Backend 프로모션 (있는 경우) */}
      {livePromos.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#5a534b', fontWeight: 600, marginBottom: 8 }}>
            ⭐ 진행 중인 프로모션
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {livePromos.map((p, i) => (
              <span key={p.id || i} style={{
                background: '#fff',
                border: '1px solid #d7d4cf',
                padding: '8px 14px',
                fontSize: 13,
                color: '#2a2724',
              }}>
                <strong style={{ color: '#231815' }}>{p.title || '프로모션'}</strong>
                {p.discount_value && (
                  <span style={{ marginLeft: 8, color: '#b87333' }}>
                    {p.discount_type === 'percent' ? `${p.discount_value}% 할인` :
                     p.discount_type === 'amount' ? `${Number(p.discount_value).toLocaleString('ko')}원 할인` : p.discount_value}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
