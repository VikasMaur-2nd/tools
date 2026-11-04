/**
 * The indexing pass's reads of a File: big chunks read ahead asynchronously (`slice().arrayBuffer()`), so the
 * parse never waits on a read and reads overlap it. Measured in Chromium (RESEARCH-REPORT.md §4): a read costs
 * ~1 ms whatever its size, so one 1 MiB read at a time tops out near 250 MB/s; two 16 MiB reads in flight
 * reach ~960 MB/s. What's in flight is bounded (`ahead` chunks), and a chunk is dropped once parsed past: the
 * garbage it leaves is what the read path costs in memory.
 */
import type { ByteSource } from '../json/tape-wasm';

export class Prefetch implements ByteSource {
  readonly size: number;
  private chunks = new Map<number, Uint8Array>();
  private loading = new Map<number, Promise<void>>();

  constructor(
    private readonly file: Blob,
    private readonly chunk = 16 << 20,
    private readonly ahead = 2,
  ) {
    this.size = file.size;
  }

  /** Whether bytes [at, at + len) are here. */
  has(at: number, len: number): boolean {
    const end = Math.min(this.size, at + len);
    for (let k = Math.floor(at / this.chunk); k * this.chunk < end; k++) if (!this.chunks.has(k)) return false;
    return true;
  }

  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    const k = Math.floor(at / this.chunk);
    const c = this.chunks.get(k);
    if (!c) throw new Error('Not read yet');
    const off = at - k * this.chunk;
    if (off + len <= c.length) return c.subarray(off, off + len);
    // (Across two chunks: joined.)
    const out = new Uint8Array(len);
    out.set(c.subarray(off));
    out.set(this.read(at + c.length - off, len - (c.length - off)), c.length - off);
    return out;
  }

  /** Reads from byte `at` on: resolves once [at, at + len) is here, with the next chunks on their way; drops the ones before. */
  need(at: number, len: number): Promise<void> {
    const first = Math.floor(at / this.chunk);
    for (const k of this.chunks.keys()) if (k < first) this.chunks.delete(k);
    const waits: Promise<void>[] = [];
    const last = Math.floor((Math.min(this.size, at + len) - 1) / this.chunk);
    for (let k = first; k < first + this.ahead && k * this.chunk < this.size; k++) {
      if (!this.chunks.has(k) && !this.loading.has(k)) {
        const p = this.file
          .slice(k * this.chunk, Math.min(this.size, (k + 1) * this.chunk))
          .arrayBuffer()
          .then((b) => {
            this.chunks.set(k, new Uint8Array(b));
            this.loading.delete(k);
          });
        this.loading.set(k, p);
      }
      if (k <= last && this.loading.has(k)) waits.push(this.loading.get(k)!);
    }
    return Promise.all(waits).then(() => {});
  }
}
