// API 문서 — FastAPI 자동 생성 /docs#/ Swagger UI 의 사이트 디자인 대체.
//
// /openapi.json 을 fetch 해 사이트 톤(어드민 셸과 동일)으로 렌더한다.
//   · KPI: 총 endpoint 수 · tag 분포 · 인증 필요 비율
//   · 검색 + tag 필터 + method 필터
//   · endpoint expand: parameters / requestBody schema / responses
//   · GET 한정 "Try it" — 토큰 자동 추가, 응답 JSON 표시
//
// POST/PATCH/DELETE 의 try-it 은 의도적으로 제공하지 않는다 (운영 부작용 위험).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';

const METHOD_COLOR = {
  GET:    { bg: '#eef6ee', fg: '#2e7d32', border: '#cfe5cf' },
  POST:   { bg: '#eef2fb', fg: '#1f5e7c', border: '#cfd9ed' },
  PUT:    { bg: '#fff8ec', fg: '#b87333', border: '#f0e3c4' },
  PATCH:  { bg: '#fff8ec', fg: '#b87333', border: '#f0e3c4' },
  DELETE: { bg: '#fff0ec', fg: '#c0392b', border: '#f0c4c0' },
};
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function AdminApiDocs() {
  const [spec, setSpec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!api.isConfigured()) {
        if (alive) { setLoading(false); setError('백엔드가 연결되어 있지 않습니다 (VITE_API_BASE 미설정).'); }
        return;
      }
      try {
        const res = await fetch(api.baseUrl() + '/openapi.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (alive) { setSpec(json); setLoading(false); }
      } catch (e) {
        if (alive) { setError(String(e?.message || e)); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, []);

  // path × method 단위로 평탄화.
  const endpoints = useMemo(() => {
    if (!spec) return [];
    const out = [];
    const paths = spec.paths || {};
    for (const path of Object.keys(paths)) {
      const methods = paths[path] || {};
      for (const method of Object.keys(methods)) {
        if (!METHODS.includes(method.toUpperCase())) continue;
        const op = methods[method];
        const tags = op.tags && op.tags.length ? op.tags : ['untagged'];
        out.push({
          id: method.toUpperCase() + ' ' + path,
          method: method.toUpperCase(),
          path,
          summary: op.summary || '',
          description: op.description || '',
          tags,
          parameters: op.parameters || [],
          requestBody: op.requestBody || null,
          responses: op.responses || {},
          security: op.security || spec.security || [],
        });
      }
    }
    return out;
  }, [spec]);

  // tag → endpoint 수.
  const tagCounts = useMemo(() => {
    const counts = {};
    for (const ep of endpoints) {
      for (const t of ep.tags) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [endpoints]);

  const stats = useMemo(() => {
    const total = endpoints.length;
    const byMethod = METHODS.reduce((acc, m) => ({ ...acc, [m]: endpoints.filter((e) => e.method === m).length }), {});
    const authed = endpoints.filter((e) => (e.security || []).length > 0).length;
    return { total, byMethod, authed };
  }, [endpoints]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return endpoints.filter((ep) => {
      if (tagFilter && !ep.tags.includes(tagFilter)) return false;
      if (methodFilter && ep.method !== methodFilter) return false;
      if (q) {
        const hay = (ep.id + ' ' + ep.summary + ' ' + ep.description).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [endpoints, search, tagFilter, methodFilter]);

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">API 문서</h1>

          <AdminHelp title="사용 안내" items={[
            'FastAPI /docs#/ 자동 Swagger UI 의 사이트 디자인 대체 페이지입니다. 동일한 /openapi.json 을 사용해 항상 백엔드와 동기화됩니다.',
            '검색 / Tag / Method 필터를 조합해 endpoint 를 빠르게 찾을 수 있습니다.',
            'GET endpoint 는 "Try it" 버튼으로 즉시 호출해 응답을 확인할 수 있습니다 (토큰 자동 첨부).',
            'POST/PATCH/DELETE 는 운영 부작용 위험 때문에 본 페이지에서 try-it 을 제공하지 않습니다 — Postman / curl 로 호출하세요.',
            '백엔드 url: ' + (api.baseUrl() || '(미설정)'),
          ]} />

          {loading && <div style={{ padding: '40px 0', color: '#8c867d' }}>API 문서 로드 중…</div>}
          {error && (
            <div style={{ background: '#fff0ec', border: '1px solid #f0c4c0', padding: '12px 16px', color: '#7a1a14', fontSize: 12.5 }}>
              로드 실패: {error}
            </div>
          )}

          {spec && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 14, marginBottom: 14 }}>
                <Stat label="API 버전" value={spec.info?.version || '—'} color="#5a534b" />
                <Stat label="총 endpoint" value={String(stats.total)} color="#1f5e7c" />
                <Stat label="GET" value={String(stats.byMethod.GET || 0)} color="#2e7d32" />
                <Stat label="POST" value={String(stats.byMethod.POST || 0)} color="#1f5e7c" />
                <Stat label="PATCH/PUT" value={String((stats.byMethod.PATCH || 0) + (stats.byMethod.PUT || 0))} color="#b87333" />
                <Stat label="DELETE" value={String(stats.byMethod.DELETE || 0)} color="#c0392b" />
                <Stat label="인증 필요" value={String(stats.authed)} color="#5a534b" />
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <input type="search" placeholder="endpoint 검색 (path / summary)"
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  style={{ flex: '1 1 220px', padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }} />
                <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12 }}>
                  <option value="">전체 method</option>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 12 }}>
                  <option value="">전체 tag ({Object.keys(tagCounts).length})</option>
                  {Object.entries(tagCounts).sort().map(([t, n]) => (
                    <option key={t} value={t}>{t} ({n})</option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: '#8c867d' }}>{filtered.length}건 표시</span>
              </div>

              {!filtered.length ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#8c867d', fontSize: 13, border: '1px solid #d7d4cf', background: '#fafaf6' }}>
                  필터 조건에 맞는 endpoint 가 없습니다.
                </div>
              ) : (
                <div>
                  {filtered.map((ep) => (
                    <EndpointRow key={ep.id} ep={ep} open={!!expanded[ep.id]} onToggle={() => toggle(ep.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dd', padding: '10px 14px' }}>
      <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>{label}</div>
      <div style={{ fontSize: 18, color, marginTop: 4, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function EndpointRow({ ep, open, onToggle }) {
  const c = METHOD_COLOR[ep.method] || METHOD_COLOR.GET;
  return (
    <div style={{ border: '1px solid #e6e3dd', borderLeft: '3px solid ' + c.fg, background: '#fff', marginBottom: 6 }}>
      <button type="button" onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}>
        <span style={{
          background: c.bg, color: c.fg, border: '1px solid ' + c.border,
          padding: '2px 8px', fontSize: 10.5, letterSpacing: '.06em', fontWeight: 700,
          minWidth: 56, textAlign: 'center',
        }}>{ep.method}</span>
        <code style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12.5, color: '#231815', flex: '0 0 auto' }}>{ep.path}</code>
        <span style={{ flex: 1, fontSize: 12, color: '#5a534b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ep.summary || ep.description.slice(0, 80)}
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          {ep.tags.map((t) => (
            <span key={t} style={{ fontSize: 10, padding: '2px 6px', background: '#f4f1ea', color: '#5a534b', border: '1px solid #d7d4cf' }}>{t}</span>
          ))}
        </span>
        <span style={{ fontSize: 11, color: '#8c867d' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <EndpointDetail ep={ep} />}
    </div>
  );
}

function EndpointDetail({ ep }) {
  return (
    <div style={{ borderTop: '1px solid #f0ede7', padding: '12px 16px', background: '#fafaf6' }}>
      {ep.description && (
        <p style={{ fontSize: 12.5, color: '#231815', margin: '0 0 12px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {ep.description}
        </p>
      )}

      {ep.parameters?.length > 0 && (
        <Section title="Parameters">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f4f1ea', textAlign: 'left' }}>
                <Th>이름</Th><Th>위치</Th><Th>타입</Th><Th>필수</Th><Th>설명</Th>
              </tr>
            </thead>
            <tbody>
              {ep.parameters.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0ede7' }}>
                  <Td><code>{p.name}</code></Td>
                  <Td>{p.in}</Td>
                  <Td><code style={{ color: '#1f5e7c' }}>{schemaTypeLabel(p.schema)}</code></Td>
                  <Td>{p.required ? '✓' : ''}</Td>
                  <Td>{p.description || ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {ep.requestBody && (
        <Section title="Request body">
          <SchemaBlock schema={firstSchema(ep.requestBody.content)} required={ep.requestBody.required} />
        </Section>
      )}

      {Object.keys(ep.responses || {}).length > 0 && (
        <Section title="Responses">
          <div>
            {Object.entries(ep.responses).map(([status, r]) => (
              <div key={status} style={{ marginBottom: 6, padding: '8px 12px', background: '#fff', border: '1px solid #e6e3dd' }}>
                <div style={{ fontSize: 11, marginBottom: 4 }}>
                  <strong style={{ color: status.startsWith('2') ? '#2e7d32' : status.startsWith('4') ? '#b87333' : status.startsWith('5') ? '#c0392b' : '#5a534b' }}>{status}</strong>
                  <span style={{ color: '#5a534b', marginLeft: 8 }}>{r.description || ''}</span>
                </div>
                {r.content && <SchemaBlock schema={firstSchema(r.content)} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {ep.method === 'GET' && <TryGetIt ep={ep} />}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function Th({ children }) {
  return <th style={{ padding: '6px 10px', borderBottom: '1px solid #d7d4cf', fontWeight: 600, fontSize: 10.5, color: '#5a534b' }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding: '6px 10px', verticalAlign: 'top' }}>{children}</td>;
}

function firstSchema(content) {
  if (!content) return null;
  const ct = Object.keys(content)[0];
  return ct ? content[ct].schema || null : null;
}
function schemaTypeLabel(s) {
  if (!s) return '—';
  if (s.$ref) return s.$ref.split('/').pop();
  if (s.type === 'array') return (schemaTypeLabel(s.items) || 'array') + '[]';
  return s.type || 'object';
}
function SchemaBlock({ schema, required }) {
  if (!schema) return <div style={{ fontSize: 11, color: '#8c867d' }}>(스키마 없음)</div>;
  return (
    <pre style={{
      fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace',
      background: '#231815', color: '#f0ede7', padding: '10px 12px',
      overflow: 'auto', maxHeight: 240, margin: 0, whiteSpace: 'pre-wrap',
    }}>
      {required && <span style={{ color: '#f0c4c0', fontSize: 10 }}>* required\n</span>}
      {JSON.stringify(schema, null, 2)}
    </pre>
  );
}

function TryGetIt({ ep }) {
  const [params, setParams] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const pathParams = ep.parameters.filter((p) => p.in === 'path');
  const queryParams = ep.parameters.filter((p) => p.in === 'query');

  const buildPath = () => {
    let p = ep.path;
    for (const pp of pathParams) {
      const v = params[pp.name];
      if (v == null || v === '') continue;
      p = p.replace('{' + pp.name + '}', encodeURIComponent(v));
    }
    const qs = queryParams
      .filter((qp) => params[qp.name] != null && params[qp.name] !== '')
      .map((qp) => encodeURIComponent(qp.name) + '=' + encodeURIComponent(params[qp.name]))
      .join('&');
    return qs ? p + '?' + qs : p;
  };

  const tryIt = async () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const r = await api.get(buildPath());
      const elapsed = Math.round(performance.now() - t0);
      setResult({ ok: !!r.ok, status: r.status, elapsed, body: r });
    } catch (e) {
      setResult({ ok: false, error: String(e?.message || e), elapsed: Math.round(performance.now() - t0) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Section title="Try it (GET only · 인증 토큰 자동 첨부)">
      {(pathParams.length || queryParams.length) > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 8 }}>
          {[...pathParams, ...queryParams].map((p) => (
            <label key={p.in + ':' + p.name} style={{ fontSize: 11, color: '#5a534b' }}>
              <span style={{ display: 'block', marginBottom: 2 }}>
                <code style={{ color: '#1f5e7c' }}>{p.name}</code>{' '}
                <span style={{ color: '#8c867d' }}>({p.in})</span>
                {p.required && <span style={{ color: '#c0392b' }}> *</span>}
              </span>
              <input
                type="text"
                value={params[p.name] ?? ''}
                onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
                placeholder={p.schema?.example != null ? String(p.schema.example) : ''}
                style={{ width: '100%', padding: '4px 8px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 11.5, fontFamily: 'SF Mono, Menlo, monospace' }}
              />
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button type="button" className="adm-btn-sm" onClick={tryIt} disabled={running}
          style={{ background: '#231815', color: '#f6f4f0' }}>
          {running ? '호출 중…' : '실행'}
        </button>
        <code style={{ fontSize: 11, color: '#8c867d', fontFamily: 'SF Mono, Menlo, monospace' }}>GET {buildPath()}</code>
      </div>
      {result && (
        <div style={{ background: '#231815', color: '#f0ede7', padding: '10px 12px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', maxHeight: 320, overflow: 'auto' }}>
          <div style={{ color: result.ok ? '#9bd99b' : '#f0c4c0', marginBottom: 4 }}>
            {result.ok ? 'OK' : 'FAIL'} · status {result.status ?? '—'} · {result.elapsed} ms
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {result.error || JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </Section>
  );
}
