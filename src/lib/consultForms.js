// Global handler for legacy `<form data-consult-form>` markup that lives in
// raw-page HTML strings (process / service / contact-bottom etc).
// Behavior mirrors the React Contact page: persist inquiry to DB, fire EmailJS
// auto-reply via backend, show site dialog confirmation.

import { DB } from './db.js';
import { sendAutoReply } from './email.js';

export function installConsultFormHandler() {
  if (typeof document === 'undefined') return;
  if (window.__daemuConsultBound) return;
  window.__daemuConsultBound = true;

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
    const category = (select && select.value) || form.dataset.category || '상담';
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

    DB.add('inquiries', {
      name, phone, email, type: finalCategory, msg: message, status: '신규'
    });

    let mailNote = '';
    try {
      const r = await sendAutoReply({
        to_email: email, to_name: name, category: finalCategory, message, phone, email
      });
      if (r.ok) mailNote = '입력하신 이메일(' + email + ')로 접수 확인 메일이 발송되었습니다.';
      else if (r.simulated) mailNote = '입력하신 이메일(' + email + ')로 접수 확인 메일이 발송될 예정입니다.';
      else mailNote = '메일 발송에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
    } catch (err) {
      mailNote = '메일 발송에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
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
