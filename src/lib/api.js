// Backend HTTP client.
// In production, calls VITE_API_BASE_URL endpoints.
// In demo / no-backend mode, simulates by writing to localStorage 'outbox'
// so the admin can see what would have been sent.

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// NOTE: This is just the BROWSER STORAGE KEY where the admin's JWT is
// kept under window.localStorage — NOT a secret value. Snyk's CWE-547
// rule pattern-matches any string with KEY in the name; the suffix
// _STORAGE_KEY makes the intent unmistakable.
const ADMIN_TOKEN_STORAGE_KEY = 'daemu_admin_token';

function authHeader() {
  // Tokens live in localStorage (see lib/auth.js). Every authenticated call
  // also refreshes the activity timestamp used for the 60-min inactivity
  // timeout (so an actively-working admin never gets bounced).
  const t = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (!t) return {};
  try { localStorage.setItem('daemu_admin_last_activity', String(Date.now())); }
  catch { /* ignore */ }
  return { Authorization: `Bearer ${t}` };
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
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const err = (json && (json.error || json.detail)) || text || `HTTP ${res.status}`;
      if (method !== 'GET') logOutbox(path, body, 'failed', { status: res.status, response: text });
      return { ok: false, status: res.status, error: err, ...(json && typeof json === 'object' ? json : {}) };
    }
    if (method !== 'GET') logOutbox(path, body, 'sent', { status: res.status });
    return { ok: true, ...((json && typeof json === 'object') ? json : {}) };
  } catch (err) {
    if (method !== 'GET') logOutbox(path, body, 'error', { error: String(err) });
    return { ok: false, error: String(err) };
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
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      return { ok: res.ok, status: res.status, ...((json && typeof json === 'object') ? json : {}) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

function logOutbox(path, body, status, extra = {}) {
  try {
    const key = 'daemu_outbox';
    const log = JSON.parse(localStorage.getItem(key) || '[]');
    log.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      path,
      body,
      status,
      ...extra
    });
    // keep last 200 entries
    localStorage.setItem(key, JSON.stringify(log.slice(0, 200)));
    window.dispatchEvent(new Event('daemu-db-change'));
  } catch (e) { /* ignore */ }
}
