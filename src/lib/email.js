// Email sender. Talks to a backend endpoint (POST /api/email/send) where
// the backend uses Resend / SendGrid / Brevo etc. In demo mode (no backend),
// requests are simulated and logged to localStorage outbox so admin can see
// what would have been sent.

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
    category: 'all'
  };
}

async function postEmail(payload) {
  return api.post('/api/email/send', payload);
}

// 공개 Contact 폼 / 어드민 신규 문의 등록 시 자동회신
// admin /admin/mail에 저장된 템플릿을 가져와 변수 치환 후 발송
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

  return postEmail({
    type: 'auto-reply',
    to: to_email,
    toName: to_name || '',
    subject: applyVars(tpl.subject, vars),
    body: applyVars(tpl.body, vars),
    replyTo: 'daemu_office@naver.com'
  });
}

// 어드민 답변완료 처리 시 회신 메모를 직접 발송
export async function sendAdminReply({ to_email, to_name, subject, body }) {
  return postEmail({
    type: 'admin-reply',
    to: to_email,
    toName: to_name || '',
    subject: subject || '[대무] 문의 회신',
    body: body || '',
    replyTo: 'daemu_office@naver.com'
  });
}

// 캠페인 발송 — 백엔드가 수신자 리스트를 받아 일괄 처리하도록 위임
export async function sendCampaign({ recipients, subject, body, channel, campaignId }) {
  if (channel !== 'Email') {
    return { ok: false, reason: 'channel-unsupported', simulated: true, recipients: recipients.length };
  }
  return api.post('/api/email/campaign', {
    campaignId: campaignId || null,
    subject,
    body,
    recipients: recipients.map((r) => ({ email: r.email, name: r.name || '' })),
    replyTo: 'daemu_office@naver.com'
  }).then((res) => {
    // Backend returns { ok, sent, failed } — in demo mode it's simulated
    if (res.simulated) {
      return { ok: true, simulated: true, sent: recipients.length, failed: 0 };
    }
    return { ok: res.ok, sent: res.sent || 0, failed: res.failed || 0, error: res.error };
  });
}
