// 회사 기본 정보 — 단일 source.
//
// 이전에는 동일 정보 (전화/이메일/주소) 가 8군데+ 하드코딩되어 있어 운영자가
// 한 번 바꾸면 누락 risk. 본 파일을 단일 진실로 두고 Footer / 이메일 템플릿
// 기본값 / JSON-LD / 계약서 발신인 정보 등 모두 여기서 import.
//
// 환경별 override:
//   VITE_COMPANY_PHONE, VITE_COMPANY_EMAIL, VITE_COMPANY_ADDRESS,
//   VITE_COMPANY_BIZ_HOURS 환경변수로 빌드 시점에 덮어쓰기 가능.
//   미설정 시 아래 default — 클라이언트 인도 후 바뀌면 env 만 갱신 (재빌드).
//
// 미래: backend `/api/site-config` endpoint 로 옮기면 admin 페이지에서 즉시
// 편집 가능 (재배포 불필요). 본 파일은 그 단계의 fallback 으로 유지.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const COMPANY = Object.freeze({
  name: 'DAEMU',
  nameKr: '대무',
  tagline: '베이커리 · 카페 비즈니스 파트너',
  taglineEn: 'BAKERY & CAFE BUSINESS PARTNER',

  phone: env.VITE_COMPANY_PHONE || '061-335-1239',
  // tel: link 용 — hyphen 제거된 raw digits.
  phoneRaw: (env.VITE_COMPANY_PHONE || '061-335-1239').replace(/[^0-9]/g, ''),

  email: env.VITE_COMPANY_EMAIL || 'daemu_office@naver.com',

  address: env.VITE_COMPANY_ADDRESS || '전라남도 나주시 황동 3길 8',
  addressShort: '전라남도 나주시',
  addressEn: 'Naju, Korea',
  region: '전라남도',
  city: '나주시',

  bizHours: env.VITE_COMPANY_BIZ_HOURS || '월–금 09:00–18:00',
  bizHoursEn: 'MON - FRI / 09:00 - 18:00',

  foundedYear: 2019,
  yearsActive: () => new Date().getFullYear() - 2019,

  // SEO / JSON-LD 용 — 도메인 받은 후 env 로 override 권장.
  siteUrl: env.VITE_SITE_BASE_URL || 'https://juyoungjun.github.io/daemu-website',
});

// 계약서 / 메일 템플릿 푸터 한 줄.
export const COMPANY_FOOTER_LINE = `${COMPANY.nameKr} (${COMPANY.name}) · ${COMPANY.email} · ${COMPANY.phone}`;

// 통계 — 메인 페이지 "YEARS / PROJECTS / STAGES / CUSTOM" 숫자.
// 클라이언트 요청으로 자주 갱신되는 값이라 분리. env 미사용 — 코드 갱신
// 빈도가 낮고 visible 위치라 PR 검토 흐름에 태우는 게 안전.
export const STATS = Object.freeze({
  years: COMPANY.yearsActive(),       // 자동 계산 (현재 = 7)
  projects: 40,                       // "40+ PROJECTS · 완성된 브랜드"
  stages: 5,                          // "5 STAGES · 전략부터 운영까지"
  customPercent: 100,                 // "100% CUSTOM"
});
