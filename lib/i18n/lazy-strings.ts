'use client';

import { useEffect } from 'react';
import type { LazyFeature } from './client-dict';
import { useT } from './react';

/**
 * Asks for a lazily loaded feature's strings (lib/i18n/translate.ts `lazy`) while `on` (its view open, its menu
 * shown). The feature renders at once, in English where they aren't in yet; when they come, the translator is a new
 * value (components/LocalizedTool.tsx) and it renders again translated. A fetch that failed (offline, never cached)
 * is tried again on the next opening. English pages have none to ask for.
 */
export function useLazyStrings(feature: LazyFeature, on = true): void {
  const t = useT();
  useEffect(() => {
    if (on && t.lazy && !t.has?.(feature)) void t.lazy(feature);
  }, [t, feature, on]);
}
