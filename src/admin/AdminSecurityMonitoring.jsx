// 보안 모니터링 — 실시간 보안 KPI 전용 페이지.
//
// /admin/monitoring 의 보안 섹션은 그대로 유지하고, 본 페이지는 보안 지표만
// 모아 30초 주기로 자동 갱신한다. 의심 IP / 인증 실패 / 보안 이벤트 / 외부
// 보안 endpoint(추후 카페24·Render Starter 등 결제 서버) 연동 설정.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import EventStreamPanel from '../components/EventStreamPanel.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';
import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteToast } from '../lib/dialog.js';
import { api } from '../lib/api.js';
import { filterByDevIp } from '../lib/ipFilter.js';

// 실시간급 — 15초 주기 (이전 30초). 사용자 요청.
const POLL_INTERVAL_MS = 15 * 1000;
const EXT_URL_KEY = 'daemu_security_external_endpoint';

function probeColor(level) {
  if (level === 'high') return '#c0392b';
  if (level === 'medium') return '#b87333';
  return '#2e7d32';
}

export default function AdminSecurityMonitoring() {
  const [summary, setSummary] = useState(null);
  const [external, setExternal] = useState(null);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState(null);
  const [extUrl, setExtUrl] = useState(() => {
    try { return localStorage.getItem(EXT_URL_KEY) || ''; }
    catch { return ''; }
  });

  // 백엔드 summary 호출.
  useEffect(() => {
    if (!api.isConfigured()) return;
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const r = await api.get('/api/monitoring/summary');
        if (!alive) return;
        if (r.ok) { setSummary(r); setError(''); }
        else setError(r.error || '서버 응답 오류');
        setLastRun(Date.now());
      } catch (e) {
        if (alive) setError(String(e?.message || e));
      }
    };
    tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  // 외부 보안 endpoint 호출 (옵션).
  useEffect(() => {
    if (!extUrl) { setExternal(null); return; }
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(extUrl, { mode: 'cors', credentials: 'omit' });
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        if (!alive) return;
        setExternal({ ok: res.ok, status: res.status, body: json, raw: text.slice(0, 1000) });
      } catch (e) {
        if (alive) setExternal({ ok: false, error: String(e?.message || e) });
      }
    };
    tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [extUrl]);

  const saveExternal = () => {
    try {
      const v = String(extUrl || '').trim();
      if (v && !/^https?:\/\//.test(v)) {
        siteAlert('http(s):// 로 시작하는 URL 만 허용됩니다.');
        return;
      }
      if (v) localStorage.setItem(EXT_URL_KEY, v);
      else localStorage.removeItem(EXT_URL_KEY);
      siteToast(v ? '외부 endpoint 저장됨' : '외부 endpoint 해제됨');
    } catch { /* ignore */ }
  };

  const securityEvents = useMemo(() => {
    if (!summary?.securityEvents24h) return [];
    return Object.entries(summary.securityEvents24h)
      .map(([k, v]) => ({ event: k, count: v }))
      .sort((a, b) => b.count - a.count);
  }, [summary]);

  const exportCsv = () => {
    if (!securityEvents.length) {
      siteAlert('내보낼 보안 이벤트가 없습니다.');
      return;
    }
    downloadCSV(
      'daemu-security-events-' + new Date().toISOString().slice(0, 10) + '.csv',
      securityEvents,
      [
        { key: 'event', label: '이벤트' },
        { key: 'count', label: '24시간 발생 수' },
      ],
    );
  };

  const risk = summary?.riskLevel || 'low';
  // 개발자 IP 화이트리스트로 노이즈 제거.
  const ips = filterByDevIp(summary?.suspiciousIps1h || []);
  const authFail5m = summary?.authFailures5m ?? 0;
  const uniqueFailIps = summary?.uniqueFailedIps24h ?? 0;

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">보안 모니터링</h1>

          <PageActions>

            <GuideButton GuideComponent={SecurityGuide} />

          </PageActions>

          <p style={{ fontSize: 13, color: '#5a534b', margin: '0 0 16px', lineHeight: 1.7 }}>
            인증 실패 / 의심 IP / 보안 이벤트를 30초 주기로 실시간 추적합니다.
            <code> /admin/monitoring</code> 의 보안 섹션과 데이터를 공유하지만, 본 페이지는 보안 지표만 모아
            깊게 분석하기 위한 전용 화면입니다.
          </p>

          {!api.isConfigured() && (
            <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#5a4a2a' }}>
              백엔드가 연결되어 있지 않습니다 (VITE_API_BASE_URL 미설정) — 데모 모드.
            </div>
          )}
          {error && (
            <div style={{ background: '#fff0ec', border: '1px solid #f0c4c0', padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#7a1a14' }}>
              {error}
            </div>
          )}

          {/* 실시간 위험도 카드 */}
          <div style={{
            background: risk === 'high' ? '#fff0ec' : risk === 'medium' ? '#fff8ec' : '#eef6ee',
            border: '1px solid ' + (risk === 'high' ? '#f0c4c0' : risk === 'medium' ? '#f0e3c4' : '#cfe5cf'),
            borderLeft: '6px solid ' + probeColor(risk),
            padding: '20px 24px', marginBottom: 18,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8c867d' }}>현재 위험도</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: probeColor(risk), marginTop: 2 }}>
                  {risk === 'high' ? 'HIGH — 즉시 조치 필요' : risk === 'medium' ? 'MEDIUM — 주의 관찰' : 'LOW — 정상'}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#8c867d', textAlign: 'right' }}>
                {lastRun ? '마지막 갱신 ' + new Date(lastRun).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }) : '대기 중'}<br />
                30초 주기 자동 갱신
              </div>
            </div>
            {risk === 'high' && (
              <p style={{ fontSize: 13, color: '#7a1a14', margin: '6px 0 0', lineHeight: 1.7 }}>
                분산 무차별 대입 또는 DDoS 시도가 의심됩니다. 카페24 운영자 패널에서 fail2ban 정책 강화,
                ALLOWED_ORIGINS 점검, rate limit 강화를 권장합니다.
              </p>
            )}
            {risk === 'medium' && (
              <p style={{ fontSize: 13, color: '#5a4a2a', margin: '6px 0 0', lineHeight: 1.7 }}>
                비정상 로그인 시도가 감지됩니다. 의심 IP 목록을 점검하고 필요 시 차단을 검토하세요.
              </p>
            )}
          </div>

          {/* 실시간 KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Card label="최근 5분 인증 실패" value={String(authFail5m)}
              color={authFail5m >= 10 ? '#c0392b' : authFail5m >= 3 ? '#b87333' : '#2e7d32'} />
            <Card label="최근 1시간 의심 IP" value={String(ips.length)}
              color={ips.length >= 5 ? '#c0392b' : ips.length > 0 ? '#b87333' : '#2e7d32'} />
            <Card label="24h unique 실패 IP" value={String(uniqueFailIps)}
              color={uniqueFailIps >= 20 ? '#c0392b' : uniqueFailIps >= 5 ? '#b87333' : '#2e7d32'} />
            <Card label="24h 보안 이벤트 종류" value={String(securityEvents.length)}
              color="#5a534b" />
          </div>

          {/* 의심 IP 목록 */}
          <h3 className="admin-section-title">의심 IP (최근 1시간 인증 실패 3건+)</h3>
          {!ips.length ? (
            <div style={{ background: '#eef6ee', border: '1px solid #cfe5cf', padding: '12px 16px', marginBottom: 18, fontSize: 12.5, color: '#2a4a2c' }}>
              현재 의심 IP 가 없습니다 — 정상 상태.
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e6e3dd', marginBottom: 18 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f4f1ea' }}>
                    <th style={cellStyle}>IP</th>
                    <th style={cellStyle}>인증 실패 횟수</th>
                    <th style={cellStyle}>마지막 시도</th>
                  </tr>
                </thead>
                <tbody>
                  {ips.map((s) => (
                    <tr key={s.ip} style={{ borderTop: '1px solid #f0ede7' }}>
                      <td style={cellStyle}>
                        <code style={{ fontFamily: 'SF Mono, Menlo, monospace', color: '#7a1a14' }}>{s.ip}</code>
                      </td>
                      <td style={cellStyle}><strong style={{ color: '#c0392b' }}>×{s.count}</strong></td>
                      <td style={{ ...cellStyle, color: '#8c867d' }}>
                        {s.last_seen ? new Date(s.last_seen).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 24h 보안 이벤트 분포 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h3 className="admin-section-title" style={{ marginBottom: 0 }}>24시간 보안 이벤트 분포</h3>
            <button type="button" className="adm-btn-sm" onClick={exportCsv}>CSV 내보내기</button>
          </div>
          {!securityEvents.length ? (
            <div style={{ background: '#fafaf6', border: '1px solid #d7d4cf', padding: '12px 16px', marginBottom: 18, fontSize: 12.5, color: '#8c867d' }}>
              기록된 보안 이벤트가 없습니다.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 18 }}>
              {securityEvents.map((e) => (
                <Card key={e.event}
                  label={e.event}
                  value={String(e.count)}
                  color={e.event.includes('failure') || e.event.includes('throttled') || e.event.includes('lockout') ? '#c0392b' : e.event.includes('success') ? '#2e7d32' : '#5a534b'} />
              ))}
            </div>
          )}

          {/* 외부 보안 endpoint */}
          <h3 className="admin-section-title">외부 보안 endpoint 연동 (선택)</h3>
          <div style={{ background: '#fafaf6', border: '1px solid #e6e3dd', padding: '12px 16px', marginBottom: 18 }}>
            <p style={{ fontSize: 12.5, color: '#5a534b', margin: '0 0 8px', lineHeight: 1.7 }}>
              추후 카페24 / Render Starter / 자체 서버 등에 보안 이벤트 endpoint 가 생기면 여기 등록.
              30초 주기로 GET 호출하고 응답을 본 페이지 하단에 표시합니다 (CORS 가 허용되어야 호출 가능).
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="url" value={extUrl}
                onChange={(e) => setExtUrl(e.target.value)}
                placeholder="https://your-server.com/api/security/summary"
                style={{ flex: '1 1 320px', padding: '8px 12px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12.5, fontFamily: 'SF Mono, Menlo, monospace' }} />
              <button type="button" className="adm-btn-sm" onClick={saveExternal}
                style={{ background: '#1f5e7c', color: '#fff', borderColor: '#1f5e7c' }}>
                저장
              </button>
              {extUrl && (
                <button type="button" className="adm-btn-sm" onClick={() => { setExtUrl(''); saveExternal(); }}>
                  해제
                </button>
              )}
            </div>
            {external && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#231815', color: '#f0ede7', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', maxHeight: 240, overflow: 'auto' }}>
                <div style={{ color: external.ok ? '#9bd99b' : '#f0c4c0', marginBottom: 4 }}>
                  {external.ok ? `OK · status ${external.status}` : `FAIL · ${external.error || external.status}`}
                </div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {external.body ? JSON.stringify(external.body, null, 2) : (external.raw || '')}
                </pre>
              </div>
            )}
          </div>

          <SecurityToolsStatus />

          <EventStreamPanel
            defaultKindFilter="suspicious"
            height={420}
            description={
              <>backend 가 자동 탐지한 보안 이벤트 (suspicious_events) 만 시간 순으로 표시.
              auth 인증 흐름의 audit log 도 보고 싶으면 위 필터를 <code>audit</code> 또는
              <code>전체</code>로 변경. 5초 polling 으로 거의 실시간.</>
            }
          />
        </section>
      </main>
    </AdminShell>
  );
}

function Card({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dd', padding: '10px 14px' }}>
      <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>{label}</div>
      <div style={{ fontSize: 18, color, marginTop: 4, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// 보안 자동 도구 상태 카드 — backend 의 SuspiciousEvent 자동 기록 도구가
// 어떤 reason 으로 어떤 빈도로 동작 중인지 운영자가 한 눈에 본다.
//
// status 분류:
//   · active   — 24h 안에 실제 trigger 됨 (1건 이상)
//   · enabled  — backend 코드에 호출 site 가 있지만 24h 안에 trigger 없음 (조용)
//   · inactive — 코드에 호출 site 자체가 없음. 운영 단계에서 추가 예정.
const SECURITY_TOOLS = [
  // backend/suspicious.py REASON_LABELS + auth.py 의 실제 호출 site 매핑.
  { reason: 'brute_force_login',          label: '브루트포스 로그인',     wired: true,  desc: '동일 IP 가 15회/15분 내 로그인 실패 시 자동 high 기록.' },
  { reason: 'scrape_pattern',             label: '스크래핑 의심 트래픽',  wired: false, desc: 'enum 정의만. 운영 단계 nginx + middleware 연결 예정.' },
  { reason: 'csrf_violation',             label: 'CSRF 토큰 불일치',      wired: false, desc: 'enum 정의만. CSRF 미들웨어 도입 시 연결.' },
  { reason: 'unauthorized_admin_attempt', label: '비인가 어드민 접근',    wired: false, desc: 'enum 정의만. require_admin 거부 시점에 연결 예정.' },
  { reason: 'abnormal_payload',           label: '비정상 페이로드',       wired: false, desc: 'enum 정의만. Pydantic ValidationError 시점에 연결 예정.' },
  { reason: 'rate_limit_exceeded',        label: 'Rate limit 초과',       wired: false, desc: 'enum 정의만. slowapi/제어 미들웨어 도입 시 연결.' },
  { reason: 'geo_anomaly',                label: '비정상 지리 변화',      wired: false, desc: 'enum 정의만. GeoIP 비교 로직 도입 시 연결.' },
  { reason: 'uploaded_malware_signature', label: '업로드 악성 시그니처',  wired: false, desc: 'enum 정의만. ClamAV 등 백엔드 스캐너 도입 시 연결.' },
];

function _statusOf(wired, count24h) {
  if (count24h > 0) return 'active';
  if (wired) return 'enabled';
  return 'inactive';
}

function _statusColor(s) {
  if (s === 'active') return { bg: '#fef3e7', fg: '#b87333', border: '#f0d586' };
  if (s === 'enabled') return { bg: '#eef6ee', fg: '#2e7d32', border: '#cfe2cf' };
  return { bg: '#f5f2ec', fg: '#8c867d', border: '#d7d4cf' };
}

function _statusLabel(s) {
  if (s === 'active') return '🟠 활성 (24h 발생)';
  if (s === 'enabled') return '🟢 대기 (코드 연결 완료)';
  return '⚪ 비활성 (코드 연결 안 됨)';
}

function SecurityToolsStatus() {
  const [counts, setCounts] = useState({});      // reason → 24h count
  const [lastSeen, setLastSeen] = useState({});  // reason → ISO ts
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const fetchOnce = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!api.isConfigured()) {
      if (aliveRef.current) { setLoading(false); setError('백엔드 미연결'); }
      return;
    }
    // 24h 안의 suspicious_events 200건 fetch — reason 별 group by.
    const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await api.get(`/api/suspicious-events?limit=200&since=${encodeURIComponent(sinceIso)}`);
    if (!aliveRef.current) return;
    setLoading(false);
    if (!r?.ok || !Array.isArray(r.items)) {
      setError(r?.error || '도구 상태 조회 실패');
      return;
    }
    const byReason = {};
    const tsByReason = {};
    for (const it of r.items) {
      byReason[it.reason] = (byReason[it.reason] || 0) + 1;
      if (!tsByReason[it.reason] || it.ts > tsByReason[it.reason]) {
        tsByReason[it.reason] = it.ts;
      }
    }
    setCounts(byReason);
    setLastSeen(tsByReason);
    setError(null);
  };

  useEffect(() => {
    aliveRef.current = true;
    fetchOnce();
    const id = setInterval(fetchOnce, 30_000);  // 30초 주기 — 도구 상태는 자주 안 변함
    return () => { aliveRef.current = false; clearInterval(id); };
  }, []);

  return (
    <div style={{ marginTop: 32 }}>
      <h3 className="admin-section-title">보안 자동 도구 상태</h3>
      <p style={{ fontSize: 12, color: '#8c867d', marginTop: 4 }}>
        backend 의 <code>suspicious_events</code> 테이블에 자동 기록되는 보안 탐지 도구 8개의 상태.
        <strong>🟠 활성</strong> 은 24시간 안에 실제 trigger 가 발생한 도구, <strong>🟢 대기</strong>
        는 코드 연결이 완료돼 trigger 만 기다리는 도구, <strong>⚪ 비활성</strong> 은 enum 정의만 있고
        운영 단계에서 trigger 코드를 추가할 도구. 30초 주기 갱신.
      </p>
      {error && (
        <div style={{ padding: 10, marginBottom: 8, background: '#fdf2f0', color: '#c0392b',
          border: '1px solid #f0c5c0', fontSize: 12 }}>오류: {error}</div>
      )}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 10, marginTop: 12,
      }}>
        {SECURITY_TOOLS.map((tool) => {
          const c = counts[tool.reason] || 0;
          const status = _statusOf(tool.wired, c);
          const colors = _statusColor(status);
          return (
            <div key={tool.reason} style={{
              border: `1px solid ${colors.border}`, background: '#fff',
              padding: '10px 14px', borderLeft: `3px solid ${colors.fg}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#231815' }}>{tool.label}</div>
                <div style={{ fontSize: 11, color: colors.fg }}>{_statusLabel(status)}</div>
              </div>
              <div style={{ fontSize: 11, color: '#5a544c', marginTop: 4, lineHeight: 1.5 }}>{tool.desc}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#8c867d' }}>
                <span><code>{tool.reason}</code></span>
                <span>{loading ? '…' : `24h: ${c}건`}{lastSeen[tool.reason] && ` · 최근 ${new Date(lastSeen[tool.reason]).toLocaleTimeString('ko-KR', { hour12: false })}`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
const cellStyle = { padding: '8px 12px', textAlign: 'left', verticalAlign: 'top', fontSize: 12 };

function SecurityGuide({ onClose }) {
  return (
    <AdminGuideModal title="보안 모니터링 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          백엔드 <code>/api/monitoring/summary</code> 의 보안 지표만 모아 30초 주기로 실시간 추적합니다.
          기존 <code>/admin/monitoring</code> 의 보안 섹션과 데이터를 공유하므로 양쪽이 같은 값을 보여줍니다 — 본 페이지는
          깊은 분석 + CSV + 외부 endpoint 연동을 위한 전용 화면.
        </p>
      </GuideSection>
      <GuideSection title="위험도 분류 기준">
        <GuideTable
          headers={['단계', '의미', '대응']}
          rows={[
            ['LOW', '의심 IP 0~1, 인증 실패 5분<3', '관찰만'],
            ['MEDIUM', '의심 IP 2~4 또는 5분<10', 'IP 패턴 점검 + 운영자 알림 권장'],
            ['HIGH', '의심 IP 5+ 또는 5분 인증 실패 10+', 'fail2ban 정책 강화·rate limit·ALLOWED_ORIGINS 점검'],
          ]}
        />
      </GuideSection>
      <GuideSection title="외부 endpoint 연동">
        <p>
          카페24/Render Starter/자체 서버에 보안 이벤트 endpoint 가 생기면 URL 을 입력 → 30초 주기로 GET
          호출. CORS 헤더(<code>Access-Control-Allow-Origin: https://juyoungjun.github.io</code>) 가 응답에 포함되어야
          브라우저가 차단하지 않습니다.
        </p>
        <p style={{ fontSize: 12.5, color: '#5a4a2a' }}>
          현재는 단순 GET + JSON 응답 표시. 응답 포맷에 맞춘 KPI 통합은 endpoint 결정 후 추가 가능.
        </p>
      </GuideSection>
      <GuideSection title="추천 OSS 보안 도구 (참고용 — 즉시 적용 X)">
        <p>아래는 운영 단계에서 검토할 수 있는 무료/오픈소스 도구입니다. OS 형 도구(칼리리눅스 등)는 제외.</p>
        <ul style={guideListStyle}>
          <li><strong>fail2ban</strong> — 로그 패턴 기반 IP 차단. nginx/sshd 인증 실패 누적 시 자동 차단. 카페24 VPS 표준.</li>
          <li><strong>CrowdSec</strong> — 커뮤니티 IP 평판 + behavior detection. fail2ban 보다 모던, 협업형 차단 리스트.</li>
          <li><strong>OSSEC / Wazuh</strong> — HIDS(Host Intrusion Detection). 파일 무결성·로그 분석·룰 기반 탐지. Wazuh 가 모던 fork.</li>
          <li><strong>Suricata</strong> — IDS/IPS. 네트워크 트래픽 룰 기반 탐지. Snort 후속.</li>
          <li><strong>Falco</strong> — 컨테이너 런타임 보안. 비정상 시스템 콜 탐지. Render·Fly·Docker 환경에서 유용.</li>
          <li><strong>Grafana + Loki + Promtail</strong> — 로그 집계/대시보드. 보안 이벤트 시각화에 적합. 무료(self-host).</li>
          <li><strong>Trivy</strong> — 컨테이너 이미지 / IaC 취약점 스캐너. CI/CD 통합.</li>
          <li><strong>OWASP ZAP</strong> — 웹 취약점 스캐너. 운영 전 주기적 점검용.</li>
          <li><strong>Snyk</strong>(이미 사용) — 의존성 / 코드 취약점. GitHub Action 으로 PR 마다 자동.</li>
          <li><strong>Cloudflare Free</strong> — WAF + DDoS + Bot Fight. CNAME 만 변경하면 즉시 적용. 가장 큰 효과 대비 가장 적은 운영 비용.</li>
          <li><strong>UptimeRobot / Pingdom</strong> — 외부 모니터링. 가용성 + ping → render 슬립 방어 도 함께.</li>
        </ul>
        <p style={{ fontSize: 12.5, color: '#5a4a2a', background: '#fff8ec', padding: '10px 14px', borderLeft: '3px solid #c9a25a', marginTop: 10 }}>
          1인 운영 단계 권장 조합: <strong>Cloudflare Free + fail2ban + Wazuh(or 단순 로그 + Grafana) + Snyk</strong>.
          이 4개로 웹 layer / 호스트 layer / 종속성까지 커버됩니다.
        </p>
      </GuideSection>
    </AdminGuideModal>
  );
}
