'use client';

import { useEffect, useState } from 'react';
import type { LazyFeature } from './client-dict';
import { useT } from './react';

/**
 * Whether a lazily loaded feature's strings are in (lib/i18n/translate.ts `lazy`), for its component to render
 * translated from the start. English pages have none to wait for; a failed fetch (offline, never cached) renders
 * in English.
 */
export function useLazyStrings(feature: LazyFeature): boolean {
  const t = useT();
  const [settled, setSettled] = useState(false);
  const ready = !t.lazy || !!t.has?.(feature) || settled;
  useEffect(() => {
    if (ready || !t.lazy) return;
    let on = true;
    void t.lazy(feature).then(() => {
      if (on) setSettled(true);
    });
    return () => {
      on = false;
    };
  }, [t, feature, ready]);
  return ready;
}
