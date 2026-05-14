// 사이트 팝업 — React + createPortal로 document.body에 mount.
//
// useSitePopups()이 반환하는 sanitised popup record를 받아 React가 직접
// 렌더링합니다. React가 자동으로 text content와 attribute를 escape하므로
// Snyk DOM-XSS taint tracker가 추적할 흐름이 존재하지 않습니다.
//
// popup 객체는 useSitePopups의 sanitisePopup() 단계에서 모든 필드가 이미
// primitive로 검증된 상태입니다. 추가 sanitize는 불필요하지만 안전을 위해
// safe~ helper도 한 번 더 통과시킵니다.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dismissPopup, bumpMetric } from '../hooks/useSitePopups.js';
import { safeUrl, safeMediaUrl } from '../lib/safe.js';

export default function SitePopupOverlay({ popup }) {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [skip, setSkip] = useState(false);
  const overlayRef = useRef(null);
  const closeTimerRef = useRef(null);

  // popup prop 이 바뀌면 모든 내부 state 를 reset 해야 새 팝업이 정상 노출됨.
  useEffect(() => {
    if (!popup) return;
    setClosed(false);
    setClosing(false);
    setShown(false);
    setSkip(false);
    const t = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(t);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [popup]);

  if (!popup) return null;
  // close 후 transition 종료되면 portal 완전 제거 — DOM 에 잔존하던
  // 투명 overlay 가 nav/page 클릭을 가로채던 회귀 차단.
  if (closed) return null;

  const close = () => {
    dismissPopup(popup, skip);
    setClosing(true);
    setShown(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setClosing(false);
      setClosed(true);
      closeTimerRef.current = null;
    }, 320);
  };

  // React already escapes text and HTML-encodes attribute values; we apply
  // the dedicated allow-list helpers ONE more time so Snyk sees a verified
  // primitive at the JSX boundary.
  const safeImg = safeMediaUrl(popup.image);
  const safeCtaUrl = safeUrl(popup.ctaUrl);

  // closing 동안에는 portal에서 떼어내지 않음 (transition 유지). 부모가
  // popup=null로 바꾸면 컴포넌트 자체가 unmount되어 사라짐.
  if (closing) {
    return createPortal(
      <div ref={overlayRef} className={`site-popup-overlay site-popup-pos-${popup.position}`}>
        <div className="site-popup-box">
          {/* 비어있는 placeholder — fade-out transition 동안 빈 박스 유지 */}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={`site-popup-overlay site-popup-pos-${popup.position}${shown ? ' is-shown' : ''}`}
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div className="site-popup-box">
        <button type="button" className="site-popup-close" aria-label="닫기" onClick={close}>×</button>
        {safeImg && <img className="site-popup-image" src={safeImg} alt="" />}
        <div className="site-popup-body">
          {popup.title && <h3>{popup.title}</h3>}
          {popup.body && <p>{popup.body}</p>}
          {popup.ctaText && safeCtaUrl && (
            <a
              className="site-popup-cta"
              href={safeCtaUrl}
              rel="noopener noreferrer"
              onClick={() => bumpMetric(popup.id, 'clicks')}
            >
              {popup.ctaText}
            </a>
          )}
        </div>
        {popup.frequency !== 'always' && (
          <label className="site-popup-skip">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            오늘 하루 보지 않기
          </label>
        )}
      </div>
    </div>,
    document.body,
  );
}
