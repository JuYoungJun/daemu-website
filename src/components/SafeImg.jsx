import { useState } from 'react';
import { safeMediaUrl } from '../lib/safe.js';

// 이미지 로딩 실패 fallback — 깨진 아이콘 노출 회피.
// 원본 src 가 404 / 네트워크 실패 시 (a) 부모 prop fallback / (b) 인라인
// SVG placeholder 로 swap. safeMediaUrl 로 1차 sanitize → XSS / Open Redirect
// 방어, 그 후 onError 캐치.
//
// 사용 예:
//   <SafeImg src={brand.logo} alt={brand.name} fallback="/assets/logo-stub.svg" />
//
// 빈 src 면 아예 렌더 안 함 (placeholder 도 안 보임) — 운영자가 의도적으로
// 이미지 미등록한 row 가 텍스트만 표시되도록.

const INLINE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" role="img" aria-label="image unavailable">` +
      `<rect width="80" height="80" fill="#f3f1ec"/>` +
      `<path d="M20 56 L34 38 L48 50 L60 32" stroke="#c5beb1" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="56" cy="22" r="4" fill="#c5beb1"/>` +
    `</svg>`
  );

export default function SafeImg({
  src,
  alt = '',
  fallback,
  className,
  style,
  loading = 'lazy',
  decoding = 'async',
  onClick,
  ...rest
}) {
  const [errored, setErrored] = useState(false);
  const verified = src ? String(safeMediaUrl(src) || '') : '';

  if (!verified) return null;

  const finalSrc = errored ? (fallback || INLINE_PLACEHOLDER) : verified;
  const finalAlt = String(alt == null ? '' : alt).slice(0, 240);

  return (
    <img
      src={finalSrc}
      alt={finalAlt}
      loading={loading}
      decoding={decoding}
      className={className}
      style={style}
      onClick={onClick}
      onError={() => { if (!errored) setErrored(true); }}
      {...rest}
    />
  );
}
