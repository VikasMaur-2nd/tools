/* Document rules kept free of the browser-only engine, so tests can import them. */
import type { JNode, ParseResult } from '../json/parser';
import type { ChangeKind } from './editor';
import type { SourceFormat } from './store';

/** What an input can be read as (lib/engine/source.ts reads the others than JSON). */
export const SOURCE_FORMATS: readonly SourceFormat[] = ['json', 'yaml', 'csv', 'xml', 'toml'];

/** A stored or linked format name, or JSON. */
export const formatOf = (v: unknown): SourceFormat => SOURCE_FORMATS.find((f) => f === v) ?? 'json';

/** What a file is read as, by its name: YAML, CSV (and TSV), XML and TOML files by their extension; anything else is JSON. */
export function formatOfName(name: string | null | undefined): SourceFormat {
  const n = name ?? '';
  if (/\.ya?ml$/i.test(n)) return 'yaml';
  if (/\.(csv|tsv)$/i.test(n)) return 'csv';
  if (/\.xml$/i.test(n)) return 'xml';
  if (/\.toml$/i.test(n)) return 'toml';
  return 'json';
}

/** Above this, text pasted over everything isn't checked to be JSON (JSON.parse: ~30 ms at 5 MB). */
const PLAIN_JSON_MAX = 5_000_000;

/**
 * Whether text pasted over everything is plainly JSON: an object or array that JSON.parse reads. The input is then
 * read as JSON again, whatever it was read as (a YAML flow mapping like `{a: 1}` isn't JSON, so it stays YAML).
 */
export function plainJson(text: string): boolean {
  if (text.length > PLAIN_JSON_MAX) return false;
  let i = 0;
  while (i < text.length && text.charCodeAt(i) <= 32) i++;
  const c = text.charCodeAt(i);
  if (c !== 123 && c !== 91) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Up to this length, text that may be JSON is checked with JSON.parse (holdsJson); longer, by its first and last characters. */
export const HOLDS_JSON_PARSE_MAX = 1_000_000;

/**
 * Whether text `s` (a JSON string's value: what Unescape would show) is a JSON object or array, whitespace around it
 * allowed: its first and last characters other than whitespace are `{…}` or `[…]`, and JSON.parse reads it (prose
 * such as `[citation needed]` isn't). `last`: the text's last such character, when `s` is only its start (a long
 * string isn't decoded whole for this). Then, as for an `s` longer than HOLDS_JSON_PARSE_MAX, the pair alone decides
 * (Unescape checks the rest).
 */
export function holdsJson(s: string, last = -1): boolean {
  let a = 0;
  while (a < s.length && isJsonSpace(s.charCodeAt(a))) a++;
  const o = s.charCodeAt(a);
  if (o !== 123 && o !== 91) return false;
  const whole = last < 0;
  if (whole) {
    let b = s.length - 1;
    while (b > a && isJsonSpace(s.charCodeAt(b))) b--;
    last = s.charCodeAt(b);
  }
  if (last !== (o === 123 ? 125 : 93)) return false;
  if (!whole || s.length > HOLDS_JSON_PARSE_MAX) return true;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

const isJsonSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/**
 * The text of a document that is a JSON string written without being one (`{\"a\": 1}`, with or without its outer
 * quotes), with its escapes undone; null if they aren't all valid, or it has a quote not escaped. Raw control
 * characters (a tab, a CRLF line break) are taken as they are, as in a string the parser reads loosely.
 */
export function unescapeText(text: string): string | null {
  const body = text.trim().replace(/^"|"$/g, '').replace(/[\u0000-\u001f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  try {
    const v: unknown = JSON.parse('"' + body + '"');
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Whether `text`, JSON written as a string (see unescapeText), holds JSON (holdsJson): taken as so past HOLDS_JSON_PARSE_MAX. */
export const holdsEscapedJson = (text: string) => text.length > HOLDS_JSON_PARSE_MAX || holdsJson(unescapeText(text) ?? '');

export function persistenceAfterChange(enabled: boolean, kind: ChangeKind): boolean {
  return enabled || kind !== 'set';
}

export function persistenceAfterLoad(enabled: boolean, persist: boolean): boolean {
  return enabled || persist;
}

const MULTI = 'Multiple top-level values (wrapped in an array)';

/**
 * JSON Lines / NDJSON: strict JSON values, one per line, separated by newlines
 * only (blank lines are skipped). Concatenated or comma-separated values are
 * still shown, but as loose JSON with an issue to fix.
 */
export function jsonLines(text: string, res: ParseResult): boolean {
  if (!res.multi || !res.root || res.error || res.issues.some((x) => x.m !== MULTI)) return false;
  const recs = res.root.v as JNode[];
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    const nl = text.indexOf('\n', r.s);
    if (nl >= 0 && nl < r.e) return false;
    if (k && !/^[ \t\r]*\n\s*$/.test(text.slice(recs[k - 1].e, r.s))) return false;
  }
  return true;
}
