/**
 * The page's side of the stream worker (protocol.ts): runs a command or a pass over a huge file and hands back
 * progress, the Shape panel's reports and the result; decompresses .gz files. Also what the page does with
 * huge mode's OPFS files: names, locks (a file in use is never swept by another tab), sweeping old ones,
 * free space.
 */
import type { Job, JobResult } from './jobs';
import type { Out, StreamReply, StreamRequest } from './protocol';
import type { ShapeReport } from './shape';
import { TEMP_DIR } from './sinks';

export interface Port {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  terminate?(): void;
}

/** A command's failure: a fixed message (protocol.ts KNOWN_ERRORS), and the byte of an invalid document. */
export class StreamError extends Error {
  constructor(
    msg: string,
    readonly at = -1,
    /** Split into a picked folder: the finished parts kept there. */
    readonly parts = 0,
  ) {
    super(msg);
  }
}

export interface Running<T> {
  done: Promise<T>;
  stop(): void;
}

type Handlers = {
  progress?: (done: number, total: number, out?: number) => void;
  shape?: (r: ShapeReport) => void;
  done: (r: Extract<StreamReply, { type: 'done' }>) => void;
  fail: (e: StreamError) => void;
};

export class StreamClient {
  private port: Port;
  private seq = 0;
  private pending = new Map<number, Handlers>();
  private closed = false;

  constructor(port?: Port) {
    this.port = port ?? (new Worker(new URL('./stream.worker.ts', import.meta.url)) as unknown as Port);
    this.port.onmessage = (e) => this.receive(e.data as StreamReply);
  }

  private receive(r: StreamReply) {
    const h = this.pending.get(r.id);
    if (!h) return;
    if (r.type === 'progress') h.progress?.(r.done, r.total, r.out);
    else if (r.type === 'shape') h.shape?.(r.report);
    else {
      this.pending.delete(r.id);
      if (r.type === 'done') h.done(r);
      else h.fail(new StreamError(r.error, r.at, r.parts ?? 0));
    }
  }

  private send<T>(q: StreamRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never, handlers: Omit<Handlers, 'done' | 'fail'>, map: (r: Extract<StreamReply, { type: 'done' }>) => T): Running<T> {
    const id = ++this.seq;
    const done = new Promise<T>((ok, fail) => {
      if (this.closed) return fail(new StreamError('Stopped'));
      this.pending.set(id, { ...handlers, done: (r) => ok(map(r)), fail });
      this.port.postMessage({ ...q, id });
    });
    return { done, stop: () => !this.closed && this.port.postMessage({ id: ++this.seq, op: 'stop', target: id }) };
  }

  /** Runs `job` over `file` (`skip`: a byte order mark's bytes); the OPFS output, if any, comes back as `file`. */
  run(file: Blob, skip: number, job: Job, out: Out, on: { progress?: (done: number, total: number) => void; shape?: (r: ShapeReport) => void } = {}): Running<{ result: JobResult; file?: File }> {
    return this.send({ op: 'run', file, skip, job, out }, on, (r) => ({ result: r.result!, file: r.file }));
  }

  /** Decompresses a gzip file: a Blob if it is at most `limit` bytes, else an OPFS file named `name`. */
  gunzip(file: Blob, name: string, limit: number, progress?: (read: number, total: number, out: number) => void): Running<{ blob?: Blob; file?: File; size: number }> {
    return this.send({ op: 'gunzip', file, name, limit }, { progress: (d, t, o) => progress?.(d, t, o ?? 0) }, (r) => ({ blob: r.blob, file: r.file, size: r.size ?? 0 }));
  }

  close() {
    this.closed = true;
    for (const h of this.pending.values()) h.fail(new StreamError('Stopped'));
    this.pending.clear();
    this.port.terminate?.();
  }
}

// ── OPFS files (page side) ──────────────────────────────────────────────────

const LOCK = 'tk-huge:';

/** A new temporary file name (`ext`: its extension, e.g. "csv.gz"). */
export const tempName = (stem: string, ext: string) => `${stem.replace(/[^\w.-]+/g, '_').slice(0, 60)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;

/** Holds a lock on temp file `name` while this tab uses it (another tab's sweep leaves it); call the result to let go. */
export function hold(name: string): () => void {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  try {
    void navigator.locks?.request(LOCK + name, () => held);
  } catch {
    /* no Web Locks: the sweep's age check keeps it */
  }
  return release;
}

/** Deletes temp file `name` (if it isn't open). */
export async function removeTemp(name: string) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(TEMP_DIR);
    await dir.removeEntry(name);
  } catch {
    /* gone, or still being read */
  }
}

/** Deletes huge mode's temp files no tab holds and older than `age` ms (left by a closed tab). */
export async function sweep(age = 10 * 60_000) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(TEMP_DIR, { create: true });
    const held = new Set(((await navigator.locks?.query())?.held ?? []).map((l) => l.name));
    const now = Date.now();
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (held.has(LOCK + name) || h.kind !== 'file') continue;
      const f = await (h as FileSystemFileHandle).getFile().catch(() => null);
      if (f && now - f.lastModified > age) await dir.removeEntry(name).catch(() => {});
    }
  } catch {
    /* no OPFS here */
  }
}

/** Free bytes the origin may still store (null: the browser doesn't say). */
export async function freeSpace(): Promise<number | null> {
  try {
    const e = await navigator.storage.estimate();
    if (e.quota === undefined || e.usage === undefined) return null;
    return Math.max(0, e.quota - e.usage);
  } catch {
    return null;
  }
}

/** Whether this browser writes OPFS files from workers (sync access handles). */
export const hasOpfs = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

/** Chromium's save and folder pickers. */
export const canPick = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;
export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/**
 * The size a gzip file says it decompresses to (its ISIZE trailer: modulo 4 GiB, raised by 4 GiB at a time
 * while below twice the compressed size: JSON compresses well), or null if it isn't gzip.
 */
export async function gzSize(file: Blob): Promise<number | null> {
  if (file.size < 18) return null;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return null;
  let n = new DataView(await file.slice(file.size - 4).arrayBuffer()).getUint32(0, true);
  if (file.size > 2 ** 30) while (n < file.size * 2) n += 2 ** 32;
  return n;
}
