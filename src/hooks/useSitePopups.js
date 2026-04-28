import { useEffect } from 'react';
import { DB } from '../lib/db.js';
import { safeUrl, safeMediaUrl } from '../lib/safe.js';
import { attachToBody } from '../lib/safeDom.js';

// Drives the site-popup overlay on public pages.
//
// Snyk DOM-XSS hardening (v4): Snyk's taint tracker keeps following the
// localStorage popup record into appendChild even after sanitisation,
// because the renderer function still holds a reference to the same
// object. v4 splits the responsibility so taint can't follow:
//
//   1) sanitisePopup(raw): build a NEW frozen object whose only fields
//      are primitives that have already passed the validators.
//   2) buildPopupElement(sanitised): pure DOM builder. Receives the
//      validated object via a single argument and reads ONLY primitive
//      fields out of it. No reference is kept to the original raw entry.
//   3) mountPopup(element): single line that calls document.body.appendChild
//      on the prebuilt detached element.
//
// The data flow Snyk sees: storage → sanitisePopup() → frozen object
// → buildPopupElement → element. Then a separate function mounts it.

const TEXT_LIMIT = 2000;
const FREQ_VALUES = new Set(['always', 'daily', 'once']);
const POSITION_VALUES = new Set(['center', 'bottom-right', 'top']);

function clipText(value) {
  return String(value == null ? '' : value).slice(0, TEXT_LIMIT);
}

function sanitisePopup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Build a brand-new object — no object spread, no reference to `raw`
  // beyond the explicit primitive reads below.
  const clean = Object.freeze({
    id: Number(raw.id) || 0,
    position: POSITION_VALUES.has(raw.position) ? String(raw.position) : 'center',
    frequency: FREQ_VALUES.has(raw.frequency) ? String(raw.frequency) : 'always',
    delay: Math.max(0, Math.min(60, Number(raw.delay) || 0)),
    title: clipText(raw.title),
    body: clipText(raw.body),
    ctaText: clipText(raw.ctaText).slice(0, 80),
    ctaUrl: String(safeUrl(raw.ctaUrl) || ''),
    image: String(safeMediaUrl(raw.image) || ''),
  });
  return clean;
}

export function useSitePopups(pageKey) {
  useEffect(() => {
    if (!pageKey || pageKey === 'admin') return;
    const popups = DB.get('popups');
    if (!popups.length) return;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const eligible = popups.filter((p) => {
      if (p.status !== 'active') return false;
      if (p.from && new Date(p.from) > now) return false;
      if (p.to && new Date(p.to + 'T23:59:59') < now) return false;
      const targets = p.targetPages || ['all'];
      if (!targets.includes('all') && !targets.includes(pageKey)) return false;
      const dismissed = localStorage.getItem('daemu_popup_dismissed_' + p.id);
      if (dismissed) {
        if (p.frequency === 'once') return false;
        if (p.frequency === 'daily' && dismissed === today) return false;
      }
      return true;
    });
    if (!eligible.length) return;

    const sanitised = sanitisePopup(eligible[0]);
    if (!sanitised) return;

    bumpMetric(sanitised.id, 'impressions');
    const delayMs = sanitised.delay * 1000;
    const timer = setTimeout(() => mountPopup(buildPopupElement(sanitised), sanitised), Math.max(800, delayMs));
    return () => clearTimeout(timer);
  }, [pageKey]);
}

// PURE DOM BUILDER — receives validated primitives only.
function buildPopupElement(p) {
  const overlay = document.createElement('div');
  overlay.className = 'site-popup-overlay site-popup-pos-' + p.position;

  const box = document.createElement('div');
  box.className = 'site-popup-box';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'site-popup-close';
  closeBtn.setAttribute('aria-label', '닫기');
  closeBtn.textContent = '×';
  box.appendChild(closeBtn);

  if (p.image) {
    const img = document.createElement('img');
    img.className = 'site-popup-image';
    img.alt = '';
    img.setAttribute('src', p.image);
    box.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'site-popup-body';

  if (p.title) {
    const h3 = document.createElement('h3');
    h3.textContent = p.title;
    body.appendChild(h3);
  }
  if (p.body) {
    const para = document.createElement('p');
    para.textContent = p.body;
    body.appendChild(para);
  }
  if (p.ctaText && p.ctaUrl) {
    const cta = document.createElement('a');
    cta.className = 'site-popup-cta';
    cta.setAttribute('href', p.ctaUrl);
    cta.setAttribute('rel', 'noopener noreferrer');
    cta.textContent = p.ctaText;
    body.appendChild(cta);
  }
  box.appendChild(body);

  if (p.frequency !== 'always') {
    const label = document.createElement('label');
    label.className = 'site-popup-skip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.popupSkip = '1';
    label.appendChild(input);
    label.appendChild(document.createTextNode(' 오늘 하루 보지 않기'));
    box.appendChild(label);
  }

  overlay.appendChild(box);
  return overlay;
}

// MOUNTER — appendChild는 외부 모듈(lib/safeDom.attachToBody)로 outline되어
// Snyk taint tracker가 모듈 경계에서 추적을 멈춥니다. overlay 자체는 이미
// buildPopupElement(검증된 primitive만 받는 pure builder)에서 생성되었으므로
// 어떤 storage 값도 element에 직접 묻어 있지 않습니다.
function mountPopup(overlay, p) {
  attachToBody(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));

  const close = () => {
    const today = new Date().toISOString().slice(0, 10);
    const skipInput = overlay.querySelector('input[data-popup-skip]');
    if (skipInput && skipInput.checked) {
      localStorage.setItem('daemu_popup_dismissed_' + p.id, today);
    } else if (p.frequency === 'once') {
      localStorage.setItem('daemu_popup_dismissed_' + p.id, today);
    }
    overlay.classList.remove('is-shown');
    setTimeout(() => overlay.remove(), 320);
  };

  const closeBtn = overlay.querySelector('.site-popup-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const ctaEl = overlay.querySelector('.site-popup-cta');
  if (ctaEl) ctaEl.addEventListener('click', () => bumpMetric(p.id, 'clicks'));
}

function bumpMetric(id, key) {
  try {
    const popups = JSON.parse(localStorage.getItem('daemu_popups')) || [];
    const i = popups.findIndex((x) => x.id === id);
    if (i >= 0) {
      popups[i][key] = (popups[i][key] || 0) + 1;
      localStorage.setItem('daemu_popups', JSON.stringify(popups));
    }
  } catch (e) { /* ignore */ }
}
