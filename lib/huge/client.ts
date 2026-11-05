/**
 * Huge-file mode from the page: a document read and queried in a worker (huge.worker.ts), every answer
 * async. See docs/huge-files/API.md. Load this module dynamically, only once a huge file is opened.
 *
 *   const doc = openHuge(file, { name: file.name }, (p) => showProgress(p.bytes / p.size));
 *   const summary = await doc.ready;            // or doc.summary() while indexing
 *   const page = await doc.children(summary.root!, 0, 1000);
 */
import type { Answer, Reply, Request } from './protocol';
import type { Bytes, FindBatch, FindOptions, HugeEdited, HugeLines, HugeLocation, HugeNode, HugeOptions, HugePage, HugeProgress, HugeSaved, HugeSummary, Seg } from './types';
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
/** How long close() waits for the edits to be kept before the worker ends (ms). */
const CLOSE_MS = 10_000;

export class HugeClient {
  /** The summary once the whole document is read (the first problem, if any, is in it). */
  readonly ready: Promise<HugeSummary>;
  private port: Port;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private closed = false;
  /** Bytes before the document's first (a UTF-8 byte order mark), known from the first summary. */
  private bom = 0;
  /** Whether the document has been edited since it was opened (or saved in place): blob() reads the file only until then. */
  private changed = false;
  /** After an edit that wasn't all read again at once: the summary when it is (and progress meanwhile, through onProgress). */
  onSummary: ((s: HugeSummary) => void) | null = null;

  constructor(
    public file: Blob,
    options: HugeOptions = {},
    onProgress?: (p: HugeProgress) => void,
    port?: Port,
  ) {
    this.port = port ?? (new Worker(new URL('./huge.worker.ts', import.meta.url)) as unknown as Port);
    this.port.onmessage = (e) => this.receive(e.data as Reply);
    this.ready = this.ask('open', { file, options }, (v) => onProgress?.(v as HugeProgress)).then((s) => this.saw(s as HugeSummary));
    // (Never done: what reading again after edits says.)
    void this.ask('watch', {}, (v) => {
      const x = v as HugeProgress | HugeSummary;
      if ('status' in x) this.onSummary?.(this.saw(x));
      else onProgress?.(x);
    }).catch(() => {});
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

  /**
   * The value at `path` (`$.records[5000000].name`, `/records/5000000/name`, or segments), or null. `at`: per
   * segment, the child's index in its container where known (-1: by name): with duplicate names, which member.
   */
  resolve(path: string | Seg[], at?: number[]): Promise<HugeLocation | null> {
    const segs = typeof path === 'string' ? parsePath(path) : path;
    return segs ? this.ask('resolve', at ? { path: segs, at } : { path: segs }) : Promise.resolve(null);
  }

  /** The text [start, end), at most `max` bytes of it (cut: true if there was more). */
  text(start: Bytes, end: Bytes, max = 1 << 20): Promise<{ text: string; cut: boolean; bad?: Float64Array }> {
    return this.ask('text', { start, end, max });
  }

  /**
   * The bytes [start, end) as a Blob (the file's own: nothing is read): a value to save or copy. Call after a
   * summary, and only while the document isn't edited (else `slice`: the document's bytes are the edits' too).
   */
  blob(start: Bytes, end: Bytes): Blob {
    if (this.changed) throw new Error('Edited');
    return this.file.slice(this.bom + start, this.bom + end);
  }

  /** The document's bytes [start, end) as a Blob (the file's slices and the edits' bytes: nothing copied). */
  slice(start: Bytes, end: Bytes): Promise<Blob> {
    return this.ask('slice', { start, end });
  }

  // ── Edits (editor.ts): each is one undo step. Positions are the document's as it is when the edit is asked. ──

  private edits(p: Promise<HugeEdited>): Promise<HugeEdited> {
    return p.then((e) => {
      this.changed = true;
      if (e.summary) this.saw(e.summary);
      return e;
    });
  }

  /** Replaces bytes [a, b) with `text` (several changes at once: in order, each at the document the one before leaves). `typing`: joins the last step if it goes on from it. */
  replace(ops: { a: Bytes; b: Bytes; text: string }[], typing = false): Promise<HugeEdited> {
    return this.edits(this.ask('edit', { ops, typing }));
  }

  /** Sets `node`'s value to JSON `json` (re-indented for where it is). */
  setValue(node: HugeNode, json: string): Promise<HugeEdited> {
    return this.edits(this.ask('setValue', { node, json }));
  }

  /** Renames child `index` of object `parent`. */
  rename(parent: HugeNode, index: number, name: string): Promise<HugeEdited> {
    return this.edits(this.ask('rename', { parent, index, name }));
  }

  /** Removes child `index` of `parent` (a container or the LIST), with its separator. */
  remove(parent: HugeNode, index: number): Promise<HugeEdited> {
    return this.edits(this.ask('remove', { parent, index }));
  }

  /** Inserts JSON `json` as child `index` of `parent` (named `name` in an object; parent null: an empty document's value). */
  insert(parent: HugeNode | null, index: number, json: string, name: string | null = null): Promise<HugeEdited> {
    return this.edits(this.ask('insert', { parent, index, json, name }));
  }

  /** Copies child `index` of `parent` right after it (an object member: "<name> (copy)"). Any size: nothing is read. */
  duplicate(parent: HugeNode, index: number): Promise<HugeEdited> {
    return this.edits(this.ask('duplicate', { parent, index }));
  }

  /** `node`'s text for the normal editor (at most `max` bytes, else the error 'Too big'). */
  nodeText(node: HugeNode, max = 64 << 20): Promise<string> {
    return this.ask('nodeText', { node, max });
  }

  /** Puts `text` (from the normal editor) in place of `node` (re-indented if it's JSON). */
  replaceNode(node: HugeNode, text: string): Promise<HugeEdited> {
    return this.edits(this.ask('replaceNode', { node, text }));
  }

  undo(): Promise<HugeEdited> {
    return this.edits(this.ask('undo', {}));
  }

  redo(): Promise<HugeEdited> {
    return this.edits(this.ask('redo', {}));
  }

  /**
   * Writes the document: to `handle`'s file (File System Access; `inPlace`: the opened file, which the document
   * then reads: no edits, no history), or with no handle as a Blob to download (`blob` in the last answer). Progress
   * through `onSaved`; call the returned function to stop (the file is left as it was).
   */
  save(handle: FileSystemFileHandle | null, inPlace: boolean, onSaved?: (s: HugeSaved) => void): { done: Promise<HugeSaved>; stop: () => void } {
    const done = this.ask('save', { handle, inPlace }, (v) => onSaved?.(v as HugeSaved));
    const id = this.seq;
    return {
      done: done.then(async (s) => {
        if (inPlace && handle) {
          this.file = await handle.getFile();
          this.changed = false;
        }
        return s;
      }),
      stop: () => {
        if (this.pending.has(id)) void this.ask('cancel', { target: id });
      },
    };
  }

  /** Puts back the kept session of this file (summary.session): its edits and history. */
  restoreSession(): Promise<HugeEdited> {
    return this.edits(this.ask('restoreSession', {}));
  }

  /**
   * Drops the kept session (closing without keeping the edits: nothing is kept till a further edit). `keepEdits`:
   * dropping an earlier session, offered while this document was edited, so that its edits are kept instead.
   */
  dropSession(keepEdits = false): Promise<null> {
    return this.ask('dropSession', { keepEdits });
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
  /**
   * Closes the document: edits not kept yet as a session (it's kept a second after the last edit) are kept first,
   * so reopening the file offers them; then the worker ends. Other requests fail ('Closed') at once. Resolves once
   * the worker has ended (at most CLOSE_MS after: an unfinished keep then leaves the session as last kept), with
   * whether this document's edits are kept (false: none, too big to keep, an earlier session on offer, a failed
   * write, or not in time).
   */
  close(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    const id = this.seq + 1;
    const kept = this.ask('close', {}).then(
      (r) => r.kept,
      () => false,
    );
    this.closed = true;
    for (const [k, p] of this.pending) {
      if (k === id) continue;
      p.fail(new Error('Closed'));
      this.pending.delete(k);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((done) => (timer = setTimeout(() => done(false), CLOSE_MS)));
    return Promise.race([kept, late]).then((k) => {
      clearTimeout(timer);
      this.pending.clear();
      this.port.terminate?.();
      return k;
    });
  }
}

/** Opens `file` in huge-file mode. */
export function openHuge(file: Blob, options: HugeOptions = {}, onProgress?: (p: HugeProgress) => void): HugeClient {
  return new HugeClient(file, options, onProgress);
}

export type { HugeEdited, HugeLines, HugeLocation, HugeNode, HugePage, HugeSaved, HugeSummary };
