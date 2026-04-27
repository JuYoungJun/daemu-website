// Email sender. Talks to a backend endpoint (POST /api/email/send) where
// the backend uses Resend / SendGrid / Brevo etc. In demo mode (no backend),
// requests are simulated and logged to localStorage outbox.

import { api } from './api.js';

export function isEmailEnabled() {
  return api.isConfigured();
}

function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ''));
}

function loadAdminMailTemplate() {
  try {
    const t = JSON.parse(localStorage.getItem('daemu_mail') || 'null');
    if (t && typeof t === 'object') return t;
  } catch (e) { /* ignore */ }
  return {
    subject: '[대무] 문의가 접수되었습니다',
    body: '{{name}} 님,\n\n대무에 문의해 주셔서 감사합니다.\n접수하신 내용을 확인하여 1-2 영업일 내 담당자가 회신드리겠습니다.\n\n─ 카테고리: {{category}}\n─ 문의 내용:\n{{message}}\n\n감사합니다.\n대무 (DAEMU)',
    active: 'on',
    category: 'all',
    images: []
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert plain-text body with `[[img:cidXXX]]` markers into HTML with
// `<img src="cid:cidXXX">` references. Surrounding text is escaped + line-broken.
// Returns { html, attachments } where attachments are the inline-disposition
// entries to include in the API call.
function bodyToHtml(body, images) {
  const parts = String(body || '').split(/(\[\[img:[\w-]+\]\])/g);
  let inner = '';
  parts.forEach((part) => {
    const m = part.match(/^\[\[img:([\w-]+)\]\]$/);
    if (m) {
      const cid = m[1];
      const img = (images || []).find((x) => x.contentId === cid);
      if (img && img.url) {
        // Reference public URL — works in all email clients incl. Gmail
        inner += `<div style="margin:14px 0"><img src="${img.url}" alt="${escapeHtml(img.filename || '')}" style="max-width:100%;height:auto;display:block;border-radius:2px"></div>`;
      } else if (img && img.previewUrl && img.previewUrl.startsWith('data:')) {
        // Fallback: data URI (works in some clients, not Gmail)
        inner += `<div style="margin:14px 0"><img src="${img.previewUrl}" alt="${escapeHtml(img.filename || '')}" style="max-width:100%;height:auto;display:block;border-radius:2px"></div>`;
      }
    } else {
      // escape + preserve line breaks
      inner += escapeHtml(part).replace(/\r?\n/g, '<br>');
    }
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f4f0;font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#222;line-height:1.7">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f4f0">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #d7d4cf">
    <tr><td style="padding:32px 28px 28px 28px;font-size:14px;line-height:1.7;color:#222">${inner}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #e6e3dd;font-size:11px;letter-spacing:.06em;color:#8c867d">
      <strong style="color:#111">대무 (DAEMU)</strong> · 061-335-1239 · daemu_office@naver.com<br>
      전라남도 나주시 황동 3길 8
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  // No CID attachments anymore — images are referenced via public URL.
  // Return empty attachments array (callers can still add their own paperclip files).
  return { html, attachments: [] };
}

async function postEmail(payload) {
  return api.post('/api/email/send', payload);
}

// 공개 Contact 폼 / 어드민 신규 문의 등록 시 자동회신
// admin /admin/mail에 저장된 템플릿(본문 + 인라인 이미지)을 가져와 변수 치환 후 발송
export async function sendAutoReply({ to_email, to_name, category, message, phone, email }) {
  const tpl = loadAdminMailTemplate();
  if (tpl.active === 'off') return { ok: false, reason: 'auto-reply-disabled' };

  const vars = {
    name: to_name || '',
    category: category || '',
    message: message || '',
    phone: phone || '',
    email: email || to_email || ''
  };
  const subject = applyVars(tpl.subject, vars);
  const body = applyVars(tpl.body, vars);
  const { html, attachments } = bodyToHtml(body, tpl.images || []);

  return postEmail({
    type: 'auto-reply',
    to: to_email,
    toName: to_name || '',
    subject,
    body,
    html,
    attachments,
    replyTo: 'daemu_office@naver.com'
  });
}

// 어드민 답변완료 처리 시 회신 메모를 직접 발송 (첨부 파일 옵션)
export async function sendAdminReply({ to_email, to_name, subject, body, attachments, images }) {
  // If images[] (with contentId) provided, build HTML with inline embedding.
  let html;
  let finalAttachments = attachments;
  if (images && images.length) {
    const out = bodyToHtml(body || '', images);
    html = out.html;
    finalAttachments = (attachments || []).concat(out.attachments);
  } else if (body) {
    // Wrap plain text in HTML envelope for consistent styling
    const out = bodyToHtml(body, []);
    html = out.html;
  }

  return postEmail({
    type: 'admin-reply',
    to: to_email,
    toName: to_name || '',
    subject: subject || '[대무] 문의 회신',
    body: body || '',
    html,
    attachments: finalAttachments,
    replyTo: 'daemu_office@naver.com'
  });
}

// 발주서 / 계약서 — body + 인라인 이미지 + 일반 첨부파일
export async function sendDocument({ to_email, to_name, subject, body, attachments, images }) {
  let html;
  let finalAttachments = attachments;
  if (images && images.length) {
    const out = bodyToHtml(body || '', images);
    html = out.html;
    finalAttachments = (attachments || []).concat(out.attachments);
  } else if (body) {
    const out = bodyToHtml(body, []);
    html = out.html;
  }
  return postEmail({
    type: 'document',
    to: to_email,
    toName: to_name || '',
    subject: subject || '[대무] 문서',
    body: body || '',
    html,
    attachments: finalAttachments,
    replyTo: 'daemu_office@naver.com'
  });
}

// 캠페인 — 백엔드가 일괄 처리, 변수 치환은 백엔드에서 (HTML 변환 추가)
export async function sendCampaign({ recipients, subject, body, channel, campaignId, images }) {
  if (channel !== 'Email') {
    return { ok: false, reason: 'channel-unsupported', simulated: true, recipients: recipients.length };
  }
  // Build HTML once (variables get replaced per-recipient by backend if needed)
  const out = bodyToHtml(body || '', images || []);
  return api.post('/api/email/campaign', {
    campaignId: campaignId || null,
    subject,
    body,
    html: out.html,
    attachments: out.attachments,
    recipients: recipients.map((r) => ({ email: r.email, name: r.name || '' })),
    replyTo: 'daemu_office@naver.com'
  }).then((res) => {
    if (res.simulated) {
      return { ok: true, simulated: true, sent: recipients.length, failed: 0 };
    }
    return { ok: res.ok, sent: res.sent || 0, failed: res.failed || 0, error: res.error };
  });
}
