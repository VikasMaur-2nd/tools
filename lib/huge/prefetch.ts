/**
 * The indexing pass's reads of a File: big chunks read ahead asynchronously (`slice().arrayBuffer()`), so the
 * parse never waits on a read and reads overlap it. Measured in Chromium (RESEARCH-REPORT.md §4): a read costs
 * ~1 ms whatever its size, so one 1 MiB read at a time tops out near 250 MB/s; two 16 MiB reads in flight
 * reach ~960 MB/s. What's in flight is bounded (`ahead` chunks), and a chunk is dropped once parsed past: the
 * garbage it leaves is what the read path costs in memory.
 */
import type { ByteSource } from '../json/tape-wasm';
import { watched } from './wait';

export class Prefetch implements ByteSource {
  readonly size: number;
  private chunks = new Map<number, Uint8Array>();
  private loading = new Map<number, Promise<void>>();

  constructor(
    private readonly file: Blob,
    private readonly chunk = 16 << 20,
    private readonly ahead = 2,
    /** How long a read may take before it's made again (ms; wait.ts `watched`). */
    private readonly stall = 20_000,
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

  /** The read under way of the chunk holding byte `at`, or null. */
  loadingAt(at: number): Promise<void> | null {
    return this.loading.get(Math.floor(at / this.chunk)) ?? null;
  }

  /** Reads from byte `at` on: resolves once [at, at + len) is here, with the next chunks on their way; drops the ones before. */
  need(at: number, len: number): Promise<void> {
    const first = Math.floor(at / this.chunk);
    for (const k of this.chunks.keys()) if (k < first) this.chunks.delete(k);
    const waits: Promise<void>[] = [];
    const last = Math.floor((Math.min(this.size, at + len) - 1) / this.chunk);
    for (let k = first; k < first + this.ahead && k * this.chunk < this.size; k++) {
      if (!this.chunks.has(k) && !this.loading.has(k)) {
        // (Each read watched: one that stalls is made again.)
        const p = watched(() => this.file.slice(k * this.chunk, Math.min(this.size, (k + 1) * this.chunk)).arrayBuffer(), this.stall).then(
          (b) => {
            this.chunks.set(k, new Uint8Array(b));
            this.loading.delete(k);
          },
          (e) => {
            this.loading.delete(k);
            throw e;
          },
        );
        this.loading.set(k, p);
      }
      if (k <= last && this.loading.has(k)) waits.push(this.loading.get(k)!);
    }
    return Promise.all(waits).then(() => {});
  }
}

/**
 * The indexing pass's reads where FileReaderSync is the better reader (Firefox: flat memory over a long read,
 * ~440 MB/s in 16 MiB reads): one chunk at a time, synchronously. Always "here".
 */
export class SyncChunks implements ByteSource {
  readonly size: number;
  private at = -1;
  private buf = new Uint8Array(0);

  constructor(
    private readonly file: Blob,
    private readonly readSync: (blob: Blob) => ArrayBuffer,
    private readonly chunk = 16 << 20,
  ) {
    this.size = file.size;
  }

  has(): boolean {
    return true;
  }

  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    if (at < this.at || at + len > this.at + this.buf.length) {
      this.at = at;
      this.buf = new Uint8Array(this.readSync(this.file.slice(at, Math.min(this.size, at + Math.max(len, this.chunk)))));
    }
    return this.buf.subarray(at - this.at, at - this.at + len);
  }

  need(): Promise<void> {
    return Promise.resolve();
  }
}
