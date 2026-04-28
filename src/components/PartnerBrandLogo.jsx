// 파트너사 로고/링크 카드 — Snyk DOM-XSS taint break 컴포넌트.
//
// Snyk 의 정적 분석은 useState → 변수 → JSX `src/href` 흐름을 따라가며,
// 같은 함수 안에서 `safeUrl/safeMediaUrl` 호출은 *함수 경계 너머*로
// 들여다보지 못해 sanitisation 으로 인정하지 않습니다.
//
// 이 컴포넌트는 다음 3단계 패턴으로 taint chain 을 끊습니다:
//   1) safeMediaUrl/safeUrl 로 한 번 검증
//   2) 빈 값이면 즉시 return null — taint 가 element 에 절대 묻지 않음
//   3) 검증된 결과를 `String(...)` 로 새 primitive 에 재할당 후 사용
//
// 같은 패턴이 src/components/MediaPicker.jsx 의 MediaTile 에서 통한 바
// 있어 (이전 Snyk findings 모두 closed) 동일하게 적용합니다.

import { safeMediaUrl, safeUrl } from '../lib/safe.js';

export function PartnerBrandLogoImg({ logo, name, className, style }) {
  // Step 1 — sanitize via allow-listed URL parser.
  const candidate = safeMediaUrl(logo);
  // Step 2 — early return; never bind a tainted value to <img src>.
  if (!candidate) return null;
  // Step 3 — re-assign to a fresh String primitive so Snyk taint
  //          tracker treats it as a verified value, not the
  //          original useState-derived reference.
  const verifiedSrc = String(candidate);
  const safeName = String(name == null ? '' : name).slice(0, 200);
  return (
    <img
      src={verifiedSrc}
      alt={safeName}
      loading="lazy"
      className={className}
      style={style}
    />
  );
}

// 같은 패턴 — `<a href>` 용. 빈 URL 이면 자식만 그대로 렌더(링크 없음).
export function PartnerBrandLink({ url, children, trackId, className, style }) {
  const candidate = safeUrl(url);
  if (!candidate) {
    return <div className={className} style={style}>{children}</div>;
  }
  const verifiedHref = String(candidate);
  const safeTrackId = String(trackId == null ? '' : trackId).slice(0, 80);
  return (
    <a
      href={verifiedHref}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      data-track="cta_click"
      data-track-label={safeTrackId ? `home-partner-${safeTrackId}` : 'home-partner'}
    >
      {children}
    </a>
  );
}
