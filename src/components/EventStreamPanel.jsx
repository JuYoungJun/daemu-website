import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// 터미널 형태 실시간 이벤트 로그 — audit_logs + suspicious_events 합쳐서
// 5초 polling, 시간 역순. monospace + 색상 코딩 (severity / kind 별).
// /admin/monitoring + /admin/security 양쪽에서 재사용.
//
// props:
//   · title — 패널 제목 (기본: "실시간 이벤트 로그 (터미널)")
//   · description — 1~2줄 설명 (기본: 일반 안내)
//   · defaultKindFilter — 'all' | 'audit' | 'suspicious' (기본: 'all')
//   · height — terminal 영역 픽셀 높이 (기본: 360)
export default function EventStreamPanel({
  title = '실시간 이벤트 로그 (터미널)',
  description,
  defaultKindFilter = 'all',
  height = 360,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState(defaultKindFilter);
  const [autoScroll, setAutoScroll] = useState(true);
  const aliveRef = useRef(true);
  const scrollRef = useRef(null);

  const fetchOnce = async () => {
    if (paused) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!api.isConfigured()) {
      if (aliveRef.current) { setLoading(false); setError('백엔드 미연결'); }
      return;
    }
    try {
      // kindFilter 가 'audit' 또는 'suspicious' 면 해당 endpoint 만 호출 (대역폭 절약).
      const wantAudit = kindFilter === 'all' || kindFilter === 'audit';
      const wantSusp = kindFilter === 'all' || kindFilter === 'suspicious';
      const [a, s] = await Promise.all([
        wantAudit ? api.get('/api/audit-logs?limit=100') : Promise.resolve(null),
        wantSusp ? api.get('/api/suspicious-events?limit=100') : Promise.resolve(null),
      ]);
      if (!aliveRef.current) return;
      setLoading(false);
      const auditItems = (a?.ok && Array.isArray(a.items)) ? a.items.map((it) => ({
        kind: 'audit', id: 'a-' + it.id, ts: it.ts, severity: _auditSeverity(it.action),
        title: it.action,
        body: [it.actor_email, it.ip, it.target_type && (it.target_type + ':' + (it.target_id || '?'))].filter(Boolean).join(' · '),
        detail: it.detail,
      })) : [];
      const suspiciousItems = (s?.ok && Array.isArray(s.items)) ? s.items.map((it) => ({
        kind: 'suspicious', id: 's-' + it.id, ts: it.ts, severity: it.severity || 'medium',
        title: it.reason,
        body: [it.ip, it.method + ' ' + it.path, 'HTTP ' + it.status_code].filter(Boolean).join(' · '),
        detail: it.detail,
        evidence: it.evidence,
      })) : [];
      const merged = [...auditItems, ...suspiciousItems]
        .filter((e) => e.ts)
        .sort((x, y) => (x.ts < y.ts ? -1 : 1));  // 오래된 순 → 터미널처럼 아래로 흐름
      setEvents(merged);
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(String(e?.message || e));
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    fetchOnce();
    const id = setInterval(fetchOnce, 5_000);
    const onVisible = () => { if (!document.hidden) fetchOnce(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, kindFilter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const filtered = events.filter((e) => {
    if (!filter.trim()) return true;
    const hay = [e.title, e.body, JSON.stringify(e.detail || {})].join(' ').toLowerCase();
    return hay.includes(filter.toLowerCase().trim());
  });

  return (
    <div style={{ marginTop: 28 }}>
      <h3 className="admin-section-title">{title}</h3>
      {description && (
        <p style={{ fontSize: 12, color: '#8c867d', marginTop: 4 }}>{description}</p>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
        <input type="search" placeholder="검색 (action / ip / email)" value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d7d4cf', fontSize: 12, minWidth: 220 }} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}
          style={{ padding: '6px 8px', border: '1px solid #d7d4cf', fontSize: 12 }}>
          <option value="all">전체</option>
          <option value="audit">audit (인증/관리)</option>
          <option value="suspicious">suspicious (자동 탐지)</option>
        </select>
        <label style={{ fontSize: 12, color: '#5a544c', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> auto-scroll
        </label>
        <button type="button" className="adm-btn-sm" onClick={() => setPaused((p) => !p)}>
          {paused ? '▶ 재개' : '⏸ 일시정지'}
        </button>
        <button type="button" className="adm-btn-sm" onClick={fetchOnce}>새로고침</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#8c867d' }}>
          {loading ? '로딩…' : `총 ${events.length}건 · 표시 ${filtered.length}건`}
        </span>
      </div>
      {error && (
        <div style={{ padding: 10, marginBottom: 8, background: '#fdf2f0', color: '#c0392b',
          border: '1px solid #f0c5c0', fontSize: 12 }}>오류: {error}</div>
      )}
      <div ref={scrollRef} style={{
        background: '#0e1116', color: '#cdd6dc', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12, lineHeight: 1.55, padding: 14, height, overflow: 'auto',
        border: '1px solid #2a2f37', borderRadius: 2,
      }}>
        {filtered.length === 0 ? (
          <div style={{ color: '#5a6470', textAlign: 'center', padding: '40px 0' }}>
            {loading ? '로그를 불러오는 중…' : '표시할 이벤트가 없습니다 (필터 조건 또는 backend 미연결).'}
          </div>
        ) : filtered.map((e) => (
          <div key={e.id} style={{ marginBottom: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            <span style={{ color: '#6f7780' }}>[{_fmtTs(e.ts)}]</span>{' '}
            <span style={{ color: _kindColor(e.kind), fontWeight: 600 }}>
              {e.kind === 'suspicious' ? '⚠ SUSPICIOUS' : '· AUDIT     '}
            </span>{' '}
            <span style={{ color: _severityColor(e.severity) }}>{(e.severity || 'info').padEnd(8)}</span>{' '}
            <span style={{ color: '#e6edf3' }}>{e.title}</span>
            {e.body && <span style={{ color: '#8b96a0' }}> — {e.body}</span>}
            {e.kind === 'suspicious' && e.evidence && (
              <span style={{ marginLeft: 8, color: '#f0883e', fontWeight: 600 }}>[evidence]</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function _auditSeverity(action) {
  if (!action) return 'info';
  if (action.includes('failure') || action.includes('throttled')) return 'warning';
  if (action.includes('delete') || action.includes('disabled')) return 'warning';
  return 'info';
}

function _kindColor(kind) {
  return kind === 'suspicious' ? '#ff6b6b' : '#7ab8ff';
}

function _severityColor(sev) {
  if (sev === 'critical' || sev === 'high') return '#ff6b6b';
  if (sev === 'medium' || sev === 'warning') return '#f0883e';
  if (sev === 'low' || sev === 'info') return '#7ab8ff';
  return '#cdd6dc';
}

function _fmtTs(ts) {
  if (!ts) return '???';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('ko-KR', { hour12: false }) + '.' +
      String(d.getMilliseconds()).padStart(3, '0').slice(0, 3);
  } catch { return String(ts).slice(11, 23); }
}
