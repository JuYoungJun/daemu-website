// 유지보수 모니터링 페이지.
//
// Sources of operational signal (in order of usefulness):
//   1. localStorage 'daemu_outbox'    — every authenticated mutating API call
//      logged by lib/api.js, so failed/error rows here are real recent errors.
//   2. window.daemu_runtime_errors    — captured by ErrorBoundary + a global
//      error listener installed below. Populated only while the admin tab is
//      open, but useful to see what breaks during operation.
//   3. /api/monitoring/health         — backend health probe (DB latency, etc).
//
// 출력 페이지는 운영자가 바로 보는 화면이므로 한국어 라벨, 친절한 에러 설명,
// "복구 액션" 힌트를 함께 보여줍니다.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';

const KIND_LABEL = {
  outbox_failed: '발송 실패',
  outbox_error: 'API 호출 오류',
  runtime_error: '브라우저 런타임 에러',
  upload_error: '업로드 실패',
};

const SEVERITY_COLOR = {
  high: '#c0392b',
  med: '#b87333',
  low: '#6f6b68',
};

function loadOutbox() {
  try { return JSON.parse(localStorage.getItem('daemu_outbox') || '[]'); }
  catch { return []; }
}

function loadRuntimeErrors() {
  if (typeof window === 'undefined') return [];
  return (window.daemu_runtime_errors || []).slice(0, 50);
}

function installRuntimeListeners() {
  if (window.__daemu_monitoring_installed) return;
  window.__daemu_monitoring_installed = true;
  window.daemu_runtime_errors = window.daemu_runtime_errors || [];
  const push = (entry) => {
    window.daemu_runtime_errors.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      ...entry,
    });
    window.daemu_runtime_errors = window.daemu_runtime_errors.slice(0, 100);
    try { window.dispatchEvent(new Event('daemu-monitoring-tick')); } catch { /* ignore */ }
  };
  window.addEventListener('error', (e) => {
    push({ kind: 'runtime_error', message: e.message || String(e), source: e.filename || '', lineno: e.lineno || 0 });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason && (e.reason.message || String(e.reason)) || 'unhandled rejection';
    push({ kind: 'runtime_error', message: msg, source: 'promise' });
  });
}

export default function AdminMonitoring() {
  const [outbox, setOutbox] = useState(() => loadOutbox());
  const [errors, setErrors] = useState(() => loadRuntimeErrors());
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    installRuntimeListeners();
    const refresh = () => {
      setOutbox(loadOutbox());
      setErrors(loadRuntimeErrors());
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    window.addEventListener('daemu-monitoring-tick', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
      window.removeEventListener('daemu-monitoring-tick', refresh);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      if (!api.isConfigured()) {
        if (alive) setHealth({ ok: false, demo: true });
        return;
      }
      const [h, s] = await Promise.all([
        api.get('/api/health'),
        api.get('/api/monitoring/summary'),
      ]);
      if (!alive) return;
      setHealth({ ok: !!h.ok, ...h });
      if (s.ok) setSummary(s);
    };
    probe();
    const id = setInterval(probe, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Failed/error rows from outbox become "최근 운영 오류".
  const recentFailures = outbox.filter((e) => e.status === 'failed' || e.status === 'error').slice(0, 25);
  const failedCount24h = recentFailures.filter((e) => Date.now() - new Date(e.ts).getTime() < 24 * 3600 * 1000).length;

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">유지보수 모니터링</h1>

          <AdminHelp title="모니터링 사용 안내" items={[
            '백엔드 운영 요약 카드들은 1분 주기로 새로고침되며 실제 backend DB 통계를 보여줍니다.',
            'DB 응답시간이 100ms 미만이면 정상, 500ms 초과는 콜드 스타트 또는 트래픽 과부하 신호입니다.',
            '24시간 발송 실패가 있다면 RESEND_API_KEY/SMTP_HOST 환경변수 또는 Resend 도메인 인증을 점검하세요.',
            '보안 이벤트(login.failure, login.totp.failure 등)는 비정상 시도가 있는지 추적합니다.',
            '오류가 있는 항목은 Outbox에서도 동일하게 확인할 수 있습니다. 브라우저 런타임 에러는 본 탭이 열려있는 동안만 수집.',
          ]} />

          {/* 1행 — 인프라/시스템 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Card label="백엔드 상태"
              value={health?.demo ? '데모(미연결)' : (health?.ok ? '정상' : '오류')}
              color={health?.demo ? '#6f6b68' : (health?.ok ? '#2e7d32' : '#c0392b')} />
            <Card label="버전" value={String(health?.version || '—')} color="#6f6b68" />
            <Card label="DB 응답"
              value={summary?.dbLatencyMs != null ? `${summary.dbLatencyMs} ms` : '—'}
              color={(summary?.dbLatencyMs ?? 9999) < 100 ? '#2e7d32' : (summary?.dbLatencyMs ?? 9999) < 500 ? '#b87333' : '#c0392b'} />
            <Card label="이메일 발송"
              value={
                health?.emailProvider === 'resend' ? 'Resend' :
                health?.emailProvider === 'smtp' ? 'SMTP' :
                '미설정 (시뮬)'
              }
              color={health?.emailProvider === 'none' ? '#c0392b' : '#2e7d32'} />
          </div>

          {(health?.warnings || []).length > 0 && (
            <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', padding: '12px 16px', marginBottom: 14, fontSize: 12.5, color: '#5a4a2a', borderRadius: 4 }}>
              {health.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          {/* 보안 이상 징후 — 해킹/DDoS 의심 */}
          {summary && (
            <div style={{
              background: summary.riskLevel === 'high' ? '#fff0ec' : summary.riskLevel === 'medium' ? '#fff8ec' : '#eef6ee',
              border: '1px solid ' + (summary.riskLevel === 'high' ? '#f0c4c0' : summary.riskLevel === 'medium' ? '#f0e3c4' : '#cfe5cf'),
              borderLeft: '3px solid ' + (summary.riskLevel === 'high' ? '#c0392b' : summary.riskLevel === 'medium' ? '#b87333' : '#2e7d32'),
              padding: '14px 18px',
              marginBottom: 18,
              borderRadius: 4,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: summary.riskLevel === 'high' ? '#c0392b' : summary.riskLevel === 'medium' ? '#b87333' : '#2e7d32' }}>
                  {summary.riskLevel === 'high' ? '보안 위험도 — 높음' : summary.riskLevel === 'medium' ? '보안 위험도 — 주의' : '보안 위험도 — 정상'}
                </div>
                <div style={{ fontSize: 11, color: '#8c867d' }}>
                  최근 1시간 의심 IP <strong>{(summary.suspiciousIps1h || []).length}</strong>개 ·
                  최근 5분 인증 실패 <strong>{summary.authFailures5m ?? 0}</strong>건 ·
                  24h unique 실패 IP <strong>{summary.uniqueFailedIps24h ?? 0}</strong>개
                </div>
              </div>
              {summary.riskLevel === 'high' && (
                <p style={{ fontSize: 12, color: '#c0392b', margin: '6px 0 0', lineHeight: 1.6 }}>
                  분산 무차별 대입 공격 또는 DDoS 의심. 카페24 운영자 패널에서 fail2ban 정책 강화 또는 ALLOWED_ORIGINS·rate limit 점검을 권장합니다.
                </p>
              )}
              {summary.riskLevel === 'medium' && (
                <p style={{ fontSize: 12, color: '#5a4a2a', margin: '6px 0 0', lineHeight: 1.6 }}>
                  비정상 로그인 시도가 감지됩니다. 의심 IP 목록을 확인하고 필요시 차단 조치를 검토하세요.
                </p>
              )}
              {(summary.suspiciousIps1h || []).length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #d7d4cf' }}>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>의심 IP (최근 1시간 인증 실패 3건+)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {summary.suspiciousIps1h.slice(0, 8).map((s) => (
                      <code key={s.ip} style={{ background: '#fff', padding: '4px 10px', border: '1px solid #d7d4cf', fontSize: 11, fontFamily: 'monospace' }}>
                        {s.ip} <span style={{ color: '#c0392b' }}>×{s.count}</span>
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2행 — 24시간 운영 통계 */}
          <h3 className="admin-section-title" style={{ marginTop: 14 }}>최근 24시간</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Card label="이메일 발송 (24h)"
              value={
                summary ? Object.entries(summary.outbox24h || {}).map(([k, v]) => `${k}:${v}`).join(' · ') || '0' : '—'
              }
              color="#6f6b68" />
            <Card label="발송 실패 (24h)"
              value={String((summary?.outbox24h || {}).failed || (summary?.outbox24h || {}).error || 0)}
              color={((summary?.outbox24h || {}).failed || 0) > 0 ? '#c0392b' : '#2e7d32'} />
            <Card label="신규 문의 (24h)"
              value={String(summary?.inquiries24h ?? '—')}
              color="#1f5e7c" />
            <Card label="미답변 문의 (전체)"
              value={String(summary?.newInquiries ?? '—')}
              color={(summary?.newInquiries ?? 0) > 5 ? '#c0392b' : '#6f6b68'} />
          </div>

          {/* 3행 — 비즈니스 데이터 */}
          <h3 className="admin-section-title">비즈니스 데이터</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Card label="활성 파트너" value={String(summary?.activePartners ?? '—')} color="#1f5e7c" />
            <Card label="뉴스레터 활성 구독자" value={String(summary?.newsletterActive ?? '—')} color="#1f5e7c" />
            <Card label="누적 발송 이력" value={String(summary?.outboxTotal ?? outbox.length)} color="#6f6b68" />
            <Card label="런타임 에러(현 세션)" value={String(errors.length)}
              color={errors.length > 0 ? '#b87333' : '#6f6b68'} />
          </div>

          {summary?.documentsByStatus && Object.keys(summary.documentsByStatus).length > 0 && (
            <>
              <h3 className="admin-section-title">계약/PO 문서 상태</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
                {Object.entries(summary.documentsByStatus).map(([k, v]) => (
                  <Card key={k} label={k} value={String(v)} color="#5a534b" />
                ))}
              </div>
            </>
          )}

          {summary?.securityEvents24h && Object.keys(summary.securityEvents24h).length > 0 && (
            <>
              <h3 className="admin-section-title">보안 이벤트 (24h)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                {Object.entries(summary.securityEvents24h).map(([k, v]) => (
                  <Card key={k} label={k} value={String(v)}
                    color={k.includes('failure') || k.includes('throttled') ? '#c0392b' :
                           k.includes('success') ? '#2e7d32' : '#6f6b68'} />
                ))}
              </div>
            </>
          )}

          {summary?.recentFailures?.length > 0 && (
            <>
              <h3 className="admin-section-title">최근 발송 실패 (백엔드 기록)</h3>
              <div style={{ marginBottom: 14 }}>
                {summary.recentFailures.map((f) => (
                  <div key={f.id} style={{ background: '#fff', border: '1px solid #f0d6d2', padding: '10px 14px', marginBottom: 8, fontSize: 12 }}>
                    <span style={{ color: '#c0392b', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', marginRight: 8 }}>{f.type}</span>
                    {f.to} · {f.subject || '(제목 없음)'}<br />
                    <span style={{ color: '#8c867d', fontSize: 11 }}>{new Date(f.ts).toLocaleString('ko')} · {f.error}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h3 className="admin-section-title">최근 운영 오류</h3>
          {!recentFailures.length ? (
            <EmptyState text="기록된 오류가 없습니다. 시스템이 정상 동작 중입니다." />
          ) : (
            <div>
              {recentFailures.map((e) => (
                <ErrorRow key={e.id} entry={e} kind="outbox" />
              ))}
            </div>
          )}

          <h3 className="admin-section-title" style={{ marginTop: 36 }}>브라우저 런타임 에러 (현 세션)</h3>
          {!errors.length ? (
            <EmptyState text="현 세션에서 발생한 자바스크립트 에러가 없습니다." />
          ) : (
            <div>
              {errors.map((e) => (
                <ErrorRow key={e.id} entry={e} kind="runtime" />
              ))}
            </div>
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function Card({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '18px 20px' }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color }}>{value}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c867d', background: '#fff', border: '1px dashed #d7d4cf' }}>
      <p>{text}</p>
    </div>
  );
}

function ErrorRow({ entry, kind }) {
  if (kind === 'outbox') {
    return (
      <div style={{ border: '1px solid #d7d4cf', padding: '14px 18px', marginBottom: 10, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 6 }}>
          <span style={{ color: SEVERITY_COLOR.high, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
            {entry.status === 'failed' ? '발송 실패' : 'API 호출 오류'} · {entry.path}
          </span>
          <span style={{ fontSize: 11, color: '#8c867d' }}>{new Date(entry.ts).toLocaleString('ko')}</span>
        </div>
        {entry.error && <div style={{ fontSize: 13, color: '#c0392b' }}>{entry.error}</div>}
        {entry.body?.to && <div style={{ fontSize: 12, color: '#4a4744', marginTop: 6 }}>수신자: {entry.body.to}</div>}
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid #d7d4cf', padding: '14px 18px', marginBottom: 10, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 6 }}>
        <span style={{ color: SEVERITY_COLOR.med, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          {KIND_LABEL[entry.kind] || entry.kind}
        </span>
        <span style={{ fontSize: 11, color: '#8c867d' }}>{new Date(entry.ts).toLocaleString('ko')}</span>
      </div>
      <div style={{ fontSize: 13, color: '#4a4744', wordBreak: 'break-word' }}>{entry.message}</div>
      {entry.source && <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>{entry.source}{entry.lineno ? ':' + entry.lineno : ''}</div>}
    </div>
  );
}
