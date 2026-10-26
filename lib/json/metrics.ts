import { ARR, OBJ, STR, type JNode, type ParseResult } from './parser';
import { byteLength, formatDoc } from './format';
import { tapeOfNode } from './lazy';
import { sizeOf, W, type Tape } from './tape';

/** documentMetrics' whitespace counts, read off a tape: per container with k children at depth d, k + 1 (+ k for an object's colons) and k(d + 1) + d indent units. */
function tapeMetrics(t: Tape): { extra: number; units: number } {
  let extra = 0;
  let units = 0;
  const a = t.nodes;
  // Children seen so far per open container, and where each ends.
  const ends: number[] = [];
  const counts: number[] = [];
  const kinds: number[] = [];
  const close = () => {
    const k = counts.pop()!;
    const kind = kinds.pop()!;
    ends.pop();
    const d = ends.length;
    if (k) {
      extra += k + 1 + (kind === OBJ ? k : 0);
      units += k * (d + 1) + d;
    }
  };
  for (let i = 0; i < t.count; i++) {
    while (ends.length && i >= ends[ends.length - 1]) close();
    if (counts.length) counts[counts.length - 1]++;
    const kind = a[i * W] & 7;
    if (kind >= ARR) {
      ends.push(i + sizeOf(t, i));
      counts.push(0);
      kinds.push(kind);
    }
  }
  while (ends.length) close();
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
  if (res.root?.t === STR && /^\s*[[{]/.test(res.root.v as string)) metrics.unescape = true;
  return metrics;
}
