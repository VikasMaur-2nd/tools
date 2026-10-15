'use client';

import { useMemo, type ComponentProps } from 'react';
import JsonTool from './JsonTool';
import { UiContext } from '@/lib/i18n/react';
import { translator } from '@/lib/i18n/translate';
import type { UiDict } from '@/lib/i18n/ui';

/**
 * The app on a localized page: its dictionary arrives with the page (no extra
 * request) and the translator code lives in this entry's chunk, which English
 * pages never load.
 */
export default function LocalizedTool({ ui, lang, ...props }: ComponentProps<typeof JsonTool> & { ui: UiDict | undefined; lang: string }) {
  const t = useMemo(() => translator(ui ?? {}, lang), [ui, lang]);
  return (
    <UiContext value={t}>
      <JsonTool {...props} />
    </UiContext>
  );
}
