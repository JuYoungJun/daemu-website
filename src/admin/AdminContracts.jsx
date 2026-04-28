// 계약서 / 발주서 관리 — 템플릿 CRUD + 문서 생성·발송·서명 추적·PDF 출력.
//
// 책임 범위 (의도적 한계):
//   - 본 모듈은 문서 워크플로(작성·치환·발송·서명·PDF)에 한정합니다.
//   - 결제/대금 처리/PG 연동은 본 시스템에서 다루지 않습니다.
//   - 그러므로 amount 변수는 단순 표기이며, 실제 결제 청구나 청구서 처리와 연결되지 않습니다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';
import { Auth } from '../lib/auth.js';
import { DB } from '../lib/db.js';

const KIND_LABEL = { contract: '계약서', purchase_order: '발주서' };
const STATUS_LABEL = {
  draft: '초안', sent: '발송됨', viewed: '열람됨',
  signed: '서명완료', canceled: '취소됨',
};
const STATUS_COLOR = {
  draft: '#6f6b68', sent: '#2e7d32', viewed: '#b87333',
  signed: '#1f5e7c', canceled: '#c0392b',
};

const VARIABLE_HINTS = [
  { key: 'clientName', label: '고객/회사명' },
  { key: 'projectName', label: '프로젝트명' },
  { key: 'amount', label: '금액(표기용)' },
  { key: 'startDate', label: '시작일' },
  { key: 'endDate', label: '종료일' },
  { key: 'companyName', label: '발주/공급사명' },
  { key: 'managerName', label: '담당자' },
  { key: 'scope', label: '업무 범위' },
  { key: 'terms', label: '특약 조건' },
];

const DEFAULT_CONTRACT_TEMPLATE = `용역 계약서

본 계약은 {{companyName}}(이하 "갑")과 {{clientName}}(이하 "을") 사이에 체결되며,
"{{projectName}}" 프로젝트에 관한 사항을 다음과 같이 정한다.

1. 용역 범위
{{scope}}

2. 계약 기간
{{startDate}} ~ {{endDate}}

3. 금액 (표기)
{{amount}} (실제 대금 수납·청구 처리는 본 문서 시스템과 별도로 진행됨)

4. 특약사항
{{terms}}

위 내용에 따라 본 계약을 체결하며, 양 당사자는 서명을 통해 이를 확인한다.

— {{managerName}} 드림`;

const DEFAULT_PO_TEMPLATE = `발주서 (Purchase Order)

발주처: {{companyName}}
공급처: {{clientName}}
프로젝트: {{projectName}}

납기: {{endDate}}
금액(표기): {{amount}}

발주 항목 / 조건:
{{scope}}

비고:
{{terms}}

— {{managerName}}`;

function isoNow() { return new Date().toISOString(); }

function localStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem('daemu_' + key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function localSet(key, val) {
  localStorage.setItem('daemu_' + key, JSON.stringify(val));
  window.dispatchEvent(new Event('daemu-db-change'));
}

function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

export default function AdminContracts() {
  const me = Auth.user();
  const isAdmin = me?.role === 'admin';
  const [tab, setTab] = useState('documents');
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // doc id for detail drawer

  const reload = async () => {
    setLoading(true); setError('');
    try {
      if (api.isConfigured()) {
        const [t, d] = await Promise.all([
          api.get('/api/document-templates'),
          api.get('/api/documents?page_size=200'),
        ]);
        setTemplates(t.ok ? (t.items || []) : []);
        setDocuments(d.ok ? (d.items || []) : []);
        if (!t.ok) setError(t.error || '템플릿을 불러올 수 없습니다.');
      } else {
        // Demo mode — localStorage
        setTemplates(localStore('document_templates', []));
        setDocuments(localStore('documents', []));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-line */ }, []);

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">계약서 / 발주서</h1>

          <AdminHelp title="계약서·발주서 사용 안내" items={[
            '1단계 — 템플릿 만들기: "템플릿" 탭에서 표준 계약서/발주서 양식을 등록하세요. {{변수}} 자리에 실제 값이 치환됩니다.',
            '2단계 — 문서 생성: "문서" 탭에서 템플릿을 고르고 변수값(고객명·프로젝트명·금액·기간 등)을 채워 최종 문서를 생성합니다.',
            '3단계 — 미리보기 → 발송: 문서를 열어 미리보기에서 확인 후 "발송"을 누르면 수신자에게 이메일이 나가며 서명 링크가 동봉됩니다.',
            '4단계 — 서명: 수신자가 서명 링크에서 캔버스 서명을 완료하면 상태가 자동으로 "서명완료"로 바뀝니다.',
            '⚖️ 법적 효력 안내 — 본 e-Sign은 데모/내부 결재용입니다. 강한 법적 효력이 필요한 계약은 DocuSign·Adobe Sign·KICA 인증서 + 신원확인·감사이력·위변조 방지가 필요합니다.',
            '본 시스템은 결제/대금 수납을 다루지 않습니다. 금액 변수는 명세 표기일 뿐 실제 청구·수납 처리와 연결되지 않습니다.',
          ]} />

          <div className="adm-tabs">
            <button type="button" className={tab === 'documents' ? 'is-active' : ''} onClick={() => setTab('documents')}>
              문서 <span style={{ color: '#b9b5ae', fontWeight: 400 }}>{documents.length}</span>
            </button>
            <button type="button" className={tab === 'templates' ? 'is-active' : ''} onClick={() => setTab('templates')}>
              템플릿 <span style={{ color: '#b9b5ae', fontWeight: 400 }}>{templates.length}</span>
            </button>
          </div>

          {error && <p style={{ color: '#c0392b', fontSize: 12, marginBottom: 14 }}>{error}</p>}

          {tab === 'templates' && (
            <TemplatesPane
              templates={templates}
              onChange={reload}
              isAdmin={isAdmin}
            />
          )}

          {tab === 'documents' && (
            <DocumentsPane
              documents={documents}
              templates={templates}
              onChange={reload}
              isAdmin={isAdmin}
              loading={loading}
              onOpen={(id) => setSelected(id)}
            />
          )}

          {selected && (
            <DocumentDrawer
              docId={selected}
              onClose={() => setSelected(null)}
              onChange={reload}
              templates={templates}
              isAdmin={isAdmin}
            />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

/* ─────────────── 템플릿 패널 ─────────────── */

function TemplatesPane({ templates, onChange, isAdmin }) {
  const [editing, setEditing] = useState(null);

  const startNew = (kind) => setEditing({
    name: kind === 'contract' ? '기본 계약서' : '기본 발주서',
    kind,
    subject: kind === 'contract' ? '[대무] 계약서 — {{projectName}}' : '[대무] 발주서 — {{projectName}}',
    body: kind === 'contract' ? DEFAULT_CONTRACT_TEMPLATE : DEFAULT_PO_TEMPLATE,
    variables: VARIABLE_HINTS.map((v) => v.key),
    active: true,
  });

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <button className="btn" type="button" onClick={() => startNew('contract')}>+ 계약서 템플릿</button>
          <button className="btn" type="button" onClick={() => startNew('purchase_order')}>+ 발주서 템플릿</button>
        </div>
      )}

      {!templates.length && <EmptyState text="등록된 템플릿이 없습니다. 위 버튼으로 표준 양식을 만들어 보세요." />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 14 }}>
        {templates.map((t) => (
          <div key={t.id} style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <strong style={{ fontSize: 14 }}>{t.name}</strong>
              <span style={{ fontSize: 11, color: '#8c867d' }}>{KIND_LABEL[t.kind] || t.kind}</span>
            </div>
            <p style={{ fontSize: 12, color: '#6f6b68', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 84, overflow: 'hidden', position: 'relative' }}>
              {String(t.body || '').slice(0, 240)}{(t.body || '').length > 240 ? '…' : ''}
            </p>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(t.variables || []).slice(0, 6).map((v) => (
                <code key={v} style={{ fontSize: 10, background: '#f6f4f0', padding: '2px 6px', border: '1px solid #e6e3dd' }}>{v}</code>
              ))}
            </div>
            {isAdmin && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                <button type="button" className="adm-btn-sm" onClick={() => setEditing(t)}>수정</button>
                <button type="button" className="adm-btn-sm danger" onClick={async () => {
                  if (!confirm('이 템플릿을 삭제할까요?')) return;
                  if (api.isConfigured()) {
                    await api.del('/api/document-templates/' + t.id);
                  } else {
                    localSet('document_templates', localStore('document_templates', []).filter((x) => x.id !== t.id));
                  }
                  onChange();
                }}>삭제</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }) {
  const [t, setT] = useState({
    name: template.name || '', kind: template.kind || 'contract',
    subject: template.subject || '', body: template.body || '',
    variables: template.variables || [], active: template.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (api.isConfigured()) {
        const url = template.id ? '/api/document-templates/' + template.id : '/api/document-templates';
        const r = template.id ? await api.patch(url, t) : await api.post(url, t);
        if (!r.ok) { setErr(r.error || '저장 실패'); setSaving(false); return; }
      } else {
        const list = localStore('document_templates', []);
        if (template.id) {
          const idx = list.findIndex((x) => x.id === template.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...t, updated_at: isoNow() };
        } else {
          list.unshift({ id: Date.now(), ...t, created_at: isoNow(), updated_at: isoNow() });
        }
        localSet('document_templates', list);
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={template.id ? '템플릿 수정' : '템플릿 등록'}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="이름">
          <input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </Field>
        <Field label="종류">
          <select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value })}>
            <option value="contract">계약서</option>
            <option value="purchase_order">발주서</option>
          </select>
        </Field>
        <Field label="이메일 제목 (변수 사용 가능)">
          <input type="text" value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} />
        </Field>
        <Field label="본문 (변수: {{key}} 형식)">
          <textarea value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} rows={14}
            style={{ fontFamily: 'monospace', fontSize: 13 }} />
        </Field>
        <div style={{ fontSize: 12, color: '#6f6b68' }}>
          <strong style={{ color: '#2a2724', letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11 }}>사용 가능한 변수</strong>{' '}
          (클릭해서 본문에 삽입)
          <div style={{ marginTop: 6 }}>
            {VARIABLE_HINTS.map((v) => (
              <button key={v.key} type="button" className="adm-var-chip"
                onClick={() => setT({ ...t, body: t.body + ' {{' + v.key + '}}' })}>
                {`{{${v.key}}}`} <span style={{ color: '#8c867d', marginLeft: 4 }}>{v.label}</span>
              </button>
            ))}
          </div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={t.active} onChange={(e) => setT({ ...t, active: e.target.checked })} />
          사용 중 (체크 해제하면 문서 작성 화면에서 숨김)
        </label>
        {err && <p style={{ color: '#c0392b', fontSize: 12, margin: 0 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="adm-btn-sm" type="button" onClick={onClose}>취소</button>
          <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────── 문서 패널 ─────────────── */

function DocumentsPane({ documents, templates, onChange, isAdmin, loading, onOpen }) {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return documents;
    return documents.filter((d) => d.status === filter);
  }, [documents, filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {isAdmin && <button className="btn" type="button" onClick={() => setCreating(true)}>+ 새 문서</button>}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff' }}>
          <option value="all">전체 상태</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#8c867d', marginLeft: 'auto' }}>{filtered.length}건</span>
      </div>

      {loading && <p style={{ color: '#8c867d', fontSize: 12 }}>불러오는 중…</p>}

      {!filtered.length && !loading && (
        <div className="adm-doc-empty">
          <strong>문서가 없습니다</strong>
          상단 <em>+ 새 문서</em> 버튼으로 첫 계약서·발주서를 작성하세요.
        </div>
      )}

      <div className="adm-doc-grid">
        {filtered.map((d) => (
          <div key={d.id} className="adm-doc-row" onClick={() => onOpen(d.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span className="adm-doc-pill" data-status={d.status}>{STATUS_LABEL[d.status] || d.status}</span>
                <span style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase' }}>{KIND_LABEL[d.kind] || d.kind}</span>
              </div>
              <p className="adm-doc-row__title">{d.title}</p>
              <div className="adm-doc-row__meta">
                수신자 {(d.recipients || []).length}명 · {new Date(d.created_at).toLocaleString('ko')}
              </div>
            </div>
            <div style={{ fontSize: 18, color: '#b9b5ae', fontWeight: 300 }}>→</div>
          </div>
        ))}
      </div>

      {creating && (
        <DocumentEditor
          doc={null}
          templates={templates}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); onChange(); }}
        />
      )}
    </div>
  );
}

/* ─────────────── 문서 편집기 (생성/수정) ─────────────── */

function DocumentEditor({ doc, templates, onClose, onSaved }) {
  const [d, setD] = useState({
    template_id: doc?.template_id || (templates[0]?.id || null),
    kind: doc?.kind || (templates.find((x) => x.id === doc?.template_id)?.kind || 'contract'),
    title: doc?.title || '',
    subject: doc?.subject || '',
    body: doc?.body || '',
    variables: doc?.variables || {},
    recipients: doc?.recipients || [],
    crm_id: doc?.crm_id || null,
    partner_id: doc?.partner_id || null,
    order_id: doc?.order_id || null,
    work_id: doc?.work_id || null,
    render_from_template: !doc,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Sync template default body whenever the template selection changes.
  const tplActive = templates.filter((t) => t.active !== false);
  const currentTpl = templates.find((t) => t.id === d.template_id);

  useEffect(() => {
    if (!currentTpl || doc) return;
    setD((prev) => ({
      ...prev,
      kind: currentTpl.kind,
      subject: currentTpl.subject || prev.subject,
      body: currentTpl.body || prev.body,
    }));
  }, [d.template_id]); // eslint-disable-line

  const previewBody = applyVars(d.body, d.variables);
  const previewSubject = applyVars(d.subject, d.variables);

  const setVar = (k, v) => setD({ ...d, variables: { ...d.variables, [k]: v } });
  const addRecipient = () => setD({ ...d, recipients: [...(d.recipients || []), { name: '', email: '', role: 'signer' }] });
  const updateRecipient = (i, k, v) => {
    const list = [...(d.recipients || [])];
    list[i] = { ...list[i], [k]: v };
    setD({ ...d, recipients: list });
  };
  const removeRecipient = (i) => {
    const list = [...(d.recipients || [])];
    list.splice(i, 1);
    setD({ ...d, recipients: list });
  };

  // CRM/Partners/Orders pickers — pulled from local DB for convenience.
  const crmList = DB.get('crm');
  const partnerList = DB.get('partners');
  const orderList = DB.get('orders');

  const save = async () => {
    if (!d.title.trim()) { setErr('제목을 입력하세요.'); return; }
    if (!(d.recipients || []).length) { setErr('수신자를 1명 이상 추가하세요.'); return; }
    setSaving(true); setErr('');
    const payload = { ...d };
    try {
      if (api.isConfigured()) {
        const r = doc ? await api.patch('/api/documents/' + doc.id, payload) : await api.post('/api/documents', payload);
        if (!r.ok) { setErr(r.error || '저장 실패'); setSaving(false); return; }
      } else {
        const list = localStore('documents', []);
        const renderedBody = payload.render_from_template ? applyVars(payload.body, payload.variables) : payload.body;
        const renderedSubject = payload.render_from_template ? applyVars(payload.subject, payload.variables) : payload.subject;
        if (doc) {
          const idx = list.findIndex((x) => x.id === doc.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...payload, body: renderedBody, subject: renderedSubject, updated_at: isoNow() };
        } else {
          list.unshift({
            id: Date.now(), ...payload, body: renderedBody, subject: renderedSubject,
            status: 'draft', sign_token: '', created_at: isoNow(), updated_at: isoNow(),
            history: [{ ts: isoNow(), action: 'created' }],
          });
        }
        localSet('documents', list);
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={doc ? '문서 수정' : '새 문서 생성'} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="템플릿 선택">
            <select value={d.template_id || ''} onChange={(e) => setD({ ...d, template_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">(직접 작성 — 템플릿 없음)</option>
              {tplActive.map((t) => <option key={t.id} value={t.id}>{KIND_LABEL[t.kind]} · {t.name}</option>)}
            </select>
          </Field>
          <Field label="문서 제목">
            <input type="text" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="예: 비클래시 나주점 메뉴개발 용역계약서" />
          </Field>
          <Field label="이메일 제목">
            <input type="text" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />
          </Field>
          <Field label="문서 본문 (변수 미치환 원본)">
            <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={14} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          </Field>

          <div>
            <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', margin: '14px 0 8px' }}>변수값</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {VARIABLE_HINTS.map((v) => (
                <label key={v.key} style={{ display: 'block' }}>
                  <span style={{ fontSize: 11, color: '#6f6b68' }}>{v.label} (<code>{`{{${v.key}}}`}</code>)</span>
                  <input type="text" value={d.variables[v.key] || ''} onChange={(e) => setVar(v.key, e.target.value)}
                    style={{ width: '100%', padding: 6, border: '1px solid #d7d4cf', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </label>
              ))}
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', margin: '14px 0 8px' }}>수신자 (서명 대상)</h4>
            {(d.recipients || []).map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input type="text" placeholder="이름" value={r.name} onChange={(e) => updateRecipient(i, 'name', e.target.value)}
                  style={{ flex: 1, padding: 6, border: '1px solid #d7d4cf', fontSize: 13 }} />
                <input type="email" placeholder="이메일" value={r.email} onChange={(e) => updateRecipient(i, 'email', e.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid #d7d4cf', fontSize: 13 }} />
                <select value={r.role} onChange={(e) => updateRecipient(i, 'role', e.target.value)}
                  style={{ padding: 6, border: '1px solid #d7d4cf', fontSize: 13 }}>
                  <option value="signer">서명자</option>
                  <option value="cc">참조</option>
                </select>
                <button type="button" className="adm-btn-sm danger" onClick={() => removeRecipient(i)}>×</button>
              </div>
            ))}
            <button type="button" className="adm-btn-sm" onClick={addRecipient}>+ 수신자 추가</button>
          </div>

          <details style={{ fontSize: 12, color: '#6f6b68' }}>
            <summary style={{ cursor: 'pointer', padding: '6px 0' }}>📎 연결할 데이터 선택 (선택 사항)</summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
              <Field label="CRM 고객">
                <select value={d.crm_id || ''} onChange={(e) => setD({ ...d, crm_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">(선택 없음)</option>
                  {crmList.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` / ${c.company}` : ''}</option>)}
                </select>
              </Field>
              <Field label="파트너">
                <select value={d.partner_id || ''} onChange={(e) => setD({ ...d, partner_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">(선택 없음)</option>
                  {partnerList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="발주">
                <select value={d.order_id || ''} onChange={(e) => setD({ ...d, order_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">(선택 없음)</option>
                  {orderList.map((o) => <option key={o.id} value={o.id}>#{String(o.id).slice(-6)} {o.partner}</option>)}
                </select>
              </Field>
            </div>
          </details>
        </div>

        <div>
          <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', margin: '0 0 8px' }}>미리보기</h4>
          <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 22, minHeight: 400, overflow: 'auto', maxHeight: 600 }}>
            <div style={{ fontSize: 11, color: '#8c867d', marginBottom: 6, letterSpacing: '.08em', textTransform: 'uppercase' }}>제목 · {previewSubject || '—'}</div>
            <h2 style={{ fontSize: 18, marginTop: 0 }}>{d.title || '(문서 제목)'}</h2>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7 }}>
              {previewBody || '(미리보기가 비어있습니다 — 본문/변수값을 입력하세요)'}
            </pre>
          </div>
        </div>
      </div>

      {err && <p style={{ color: '#c0392b', fontSize: 12, margin: '12px 0 0' }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="adm-btn-sm" type="button" onClick={onClose}>취소</button>
        <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '저장 중…' : (doc ? '저장' : '문서 생성')}</button>
      </div>
    </Modal>
  );
}

/* ─────────────── 상세 드로어 ─────────────── */

function DocumentDrawer({ docId, onClose, onChange, templates, isAdmin }) {
  const [doc, setDoc] = useState(null);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    if (api.isConfigured()) {
      const r = await api.get('/api/documents/' + docId);
      if (r.ok) {
        setDoc(r.item);
        setSignatures(r.signatures || []);
      } else {
        setErr(r.error || '불러오기 실패');
      }
    } else {
      const list = localStore('documents', []);
      const found = list.find((x) => x.id === docId);
      setDoc(found || null);
      setSignatures([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, [docId]);

  const send = async () => {
    if (!confirm('수신자에게 문서를 발송할까요?\n발송 후 서명 링크가 함께 전달됩니다.')) return;
    if (api.isConfigured()) {
      const r = await api.post('/api/documents/' + docId + '/send', { sign_required: true, extra_message: '' });
      if (r.ok) {
        alert('발송 결과 — 성공: ' + r.sent + ', 실패: ' + r.failed + '\n서명 URL: ' + (r.sign_url || '(없음)'));
        await load(); onChange();
      } else {
        alert('발송 실패: ' + (r.error || ''));
      }
    } else {
      // Demo — mark as sent and create a fake token.
      const list = localStore('documents', []);
      const idx = list.findIndex((x) => x.id === docId);
      if (idx >= 0) {
        list[idx].status = 'sent';
        list[idx].sent_at = isoNow();
        list[idx].sign_token = 'demo-' + Math.random().toString(36).slice(2);
        list[idx].history = [...(list[idx].history || []), { ts: isoNow(), action: 'sent' }];
        localSet('documents', list);
        alert('데모 모드 — 발송 시뮬레이션 완료. 서명 URL: ' + window.location.origin + '/sign/' + list[idx].sign_token);
        await load(); onChange();
      }
    }
  };

  const cancel = async () => {
    const reason = prompt('취소 사유를 입력하세요 (선택):', '') || '';
    if (api.isConfigured()) {
      const r = await api.post('/api/documents/' + docId + '/cancel', { reason });
      if (r.ok) { await load(); onChange(); }
      else alert('취소 실패: ' + (r.error || ''));
    } else {
      const list = localStore('documents', []);
      const idx = list.findIndex((x) => x.id === docId);
      if (idx >= 0) {
        list[idx].status = 'canceled';
        list[idx].canceled_at = isoNow();
        list[idx].canceled_reason = reason;
        list[idx].history = [...(list[idx].history || []), { ts: isoNow(), action: 'canceled' }];
        localSet('documents', list);
        await load(); onChange();
      }
    }
  };

  const remove = async () => {
    if (!confirm('이 문서를 삭제할까요? 복구할 수 없습니다.')) return;
    if (api.isConfigured()) {
      await api.del('/api/documents/' + docId);
    } else {
      localSet('documents', localStore('documents', []).filter((x) => x.id !== docId));
    }
    onChange(); onClose();
  };

  const exportPdf = () => {
    // Print-to-PDF via the browser's native print dialog. No extra deps.
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) { alert('팝업 차단으로 PDF 창을 열 수 없습니다.'); return; }
    const safe = (s) => String(s ?? '').replace(/[<>]/g, (c) => ({ '<': '&lt;', '>': '&gt;' }[c]));
    const sigImgs = signatures.map((s) => `
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #d7d4cf">
        <div style="font-size:11px;color:#6f6b68">서명자: ${safe(s.signer_name)} (${safe(s.signer_email)}) · ${s.signed_at ? new Date(s.signed_at).toLocaleString('ko') : ''}</div>
      </div>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(doc.title)}</title>
      <style>
        @page { size: A4; margin: 22mm; }
        body { font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif; color:#231815; line-height:1.75; }
        h1 { font-size: 20px; border-bottom: 2px solid #231815; padding-bottom: 8px; }
        .meta { font-size: 11px; color: #8c867d; margin-bottom: 18px; letter-spacing:.04em }
        pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; }
        .brand { text-align: right; font-size: 12px; color: #8c867d; margin-top: 28px; border-top: 1px solid #d7d4cf; padding-top: 10px; letter-spacing:.08em }
      </style></head><body>
      <div class="meta">${safe(KIND_LABEL[doc.kind] || '')} · ${safe(STATUS_LABEL[doc.status] || '')} · ${doc.created_at ? new Date(doc.created_at).toLocaleString('ko') : ''}</div>
      <h1>${safe(doc.title)}</h1>
      <pre>${safe(doc.body)}</pre>
      ${sigImgs}
      <div class="brand">대무 (DAEMU) · daemu_office@naver.com · 061-335-1239</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),250);<\/script>
      </body></html>`);
    w.document.close();
  };

  if (loading || !doc) {
    return <Modal onClose={onClose} title="불러오는 중…"><p>{err || '문서를 불러오고 있습니다.'}</p></Modal>;
  }

  if (editing) {
    return <DocumentEditor doc={doc} templates={templates} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); onChange(); }} />;
  }

  return (
    <Modal onClose={onClose} title={doc.title} wide>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="adm-doc-pill" data-status={doc.status}>{STATUS_LABEL[doc.status]}</span>
        <span style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.06em', textTransform: 'uppercase' }}>{KIND_LABEL[doc.kind]}</span>
        <span style={{ fontSize: 11, color: '#b9b5ae' }}>· 작성 {new Date(doc.created_at).toLocaleString('ko')}</span>
      </div>

      <div className="adm-doc-preview" style={{ marginBottom: 18 }}>
        <span className="adm-doc-subject">{doc.subject || '(제목 없음)'}</span>
        <h2 className="adm-doc-title">{doc.title}</h2>
        {doc.body}
      </div>

      {(doc.recipients || []).length > 0 && (
        <div style={{ marginBottom: 14, fontSize: 12, color: '#6f6b68' }}>
          <strong style={{ color: '#2a2724', letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11 }}>수신자</strong>{' '}
          {(doc.recipients || []).map((r) => `${r.name || ''} <${r.email}>`).join(', ')}
        </div>
      )}

      {doc.sign_token && (
        <div className="adm-sign-link" style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 16 }}>🔗</span>
          <span style={{ flex: 1 }}>
            <strong style={{ display: 'block', marginBottom: 4, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5a4a2a' }}>서명 링크</strong>
            <code>{window.location.origin}/sign/{doc.sign_token}</code>
          </span>
          <button type="button" className="adm-btn-sm" onClick={() => {
            navigator.clipboard?.writeText(`${window.location.origin}/sign/${doc.sign_token}`);
          }}>복사</button>
        </div>
      )}

      {signatures.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>서명 기록</h4>
          {signatures.map((s) => (
            <div key={s.id} style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 12, marginTop: 6, fontSize: 12 }}>
              <strong>{s.signer_name}</strong> · {s.signer_email} · {new Date(s.signed_at).toLocaleString('ko')}<br />
              IP {s.ip || '-'} · UA {(s.user_agent || '').slice(0, 80)}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>이력</h4>
        {(doc.history || []).map((h, i) => (
          <div key={i} style={{ fontSize: 12, color: '#6f6b68', padding: '4px 0' }}>
            {new Date(h.ts).toLocaleString('ko')} · <strong>{h.action}</strong>
            {h.by ? ` · ${h.by}` : ''}
            {h.detail ? ` · ${JSON.stringify(h.detail)}` : ''}
          </div>
        ))}
      </div>

      <div className="adm-action-row">
        {isAdmin && doc.status === 'draft' && (
          <button className="btn" type="button" onClick={send}>📤 발송</button>
        )}
        {isAdmin && doc.status !== 'signed' && doc.status !== 'canceled' && (
          <button className="adm-btn-sm" type="button" onClick={() => setEditing(true)}>수정</button>
        )}
        <button className="adm-btn-sm" type="button" onClick={exportPdf}>📄 PDF 출력</button>
        {isAdmin && doc.status !== 'canceled' && doc.status !== 'signed' && (
          <button className="adm-btn-sm danger" type="button" onClick={cancel}>취소 처리</button>
        )}
        {isAdmin && (
          <button className="adm-btn-sm danger" type="button" onClick={remove}>삭제</button>
        )}
      </div>
    </Modal>
  );
}

/* ─────────────── 공통 ─────────────── */

function Modal({ children, onClose, title, wide }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`adm-modal-box ${wide ? 'is-wide' : 'is-narrow'}`}>
        <div className="adm-modal-head">
          <h2>{title}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c867d', background: '#fff', border: '1px dashed #d7d4cf' }}>
      <p>{text}</p>
    </div>
  );
}
