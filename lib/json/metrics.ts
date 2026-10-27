import { ARR, OBJ, STR, type JNode, type ParseResult } from './parser';
import { byteLength, formatDoc } from './format';
import { tapeOfNode } from './lazy';
import { SIZE_BIG, sizeOf, W, type Tape } from './tape';

/** documentMetrics' whitespace counts, read off a tape: per container with k children at depth d, k + 1 (+ k for an object's colons) and k(d + 1) + d indent units. */
function tapeMetrics(t: Tape): { extra: number; units: number } {
  let extra = 0;
  let units = 0;
  const a = t.nodes;
  const n = t.count;
  // Per open container: where it ends, its children so far, whether it is an object.
  const levels = t.head.depth + 2;
  const ends = new Int32Array(levels);
  const counts = new Int32Array(levels);
  const objs = new Uint8Array(levels);
  let top = 0;
  for (let i = 0; i < n; i++) {
    while (top && i >= ends[top - 1]) {
      const k = counts[--top];
      if (k) {
        extra += k + 1 + (objs[top] ? k : 0);
        units += k * (top + 1) + top;
      }
    }
    if (top) counts[top - 1]++;
    const m = a[i * W];
    const kind = m & 7;
    if (kind >= ARR) {
      let size = m >>> 8;
      if (size >= SIZE_BIG) size = sizeOf(t, i);
      ends[top] = i + size;
      counts[top] = 0;
      objs[top++] = kind === OBJ ? 1 : 0;
    }
  }
  while (top) {
    const k = counts[--top];
    if (k) {
      extra += k + 1 + (objs[top] ? k : 0);
      units += k * (top + 1) + top;
    }
  }
  return { extra, units };
}

export interface DocumentMetrics {
  bytes: number;
  records?: number;
  escaped?: number;
  unescape?: boolean;
  min: number;
  /** Pretty whitespace bytes, independent of the selected indent unit. */
  extra: number;
  units: number;
}

/** Whole-document measurements run alongside parsing in the worker (`min`: the minified size, if known). */
export function documentMetrics(text: string, res: ParseResult, minified?: string, min?: number): DocumentMetrics {
  let extra = 0;
  let units = 0;
  const at = res.root && tapeOfNode(res.root);
  // (A tree from a tape is measured on the tape: walking it would make every node.)
  if (at) ({ extra, units } = tapeMetrics(at.tape));
  const stack: JNode[] = res.root && !at ? [res.root] : [];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.t < ARR) continue;
    const list = n.v as JNode[];
    const k = list.length;
    if (!k) continue;
    extra += k + 1 + (n.t === OBJ ? k : 0);
    units += k * (n.d + 1) + n.d;
    for (const child of list) if (child.t >= ARR) stack.push(child);
  }
  const metrics: DocumentMetrics = { bytes: byteLength(text), min: res.root ? min ?? byteLength(minified ?? formatDoc(text, res, '')) : 0, extra, units };
  // (A string's start is enough: a long one from a tape isn't decoded whole for this.)
  const root = res.root;
  if (root?.t === STR && /^\s*[[{]/.test(root._v === undefined && root.z ? root.z.head(root, 65_536) : (root.v as string))) metrics.unescape = true;
  return metrics;
}
