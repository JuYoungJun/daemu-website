// 어드민 RawPage 백엔드 동기화 헬퍼.
//
// 환경별 (Mac / Windows / 모바일) 브라우저 localStorage 가 따로 노는 문제 해결.
// 이전엔 admin-orders-page.js / admin-works-page.js / ... 가 localStorage 만
// 단독으로 사용 → PC 마다 데이터가 다르게 보임. 이제 backend Aiven MySQL 을
// single source of truth 로 두고, localStorage 는 캐시 + offline buffer 로만.
//
// 사용 — 각 admin RawPage 의 init 부에서:
//   window.daemuHydrate({
//     storageKey: 'orders',
//     endpoint: '/api/orders?page=1&page_size=500',
//     mapItem: (it) => ({ ... admin shape ... }),  // backend → admin row
//   }).then(() => render());
//
// 쓰기 미러:
//   await window.daemuMirror({ method: 'POST', endpoint: '/api/orders', body, mapResponse });
//
// 호환:
//   · backend 미설정 (api.isConfigured()=false) → silent fallback, localStorage 유지
//   · 5xx / network 실패 → silent fallback + console.warn
//   · 401/403 → silent (Auth 가 별도로 logout flow 처리)
//
// 그리고 backend hydrate 가 진행 중인지 외부에서 알 수 있도록 boolean flag 노출.
// CSV 버튼 등이 hydrate 끝날 때까지 안내 띄울 수 있게.

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const _state = {
    hydrating: new Set(),  // 진행 중인 storageKey 들
  };

  // 외부에서 "지금 hydrate 진행 중인가" 조회.
  window.daemuIsHydrating = function (storageKey) {
    return _state.hydrating.has(storageKey);
  };

  /**
   * @param {object} opts
   * @param {string} opts.storageKey
   * @param {string} opts.endpoint
   * @param {(it: any) => any} opts.mapItem
   * @param {boolean} [opts.preserveLocal] — true 면 backend 응답이 빈 경우 localStorage 유지.
   * @returns {Promise<{ok: boolean, count: number, transient: boolean, reason?: string}>}
   */
  window.daemuHydrate = async function (opts) {
    const { storageKey, endpoint, mapItem, preserveLocal } = opts || {};
    if (!storageKey || !endpoint || typeof mapItem !== 'function') {
      return { ok: false, count: 0, transient: false, reason: 'bad-opts' };
    }
    _state.hydrating.add(storageKey);
    try {
      if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) {
        return { ok: false, count: 0, transient: true, reason: 'no-backend' };
      }
      const r = await window.api.get(endpoint);
      if (!r || !r.ok || !Array.isArray(r.items)) {
        // 401/403 도 여기로 들어옴 — Auth 가 redirect 처리. 우리는 silent.
        if (r && (r.status === 401 || r.status === 403)) {
          return { ok: false, count: 0, transient: false, reason: 'auth' };
        }
        return { ok: false, count: 0, transient: true, reason: 'fetch-failed' };
      }
      const mapped = r.items.map((it) => {
        try {
          const out = mapItem(it);
          if (out && typeof out === 'object') {
            out._backend = true;  // marker — backend row 표식 (있으면 PATCH/DELETE 시 backend 호출)
            if (out.id == null && it.id != null) out.id = it.id;
          }
          return out;
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      if (preserveLocal && mapped.length === 0) {
        // backend 가 빈 배열이고 보호 옵션 켜진 경우 — localStorage 유지.
        return { ok: true, count: 0, transient: false, reason: 'empty-preserved' };
      }

      try {
        if (window.DB && typeof window.DB.set === 'function') {
          window.DB.set(storageKey, mapped);
          window.dispatchEvent(new Event('daemu-db-change'));
        }
      } catch (_) { /* ignore */ }

      return { ok: true, count: mapped.length, transient: false };
    } catch (e) {
      try { console.warn('[daemuHydrate]', storageKey, e); } catch (_) { /* ignore */ }
      return { ok: false, count: 0, transient: true, reason: 'exception' };
    } finally {
      _state.hydrating.delete(storageKey);
    }
  };

  /**
   * 쓰기 연산 backend 미러.
   *   { method, endpoint, body, mapResponse, onAuthFail }
   * @returns {Promise<{ok, status, item?, error?}>}
   */
  window.daemuMirror = async function (opts) {
    const { method, endpoint, body, mapResponse } = opts || {};
    if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) {
      return { ok: false, status: 0, error: 'no-backend' };
    }
    try {
      let r;
      const m = String(method || 'GET').toUpperCase();
      if (m === 'POST') r = await window.api.post(endpoint, body);
      else if (m === 'PATCH') r = await window.api.patch(endpoint, body);
      else if (m === 'PUT') r = await window.api.put(endpoint, body);
      else if (m === 'DELETE') r = await window.api.del(endpoint);
      else r = await window.api.get(endpoint);
      if (!r || (!r.ok && r.status !== 204)) {
        return { ok: false, status: r ? r.status : 0, error: (r && r.error) || 'fetch-failed' };
      }
      let item = r.item || null;
      if (item && typeof mapResponse === 'function') {
        try { item = mapResponse(item); } catch (_) { /* ignore */ }
      }
      return { ok: true, status: r.status || 200, item };
    } catch (e) {
      return { ok: false, status: 0, error: String(e) };
    }
  };

  /**
   * client-side temp id 생성 (offline create 후 hydrate race 방지).
   * 음수 timestamp + random — backend 의 양수 PK 와 충돌 없음.
   */
  window.daemuTempId = function () {
    return -1 * (Date.now() * 1000 + Math.floor(Math.random() * 1000));
  };
})();
