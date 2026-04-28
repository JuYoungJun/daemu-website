// 메일 템플릿 라이브러리.
//
// 기존 /admin/mail 은 "상담 자동회신" 단일 템플릿입니다. 이 페이지는 그와
// 별개로 운영자가 *여러 개* 템플릿을 저장해두고 단체 발송, 1:1 발송,
// 캠페인 등에서 재사용할 수 있게 합니다.
//
// 데이터: localStorage 'daemu_mail_templates' — 형태:
//   [{ id, name, category, subject, body, variables, active, updatedAt }]
//
// 향후 backend 연결 시 같은 형태로 mail_template_lib 테이블에 흡수됩니다
// (B1 모델: backend-py/models.py 의 MailTemplateLib).
//
// 단체 발송 UI 는 동일 페이지 하단의 "단체 발송" 패널에 있습니다.
// 실제 발송은 RESEND_API_KEY 가 백엔드에 등록된 후 활성화됩니다 — 그 전까지는
// outbox simulation 으로만 기록됩니다.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { downloadCSV } from '../lib/csv.js';
import { api } from '../lib/api.js';
import { isEmailEnabled } from '../lib/email.js';

const STORAGE_KEY = 'daemu_mail_templates';

const CATEGORIES = [
  { value: 'general', label: '일반' },
  { value: 'newsletter', label: '뉴스레터' },
  { value: 'event', label: '이벤트/공지' },
  { value: 'partner', label: '파트너 안내' },
  { value: 'reply', label: '회신/안내' },
];

function readTemplates() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveTemplates(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event('daemu-db-change'));
}
function nextId(list) {
  return list.length ? Math.max(...list.map((x) => Number(x.id) || 0)) + 1 : 1;
}

// 첫 진입 시 자동 시드되는 기본 템플릿 5종.
// 이미 같은 이름이 있으면 건드리지 않습니다(idempotent).
const SEED_TEMPLATES = [
  {
    name: '신규 파트너 환영',
    category: 'partner',
    subject: '[대무] {{이름}}님, 파트너 등록을 환영합니다',
    body:
`안녕하세요 {{이름}}님,

대무 파트너로 등록해 주셔서 감사합니다.
지금부터 발주 포털을 통해 다음 기능을 사용하실 수 있습니다:

  · 표준 카탈로그 발주
  · 발주 진행 상태 실시간 확인
  · 계약서·발주서 e-Sign 서명 및 사본 다운로드

문의 사항은 본 메일에 회신해 주세요.

대무 (DAEMU)
daemu_office@naver.com · 061-335-1239`,
    active: true,
  },
  {
    name: '발주 처리 안내',
    category: 'reply',
    subject: '[대무] {{발주번호}} 발주가 접수되었습니다',
    body:
`안녕하세요 {{이름}}님,

요청하신 발주 {{발주번호}} 가 정상 접수되었습니다.

  · 접수일: {{접수일}}
  · 예정 출고: {{출고예정일}}
  · 합계: {{합계금액}}

진행 상태는 파트너 포털에서 실시간 확인 가능합니다.
변경 또는 취소가 필요하시면 출고 1영업일 전까지 연락 주세요.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '뉴스레터 — 시즌 메뉴',
    category: 'newsletter',
    subject: '[대무] {{이름}}님께 보내는 이번 시즌 추천 메뉴',
    body:
`안녕하세요 {{이름}}님,

대무가 새로 큐레이션한 이번 시즌 메뉴를 소개드립니다.

  · 봄 시그니처 — 딸기 크렘 다누아즈
  · 한정 베이커리 — 무화과 크림 브리오슈
  · 시즌 음료 — 로즈 라떼

자세한 레시피 노트와 도입 사례는 아래 링크에서 확인하실 수 있습니다.
{{상세링크}}

수신을 원치 않으시면 본 메일 하단의 수신거부 링크를 이용해 주세요.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '미팅 일정 안내',
    category: 'general',
    subject: '[대무] {{이름}}님과의 미팅 일정 확인',
    body:
`안녕하세요 {{이름}}님,

요청하신 미팅 일정을 아래와 같이 조정했습니다.

  · 일시: {{일시}}
  · 장소: {{장소}}
  · 참석자: {{참석자}}
  · 안건: {{안건}}

변경이 필요하시면 1영업일 전까지 회신 부탁드립니다.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '이벤트/공지 안내',
    category: 'event',
    subject: '[대무] {{이벤트명}} 안내',
    body:
`안녕하세요 {{이름}}님,

{{이벤트명}} 을 다음과 같이 진행합니다.

  · 일정: {{시작일}} ~ {{종료일}}
  · 대상: {{대상}}
  · 혜택: {{혜택}}

자세한 내용은 아래에서 확인하실 수 있습니다.
{{상세링크}}

대무 (DAEMU)`,
    active: true,
  },
];

function ensureSeedTemplates() {
  const current = readTemplates();
  const existingNames = new Set(current.map((t) => (t.name || '').trim()));
  const toAdd = SEED_TEMPLATES.filter((t) => !existingNames.has(t.name));
  if (!toAdd.length) return current;
  const now = new Date().toISOString();
  let nid = nextId(current);
  const seeded = toAdd.map((t) => ({ ...t, id: nid++, createdAt: now, updatedAt: now }));
  const next = [...current, ...seeded];
  saveTemplates(next);
  return next;
}

// {{var_name}} 자리표시자 추출.
function extractVariables(text) {
  const set = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(text || ''))) set.add(m[1]);
  return [...set];
}
function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}/g,
    (_, name) => (vars && Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : '{{' + name + '}}'));
}

export default function AdminMailTemplates() {
  const [templates, setTemplates] = useState(() => ensureSeedTemplates());
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [activePreview, setActivePreview] = useState(null);

  useEffect(() => {
    const refresh = () => setTemplates(readTemplates());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return templates;
    return templates.filter((t) => t.category === filter);
  }, [templates, filter]);

  const upsert = (form) => {
    if (!form.name?.trim()) { alert('템플릿 이름을 입력하세요.'); return; }
    if (!form.subject?.trim()) { alert('메일 제목을 입력하세요.'); return; }
    const next = [...templates];
    const now = new Date().toISOString();
    if (form.id) {
      const i = next.findIndex((x) => x.id === form.id);
      if (i >= 0) next[i] = { ...next[i], ...form, updatedAt: now };
    } else {
      next.push({ ...form, id: nextId(next), createdAt: now, updatedAt: now });
    }
    setTemplates(next);
    saveTemplates(next);
    setEditing(null);
    setCreating(false);
  };

  const remove = (id) => {
    if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
    const next = templates.filter((x) => x.id !== id);
    setTemplates(next);
    saveTemplates(next);
  };

  const duplicate = (id) => {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const copy = { ...tpl, id: nextId(templates), name: tpl.name + ' (복사본)', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const next = [...templates, copy];
    setTemplates(next);
    saveTemplates(next);
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">메일 템플릿 라이브러리</h1>

          <AdminHelp title="메일 템플릿 사용 안내" items={[
            '여기서 저장한 템플릿은 단체 메일 발송, 캠페인, 1:1 안내 메일 등에서 재사용됩니다.',
            '본문에 {{이름}} 같은 자리표시자(variable)를 넣으면 발송 시 수신자별로 자동 치환됩니다.',
            '템플릿 카테고리(일반/뉴스레터/이벤트/파트너/회신)는 검색·필터에만 쓰이고 발송 동작에는 영향 없습니다.',
            '실제 메일 발송은 RESEND_API_KEY 가 백엔드에 등록되어 있을 때 진행됩니다. 미등록 상태에서는 모든 발송이 Outbox 에 simulated 로 기록됩니다.',
            '"상담 자동회신"(/admin/mail) 과는 다른 페이지입니다 — 자동회신은 별도 단일 템플릿으로 운영됩니다.',
          ]} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 18px' }}>
            <span className="adm-doc-pill" style={{ borderColor: '#6f6b68', color: '#6f6b68' }}>전체 {templates.length}</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }}>
              <option value="">전체 카테고리</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm" disabled={!templates.length}
              onClick={() => downloadCSV(
                'daemu-mail-templates-' + new Date().toISOString().slice(0, 10) + '.csv',
                templates,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'name', label: '이름' },
                  { key: (t) => CATEGORIES.find((c) => c.value === t.category)?.label || t.category, label: '카테고리' },
                  { key: 'subject', label: '제목' },
                  { key: (t) => extractVariables(t.subject + ' ' + t.body).join(' | '), label: '변수' },
                  { key: 'updatedAt', label: '수정일' },
                ],
              )}>CSV 내보내기</button>
            <button type="button" className="btn" onClick={() => setCreating(true)}>+ 새 템플릿</button>
          </div>

          {!filtered.length ? (
            <div className="adm-doc-empty">
              <strong>저장된 템플릿이 없습니다</strong>
              상단 <em>+ 새 템플릿</em> 으로 첫 메일 템플릿을 만들어보세요.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {filtered.map((t) => {
                const vars = extractVariables(t.subject + ' ' + t.body);
                return (
                  <div key={t.id} style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '16px 20px' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span className="adm-doc-pill" style={{ borderColor: '#1f5e7c', color: '#1f5e7c', fontSize: 10 }}>
                            {CATEGORIES.find((c) => c.value === t.category)?.label || '일반'}
                          </span>
                          <strong style={{ fontSize: 14, color: '#231815' }}>{t.name}</strong>
                        </div>
                        <div style={{ fontSize: 12, color: '#5a534b', marginBottom: 4 }}>
                          <strong style={{ color: '#8c867d', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', marginRight: 6 }}>제목</strong>
                          {t.subject}
                        </div>
                        {vars.length > 0 && (
                          <div style={{ fontSize: 11, color: '#8c867d' }}>
                            <strong style={{ marginRight: 6 }}>변수:</strong>
                            {vars.map((v) => <code key={v} style={{ background: '#f6f4f0', padding: '2px 6px', marginRight: 4, fontSize: 10.5 }}>{`{{${v}}}`}</code>)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button type="button" className="adm-btn-sm" onClick={() => setActivePreview(t)}>미리보기</button>
                        <button type="button" className="adm-btn-sm" onClick={() => setEditing(t)}>수정</button>
                        <button type="button" className="adm-btn-sm" onClick={() => duplicate(t.id)}>복사</button>
                        <button type="button" className="adm-btn-sm danger" onClick={() => remove(t.id)}>삭제</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="admin-section-title" style={{ marginTop: 36 }}>단체 발송</h3>
          <BulkSendPanel templates={templates} />

          {(editing || creating) && (
            <TemplateEditor
              data={editing}
              onClose={() => { setEditing(null); setCreating(false); }}
              onSave={upsert}
            />
          )}
          {activePreview && (
            <TemplatePreviewModal template={activePreview} onClose={() => setActivePreview(null)} />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function TemplateEditor({ data, onClose, onSave }) {
  const [form, setForm] = useState({
    id: data?.id,
    name: data?.name || '',
    category: data?.category || 'general',
    subject: data?.subject || '',
    body: data?.body || '',
    active: data?.active !== false,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const vars = extractVariables(form.subject + ' ' + form.body);

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>{data ? '템플릿 수정' : '새 메일 템플릿'}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 10 }}>
            <Field label="템플릿 이름">
              <input type="text" value={form.name} onChange={set('name')} placeholder="예: 봄맞이 신메뉴 안내" required />
            </Field>
            <Field label="카테고리">
              <select value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="메일 제목">
            <input type="text" value={form.subject} onChange={set('subject')} placeholder="예: [대무] {{이름}}님께 신메뉴 소식" required />
          </Field>
          <Field label="본문">
            <textarea rows={12} value={form.body} onChange={set('body')}
              placeholder={'안녕하세요 {{이름}}님,\n\n대무가 새로 출시한 봄 메뉴를 소개드립니다.\n...\n\n대무 드림'}
              style={{ fontFamily: 'inherit', lineHeight: 1.7 }} />
          </Field>
          {vars.length > 0 && (
            <div style={{ fontSize: 12, color: '#5a534b', background: '#fff8ec', padding: 10, borderLeft: '3px solid #c9a25a' }}>
              <strong style={{ marginRight: 6 }}>인식된 변수:</strong>
              {vars.map((v) => <code key={v} style={{ background: '#fff', padding: '2px 8px', marginRight: 4, fontSize: 11 }}>{`{{${v}}}`}</code>)}
              <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>발송 시 수신자 데이터에서 자동 치환됩니다.</div>
            </div>
          )}
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={() => onSave(form)}>저장</button>
        </div>
      </div>
    </div>
  );
}

function TemplatePreviewModal({ template, onClose }) {
  const vars = extractVariables(template.subject + ' ' + template.body);
  const [sample, setSample] = useState(() => {
    const obj = {};
    vars.forEach((v) => { obj[v] = ''; });
    obj['이름'] = obj['이름'] || '홍길동';
    obj['name'] = obj['name'] || 'Hong Gildong';
    return obj;
  });
  const renderedSubject = applyVars(template.subject, sample);
  const renderedBody = applyVars(template.body, sample);

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>미리보기 — {template.name}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        {vars.length > 0 && (
          <div style={{ background: '#fff8ec', padding: 12, borderLeft: '3px solid #c9a25a', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>샘플 값</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {vars.map((v) => (
                <label key={v} style={{ fontSize: 12, color: '#5a534b' }}>
                  <span style={{ display: 'block', marginBottom: 2, fontFamily: 'monospace' }}>{`{{${v}}}`}</span>
                  <input type="text" value={sample[v] || ''}
                    onChange={(e) => setSample((s) => ({ ...s, [v]: e.target.value }))}
                    style={{ width: '100%' }} />
                </label>
              ))}
            </div>
          </div>
        )}
        <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 18 }}>
          <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>제목</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#231815', marginBottom: 14 }}>{renderedSubject}</div>
          <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>본문</div>
          <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 13.5, color: '#2a2724', lineHeight: 1.85, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>{renderedBody}</pre>
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function BulkSendPanel({ templates }) {
  const [templateId, setTemplateId] = useState('');
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const tpl = templates.find((t) => String(t.id) === String(templateId));
  const recipients = useMemo(() => {
    return recipientsRaw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  }, [recipientsRaw]);

  const send = async () => {
    if (!tpl) { alert('발송할 템플릿을 선택하세요.'); return; }
    if (!recipients.length) { alert('수신자 이메일을 1명 이상 입력하세요. (한 줄에 하나)'); return; }
    if (!confirm(`${recipients.length}명에게 "${tpl.name}" 템플릿으로 발송하시겠습니까?`)) return;
    setSending(true);
    setResult(null);
    try {
      // 백엔드 미연결이면 client-side simulation 만 — 이메일은 Outbox 에 기록.
      // 백엔드 연결 후엔 /api/admin/mail/send-bulk 사용.
      if (api.isConfigured()) {
        const r = await api.post('/api/admin/mail/send-bulk', {
          template: { subject: tpl.subject, body: tpl.body },
          recipients: recipients.map((email) => ({ email, vars: {} })),
        });
        setResult({ ok: !!r.ok, sent: r.sent || 0, failed: r.failed || 0, error: r.error });
      } else {
        // simulated
        for (const email of recipients) {
          // logOutbox 는 api.js 내부 함수 — 직접 호출 대신 outbox 직접 기록.
          try {
            const log = JSON.parse(localStorage.getItem('daemu_outbox') || '[]');
            log.unshift({
              id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              ts: new Date().toISOString(),
              path: '/api/admin/mail/send-bulk',
              body: { to: email, subject: tpl.subject, body: tpl.body },
              status: 'simulated',
            });
            localStorage.setItem('daemu_outbox', JSON.stringify(log.slice(0, 200)));
          } catch { /* ignore */ }
        }
        window.dispatchEvent(new Event('daemu-db-change'));
        setResult({ ok: true, sent: recipients.length, failed: 0, simulated: true });
      }
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 20 }}>
      {!isEmailEnabled() && (
        <p style={{ fontSize: 12, color: '#b87333', margin: '0 0 12px', background: '#fff8ec', padding: '8px 12px', borderLeft: '3px solid #c9a25a' }}>
          백엔드 이메일이 미설정 상태입니다 — 발송은 Outbox 에 simulated 로만 기록됩니다.
          RESEND_API_KEY 등록 후 실제 발송이 활성화됩니다.
        </p>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="템플릿 선택">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— 템플릿을 선택하세요 —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                [{CATEGORIES.find((c) => c.value === t.category)?.label || t.category}] {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`수신자 이메일 (한 줄에 하나, 또는 쉼표로 구분) — ${recipients.length}명 인식`}>
          <textarea rows={5} value={recipientsRaw} onChange={(e) => setRecipientsRaw(e.target.value)}
            placeholder="customer1@example.com&#10;customer2@example.com&#10;..." />
        </Field>
        {tpl && (
          <div style={{ background: '#f6f4f0', padding: 12, fontSize: 12, color: '#5a534b' }}>
            <strong>발송 미리보기 (첫 1명):</strong> {tpl.subject} → {recipients[0] || '(수신자 없음)'}
          </div>
        )}
        <div className="adm-action-row" style={{ borderTop: 'none', paddingTop: 0 }}>
          <button type="button" className="btn" disabled={sending || !tpl || !recipients.length} onClick={send}>
            {sending ? '발송 중…' : `${recipients.length}명에게 발송`}
          </button>
        </div>
        {result && (
          <div style={{
            background: result.ok ? '#eef6ee' : '#fff0ec',
            border: '1px solid ' + (result.ok ? '#cfe5cf' : '#f0c4c0'),
            padding: '12px 16px', fontSize: 13, color: result.ok ? '#2e7d32' : '#c0392b',
          }}>
            {result.ok
              ? `발송 완료 — ${result.sent}명 성공${result.failed ? `, ${result.failed}명 실패` : ''}${result.simulated ? ' (시뮬레이션 모드)' : ''}`
              : `발송 실패 — ${result.error || '알 수 없는 오류'}`}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="adm-inline-field" style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
