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

  // 클라이언트 피드백 PDF p.3: "심볼 삭제, 스플래시 영문 + 슬로건 만"
  //   · logo.svg 안에 wordmark + ㅁ 심볼이 한 이미지로 들어있어 이미지를
  //     그대로 쓰면 ㅁ 가 따라옴. 그래서 이미지 자체를 안 쓰고 CSS-only
  //     텍스트 'DAEMU' 로 wordmark 표현 → 심볼 원천 차단.
  //   · 영문 wordmark + 한글 슬로건만 노출.
  return createPortal(
    <div className={cls} aria-hidden="true">
      <div className="site-splash-content">
        <div className="site-splash-logo-area">
          <div className="site-splash-glow"></div>
          <div className="site-splash-text-wordmark" aria-label="DAEMU">DAEMU</div>
        </div>
        <p className="site-splash-subtitle">기획은 많습니다. 실행까지 책임지는 팀은 많지 않습니다.</p>
      </div>
    </div>,
    document.body
  );
}
