// Cloudflare Worker — DAEMU email backend.
// Same API surface as backend/server.js (Express). Either can be used.
//
// Deploy:
//   cd backend-cf
//   npm install
//   npx wrangler login          (first time)
//   npx wrangler secret put RESEND_API_KEY        # paste key
//   npx wrangler secret put ALLOWED_ORIGINS       # e.g. https://juyoungjun.github.io,http://localhost:8765
//   npx wrangler deploy
//
// After deploy, set the Worker URL in:
//   - Frontend .env (local):   VITE_API_BASE_URL=https://daemu-api.<your>.workers.dev
//   - GitHub repo Variables:    VITE_API_BASE_URL  (same URL)
//                              → demo branch redeploys with real backend wired

const PATH_HEALTH   = '/api/health';
const PATH_SEND     = '/api/email/send';
const PATH_CAMPAIGN = '/api/email/campaign';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const corsOrigin = allowed.length === 0
      ? '*'
      : (allowed.includes(origin) ? origin : '');

    const cors = {
      'Access-Control-Allow-Origin': corsOrigin || allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === PATH_HEALTH) {
      return json({ ok: true, resendConfigured: !!env.RESEND_API_KEY, from: env.FROM_EMAIL }, 200, cors);
    }

    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);

    let body;
    try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, cors); }

    if (!env.RESEND_API_KEY) {
      console.log('[simulated]', url.pathname, body);
      return json({ ok: true, simulated: true }, 200, cors);
    }

    const FROM = env.FROM_EMAIL || 'DAEMU <onboarding@resend.dev>';

    if (url.pathname === PATH_SEND) {
      const { to, toName, subject, body: text, html, replyTo, attachments } = body || {};
      if (!to || !subject) return json({ ok: false, error: 'to/subject required' }, 400, cors);
      const safeAtt = Array.isArray(attachments)
        ? attachments.filter(a => a && a.filename && a.content).slice(0, 12).map(a => {
            const out = { filename: a.filename, content: a.content };
            const fn = String(a.filename).toLowerCase();
            if (fn.endsWith('.jpg') || fn.endsWith('.jpeg')) out.content_type = 'image/jpeg';
            else if (fn.endsWith('.png')) out.content_type = 'image/png';
            else if (fn.endsWith('.gif')) out.content_type = 'image/gif';
            else if (fn.endsWith('.webp')) out.content_type = 'image/webp';
            else if (fn.endsWith('.pdf')) out.content_type = 'application/pdf';
            // Resend REST API: inline_content_id triggers inline embedding (NOT content_id)
            if (a.contentId) out.inline_content_id = a.contentId;
            return out;
          })
        : null;
      const r = await sendOne(env.RESEND_API_KEY, { from: FROM, to, subject, text, html, replyTo, attachments: safeAtt });
      return json(r, r.ok ? 200 : 502, cors);
    }

    if (url.pathname === PATH_CAMPAIGN) {
      const { recipients, subject, body: text, replyTo } = body || {};
      if (!Array.isArray(recipients) || !recipients.length) {
        return json({ ok: false, error: 'recipients[] required' }, 400, cors);
      }
      let sent = 0, failed = 0;
      const errors = [];
      for (const r of recipients) {
        if (!r.email) { failed++; continue; }
        const personal = {
          subject: applyVars(subject, { name: r.name || '' }),
          text: applyVars(text || '', { name: r.name || '' })
        };
        const result = await sendOne(env.RESEND_API_KEY, { from: FROM, to: r.email, ...personal, replyTo });
        if (result.ok) sent++; else { failed++; errors.push({ email: r.email, error: result.error }); }
        await sleep(200);
      }
      return json({ ok: true, sent, failed, errors: errors.slice(0, 10) }, 200, cors);
    }

    return json({ ok: false, error: 'not found' }, 404, cors);
  }
};

async function sendOne(apiKey, { from, to, subject, text, html, replyTo, attachments }) {
  try {
    const payload = { from, to: [to], subject, reply_to: replyTo };
    if (html) { payload.html = html; if (text) payload.text = text; } else { payload.text = text || ''; }
    if (attachments && attachments.length) payload.attachments = attachments;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (data && (data.message || data.error)) || ('HTTP ' + res.status) };
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}
