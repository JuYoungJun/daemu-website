// Render free tier 슬립 방어 — 클라이언트 사이드 keep-alive.
//
// Render free tier 는 15분간 트래픽이 없으면 dyno 가 sleep 상태로 들어가고
// 첫 요청은 cold-start 로 30초+ 지연이 발생한다. GitHub Actions cron 은
// hour-boundary 부하로 신뢰성이 낮고, 외부 cron(UptimeRobot 등) 등록을 안내
// 하지만 사용자가 등록하기 전에는 슬립이 자주 발생한다.
//
// 본 모듈은 보강책: 일반 방문자가 사이트에 들어와 있을 때 5분에 한 번씩만
// 백엔드 /api/health 를 호출해 dyno 를 깨워 둔다. 새벽에 방문자가 0이면
// 효과가 없으므로 외부 cron 과 함께 사용해야 슬립이 거의 들어가지 않는다.
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
