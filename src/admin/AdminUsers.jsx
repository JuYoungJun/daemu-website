// 사용자 권한 관리 — 어드민 계정 CRUD + 보안 작업.
//
// 기능 요약:
//   - KPI 4종 (전체/활성/관리자/대기)
//   - 검색 (이메일·이름) + 권한·상태 필터 + 정렬
//   - 행 클릭 → 상세 모달 (보안 상태 7항목 + 액션 버튼들)
//   - 액션:
//       · 권한·활성 변경 (인라인)
//       · 비밀번호 리셋 (must_change_password=true 강제)
//       · 이메일 인증 재요구 (email_verified_at=null)
//       · 2FA 강제 해제 (디바이스 분실 시)
//       · 계정 삭제
//   - bulk: 선택 비활성화 / 삭제
//   - CSV 내보내기

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell.jsx';
import { api } from '../lib/api.js';
import { Auth } from '../lib/auth.js';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm, sitePrompt } from '../lib/dialog.js';
import { normalizeEmail } from '../lib/inputFormat.js';
import UsersGuide from './UsersGuide.jsx';

const ROLE_LABEL = { admin: '슈퍼 관리자', tester: '서브 관리자', developer: '개발자' };
const ROLE_COLOR = { admin: '#c0392b', tester: '#1f5e7c', developer: '#b87333' };
const ROLE_DESC = {
  admin: '전체 권한. 사용자·고객·파트너·CRM·계약·시스템 설정까지 모두 접근.',
  tester: '서브 관리자 — 대부분 읽기 전용. 팝업 등록·문의 모니터링 가능. 사용자·시스템 설정 차단.',
  developer: '개발자 — 작업사례·팝업·메일템플릿·콘텐츠 관리. 고객 PII 차단.',
};

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ko'); } catch { return iso; }
}
function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export default function AdminUsers() {
  const me = Auth.user();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'tester' });
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState('id'); // id | email | last_login
  const [showGuide, setShowGuide] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [detail, setDetail] = useState(null); // user object or null

  const isAdmin = me?.role === 'admin';

  async function load() {
    if (!api.isConfigured()) {
      setError('백엔드 미연결 — 사용자 관리는 백엔드가 활성화돼 있을 때만 동작합니다.');
      return;
    }
    setLoading(true);
    const r = await api.get('/api/users');
    setLoading(false);
    if (!r.ok) {
      setError(r.error || '목록을 불러오지 못했습니다');
      return;
    }
    setItems(r.items || []);
    setError('');
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // KPI 계산
  const kpi = useMemo(() => ({
    total: items.length,
    active: items.filter((u) => u.active).length,
    admins: items.filter((u) => u.role === 'admin' && u.active).length,
    pendingVerify: items.filter((u) => u.email_verified_at == null).length,
    needsPassword: items.filter((u) => u.must_change_password).length,
    twoFa: items.filter((u) => u.totp_enabled).length,
    inactive7d: items.filter((u) => {
      const d = daysSince(u.last_login_at);
      return u.active && (d == null || d > 7);
    }).length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = items.filter((u) => {
      if (filterRole && u.role !== filterRole) return false;
      if (filterStatus === 'active' && !u.active) return false;
      if (filterStatus === 'inactive' && u.active) return false;
      if (filterStatus === 'verify_pending' && u.email_verified_at != null) return false;
      if (filterStatus === 'must_change' && !u.must_change_password) return false;
      if (filterStatus === 'has_2fa' && !u.totp_enabled) return false;
      if (q && !((u.email || '') + ' ' + (u.name || '')).toLowerCase().includes(q)) return false;
      return true;
    });
    arr.sort((a, b) => {
      if (sortBy === 'email') return (a.email || '').localeCompare(b.email || '');
      if (sortBy === 'last_login') {
        const ta = new Date(a.last_login_at || 0).getTime();
        const tb = new Date(b.last_login_at || 0).getTime();
        return tb - ta;
      }
      return a.id - b.id;
    });
    return arr;
  }, [items, search, filterRole, filterStatus, sortBy]);

  async function onCreate(e) {
    e.preventDefault();
    if (!isAdmin) return;
    setSubmitting(true);
    const r = await api.post('/api/users', form);
    setSubmitting(false);
    if (!r.ok) { setError(r.error || '계정 생성 실패'); return; }
    setForm({ email: '', password: '', name: '', role: 'tester' });
    setError('');
    await load();
  }

  async function onUpdate(id, patch) {
    if (!isAdmin) return;
    const r = await api.patch(`/api/users/${id}`, patch);
    if (!r.ok) { siteAlert(r.error || '업데이트 실패'); return; }
    await load();
    if (detail?.id === id) {
      // detail 모달 갱신
      const fresh = (await api.get('/api/users')).items?.find((x) => x.id === id);
      if (fresh) setDetail(fresh);
    }
  }

  async function onDelete(id) {
    if (!isAdmin) return;
    if (!(await siteConfirm('이 계정을 삭제하시겠습니까? 복구할 수 없습니다.'))) return;
    const r = await api.del(`/api/users/${id}`);
    if (!r.ok) { siteAlert(r.error || '삭제 실패'); return; }
    if (detail?.id === id) setDetail(null);
    await load();
  }

  async function onResetPassword(id, email) {
    const newPwd = await sitePrompt(
      `${email} 의 새 임시 비밀번호 (8자 이상, 영문·숫자·특수문자 조합)`,
      '',
      { placeholder: '임시 비밀번호 입력', required: true },
    );
    if (!newPwd || newPwd.length < 8) {
      siteAlert('비밀번호는 최소 8자 이상이어야 합니다.');
      return;
    }
    await onUpdate(id, { password: newPwd, must_change_password: true });
    siteAlert(`임시 비밀번호 적용 완료. 사용자가 첫 로그인 시 변경하게 됩니다.\n\n새 비밀번호: ${newPwd}\n\n이 메시지를 안전한 채널로 전달하세요.`);
  }

  async function onForceVerifyEmail(id, email) {
    if (!(await siteConfirm(`${email} 의 이메일 인증을 다시 요구하시겠습니까?\n다음 로그인 시 6자리 코드 인증이 필요합니다.`))) return;
    await onUpdate(id, { email_verified: false });
    siteAlert('이메일 인증이 초기화되었습니다.');
  }

  async function onMarkVerified(id, email) {
    if (!(await siteConfirm(`${email} 을 인증 완료로 표시하시겠습니까?\n(이메일 OTP 우회 — 디버깅·QA 용도)`))) return;
    await onUpdate(id, { email_verified: true });
  }

  async function onResetTotp(id, email) {
    if (!(await siteConfirm(`${email} 의 2단계 인증을 강제 해제하시겠습니까?\n사용자가 디바이스 분실 시에만 사용. 사용자가 다시 활성화해야 합니다.`))) return;
    await onUpdate(id, { reset_totp: true });
    siteAlert('2단계 인증이 해제되었습니다.');
  }

  async function onBulkDeactivate() {
    const ids = [...selected].filter((id) => id !== me?.id);
    if (!ids.length) return;
    if (!(await siteConfirm(`선택한 ${ids.length}개 계정을 비활성화하시겠습니까?`))) return;
    for (const id of ids) {
      await api.patch(`/api/users/${id}`, { active: false });
    }
    setSelected(new Set());
    await load();
  }

  async function onBulkDelete() {
    const ids = [...selected].filter((id) => id !== me?.id);
    if (!ids.length) return;
    if (!(await siteConfirm(`선택한 ${ids.length}개 계정을 삭제하시겠습니까? 복구 불가.`))) return;
    for (const id of ids) {
      await api.del(`/api/users/${id}`);
    }
    setSelected(new Set());
    await load();
  }

  function toggleSelect(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function toggleSelectAll() {
    const visibleIds = filtered.map((u) => u.id).filter((id) => id !== me?.id);
    if (visibleIds.every((id) => selected.has(id))) setSelected(new Set());
    else setSelected(new Set(visibleIds));
  }

  if (!isAdmin) {
    return (
      <AdminShell>
        <main className="page">
          <section className="wide admin-page">
            <h1 className="page-title">사용자 관리</h1>
            <div className="adm-empty" style={{ padding: 32, textAlign: 'center' }}>
              <p>이 페이지는 <strong>관리자(admin)</strong> 권한 사용자만 접근할 수 있습니다.</p>
              <p style={{ color: '#8c867d', fontSize: 13 }}>현재 권한: {ROLE_LABEL[me?.role] || '알 수 없음'}</p>
            </div>
          </section>
        </main>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <main className="page">
        <section className="wide admin-page">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
            <h1 className="page-title" style={{ margin: 0 }}>사용자 권한 관리</h1>
            <button type="button" className="btn" onClick={() => setShowGuide(true)}
              style={{ background: '#1f5e7c', color: '#fff', border: '1px solid #1f5e7c' }}>
              사용 가이드 보기
            </button>
          </div>

          {showGuide && <UsersGuide onClose={() => setShowGuide(false)} />}

          {/* KPI 4 + 보안 KPI 3 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
            <Kpi label="전체" value={kpi.total} />
            <Kpi label="활성" value={kpi.active} color="#2e7d32" />
            <Kpi label="관리자" value={kpi.admins} color="#c0392b" />
            <Kpi label="이메일 미인증" value={kpi.pendingVerify}
              color={kpi.pendingVerify > 0 ? '#b87333' : '#6f6b68'} />
            <Kpi label="비번 변경 필요" value={kpi.needsPassword}
              color={kpi.needsPassword > 0 ? '#b87333' : '#6f6b68'} />
            <Kpi label="2FA 활성" value={kpi.twoFa}
              color={kpi.twoFa > 0 ? '#2e7d32' : '#6f6b68'} />
            <Kpi label="7일+ 미접속" value={kpi.inactive7d}
              color={kpi.inactive7d > 0 ? '#b87333' : '#6f6b68'} />
          </div>

          {/* 권한 설명 */}
          <details style={{ marginBottom: 18 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#5a534b', padding: '8px 0' }}>
              권한 설명 (3종)
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 8 }}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <div key={k} style={{ border: '1px solid #d7d4cf', padding: 14, background: '#faf8f5' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: ROLE_COLOR[k] }}>
                    {v} <span style={{ color: '#8c867d', fontWeight: 400 }}>({k})</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#5f5b57', lineHeight: 1.6 }}>{ROLE_DESC[k]}</div>
                </div>
              ))}
            </div>
          </details>

          <h3 className="admin-section-title">신규 계정 추가</h3>
          <form onSubmit={onCreate} className="adm-user-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 24 }}>
            <input type="email" required placeholder="이메일" autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value.replace(/\s/g, '') })}
              onBlur={(e) => setForm({ ...form, email: normalizeEmail(e.target.value) })}
              style={inputStyle} />
            <input type="text" placeholder="이름" autoComplete="off"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={inputStyle} />
            <input type="password" required placeholder="임시 비밀번호 (8자 이상)" autoComplete="new-password" minLength={8}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={inputStyle} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle}>
              <option value="admin">관리자 (admin)</option>
              <option value="tester">서브 관리자 (tester)</option>
              <option value="developer">개발자 (developer)</option>
            </select>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? '생성 중…' : '계정 생성'}
            </button>
          </form>
          <p style={{ fontSize: 11, color: '#8c867d', marginTop: -16, marginBottom: 22 }}>
            신규 계정은 <strong>첫 로그인 시 이메일 인증 + 비밀번호 변경</strong>이 강제됩니다.
            임시 비밀번호는 안전한 채널로만 전달하세요.
          </p>

          {error && <div style={{ color: '#b04a3b', fontSize: 13, marginBottom: 16 }}>{error}</div>}

          {/* 검색 / 필터 / 정렬 / bulk */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input type="search" placeholder="이메일·이름 검색" value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, padding: '6px 10px', minWidth: 180 }} />
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ ...inputStyle, padding: '6px 10px' }}>
              <option value="">전체 권한</option>
              <option value="admin">관리자</option>
              <option value="tester">서브 관리자</option>
              <option value="developer">개발자</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, padding: '6px 10px' }}>
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
              <option value="verify_pending">이메일 미인증</option>
              <option value="must_change">비번 변경 필요</option>
              <option value="has_2fa">2FA 활성</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...inputStyle, padding: '6px 10px' }}>
              <option value="id">ID 순</option>
              <option value="email">이메일 순</option>
              <option value="last_login">최근 로그인 순</option>
            </select>
            <span style={{ fontSize: 11, color: '#8c867d' }}>{filtered.length}/{items.length}건</span>
            <span style={{ flex: 1 }} />
            {selected.size > 0 && (
              <>
                <span style={{ fontSize: 12, color: '#2a2724' }}>{selected.size}개 선택</span>
                <button type="button" className="adm-btn-sm" onClick={onBulkDeactivate}>선택 비활성화</button>
                <button type="button" className="adm-btn-sm danger" onClick={onBulkDelete}>선택 삭제</button>
              </>
            )}
            <button type="button" className="adm-btn-sm"
              onClick={() => downloadCSV(
                'daemu-users-' + new Date().toISOString().slice(0, 10) + '.csv',
                filtered,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'email', label: '이메일' },
                  { key: 'name', label: '이름' },
                  { key: (u) => ROLE_LABEL[u.role] || u.role, label: '권한' },
                  { key: (u) => u.active ? '활성' : '비활성', label: '상태' },
                  { key: (u) => u.email_verified_at ? '인증완료' : '미인증', label: '이메일인증' },
                  { key: (u) => u.totp_enabled ? '활성' : '비활성', label: '2FA' },
                  { key: (u) => u.must_change_password ? 'Y' : 'N', label: '비번변경필요' },
                  { key: (u) => u.last_login_at ? new Date(u.last_login_at).toISOString() : '', label: '최근로그인' },
                  { key: (u) => u.created_at ? new Date(u.created_at).toISOString() : '', label: '가입일' },
                ],
              )}>CSV 내보내기</button>
          </div>

          <div className="adm-table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>
                  <th style={{ ...th, width: 32 }}>
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.filter((u) => u.id !== me?.id).every((u) => selected.has(u.id))}
                      onChange={toggleSelectAll}
                      title="선택 전체 토글" />
                  </th>
                  <th style={th}>이메일</th>
                  <th style={th}>이름</th>
                  <th style={th}>권한</th>
                  <th style={th}>활성</th>
                  <th style={th}>이메일 인증</th>
                  <th style={th}>2FA</th>
                  <th style={th}>최근 로그인</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center' }}>불러오는 중…</td></tr>}
                {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: '#8c867d' }}>조건에 맞는 계정이 없습니다.</td></tr>}
                {filtered.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #e6e3dd', cursor: 'pointer' }}
                    onClick={(e) => {
                      // 체크박스 / 인터랙션 요소 클릭 시 detail 안 열림
                      if (e.target.closest('input, select, button')) return;
                      setDetail(u);
                    }}>
                    <td style={td}>
                      <input type="checkbox"
                        checked={selected.has(u.id)}
                        disabled={u.id === me?.id}
                        onChange={() => toggleSelect(u.id)} />
                    </td>
                    <td style={td}>
                      <strong>{u.email}</strong>
                      {u.id === me?.id && <span style={{ marginLeft: 6, color: '#8c867d', fontSize: 11 }}>(나)</span>}
                      {u.must_change_password && <span style={{ marginLeft: 6, fontSize: 10, color: '#b87333', background: '#fff8ec', padding: '1px 6px', borderRadius: 2 }}>비번 변경 필요</span>}
                    </td>
                    <td style={td}>{u.name || '—'}</td>
                    <td style={td}>
                      <select value={u.role} onChange={(e) => onUpdate(u.id, { role: e.target.value })}
                        disabled={u.id === me?.id} style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, color: ROLE_COLOR[u.role] }}>
                        <option value="admin">관리자</option>
                        <option value="tester">서브 관리자</option>
                        <option value="developer">개발자</option>
                      </select>
                    </td>
                    <td style={td}>
                      <button type="button" onClick={() => onUpdate(u.id, { active: !u.active })}
                        disabled={u.id === me?.id}
                        style={{
                          padding: '4px 10px', fontSize: 11, border: '1px solid ' + (u.active ? '#2f7d4d' : '#a09a92'),
                          background: u.active ? '#2f7d4d' : 'transparent', color: u.active ? '#fff' : '#5f5b57',
                          cursor: u.id === me?.id ? 'not-allowed' : 'pointer',
                        }}>
                        {u.active ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td style={td}>
                      {u.email_verified_at ? (
                        <span style={{ fontSize: 11, color: '#2e7d32' }} title={fmtDate(u.email_verified_at)}>완료</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#b87333' }}>미인증</span>
                      )}
                    </td>
                    <td style={td}>
                      {u.totp_enabled ? (
                        <span style={{ fontSize: 11, color: '#2e7d32' }}>활성</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#8c867d' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: '#5a534b' }}>
                      {u.last_login_at ? (
                        <span title={fmtDate(u.last_login_at)}>
                          {daysSince(u.last_login_at) === 0 ? '오늘' :
                           daysSince(u.last_login_at) === 1 ? '어제' :
                           daysSince(u.last_login_at) + '일 전'}
                        </span>
                      ) : (
                        <span style={{ color: '#b9b5ae' }}>한 번도 없음</span>
                      )}
                    </td>
                    <td style={td}>
                      <button type="button" className="adm-btn-sm" onClick={() => setDetail(u)}>상세</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {detail && (
        <UserDetailModal
          user={detail}
          isMe={detail.id === me?.id}
          onClose={() => setDetail(null)}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onResetPassword={onResetPassword}
          onForceVerifyEmail={onForceVerifyEmail}
          onMarkVerified={onMarkVerified}
          onResetTotp={onResetTotp}
        />
      )}
    </AdminShell>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#8c867d', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || '#231815' }}>{value}</div>
    </div>
  );
}

function UserDetailModal({ user, isMe, onClose, onUpdate, onDelete, onResetPassword, onForceVerifyEmail, onMarkVerified, onResetTotp }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>
            {user.email} {isMe && <span style={{ color: '#8c867d', fontSize: 13, fontWeight: 400 }}>(나)</span>}
          </h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>

        <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '8px 16px', fontSize: 13, marginBottom: 18 }}>
          <DT>ID</DT><DD>{user.id}</DD>
          <DT>이름</DT><DD>{user.name || '—'}</DD>
          <DT>권한</DT><DD style={{ color: ROLE_COLOR[user.role] }}>{ROLE_LABEL[user.role] || user.role}</DD>
          <DT>활성 상태</DT><DD>{user.active ? '활성' : '비활성'}</DD>
          <DT>이메일 인증</DT>
          <DD>
            {user.email_verified_at ? (
              <>완료 <span style={{ color: '#8c867d', fontSize: 12, marginLeft: 6 }}>{fmtDate(user.email_verified_at)}</span></>
            ) : <span style={{ color: '#b87333' }}>미인증 — 다음 로그인 시 6자리 코드 인증 필요</span>}
          </DD>
          <DT>2단계 인증 (TOTP)</DT>
          <DD>
            {user.totp_enabled ? (
              <>활성 <span style={{ color: '#8c867d', fontSize: 12, marginLeft: 6 }}>recovery code {user.recovery_codes_count || 0}개</span></>
            ) : <span style={{ color: '#8c867d' }}>비활성</span>}
          </DD>
          <DT>비번 변경 필요</DT>
          <DD>{user.must_change_password ? <span style={{ color: '#b87333' }}>예 — 다음 로그인 시 변경</span> : '아니오'}</DD>
          <DT>마지막 비번 변경</DT><DD>{fmtDate(user.password_changed_at)}</DD>
          <DT>최근 로그인</DT><DD>{fmtDate(user.last_login_at)}</DD>
          <DT>가입일</DT><DD>{fmtDate(user.created_at)}</DD>
        </dl>

        <h3 className="admin-section-title" style={{ fontSize: 13 }}>보안 작업</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <button type="button" className="adm-btn-sm"
            onClick={() => onResetPassword(user.id, user.email)}>
            비밀번호 리셋 (임시 발급)
          </button>
          <button type="button" className="adm-btn-sm"
            onClick={() => user.email_verified_at ? onForceVerifyEmail(user.id, user.email) : onMarkVerified(user.id, user.email)}>
            {user.email_verified_at ? '이메일 인증 다시 요구' : '인증 완료로 표시'}
          </button>
          <button type="button" className="adm-btn-sm" disabled={!user.totp_enabled}
            onClick={() => onResetTotp(user.id, user.email)}>
            2FA 강제 해제
          </button>
          <button type="button" className="adm-btn-sm"
            onClick={() => onUpdate(user.id, { must_change_password: !user.must_change_password })}>
            비번 변경 필요 토글
          </button>
        </div>

        <h3 className="admin-section-title" style={{ fontSize: 13 }}>위험 작업</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="adm-btn-sm" disabled={isMe}
            onClick={() => onUpdate(user.id, { active: !user.active })}>
            {user.active ? '계정 비활성화' : '계정 활성화'}
          </button>
          <button type="button" className="adm-btn-sm danger" disabled={isMe}
            onClick={() => onDelete(user.id)}>
            계정 삭제 (복구 불가)
          </button>
        </div>

        {isMe && (
          <p style={{ fontSize: 11, color: '#8c867d', marginTop: 14 }}>
            본인 계정은 셀프 비활성화·삭제·권한 강등이 차단됩니다.
          </p>
        )}

        <div className="adm-action-row">
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function DT({ children }) {
  return <dt style={{ color: '#8c867d', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>{children}</dt>;
}
function DD({ children, style }) {
  return <dd style={{ margin: 0, color: '#231815', ...style }}>{children}</dd>;
}

const inputStyle = {
  border: '1px solid #d7d4cf',
  padding: '10px 12px',
  fontSize: 13,
  background: '#fff',
  fontFamily: 'inherit',
};

const th = {
  textAlign: 'left',
  padding: '10px 8px',
  fontSize: 11,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: '#5f5b57',
};

const td = {
  padding: '12px 8px',
  verticalAlign: 'middle',
};
