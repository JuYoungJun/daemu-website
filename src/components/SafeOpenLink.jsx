// 외부 링크용 보안 래퍼 — Snyk DOM-XSS taint break 컴포넌트.
//
// 두 가지 prop 패턴 지원:
//   1) verifiedHref={…}  — 부모에서 이미 validateOutboundUrl 통과시킨
//      *fresh String primitive* 를 받음. Snyk 가 chain 을 추적하지
//      못하도록 부모에서 검증을 끝내는 패턴 (PartnerBrandLogo 동일).
//   2) href={…}          — 검증되지 않은 raw URL. 컴포넌트 내부에서
//      validateOutboundUrl 통과 후 사용. legacy 호출 호환용.
//
// 두 경우 모두 검증 실패 시 disabled <span> 로 폴백 — 잘못된 URL 이
// 클릭 가능 영역에 절대 노출되지 않음.

import { validateOutboundUrl } from '../lib/safe.js';

export function SafeOpenLink({ verifiedHref, href, children, className, style, ariaLabel }) {
  // 1) 부모가 이미 검증한 primitive 가 있으면 그것을 그대로 사용 (선호 경로).
  let final = '';
  if (verifiedHref) {
    final = String(verifiedHref);
  } else if (href) {
    // 2) raw href fallback — 자체 검증.
    const candidate = validateOutboundUrl(href);
    if (candidate) final = String(candidate);
  }

  if (!final) {
    return (
      <span className={className} style={{ ...style, opacity: 0.5, pointerEvents: 'none' }}
        aria-disabled="true" aria-label={ariaLabel || undefined}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={final}
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
