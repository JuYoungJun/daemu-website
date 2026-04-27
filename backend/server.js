import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Resend } from 'resend';

const PORT = process.env.PORT || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.FROM_EMAIL || 'DAEMU <onboarding@resend.dev>';
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'http://localhost:8765,http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!RESEND_API_KEY) {
  console.warn('[daemu-backend] RESEND_API_KEY is not set — emails will not actually send.');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const app = express();

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin (curl, server-to-server) and whitelisted origins
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('CORS: ' + origin + ' not allowed'));
  }
}));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    resendConfigured: !!resend,
    from: FROM,
    allowedOrigins: ALLOWED
  });
});

function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

// Single email send. Bypasses Resend SDK when inline attachments are
// present — calls REST API directly so we can use the documented snake_case
// `content_id` field exactly, and (for safety) double-tag with `inline_content_id`
// + `cid` aliases to maximize compatibility across SDK versions.
app.post('/api/email/send', async (req, res) => {
  const { to, toName, subject, body, html, replyTo, attachments } = req.body || {};
  if (!to || !subject) return res.status(400).json({ ok: false, error: 'to and subject are required' });

  const safeAttachments = Array.isArray(attachments)
    ? attachments
        .filter((a) => a && a.filename && a.content)
        .slice(0, 12)
        .map((a) => {
          const out = { filename: String(a.filename), content: String(a.content) };
          const filename = String(a.filename).toLowerCase();
          if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) out.content_type = 'image/jpeg';
          else if (filename.endsWith('.png')) out.content_type = 'image/png';
          else if (filename.endsWith('.gif')) out.content_type = 'image/gif';
          else if (filename.endsWith('.webp')) out.content_type = 'image/webp';
          else if (filename.endsWith('.svg')) out.content_type = 'image/svg+xml';
          else if (filename.endsWith('.pdf')) out.content_type = 'application/pdf';
          if (a.contentId) {
            const cid = String(a.contentId);
            // Triple-name to maximize Resend compatibility across versions
            out.content_id = cid;
            out.inline_content_id = cid;
            out.cid = cid;
          }
          return out;
        })
    : undefined;

  if (!RESEND_API_KEY) {
    console.log('[email/send simulated]', { to, subject, hasHtml: !!html, attachments: safeAttachments?.length || 0 });
    return res.json({ ok: true, simulated: true, id: 'sim-' + Date.now() });
  }

  const payload = { from: FROM, to: [to], subject, reply_to: replyTo };
  if (html) {
    payload.html = html;
    if (body) payload.text = body;
  } else {
    payload.text = body || '';
  }
  if (safeAttachments?.length) payload.attachments = safeAttachments;

  try {
    const apiRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await apiRes.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!apiRes.ok) {
      console.error('[email/send] Resend HTTP', apiRes.status, text);
      return res.status(502).json({ ok: false, error: (json && json.message) || ('HTTP ' + apiRes.status) });
    }
    return res.json({ ok: true, id: json?.id });
  } catch (err) {
    console.error('[email/send] thrown:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Bulk campaign send (sequential with throttle)
app.post('/api/email/campaign', async (req, res) => {
  const { recipients, subject, body, html, attachments, replyTo } = req.body || {};
  if (!Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ ok: false, error: 'recipients[] required' });
  }

  if (!resend) {
    console.log('[email/campaign simulated]', { count: recipients.length, subject });
    return res.json({ ok: true, simulated: true, sent: recipients.length, failed: 0 });
  }

  const safeAtt = Array.isArray(attachments)
    ? attachments.filter(a => a && a.filename && a.content).slice(0, 12).map(a => {
        const out = { filename: String(a.filename), content: String(a.content) };
        const filename = String(a.filename).toLowerCase();
        if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) out.contentType = 'image/jpeg';
        else if (filename.endsWith('.png')) out.contentType = 'image/png';
        else if (filename.endsWith('.gif')) out.contentType = 'image/gif';
        else if (filename.endsWith('.webp')) out.contentType = 'image/webp';
        else if (filename.endsWith('.pdf')) out.contentType = 'application/pdf';
        if (a.contentId) out.inlineContentId = String(a.contentId);
        return out;
      })
    : null;

  let sent = 0, failed = 0;
  const errors = [];
  for (const r of recipients) {
    if (!r.email) { failed++; continue; }
    try {
      const personal = {
        from: FROM,
        to: [r.email],
        subject: applyVars(subject, { name: r.name || '' }),
        replyTo
      };
      if (html) {
        personal.html = applyVars(html, { name: r.name || '' });
        if (body) personal.text = applyVars(body, { name: r.name || '' });
      } else {
        personal.text = applyVars(body || '', { name: r.name || '' });
      }
      if (safeAtt && safeAtt.length) personal.attachments = safeAtt;
      const result = await resend.emails.send(personal);
      if (result.error) {
        failed++;
        errors.push({ email: r.email, error: result.error.message });
      } else {
        sent++;
      }
    } catch (err) {
      failed++;
      errors.push({ email: r.email, error: String(err?.message || err) });
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return res.json({ ok: true, sent, failed, errors: errors.slice(0, 10) });
});

app.use((err, _req, res, _next) => {
  if (err && err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ ok: false, error: err.message });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'internal' });
});

app.listen(PORT, () => {
  console.log(`[daemu-backend] listening on http://localhost:${PORT}`);
  console.log(`[daemu-backend] from: ${FROM}`);
  console.log(`[daemu-backend] allowed origins: ${ALLOWED.join(', ')}`);
  console.log(`[daemu-backend] resend: ${resend ? 'configured' : 'NOT CONFIGURED (simulating)'}`);
});
