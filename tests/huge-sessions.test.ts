/**
 * Kept sessions (REVIEW-2 items 1, 4, 8, 9 and the keep cost), through the real client and worker:
 * 1. a session is put back only onto the file as opened (an edit since: 'Not allowed'), and isn't overwritten by
 *    new edits while it's on offer;
 * 4. after saving in place, edits are kept under the saved file's key (the old key gone);
 * 8. a download (no handle) or a save as leaves the session: the opened file is unchanged;
 * 9. another file with the same name, size and time isn't offered it (a content fingerprint); old sessions are
 *    swept by age and in all; close() says whether the edits are kept;
 * and a keep writes what's new, not every edit's bytes again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { Prefetch } from '../lib/huge/prefetch';
import { BlockSource } from '../lib/huge/bytes';
import { HugeEditor } from '../lib/huge/editor';
import { piecesOf } from '../lib/huge/pieces';
import { fingerprint, Keeper, MemorySessionStore, sessionKey, sweepOf, type Kept } from '../lib/huge/session-store';
import type { HugeSession, HugeSummary } from '../lib/huge/types';
import { hugeMod, open, tapeMod } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m) => setImmediate(() => b.onmessage?.({ data: m })) };
  const b: Port = { onmessage: null, postMessage: (m) => setImmediate(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

function connect(file: File, store?: MemorySessionStore) {
  const [page, worker] = channel();
  let shared: Prefetch | null = null;
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), (f) => Object.assign(new BlockSource(f, 1 << 16, 8, shared && f === file ? shared : undefined), { cached: true }), (f) => (shared = new Prefetch(f, 1 << 20, 2)), store);
  return new HugeClient(file, { name: file.name, every: 512, big: 1 << 12 }, undefined, page);
}

class FakeHandle {
  bytes = new Uint8Array(0);
  constructor(
    readonly name: string,
    readonly lastModified: number,
  ) {}
  async createWritable() {
    const parts: Uint8Array[] = [];
    return {
      write: async (d: Blob | Uint8Array) => void parts.push(d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : d.slice()),
      close: async () => void (this.bytes = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer())),
      abort: async () => {},
    };
  }
  async getFile() {
    return new File([this.bytes as BlobPart], this.name, { lastModified: this.lastModified });
  }
}

const textOf = async (doc: HugeClient) => {
  const s = await doc.summary();
  return dec.decode(new Uint8Array(await (await doc.slice(0, s.size - s.bom)).arrayBuffer()));
};
/** The session offered (as the UI waits for it: in ready, else pushed). */
const sessionOf = async (doc: HugeClient): Promise<HugeSession | null> => {
  const pushed = new Promise<HugeSummary>((done) => (doc.onSummary = done));
  const s = await doc.ready;
  return (s.session !== undefined ? s.session : (await pushed).session) ?? null;
};
const text = JSON.stringify({ a: 'AAAA', b: 'BBBB', c: 'CCCC' });

test('sessions 1: put back only onto the file as opened, and not overwritten by new edits while on offer (the reviewer\'s case)', async () => {
  const store = new MemorySessionStore();
  const file = () => new File([text], 'r.json', { lastModified: 5 });
  const d1 = connect(file(), store);
  await d1.ready;
  await d1.replace([{ a: 6, b: 10, text: 'kept' }]);
  const keptDoc = await textOf(d1);
  assert.equal(await d1.close(), true, 'kept at close');
  const stored = structuredClone([...store.kept.values()][0]);
  // Reopened: offered; the user edits first.
  const d2 = connect(file(), store);
  assert.deepEqual(await sessionOf(d2), { steps: 1, bytes: 4, time: stored.time, restorable: true });
  await d2.replace([{ a: 1, b: 1, text: '"z":1,' }]);
  const mine = await textOf(d2);
  assert.equal((await d2.summary()).session?.restorable, false, 'not restorable once edited');
  await assert.rejects(d2.restoreSession(), /Not allowed/);
  assert.equal(await textOf(d2), mine, 'the document as the user left it');
  // A second on: the session on offer is still the stored one, not this document's edits.
  await sleep(1200);
  assert.deepEqual([...store.kept.values()][0].pieces, stored.pieces);
  // Undone back to the file: still not (the history would be lost), until it's a fresh open.
  await d2.undo();
  await assert.rejects(d2.restoreSession(), /Not allowed/);
  assert.equal(await d2.close(), false, 'these edits are not kept: an earlier session is on offer');
  // Opened again: the stored one, put back whole.
  const d3 = connect(file(), store);
  assert.equal((await sessionOf(d3))?.restorable, true);
  await d3.restoreSession();
  assert.equal(await textOf(d3), keptDoc);
  await d3.undo();
  assert.equal(await textOf(d3), text);
  await d3.redo();
  await d3.dropSession();
  await d3.close();
  // Dropped to keep this document's edits instead (offered, then edited): they are.
  const d4 = connect(file(), store);
  await d4.ready;
  await d4.replace([{ a: 0, b: 0, text: ' ' }]);
  await d4.dropSession(true);
  assert.equal(await d4.close(), true);
  const d5 = connect(file(), store);
  assert.equal((await sessionOf(d5))?.steps, 1);
  await d5.restoreSession();
  assert.equal(await textOf(d5), ' ' + text);
  await d5.close();
});

test('sessions 4: after saving in place, edits are kept under the saved file\'s key (the old key gone)', async () => {
  const store = new MemorySessionStore();
  const d = connect(new File([text], 's.json', { lastModified: 5 }), store);
  await d.ready;
  await d.replace([{ a: 6, b: 10, text: 'longer value' }]);
  await sleep(1200);
  const h = new FakeHandle('s.json', 99);
  await d.save(h as unknown as FileSystemFileHandle, true).done;
  await d.replace([{ a: 0, b: 0, text: ' ' }]);
  const want = await textOf(d);
  assert.equal(await d.close(), true);
  assert.deepEqual([...store.kept.keys()], [sessionKey('s.json', h.bytes.length, 99)]);
  const again = connect(new File([h.bytes as BlobPart], 's.json', { lastModified: 99 }), store);
  assert.equal((await sessionOf(again))?.steps, 1);
  await again.restoreSession();
  assert.equal(await textOf(again), want);
  await again.close();
});

test('sessions 8: a download or a save as leaves the session (the opened file is unchanged)', async () => {
  for (const how of ['download', 'save as'] as const) {
    const store = new MemorySessionStore();
    const file = () => new File([text], 'b.json', { lastModified: 5 });
    const d = connect(file(), store);
    await d.ready;
    await d.replace([{ a: 6, b: 10, text: 'dl' }]);
    await sleep(1200);
    assert.equal(store.kept.size, 1);
    if (how === 'download') await d.save(null, false).done;
    else await d.save(new FakeHandle('copy.json', 7) as unknown as FileSystemFileHandle, false).done;
    assert.equal(store.kept.size, 1, how);
    assert.equal(await d.close(), true, how);
    const again = connect(file(), store);
    assert.equal((await sessionOf(again))?.steps, 1, how);
    await again.close();
  }
});

test('sessions 9: another file with the same name, size and time isn\'t offered; close says when edits aren\'t kept', async () => {
  const store = new MemorySessionStore();
  const d = connect(new File([text], 'c.json', { lastModified: 5 }), store);
  await d.ready;
  await d.replace([{ a: 6, b: 10, text: 'ZZZZ' }]);
  assert.equal(await d.close(), true);
  // The same name, size and time, other bytes: not offered, and its session (another file's) dropped.
  const other = text.replace('CCCC', 'DDDD');
  const o = connect(new File([other], 'c.json', { lastModified: 5 }), store);
  assert.equal(await sessionOf(o), null);
  await o.close();
  assert.equal(store.kept.size, 0);
  // Unedited: nothing kept. A store that fails: not kept.
  const plain = connect(new File([text], 'c.json', { lastModified: 5 }), store);
  await plain.ready;
  assert.equal(await plain.close(), false);
  const failing = Object.assign(new MemorySessionStore(), { put: async () => Promise.reject(new Error('quota')) });
  const f = connect(new File([text], 'c.json', { lastModified: 5 }), failing);
  await f.ready;
  await f.replace([{ a: 0, b: 0, text: ' ' }]);
  assert.equal(await f.close(), false);
  // The fingerprint: content, not only facts.
  const a = await fingerprint(new Blob([text]));
  assert.equal(await fingerprint(new Blob([text])), a);
  assert.notEqual(await fingerprint(new Blob([other])), a);
});

test('sessions 9: old ones swept by age, then the oldest while they hold more than the cap (the open one stays)', async () => {
  const day = 24 * 3600 * 1000;
  const all = [
    { key: 'a', time: 0, bytes: 10 },
    { key: 'b', time: 40 * day, bytes: 600 },
    { key: 'c', time: 41 * day, bytes: 600 },
    { key: 'open', time: 1 * day, bytes: 100 },
  ];
  assert.deepEqual(sweepOf(all, 42 * day, 'open', 30 * day, 1000).sort(), ['a', 'b']);
  // Through the worker: an old session of another file goes when a file is opened.
  const store = new MemorySessionStore();
  const seed = new Keeper().plan([{ buf: enc.encode('x'), off: 0, len: 1 }], [], 0, 0, 1, 'p')!;
  await store.put('old\u00001\u00001', { ...seed.kept, time: Date.now() - 60 * day }, seed.add, seed.drop);
  await store.put('new\u00001\u00001', { ...seed.kept, time: Date.now() }, seed.add, seed.drop);
  const d = connect(new File([text], 'd.json', { lastModified: 5 }), store);
  await sessionOf(d);
  await d.close();
  assert.deepEqual([...store.kept.keys()], ['new\u00001\u00001']);
  assert.equal([...store.chunkMap.keys()].filter((k) => k.startsWith('old')).length, 0, 'its bytes too');
});

test('sessions: a keep writes what is new (typing after a big paste writes bytes, not the paste again); put back whole', async () => {
  const d = open(enc.encode(text), 'k.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const ed = new HugeEditor(d);
  const store = new MemorySessionStore();
  const k = new Keeper();
  const keepOnce = async () => {
    const p = k.plan(d.src.list, ed.history.steps, ed.history.applied, ed.droppedSteps, d.src.base.size, 'p')!;
    await store.put('k', p.kept, p.add, p.drop);
  };
  ed.apply([{ a: 6, b: 6, put: piecesOf(enc.encode('y'.repeat(4 << 20))) }]);
  await keepOnce();
  assert.ok(store.written >= 4 << 20);
  const before = store.written;
  for (let i = 0; i < 20; i++) {
    ed.apply([{ a: 7 + i, b: 7 + i, put: piecesOf(enc.encode('z')) }], Infinity, true);
    await keepOnce();
  }
  assert.ok(store.written - before < 1024, `typing wrote ${store.written - before} bytes`);
  // Undone past the paste and redone: no bytes are lost; dropped from history: its chunk goes.
  const want = dec.decode(d.src.read(0, d.src.size));
  const kept = (await store.get('k')) as Kept;
  const back = new Keeper().load(kept, await store.chunks('k', new Keeper().chunksOf(kept)));
  const d2 = open(enc.encode(text), 'k.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const { opsOf } = await import('../lib/huge/session-store');
  d2.edit(opsOf(back.pieces, d2.src.base.size));
  assert.equal(dec.decode(d2.src.read(0, d2.src.size)), want);
  ed.clear();
  d.edit([{ a: 6, b: 6 + (4 << 20) + 20, put: [] }]);
  await keepOnce();
  assert.equal([...store.chunkMap.values()].reduce((n, v) => n + v.length, 0), 0, 'no bytes left kept');
});
