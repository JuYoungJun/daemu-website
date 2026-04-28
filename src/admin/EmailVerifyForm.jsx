// 첫 접속 어드민 이메일 인증.
//
// 백엔드의 POST /api/auth/email-verify/send 로 6자리 코드 발송 요청 →
// 사용자 이메일에서 코드 확인 → POST /confirm 으로 검증.
// 검증 완료 시 onVerified() 호출로 다음 단계(비밀번호 변경)로 진입.
//
// RESEND_API_KEY 가 미설정이면 simulated 모드로 동작 — 코드는 백엔드 stdout
// 에만 출력되어 운영자가 로그를 보고 직접 알려주거나 .env 등록이 필요.

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const RESEND_COOLDOWN = 60; // 백엔드와 동일

export default function EmailVerifyForm({ email, onVerified, onLogout }) {
  const [step, setStep] = useState('send'); // 'send' | 'confirm'
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

  const sendCode = async () => {
    setError(''); setInfo(''); setLoading(true);
    try {
      const r = await api.post('/api/auth/email-verify/send', {});
      setLoading(false);
      if (!r.ok) {
        setError(r.error || '코드 발송에 실패했습니다.');
        return;
      }
      setSimulated(!!r.simulated);
      setStep('confirm');
      startCooldown(RESEND_COOLDOWN);
      setInfo(r.simulated
        ? '시뮬레이션 모드 — 코드가 백엔드 콘솔(stdout)에 출력됩니다. 운영자에게 확인 요청하세요.'
        : `${email} 로 6자리 인증 코드를 발송했습니다. 5분 안에 입력해 주세요.`);
    } catch (e) {
      setLoading(false);
      setError(String(e));
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
        setError(r.error || '코드 검증 실패');
        return;
      }
      onVerified();
    } catch (err) {
      setLoading(false);
      setError(String(err));
    }
  };

  return (
    <div style={{
      maxWidth: 460, margin: '40px auto', background: '#fff', border: '1px solid #d7d4cf',
      padding: '36px 38px',
    }}>
      <h2 style={{ fontSize: 20, fontFamily: "'Cormorant Garamond', Georgia, serif", margin: '0 0 8px', color: '#231815' }}>
        이메일 인증이 필요합니다
      </h2>
      <p style={{ fontSize: 13, color: '#5a534b', lineHeight: 1.7, margin: '0 0 24px' }}>
        첫 접속 시 본인 확인을 위해 등록된 이메일 주소로 6자리 코드를 발송합니다.
        인증이 완료되면 새 비밀번호를 설정한 뒤 정상 접속이 가능합니다.
      </p>

      <div style={{ background: '#f6f4f0', padding: '12px 14px', marginBottom: 18, borderLeft: '3px solid #1f5e7c', fontSize: 12.5, color: '#2a2724' }}>
        <strong style={{ marginRight: 6 }}>인증 메일 받는 주소:</strong>
        <code style={{ background: '#fff', padding: '2px 8px' }}>{String(email || '')}</code>
      </div>

      {step === 'send' ? (
        <button type="button" className="btn" disabled={loading}
          onClick={sendCode} style={{ width: '100%' }}>
          {loading ? '발송 중…' : '인증 코드 발송'}
        </button>
      ) : (
        <form onSubmit={confirmCode} style={{ display: 'grid', gap: 14 }}>
          {info && <div style={{
            background: simulated ? '#fff8ec' : '#eef6ee',
            border: '1px solid ' + (simulated ? '#f0e3c4' : '#cfe5cf'),
            padding: '10px 14px', fontSize: 12, color: simulated ? '#5a4a2a' : '#2e7d32',
          }}>{info}</div>}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <button type="button" disabled={cooldown > 0 || loading} onClick={sendCode}
              style={{ background: 'transparent', border: 'none', color: cooldown > 0 ? '#b9b5ae' : '#1f5e7c', cursor: cooldown > 0 ? 'default' : 'pointer', textDecoration: cooldown > 0 ? 'none' : 'underline' }}>
              {cooldown > 0 ? `재발송 가능 ${cooldown}초 후` : '코드 다시 받기'}
            </button>
            <button type="button" onClick={onLogout}
              style={{ background: 'transparent', border: 'none', color: '#b04a3b', cursor: 'pointer', textDecoration: 'underline' }}>
              다른 계정으로 로그인
            </button>
          </div>
        </form>
      )}

      {error && <p style={{ color: '#c0392b', fontSize: 12.5, marginTop: 14, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
