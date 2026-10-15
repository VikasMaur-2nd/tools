/**
 * Interface strings at runtime, localized half: only localized pages load this
 * (through components/LocalizedTool), so English pages never pay for it.
 */
import { EN, fill, type Forms, type Params, type T, type UiDict } from './ui';

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

export function translator(d: UiDict | null | undefined, lang?: string): T {
  if (!d) return EN;
  // Locale data is expensive on a cold phone. Labels need no number formatters.
  let nf: Intl.NumberFormat | undefined;
  let rules: Intl.PluralRules | undefined;
  const fixed: Intl.NumberFormat[] = [];
  const num = (n: number) => (nf ??= new Intl.NumberFormat(lang)).format(n);
  const decimal = (n: number, digits: number) => (fixed[digits] ??= new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })).format(n);
  const pick = (v: string | Forms, n: number) => (typeof v === 'string' ? v : (v[(rules ??= new Intl.PluralRules(lang)).select(n)] ?? v.other ?? ''));
  const tr = (s: string) => {
    const v = d[s];
    return v === undefined ? s : pick(v, 1);
  };

  let pats: Pattern[] | null = null;
  const patterns = () =>
    (pats ??= Object.keys(d)
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
    const v = d[s];
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
      return fill(pick(d[key], count), p);
    }
    return undefined;
  };

  const DF = (Intl as unknown as { DurationFormat?: DurationFormat }).DurationFormat;
  const dfs: Partial<Record<'long' | 'narrow', InstanceType<DurationFormat>>> = {};

  return Object.assign((s: string, p?: Params) => fill(tr(s), p), {
    n: (c: number, one: string, other: string, p?: Params) => {
      const v = d[one] ?? d[other];
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
  });
}
