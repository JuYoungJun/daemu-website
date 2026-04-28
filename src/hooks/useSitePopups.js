import { useEffect, useState } from 'react';
import { DB } from '../lib/db.js';
import { safeUrl, safeMediaUrl } from '../lib/safe.js';

// Drives the site-popup overlay on public pages.
//
// Snyk DOM-XSS hardening (v5 — final): the entire imperative DOM-API
// pipeline is gone. The hook now returns a sanitised popup record (or
// null) and the caller renders it through React + createPortal. React
// auto-escapes text content, attribute values are validated by
// safeMediaUrl/safeUrl helpers, and there is no document.body.appendChild
// for Snyk's taint tracker to follow.
//
// Use:
//   const popup = useSitePopups(pageKey);
//   return <>{popup && <SitePopupOverlay popup={popup} />}</>;

const TEXT_LIMIT = 2000;
const FREQ_VALUES = new Set(['always', 'daily', 'once']);
const POSITION_VALUES = new Set(['center', 'bottom-right', 'top']);

function clipText(value) {
  return String(value == null ? '' : value).slice(0, TEXT_LIMIT);
}

// Build a frozen primitive-only record. Anything from localStorage that
// can't pass the validators is replaced with a safe default. Caller never
// touches the original `raw` object beyond this function.
function sanitisePopup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return Object.freeze({
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
}

export function useSitePopups(pageKey) {
  const [popup, setPopup] = useState(null);

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
    if (!eligible.length) { setPopup(null); return; }

    const sanitised = sanitisePopup(eligible[0]);
    if (!sanitised) return;
    bumpMetric(sanitised.id, 'impressions');

    const delayMs = sanitised.delay * 1000;
    const timer = setTimeout(() => setPopup(sanitised), Math.max(800, delayMs));
    return () => { clearTimeout(timer); setPopup(null); };
  }, [pageKey]);

  return popup;
}

// Called from the close handler of the React-rendered popup.
export function dismissPopup(p, withSkipChecked) {
  if (!p) return;
  const today = new Date().toISOString().slice(0, 10);
  if (withSkipChecked) {
    localStorage.setItem('daemu_popup_dismissed_' + p.id, today);
  } else if (p.frequency === 'once') {
    localStorage.setItem('daemu_popup_dismissed_' + p.id, today);
  }
}

export function bumpMetric(id, key) {
  try {
    const popups = JSON.parse(localStorage.getItem('daemu_popups')) || [];
    const i = popups.findIndex((x) => x.id === id);
    if (i >= 0) {
      popups[i][key] = (popups[i][key] || 0) + 1;
      localStorage.setItem('daemu_popups', JSON.stringify(popups));
    }
  } catch (e) { /* ignore */ }
}
