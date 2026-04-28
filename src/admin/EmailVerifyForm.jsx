// 첫 접속 어드민 이메일 인증.
//
// 흐름:
//   step='enter'   — 본인의 실제 이메일 주소 입력
//   step='confirm' — 받은 6자리 코드 입력
//
// 검증 완료 시 user.email 이 입력값으로 갱신됩니다 (이전엔 슈퍼관리자가
// 임시 발급한 placeholder 였음). onVerified() 콜백으로 다음 단계
// (비밀번호 변경) 진입.
//
// 슈퍼관리자(데모 계정)는 백엔드 seeds 단계에서 email_verified_at 이
// 채워져 있어 이 화면 자체가 표시되지 않습니다.

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const RESEND_COOLDOWN = 60; // 백엔드와 동일

export default function EmailVerifyForm({ email, onVerified, onLogout }) {
  const [step, setStep] = useState('enter');
  const [newEmail, setNewEmail] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [simulated, setSimulated] = useState(false);
  const tickRef = useRef(null);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  const startCooldown = (seconds) => {
    setCooldown(seconds);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(tickRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async (e) => {
    if (e) e.preventDefault();
    setError(''); setInfo('');
    const trimmed = (newEmail || '').trim();
    if (!trimmed) {
      setError('본인이 사용할 이메일 주소를 입력하세요.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError('올바른 이메일 형식이 아닙니다.');
      return;
    }
    setLoading(true);
    try {
      const r = await api.post('/api/auth/email-verify/send', { new_email: trimmed });
      setLoading(false);
      if (!r.ok) {
        setError(r.error || r.detail || '코드 발송에 실패했습니다.');
        return;
      }
      setSimulated(!!r.simulated);
      setTargetEmail(r.target_email || trimmed);
      setStep('confirm');
      startCooldown(RESEND_COOLDOWN);
      setInfo(r.simulated
        ? '시뮬레이션 모드 — 코드가 백엔드 콘솔(stdout)에 출력됩니다. Render Logs 또는 운영자 확인 필요.'
        : `${r.target_email || trimmed} 로 6자리 인증 코드를 발송했습니다. 5분 안에 입력해 주세요.`);
    } catch (err) {
      setLoading(false);
      setError(String(err));
    }
  };

  const resend = async () => {
    if (cooldown > 0 || loading) return;
    setError(''); setInfo('');
    setLoading(true);
    try {
      const r = await api.post('/api/auth/email-verify/send', { new_email: targetEmail });
      setLoading(false);
      if (!r.ok) {
        setError(r.error || r.detail || '코드 재발송 실패');
        return;
      }
      setSimulated(!!r.simulated);
      startCooldown(RESEND_COOLDOWN);
      setInfo('코드를 다시 발송했습니다.');
    } catch (err) {
      setLoading(false);
      setError(String(err));
    }
  };

  const confirmCode = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('6자리 숫자 코드를 입력하세요.');
      return;
    }
    setLoading(true);
    try {
      const r = await api.post('/api/auth/email-verify/confirm', { code: code.trim() });
      setLoading(false);
      if (!r.ok) {
        setError(r.error || r.detail || '코드 검증 실패');
        return;
      }
      onVerified(r.email || targetEmail);
    } catch (err) {
      setLoading(false);
      setError(String(err));
    }
  };

  return (
    <div style={{
      maxWidth: 520, margin: '40px auto', background: '#fff', border: '1px solid #d7d4cf',
      padding: '36px 38px',
    }}>
      <h2 style={{ fontSize: 20, fontFamily: "'Cormorant Garamond', Georgia, serif", margin: '0 0 8px', color: '#231815' }}>
        이메일 인증이 필요합니다
      </h2>
      <p style={{ fontSize: 13, color: '#5a534b', lineHeight: 1.7, margin: '0 0 18px' }}>
        실제 사용하실 이메일 주소를 입력해 주세요. 입력하신 주소로 6자리 인증 코드가 발송되며,
        검증이 완료되면 그 주소가 새 로그인 ID 가 됩니다.
      </p>

      {step === 'enter' ? (
        <form onSubmit={sendCode} style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: '#f6f4f0', padding: '10px 12px', borderLeft: '3px solid #b9b5ae', fontSize: 12, color: '#5a534b' }}>
            <strong style={{ marginRight: 6, color: '#8c867d' }}>현재 임시 ID:</strong>
            <code style={{ background: '#fff', padding: '2px 8px', fontSize: 11.5 }}>{String(email || '')}</code>
            <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>
              아래에 본인이 사용할 실제 이메일을 입력하면 그것으로 갱신됩니다.
            </div>
          </div>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>
              사용할 이메일 (실제 받을 수 있는 주소)
            </span>
            <input type="email" required autoFocus inputMode="email" autoComplete="email"
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              placeholder="example@yourcompany.com"
              style={{ width: '100%', padding: '12px 14px', fontSize: 14, border: '1px solid #d7d4cf', background: '#fff' }} />
          </label>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? '발송 중…' : '인증 코드 발송'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <button type="button" onClick={onLogout}
              style={{ background: 'transparent', border: 'none', color: '#b04a3b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
              다른 계정으로 로그인
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirmCode} style={{ display: 'grid', gap: 14 }}>
          {info && <div style={{
            background: simulated ? '#fff8ec' : '#eef6ee',
            border: '1px solid ' + (simulated ? '#f0e3c4' : '#cfe5cf'),
            padding: '10px 14px', fontSize: 12, color: simulated ? '#5a4a2a' : '#2e7d32',
          }}>{info}</div>}
          <div style={{ background: '#f6f4f0', padding: '10px 12px', borderLeft: '3px solid #1f5e7c', fontSize: 12, color: '#2a2724' }}>
            <strong style={{ marginRight: 6 }}>인증 메일 받는 주소:</strong>
            <code style={{ background: '#fff', padding: '2px 8px' }}>{targetEmail}</code>
          </div>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>
              인증 코드 (6자리)
            </span>
            <input type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} pattern="\d{6}" required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ width: '100%', padding: '12px 14px', fontSize: 18, letterSpacing: '.4em', textAlign: 'center',
                fontFamily: 'monospace', border: '1px solid #d7d4cf', background: '#fff' }} />
          </label>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? '검증 중…' : '인증하고 다음 단계로'}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { setStep('enter'); setCode(''); setInfo(''); setError(''); }}
              style={{ background: 'transparent', border: 'none', color: '#5a534b', cursor: 'pointer', textDecoration: 'underline' }}>
              ← 이메일 다시 입력
            </button>
            <button type="button" disabled={cooldown > 0 || loading} onClick={resend}
              style={{ background: 'transparent', border: 'none', color: cooldown > 0 ? '#b9b5ae' : '#1f5e7c', cursor: cooldown > 0 ? 'default' : 'pointer', textDecoration: cooldown > 0 ? 'none' : 'underline' }}>
              {cooldown > 0 ? `재발송 가능 ${cooldown}초 후` : '코드 다시 받기'}
            </button>
            <button type="button" onClick={onLogout}
              style={{ background: 'transparent', border: 'none', color: '#b04a3b', cursor: 'pointer', textDecoration: 'underline' }}>
              로그아웃
            </button>
          </div>
        </form>
      )}

      {error && <p style={{ color: '#c0392b', fontSize: 12.5, marginTop: 14, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
