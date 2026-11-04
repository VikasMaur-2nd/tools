/**
 * The worker's side of protocol.ts: one document (HugeDoc) per worker, indexed in steps between which
 * requests are answered (the views browse what's read while the rest is read), and finds that stream their
 * matches and can be stopped. huge.worker.ts runs it on the worker's own port; tests run it in process.
 */
import type { ByteSource } from '../json/tape-wasm';
import { HugeDoc, type Parsers } from './doc';
import type { Reply, Request } from './protocol';
import type { FindBatch, HugePage } from './types';

export interface ServePort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

/** Indexing runs this long between looks at the requests (ms). */
const SLICE = 25;
/** Progress is posted at most this often (ms). */
const PROGRESS = 100;

/** Messages this worker may send as an error (others are replaced: they could say something of the document). */
const KNOWN = new Set(['Out of memory', 'Nesting is too deep to format', 'No document']);

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

export function serve(port: ServePort, load: () => Promise<{ huge: WebAssembly.Module; parsers: Parsers }>, sourceOf: (file: Blob) => ByteSource) {
  let doc: HugeDoc | null = null;
  const finds = new Map<number, boolean>();
  const reply = (r: Reply, transfer: Transferable[] = []) => port.postMessage(r, transfer);
  const fail = (id: number, e: unknown) => reply({ id, ok: false, error: e instanceof Error && KNOWN.has(e.message) ? e.message : 'Query failed' });

  const open = async (id: number, file: Blob, options: import('./types').HugeOptions) => {
    const { huge, parsers } = await load();
    doc = new HugeDoc(sourceOf(file), huge, parsers, options);
    let shown = 0;
    while (!doc.step(performance.now() + SLICE)) {
      const now = performance.now();
      if (now - shown >= PROGRESS) {
        shown = now;
        reply({ id, ok: true, value: doc.progress(), done: false });
      }
      await nextTask();
    }
    reply({ id, ok: true, value: doc.summary(), done: true });
  };

  const find = async (id: number, query: string, options: import('./types').FindOptions) => {
    finds.set(id, true);
    const it = doc!.find(query, options);
    for (;;) {
      if (!finds.get(id)) {
        reply({ id, ok: true, value: { matches: new Float64Array(0), length: 0, scanned: 0, done: true } satisfies FindBatch, done: true });
        break;
      }
      const r = it.next();
      if (r.done) break;
      const b = r.value;
      reply({ id, ok: true, value: b, done: b.done }, [b.matches.buffer]);
      if (b.done) break;
      await nextTask();
    }
    finds.delete(id);
  };

  port.onmessage = (e) => {
    const m = e.data as Request;
    try {
      if (m.op === 'open') {
        open(m.id, m.file, m.options).catch((err) => fail(m.id, err));
        return;
      }
      if (m.op === 'cancel') {
        finds.set(m.target, false);
        reply({ id: m.id, ok: true, value: null, done: true });
        return;
      }
      if (!doc) throw new Error('No document');
      switch (m.op) {
        case 'summary':
          return reply({ id: m.id, ok: true, value: doc.summary(), done: true });
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
          return reply({ id: m.id, ok: true, value: doc.resolve(m.path), done: true });
        case 'text':
          return reply({ id: m.id, ok: true, value: doc.text(m.start, m.end, m.max), done: true });
        case 'find':
          find(m.id, m.query, m.options).catch((err) => fail(m.id, err));
          return;
      }
    } catch (err) {
      fail(m.id, err);
    }
  };
}
