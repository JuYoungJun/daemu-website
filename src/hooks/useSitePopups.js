import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
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

// 공개 사이트 팝업은 backend Aiven `site_popups` 가 source of truth.
// 본 hook 은 `/api/popups/visible` (active=True) 만 fetch.
// "보지 않기" 같은 사용자 클라이언트 환경 dismiss 정보만 localStorage 에 보관 —
// 서비스 데이터 아님 (브라우저 단위 UX 상태).
//
// backend popup 모델 매핑: page_key/active/scheduled_start/scheduled_end/title/body/
//                          image_url/cta_label/cta_href/placement/frequency.

function _mapBackendPopup(it) {
  return {
    id: Number(it.id) || 0,
    title: it.title || '',
    body: it.body || '',
    image: it.image_url || '',
    ctaText: it.cta_label || '',
    ctaUrl: it.cta_href || '',
    position: it.placement || 'center',
    frequency: it.frequency || 'always',
    delay: 0,
    status: it.active === false ? 'paused' : 'active',
    from: it.scheduled_start || '',
    to: it.scheduled_end || '',
    page_key: it.page_key || 'all',
  };
}

export function useSitePopups(pageKey) {
  const [popup, setPopup] = useState(null);

  useEffect(() => {
    if (!pageKey || pageKey === 'admin') return;
    let alive = true;
    let timer = null;
    (async () => {
      // backend 미연결이면 popup 미표시 (정책 — localStorage 시드 사용 금지).
      if (!api.isConfigured()) return;
      let items = [];
      try {
        const r = await api.get('/api/popups/visible');
        if (r && r.ok && Array.isArray(r.items)) items = r.items.map(_mapBackendPopup);
      } catch { /* network error — silent */ }
      if (!alive || !items.length) return;

      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const eligible = items.filter((p) => {
        if (p.status !== 'active') return false;
        if (p.from && new Date(p.from) > now) return false;
        if (p.to && new Date(String(p.to).slice(0, 10) + 'T23:59:59') < now) return false;
        const target = p.page_key || 'all';
        if (target !== 'all' && target !== pageKey) return false;
        const dismissed = localStorage.getItem('daemu_popup_dismissed_' + p.id);
        if (dismissed) {
          if (p.frequency === 'once') return false;
          if (p.frequency === 'daily' && dismissed === today) return false;
        }
        // 같은 브라우저 세션에서는 한 번 닫은 팝업을 다시 띄우지 않음 —
        // frequency='always' 만 예외 (매 방문마다 노출 의도).
        if (p.frequency !== 'always') {
          try {
            if (sessionStorage.getItem('daemu_popup_session_' + p.id)) return false;
          } catch { /* sessionStorage 비활성 — 무시 */ }
        }
        return true;
      });
      if (!eligible.length) return;

      const sanitised = sanitisePopup(eligible[0]);
      if (!sanitised) return;
      const delayMs = sanitised.delay * 1000;
      timer = setTimeout(() => { if (alive) setPopup(sanitised); }, Math.max(800, delayMs));
    })();
    return () => { alive = false; if (timer) clearTimeout(timer); setPopup(null); };
  }, [pageKey]);

  return popup;
}

// Called from the close handler of the React-rendered popup.
// localStorage 사용은 사용자 단위 dismiss UX 상태 한정 (서비스 데이터 X).
export function dismissPopup(p, withSkipChecked) {
  if (!p) return;
  const today = new Date().toISOString().slice(0, 10);
  // localStorage: 영속 dismiss — "오늘 하루 보지 않기" 체크 또는
  // frequency='daily'/'once' 정책상 같은 날 재노출 금지.
  if (withSkipChecked || p.frequency === 'once' || p.frequency === 'daily') {
    try {
      localStorage.setItem('daemu_popup_dismissed_' + p.id, today);
    } catch { /* storage 비활성 — 무시 */ }
  }
  // sessionStorage: 같은 세션 내 재노출 차단. frequency='always' 만 예외.
  if (p.frequency !== 'always') {
    try {
      sessionStorage.setItem('daemu_popup_session_' + p.id, '1');
    } catch { /* storage 비활성 — 무시 */ }
  }
}

// impressions / clicks 집계는 backend 모델에 컬럼이 없어 운영 단계에서
// 별도 분석 endpoint 도입 예정. demo 단계는 측정 안 함.
export function bumpMetric(_id, _key) { /* noop */ }
