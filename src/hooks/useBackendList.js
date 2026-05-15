import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

// admin React 페이지의 list endpoint 동기화 — mount 시 1회 fetch + 주기적
// polling + window focus / visibilitychange / daemu-db-change 이벤트 발생 시
// 즉시 refetch.
//
// 사용 예:
//   const { items, loading, error, refetch } = useBackendList(
//     '/api/users',
//     { intervalMs: 15000, mapItem: (it) => it }
//   );
//
// raw admin 페이지(`public/admin-*-page.js`) 는 별도의 `admin-hydrate-helper.js`
// 가 동일 역할을 수행. 본 훅은 React 트리 안의 admin 페이지 전용.
//
// 옵션:
//   · intervalMs   — 폴링 간격. 기본 15초. document.hidden 일 때는 skip
//                    해 Render free-tier 사용량 절약.
//   · mapItem      — 응답 item 가공 (없으면 그대로 사용).
//   · enabled      — 조건부 활성 (예: api.isConfigured() 일 때만).
//
// 반환:
//   · items   — 현재 list (success 마지막 응답 또는 mount initial []).
//   · loading — 진행 중 표시. 첫 mount 시 true.
//   · error   — string 또는 null.
//   · refetch — 명시적 refetch (mutation 직후 호출). Promise<void>.
export function useBackendList(endpoint, opts = {}) {
  const { intervalMs = 15000, mapItem, enabled = true } = opts;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const mapRef = useRef(mapItem);
  mapRef.current = mapItem;

  const fetchOnce = useCallback(async () => {
    if (!enabled) return;
    if (!api.isConfigured()) {
      if (aliveRef.current) {
        setLoading(false);
        setItems([]);
        setError('백엔드 미연결 — 운영자에게 문의해 주세요.');
      }
      return;
    }
    const r = await api.get(endpoint);
    if (!aliveRef.current) return;
    setLoading(false);
    if (!r || !r.ok) {
      setError(r?.error || `요청 실패 (HTTP ${r?.status || '?'})`);
      return;
    }
    const raw = Array.isArray(r.items) ? r.items : [];
    const mapped = mapRef.current ? raw.map((it) => {
      try { return mapRef.current(it); } catch { return null; }
    }).filter(Boolean) : raw;
    setItems(mapped);
    setError(null);
  }, [endpoint, enabled]);

  useEffect(() => {
    aliveRef.current = true;
    fetchOnce();
    const onVisible = () => { if (!document.hidden) fetchOnce(); };
    const onChange = () => fetchOnce();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('daemu-db-change', onChange);
    const id = setInterval(() => {
      if (!document.hidden) fetchOnce();
    }, intervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('daemu-db-change', onChange);
    };
  }, [fetchOnce, intervalMs]);

  return { items, loading, error, refetch: fetchOnce, setItems };
}
