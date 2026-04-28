// Global handler for legacy `<form data-consult-form>` markup that lives in
// raw-page HTML strings (process / service / contact-bottom etc).
// Behavior mirrors the React Contact page: persist inquiry to DB, fire EmailJS
// auto-reply via backend, show site dialog confirmation.

import { DB } from './db.js';
import { sendAutoReply } from './email.js';
import { api } from './api.js';
import { formatPhone, normalizeEmail } from './inputFormat.js';

export function installConsultFormHandler() {
  if (typeof document === 'undefined') return;
  if (window.__daemuConsultBound) return;
  window.__daemuConsultBound = true;

  // 입력 시점 자동 포맷 — raw-page 의 <form data-consult-form> 안에 있는
  // 전화·이메일 input 이 타이핑 도중 010-1234-5678 형태로 자동 정렬됨.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (!t.closest('form[data-consult-form]')) return;
    if (t.matches('input[type="tel"], input[name="phone"], input[type="text"][placeholder*="0000"], input[type="text"][placeholder*="010"]')) {
      const formatted = formatPhone(t.value);
      if (formatted !== t.value) {
        const pos = t.selectionStart;
        t.value = formatted;
        try { t.setSelectionRange(formatted.length, formatted.length); } catch { /* ignore */ }
      }
    } else if (t.matches('input[type="email"], input[name="email"]')) {
      // 이메일은 공백 즉시 제거 (보내는 알파벳·숫자 keystroke 는 그대로).
      if (/\s/.test(t.value)) t.value = t.value.replace(/\s/g, '');
    }
  }, true);

  // blur 시점 — 이메일 소문자 정규화.
  document.addEventListener('blur', (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (!t.closest('form[data-consult-form]')) return;
    if (t.matches('input[type="email"], input[name="email"]')) {
      t.value = normalizeEmail(t.value);
    }
  }, true);

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-consult-form]');
    if (!form) return;
    e.preventDefault();

    if (form.dataset.submitting === '1') return;
    form.dataset.submitting = '1';
    const submitBtn = form.querySelector('button[type="submit"], .dmprc-form-btn');
    const origLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) submitBtn.disabled = true;

    const get = (selectors) => {
      for (const sel of selectors) {
        const el = form.querySelector(sel);
        if (el && (el.value || '').trim()) return el.value.trim();
      }
      return '';
    };

    // Collect — flexible by placeholder/type since label markup varies per page
    const name    = get(['input[type="text"][placeholder*="이름"]', 'input[name="name"]']) ||
                    form.querySelector('input[type="text"]')?.value?.trim() || '';
    const phone   = get(['input[type="text"][placeholder*="0000"]', 'input[name="phone"]', 'input[type="tel"]']);
    const email   = get(['input[type="email"]', 'input[name="email"]']);
    const select  = form.querySelector('select');
    const rawCategory = (select && select.value) || '';
    const isPlaceholder = !rawCategory || rawCategory === '선택해주세요';
    const category = isPlaceholder ? (form.dataset.category || '상담 문의') : rawCategory;
    const message = (form.querySelector('textarea')?.value || '').trim();
    const hidden  = form.querySelector('input[type="hidden"][name="consult_category"]')?.value;
    const finalCategory = hidden || category;

    if (!name) {
      alert('이름(회사명)을 입력해 주세요.');
      restore();
      return;
    }
    if (!email) {
      alert('이메일을 입력해 주세요.');
      restore();
      return;
    }

    // PIPA consent. Legacy forms (process/contact-bottom) don't render a
    // dedicated checkbox so we surface the disclosure here. Skip silently
    // if the user declines — same UX as the React Contact form.
    const consentMsg =
      '개인정보 수집·이용에 동의하시겠습니까?\n\n' +
      '· 수집 항목: 이름, 이메일, 연락처(선택), 문의 내용\n' +
      '· 보유 기간: 3년\n' +
      '· 자세한 내용은 /privacy 페이지를 참고해 주세요.';
    if (!window.confirm(consentMsg)) {
      restore();
      return;
    }

    // V3-10: only mirror to localStorage in offline demo mode. Otherwise
    // the backend is the source of truth and the visitor's browser
    // doesn't accumulate inquiry copies.
    if (!api.isConfigured()) {
      DB.add('inquiries', {
        name, phone, email, type: finalCategory, msg: message, status: '신규'
      });
    }

    let mailNote = '';
    if (api.isConfigured()) {
      // Backend persists + fires auto-reply server-side. No public mail relay.
      const r = await api.post('/api/inquiries', {
        name, email, phone, category: finalCategory, message,
        privacy_consent: true,
      });
      if (r.ok) {
        mailNote = '입력하신 이메일(' + email + ')로 접수 확인 메일이 발송됩니다.';
      } else if (r.status === 429) {
        mailNote = '문의가 너무 빠르게 접수되었습니다. 잠시 후 다시 시도해 주세요.';
      } else {
        mailNote = '접수는 완료되었지만 자동 회신 메일에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
      }
    } else {
      // Demo mode fallback (no backend) — simulate via the email lib so the
      // localStorage outbox shows the simulated send.
      try {
        const r = await sendAutoReply({ to_email: email, to_name: name, category: finalCategory, message, phone, email });
        mailNote = r.simulated
          ? '입력하신 이메일(' + email + ')로 접수 확인 메일이 발송될 예정입니다.'
          : '입력하신 이메일(' + email + ')로 접수 확인 메일이 발송되었습니다.';
      } catch {
        mailNote = '메일 발송에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
      }
    }

    alert('상담 신청이 접수되었습니다. (' + finalCategory + ')\n\n' + mailNote + '\n\n담당 매니저가 빠른 시일 내에 연락드리겠습니다.');
    form.reset();
    restore();

    function restore() {
      form.dataset.submitting = '';
      if (submitBtn) {
        submitBtn.disabled = false;
        if (origLabel) submitBtn.textContent = origLabel;
      }
    }
  });
}
