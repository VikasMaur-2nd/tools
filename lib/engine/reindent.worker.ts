/** Re-indents big documents off the main thread (see Engine.outputFirst), and parses them after typing. */
import { byteLength, formatDoc, reindent } from '../json/format';
import { packTree } from '../json/pack';
import { parse, type ParseResult } from '../json/parser';
import { codeChange, codeIndexer } from '../json/code-index';
import { documentMetrics } from '../json/metrics';
import { compressedSizes } from './sizes';
import { jsonLines } from './rules';
import type { JNode } from '../json/parser';

let latest = 0;
let previous = '';
let previousId = 0;
self.onmessage = (e: MessageEvent<{ id: number; text: string; indent: string; warm?: number; parse?: boolean; sortKeys?: boolean; lines?: boolean; escape?: boolean }>) => {
  const { id, text, indent, warm } = e.data;
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(text, k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  // The parse goes first, on its own (the page takes each message in its own task), packed: cloning a
  // big tree would block the page for about a second per 10 MB; the page rebuilds it in slices.
  latest = id;
  let min: string | null = null;
  let parsed: ParseResult | null = null;
  if (e.data.parse) {
    const res = parsed = parse(text, { lines: e.data.lines });
    min = res.root ? formatDoc(text, res, '') : null;
    const metrics = documentMetrics(text, res, min ?? '');
    if (jsonLines(text, res)) metrics.records = (res.root!.v as JNode[]).length;
    if (e.data.escape && min !== null) metrics.escaped = byteLength(JSON.stringify(min));
    const tree = packTree(res, text);
    (self as unknown as Worker).postMessage({ id, tree, metrics }, [tree.nodes.buffer, tree.parents.buffer]);
    // Compression consumes the same minified variant, entirely off the page's thread.
    if (res.root && metrics.min <= 32_000_000) {
      if (min !== null) void compressedSizes(new Blob([min]), () => latest === id).then((sizes) => {
        if (latest === id) self.postMessage({ id, sizes: { min: metrics.min, stale: false, ...sizes } });
      });
    }
  }
  const out = e.data.sortKeys && parsed?.root ? formatDoc(text, parsed, indent, true) : (indent === '' && min !== null ? min : reindent(text, indent)) ?? (parsed?.root ? formatDoc(text, parsed, indent) : null);
  const display = e.data.escape && out ? JSON.stringify(out) : undefined;
  const change = out === null ? undefined : { ...codeChange(previous, display ?? out), base: previousId };
  if (out !== null) { previous = display ?? out; previousId = id; }
  const index = out === null ? undefined : codeIndexer(display ?? out)(Infinity)!;
  (self as unknown as Worker).postMessage({ id, out, index, display, change }, index ? [index.starts.buffer, index.close.buffer, index.depth.buffer] : []);
};
