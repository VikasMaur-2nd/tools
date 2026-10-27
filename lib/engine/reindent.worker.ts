/** Re-indents big documents off the main thread (see Engine.outputFirst), and parses them after typing. */
import '../json/requote';
import { byteLength, formatDoc, minifiedBytes, reindent, reindenter, tooLarge } from '../json/format';
import { packedTransfer, packTape } from '../json/pack-send';
import { lazyResult } from '../json/lazy';
import { parse as parseTape, parser as tapeParser, warmUp } from '../json/tape-parser';
import { wasmTape } from '../json/tape-wasm';
import { childCount, W, type Tape } from '../json/tape';
import { MAX_DEPTH, type ParseResult } from '../json/parser';
import { codeChange, codeIndexer, inlineCodeIndexer, type CodeIndex } from '../json/code-index';
import { documentMetrics } from '../json/metrics';
import { compressedSizes } from './sizes';
import { jsonLines } from './rules';
import { Doc, type TextEdit } from './doc';
import { ScalarFormatter } from '../json/incremental-format';
import { prettyIndexer } from '../json/pretty';

let latest = 0;
let previous = '';
let previousId = 0;
export interface Request {
  id: number;
  text?: string;
  indent?: string;
  warm?: number;
  /** The analysis worker's warm-up before a document comes (see warmTape). */
  warmTape?: boolean;
  parse?: boolean;
  sortKeys?: boolean;
  lines?: boolean;
  escape?: boolean;
  /** An analysis whose document the Format view shows Pretty off its tape: its pretty lines, for this indent unit (see pretty.ts). */
  pretty?: string;
  base?: number;
  start?: boolean;
  chunk?: string;
  last?: boolean;
  fast?: boolean;
  analysis?: boolean;
  edit?: TextEdit;
  sourceBase?: number;
  cancel?: boolean;
  clear?: boolean;
  prepare?: boolean;
  reuseIndex?: boolean;
  good?: boolean;
  /** A big load: post how far this request's work got (see showing). */
  progress?: boolean;
  /** Measure this minified document's compressed sizes (`seq`: the page's request). */
  measure?: Blob;
  seq?: number;
}

/**
 * A big load's work in the worker posts how far it got, `{ id, progress }` (0 to 1 of this worker's part),
 * about this often in ms: the page shows it as "Parsing… N%" (see Engine.progress).
 */
const PROGRESS_EVERY = 100;
// Where each step of the worker's part ends (its measured share of the part, on 70 MB in Chromium, Firefox and Safari).
/** Formatting: re-indenting, then indexing the output's lines and sending it. */
const REINDENTED = 0.65;
/** Analysing: parsing, measuring (the minified size, then the rest), then packing the tree and sending it. */
const PARSED = 0.58;
const MINIFIED = 0.69;
const MEASURED = 0.8;

/** Posts how far the work for `data` got, if it asked (see PROGRESS_EVERY). */
const showing = (data: Request, progress: number) => {
  if (data.progress) self.postMessage({ id: data.id, progress });
};

let source = Doc.of('');
let sourceId = 0;
let fastTimer: ReturnType<typeof setTimeout> | undefined;
let incoming: { options: Request; chunks: string[] } | null = null;
/** The newest compressed-size request (see Request.measure): an older one stops after its current encoder. */
let measuring = 0;

self.onmessage = (e: MessageEvent<Request>) => {
  let data = e.data;
  if (data.measure) {
    // Compressed sizes for the page (Firefox runs the encoders on the thread that calls them).
    const seq = (measuring = data.seq!);
    void compressedSizes(data.measure, () => measuring === seq).then((sizes) => {
      if (measuring === seq) self.postMessage({ id: 0, measured: seq, sizes });
    });
    return;
  }
  if (data.clear) {
    latest = 0;
    clearTimeout(fastTimer);
    incoming = null;
    source = Doc.of('');
    sourceId = previousId = 0;
    previous = '';
    scalar = indexed = null;
    pendingCheckpoints = null;
    outputs.clear();
    return;
  }
  if (data.prepare) {
    const pending = pendingCheckpoints;
    if (pending?.id === data.id) {
      pendingCheckpoints = null;
      scalar = { key: pending.key, formatter: new ScalarFormatter(pending.input, pending.output) };
    }
    return;
  }
  if (data.cancel) { latest = data.id; clearTimeout(fastTimer); return; }
  if (data.warmTape) { void loadWasm().then(warmTape); return; }
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
  const { id, indent = '', warm } = data;
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(data.text ?? '', k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  if (data.edit) {
    if (data.sourceBase !== sourceId) { self.postMessage({ id, reset: true }); return; }
    source = source.edit(data.edit.a, data.edit.b, data.edit.ins);
  } else source = Doc.of(data.text ?? '');
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
  const text = source.toString();
  // The parse goes first, on its own (the page takes each message in its own task), packed: cloning a
  // big tree would block the page for about a second per 10 MB; the page rebuilds it in slices.
  latest = id;
  let min: string | null = null;
  let parsed: ParseResult | null = null;
  if (data.parse) {
    const tape = parseTape(text, { lines: data.lines, maxDepth: MAX_DEPTH, repair: true });
    const res = lazyResult(tape, text);
    min = res.root ? formatDoc(text, res, '') : null;
    const metrics = documentMetrics(text, res, min ?? '');
    if (jsonLines(text, res)) metrics.records = childCount(tape, 0);
    if (data.escape && min !== null) metrics.escaped = byteLength(JSON.stringify(min));
    // (A sent tape can't be read here. The output below reads the parse only for sorted keys, loose JSON
    // and nesting deeper than reindent goes: then a copy of the tape goes instead.)
    const reads = !!res.root && (!!data.sortKeys || !!res.error || !!res.issues.length || res.multi || res.depth >= REINDENT_DEPTH);
    if (reads) parsed = res;
    const tree = packTape(reads ? { ...tape, nodes: tape.nodes.slice(0, tape.count * W) } : tape);
    (self as unknown as Worker).postMessage({ id, tree, metrics }, packedTransfer(tree));
    // Compression consumes the same minified variant, entirely off the page's thread.
    if (res.root && metrics.min <= 32_000_000) {
      if (min !== null) void compressedSizes(new Blob([min]), () => latest === id).then((sizes) => {
        if (latest === id) self.postMessage({ id, sizes: { min: metrics.min, stale: false, ...sizes } });
      });
    }
  }
  // An output too large to make (see MAX_TEXT) is none: the page then says so.
  let out: string | null = null;
  let display: string | undefined;
  try {
    out = data.sortKeys && parsed?.root ? formatDoc(text, parsed, indent, true) : (indent === '' && min !== null ? min : reindent(text, indent)) ?? (parsed?.root ? formatDoc(text, parsed, indent) : null);
    display = data.escape && out ? JSON.stringify(out) : undefined;
  } catch (e) {
    if (!tooLarge(e)) throw e;
    out = null;
  }
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


/**
 * The WebAssembly tape parser (tape.wasm): strict JSON several times faster than in JavaScript. Compiled
 * on the first analysis (only the analysis worker parses big documents); null where WebAssembly can't run
 * (the JavaScript parser then does it all).
 */
let wasm: WebAssembly.Module | null | undefined;
let wasmReady: Promise<unknown> | null = null;
const loadWasm = () => (wasmReady ??= (async () => {
  try {
    const url = new URL('../json/tape.wasm', import.meta.url);
    // (compileStreaming needs the application/wasm type: a server that sends another gets the bytes compiled instead.)
    wasm = await WebAssembly.compileStreaming(fetch(url)).catch(async () => WebAssembly.compile(await (await fetch(url)).arrayBuffer()));
  } catch {
    wasm = null;
  }
  // The JavaScript parser's first parses in a fresh worker run before the engine optimizes it: a small one now.
  warmUp();
})());

/**
 * The analysis worker's warm-up (Engine.warmAnalysis): one WebAssembly parse of ~256 KB, from bytes and from
 * text. The engines optimize a module only once it has run a while: after the 4 KB warmUp() alone, the first
 * 1 MB document parsed 30-60% slower than the next (Node: 13 ms against 8.5; WebKit 2x).
 */
function warmTape() {
  if (!wasm) return;
  const records = Array.from({ length: 1700 }, (_, i) => `{"id":${i},"name":"item ${i} — café","tags":["a","b\\n","c"],"price":${(i * 1.37).toFixed(2)},"ok":${i % 2 === 0},"n":null,"geo":{"lat":${(i % 90) + 0.5},"lon":-${(i % 180) + 0.25}}}`);
  const text = '[' + records.join(',\n') + ']';
  wasmTape(wasm, text, {}, new TextEncoder().encode(text));
  wasmTape(wasm, text);
}

/** Secondary work has its own worker, so a full parse never delays the next output patch. */
function analyse(data: Request, text: string) {
  // (The first document may come before WebAssembly is compiled: a few ms.)
  if (wasm === undefined) return void loadWasm().then(() => latest === data.id && analyse(data, text));
  // Parsed straight to a tape: no node objects here (the page makes the ones it shows). Strict JSON goes
  // through WebAssembly; anything else (or no WebAssembly) through the JavaScript parser.
  const options = { lines: data.lines, maxDepth: MAX_DEPTH, repair: true };
  const tape = (wasm && !data.lines ? wasmTape(wasm, text, options) : null) ?? (data.progress ? parseShowing(data, text) : parseTape(text, options));
  const res = lazyResult(tape, text);
  showing(data, PARSED);
  // Strict JSON's minified size needs no minified copy: the tree goes to the page first, and the copy
  // is made after, only for what needs it (compressed sizes, the escaped size).
  const strict = !!res.root && !res.error && !res.issues.length && !res.multi;
  // (After the tape is sent this parse can't be read: a copy that needs it (loose JSON, nesting deeper than
  // reindent goes) is made before.)
  const later = !data.good && !!res.root;
  let min = res.root && (!strict || data.escape || (later && res.depth >= REINDENT_DEPTH)) ? formatDoc(text, res, '') : null;
  const minBytes = strict ? minifiedBytes(text) ?? undefined : undefined;
  showing(data, MINIFIED);
  const metrics = documentMetrics(text, res, min ?? undefined, minBytes);
  if (jsonLines(text, res)) metrics.records = childCount(tape, 0);
  if (data.escape && min !== null) metrics.escaped = byteLength(JSON.stringify(min));
  showing(data, MEASURED);
  // The Format view's lines are indexed here, off the page's thread, before the tape goes (it moves, not copied).
  const pretty = data.pretty && res.root ? prettyIndexer(tape, text, data.pretty)(Infinity) : null;
  const tree = packTape(tape);
  const lines = pretty ? [pretty.starts.buffer, pretty.close.buffer, pretty.depth.buffer, pretty.node.buffer, pretty.ascii.buffer] : [];
  (self as unknown as Worker).postMessage({ id: data.id, tree, metrics, good: data.good, pretty: pretty && { indent: data.pretty, index: pretty } }, [...packedTransfer(tree), ...lines]);
  // A huge document isn't kept here as well (hundreds of MB): an edit then asks the page for all of it again.
  if (text.length > RETAIN_MAX && !data.good) {
    source = Doc.of('');
    sourceId = -1;
  }
  if (later && metrics.min <= 32_000_000) {
    min ??= reindent(text, '');
    if (min === null) return;
    void compressedSizes(new Blob([min]), () => latest === data.id).then((sizes) => {
      if (latest === data.id) self.postMessage({ id: data.id, sizes: { min: metrics.min, stale: false, ...sizes } });
    });
  }
}

/** Nesting reindent leaves to the parser (see format.ts). */
const REINDENT_DEPTH = 500;

/** The tape parse in steps, posting how far it got (it costs the same as in one go). */
function parseShowing(data: Request, text: string): Tape {
  const p = tapeParser(text, { lines: data.lines, maxDepth: MAX_DEPTH, repair: true });
  for (;;) {
    const res = p.step(performance.now() + PROGRESS_EVERY);
    if (res) return res;
    showing(data, (PARSED * p.at()) / text.length);
  }
}

/** `reindent` in steps, posting how far it got (it costs the same as in one go). */
function reindentShowing(data: Request, text: string, indent: string): string | null {
  const run = reindenter(text, indent);
  for (;;) {
    const out = run(performance.now() + PROGRESS_EVERY);
    if (out !== undefined) return out;
    showing(data, (REINDENTED * run.at()) / text.length);
  }
}

/** Outputs longer than this (characters) aren't kept for patching the next one (see formatFast). */
const RETAIN_MAX = 48_000_000;

let scalar: { key: string; formatter: ScalarFormatter } | null = null;
let pendingCheckpoints: { id: number; key: string; input: Doc; output: Doc } | null = null;
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
  let checkpoints = false;
  if (small) output = small.output;
  else {
    const text = input.toString();
    let strict = false;
    try {
      raw = !data.sortKeys && !data.lines ? (data.progress ? reindentShowing(data, text, indent) : reindent(text, indent)) : null;
      strict = raw !== null;
      if (raw === null) {
        const res = lazyResult(parseTape(text, { lines: data.lines, maxDepth: MAX_DEPTH, repair: true }), text);
        raw = res.root ? formatDoc(text, res, indent, data.sortKeys) : null;
      }
    } catch (e) {
      // Too large to make (see MAX_TEXT): no output, as for invalid input.
      if (!tooLarge(e)) throw e;
      raw = null;
    }
    if (raw === null) { self.postMessage({ id, out: null }); return; }
    showing(data, REINDENTED);
    shape++;
    output = Doc.of(raw);
    scalar = null;
    pendingCheckpoints = null;
    checkpoints = strict && !data.escape && !data.sortKeys;
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
  // This worker owns formatting, so indexing can finish without main-thread slices or timer clamping.
  const index = run(Infinity)!;
  indexed = { doc: output, index, shape: currentShape };
  // Keep the worker's index; only the page's copy is transferred.
  const indexReuse = inline && data.reuseIndex;
  const sent = { ...index, starts: index.starts.slice(), close: indexReuse ? undefined : index.close.slice(), depth: indexReuse ? undefined : index.depth.slice() };
  // (`size`: the page shows how much of a big load's output has arrived.)
  const send = (field: 'out' | 'display', value: Doc | string) => {
    if (value.length < 2_000_000) return typeof value === 'string' ? value : value.toString();
    for (let i = 0; i < value.length; i += 256_000) self.postMessage({ id, field, chunk: value.slice(i, i + 256_000), size: value.length });
    return undefined;
  };
  const sentOut = patch === undefined ? send('out', raw ?? output) : null;
  const sentDisplay = display === undefined ? undefined : send('display', display);
  (self as unknown as Worker).postMessage({ id, out: sentOut ?? null, display: sentDisplay, change, patch, inline, indexReuse,
    chunkedOut: patch === undefined && sentOut === undefined,
    chunkedDisplay: display !== undefined && sentDisplay === undefined, index: sent,
  }, [sent.starts.buffer, ...(sent.close && sent.depth ? [sent.close.buffer, sent.depth.buffer] : [])]);
  // A huge document isn't kept here as well as on the page (hundreds of MB): an edit then asks the page for
  // all of it again (see analyse), and a huge output's next one is sent whole.
  if (input.length > RETAIN_MAX && source === input) {
    source = Doc.of('');
    sourceId = -1;
  }
  if (output.length > RETAIN_MAX || input.length > RETAIN_MAX) {
    outputs.clear();
    indexed = null;
    scalar = null;
    return;
  }
  // The viewer acknowledges after drawing. Only then may checkpoints compete for CPU,
  // so neither a cold load nor a full fallback pays for them before its rows appear.
  if (checkpoints) pendingCheckpoints = { id, key, input, output };
}
