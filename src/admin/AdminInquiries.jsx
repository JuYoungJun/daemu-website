// 상담/문의 관리 — backend (POST /api/inquiries) 와 연동되는 React 페이지.
//
// 이전 버전은 RawPage로 public/admin-inquiries-page.js (전역 스크립트)를
// 동적 로드하면서 window.api/window.DB에 의존했는데:
//   1) globals.js가 dynamic-import이라 raw script보다 늦게 평가될 수 있음
//      → window.api가 undefined → backend 호출 자체가 안 됨
//   2) 빌드 시 VITE_API_BASE_URL이 비어있으면 backend가 "none"으로 인식
//      → 모든 admin 동작이 localStorage 기반으로만 작동
// 두 케이스 모두 사용자가 보고한 "수정/삭제 안 됨" 증상의 원인이었습니다.
//
// 이 컴포넌트는 lib/api.js를 직접 import하므로 두 케이스 모두에서 안정적이며
// 백엔드 미연결(api.isConfigured() === false) 상태에서도 localStorage로
// fallback 동작합니다.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';
import { DB } from '../lib/db.js';
import { sendAdminReply, isEmailEnabled } from '../lib/email.js';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm } from '../lib/dialog.js';
import { formatPhone, normalizeEmail } from '../lib/inputFormat.js';
import InquiriesGuide from './InquiriesGuide.jsx';
import { PageActions, GuideButton, RawPageCsvButton } from './PageGuides.jsx';

const STORAGE_KEY = 'inquiries';

const STATUS_OPTIONS = ['신규', '처리중', '답변완료'];
const STATUS_FROM_API = { new: '신규', pending: '처리중', replied: '답변완료' };
const STATUS_TO_API = { 신규: 'new', 처리중: 'pending', 답변완료: 'replied' };

const TYPE_OPTIONS = [
  '창업 컨설팅', '메뉴 개발', '브랜드 디자인',
  '인테리어/공간 설계', '원두/베이커리 납품', '기타 문의',
];

function adaptFromBackend(it) {
  return {
    id: it.id,
    name: it.name || '',
    phone: it.phone || '',
    email: it.email || '',
    type: it.category || '',
    status: STATUS_FROM_API[it.status] || it.status || '신규',
    open: it.expected_open || '',
    brand: it.brand_name || '',
    region: it.location || '',
    msg: it.message || '',
    reply: it.note || '',
    date: it.created_at ? new Date(it.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '',
    _backend: true,
  };
}

const STATUS_PILL_COLOR = { 신규: '#c0392b', 처리중: '#b87333', 답변완료: '#2e7d32' };

export default function AdminInquiries() {
  const [items, setItems] = useState(() => DB.get(STORAGE_KEY) || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const reload = async () => {
    setLoading(true); setError('');
    try {
      if (api.isConfigured()) {
        const r = await api.get('/api/inquiries?page=1&page_size=500');
        if (r.ok && Array.isArray(r.items)) {
          const mapped = r.items.map(adaptFromBackend);
          if (mapped.length > 0) {
            // 백엔드에 데이터 있음 — 신뢰하고 사용 + 캐시 동기화.
            DB.set(STORAGE_KEY, mapped);
            setItems(mapped);
          } else {
            // 백엔드는 비어있지만 로컬 캐시에 데이터가 있을 수 있음.
            // Render free tier 에서 SQLite 가 휘발 후 첫 부팅 시 자주 발생.
            // 사용자가 새로고침할 때 이미 보고 있던 데이터가 사라지는 것을
            // 막기 위해 로컬 캐시를 fallback 으로 표시.
            const local = DB.get(STORAGE_KEY) || [];
            if (local.length > 0) {
              setItems(local);
              setError('백엔드에 문의 데이터가 비어있어 로컬 캐시를 표시합니다. (Render 무료 tier SQLite 가 재시작 시 휘발됩니다.)');
            } else {
              setItems([]);
            }
          }
        } else {
          setError(r.error || '백엔드에서 문의 목록을 불러올 수 없습니다.');
          setItems(DB.get(STORAGE_KEY) || []);
        }
      } else {
        setItems(DB.get(STORAGE_KEY) || []);
      }
    } catch (e) {
      setError(String(e));
      setItems(DB.get(STORAGE_KEY) || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-line */ }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((d) =>
      (!q || ((d.name || '') + ' ' + (d.email || '') + ' ' + (d.msg || '')).toLowerCase().includes(q))
      && (!filterStatus || d.status === filterStatus)
      && (!filterType || d.type === filterType)
    );
  }, [items, search, filterStatus, filterType]);

  const counts = useMemo(() => ({
    total: items.length,
    new: items.filter((d) => d.status === '신규').length,
    pending: items.filter((d) => d.status === '처리중').length,
    done: items.filter((d) => d.status === '답변완료').length,
  }), [items]);

  const updateStatus = async (id, status) => {
    const target = items.find((x) => x.id === id);
    if (!target) return;
    setItems((prev) => prev.map((x) => x.id === id ? { ...x, status } : x));
    DB.update(STORAGE_KEY, id, { status });

    if (target._backend && api.isConfigured()) {
      const r = await api.patch('/api/inquiries/' + id, {
        status: STATUS_TO_API[status] || status,
        replied: status === '답변완료',
      });
      if (!r.ok) {
        siteAlert('백엔드 동기화 실패: ' + (r.error || ''));
        setItems((prev) => prev.map((x) => x.id === id ? { ...x, status: target.status } : x));
        DB.update(STORAGE_KEY, id, { status: target.status });
        return;
      }
    }

    if (status === '답변완료' && target.email && target.reply && target.reply.trim() && isEmailEnabled()) {
      if (await siteConfirm('회신 메모 내용을 ' + target.email + ' 로 발송할까요?')) {
        try {
          const r = await sendAdminReply({
            to_email: target.email,
            to_name: target.name,
            subject: '[대무] 문의 회신',
            body: target.reply,
          });
          siteAlert(r.ok ? '회신 메일 발송 완료' : '메일 발송 실패: ' + (r.error || r.reason || ''));
        } catch (err) {
          siteAlert('메일 발송 실패: ' + err);
        }
      }
    }
  };

  const remove = async (id) => {
    if (!(await siteConfirm('이 문의를 삭제하시겠습니까?'))) return;
    const target = items.find((x) => x.id === id);
    if (!target) return;

    if (target._backend && api.isConfigured()) {
      const r = await api.del('/api/inquiries/' + id);
      if (!r.ok && r.status !== 204) {
        siteAlert('백엔드 삭제 실패: ' + (r.error || ''));
        return;
      }
    }
    DB.del(STORAGE_KEY, id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const saveEdit = async (form) => {
    if (!form.name?.trim()) { siteAlert('이름을 입력하세요.'); return; }
    if (form.id) {
      const target = items.find((x) => x.id === form.id);
      const next = { ...target, ...form };
      setItems((prev) => prev.map((x) => x.id === form.id ? next : x));
      DB.update(STORAGE_KEY, form.id, form);
      if (target?._backend && api.isConfigured()) {
        const r = await api.patch('/api/inquiries/' + form.id, {
          status: STATUS_TO_API[form.status] || form.status,
          note: form.reply,
          replied: form.status === '답변완료',
        });
        if (!r.ok) siteAlert('백엔드 동기화 실패: ' + (r.error || ''));
      }
    } else {
      const newRow = DB.add(STORAGE_KEY, form);
      setItems((prev) => [newRow, ...prev]);
    }
    setEditing(null);
    setCreating(false);
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">상담/문의</h1>

          <PageActions>
            <button type="button" className="adm-page-action-btn adm-page-action-btn--csv"
              onClick={() => downloadCSV(
                'daemu-inquiries-' + new Date().toISOString().slice(0, 10) + '.csv',
                filtered,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'name', label: '이름' },
                  { key: 'phone', label: '연락처' },
                  { key: 'email', label: '이메일' },
                  { key: 'type', label: '카테고리' },
                  { key: 'status', label: '상태' },
                  { key: 'open', label: '오픈시기' },
                  { key: 'brand', label: '브랜드' },
                  { key: 'region', label: '지역' },
                  { key: 'msg', label: '문의내용' },
                  { key: 'reply', label: '회신메모' },
                  { key: 'date', label: '접수일' },
                ],
              )}>
              CSV 내보내기
            </button>
            <GuideButton GuideComponent={InquiriesGuide} />
          </PageActions>

          <AdminHelp title="상담관리 사용 안내" items={[
            'Contact 폼에서 들어온 문의는 자동으로 여기에 표시됩니다.',
            '상태 변경(신규→처리중→답변완료)은 즉시 백엔드에 동기화됩니다.',
            '"답변완료"로 변경하면, 회신 메모가 입력되어 있고 이메일 발송이 활성화된 경우 회신 메일 발송 여부를 확인합니다.',
            '회신 메모만 저장하고 발송은 별도로 진행하려면 "수정" → 회신메모 입력 → 저장 → 상태는 그대로 두세요.',
            '새로고침 버튼: 백엔드에서 최신 데이터를 다시 가져옵니다.',
          ]} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 18px' }}>
            <span className="adm-doc-pill" style={{ borderColor: '#6f6b68', color: '#6f6b68' }}>전체 {counts.total}</span>
            <span className="adm-doc-pill" style={{ borderColor: STATUS_PILL_COLOR['신규'], color: STATUS_PILL_COLOR['신규'] }}>신규 {counts.new}</span>
            <span className="adm-doc-pill" style={{ borderColor: STATUS_PILL_COLOR['처리중'], color: STATUS_PILL_COLOR['처리중'] }}>처리중 {counts.pending}</span>
            <span className="adm-doc-pill" style={{ borderColor: STATUS_PILL_COLOR['답변완료'], color: STATUS_PILL_COLOR['답변완료'] }}>답변완료 {counts.done}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm" onClick={reload} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button>
            <button type="button" className="btn" onClick={() => setCreating(true)}>+ 새 문의(메모)</button>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <input type="search" placeholder="이름·이메일·내용 검색" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: '8px 12px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }} />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }}>
              <option value="">전체 상태</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }}>
              <option value="">전체 카테고리</option>
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ fontSize: 11, color: '#8c867d' }}>{filtered.length}건</span>
          </div>

          {error && <p style={{ color: '#c0392b', fontSize: 12, marginBottom: 12 }}>{error}</p>}

          {!filtered.length ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c867d', background: '#fff', border: '1px dashed #d7d4cf' }}>
              <p>{loading ? '불러오는 중…' : '조건에 맞는 문의가 없습니다.'}</p>
              {!api.isConfigured() && (
                <p style={{ fontSize: 12, marginTop: 6, color: '#b87333' }}>
                  백엔드 미연결 상태 — 빌드 환경변수 <code>VITE_API_BASE_URL</code> 등록 후 사이트 재배포가 필요합니다.
                </p>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>연락처</th>
                    <th>이메일</th>
                    <th>카테고리</th>
                    <th>접수일</th>
                    <th>상태</th>
                    <th className="col-actions" style={{ minWidth: 220 }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.id}>
                      <td data-label="이름">{d.name}</td>
                      <td data-label="연락처">{d.phone || '-'}</td>
                      <td data-label="이메일">{d.email || '-'}</td>
                      <td data-label="카테고리">{d.type || '-'}</td>
                      <td data-label="접수일">{d.date}</td>
                      <td data-label="상태">
                        <select value={d.status} onChange={(e) => updateStatus(d.id, e.target.value)}
                          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d7d4cf', background: '#fff' }}>
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td data-label="관리" className="col-actions">
                        <button type="button" className="adm-btn-sm" onClick={() => setEditing(d)}>수정</button>
                        <button type="button" className="adm-btn-sm danger" onClick={() => remove(d.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(editing || creating) && (
            <InquiryEditor
              data={editing}
              onClose={() => { setEditing(null); setCreating(false); }}
              onSave={saveEdit}
            />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function InquiryEditor({ data, onClose, onSave }) {
  const [form, setForm] = useState({
    id: data?.id,
    name: data?.name || '',
    phone: data?.phone || '',
    email: data?.email || '',
    type: data?.type || '창업 컨설팅',
    status: data?.status || '신규',
    open: data?.open || '',
    msg: data?.msg || '',
    reply: data?.reply || '',
  });
  const set = (k) => (e) => {
    const raw = e.target.value;
    const v = k === 'phone' ? formatPhone(raw)
            : k === 'email' ? raw.replace(/\s/g, '')
            : raw;
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-narrow">
        <div className="adm-modal-head">
          <h2>{data ? '문의 수정' : '새 문의 메모'}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="이름"><input type="text" value={form.name} onChange={set('name')} required /></Field>
          <Field label="연락처"><input type="tel" inputMode="numeric" maxLength={13} placeholder="010-1234-5678" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="이메일"><input type="email" inputMode="email" value={form.email} onChange={set('email')} onBlur={() => setForm((f) => ({ ...f, email: normalizeEmail(f.email) }))} /></Field>
          <Field label="카테고리">
            <select value={form.type} onChange={set('type')}>
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="상태">
            <select value={form.status} onChange={set('status')}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="오픈 시기"><input type="text" value={form.open} onChange={set('open')} placeholder="예: 2026 봄" /></Field>
          <Field label="문의 내용"><textarea rows={4} value={form.msg} onChange={set('msg')} /></Field>
          <Field label="회신 메모">
            <textarea rows={3} value={form.reply} onChange={set('reply')} placeholder="고객에게 발송할 회신 본문 또는 내부 메모" />
          </Field>
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={() => onSave(form)}>저장</button>
        </div>
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
