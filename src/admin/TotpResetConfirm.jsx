// 2FA 분실 복구 — 이메일 링크의 token 을 검증하고 backend 에 confirm.
// /admin/totp-reset?token=... 으로 도착.
//
// 흐름:
//   1) URL 에서 token 추출
//   2) POST /api/auth/totp-reset-confirm { token }
//   3) 성공 → 안내 + /admin 로 이동 (사용자가 비밀번호로 다시 로그인)
//   4) 실패 → 에러 메시지 + 다시 요청 안내

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import { api } from '../lib/api.js';

export default function TotpResetConfirm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [status, setStatus] = useState('loading');  // loading | done | error
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('복구 링크가 올바르지 않습니다. 메일에서 다시 확인해 주세요.');
      return;
    }
    (async () => {
      const r = await api.post('/api/auth/totp-reset-confirm', { token });
      if (r.ok) {
        setStatus('done');
        setEmail(r.email || '');
        setMessage('');
      } else {
        setStatus('error');
        setMessage(r.error || '복구 처리에 실패했습니다.');
      }
    })();
  }, [token]);

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide admin-page">
          <h1 className="page-title">2단계 인증 복구</h1>
          <div className="admin-login-wrap">
            <div className="admin-login-box" style={{ maxWidth: 480 }}>
              {status === 'loading' && (
                <p style={{ fontSize: 13, color: '#5a534b' }}>복구 링크를 검증하는 중입니다…</p>
              )}
              {status === 'done' && (
                <>
                  <h2 style={{ color: '#2e7d32' }}>✓ 2단계 인증이 해제되었습니다</h2>
                  <p style={{ fontSize: 13, color: '#5a534b', lineHeight: 1.7, marginTop: 12 }}>
                    {email && <><strong>{email}</strong> 계정의 2단계 인증이 해제되었습니다.</>}<br />
                    다음 화면에서 로그인하면 <strong>비밀번호 변경</strong>이 자동으로 요구됩니다.
                  </p>
                  <p style={{ fontSize: 12, color: '#b87333', background: '#fff8ec', border: '1px solid #f0e3c4', padding: '10px 12px', borderRadius: 4, marginTop: 16, lineHeight: 1.6 }}>
                    🔒 <strong>보안 정책</strong> (3단계):<br />
                    1. 로그인 → <strong>비밀번호 강제 교체</strong> (탈취된 비번 재사용 차단)<br />
                    2. 비번 변경 후 → 즉시 <strong>새 인증 앱으로 2FA 다시 등록</strong><br />
                    3. 본인이 요청한 게 아니라면 즉시 운영자에게 신고
                  </p>
                  <button type="button" className="btn" onClick={() => navigate('/admin', { replace: true })}
                    style={{ marginTop: 20, width: '100%' }}>
                    로그인 화면으로
                  </button>
                </>
              )}
              {status === 'error' && (
                <>
                  <h2 style={{ color: '#c0392b' }}>복구 실패</h2>
                  <p style={{ fontSize: 13, color: '#5a534b', lineHeight: 1.7, marginTop: 12 }}>
                    {message || '복구 링크가 만료되었거나 유효하지 않습니다.'}
                  </p>
                  <p style={{ fontSize: 12, color: '#8c867d', marginTop: 12 }}>
                    링크는 발송 후 5분간 유효하며 1회만 사용할 수 있습니다.
                    다시 시도하시려면 로그인 화면에서 "2단계 인증 분실?" 을 다시 눌러 주세요.
                  </p>
                  <button type="button" className="btn" onClick={() => navigate('/admin', { replace: true })}
                    style={{ marginTop: 20, width: '100%' }}>
                    로그인 화면으로
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </main>
    </AdminShell>
  );
}
