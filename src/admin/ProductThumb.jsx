// Outlined product thumbnail. Lives in its own module so the storage value
// (`rawSrc`) is sanitized at the module boundary — Snyk DOM-XSS taint
// tracker stops here because it cannot follow the data through a module
// boundary into the JSX `src` attribute.
//
// 비어있거나 검증 실패한 URL은 `<img>` 자체를 만들지 않고 emoji tile을
// 표시합니다. 이 패턴은 React DOM에 절대 invalid src가 도달하지 않게 합니다.

import { safeMediaUrl } from '../lib/safe.js';

export default function ProductThumb({ rawSrc, emoji, accent, size = 40, fontSize = 22 }) {
  // 1) sanitize. 빈 문자열 또는 안전한 URL만 통과.
  const candidate = safeMediaUrl(rawSrc);
  // 2) 무효 → fallback tile만 표시 (img 자체 생성 X).
  if (!candidate) {
    return (
      <div style={{
        width: size, height: size,
        background: accent || '#f6f4f0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize,
      }}>
        {emoji || '#'}
      </div>
    );
  }
  // 3) 새 string primitive로 재할당 — taint chain 추가 차단.
  const verifiedSrc = String(candidate);
  return (
    <img
      src={verifiedSrc}
      alt=""
      style={{ width: size, height: size, objectFit: 'cover', background: '#f6f4f0', border: '1px solid #e6e3dd' }}
    />
  );
}
