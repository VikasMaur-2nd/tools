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

/** Features whose strings load with them (lib/i18n/lazy/<feature>-strings.<locale>.json, lib/i18n/translate.ts `lazy`). */
export type LazyFeature = 'schema' | 'flatten';
export const LAZY_FEATURES: readonly LazyFeature[] = ['schema', 'flatten'];
/** The Schema view's strings the first load shows: its tab, and Close schema (also a palette command). */
const SCHEMA_FIRST = new Set(['app.schema', 'app.schema.close']);

/**
 * The lazily loaded feature a string belongs to (null: none). The Schema view's (components/SchemaView.tsx) and
 * Flatten's options and notes (components/FlatItems.tsx) come with them; their tab, command and target labels
 * stay in the page's dictionary. A string the rest of the app shows must not match (tests/i18n.test.ts checks).
 */
export function lazyFeature(key: string): LazyFeature | null {
  if (/^(app\.schema\.|toast\.schema)/.test(key) && !SCHEMA_FIRST.has(key)) return 'schema';
  if (/^(app\.flat|app\.(un)?flattenInstead$|eng\.(un)?flat|toast\.(un)?flattenedInput$)/.test(key)) return 'flatten';
  return null;
}

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

/** A localized page's dictionary: what the browser shows, but huge mode's strings and the lazy features'. */
export const pageDict = (en: Strings, translated: Strings) => clientDict(en, translated, (k) => CLIENT.test(k) && !isHugeKey(k) && !lazyFeature(k));

/** A lazily loaded feature's dictionary (lib/i18n/lazy/<feature>-strings.<locale>.json). */
export const lazyDict = (en: Strings, translated: Strings, feature: LazyFeature) => clientDict(en, translated, (k) => CLIENT.test(k) && lazyFeature(k) === feature);

/** Huge mode's dictionary (lib/i18n/huge/huge-strings.<locale>.json). */
export const hugeDict = (en: Strings, translated: Strings) => clientDict(en, translated, (k) => CLIENT.test(k) && isHugeKey(k));
