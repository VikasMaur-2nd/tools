'use client';

import { useRef, useState } from 'react';
import { PRIVATE, track } from '@/lib/analytics';
import { act } from '@/lib/engine/instance';
import { store, useUI, type FlatSettings } from '@/lib/engine/store';
import { useT } from '@/lib/i18n/react';
import { Icon } from './icons';
import { MCheck, MChoice, MItem, MSep } from './menu';

/*
 * Flatten and unflatten (Convert targets): their options in the ⋯ menu and their note above the output. A
 * chunk of its own (JsonTool loads it when one of them is the target), so the first load stays as it was.
 */

/** lib/convert/flat.ts FLAT_DEFAULTS, for settings saved before flatten existed. */
const DEFAULTS: FlatSettings = { sep: '.', arrays: 'bracket', escape: true, depth: 0 };
const SEPARATORS = ['.', '/', '_', '__'];

/** With `close`: the options, in the ⋯ menu. Without: the note on the output. */
export default function Flat({ flatten, close }: { flatten?: boolean; close?: () => void }) {
  return close ? <FlatItems flatten={!!flatten} close={close} /> : <FlatNote />;
}

/** The options, the same for both directions (so flat JSON unflattens with what made it). */
function FlatItems({ flatten, close }: { flatten: boolean; close: () => void }) {
  const f = useUI((s) => s.settings.flat) ?? DEFAULTS;
  const t = useT();
  // A separator being typed: shown at once, converted after a pause, never sent (only the menu's own are).
  const [typed, setTyped] = useState<string | null>(null);
  const timer = useRef(0);
  const set = (p: Partial<FlatSettings>, quiet = false) => {
    if (!quiet) {
      // (A pick wins over a separator still being typed.)
      if (p.sep !== undefined) {
        window.clearTimeout(timer.current);
        setTyped(null);
      }
      for (const [option, value] of Object.entries(p)) track('convert_option_changed', { option: `flat_${option as keyof FlatSettings}`, value: String(value) });
    }
    // (The settings as they are now: a typed separator lands 200 ms later, maybe after another option changed.)
    act((e) => e.setConvert({ flat: { ...(store.get().settings.flat ?? DEFAULTS), ...p } }));
  };
  const type = (sep: string) => {
    setTyped(sep);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setTyped(null);
      set({ sep }, true);
    }, 200);
  };
  return (
    <>
      <MChoice label="Separator" value={f.sep} options={SEPARATORS.map((v) => ({ v, label: v }))} onPick={(sep) => set({ sep })} />
      <label className="mi mi-row">
        <span>{t('Custom separator')}</span>
        <input className={`mi-input ${PRIVATE}`} value={typed ?? f.sep} maxLength={8} spellCheck={false} onChange={(e) => type(e.target.value.replace(/[\\[\]\d]/g, ''))} />
      </label>
      <MChoice
        label="Array indexes"
        value={f.arrays}
        options={[
          { v: 'bracket', label: 'a[0]' },
          { v: 'dot', label: `a${f.sep || '.'}0` },
          { v: 'keep', label: 'None' },
        ]}
        onPick={(arrays) => set({ arrays })}
      />
      <MCheck label="Escape keys" checked={f.escape} onClick={() => set({ escape: !f.escape })} />
      {flatten && <MChoice label="Depth" value={f.depth} options={[{ v: 0, label: 'All' }, ...[1, 2, 3].map((v) => ({ v, label: String(v) }))]} onPick={(depth) => set({ depth })} />}
      <MItem label="Use as input" keys="mod+Enter" onClick={() => act((e) => e.useConvert())} close={close} />
      <MSep />
    </>
  );
}

/** What to know about the output: a warning when it won't convert back as it is, and a switch when the other direction fits. */
function FlatNote() {
  const note = useUI((s) => s.convert.flat);
  const flatten = useUI((s) => s.settings.target === 'flatten');
  const t = useT();
  if (!note?.note) return null;
  return (
    <div className={`banner ${note.warn ? 'warn' : 'info'}`} role="status" aria-live="polite">
      <Icon name={note.warn ? 'alert' : 'braces'} size={15} />
      {/* (A quoted key is one long word: it breaks rather than overflows a phone.) */}
      <span className="b-msg" style={{ overflowWrap: 'anywhere' }}>
        {t.msg(note.note)}
      </span>
      {note.flip && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.setConvert({ target: flatten ? 'unflatten' : 'flatten' }))}>
          {flatten ? t('Unflatten instead') : t('Flatten instead')}
        </button>
      )}
    </div>
  );
}
