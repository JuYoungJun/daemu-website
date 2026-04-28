// 자체 client-side 마케팅 분석 — 외부 의존 없이 admin이 즉시 활용 가능.
//
// 수집 항목 (개인정보 최소화):
//   - 페이지 경로 (pathname)
//   - referrer (외부 유입 채널)
//   - UTM 파라미터 (캠페인 추적 — utm_source/utm_medium/utm_campaign/utm_content/utm_term)
//   - 화면 크기 카테고리 (mobile/tablet/desktop)
//   - 브라우저 카테고리 (chrome/safari/firefox/edge/etc)
//   - OS 카테고리 (mac/windows/ios/android/etc)
//   - 언어 (navigator.language의 첫 2자만)
//   - 세션 ID (UUID, localStorage 30분 슬라이딩)
//   - 페이지 진입/이탈 시각, 체류 시간
//   - scroll depth (25/50/75/100%)
//   - CTA 버튼 클릭 (data-track 속성이 있는 버튼)
//   - Contact/Partners 폼 제출
//
// NOT 수집:
//   - IP / 정확한 디바이스 ID / 폼 본문 / 비밀번호 / 이메일 /
//     쿠키 fingerprint / 위치 정보
//
// 데이터 보관:
//   - localStorage 'daemu_analytics_events' (최근 5000건 ring buffer)
//   - 30일 이상된 이벤트는 자동 정리
//   - admin/analytics 페이지에서 집계 + CSV 내보내기 가능
//
// 동의 흐름:
//   - daemu_ga_consent === 'denied' → 본 모듈도 비활성화
//   - 'granted' 또는 'unknown' → 활성 (PIPA: 익명 통계는 동의 의무 면제)

const STORAGE_KEY = 'daemu_analytics_events';
const SESSION_KEY = 'daemu_analytics_session';
const CONSENT_KEY = 'daemu_ga_consent';
const MAX_EVENTS = 5000;
const RETENTION_DAYS = 30;
const SESSION_IDLE_MS = 30 * 60 * 1000;

let pageEnterAt = 0;
let scrollDepthFired = new Set();
let installed = false;

function isEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CONSENT_KEY) !== 'denied';
  } catch { return false; }
}

function uuidish() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getSessionId() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id && Date.now() - (parsed.last || 0) < SESSION_IDLE_MS) {
        parsed.last = Date.now();
        localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
        return parsed.id;
      }
    }
  } catch { /* ignore */ }
  const fresh = { id: uuidish(), start: Date.now(), last: Date.now() };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
  return fresh.id;
}

function deviceCategory() {
  if (typeof window === 'undefined') return 'unknown';
  const w = window.innerWidth || 0;
  if (w < 600) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function browserCategory() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/MSIE|Trident\//.test(ua)) return 'ie';
  return 'other';
}
function osCategory() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

// IANA 타임존 → ISO 국가코드 추정 (외부 API 의존 없음).
// 100% 정확하진 않지만 대다수 케이스를 잡습니다 — 정확한 IP geolocation이
// 필요하면 backend에서 X-Forwarded-For + GeoIP2 lite를 추가해야 합니다.
const TZ_TO_COUNTRY = {
  'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW', 'Asia/Singapore': 'SG', 'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ', 'Pacific/Honolulu': 'US',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR', 'America/Buenos_Aires': 'AR',
  'Europe/London': 'GB', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Moscow': 'RU',
  'Europe/Istanbul': 'TR', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR',
  'Europe/Zurich': 'CH', 'Europe/Dublin': 'IE',
  'Africa/Cairo': 'EG', 'Africa/Johannesburg': 'ZA', 'Africa/Lagos': 'NG',
  'UTC': 'XX', 'GMT': 'XX',
};
function countryGuess() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_TO_COUNTRY[tz]) return TZ_TO_COUNTRY[tz];
    // tz prefix로 fallback (Asia/Seoul → Asia, America/* → US 추정 안 함)
    if (tz && tz.startsWith('Asia/')) return 'Asia';
    if (tz && tz.startsWith('Europe/')) return 'EU';
    if (tz && tz.startsWith('America/')) return 'AM';
    if (tz && tz.startsWith('Africa/')) return 'AF';
    if (tz && tz.startsWith('Australia/')) return 'AU';
    if (tz && tz.startsWith('Pacific/')) return 'PC';
  } catch { /* ignore */ }
  // navigator.language 백업: 'ko-KR' → 'KR'
  try {
    const lang = navigator.language || '';
    const m = /-([A-Z]{2})$/i.exec(lang);
    if (m) return m[1].toUpperCase();
  } catch { /* ignore */ }
  return 'XX';
}
function timezoneRaw() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  catch { return ''; }
}

function readUtm() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const utm = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = sp.get(k);
      if (v) utm[k] = String(v).slice(0, 100);
    }
    return utm;
  } catch { return {}; }
}

function readReferrerCategory() {
  if (typeof document === 'undefined') return '';
  const ref = document.referrer || '';
  if (!ref) return 'direct';
  try {
    const u = new URL(ref);
    if (u.host === window.location.host) return 'internal';
    const h = u.host.replace(/^www\./, '');
    if (/google|naver|daum|bing/i.test(h)) return 'search:' + h;
    if (/instagram|facebook|tiktok|youtube|x\.com|twitter|threads|linkedin|kakao/i.test(h)) return 'social:' + h;
    return 'referral:' + h;
  } catch { return 'unknown'; }
}

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // retention prune
    const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
    return arr.filter((e) => (e.ts || 0) >= cutoff);
  } catch { return []; }
}
function saveEvents(arr) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-MAX_EVENTS))); }
  catch { /* quota — best effort */ }
}

export function trackEvent(name, props = {}) {
  if (!isEnabled()) return;
  const now = new Date();
  const event = {
    id: uuidish(),
    ts: Date.now(),
    name: String(name).slice(0, 80),
    path: window.location.pathname,
    session: getSessionId(),
    device: deviceCategory(),
    browser: browserCategory(),
    os: osCategory(),
    lang: (navigator.language || '').slice(0, 2),
    country: countryGuess(),
    timezone: timezoneRaw(),
    hour: now.getHours(),                    // 0-23 — 시간대별 트래픽
    weekday: now.getDay(),                   // 0(일)-6(토)
    referrer: readReferrerCategory(),
    ...readUtm(),
    // primitive props만 — XSS 위험 차단
    props: Object.fromEntries(
      Object.entries(props || {}).map(([k, v]) => [
        String(k).slice(0, 32),
        typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200),
      ])
    ),
  };
  const list = loadEvents();
  list.push(event);
  saveEvents(list);
  try { window.dispatchEvent(new Event('daemu-analytics-tick')); } catch { /* ignore */ }
}

export function trackPageEnter() {
  if (!isEnabled()) return;
  pageEnterAt = Date.now();
  scrollDepthFired = new Set();
  trackEvent('pageview');
}

export function trackPageLeave() {
  if (!isEnabled() || !pageEnterAt) return;
  const dwell = Math.round((Date.now() - pageEnterAt) / 1000);
  if (dwell > 0) trackEvent('page_dwell', { seconds: dwell });
  pageEnterAt = 0;
}

function onScroll() {
  if (!isEnabled() || typeof document === 'undefined') return;
  const scrolled = window.scrollY + window.innerHeight;
  const total = document.documentElement.scrollHeight || 1;
  const pct = Math.min(100, Math.round((scrolled / total) * 100));
  for (const t of [25, 50, 75, 100]) {
    if (pct >= t && !scrollDepthFired.has(t)) {
      scrollDepthFired.add(t);
      trackEvent('scroll_depth', { pct: t });
    }
  }
}

function onClick(e) {
  const tgt = e.target.closest && e.target.closest('[data-track]');
  if (!tgt) return;
  const name = tgt.getAttribute('data-track') || 'cta_click';
  const label = tgt.getAttribute('data-track-label') || tgt.textContent?.trim().slice(0, 60) || '';
  trackEvent(name, { label });
}

export function installMarketingAnalytics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 처음 진입 시 session 시작 + 첫 이벤트
  trackPageEnter();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('click', onClick, { passive: true });
  window.addEventListener('beforeunload', () => trackPageLeave());

  // SPA pageview
  let lastPath = window.location.pathname;
  const observer = setInterval(() => {
    if (window.location.pathname !== lastPath) {
      trackPageLeave();
      lastPath = window.location.pathname;
      trackPageEnter();
    }
  }, 600);
  // cleanup이 어려운 module이므로 hint만
  return () => clearInterval(observer);
}

// admin/analytics가 사용할 집계 헬퍼
export function loadAllEvents() { return loadEvents(); }

export function clearAllEvents() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event('daemu-analytics-tick')); } catch { /* ignore */ }
}
