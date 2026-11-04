/**
 * Where the stream worker's commands write (out.ts Sink): a file the user picked (Chromium's save picker, or a
 * folder for Split: `createWritable`, committed on close), or a file in the origin's private file system
 * (OPFS, a sync access handle: every browser) that the page then downloads, gzip on the way
 * (CompressionStream), and for Split outside Chromium one stored ZIP64 archive of the parts.
 */
import type { Sink } from './out';

/** The folder in OPFS huge mode's files go to (outputs to download, decompressed inputs). */
export const TEMP_DIR = 'tk-huge';

/** A sink failed for want of space (QuotaExceededError), said with a fixed message. */
export class SpaceError extends Error {
  constructor() {
    super('Not enough storage space');
  }
}

const quota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || /quota|space/i.test(e.message));

/** A sink over a writable file stream (a file the user picked). */
export function writableSink(w: FileSystemWritableFileStream): Sink {
  return {
    async write(b) {
      try {
        await w.write(b as Uint8Array<ArrayBuffer>);
      } catch (e) {
        throw quota(e) ? new SpaceError() : e;
      }
    },
    close: () => w.close(),
    abort: () => w.abort(),
  };
}

interface SyncHandle {
  write(b: Uint8Array, o: { at: number }): number;
  read(b: Uint8Array, o: { at: number }): number;
  truncate(n: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

/** The browser won't store files for this page (a private window, storage turned off). */
export class NoStorageError extends Error {
  constructor() {
    super('No storage');
  }
}

export async function tempDir(): Promise<FileSystemDirectoryHandle> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(TEMP_DIR, { create: true });
  } catch (e) {
    if (quota(e)) throw new SpaceError();
    throw new NoStorageError();
  }
}

/** A file in OPFS written through a sync access handle (workers only); `at` writes at a byte (the zip patches its headers). */
export interface OpfsFile extends Sink {
  readonly name: string;
  /** Bytes written so far. */
  size: number;
  writeAt(b: Uint8Array, at: number): void;
  file(): Promise<File>;
}

export async function opfsFile(name: string): Promise<OpfsFile> {
  const dir = await tempDir();
  let fh: FileSystemFileHandle;
  let h: SyncHandle;
  try {
    fh = await dir.getFileHandle(name, { create: true });
    h = (await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()) as SyncHandle;
  } catch (e) {
    throw quota(e) ? new SpaceError() : new NoStorageError();
  }
  h.truncate(0);
  let open = true;
  const put = (b: Uint8Array, at: number) => {
    let n: number;
    try {
      n = h.write(b, { at });
    } catch (e) {
      throw quota(e) ? new SpaceError() : e;
    }
    if (n !== b.length) throw new SpaceError();
  };
  const f: OpfsFile = {
    name,
    size: 0,
    write(b) {
      put(b, f.size);
      f.size += b.length;
    },
    writeAt: put,
    async close() {
      if (!open) return;
      open = false;
      h.flush();
      h.close();
    },
    async abort() {
      if (open) {
        open = false;
        h.close();
      }
      await dir.removeEntry(name).catch(() => {});
    },
    file: () => fh.getFile(),
  };
  return f;
}

/** `inner`, gzip-compressed on the way (CompressionStream: every browser). */
export function gzipSink(inner: Sink): Sink {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  const r = cs.readable.getReader();
  let failed: unknown = null;
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        await inner.write(value);
      }
    } catch (e) {
      failed = e;
      await w.abort(e).catch(() => {});
    }
  })();
  return {
    async write(b) {
      if (failed) throw failed;
      await w.ready;
      if (failed) throw failed;
      // (Not awaited: `ready` paces the writes.)
      w.write(b as Uint8Array<ArrayBuffer>).catch(() => {});
    },
    async close() {
      if (failed) throw failed;
      await w.close();
      await pump;
      if (failed) throw failed;
      await inner.close();
    },
    async abort() {
      await w.abort().catch(() => {});
      await pump.catch(() => {});
      await inner.abort();
    },
  };
}

// ── ZIP (stored, ZIP64) ─────────────────────────────────────────────────────

const CRC = new Int32Array(256 * 8);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
for (let n = 0; n < 256; n++) for (let t = 1; t < 8; t++) CRC[t * 256 + n] = (CRC[(t - 1) * 256 + n] >>> 8) ^ CRC[CRC[(t - 1) * 256 + n] & 0xff];

/** CRC-32 of b, continuing from `crc` (slicing by 8). */
export function crc32(b: Uint8Array, crc = 0): number {
  let c = ~crc;
  let i = 0;
  const n = b.length;
  for (; i + 8 <= n; i += 8) {
    c ^= b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
    c =
      CRC[7 * 256 + (c & 0xff)] ^
      CRC[6 * 256 + ((c >>> 8) & 0xff)] ^
      CRC[5 * 256 + ((c >>> 16) & 0xff)] ^
      CRC[4 * 256 + (c >>> 24)] ^
      CRC[3 * 256 + b[i + 4]] ^
      CRC[2 * 256 + b[i + 5]] ^
      CRC[256 + b[i + 6]] ^
      CRC[b[i + 7]];
  }
  for (; i < n; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const u16 = (v: DataView, at: number, x: number) => v.setUint16(at, x, true);
const u32 = (v: DataView, at: number, x: number) => v.setUint32(at, x >>> 0, true);
const u64 = (v: DataView, at: number, x: number) => {
  v.setUint32(at, x % 2 ** 32, true);
  v.setUint32(at + 4, Math.floor(x / 2 ** 32), true);
};

function dosTime(d: Date): [number, number] {
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

/**
 * A ZIP archive written into an OPFS file, its entries one after another (stored: JSON parts are best
 * compressed by the gzip option, and a stored entry streams). Every header is ZIP64, so parts and archives past
 * 4 GiB are fine; a local header's CRC and sizes are written in place once its entry ends (no data descriptors).
 */
export class ZipWriter {
  private entries: { name: Uint8Array; at: number; size: number; crc: number }[] = [];
  private readonly time: [number, number];
  constructor(private readonly f: OpfsFile) {
    this.time = dosTime(new Date());
  }

  /** The next entry's sink (the previous one must be closed). */
  entry(name: string): Sink {
    const n = new TextEncoder().encode(name);
    const head = new Uint8Array(30 + n.length + 20);
    const v = new DataView(head.buffer);
    const at = this.f.size;
    u32(v, 0, 0x04034b50);
    u16(v, 4, 45);
    u16(v, 6, 0x0800);
    u16(v, 8, 0);
    u16(v, 10, this.time[0]);
    u16(v, 12, this.time[1]);
    u32(v, 14, 0);
    u32(v, 18, 0xffffffff);
    u32(v, 22, 0xffffffff);
    u16(v, 26, n.length);
    u16(v, 28, 20);
    head.set(n, 30);
    u16(v, 30 + n.length, 1);
    u16(v, 32 + n.length, 16);
    this.f.write(head);
    const e = { name: n, at, size: 0, crc: 0 };
    this.entries.push(e);
    return {
      write: (b) => {
        e.crc = crc32(b, e.crc);
        e.size += b.length;
        this.f.write(b);
      },
      close: async () => {
        u32(v, 14, e.crc);
        u64(v, 34 + n.length, e.size);
        u64(v, 42 + n.length, e.size);
        this.f.writeAt(head, at);
      },
      abort: async () => {},
    };
  }

  /** The central directory and its ends; then the file is complete. */
  async close() {
    const cdAt = this.f.size;
    let cdSize = 0;
    for (const e of this.entries) {
      const rec = new Uint8Array(46 + e.name.length + 28);
      const v = new DataView(rec.buffer);
      u32(v, 0, 0x02014b50);
      u16(v, 4, 45);
      u16(v, 6, 45);
      u16(v, 8, 0x0800);
      u16(v, 10, 0);
      u16(v, 12, this.time[0]);
      u16(v, 14, this.time[1]);
      u32(v, 16, e.crc);
      u32(v, 20, 0xffffffff);
      u32(v, 24, 0xffffffff);
      u16(v, 28, e.name.length);
      u16(v, 30, 28);
      u16(v, 32, 0);
      u16(v, 34, 0);
      u16(v, 36, 0);
      u32(v, 38, 0);
      u32(v, 42, 0xffffffff);
      rec.set(e.name, 46);
      const x = 46 + e.name.length;
      u16(v, x, 1);
      u16(v, x + 2, 24);
      u64(v, x + 4, e.size);
      u64(v, x + 12, e.size);
      u64(v, x + 20, e.at);
      this.f.write(rec);
      cdSize += rec.length;
    }
    const end = new Uint8Array(56 + 20 + 22);
    const v = new DataView(end.buffer);
    const z64 = this.f.size;
    u32(v, 0, 0x06064b50);
    u64(v, 4, 44);
    u16(v, 12, 45);
    u16(v, 14, 45);
    u32(v, 16, 0);
    u32(v, 20, 0);
    u64(v, 24, this.entries.length);
    u64(v, 32, this.entries.length);
    u64(v, 40, cdSize);
    u64(v, 48, cdAt);
    u32(v, 56, 0x07064b50);
    u32(v, 60, 0);
    u64(v, 64, z64);
    u32(v, 72, 1);
    u32(v, 76, 0x06054b50);
    u16(v, 80, 0);
    u16(v, 82, 0);
    u16(v, 84, 0xffff);
    u16(v, 86, 0xffff);
    u32(v, 88, 0xffffffff);
    u32(v, 92, 0xffffffff);
    u16(v, 96, 0);
    this.f.write(end);
    await this.f.close();
  }
}
