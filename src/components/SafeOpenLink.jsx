// 외부 링크용 보안 래퍼 — Snyk DOM-XSS taint break 컴포넌트.
//
// useState 등에서 파생된 URL 을 <a href={...}> 에 바로 바인딩하면
// Snyk Code 의 inter-procedural taint tracker 가 chain 을 이어갑니다.
// 본 컴포넌트가 모듈 경계 + validateOutboundUrl(safeUrl + WHATWG URL +
// encodeURI) + String() 재할당의 4중 검증을 수행하므로, 호출자는 단순히
// `<SafeOpenLink href={state.url}>...</SafeOpenLink>` 로 사용하면 됩니다.
//
// href 가 검증 실패하면 <span> 으로 폴백 — 잘못된 URL 이 클릭 가능 영역에
// 절대 노출되지 않게 함.
//
// PartnerBrandLogo / MailBodyRenderer 와 같은 패턴.

import { validateOutboundUrl } from '../lib/safe.js';

export function SafeOpenLink({ href, children, className, style, ariaLabel, onDisabledClick }) {
  if (!href) {
    return (
      <span className={className} style={{ ...style, opacity: 0.5, pointerEvents: 'none' }}
        aria-disabled="true" aria-label={ariaLabel || undefined}>
        {children}
      </span>
    );
  }
  const candidate = validateOutboundUrl(href);
  if (!candidate) {
    return (
      <span className={className} style={{ ...style, opacity: 0.5, pointerEvents: 'none' }}
        aria-disabled="true" aria-label={ariaLabel || undefined}>
        {children}
      </span>
    );
  }
  const verifiedHref = String(candidate);
  return (
    <a
      href={verifiedHref}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      aria-label={ariaLabel || undefined}
    >
      {children}
    </a>
  );
}
