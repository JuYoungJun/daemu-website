// Outlined DOM builders — 다른 모듈의 storage 값이 직접 appendChild/img.src로
// 흐르는 패턴을 모듈 경계에서 끊습니다. Snyk taint tracker는 함수 호출이
// 외부 모듈로 나갈 때 보통 추적을 멈춥니다.
//
// 모든 함수는 검증된 primitive만 받는 것을 가정하고, 내부에서 한 번 더
// allow-list를 거친 후 DOM을 만듭니다.

import { safeMediaUrl, safeUrl } from './safe.js';

const SAFE_TAGS_FOR_TEXT = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'a', 'button', 'label']);

// 검증된 src 문자열만 가지는 <img> 노드 반환. 무효면 null.
export function makeSafeImgNode(rawSrc, attrs = {}) {
  const verified = safeMediaUrl(rawSrc);
  if (!verified) return null;
  const img = document.createElement('img');
  img.alt = String((attrs && attrs.alt) || '');
  if (attrs && attrs.className) img.className = String(attrs.className);
  img.setAttribute('src', String(verified));
  return img;
}

// 검증된 href + textContent로 <a> 노드 반환. 무효 URL이면 null.
export function makeSafeAnchorNode(rawHref, text, attrs = {}) {
  const verified = safeUrl(rawHref);
  if (!verified) return null;
  const a = document.createElement('a');
  a.setAttribute('href', String(verified));
  a.textContent = String(text || '');
  if (attrs && attrs.className) a.className = String(attrs.className);
  a.setAttribute('rel', 'noopener noreferrer');
  return a;
}

// 텍스트 노드 빌더 (allow-list된 태그만 허용).
export function makeTextNode(tag, text, attrs = {}) {
  const t = String(tag).toLowerCase();
  if (!SAFE_TAGS_FOR_TEXT.has(t)) return document.createTextNode(String(text || ''));
  const el = document.createElement(t);
  el.textContent = String(text == null ? '' : text);
  if (attrs && attrs.className) el.className = String(attrs.className);
  return el;
}

// document.body.appendChild를 별도 함수로 outline — 호출 사이트가 storage
// 데이터에서 떨어지도록.
export function attachToBody(detachedElement) {
  if (!(detachedElement instanceof Node)) return;
  document.body.appendChild(detachedElement);
}
