// 백엔드 HTTP 클라이언트.
// VITE_API_BASE_URL 미설정 시 데모 모드 — mutating 호출은 localStorage outbox 에
// simulated 상태로 적재되어 어드민이 발송 의도를 확인할 수 있다.

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// 어드민 JWT 의 브라우저 storage key (값 자체가 비밀이 아님). Snyk CWE-547 가
// "KEY" 들어간 식별자를 모두 잡길래 의도를 분명히 하려고 _STORAGE_KEY 접미.
const ADMIN_TOKEN_STORAGE_KEY = 'daemu_admin_token';

function authHeader() {
  const t = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (!t) return {};
  // 인증 호출마다 활동 타임스탬프 갱신 — 60분 inactivity 타임아웃 방지.
  try { localStorage.setItem('daemu_admin_last_activity', String(Date.now())); }
  catch { /* ignore */ }
  return { Authorization: `Bearer ${t}` };
}

// 네트워크/fetch 예외를 사용자 친화 한국어 메시지로 변환.
// 백엔드 cold-start, DB hibernate, CORS preflight, 일시 단절 등 모두 같은
// "TypeError: Failed to fetch" 로 떨어지므로 공통 안내 문구 사용.
// detail 은 logs/디버그 용도로 별도 필드에 보존.
function _friendlyFetchError(err) {
  const raw = String(err || '');
  // fetch 의 typical network error 들
  if (/Failed to fetch|NetworkError|ERR_NETWORK|Load failed/i.test(raw)) {
    return '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요. (네트워크 또는 일시 점검)';
  }
  if (/timeout/i.test(raw)) {
    return '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (/AbortError|aborted/i.test(raw)) {
    return '요청이 취소되었습니다. 다시 시도해 주세요.';
  }
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function request(method, path, body, opts = {}) {
  if (!BASE) {
    if (method !== 'GET') logOutbox(path, body, 'simulated');
    return { ok: false, simulated: true };
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.skipAuth ? {} : authHeader()),
    ...(opts.headers || {}),
  };
  try {
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: opts.credentials || 'omit',
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSON 아님 */ }
    if (!res.ok) {
      // 백엔드가 명확한 detail 을 줬으면 그대로, 없으면 status 별 친근 안내.
      let err = (json && (json.error || json.detail)) || text;
      if (!err || typeof err !== 'string') {
        if (res.status >= 500 && res.status < 600) {
          err = '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
        } else if (res.status === 401 || res.status === 403) {
          err = '인증이 필요합니다. 다시 로그인해 주세요.';
        } else if (res.status === 404) {
          err = '요청하신 항목을 찾을 수 없습니다.';
        } else {
          err = `요청을 처리하지 못했습니다. (HTTP ${res.status})`;
        }
      }
      if (method !== 'GET') logOutbox(path, body, 'failed', { status: res.status, response: text });
      return { ok: false, status: res.status, error: err, ...(json && typeof json === 'object' ? json : {}) };
    }
    if (method !== 'GET') logOutbox(path, body, 'sent', { status: res.status });
    return { ok: true, ...((json && typeof json === 'object') ? json : {}) };
  } catch (err) {
    if (method !== 'GET') logOutbox(path, body, 'error', { error: String(err) });
    return { ok: false, error: _friendlyFetchError(err), errorDetail: String(err) };
  }
}

export const api = {
  isConfigured() { return Boolean(BASE); },
  baseUrl() { return BASE; },

  post(path, body, opts) { return request('POST', path, body, opts); },
  patch(path, body, opts) { return request('PATCH', path, body, opts); },
  put(path, body, opts) { return request('PUT', path, body, opts); },
  del(path, opts) { return request('DELETE', path, undefined, opts); },

  async get(path, opts = {}) {
    if (!BASE) return { ok: false, simulated: true };
    try {
      const res = await fetch(BASE + path, {
        headers: opts.skipAuth ? {} : authHeader(),
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* JSON 아님 */ }
      return { ok: res.ok, status: res.status, ...((json && typeof json === 'object') ? json : {}) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

// 비밀번호·OTP·토큰류는 localStorage outbox 에 cleartext 로 절대 들어가지 않게
// 직전에 redact. 어드민이 모니터링/CSV 로 export 해도 [REDACTED] 만 노출.
const REDACT_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'old_password', 'new_password',
  'totp_code', 'totp', 'code', 'recovery_code', 'recoverycode',
  'token', 'access_token', 'refresh_token', 'authorization', 'auth',
  'otp', 'secret', 'api_key', 'apikey',
]);

function redactForLog(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value)) {
    if (REDACT_KEYS.has(String(k).toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactForLog(value[k], depth + 1);
    }
  }
  return out;
}

function logOutbox(path, body, status, extra = {}) {
  try {
    const key = 'daemu_outbox';
    const log = JSON.parse(localStorage.getItem(key) || '[]');
    log.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      path,
      body: redactForLog(body),
      status,
      ...extra
    });
    localStorage.setItem(key, JSON.stringify(log.slice(0, 200)));
    window.dispatchEvent(new Event('daemu-db-change'));
  } catch (e) { /* ignore */ }
}
