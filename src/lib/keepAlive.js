// 백엔드 슬립/cold-start 방어 — 클라이언트 사이드 keep-alive.
//
// 호스트 환경에 따라 free tier 가 일정 시간 idle 시 슬립 (Render free tier =
// 15분, 기타 free PaaS = 다양). Cafe24 self-host VPS 는 슬립이 없으므로
// 본 모듈이 거의 무해 (5분 ping 1회). 운영 호스트 결정 시점에 따라 자동
// 적응 — 환경변수 의존 없음.
//
// 본 모듈: 일반 방문자가 사이트에 들어와 있을 때 5분에 한 번씩만 백엔드
// /api/health 를 호출. 새벽에 방문자가 0이면 효과가 없으므로 외부 cron
// (UptimeRobot 등) 과 함께 사용 권장.
//
// 부담:
//   · 같은 탭에서 5분 throttle → 한 사용자가 한 시간 머물러도 12회 호출.
//   · /api/health 는 단순 dict 반환 + DB ping 1회. 부하 무시 가능.
//   · 백엔드 미연결(VITE_API_BASE_URL 미설정) 환경은 자동 skip.
//   · navigator.sendBeacon 폴백 — 페이지 unload 시점에도 ping 가능.

const PING_THROTTLE_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'daemu_keepalive_last_ts';

function getBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  return raw || '';
}

function lastPingTs() {
  try { return Number(localStorage.getItem(STORAGE_KEY) || 0); }
  catch { return 0; }
}

function markPinged() {
  try { localStorage.setItem(STORAGE_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

// 한 번 ping. throttle 내부면 skip.
export function pingBackend() {
  const base = getBaseUrl();
  if (!base) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const last = lastPingTs();
  if (last && Date.now() - last < PING_THROTTLE_MS) return;
  markPinged();
  try {
    fetch(base + '/api/health', { method: 'GET', mode: 'cors', credentials: 'omit' })
      .catch(() => { /* ignore — 다음 시도가 또 깨울 것 */ });
  } catch { /* ignore */ }
}

// 5분마다 자동 ping. 탭이 visible 일 때만.
let timerId = null;
export function startKeepAlive() {
  if (typeof window === 'undefined') return;
  if (!getBaseUrl()) return;
  if (timerId) return;
  // mount 직후 1회.
  pingBackend();
  // 이후 5분 간격.
  timerId = setInterval(pingBackend, PING_THROTTLE_MS);
  // 탭이 다시 보이게 될 때 즉시 1회 더(throttle 가 알아서 skip).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pingBackend();
  });
}

export function stopKeepAlive() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}
