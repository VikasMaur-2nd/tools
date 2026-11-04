/**
 * Bytes of a huge document: reading them as text the way the page reads a file (read.ts: UTF-8, invalid bytes
 * as U+FFFD), and counting what positions need (UTF-16 units, line breaks) the way huge.wasm counts them.
 */
import type { ByteSource } from '../json/tape-wasm';
import { Wait, watched } from './wait';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** The text of bytes [at, at + len) of `src` (UTF-8; invalid bytes as U+FFFD). */
export function textOf(src: ByteSource, at: number, len: number): string {
  if (len <= 0) return '';
  return decoder.decode(src.read(at, len).subarray(0, len));
}

/** The document after a UTF-8 byte order mark, if the file has one: its bytes from 3 on. */
export function content(file: ByteSource): { src: ByteSource; bom: number; utf16: boolean } {
  const head = file.size >= 2 ? file.read(0, Math.min(3, file.size)) : new Uint8Array(0);
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return { src: { size: file.size - 3, read: (at, len) => file.read(at + 3, len) }, bom: 3, utf16 };
  }
  return { src: file, bom: 0, utf16 };
}

/** A ByteSource that keeps the last few blocks it read (queries read the same bytes again and again). */
export class CachedSource implements ByteSource {
  readonly size: number;
  private blocks = new Map<number, Uint8Array>();
  constructor(
    private readonly src: ByteSource,
    private readonly block = 1 << 20,
    private readonly keep = 16,
  ) {
    this.size = src.size;
  }

  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    const b = this.block;
    const first = Math.floor(at / b);
    const last = Math.floor((at + Math.max(len, 1) - 1) / b);
    if (first === last) {
      const blk = this.get(first);
      return blk.subarray(at - first * b, at - first * b + len);
    }
    // (Reads spanning blocks: straight from the source, not kept.)
    return this.src.read(at, len).subarray(0, len);
  }

  private get(k: number): Uint8Array {
    let blk = this.blocks.get(k);
    if (blk) {
      this.blocks.delete(k);
      this.blocks.set(k, blk);
      return blk;
    }
    const at = k * this.block;
    blk = this.src.read(at, Math.min(this.block, this.size - at)).slice();
    this.blocks.set(k, blk);
    if (this.blocks.size > this.keep) this.blocks.delete(this.blocks.keys().next().value!);
    return blk;
  }
}

/**
 * Counts bytes `b[from, to)` as huge.wasm does: UTF-16 units (a continuation byte is none, a 4-byte character's
 * first byte two, a \n after a \r none), line breaks (\r\n, \r and \n each one), and the UTF-16 units since the
 * last break (or -1 if none). `cr`: the byte before `from` is a \r.
 */
export function count(b: Uint8Array, from: number, to: number, cr = false): { units: number; breaks: number; sinceBreak: number } {
  let units = 0;
  let breaks = 0;
  let since = -1;
  let prevCr = cr;
  for (let i = from; i < to; i++) {
    const c = b[i];
    if (c < 0x80) {
      if (c === 10) {
        if (prevCr) {
          prevCr = false;
          continue;
        }
        breaks++;
        units++;
        since = 0;
        continue;
      }
      units++;
      if (c === 13) {
        breaks++;
        since = 0;
        prevCr = true;
        continue;
      }
      prevCr = false;
      if (since >= 0) since++;
      continue;
    }
    prevCr = false;
    if (c < 0xc0) continue;
    const u = c >= 0xf0 ? 2 : 1;
    units += u;
    if (since >= 0) since += u;
  }
  return { units, breaks, sinceBreak: since };
}

/** The byte in `b[from, to)` after which `units` UTF-16 units (counted as `count` does) have passed. */
export function byteAfterUnits(b: Uint8Array, from: number, to: number, units: number, cr = false): number {
  let u = 0;
  let prevCr = cr;
  let i = from;
  for (; i < to && u < units; i++) {
    const c = b[i];
    if (c === 10 && prevCr) {
      prevCr = false;
      continue;
    }
    prevCr = c === 13;
    if (c < 0x80) u++;
    else if (c >= 0xc0) u += c >= 0xf0 ? 2 : 1;
  }
  // (Past a character's first byte: on to its last.)
  while (i < to && b[i] >= 0x80 && b[i] < 0xc0) i++;
  // (A \n that ends a \r\n counts with its \r.)
  if (i < to && i > from && b[i] === 10 && b[i - 1] === 13) i++;
  return i;
}

/** The first line break (\n or \r) in `src` at or after `at` and before `end`, or -1; read a chunk at a time. */
export function nextBreak(src: ByteSource, at: number, end = src.size, max = 1 << 20): number {
  // (Small reads first: a line is usually short.)
  for (let p = at, chunk = 4096; p < end; p += chunk, chunk = Math.min(max, chunk * 4)) {
    const len = Math.min(chunk, end - p);
    const b = src.read(p, len);
    let i = b.indexOf(10);
    const j = b.indexOf(13);
    if (j >= 0 && (i < 0 || j < i)) i = j;
    if (i >= 0 && i < len) return p + i;
  }
  return -1;
}

/** The byte after the line break at `at` (\r\n is one break). */
export function afterBreak(src: ByteSource, at: number): number {
  if (src.read(at, 1)[0] === 13 && at + 1 < src.size && src.read(at + 1, 1)[0] === 10) return at + 2;
  return at + 1;
}

/** The `n`th line break (n ≥ 1) at or after `at` (\r\n is one): the byte after it, or -1 if there are fewer before `end`. */
export function afterBreaks(src: ByteSource, at: number, n: number, end = src.size, max = 1 << 20): number {
  let left = n;
  let prevCr = false;
  // The nth break was a \r: what follows decides (a \n is part of it).
  let last = false;
  for (let p = at, chunk = 4096; p < end; p += chunk, chunk = Math.min(max, chunk * 4)) {
    const len = Math.min(chunk, end - p);
    const b = src.read(p, len);
    for (let i = 0; i < len; i++) {
      const c = b[i];
      if (last) return c === 10 ? p + i + 1 : p + i;
      if (c === 10) {
        if (!prevCr && --left === 0) return p + i + 1;
        prevCr = false;
      } else if (c === 13) {
        prevCr = true;
        if (--left === 0) last = true;
      } else prevCr = false;
    }
  }
  if (last) return end < src.size && src.read(end, 1)[0] === 10 ? end + 1 : end;
  return -1;
}

/**
 * A file read in blocks fetched asynchronously (`slice().arrayBuffer()`, each watched for a stall), for engines
 * where FileReaderSync's garbage keeps growing over a long session (Chromium) or slices are cheap only async.
 * A read of blocks not here throws a Wait (wait.ts) that fetches them; the query is then asked again.
 */
export class BlockSource implements ByteSource {
  readonly size: number;
  private blocks = new Map<number, Uint8Array>();
  private loading = new Map<number, Promise<void>>();
  /** Blocks read by the queries under way (asked again after a Wait): not dropped until release(). */
  private pinned = new Set<number>();

  constructor(
    private readonly file: Blob,
    private readonly block = 1 << 20,
    private readonly keep = 24,
  ) {
    this.size = file.size;
  }

  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    const b = this.block;
    const first = Math.floor(at / b);
    const last = Math.floor((at + Math.max(len, 1) - 1) / b);
    const missing: number[] = [];
    for (let k = first; k <= last; k++) {
      if (this.blocks.has(k)) this.pinned.add(k);
      else missing.push(k);
    }
    if (missing.length) throw new Wait(() => this.fetch(missing));
    if (first === last) {
      const blk = this.touch(first);
      return blk.subarray(at - first * b, at - first * b + len);
    }
    const out = new Uint8Array(len);
    for (let k = first, o = 0; k <= last; k++) {
      const blk = this.touch(k);
      const from = k === first ? at - k * b : 0;
      const n = Math.min(blk.length - from, len - o);
      out.set(blk.subarray(from, from + n), o);
      o += n;
    }
    return out;
  }

  /** The queries under way are done: their blocks may go. */
  release() {
    this.pinned.clear();
    this.trim();
  }

  private trim() {
    if (this.blocks.size <= this.keep) return;
    for (const k of [...this.blocks.keys()]) {
      if (this.blocks.size <= this.keep) break;
      if (!this.pinned.has(k)) this.blocks.delete(k);
    }
  }

  private touch(k: number): Uint8Array {
    this.pinned.add(k);
    const blk = this.blocks.get(k)!;
    this.blocks.delete(k);
    this.blocks.set(k, blk);
    return blk;
  }

  /** Reads blocks `ks` (dropping the least used past `keep`). */
  fetch(ks: number[]): Promise<void> {
    return Promise.all(
      ks.map((k) => {
        let p = this.loading.get(k);
        if (!p) {
          const at = k * this.block;
          p = watched(() => this.file.slice(at, Math.min(this.size, at + this.block)).arrayBuffer()).then(
            (buf) => {
              this.blocks.set(k, new Uint8Array(buf));
              this.pinned.add(k);
              this.loading.delete(k);
              this.trim();
            },
            (e) => {
              this.loading.delete(k);
              throw e;
            },
          );
          this.loading.set(k, p);
        }
        return p;
      }),
    ).then(() => {});
  }
}
