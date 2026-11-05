/**
 * The stream worker's side of protocol.ts (stream.worker.ts runs it on its port; tests in process): runs jobs
 * (jobs.ts) with their sinks (sinks.ts), streams progress and the Shape panel's reports, stops on request, and
 * decompresses .gz files. Errors go back as fixed messages.
 */
import { JobError, runJob, type Outputs } from './jobs';
import type { Sink } from './out';
import { blobSource, Stopped } from './pass';
import { KNOWN_ERRORS, type Out, type StreamReply, type StreamRequest } from './protocol';
import { gzipSink, NoStorageError, opfsFile, SpaceError, tempDir, writableSink, ZipWriter, type OpfsFile } from './sinks';

const removeTemp = async (name: string) => {
  try {
    await (await tempDir()).removeEntry(name);
  } catch {
    /* gone already, or still open */
  }
};

export interface ServePort {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

/** The temp file a ZIP's central directory is spooled to. */
const spoolName = (name: string) => `${name}.cd`;

const partName = (names: string, k: number) => names.replace('{n}', String(k + 1).padStart(4, '0'));

/**
 * The job's outputs for `out`: `done` (all written: the OPFS file to hand back, if any) and `abort` (stopped
 * or failed: every file it opened closed and deleted, whether or not the job got to write to it).
 */
export async function outputsFor(out: Out, written: { bytes: number }): Promise<{ outs: Outputs; done: () => Promise<File | undefined>; abort: () => Promise<void>; kept: () => number }> {
  const nothing = () => 0;
  const none = async () => {};
  // (What reaches the file: after gzip, if any.)
  const counted = (s: Sink): Sink => ({
    write: (b) => {
      written.bytes += b.length;
      return s.write(b);
    },
    close: () => s.close(),
    abort: () => s.abort(),
  });
  const gz = (s: Sink, on: boolean) => (on ? gzipSink(counted(s)) : counted(s));
  switch (out.kind) {
    case 'none':
      return { outs: { main: () => Promise.reject(new JobError('No output')), part: () => Promise.reject(new JobError('No output')) }, done: async () => undefined, abort: none, kept: nothing };
    case 'file':
      return {
        outs: { main: async () => gz(writableSink(await out.handle.createWritable()), out.gzip), part: () => Promise.reject(new JobError('No output')) },
        done: async () => undefined,
        // (The job aborts its writable: the picked file keeps what it had.)
        abort: none,
        kept: nothing,
      };
    case 'dir': {
      // (Parts made in the picked folder: a split that doesn't finish keeps the finished ones, the unfinished one goes.)
      const open = new Set<string>();
      let finished = 0;
      return {
        outs: {
          main: () => Promise.reject(new JobError('No output')),
          part: async (k) => {
            const name = partName(out.names, k);
            const fh = await out.handle.getFileHandle(name, { create: true });
            open.add(name);
            const sink = writableSink(await fh.createWritable());
            const closing: Sink = {
              write: (b) => sink.write(b),
              close: async () => {
                await sink.close();
                open.delete(name);
                finished++;
              },
              abort: () => sink.abort(),
            };
            return gz(closing, out.gzip);
          },
        },
        done: async () => undefined,
        abort: async () => {
          for (const name of open) await out.handle.removeEntry(name).catch(() => {});
          open.clear();
        },
        kept: () => finished,
      };
    }
    case 'opfs': {
      let f: OpfsFile | null = null;
      return {
        outs: {
          main: async () => gz((f = await opfsFile(out.name)), out.gzip),
          part: () => Promise.reject(new JobError('No output')),
        },
        done: async () => (f ? f.file() : undefined),
        abort: async () => {
          await f?.abort().catch(() => {});
        },
        kept: nothing,
      };
    }
    case 'zip': {
      const f = await opfsFile(out.name);
      let spool: OpfsFile;
      try {
        spool = await opfsFile(spoolName(out.name));
      } catch (e) {
        await f.abort().catch(() => {});
        throw e;
      }
      const zip = new ZipWriter(f, spool);
      return {
        outs: {
          main: () => Promise.reject(new JobError('No output')),
          part: async (k) => gz(zip.entry(partName(out.names, k)), out.gzip),
        },
        done: async () => {
          await zip.close();
          return f.file();
        },
        abort: () => zip.abort(),
        kept: nothing,
      };
    }
  }
}

const messageOf = (e: unknown): string => {
  if (e instanceof Stopped) return 'Stopped';
  if (e instanceof SpaceError) return 'Not enough storage space';
  if (e instanceof NoStorageError) return 'No storage';
  if (e instanceof Error && KNOWN_ERRORS.has(e.message)) return e.message;
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'Not enough storage space';
  if (e instanceof DOMException && (e.name === 'NotReadableError' || e.name === 'NotFoundError')) return 'Read failed';
  return 'Command failed';
};

/** Decompresses `file` (gzip): in memory up to `limit` bytes, else into OPFS file `name`. */
async function gunzip(file: Blob, name: string, limit: number, progress: (read: number, out: number) => void, stopped: () => boolean): Promise<{ blob?: Blob; file?: File; size: number }> {
  let read = 0;
  const counted = file.stream().pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        read += chunk.length;
        c.enqueue(chunk);
      },
    }),
  );
  const r = counted.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>).getReader();
  let mem: Uint8Array[] | null = [];
  let size = 0;
  let f: OpfsFile | null = null;
  // (Small pieces are gathered into 4 MiB writes.)
  let buf = new Uint8Array(4 << 20);
  let pos = 0;
  const put = (b: Uint8Array) => {
    if (mem) {
      mem.push(b);
      return;
    }
    let at = 0;
    while (at < b.length) {
      const n = Math.min(b.length - at, buf.length - pos);
      buf.set(b.subarray(at, at + n), pos);
      pos += n;
      at += n;
      if (pos === buf.length) {
        f!.write(buf);
        buf = new Uint8Array(buf.length);
        pos = 0;
      }
    }
  };
  let last = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await r.read();
      } catch {
        throw new JobError('Not a gzip file');
      }
      if (chunk.done) break;
      const v = chunk.value;
      size += v.length;
      put(v);
      if (mem && size > limit) {
        f = await opfsFile(name);
        const held = mem;
        mem = null;
        for (const m of held) put(m);
      }
      const now = Date.now();
      if (now - last > 100) {
        last = now;
        progress(read, size);
        if (stopped()) {
          await r.cancel().catch(() => {});
          throw new Stopped();
        }
      }
    }
    if (mem) return { blob: new Blob(mem as Uint8Array<ArrayBuffer>[]), size };
    if (pos) f!.write(buf.subarray(0, pos));
    await f!.close();
    return { file: await f!.file(), size };
  } catch (e) {
    await f?.abort().catch(() => {});
    throw e;
  }
}

export function serve(port: ServePort) {
  const stops = new Set<number>();
  const reply = (r: StreamReply) => port.postMessage(r);

  const run = async (q: Extract<StreamRequest, { op: 'run' }>) => {
    let abort: () => Promise<void> = async () => {};
    let kept: () => number = () => 0;
    try {
      const written = { bytes: 0 };
      const o = await outputsFor(q.out, written);
      abort = o.abort;
      kept = o.kept;
      let last = 0;
      const result = await runJob(blobSource(q.file, q.skip), q.job, o.outs, {
        stopped: () => stops.has(q.id),
        progress: (d, total) => {
          const now = Date.now();
          if (now - last < 100 && d < total) return;
          last = now;
          reply({ id: q.id, type: 'progress', done: d, total });
        },
        report: (report) => reply({ id: q.id, type: 'shape', report }),
      });
      const file = await o.done();
      if (q.out.kind !== 'none') result.bytes = written.bytes;
      reply({ id: q.id, type: 'done', result, file });
    } catch (e) {
      // (What it opened is closed and deleted: a temporary output that won't be downloaded goes at once.)
      await abort().catch(() => {});
      if (q.out.kind === 'opfs' || q.out.kind === 'zip') await removeTemp(q.out.name);
      if (q.out.kind === 'zip') await removeTemp(spoolName(q.out.name));
      reply({ id: q.id, type: 'error', error: messageOf(e), at: e instanceof JobError ? e.at : -1, parts: kept() });
    } finally {
      stops.delete(q.id);
    }
  };

  port.onmessage = (e) => {
    const q = e.data as StreamRequest;
    if (q.op === 'stop') stops.add(q.target);
    else if (q.op === 'run') void run(q);
    else if (q.op === 'gunzip') {
      void gunzip(
        q.file,
        q.name,
        q.limit,
        (done, out) => reply({ id: q.id, type: 'progress', done, total: q.file.size, out }),
        () => stops.has(q.id),
      ).then(
        (r) => reply({ id: q.id, type: 'done', result: null, blob: r.blob, file: r.file, size: r.size }),
        (err) => reply({ id: q.id, type: 'error', error: messageOf(err), at: -1 }),
      );
    }
  };
}
