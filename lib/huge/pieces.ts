/**
 * The edited document as a piece table over the file: pieces of the file's bytes (as read from `base`) and of
 * edits' bytes (UTF-8), in order. Memory is the edits' bytes and a few numbers per piece; the file is never
 * copied. Positions are bytes of the document (after a byte order mark, as everywhere in huge mode).
 */
import type { ByteSource } from '../json/tape-wasm';

/** `len` bytes of an edit (`buf` from `off`), or of the base source from `off` (`buf` null). */
export interface Piece {
  buf: Uint8Array | null;
  off: number;
  len: number;
}

/** The bytes of `text` as one piece (none if empty). */
export const piecesOf = (bytes: Uint8Array): Piece[] => (bytes.length ? [{ buf: bytes, off: 0, len: bytes.length }] : []);

/** Bytes in `ps`. */
export const lengthOf = (ps: readonly Piece[]): number => {
  let n = 0;
  for (const p of ps) n += p.len;
  return n;
};

export class Pieces implements ByteSource {
  size: number;
  /** Bumped by every change (caches of what was read compare it). */
  version = 0;
  private ps: Piece[];
  /** Where each piece starts in the document. */
  private starts: number[];

  constructor(public base: ByteSource) {
    this.size = base.size;
    this.ps = base.size ? [{ buf: null, off: 0, len: base.size }] : [];
    this.starts = base.size ? [0] : [];
  }

  /** Whether the document differs from the base (as pieces: an edit undone by hand still counts). */
  get edited(): boolean {
    return !(this.ps.length === 0 ? this.base.size === 0 : this.ps.length === 1 && !this.ps[0].buf && this.ps[0].off === 0 && this.ps[0].len === this.base.size);
  }

  /** The pieces, in order (save streams them). */
  get list(): readonly Piece[] {
    return this.ps;
  }

  /** The piece holding byte `at` (the last one at the end). */
  private find(at: number): number {
    const s = this.starts;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (s[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    if (!len) return new Uint8Array(0);
    const ps = this.ps;
    // (Unedited: the base as is.)
    if (ps.length === 1 && !ps[0].buf) return this.base.read(ps[0].off + at, len);
    let i = this.find(at);
    const first = ps[i];
    const into = at - this.starts[i];
    if (into + len <= first.len) return this.bytes(first, into, len);
    const out = new Uint8Array(len);
    let o = 0;
    for (let skip = into; o < len; i++, skip = 0) {
      const p = ps[i];
      const n = Math.min(p.len - skip, len - o);
      out.set(this.bytes(p, skip, n), o);
      o += n;
    }
    return out;
  }

  private bytes(p: Piece, from: number, len: number): Uint8Array {
    return p.buf ? p.buf.subarray(p.off + from, p.off + from + len) : this.base.read(p.off + from, len).subarray(0, len);
  }

  /** Splits the piece holding `at` there (if inside one): the index of the piece starting at `at` (ps.length at the end). */
  private split(at: number): number {
    if (at >= this.size) return this.ps.length;
    const i = this.find(at);
    const into = at - this.starts[i];
    if (!into) return i;
    const p = this.ps[i];
    this.ps.splice(i, 1, { buf: p.buf, off: p.off, len: into }, { buf: p.buf, off: p.off + into, len: p.len - into });
    this.starts.splice(i + 1, 0, at);
    return i + 1;
  }

  /**
   * Replaces bytes [a, b) with `add`: the pieces taken out (exactly [a, b): putting them back undoes it).
   * Neighbouring pieces that continue each other are joined, so undoing everything leaves one piece of the base.
   */
  splice(a: number, b: number, add: readonly Piece[]): Piece[] {
    if (a < 0 || b < a || b > this.size) throw new RangeError('Out of range');
    const i = this.split(a);
    const j = this.split(b);
    const removed = this.ps.slice(i, j);
    const put = add.filter((p) => p.len > 0);
    this.ps.splice(i, j - i, ...put);
    this.size += lengthOf(put) - (b - a);
    // Joins around what changed, then the starts from there on.
    let from = Math.max(0, i - 1);
    for (let k = from; k < Math.min(this.ps.length - 1, i + put.length + 1); ) {
      const p = this.ps[k];
      const q = this.ps[k + 1];
      if (p.buf === q.buf && p.off + p.len === q.off) {
        this.ps.splice(k, 2, { buf: p.buf, off: p.off, len: p.len + q.len });
      } else k++;
    }
    from = Math.max(0, Math.min(from, this.ps.length));
    this.starts.length = this.ps.length;
    let at = from > 0 ? this.starts[from - 1] + this.ps[from - 1].len : 0;
    for (let k = from; k < this.ps.length; k++) {
      this.starts[k] = at;
      at += this.ps[k].len;
    }
    this.version++;
    return removed;
  }

  /** The pieces of bytes [a, b) (references: nothing is read or copied, so a value of any size is copied for free). */
  slice(a: number, b: number): Piece[] {
    const out: Piece[] = [];
    if (b <= a) return out;
    for (let i = this.find(a); i < this.ps.length && this.starts[i] < b; i++) {
      const p = this.ps[i];
      const from = Math.max(0, a - this.starts[i]);
      const to = Math.min(p.len, b - this.starts[i]);
      if (to > from) out.push({ buf: p.buf, off: p.off + from, len: to - from });
    }
    return out;
  }

  /** Reads `base` from now on, as the whole document (it was saved there): nothing edited. */
  rebase(base: ByteSource): void {
    this.base = base;
    this.reset();
  }

  /** The base's bytes (no edits) again. */
  reset(): void {
    this.ps = this.base.size ? [{ buf: null, off: 0, len: this.base.size }] : [];
    this.starts = this.base.size ? [0] : [];
    this.size = this.base.size;
    this.version++;
  }

  /** Bytes of edits the pieces hold (what the document costs beyond the file). */
  get editBytes(): number {
    let n = 0;
    for (const p of this.ps) if (p.buf) n += p.len;
    return n;
  }
}
