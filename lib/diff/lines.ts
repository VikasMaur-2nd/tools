/**
 * Offset → line mapping for diff highlighting. Built once per document in a
 * single indexOf scan; lookups are O(log lines).
 */

import type { JNode } from '../json/parser';
import type { Change } from './diff';

export class LineMap {
  /** Offset of the first character of each line (0-based line index). */
  readonly starts: Int32Array;

  constructor(src: string) {
    let count = 1;
    for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) count++;
    const st = new Int32Array(count);
    let k = 1;
    for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) st[k++] = i + 1;
    this.starts = st;
  }

  get count(): number {
    return this.starts.length;
  }

  /** 1-based line containing `off`. */
  line(off: number): number {
    const st = this.starts;
    let lo = 0;
    let hi = st.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (st[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** 1-based column of `off`. */
  col(off: number): number {
    return off - this.starts[this.line(off) - 1] + 1;
  }

  /** Offset where 1-based `line` starts. */
  offset(line: number): number {
    return this.starts[Math.min(Math.max(line, 1), this.starts.length) - 1];
  }

  /** First and last 1-based lines a node spans. */
  range(node: JNode): [number, number] {
    return [this.line(node.s), this.line(Math.max(node.s, node.e - 1))];
  }
}

export type Side = 'left' | 'right';

export const MARK_ADDED = 1;
export const MARK_REMOVED = 2;
export const MARK_CHANGED = 3;

/**
 * Per-line markers for one side (index = line - 1): MARK_REMOVED / MARK_ADDED
 * for nodes only on that side, MARK_CHANGED for changed values. Changes cover
 * disjoint subtrees, so this is O(lines + changes).
 */
export function lineMarks(changes: readonly Change[], side: Side, map: LineMap): Uint8Array {
  const out = new Uint8Array(map.count);
  for (const c of changes) {
    if (c.order) continue;
    const n = side === 'left' ? c.left : c.right;
    if (!n) continue;
    const mark = c.kind === 'added' ? MARK_ADDED : c.kind === 'removed' ? MARK_REMOVED : MARK_CHANGED;
    const [a, b] = map.range(n);
    out.fill(mark, a - 1, b);
  }
  return out;
}
