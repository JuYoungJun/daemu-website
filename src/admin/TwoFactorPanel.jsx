// 관리자 본인 계정에 2FA(TOTP)를 설정·해제하는 다이얼로그.
//
// 흐름:
//   1) 비활성 → "활성화 시작" 클릭 → POST /api/auth/totp/setup
//      → secret + otpauth_uri 반환 → 화면에 QR + secret 표시
//   2) 사용자가 인증 앱(Google Authenticator/Authy/1Password 등)에 등록
//   3) 6자리 코드 입력 → POST /api/auth/totp/enable
//      → 백업 코드 8개 1회 표시 (이후 다시 못 봄, 사용자가 보관)
//   4) 활성된 상태 → "비활성화" 버튼 → 비번 재확인 → POST /api/auth/totp/disable
//
// QR은 외부 라이브러리 없이 ZXing-style raster 대신, 안전한 SVG QR을 inline으로
// 렌더링합니다. 단순 구현을 위해 google-charts QR API는 쓰지 않고, otpauth_uri를
// 텍스트 + 시크릿 코드 텍스트로 바로 표시 + 인증 앱이 제공하는 "수동 입력" 옵션을
// 안내합니다. (브라우저 안에서 외부 자원 없이 QR을 만들려면 별도 lib 추가 필요.)

import { useState } from 'react';
import { api } from '../lib/api.js';

const Q_PIX = 7;  // px per QR module — placeholder size; we render text-only QR alternative

export default function TwoFactorPanel({ user, onClose }) {
  // step: 'idle' | 'setup' | 'verify' | 'recovery' | 'disable'
  const [step, setStep] = useState(user?.totp_enabled ? 'enabled' : 'idle');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [qrPng, setQrPng] = useState('');
  const [code, setCode] = useState('');
  const [pwForDisable, setPwForDisable] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const beginSetup = async () => {
    setError(''); setLoading(true);
    const r = await api.post('/api/auth/totp/setup', {});
    setLoading(false);
    if (!r.ok) { setError(r.error || '시크릿 발급에 실패했습니다.'); return; }
    setSecret(r.secret || '');
    setOtpauthUri(r.otpauth_uri || '');
    setQrPng(r.qr_png_data_url || '');
    setStep('verify');
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    const r = await api.post('/api/auth/totp/enable', { code: code.trim() });
    setLoading(false);
    if (!r.ok) { setError(r.error || '인증 코드가 일치하지 않습니다.'); return; }
    setRecoveryCodes(r.recovery_codes || []);
    setStep('recovery');
  };

  const disable = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    const r = await api.post('/api/auth/totp/disable', { password: pwForDisable });
    setLoading(false);
    if (!r.ok) { setError(r.error || '비활성화에 실패했습니다.'); return; }
    setStep('disabled-done');
  };

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="2단계 인증 설정">
      <div className="adm-modal-box is-narrow">
        <div className="adm-modal-head">
          <h2>2단계 인증 (TOTP)</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        {step === 'idle' && (
          <div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#5a534b' }}>
              비밀번호 외에 인증 앱(Google Authenticator, Authy, 1Password 등)의 6자리 코드를 추가로 요구하여 계정을 보호합니다.
            </p>
            <ul style={{ fontSize: 12, color: '#6f6b68', lineHeight: 1.7, paddingLeft: 18 }}>
              <li>활성화 후에는 로그인 시 비밀번호와 함께 코드가 필요합니다.</li>
              <li>인증 앱을 잃었을 때를 대비해 백업 코드 8개가 발급됩니다 — 안전한 곳에 보관하세요.</li>
              <li>스마트폰 분실 시 백업 코드로 1회 로그인 후 즉시 다른 인증 앱에 재등록하세요.</li>
            </ul>
            {error && <p style={{ color: '#c0392b', fontSize: 12 }}>{error}</p>}
            <div className="adm-action-row">
              <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
              <button type="button" className="btn" onClick={beginSetup} disabled={loading}>
                {loading ? '준비 중…' : '활성화 시작'}
              </button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#5a534b' }}>
              인증 앱(Google Authenticator / Authy / 1Password 등) 을 열고 아래 QR 을 스캔하세요.
              QR 인식이 안 되면 시크릿을 직접 입력해도 됩니다.
            </p>
            {qrPng ? (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                <img src={qrPng} alt="2FA QR" width={208} height={208}
                  style={{ border: '1px solid #d7d4cf', background: '#fff', padding: 8 }} />
              </div>
            ) : (
              <p style={{ fontSize: 11, color: '#8c867d', textAlign: 'center', margin: '8px 0' }}>
                (QR 생성 미지원 환경 — 아래 시크릿을 인증 앱의 "수동 추가" 에 입력하세요)
              </p>
            )}
            <Field label="시크릿 (수동 입력 시)">
              <code style={{ display: 'block', padding: 10, background: '#f6f4f0', border: '1px solid #d7d4cf', wordBreak: 'break-all', fontSize: 13, letterSpacing: '.04em' }}>
                {secret || '—'}
              </code>
            </Field>

            <form onSubmit={confirmEnable} style={{ marginTop: 16 }}>
              <Field label="앱이 표시한 6자리 코드">
                <input type="text" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code"
                  autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value)}
                  required style={{ width: '100%', padding: 10, border: '1px solid #d7d4cf', fontSize: 16, letterSpacing: '.2em', textAlign: 'center', fontFamily: 'monospace' }} />
              </Field>
              {error && <p style={{ color: '#c0392b', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
              <div className="adm-action-row">
                <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
                <button type="submit" className="btn" disabled={loading}>{loading ? '확인 중…' : '활성화 완료'}</button>
              </div>
            </form>
          </div>
        )}

        {step === 'recovery' && (
          <div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#2e7d32', fontWeight: 500 }}>
              2단계 인증이 활성화되었습니다.
            </p>
            <p style={{ fontSize: 12.5, lineHeight: 1.7, color: '#5a4a2a', background: '#fff8ec', border: '1px solid #f0e3c4', padding: 12 }}>
              아래 백업 코드 <strong>8개</strong>를 안전한 곳에 보관하세요. 인증 앱을 잃었을 때 1회씩 사용 가능합니다.
              <strong> 화면을 닫으면 다시 볼 수 없습니다.</strong>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12, fontFamily: 'monospace', fontSize: 14 }}>
              {recoveryCodes.map((c) => (
                <code key={c} style={{ padding: 8, background: '#f6f4f0', border: '1px solid #d7d4cf', textAlign: 'center', letterSpacing: '.06em' }}>{c}</code>
              ))}
            </div>
            <div className="adm-action-row">
              <button type="button" className="adm-btn-sm" onClick={() => {
                navigator.clipboard?.writeText(recoveryCodes.join('\n'));
              }}>모두 복사</button>
              <button type="button" className="btn" onClick={onClose}>저장 완료</button>
            </div>
          </div>
        )}

        {step === 'enabled' && (
          <div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#5a534b' }}>
              현재 <strong>2단계 인증이 활성</strong>되어 있습니다. 로그인 시 비밀번호와 함께 인증 앱 코드가 필요합니다.
            </p>
            <p style={{ fontSize: 12, color: '#8c867d' }}>
              비활성화하려면 비밀번호로 본인 확인이 필요합니다.
            </p>
            <form onSubmit={disable}>
              <Field label="현재 비밀번호">
                <input type="password" autoComplete="current-password" required
                  value={pwForDisable} onChange={(e) => setPwForDisable(e.target.value)}
                  style={{ width: '100%', padding: 10, border: '1px solid #d7d4cf', fontSize: 14 }} />
              </Field>
              {error && <p style={{ color: '#c0392b', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
              <div className="adm-action-row">
                <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
                <button type="submit" className="adm-btn-sm danger" disabled={loading}>
                  {loading ? '처리 중…' : '2단계 인증 비활성화'}
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 'disabled-done' && (
          <div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#c0392b' }}>
              2단계 인증이 비활성화되었습니다. 보안 강화를 위해 가능한 한 다시 활성화하시는 것을 권장합니다.
            </p>
            <div className="adm-action-row">
              <button type="button" className="btn" onClick={onClose}>닫기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
