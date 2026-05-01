(function() {
  'use strict';

  // 사이트 정보 — backend `/api/content/siteinfo` 와 양방향 동기화.
  // localStorage 'daemu_siteinfo' 는 1차 캐시 (offline / api 미연결 시 사용).
  // 저장 시: localStorage + backend PUT 둘 다. 페이지 mount 시 backend 에서
  // hydrate → localStorage 갱신 → DOM 갱신. 결과적으로 Mac/Windows 어디서
  // 들어와도 같은 정보가 보임.
  const STORAGE_KEY = 'daemu_siteinfo';
  const CONTENT_KEY = 'siteinfo';
  const defaults = {
    company: "대무 (DAEMU)",
    email: "daemu_office@naver.com",
    phone: "061-335-1239",
    addr: "전라남도 나주시 황동 3길 8",
  };

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || defaults; }
    catch (_) { return { ...defaults }; }
  }

  function fillForm(info) {
    const el = (id) => document.getElementById(id);
    if (el('s-company')) el('s-company').value = info.company || '';
    if (el('s-email')) el('s-email').value = info.email || '';
    if (el('s-phone')) el('s-phone').value = info.phone || '';
    if (el('s-addr')) el('s-addr').value = info.addr || '';
  }

  // 1) localStorage 캐시로 즉시 화면 채움 (깜빡임 방지)
  fillForm(readLocal());

  // 2) backend 에서 fresh fetch — 성공 시 캐시 갱신 + DOM 갱신
  (async function hydrateFromBackend() {
    try {
      if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) return;
      const r = await window.api.get('/api/content/' + CONTENT_KEY);
      if (r && r.ok && r.value && typeof r.value === 'object') {
        const info = { ...defaults, ...r.value };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(info)); }
        catch (_) { /* ignore */ }
        fillForm(info);
      }
    } catch (_) { /* offline / 일시 오류 — localStorage 캐시로 진행 */ }
  })();

  async function saveSiteInfo() {
    const info = {
      company: document.getElementById('s-company').value,
      email: document.getElementById('s-email').value,
      phone: document.getElementById('s-phone').value,
      addr: document.getElementById('s-addr').value,
    };
    // localStorage 즉시 갱신 (낙관적 업데이트)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(info)); }
    catch (_) { /* ignore */ }

    // backend 에 PUT — 실패해도 사용자 화면은 이미 저장된 상태
    let backendOk = false;
    try {
      if (window.api && window.api.isConfigured && window.api.isConfigured()) {
        const r = await window.api.put('/api/content/' + CONTENT_KEY, { value: info });
        backendOk = !!(r && r.ok);
      }
    } catch (_) { /* fallthrough */ }

    if (backendOk) {
      if (window.siteToast) window.siteToast('저장되었습니다 — 모든 환경에 반영', { tone: 'success' });
      else alert('저장되었습니다.');
    } else {
      if (window.siteToast) window.siteToast('저장됨 (이 브라우저 캐시 — 백엔드 미연결 또는 일시 오류)', { tone: 'warn' });
      else alert('저장되었습니다 (이 브라우저 캐시).');
    }
  }

  Object.assign(window, { saveSiteInfo });
})();
