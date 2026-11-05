/**
 * The browser's dictionaries, built from lib/i18n/<locale>/ui.json: a localized page's (lib/i18n/server.ts
 * `clientUi`, in its RSC payload) and huge mode's (lib/i18n/huge/huge-strings.<locale>.json, written by
 * scripts/i18n-huge.mjs and loaded when a huge file opens: lib/i18n/translate.ts `huge`). Plain data, no
 * imports at run time: the server, the scripts and the tests share it.
 */
import type { Forms, UiDict } from './ui';

type Strings = Record<string, string>;

/** Interface string namespaces the browser needs (the rest renders on the server). */
export const CLIENT = /^(app|dlg|cmd|cmp|toast|eng|target|parse|import|unit)\./;
const PLURAL = /\.(zero|one|two|few|many|other)$/;
const isNote = (k: string) => k.startsWith('_') || k.endsWith('._context');

/** Huge-only strings without the huge prefix: the palette's Shape command, the several-values notice. */
const HUGE_ONLY = new Set(['cmd.shape', 'cmd.shape.terms', 'app.notStrictJson']);

/**
 * Strings only huge mode shows (lib/huge, components/huge, the palette while a huge file is open): they stay
 * out of every page's dictionary and come with huge mode. A string the rest of the app shows too must not
 * match (tests/i18n.test.ts checks).
 */
export const isHugeKey = (key: string) => /^(app|toast|cmd)\.huge/.test(key) || HUGE_ONLY.has(key);

/**
 * English text → translation for the keys `keep` takes. A plural string maps both English forms to the same
 * forms; untranslated strings are left out (the app shows them in English).
 */
export function clientDict(en: Strings, translated: Strings, keep: (key: string) => boolean): UiDict {
  const out: UiDict = {};
  for (const key of Object.keys(en)) {
    if (isNote(key) || !keep(key)) continue;
    const m = PLURAL.exec(key);
    if (m) {
      if (m[1] !== 'other') continue;
      const base = key.slice(0, -'.other'.length);
      const forms: Forms = {};
      for (const k of Object.keys(translated)) if (k.startsWith(base + '.') && PLURAL.test(k.slice(base.length))) forms[k.slice(base.length + 1) as Intl.LDMLPluralRule] = translated[k];
      if (!forms.other) continue;
      out[en[base + '.one'] ?? en[key]] = forms;
      out[en[key]] = forms;
    } else if (translated[key] && translated[key] !== en[key]) out[en[key]] = translated[key];
  }
  return out;
}

/** A localized page's dictionary: what the browser shows, but huge mode's strings. */
export const pageDict = (en: Strings, translated: Strings) => clientDict(en, translated, (k) => CLIENT.test(k) && !isHugeKey(k));

/** Huge mode's dictionary (lib/i18n/huge/huge-strings.<locale>.json). */
export const hugeDict = (en: Strings, translated: Strings) => clientDict(en, translated, (k) => CLIENT.test(k) && isHugeKey(k));
