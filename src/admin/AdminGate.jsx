import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import { Auth } from '../lib/auth.js';
import { DB } from '../lib/db.js';
import { api } from '../lib/api.js';
import ChangePasswordForm from './ChangePasswordForm.jsx';
import TwoFactorPanel from './TwoFactorPanel.jsx';
import EmailVerifyForm from './EmailVerifyForm.jsx';
import { siteAlert, siteToast } from '../lib/dialog.js';
import {
  pickDownloadDirectory, clearDownloadDirectory,
  getDownloadDirectoryLabel, isDirectoryPickerSupported,
} from '../lib/downloadDir.js';
import AdminMainGuide from './AdminMainGuide.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';
// V3-02: ensure window.DB / Auth / escHtml / sendAutoReply etc. are
// installed even when the user navigates *into* /admin via React Router
// (no full reload). The dynamic import in main.jsx only catches direct
// landings on admin URLs.
import('../lib/globals.js');

export default function AdminGate() {
  const [loggedIn, setLoggedIn] = useState(() => Auth.isLoggedIn());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mustChange, setMustChange] = useState(() => !!Auth.user()?.must_change_password);
  // 첫 접속 이메일 인증 필요 여부 — strict null 검사. localStorage 에
  // 필드 자체가 없는 *legacy* 케이스(undefined)는 '아직 모름' 으로 보고
  // verify 화면을 띄우지 않음 (refreshMe 이후 정확한 값이 들어옴).
  // 그래서 '깜빡' 현상이 사라짐.
  const [needsEmailVerify, setNeedsEmailVerify] = useState(
    () => !!Auth.user() && Auth.user()?.email_verified_at === null,
  );
  // refreshMe 가 끝나기 전에는 hydrating=true 로 두고, verify/changePw 화면을
  // 절대 렌더링하지 않음. 정상 dashboard 가 stale state 로 잠시 잘못 그려지지
  // 않게 보호하는 가드.
  const [hydrating, setHydrating] = useState(() => Auth.isLoggedIn() && api.isConfigured());
  const [showChange, setShowChange] = useState(false);
  const [show2fa, setShow2fa] = useState(false);
  const [csvPrefix, setCsvPrefix] = useState(() => {
    try { return localStorage.getItem('daemu_csv_filename_prefix') || 'daemu-'; }
    catch { return 'daemu-'; }
  });
  const [csvDirLabel, setCsvDirLabel] = useState(() => getDownloadDirectoryLabel());
  // 모던 브라우저(Chrome/Edge/Opera 86+) 만 File System Access API 지원.
  const supportsPicker = isDirectoryPickerSupported();
  const onPickCsvDir = async () => {
    try {
      const handle = await pickDownloadDirectory();
      setCsvDirLabel(handle?.name || '');
      try { siteToast(`다운로드 폴더 설정됨: ${handle?.name || ''}`); } catch { /* ignore */ }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      try { siteAlert(e?.message || '폴더 선택 실패'); } catch { /* ignore */ }
    }
  };
  const onClearCsvDir = async () => {
    await clearDownloadDirectory();
    setCsvDirLabel('');
    try { siteToast('다운로드 폴더 해제됨 — 브라우저 기본 폴더로 저장됩니다.'); } catch { /* ignore */ }
  };
  // 2FA login flow state — when backend says need_totp, we keep email/password
  // around (NOT in storage) so the user can submit the 6-digit code without
  // re-typing credentials.
  const [pendingCreds, setPendingCreds] = useState(null);
  const [totpCode, setTotpCode] = useState('');

  // 2FA 분실 복구 — 이메일 + 본인 확인용 비밀번호 입력 modal.
  const [showTotpRecover, setShowTotpRecover] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverPassword, setRecoverPassword] = useState('');
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverLoading, setRecoverLoading] = useState(false);

  const onTotpRecoverSubmit = async (e) => {
    e.preventDefault();
    if (!recoverEmail.trim() || !recoverPassword) return;
    setRecoverLoading(true);
    // backend 는 사용자 존재/비번 일치 여부 leak 방지로 항상 200 응답.
    await api.post('/api/auth/totp-reset-request', {
      email: recoverEmail.trim(),
      password: recoverPassword,
    }, { skipAuth: true });
    setRecoverLoading(false);
    setRecoverSent(true);
    setRecoverPassword('');  // 메모리에서 즉시 제거
  };
  const onTotpRecoverClose = () => {
    setShowTotpRecover(false);
    setRecoverSent(false);
    setRecoverEmail('');
    setRecoverPassword('');
  };

  useEffect(() => { document.title = 'Admin — DAEMU'; }, []);

  // Refresh /api/auth/me on mount so the forced-change flag stays accurate
  // even if it changed on another device or via admin reset.
  //
  // 중요: refreshMe 가 실패해도 logout 은 401/403 (authFailed) 일 때만.
  // 5xx / 네트워크 에러(예: 백엔드 cold-start, DB 일시 단절, ipv6 끊김,
  // CORS preflight 시점 일시 장애) 는 transient 로 분류해 세션 유지 — 사용자
  // 가 어드민에 들어와 새로고침할 때마다 강제 로그아웃되던 버그 제거.
  useEffect(() => {
    if (loggedIn && api.isConfigured()) {
      setHydrating(true);
      Auth.refreshMe().then((res) => {
        if (res && res.ok) {
          setMustChange(!!res.must_change_password);
          setNeedsEmailVerify(res.email_verified_at == null);
        } else if (res && res.authFailed) {
          // 토큰 만료 / 위조 / 계정 비활성 — 진짜 logout
          Auth.logout();
          setLoggedIn(false);
        }
        // transient (5xx/네트워크) — 기존 세션 그대로 유지. localStorage 의
        // user 정보로 화면 진입. 다음 API 호출이 정상화되면 자동 회복.
      }).finally(() => setHydrating(false));
    } else {
      setHydrating(false);
    }
  }, [loggedIn]);

  const onLogin = async (e) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.target);
    const email = String(fd.get('admin_id') || '').trim();
    const password = String(fd.get('admin_pw') || '');
    setLoading(true);
    const res = await Auth.login(email, password);
    setLoading(false);
    if (!res.ok) {
      if (res.needTotp) {
        setPendingCreds({ email, password });
        setError(res.message || '2단계 인증 코드를 입력해 주세요.');
        return;
      }
      setError(res.error || '로그인 실패');
      return;
    }
    setMustChange(!!res.mustChangePassword);
    setLoggedIn(true);
  };

  const onTotpSubmit = async (e) => {
    e.preventDefault();
    if (!pendingCreds) return;
    setError('');
    setLoading(true);
    const res = await Auth.login(pendingCreds.email, pendingCreds.password, totpCode.trim());
    setLoading(false);
    if (!res.ok) {
      if (res.needTotp) {
        setError(res.message || '잘못된 인증 코드입니다.');
        return;
      }
      setError(res.error || '로그인 실패');
      return;
    }
    setPendingCreds(null);
    setTotpCode('');
    setMustChange(!!res.mustChangePassword);
    setLoggedIn(true);
  };
  const onTotpCancel = () => {
    setPendingCreds(null);
    setTotpCode('');
    setError('');
  };
  const onLogout = () => {
    Auth.logout();
    setLoggedIn(false);
    setMustChange(false);
    setShowChange(false);
  };

  // 하이드레이션 중에는 stale 한 verify/changePw 화면이 깜빡 표시되지 않도록
  // 미니 스피너만 보여줌. /api/auth/me 응답이 오면 정확한 분기로 진입.
  if (loggedIn && hydrating) {
    return (
      <AdminShell>
        <main className="page" style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#8c867d', fontSize: 13, letterSpacing: '.08em' }}>세션 확인 중…</div>
        </main>
      </AdminShell>
    );
  }

  // 첫 접속 어드민 — 이메일 인증을 가장 먼저 요구.
  if (loggedIn && needsEmailVerify) {
    return (
      <AdminShell>
        <main className="page">
          <section className="wide admin-page">
            <h1 className="page-title">Admin</h1>
            <EmailVerifyForm
              email={Auth.user()?.email || ''}
              onVerified={(newEmail) => {
                // 검증 성공 시 user 객체의 email 도 갱신 (백엔드에서 user.email 이
                // 새 이메일로 바뀌었기 때문). refreshMe 가 비동기로 동기화되지만
                // 즉시 UI 일관성을 위해 로컬 캐시도 미리 업데이트.
                try {
                  const u = Auth.user();
                  if (u && newEmail) {
                    localStorage.setItem('daemu_admin_user', JSON.stringify({
                      ...u, email: newEmail, email_verified_at: new Date().toISOString(),
                    }));
                  }
                } catch { /* ignore */ }
                setNeedsEmailVerify(false);
              }}
              onLogout={onLogout}
            />
          </section>
        </main>
      </AdminShell>
    );
  }

  if (loggedIn && (mustChange || showChange)) {
    return (
      <AdminShell>
        <main className="page">
          <section className="wide admin-page">
            <h1 className="page-title">Admin</h1>
            <ChangePasswordForm
              forced={mustChange}
              onDone={() => {
                setMustChange(false);
                setShowChange(false);
                siteAlert('비밀번호가 변경되었습니다.');
              }}
            />
            {!mustChange && (
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setShowChange(false)}>
                  취소
                </button>
              </div>
            )}
            {mustChange && (
              <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: '#8c867d' }}>
                비밀번호를 변경한 후 대시보드로 이동합니다.
                <div style={{ marginTop: 12 }}>
                  <button type="button" onClick={onLogout}
                    style={{ background: 'transparent', border: 'none', color: '#b04a3b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                    다른 계정으로 로그인
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      </AdminShell>
    );
  }

  if (!loggedIn) {
    return (
      <AdminShell>
        <main className="page fade-up">
          <section className="wide admin-page">
            <h1 className="page-title">Admin</h1>
            <div className="admin-login-wrap">
              <div className="admin-login-box">
                {pendingCreds ? (
                  <>
                    <h2>2단계 인증</h2>
                    <p>인증 앱(Google Authenticator, Authy 등)에 표시된 <strong>6자리 코드</strong>를 입력해 주세요.<br />
                    백업 코드(XXXX-XXXX 형식)도 사용 가능합니다.</p>
                    <form onSubmit={onTotpSubmit}>
                      <div className="admin-login-field">
                        <input type="text" inputMode="numeric" autoComplete="one-time-code"
                          autoFocus pattern="[0-9A-Za-z\\-\\s]*" maxLength={20}
                          value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                          placeholder="123456 또는 ABCD-1234" required />
                      </div>
                      {error && <div style={{ color: '#b04a3b', fontSize: 12, margin: '4px 0 8px' }}>{error}</div>}
                      <button className="btn" type="submit" disabled={loading}>{loading ? '확인 중…' : '확인'}</button>
                      <button type="button" className="adm-btn-sm" style={{ marginTop: 8 }} onClick={onTotpCancel}>← 다시 로그인</button>
                      <button type="button" onClick={() => setShowTotpRecover(true)}
                        style={{ background: 'transparent', border: 'none', color: '#1f5e7c', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', marginTop: 14, display: 'block', width: '100%' }}>
                        2단계 인증 분실? 이메일로 복구 링크 받기
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <h2>관리자 로그인</h2>
                    <p>대무 관리자 전용 페이지입니다.</p>
                    {!api.isConfigured() && <p style={{fontSize:11,color:'#a09a92',marginTop:-12}}>※ 백엔드 미연결 상태 — 데모 모드로 진행됩니다.</p>}
                    <form onSubmit={onLogin}>
                      <div className="admin-login-field"><input type="text" name="admin_id" placeholder="관리자 아이디 (이메일)" autoComplete="username" required /></div>
                      <div className="admin-login-field"><input type="password" name="admin_pw" placeholder="비밀번호" autoComplete="current-password" required /></div>
                      {error && <div style={{color:'#b04a3b',fontSize:12,margin:'4px 0 8px'}}>{error}</div>}
                      <button className="btn" type="submit" disabled={loading}>{loading ? '확인 중…' : '로그인'}</button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </section>
        </main>
        {showTotpRecover && (
          <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onTotpRecoverClose(); }}
            role="dialog" aria-modal="true" aria-label="2단계 인증 복구">
            <div className="adm-modal-box is-narrow">
              <div className="adm-modal-head">
                <h2>2단계 인증 복구</h2>
                <button type="button" className="adm-modal-close" onClick={onTotpRecoverClose} aria-label="닫기">×</button>
              </div>
              {recoverSent ? (
                <div>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: '#2e7d32', fontWeight: 500 }}>
                    ✓ 복구 링크 요청을 받았습니다.
                  </p>
                  <p style={{ fontSize: 12.5, lineHeight: 1.7, color: '#5a534b' }}>
                    입력하신 이메일이 등록된 어드민 계정인 경우, <strong>5분 이내</strong>에 복구 링크가 도착합니다.
                    스팸함도 함께 확인해 주세요. 링크는 1회용이며 5분 후 만료됩니다.
                  </p>
                  <p style={{ fontSize: 11.5, color: '#8c867d', marginTop: 12 }}>
                    이메일이 도착하지 않아도 보안상 같은 응답을 드립니다 — 등록되지 않은 이메일이거나 발송 한도(10분 1회)에 걸린 경우입니다.
                  </p>
                  <div className="adm-action-row">
                    <button type="button" className="btn" onClick={onTotpRecoverClose}>닫기</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={onTotpRecoverSubmit}>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: '#5a534b' }}>
                    인증 앱과 백업 코드를 모두 잃은 경우, 등록된 이메일로 복구 링크를 받을 수 있습니다.
                  </p>
                  <p style={{ fontSize: 12, color: '#b87333', background: '#fff8ec', border: '1px solid #f0e3c4', padding: '8px 10px', borderRadius: 4, marginBottom: 14 }}>
                    🔒 본인 확인을 위해 <strong>이메일과 현재 비밀번호</strong>를 함께 입력해 주세요.
                    링크 클릭 후 2단계 인증이 해제되며, 다음 로그인 시 비밀번호 변경이 강제됩니다.
                  </p>
                  <div className="admin-login-field">
                    <input type="email" autoComplete="username"
                      value={recoverEmail} onChange={(e) => setRecoverEmail(e.target.value)}
                      placeholder="등록된 어드민 이메일" required autoFocus />
                  </div>
                  <div className="admin-login-field">
                    <input type="password" autoComplete="current-password"
                      value={recoverPassword} onChange={(e) => setRecoverPassword(e.target.value)}
                      placeholder="현재 비밀번호" required />
                  </div>
                  <div className="adm-action-row">
                    <button type="button" className="adm-btn-sm" onClick={onTotpRecoverClose}>취소</button>
                    <button type="submit" className="btn" disabled={recoverLoading}>
                      {recoverLoading ? '발송 중…' : '복구 링크 발송'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </AdminShell>
    );
  }

  const inq = DB.get('inquiries');
  const ord = DB.get('orders');
  const crm = DB.get('crm');
  const cmp = DB.get('campaigns');
  const newInq = inq.filter(i => i.status === '신규').length;
  const pendingOrd = ord.filter(o => o.status === '접수' || o.status === '처리중').length;
  const leads = crm.filter(c => c.status === 'lead' || c.status === 'qualified').length;
  const sentCmp = cmp.filter(c => c.status === 'sent').length;

  const me = Auth.user() || { role: 'admin', email: '데모', name: '관리자' };
  // Permission map mirrors backend auth.PERMISSIONS — keep in sync.
  const PERM = {
    'content':       ['admin', 'developer'],
    'partner-brands':['admin', 'developer', 'tester'],
    'works':         ['admin', 'developer', 'tester'],
    'inquiries':     ['admin', 'tester'],
    'partners':      ['admin'],
    'orders':        ['admin', 'tester'],
    'stats':         ['admin', 'tester', 'developer'],
    'media':         ['admin', 'developer'],
    'mail':          ['admin', 'developer', 'tester'],
    'mail-templates':['admin', 'developer'],
    'utm-builder':   ['admin', 'developer', 'tester'],
    'crm':           ['admin'],
    'campaign':      ['admin'],
    'promotion':     ['admin'],
    'popup':         ['admin', 'developer', 'tester'],
    'outbox':        ['admin', 'developer', 'tester'],
    'monitoring':    ['admin', 'developer'],
    'contracts':     ['admin', 'tester'],
    'products':      ['admin', 'tester'],
    'analytics':     ['admin', 'tester', 'developer'],
    'users':         ['admin'],
    'api-docs':      ['admin', 'developer'],
    'security':      ['admin', 'developer'],
    'announcements': ['admin', 'developer'],
    'inventory':     ['admin', 'tester'],
  };
  const can = (k) => PERM[k]?.includes(me.role);
  // 한국어 역할 라벨. admin = Super Admin (모든 권한),
  // tester = Sub Admin (읽기 전용), developer = 개발자(콘텐츠/시스템 일부).
  const ROLE_BADGE = { admin: '슈퍼 관리자', tester: '서브 관리자', developer: '개발자' };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide admin-page">
          <h1 className="page-title">Admin</h1>
          <div className="admin-dashboard">
            <div className="admin-header">
              <div>
                <h2>관리자 대시보드</h2>
                <div style={{ fontSize: 12, color: '#5f5b57', marginTop: 6 }}>
                  <strong>{me.name || me.email}</strong>
                  <span style={{ display: 'inline-block', marginLeft: 8, padding: '2px 8px', background: '#2a2724', color: '#f6f4f0', borderRadius: 2, fontSize: 10, letterSpacing: '.06em' }}>
                    {ROLE_BADGE[me.role] || me.role}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" type="button" onClick={() => setShowChange(true)}
                  style={{ minWidth: 120 }}>비밀번호 변경</button>
                <button className="btn" type="button" onClick={() => setShow2fa(true)}
                  style={{ minWidth: 120 }}>2단계 인증{me.totp_enabled ? ' ✓' : ''}</button>
                <button className="btn admin-logout-btn" type="button" onClick={onLogout}
                  style={{ minWidth: 120 }}>로그아웃</button>
              </div>
              {show2fa && (
                <TwoFactorPanel
                  user={me}
                  onClose={() => { setShow2fa(false); Auth.refreshMe(); }}
                />
              )}
            </div>
            <PageActions>
              <GuideButton GuideComponent={AdminMainGuide} />
            </PageActions>

            <div className="admin-stats-grid">
              <div className="admin-stat-card"><span className="admin-stat-number">{newInq}</span><span className="admin-stat-label">신규 상담 문의</span></div>
              <div className="admin-stat-card"><span className="admin-stat-number">{pendingOrd}</span><span className="admin-stat-label">처리 대기 발주</span></div>
              <div className="admin-stat-card"><span className="admin-stat-number">{leads}</span><span className="admin-stat-label">활성 리드</span></div>
              <div className="admin-stat-card"><span className="admin-stat-number">{sentCmp}</span><span className="admin-stat-label">발송된 캠페인</span></div>
            </div>

            {/* 개발자 IP 화이트리스트 — 본인/팀 IP 입력 시 모니터링·analytics
                에서 자동 필터. 도메인 + 운영 단계 후에도 GA4 internal traffic
                과 동일 역할. 미리 등록해두면 마이그레이션 후 바로 적용 가능. */}
            <div style={{ background: '#fafaf6', border: '1px solid #e6e3dd', padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8 }}>
                개발자 IP 화이트리스트 (노이즈 제거)
              </div>
              <DevIpWhitelistEditor />
              <p style={{ fontSize: 11.5, color: '#8c867d', margin: '8px 0 0', lineHeight: 1.6 }}>
                여기 등록된 IP 는 모니터링/analytics 응답에서 자동 제외됩니다. 본인 IP 는
                {' '}<a href="https://www.whatismyip.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#1f5e7c' }}>whatismyip.com</a>
                {' '}에서 확인. 콤마/공백으로 여러 개 입력 가능
                (예: <code>121.130.1.1, 192.168.0.0/24</code>).
              </p>
            </div>

            {/* CSV 다운로드 설정 — 파일명 prefix + 다운로드 폴더 미리 지정. */}
            <div style={{ background: '#fafaf6', border: '1px solid #e6e3dd', padding: '14px 18px', marginBottom: 28 }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 10 }}>CSV 다운로드 설정</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, flex: '0 0 auto' }}>
                  <span style={{ color: '#5a534b' }}>파일명 prefix</span>
                  <input type="text" value={csvPrefix}
                    onChange={(e) => setCsvPrefix(e.target.value)}
                    onBlur={() => {
                      try {
                        const v = String(csvPrefix || '').replace(/[^a-zA-Z0-9_-]/g, '');
                        const final = v ? (v.endsWith('-') ? v : v + '-') : 'daemu-';
                        setCsvPrefix(final);
                        localStorage.setItem('daemu_csv_filename_prefix', final);
                        try { siteToast(`CSV 파일명 prefix 저장됨: ${final}`); } catch { /* ignore */ }
                      } catch { /* ignore */ }
                    }}
                    placeholder="daemu-"
                    style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12, minWidth: 160 }} />
                </label>

                <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#5a534b' }}>다운로드 폴더</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {csvDirLabel ? (
                      <>
                        <code style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12, color: '#231815', background: '#fff', padding: '6px 10px', border: '1px solid #d7d4cf' }}>
                          📁 {csvDirLabel}
                        </code>
                        <button type="button" className="adm-btn-sm" onClick={onPickCsvDir}>
                          폴더 변경
                        </button>
                        <button type="button" className="adm-btn-sm danger" onClick={onClearCsvDir}>
                          해제
                        </button>
                      </>
                    ) : (
                      <button type="button" className="adm-btn-sm" onClick={onPickCsvDir}
                        disabled={!supportsPicker}
                        style={{ background: supportsPicker ? '#1f5e7c' : '#d7d4cf', color: '#fff', borderColor: supportsPicker ? '#1f5e7c' : '#d7d4cf' }}>
                        다운로드 폴더 선택
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8c867d', lineHeight: 1.6 }}>
                    {supportsPicker ? (
                      csvDirLabel
                        ? `모든 CSV 다운로드가 위 폴더로 자동 저장됩니다. 처음 사용 시 한 번 권한 허용 다이얼로그가 뜰 수 있습니다.`
                        : `폴더를 한 번 선택해두면 이후 모든 CSV 가 그 폴더로 자동 저장됩니다. 미선택 시 브라우저 기본 다운로드 폴더로 저장.`
                    ) : (
                      `본 브라우저는 폴더 직접 지정을 지원하지 않습니다 (Firefox / iOS Safari). Chrome·Edge·Opera 에서만 가능 — 그 외에는 브라우저 기본 다운로드 폴더(보통 ~/Downloads)로 저장됩니다. 위치는 브라우저 설정에서 변경 가능.`
                    )}
                  </div>
                </div>
              </div>
            </div>

            <h3 className="admin-section-title">관리 메뉴</h3>
            <div className="admin-menu-grid">
              {can('content')   && <MenuCard to="/admin/content" title="콘텐츠 관리" desc="연혁, 소개, 서비스 등 사이트 콘텐츠를 수정합니다." items={['회사 소개 수정','연혁 관리','서비스 항목 편집','프로세스 내용 수정']} />}
              {can('partner-brands') && <MenuCard to="/admin/partner-brands" title="함께하는 파트너사" desc="Home 페이지 '함께하는 파트너사' 섹션에 노출되는 협업 파트너 로고를 관리합니다." items={['파트너 로고 등록·수정','노출 순서 조정 (↑↓)','외부 링크 연결','노출/비활성 토글','즉시 사이트 반영']} />}
              {can('works')     && <MenuCard to="/admin/works" title="작업사례 관리" desc="포트폴리오 및 작업사례를 등록하고 수정합니다." items={['작업사례 등록','기존 사례 수정','이미지 업로드','게시 상태 관리']} />}
              {can('inquiries') && <MenuCard to="/admin/inquiries" title="상담/문의 관리" desc="고객 상담 신청 및 문의 내역을 확인하고 관리합니다." items={['신규 문의 확인','상담 상태 관리','메일 자동회신 설정','문의 이력 검색']} />}
              {can('partners')  && <MenuCard to="/admin/partners" title="파트너 계정 관리" desc="파트너 계정 발급, 권한 설정, 승인을 관리합니다." items={['신규 계정 발급','계정 승인/거절','역할 및 권한 설정','계정 비활성화']} />}
              {can('orders')    && <MenuCard to="/admin/orders" title="발주 관리" desc="파트너 발주 접수, 처리, 출고 상태를 관리합니다." items={['신규 발주 확인','발주 상태 변경','정산 내역 관리','출고/배송 추적']} />}
              {can('products')  && <MenuCard to="/admin/products" title="발주 상품 관리" desc="파트너 포털에 노출되는 발주 카탈로그(카테고리·상품·가격·이미지)를 관리합니다." items={['카테고리 추가/수정/삭제','상품 등록·가격·재고','이미지·이모지 설정','즉시 파트너 포털 반영']} />}
              {can('inventory') && <MenuCard to="/admin/inventory" title="재고 / SKU / LOT" desc="표준 SKU 발급, 재고 추적, LOT 단위 유통기한 관리. FIFO 차감 + D-3 임박 알림." items={['표준 SKU (DAEMU-CAT-NNNN-LL) 자동 발급','LOT 단위 입고 + 유통기한','D-3 임박 알림 + 만료 자동 격리','재고 부족 알림 (< 10)','30일 베스트셀러 TOP']} />}
              {can('stats')     && <MenuCard to="/admin/stats" title="통계 및 리포트" desc="방문자, 문의, 발주 등 주요 지표를 확인합니다." items={['방문자 통계','문의 유입 분석','발주 현황 리포트','월별 매출 추이']} />}
              {can('analytics') && <MenuCard to="/admin/analytics" title="마케팅 분석" desc="페이지뷰·체류시간·UTM·기기별 분포를 자동 집계합니다." items={['일자별 방문 추이','UTM 캠페인 추적','유입 채널 분석 (검색/SNS/직접)','CTA 클릭·폼 제출 카운트','CSV 내보내기 (마케팅 보고서)']} />}
              {can('media')     && <MenuCard to="/admin/media" title="미디어 관리" desc="이미지 및 영상을 업로드하고 관리합니다." items={['이미지 업로드','영상 업로드','미디어 라이브러리','용량 관리']} />}
              {can('mail')      && <MenuCard to="/admin/mail" title="메일 자동회신 설정" desc="상담 문의 접수 시 자동으로 발송되는 회신 메일을 관리합니다." items={['자동회신 템플릿 편집','카테고리별 회신 설정','발송 이력 확인','자동회신 ON/OFF']} />}
              {can('mail-templates') && <MenuCard to="/admin/mail-templates" title="메일 템플릿 라이브러리" desc="여러 개의 메일 템플릿을 저장·재사용하고, 단체 메일을 발송합니다." items={['템플릿 CRUD + 카테고리 분류','{{변수}} 자리표시자','템플릿별 미리보기','단체 발송 (BCC 아닌 1:1 N건)','Resend 연결 시 실발송, 미연결 시 simulated']} />}
              {can('utm-builder') && <MenuCard to="/admin/utm-builder" title="UTM 빌더" desc="마케팅 캠페인 추적용 URL 을 자동 조립합니다. 외부 API 없이 100% 무료." items={['utm_source/medium/campaign 자동 조립','source·medium 프리셋 chip','이력 저장·재사용 (최근 50건)','CSV 내보내기','분석 페이지에서 자동 집계']} />}
            </div>

            <h3 className="admin-section-title" style={{marginTop:'48px'}}>마케팅 / CRM</h3>
            <div className="admin-menu-grid">
              {can('crm')       && <MenuCard to="/admin/crm" title="CRM" desc="리드와 고객 관계를 파이프라인 단계로 관리합니다." items={['리드 → 검토중 → 전환 단계 추적','태그·세그먼트 분류','활동 메모 타임라인','예상 거래 금액']} />}
              {can('campaign')  && <MenuCard to="/admin/campaign" title="캠페인" desc="이메일·SMS·Kakao 캠페인 작성, 예약, 발송, 결과 분석." items={['CRM 단계/태그 기반 세그먼트','즉시 / 예약 / 초안 저장','오픈율·클릭률 추적','뉴스레터 구독자 관리']} />}
              {can('promotion') && <MenuCard to="/admin/promotion" title="프로모션" desc="쿠폰 코드와 이벤트/공지를 관리합니다." items={['정률·정액·1+1 할인','유효기간·최대사용 횟수','실시간 사용량 추적','이벤트/공지 배너']} />}
              {can('announcements') && <MenuCard to="/admin/announcements" title="공지 / 프로모션 (사이트·파트너 포털)" desc="공개 사이트와 파트너 포털 양쪽에 노출할 공지/프로모션을 한 곳에서 작성·예약·관리." items={['공지/프로모션/긴급 3종 분류','공개 사이트 + 파트너 포털 대상 선택','시작/종료 일시 예약 노출','이미지 + CTA 버튼','활성/비활성 즉시 토글']} />}
              {can('popup')     && <MenuCard to="/admin/popup" title="팝업" desc="사이트 팝업 배너를 등록·수정하고 노출 규칙을 관리합니다." items={['중앙/우하단/상단 위치','이미지 + CTA 버튼','노출 빈도 (매번/일1회/영구1회)','타겟 페이지 + 노출/클릭 추적']} />}
              {can('outbox')    && <MenuCard to="/admin/outbox" title="Outbox" desc="이메일·캠페인·계약서 발송 이력을 확인합니다." items={['백엔드 API 호출 로그','시뮬레이션 / 발송완료 / 실패 구분','수신자·제목·본문 검색','데모 환경에서도 발송 시뮬레이션 확인']} />}
              {can('monitoring') && <MenuCard to="/admin/monitoring" title="유지보수 모니터링" desc="운영 중 발생한 오류와 백엔드 헬스를 확인합니다." items={['백엔드 헬스 1분 주기 체크','24시간 발송 실패 카운트','API 호출 오류 누적','브라우저 런타임 에러 수집']} />}
              {can('contracts') && <MenuCard to="/admin/contracts" title="계약서 / 발주서" desc="계약서·발주서 템플릿과 문서를 관리하고 e-Sign 서명을 추적합니다." items={['표준 템플릿 + 변수 치환','고객·프로젝트 연결','이메일 발송 + 서명 링크','캔버스 e-Sign + 감사 이력','PDF 출력 (브라우저 인쇄)']} />}
            </div>

            {(can('users') || can('api-docs')) && (
              <>
                <h3 className="admin-section-title" style={{marginTop:'48px'}}>시스템</h3>
                <div className="admin-menu-grid">
                  {can('users') && (
                    <MenuCard to="/admin/users" title="사용자 권한 관리" desc="관리자 / 테스트 / 개발 권한 계정을 발급하고 관리합니다." items={['신규 계정 발급','권한 변경 (admin · tester · developer)','계정 활성화 / 비활성화','자기 계정 보호 (셀프 권한 강등 차단)']} />
                  )}
                  {can('api-docs') && (
                    <MenuCard to="/admin/api-docs" title="API 문서" desc="FastAPI /docs 자동 Swagger UI 의 사이트 디자인 대체 페이지." items={['/openapi.json 실시간 동기화','검색 + tag/method 필터','GET try-it (토큰 자동 첨부)','endpoint 별 parameters/responses 스키마 표시']} />
                  )}
                  {can('security') && (
                    <MenuCard to="/admin/security" title="보안 모니터링" desc="인증 실패 / 의심 IP / 보안 이벤트만 모은 실시간 전용 페이지." items={['30초 주기 자동 갱신','위험도 LOW/MEDIUM/HIGH 단계','의심 IP 표 + 24h 이벤트 분포','외부 보안 endpoint 연동(추후 결제 서버용)','권장 OSS 보안 도구 가이드']} />
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </AdminShell>
  );
}

// 개발자 IP 화이트리스트 입력기 — localStorage 'daemu_dev_ip_whitelist' 에
// 콤마 구분 문자열로 저장. 모니터링/analytics 의 ipFilter() 헬퍼가 그 값을
// 읽어 자동 필터링한다.
function DevIpWhitelistEditor() {
  const [val, setVal] = useState(() => {
    try { return localStorage.getItem('daemu_dev_ip_whitelist') || ''; }
    catch { return ''; }
  });
  const save = () => {
    try {
      const cleaned = String(val || '').split(/[,\s]+/).filter(Boolean).join(', ');
      localStorage.setItem('daemu_dev_ip_whitelist', cleaned);
      setVal(cleaned);
      try { siteToast(cleaned ? 'IP 화이트리스트 저장됨' : 'IP 화이트리스트 비움'); } catch { /* ignore */ }
    } catch { /* ignore */ }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="text" value={val} onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        placeholder="121.130.1.1, 192.168.0.0/24"
        style={{ flex: '1 1 320px', padding: '7px 10px', border: '1px solid #d7d4cf', background: '#fff', fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12 }} />
      <button type="button" className="adm-btn-sm" onClick={save}>저장</button>
    </div>
  );
}

function MenuCard({ to, title, desc, items }) {
  return (
    <div className="admin-menu-card">
      <h4>{title}</h4>
      <p>{desc}</p>
      <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>
      <Link to={to} className="btn admin-menu-btn">관리하기</Link>
    </div>
  );
}
