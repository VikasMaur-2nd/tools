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
