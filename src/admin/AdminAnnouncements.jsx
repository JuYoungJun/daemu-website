// 공지 / 프로모션 관리 — 어드민에서 작성, 공개 사이트 또는 파트너 포털에 노출.
// backend endpoint:
//   GET  /api/announcements?include_inactive=1
//   POST /api/announcements   { title, body, kind, target, active, scheduled_start, scheduled_end, image_url, cta_label, cta_href }
//   PATCH /api/announcements/{id}
//   DELETE /api/announcements/{id}
//   GET  /api/announcements/visible?target=public|partner_portal|all  (공개 호출용)

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';
import { api } from '../lib/api.js';
import { siteAlert, siteConfirm, siteToast } from '../lib/dialog.js';
import { downloadCSV } from '../lib/csv.js';

const KIND_OPTIONS = [
  { value: 'notice', label: '공지' },
  { value: 'promo', label: '프로모션' },
  { value: 'urgent', label: '긴급' },
];
const TARGET_OPTIONS = [
  { value: 'all', label: '공개 + 파트너 포털' },
  { value: 'public', label: '공개 사이트만' },
  { value: 'partner_portal', label: '파트너 포털만' },
];

const EMPTY = {
  title: '', body: '', kind: 'notice', target: 'all', active: true,
  scheduled_start: '', scheduled_end: '', image_url: '', cta_label: '', cta_href: '',
};

function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }); }
  catch { return String(s); }
}

export default function AdminAnnouncements() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    setLoading(true);
    const r = await api.get('/api/announcements?include_inactive=1');
    setLoading(false);
    if (!r.ok) { siteAlert(r.error || '불러오기 실패'); return; }
    setItems(r.items || []);
  };
  useEffect(() => { load(); }, []);

  const onSave = async () => {
    if (!form.title.trim()) { siteAlert('제목을 입력하세요.'); return; }
    const body = { ...form, title: form.title.trim() };
    const r = editing
      ? await api.patch(`/api/announcements/${editing}`, body)
      : await api.post('/api/announcements', body);
    if (!r.ok) { siteAlert(r.error || '저장 실패'); return; }
    siteToast(editing ? '수정 완료' : '등록 완료', { tone: 'success' });
    setEditing(null); setForm(EMPTY);
    await load();
  };

  const onEdit = (a) => {
    setEditing(a.id);
    setForm({
      title: a.title || '', body: a.body || '', kind: a.kind || 'notice',
      target: a.target || 'all', active: !!a.active,
      scheduled_start: a.scheduled_start ? a.scheduled_start.slice(0, 16) : '',
      scheduled_end: a.scheduled_end ? a.scheduled_end.slice(0, 16) : '',
      image_url: a.image_url || '', cta_label: a.cta_label || '', cta_href: a.cta_href || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onCancel = () => { setEditing(null); setForm(EMPTY); };

  const onDelete = async (id) => {
    if (!(await siteConfirm('영구 삭제하시겠습니까?'))) return;
    const r = await api.del(`/api/announcements/${id}`);
    if (r.ok || r.status === 204) {
      siteToast('삭제 완료', { tone: 'success' });
      await load();
    } else siteAlert(r.error || '삭제 실패');
  };

  const onToggleActive = async (a) => {
    const r = await api.patch(`/api/announcements/${a.id}`, { active: !a.active });
    if (!r.ok) { siteAlert(r.error || '변경 실패'); return; }
    await load();
  };

  const stats = useMemo(() => {
    const now = new Date();
    return {
      total: items.length,
      active: items.filter(a => a.active).length,
      live: items.filter(a => a.active && (!a.scheduled_start || new Date(a.scheduled_start) <= now)
        && (!a.scheduled_end || new Date(a.scheduled_end) >= now)).length,
    };
  }, [items]);

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">공지 / 프로모션 관리</h1>

          <PageActions>
            <button type="button" className="adm-page-action-btn adm-page-action-btn--csv"
              onClick={() => downloadCSV(
                'daemu-announcements-' + new Date().toISOString().slice(0, 10) + '.csv',
                items,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'title', label: '제목' },
                  { key: 'kind', label: '종류' },
                  { key: 'target', label: '대상' },
                  { key: (a) => a.active ? '활성' : '비활성', label: '활성' },
                  { key: 'scheduled_start', label: '시작' },
                  { key: 'scheduled_end', label: '종료' },
                  { key: 'cta_label', label: 'CTA' },
                  { key: 'cta_href', label: 'CTA URL' },
                  { key: 'created_at', label: '작성일' },
                ],
              )}>
              CSV 내보내기
            </button>
            <GuideButton GuideComponent={AnnouncementsGuide} />
          </PageActions>

          <AdminHelp title="공지·프로모션 작성 안내" items={[
            '"공개 사이트" 대상은 메인 페이지 상단 띠배너 또는 home 의 공지 카드로 노출됩니다.',
            '"파트너 포털" 대상은 파트너 로그인 후 보이는 알림 영역에 표시됩니다.',
            '시작/종료 일시 비워두면 즉시 노출 + 만료 없음. 둘 다 채우면 그 기간 동안만 노출.',
            '활성 토글이 OFF 면 노출 안 됨 (스케줄 무관).',
            'CTA 라벨/URL 채우면 본문 하단에 버튼 형태로 표시 — 외부 링크는 https:// 부터.',
            'kind=urgent 는 색상이 빨간색으로 강조됩니다.',
          ]} />

          {/* 작성/수정 폼 */}
          <h3 className="admin-section-title" style={{ marginTop: 24 }}>
            {editing ? `수정 (id=${editing})` : '신규 작성'}
          </h3>
          <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
            <Row>
              <Field label="종류">
                <select value={form.kind} onChange={(e) => setForm(f => ({ ...f, kind: e.target.value }))} style={inputStyle}>
                  {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="노출 대상">
                <select value={form.target} onChange={(e) => setForm(f => ({ ...f, target: e.target.value }))} style={inputStyle}>
                  {TARGET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="활성">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36 }}>
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))} />
                  <span>{form.active ? '활성' : '비활성'}</span>
                </label>
              </Field>
            </Row>
            <Field label="제목 *">
              <input type="text" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} style={inputStyle} maxLength={120} />
            </Field>
            <Field label="본문">
              <textarea value={form.body} onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }} maxLength={5000} />
            </Field>
            <Row>
              <Field label="시작 일시 (선택)">
                <input type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm(f => ({ ...f, scheduled_start: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="종료 일시 (선택)">
                <input type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm(f => ({ ...f, scheduled_end: e.target.value }))} style={inputStyle} />
              </Field>
            </Row>
            <Field label="이미지 URL (선택)">
              <input type="url" value={form.image_url} onChange={(e) => setForm(f => ({ ...f, image_url: e.target.value }))} style={inputStyle} placeholder="https://..." />
            </Field>
            <Row>
              <Field label="CTA 라벨 (선택)">
                <input type="text" value={form.cta_label} onChange={(e) => setForm(f => ({ ...f, cta_label: e.target.value }))} style={inputStyle} maxLength={40} />
              </Field>
              <Field label="CTA URL (선택)">
                <input type="url" value={form.cta_href} onChange={(e) => setForm(f => ({ ...f, cta_href: e.target.value }))} style={inputStyle} placeholder="https://..." />
              </Field>
            </Row>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn" onClick={onSave}>{editing ? '수정 저장' : '등록'}</button>
              {editing && <button type="button" className="adm-btn-sm" onClick={onCancel}>취소</button>}
            </div>
          </div>

          {/* 목록 */}
          <h3 className="admin-section-title">
            등록된 공지·프로모션 ({stats.total}) <span style={{ fontSize: 11, color: '#8c867d', fontWeight: 400 }}>활성 {stats.active} · 현재 노출 중 {stats.live}</span>
          </h3>
          {loading ? (
            <div style={{ padding: '24px 12px', color: '#8c867d', fontSize: 13 }}>불러오는 중…</div>
          ) : !items.length ? (
            <div className="adm-doc-empty" style={{ padding: '24px 16px' }}>
              <strong>등록된 공지·프로모션이 없습니다</strong>
              상단 폼에서 첫 번째 공지를 작성해 보세요.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>
                    <th style={th}>제목</th>
                    <th style={th}>종류</th>
                    <th style={th}>대상</th>
                    <th style={th}>상태</th>
                    <th style={th}>기간</th>
                    <th style={th}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const kindLabel = KIND_OPTIONS.find(o => o.value === a.kind)?.label || a.kind;
                    const targetLabel = TARGET_OPTIONS.find(o => o.value === a.target)?.label || a.target;
                    const isUrgent = a.kind === 'urgent';
                    return (
                      <tr key={a.id} style={{ borderBottom: '1px solid #e6e3dd' }}>
                        <td style={td}>
                          <strong style={{ color: isUrgent ? '#c0392b' : '#231815' }}>{a.title}</strong>
                          {a.body && <div style={{ fontSize: 11, color: '#8c867d', marginTop: 2 }}>{(a.body || '').slice(0, 80)}{(a.body || '').length > 80 ? '…' : ''}</div>}
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3, background: isUrgent ? '#fce4e4' : '#f6f4f0', color: isUrgent ? '#c0392b' : '#5a534b' }}>
                            {kindLabel}
                          </span>
                        </td>
                        <td style={{ ...td, fontSize: 11.5, color: '#5a534b' }}>{targetLabel}</td>
                        <td style={td}>
                          <button type="button" className="adm-btn-sm" onClick={() => onToggleActive(a)}>
                            {a.active ? <span style={{ color: '#2e7d32' }}>활성</span> : <span style={{ color: '#8c867d' }}>비활성</span>}
                          </button>
                        </td>
                        <td style={{ ...td, fontSize: 11, color: '#5a534b' }}>
                          {a.scheduled_start || a.scheduled_end ? (
                            <>
                              {a.scheduled_start ? fmtDate(a.scheduled_start) : '즉시'}
                              <br />~ {a.scheduled_end ? fmtDate(a.scheduled_end) : '무기한'}
                            </>
                          ) : <span style={{ color: '#b9b5ae' }}>제한 없음</span>}
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button type="button" className="adm-btn-sm" onClick={() => onEdit(a)}>수정</button>
                            <button type="button" className="adm-btn-sm danger" onClick={() => onDelete(a.id)}>삭제</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function Row({ children }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>{children}</div>; }
function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #d7d4cf', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 11, letterSpacing: '.08em', color: '#5a534b', fontWeight: 600 };
const td = { padding: '10px', verticalAlign: 'top' };

function AnnouncementsGuide({ onClose }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog">
      <div className="adm-modal-box">
        <div className="adm-modal-head">
          <h2>공지·프로모션 — 사용 가이드</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: '#5a534b' }}>
          <h3 style={{ fontSize: 14, marginTop: 12 }}>이 페이지는 어떤 곳인가요?</h3>
          <p>사이트 상단 띠배너, 메인 카드, 파트너 포털의 공지를 한 곳에서 관리합니다.</p>
          <h3 style={{ fontSize: 14, marginTop: 12 }}>3단계 흐름</h3>
          <ol style={{ paddingLeft: 18 }}>
            <li>종류(공지/프로모션/긴급) + 노출 대상(공개/파트너/둘 다) + 활성 여부 선택</li>
            <li>제목과 본문 작성, 필요시 시작/종료 일시 + 이미지/CTA 추가</li>
            <li>등록 후 목록에서 활성 토글로 즉시 노출/숨김 제어</li>
          </ol>
          <h3 style={{ fontSize: 14, marginTop: 12 }}>주의</h3>
          <ul style={{ paddingLeft: 18 }}>
            <li>kind=urgent 는 빨간색으로 표시됩니다 — 진짜 긴급할 때만 사용.</li>
            <li>CTA URL 외부 링크는 반드시 https:// 부터 입력.</li>
            <li>스케줄을 미래로 잡으면 그때까지 활성이어도 노출되지 않습니다.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
