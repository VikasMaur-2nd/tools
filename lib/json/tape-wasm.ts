/**
 * The tape of a strict JSON document from WebAssembly (tape.wasm, built from wasm/src/lib.rs with
 * `pnpm wasm`): exactly the JS tape parser's (tape-parser.ts), faster, for documents that are
 * strict JSON with one top-level value. For anything else it returns null, and the JS tape parser
 * parses the document (and reports what it found).
 *
 * The input is the document's text or, better, its bytes as read from a file (UTF-8, then not
 * encoded again; invalid UTF-8 returns null). It goes to WebAssembly a window at a time, so the
 * document is never copied whole, and each window's nodes come back to JS.
 */
import { decodeString } from './decode';
import { fitted, SIZE_BIG, W, type Tape } from './tape';
import type { TapeOptions } from './tape-parser';

interface Exports {
  memory: WebAssembly.Memory;
  init(text: number, maxDepth: number, window: number): number;
  window(size: number): number;
  win_ptr(): number;
  win_cap(): number;
  load(len: number, last: number, u16: number, cr: number): number;
  run(): number;
  out_ptr(): number;
  out_len(): number;
  drain(): void;
  resume(): number;
  pos(): number;
  resume_u16(): number;
  depth(): number;
  exact(): number;
  patch_ptr(): number;
  patch_len(): number;
  big_ptr(): number;
  big_len(): number;
  warn_ptr(): number;
  warn_len(): number;
  keys(): number;
  key_u16_ptr(): number;
  key_end_ptr(): number;
  key_flag_ptr(): number;
}

// run() results (else -1: not strict JSON).
const DONE = 0;
const NEED = 1;

/** Window size in bytes (a token longer than that doubles it). */
const WINDOW = 1 << 18;
/** An instance is kept for the next parse while its memory is at most this (Wasm memory never shrinks). */
const KEEP = 16 << 20;

/** An idle instance per module (making one costs ~0.5 ms in WebKit). */
const idle = new WeakMap<WebAssembly.Module, Exports>();

const encoder = new TextEncoder();

/** A file's bytes, read a window at a time (a worker reads a File so, with FileReaderSync: never all of it at once). */
export interface ByteSource {
  size: number;
  /** `len` bytes from `at` (fewer at the end). */
  read(at: number, len: number): Uint8Array;
}

/**
 * The tape of `text` from WebAssembly module `mod` (compiled from tape.wasm), or null if it isn't strict
 * JSON with one top-level value (or `lines` is set): parse it with tape-parser.ts then. `bytes`, if given,
 * are the file `text` was read from (UTF-8), whole or read a window at a time: `text` is them decoded with
 * their line ends as \n (doc.ts lf(), as Engine.load keeps a document), and the offsets count \r\n as one
 * unit. `window`: input bytes per window (tests make it small).
 */
export function wasmTape(mod: WebAssembly.Module, text: string, options: TapeOptions = {}, bytes?: Uint8Array | ByteSource, window = WINDOW): Tape | null {
  if (options.lines || !text) return null;
  let src: ByteSource | undefined;
  if (bytes instanceof Uint8Array) {
    const all = bytes;
    src = { size: all.length, read: (at, len) => all.subarray(at, at + len) };
  } else src = bytes;
  // TextDecoder drops a byte order mark: the bytes must be the text's.
  if (src && text.charCodeAt(0) !== 0xfeff) {
    const head = src.read(0, 3);
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
      const whole = src;
      src = { size: whole.size - 3, read: (at, len) => whole.read(at + 3, len) };
    }
  }
  const x = idle.get(mod) ?? (new WebAssembly.Instance(mod, {}).exports as unknown as Exports);
  idle.delete(mod);
  const tape = run(x, text, options, src, window);
  if (x.memory.buffer.byteLength <= KEEP) idle.set(mod, x);
  return tape;
}

function run(x: Exports, text: string, options: TapeOptions, bytes: ByteSource | undefined, window: number): Tape | null {
  const maxDepth = Math.min(options.maxDepth ?? 0xffffffff, 0xffffffff);
  if (!x.init(bytes ? 0 : 1, maxDepth >>> 0, window)) return null;
  const total = bytes ? bytes.size : text.length;
  let nodes = new Int32Array(0);
  let count = 0;
  // Where the next window starts: in bytes (from bytes) or UTF-16 code units (both, from bytes).
  let at = 0;
  let u16 = 0;
  // From bytes: whether the byte before the window is a \r (a \r\n the window cuts is one unit).
  let cr = 0;
  for (;;) {
    const cap = x.win_cap();
    const win = new Uint8Array(x.memory.buffer, x.win_ptr(), cap);
    let len: number;
    let last: boolean;
    // The share of the document done at offset `p` of the window (estimates the tape's size).
    let done: (p: number) => number;
    if (bytes) {
      len = Math.min(cap, total - at);
      win.set(bytes.read(at, len));
      last = at + len === total;
      done = (p) => (at + p) / total;
    } else {
      // (Not between the halves of a surrogate pair: each half would become U+FFFD.)
      let end = Math.min(total, u16 + cap);
      if (end < total && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end--;
      const r = encoder.encodeInto(u16 === 0 && end === total ? text : text.substring(u16, end), win);
      len = r.written;
      last = u16 + r.read === total;
      // (UTF-8 bytes for UTF-16 units: close enough for an estimate.)
      done = (p) => (u16 + (p * r.read) / Math.max(len, 1)) / total;
    }
    if (x.load(len, last ? 1 : 0, u16, cr) < 0) return null;
    const r = x.run();
    if (r !== DONE && r !== NEED) return null;
    // The window's nodes.
    const n = x.out_len();
    if (n) {
      if ((count + n) * W > nodes.length) nodes = grow(nodes, count, count + n, done(x.pos()), total);
      nodes.set(new Int32Array(x.memory.buffer, x.out_ptr(), n * W), count * W);
      count += n;
      x.drain();
    }
    if (r === DONE) return finish(x, text, nodes, count);
    const next = x.resume();
    // A token longer than the window: a bigger one, from the same place.
    if (next === 0) {
      if (!x.window(cap * 2)) return null;
      continue;
    }
    if (bytes) {
      cr = new Uint8Array(x.memory.buffer, x.win_ptr() + next - 1, 1)[0] === 13 ? 1 : 0;
      at += next;
    }
    u16 = x.resume_u16();
  }
}

/**
 * `nodes` with room for `need` nodes (`used` in use), grown to about what the whole document needs:
 * `need` nodes are its share `done` (of `size` bytes). A small document gets more room to spare (up to 24%):
 * its density varies more, and growing again costs more than the room (big allocations are slow in
 * WebKit).
 */
function grow(nodes: Int32Array<ArrayBuffer>, used: number, need: number, done: number, size: number): Int32Array<ArrayBuffer> {
  const margin = 1.04 + Math.min(0.2, 1e6 / size);
  const want = Math.max(need, Math.ceil((need / Math.max(done, 1e-6)) * margin) + 1024, Math.ceil((nodes.length / W) * 1.125));
  const next = new Int32Array(want * W);
  next.set(nodes.subarray(0, used * W));
  return next;
}

function finish(x: Exports, text: string, nodes: Int32Array<ArrayBuffer>, count: number): Tape {
  const u32 = (ptr: number, len: number) => new Uint32Array(x.memory.buffer, ptr, len);
  // Containers that closed after their node went out, and sizes too big for the node.
  let big: Map<number, number> | null = null;
  const patches = u32(x.patch_ptr(), x.patch_len());
  for (let k = 0; k < patches.length; k += 3) {
    const o = patches[k] * W;
    const size = patches[k + 1];
    nodes[o] = (nodes[o] & 0xff) | (Math.min(size, SIZE_BIG) << 8);
    nodes[o + 2] = patches[k + 2];
    if (size >= SIZE_BIG) (big ??= new Map()).set(patches[k], size);
  }
  const bigs = u32(x.big_ptr(), x.big_len());
  for (let k = 0; k < bigs.length; k += 2) (big ??= new Map()).set(bigs[k], bigs[k + 1]);
  // Property names, read from the text where each first appears.
  const n = x.keys();
  const starts = u32(x.key_u16_ptr(), n);
  const ends = u32(x.key_end_ptr(), n);
  const flags = u32(x.key_flag_ptr(), n);
  const keys: string[] = new Array(n);
  for (let k = 0; k < n; k++) keys[k] = flags[k] & 1 ? decodeString(text, starts[k]) : text.slice(starts[k] + 1, ends[k] - 1);
  const dups = u32(x.warn_ptr(), x.warn_len());
  const warnings = [];
  for (let k = 0; k < dups.length; k += 2) {
    const key = keys[dups[k + 1]];
    warnings.push({ p: dups[k], m: `Duplicate key "${key.length > 40 ? key.slice(0, 40) + '…' : key}"` });
  }
  const head = { issues: [], warnings, error: null, nodes: count, depth: x.depth(), exact: x.exact() === 1 && !warnings.length, multi: false };
  return { nodes: fitted(nodes, count), count, keys, big, extra: null, head };
}
