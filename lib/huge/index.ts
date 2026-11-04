/**
 * The index of a huge document: what the skeleton (skeleton.ts) leaves after one pass, and all queries start
 * from. It is small (about 100 bytes per checkpoint, ~1 per MB, and the directory of big values), so a 10 GB
 * document's index is a few MB.
 *
 * - Checkpoints: the parser's state after a value about every `every` bytes (and right after every big value),
 *   in typed arrays. Each holds only the open containers that changed since the one before (`from`..depth); the
 *   rest are its predecessor's (see frame()), so a deep document doesn't cost depth × checkpoints.
 * - The directory: every value of at least `big` bytes (containers and strings) with its span, children, depth
 *   and pretty lines, sorted by start when queried.
 */
import { DW, FW, HW, S_VALUE, firstFrame, type Frame, type State } from './skeleton';

const grow = <T extends Float64Array | Int32Array | Uint8Array>(a: T, need: number): T => {
  if (need <= a.length) return a;
  const b = new (a.constructor as new (n: number) => T)(Math.max(need, a.length * 2));
  b.set(a);
  return b;
};

/** A directory record: a value of at least `big` bytes. */
export interface Big {
  start: number;
  /** Byte after its last. */
  end: number;
  /** STR, ARR or OBJ. */
  kind: number;
  /** Its depth (the root is 0). */
  depth: number;
  /** Children (0 for a string). */
  count: number;
  /** Nodes and closing lines before it: its pretty line is nodes + closers (+1 in JSON Lines). */
  nodes: number;
  closers: number;
  /** Nodes and closing lines before its end: its subtree has endNodes - nodes nodes, and its closing line is endNodes + endClosers. */
  endNodes: number;
  endClosers: number;
  /** Its container's start byte (-1: the top level). */
  parent: number;
}

export class HugeIndex {
  /** Checkpoints. */
  n = 0;
  pos = new Float64Array(1024);
  st = new Uint8Array(1024);
  depth = new Int32Array(1024);
  /** First frame it holds (the ones below are the previous checkpoint's). */
  from = new Int32Array(1024);
  /** Where frame `from` is in `frames` (FW numbers per frame). */
  fr = new Int32Array(1024);
  nodes = new Float64Array(1024);
  closers = new Float64Array(1024);
  lines = new Float64Array(1024);
  u16 = new Float64Array(1024);
  lineU16 = new Float64Array(1024);
  top = new Float64Array(1024);
  deepest = new Float64Array(1024);
  frames = new Float64Array(FW * 1024);
  nf = 0;
  /** Directory records (DW numbers each) in the order they closed; `sorted` by start when asked. */
  dir = new Float64Array(DW * 256);
  nd = 0;
  private sortedAt = -1;
  private order = new Int32Array(0);
  private starts = new Float64Array(0);

  constructor() {
    // Checkpoint 0: before anything.
    this.addState({ pos: 0, state: S_VALUE, nodes: 0, closers: 0, lines: 0, u16: 0, lineU16: 0, top: 0, deepest: 0, frames: [] });
  }

  private room(k: number) {
    if (k < this.pos.length) return;
    const n = k + 1;
    this.pos = grow(this.pos, n);
    this.st = grow(this.st, n);
    this.depth = grow(this.depth, n);
    this.from = grow(this.from, n);
    this.fr = grow(this.fr, n);
    this.nodes = grow(this.nodes, n);
    this.closers = grow(this.closers, n);
    this.lines = grow(this.lines, n);
    this.u16 = grow(this.u16, n);
    this.lineU16 = grow(this.lineU16, n);
    this.top = grow(this.top, n);
    this.deepest = grow(this.deepest, n);
  }

  private addState(s: State) {
    const k = this.n++;
    this.room(k);
    this.pos[k] = s.pos;
    this.st[k] = s.state;
    this.depth[k] = s.frames.length;
    this.from[k] = 0;
    this.fr[k] = this.nf;
    this.nodes[k] = s.nodes;
    this.closers[k] = s.closers;
    this.lines[k] = s.lines;
    this.u16[k] = s.u16;
    this.lineU16[k] = s.lineU16;
    this.top[k] = s.top;
    this.deepest[k] = s.deepest;
    this.frames = grow(this.frames, (this.nf + s.frames.length) * FW);
    for (const f of s.frames) {
      const o = this.nf++ * FW;
      this.frames.set([f.kind, f.count, f.start, f.key, f.nodes, f.closers], o);
    }
  }

  /** Takes the checkpoints in `a` (skeleton output). */
  addCheckpoints(a: Float64Array) {
    for (let at = 0; at < a.length; ) {
      const depth = a[at + 2];
      const from = firstFrame(depth, a[at + 3]);
      const own = depth - from;
      const k = this.n++;
      this.room(k);
      this.pos[k] = a[at];
      this.st[k] = a[at + 1];
      this.depth[k] = depth;
      this.from[k] = from;
      this.fr[k] = this.nf;
      this.nodes[k] = a[at + 4];
      this.closers[k] = a[at + 5];
      this.lines[k] = a[at + 6];
      this.u16[k] = a[at + 7];
      this.lineU16[k] = a[at + 8];
      this.top[k] = a[at + 9];
      this.deepest[k] = a[at + 10];
      this.frames = grow(this.frames, (this.nf + own) * FW);
      this.frames.set(a.subarray(at + HW, at + HW + own * FW), this.nf * FW);
      this.nf += own;
      at += HW + own * FW;
    }
  }

  /** Takes the directory records in `a`. */
  addBig(a: Float64Array) {
    if (!a.length) return;
    this.dir = grow(this.dir, this.nd * DW + a.length);
    this.dir.set(a, this.nd * DW);
    this.nd += a.length / DW;
  }

  /** Where frame `d` of checkpoint `k` is in `frames`. */
  frame(k: number, d: number): number {
    while (d < this.from[k]) k--;
    return (this.fr[k] + d - this.from[k]) * FW;
  }

  /** Checkpoint `k`'s state. */
  state(k: number): State {
    const depth = this.depth[k];
    const frames: Frame[] = new Array(depth);
    const F = this.frames;
    for (let d = 0; d < depth; d++) {
      const o = this.frame(k, d);
      frames[d] = { kind: F[o], count: F[o + 1], start: F[o + 2], key: F[o + 3], nodes: F[o + 4], closers: F[o + 5] };
    }
    return {
      pos: this.pos[k],
      state: this.st[k],
      nodes: this.nodes[k],
      closers: this.closers[k],
      lines: this.lines[k],
      u16: this.u16[k],
      lineU16: this.lineU16[k],
      top: this.top[k],
      deepest: this.deepest[k],
      frames,
    };
  }

  /** The last checkpoint at or before byte `pos` (0 if none). */
  at(pos: number): number {
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.pos[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The last checkpoint whose `arr` value is at most `v` (`arr` grows with the checkpoints). */
  lastAtMost(arr: Float64Array, v: number, lo = 0, hi = this.n - 1): number {
    if (arr[lo] > v) return lo - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (arr[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Pretty line of checkpoint `k` (before JSON Lines' opening line). */
  pretty(k: number): number {
    return this.nodes[k] + this.closers[k];
  }

  // ── The directory ──

  private sort() {
    if (this.sortedAt === this.nd) return;
    const n = this.nd;
    const order = new Int32Array(n);
    for (let k = 0; k < n; k++) order[k] = k;
    const d = this.dir;
    order.sort((a, b) => d[a * DW] - d[b * DW]);
    const starts = new Float64Array(n);
    for (let k = 0; k < n; k++) starts[k] = d[order[k] * DW];
    this.order = order;
    this.starts = starts;
    this.sortedAt = n;
  }

  /** Directory record `k` (in start order). */
  big(k: number): Big {
    this.sort();
    const o = this.order[k] * DW;
    const d = this.dir;
    return { start: d[o], end: d[o + 1], kind: d[o + 2], depth: d[o + 3], count: d[o + 4], nodes: d[o + 5], closers: d[o + 6], endNodes: d[o + 7], endClosers: d[o + 8], parent: d[o + 9] };
  }

  /** Records in the directory. */
  get bigCount(): number {
    return this.nd;
  }

  /** The first record (in start order) starting at `start` or later. */
  bigFrom(start: number): number {
    this.sort();
    const s = this.starts;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (s[mid] < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The record of the value starting at `start`, or null. */
  bigAt(start: number): Big | null {
    const k = this.bigFrom(start);
    return k < this.nd && this.starts[k] === start ? this.big(k) : null;
  }

  /** Bytes the index takes. */
  get bytes(): number {
    return this.pos.length * (8 * 9 + 1 + 4 * 3) + this.frames.byteLength + this.dir.byteLength + this.order.byteLength + this.starts.byteLength;
  }
}
