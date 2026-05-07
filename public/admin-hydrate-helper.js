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
  // opts.origin = 'mutation' (기본) — 외부 변이. helper 의 자동 refetch listener
  //               가 이 이벤트를 받아 모든 cached storageKey refetch.
  // opts.origin = 'hydrate'  — refetch 결과 store 갱신. helper listener 가 무시
  //               해 cascade 무한 루프를 차단. UI(page script) 는 origin 무관하게
  //               render() 호출.
  window.daemuStoreSet = function (storageKey, rows, opts) {
    window.daemuStore[storageKey] = Array.isArray(rows) ? rows : [];
    try {
      const detail = { storageKey, origin: (opts && opts.origin) || 'mutation' };
      window.dispatchEvent(new CustomEvent('daemu-db-change', { detail }));
    } catch (_) { /* ignore */ }
  };

  // helper 자체의 자동 refetch — 외부 mutation 발생 시 모든 cached storageKey
  // 를 backend 로부터 다시 읽어오게 한다. cascade 는 origin='hydrate' 검사로 차단.
  // 한 번만 등록되도록 module-level guard.
  let _autoRefreshAttached = false;
  function _refreshAllCached() {
    for (const key of Object.keys(_hydrateOpts)) {
      try { window.daemuRefetch(key); } catch (_) { /* ignore */ }
    }
  }
  function _ensureAutoRefresh() {
    if (_autoRefreshAttached) return;
    _autoRefreshAttached = true;
    window.addEventListener('daemu-db-change', (e) => {
      const origin = e && e.detail && e.detail.origin;
      if (origin === 'hydrate') return;  // self — 무한 cascade 방지
      _refreshAllCached();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) _refreshAllCached();
      });
      // visible 일 때만 60s 폴링 — cross-device sync 보강.
      setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          _refreshAllCached();
        }
      }, 60_000);
    }
  }

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
    _ensureAutoRefresh();
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

      window.daemuStoreSet(storageKey, mapped, { origin: 'hydrate' });
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
   *   { method, endpoint, body, mapResponse, refetchKey, id }
   *
   * 동작 순서:
   *   1) backend 호출 (mutation).
   *   2) backend 200 직후 *즉시* store 에 optimistic local patch:
   *      · POST  → 응답 item 이 있으면 list 맨 앞에 prepend (id 중복 시 교체).
   *      · PATCH/PUT → 응답 item 의 id 와 일치하는 row 를 응답 item 으로 교체.
   *      · DELETE → opts.id 또는 endpoint 끝 숫자 id 의 row 제거.
   *      patch 직후 daemu-db-change(origin='mutation') 발화 → page script 의
   *      render() 가 즉시 실행되어 사용자가 *서버 응답 직후* 화면 변화를 본다.
   *      이전엔 daemuRefetch 한 번 더 round-trip 해야 화면이 갱신되어 sluggish.
   *   3) 그 *후* background daemuRefetch (정정 / 검증). 사용자 체감 0ms 추가.
   *      cascade 무한 루프는 origin='hydrate' 마커로 차단 — helper listener 가
   *      hydrate 자가 발화는 무시.
   *
   * 실패 시 patch 미수행 — fake success 방지.
   * @returns {Promise<{ok, status, item?, error?}>}
   */
  window.daemuMirror = async function (opts) {
    const { method, endpoint, body, mapResponse, refetchKey, id } = opts || {};
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
      // 즉시 optimistic local patch — backend success 직후 화면이 곧바로 변화.
      if (refetchKey) {
        try {
          const cur = Array.isArray(window.daemuStore[refetchKey]) ? window.daemuStore[refetchKey] : [];
          let next = cur;
          if (m === 'DELETE') {
            // id: opts.id 우선, 없으면 endpoint 끝 숫자 추출.
            let delId = id;
            if (delId == null) {
              const match = String(endpoint || '').match(/\/(\d+)(?:[\/?]|$)/);
              if (match) delId = Number(match[1]);
            }
            if (delId != null) {
              next = cur.filter((x) => String(x && x.id) !== String(delId));
            }
          } else if (item && item.id != null) {
            const existsAt = cur.findIndex((x) => String(x && x.id) === String(item.id));
            const merged = { ...(existsAt >= 0 ? cur[existsAt] : {}), ...item, _backend: true };
            if (m === 'POST') {
              if (existsAt >= 0) {
                next = cur.slice();
                next[existsAt] = merged;
              } else {
                next = [merged, ...cur];
              }
            } else {
              // PATCH / PUT — 기존 row 교체 (없으면 prepend 로 안전 보강).
              if (existsAt >= 0) {
                next = cur.slice();
                next[existsAt] = merged;
              } else {
                next = [merged, ...cur];
              }
            }
          }
          if (next !== cur) {
            window.daemuStoreSet(refetchKey, next, { origin: 'mutation' });
          }
        } catch (_) { /* ignore — refetch 가 backstop */ }
      }
      // backend 가 단일 진실원 — 정정/검증을 위한 background refetch.
      // await 안 함 → 사용자 체감 0ms. cascade 차단은 origin 마커로 보장.
      if (refetchKey) {
        try { window.daemuRefetch(refetchKey); } catch (_) { /* ignore */ }
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
