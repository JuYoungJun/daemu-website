// 파트너 포털 상단에 노출되는 공지·프로모션 패널.
//
// 데이터 출처 (모두 backend Aiven — single source of truth):
//   · GET /api/promotions/visible                            — 활성 프로모션
//   · GET /api/announcements/visible?target=partner_portal   — 어드민 공지
//
// 사용자 정책: 쿠폰/공지 = partner portal 외 노출 금지. 본 컴포넌트는
// PartnerPortal 안에서만 마운트되므로 정책 준수.
//
// 갱신 트리거:
//   · mount 시 1회 backend fetch
//   · daemu-db-change 이벤트
//   · visibilitychange 시 즉시
//   · visible 일 때만 60s 폴링
//
// 모든 텍스트는 React 가 자동 escape — XSS 위험 없음.
//
// 주: 옛 DB('events') / DB('coupons') localStorage 시드 의존 제거됨
// (시드 자체가 어디에서도 add 되지 않아 항상 빈 배열 — dead UI 였음).
// 그쪽 데이터가 필요하면 어드민 /admin/announcements (kind=promo) 또는
// /admin/promotion (쿠폰) 으로 backend 등록.

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

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

export default function PartnerPromotions() {
  const [promotions, setPromotions] = useState([]);
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    let alive = true;
    const fetchBackend = async () => {
      if (!alive) return;
      if (!api.isConfigured()) {
        setPromotions([]); setAnnouncements([]);
        return;
      }
      const [pr, ar] = await Promise.all([
        api.get('/api/promotions/visible'),
        api.get('/api/announcements/visible?target=partner_portal'),
      ]);
      if (!alive) return;
      if (pr && pr.ok && Array.isArray(pr.items)) setPromotions(pr.items);
      if (ar && ar.ok && Array.isArray(ar.items)) setAnnouncements(ar.items);
      // 실패 시 setX 호출 안 함 → 직전 정상 값 유지 (fake zero 방지).
    };
    fetchBackend();
    const onChange = () => { fetchBackend(); };
    window.addEventListener('daemu-db-change', onChange);
    const id = setInterval(() => {
      if (alive && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchBackend();
      }
    }, 60_000);
    const onVis = () => {
      if (alive && typeof document !== 'undefined' && !document.hidden) fetchBackend();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.removeEventListener('daemu-db-change', onChange);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
    };
  }, []);

  const livePromos = promotions.filter(promotionIsLive);
  // backend visible endpoint 가 이미 active + 스케줄 + 만료를 server-side 에서
  // 걸러주므로 frontend 는 받은 그대로 표시.
  const liveAnnouncements = announcements;

  // 모두 비어있으면 패널 자체 숨김.
  if (!livePromos.length && !liveAnnouncements.length) return null;

  return (
    <div style={{
      background: 'linear-gradient(180deg,#fff8ec 0%,#fdfcfa 100%)',
      border: '1px solid #f0e3c4',
      padding: '20px 22px',
      marginBottom: 28,
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#8c6d2c', marginBottom: 14, fontWeight: 600 }}>
        파트너 혜택 / 진행 중인 안내
      </div>

      {/* backend 공지 / 프로모션 (admin /admin/announcements 등록) — 가장 위 노출 */}
      {liveAnnouncements.length > 0 && (
        <div style={{ marginBottom: livePromos.length ? 18 : 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            {liveAnnouncements.slice(0, 6).map((a) => {
              const accent = a.kind === 'urgent' ? '#c64a3b' : (a.kind === 'promo' ? '#b87333' : '#1f5e7c');
              const label = a.kind === 'urgent' ? '긴급' : (a.kind === 'promo' ? '프로모션' : '공지');
              const ctaSafe = a.cta_href && /^https?:\/\//i.test(a.cta_href);
              return (
                <article key={'ann-' + a.id} style={{
                  background: '#fff',
                  border: '1px solid #e6e3dd',
                  padding: '14px 16px',
                  borderLeft: '3px solid ' + accent,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                    <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: accent, fontWeight: 600 }}>
                      {label}
                    </span>
                    {(a.scheduled_start || a.scheduled_end) && (
                      <span style={{ fontSize: 11, color: '#8c867d' }}>
                        {a.scheduled_start ? String(a.scheduled_start).slice(0, 10) : ''}
                        {(a.scheduled_start && a.scheduled_end) ? ' ~ ' : ''}
                        {a.scheduled_end ? String(a.scheduled_end).slice(0, 10) : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: '#231815', fontWeight: 500, marginBottom: 4 }}>{a.title}</div>
                  {a.body && (
                    <div style={{ fontSize: 12.5, color: '#5a534b', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>
                      {a.body}
                    </div>
                  )}
                  {ctaSafe && a.cta_label && (
                    <a href={a.cta_href} target="_blank" rel="noopener noreferrer"
                       style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: accent, fontWeight: 500, textDecoration: 'underline' }}>
                      {a.cta_label} →
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Backend 프로모션 (있는 경우) */}
      {livePromos.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#5a534b', fontWeight: 600, marginBottom: 8 }}>
            진행 중인 프로모션
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
                     p.discount_type === 'amount' ? `${Number(p.discount_value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}원 할인` : p.discount_value}
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
