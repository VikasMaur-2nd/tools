/**
 * An edited huge document kept between visits: its pieces (the document: references to the file, and to the edits'
 * bytes) and its undo history, keyed by the file (name, size, last modified) and checked against its content (a
 * fingerprint), in IndexedDB. Reopening the same file offers it back; saving in place, or closing without keeping,
 * clears it.
 *
 * Kept a little at a time: the edits' bytes are chunks, each stored once (small new ones packed into one chunk a
 * keep, bigger ones a chunk each); a keep writes the new chunks and the record (references only), and deletes the
 * chunks nothing refers to any more. So typing after a 200 MiB paste writes a few bytes a pause, not 200 MiB.
 * Bounded: SESSION_BYTES of edits' bytes a session (past that, the history goes first, then nothing is kept);
 * SESSIONS_BYTES in all and SESSION_AGE (sweep: the oldest go first).
 */
import { lengthOf, type Piece } from './pieces';
import type { EditOp } from './doc';

/** Edits' bytes a kept session may hold. */
export const SESSION_BYTES = 256 << 20;
/** Edits' bytes all kept sessions may hold together (sweep: the oldest go first). */
export const SESSIONS_BYTES = 1 << 30;
/** How long a kept session is kept (ms). */
export const SESSION_AGE = 30 * 24 * 3600 * 1000;
/** New edit buffers smaller than this are packed into one chunk a keep; bigger ones are chunks of their own. */
const PACK = 1 << 16;

/** A piece as kept: the file's bytes [off, off + len), or bytes [off, off + len) of edit buffer `b`. */
export type PieceRef = { off: number; len: number } | { b: number; off: number; len: number };

export interface KeptStep {
  ops: { a: number; b: number; put: PieceRef[] }[];
  removed: PieceRef[][];
}

export interface Kept {
  version: 2;
  /** The file it was made from: its size (after a byte order mark) and content (fingerprint()). */
  base: number;
  print: string;
  /** The document. */
  pieces: PieceRef[];
  /** Its undo history (steps[0, applied) applied); empty if it didn't fit. */
  steps: KeptStep[];
  applied: number;
  /** Applied steps not in `steps` (let go of by the history, or not kept): still in the document. */
  dropped: number;
  /** Where its edit buffers are: [buffer, chunk, start in the chunk, length] for each. */
  bufs: number[];
  /** Bytes of its chunks, and when it was kept (ms since 1970). */
  bytes: number;
  time: number;
}

/** Where sessions are kept: IndexedDB in browsers, memory in tests. */
export interface SessionStore {
  /** The record kept for `key` (null: none). */
  get(key: string): Promise<Kept | null>;
  /** Keeps `kept` for `key` with chunks `add` (new) and without chunks `drop` (no longer used), at once. */
  put(key: string, kept: Kept, add: [number, Uint8Array][], drop: number[]): Promise<void>;
  /** Chunks `ids` of `key`'s session. */
  chunks(key: string, ids: number[]): Promise<Map<number, Uint8Array>>;
  /** `key`'s record and chunks. */
  delete(key: string): Promise<void>;
  /** Every record's key, time and bytes (for the sweep). */
  list(): Promise<{ key: string; time: number; bytes: number }[]>;
}

/** A file's key: its name, size and last modified time (the same file reopened has the same). */
export const sessionKey = (name: string, size: number, lastModified: number) => `${name}\u0000${size}\u0000${lastModified}`;

/** The changes a kept session puts back (what `HugeSession.steps` says). */
export const keptSteps = (k: Kept): number => k.applied + k.dropped;

/**
 * A file's content, cheaply: its size and a hash of its first and last 64 KiB and of 6 blocks of 4 KiB between, so
 * a session isn't offered (or put back) on another file with the same name, size and time (a copy that kept them).
 */
export async function fingerprint(file: Blob): Promise<string> {
  const n = file.size;
  const spans: [number, number][] = [[0, Math.min(n, 1 << 16)]];
  for (let k = 1; k <= 6; k++) {
    const at = Math.floor((n * k) / 7);
    spans.push([at, Math.min(n, at + 4096)]);
  }
  spans.push([Math.max(0, n - (1 << 16)), n]);
  // (FNV-1a, two seeds: 64 bits.)
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (const [a, b] of spans) {
    const bytes = new Uint8Array(await file.slice(a, b).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
      h2 = Math.imul(h2 ^ bytes[i], 0x01000193) ^ (h2 >>> 13);
    }
  }
  return `${n.toString(36)}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/**
 * A document's keeps for one session key: which edit buffers are stored, in which chunks, so each keep writes only
 * what's new. Buffers are known by identity (the pieces' `buf`s, which edits never change).
 */
export class Keeper {
  private ids = new WeakMap<Uint8Array, number>();
  private nextBuf = 1;
  private nextChunk = 1;
  /** Stored buffers: id → [chunk, start, length]; stored chunks: id → bytes. */
  private at = new Map<number, [number, number, number]>();
  private chunkLen = new Map<number, number>();

  /** The key's record and chunks are gone: start over. */
  reset() {
    this.ids = new WeakMap();
    this.at.clear();
    this.chunkLen.clear();
  }

  private id(buf: Uint8Array): number {
    let i = this.ids.get(buf);
    if (i === undefined) this.ids.set(buf, (i = this.nextBuf++));
    return i;
  }

  /**
   * What to keep of a document of `pieces` (from a file of `base` bytes with fingerprint `print`) and its history,
   * within `cap` bytes of edit buffers: the record, the new chunks, the chunks no longer used. Null: the document's
   * own edits' bytes don't fit (then nothing is kept). `dropped`: applied steps the history has let go of already.
   */
  plan(
    pieces: readonly Piece[],
    steps: readonly { ops: readonly EditOp[]; removed: readonly Piece[][] }[],
    applied: number,
    dropped: number,
    base: number,
    print: string,
    cap = SESSION_BYTES,
  ): { kept: Kept; add: [number, Uint8Array][]; drop: number[] } | null {
    const used = new Map<number, Uint8Array>();
    let bytes = 0;
    // (References to `ps`, and the bytes of buffers they add; counted in only if `take`.)
    const refs = (ps: readonly Piece[], fresh: Map<number, Uint8Array>): PieceRef[] =>
      ps.map((p) => {
        if (!p.buf) return { off: p.off, len: p.len };
        const b = this.id(p.buf);
        if (!used.has(b)) fresh.set(b, p.buf);
        return { b, off: p.off, len: p.len };
      });
    const size = (m: Map<number, Uint8Array>) => {
      let n = 0;
      for (const v of m.values()) n += v.length;
      return n;
    };
    const fresh = new Map<number, Uint8Array>();
    const doc = refs(pieces, fresh);
    bytes = size(fresh);
    if (bytes > cap) return null;
    for (const [b, v] of fresh) used.set(b, v);
    // The history from the newest step back, as long as it fits (undo then stops where it starts).
    const kept: KeptStep[] = [];
    let first = steps.length;
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      const more = new Map<number, Uint8Array>();
      const k: KeptStep = { ops: s.ops.map((o) => ({ a: o.a, b: o.b, put: refs(o.put, more) })), removed: s.removed.map((ps) => refs(ps, more)) };
      const n = size(more);
      if (bytes + n > cap) break;
      bytes += n;
      for (const [b, v] of more) used.set(b, v);
      kept.unshift(k);
      first = i;
    }
    // New buffers into chunks: small ones packed together, bigger ones each its own (a view copied: a clone of a
    // view would take its whole buffer).
    const add: [number, Uint8Array][] = [];
    const small: [number, Uint8Array][] = [];
    for (const [b, v] of used) {
      if (this.at.has(b)) continue;
      if (v.length < PACK) {
        small.push([b, v]);
        continue;
      }
      const c = this.nextChunk++;
      const whole = v.byteOffset === 0 && v.byteLength === v.buffer.byteLength ? v : v.slice();
      add.push([c, whole]);
      this.at.set(b, [c, 0, v.length]);
      this.chunkLen.set(c, v.length);
    }
    if (small.length) {
      const c = this.nextChunk++;
      const pack = new Uint8Array(small.reduce((n, [, v]) => n + v.length, 0));
      let o = 0;
      for (const [b, v] of small) {
        pack.set(v, o);
        this.at.set(b, [c, o, v.length]);
        o += v.length;
      }
      add.push([c, pack]);
      this.chunkLen.set(c, pack.length);
    }
    // Chunks nothing refers to any more go.
    const live = new Set<number>();
    for (const b of used.keys()) live.add(this.at.get(b)![0]);
    const drop: number[] = [];
    for (const c of [...this.chunkLen.keys()]) {
      if (live.has(c)) continue;
      drop.push(c);
      this.chunkLen.delete(c);
    }
    for (const [b, w] of [...this.at]) if (!live.has(w[0])) this.at.delete(b);
    const bufs: number[] = [];
    for (const b of used.keys()) bufs.push(b, ...this.at.get(b)!);
    let stored = 0;
    for (const c of live) stored += this.chunkLen.get(c)!;
    // (Steps before `first` aren't kept: if some applied ones aren't, undo can't go back past them.)
    const record: Kept = { version: 2, base, print, pieces: doc, steps: kept, applied: Math.max(0, applied - first), dropped: dropped + Math.min(first, applied), bufs, bytes: stored, time: Date.now() };
    return { kept: record, add, drop };
  }

  /** The chunks `kept` needs (store.chunks). */
  chunksOf(kept: Kept): number[] {
    const out = new Set<number>();
    for (let j = 0; j < kept.bufs.length; j += 4) out.add(kept.bufs[j + 1]);
    return [...out];
  }

  /** A kept session put back: its pieces and history, its buffers known as stored (the next keep adds only what's new). */
  load(kept: Kept, chunks: Map<number, Uint8Array>): { pieces: Piece[]; steps: { ops: EditOp[]; removed: Piece[][] }[] } {
    this.reset();
    const bufs = new Map<number, Uint8Array>();
    for (let j = 0; j < kept.bufs.length; j += 4) {
      const [b, c, start, len] = [kept.bufs[j], kept.bufs[j + 1], kept.bufs[j + 2], kept.bufs[j + 3]];
      const chunk = chunks.get(c);
      if (!chunk) throw new Error('Not ready');
      const v = chunk.subarray(start, start + len);
      bufs.set(b, v);
      this.ids.set(v, b);
      this.at.set(b, [c, start, len]);
      this.chunkLen.set(c, chunk.length);
      this.nextBuf = Math.max(this.nextBuf, b + 1);
      this.nextChunk = Math.max(this.nextChunk, c + 1);
    }
    const piece = (r: PieceRef): Piece => ('b' in r ? { buf: bufs.get(r.b)!, off: r.off, len: r.len } : { buf: null, off: r.off, len: r.len });
    return {
      pieces: kept.pieces.map(piece),
      steps: kept.steps.map((s) => ({ ops: s.ops.map((o) => ({ a: o.a, b: o.b, put: o.put.map(piece) })), removed: s.removed.map((r) => r.map(piece)) })),
    };
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
 * SESSIONS_BYTES together. `keep`: one never to go (the open document's).
 */
export function sweepOf(all: { key: string; time: number; bytes: number }[], now: number, keep = '', age = SESSION_AGE, total = SESSIONS_BYTES): string[] {
  const out: string[] = [];
  const rest = all.filter((s) => {
    if (s.key !== keep && now - s.time > age) {
      out.push(s.key);
      return false;
    }
    return true;
  });
  let sum = rest.reduce((n, s) => n + s.bytes, 0);
  for (const s of rest.sort((a, b) => a.time - b.time)) {
    if (sum <= total) break;
    if (s.key === keep) continue;
    out.push(s.key);
    sum -= s.bytes;
  }
  return out;
}

const chunkKey = (key: string, id: number) => `${key}\u0000c${id}`;

/** Sessions in IndexedDB: records in `sessions`, edits' bytes in `chunks` (keyed `<key>\0c<id>`). */
export class IdbSessionStore implements SessionStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly name = 'tk-huge-sessions') {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((done, fail) => {
      const r = indexedDB.open(this.name, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        // (Version 1's records held their bytes: dropped.)
        if (db.objectStoreNames.contains('sessions')) db.deleteObjectStore('sessions');
        db.createObjectStore('sessions');
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      r.onsuccess = () => done(r.result);
      r.onerror = () => fail(new Error('Store failed'));
    }));
  }

  /** Runs `f` in one transaction over both stores; resolves when it commits. */
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore, c: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((done, fail) => {
      const t = db.transaction(['sessions', 'chunks'], mode);
      const r = f(t.objectStore('sessions'), t.objectStore('chunks'));
      t.oncomplete = () => done(r ? r.result : undefined);
      t.onerror = t.onabort = () => fail(new Error('Store failed'));
    });
  }

  async get(key: string): Promise<Kept | null> {
    const v = (await this.tx('readonly', (s) => s.get(key))) as Kept | undefined;
    return v && v.version === 2 ? v : null;
  }

  async put(key: string, kept: Kept, add: [number, Uint8Array][], drop: number[]): Promise<void> {
    await this.tx('readwrite', (s, c) => {
      for (const [id, bytes] of add) c.put(bytes, chunkKey(key, id));
      for (const id of drop) c.delete(chunkKey(key, id));
      s.put(kept, key);
    });
  }

  async chunks(key: string, ids: number[]): Promise<Map<number, Uint8Array>> {
    const out = new Map<number, Uint8Array>();
    await this.tx('readonly', (_s, c) => {
      for (const id of ids) {
        const r = c.get(chunkKey(key, id));
        r.onsuccess = () => r.result && out.set(id, r.result as Uint8Array);
      }
    });
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.tx('readwrite', (s, c) => {
      s.delete(key);
      c.delete(IDBKeyRange.bound(`${key}\u0000c`, `${key}\u0000c\uffff`));
    });
  }

  async list(): Promise<{ key: string; time: number; bytes: number }[]> {
    const out: { key: string; time: number; bytes: number }[] = [];
    await this.tx('readonly', (s) => {
      const r = s.openCursor();
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return;
        const v = cur.value as Kept;
        out.push({ key: String(cur.key), time: v.time ?? 0, bytes: v.bytes ?? 0 });
        cur.continue();
      };
    });
    return out;
  }
}

/** Sessions in memory, structured-cloned as IndexedDB keeps them (tests). */
export class MemorySessionStore implements SessionStore {
  readonly kept = new Map<string, Kept>();
  readonly chunkMap = new Map<string, Uint8Array>();
  /** Bytes cloned into it so far (tests: what keeps cost). */
  written = 0;

  async get(key: string): Promise<Kept | null> {
    const v = this.kept.get(key);
    return v ? structuredClone(v) : null;
  }

  async put(key: string, kept: Kept, add: [number, Uint8Array][], drop: number[]): Promise<void> {
    for (const [id, bytes] of add) {
      this.chunkMap.set(chunkKey(key, id), structuredClone(bytes));
      this.written += bytes.length;
    }
    for (const id of drop) this.chunkMap.delete(chunkKey(key, id));
    this.kept.set(key, structuredClone(kept));
  }

  async chunks(key: string, ids: number[]): Promise<Map<number, Uint8Array>> {
    const out = new Map<number, Uint8Array>();
    for (const id of ids) {
      const v = this.chunkMap.get(chunkKey(key, id));
      if (v) out.set(id, structuredClone(v));
    }
    return out;
  }

  async delete(key: string): Promise<void> {
    this.kept.delete(key);
    for (const k of [...this.chunkMap.keys()]) if (k.startsWith(`${key}\u0000c`)) this.chunkMap.delete(k);
  }

  async list(): Promise<{ key: string; time: number; bytes: number }[]> {
    return [...this.kept].map(([key, v]) => ({ key, time: v.time, bytes: v.bytes }));
  }
}
