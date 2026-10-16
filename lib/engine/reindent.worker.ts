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
interface Request {
  id: number;
  text?: string;
  indent?: string;
  warm?: number;
  parse?: boolean;
  sortKeys?: boolean;
  lines?: boolean;
  escape?: boolean;
  base?: number;
  start?: boolean;
  chunk?: string;
  last?: boolean;
}
let incoming: { options: Request; chunks: string[] } | null = null;
self.onmessage = (e: MessageEvent<Request>) => {
  let data = e.data;
  if (data.start) {
    incoming = { options: data, chunks: [] };
    return;
  }
  if (data.chunk !== undefined) {
    if (!incoming || incoming.options.id !== data.id) return;
    incoming.chunks.push(data.chunk);
    if (!data.last) return;
    data = { ...incoming.options, text: incoming.chunks.join('') };
    incoming = null;
  }
  const { id, text = '', indent = '', warm } = data;
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
  if (data.parse) {
    const res = parsed = parse(text, { lines: data.lines });
    min = res.root ? formatDoc(text, res, '') : null;
    const metrics = documentMetrics(text, res, min ?? '');
    if (jsonLines(text, res)) metrics.records = (res.root!.v as JNode[]).length;
    if (data.escape && min !== null) metrics.escaped = byteLength(JSON.stringify(min));
    const tree = packTree(res, text);
    (self as unknown as Worker).postMessage({ id, tree, metrics }, [tree.nodes.buffer, tree.parents.buffer]);
    // Compression consumes the same minified variant, entirely off the page's thread.
    if (res.root && metrics.min <= 32_000_000) {
      if (min !== null) void compressedSizes(new Blob([min]), () => latest === id).then((sizes) => {
        if (latest === id) self.postMessage({ id, sizes: { min: metrics.min, stale: false, ...sizes } });
      });
    }
  }
  const out = data.sortKeys && parsed?.root ? formatDoc(text, parsed, indent, true) : (indent === '' && min !== null ? min : reindent(text, indent)) ?? (parsed?.root ? formatDoc(text, parsed, indent) : null);
  const display = data.escape && out ? JSON.stringify(out) : undefined;
  const change = out === null ? undefined : { ...codeChange(previous, display ?? out), base: previousId };
  const patch = out !== null && !data.escape && change && change.base === data.base && out.length - change.prefix - change.suffix <= 1_000_000
    ? out.slice(change.prefix, out.length - change.suffix) : undefined;
  const shown = display ?? out;
  const unchanged = shown !== null && shown.length === previous.length && change?.prefix === shown.length && change?.suffix === 0;
  if (out !== null) { previous = display ?? out; previousId = id; }
  const index = out === null || unchanged ? undefined : codeIndexer(display ?? out)(Infinity)!;
  // A cold worker or a whole rewrite has no small patch. Bound each message's string clone.
  const send = (field: 'out' | 'display', value: string | null | undefined) => {
    if (!value || value.length < 2_000_000) return value;
    for (let i = 0; i < value.length; i += 256_000) self.postMessage({ id, field, chunk: value.slice(i, i + 256_000) });
    return undefined;
  };
  const sentOut = patch === undefined ? send('out', out) : null;
  const sentDisplay = send('display', display);
  (self as unknown as Worker).postMessage({ id, out: sentOut ?? null, index, display: sentDisplay, change, patch,
    chunkedOut: patch === undefined && out !== null && sentOut === undefined,
    chunkedDisplay: display !== undefined && sentDisplay === undefined,
  }, index ? [index.starts.buffer, index.close.buffer, index.depth.buffer] : []);
};
