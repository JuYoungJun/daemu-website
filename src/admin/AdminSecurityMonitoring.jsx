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

          <SecurityHeadersAuditor />

          <AttackSurfaceProbe />

          <JwtDecoder />

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
  { reason: 'brute_force_login',          label: '브루트포스 로그인',     wired: true,  desc: '동일 IP 가 5회/15분 내 로그인 실패 시 자동 high 기록 (admin + partner).' },
  { reason: 'unauthorized_admin_attempt', label: '비인가 어드민 접근',    wired: true,  desc: 'require_admin / require_perm 거부 시점에 medium 기록. role 부족 + 권한 매트릭스 외 시도.' },
  { reason: 'abnormal_payload',           label: '비정상 페이로드',       wired: true,  desc: 'Pydantic 422 (RequestValidationError) 발생 시 low 기록. 정상 1-2회는 noise, 반복 IP 가 fuzzing 단서.' },
  { reason: 'rate_limit_exceeded',        label: 'Rate limit 초과',       wired: true,  desc: '/api/inquiries / /api/partners/apply / /api/newsletter/subscribe 의 IP 단위 429 도달 시 low 기록.' },
  { reason: 'scrape_pattern',             label: '스크래핑 의심 트래픽',  wired: false, desc: 'enum 정의만. 운영 단계 nginx log heuristic + middleware 연결 예정.' },
  { reason: 'csrf_violation',             label: 'CSRF 토큰 불일치',      wired: false, desc: 'enum 정의만. 현재는 stateless JWT 라 CSRF 표면 없음. cookie 인증 전환 시 연결.' },
  { reason: 'geo_anomaly',                label: '비정상 지리 변화',      wired: false, desc: 'enum 정의만. login 직후 GeoIP 비교 로직 도입 시 연결 (CrmCustomer.geo_cache 활용).' },
  { reason: 'uploaded_malware_signature', label: '업로드 악성 시그니처',  wired: false, desc: 'enum 정의만. ClamAV / YARA 등 백엔드 스캐너 도입 시 연결.' },
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


// ───────────────────────────────────────────────────────────────────────
// 보안 도구 #1 — 응답 헤더 점검기
//
// 운영자가 입력한 URL 또는 default (현재 backend `/api/health`) 에 fetch 보내
// 응답 헤더의 보안 관련 항목 (HSTS / CSP / X-Frame-Options / X-Content-Type-Options
// / Referrer-Policy / Permissions-Policy 등) 을 grade 표로 표시.
// CORS 제약: 동일 origin 또는 backend 가 `Access-Control-Expose-Headers` 로
// 헤더를 노출해야 readable. 그 외엔 "(브라우저 비공개)" 표시.
const SECURITY_HEADER_TARGETS = [
  { key: 'strict-transport-security', label: 'HSTS', good: (v) => /max-age=\d{7,}/i.test(v), hint: 'max-age ≥ 6개월 권장 (15768000+)' },
  { key: 'content-security-policy', label: 'CSP', good: (v) => v && !/unsafe-inline/i.test(v), hint: 'unsafe-inline 제거 권장' },
  { key: 'x-frame-options', label: 'X-Frame-Options', good: (v) => /DENY|SAMEORIGIN/i.test(v), hint: 'DENY 또는 SAMEORIGIN' },
  { key: 'x-content-type-options', label: 'X-Content-Type-Options', good: (v) => /nosniff/i.test(v), hint: 'nosniff' },
  { key: 'referrer-policy', label: 'Referrer-Policy', good: (v) => /no-referrer|same-origin|strict-origin/i.test(v), hint: 'strict-origin-when-cross-origin 권장' },
  { key: 'permissions-policy', label: 'Permissions-Policy', good: (v) => Boolean(v), hint: 'camera=(), microphone=() 등 명시' },
  { key: 'cross-origin-opener-policy', label: 'COOP', good: (v) => /same-origin/i.test(v), hint: 'same-origin' },
  { key: 'cross-origin-resource-policy', label: 'CORP', good: (v) => /same-origin|same-site/i.test(v), hint: 'same-origin 또는 same-site' },
];

function SecurityHeadersAuditor() {
  const [target, setTarget] = useState(() => {
    const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
    return base ? `${base}/api/health` : '';
  });
  const [headers, setHeaders] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true); setError(''); setHeaders(null); setStatus(null);
    try {
      const url = String(target || '').trim();
      if (!/^https?:\/\//.test(url)) {
        setError('http(s):// 로 시작하는 URL 만 허용');
        setRunning(false);
        return;
      }
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      const out = {};
      for (const k of SECURITY_HEADER_TARGETS) {
        out[k.key] = res.headers.get(k.key);
      }
      setHeaders(out); setStatus(res.status);
    } catch (e) {
      setError(String(e?.message || e));
    } finally { setRunning(false); }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <h3 className="admin-section-title">응답 헤더 보안 점검</h3>
      <p style={{ fontSize: 12, color: '#8c867d', marginTop: 4, lineHeight: 1.6 }}>
        backend 또는 정적 자산 URL 의 응답 헤더에서 HSTS / CSP / X-Frame-Options / Referrer-Policy 등 8개 보안 헤더를 확인.
        cross-origin 응답은 브라우저가 일부 헤더를 숨길 수 있으며 (CORS 제약), 그 경우 backend 가
        <code> Access-Control-Expose-Headers</code> 로 명시 노출해야 readable.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input type="url" value={target} onChange={(e) => setTarget(e.target.value)}
          placeholder="https://your-backend.example.com/api/health" maxLength={500}
          style={{ flex: '1 1 320px', padding: '8px 12px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12.5, fontFamily: 'SF Mono, Menlo, monospace' }} />
        <button type="button" className="adm-btn-sm" onClick={run} disabled={running}
          style={{ background: '#1f5e7c', color: '#fff', borderColor: '#1f5e7c', minWidth: 96 }}>
          {running ? '확인 중…' : '헤더 확인'}
        </button>
      </div>
      {error && (
        <div style={{ background: '#fdf2f0', color: '#c0392b', border: '1px solid #f0c5c0', padding: '8px 12px', fontSize: 12 }}>
          {error}
        </div>
      )}
      {headers && (
        <div style={{ background: '#fff', border: '1px solid #e6e3dd' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f4f1ea' }}>
                <th style={cellStyle}>헤더</th>
                <th style={cellStyle}>응답 값</th>
                <th style={cellStyle}>판정</th>
                <th style={cellStyle}>권장</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: '1px solid #f0ede7', background: '#fafaf6' }}>
                <td style={cellStyle} colSpan={4}><strong>HTTP {status}</strong></td>
              </tr>
              {SECURITY_HEADER_TARGETS.map((h) => {
                const v = headers[h.key];
                const ok = v ? h.good(v) : false;
                return (
                  <tr key={h.key} style={{ borderTop: '1px solid #f0ede7' }}>
                    <td style={cellStyle}><code>{h.label}</code></td>
                    <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace', color: v ? '#231815' : '#8c867d', wordBreak: 'break-all' }}>
                      {v || <em>(없음 또는 브라우저 비공개)</em>}
                    </td>
                    <td style={cellStyle}>
                      <span style={{ color: ok ? '#2e7d32' : '#c0392b', fontWeight: 600 }}>
                        {ok ? '✓ 양호' : '⚠ 미흡'}
                      </span>
                    </td>
                    <td style={{ ...cellStyle, color: '#5a534b' }}>{h.hint}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────────
// 보안 도구 #2 — 공격 표면 빠른 점검
//
// 자기 사이트의 공개 자산을 외부 attacker 시점에서 확인. robots.txt /
// sitemap.xml / security.txt 는 200 (의도), .env / .git/HEAD / phpinfo.php
// /wp-admin 등은 404 (의도). 200 이 뜨면 의심.
const PROBE_TARGETS = [
  { path: '/robots.txt', expect: '200', label: 'robots.txt' },
  { path: '/sitemap.xml', expect: '200', label: 'sitemap.xml' },
  { path: '/.well-known/security.txt', expect: '200', label: 'security.txt' },
  { path: '/llms.txt', expect: '200', label: 'llms.txt' },
  { path: '/.env', expect: '404', label: '.env (노출 X)' },
  { path: '/.env.local', expect: '404', label: '.env.local (노출 X)' },
  { path: '/.git/HEAD', expect: '404', label: '.git/HEAD (노출 X)' },
  { path: '/.git/config', expect: '404', label: '.git/config (노출 X)' },
  { path: '/phpinfo.php', expect: '404', label: 'phpinfo.php (노출 X)' },
  { path: '/wp-admin', expect: '404', label: 'wp-admin (노출 X)' },
  { path: '/.DS_Store', expect: '404', label: '.DS_Store (노출 X)' },
  { path: '/backup.zip', expect: '404', label: 'backup.zip (노출 X)' },
];

function AttackSurfaceProbe() {
  const [origin, setOrigin] = useState(() => {
    if (typeof window !== 'undefined') {
      // SPA 가 sub-path 에 deploy 될 수 있어 origin + base 분리.
      const baseUrl = import.meta.env.BASE_URL || '/';
      return window.location.origin + (baseUrl === '/' ? '' : baseUrl.replace(/\/$/, ''));
    }
    return '';
  });
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true); setResults([]);
    const items = [];
    for (const t of PROBE_TARGETS) {
      const url = origin.replace(/\/$/, '') + t.path;
      try {
        const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'manual' });
        const matched = String(res.status) === t.expect || (t.expect === '404' && res.status >= 400);
        items.push({ ...t, status: res.status, ok: matched });
      } catch (e) {
        // network error 는 CORS / DNS 실패. 노출 X 케이스로 간주.
        items.push({ ...t, status: 'ERR', ok: t.expect === '404', error: String(e?.message || e) });
      }
      setResults([...items]);
    }
    setRunning(false);
  };

  const issues = results.filter((r) => !r.ok);

  return (
    <div style={{ marginTop: 32 }}>
      <h3 className="admin-section-title">공격 표면 빠른 점검</h3>
      <p style={{ fontSize: 12, color: '#8c867d', marginTop: 4, lineHeight: 1.6 }}>
        외부 attacker 시점에서 시도 가능한 공개 경로 12종을 일괄 점검.
        robots/sitemap/security.txt 는 200 이 정상이고, .env / .git/HEAD / phpinfo.php / wp-admin 등은 404 가
        정상. 200 이 뜨는 항목은 즉시 확인 필요.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input type="url" value={origin} onChange={(e) => setOrigin(e.target.value)}
          placeholder="https://your-domain.example.com" maxLength={300}
          style={{ flex: '1 1 280px', padding: '8px 12px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12.5, fontFamily: 'SF Mono, Menlo, monospace' }} />
        <button type="button" className="adm-btn-sm" onClick={run} disabled={running}
          style={{ background: '#1f5e7c', color: '#fff', borderColor: '#1f5e7c', minWidth: 96 }}>
          {running ? `확인 중… (${results.length}/${PROBE_TARGETS.length})` : '전체 점검'}
        </button>
      </div>
      {!!results.length && (
        <>
          <div style={{
            background: issues.length ? '#fdf2f0' : '#eef6ee',
            border: '1px solid ' + (issues.length ? '#f0c5c0' : '#cfe5cf'),
            padding: '10px 14px', marginBottom: 10, fontSize: 12.5,
            color: issues.length ? '#7a1a14' : '#2a4a2c',
          }}>
            {issues.length
              ? `⚠ 점검 항목 ${issues.length}개 비정상 — 아래 빨간 행 확인.`
              : `✓ 12개 점검 항목 모두 정상.`}
          </div>
          <div style={{ background: '#fff', border: '1px solid #e6e3dd' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f4f1ea' }}>
                  <th style={cellStyle}>경로</th>
                  <th style={cellStyle}>기대</th>
                  <th style={cellStyle}>실제</th>
                  <th style={cellStyle}>판정</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.path} style={{ borderTop: '1px solid #f0ede7', background: r.ok ? 'transparent' : '#fdf6f4' }}>
                    <td style={cellStyle}><code>{r.path}</code></td>
                    <td style={cellStyle}>{r.expect}</td>
                    <td style={cellStyle}><code>{r.status}</code></td>
                    <td style={cellStyle}>
                      <span style={{ color: r.ok ? '#2e7d32' : '#c0392b', fontWeight: 600 }}>
                        {r.ok ? '✓ 정상' : '⚠ 확인 필요'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────────
// 보안 도구 #3 — JWT 디코더
//
// 운영자가 paste 한 토큰의 claims 표시. signature 검증은 server-side 필요라
// 본 도구는 decode 만 (HMAC 키 없이 payload base64url 직접 파싱).
// 의심 토큰 분석, 디버깅 (exp 시각, role, scope 클레임), 운영자 본인 토큰
// 확인 등에 유용. 토큰은 localStorage 에 절대 저장하지 않음.
function _b64UrlDecode(s) {
  // base64url → base64 (pad)
  let pad = s.length % 4;
  if (pad) s = s + '='.repeat(4 - pad);
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  try { return decodeURIComponent(escape(atob(s))); }
  catch { return atob(s); }
}

// B-10: token 자체 크기 cap — 64KB. 정상 JWT 는 길어야 4KB 수준. attacker /
// 운영자 실수로 매우 큰 base64 paste 시 React state + JSON.parse 가 메모리
// 폭증 / 브라우저 freeze. 호출자 (decode) 에서 우선 검증.
const JWT_TOKEN_MAX_BYTES = 64 * 1024;

function _parseJwt(token) {
  if (token.length > JWT_TOKEN_MAX_BYTES) {
    throw new Error(`token 길이가 너무 큽니다 (${token.length}B > ${JWT_TOKEN_MAX_BYTES}B 한도)`);
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT 가 아닙니다 (3 segments 가 아님)');
  try {
    const header = JSON.parse(_b64UrlDecode(parts[0]));
    const payload = JSON.parse(_b64UrlDecode(parts[1]));
    return { header, payload, signature: parts[2] };
  } catch (e) {
    // B-4: token 원문이 error 메시지에 포함되지 않게 generic 메시지만.
    // 진단용 정보는 console (개발자 도구) 에만 — UI 화면 노출 X.
    // eslint-disable-next-line no-console
    console.warn('[JwtDecoder] parse error:', e && e.message);
    throw new Error('JWT 파싱 실패 — base64 decode 또는 JSON 형식 오류');
  }
}

function JwtDecoder() {
  const [token, setToken] = useState('');
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');

  const decode = () => {
    setError(''); setParsed(null);
    const t = String(token || '').trim();
    if (!t) { setError('token 입력 필요'); return; }
    try {
      const r = _parseJwt(t);
      setParsed(r);
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const useMyToken = () => {
    try {
      const t = localStorage.getItem('daemu_admin_token') || '';
      if (t) setToken(t);
      else setError('현재 admin token 없음 — 로그인 후 사용');
    } catch { setError('localStorage 접근 실패'); }
  };

  const now = Math.floor(Date.now() / 1000);
  const exp = parsed?.payload?.exp;
  const iat = parsed?.payload?.iat;
  const expired = exp && exp < now;
  const ttlRemainSec = exp ? Math.max(0, exp - now) : null;

  return (
    <div style={{ marginTop: 32, marginBottom: 32 }}>
      <h3 className="admin-section-title">JWT 디코더</h3>
      <p style={{ fontSize: 12, color: '#8c867d', marginTop: 4, lineHeight: 1.6 }}>
        토큰 paste 시 header / payload / exp / scope / role 등 표시. <strong>signature 검증은 안 함</strong>
        (server-side JWT_SECRET 필요) — 디버깅·의심 토큰 분석용. 입력 토큰은 화면 표시만 하고 storage 에 저장하지 않음.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
        <textarea value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="eyJhbGciOi..." rows={3} maxLength={JWT_TOKEN_MAX_BYTES}
          style={{ flex: '1 1 320px', padding: '8px 12px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12, fontFamily: 'SF Mono, Menlo, monospace', resize: 'vertical' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" className="adm-btn-sm" onClick={decode}
            style={{ background: '#1f5e7c', color: '#fff', borderColor: '#1f5e7c', minWidth: 110 }}>디코드</button>
          <button type="button" className="adm-btn-sm" onClick={useMyToken}>내 토큰 사용</button>
          <button type="button" className="adm-btn-sm" onClick={() => { setToken(''); setParsed(null); setError(''); }}>지우기</button>
        </div>
      </div>
      {error && (
        <div style={{ background: '#fdf2f0', color: '#c0392b', border: '1px solid #f0c5c0', padding: '8px 12px', fontSize: 12 }}>
          {error}
        </div>
      )}
      {parsed && (
        <div style={{ background: '#fff', border: '1px solid #e6e3dd' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              <tr style={{ borderTop: '1px solid #f0ede7' }}>
                <td style={{ ...cellStyle, width: 140 }}><strong>alg</strong></td>
                <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace' }}>{parsed.header.alg || '—'}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #f0ede7' }}>
                <td style={cellStyle}><strong>typ</strong></td>
                <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace' }}>{parsed.header.typ || '—'}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #f0ede7' }}>
                <td style={cellStyle}><strong>sub</strong></td>
                <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace' }}>{String(parsed.payload.sub || '—')}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #f0ede7' }}>
                <td style={cellStyle}><strong>scope</strong></td>
                <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace' }}>
                  <span style={{ color: parsed.payload.scope === 'admin' ? '#1f5e7c' : '#b87333', fontWeight: 600 }}>
                    {parsed.payload.scope || '(없음 — 옛 token)'}
                  </span>
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid #f0ede7' }}>
                <td style={cellStyle}><strong>role</strong></td>
                <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace' }}>{parsed.payload.role || '—'}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #f0ede7' }}>
                <td style={cellStyle}><strong>email</strong></td>
                <td style={{ ...cellStyle, fontFamily: 'SF Mono, Menlo, monospace' }}>{parsed.payload.email || '—'}</td>
              </tr>
              {iat && (
                <tr style={{ borderTop: '1px solid #f0ede7' }}>
                  <td style={cellStyle}><strong>iat</strong></td>
                  <td style={cellStyle}>{new Date(iat * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td>
                </tr>
              )}
              {exp && (
                <tr style={{ borderTop: '1px solid #f0ede7', background: expired ? '#fdf2f0' : 'transparent' }}>
                  <td style={cellStyle}><strong>exp</strong></td>
                  <td style={cellStyle}>
                    {new Date(exp * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    <span style={{ marginLeft: 12, color: expired ? '#c0392b' : '#2e7d32', fontWeight: 600 }}>
                      {expired
                        ? '⚠ 만료됨'
                        : `✓ ${Math.floor(ttlRemainSec / 3600)}h ${Math.floor((ttlRemainSec % 3600) / 60)}m 남음`}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <details style={{ padding: '8px 12px', background: '#fafaf6', borderTop: '1px solid #e6e3dd' }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: '#5a534b' }}>전체 payload (JSON)</summary>
            <pre style={{ margin: '8px 0 0', padding: 8, background: '#231815', color: '#f0ede7', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', overflow: 'auto', maxHeight: 240 }}>
              {JSON.stringify(parsed.payload, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

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
