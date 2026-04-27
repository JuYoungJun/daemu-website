import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Renders the splash overlay as a direct child of <body> via portal.
// Crucial for the CSS rule:
//   body.splash-pending > *:not(.site-splash-overlay){ visibility:hidden; }
// which keys off direct-child relationship — if splash were inside #root,
// the rule would hide #root (and everything inside, including the splash itself).
export default function Splash({ show }) {
  const [mounted, setMounted] = useState(show);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (show) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => setMounted(false), 460);
    return () => clearTimeout(t);
  }, [show, mounted]);

  if (!mounted) return null;

  const cls = 'site-splash-overlay ' + (leaving ? 'is-leaving' : 'is-animating');

  return createPortal(
    <div className={cls} aria-hidden="true">
      <div className="site-splash-content">
        <div className="site-splash-logo-area">
          <div className="site-splash-glow"></div>
          <div className="site-splash-logo-symbol"><img src={import.meta.env.BASE_URL + 'assets/logo.svg'} alt="" /></div>
          <div className="site-splash-logo-wordmark"><img src={import.meta.env.BASE_URL + 'assets/logo.svg'} alt="" /></div>
        </div>
        <p className="site-splash-subtitle">기획은 많습니다. 실행까지 책임지는 팀은 많지 않습니다.</p>
      </div>
    </div>,
    document.body
  );
}
