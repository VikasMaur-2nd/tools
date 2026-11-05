/**
 * An edited huge document kept between visits: its pieces (the document: references to the file, and the edits'
 * bytes) and its undo history, keyed by the file (name, size, last modified), in IndexedDB. Reopening the same file
 * offers it back; saving or closing without keeping clears it. Bounded (SESSION_BYTES of edits' bytes: past that,
 * the history goes first, then nothing is kept).
 */
import { lengthOf, type Piece } from './pieces';
import type { EditOp } from './doc';

/** Edits' bytes a kept session may hold. */
export const SESSION_BYTES = 256 << 20;

/** A piece as kept: the file's bytes [off, off + len), or bytes of its own. */
export type PieceRef = { off: number; len: number } | { bytes: Uint8Array };

export interface KeptStep {
  ops: { a: number; b: number; put: PieceRef[] }[];
  removed: PieceRef[][];
}

export interface Kept {
  version: 1;
  /** The document. */
  pieces: PieceRef[];
  /** Its undo history (steps[0, applied) applied); empty if it didn't fit. */
  steps: KeptStep[];
  applied: number;
  /** Edits' bytes it holds, and when it was kept (ms since 1970). */
  bytes: number;
  time: number;
}

/** Where sessions are kept: IndexedDB in browsers, memory in tests. */
export interface SessionStore {
  get(key: string): Promise<Kept | null>;
  put(key: string, kept: Kept): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A file's key: its name, size and last modified time (the same file reopened has the same). */
export const sessionKey = (name: string, size: number, lastModified: number) => `${name}\u0000${size}\u0000${lastModified}`;

export const refOf = (p: Piece): PieceRef => (p.buf ? { bytes: p.buf.slice(p.off, p.off + p.len) } : { off: p.off, len: p.len });
export const pieceOf = (r: PieceRef): Piece => ('bytes' in r ? { buf: r.bytes, off: 0, len: r.bytes.length } : { buf: null, off: r.off, len: r.len });
const refBytes = (rs: readonly PieceRef[]) => rs.reduce((n, r) => n + ('bytes' in r ? r.bytes.length : 0), 0);

/** What to keep of a document (its pieces) and its history, within `cap` bytes of edits (null: it doesn't fit). */
export function keep(pieces: readonly Piece[], steps: readonly { ops: readonly EditOp[]; removed: readonly Piece[][] }[], applied: number, cap = SESSION_BYTES): Kept | null {
  const doc = pieces.map(refOf);
  let bytes = refBytes(doc);
  if (bytes > cap) return null;
  // The history from the newest step back, as long as it fits (undo then stops where it starts).
  const kept: KeptStep[] = [];
  let first = steps.length;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    const k: KeptStep = { ops: s.ops.map((o) => ({ a: o.a, b: o.b, put: o.put.map(refOf) })), removed: s.removed.map((ps) => ps.map(refOf)) };
    const n = k.ops.reduce((m, o) => m + refBytes(o.put), 0) + k.removed.reduce((m, ps) => m + refBytes(ps), 0);
    if (bytes + n > cap) break;
    bytes += n;
    kept.unshift(k);
    first = i;
  }
  // (Steps before `first` aren't kept: if some applied ones aren't, undo can't go back past them.)
  return { version: 1, pieces: doc, steps: kept, applied: Math.max(0, applied - first), bytes, time: Date.now() };
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

/** Sessions in IndexedDB (one object store, keyed by sessionKey). */
export class IdbSessionStore implements SessionStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly name = 'tk-huge-sessions') {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((done, fail) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sessions');
      r.onsuccess = () => done(r.result);
      r.onerror = () => fail(new Error('Store failed'));
    }));
  }

  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((done, fail) => {
      const r = f(db.transaction('sessions', mode).objectStore('sessions'));
      r.onsuccess = () => done(r.result);
      r.onerror = () => fail(new Error('Store failed'));
    });
  }

  async get(key: string): Promise<Kept | null> {
    const v = (await this.run('readonly', (s) => s.get(key))) as Kept | undefined;
    return v && v.version === 1 ? v : null;
  }

  async put(key: string, kept: Kept): Promise<void> {
    await this.run('readwrite', (s) => s.put(kept, key));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }
}

/** Sessions in memory, structured-cloned as IndexedDB keeps them (tests). */
export class MemorySessionStore implements SessionStore {
  readonly kept = new Map<string, Kept>();

  async get(key: string): Promise<Kept | null> {
    const v = this.kept.get(key);
    return v ? structuredClone(v) : null;
  }

  async put(key: string, kept: Kept): Promise<void> {
    this.kept.set(key, structuredClone(kept));
  }

  async delete(key: string): Promise<void> {
    this.kept.delete(key);
  }
}
