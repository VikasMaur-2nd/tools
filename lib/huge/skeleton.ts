/**
 * huge.wasm (wasm/src/lib.rs, built with `pnpm wasm:huge`) from JS: a document's skeleton, read a window of
 * bytes at a time from a ByteSource. One Skeleton is one WebAssembly instance (its own memory), so an index
 * being built and queries answered meanwhile each have theirs.
 */
import type { ByteSource } from '../json/tape-wasm';

interface Exports {
  memory: WebAssembly.Memory;
  init(wcap: number, flags: number, ckEvery: number, big: number, maxDepth: number): number;
  win_ptr(): number;
  win_cap(): number;
  next_pos(): number;
  why(): number;
  fail_pos(): number;
  fail_info(): number;
  ck_ptr(): number;
  ck_len(): number;
  dir_ptr(): number;
  dir_len(): number;
  warn_ptr(): number;
  warn_len(): number;
  drain(): void;
  stats(): number;
  target(depth: number, start: number, count: number, byte: number, val: number): void;
  stop_after(after: number): void;
  facts(linesOk: number, sep: number, second: number, warns: number): void;
  load(len: number, last: number): number;
  run(): number;
  snap(): number;
  snap_ptr(): number;
  snap_room(depth: number): number;
  restore(): number;
}

// run() results.
export const DONE = 0;
export const NEED = 1;
export const STOP = 2;
export const FAIL = -1;
/** (JS only) The bytes after `limit` aren't read yet: the run stopped before them (see Skeleton.limit). */
export const FRONT = 3;

// why(): failures, then stops.
export const W_SYNTAX = 1;
export const W_DEPTH = 2;
export const W_MEMORY = 3;
export const W_END = 4;
export const W_CHILD = 5;
export const W_CLOSE = 6;
/** Stopped after a value at or past stopAfter's byte. */
export const W_AFTER = 7;

// Parser states (what comes next).
export const S_VALUE = 0;
export const S_ARR_FIRST = 1;
export const S_OBJ_FIRST = 2;
export const S_KEY = 3;
export const S_COLON = 4;
/** After a value in a container: a comma or its closing bracket. */
export const S_AFTER = 5;
/** After a top-level value: another (JSON Lines) or the end. */
export const S_TOP = 6;

// init() flags.
export const F_CHECKPOINTS = 1;
export const F_DUPS = 2;
export const F_DIR = 4;
export const F_LINES = 8;

/** f64 per frame in a state (see State), and before the frames. */
export const FW = 6;
export const HW = 15;
/** f64 per directory record. */
export const DW = 10;

/** One open container in a state: kind (ARR/OBJ), children so far, start byte, its current member's name (byte of its quote, -1: none), nodes and closing lines before it. */
export interface Frame {
  kind: number;
  count: number;
  start: number;
  key: number;
  nodes: number;
  closers: number;
}

/**
 * The parser's state before a token: a checkpoint, or where a parse stopped. Positions are bytes of the
 * document (after a UTF-8 byte order mark); `lines` counts line breaks before `pos`, `u16` UTF-16 units (the
 * page's text: \r\n as one), `lineU16` the UTF-16 offset of the start of `pos`'s line.
 */
export interface State {
  pos: number;
  state: number;
  /** Nodes (values) before `pos`. */
  nodes: number;
  /** Closing lines before `pos` (containers with children that closed): `nodes + closers` is `pos`'s pretty line. */
  closers: number;
  lines: number;
  u16: number;
  lineU16: number;
  /** Top-level values begun. */
  top: number;
  /** The deepest closing container with children since the checkpoint before (a checkpoint's own stretch). */
  deepest: number;
  // The JSON Lines facts of the same stretch: whether its top-level values were on lines of their own (1/0),
  // its first separator between them (-1: none); the line where the last top-level value started, the line where
  // the one before it ended (-1: none).
  lok: number;
  sep: number;
  topLine: number;
  lastTopLine: number;
  /** Open containers, outermost first. */
  frames: Frame[];
}

export interface SkeletonOptions {
  /** Window bytes (a multiple of 64). */
  window?: number;
  /** Bytes between checkpoints (0: none). */
  every?: number;
  /** Values of this many bytes or more go to the directory (0: no directory). */
  big?: number;
  /** Check property names for duplicates (bounded: see DUP_CAP in lib.rs). */
  dups?: boolean;
  maxDepth?: number;
  /** JSON Lines (as tape-parser.ts `lines`): separators after a single top-level value are fine. */
  lines?: boolean;
}

export const WINDOW = 1 << 20;

const decodeFrames = (a: Float64Array, at: number, n: number): Frame[] => {
  const out: Frame[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const o = at + k * FW;
    out[k] = { kind: a[o], count: a[o + 1], start: a[o + 2], key: a[o + 3], nodes: a[o + 4], closers: a[o + 5] };
  }
  return out;
};

/** The first frame a checkpoint holds (the ones below are its predecessor's): see lib.rs state_out. */
export const firstFrame = (depth: number, low: number) => (low > 0 ? Math.min(low - 1, depth) : 0);

/** The state in a header + frames record (snap(), or a checkpoint whose frames start at firstFrame(): `frames` then). */
export function decodeState(a: Float64Array, at: number, frames?: Frame[]): State {
  const depth = a[at + 2];
  return {
    pos: a[at],
    state: a[at + 1],
    nodes: a[at + 4],
    closers: a[at + 5],
    lines: a[at + 6],
    u16: a[at + 7],
    lineU16: a[at + 8],
    top: a[at + 9],
    deepest: a[at + 10],
    lok: a[at + 11],
    sep: a[at + 12],
    topLine: a[at + 13],
    lastTopLine: a[at + 14],
    frames: frames ?? decodeFrames(a, at + HW, depth - firstFrame(depth, a[at + 3])),
  };
}

export class Skeleton {
  private x: Exports;
  private src: ByteSource | null = null;
  window = WINDOW;
  /**
   * Bytes it may read: past this the document isn't read yet (the indexing pass's front), and a run stops there
   * with FRONT (a token the limit cuts is left unread).
   */
  limit = Infinity;

  constructor(mod: WebAssembly.Module) {
    this.x = new WebAssembly.Instance(mod, {}).exports as unknown as Exports;
  }

  /** Starts a parse of `src` from its first byte. False if out of memory. */
  start(src: ByteSource, o: SkeletonOptions = {}): boolean {
    this.src = src;
    this.limit = Infinity;
    this.window = Math.max(64, (o.window ?? WINDOW) & ~63);
    const flags = (o.every ? F_CHECKPOINTS : 0) | (o.dups ? F_DUPS : 0) | (o.big ? F_DIR : 0) | (o.lines ? F_LINES : 0);
    return this.x.init(this.window, flags, o.every || 0, o.big || 0, o.maxDepth ?? 100_000) === 1;
  }

  /** Where the next window starts (bytes). */
  get pos(): number {
    return this.x.next_pos();
  }

  /**
   * Loads the next window and runs until it needs another, is done, stops or fails (NEED, DONE, STOP, FAIL).
   * `max`: at most this many bytes in the window (multiple of 64; a stop target close by needs less).
   */
  step(max = this.window): number {
    const x = this.x;
    const src = this.src!;
    const at = x.next_pos();
    // (Never past the window it was made with, and whole 64-byte blocks unless it's the last.)
    max = Math.max(64, Math.min(this.window, max) & ~63);
    let len = Math.min(max, src.size - at);
    let last = at + len >= src.size;
    if (at + len > this.limit) {
      // (The window up to the limit: not a whole number of blocks, but nothing is read after it.)
      len = this.limit - at;
      last = false;
      if (len <= 0) return FRONT;
    }
    if (len > 0) new Uint8Array(x.memory.buffer, x.win_ptr(), len).set(src.read(at, len).subarray(0, len));
    x.load(len, last ? 1 : 0);
    return x.run();
  }

  /** Runs again in the same window (after a stop and a new target). */
  resume(): number {
    return this.x.run();
  }

  /** Runs on (in the window it is in, then the next ones) until done, stopped, failed or at the limit (not NEED). */
  go(max = this.window): number {
    let r = this.x.run();
    while (r === NEED) r = this.step(max);
    return r;
  }

  get why(): number {
    return this.x.why();
  }

  get failPos(): number {
    return this.x.fail_pos();
  }

  /** At failPos (if the failure is in the last window): [UTF-16 units before it, line breaks before it, the UTF-16 offset of its line's start]. */
  get failAt(): [number, number, number] {
    const a = new Float64Array(this.x.memory.buffer, this.x.fail_info(), 3);
    return [a[0], a[1], a[2]];
  }

  /**
   * From now on, stop before child `count` of the container that starts at byte `start` and has `depth` open
   * containers when innermost (depth 0: the top level, whatever `start`), or before its first child at byte
   * `byte` or later (an object member: at its name), or before the child whose value starts at byte `val` (an
   * object member: after its name), or at its closing bracket. `depth` -1: no target.
   */
  target(depth: number, start = -1, count = -1, byte = -1, val = -1): void {
    this.x.target(depth, start, count, byte, val);
  }

  /** From now on (after target()), also stop after a value at the first comma, closing bracket or top-level value at or after byte `after` (-1: no). */
  stopAfter(after: number): void {
    this.x.stop_after(after);
  }

  /** The state now (where it stopped, or at the end of the window). */
  snapshot(): State {
    const x = this.x;
    const n = x.snap();
    return decodeState(new Float64Array(x.memory.buffer, x.snap_ptr(), n), 0);
  }

  /**
   * Continues from state `s` (the source's bytes from s.pos on). False if out of memory. `carry`: `s` is where a
   * run stopped past a checkpoint, and its stretch's facts (deepest, lok, sep) go on into the next checkpoint's;
   * else (a checkpoint, whose own stretch they are) the next stretch starts with none.
   */
  restore(s: State, carry = false): boolean {
    const x = this.x;
    const depth = s.frames.length;
    const p = x.snap_room(depth);
    if (!p) return false;
    const a = new Float64Array(x.memory.buffer, p, HW + depth * FW);
    a[0] = s.pos;
    a[1] = s.state;
    a[2] = depth;
    // (-1: past the last checkpoint: the next one holds all its frames.)
    a[3] = carry ? -1 : 0;
    a[4] = s.nodes;
    a[5] = s.closers;
    a[6] = s.lines;
    a[7] = s.u16;
    a[8] = s.lineU16;
    a[9] = s.top;
    a[10] = carry ? s.deepest : 0;
    a[11] = carry ? s.lok : 1;
    a[12] = carry ? s.sep : -1;
    a[13] = s.topLine;
    a[14] = s.lastTopLine;
    for (let k = 0; k < depth; k++) {
      const f = s.frames[k];
      const o = HW + k * FW;
      a[o] = f.kind;
      a[o + 1] = f.count;
      a[o + 2] = f.start;
      a[o + 3] = f.key;
      a[o + 4] = f.nodes;
      a[o + 5] = f.closers;
    }
    return x.restore() === 1;
  }

  /** After restore(): the document's facts before the state's byte, and its duplicate names so far (see lib.rs facts()). */
  facts(linesOk: boolean, sep: number, second: number, warns: number): void {
    this.x.facts(linesOk ? 1 : 0, sep, second, warns);
  }

  /** Reads `src` from now on (the same document, edited: see pieces.ts). */
  use(src: ByteSource): void {
    this.src = src;
  }

  /** Counters now: see lib.rs stats(). */
  stats(): Float64Array {
    const x = this.x;
    return new Float64Array(x.memory.buffer, x.stats(), 19).slice();
  }

  /** The checkpoints, directory records and warnings since the last drain (copies), then drains. */
  drain(): { ck: Float64Array; dir: Float64Array; warn: Float64Array } {
    const x = this.x;
    const buf = x.memory.buffer;
    const out = {
      ck: new Float64Array(buf, x.ck_ptr(), x.ck_len()).slice(),
      dir: new Float64Array(buf, x.dir_ptr(), x.dir_len()).slice(),
      warn: new Float64Array(buf, x.warn_ptr(), x.warn_len()).slice(),
    };
    x.drain();
    return out;
  }

  /** Bytes of WebAssembly memory (it never shrinks: a Skeleton that grew a lot should be dropped). */
  get memoryBytes(): number {
    return this.x.memory.buffer.byteLength;
  }
}
