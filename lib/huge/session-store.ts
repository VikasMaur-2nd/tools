/**
 * An edited huge document kept between visits: its pieces (the document: references to the file, and to the edits'
 * bytes) and its undo history, keyed by the file (name, size, last modified and a fingerprint of its content), in
 * IndexedDB. Reopening the same file offers it back; saving in place, or closing without keeping, clears it.
 *
 * Kept a little at a time, so a keep costs what changed since the last one:
 * - the edits' bytes are chunks, each stored once; a buffer that grows (typed text goes into shared buffers) has
 *   only its new bytes stored, small new ones packed into one chunk a keep (and a buffer's parts merged as they
 *   pile up: O(log n) of them);
 * - the history is in segments of SEG steps, and a keep writes the segments whose steps changed;
 * - the tables (the document's pieces, the buffers' parts, the segments) are in blocks cut where their content
 *   says, so a change rewrites the blocks around it only;
 * - the head (references to the tables' blocks) and a small record of it for the sweep (`meta`) are written each
 *   keep; parts nothing refers to are deleted.
 * Every name a keep writes carries its generation (a random id a Keeper takes when it starts), so two writers
 * never share a chunk, and a generation's head refers to its own chunks only. One tab keeps a file at a time: a
 * Web Lock per session key (`lock`); the sweep never touches a session whose lock another tab holds.
 * Bounded: SESSION_BYTES of edits' bytes a session (past that, the history goes first, then nothing is kept);
 * SESSIONS_BYTES in all and SESSION_AGE (the sweep: the oldest go first).
 */
import { lengthOf, type Piece } from './pieces';
import type { EditOp } from './doc';

/** Edits' bytes a kept session may hold. */
export const SESSION_BYTES = 256 << 20;
/** Edits' bytes all kept sessions may hold together (the sweep: the oldest go first). */
export const SESSIONS_BYTES = 1 << 30;
/** How long a kept session is kept (ms). */
export const SESSION_AGE = 30 * 24 * 3600 * 1000;
/** New bytes smaller than this are packed into one chunk a keep; bigger ones are chunks of their own. */
const PACK = 1 << 16;
/** Steps a segment of a kept history holds (a keep writes the newest again: at most this many steps). */
const SEG = 64;
/** A table block ends after an entry whose hash has these bits set (about 1 in 32), or at this many entries. */
const CUT = 31;
const BLOCK = 512;

/** A kept session's head: what it is, and where its parts are. */
export interface Head {
  version: 3;
  /** The file it was made from: its size (after a byte order mark) and content (fingerprint()). */
  base: number;
  print: string;
  /** Its generation: the prefix of every chunk and segment it refers to. */
  gen: string;
  /**
   * The document's pieces, a table of [buffer, off, len] per piece (buffer -1: the file), in blocks: [block, numbers]
   * per block (parts `<gen>.p<block>`). Blocks end where their content says (Keeper: a change rewrites its own).
   */
  pieces: Float64Array;
  /** Its edit buffers, a table of [id, bytes, parts, (chunk, start, len) per part] per buffer, in blocks (`<gen>.b<block>`). */
  bufs: Float64Array;
  /**
   * Its history's segments, a table of [segment, first step, steps] per segment, in order (steps numbered from the
   * first ever; parts `<gen>.s<segment>`), in blocks (`<gen>.g<block>`).
   */
  segs: Float64Array;
  /** Steps kept, of them applied, and applied ones not kept (let go of by the history, or not kept for room). */
  steps: number;
  applied: number;
  dropped: number;
  /** Bytes of its chunks, and when it was kept (ms since 1970). */
  bytes: number;
  time: number;
}

/** What the sweep and the offer need of a session, apart from it. */
export interface Meta {
  key: string;
  time: number;
  bytes: number;
}

/** A Web Lock held on a session key (one tab keeps a file at a time). */
export interface SessionLock {
  release(): void;
}

/** Where sessions are kept: IndexedDB in browsers, memory in tests. */
export interface SessionStore {
  /**
   * `key`'s lock, if no other tab holds it (null: one does). `wait`: wait for it instead (null if aborted). A store
   * where no other tab can be keeps no lock (always held).
   */
  lock(key: string, wait?: AbortSignal): Promise<SessionLock | null>;
  /** The head kept for `key` (null: none). */
  get(key: string): Promise<Head | null>;
  /**
   * Keeps `head` for `key` (and its meta) with parts `add` (name → data, names from `head.gen`) and without parts
   * `drop`, at once. `clean`: also without any other generation's parts but `spare`'s (a generation's first keep).
   */
  put(key: string, head: Head, add: [string, Uint8Array | Float64Array][], drop: string[], clean?: boolean, spare?: string): Promise<void>;
  /** Parts `names` of `key`'s session. */
  parts(key: string, names: string[]): Promise<Map<string, Uint8Array | Float64Array>>;
  /** Moves `key`'s head to its set-aside slot (`back`: from it), its parts where they are; the head moved. */
  aside(key: string, back?: boolean): Promise<Head | null>;
  /** `key`'s session: all of it, its set-aside one ('aside'), or its own ('current'), with their parts. */
  delete(key: string, which?: 'all' | 'aside' | 'current'): Promise<void>;
  /** Every session's (and set-aside one's) meta (for the sweep: nothing else is read). */
  list(): Promise<Meta[]>;
}

/** A file's key: its name, size, last modified time and content (the same file reopened has the same). */
export const sessionKey = (name: string, size: number, lastModified: number, print = '') => `${name}\u0000${size}\u0000${lastModified}\u0000${print}`;
/** The set-aside slot of `key` (C5: a session put aside on a first edit, until close). */
export const asideKey = (key: string) => `${key}\u0000aside`;
/** The session key a set-aside slot belongs to (itself if not one). */
export const ownerOf = (key: string) => (key.endsWith('\u0000aside') ? key.slice(0, -6) : key);

/** The changes a kept session puts back (what `HugeSession.steps` says). */
export const keptSteps = (h: Head): number => h.applied + h.dropped;

const newGen = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * A file's content, cheaply: its size, its first and last 64 KiB and 32 blocks of 4 KiB between, each hashed on
 * its own (so a session isn't offered, or put back, on another file with the same name, size and time). Residual:
 * a change of the same length outside those bytes, with the time kept, isn't seen (API.md).
 */
export async function fingerprint(file: Blob): Promise<string> {
  const n = file.size;
  const spans: [number, number][] = [[0, Math.min(n, 1 << 16)]];
  for (let k = 1; k <= 32; k++) {
    const at = Math.floor((n * k) / 33);
    spans.push([at, Math.min(n, at + 4096)]);
  }
  spans.push([Math.max(0, n - (1 << 16)), n]);
  // (FNV-1a, two lanes, each span on its own, folded in with its place.)
  let h1 = 0x811c9dc5 ^ n;
  let h2 = 0x5bd1e995 ^ Math.floor(n / 2 ** 32);
  for (const [a, b] of spans) {
    const bytes = new Uint8Array(await file.slice(a, b).arrayBuffer());
    let s1 = 0x811c9dc5;
    let s2 = 0x01000193;
    for (let i = 0; i < bytes.length; i++) {
      s1 = Math.imul(s1 ^ bytes[i], 0x01000193);
      s2 = Math.imul(s2 ^ bytes[i], 0x5bd1e995) ^ (s2 >>> 15);
    }
    h1 = Math.imul(h1 ^ s1 ^ a, 0x01000193);
    h2 = Math.imul(h2 ^ s2 ^ b, 0x5bd1e995) ^ (h2 >>> 13);
  }
  return `${n.toString(36)}.${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

type Step = { ops: readonly EditOp[]; removed: readonly Piece[][] };
/** What says a step changed since kept: itself, its changes and what they took out (typing grows the last). */
const sigOf = (s: { ops: readonly EditOp[]; removed: readonly Piece[][] }): unknown[] => [s.ops, s.ops.length, s.ops[s.ops.length - 1], s.removed, s.removed.length, s.removed[s.removed.length - 1]];
/** A 32-bit hash of numbers [from, to) of `v` (integers below 2^53), from `seed`. */
function hashOf(v: Float64Array, from: number, to: number, seed: number): number {
  let h = seed;
  for (let i = from; i < to; i++) {
    const x = v[i];
    h = Math.imul(h ^ (x >>> 0), 0x01000193);
    h = Math.imul(h ^ Math.floor(x / 4294967296), 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

const sameSig = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A document's keeps for one session key: which bytes of which buffers are stored where, which history segments
 * and table blocks, so each keep writes what's new. Buffers are known by identity (the pieces' `buf`s; edits never change their
 * bytes, typing only adds after what's in them).
 */
export class Keeper {
  /** Its generation (a fresh one at reset: nothing of another is referred to). */
  gen = newGen();
  /** Whether nothing of this generation is stored yet (its first keep cleans the others out). */
  fresh = true;
  private ids = new WeakMap<Uint8Array, number>();
  private nextBuf = 1;
  private nextChunk = 1;
  private nextSeg = 1;
  /** Stored buffers: id → bytes stored from its start, and where ([chunk, start, len] per part). */
  private stored = new Map<number, { len: number; parts: number[] }>();
  private chunkLen = new Map<number, number>();
  /** Stored history segments, by segment number (steps [k * SEG, (k + 1) * SEG)): id, steps, their signatures. */
  private segs = new Map<number, { id: number; from: number; to: number; sig: unknown[][] }>();
  /** Stored table blocks (pieces 'p', buffers 'b'), by their content's hash. */
  private blocks = new Map<string, { name: string; data: Float64Array }[]>();
  private nextBlock = 1;

  /** Starts a new generation: nothing is stored of it. */
  reset() {
    this.gen = newGen();
    this.fresh = true;
    this.ids = new WeakMap();
    this.stored.clear();
    this.chunkLen.clear();
    this.segs.clear();
    this.blocks.clear();
  }

  private id(buf: Uint8Array): number {
    let i = this.ids.get(buf);
    if (i === undefined) this.ids.set(buf, (i = this.nextBuf++));
    return i;
  }

  /**
   * What to keep of a document of `pieces` (from a file of `base` bytes, fingerprint `print`) and its history
   * (`steps`, `applied` of them; `dropped`: applied steps the history has let go of), within `cap` bytes of edit
   * buffers: the head, the parts to add and to drop. Null: the document's own edits don't fit (nothing is kept).
   */
  plan(pieces: readonly Piece[], steps: readonly Step[], applied: number, dropped: number, base: number, print: string, cap = SESSION_BYTES): { head: Head; add: [string, Uint8Array | Float64Array][]; drop: string[] } | null {
    // Buffers used, and how far into each: the document's first, then the history's from the newest step back,
    // as long as they fit.
    const need = new Map<number, { buf: Uint8Array; end: number }>();
    let bytes = 0;
    const take = (ps: readonly Piece[], into: Map<number, { buf: Uint8Array; end: number }>) => {
      for (const p of ps) {
        if (!p.buf) continue;
        const b = this.id(p.buf);
        const was = need.get(b)?.end ?? 0;
        const now = into.get(b);
        const end = Math.max(p.off + p.len, now?.end ?? 0, was);
        into.set(b, { buf: p.buf, end });
      }
    };
    const cost = (m: Map<number, { buf: Uint8Array; end: number }>) => {
      let n = 0;
      for (const [b, v] of m) n += v.end - (need.get(b)?.end ?? 0);
      return n;
    };
    const merge = (m: Map<number, { buf: Uint8Array; end: number }>) => {
      for (const [b, v] of m) need.set(b, v);
    };
    const doc = new Map<number, { buf: Uint8Array; end: number }>();
    take(pieces, doc);
    bytes = cost(doc);
    if (bytes > cap) return null;
    merge(doc);
    let first = steps.length;
    for (let i = steps.length - 1; i >= 0; i--) {
      const more = new Map<number, { buf: Uint8Array; end: number }>();
      for (const o of steps[i].ops) take(o.put, more);
      for (const r of steps[i].removed) take(r, more);
      const n = cost(more);
      if (bytes + n > cap) break;
      bytes += n;
      merge(more);
      first = i;
    }
    const add: [string, Uint8Array | Float64Array][] = [];
    const drop: string[] = [];
    // Buffers no longer used: forgotten (stored again if used again).
    for (const b of [...this.stored.keys()]) if (!need.has(b)) this.stored.delete(b);
    // New bytes: [stored, end) of each buffer. A buffer's parts are kept few: while the one before the newest is
    // no more than twice its size, the two are written again as one (each byte is written O(log n) times, a buffer
    // typed into over many keeps has O(log n) parts). What's written: chunks of their own if big, else packed into
    // one chunk this keep.
    const writes: [number, number, number][] = [];
    for (const [b, v] of need) {
      const s = this.stored.get(b) ?? { len: 0, parts: [] };
      this.stored.set(b, s);
      if (v.end <= s.len) continue;
      let from = s.len;
      while (s.parts.length >= 3) {
        const n = s.parts[s.parts.length - 1];
        if (n > 2 * (v.end - from)) break;
        from -= n;
        s.parts.length -= 3;
      }
      s.len = v.end;
      writes.push([b, from, v.end]);
    }
    const small = writes.filter(([, a, z]) => z - a < PACK);
    for (const [b, a, z] of writes) {
      if (z - a < PACK) continue;
      const c = this.nextChunk++;
      add.push([`${this.gen}.c${c}`, need.get(b)!.buf.slice(a, z)]);
      this.chunkLen.set(c, z - a);
      this.stored.get(b)!.parts.push(c, 0, z - a);
    }
    if (small.length) {
      const c = this.nextChunk++;
      const pack = new Uint8Array(small.reduce((n, [, a, z]) => n + z - a, 0));
      let o = 0;
      for (const [b, a, z] of small) {
        pack.set(need.get(b)!.buf.subarray(a, z), o);
        this.stored.get(b)!.parts.push(c, o, z - a);
        o += z - a;
      }
      add.push([`${this.gen}.c${c}`, pack]);
      this.chunkLen.set(c, pack.length);
    }
    // Chunks nothing refers to any more go.
    const live = new Set<number>();
    for (const s of this.stored.values()) for (let j = 0; j < s.parts.length; j += 3) live.add(s.parts[j]);
    for (const c of [...this.chunkLen.keys()]) {
      if (live.has(c)) continue;
      drop.push(`${this.gen}.c${c}`);
      this.chunkLen.delete(c);
    }
    // History segments: those whose steps changed (or whose range did) written again; the rest as they are.
    const absFirst = dropped + first;
    const absEnd = dropped + steps.length;
    const want = new Set<number>();
    const segs: number[] = [];
    for (let k = Math.floor(absFirst / SEG); k * SEG < absEnd; k++) {
      want.add(k);
      const from = Math.max(k * SEG, absFirst);
      const to = Math.min((k + 1) * SEG, absEnd);
      const sig: unknown[][] = [];
      for (let a = from; a < to; a++) sig.push(sigOf(steps[a - dropped]));
      const was = this.segs.get(k);
      if (!was || was.from !== from || was.to !== to || was.sig.some((x, i) => !sameSig(x, sig[i]))) {
        if (was) drop.push(`${this.gen}.s${was.id}`);
        const id = this.nextSeg++;
        add.push([`${this.gen}.s${id}`, this.encodeSteps(steps.slice(from - dropped, to - dropped))]);
        this.segs.set(k, { id, from, to, sig });
      }
      const s = this.segs.get(k)!;
      segs.push(s.id, s.from, s.to - s.from);
    }
    for (const [k, s] of [...this.segs]) {
      if (want.has(k)) continue;
      drop.push(`${this.gen}.s${s.id}`);
      this.segs.delete(k);
    }
    // The tables: blocks not stored yet written, ones no longer used dropped.
    const used = new Set<string>();
    const bufs: number[] = [];
    const bufEnds: number[] = [];
    for (const [b, s] of this.stored) {
      bufs.push(b, s.len, s.parts.length / 3, ...s.parts);
      bufEnds.push(bufs.length);
    }
    const ps = new Float64Array(pieces.length * 3);
    pieces.forEach((p, j) => {
      ps[j * 3] = p.buf ? this.id(p.buf) : -1;
      ps[j * 3 + 1] = p.off;
      ps[j * 3 + 2] = p.len;
    });
    const pieceRefs = this.table('p', ps, pieces.map((_, j) => j * 3 + 3), add, used);
    const bufRefs = this.table('b', Float64Array.from(bufs), bufEnds, add, used);
    const segRefs = this.table('g', Float64Array.from(segs), Array.from({ length: segs.length / 3 }, (_, j) => j * 3 + 3), add, used);
    for (const [h, list] of [...this.blocks]) {
      const keep = list.filter((x) => used.has(x.name));
      for (const x of list) if (!used.has(x.name)) drop.push(x.name);
      if (keep.length) this.blocks.set(h, keep);
      else this.blocks.delete(h);
    }
    let stored = 0;
    for (const c of live) stored += this.chunkLen.get(c)!;
    const head: Head = {
      version: 3,
      base,
      print,
      gen: this.gen,
      pieces: pieceRefs,
      bufs: bufRefs,
      segs: segRefs,
      steps: steps.length - first,
      applied: Math.max(0, applied - first),
      dropped: dropped + Math.min(first, applied),
      bytes: stored,
      time: Date.now(),
    };
    return { head, add, drop };
  }

  /**
   * A table of numbers (entries ending at `ends`) as blocks: [block, numbers] per block. A block ends after an entry
   * whose hash says so (or at BLOCK entries), so a change in the table moves the blocks around it only, and the
   * rest are found stored by their content. New ones go into `add`; every one used into `used`.
   */
  private table(tag: 'p' | 'b' | 'g', values: Float64Array, ends: readonly number[], add: [string, Uint8Array | Float64Array][], used: Set<string>): Float64Array {
    const refs: number[] = [];
    let start = 0;
    let n = 0;
    for (let e = 0; e < ends.length; e++) {
      const from = e ? ends[e - 1] : 0;
      const end = ends[e];
      n++;
      if (e < ends.length - 1 && n < BLOCK && (hashOf(values, from, end, 0x811c9dc5) & CUT) !== CUT) continue;
      const data = values.subarray(start, end);
      const h = `${tag}${hashOf(values, start, end, 0x811c9dc5).toString(36)}.${hashOf(values, start, end, 0x9e3779b9).toString(36)}`;
      const list = this.blocks.get(h) ?? [];
      let x = list.find((y) => y.data.length === data.length && y.data.every((v, i) => v === data[i]));
      if (!x) {
        const id = this.nextBlock++;
        x = { name: `${this.gen}.${tag}${id}`, data: data.slice() };
        list.push(x);
        this.blocks.set(h, list);
        add.push([x.name, x.data]);
      }
      used.add(x.name);
      refs.push(Number(x.name.slice(x.name.lastIndexOf('.') + 2)), data.length);
      start = end;
      n = 0;
    }
    return Float64Array.from(refs);
  }

  /** The table a head's blocks (`refs`) make, from their parts. Throws if one is missing or not its length. */
  private untable(tag: 'p' | 'b' | 'g', gen: string, refs: Float64Array, parts: Map<string, Uint8Array | Float64Array>): Float64Array {
    let n = 0;
    for (let j = 1; j < refs.length; j += 2) n += refs[j];
    const out = new Float64Array(n);
    let o = 0;
    for (let j = 0; j < refs.length; j += 2) {
      const name = `${gen}.${tag}${refs[j]}`;
      const data = parts.get(name);
      if (!(data instanceof Float64Array) || data.length !== refs[j + 1]) throw new Error('Not allowed');
      out.set(data, o);
      o += data.length;
      const h = `${tag}${hashOf(data, 0, data.length, 0x811c9dc5).toString(36)}.${hashOf(data, 0, data.length, 0x9e3779b9).toString(36)}`;
      const list = this.blocks.get(h) ?? [];
      if (!list.some((x) => x.name === name)) list.push({ name, data });
      this.blocks.set(h, list);
      this.nextBlock = Math.max(this.nextBlock, refs[j] + 1);
    }
    return out;
  }

  /** Steps as numbers: per step [changes, per change (a, b, put's refs, removed's refs)]; refs as `refs()`. */
  private encodeSteps(steps: readonly Step[]): Float64Array {
    const out: number[] = [steps.length];
    const refs = (ps: readonly Piece[]) => {
      out.push(ps.length);
      for (const p of ps) out.push(p.buf ? this.id(p.buf) : -1, p.off, p.len);
    };
    for (const s of steps) {
      out.push(s.ops.length);
      s.ops.forEach((o, i) => {
        out.push(o.a, o.b);
        refs(o.put);
        refs(s.removed[i] ?? []);
      });
    }
    return Float64Array.from(out);
  }

  /**
   * A kept session put back: its pieces and history (its steps' places in `steps`, `applied`, `dropped`), its parts
   * read with `parts` (store.parts: its tables first, then the chunks and segments they name), this Keeper going on
   * in its generation with its parts known as stored (the next keep writes what's new). Throws 'Not allowed' if a
   * part is missing or not the length it should be.
   */
  async load(head: Head, parts: (names: string[]) => Promise<Map<string, Uint8Array | Float64Array>>): Promise<{ pieces: Piece[]; steps: { ops: EditOp[]; removed: Piece[][] }[] }> {
    this.reset();
    this.gen = head.gen;
    this.fresh = false;
    const names = (tag: string, refs: Float64Array) => Array.from({ length: refs.length / 2 }, (_, j) => `${head.gen}.${tag}${refs[j * 2]}`);
    const tables = await parts([...names('p', head.pieces), ...names('b', head.bufs), ...names('g', head.segs)]);
    const pieceTable = this.untable('p', head.gen, head.pieces, tables);
    const bufTable = this.untable('b', head.gen, head.bufs, tables);
    const segTable = this.untable('g', head.gen, head.segs, tables);
    if (segTable.length % 3) throw new Error('Not allowed');
    const want = new Set<string>();
    for (let j = 0; j < bufTable.length; ) {
      const n = bufTable[j + 2];
      for (let k = 0; k < n; k++) want.add(`${head.gen}.c${bufTable[j + 3 + k * 3]}`);
      j += 3 + n * 3;
    }
    for (let j = 0; j < segTable.length; j += 3) want.add(`${head.gen}.s${segTable[j]}`);
    const got = await parts([...want]);
    const bufs = new Map<number, Uint8Array>();
    for (let j = 0; j < bufTable.length; ) {
      const [b, len, n] = [bufTable[j], bufTable[j + 1], bufTable[j + 2]];
      if (!(j + 3 + n * 3 <= bufTable.length)) throw new Error('Not allowed');
      const buf = new Uint8Array(len);
      const ps: number[] = [];
      let o = 0;
      for (let k = 0; k < n; k++) {
        const [c, start, l] = [bufTable[j + 3 + k * 3], bufTable[j + 4 + k * 3], bufTable[j + 5 + k * 3]];
        const chunk = got.get(`${head.gen}.c${c}`);
        if (!(chunk instanceof Uint8Array) || start + l > chunk.length || o + l > len) throw new Error('Not allowed');
        buf.set(chunk.subarray(start, start + l), o);
        o += l;
        ps.push(c, start, l);
        this.chunkLen.set(c, chunk.length);
        this.nextChunk = Math.max(this.nextChunk, c + 1);
      }
      if (o !== len) throw new Error('Not allowed');
      bufs.set(b, buf);
      this.ids.set(buf, b);
      this.stored.set(b, { len, parts: ps });
      this.nextBuf = Math.max(this.nextBuf, b + 1);
      j += 3 + n * 3;
    }
    const piece = (b: number, off: number, len: number): Piece => {
      if (b < 0) return { buf: null, off, len };
      const buf = bufs.get(b);
      if (!buf || off + len > buf.length) throw new Error('Not allowed');
      return { buf, off, len };
    };
    const pieces: Piece[] = [];
    if (pieceTable.length % 3) throw new Error('Not allowed');
    for (let j = 0; j < pieceTable.length; j += 3) pieces.push(piece(pieceTable[j], pieceTable[j + 1], pieceTable[j + 2]));
    const steps: { ops: EditOp[]; removed: Piece[][] }[] = [];
    for (let j = 0; j < segTable.length; j += 3) {
      const [id, from, count] = [segTable[j], segTable[j + 1], segTable[j + 2]];
      const seg = got.get(`${head.gen}.s${id}`);
      if (!(seg instanceof Float64Array) || seg[0] !== count) throw new Error('Not allowed');
      const first = steps.length;
      this.nextSeg = Math.max(this.nextSeg, id + 1);
      let o = 1;
      const refs = () => {
        const out: Piece[] = [];
        const n = seg[o++];
        for (let k = 0; k < n; k++, o += 3) out.push(piece(seg[o], seg[o + 1], seg[o + 2]));
        return out;
      };
      for (let s = 0; s < seg[0]; s++) {
        const ops: EditOp[] = [];
        const removed: Piece[][] = [];
        const n = seg[o++];
        for (let c = 0; c < n; c++) {
          const a = seg[o++];
          const b = seg[o++];
          ops.push({ a, b, put: refs() });
          removed.push(refs());
        }
        steps.push({ ops, removed });
      }
      if (o !== seg.length) throw new Error('Not allowed');
      // (Known as stored: the history put back keeps these steps' arrays, so the next keep finds them unchanged.)
      this.segs.set(Math.floor(from / SEG), { id, from, to: from + count, sig: steps.slice(first).map(sigOf) });
    }
    if (steps.length !== head.steps) throw new Error('Not allowed');
    return { pieces, steps };
  }
}

/**
 * Changes that make the file (`base` bytes) the document of `pieces`: in order, each at the document as the
 * ones before leave it. Runs of the file in order are kept; the rest replaces what's between them.
 */
export function opsOf(pieces: readonly Piece[], base: number): EditOp[] {
  const ops: EditOp[] = [];
  // The file's next byte not yet matched, where it is in the document, and the run of pieces replacing it.
  let bc = 0;
  let shift = 0;
  let run: Piece[] = [];
  const flush = (to: number) => {
    if (!run.length && to === bc) return;
    const a = bc + shift;
    ops.push({ a, b: a + (to - bc), put: run });
    shift += lengthOf(run) - (to - bc);
    run = [];
    bc = to;
  };
  for (const p of pieces) {
    if (!p.buf && p.off >= bc) {
      // (The file again, from `p.off`: what's between was replaced by the run.)
      flush(p.off);
      bc = p.off + p.len;
    } else run.push(p);
  }
  flush(base);
  return ops;
}

/**
 * Which sessions to let go of (`now`): those older than SESSION_AGE, then the oldest while they hold more than
 * SESSIONS_BYTES together. `keep`: never these (the open document's, its set-aside one). (Sessions another tab
 * has open the caller skips: their locks.)
 */
export function sweepOf(all: Meta[], now: number, keep: readonly string[] = [], age = SESSION_AGE, total = SESSIONS_BYTES): string[] {
  const out: string[] = [];
  const rest = all.filter((s) => {
    if (!keep.includes(s.key) && now - s.time > age) {
      out.push(s.key);
      return false;
    }
    return true;
  });
  let sum = rest.reduce((n, s) => n + s.bytes, 0);
  for (const s of rest.sort((a, b) => a.time - b.time)) {
    if (sum <= total) break;
    if (keep.includes(s.key)) continue;
    out.push(s.key);
    sum -= s.bytes;
  }
  return out;
}

const partKey = (key: string, name: string) => `${key}\u0000${name}`;
const genOf = (name: string) => name.slice(0, name.indexOf('.'));

/** Web Locks (in windows and workers), if there are any. */
const webLocks = (): { request(name: string, opts: object, f: (lock: unknown) => unknown): Promise<unknown> } | null => (globalThis as unknown as { navigator?: { locks?: never } }).navigator?.locks ?? null;

/** Sessions in IndexedDB: heads in `heads`, their meta in `meta`, chunks and history segments in `parts`. */
export class IdbSessionStore implements SessionStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly name = 'tk-huge-sessions') {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((done, fail) => {
      const r = indexedDB.open(this.name, 3);
      r.onupgradeneeded = () => {
        const db = r.result;
        // (Versions 1 and 2 kept whole records: dropped.)
        for (const s of Array.from(db.objectStoreNames)) db.deleteObjectStore(s);
        db.createObjectStore('heads');
        db.createObjectStore('meta');
        db.createObjectStore('parts');
      };
      r.onsuccess = () => done(r.result);
      r.onerror = () => fail(new Error('Store failed'));
    }));
  }

  /** Runs `f` in one transaction over the stores; resolves when it commits. */
  private async tx<T>(mode: IDBTransactionMode, f: (h: IDBObjectStore, m: IDBObjectStore, p: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((done, fail) => {
      const t = db.transaction(['heads', 'meta', 'parts'], mode);
      const r = f(t.objectStore('heads'), t.objectStore('meta'), t.objectStore('parts'));
      t.oncomplete = () => done(r ? r.result : undefined);
      t.onerror = t.onabort = () => fail(new Error('Store failed'));
    });
  }

  lock(key: string, wait?: AbortSignal): Promise<SessionLock | null> {
    const locks = webLocks();
    if (!locks) return Promise.resolve({ release() {} });
    return new Promise((done) => {
      let release = () => {};
      const held = new Promise<void>((r) => (release = r));
      locks
        .request(`tk-huge:${key}`, wait ? { signal: wait } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            done(null);
            return;
          }
          done({ release });
          return held;
        })
        .catch(() => done(null));
    });
  }

  async get(key: string): Promise<Head | null> {
    const v = (await this.tx('readonly', (h) => h.get(key))) as Head | undefined;
    return v && v.version === 3 ? v : null;
  }

  async put(key: string, head: Head, add: [string, Uint8Array | Float64Array][], drop: string[], clean = false, spare = ''): Promise<void> {
    await this.tx('readwrite', (h, m, p) => {
      for (const [name, data] of add) p.put(data, partKey(key, name));
      for (const name of drop) p.delete(partKey(key, name));
      h.put(head, key);
      m.put({ key, time: head.time, bytes: head.bytes } satisfies Meta, key);
      if (!clean) return;
      // (Another generation's parts: gone, but the set-aside one's.)
      const r = p.openKeyCursor(IDBKeyRange.bound(`${key}\u0000`, `${key}\u0000\uffff`));
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return;
        const g = genOf(String(cur.key).slice(key.length + 1));
        if (g !== head.gen && g !== spare) p.delete(cur.key);
        cur.continue();
      };
    });
  }

  async parts(key: string, names: string[]): Promise<Map<string, Uint8Array | Float64Array>> {
    const out = new Map<string, Uint8Array | Float64Array>();
    await this.tx('readonly', (_h, _m, p) => {
      for (const name of names) {
        const r = p.get(partKey(key, name));
        r.onsuccess = () => r.result && out.set(name, r.result as Uint8Array | Float64Array);
      }
    });
    return out;
  }

  async aside(key: string, back = false): Promise<Head | null> {
    const [from, to] = back ? [asideKey(key), key] : [key, asideKey(key)];
    let moved: Head | null = null;
    await this.tx('readwrite', (h, m) => {
      const r = h.get(from);
      r.onsuccess = () => {
        const v = r.result as Head | undefined;
        if (!v) return;
        moved = v;
        h.put(v, to);
        h.delete(from);
        m.put({ key: to, time: v.time, bytes: v.bytes } satisfies Meta, to);
        m.delete(from);
      };
    });
    return moved;
  }

  async delete(key: string, which: 'all' | 'aside' | 'current' = 'all'): Promise<void> {
    await this.tx('readwrite', (h, m, p) => {
      const slots = which === 'all' ? [key, asideKey(key)] : which === 'aside' ? [asideKey(key)] : [key];
      const other = which === 'all' ? null : which === 'aside' ? key : asideKey(key);
      // (The other slot's generation is spared.)
      const spare = other ? h.get(other) : null;
      const gens = new Set<string>();
      let left = slots.length;
      const sweep = () => {
        const keepGen = (spare?.result as Head | undefined)?.gen;
        // (Nothing in the slots: no parts to look for.)
        if (which !== 'all' && !gens.size) return;
        const r = p.openKeyCursor(IDBKeyRange.bound(`${key}\u0000`, `${key}\u0000\uffff`));
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur) return;
          const name = String(cur.key).slice(key.length + 1);
          const g = genOf(name);
          if (which === 'all' || (gens.has(g) && g !== keepGen)) p.delete(cur.key);
          cur.continue();
        };
      };
      for (const s of slots) {
        const r = h.get(s);
        r.onsuccess = () => {
          const v = r.result as Head | undefined;
          if (v) gens.add(v.gen);
          h.delete(s);
          m.delete(s);
          if (--left === 0) sweep();
        };
      }
    });
  }

  async list(): Promise<Meta[]> {
    return ((await this.tx('readonly', (_h, m) => m.getAll())) as Meta[] | undefined) ?? [];
  }
}

/** Sessions in memory, structured-cloned as IndexedDB keeps them, with locks shared by the tabs using it (tests). */
export class MemorySessionStore implements SessionStore {
  readonly heads = new Map<string, Head>();
  readonly meta = new Map<string, Meta>();
  readonly partMap = new Map<string, Uint8Array | Float64Array>();
  /** Bytes and values cloned into it so far (tests: what keeps cost). */
  written = 0;
  /** Locks held: per key, the tabs waiting for it. */
  private held = new Map<string, (() => void)[]>();

  lock(key: string, wait?: AbortSignal): Promise<SessionLock | null> {
    const grant = (): SessionLock => {
      let done = false;
      return {
        release: () => {
          if (done) return;
          done = true;
          const q = this.held.get(key)!;
          const next = q.shift();
          if (next) next();
          else this.held.delete(key);
        },
      };
    };
    if (!this.held.has(key)) {
      this.held.set(key, []);
      return Promise.resolve(grant());
    }
    if (!wait) return Promise.resolve(null);
    return new Promise((done) => {
      const q = this.held.get(key)!;
      const go = () => done(grant());
      q.push(go);
      wait.addEventListener(
        'abort',
        () => {
          const i = q.indexOf(go);
          if (i < 0) return;
          q.splice(i, 1);
          done(null);
        },
        { once: true },
      );
    });
  }

  async get(key: string): Promise<Head | null> {
    const v = this.heads.get(key);
    return v ? structuredClone(v) : null;
  }

  async put(key: string, head: Head, add: [string, Uint8Array | Float64Array][], drop: string[], clean = false, spare = ''): Promise<void> {
    for (const [name, data] of add) {
      this.partMap.set(partKey(key, name), structuredClone(data));
      this.written += data.byteLength;
    }
    for (const name of drop) this.partMap.delete(partKey(key, name));
    this.heads.set(key, structuredClone(head));
    this.written += head.pieces.byteLength + head.bufs.byteLength + head.segs.byteLength;
    this.meta.set(key, { key, time: head.time, bytes: head.bytes });
    if (clean) {
      for (const k of [...this.partMap.keys()]) {
        if (!k.startsWith(`${key}\u0000`)) continue;
        const g = genOf(k.slice(key.length + 1));
        if (g !== head.gen && g !== spare) this.partMap.delete(k);
      }
    }
  }

  async parts(key: string, names: string[]): Promise<Map<string, Uint8Array | Float64Array>> {
    const out = new Map<string, Uint8Array | Float64Array>();
    for (const name of names) {
      const v = this.partMap.get(partKey(key, name));
      if (v) out.set(name, structuredClone(v));
    }
    return out;
  }

  async aside(key: string, back = false): Promise<Head | null> {
    const [from, to] = back ? [asideKey(key), key] : [key, asideKey(key)];
    const v = this.heads.get(from);
    if (!v) return null;
    this.heads.set(to, v);
    this.heads.delete(from);
    this.meta.set(to, { key: to, time: v.time, bytes: v.bytes });
    this.meta.delete(from);
    return structuredClone(v);
  }

  async delete(key: string, which: 'all' | 'aside' | 'current' = 'all'): Promise<void> {
    const slots = which === 'all' ? [key, asideKey(key)] : which === 'aside' ? [asideKey(key)] : [key];
    const other = which === 'all' ? null : which === 'aside' ? key : asideKey(key);
    const keepGen = other ? this.heads.get(other)?.gen : undefined;
    const gens = new Set<string>();
    for (const s of slots) {
      const v = this.heads.get(s);
      if (v) gens.add(v.gen);
      this.heads.delete(s);
      this.meta.delete(s);
    }
    for (const k of [...this.partMap.keys()]) {
      if (!k.startsWith(`${key}\u0000`)) continue;
      const g = genOf(k.slice(key.length + 1));
      if (which === 'all' || (gens.has(g) && g !== keepGen)) this.partMap.delete(k);
    }
  }

  async list(): Promise<Meta[]> {
    return [...this.meta.values()].map((m) => ({ ...m }));
  }
}
