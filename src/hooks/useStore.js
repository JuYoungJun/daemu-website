import { useEffect, useState, useCallback } from 'react';
import { DB } from '../lib/db.js';

// Reactive wrapper around DB.get(key) — re-renders when set/add/del/update is called.
export function useStore(key) {
  const [data, setData] = useState(() => DB.get(key));

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'daemu_' + key || e.key === null) setData(DB.get(key));
    };
    window.addEventListener('storage', onStorage);
    const onLocal = () => setData(DB.get(key));
    window.addEventListener('daemu-db-change', onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('daemu-db-change', onLocal);
    };
  }, [key]);

  const refresh = useCallback(() => setData(DB.get(key)), [key]);
  const add = useCallback((item) => { DB.add(key, item); window.dispatchEvent(new Event('daemu-db-change')); refresh(); }, [key, refresh]);
  const update = useCallback((id, updates) => { DB.update(key, id, updates); window.dispatchEvent(new Event('daemu-db-change')); refresh(); }, [key, refresh]);
  const del = useCallback((id) => { DB.del(key, id); window.dispatchEvent(new Event('daemu-db-change')); refresh(); }, [key, refresh]);

  return { data, refresh, add, update, del };
}
