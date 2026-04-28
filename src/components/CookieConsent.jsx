import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ga4ConsentStatus, setGa4Consent } from '../lib/analytics.js';
import { isGa4Configured } from '../lib/config.js';

// PIPA Art. 22 / GDPR Art. 7 — explicit, granular, opt-in consent before
// any non-essential tracking. The banner appears only if VITE_GA4_ID is
// configured AND the user hasn't made a choice yet. Plausible (cookieless)
// runs without consent because it doesn't process personal data.
export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isGa4Configured()) return;
    if (ga4ConsentStatus() === 'unknown') {
      // delay banner so it doesn't fight with splash
      const t = setTimeout(() => setShow(true), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  if (!show) return null;

  const accept = () => { setGa4Consent('granted'); setShow(false); };
  const decline = () => { setGa4Consent('denied'); setShow(false); };

  return (
    <div role="dialog" aria-label="쿠키 사용 동의" style={wrapStyle}>
      <div style={textStyle}>
        <strong style={{ color: '#111' }}>쿠키 사용 안내</strong>
        <span style={{ marginLeft: 8 }}>
          서비스 개선을 위해 Google Analytics(익명·IP 마스킹)를 사용합니다.{' '}
          <Link to="/privacy" style={{ textDecoration: 'underline' }}>개인정보처리방침</Link>{' '}
          에서 자세한 내용을 확인하실 수 있습니다.
        </span>
      </div>
      <div style={buttonRowStyle}>
        <button type="button" onClick={decline} style={btnGhost}>거부</button>
        <button type="button" onClick={accept} style={btnPrimary}>동의</button>
      </div>
    </div>
  );
}

const wrapStyle = {
  position: 'fixed',
  bottom: 16,
  left: 16,
  right: 16,
  maxWidth: 720,
  margin: '0 auto',
  padding: '14px 18px',
  background: '#2a2724',
  color: '#f6f4f0',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  zIndex: 9000,
  fontSize: 13,
  lineHeight: 1.6,
  boxShadow: '0 8px 28px rgba(0,0,0,.18)',
  borderRadius: 4,
};
const textStyle = { paddingRight: 0 };
const buttonRowStyle = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const btnGhost = {
  background: 'transparent',
  color: '#f6f4f0',
  border: '1px solid rgba(246,244,240,.5)',
  padding: '8px 18px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};
const btnPrimary = {
  background: '#f6f4f0',
  color: '#2a2724',
  border: '1px solid #f6f4f0',
  padding: '8px 18px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};
