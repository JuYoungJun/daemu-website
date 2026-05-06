// 어드민 RawPage 백엔드 동기화 헬퍼.
//
// 정책 (2026-05): backend Aiven MySQL = single source of truth.
// localStorage 는 어드민 공유 데이터의 source 가 아닙니다 — 본 헬퍼는
// 메모리 전용 `window.daemuStore[storageKey]` 에만 행을 적재합니다.
// 어드민 공유 데이터(works/orders/partners/popups/promotions/inquiries/
// campaigns/crm/content/mail/media) 가 어떤 환경에 로그인해도 동일하게
// 보이도록 보장합니다.
//
// 사용 — 각 admin RawPage 의 init 부에서:
//   window.daemuHydrate({
//     storageKey: 'orders',
//     endpoint: '/api/orders?page=1&page_size=500',
//     mapItem: (it) => ({ ... admin shape ... }),
//   }).then(() => render());
//
// rows 읽기 — 페이지의 render() 함수가 localStorage 대신:
//   const all = window.daemuRows('orders');  // 항상 backend 가 마지막에 준 응답
//
// 쓰기 미러 — 성공 시 자동 재-hydrate 까지 처리:
//   await window.daemuMirror({ method: 'POST', endpoint: '/api/orders', body, mapResponse });
//
// 호환: backend 미설정 / 5xx / network / 401/403 모두 silent (rows = []).
// 진행 중 표시는 daemuIsHydrating(storageKey) 로 외부 확인.

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // 모든 어드민 RawPage 의 in-memory store. localStorage 미사용.
  // key → row 배열. hydrate 마다 backend 응답으로 통째 교체.
  window.daemuStore = window.daemuStore || {};
  // 같은 storageKey 의 hydrate 옵션을 캐시 — 변이 후 자동 refetch 에 사용.
  const _hydrateOpts = {};

  const _state = {
    hydrating: new Set(),  // 진행 중인 storageKey 들
  };

  // 외부에서 "지금 hydrate 진행 중인가" 조회.
  window.daemuIsHydrating = function (storageKey) {
    return _state.hydrating.has(storageKey);
  };

  // 렌더 시점 행 읽기. localStorage 대신 in-memory store 사용.
  window.daemuRows = function (storageKey) {
    const arr = window.daemuStore[storageKey];
    return Array.isArray(arr) ? arr : [];
  };

  // store 직접 갱신 (변이 후 즉시 화면 반영용 — 다음 hydrate 가 backend 로 정정).
  window.daemuStoreSet = function (storageKey, rows) {
    window.daemuStore[storageKey] = Array.isArray(rows) ? rows : [];
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch (_) { /* ignore */ }
  };

  /**
   * @param {object} opts
   * @param {string} opts.storageKey
   * @param {string} opts.endpoint
   * @param {(it: any) => any} opts.mapItem
   * @returns {Promise<{ok: boolean, count: number, transient: boolean, reason?: string}>}
   */
  window.daemuHydrate = async function (opts) {
    const { storageKey, endpoint, mapItem } = opts || {};
    if (!storageKey || !endpoint || typeof mapItem !== 'function') {
      return { ok: false, count: 0, transient: false, reason: 'bad-opts' };
    }
    // 다음 refetch 를 위해 옵션 캐시.
    _hydrateOpts[storageKey] = { storageKey, endpoint, mapItem };
    _state.hydrating.add(storageKey);
    try {
      if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) {
        // backend 미설정 — store 는 빈 배열로 두고, 화면은 빈 empty state.
        window.daemuStoreSet(storageKey, []);
        return { ok: false, count: 0, transient: true, reason: 'no-backend' };
      }
      const r = await window.api.get(endpoint);
      if (!r || !r.ok || !Array.isArray(r.items)) {
        if (r && (r.status === 401 || r.status === 403)) {
          window.daemuStoreSet(storageKey, []);
          return { ok: false, count: 0, transient: false, reason: 'auth' };
        }
        // 5xx / network 실패 — 기존 store 는 그대로 두고 (사용자가 보던
        // 화면 깜빡임 회피), 다음 호출에서 다시 시도.
        return { ok: false, count: 0, transient: true, reason: 'fetch-failed' };
      }
      const mapped = r.items.map((it) => {
        try {
          const out = mapItem(it);
          if (out && typeof out === 'object') {
            out._backend = true;  // marker — PATCH/DELETE 시 backend 호출 분기.
            if (out.id == null && it.id != null) out.id = it.id;
          }
          return out;
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      window.daemuStoreSet(storageKey, mapped);
      return { ok: true, count: mapped.length, transient: false };
    } catch (e) {
      try { console.warn('[daemuHydrate]', storageKey, e); } catch (_) { /* ignore */ }
      return { ok: false, count: 0, transient: true, reason: 'exception' };
    } finally {
      _state.hydrating.delete(storageKey);
    }
  };

  // 같은 storageKey 의 hydrate 옵션을 캐시에서 꺼내 다시 실행.
  // mutation (POST/PATCH/DELETE) 후 호출해 backend 가 source-of-truth 임을 보장.
  window.daemuRefetch = async function (storageKey) {
    const opts = _hydrateOpts[storageKey];
    if (!opts) return { ok: false, reason: 'no-cached-opts' };
    return window.daemuHydrate(opts);
  };

  /**
   * 쓰기 연산 backend 미러.
   *   { method, endpoint, body, mapResponse, refetchKey }
   * `refetchKey` 가 주어지면 backend 성공 후 자동으로 daemuHydrate 재실행 →
   * window.daemuStore[refetchKey] 가 backend 응답으로 갱신됨.
   * @returns {Promise<{ok, status, item?, error?}>}
   */
  window.daemuMirror = async function (opts) {
    const { method, endpoint, body, mapResponse, refetchKey } = opts || {};
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
      // backend 가 source of truth — mutation 성공 시 자동 refetch 로 store 갱신.
      if (refetchKey) {
        try { await window.daemuRefetch(refetchKey); } catch (_) { /* ignore */ }
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
