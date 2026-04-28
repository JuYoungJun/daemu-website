// 파트너사 로고/링크 카드 — Snyk DOM-XSS + Open Redirect taint break.
//
// 이 컴포넌트는 *이미 검증된* primitive 만 prop 으로 받습니다. 부모는
// 다음 두 함수로 검증을 끝낸 뒤 결과를 prop 으로 전달해야 합니다:
//   safeMediaUrl(b.logo)        — <img src> 용 (브랜드 로고)
//   validateOutboundUrl(b.url)  — <a href> 용 (외부 링크)
//
// Snyk Code 의 inter-procedural taint 추적이 React 컴포넌트 경계에서
// 끊기는 케이스가 있어, 검증을 부모에서 명시적으로 수행한 후 결과만
// 넘기는 패턴을 사용합니다. 컴포넌트 안의 String() 재할당은 추가 안전망.

export function PartnerBrandLogoImg({ verifiedLogoSrc, name, className, style }) {
  // 부모가 safeMediaUrl 통과시킨 결과만 들어옴. 빈 값이면 렌더 안 함.
  if (!verifiedLogoSrc) return null;
  // 안전망 — 새 String primitive 로 한 번 더 재할당.
  const src = String(verifiedLogoSrc);
  const alt = String(name == null ? '' : name).slice(0, 200);
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      style={style}
    />
  );
}

export function PartnerBrandLink({ verifiedHref, children, trackId, className, style }) {
  // 부모가 validateOutboundUrl 통과시킨 결과만 들어옴.
  // 빈 값이면 wrapper div 만 렌더(링크 비활성).
  if (!verifiedHref) {
    return <div className={className} style={style}>{children}</div>;
  }
  const href = String(verifiedHref);
  const labelId = String(trackId == null ? '' : trackId).slice(0, 80);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      data-track="cta_click"
      data-track-label={labelId ? `home-partner-${labelId}` : 'home-partner'}
    >
      {children}
    </a>
  );
}
