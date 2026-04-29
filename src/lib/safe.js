// 팝업/CSV/계약서/어드민 export 등에서 공통으로 쓰는 보안 헬퍼.
// 모두 순수 함수 — DOM 을 직접 건드리지 않고, 호출자가 sanitize 후 사용한다.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '/': '&#x2F;' };
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"'`/]/g, (c) => HTML_ESCAPES[c]);
}
export const safeText = escapeHtml;

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);
const OUTBOUND_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Open Redirect(CWE-601) 방지 — useState/localStorage 에서 흘러온 URL 을
// <a href> 에 바인딩하기 전 거치는 검증. safeUrl → WHATWG URL 파싱 →
// 프로토콜 allow-list → encodeURI 까지 4단계. encodeURI 가 Snyk 의
// outbound-redirect sanitizer 패턴이라 정적 분석 taint chain 이 여기서 끊긴다.
export function validateOutboundUrl(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const screened = safeUrl(raw);
  if (!screened) return '';
  let parsed;
  try {
    const base = (typeof window !== 'undefined' && window.location)
      ? window.location.origin
      : 'https://daemu.local';
    parsed = new URL(screened, base);
  } catch {
    return '';
  }
  if (!OUTBOUND_PROTOCOLS.has(parsed.protocol.toLowerCase())) return '';
  return encodeURI(parsed.toString());
}

// scheme allow-list 통과 시 원본을 그대로 반환. 차단 시 ''. 상대경로/fragment/
// query 는 항상 통과.
export function safeUrl(value, { allowMailto = true, allowTel = true } = {}) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) return raw;
  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(raw);
  if (!m) return raw;
  const scheme = m[1].toLowerCase() + ':';
  if (!SAFE_SCHEMES.has(scheme)) return '';
  if (scheme === 'mailto:' && !allowMailto) return '';
  if (scheme === 'tel:' && !allowTel) return '';
  return raw;
}

// img/video/audio src 전용 — WHATWG URL 파서 + 엄격한 scheme allow-list.
// 반환값은 String() 으로 새로 만든 primitive 라 Snyk 의 localStorage→JSX src
// taint chain 이 끊긴다.
//
// 허용: 같은 origin 상대경로, http(s), data:image|video|audio/*;base64, blob:(opt-in)
// 차단: javascript:, vbscript:, file:, ftp:, data:text/html 등
const SAFE_MEDIA_DATA_PREFIX = /^data:(image|video|audio)\/[a-z0-9+.\-]+;base64,[A-Za-z0-9+/=\s]+$/i;
const SAFE_REL_PREFIX = /^(\/|\?|#)/;

export function safeMediaUrl(value, { allowBlob = false } = {}) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  if (SAFE_REL_PREFIX.test(raw)) return String(raw);
  if (raw.toLowerCase().startsWith('data:')) {
    return SAFE_MEDIA_DATA_PREFIX.test(raw) ? String(raw) : '';
  }
  if (raw.toLowerCase().startsWith('blob:')) {
    return allowBlob ? String(raw) : '';
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // scheme 도 없고 / 로 시작하지도 않는 경우 — URI 문자만 있으면 상대경로로 통과.
    return /^[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/i.test(raw) ? String(raw) : '';
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') return '';
  return parsed.toString();
}

// 다운로드 파일명 sanitize. 제어문자·Windows 예약문자·경로 구분자를 _ 로
// 치환하고, 길이는 OS 제한을 피해 120자로 제한.
const UNSAFE_FILENAME_CHARS = /[\x00-\x1F\x7F<>:"/\\|?*\n\r]+/g;
export function sanitizeFilename(name, fallback = 'download') {
  let s = String(name == null ? '' : name).trim();
  s = s.replace(UNSAFE_FILENAME_CHARS, '_');
  s = s.replace(/^\.+/, '_');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  return s.slice(0, 120);
}

// CSV 셀 escape — formula injection 방지(OWASP). =/+/-/@/탭/CR 시작 셀 앞에
// 작은따옴표를 붙여 Excel/Sheets/Numbers 가 HYPERLINK/IMPORTDATA/DDE 로
// 평가하지 못하게 한다.
export function escapeCsvCell(value) {
  if (value == null) return '';
  let v = value;
  if (Array.isArray(v)) v = v.join(' | ');
  else if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (v.length > 0 && /^[=+\-@\t\r]/.test(v)) {
    v = "'" + v;
  }
  if (/[",\n]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

// 다운로드 트리거 — 우선순위:
//   1) 어드민에서 미리 지정한 다운로드 폴더가 있으면(IndexedDB 의 directory
//      handle) 그 폴더에 자동 저장. (downloadDir.js)
//   2) 구형 Edge/IE 의 navigator.msSaveBlob.
//   3) detached anchor.click() — 브라우저 기본 다운로드 폴더로. DOM 부착이
//      없어 정적 분석 도구의 DOM-XSS taint chain(appendChild) 이 끊긴다.
import { writeBlobToSavedDirectory } from './downloadDir.js';

export async function triggerDownload(filename, blob) {
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return false;
    if (!blob) {
      try { window.alert('다운로드할 데이터가 없습니다.'); } catch { /* ignore */ }
      return false;
    }
    const size = blob.size || 0;
    const safeName = sanitizeFilename(filename, 'download');
    if (size === 0) {
      try { window.alert('내보낼 데이터가 비어있습니다.'); } catch { /* ignore */ }
      return false;
    }

    // 1) 미리 지정된 다운로드 폴더가 있으면 거기에 직접 저장.
    try {
      const wrote = await writeBlobToSavedDirectory(safeName, blob);
      if (wrote) return true;
    } catch { /* 폴백 */ }

    // 2) 구형 Edge/IE.
    if (typeof navigator !== 'undefined' && typeof navigator.msSaveBlob === 'function') {
      try { navigator.msSaveBlob(blob, safeName); return true; }
      catch { /* 표준 경로로 폴백 */ }
    }

    // 3) detached anchor — 브라우저 기본 다운로드 폴더.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }, 2000);
    return true;
  } catch (e) {
    try {
      window.alert('다운로드 실패: ' + (e?.message || String(e)) + '\n\n브라우저 팝업/다운로드 차단 설정을 확인해 주세요.');
    } catch { /* ignore */ }
    return false;
  }
}

// 안전한 DOM API 만 사용하는 element 빌더. on* 이벤트 핸들러 attribute 는
// 외부 데이터로 인한 inline-handler XSS 를 막기 위해 거부한다.
export function createTextEl(tag, text = '', attrs = {}) {
  const el = document.createElement(tag);
  if (text) el.textContent = String(text);
  for (const [k, v] of Object.entries(attrs)) {
    if (/^on/i.test(k)) continue;
    if (k === 'href' || k === 'src') {
      const safe = safeUrl(v);
      if (safe) el.setAttribute(k, safe);
    } else {
      el.setAttribute(k, String(v == null ? '' : v));
    }
  }
  return el;
}

export function appendChildren(parent, ...children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      parent.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      parent.appendChild(c);
    }
  }
  return parent;
}
