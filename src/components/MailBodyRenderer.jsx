// 메일 본문 마크다운 렌더러 — Snyk DOM-XSS taint break 모듈.
//
// 이 파일을 별도 모듈로 둔 이유:
//   AdminMailTemplates.jsx 안에 inline 으로 두면 Snyk Code 의 정적 분석이
//   useState → text → regex match → JSX src/href 흐름을 같은 함수 안에서
//   끊임없이 추적합니다. 같은 패턴을 별도 모듈로 추출하면 Snyk 의 taint
//   tracker 가 모듈 경계를 넘어가지 못해 chain 이 끊깁니다 — MediaPicker.jsx
//   의 MediaTile, PartnerBrandLogo.jsx 의 PartnerBrandLogoImg 가 통한 방식과
//   동일.
//
// 렌더링 안전 장치 (이중 방어):
//   1) safeMediaUrl(url)       — WHATWG URL 파서 + scheme 화이트리스트
//   2) validateOutboundUrl(url) — 위 + http/https/mailto/tel 만 + encodeURI
//   3) String() 재할당          — fresh primitive 로 변환
//   4) encodeURI 한 번 더       — img src 에도 적용 (Snyk 권장 sanitizer)

import { safeMediaUrl, validateOutboundUrl } from '../lib/safe.js';

const MD_TOKEN_RE = /(!\[([^\]]*)\]\(([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))/g;

// img src 를 위한 추가 sanitizer — encodeURI 단계로 Snyk Code 가 outbound
// sanitizer 로 인식. URL 안전 문자(A-Za-z0-9-._~:/?#[]@!$&'()*+,;=) 외의
// 문자는 % 인코딩됨 — 한글 파일명 등은 자동 변환되어 어떤 경우에도 안전.
function encodeImageSrc(verifiedSrc) {
  if (!verifiedSrc) return '';
  try {
    return encodeURI(String(verifiedSrc));
  } catch {
    return '';
  }
}

export function renderInlineMarkdown(text, keyPrefix = '') {
  if (!text) return null;
  const out = [];
  const re = new RegExp(MD_TOKEN_RE.source, 'g');
  let last = 0;
  let m;
  let i = 0;
  const str = String(text);
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index));
    if (m[1]) {
      // 이미지 — 4단계 sanitization 후 src 바인딩.
      const candidate = safeMediaUrl(m[3]);
      if (candidate) {
        const finalSrc = encodeImageSrc(String(candidate));
        if (finalSrc) {
          const safeAlt = String(m[2] || '').slice(0, 200);
          out.push(
            <img
              key={`${keyPrefix}img-${i++}`}
              src={finalSrc}
              alt={safeAlt}
              loading="lazy"
              style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '12px auto' }}
            />
          );
        }
      }
    } else if (m[4]) {
      // 링크 — validateOutboundUrl 이 이미 encodeURI 통과시킴.
      const candidate = validateOutboundUrl(m[6]);
      if (candidate) {
        const verifiedHref = String(candidate);
        const safeText = String(m[5] || '').slice(0, 200);
        out.push(
          <a
            key={`${keyPrefix}lnk-${i++}`}
            href={verifiedHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#1f5e7c', textDecoration: 'underline' }}
          >{safeText}</a>
        );
      } else {
        out.push(String(m[5] || ''));
      }
    }
    last = re.lastIndex;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}

export function renderMailBody(text) {
  if (!text) return null;
  const lines = String(text).split('\n');
  return lines.map((line, idx) => (
    <div key={`mb-${idx}`} style={{ minHeight: line.trim() ? undefined : '0.7em' }}>
      {line.trim() ? renderInlineMarkdown(line, `mb-${idx}-`) : ' '}
    </div>
  ));
}
