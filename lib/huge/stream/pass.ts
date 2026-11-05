/**
 * One streamed pass over bytes [start, end) of a document: chunks read ahead (two 16 MiB reads in flight,
 * `slice().arrayBuffer()`: the read the research measured fastest across engines for a whole-file pass), fed
 * to a walker in order, what the visitor wrote handed to its sinks between chunks and whenever too much waits
 * (the job pauses the walker then), progress, and a stop that takes effect between chunks and pauses.
 */
import type { ByteSource } from '../../json/tape-wasm';
import type { Walker } from './walk';

/** Bytes of a document, read asynchronously. */
export interface Source {
  readonly size: number;
  read(at: number, len: number): Promise<Uint8Array>;
}

/** A File (or Blob) as a Source; `skip`: bytes before the document (a UTF-8 byte order mark). */
export function blobSource(file: Blob, skip = 0): Source {
  return {
    size: file.size - skip,
    read: async (at, len) => new Uint8Array(await file.slice(skip + at, skip + at + len).arrayBuffer()),
  };
}

/** A synchronous ByteSource (tests: documents made on the fly) as a Source; reads are copied (the source may reuse its buffer). */
export function syncSource(src: ByteSource): Source {
  return { size: src.size, read: async (at, len) => src.read(at, len).slice(0, len) };
}

/** Resolves in a new task (a MessageChannel message: timers would be clamped), so a stop request is seen between chunks. */
const nextTask = () =>
  new Promise<void>((done) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      done();
    };
    ch.port2.postMessage(0);
  });

export class Stopped extends Error {
  constructor() {
    super('Stopped');
  }
}

export interface PassOptions {
  /** Bytes a read (default 16 MiB) and reads in flight (default 2). */
  chunk?: number;
  ahead?: number;
  /** Checked between chunks: true stops the pass (it throws Stopped). */
  stopped?: () => boolean;
  /** Bytes read so far (of end - start), after each chunk. */
  progress?: (done: number) => void;
  /** Called after each chunk and whenever the visitor paused the walker: hands its output on. */
  flush?: () => Promise<void> | void;
  /** After this many bytes the pass may end early: the visitor says so with `walker.pause` and `done()`. */
  done?: () => boolean;
}

/** Reads [start, end) of `src` through `walker`; `finish`: the walker is told the document ended there. */
export async function pass(src: Source, start: number, end: number, walker: Walker, o: PassOptions = {}, finish = true): Promise<void> {
  const chunk = o.chunk ?? 16 << 20;
  const ahead = o.ahead ?? 2;
  const reads: Promise<Uint8Array>[] = [];
  let next = start;
  const issue = () => {
    while (reads.length < ahead && next < end) {
      const len = Math.min(chunk, end - next);
      const p = src.read(next, len);
      // (A read failing while an earlier one is awaited is reported when its turn comes.)
      p.catch(() => {});
      reads.push(p);
      next += len;
    }
  };
  let at = start;
  let yielded = performance.now();
  issue();
  while (reads.length) {
    const b = await reads.shift()!;
    if (o.stopped?.()) throw new Stopped();
    issue();
    let i = 0;
    for (;;) {
      i = walker.feed(b, at, i);
      if (o.done?.()) return;
      if (i >= b.length) break;
      // (Paused: its output goes to the sink first; a stop request gets its turn now and then.)
      await o.flush?.();
      if (performance.now() - yielded > 30) {
        await nextTask();
        yielded = performance.now();
      }
      if (o.stopped?.()) throw new Stopped();
    }
    at += b.length;
    await o.flush?.();
    o.progress?.(at - start);
    // (Reads already here resolve at once: messages, a stop among them, get their turn now and then.)
    if (performance.now() - yielded > 30) {
      await nextTask();
      yielded = performance.now();
    }
  }
  if (finish) walker.finish(end);
  await o.flush?.();
}
