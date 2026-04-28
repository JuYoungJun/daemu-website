import { useEffect } from 'react';
import { setSeo } from '../lib/seo.js';

// React-friendly wrapper around setSeo(). Re-applies on every cfg change
// and cleans up page-scoped JSON-LD on unmount.
export function useSeo(cfg) {
  // Stable serialization key so we don't infinite-loop on a new object literal.
  const key = JSON.stringify(cfg || {});
  useEffect(() => {
    return setSeo(cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
