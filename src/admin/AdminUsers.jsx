import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell.jsx';
import { api } from '../lib/api.js';
import { Auth } from '../lib/auth.js';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm } from '../lib/dialog.js';
import { normalizeEmail } from '../lib/inputFormat.js';

const ROLE_LABEL = { admin: '슈퍼 관리자', tester: '서브 관리자', developer: '개발자' };
const ROLE_DESC = {
  admin: '전체 권한. 사용자·고객·파트너·CRM·계약·시스템 설정까지 모두 접근.',
  tester: '서브 관리자 — 대부분 읽기 전용. 팝업 등록/문의 모니터링은 가능. 사용자·시스템 설정은 차단.',
  developer: '개발자 — 작업사례·팝업·메일템플릿·콘텐츠 관리. 고객 PII는 차단.',
};

export default function AdminUsers() {
  const me = Auth.user();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'tester' });
  const [submitting, setSubmitting] = useState(false);

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

  async function onCreate(e) {
    e.preventDefault();
    if (!isAdmin) return;
    setSubmitting(true);
    const r = await api.post('/api/users', form);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error || '계정 생성 실패');
      return;
    }
    setForm({ email: '', password: '', name: '', role: 'tester' });
    setError('');
    await load();
  }

  async function onUpdate(id, patch) {
    if (!isAdmin) return;
    const r = await api.patch(`/api/users/${id}`, patch);
    if (!r.ok) {
      siteAlert(r.error || '업데이트 실패');
      return;
    }
    await load();
  }

  async function onDelete(id) {
    if (!isAdmin) return;
    if (!(await siteConfirm('이 계정을 삭제하시겠습니까?'))) return;
    const r = await api.del(`/api/users/${id}`);
    if (!r.ok) {
      siteAlert(r.error || '삭제 실패');
      return;
    }
    await load();
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
          <h1 className="page-title">사용자 관리</h1>

          <div className="adm-roles-legend" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 32 }}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <div key={k} style={{ border: '1px solid #d7d4cf', padding: 14, background: '#faf8f5' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{v} ({k})</div>
                <div style={{ fontSize: 12, color: '#5f5b57', lineHeight: 1.6 }}>{ROLE_DESC[k]}</div>
              </div>
            ))}
          </div>

          <h3 className="admin-section-title">신규 계정 추가</h3>
          <form onSubmit={onCreate} className="adm-user-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
            <input type="email" required placeholder="이메일" autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value.replace(/\s/g, '') })}
              onBlur={(e) => setForm({ ...form, email: normalizeEmail(e.target.value) })}
              style={inputStyle} />
            <input type="text" placeholder="이름" autoComplete="off"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={inputStyle} />
            <input type="password" required placeholder="비밀번호 (8자 이상)" autoComplete="new-password" minLength={8}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={inputStyle} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle}>
              <option value="admin">관리자 (admin)</option>
              <option value="tester">서브 관리자 (tester)</option>
              <option value="developer">개발자 (developer)</option>
            </select>
            <button className="btn" type="submit" disabled={submitting}>{submitting ? '생성 중…' : '계정 생성'}</button>
          </form>

          {error && <div style={{ color: '#b04a3b', fontSize: 13, marginBottom: 16 }}>{error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 className="admin-section-title" style={{ margin: 0 }}>계정 목록 ({items.length})</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm" disabled={!items.length}
              onClick={() => downloadCSV(
                'daemu-users-' + new Date().toISOString().slice(0, 10) + '.csv',
                items,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'email', label: '이메일' },
                  { key: 'name', label: '이름' },
                  { key: (u) => ROLE_LABEL[u.role] || u.role, label: '권한' },
                  { key: (u) => u.active ? '활성' : '비활성', label: '상태' },
                  { key: (u) => u.created_at ? new Date(u.created_at).toISOString() : '', label: '가입일' },
                  { key: (u) => u.last_login_at ? new Date(u.last_login_at).toISOString() : '', label: '최근로그인' },
                ],
              )}>CSV 내보내기</button>
          </div>
          <div className="adm-table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #2a2724' }}>
                  <th style={th}>ID</th>
                  <th style={th}>이메일</th>
                  <th style={th}>이름</th>
                  <th style={th}>권한</th>
                  <th style={th}>상태</th>
                  <th style={th}>가입일</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center' }}>불러오는 중…</td></tr>}
                {!loading && items.length === 0 && <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center' }}>계정이 없습니다.</td></tr>}
                {items.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #e6e3dd' }}>
                    <td style={td}>{u.id}</td>
                    <td style={td}><strong>{u.email}</strong>{u.id === me?.id && <span style={{ marginLeft: 6, color: '#8c867d', fontSize: 11 }}>(나)</span>}</td>
                    <td style={td}>{u.name || '-'}</td>
                    <td style={td}>
                      <select value={u.role} onChange={(e) => onUpdate(u.id, { role: e.target.value })}
                        disabled={u.id === me?.id} style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }}>
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
                    <td style={td}>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                    <td style={td}>
                      <button type="button" onClick={() => onDelete(u.id)} disabled={u.id === me?.id}
                        style={{ padding: '4px 10px', fontSize: 11, color: '#b04a3b', background: 'transparent', border: '1px solid #b04a3b', cursor: u.id === me?.id ? 'not-allowed' : 'pointer' }}>
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AdminShell>
  );
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
