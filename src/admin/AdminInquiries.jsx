// 상담/문의 관리 — backend Aiven (`/api/inquiries`) 가 source of truth.
// 정책 (2026-05): localStorage 직접 read/write 없음. React state 로 backend
// 응답을 보관하고, 모든 mutation 후 backend 에서 다시 fetch.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';
import { sendAdminReply, isEmailEnabled } from '../lib/email.js';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm } from '../lib/dialog.js';
import { formatPhone, normalizeEmail } from '../lib/inputFormat.js';
import InquiriesGuide from './InquiriesGuide.jsx';
import LastSyncBadge from '../components/LastSyncBadge.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';

// localStorage 캐시 키 — backend 가 source-of-truth 가 된 후로 미사용.
// 추후 admin offline 모드 도입 시 복원 예정.
const _STORAGE_KEY = 'inquiries';

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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const reload = async () => {
    setLoading(true); setError('');
    try {
      if (!api.isConfigured()) {
        setItems([]);
        setError('백엔드가 연결되어 있지 않습니다.');
        return;
      }
      const r = await api.get('/api/inquiries?page=1&page_size=500');
      if (r.ok && Array.isArray(r.items)) {
        setItems(r.items.map(adaptFromBackend));
        setLastSyncAt(Date.now());
      } else {
        setError(r.error || '백엔드에서 문의 목록을 불러올 수 없습니다.');
        setItems([]);
      }
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // 자동 최신화 (near real-time):
  //   · mount 시 1회
  //   · 같은 탭 내 다른 admin 화면 mutation → daemu-db-change 즉시 갱신
  //   · 백그라운드 갔다가 visible 복귀 시 즉시 갱신
  //   · visible 일 때만 15초 주기 폴링 (사용자 요청 실시간성 강화, 옛 60s)
  // 백엔드 source of truth — 옛 localStorage 캐시 의존 없음.
  useEffect(() => {
    let alive = true;
    reload();
    const onChange = () => { if (alive) reload(); };
    window.addEventListener('daemu-db-change', onChange);
    const id = setInterval(() => {
      if (alive && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        reload();
      }
    }, 15_000);
    const onVis = () => {
      if (alive && typeof document !== 'undefined' && !document.hidden) reload();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.removeEventListener('daemu-db-change', onChange);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

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
    if (!target._backend || !api.isConfigured()) {
      siteAlert('백엔드 행이 아니거나 백엔드 미연결 — 상태 변경 불가.');
      return;
    }
    const r = await api.patch('/api/inquiries/' + id, {
      status: STATUS_TO_API[status] || status,
      replied: status === '답변완료',
    });
    if (!r.ok) {
      siteAlert('서버 상태 변경에 실패했습니다: ' + (r.error || ('HTTP ' + (r.status || 0))));
      return;
    }
    // 즉시 화면 반영 — backend 200 직후 사용자가 round-trip 을 기다리지 않음.
    setItems((prev) => prev.map((x) => x.id === id ? { ...x, status, replied: status === '답변완료' } : x));
    // background 검증 — 다음 cycle 에서 backend 응답으로 정정 (await 안 함).
    reload();

    if (status === '답변완료' && target.email && target.reply && target.reply.trim() && isEmailEnabled()) {
      if (await siteConfirm('회신 메모 내용을 ' + target.email + ' 로 발송할까요?')) {
        try {
          const mr = await sendAdminReply({
            to_email: target.email,
            to_name: target.name,
            subject: '[대무] 문의 회신',
            body: target.reply,
          });
          siteAlert(mr.ok ? '회신 메일 발송 완료' : '메일 발송 실패: ' + (mr.error || mr.reason || ''));
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
    if (!target._backend || !api.isConfigured()) {
      siteAlert('백엔드 행이 아니거나 백엔드 미연결 — 삭제 불가.');
      return;
    }
    const r = await api.del('/api/inquiries/' + id);
    if (!r.ok && r.status !== 204) {
      siteAlert('서버 삭제에 실패했습니다: ' + (r.error || ('HTTP ' + (r.status || 0))));
      return;
    }
    // 즉시 화면에서 행 제거 — refetch round-trip 대기 없이 UI 반응.
    setItems((prev) => prev.filter((x) => x.id !== id));
    reload();
  };

  const saveEdit = async (form) => {
    if (!form.name?.trim()) { siteAlert('이름을 입력하세요.'); return; }
    if (!api.isConfigured()) { siteAlert('백엔드가 연결되어 있지 않습니다.'); return; }
    if (form.id) {
      const target = items.find((x) => x.id === form.id);
      if (!target?._backend) { siteAlert('백엔드 행이 아닙니다.'); return; }
      const r = await api.patch('/api/inquiries/' + form.id, {
        status: STATUS_TO_API[form.status] || form.status,
        note: form.reply,
        replied: form.status === '답변완료',
      });
      if (!r.ok) {
        siteAlert('서버 저장에 실패했습니다: ' + (r.error || ('HTTP ' + (r.status || 0))));
        return;
      }
    } else {
      // 어드민 측 직접 신규 등록 — backend `POST /api/inquiries` 공개 라우트 사용.
      const r = await api.post('/api/inquiries', {
        name: form.name || '',
        phone: form.phone || '',
        email: form.email || '',
        category: form.type || '',
        message: form.msg || '',
        privacy_consent: true,
      }, { skipAuth: true });
      if (!r || !r.ok) {
        siteAlert('서버 저장에 실패했습니다: ' + (r && (r.error || ('HTTP ' + r.status))));
        return;
      }
    }
    // 즉시 modal 닫기 + reload 는 background — 사용자가 즉시 결과를 본다.
    setEditing(null);
    setCreating(false);
    reload();
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>상담/문의</h1>
            <LastSyncBadge loading={loading} lastSyncAt={lastSyncAt} error={error} label="문의" />
          </div>

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
