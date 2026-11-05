/**
 * Interface strings at runtime, English half.
 *
 * Source code keeps its English text inline: that text is the lookup key, so
 * English pages ship no dictionary at all and `EN` only fills {placeholders}.
 * Localized pages get a dictionary (English text → translation, built on the
 * server from lib/i18n/<locale>/ui.json) and a full translator from
 * ./translate (a chunk only those pages load), provided to React through
 * context (./react) and to engine DOM code through `rt`.
 */
import { formatBytes } from '../json/format';
import { compact, duration } from './duration';

export type Forms = Partial<Record<Intl.LDMLPluralRule, string>>;
/** English text → translation; a plural string maps both English forms to the same forms object. */
export type UiDict = Record<string, string | Forms>;
export type Params = Record<string, string | number>;

export interface T {
  /** Translates an English UI string and fills its {placeholders}. */
  (s: string, p?: Params): string;
  /** Plural string: `one` / `other` are the English forms, {n} is the formatted count. */
  n(count: number, one: string, other: string, p?: Params): string;
  /** A message composed in English elsewhere (parser, importers, toasts): matched against the templates, part by part. */
  msg(s: string): string;
  num(n: number): string;
  bytes(n: number): string;
  /** Duration: compact (3h) or in words (1 hour 59 minutes). */
  dur(sec: number, long?: boolean): string;
  /** The page's language (`<html lang>`); undefined on English pages, which keep the browser's own formats. */
  lang?: string;
  /**
   * Localized pages: adds huge mode's strings, which their dictionary leaves out (a chunk per language, loaded
   * on first use; never rejects: a failed load leaves them English). English pages have none to add.
   */
  huge?(): Promise<void>;
}

export const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (p[k] === undefined ? m : String(p[k]))) : s);

/** Thousands separators only where they show: the first toLocaleString() pays for the locale data (~80 ms on a slow phone). */
const int = (n: number) => (n < 1000 ? String(n) : n.toLocaleString());

export const EN: T = Object.assign(fill, {
  n: (c: number, one: string, other: string, p?: Params) => fill(c === 1 ? one : other, { ...p, n: int(c) }),
  msg: (s: string) => s,
  num: int,
  bytes: formatBytes,
  dur: (sec: number, long?: boolean) => (long ? duration(sec) : compact(sec)),
});

/** The translator for code outside React (engine DOM, value hints). <JsonTool> sets it in the browser, before the engine starts; the server never does. */
export let rt: T = EN;
export const setRuntime = (t: T) => {
  rt = t;
};
