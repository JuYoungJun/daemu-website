import { useState } from 'react';
import { Auth } from '../lib/auth.js';

export default function ChangePasswordForm({ forced, onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function strengthMessage(pwd) {
    if (pwd.length < 8) return '최소 8자 이상';
    const classes = [/\d/, /[a-zA-Z]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pwd)).length;
    if (classes < 2) return '영문/숫자/특수문자 중 2종류 이상';
    if (['daemu1234', 'tester1234', 'dev1234', 'password', '12345678', 'admin1234'].includes(pwd.toLowerCase())) {
      return '너무 자주 쓰이는 비밀번호';
    }
    return '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('새 비밀번호와 확인이 일치하지 않습니다.');
      return;
    }
    const weakness = strengthMessage(next);
    if (weakness) {
      setError(weakness);
      return;
    }
    setSubmitting(true);
    const r = await Auth.changePassword(current, next);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error || '비밀번호 변경 실패');
      return;
    }
    setCurrent(''); setNext(''); setConfirm('');
    if (typeof onDone === 'function') onDone();
  }

  return (
    <div className="admin-login-wrap" style={{ paddingTop: 24 }}>
      <div className="admin-login-box" style={{ maxWidth: 420 }}>
        <h2 style={{ marginBottom: 4 }}>{forced ? '비밀번호 변경 (필수)' : '비밀번호 변경'}</h2>
        <p style={{ marginBottom: 18 }}>
          {forced
            ? '관리자가 발급한 임시 비밀번호를 사용 중입니다. 보안을 위해 새 비밀번호로 변경해 주세요.'
            : '현재 비밀번호를 입력하고 새 비밀번호를 설정합니다.'}
        </p>
        <form onSubmit={onSubmit}>
          <div className="admin-login-field">
            <input type="password" required placeholder="현재 비밀번호" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="admin-login-field">
            <input type="password" required placeholder="새 비밀번호 (8자 이상, 2종류)" autoComplete="new-password" minLength={8}
              value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="admin-login-field">
            <input type="password" required placeholder="새 비밀번호 확인" autoComplete="new-password" minLength={8}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {next && (
            <div style={{ fontSize: 11, color: strengthMessage(next) ? '#b04a3b' : '#2f7d4d', margin: '4px 0 12px' }}>
              {strengthMessage(next) ? `⚠ ${strengthMessage(next)}` : '✓ 비밀번호 강도 OK'}
            </div>
          )}
          {error && <div style={{ color: '#b04a3b', fontSize: 12, margin: '4px 0 12px' }}>{error}</div>}
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? '저장 중…' : '비밀번호 변경'}
          </button>
        </form>
      </div>
    </div>
  );
}
