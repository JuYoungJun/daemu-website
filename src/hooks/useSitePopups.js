import { useEffect } from 'react';
import { DB } from '../lib/db.js';
import { safeUrl, createTextEl, appendChildren } from '../lib/safe.js';

// Drives the site-popup overlay on public pages.
//
// Snyk DOM-XSS hardening (v2): popup content comes from localStorage which
// the admin can set. Even though the admin is a trusted role, treating
// browser-storage values as untrusted lets us survive a compromised admin
// session, a malicious imported popup, or a stored XSS in any future
// admin tool that writes the same key.
//
// Implementation notes:
//   · Every text field goes through textContent (NEVER innerHTML).
//   · Every URL goes through safeUrl() — javascript:/data:/vbscript: rejected.
//   · No template strings build HTML.

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

    const popup = eligible[0];
    const delayMs = (parseInt(popup.delay, 10) || 0) * 1000;

    const timer = setTimeout(() => showPopup(popup), Math.max(800, delayMs));
    bumpMetric(popup.id, 'impressions');
    return () => clearTimeout(timer);
  }, [pageKey]);
}

function showPopup(popup) {
  // Root overlay
  const overlay = document.createElement('div');
  overlay.className = 'site-popup-overlay site-popup-pos-' + (popup.position || 'center');

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

  // Image (optional). createTextEl validates the URL via safeUrl; the
  // attribute is only set if the URL passes the allow-list.
  const imgUrl = safeUrl(popup.image);
  if (imgUrl) {
    const img = document.createElement('img');
    img.className = 'site-popup-image';
    img.alt = '';
    img.setAttribute('src', imgUrl);
    box.appendChild(img);
  }

  // Body container
  const body = document.createElement('div');
  body.className = 'site-popup-body';

  if (popup.title) {
    body.appendChild(createTextEl('h3', popup.title));
  }
  if (popup.body) {
    body.appendChild(createTextEl('p', popup.body));
  }
  if (popup.ctaText && popup.ctaUrl) {
    const ctaUrl = safeUrl(popup.ctaUrl);
    if (ctaUrl) {
      const cta = createTextEl('a', popup.ctaText, { class: 'site-popup-cta', href: ctaUrl });
      cta.setAttribute('rel', 'noopener noreferrer');
      body.appendChild(cta);
    }
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
