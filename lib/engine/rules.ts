/* Document rules kept free of the browser-only engine, so tests can import them. */
import type { JNode, ParseResult } from '../json/parser';
import type { ChangeKind } from './editor';

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
