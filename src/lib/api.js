// Backend HTTP client.
// In production, calls VITE_API_BASE_URL endpoints.
// In demo / no-backend mode, simulates by writing to localStorage 'outbox'
// so the admin can see what would have been sent.

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const api = {
  isConfigured() { return Boolean(BASE); },
  baseUrl() { return BASE; },

  async post(path, body, opts = {}) {
    if (!BASE) {
      // Demo simulation: log to outbox
      logOutbox(path, body, 'simulated');
      return { ok: true, simulated: true };
    }
    try {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: JSON.stringify(body),
        credentials: opts.credentials || 'omit'
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (!res.ok) {
        logOutbox(path, body, 'failed', { status: res.status, response: text });
        return { ok: false, status: res.status, error: (json && json.error) || text || ('HTTP ' + res.status) };
      }
      logOutbox(path, body, 'sent', { status: res.status });
      return { ok: true, ...((json && typeof json === 'object') ? json : {}) };
    } catch (err) {
      logOutbox(path, body, 'error', { error: String(err) });
      return { ok: false, error: String(err) };
    }
  },

  async get(path) {
    if (!BASE) return { ok: false, simulated: true };
    try {
      const res = await fetch(BASE + path);
      const json = await res.json();
      return { ok: res.ok, ...(json || {}) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
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
