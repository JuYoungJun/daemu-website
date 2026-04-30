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

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';
import { downloadCSV } from '../lib/csv.js';
import { stockSummary, LOW_STOCK_THRESHOLD } from '../lib/inventory.js';
import { filterByDevIp } from '../lib/ipFilter.js';
import MonitoringGuide from './MonitoringGuide.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';

const KIND_LABEL = {
  outbox_failed: '발송 실패',
  outbox_error: 'API 호출 오류',
  runtime_error: '브라우저 런타임 에러',
  upload_error: '업로드 실패',
};

const SEVERITY = {
  critical: { label: 'CRITICAL', color: '#7a1a14', bg: '#fbe9e7', desc: '즉시 조치 필요 — 사용자 영향 큼' },
  high:     { label: 'HIGH',     color: '#c0392b', bg: '#fff0ec', desc: '24시간 내 조치 필요' },
  medium:   { label: 'MEDIUM',   color: '#b87333', bg: '#fff8ec', desc: '한 주 내 조치 권장' },
  low:      { label: 'LOW',      color: '#5a6b7a', bg: '#eef2f5', desc: '낮은 영향 — 경향만 모니터링' },
  info:     { label: 'INFO',     color: '#6f6b68', bg: '#f4f1ea', desc: '정보성' },
};
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

// 이슈 1건의 severity 추정.
function classify(entry, ctx) {
  const k = entry.kind;
  const status = entry.status;
  if (k === 'runtime_error') {
    const m = String(entry.message || '').toLowerCase();
    if (/cannot read|undefined|null is not|typeerror|chunk load failed/.test(m)) return 'high';
    if (/network|fetch|timeout/.test(m)) return 'medium';
    return 'low';
  }
  if (status === 'failed' || status === 'error') {
    if (entry.path && /\/(login|2fa|password|users|payments)/i.test(entry.path)) return 'critical';
    if ((ctx?.failedCount24h || 0) >= 5) return 'high';
    return 'medium';
  }
  return 'info';
}

function uniqueId(entry, kind) {
  return entry.id ? String(entry.id) : `${kind}-${entry.ts}-${entry.path || entry.source || ''}`;
}

// 보안 검수 권고(F1/F5/F6): CSV/모달 어디에도 비밀번호·OTP·토큰류가
// 평문으로 흘러가지 않게 한 번 더 redact. api.js에서도 적재 시점에 한 번
// redact하지만, 백엔드 recentFailures 같은 외부 입력은 그 단계를 거치지
// 않으므로 표시 직전에도 동일 정책을 적용한다.
const ISSUE_REDACT_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'old_password', 'new_password',
  'totp_code', 'totp', 'code', 'recovery_code', 'recoverycode',
  'token', 'access_token', 'refresh_token', 'authorization', 'auth',
  'otp', 'secret', 'api_key', 'apikey',
]);
function redactDeep(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value)) {
    if (ISSUE_REDACT_KEYS.has(String(k).toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactDeep(value[k], depth + 1);
    }
  }
  return out;
}

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

// 사이트 전체 핵심 GET 엔드포인트 — 1분 주기로 probe 해 가용성/지연을 본다.
// 모든 항목은 idempotent 한 read-only 라우트만. probe 자체로 데이터가 변하지
// 않도록 mutating 라우트(POST/DELETE/PATCH)는 절대 포함하지 않는다.
const API_PROBE_TARGETS = [
  { key: 'health',         path: '/api/health',                  label: '헬스 체크',       group: 'core',     publicProbe: true },
  { key: 'summary',        path: '/api/monitoring/summary',      label: '운영 요약',       group: 'core' },
  { key: 'inquiries',      path: '/api/inquiries?limit=1',       label: '문의',            group: 'business' },
  { key: 'users',          path: '/api/users?limit=1',           label: '사용자',          group: 'business' },
  { key: 'documents',      path: '/api/documents?page_size=1',   label: '계약/PO',         group: 'business' },
  { key: 'short-links',    path: '/api/short-links?limit=1',     label: '단축 링크',       group: 'business' },
  // partner-brands 는 현재 localStorage 전용 — backend 마이그레이션 후 재추가.
  { key: 'products',       path: '/api/products?page_size=1',    label: '상품',            group: 'content' },
  { key: 'works',          path: '/api/works?page_size=1',       label: '작업 사례',       group: 'content' },
  { key: 'popups',         path: '/api/popups?page_size=1',      label: '팝업',            group: 'content' },
  { key: 'newsletter',     path: '/api/newsletter?page_size=1',  label: '뉴스레터',         group: 'content' },
  { key: 'announcements',  path: '/api/announcements?page_size=1', label: '공지/프로모션',   group: 'content' },
  { key: 'inventory-alerts', path: '/api/inventory/alerts',      label: '재고 알림',       group: 'content' },
  { key: 'audit-logs',     path: '/api/audit-logs?limit=1',      label: '감사 로그',       group: 'security' },
  { key: 'resource',       path: '/api/health/resource',         label: '리소스 (메모리/DB)', group: 'security' },
];
const PROBE_GROUP_LABEL = {
  core:     '코어',
  business: '비즈니스',
  content:  '콘텐츠',
  security: '보안',
};
// 200 ms 미만 = 정상, 1 s 미만 = 느림, 그 이상 = 문제.
function probeColor(p) {
  if (!p) return '#8c867d';
  if (p.error || (p.status && p.status >= 500)) return '#c0392b';
  if (p.status === 401 || p.status === 403) return '#b87333';  // auth required — page-level concern
  if (p.status && p.status >= 400) return '#b87333';
  if (p.latency == null) return '#6f6b68';
  if (p.latency < 200) return '#2e7d32';
  if (p.latency < 1000) return '#b87333';
  return '#c0392b';
}
function probeLabel(p) {
  if (!p) return '—';
  if (p.error) return 'ERR';
  if (p.status === 401 || p.status === 403) return 'AUTH';
  if (p.status && p.status >= 400) return String(p.status);
  if (p.latency == null) return '—';
  return p.latency + ' ms';
}

export default function AdminMonitoring() {
  const [outbox, setOutbox] = useState(() => loadOutbox());
  const [errors, setErrors] = useState(() => loadRuntimeErrors());
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);
  const [probeResults, setProbeResults] = useState({});  // { key: { status, latency, error, ts } }
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeLastRun, setProbeLastRun] = useState(null);

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
    // 실시간급 — 15초 주기 (이전 60초). 사용자 요청.
    const id = setInterval(probe, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // 사이트 전체 API 가용성 probe — 15초 주기, mount 시 즉시 1회.
  // GET only · 동시성 제한 4 · 결과는 state 와 localStorage(history)에 저장.
  // 탭이 숨겨진 동안에는 probe 를 멈춰 Render 무료 tier 사용량을 절약한다.
  useEffect(() => {
    let alive = true;
    let timer = null;
    const runProbes = async () => {
      if (!api.isConfigured()) {
        if (alive) setProbeResults({});
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) return; // skip when tab hidden
      if (alive) setProbeRunning(true);
      const startedAll = Date.now();
      const results = {};
      const queue = [...API_PROBE_TARGETS];
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const tgt = queue.shift();
          if (!tgt) break;
          const t0 = performance.now();
          let entry = { ts: Date.now() };
          try {
            const r = await api.get(tgt.path, tgt.publicProbe ? { skipAuth: true } : {});
            entry.latency = Math.round(performance.now() - t0);
            entry.status = r.status || (r.ok ? 200 : 0);
            entry.ok = !!r.ok;
            if (!r.ok && r.error) entry.error = String(r.error).slice(0, 200);
          } catch (e) {
            entry.latency = Math.round(performance.now() - t0);
            entry.error = String(e?.message || e).slice(0, 200);
            entry.ok = false;
          }
          results[tgt.key] = entry;
        }
      });
      await Promise.all(workers);
      if (!alive) return;
      setProbeResults(results);
      setProbeLastRun(Date.now());
      setProbeRunning(false);
      // 작은 history (마지막 10회 평균 latency 추세용).
      try {
        const hist = JSON.parse(localStorage.getItem('daemu_api_probe_history') || '[]');
        hist.unshift({ ts: startedAll, results });
        localStorage.setItem('daemu_api_probe_history', JSON.stringify(hist.slice(0, 20)));
      } catch { /* ignore */ }
    };
    runProbes();
    // 실시간급 — 15초 주기 (이전 60초). 사용자 요청.
    timer = setInterval(runProbes, 15_000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  // probe history 에서 마지막 10회 평균 latency 추출.
  //
  // 보안: localStorage 에서 읽은 데이터의 key 를 그대로 객체 인덱싱에
  // 사용하지 않는다. API_PROBE_TARGETS allow-list 에 포함된 key 만 처리하고,
  // accumulator 도 prototype-less object 로 만들어 prototype pollution 차단.
  const probeHistory = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('daemu_api_probe_history') || '[]');
      const hist = Array.isArray(raw) ? raw.slice(0, 10) : [];
      const acc = Object.create(null);
      for (const tgt of API_PROBE_TARGETS) acc[tgt.key] = { sum: 0, n: 0, fail: 0 };
      for (const h of hist) {
        const results = h && typeof h === 'object' ? h.results : null;
        if (!results || typeof results !== 'object') continue;
        for (const tgt of API_PROBE_TARGETS) {
          const k = tgt.key;
          if (!Object.prototype.hasOwnProperty.call(results, k)) continue;
          const r = results[k];
          if (!r || typeof r !== 'object') continue;
          if (typeof r.latency === 'number') { acc[k].sum += r.latency; acc[k].n++; }
          if (r.ok === false) acc[k].fail++;
        }
      }
      const out = Object.create(null);
      for (const tgt of API_PROBE_TARGETS) {
        const a = acc[tgt.key];
        out[tgt.key] = {
          avgLatency: a.n > 0 ? Math.round(a.sum / a.n) : null,
          failRate: hist.length ? Math.round((a.fail / hist.length) * 100) : 0,
          samples: hist.length,
        };
      }
      return out;
    } catch { return Object.create(null); }
  }, [probeLastRun]);

  // outbox 기반 API 호출 통계 — 시간창별 total/failed/error.
  const apiStats = useMemo(() => {
    const now = Date.now();
    const windows = { '1h': 3600 * 1000, '24h': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000 };
    const out = {};
    for (const [label, ms] of Object.entries(windows)) {
      const arr = outbox.filter((e) => now - new Date(e.ts).getTime() < ms);
      const failed = arr.filter((e) => e.status === 'failed' || e.status === 'error').length;
      out[label] = {
        total: arr.length,
        failed,
        rate: arr.length ? Math.round((failed / arr.length) * 100) : 0,
      };
    }
    return out;
  }, [outbox]);

  // 가장 자주 실패한 endpoint top 5 (24h).
  const topFailingEndpoints = useMemo(() => {
    const now = Date.now();
    const counter = new Map();
    for (const e of outbox) {
      if (now - new Date(e.ts).getTime() > 24 * 3600 * 1000) continue;
      if (e.status !== 'failed' && e.status !== 'error') continue;
      const key = (e.path || '?') + ' ' + (e.method || '');
      counter.set(key, (counter.get(key) || 0) + 1);
    }
    return [...counter.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [outbox]);

  const [selectedIssue, setSelectedIssue] = useState(null);
  const [resolved, setResolved] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('daemu_monitoring_resolved') || '[]')); }
    catch { return new Set(); }
  });
  const [severityFilter, setSeverityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const persistResolved = (next) => {
    setResolved(next);
    try { localStorage.setItem('daemu_monitoring_resolved', JSON.stringify([...next])); } catch { /* ignore */ }
  };

  // ── 추가 모니터링 데이터 수집 ─────────────────────────────────────
  // localStorage 기반 자체 분석으로 운영자가 한 화면에서 볼 거리를 늘림.

  // 1) 스토리지 사용량 — 모든 daemu_* 키의 합산 byte.
  const storageStats = useMemo(() => {
    if (typeof localStorage === 'undefined') return null;
    let total = 0;
    let count = 0;
    const byKey = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('daemu_')) continue;
      const v = localStorage.getItem(k) || '';
      const bytes = (k.length + v.length) * 2; // UTF-16 추정
      total += bytes;
      count++;
      byKey.push({ key: k, bytes, len: v.length });
    }
    byKey.sort((a, b) => b.bytes - a.bytes);
    return { totalBytes: total, count, top: byKey.slice(0, 8) };
  }, []);

  // 2) 문의 응답 시간 KPI — 신규 → 답변완료 평균 일수 (last 30일).
  const inquiryKpi = useMemo(() => {
    try {
      const list = JSON.parse(localStorage.getItem('daemu_inquiries') || '[]');
      if (!Array.isArray(list) || !list.length) return null;
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 86400 * 1000;
      const recent = list.filter((d) => {
        const t = d.date ? new Date(d.date).getTime() : 0;
        return Number.isFinite(t) && t >= thirtyDaysAgo;
      });
      const replied = recent.filter((d) => d.status === '답변완료');
      const newCount = recent.filter((d) => d.status === '신규').length;
      const pendingCount = recent.filter((d) => d.status === '처리중').length;
      const replyRate = recent.length ? Math.round((replied.length / recent.length) * 100) : 0;
      return {
        total30d: recent.length,
        new: newCount,
        pending: pendingCount,
        replied: replied.length,
        replyRate,
      };
    } catch { return null; }
  }, []);

  // 3) 콘텐츠 건강도 — 빈 양식·미디어 누락 등.
  const contentHealth = useMemo(() => {
    const issues = [];
    try {
      const works = JSON.parse(localStorage.getItem('daemu_works') || '[]');
      const noHero = works.filter((w) => !w.hero && (!w.images || !w.images.length)).length;
      if (noHero) issues.push({ key: 'works.noHero', label: '히어로 이미지 없는 작업사례', count: noHero });
      const products = JSON.parse(localStorage.getItem('daemu_products') || '[]');
      const noImage = products.flatMap((c) => c.items || []).filter((p) => !p.image).length;
      if (noImage) issues.push({ key: 'products.noImage', label: '이미지 없는 상품', count: noImage });
      const partners = JSON.parse(localStorage.getItem('daemu_partner_brands') || '[]');
      const noLogo = partners.filter((b) => b.active && !b.logo).length;
      if (noLogo) issues.push({ key: 'brands.noLogo', label: '로고 없는 활성 파트너사', count: noLogo });
      const popups = JSON.parse(localStorage.getItem('daemu_popups') || '[]');
      const expiredActive = popups.filter((p) => {
        if (p.status !== 'active') return false;
        if (!p.to) return false;
        return new Date(p.to + 'T23:59:59').getTime() < Date.now();
      }).length;
      if (expiredActive) issues.push({ key: 'popups.expired', label: '만료됐지만 활성 상태인 팝업', count: expiredActive });
    } catch { /* ignore */ }
    return issues;
  }, []);

  // 4) 최근 활동 타임라인 — outbox + analytics 의 마지막 20건 통합.
  const activityTimeline = useMemo(() => {
    const events = [];
    try {
      const ob = JSON.parse(localStorage.getItem('daemu_outbox') || '[]');
      for (const e of ob.slice(0, 50)) {
        events.push({
          ts: new Date(e.ts).getTime(),
          type: e.status === 'failed' || e.status === 'error' ? 'error' : 'send',
          label: (e.status === 'failed' ? '발송 실패' : e.status === 'error' ? 'API 오류' : '발송') + ' · ' + (e.path || ''),
          detail: e.body?.subject || e.body?.to || e.error || '',
        });
      }
    } catch { /* ignore */ }
    try {
      const ev = JSON.parse(localStorage.getItem('daemu_analytics_events') || '[]');
      for (const e of ev.slice(-30)) {
        if (e.name === 'pageview') continue;
        events.push({
          ts: e.ts || 0,
          type: 'analytics',
          label: e.name,
          detail: e.path || '',
        });
      }
    } catch { /* ignore */ }
    return events.sort((a, b) => b.ts - a.ts).slice(0, 30);
  }, [outbox]);

  // 5) 백업 상태 — 마지막 CSV export 일시 (localStorage 마커).
  // 재고 요약 — 카탈로그 전체 합산.
  const stockStats = useMemo(() => stockSummary(), [outbox]);

  const backupStatus = useMemo(() => {
    try {
      const last = localStorage.getItem('daemu_last_csv_export');
      if (!last) return { status: 'never' };
      const ts = new Date(last).getTime();
      const days = Math.round((Date.now() - ts) / (86400 * 1000));
      return { status: days < 14 ? 'recent' : 'stale', daysAgo: days, ts };
    } catch { return { status: 'never' }; }
  }, []);

  const toggleResolved = (id) => {
    const next = new Set(resolved);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistResolved(next);
  };

  // Failed/error rows from outbox become "최근 운영 오류".
  const recentFailures = outbox.filter((e) => e.status === 'failed' || e.status === 'error').slice(0, 25);
  const failedCount24h = recentFailures.filter((e) => Date.now() - new Date(e.ts).getTime() < 24 * 3600 * 1000).length;

  // 통합 이슈 리스트 — outbox 실패 + runtime errors + summary recentFailures
  const issues = useMemo(() => {
    const all = [];
    for (const e of recentFailures) {
      const id = uniqueId(e, 'outbox');
      const severity = classify(e, { failedCount24h });
      all.push({
        id,
        ts: new Date(e.ts).getTime(),
        severity,
        source: 'outbox',
        title: (e.status === 'failed' ? '발송 실패' : 'API 오류') + ' · ' + (e.path || ''),
        summary: e.error || e.body?.subject || '',
        raw: e,
      });
    }
    for (const e of errors) {
      const id = uniqueId(e, 'runtime');
      const severity = classify(e, {});
      all.push({
        id,
        ts: new Date(e.ts).getTime(),
        severity,
        source: 'runtime',
        title: KIND_LABEL[e.kind] || e.kind || '런타임 에러',
        summary: e.message || '',
        raw: e,
      });
    }
    for (const e of (summary?.recentFailures || [])) {
      const id = 'be-' + (e.id || e.ts);
      all.push({
        id,
        ts: new Date(e.ts).getTime(),
        severity: 'high',
        source: 'backend',
        title: '백엔드 발송 실패 · ' + (e.type || ''),
        summary: e.error || (e.to + ' / ' + (e.subject || '')),
        raw: e,
      });
    }
    return all.sort((a, b) => b.ts - a.ts);
  }, [recentFailures, errors, summary, failedCount24h]);

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((i) => {
      if (!showResolved && resolved.has(i.id)) return false;
      if (severityFilter && i.severity !== severityFilter) return false;
      if (q && !((i.title + ' ' + i.summary).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [issues, severityFilter, search, resolved, showResolved]);

  const counts = useMemo(() => {
    const c = { total: issues.length, open: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, resolved: 0 };
    for (const i of issues) {
      if (resolved.has(i.id)) { c.resolved++; continue; }
      c.open++;
      c[i.severity] = (c[i.severity] || 0) + 1;
    }
    return c;
  }, [issues, resolved]);

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">유지보수 모니터링</h1>

          <PageActions>

            <GuideButton GuideComponent={MonitoringGuide} />

          </PageActions>

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
                  최근 1시간 의심 IP <strong>{filterByDevIp(summary.suspiciousIps1h || []).length}</strong>개 ·
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
              {filterByDevIp(summary.suspiciousIps1h || []).length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #d7d4cf' }}>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>의심 IP (최근 1시간 인증 실패 3건+)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {filterByDevIp(summary.suspiciousIps1h || []).slice(0, 8).map((s) => (
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

          {/* API 엔드포인트 가용성 probe — 사이트 전체 GET 라우트 */}
          <h3 className="admin-section-title" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>API 엔드포인트 상태</span>
            <span style={{ fontSize: 11, color: '#8c867d', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
              {probeRunning ? '확인 중…' : probeLastRun
                ? '마지막 확인 ' + new Date(probeLastRun).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })
                : '대기 중'}
              {' · 60초 주기'}
            </span>
          </h3>
          {!api.isConfigured() ? (
            <div style={{ background: '#f4f1ea', border: '1px solid #d7d4cf', padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#5a534b' }}>
              백엔드 미연결 (데모 모드) — VITE_API_BASE 환경변수가 설정되지 않아 probe 를 건너뜁니다.
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              {Object.keys(PROBE_GROUP_LABEL).map((group) => {
                const targets = API_PROBE_TARGETS.filter((t) => t.group === group);
                if (!targets.length) return null;
                return (
                  <div key={group} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>
                      {PROBE_GROUP_LABEL[group]}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                      {targets.map((tgt) => {
                        const p = probeResults[tgt.key];
                        const hist = probeHistory[tgt.key];
                        const color = probeColor(p);
                        return (
                          <div key={tgt.key} style={{
                            background: '#fff',
                            border: '1px solid #e6e3dd',
                            borderLeft: '3px solid ' + color,
                            padding: '8px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            fontSize: 12,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                              <span style={{ fontWeight: 600, color: '#231815' }}>{tgt.label}</span>
                              <span style={{ color, fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11, fontWeight: 600 }}>
                                {probeLabel(p)}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8c867d' }}>
                              <code style={{ fontFamily: 'SF Mono, Menlo, monospace' }}>{tgt.path}</code>
                              {hist && hist.samples > 0 && (
                                <span title={`최근 ${hist.samples}회 평균`}>
                                  ~{hist.avgLatency ?? '—'}{hist.avgLatency != null ? 'ms' : ''}
                                  {hist.failRate > 0 ? ` · 실패 ${hist.failRate}%` : ''}
                                </span>
                              )}
                            </div>
                            {p?.error && (
                              <div style={{ fontSize: 10.5, color: '#c0392b', marginTop: 2, wordBreak: 'break-all' }}>
                                {p.error}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>
                AUTH 표시는 인증 토큰이 필요한 GET 라우트인데 권한이 부족하다는 뜻입니다(슈퍼 관리자가 아닐 때 정상). ERR/5xx는 실제 장애 신호로 간주.
              </div>
            </div>
          )}

          {/* API 호출 에러율 — outbox 집계 */}
          <h3 className="admin-section-title">API 호출 에러율 (Outbox 기반)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {['1h', '24h', '7d'].map((w) => {
              const s = apiStats[w];
              const color = s.rate >= 10 ? '#c0392b' : s.rate >= 3 ? '#b87333' : s.total === 0 ? '#8c867d' : '#2e7d32';
              return (
                <Card key={w}
                  label={`최근 ${w} (${s.total}건)`}
                  value={s.total === 0 ? '—' : `${s.failed} 실패 / ${s.rate}%`}
                  color={color} />
              );
            })}
          </div>
          {topFailingEndpoints.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #f0d6d2', padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0392b', marginBottom: 6 }}>
                실패 빈도 상위 (24h)
              </div>
              {topFailingEndpoints.map((e) => (
                <div key={e.path} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed #f4ebe9' }}>
                  <code style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11.5, color: '#7a1a14' }}>{e.path}</code>
                  <strong style={{ color: '#c0392b' }}>×{e.count}</strong>
                </div>
              ))}
            </div>
          )}

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
                    <span style={{ color: '#8c867d', fontSize: 11 }}>{new Date(f.ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {f.error}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 문의 KPI — 응답 시간/응답률 */}
          {inquiryKpi && (
            <>
              <h3 className="admin-section-title">문의 응답 KPI (최근 30일)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
                <Card label="접수 30d" value={String(inquiryKpi.total30d)} color="#1f5e7c" />
                <Card label="신규" value={String(inquiryKpi.new)}
                  color={inquiryKpi.new > 5 ? '#c0392b' : '#6f6b68'} />
                <Card label="처리중" value={String(inquiryKpi.pending)} color="#b87333" />
                <Card label="답변완료" value={String(inquiryKpi.replied)} color="#2e7d32" />
                <Card label="응답률" value={inquiryKpi.replyRate + '%'}
                  color={inquiryKpi.replyRate >= 80 ? '#2e7d32' : inquiryKpi.replyRate >= 50 ? '#b87333' : '#c0392b'} />
              </div>
            </>
          )}

          {/* 재고 현황 */}
          <h3 className="admin-section-title">재고 현황</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Card label="총 재고 수량" value={stockStats.totalUnits.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} color="#5a534b" />
            <Card label={`재고 부족 (< ${LOW_STOCK_THRESHOLD})`}
              value={String(stockStats.lowStock.length)}
              color={stockStats.lowStock.length > 0 ? '#b87333' : '#2e7d32'} />
            <Card label="품절 SKU"
              value={String(stockStats.outOfStock.length)}
              color={stockStats.outOfStock.length > 0 ? '#c0392b' : '#2e7d32'} />
          </div>
          {(stockStats.outOfStock.length > 0 || stockStats.lowStock.length > 0) && (
            <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
              {stockStats.outOfStock.length > 0 && (
                <>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0392b', marginBottom: 4 }}>품절 (즉시 보충 필요)</div>
                  {stockStats.outOfStock.slice(0, 6).map((s) => (
                    <div key={s.sku} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span><code style={{ color: '#7a1a14' }}>{s.sku}</code> · {s.name}</span>
                      <span style={{ color: '#8c867d', fontSize: 11 }}>{s.category}</span>
                    </div>
                  ))}
                </>
              )}
              {stockStats.lowStock.length > 0 && (
                <>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#b87333', margin: '8px 0 4px' }}>재고 부족</div>
                  {stockStats.lowStock.slice(0, 6).map((s) => (
                    <div key={s.sku} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span><code style={{ color: '#5a4a2a' }}>{s.sku}</code> · {s.name}</span>
                      <span style={{ color: '#b87333', fontSize: 11 }}>잔여 {s.stock}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* 콘텐츠 건강도 */}
          {contentHealth.length > 0 && (
            <>
              <h3 className="admin-section-title">콘텐츠 건강도</h3>
              <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', padding: '12px 16px', marginBottom: 14, fontSize: 13 }}>
                {contentHealth.map((c) => (
                  <div key={c.key} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#5a4a2a' }}>{c.label}</span>
                    <strong style={{ color: '#b87333' }}>{c.count}건</strong>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: '#8c867d', marginTop: 6 }}>각 항목 어드민 페이지에서 보강하면 사이트 완성도가 올라갑니다.</div>
              </div>
            </>
          )}

          {/* 스토리지 사용량 */}
          {storageStats && (
            <>
              <h3 className="admin-section-title">스토리지 사용량 (브라우저 localStorage)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 8 }}>
                <Card label="저장 키 수" value={String(storageStats.count)} color="#5a534b" />
                <Card label="총 크기"
                  value={(storageStats.totalBytes / 1024).toFixed(1) + ' KB'}
                  color={storageStats.totalBytes > 4 * 1024 * 1024 ? '#c0392b' : storageStats.totalBytes > 2 * 1024 * 1024 ? '#b87333' : '#2e7d32'} />
                <Card label="브라우저 한도" value="~5 MB" color="#8c867d" />
              </div>
              <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
                <strong style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8c867d', display: 'block', marginBottom: 6 }}>상위 키 8개</strong>
                {storageStats.top.map((k) => (
                  <div key={k.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11.5 }}>
                    <code style={{ color: '#1f5e7c' }}>{k.key}</code>
                    <span style={{ color: '#5a534b' }}>{(k.bytes / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 백업 상태 */}
          <h3 className="admin-section-title">데이터 백업 상태</h3>
          <div style={{
            background: backupStatus.status === 'never' ? '#fff0ec' : backupStatus.status === 'stale' ? '#fff8ec' : '#eef6ee',
            border: '1px solid ' + (backupStatus.status === 'never' ? '#f0c4c0' : backupStatus.status === 'stale' ? '#f0e3c4' : '#cfe5cf'),
            padding: '12px 16px', marginBottom: 14, fontSize: 13,
          }}>
            {backupStatus.status === 'never' && (
              <>
                <strong style={{ color: '#c0392b' }}>백업 이력 없음</strong> — 어드민 페이지 각 목록에서 <em>CSV 내보내기</em> 로 정기 백업 권장.
              </>
            )}
            {backupStatus.status === 'recent' && (
              <>
                <strong style={{ color: '#2e7d32' }}>최근 백업: {backupStatus.daysAgo}일 전</strong> ({new Date(backupStatus.ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})
              </>
            )}
            {backupStatus.status === 'stale' && (
              <>
                <strong style={{ color: '#b87333' }}>오래된 백업: {backupStatus.daysAgo}일 전</strong> — 2주 이상 지났습니다. CSV 내보내기로 갱신을 권장합니다.
              </>
            )}
          </div>

          {/* 활동 타임라인 */}
          {activityTimeline.length > 0 && (
            <>
              <h3 className="admin-section-title">최근 활동 타임라인 (최신 30건)</h3>
              <div style={{ background: '#fff', border: '1px solid #d7d4cf', maxHeight: 320, overflowY: 'auto', marginBottom: 14 }}>
                {activityTimeline.map((e, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, padding: '8px 14px',
                    borderBottom: i < activityTimeline.length - 1 ? '1px solid #f0ede7' : 'none',
                    fontSize: 12,
                  }}>
                    <span style={{ minWidth: 130, color: '#8c867d', fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11 }}>
                      {e.ts ? new Date(e.ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''}
                    </span>
                    <span style={{
                      minWidth: 56, fontSize: 10, padding: '2px 6px', height: 20,
                      background: e.type === 'error' ? '#fff0ec' : e.type === 'send' ? '#eef6ee' : '#f4f1ea',
                      color: e.type === 'error' ? '#c0392b' : e.type === 'send' ? '#2e7d32' : '#5a534b',
                      letterSpacing: '.08em', textTransform: 'uppercase', borderRadius: 2,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{e.type}</span>
                    <span style={{ flex: 1, color: '#231815', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.label}{e.detail ? ' · ' + e.detail : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h3 className="admin-section-title" style={{ marginTop: 36 }}>이슈 (Issue Feed)</h3>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="adm-doc-pill" style={{ borderColor: '#6f6b68', color: '#6f6b68' }}>전체 {counts.total}</span>
            <span className="adm-doc-pill" style={{ borderColor: '#5f5b57', color: '#5f5b57' }}>열린 {counts.open}</span>
            {SEVERITY_ORDER.map((s) => (
              counts[s] > 0 && (
                <button key={s} type="button"
                  onClick={() => setSeverityFilter(severityFilter === s ? '' : s)}
                  style={{
                    background: severityFilter === s ? SEVERITY[s].color : SEVERITY[s].bg,
                    color: severityFilter === s ? '#fff' : SEVERITY[s].color,
                    border: '1px solid ' + SEVERITY[s].color,
                    padding: '3px 10px', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
                    fontWeight: 600, cursor: 'pointer', borderRadius: 3,
                  }}>
                  {SEVERITY[s].label} {counts[s]}
                </button>
              )
            ))}
            <span style={{ flex: 1 }} />
            <input type="search" placeholder="이슈 검색" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12, minWidth: 160 }} />
            <label style={{ fontSize: 12, color: '#5a534b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              해결 표시한 항목 포함 ({counts.resolved})
            </label>
            <button type="button" className="adm-btn-sm"
              onClick={() => downloadCSV(
                'daemu-issues-' + new Date().toISOString().slice(0, 10) + '.csv',
                filteredIssues,
                [
                  { key: (i) => new Date(i.ts).toISOString(), label: '시각' },
                  { key: (i) => SEVERITY[i.severity]?.label || i.severity, label: '등급' },
                  { key: 'source', label: '출처' },
                  { key: 'title', label: '제목' },
                  { key: 'summary', label: '요약' },
                  { key: (i) => resolved.has(i.id) ? '해결' : '열림', label: '상태' },
                  { key: (i) => JSON.stringify(redactDeep(i.raw)), label: '원본(민감정보 마스킹)' },
                ],
              )}>이슈 CSV</button>
          </div>

          {!filteredIssues.length ? (
            <EmptyState text={severityFilter || search ? '필터 조건에 맞는 이슈가 없습니다.' : '기록된 이슈가 없습니다. 시스템이 정상 동작 중입니다.'} />
          ) : (
            <div>
              {filteredIssues.map((i) => (
                <IssueRow key={i.id} issue={i} resolved={resolved.has(i.id)}
                  onOpen={() => setSelectedIssue(i)} onToggleResolve={() => toggleResolved(i.id)} />
              ))}
            </div>
          )}

          {selectedIssue && (
            <IssueDetailModal issue={selectedIssue}
              onClose={() => setSelectedIssue(null)}
              resolved={resolved.has(selectedIssue.id)}
              onToggleResolve={() => toggleResolved(selectedIssue.id)} />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function IssueRow({ issue, resolved, onOpen, onToggleResolve }) {
  const sev = SEVERITY[issue.severity] || SEVERITY.info;
  return (
    <div style={{
      border: '1px solid ' + (resolved ? '#d7d4cf' : '#e6e3dd'),
      borderLeft: '3px solid ' + sev.color,
      padding: '12px 16px', marginBottom: 8, background: resolved ? '#faf8f5' : '#fff',
      opacity: resolved ? 0.62 : 1,
      cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
    }} onClick={onOpen}>
      <span style={{
        background: sev.color, color: '#fff', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
        padding: '3px 8px', borderRadius: 2, fontWeight: 700, marginTop: 2, minWidth: 64, textAlign: 'center', flexShrink: 0,
      }}>{sev.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#231815', marginBottom: 3, wordBreak: 'break-word' }}>{issue.title}</div>
        {issue.summary && <div style={{ fontSize: 12, color: '#5a534b', wordBreak: 'break-word', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{issue.summary}</div>}
        <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>
          {new Date(issue.ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 출처 {issue.source}
        </div>
      </div>
      <button type="button" className="adm-btn-sm" onClick={(e) => { e.stopPropagation(); onToggleResolve(); }}>
        {resolved ? '재오픈' : '해결 표시'}
      </button>
    </div>
  );
}

function IssueDetailModal({ issue, onClose, resolved, onToggleResolve }) {
  const sev = SEVERITY[issue.severity] || SEVERITY.info;
  // raw는 표시·복사 가능하므로 비밀번호·OTP 등은 [REDACTED]로 치환된 사본만
  // 사용한다. dt/dd 영역에서 잘 알려진 필드(path/status/message …)는 별도
  // 라인으로 표시되며, 여기에는 민감 키가 들어오지 않는다.
  const raw = redactDeep(issue.raw || {});
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="issue-modal-title">
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2 id="issue-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{
              background: sev.color, color: '#fff', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '4px 10px', borderRadius: 3, fontWeight: 700,
            }}>{sev.label}</span>
            <span>{issue.title}</span>
          </h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div style={{ background: sev.bg, border: '1px solid ' + sev.color + '33', padding: '10px 14px', marginBottom: 14, fontSize: 12, color: sev.color, borderRadius: 3 }}>
          <strong>{sev.label}</strong> — {sev.desc}
        </div>

        <dl className="adm-issue-dl">
          <dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>시각</dt>
          <dd style={{ margin: 0 }}>{new Date(issue.ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</dd>
          <dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>출처</dt>
          <dd style={{ margin: 0 }}>{issue.source}</dd>
          {raw.path && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>경로</dt><dd style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{raw.path}</dd></>}
          {raw.status && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>상태</dt><dd style={{ margin: 0 }}>{raw.status}</dd></>}
          {raw.message && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>메시지</dt><dd style={{ margin: 0, color: '#c0392b' }}>{raw.message}</dd></>}
          {raw.error && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>에러</dt><dd style={{ margin: 0, color: '#c0392b' }}>{raw.error}</dd></>}
          {raw.source && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>소스</dt><dd style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{raw.source}{raw.lineno ? ':' + raw.lineno : ''}</dd></>}
          {raw.body?.to && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>수신자</dt><dd style={{ margin: 0 }}>{raw.body.to}</dd></>}
          {raw.body?.subject && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>제목</dt><dd style={{ margin: 0 }}>{raw.body.subject}</dd></>}
          {raw.type && <><dt style={{ color: '#8c867d', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>유형</dt><dd style={{ margin: 0 }}>{raw.type}</dd></>}
        </dl>

        <details style={{ background: '#f6f4f0', padding: '10px 14px', border: '1px solid #e6e3dd', marginBottom: 14 }} open>
          <summary style={{ fontSize: 11, color: '#6f6b68', cursor: 'pointer', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>원본 페이로드 (JSON)</summary>
          <pre style={{ margin: '10px 0 0', fontSize: 11.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#2a2724' }}>
{JSON.stringify(raw, null, 2)}
          </pre>
        </details>

        <div style={{ background: '#fff8ec', borderLeft: '3px solid #c9a25a', padding: '10px 14px', fontSize: 12, color: '#5a4a2a', marginBottom: 14 }}>
          <strong style={{ marginRight: 6 }}>권장 조치:</strong>
          {issue.severity === 'critical' && '즉시 책임자 알림 + 인증/결제 경로 점검. 수치 급증 시 service downtime 가능성.'}
          {issue.severity === 'high' && '24시간 내 root cause 식별 + hotfix 배포. 동일 패턴 재발 시 등급 상향.'}
          {issue.severity === 'medium' && '한 주 내 코드 리뷰 + 개선. 빈도 추이 관찰.'}
          {issue.severity === 'low' && '낮은 우선순위. 분기별 정리에서 일괄 처리.'}
          {issue.severity === 'info' && '정보성. 별도 조치 불필요.'}
        </div>

        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn" onClick={onToggleResolve}>
            {resolved ? '재오픈 (다시 열기)' : '해결 표시'}
          </button>
        </div>
      </div>
    </div>
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

