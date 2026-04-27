import { useEffect } from 'react';
import { DB } from '../lib/db.js';
import { escapeHtml } from '../lib/db.js';

// Allow only safe URL schemes in popup CTA links to prevent XSS via
// javascript: / data: URLs that the admin (or a compromised admin row)
// could store in localStorage.
function safeUrl(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return '#';
  if (v.startsWith('/') || v.startsWith('#') || v.startsWith('?')) return escapeHtml(v);
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return escapeHtml(v);
  const scheme = m[1].toLowerCase();
  return (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel')
    ? escapeHtml(v) : '#';
}

// Drives the site-popup overlay on public pages.
// Mirrors the script.js init_site_popups behavior so admin-managed popups still work.
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
  const overlay = document.createElement('div');
  overlay.className = 'site-popup-overlay site-popup-pos-' + (popup.position || 'center');
  const imgHtml = popup.image ? `<img class="site-popup-image" src="${safeUrl(popup.image)}" alt="">` : '';
  const titleHtml = popup.title ? `<h3>${escapeHtml(popup.title)}</h3>` : '';
  const bodyHtml = popup.body ? `<p>${escapeHtml(popup.body)}</p>` : '';
  const ctaHtml = (popup.ctaText && popup.ctaUrl)
    ? `<a class="site-popup-cta" href="${safeUrl(popup.ctaUrl)}">${escapeHtml(popup.ctaText)}</a>` : '';
  const skipHtml = popup.frequency !== 'always'
    ? `<label class="site-popup-skip"><input type="checkbox"> 오늘 하루 보지 않기</label>` : '';
  overlay.innerHTML = `<div class="site-popup-box">
    <button class="site-popup-close" aria-label="닫기">×</button>
    ${imgHtml}
    <div class="site-popup-body">${titleHtml}${bodyHtml}${ctaHtml}</div>
    ${skipHtml}
  </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));

  const close = () => {
    const skip = overlay.querySelector('.site-popup-skip input');
    const today = new Date().toISOString().slice(0, 10);
    if (skip && skip.checked) localStorage.setItem('daemu_popup_dismissed_' + popup.id, today);
    else if (popup.frequency === 'once') localStorage.setItem('daemu_popup_dismissed_' + popup.id, today);
    overlay.classList.remove('is-shown');
    setTimeout(() => overlay.remove(), 320);
  };
  overlay.querySelector('.site-popup-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const cta = overlay.querySelector('.site-popup-cta');
  if (cta) cta.addEventListener('click', () => bumpMetric(popup.id, 'clicks'));
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
