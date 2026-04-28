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
      const r = await api.get('/api/health');
      if (alive) setHealth({ ok: !!r.ok, ...r });
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
            '이 페이지는 운영 중 발생한 오류를 빠르게 찾기 위한 도구입니다. 실제 사용자에게 영향을 준 오류는 "발송 실패"와 "API 호출 오류"에 모입니다.',
            '백엔드 헬스: 1분마다 /api/health를 조회합니다. 빨간색이면 사이트 → 백엔드 연결이 끊어진 상태입니다.',
            '브라우저 런타임 에러는 본 탭이 열려있는 동안만 수집됩니다. 장기 모니터링은 Sentry 등 외부 도구 권장.',
            '오류가 있는 항목은 Outbox에서도 동일하게 확인할 수 있습니다.',
          ]} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 26 }}>
            <Card label="백엔드 상태"
              value={health?.demo ? '데모(미연결)' : (health?.ok ? '정상' : '오류')}
              color={health?.demo ? '#6f6b68' : (health?.ok ? '#2e7d32' : '#c0392b')} />
            <Card label="24시간 실패 발송" value={String(failedCount24h)}
              color={failedCount24h > 0 ? '#c0392b' : '#2e7d32'} />
            <Card label="누적 발송 이력" value={String(outbox.length)} color="#6f6b68" />
            <Card label="런타임 에러(현 세션)" value={String(errors.length)}
              color={errors.length > 0 ? '#b87333' : '#6f6b68'} />
          </div>

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
