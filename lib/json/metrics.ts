import { ARR, OBJ, STR, type JNode, type ParseResult } from './parser';
import { byteLength, formatDoc } from './format';

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

/** Whole-document measurements run alongside parsing in the worker. */
export function documentMetrics(text: string, res: ParseResult, minified?: string): DocumentMetrics {
  let extra = 0;
  let units = 0;
  const stack: JNode[] = res.root ? [res.root] : [];
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
  const metrics: DocumentMetrics = { bytes: byteLength(text), min: res.root ? byteLength(minified ?? formatDoc(text, res, '')) : 0, extra, units };
  if (res.root?.t === STR && /^\s*[[{]/.test(res.root.v as string)) metrics.unescape = true;
  return metrics;
}
