/**
 * Huge-file mode from the page: a document read and queried in a worker (huge.worker.ts), every answer
 * async. See docs/huge-files/API.md. Load this module dynamically, only once a huge file is opened.
 *
 *   const doc = openHuge(file, { name: file.name }, (p) => showProgress(p.bytes / p.size));
 *   const summary = await doc.ready;            // or doc.summary() while indexing
 *   const page = await doc.children(summary.root!, 0, 1000);
 */
import type { Answer, Reply, Request } from './protocol';
import type { Bytes, FindBatch, FindOptions, HugeLines, HugeLocation, HugeNode, HugeOptions, HugePage, HugeProgress, HugeSummary, Seg } from './types';
import { parsePath } from '../json/path';

/** What the client talks to: a Worker, or (tests) anything that passes messages the same way. */
export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  terminate?(): void;
}

type Pending = { done: (v: unknown) => void; fail: (e: Error) => void; each?: (v: unknown) => void };

// Without the `op` and `id`: what each request takes.
type Args<O extends Request['op']> = Omit<Extract<Request, { op: O }>, 'id' | 'op'>;

/** Lines a pretty or raw line is cut at by default (a view shows the start of a long line). */
export const LINE_MAX = 1 << 16;

export class HugeClient {
  /** The summary once the whole document is read (the first problem, if any, is in it). */
  readonly ready: Promise<HugeSummary>;
  private port: Port;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private closed = false;
  /** Bytes before the document's first (a UTF-8 byte order mark), known from the first summary. */
  private bom = 0;

  constructor(
    readonly file: Blob,
    options: HugeOptions = {},
    onProgress?: (p: HugeProgress) => void,
    port?: Port,
  ) {
    this.port = port ?? (new Worker(new URL('./huge.worker.ts', import.meta.url)) as unknown as Port);
    this.port.onmessage = (e) => this.receive(e.data as Reply);
    this.ready = this.ask('open', { file, options }, (v) => onProgress?.(v as HugeProgress)).then((s) => this.saw(s as HugeSummary));
  }

  private receive(r: Reply) {
    const p = this.pending.get(r.id);
    if (!p) return;
    if (!r.ok) {
      this.pending.delete(r.id);
      p.fail(new Error(r.error));
    } else if (r.done) {
      this.pending.delete(r.id);
      p.done(r.value);
    } else p.each?.(r.value);
  }

  private ask<O extends Request['op']>(op: O, args: Args<O>, each?: (v: unknown) => void): Promise<Answer[O]> {
    if (this.closed) return Promise.reject(new Error('Closed'));
    const id = ++this.seq;
    return new Promise((done, fail) => {
      this.pending.set(id, { done: done as (v: unknown) => void, fail, each });
      this.port.postMessage({ id, op, ...args });
    });
  }

  private saw(s: HugeSummary): HugeSummary {
    this.bom = s.bom;
    return s;
  }

  /** The summary now: while indexing, counts so far (`done` false). */
  summary(): Promise<HugeSummary> {
    return this.ask('summary', {}).then((s) => this.saw(s));
  }

  /** Children [from, from + count) of `node` (a big container or the LIST), parsed. While indexing, only what's read. */
  children(node: HugeNode, from: number, count = 1000): Promise<HugePage> {
    return this.ask('children', { node, from, count });
  }

  /** Lines [from, from + count) of the pretty form with `indent` (as the Format view writes it), each cut at `max`. */
  prettyLines(from: number, count: number, indent = '  ', max = LINE_MAX): Promise<HugeLines> {
    return this.ask('pretty', { from, count, indent, max });
  }

  /** The closing line of pretty line `line` (an opening line), or -1. */
  prettyClose(line: number): Promise<number> {
    return this.ask('prettyClose', { line });
  }

  /** Lines [from, from + count) of the text as stored, each cut at `max` bytes. */
  rawLines(from: number, count: number, max = LINE_MAX): Promise<HugeLines> {
    return this.ask('raw', { from, count, max });
  }

  /** The value at byte `pos` (the deepest whose text holds it, as the editor's caret selects), with its path. */
  locate(pos: Bytes): Promise<HugeLocation | null> {
    return this.ask('locate', { pos });
  }

  /** The value at `path` (`$.records[5000000].name`, `/records/5000000/name`, or segments), or null. */
  resolve(path: string | Seg[]): Promise<HugeLocation | null> {
    const segs = typeof path === 'string' ? parsePath(path) : path;
    return segs ? this.ask('resolve', { path: segs }) : Promise.resolve(null);
  }

  /** The text [start, end), at most `max` bytes of it (cut: true if there was more). */
  text(start: Bytes, end: Bytes, max = 1 << 20): Promise<{ text: string; cut: boolean }> {
    return this.ask('text', { start, end, max });
  }

  /** The bytes [start, end) as a Blob (the file's own: nothing is read): a value to save or copy. Call after a summary. */
  blob(start: Bytes, end: Bytes): Blob {
    return this.file.slice(this.bom + start, this.bom + end);
  }

  /**
   * Finds `query` (its UTF-8 bytes) in the document as stored: batches of matches as they come, the last with
   * `done`. Call the returned function to stop.
   */
  find(query: string, options: FindOptions, onBatch: (b: FindBatch) => void): () => void {
    let id = 0;
    const p = this.ask('find', { query, options }, (v) => onBatch(v as FindBatch));
    id = this.seq;
    p.then((last) => onBatch(last), () => {});
    return () => {
      if (this.pending.has(id)) void this.ask('cancel', { target: id });
    };
  }

  /** Stops indexing where it is: `ready` resolves with the summary (`stopped`); queries keep working on what was read. */
  stop(): Promise<null> {
    return this.ask('stop', {});
  }

  /** Stops the worker: the document is let go. */
  close() {
    this.closed = true;
    for (const p of this.pending.values()) p.fail(new Error('Closed'));
    this.pending.clear();
    this.port.terminate?.();
  }
}

/** Opens `file` in huge-file mode. */
export function openHuge(file: Blob, options: HugeOptions = {}, onProgress?: (p: HugeProgress) => void): HugeClient {
  return new HugeClient(file, options, onProgress);
}

export type { HugeLines, HugeLocation, HugeNode, HugePage, HugeSummary };
