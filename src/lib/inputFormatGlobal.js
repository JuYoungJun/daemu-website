// Raw-page (public/*.js) 의 일반 폼 input 자동 포맷 — 모든 공개 페이지에서
// 즉시 동작해야 하므로 *eager* 로드 (main.jsx 가 import).
//
// 별도 모듈로 둔 이유: consultForms.js 는 db/email/api 의존이 있어 무겁고,
// 공개 페이지 visitor 가 매번 70KB+ 를 받지 않게 lazy 로드되어 있습니다.
// 입력 포맷터는 가볍기 때문에 (~2KB) 모든 페이지에서 즉시 활성화.
//
// 적용 대상:
//   - <form data-consult-form> 안의 phone/email
//   - <form data-format-inputs> 등 명시 opt-in 폼 (확장용)
//   - 일반 admin 페이지의 raw-page 폼 (/admin/* 가 아닌 raw HTML)
//
// React 컴포넌트의 input 은 자체 onChange 로 포맷터를 호출하므로 이 핸들러
// 영향을 받지 않습니다 (React 가 controlled input 의 value 를 매 렌더에
// 덮어씀).

import { formatPhone, normalizeEmail } from './inputFormat.js';

let installed = false;

const PHONE_SELECTORS = [
  'input[type="tel"]',
  'input[name="phone"]',
  'input[name="tel"]',
  'input[type="text"][placeholder*="0000"]',
  'input[type="text"][placeholder*="010"]',
  'input[type="text"][placeholder*="010-"]',
  'input[type="text"][placeholder*="전화"]',
  'input[type="text"][placeholder*="연락처"]',
  'input[data-format="phone"]',
];

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[data-format="email"]',
];

function matchesAny(el, selectors) {
  if (!el || !el.matches) return false;
  for (const sel of selectors) {
    try { if (el.matches(sel)) return true; } catch { /* ignore invalid sel */ }
  }
  return false;
}

function shouldFormat(el) {
  // React 가 자체적으로 value 를 컨트롤하는 input 은 건드리지 않음.
  // React 16+ 는 _valueTracker 를 사용해 native value 변경을 추적하므로
  // 이 속성이 있으면 React-controlled input 으로 간주.
  if (el && el._valueTracker) return false;
  // data-no-autoformat="true" 로 명시 거부한 경우.
  if (el && el.dataset && el.dataset.noAutoformat === 'true') return false;
  return true;
}

export function installInputFormatHandler() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !shouldFormat(t)) return;

    if (matchesAny(t, PHONE_SELECTORS)) {
      const before = t.value;
      const formatted = formatPhone(before);
      if (formatted !== before) {
        t.value = formatted;
        try {
          // 커서를 끝으로 — 사용자가 중간 편집 중일 수 있지만 단순 추가
          // 시나리오가 95%. 중간 편집 case 는 드물어 끝으로 두는 게 안전.
          t.setSelectionRange(formatted.length, formatted.length);
        } catch { /* type 에 따라 setSelectionRange 미지원 — 무시 */ }
      }
    } else if (matchesAny(t, EMAIL_SELECTORS)) {
      // 이메일은 공백만 즉시 제거 (소문자 변환은 blur 시).
      if (/\s/.test(t.value)) {
        t.value = t.value.replace(/\s/g, '');
      }
    }
  }, true);

  document.addEventListener('blur', (e) => {
    const t = e.target;
    if (!t || !shouldFormat(t)) return;
    if (matchesAny(t, EMAIL_SELECTORS)) {
      const normalized = normalizeEmail(t.value);
      if (normalized !== t.value) t.value = normalized;
    }
  }, true);
}
