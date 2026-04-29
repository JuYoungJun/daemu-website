// 보안 모니터링 — 실시간 보안 KPI 전용 페이지.
//
// /admin/monitoring 의 보안 섹션은 그대로 유지하고, 본 페이지는 보안 지표만
// 모아 30초 주기로 자동 갱신한다. 의심 IP / 인증 실패 / 보안 이벤트 / 외부
// 보안 endpoint(추후 카페24·Render Starter 등 결제 서버) 연동 설정.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
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
