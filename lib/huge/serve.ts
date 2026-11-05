/**
 * The worker's side of protocol.ts: one document (HugeDoc) per worker, indexed in steps between which
 * requests are answered (the views browse what's read while the rest is read), and finds that stream their
 * matches and can be stopped. Edits (editor.ts) read the document again around them in the same steps; saves
 * stream it to a file or a Blob; a session of edits is kept (session-store.ts) for the file to be reopened.
 * huge.worker.ts runs it on the worker's own port; tests run it in process.
 */
import type { ByteSource } from '../json/tape-wasm';
import { HugeDoc, type EditOp, type Parsers } from './doc';
import { HugeEditor } from './editor';
import { piecesOf } from './pieces';
import { fingerprint, Keeper, keptSteps, opsOf, sessionKey, sweepOf, type Kept, type SessionStore } from './session-store';
import { Wait, watched } from './wait';
import type { Reply, Request } from './protocol';
import type { Prefetch } from './prefetch';
import type { FindBatch, HugeEdited, HugePage, HugeSummary } from './types';

/** Pins scoped to a query or a find's step (bytes.ts BlockSource). */
interface Scoped {
  open(): Set<number>;
  enter(s: Set<number>): Set<number>;
  leave(): void;
  close(s: Set<number>): void;
}

export interface ServePort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

/** Indexing runs this long between looks at the requests (ms): a request waits at most this for a step to end (10 ms
 * costs indexing nothing measurable; 25 ms held every first query back by ~12 ms on average). */
const SLICE = 10;
/** An edit reads the document again for at most this long before it replies (ms); the rest goes on in steps. */
const EDIT_MS = 50;
/** The same for a keystroke (`replace(…, typing)`: the Format view's typing), so typing never waits long behind a change that reads on (an unbalanced bracket): the rest in steps. */
const TYPING_MS = 8;
/** Progress is posted at most this often (ms). */
const PROGRESS = 100;
/** A session is kept this long after the last edit (ms). */
const KEEP_MS = 1000;
/** A save writes this many bytes at a time (progress, cancel). */
const WRITE = 64 << 20;

/** Messages this worker may send as an error (others are replaced: they could say something of the document). */
const KNOWN = new Set(['Out of memory', 'Nesting is too deep to format', 'No document', 'Read failed', 'Not ready', 'Not allowed', 'Invalid JSON', 'Too big', 'Out of range', 'Save failed', 'Cancelled']);
/** Tries of a query that waits (blocks to read, the parser to load) before it fails. */
const TRIES = 256;

const enc = new TextEncoder();

/** Resolves in a new task (a MessageChannel message: timers would be clamped). */
const nextTask = () =>
  new Promise<void>((done) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      done();
    };
    ch.port2.postMessage(0);
  });

/**
 * `sourceOf`: random reads of a file (queries). `aheadOf`: the indexing pass's read-ahead source (prefetch.ts), or
 * none (the indexing pass reads through `sourceOf`). `store`: where sessions of edits are kept (none: not kept).
 */
export function serve(port: ServePort, load: () => Promise<{ huge: WebAssembly.Module; parsers: Parsers }>, sourceOf: (file: Blob) => ByteSource, aheadOf?: (file: Blob) => Pick<Prefetch, 'has' | 'need' | 'read' | 'size'>, store?: SessionStore) {
  let doc: HugeDoc | null = null;
  let editor: HugeEditor | null = null;
  let file: Blob | null = null;
  /**
   * The document's source for queries; one that reads async blocks (bytes.ts BlockSource) pins what a scope reads
   * until it's closed: a scope per query (kept while it's asked again after a Wait) and per step of a find.
   */
  let src: (ByteSource & Partial<Scoped>) | null = null;
  let ahead: Pick<Prefetch, 'has' | 'need' | 'read' | 'size'> | undefined;
  // A stop that came before the document existed.
  let stopNow = false;
  // Requests that come before the document exists (its modules still loading) wait for it.
  let opened: () => void = () => {};
  const made = new Promise<void>((done) => (opened = done));
  const finds = new Map<number, boolean>();
  // Queries waiting for reads (or the parser): indexing pauses until they're answered, or each would wait out
  // a step (up to SLICE ms) every time it's asked again.
  let held = 0;
  let resume: (() => void) | null = null;
  const unhold = () => {
    if (--held === 0 && resume) {
      resume();
      resume = null;
    }
  };
  // Reading in steps (opening, or again after an edit): one loop at a time; the watch stream hears of it.
  let stepping = false;
  let watchId = -1;
  // A save under way (edits wait for it), and the ones asked to stop.
  let saving = false;
  const stopSave = new Set<number>();
  // Sessions: this file's key (its name as opened, size, last modified) and content (fingerprint); the session
  // found for it, on offer until put back or dropped (new edits don't overwrite it meanwhile); what's stored of
  // this document's edits (keeper: a keep writes what's new) and the version it holds (-1: none); the keep timer.
  let key = '';
  let name = '';
  let print = '';
  let kept: Kept | null = null;
  const keeper = new Keeper();
  let keptVersion = -1;
  let keepTimer: ReturnType<typeof setTimeout> | null = null;
  // Whether the look for a kept session has ended (none to look in: it has), and the open's summary gone out (a
  // look that ends after it sends its own through the watch stream).
  let looked = !store;
  let readySent = false;
  // (Owed before the watch stream was asked for: a small document can be read before its request comes.)
  let pushOwed = false;

  const reply = (r: Reply, transfer: Transferable[] = []) => port.postMessage(r, transfer);
  const fail = (id: number, e: unknown) => reply({ id, ok: false, error: e instanceof Error && KNOWN.has(e.message) ? e.message : 'Query failed' });

  const summary = (): HugeSummary => {
    const s = doc!.summary();
    // (undefined while the look for one is under way.)
    const session = !looked ? undefined : kept ? { steps: keptSteps(kept), bytes: kept.bytes, time: kept.time, restorable: unedited() } : null;
    if (!editor) return session === undefined ? s : { ...s, session };
    return { ...s, edited: doc!.src.edited, version: doc!.src.version, canUndo: editor.canUndo, canRedo: editor.canRedo, steps: editor.applied, editBytes: doc!.src.editBytes + editor.historyBytes, session };
  };

  /** Steps until the document is all read: progress on `id` (open) or the watch stream, then the summary. */
  const run = async (id: number) => {
    stepping = true;
    let shown = 0;
    try {
      while (!doc!.done && !doc!.stopped) {
        const where = ahead ? doc!.indexAt : null;
        if (ahead && where) {
          // (Reads ahead; waits only if the parse caught up with the reads.)
          const [at, len] = where;
          const ready = ahead.need(at, len);
          if (!ahead.has(at, len)) await ready;
        }
        if (held) await new Promise<void>((done) => (resume = done));
        try {
          if (doc!.step(performance.now() + SLICE)) break;
        } catch (e) {
          // (Blocks or the parser not here yet.)
          if (!(e instanceof Wait)) throw e;
          await e.until();
          continue;
        }
        const now = performance.now();
        if (now - shown >= PROGRESS && id >= 0) {
          shown = now;
          reply({ id, ok: true, value: doc!.progress(), done: false });
        }
        await nextTask();
      }
    } finally {
      stepping = false;
    }
    if (id >= 0) {
      if (id !== watchId) readySent = true;
      reply({ id, ok: true, value: summary(), done: id !== watchId });
    }
  };

  /** After an edit: reads on in steps (if it isn't all read yet), and keeps the session soon. */
  const edited = (): HugeEdited => {
    if (!doc!.done && !stepping) void run(watchId).catch(() => {});
    if (store && key) {
      if (keepTimer) clearTimeout(keepTimer);
      keepTimer = setTimeout(() => void keepNow().catch(() => {}), KEEP_MS);
    }
    return { version: doc!.src.version, done: doc!.done, canUndo: editor!.canUndo, canRedo: editor!.canRedo, steps: editor!.applied, summary: doc!.done ? summary() : null };
  };

  /** Whether the document is the file as opened: no edit, nothing to undo or redo (a session is put back only then). */
  const unedited = () => !doc!.src.edited && !editor?.canUndo && !editor?.canRedo;

  /**
   * Keeps the edits as a session now: what's new of them (keeper), the record (`keeping` until it's stored: closing
   * waits for it). Whether this document's edits are stored. Not while a session found for the file is on offer: it
   * isn't overwritten before it's put back or dropped.
   */
  let keeping: Promise<boolean> | null = null;
  const keepNow = (): Promise<boolean> => {
    keepTimer = null;
    if (!store || !key || !editor || kept) return Promise.resolve(false);
    const d = doc!;
    const version = d.src.version;
    const plan = d.src.edited ? keeper.plan(d.src.list, editor.history.steps, editor.history.applied, editor.droppedSteps, d.src.base.size, print) : null;
    const k = key;
    const p: Promise<boolean> = (plan ? store.put(k, plan.kept, plan.add, plan.drop) : store.delete(k).then(() => keeper.reset()))
      .then(
        () => {
          keptVersion = plan ? version : -1;
          return !!plan;
        },
        // (Not stored: what the keeper counted on isn't either; the key's record and chunks go, to start over.)
        () => {
          keptVersion = -1;
          keeper.reset();
          return store.delete(k).then(
            () => false,
            () => false,
          );
        },
      )
      .finally(() => {
        if (keeping === p) keeping = null;
      });
    keeping = p;
    return p;
  };

  const dropKept = async () => {
    if (keepTimer) clearTimeout(keepTimer);
    keepTimer = null;
    kept = null;
    keptVersion = -1;
    keeper.reset();
    if (store && key) await store.delete(key);
  };

  const ed = (): HugeEditor => {
    if (saving || !doc || !doc.editable) throw new Error('Not ready');
    return (editor ??= new HugeEditor(doc));
  };

  const open = async (id: number, f: Blob, options: import('./types').HugeOptions) => {
    const { huge, parsers } = await load();
    file = f;
    ahead = aheadOf?.(f);
    // (The read-ahead starts now: the first pages can take the start of the file from it.)
    void ahead?.need(0, 1 << 20).catch(() => {});
    src = sourceOf(f);
    for (;;) {
      try {
        doc = new HugeDoc(src, huge, parsers, options, { index: ahead });
        break;
      } catch (e) {
        // (Its first bytes (a byte order mark?) read first.)
        if (!(e instanceof Wait)) throw e;
        await e.until();
      }
    }
    // A session kept for this file (looked up while it's read): its content checked (another file with the same
    // name, size and time is another); old sessions swept.
    if (store) {
      name = options.name ?? (f as File).name ?? '';
      key = sessionKey(name, f.size, (f as File).lastModified ?? 0);
      const d = doc;
      void fingerprint(f)
        .then(async (fp) => {
          print = fp;
          const k = await store.get(key);
          if (k && (k.print !== print || k.base !== d.src.base.size)) await store.delete(key);
          else kept = k;
          const gone = sweepOf(await store.list(), Date.now(), key);
          for (const x of gone) await store.delete(x);
        })
        .catch(() => {})
        .then(() => {
          looked = true;
          // (Ended after the open's summary went out: a summary through the watch stream says what it found.)
          if (!readySent || !doc) return;
          if (watchId >= 0) reply({ id: watchId, ok: true, value: summary(), done: false });
          else pushOwed = true;
        });
    }
    opened();
    if (stopNow) doc.stop();
    await run(id);
  };

  const find = async (id: number, query: string, options: import('./types').FindOptions) => {
    finds.set(id, true);
    const it = doc!.find(query, options);
    // (Each step pins what it reads, and what's fetched for it when it waits; the step before lets go of its own
    // then. So the blocks a step waited for stay until the next step has read them, and a scan with no match, which
    // has no batch till the end, holds two steps' blocks at most, not all it has read.)
    let scope: Set<number> | null = null;
    try {
      for (;;) {
        if (!finds.get(id)) {
          reply({ id, ok: true, value: { matches: new Float64Array(0), length: 0, scanned: 0, done: true } satisfies FindBatch, done: true });
          break;
        }
        const before = scope;
        scope = src?.open?.() ?? null;
        let r: IteratorResult<FindBatch | { wait: Wait }>;
        try {
          r = it.next();
        } finally {
          src?.leave?.();
          if (before) src!.close!(before);
        }
        if (r.done) break;
        if ('wait' in r.value) {
          await r.value.wait.until();
          continue;
        }
        const b = r.value;
        reply({ id, ok: true, value: b, done: b.done }, [b.matches.buffer]);
        if (b.done) break;
        await nextTask();
      }
    } finally {
      if (scope) src?.close?.(scope);
      finds.delete(id);
    }
  };

  /** The document's bytes [start, end) as Blob parts: the file's slices and edits' bytes (nothing copied). */
  const parts = (start: number, end: number): (Blob | Uint8Array)[] => {
    const d = doc!;
    const out: (Blob | Uint8Array)[] = [];
    for (const p of d.src.slice(start, end)) out.push(p.buf ? p.buf.subarray(p.off, p.off + p.len) : file!.slice(d.bom + p.off, d.bom + p.off + p.len));
    return out;
  };

  const save = async (id: number, handle: FileSystemFileHandle | null, inPlace: boolean) => {
    const d = doc!;
    if (saving) throw new Error('Not ready');
    const size = d.size;
    // (The document now, with its byte order mark: edits wait until it's written.)
    const all = [...(d.bom ? [file!.slice(0, d.bom)] : []), ...parts(0, d.src.size)];
    if (!handle) {
      // (A copy to download: the opened file and the session kept for it stay as they are.)
      reply({ id, ok: true, value: { written: size, size, done: true, blob: new Blob(all as BlobPart[]) }, done: true });
      return;
    }
    saving = true;
    let w: FileSystemWritableFileStream | null = null;
    try {
      w = await handle.createWritable();
      let written = 0;
      let shown = 0;
      for (const part of all) {
        const n = part instanceof Blob ? part.size : part.length;
        for (let o = 0; o < n; o += WRITE) {
          if (stopSave.has(id)) throw new Error('Cancelled');
          const piece = part.slice(o, Math.min(n, o + WRITE));
          await watched(() => w!.write(piece as Blob));
          written += (piece as Blob | Uint8Array) instanceof Blob ? (piece as Blob).size : (piece as Uint8Array).length;
          const now = performance.now();
          if (now - shown >= PROGRESS) {
            shown = now;
            reply({ id, ok: true, value: { written, size, done: false }, done: false });
          }
        }
      }
      await w.close();
      w = null;
      if (inPlace) {
        // The file is the document now: read from it, nothing edited, no history (it read the old file).
        const nf = await handle.getFile();
        file = nf;
        src = sourceOf(nf);
        for (;;) {
          try {
            d.rebase(src);
            break;
          } catch (e) {
            // (Its first bytes (a byte order mark?) read first.)
            if (!(e instanceof Wait)) throw e;
            await e.until();
          }
        }
        editor?.clear();
        // (The session was the old file's: gone; edits from now on are kept under the new file's key.)
        await dropKept();
        if (store) {
          key = sessionKey(name, nf.size, nf.lastModified);
          print = await fingerprint(nf);
        }
      }
      // (Saved as another file: the opened file and its session stay as they are.)
      reply({ id, ok: true, value: { written, size, done: true }, done: true });
    } catch (e) {
      try {
        await w?.abort();
      } catch {
        // (Already gone.)
      }
      throw e instanceof Error && KNOWN.has(e.message) ? e : new Error('Save failed');
    } finally {
      saving = false;
      stopSave.delete(id);
    }
  };

  /** Puts the kept session back: only onto the file as opened (an edit since would have its changes land elsewhere). */
  const restoreSession = async (id: number) => {
    const e = ed();
    if (!kept || !doc!.done || !store) throw new Error('Not ready');
    if (!unedited()) throw new Error('Not allowed');
    const k = kept;
    const chunks = await store.chunks(key, keeper.chunksOf(k));
    // (Edited, or put back or dropped, while its bytes were read.)
    if (kept !== k || !unedited() || saving) throw new Error('Not allowed');
    let got: ReturnType<Keeper['load']>;
    try {
      got = keeper.load(k, chunks);
    } catch {
      // (Its bytes aren't all there: it can't be put back.)
      await dropKept();
      throw new Error('Not allowed');
    }
    e.doc.edit(opsOf(got.pieces, doc!.src.base.size), performance.now() + EDIT_MS);
    e.restoreHistory(got.steps, k.applied, k.dropped);
    kept = null;
    // (Stored as it is: the next keep writes what's new.)
    keptVersion = doc!.src.version;
    reply({ id, ok: true, value: edited(), done: true });
  };

  port.onmessage = (e) => {
    const m = e.data as Request;
    if (m.op === 'open') {
      open(m.id, m.file, m.options).catch((err) => {
        fail(m.id, err);
        // (Requests waiting for it fail too: there is none.)
        opened();
      });
      return;
    }
    if (m.op === 'cancel') {
      finds.set(m.target, false);
      stopSave.add(m.target);
      reply({ id: m.id, ok: true, value: null, done: true });
      return;
    }
    if (m.op === 'close') {
      // (Edits not kept yet, a second after the last one: kept now, so closing loses none; one being kept: awaited.
      // The answer: whether this document's edits are kept (none, too big, a session on offer, a failed write: no).)
      const owed = keepTimer !== null;
      if (keepTimer) clearTimeout(keepTimer);
      keepTimer = null;
      void (owed ? keepNow() : (keeping ?? Promise.resolve(false))).then(() =>
        reply({ id: m.id, ok: true, value: { kept: !!doc && doc.src.edited && keptVersion === doc.src.version }, done: true }),
      );
      return;
    }
    if (m.op === 'stop') {
      if (doc) doc.stop();
      else stopNow = true;
      reply({ id: m.id, ok: true, value: null, done: true });
      return;
    }
    if (m.op === 'watch') {
      watchId = m.id;
      if (pushOwed) {
        pushOwed = false;
        reply({ id: watchId, ok: true, value: summary(), done: false });
      }
      return;
    }
    if (doc) answer(m);
    else void made.then(() => answer(m));
  };

  const answer = (m: Request, tries = 0, scope: Set<number> | null = null) => {
    let waiting = false;
    // (Its blocks pinned while it runs and while it's asked again; another query's own scope holds theirs.)
    const s = scope ? src!.enter!(scope) : (src?.open?.() ?? null);
    try {
      if (!doc) throw new Error('No document');
      const until = performance.now() + EDIT_MS;
      switch (m.op) {
        case 'summary':
          return reply({ id: m.id, ok: true, value: summary(), done: true });
        case 'children': {
          const page: HugePage = doc.children(m.node, m.from, m.count);
          const t = page.tape;
          return reply({ id: m.id, ok: true, value: page, done: true }, [t.nodes.buffer, t.text.buffer, t.offsets.buffer, t.extraAt.buffer, page.map.buffer]);
        }
        case 'pretty':
          return reply({ id: m.id, ok: true, value: doc.prettyLines(m.from, m.count, m.indent, m.max), done: true });
        case 'prettyClose':
          return reply({ id: m.id, ok: true, value: doc.prettyClose(m.line), done: true });
        case 'raw':
          return reply({ id: m.id, ok: true, value: doc.rawLines(m.from, m.count, m.max), done: true });
        case 'locate':
          return reply({ id: m.id, ok: true, value: doc.locate(m.pos), done: true });
        case 'resolve':
          return reply({ id: m.id, ok: true, value: doc.resolve(m.path, m.at), done: true });
        case 'text':
          return reply({ id: m.id, ok: true, value: doc.text(m.start, m.end, m.max), done: true });
        case 'find':
          find(m.id, m.query, m.options).catch((err) => fail(m.id, err));
          return;
        case 'slice':
          return reply({ id: m.id, ok: true, value: new Blob(parts(Math.max(0, m.start), Math.min(doc.src.size, m.end)) as BlobPart[]), done: true });
        // Edits: each is one undo step; reads (a node's place) come before any change, so one that waits is asked again whole.
        case 'edit': {
          const ops: EditOp[] = m.ops.map((o) => ({ a: o.a, b: o.b, put: piecesOf(enc.encode(o.text)) }));
          ed().apply(ops, m.typing ? performance.now() + TYPING_MS : until, m.typing);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        }
        case 'setValue':
          ed().setValue(m.node, m.json, until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'rename':
          ed().rename(m.parent, m.index, m.name, until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'remove':
          ed().remove(m.parent, m.index, until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'insert':
          ed().insert(m.parent, m.index, m.json, m.name, until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'duplicate':
          ed().duplicate(m.parent, m.index, until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'replaceNode':
          ed().replaceNode(m.node, m.text, until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'undo':
          ed().undo(until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'redo':
          ed().redo(until);
          return reply({ id: m.id, ok: true, value: edited(), done: true });
        case 'nodeText':
          return reply({ id: m.id, ok: true, value: (editor ?? new HugeEditor(doc)).nodeText(m.node, m.max), done: true });
        case 'save':
          save(m.id, m.handle, m.inPlace).catch((err) => fail(m.id, err));
          return;
        case 'restoreSession':
          restoreSession(m.id).catch((err) => fail(m.id, err));
          return;
        case 'dropSession':
          dropKept().then(
            () => {
              // (Dropped to keep this document's edits instead: from now on. Else nothing till the next edit.)
              if (m.keepEdits && doc!.src.edited && store && key) keepTimer = setTimeout(() => void keepNow().catch(() => {}), KEEP_MS);
              reply({ id: m.id, ok: true, value: null, done: true });
            },
            (err) => fail(m.id, err),
          );
          return;
      }
    } catch (err) {
      // (Blocks to read or the parser to load first: asked again then.)
      if (err instanceof Wait && tries < TRIES) {
        waiting = true;
        held++;
        err.until().then(
          () => {
            answer(m, tries + 1, s);
            unhold();
          },
          (e) => {
            if (s) src?.close?.(s);
            fail(m.id, e);
            unhold();
          },
        );
        return;
      }
      fail(m.id, err);
    } finally {
      // (Done with its blocks, unless asked again after a Wait: then only out of its scope until then.)
      if (s && !waiting) src?.close?.(s);
      else src?.leave?.();
    }
  };
}
