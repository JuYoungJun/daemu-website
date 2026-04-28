// 마케팅 분석 — 자체 client-side 집계.
//
// 데이터 출처: localStorage 'daemu_analytics_events' (marketingAnalytics.js 가
// 사용자 브라우저별로 수집해 둔 30일치 이벤트).
//
// 한계:
//   · 사용자 본인 브라우저에서 수집된 이벤트만 보임 (admin이 다른 사용자의
//     트래픽까지 보려면 server-side analytics 가 필요. 그건 backend 옵션).
//   · 이 페이지는 "데모/QA 단계 동안 어떤 페이지를 어떤 채널로 들어왔고
//     어떤 CTA를 눌렀는지"를 직접 확인하는 도구.
//
// 운영 환경에서 더 정확한 데이터가 필요하면:
//   · Plausible (`VITE_PLAUSIBLE_DOMAIN` 등록)
//   · Google Analytics 4 (`VITE_GA4_ID` 등록)
//   둘 다 이미 lib/analytics.js 에 통합되어 있음.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { loadAllEvents, clearAllEvents } from '../lib/marketingAnalytics.js';
import { downloadCSV } from '../lib/csv.js';
import { siteConfirm } from '../lib/dialog.js';

function tally(events, keyFn) {
  const m = new Map();
  for (const e of events) {
    const k = keyFn(e);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function fmtDayLabel(ts) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminAnalytics() {
  const [events, setEvents] = useState(() => loadAllEvents());
  const [windowDays, setWindowDays] = useState(7);

  useEffect(() => {
    const refresh = () => setEvents(loadAllEvents());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-analytics-tick', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-analytics-tick', refresh);
    };
  }, []);

  const cutoff = Date.now() - windowDays * 86400 * 1000;
  const filtered = useMemo(() => events.filter((e) => (e.ts || 0) >= cutoff), [events, cutoff]);

  // KPI
  const pageviews = filtered.filter((e) => e.name === 'pageview');
  const sessions = new Set(pageviews.map((e) => e.session));
  const dwellEvents = filtered.filter((e) => e.name === 'page_dwell');
  const avgDwell = dwellEvents.length
    ? Math.round(dwellEvents.reduce((a, e) => a + Number(e.props?.seconds || 0), 0) / dwellEvents.length)
    : 0;
  const ctaClicks = filtered.filter((e) => e.name === 'cta_click' || e.name === 'click').length;
  const formSubmits = filtered.filter((e) => e.name === 'form_submit' || e.name === 'inquiry_submit').length;

  // 페이지별 / 채널별 / 디바이스 / 브라우저 / 국가
  const topPages = tally(pageviews, (e) => e.path).slice(0, 10);
  const topReferrers = tally(pageviews, (e) => e.referrer || 'unknown').slice(0, 10);
  const deviceBreakdown = tally(pageviews, (e) => e.device);
  const browserBreakdown = tally(pageviews, (e) => e.browser);
  const osBreakdown = tally(pageviews, (e) => e.os);
  const countryBreakdown = tally(pageviews, (e) => e.country || 'XX');
  const timezoneBreakdown = tally(pageviews, (e) => e.timezone || '').filter(([k]) => k);
  const langBreakdown = tally(pageviews, (e) => e.lang || '').filter(([k]) => k);
  const utmCampaigns = tally(filtered, (e) => e.utm_campaign).slice(0, 10);
  const utmSources = tally(filtered, (e) => e.utm_source).slice(0, 10);

  // 시간대 / 요일 트래픽
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ h, n: 0 }));
  const weekdayBuckets = Array.from({ length: 7 }, (_, d) => ({ d, n: 0 }));
  for (const ev of pageviews) {
    if (typeof ev.hour === 'number' && ev.hour >= 0 && ev.hour < 24) hourBuckets[ev.hour].n++;
    if (typeof ev.weekday === 'number' && ev.weekday >= 0 && ev.weekday < 7) weekdayBuckets[ev.weekday].n++;
  }
  const maxHour = Math.max(1, ...hourBuckets.map((x) => x.n));
  const maxWeekday = Math.max(1, ...weekdayBuckets.map((x) => x.n));
  const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

  // 국가 코드 → 한국어 라벨 + 국기 이모지
  const COUNTRY_LABEL = {
    KR: '🇰🇷 한국', JP: '🇯🇵 일본', CN: '🇨🇳 중국', HK: '🇭🇰 홍콩', TW: '🇹🇼 대만',
    SG: '🇸🇬 싱가포르', TH: '🇹🇭 태국', ID: '🇮🇩 인도네시아', PH: '🇵🇭 필리핀',
    VN: '🇻🇳 베트남', MY: '🇲🇾 말레이시아', IN: '🇮🇳 인도', AE: '🇦🇪 UAE',
    AU: '🇦🇺 호주', NZ: '🇳🇿 뉴질랜드',
    US: '🇺🇸 미국', CA: '🇨🇦 캐나다', MX: '🇲🇽 멕시코', BR: '🇧🇷 브라질', AR: '🇦🇷 아르헨티나',
    GB: '🇬🇧 영국', FR: '🇫🇷 프랑스', DE: '🇩🇪 독일', ES: '🇪🇸 스페인', IT: '🇮🇹 이탈리아',
    NL: '🇳🇱 네덜란드', BE: '🇧🇪 벨기에', AT: '🇦🇹 오스트리아', SE: '🇸🇪 스웨덴',
    NO: '🇳🇴 노르웨이', DK: '🇩🇰 덴마크', FI: '🇫🇮 핀란드', PL: '🇵🇱 폴란드',
    CZ: '🇨🇿 체코', RU: '🇷🇺 러시아', TR: '🇹🇷 튀르키예', PT: '🇵🇹 포르투갈',
    GR: '🇬🇷 그리스', CH: '🇨🇭 스위스', IE: '🇮🇪 아일랜드',
    EG: '🇪🇬 이집트', ZA: '🇿🇦 남아공', NG: '🇳🇬 나이지리아',
    Asia: '🌏 아시아 (기타)', EU: '🇪🇺 유럽 (기타)', AM: '🌎 미주 (기타)',
    AF: '🌍 아프리카 (기타)', PC: '🌊 태평양 (기타)', XX: '🌐 미상',
  };
  const countryWithLabel = countryBreakdown.map(([k, n]) => [COUNTRY_LABEL[k] || `🌐 ${k}`, n]);

  // 일자별 트렌드 (windowDays 만큼)
  const trend = useMemo(() => {
    const buckets = new Map();
    for (let i = 0; i < windowDays; i++) {
      const t = Date.now() - i * 86400 * 1000;
      const key = fmtDayLabel(t);
      buckets.set(key, 0);
    }
    for (const e of pageviews) {
      const key = fmtDayLabel(e.ts);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }
    return [...buckets.entries()].reverse(); // [[label, count], ...]
  }, [pageviews, windowDays]);

  const maxTrend = Math.max(1, ...trend.map(([, n]) => n));

  // 이전 기간 대비 변화량 (KPI delta)
  const prevCutoffStart = cutoff - windowDays * 86400 * 1000;
  const prevPeriod = events.filter((e) => (e.ts || 0) >= prevCutoffStart && (e.ts || 0) < cutoff);
  const prevPV = prevPeriod.filter((e) => e.name === 'pageview').length;
  const pvDelta = prevPV ? Math.round(((pageviews.length - prevPV) / prevPV) * 100) : null;
  const prevSessions = new Set(prevPeriod.filter((e) => e.name === 'pageview').map((e) => e.session));
  const sessDelta = prevSessions.size ? Math.round(((sessions.size - prevSessions.size) / prevSessions.size) * 100) : null;

  // 인사이트 한 줄
  const peakHour = hourBuckets.reduce((acc, x) => x.n > acc.n ? x : acc, { h: 0, n: 0 });
  const peakWeekday = weekdayBuckets.reduce((acc, x) => x.n > acc.n ? x : acc, { d: 0, n: 0 });
  const topPage = topPages[0];
  const insightLines = [];
  if (peakHour.n) insightLines.push(`피크 시간대 — ${peakHour.h}시 (${peakHour.n}회)`);
  if (peakWeekday.n) insightLines.push(`피크 요일 — ${WEEKDAY_LABEL[peakWeekday.d]}요일 (${peakWeekday.n}회)`);
  if (topPage) insightLines.push(`가장 많이 본 페이지 — ${topPage[0]} (${topPage[1]}회)`);

  const hasAnyData = filtered.length > 0;

  // CSV 내보내기
  const exportCsv = () => {
    downloadCSV('daemu-analytics-' + new Date().toISOString().slice(0, 10) + '.csv', filtered, [
      { key: (r) => new Date(r.ts).toLocaleString('ko'), label: '시각' },
      { key: 'name', label: '이벤트' },
      { key: 'path', label: '경로' },
      { key: 'session', label: '세션ID' },
      { key: 'device', label: '기기' },
      { key: 'browser', label: '브라우저' },
      { key: 'os', label: 'OS' },
      { key: 'lang', label: '언어' },
      { key: 'country', label: '국가코드' },
      { key: 'timezone', label: '타임존' },
      { key: 'hour', label: '시간(0-23)' },
      { key: 'weekday', label: '요일(0=일)' },
      { key: 'referrer', label: '유입경로' },
      { key: 'utm_source', label: 'UTM 소스' },
      { key: 'utm_medium', label: 'UTM 매체' },
      { key: 'utm_campaign', label: 'UTM 캠페인' },
      { key: (r) => JSON.stringify(r.props || {}), label: '추가 데이터' },
    ]);
  };

  const clearAll = async () => {
    if (!(await siteConfirm('수집된 이벤트를 모두 삭제하시겠습니까? 되돌릴 수 없습니다.'))) return;
    clearAllEvents();
    setEvents([]);
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">마케팅 분석</h1>

          <AdminHelp title="마케팅 분석 사용 안내" items={[
            '본인 브라우저에서 수집된 익명 이벤트(페이지뷰, 체류시간, scroll depth, CTA 클릭, UTM 등)를 보여줍니다.',
            'PII(이름·이메일·IP·정확한 디바이스 ID 등)는 수집하지 않으며, 30일이 지난 이벤트는 자동 삭제됩니다.',
            '여러 사용자의 트래픽까지 한 곳에서 보려면 Plausible(VITE_PLAUSIBLE_DOMAIN) 또는 GA4(VITE_GA4_ID) 환경변수를 등록하세요.',
            'UTM 파라미터(예: ?utm_source=naver&utm_campaign=spring) 가 붙은 링크는 캠페인 카드에 자동 집계됩니다.',
            '아래 표는 CSV로 내보내 마케팅 보고서·발표 자료에 활용할 수 있습니다.',
          ]} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, marginBottom: 18, flexWrap: 'wrap' }}>
            <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}
              style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }}>
              <option value={1}>오늘</option>
              <option value={7}>최근 7일</option>
              <option value={14}>최근 14일</option>
              <option value={30}>최근 30일 (전체)</option>
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm" onClick={exportCsv}>CSV 내보내기</button>
            <button type="button" className="adm-btn-sm danger" onClick={clearAll}>전체 데이터 삭제</button>
          </div>

          {!hasAnyData ? (
            <div style={{ background: '#fff', border: '1px dashed #d7d4cf', padding: '60px 24px', textAlign: 'center', color: '#8c867d', marginBottom: 22 }}>
              <div style={{ fontSize: 22, fontFamily: "'Cormorant Garamond', Georgia, serif", color: '#231815', marginBottom: 8 }}>아직 수집된 트래픽이 없습니다</div>
              <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                다른 탭/창에서 사이트를 둘러보면 여기에 자동으로 누적됩니다.<br />
                위 기간 셀렉터를 늘려보거나, <strong>홈/서비스/문의</strong> 페이지를 한 번씩 들러주세요.
              </p>
            </div>
          ) : (
            <>
              {/* 1행 KPI — 큰 숫자 + 전기간 대비 변화율 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 22 }}>
                <KPI label="페이지뷰" value={pageviews.length.toLocaleString('ko')} delta={pvDelta} />
                <KPI label="세션 수" value={sessions.size.toLocaleString('ko')} delta={sessDelta} />
                <KPI label="평균 체류 시간" value={avgDwell + '초'} />
                <KPI label="CTA 클릭" value={ctaClicks.toLocaleString('ko')} />
                <KPI label="폼 제출" value={formSubmits.toLocaleString('ko')} accent={formSubmits > 0 ? '#2e7d32' : undefined} />
                <KPI label="총 이벤트" value={filtered.length.toLocaleString('ko')} />
              </div>

              {/* 인사이트 1줄 요약 */}
              {insightLines.length > 0 && (
                <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', borderLeft: '3px solid #c9a25a', padding: '12px 18px', marginBottom: 22, fontSize: 12.5, lineHeight: 1.85, color: '#5a4a2a' }}>
                  <strong style={{ marginRight: 8, fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>이 기간 인사이트</strong>
                  {insightLines.join(' · ')}
                </div>
              )}
            </>
          )}

          {/* 일자별 트렌드 */}
          <h3 className="admin-section-title">일자별 페이지뷰 추이</h3>
          <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 16, marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
              {trend.map(([label, n]) => (
                <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#5a534b' }}>{n}</span>
                  <div style={{ width: '100%', background: '#231815', height: Math.max(2, (n / maxTrend) * 100) + 'px', borderRadius: 2, transition: 'height .25s ease' }} />
                  <span style={{ fontSize: 10, color: '#8c867d', letterSpacing: '.04em' }}>{label}</span>
                </div>
              ))}
            </div>
            {!pageviews.length && <p style={{ textAlign: 'center', color: '#8c867d', fontSize: 12, padding: '20px 0', margin: 0 }}>아직 페이지뷰가 없습니다. 사이트를 방문하면 자동으로 수집됩니다.</p>}
          </div>

          {/* 시간대 / 요일별 트래픽 */}
          <h3 className="admin-section-title">트래픽 시간대 / 요일</h3>
          <div className="adm-analytics-pair" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14, marginBottom: 22 }}>
            {/* 시간대 24개 */}
            <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 12 }}>시간대 (0~23시) 페이지뷰</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110 }}>
                {hourBuckets.map(({ h, n }) => (
                  <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 9.5, color: '#5a534b' }}>{n || ''}</span>
                    <div style={{ width: '100%', background: '#231815', height: Math.max(2, (n / maxHour) * 80) + 'px', borderRadius: 1.5 }} title={`${h}시: ${n}회`} />
                    <span style={{ fontSize: 9, color: '#b9b5ae' }}>{h % 3 === 0 ? h : ''}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: '#8c867d', margin: '8px 0 0' }}>
                가장 트래픽이 높은 시간대에 마케팅 메일/푸시 발송 시 효과적입니다.
              </p>
            </div>
            {/* 요일 7개 */}
            <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 12 }}>요일별 페이지뷰</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110 }}>
                {weekdayBuckets.map(({ d, n }) => (
                  <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#5a534b' }}>{n || ''}</span>
                    <div style={{ width: '100%', background: d === 0 || d === 6 ? '#b87333' : '#231815', height: Math.max(2, (n / maxWeekday) * 80) + 'px', borderRadius: 1.5 }} />
                    <span style={{ fontSize: 11, color: d === 0 || d === 6 ? '#b87333' : '#5a534b', fontWeight: 500 }}>{WEEKDAY_LABEL[d]}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: '#8c867d', margin: '8px 0 0' }}>
                주말은 구리색으로 표시. 평일/주말 패턴 비교에 활용.
              </p>
            </div>
          </div>

          {/* 국가 / 타임존 / 언어 */}
          <h3 className="admin-section-title">접속 국가 (타임존 기반 추정)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 22 }}>
            <RankCard title="국가 분포" items={countryWithLabel} emptyLabel="국가 데이터 없음" />
            <RankCard title="타임존 (정확값)" items={timezoneBreakdown} emptyLabel="타임존 데이터 없음" />
            <RankCard title="브라우저 언어" items={langBreakdown} emptyLabel="언어 데이터 없음" />
          </div>
          <p style={{ fontSize: 11, color: '#8c867d', marginTop: -10, marginBottom: 18, lineHeight: 1.6 }}>
            국가 추정은 사용자 브라우저의 IANA 타임존을 기반으로 합니다 (예: <code>Asia/Seoul → 🇰🇷 한국</code>).
            VPN/시스템 설정에 따라 부정확할 수 있고, 정확한 IP geolocation이 필요하면 backend에 GeoIP 모듈 추가가 필요합니다.
          </p>

          {/* 인기 페이지 + 유입경로 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 22 }}>
            <RankCard title="인기 페이지" items={topPages} />
            <RankCard title="유입 경로" items={topReferrers} />
          </div>

          {/* UTM */}
          {(utmCampaigns.length > 0 || utmSources.length > 0) && (
            <>
              <h3 className="admin-section-title">UTM 캠페인 추적</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 22 }}>
                <RankCard title="캠페인" items={utmCampaigns} emptyLabel="UTM 캠페인 없음" />
                <RankCard title="UTM 소스" items={utmSources} emptyLabel="UTM 소스 없음" />
              </div>
            </>
          )}

          {/* 디바이스 / 브라우저 / OS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 22 }}>
            <RankCard title="디바이스" items={deviceBreakdown} />
            <RankCard title="브라우저" items={browserBreakdown} />
            <RankCard title="OS" items={osBreakdown} />
          </div>

          {/* 최근 이벤트 */}
          <h3 className="admin-section-title">최근 이벤트 (50건)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>이벤트</th>
                  <th>경로</th>
                  <th>유입</th>
                  <th>기기</th>
                  <th>UTM</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(-50).reverse().map((e) => (
                  <tr key={e.id}>
                    <td data-label="시각" style={{ fontSize: 11, color: '#5a534b' }}>{new Date(e.ts).toLocaleTimeString('ko')}</td>
                    <td data-label="이벤트">{e.name}</td>
                    <td data-label="경로" style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.path}</td>
                    <td data-label="유입" style={{ fontSize: 11 }}>{e.referrer || '-'}</td>
                    <td data-label="기기">{e.device}</td>
                    <td data-label="UTM" style={{ fontSize: 11, color: '#8c867d' }}>
                      {[e.utm_source, e.utm_campaign].filter(Boolean).join(' · ') || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <p style={{ textAlign: 'center', color: '#8c867d', fontSize: 12, padding: '24px 0' }}>이벤트가 없습니다.</p>}
          </div>
        </section>
      </main>
    </AdminShell>
  );
}

function KPI({ label, value, delta, accent }) {
  const deltaColor = delta == null ? '#b9b5ae' : delta > 0 ? '#2e7d32' : delta < 0 ? '#c0392b' : '#8c867d';
  const deltaSign = delta == null ? '' : delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : '— ';
  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '18px 20px', borderTop: accent ? `2px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 28, fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, letterSpacing: '-.01em', color: accent || '#231815', lineHeight: 1.1 }}>{value}</div>
        {delta != null && (
          <span style={{ fontSize: 11, color: deltaColor, letterSpacing: '.04em', fontWeight: 600 }}>
            {deltaSign}{Math.abs(delta)}%
            <span style={{ color: '#b9b5ae', fontWeight: 400, marginLeft: 4 }}>전기간 대비</span>
          </span>
        )}
      </div>
    </div>
  );
}

function RankCard({ title, items, emptyLabel = '데이터 없음' }) {
  const top = items.slice(0, 10);
  const max = Math.max(1, ...top.map(([, n]) => n));
  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 12 }}>{title}</div>
      {!top.length ? (
        <p style={{ fontSize: 12, color: '#b9b5ae', margin: 0 }}>{emptyLabel}</p>
      ) : (
        top.map(([k, n]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <span style={{ flex: 1, fontSize: 12.5, color: '#2a2724', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
            <div style={{ flex: 2, background: '#f0ede7', height: 6, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ background: '#231815', height: '100%', width: ((n / max) * 100) + '%' }} />
            </div>
            <span style={{ fontSize: 12, color: '#5a534b', minWidth: 40, textAlign: 'right' }}>{n}</span>
          </div>
        ))
      )}
    </div>
  );
}
