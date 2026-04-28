import { useEffect } from 'react';
import { DB } from '../lib/db.js';
import { safeUrl, safeMediaUrl } from '../lib/safe.js';

// Drives the site-popup overlay on public pages.
//
// Snyk DOM-XSS hardening (v3): popup content comes from localStorage. The
// previous version already routed everything through textContent / safeUrl,
// but Snyk's taint tracker still flagged appendChild because tainted
// values were carried inside the popup object until the moment of node
// construction. v3 takes a different shape:
//
//   1. Read the popup from storage.
//   2. IMMEDIATELY copy primitive fields into a fresh object whose values
//      are explicitly normalised — strings clipped to a length cap,
//      numbers coerced via Number(), URLs filtered through safeUrl/
//      safeMediaUrl. The shape of the new object never carries any value
//      that didn't pass a validator.
//   3. Build the DOM from that sanitised object only.
//
// This breaks the taint chain at step 2: the appendChild() call no longer
// has a path back to localStorage in Snyk's data flow graph.

const TEXT_LIMIT = 2000;
const FREQ_VALUES = new Set(['always', 'daily', 'once']);
const POSITION_VALUES = new Set(['center', 'bottom-right', 'top']);

function clipText(value) {
  return String(value == null ? '' : value).slice(0, TEXT_LIMIT);
}

// Build a "clean" popup record — every field is explicitly validated.
// The downstream renderer is given ONLY this clean object.
function sanitisePopup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: Number(raw.id) || 0,
    position: POSITION_VALUES.has(raw.position) ? raw.position : 'center',
    frequency: FREQ_VALUES.has(raw.frequency) ? raw.frequency : 'always',
    delay: Math.max(0, Math.min(60, Number(raw.delay) || 0)),
    title: clipText(raw.title),
    body: clipText(raw.body),
    ctaText: clipText(raw.ctaText).slice(0, 80),
    // safeUrl returns '' for unsafe schemes; safeMediaUrl is even stricter
    // for image src.
    ctaUrl: safeUrl(raw.ctaUrl),
    image: safeMediaUrl(raw.image),
  };
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

    // Sanitise BEFORE we let the value out of the localStorage region.
    const popup = sanitisePopup(eligible[0]);
    if (!popup) return;

    const delayMs = popup.delay * 1000;
    const timer = setTimeout(() => showPopup(popup), Math.max(800, delayMs));
    bumpMetric(popup.id, 'impressions');
    return () => clearTimeout(timer);
  }, [pageKey]);
}

// `popup` here is ALWAYS the sanitised shape from sanitisePopup().
// No raw localStorage value reaches this function.
function showPopup(popup) {
  // Root overlay
  const overlay = document.createElement('div');
  overlay.className = 'site-popup-overlay site-popup-pos-' + popup.position;

  // Box
  const box = document.createElement('div');
  box.className = 'site-popup-box';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'site-popup-close';
  closeBtn.setAttribute('aria-label', '닫기');
  closeBtn.textContent = '×';
  box.appendChild(closeBtn);

  // Image — popup.image already passed safeMediaUrl. Empty string means blocked.
  if (popup.image) {
    const img = document.createElement('img');
    img.className = 'site-popup-image';
    img.alt = '';
    img.setAttribute('src', popup.image);
    box.appendChild(img);
  }

  // Body container — text via textContent, no innerHTML.
  const body = document.createElement('div');
  body.className = 'site-popup-body';

  if (popup.title) {
    const h3 = document.createElement('h3');
    h3.textContent = popup.title;
    body.appendChild(h3);
  }
  if (popup.body) {
    const p = document.createElement('p');
    p.textContent = popup.body;
    body.appendChild(p);
  }
  if (popup.ctaText && popup.ctaUrl) {
    const cta = document.createElement('a');
    cta.className = 'site-popup-cta';
    cta.setAttribute('href', popup.ctaUrl);
    cta.setAttribute('rel', 'noopener noreferrer');
    cta.textContent = popup.ctaText;
    body.appendChild(cta);
  }
  box.appendChild(body);

  // "Don't show today" checkbox
  let skipInput = null;
  if (popup.frequency !== 'always') {
    const label = document.createElement('label');
    label.className = 'site-popup-skip';
    skipInput = document.createElement('input');
    skipInput.type = 'checkbox';
    label.appendChild(skipInput);
    label.appendChild(document.createTextNode(' 오늘 하루 보지 않기'));
    box.appendChild(label);
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));

  const close = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (skipInput && skipInput.checked) {
      localStorage.setItem('daemu_popup_dismissed_' + popup.id, today);
    } else if (popup.frequency === 'once') {
      localStorage.setItem('daemu_popup_dismissed_' + popup.id, today);
    }
    overlay.classList.remove('is-shown');
    setTimeout(() => overlay.remove(), 320);
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const ctaEl = overlay.querySelector('.site-popup-cta');
  if (ctaEl) ctaEl.addEventListener('click', () => bumpMetric(popup.id, 'clicks'));
}

function bumpMetric(id, key) {
  try {
    const popups = JSON.parse(localStorage.getItem('daemu_popups')) || [];
    const i = popups.findIndex((p) => p.id === id);
    if (i >= 0) {
      popups[i][key] = (popups[i][key] || 0) + 1;
      localStorage.setItem('daemu_popups', JSON.stringify(popups));
    }
  } catch (e) { /* ignore */ }
}
