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

// Single email send (optional attachments: [{ filename, content (base64) }])
app.post('/api/email/send', async (req, res) => {
  const { to, toName, subject, body, replyTo, attachments } = req.body || {};
  if (!to || !subject) return res.status(400).json({ ok: false, error: 'to and subject are required' });

  const safeAttachments = Array.isArray(attachments)
    ? attachments
        .filter((a) => a && a.filename && a.content)
        .slice(0, 10) // safety cap
        .map((a) => ({ filename: String(a.filename), content: String(a.content) }))
    : undefined;

  if (!resend) {
    console.log('[email/send simulated]', { to, subject, attachments: safeAttachments?.length || 0 });
    return res.json({ ok: true, simulated: true, id: 'sim-' + Date.now() });
  }

  try {
    const payload = { from: FROM, to: [to], subject, text: body || '', replyTo };
    if (safeAttachments?.length) payload.attachments = safeAttachments;
    const result = await resend.emails.send(payload);
    if (result.error) {
      console.error('[email/send] Resend error:', result.error);
      return res.status(502).json({ ok: false, error: result.error.message });
    }
    return res.json({ ok: true, id: result.data?.id });
  } catch (err) {
    console.error('[email/send] thrown:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Bulk campaign send (sequential with throttle)
app.post('/api/email/campaign', async (req, res) => {
  const { recipients, subject, body, replyTo } = req.body || {};
  if (!Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ ok: false, error: 'recipients[] required' });
  }

  if (!resend) {
    console.log('[email/campaign simulated]', { count: recipients.length, subject });
    return res.json({ ok: true, simulated: true, sent: recipients.length, failed: 0 });
  }

  let sent = 0, failed = 0;
  const errors = [];
  for (const r of recipients) {
    if (!r.email) { failed++; continue; }
    try {
      const result = await resend.emails.send({
        from: FROM,
        to: [r.email],
        subject: applyVars(subject, { name: r.name || '' }),
        text: applyVars(body || '', { name: r.name || '' }),
        replyTo
      });
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
