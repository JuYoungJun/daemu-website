// 입력 포맷터 — 전화번호 / 날짜 / 사업자등록번호 등 일반 입력 정규화.
//
// 사용 패턴 — onChange 에서 e.target.value 를 포맷터에 통과시킨 후 setState:
//
//   <input
//     value={form.phone}
//     onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
//     placeholder="010-1234-5678"
//     inputMode="tel"
//     maxLength={13}
//   />
//
// 모든 포맷터는 '입력 시점' 에 동작하도록 설계 (lossy 가 아닌 mid-typing 친화).
// 글자가 잘리지 않게 deletion 시점에는 trailing dash 를 자동 정리.

// ------------------------------------------------------------------
// 전화번호
//
// 한국 시내·휴대폰·대표번호(02/0NN-XXXX-XXXX, 010-XXXX-XXXX, 1588-XXXX 등)
// 전반을 한 함수로 처리. 비숫자 모두 제거 후 길이별 분할.
// 엄격 검증은 별도 함수(isValidPhone) — 포맷터는 관용적.

export function formatPhone(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  // 1588 / 1577 / 1644 등 4자리 시작 대표번호: 1588-1234
  if (/^1[5-9]/.test(digits) && digits.length <= 8) {
    if (digits.length <= 4) return digits;
    return digits.slice(0, 4) + '-' + digits.slice(4, 8);
  }
  // 02 (서울) — 02-XXX-XXXX 또는 02-XXXX-XXXX
  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return '02-' + digits.slice(2);
    if (digits.length <= 9) return '02-' + digits.slice(2, 5) + '-' + digits.slice(5);
    return '02-' + digits.slice(2, 6) + '-' + digits.slice(6, 10);
  }
  // 010 / 011 / 016 / 017 / 018 / 019 — XXX-XXXX-XXXX (휴대폰 11자리)
  // 03X / 04X / 05X / 06X — XXX-XXX-XXXX 또는 XXX-XXXX-XXXX (지역)
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return digits.slice(0, 3) + '-' + digits.slice(3);
  if (digits.length <= 10) return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
}

export function isValidPhone(value) {
  if (!value) return false;
  const d = String(value).replace(/\D/g, '');
  // 9~11 자리 + 한국 prefix 패턴
  return /^(01[016789]\d{7,8}|02\d{7,8}|0[3-6]\d{8,9}|1[5-9]\d{2}\d{4})$/.test(d);
}

// ------------------------------------------------------------------
// 날짜 (YYYY-MM-DD)
//
// 사용자가 자유롭게 타이핑할 때 자동으로 YYYY-MM-DD 형식으로 정규화.
// type="date" 가 아닌 일반 text input 에서 활용.
// (type="date" 는 브라우저 native 픽커 사용 — 별도 포맷터 불필요)

export function formatDate(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4);
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
}

export function isValidDate(value) {
  if (!value) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  // round-trip via Date 로 31일 / 윤년 검증
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

// ------------------------------------------------------------------
// 시간 (HH:MM)

export function formatTime(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2, 4);
}

// ------------------------------------------------------------------
// 사업자 등록번호 (XXX-XX-XXXXX)

export function formatBizNo(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5, 10);
}

// ------------------------------------------------------------------
// 우편번호 (5자리, 신주소 한정)

export function formatZip(raw) {
  if (raw == null) return '';
  return String(raw).replace(/\D/g, '').slice(0, 5);
}

// ------------------------------------------------------------------
// 통화 / 수량 — 천단위 콤마 (display 전용; 저장은 number)
//
// onChange 단계에서 적용할 때는 caret 위치가 흐트러질 수 있으므로,
// onBlur 또는 별도 display state 로 노출하는 패턴을 권장.

export function formatNumberWithComma(value) {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export function unformatNumber(value) {
  if (value == null || value === '') return '';
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  return cleaned;
}

// 입력 시점 포맷 — 정수 통화에 한해 typing 중에도 콤마 적용.
// e.g. '1234567' → '1,234,567'.  소수·음수 미지원.
export function formatCurrencyTyping(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// 한국어 원화 표시 — '1,234,567원' 형태. 빈 입력은 빈 문자열.
export function formatKRW(value) {
  const v = formatNumberWithComma(value);
  return v ? v + '원' : '';
}

// ------------------------------------------------------------------
// 신용카드 번호 — XXXX-XXXX-XXXX-XXXX (16자리) / amex 15자리도 처리.
// 저장 자체는 권장하지 않음 (PCI). 결제 화면 입력 보조 용도만.
export function formatCardNumber(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '').slice(0, 19);
  if (!digits) return '';
  // amex (3 4 6 5 ...) 15자리 — 4-6-5 분할
  if (/^3[47]/.test(digits) && digits.length <= 15) {
    if (digits.length <= 4) return digits;
    if (digits.length <= 10) return digits.slice(0, 4) + '-' + digits.slice(4);
    return digits.slice(0, 4) + '-' + digits.slice(4, 10) + '-' + digits.slice(10, 15);
  }
  // visa/master/jcb 등 4-4-4-4
  return digits.match(/.{1,4}/g).join('-');
}

// ------------------------------------------------------------------
// 은행 계좌 번호 — 숫자만, 길이 제약은 은행마다 달라 자유 (max 20).
// 일부 은행은 '-' 구분을 쓰지 않으므로 단순히 숫자만 남김.
export function formatBankAccount(raw) {
  if (raw == null) return '';
  return String(raw).replace(/\D/g, '').slice(0, 20);
}

// ------------------------------------------------------------------
// 주민등록번호 — XXXXXX-XXXXXXX (개인정보 위험; 가능한 한 수집 금지)
// 화면 표시용으로만, 뒤 6자리는 마스킹된 displayResidentNo 가 별도 제공.
export function formatResidentNo(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) return digits;
  return digits.slice(0, 6) + '-' + digits.slice(6, 13);
}

export function maskResidentNo(value) {
  const m = /^(\d{6})-?(\d{1})/.exec(String(value || ''));
  if (!m) return '';
  return m[1] + '-' + m[2] + '******';
}

// ------------------------------------------------------------------
// 영문 대문자 강제 (예: 차량번호 / 코드)
export function toUpperAlphaNum(raw) {
  if (raw == null) return '';
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ------------------------------------------------------------------
// 이메일 — 공백 제거 + 소문자
export function normalizeEmail(raw) {
  if (raw == null) return '';
  return String(raw).trim().toLowerCase();
}

// ------------------------------------------------------------------
// URL — 사용자가 'example.com' 만 입력해도 자동 'https://' 부착.
// onBlur 시점에 호출 권장 (typing 중에는 자유롭게 쓸 수 있게).
export function ensureHttps(raw) {
  if (raw == null) return '';
  const v = String(raw).trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.\-]*:/i.test(v)) return v;
  return 'https://' + v;
}
