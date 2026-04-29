// API 문서 — 위키 스타일 페이지.
//
// 좌측 사이드바(태그 트리) + 우측 본문(선택된 endpoint 의 자세한 설명) 형태.
// FastAPI 자동 생성 /docs#/ Swagger UI 의 사이트 디자인 대체.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';
import AdminGuideModal, { GuideSection, guideListStyle } from './AdminGuideModal.jsx';
import { api } from '../lib/api.js';

const METHOD_COLOR = {
  GET:    { bg: '#eef6ee', fg: '#2e7d32', border: '#cfe5cf' },
  POST:   { bg: '#eef2fb', fg: '#1f5e7c', border: '#cfd9ed' },
  PUT:    { bg: '#fff8ec', fg: '#b87333', border: '#f0e3c4' },
  PATCH:  { bg: '#fff8ec', fg: '#b87333', border: '#f0e3c4' },
  DELETE: { bg: '#fff0ec', fg: '#c0392b', border: '#f0c4c0' },
};
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// 한국어 태그 라벨 — openapi 의 영문 tag 를 한국어로 표시.
const TAG_LABEL = {
  'auth': '인증',
  'email-verify': '이메일 인증',
  'users': '사용자 관리',
  'crud': '핵심 CRUD',
  'documents': '문서 / 계약서',
  'short-links': '단축 링크',
  'short-links-public': '단축 링크 (공개)',
  'untagged': '기타',
};
const TAG_DESC = {
  'auth': '관리자 로그인 / TOTP / 잠금 해제 / /me.',
  'email-verify': '이메일 인증 메일 발송 + 확인.',
  'users': '관리자 계정 발급·수정·삭제.',
  'crud': '문의·파트너 등 핵심 데이터의 일반 CRUD.',
  'documents': '계약서 / 발주서 템플릿 + 발급 + e-Sign.',
  'short-links': 'UTM 단축 링크 발급·관리·통계 (인증 필요).',
  'short-links-public': '단축 링크 redirect 엔드포인트 (인증 불필요).',
  'untagged': '헬스체크 / 모니터링 / 업로드 / 발송.',
};

export default function AdminApiDocs() {
  const [spec, setSpec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!api.isConfigured()) {
        if (alive) { setLoading(false); setError('백엔드가 연결되어 있지 않습니다 (VITE_API_BASE_URL 미설정).'); }
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

  // path × method 로 평탄화 + 첫 태그 기준으로 그룹.
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
          tag: tags[0],
          parameters: op.parameters || [],
          requestBody: op.requestBody || null,
          responses: op.responses || {},
          security: op.security || spec.security || [],
        });
      }
    }
    return out.sort((a, b) => {
      if (a.tag !== b.tag) return a.tag.localeCompare(b.tag);
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return METHODS.indexOf(a.method) - METHODS.indexOf(b.method);
    });
  }, [spec]);

  const tags = useMemo(() => {
    const map = new Map();
    for (const ep of endpoints) {
      if (!map.has(ep.tag)) map.set(ep.tag, []);
      map.get(ep.tag).push(ep);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [endpoints]);

  // 검색 시 매칭되는 endpoint 목록.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return endpoints;
    return endpoints.filter((ep) => {
      const hay = (ep.id + ' ' + ep.summary + ' ' + ep.description + ' ' + ep.tag).toLowerCase();
      return hay.includes(q);
    });
  }, [endpoints, search]);

  // 사이드바에 표시할 태그 트리(검색 적용 후).
  const tree = useMemo(() => {
    const map = new Map();
    for (const ep of filtered) {
      if (activeTag && ep.tag !== activeTag) continue;
      if (!map.has(ep.tag)) map.set(ep.tag, []);
      map.get(ep.tag).push(ep);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, activeTag]);

  // mount 시 + spec 로드 시 첫 endpoint 자동 선택.
  useEffect(() => {
    if (!activeId && endpoints.length) {
      setActiveId(endpoints[0].id);
    }
  }, [endpoints, activeId]);

  const active = endpoints.find((ep) => ep.id === activeId);

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
            <h1 className="page-title" style={{ margin: 0 }}>API 문서</h1>
            <div style={{ display: 'flex', gap: 8 }}>
              <PageActions>
                <GuideButton GuideComponent={ApiDocsGuide} />
              </PageActions>
            </div>
          </div>

          {loading && <div style={{ padding: '40px 0', color: '#8c867d' }}>API 문서 로드 중…</div>}
          {error && (
            <div style={{ background: '#fff0ec', border: '1px solid #f0c4c0', padding: '12px 16px', color: '#7a1a14', fontSize: 12.5 }}>
              로드 실패: {error}
            </div>
          )}

          {spec && (
            <>
              {/* 상단 바 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0 14px', borderBottom: '1px solid #e6e3dd', marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#8c867d' }}>
                  {spec.info?.title || 'API'} <strong style={{ color: '#5a534b' }}>v{spec.info?.version || ''}</strong>
                </span>
                <span style={{ fontSize: 11, color: '#8c867d' }}>·</span>
                <span style={{ fontSize: 12, color: '#5a534b' }}>{endpoints.length}개 endpoint · {tags.length}개 카테고리</span>
                <span style={{ flex: 1 }} />
                <input type="search" placeholder="검색 — path / 요약 / 카테고리"
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13, minWidth: 240 }} />
                <code style={{ fontSize: 10.5, color: '#8c867d', fontFamily: 'SF Mono, Menlo, monospace' }}>{api.baseUrl()}</code>
              </div>

              {/* 위키 레이아웃 — 좌측 트리 + 우측 본문 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16, alignItems: 'start' }} className="api-docs-grid">
                {/* 사이드바 */}
                <nav style={{ background: '#fafaf6', border: '1px solid #e6e3dd', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', position: 'sticky', top: 12 }}>
                  <button type="button" onClick={() => setActiveTag('')}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 14px', fontSize: 11, letterSpacing: '.14em',
                      textTransform: 'uppercase', color: activeTag ? '#8c867d' : '#1f5e7c',
                      background: activeTag ? 'transparent' : '#eef2fb',
                      border: 'none', cursor: 'pointer', borderBottom: '1px solid #e6e3dd',
                      fontWeight: activeTag ? 400 : 600,
                    }}>
                    전체 ({filtered.length})
                  </button>
                  {tree.map(([tag, list]) => (
                    <div key={tag}>
                      <button type="button" onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          width: '100%', textAlign: 'left',
                          padding: '8px 14px', background: activeTag === tag ? '#eef2fb' : '#fff',
                          color: '#231815', border: 'none', cursor: 'pointer',
                          borderTop: '1px solid #e6e3dd', fontSize: 12, fontWeight: 600,
                        }}>
                        <span>{TAG_LABEL[tag] || tag}</span>
                        <span style={{ fontSize: 10, color: '#8c867d', fontWeight: 400 }}>{list.length}</span>
                      </button>
                      {(activeTag === tag || (!activeTag && search)) && list.map((ep) => (
                        <button key={ep.id} type="button" onClick={() => setActiveId(ep.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                            padding: '7px 12px 7px 22px',
                            background: activeId === ep.id ? '#fff' : 'transparent',
                            borderLeft: '3px solid ' + (activeId === ep.id ? METHOD_COLOR[ep.method].fg : 'transparent'),
                            border: 'none', cursor: 'pointer', borderTop: '1px solid #f4f1ea', fontSize: 11.5,
                          }}>
                          <span style={{
                            background: METHOD_COLOR[ep.method].bg, color: METHOD_COLOR[ep.method].fg,
                            border: '1px solid ' + METHOD_COLOR[ep.method].border,
                            padding: '1px 6px', fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em',
                            minWidth: 44, textAlign: 'center', flexShrink: 0,
                          }}>{ep.method}</span>
                          <code style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11, color: '#231815', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.path}</code>
                        </button>
                      ))}
                    </div>
                  ))}
                  {!tree.length && (
                    <div style={{ padding: 16, fontSize: 12, color: '#8c867d', textAlign: 'center' }}>
                      검색 결과 없음
                    </div>
                  )}
                </nav>

                {/* 본문 */}
                <article style={{ background: '#fff', border: '1px solid #e6e3dd', minHeight: 320, padding: '20px 24px' }}>
                  {active ? <EndpointDetail ep={active} /> : <TagOverview tag={activeTag} list={endpoints} />}
                </article>
              </div>
            </>
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function TagOverview({ tag, list }) {
  if (!tag) {
    // 전체 — 카테고리 카드 그리드.
    const groups = new Map();
    for (const ep of list) {
      if (!groups.has(ep.tag)) groups.set(ep.tag, 0);
      groups.set(ep.tag, groups.get(ep.tag) + 1);
    }
    return (
      <>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, color: '#231815' }}>DAEMU API 위키</h2>
        <p style={{ fontSize: 13, color: '#5a534b', margin: '0 0 18px', lineHeight: 1.7 }}>
          좌측에서 카테고리를 선택하거나 검색창에 path 일부를 입력해 endpoint 를 찾으세요.
          각 endpoint 페이지는 parameters / request body / responses / curl 예시 + GET 한정 try-it 을 제공합니다.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {[...groups.entries()].sort().map(([t, n]) => (
            <div key={t} style={{ background: '#fafaf6', border: '1px solid #e6e3dd', padding: '14px 16px' }}>
              <div style={{ fontWeight: 600, color: '#231815', marginBottom: 4 }}>{TAG_LABEL[t] || t}</div>
              <div style={{ fontSize: 12, color: '#5a534b', lineHeight: 1.6, marginBottom: 6 }}>{TAG_DESC[t] || ''}</div>
              <div style={{ fontSize: 11, color: '#1f5e7c' }}>{n} endpoint</div>
            </div>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, color: '#231815' }}>{TAG_LABEL[tag] || tag}</h2>
      <p style={{ fontSize: 13, color: '#5a534b', margin: '0 0 12px' }}>{TAG_DESC[tag] || ''}</p>
      <p style={{ fontSize: 12, color: '#8c867d' }}>좌측 트리에서 endpoint 를 선택하세요.</p>
    </>
  );
}

function EndpointDetail({ ep }) {
  const c = METHOD_COLOR[ep.method] || METHOD_COLOR.GET;
  const requiresAuth = (ep.security || []).length > 0;

  return (
    <>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{
          background: c.bg, color: c.fg, border: '1px solid ' + c.border,
          padding: '4px 10px', fontSize: 12, letterSpacing: '.06em', fontWeight: 700,
          minWidth: 56, textAlign: 'center',
        }}>{ep.method}</span>
        <code style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 15, color: '#231815' }}>{ep.path}</code>
        {requiresAuth && (
          <span style={{ background: '#fff8ec', color: '#b87333', border: '1px solid #f0e3c4', padding: '2px 8px', fontSize: 10.5, fontWeight: 600 }}>인증 필요</span>
        )}
        {ep.tags.map((t) => (
          <span key={t} style={{ fontSize: 10, padding: '2px 6px', background: '#f4f1ea', color: '#5a534b', border: '1px solid #d7d4cf' }}>{TAG_LABEL[t] || t}</span>
        ))}
      </div>
      {ep.summary && <h2 style={{ margin: '4px 0 10px', fontSize: 18, color: '#231815' }}>{ep.summary}</h2>}
      {ep.description && (
        <p style={{ fontSize: 13, color: '#5a534b', margin: '0 0 18px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {ep.description}
        </p>
      )}

      {/* Parameters */}
      {ep.parameters?.length > 0 && (
        <DocSection title="Parameters">
          <table style={tableStyle}>
            <thead><tr><Th>이름</Th><Th>위치</Th><Th>타입</Th><Th>필수</Th><Th>설명</Th></tr></thead>
            <tbody>
              {ep.parameters.map((p, i) => (
                <tr key={i}>
                  <Td><code>{p.name}</code></Td>
                  <Td>{p.in}</Td>
                  <Td><code style={{ color: '#1f5e7c' }}>{schemaTypeLabel(p.schema)}</code></Td>
                  <Td>{p.required ? <span style={{ color: '#c0392b' }}>✓</span> : ''}</Td>
                  <Td>{p.description || ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSection>
      )}

      {/* Request body */}
      {ep.requestBody && (
        <DocSection title="Request body">
          <SchemaBlock schema={firstSchema(ep.requestBody.content)} required={ep.requestBody.required} />
        </DocSection>
      )}

      {/* Responses */}
      {Object.keys(ep.responses || {}).length > 0 && (
        <DocSection title="Responses">
          <div>
            {Object.entries(ep.responses).map(([status, r]) => (
              <div key={status} style={{ marginBottom: 8, padding: '10px 14px', background: '#fafaf6', border: '1px solid #e6e3dd' }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  <strong style={{ color: status.startsWith('2') ? '#2e7d32' : status.startsWith('4') ? '#b87333' : status.startsWith('5') ? '#c0392b' : '#5a534b' }}>{status}</strong>
                  <span style={{ color: '#5a534b', marginLeft: 8 }}>{r.description || ''}</span>
                </div>
                {r.content && <SchemaBlock schema={firstSchema(r.content)} />}
              </div>
            ))}
          </div>
        </DocSection>
      )}

      {/* curl 예시 */}
      <DocSection title="curl 예시">
        <CurlExample ep={ep} />
      </DocSection>

      {/* try-it */}
      {ep.method === 'GET' && (
        <DocSection title="실행해 보기 (GET only · 인증 토큰 자동 첨부)">
          <TryGetIt ep={ep} />
        </DocSection>
      )}
    </>
  );
}

function DocSection({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #e6e3dd' }}>{title}</h3>
      {children}
    </div>
  );
}

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
function Th({ children }) {
  return <th style={{ padding: '7px 10px', borderBottom: '1px solid #d7d4cf', textAlign: 'left', fontWeight: 600, fontSize: 10.5, color: '#5a534b', background: '#f4f1ea', letterSpacing: '.04em', textTransform: 'uppercase' }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding: '7px 10px', borderBottom: '1px solid #f0ede7', verticalAlign: 'top' }}>{children}</td>;
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
      overflow: 'auto', maxHeight: 280, margin: 0, whiteSpace: 'pre-wrap',
    }}>
      {required ? '* required\n' : ''}{JSON.stringify(schema, null, 2)}
    </pre>
  );
}

function CurlExample({ ep }) {
  const base = api.baseUrl() || 'https://daemu-py.onrender.com';
  const requiresAuth = (ep.security || []).length > 0;
  const lines = [];
  lines.push(`curl -X ${ep.method} '${base}${ep.path}'`);
  if (requiresAuth) lines.push("  -H 'Authorization: Bearer <ADMIN_TOKEN>'");
  if (ep.requestBody) {
    lines.push("  -H 'Content-Type: application/json'");
    lines.push("  -d '{\n    \"...\": \"...\"\n  }'");
  }
  return (
    <pre style={{
      fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace',
      background: '#231815', color: '#f0ede7', padding: '10px 12px',
      overflow: 'auto', maxHeight: 220, margin: 0, whiteSpace: 'pre-wrap',
    }}>
      {lines.join(' \\\n')}
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
    setRunning(true); setResult(null);
    const t0 = performance.now();
    try {
      const r = await api.get(buildPath());
      const elapsed = Math.round(performance.now() - t0);
      setResult({ ok: !!r.ok, status: r.status, elapsed, body: r });
    } catch (e) {
      setResult({ ok: false, error: String(e?.message || e), elapsed: Math.round(performance.now() - t0) });
    } finally { setRunning(false); }
  };

  return (
    <>
      {(pathParams.length || queryParams.length) > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 8 }}>
          {[...pathParams, ...queryParams].map((p) => (
            <label key={p.in + ':' + p.name} style={{ fontSize: 11, color: '#5a534b' }}>
              <span style={{ display: 'block', marginBottom: 2 }}>
                <code style={{ color: '#1f5e7c' }}>{p.name}</code>{' '}
                <span style={{ color: '#8c867d' }}>({p.in})</span>
                {p.required && <span style={{ color: '#c0392b' }}> *</span>}
              </span>
              <input type="text" value={params[p.name] ?? ''}
                onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
                placeholder={p.schema?.example != null ? String(p.schema.example) : ''}
                style={{ width: '100%', padding: '4px 8px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 11.5, fontFamily: 'SF Mono, Menlo, monospace' }} />
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
    </>
  );
}

function ApiDocsGuide({ onClose }) {
  return (
    <AdminGuideModal title="API 문서 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          백엔드 FastAPI 의 자동 생성 Swagger UI(<code>/docs#/</code>) 를 사이트 디자인으로 다시 만든
          위키 형태 문서입니다. 좌측 카테고리 트리 + 우측 상세 본문 구조.
        </p>
      </GuideSection>
      <GuideSection title="3가지 방법으로 endpoint 찾기">
        <ol style={guideListStyle}>
          <li><strong>좌측 트리</strong> — 카테고리(인증/사용자/문서 등) 클릭 → 하위 endpoint 펼쳐짐.</li>
          <li><strong>검색창</strong> — path 일부, summary, 카테고리 어떤 단어든.</li>
          <li><strong>전체 화면</strong> — 사이드바 상단 "전체" 클릭 → 카테고리 카드 그리드.</li>
        </ol>
      </GuideSection>
      <GuideSection title="endpoint 본문 구성">
        <ul style={guideListStyle}>
          <li><strong>헤더</strong> — method 배지 + path + 인증 필요 여부 + 카테고리.</li>
          <li><strong>Parameters</strong> — query/path/header 인자, 필수 여부, 타입.</li>
          <li><strong>Request body</strong> — JSON 스키마 (* required 포함).</li>
          <li><strong>Responses</strong> — 상태 코드별 description + 응답 스키마.</li>
          <li><strong>curl 예시</strong> — 복사해서 터미널에서 바로 호출.</li>
          <li><strong>실행해 보기</strong> — GET endpoint 한정. 토큰 자동 첨부, 응답 표시.</li>
        </ul>
      </GuideSection>
      <GuideSection title="실행해 보기 (try-it) 정책">
        <p>
          POST/PATCH/DELETE 는 운영 부작용 위험 때문에 본 페이지에서 try-it 을 제공하지 않습니다.
          curl 예시를 복사해 Postman/터미널에서 별도 호출하세요.
        </p>
      </GuideSection>
    </AdminGuideModal>
  );
}
