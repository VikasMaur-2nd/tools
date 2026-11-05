/**
 * Edits through the worker (client.ts ↔ serve.ts), over async blocks shared with the read-ahead (as in
 * Chromium): node edits, undo/redo, reading again in steps (the summary through onSummary), the document's bytes
 * as Blobs; saving (a File System Access writable: the bytes written hash to the edited document's; in place: the
 * document reads the new file; stopped: the file as it was; no handle: a Blob); sessions kept and put back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { Prefetch } from '../lib/huge/prefetch';
import { BlockSource } from '../lib/huge/bytes';
import { MemorySessionStore } from '../lib/huge/session-store';
import type { HugeNode, HugeSummary } from '../lib/huge/types';
import { hugeMod, tapeMod } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Two ends of a channel; messages as they are (handles with methods can't be cloned in Node). */
function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m) => setImmediate(() => b.onmessage?.({ data: m })) };
  const b: Port = { onmessage: null, postMessage: (m) => setImmediate(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

/** A worker on `file` reading async blocks (they wait) taken from the read-ahead when it has them. */
function connect(file: Blob, store?: MemorySessionStore, onProgress?: () => void) {
  const [page, worker] = channel();
  let shared: Prefetch | null = null;
  // (The read-ahead holds the indexer's window: 1 MiB chunks.)
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), (f) => Object.assign(new BlockSource(f, 1 << 16, 8, shared && f === file ? shared : undefined), { cached: true }), (f) => (shared = new Prefetch(f, 1 << 20, 2)), store);
  return new HugeClient(file, { name: (file as File).name ?? 'a.json', every: 512, big: 1 << 12 }, onProgress, page);
}

/** A File System Access file handle writing into memory (slow writes, so a save can be stopped meanwhile). */
class FakeHandle {
  bytes = new Uint8Array(0);
  writes = 0;
  constructor(
    readonly name: string,
    private readonly gate?: () => Promise<void>,
  ) {}
  async createWritable() {
    const parts: Uint8Array[] = [];
    return {
      write: async (d: Blob | Uint8Array) => {
        if (this.gate) await this.gate();
        this.writes++;
        parts.push(d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : d.slice());
      },
      close: async () => {
        this.bytes = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
      },
      abort: async () => {},
    };
  }
  async getFile() {
    return new File([this.bytes as BlobPart], this.name, { lastModified: 2 });
  }
}

const textOf = async (doc: HugeClient) => {
  const s = await doc.summary();
  return dec.decode(new Uint8Array(await (await doc.slice(0, s.size - s.bom)).arrayBuffer()));
};

/** Records as JSON (pretty), big enough for many blocks and checkpoints. */
const recordsDoc = (n: number) => JSON.stringify({ meta: { n }, records: Array.from({ length: n }, (_, i) => ({ id: i, name: 'item ' + i, tags: ['a', 'b'] })) }, null, 2);

test('save: node edits and undo through the worker, the document as Blobs, reading again in steps', async () => {
  const v = JSON.parse(recordsDoc(3000));
  const file = new File([recordsDoc(3000)], 'a.json', { lastModified: 1 });
  const doc = connect(file);
  const s0 = await doc.ready;
  assert.equal(s0.error, null);
  const recs = (await doc.resolve(['records']))!.node;
  // Set a value deep in, remove one, insert one, rename a member, duplicate one.
  const at = (await doc.resolve(['records', 2500, 'name']))!.node;
  let e = await doc.setValue(at, '"renamed"');
  assert.ok(e.canUndo);
  v.records[2500].name = 'renamed';
  e = await doc.remove(recs, 10);
  v.records.splice(10, 1);
  e = await doc.insert(recs, 0, '{"id": -1, "name": "first", "tags": []}');
  v.records.unshift({ id: -1, name: 'first', tags: [] });
  const meta = (await doc.resolve(['meta']))!.node;
  e = await doc.rename(meta, 0, 'count');
  v.meta = { count: v.meta.n };
  e = await doc.duplicate((await doc.resolve(['records']))!.node, 1);
  v.records.splice(2, 0, JSON.parse(JSON.stringify(v.records[1])));
  // (Each reads again at once or later: the summary comes either way.)
  const s = e.done ? e.summary! : await new Promise<HugeSummary>((done) => (doc.onSummary = done));
  assert.equal(s.error, null);
  assert.equal(s.edited, true);
  assert.equal(await textOf(doc), JSON.stringify(v, null, 2));
  assert.equal(((await doc.resolve(['records']))!.node as HugeNode).count, v.records.length);
  // blob() reads the file: not once edited.
  assert.throws(() => doc.blob(0, 10), /Edited/);
  // Undo all the way, redo all the way.
  while ((await doc.summary()).canUndo) await doc.undo();
  assert.equal(await textOf(doc), recordsDoc(3000));
  for (let i = 0; i < 5; i++) await doc.redo();
  assert.equal(await textOf(doc), JSON.stringify(v, null, 2));
  // Errors are fixed messages: a node edit where it can't be.
  await assert.rejects(doc.insert(at, 0, '1'), /Not allowed/);
  await assert.rejects(doc.setValue(at, '{oops'), /Invalid JSON/);
  doc.close();
});

test('save: to a writable (the bytes hash to the document\'s), in place (then reading the new file), stopped, or as a Blob', async () => {
  const text = recordsDoc(2000);
  const file = new File([text], 'a.json', { lastModified: 1 });
  const doc = connect(file);
  await doc.ready;
  const recs = (await doc.resolve(['records']))!.node;
  await doc.remove(recs, 5);
  await doc.replace([{ a: 0, b: 0, text: ' ' }]);
  const want = enc.encode(await textOf(doc));
  // As a Blob: no copy, the same bytes.
  const b = await doc.save(null, false).done;
  assert.equal(sha(new Uint8Array(await b.blob!.arrayBuffer())), sha(want));
  // To another file: the same bytes; the document still reads the old one, its history kept.
  const other = new FakeHandle('b.json');
  const seen: number[] = [];
  await doc.save(other as unknown as FileSystemFileHandle, false, (p) => seen.push(p.written)).done;
  assert.equal(sha(other.bytes), sha(want));
  assert.ok((await doc.summary()).canUndo);
  // Stopped part way: the file as it was (nothing swapped in).
  // (Writes wait until it's stopped, then go: the next one sees the stop.)
  let shut = true;
  const waiting: (() => void)[] = [];
  const gate = () => (shut ? new Promise<void>((done) => waiting.push(done)) : Promise.resolve());
  const slow = new FakeHandle('c.json', gate);
  const run = doc.save(slow as unknown as FileSystemFileHandle, false);
  await new Promise((r) => setTimeout(r, 20));
  run.stop();
  await new Promise((r) => setTimeout(r, 20));
  shut = false;
  for (const w of waiting) w();
  await assert.rejects(run.done, /Cancelled/);
  assert.equal(slow.bytes.length, 0);
  // In place: the document is the file's now (no edits, no history), and reads on from it.
  const same = new FakeHandle('a.json');
  await doc.save(same as unknown as FileSystemFileHandle, true).done;
  assert.equal(sha(same.bytes), sha(want));
  const s = await doc.summary();
  assert.equal(s.edited, false);
  assert.equal(s.canUndo, false);
  assert.equal(await textOf(doc), dec.decode(want));
  assert.equal(dec.decode(new Uint8Array(await doc.blob(0, 20).arrayBuffer())), dec.decode(want.subarray(0, 20)));
  // Edits go on from it.
  await doc.remove((await doc.resolve(['records']))!.node, 0);
  const v = JSON.parse(dec.decode(want));
  v.records.splice(0, 1);
  assert.equal(await textOf(doc), JSON.stringify(v, null, 2).replace(/^/, ' '));
  doc.close();
});

test('save: a session of edits is kept for the same file, put back with its history, dropped', async () => {
  const text = recordsDoc(500);
  const store = new MemorySessionStore();
  const file = new File([text], 'a.json', { lastModified: 7 });
  const doc = connect(file, store);
  await doc.ready;
  const recs = (await doc.resolve(['records']))!.node;
  await doc.remove(recs, 3);
  await doc.setValue((await doc.resolve(['records', 0, 'name']))!.node, '"kept"');
  await doc.replace([{ a: 0, b: 0, text: ' ' }]);
  const want = await textOf(doc);
  // (Kept a second after the last edit.)
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(store.kept.size, 1);
  doc.close();
  // The same file again: offered, put back, and undo goes on where it was.
  const again = connect(new File([text], 'a.json', { lastModified: 7 }), store);
  let s = await again.ready;
  for (let i = 0; i < 50 && !s.session; i++) s = await again.summary();
  assert.ok(s.session && s.session.steps === 3, `offered: ${JSON.stringify(s.session)}`);
  await again.restoreSession();
  assert.equal(await textOf(again), want);
  await again.undo();
  assert.equal(await textOf(again), want.slice(1));
  // Another file (a different time) isn't offered it.
  const other = connect(new File([text], 'a.json', { lastModified: 8 }), store);
  let o = await other.ready;
  await new Promise((r) => setTimeout(r, 50));
  o = await other.summary();
  assert.ok(!o.session);
  other.close();
  // Dropped: gone.
  await again.dropSession();
  assert.equal(store.kept.size, 0);
  again.close();
});

test('save: closing keeps the edits not kept yet (no second to wait), and nothing when there are none or they were dropped', async () => {
  const text = recordsDoc(200);
  const store = new MemorySessionStore();
  const file = () => new File([text], 'a.json', { lastModified: 9 });
  // Edited, closed at once (before the second after the last edit): kept.
  const doc = connect(file(), store);
  await doc.ready;
  await doc.remove((await doc.resolve(['records']))!.node, 3);
  await doc.replace([{ a: 0, b: 0, text: ' ' }]);
  const want = await textOf(doc);
  const t0 = performance.now();
  const late = doc.summary().catch((e: Error) => e.message);
  await doc.close();
  assert.ok(performance.now() - t0 < 900, `closed in ${Math.round(performance.now() - t0)} ms`);
  assert.equal(await late, 'Closed');
  assert.equal(store.kept.size, 1, 'kept at close');
  const again = connect(file(), store);
  const s = await again.ready;
  const session = s.session !== undefined ? s.session : (await new Promise<HugeSummary>((done) => (again.onSummary = done))).session;
  assert.equal(session?.steps, 2);
  await again.restoreSession();
  assert.equal(await textOf(again), want);
  // Dropped, then closed: nothing kept.
  await again.dropSession();
  await again.close();
  assert.equal(store.kept.size, 0);
  // Not edited: nothing kept, and closing twice is fine.
  const plain = connect(file(), store);
  await plain.ready;
  await plain.close();
  await plain.close();
  assert.equal(store.kept.size, 0);
});
