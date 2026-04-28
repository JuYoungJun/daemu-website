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
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm, siteToast } from '../lib/dialog.js';
import { ensureHttps } from '../lib/inputFormat.js';
import { validateOutboundUrl } from '../lib/safe.js';
import { SafeOpenLink } from '../components/SafeOpenLink.jsx';

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

  useEffect(() => {
    const refresh = () => setHistory(readHistory());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const url = useMemo(() => buildUtmUrl(form.base, {
    source: form.source,
    medium: form.medium,
    campaign: form.campaign,
    term: form.term,
    content: form.content,
  }), [form]);

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
          <h1 className="page-title">UTM 빌더</h1>

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
                  <span style={{ flex: 1 }} />
                  <SafeOpenLink
                    href={url}
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
        </section>
      </main>
    </AdminShell>
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
