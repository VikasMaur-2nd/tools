/**
 * Interface strings at runtime, localized half: only localized pages load this
 * (through components/LocalizedTool), so English pages never pay for it.
 */
import { EN, fill, type Forms, type Params, type T, type UiDict } from './ui';
import type { LazyFeature } from './client-dict';

/** Placeholders whose value is itself an English message (an importer error inside a toast, a token description inside a parser error). */
const NESTED = new Set(['msg', 'error', 'token', 'target']);
/** Joins the parts of composed messages ("Formatted · fixed 2 issues · Ctrl+Z to undo"); no placeholder spans it. */
const SEP = ' · ';
const ESC = /[.*+?^${}()|[\]\\]/g;

type Pattern = { re: RegExp; key: string; names: string[]; lit: number };
type DurationFormat = new (lang?: string, o?: { style: string }) => { format(d: Record<string, number>): string };

/** The English duration helpers' units, as Intl.DurationFormat fields. */
function durationParts(sec: number, long: boolean): Record<string, number> {
  const s = Math.max(0, Math.floor(sec));
  const units: [string, number][] = [['years', 31536000], ['days', 86400], ['hours', 3600], ['minutes', 60], ['seconds', 1]];
  for (let k = 0; k < units.length; k++) {
    const [name, size] = units[k];
    const n = Math.floor(s / size);
    if (!n && size > 1) continue;
    if (!long) return { [name]: n };
    const next = units[k + 1];
    const m = next && n < 10 ? Math.floor((s - n * size) / next[1]) : 0;
    return m ? { [name]: n, [next[0]]: m } : { [name]: n };
  }
  return { seconds: 0 };
}

/**
 * Huge mode's strings per language (lib/i18n/huge/huge-strings.<locale>.json, from scripts/i18n-huge.mjs): files
 * the bundler copies to /_next/static/media/huge-strings.<locale>.<hash>.json, named only in the localized pages'
 * chunk and fetched when a huge file opens. The service worker caches a page's own language's file with its other
 * files (and no other language's: public/sw.js), so huge mode works offline in it; English pages never name them.
 */
const HUGE: Record<string, URL> = {
  es: new URL('./huge/huge-strings.es.json', import.meta.url),
  pt: new URL('./huge/huge-strings.pt.json', import.meta.url),
  de: new URL('./huge/huge-strings.de.json', import.meta.url),
  fr: new URL('./huge/huge-strings.fr.json', import.meta.url),
  ja: new URL('./huge/huge-strings.ja.json', import.meta.url),
  ko: new URL('./huge/huge-strings.ko.json', import.meta.url),
  zh: new URL('./huge/huge-strings.zh.json', import.meta.url),
  ru: new URL('./huge/huge-strings.ru.json', import.meta.url),
};

/**
 * The lazily loaded features' strings per language (lib/i18n/lazy/<feature>-strings.<locale>.json, from
 * scripts/i18n-huge.mjs), fetched when the feature opens, as huge mode's are (the service worker caches the page's
 * own language's files only).
 */
const LAZY: Record<LazyFeature, Record<string, URL>> = {
  schema: {
    es: new URL('./lazy/schema-strings.es.json', import.meta.url),
    pt: new URL('./lazy/schema-strings.pt.json', import.meta.url),
    de: new URL('./lazy/schema-strings.de.json', import.meta.url),
    fr: new URL('./lazy/schema-strings.fr.json', import.meta.url),
    ja: new URL('./lazy/schema-strings.ja.json', import.meta.url),
    ko: new URL('./lazy/schema-strings.ko.json', import.meta.url),
    zh: new URL('./lazy/schema-strings.zh.json', import.meta.url),
    ru: new URL('./lazy/schema-strings.ru.json', import.meta.url),
  },
  flatten: {
    es: new URL('./lazy/flatten-strings.es.json', import.meta.url),
    pt: new URL('./lazy/flatten-strings.pt.json', import.meta.url),
    de: new URL('./lazy/flatten-strings.de.json', import.meta.url),
    fr: new URL('./lazy/flatten-strings.fr.json', import.meta.url),
    ja: new URL('./lazy/flatten-strings.ja.json', import.meta.url),
    ko: new URL('./lazy/flatten-strings.ko.json', import.meta.url),
    zh: new URL('./lazy/flatten-strings.zh.json', import.meta.url),
    ru: new URL('./lazy/flatten-strings.ru.json', import.meta.url),
  },
};

/** A dictionary file ({} for none). */
async function strings(url: URL | undefined): Promise<UiDict> {
  if (!url) return {};
  const res = await fetch(url);
  if (!res.ok) throw new Error('strings');
  return (await res.json()) as UiDict;
}

export function translator(d: UiDict | null | undefined, lang?: string): T {
  if (!d) return EN;
  // (Huge mode's and the lazy features' strings join it when they open: `huge` and `lazy` below.)
  let dict: UiDict = d;
  const loads = new Map<string, Promise<void>>();
  const loaded = new Set<string>();
  const two = lang?.slice(0, 2) ?? '';
  /** Fetches one more dictionary into this one, once (a failed fetch is tried again next time; never rejects). */
  const more = (name: string, url: URL | undefined) => {
    let p = loads.get(name);
    if (!p) {
      p = strings(url).then(
        (add) => {
          dict = { ...dict, ...add };
          pats = null;
          loaded.add(name);
        },
        () => {
          loads.delete(name); // (offline, never cached: English this time, asked again next time)
        },
      );
      loads.set(name, p);
    }
    return p;
  };
  // Locale data is expensive on a cold phone. Labels need no number formatters.
  let nf: Intl.NumberFormat | undefined;
  let rules: Intl.PluralRules | undefined;
  const fixed: Intl.NumberFormat[] = [];
  const num = (n: number) => (nf ??= new Intl.NumberFormat(lang)).format(n);
  const decimal = (n: number, digits: number) => (fixed[digits] ??= new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })).format(n);
  const pick = (v: string | Forms, n: number) => (typeof v === 'string' ? v : (v[(rules ??= new Intl.PluralRules(lang)).select(n)] ?? v.other ?? ''));
  const tr = (s: string) => {
    const v = dict[s];
    return v === undefined ? s : pick(v, 1);
  };

  let pats: Pattern[] | null = null;
  const patterns = () =>
    (pats ??= Object.keys(dict)
      .filter((k) => k.includes('{'))
      .map((key) => {
        const names: string[] = [];
        let src = '^';
        let lit = 0;
        key.split(/\{(\w+)\}/).forEach((part, i) => {
          if (i % 2) {
            names.push(part);
            src += '((?:(?! · ).)+?)';
          } else {
            src += part.replace(ESC, '\\$&');
            lit += part.length;
          }
        });
        return { re: new RegExp(src + '$', 's'), key, names, lit };
      })
      // Most specific first: "Couldn't read {name}: {error}" before "Couldn't read {name}".
      .sort((a, b) => b.lit - a.lit));

  const one = (s: string): string | undefined => {
    const v = dict[s];
    if (v !== undefined) return pick(v, 1);
    for (const { re, key, names } of patterns()) {
      const m = re.exec(s);
      if (!m) continue;
      const p: Params = {};
      let count = 1;
      names.forEach((k, i) => {
        const x = m[i + 1];
        if (k === 'n') p.n = num((count = Number(x.replace(/\D/g, '')) || 0));
        else p[k] = NESTED.has(k) ? (one(x) ?? x) : x;
      });
      return fill(pick(dict[key], count), p);
    }
    return undefined;
  };

  const DF = (Intl as unknown as { DurationFormat?: DurationFormat }).DurationFormat;
  const dfs: Partial<Record<'long' | 'narrow', InstanceType<DurationFormat>>> = {};

  return Object.assign((s: string, p?: Params) => fill(tr(s), p), {
    n: (c: number, one: string, other: string, p?: Params) => {
      const v = dict[one] ?? dict[other];
      return fill(v === undefined ? (c === 1 ? one : other) : pick(v, c), { ...p, n: num(c) });
    },
    msg: (s: string) => one(s) ?? (s.includes(SEP) ? s.split(SEP).map((x) => one(x) ?? x).join(tr(SEP)) : s),
    num,
    bytes: (b: number) =>
      b < 1024
        ? fill(tr('{size} B'), { size: num(b) })
        : b < 1048576
          ? fill(tr('{size} KB'), { size: decimal(b / 1024, b < 10240 ? 1 : 0) })
          : fill(tr('{size} MB'), { size: decimal(b / 1048576, 1) }),
    dur: (sec: number, long?: boolean) => {
      const style = long ? 'long' : 'narrow';
      const parts = durationParts(sec, !!long);
      if (DF) return (dfs[style] ??= new DF(lang, { style })).format(parts);
      // Browsers without Intl.DurationFormat: each unit on its own, still in the page's language.
      return Object.entries(parts)
        .map(([unit, n]) => new Intl.NumberFormat(lang, { style: 'unit', unit: unit.slice(0, -1), unitDisplay: style }).format(n))
        .join(' ');
    },
    lang,
    huge: () => more('huge', HUGE[two]),
    lazy: (f: LazyFeature) => more(f, LAZY[f][two]),
    has: (f: LazyFeature) => loaded.has(f),
  });
}
