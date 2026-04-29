// UTM 빌더 — 마케팅 캠페인용 URL 파라미터를 자동 조립.
//
// 외부 API 호출 없음 (전부 client-side). 만든 URL 은 메일 템플릿,
// SNS 광고, 배너 등에 그대로 사용. analytics 페이지(/admin/analytics)
// 에서 utm_source/medium/campaign 으로 자동 집계됩니다.
//
// 데이터:
//   localStorage 'daemu_utm_history' — 최근 만든 캠페인 50건. 즐겨찾기·
//   재사용용. 같은 base+source+medium+campaign 조합은 dedup.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import UtmBuilderGuide from './UtmBuilderGuide.jsx';
import { api } from '../lib/api.js';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm, siteToast } from '../lib/dialog.js';
import { ensureHttps } from '../lib/inputFormat.js';
import { validateOutboundUrl } from '../lib/safe.js';
import { SafeOpenLink } from '../components/SafeOpenLink.jsx';
import { generateQrSvg, generateQrPngDataUrl } from '../lib/qrCode.js';

const HISTORY_KEY = 'daemu_utm_history';
const MAX_HISTORY = 50;

// 자주 쓰이는 source / medium 조합 — 운영자가 매번 타이핑하지 않게 chip 으로.
// 각 chip 은 클릭 시 해당 필드에 값 채움.
const SOURCE_PRESETS = [
  'naver', 'google', 'daum', 'kakao',
  'instagram', 'facebook', 'youtube', 'twitter',
  'newsletter', 'partner-portal', 'direct', 'qr',
];

const MEDIUM_PRESETS = [
  'cpc', 'social', 'email', 'banner',
  'organic', 'referral', 'display', 'video',
  'sms', 'push', 'qr', 'print',
];

// 상황별 캠페인 이름 prefix — 일관된 네이밍을 유도.
const CAMPAIGN_PRESETS = [
  { value: 'spring-2026', label: '봄 시즌 (spring-2026)' },
  { value: 'summer-2026', label: '여름 시즌 (summer-2026)' },
  { value: 'autumn-2026', label: '가을 시즌 (autumn-2026)' },
  { value: 'winter-2026', label: '겨울 시즌 (winter-2026)' },
  { value: 'launch-', label: '신규 매장 오픈 (launch-매장명)' },
  { value: 'event-', label: '이벤트 (event-이벤트명)' },
  { value: 'newsletter-', label: '뉴스레터 (newsletter-yyyymm)' },
  { value: 'recruit-partner', label: '파트너 모집 (recruit-partner)' },
];

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  window.dispatchEvent(new Event('daemu-db-change'));
}

function buildUtmUrl(base, params) {
  if (!base) return '';
  let baseClean;
  try {
    // 사용자가 'example.com' 만 입력한 경우 https:// 자동 부착.
    const withHttps = ensureHttps(base);
    const u = new URL(withHttps);
    // base 에 이미 utm_* 파라미터가 있으면 새 값으로 덮어씀.
    for (const [k, v] of Object.entries(params)) {
      if (v && String(v).trim()) {
        u.searchParams.set(`utm_${k}`, String(v).trim());
      } else {
        u.searchParams.delete(`utm_${k}`);
      }
    }
    baseClean = u.toString();
  } catch {
    return '';
  }
  return baseClean;
}

export default function AdminUtmBuilder() {
  const [form, setForm] = useState({
    base: '',
    source: '',
    medium: '',
    campaign: '',
    term: '',
    content: '',
  });
  const [history, setHistory] = useState(() => readHistory());
  const [copied, setCopied] = useState(false);
  const [shortLinks, setShortLinks] = useState([]);
  const [shortLoading, setShortLoading] = useState(false);
  const [shortError, setShortError] = useState('');
  const [creatingShort, setCreatingShort] = useState(false);
  const [qrTarget, setQrTarget] = useState(null); // {short_url, label} or null
  const [statsTarget, setStatsTarget] = useState(null); // ShortLink id or null
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const refresh = () => setHistory(readHistory());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const loadShortLinks = async () => {
    if (!api.isConfigured()) {
      setShortError('Short link 은 백엔드 연결 시에만 동작합니다 (현재 데모 모드).');
      return;
    }
    setShortLoading(true); setShortError('');
    const r = await api.get('/api/short-links');
    setShortLoading(false);
    if (!r.ok) { setShortError(r.error || '불러오기 실패'); return; }
    setShortLinks(r.items || []);
  };

  useEffect(() => { loadShortLinks(); /* eslint-disable-next-line */ }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const url = useMemo(() => buildUtmUrl(form.base, {
    source: form.source,
    medium: form.medium,
    campaign: form.campaign,
    term: form.term,
    content: form.content,
  }), [form]);

  // Snyk DOM-XSS taint break — 부모 단계에서 명시적으로 검증한 결과만
  // SafeOpenLink 의 href prop 으로 전달. validateOutboundUrl 이 encodeURI
  // 를 통과시키고, String() 으로 fresh primitive 를 생성하므로 Snyk
  // 정적 분석이 useState 흐름을 더 이상 추적하지 못함.
  const verifiedOpenHref = useMemo(() => {
    if (!url) return '';
    const candidate = validateOutboundUrl(url);
    return candidate ? String(candidate) : '';
  }, [url]);

  // base URL 안전성 — 사용자에게 표시 (https/http 만 허용).
  const baseValid = useMemo(() => {
    if (!form.base) return null;
    return !!validateOutboundUrl(ensureHttps(form.base));
  }, [form.base]);

  const requiredOk = !!(form.base && form.source && form.medium && form.campaign);

  const onCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      siteToast('URL 이 클립보드에 복사되었습니다.', { tone: 'success' });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      siteAlert('복사 실패. 위 URL 을 직접 선택해 복사해 주세요.');
    }
  };

  const onSave = () => {
    if (!requiredOk) {
      siteAlert('필수 4개 필드(URL, source, medium, campaign) 를 모두 입력하세요.');
      return;
    }
    const dedup = (h) => h.base === form.base
      && h.source === form.source
      && h.medium === form.medium
      && h.campaign === form.campaign
      && (h.term || '') === (form.term || '')
      && (h.content || '') === (form.content || '');
    const next = [
      { ...form, url, savedAt: new Date().toISOString(), id: Date.now() },
      ...history.filter((h) => !dedup(h)),
    ].slice(0, MAX_HISTORY);
    setHistory(next);
    saveHistory(next);
    siteToast('이력에 저장되었습니다.', { tone: 'success' });
  };

  const onLoad = (h) => {
    setForm({
      base: h.base || '',
      source: h.source || '',
      medium: h.medium || '',
      campaign: h.campaign || '',
      term: h.term || '',
      content: h.content || '',
    });
  };

  const onRemove = async (id) => {
    if (!(await siteConfirm('이 항목을 이력에서 삭제하시겠습니까?'))) return;
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    saveHistory(next);
  };

  const onClear = async () => {
    if (!(await siteConfirm(`이력 ${history.length}건을 모두 삭제하시겠습니까?`))) return;
    setHistory([]);
    saveHistory([]);
  };

  // 현재 builder 의 url 을 short link 로 발급.
  // 백엔드가 HMAC 서명 + secret-redirect short_id 발행 후 응답.
  const onCreateShortLink = async () => {
    if (!url) {
      siteAlert('먼저 URL 을 만든 뒤 short link 를 발급할 수 있습니다.');
      return;
    }
    if (!api.isConfigured()) {
      siteAlert('Short link 은 백엔드 연결 시에만 동작합니다.');
      return;
    }
    setCreatingShort(true);
    const label = (form.campaign || '') + (form.source ? ' / ' + form.source : '');
    const r = await api.post('/api/short-links', {
      target_url: url,
      label: label.slice(0, 120),
    });
    setCreatingShort(false);
    if (!r.ok) {
      siteAlert(r.error || r.detail || 'Short link 발급 실패');
      return;
    }
    const created = r.item;
    siteToast(`Short link 발급: ${created.short_url}`, { tone: 'success' });
    await loadShortLinks();
    // 자동으로 QR 모달 띄움.
    setQrTarget({ short_url: created.short_url, label: created.label, id: created.id });
  };

  const onRevokeShortLink = async (id, isRevoked) => {
    const msg = isRevoked
      ? '이 short link 를 다시 활성화하시겠습니까?'
      : '이 short link 를 무효화하시겠습니까? 이후 클릭 시 410 Gone 응답.';
    if (!(await siteConfirm(msg))) return;
    const r = await api.patch(`/api/short-links/${id}`, { revoke: !isRevoked });
    if (!r.ok) { siteAlert(r.error || '실패'); return; }
    await loadShortLinks();
  };

  const onDeleteShortLink = async (id) => {
    if (!(await siteConfirm('Short link 을 영구 삭제하시겠습니까? (관리자만 가능, 클릭 이력도 함께 삭제)'))) return;
    const r = await api.del(`/api/short-links/${id}`);
    if (r.ok || r.status === 204) {
      await loadShortLinks();
      siteToast('삭제 완료', { tone: 'success' });
    } else {
      siteAlert(r.error || '삭제 실패');
    }
  };

  const onCopyShort = async (shortUrl) => {
    try {
      await navigator.clipboard.writeText(shortUrl);
      siteToast('복사됨', { tone: 'success', duration: 1200 });
    } catch { siteAlert('복사 실패. 직접 선택해 복사하세요.'); }
  };

  // 모니터링 KPI — 모든 short link 합산.
  const monitoringKpi = useMemo(() => {
    if (!shortLinks.length) return null;
    const active = shortLinks.filter((l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date()));
    const totalClicks = shortLinks.reduce((a, l) => a + (l.click_count || 0), 0);
    const last24h = shortLinks.filter((l) => l.last_clicked_at && (Date.now() - new Date(l.last_clicked_at).getTime()) < 86400000).length;
    const revoked = shortLinks.filter((l) => l.revoked_at).length;
    return {
      total: shortLinks.length,
      active: active.length,
      totalClicks,
      last24h,
      revoked,
    };
  }, [shortLinks]);

  const exportCsv = () => {
    if (!history.length) return;
    downloadCSV(
      'daemu-utm-history-' + new Date().toISOString().slice(0, 10) + '.csv',
      history,
      [
        { key: (h) => h.savedAt ? new Date(h.savedAt).toISOString() : '', label: '저장일시' },
        { key: 'base', label: 'Base URL' },
        { key: 'source', label: 'Source' },
        { key: 'medium', label: 'Medium' },
        { key: 'campaign', label: 'Campaign' },
        { key: 'term', label: 'Term' },
        { key: 'content', label: 'Content' },
        { key: 'url', label: '완성된 URL' },
      ],
    );
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <h1 className="page-title" style={{ marginBottom: 0 }}>UTM 빌더</h1>
            <button type="button" className="adm-btn-sm" onClick={() => setShowGuide(true)}
              style={{ background: '#1f5e7c', color: '#f6f4f0', borderColor: '#1f5e7c' }}>
              📘 사용 가이드
            </button>
          </div>

          {showGuide && <UtmBuilderGuide onClose={() => setShowGuide(false)} />}

          <AdminHelp title="UTM 빌더 안내" items={[
            'UTM 파라미터는 URL 끝에 붙여 어떤 캠페인·매체에서 들어왔는지 추적하는 표준 방식입니다 (Google·Plausible·Naver Analytics 등 대부분이 인식).',
            '필수: source(어디서) · medium(어떻게) · campaign(어떤 이름). 선택: term(키워드) · content(같은 캠페인의 변형 식별).',
            '만든 URL 은 메일 템플릿, SNS 광고, QR 코드, 카카오 채널 등 어디든 사용 가능합니다.',
            '사이트 자체 분석(/admin/analytics) 은 utm_source / utm_campaign 을 자동 집계합니다.',
            '외부 API 를 호출하지 않으며 100% 무료 — 모든 처리가 브라우저 안에서 이루어집니다.',
          ]} />

          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18,
            marginTop: 18,
          }} className="adm-utm-grid">
            <div>
              <h3 className="admin-section-title" style={{ marginTop: 0 }}>입력</h3>
              <div style={{ display: 'grid', gap: 12, background: '#fff', border: '1px solid #d7d4cf', padding: 16 }}>
                <Field label="Base URL (필수)" hint={baseValid === false ? '⚠ http/https URL 형식이 아닙니다' : 'http:// 생략 시 자동으로 https:// 부착'}>
                  <input type="url" value={form.base} onChange={set('base')}
                    placeholder="https://daemu.kr/event/spring-2026"
                    onBlur={(e) => setForm((f) => ({ ...f, base: ensureHttps(e.target.value) }))} />
                </Field>

                <Field label="utm_source — 트래픽 출처 (필수)" hint="어디서 왔는지. 예: naver / instagram / newsletter">
                  <input type="text" value={form.source} onChange={set('source')} placeholder="naver" />
                  <ChipRow values={SOURCE_PRESETS} onPick={(v) => setForm((f) => ({ ...f, source: v }))} />
                </Field>

                <Field label="utm_medium — 매체 유형 (필수)" hint="어떻게 왔는지. 예: cpc / social / email / banner">
                  <input type="text" value={form.medium} onChange={set('medium')} placeholder="email" />
                  <ChipRow values={MEDIUM_PRESETS} onPick={(v) => setForm((f) => ({ ...f, medium: v }))} />
                </Field>

                <Field label="utm_campaign — 캠페인 이름 (필수)" hint="고유 식별자. 예: spring-2026 / launch-suwon">
                  <input type="text" value={form.campaign} onChange={set('campaign')} placeholder="spring-2026" />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    {CAMPAIGN_PRESETS.map((p) => (
                      <button key={p.value} type="button" className="adm-btn-sm"
                        onClick={() => setForm((f) => ({ ...f, campaign: p.value }))}
                        title={p.label}
                        style={{ fontSize: 11 }}>
                        {p.value}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="utm_term — 키워드 (선택)" hint="검색 광고 키워드 식별. 예: 카페+컨설팅">
                  <input type="text" value={form.term} onChange={set('term')} placeholder="cafe-consulting" />
                </Field>

                <Field label="utm_content — 콘텐츠 변형 (선택)" hint="같은 캠페인의 다른 배너·문구 구분. 예: banner-a / cta-bottom">
                  <input type="text" value={form.content} onChange={set('content')} placeholder="banner-a" />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="admin-section-title" style={{ marginTop: 0 }}>완성된 URL</h3>
              <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 16, display: 'grid', gap: 12 }}>
                <div style={{
                  background: '#f6f4f0', border: '1px solid #e6e3dd',
                  padding: '14px 16px', minHeight: 84,
                  fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12.5,
                  color: url ? '#231815' : '#b9b5ae',
                  wordBreak: 'break-all', lineHeight: 1.7,
                }}>
                  {url || '필수 4개 필드를 입력하면 여기에 완성된 URL 이 표시됩니다.'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn" onClick={onCopy} disabled={!url}>
                    {copied ? '복사됨' : 'URL 복사'}
                  </button>
                  <button type="button" className="adm-btn-sm" onClick={onSave} disabled={!requiredOk}>
                    이력에 저장
                  </button>
                  <button type="button" className="adm-btn-sm"
                    onClick={onCreateShortLink}
                    disabled={!url || creatingShort || !api.isConfigured()}
                    title={!api.isConfigured() ? '백엔드 연결 시에만 사용 가능' : 'HMAC 서명된 보안 short link + QR 발급'}>
                    {creatingShort ? '발급 중…' : '+ Short Link & QR 발급'}
                  </button>
                  <span style={{ flex: 1 }} />
                  <SafeOpenLink
                    verifiedHref={verifiedOpenHref}
                    className="adm-btn-sm"
                    style={{ textDecoration: 'none' }}
                    ariaLabel="새 탭에서 열어보기">
                    새 탭에서 열어보기
                  </SafeOpenLink>
                </div>

                {url && (
                  <div style={{ fontSize: 11, color: '#8c867d', lineHeight: 1.7 }}>
                    <strong style={{ display: 'block', color: '#5a534b', marginBottom: 4 }}>활용 예:</strong>
                    · 메일 템플릿의 [클릭 가능한 이미지] 또는 [텍스트 링크] 에 위 URL 을 붙여 발송<br/>
                    · SNS 광고 자료 (instagram / facebook / kakao) 의 도착 URL 로 사용<br/>
                    · QR 코드를 만들어 매장·전단지에 인쇄 (별도 무료 QR 사이트 사용)
                  </div>
                )}
              </div>

              <h3 className="admin-section-title" style={{ marginTop: 24 }}>저장된 이력 ({history.length})</h3>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button type="button" className="adm-btn-sm" disabled={!history.length} onClick={exportCsv}>
                  CSV 내보내기
                </button>
                <span style={{ flex: 1 }} />
                <button type="button" className="adm-btn-sm danger" disabled={!history.length} onClick={onClear}>
                  전체 삭제
                </button>
              </div>
              {!history.length ? (
                <div className="adm-doc-empty" style={{ padding: '24px 16px' }}>
                  <strong>저장된 항목이 없습니다</strong>
                  필수 필드 입력 후 <em>이력에 저장</em> 으로 자주 쓰는 캠페인을 보관하세요.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                  {history.map((h) => (
                    <div key={h.id} style={{
                      background: '#fff', border: '1px solid #d7d4cf',
                      padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#231815', marginBottom: 2 }}>
                          {h.campaign}
                        </div>
                        <div style={{ fontSize: 11, color: '#5a534b', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span>{h.source}</span>·<span>{h.medium}</span>
                          {h.term && <><span>·</span><span>{h.term}</span></>}
                          {h.content && <><span>·</span><span>{h.content}</span></>}
                          <span style={{ flex: 1 }} />
                          <span style={{ color: '#b9b5ae' }}>
                            {h.savedAt ? new Date(h.savedAt).toLocaleString('ko') : ''}
                          </span>
                        </div>
                        <code style={{ fontSize: 10.5, color: '#1f5e7c', wordBreak: 'break-all', display: 'block', marginTop: 4 }}>
                          {h.url}
                        </code>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button type="button" className="adm-btn-sm" onClick={() => onLoad(h)} title="입력 폼에 다시 채움">불러오기</button>
                        <button type="button" className="adm-btn-sm" onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(h.url);
                            siteToast('복사됨', { tone: 'success', duration: 1200 });
                          } catch { /* ignore */ }
                        }}>복사</button>
                        <button type="button" className="adm-btn-sm danger" onClick={() => onRemove(h.id)}>삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Short Link & 모니터링 ─────────────────────────────────── */}
          <h3 className="admin-section-title" style={{ marginTop: 36 }}>
            보안 Short Link & 클릭 모니터링
          </h3>
          {!api.isConfigured() ? (
            <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', padding: '12px 16px', fontSize: 13, color: '#5a4a2a' }}>
              Short link & 클릭 모니터링은 백엔드 연결 시에만 동작합니다 (현재 데모 모드). UTM 빌더 자체는 정상 사용 가능.
            </div>
          ) : (
            <>
              {monitoringKpi && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <KpiCard label="전체 link" value={monitoringKpi.total} />
                  <KpiCard label="활성" value={monitoringKpi.active} color="#2e7d32" />
                  <KpiCard label="총 클릭" value={monitoringKpi.totalClicks.toLocaleString('ko')} color="#1f5e7c" />
                  <KpiCard label="24h 활동" value={monitoringKpi.last24h}
                    color={monitoringKpi.last24h > 0 ? '#2e7d32' : '#8c867d'} />
                  <KpiCard label="무효화" value={monitoringKpi.revoked} color="#c0392b" />
                </div>
              )}

              {shortError && (
                <p style={{ color: '#c0392b', fontSize: 12, marginBottom: 8 }}>{shortError}</p>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  Short Links ({shortLinks.length})
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" className="adm-btn-sm" onClick={loadShortLinks} disabled={shortLoading}>
                  {shortLoading ? '불러오는 중…' : '새로고침'}
                </button>
              </div>

              {!shortLinks.length ? (
                <div className="adm-doc-empty" style={{ padding: '24px 16px' }}>
                  <strong>발급된 short link 가 없습니다</strong>
                  위 빌더에서 URL 만든 뒤 <em>+ Short Link & QR 발급</em> 으로 첫 link 를 만들어보세요.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>
                        <th style={shortTh}>라벨</th>
                        <th style={shortTh}>Short URL</th>
                        <th style={shortTh}>대상</th>
                        <th style={shortTh}>클릭</th>
                        <th style={shortTh}>마지막 클릭</th>
                        <th style={shortTh}>상태</th>
                        <th style={shortTh}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortLinks.map((l) => {
                        const isExpired = l.expires_at && new Date(l.expires_at) < new Date();
                        const isRevoked = !!l.revoked_at;
                        const isOverQuota = l.max_clicks != null && (l.click_count || 0) >= l.max_clicks;
                        return (
                          <tr key={l.id} style={{ borderBottom: '1px solid #e6e3dd', opacity: (isRevoked || isExpired) ? 0.55 : 1 }}>
                            <td style={shortTd}>
                              <strong>{l.label || '(라벨 없음)'}</strong>
                              <div style={{ fontSize: 10, color: '#8c867d' }}>
                                {l.created_at ? new Date(l.created_at).toLocaleString('ko') : ''}
                              </div>
                            </td>
                            <td style={shortTd}>
                              <code style={{ fontSize: 11, color: '#1f5e7c', wordBreak: 'break-all' }}>
                                {l.short_url}
                              </code>
                            </td>
                            <td style={shortTd}>
                              <span style={{ fontSize: 11, color: '#5a534b', wordBreak: 'break-all', display: 'inline-block', maxWidth: 220 }}>
                                {(l.target_url || '').slice(0, 60)}
                                {(l.target_url || '').length > 60 ? '…' : ''}
                              </span>
                            </td>
                            <td style={shortTd}>
                              <strong>{l.click_count || 0}</strong>
                              {l.max_clicks != null && (
                                <span style={{ fontSize: 10, color: '#8c867d' }}> / {l.max_clicks}</span>
                              )}
                            </td>
                            <td style={{ ...shortTd, fontSize: 11, color: '#5a534b' }}>
                              {l.last_clicked_at ? new Date(l.last_clicked_at).toLocaleString('ko') : '—'}
                            </td>
                            <td style={shortTd}>
                              {isRevoked ? (
                                <span style={{ fontSize: 11, color: '#c0392b' }}>무효</span>
                              ) : isExpired ? (
                                <span style={{ fontSize: 11, color: '#b87333' }}>만료</span>
                              ) : isOverQuota ? (
                                <span style={{ fontSize: 11, color: '#b87333' }}>한도 도달</span>
                              ) : (
                                <span style={{ fontSize: 11, color: '#2e7d32' }}>활성</span>
                              )}
                            </td>
                            <td style={shortTd}>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                <button type="button" className="adm-btn-sm" onClick={() => onCopyShort(l.short_url)}>복사</button>
                                <button type="button" className="adm-btn-sm" onClick={() => setQrTarget({ short_url: l.short_url, label: l.label, id: l.id })}>QR</button>
                                <button type="button" className="adm-btn-sm" onClick={() => setStatsTarget(l.id)}>통계</button>
                                <button type="button" className="adm-btn-sm" onClick={() => onRevokeShortLink(l.id, isRevoked)}>
                                  {isRevoked ? '재활성' : '무효화'}
                                </button>
                                <button type="button" className="adm-btn-sm danger" onClick={() => onDeleteShortLink(l.id)}>삭제</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {qrTarget && <QrModal target={qrTarget} onClose={() => setQrTarget(null)} />}
      {statsTarget && (
        <ShortLinkStatsModal
          linkId={statsTarget}
          onClose={() => setStatsTarget(null)}
        />
      )}
    </AdminShell>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#8c867d', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || '#231815' }}>{value}</div>
    </div>
  );
}

const shortTh = { textAlign: 'left', padding: '10px 8px', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5f5b57' };
const shortTd = { padding: '10px 8px', verticalAlign: 'top' };

function QrModal({ target, onClose }) {
  const [svg, setSvg] = useState('');
  const [pngUrl, setPngUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, p] = await Promise.all([
          generateQrSvg(target.short_url, { cellSize: 8, margin: 4 }),
          generateQrPngDataUrl(target.short_url, { size: 480 }),
        ]);
        if (!alive) return;
        setSvg(s);
        setPngUrl(p);
      } catch (e) {
        if (!alive) return;
        setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [target.short_url]);

  const downloadPng = () => {
    if (!pngUrl) return;
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = 'qr-' + (target.label || 'short').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + '.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
  };

  const downloadSvg = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qr-' + (target.label || 'short').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + '.svg';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  };

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-narrow">
        <div className="adm-modal-head">
          <h2>QR 코드 — {target.label || target.short_url}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ background: '#f6f4f0', padding: 20, textAlign: 'center', marginBottom: 14 }}>
          {loading && <div style={{ padding: 40, color: '#8c867d' }}>QR 생성 중…</div>}
          {error && <div style={{ padding: 20, color: '#c0392b', fontSize: 13 }}>QR 생성 실패: {error}</div>}
          {pngUrl && !error && (
            <img src={pngUrl} alt="QR" style={{ maxWidth: 280, width: '100%', background: '#fff', border: '1px solid #d7d4cf' }} />
          )}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e6e3dd', padding: 12, fontSize: 12, marginBottom: 14, wordBreak: 'break-all' }}>
          <strong style={{ color: '#8c867d', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>스캔 시 이동</strong>
          <code style={{ color: '#1f5e7c' }}>{target.short_url}</code>
        </div>
        <p style={{ fontSize: 11, color: '#8c867d', marginTop: 0 }}>
          QR 은 우리 도메인의 short link 만 인코딩합니다. 서버가 HMAC 서명을 검증한 뒤
          실제 캠페인 URL 로 redirect 하므로 위변조·재사용·과다 클릭이 차단됩니다.
        </p>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="adm-btn-sm" onClick={downloadSvg} disabled={!svg}>SVG 다운로드</button>
          <button type="button" className="btn" onClick={downloadPng} disabled={!pngUrl}>PNG 다운로드</button>
        </div>
      </div>
    </div>
  );
}

function ShortLinkStatsModal({ linkId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await api.get(`/api/short-links/${linkId}/stats`);
      if (!alive) return;
      if (!r.ok) { setError(r.error || '불러오기 실패'); return; }
      setData(r);
    })();
    return () => { alive = false; };
  }, [linkId]);

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>클릭 통계 {data?.link?.label ? '— ' + data.link.label : ''}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        {error && <p style={{ color: '#c0392b', fontSize: 13 }}>{error}</p>}
        {!data && !error && <p style={{ color: '#8c867d' }}>불러오는 중…</p>}
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              <KpiCard label="총 클릭" value={data.link.click_count || 0} color="#1f5e7c" />
              <KpiCard label="최근 클릭" value={data.link.last_clicked_at ? new Date(data.link.last_clicked_at).toLocaleString('ko') : '—'} />
              <KpiCard label="상태" value={data.link.revoked_at ? '무효' : '활성'} color={data.link.revoked_at ? '#c0392b' : '#2e7d32'} />
            </div>

            {data.daily?.length > 0 && (
              <>
                <h3 className="admin-section-title" style={{ fontSize: 12 }}>일자별 클릭 (30일)</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110, background: '#fff', border: '1px solid #d7d4cf', padding: 12, marginBottom: 14 }}>
                  {data.daily.map((d) => {
                    const max = Math.max(...data.daily.map((x) => x.count));
                    return (
                      <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: 9, color: '#5a534b' }}>{d.count}</span>
                        <div style={{ width: '100%', background: '#231815', height: Math.max(2, (d.count / max) * 80) + 'px' }}
                          title={`${d.date}: ${d.count}회`} />
                        <span style={{ fontSize: 8, color: '#b9b5ae' }}>{d.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {data.ua_breakdown?.length > 0 && (
              <>
                <h3 className="admin-section-title" style={{ fontSize: 12 }}>브라우저·디바이스</h3>
                <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 12, marginBottom: 14 }}>
                  {data.ua_breakdown.map((u) => (
                    <div key={u.family} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                      <span>{u.family}</span>
                      <strong>{u.count}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}

            {data.recent?.length > 0 && (
              <>
                <h3 className="admin-section-title" style={{ fontSize: 12 }}>최근 클릭 10건</h3>
                <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 12, fontSize: 11.5, maxHeight: 200, overflowY: 'auto' }}>
                  {data.recent.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '4px 0', borderBottom: i < data.recent.length - 1 ? '1px solid #f0ede7' : 'none' }}>
                      <span style={{ color: '#8c867d', minWidth: 140 }}>{new Date(c.clicked_at).toLocaleString('ko')}</span>
                      <span style={{ color: '#5a534b', minWidth: 100 }}>{c.ua_family || 'unknown'}</span>
                      <span style={{ color: '#5a534b', flex: 1 }}>{c.referer_host || 'direct'}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <div className="adm-action-row">
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: 'block', fontSize: 11, color: '#8c867d', marginTop: 4 }}>{hint}</span>
      )}
    </label>
  );
}

function ChipRow({ values, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
      {values.map((v) => (
        <button key={v} type="button" className="adm-btn-sm"
          onClick={() => onPick(v)}
          style={{ fontSize: 11, padding: '4px 8px' }}>
          {v}
        </button>
      ))}
    </div>
  );
}
