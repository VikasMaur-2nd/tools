'use client';

import { useMemo, type ComponentProps } from 'react';
import JsonTool from './JsonTool';
import { UiContext } from '@/lib/i18n/react';
import { translator } from '@/lib/i18n/translate';
import type { StringFiles } from '@/lib/i18n/client-dict';
import type { UiDict } from '@/lib/i18n/ui';

/**
 * The app on a localized page: its dictionary arrives with the page (no extra
 * request) and the translator code lives in this entry's chunk, which English
 * pages never load. `files`: the URLs of its language's dictionaries that load
 * later (huge mode's, the lazy features').
 */
export default function LocalizedTool({ ui, lang, files, ...props }: ComponentProps<typeof JsonTool> & { ui: UiDict | undefined; lang: string; files: StringFiles | undefined }) {
  const t = useMemo(() => translator(ui ?? {}, lang, files), [ui, lang, files]);
  return (
    <UiContext value={t}>
      <JsonTool {...props} />
    </UiContext>
  );
}
