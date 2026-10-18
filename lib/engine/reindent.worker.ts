/** Re-indents big documents off the main thread (see Engine.outputFirst), and parses them after typing. */
import { byteLength, formatDoc, reindent } from '../json/format';
import { packStrings, packTree } from '../json/pack';
import { parse, type ParseResult } from '../json/parser';
import { codeChange, codeIndexer, inlineCodeIndexer, type CodeIndex } from '../json/code-index';
import { documentMetrics } from '../json/metrics';
import { compressedSizes } from './sizes';
import { jsonLines } from './rules';
import type { JNode } from '../json/parser';
import { Doc, type TextEdit } from './doc';
import { ScalarFormatter } from '../json/incremental-format';

let latest = 0;
let previous = '';
let previousId = 0;
export interface Request {
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
  fast?: boolean;
  analysis?: boolean;
  edit?: TextEdit;
  sourceBase?: number;
  cancel?: boolean;
  reuseIndex?: boolean;
  good?: boolean;
}
let source = Doc.of('');
let sourceId = 0;
let fastTimer: ReturnType<typeof setTimeout> | undefined;
let incoming: { options: Request; chunks: string[] } | null = null;
self.onmessage = (e: MessageEvent<Request>) => {
  let data = e.data;
  if (data.cancel) { latest = data.id; clearTimeout(fastTimer); return; }
  if (data.start) {
    latest = data.id;
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
  incoming = null;
  const { id, text = '', indent = '', warm } = data;
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(text, k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  if (data.edit) {
    if (data.sourceBase !== sourceId) { self.postMessage({ id, reset: true }); return; }
    source = source.edit(data.edit.a, data.edit.b, data.edit.ins);
  } else source = Doc.of(text);
  sourceId = id;
  latest = id;
  if (data.analysis) { analyse(data, source.toString()); return; }
  clearTimeout(fastTimer);
  if (data.fast) {
    const input = source;
    // Apply queued source edits in order, then format only the newest version.
    fastTimer = setTimeout(() => { if (latest === id) formatFast(data, input); }, 2);
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
    const tree = packStrings(packTree(res, text));
    (self as unknown as Worker).postMessage({ id, tree, metrics }, [tree.nodes.buffer, tree.parents.buffer, tree.words.text.buffer, tree.words.offsets.buffer]);
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


/** Secondary work has its own worker, so a full parse never delays the next output patch. */
function analyse(data: Request, text: string) {
  const res = parse(text, { lines: data.lines });
  const min = res.root ? formatDoc(text, res, '') : null;
  const metrics = documentMetrics(text, res, min ?? '');
  if (jsonLines(text, res)) metrics.records = (res.root!.v as JNode[]).length;
  if (data.escape && min !== null) metrics.escaped = byteLength(JSON.stringify(min));
  const tree = packStrings(packTree(res, text));
  (self as unknown as Worker).postMessage({ id: data.id, tree, metrics, good: data.good }, [tree.nodes.buffer, tree.parents.buffer, tree.words.text.buffer, tree.words.offsets.buffer]);
  if (!data.good && min !== null && metrics.min <= 32_000_000) void compressedSizes(new Blob([min]), () => latest === data.id).then((sizes) => {
    if (latest === data.id) self.postMessage({ id: data.id, sizes: { min: metrics.min, stale: false, ...sizes } });
  });
}

let scalar: { key: string; formatter: ScalarFormatter } | null = null;
let shape = 0;
let indexed: { doc: Doc; index: CodeIndex; shape: number } | null = null;
const outputs = new Map<number, { doc: Doc; shape: number }>();

function formatFast(data: Request, input: Doc) {
  const id = data.id;
  const indent = data.indent ?? '';
  const key = `${indent}:${!!data.sortKeys}:${!!data.escape}:${!!data.lines}`;
  const small = scalar?.key === key ? scalar.formatter.update(input) : null;
  let output: Doc;
  let raw: string | null = null;
  let display: string | undefined;
  if (small) output = small.output;
  else {
    const text = input.toString();
    raw = !data.sortKeys && !data.lines ? reindent(text, indent) : null;
    const strict = raw !== null;
    if (raw === null) {
      const res = parse(text, { lines: data.lines });
      raw = res.root ? formatDoc(text, res, indent, data.sortKeys) : null;
    }
    if (raw === null) { self.postMessage({ id, out: null }); return; }
    shape++;
    output = Doc.of(raw);
    scalar = strict && !data.escape && !data.sortKeys ? { key, formatter: new ScalarFormatter(input, output) } : null;
    if (data.escape) { display = JSON.stringify(raw); output = Doc.of(display); }
  }
  const currentShape = shape;
  const base = outputs.get(data.base ?? 0);
  const delta = base ? output.changeFrom(base.doc) : null;
  const change = base ? { ...(delta ? { prefix: delta.a, suffix: base.doc.length - delta.b } : codeChange(base.doc.toString(), output.toString())), base: data.base! } : undefined;
  const patch = !data.escape && change && output.length - change.prefix - change.suffix <= 1_000_000
    ? delta?.ins ?? output.slice(change.prefix, output.length - change.suffix) : undefined;
  const inline = !!base && base.shape === currentShape && patch !== undefined;
  outputs.set(id, { doc: output, shape: currentShape });
  for (const [oldId, old] of outputs) if (oldId !== data.base && (old.shape !== currentShape || outputs.size > 8)) outputs.delete(oldId);
  let indexEdit = indexed?.shape === currentShape ? output.changeFrom(indexed.doc) : null;
  if (indexEdit?.ins.includes('\n')) indexEdit = null;
  const run = indexed && indexEdit ? inlineCodeIndexer(indexed.index, indexed.doc.length, { prefix: indexEdit.a, suffix: indexed.doc.length - indexEdit.b }, indexEdit.ins) : codeIndexer(output.toString());
  const step = () => {
    if (latest !== id) return;
    const index = run(performance.now() + 8);
    if (!index) { setTimeout(step, 0); return; }
    indexed = { doc: output, index, shape: currentShape };
    // Keep the worker's index; only the page's copy is transferred.
    const indexReuse = inline && data.reuseIndex;
    const sent = { ...index, starts: index.starts.slice(), close: indexReuse ? undefined : index.close.slice(), depth: indexReuse ? undefined : index.depth.slice() };
    const send = (field: 'out' | 'display', value: Doc | string) => {
      if (value.length < 2_000_000) return typeof value === 'string' ? value : value.toString();
      for (let i = 0; i < value.length; i += 256_000) self.postMessage({ id, field, chunk: value.slice(i, i + 256_000) });
      return undefined;
    };
    const sentOut = patch === undefined ? send('out', raw ?? output) : null;
    const sentDisplay = display === undefined ? undefined : send('display', display);
    (self as unknown as Worker).postMessage({ id, out: sentOut ?? null, display: sentDisplay, change, patch, inline, indexReuse,
      chunkedOut: patch === undefined && sentOut === undefined,
      chunkedDisplay: display !== undefined && sentDisplay === undefined, index: sent,
    }, [sent.starts.buffer, ...(sent.close && sent.depth ? [sent.close.buffer, sent.depth.buffer] : [])]);
  };
  step();
}
