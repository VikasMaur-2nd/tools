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
import { Arena, piecesOf } from '../lib/huge/pieces';
import { fingerprint, Keeper, MemorySessionStore, sessionKey, sweepOf, type Head } from '../lib/huge/session-store';
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
  const stored = structuredClone([...store.heads.values()][0]);
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
  assert.deepEqual(Array.from([...store.heads.values()][0].pieces), Array.from(stored.pieces));
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
  assert.deepEqual([...store.heads.keys()], [sessionKey('s.json', h.bytes.length, 99, await fingerprint(new Blob([h.bytes as BlobPart])))]);
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
    assert.equal(store.heads.size, 1);
    if (how === 'download') await d.save(null, false).done;
    else await d.save(new FakeHandle('copy.json', 7) as unknown as FileSystemFileHandle, false).done;
    assert.equal(store.heads.size, 1, how);
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
  // The same name, size and time, other bytes: not offered, and the first file's session left as it is (REVIEW-3 C6).
  const other = text.replace('CCCC', 'DDDD');
  const o = connect(new File([other], 'c.json', { lastModified: 5 }), store);
  assert.equal(await sessionOf(o), null);
  await o.close();
  assert.equal(store.heads.size, 1);
  // Unedited: nothing kept (the first file's session is offered, and stays). A store that fails: not kept.
  const plain = connect(new File([text], 'c.json', { lastModified: 5 }), store);
  assert.equal((await sessionOf(plain))?.steps, 1);
  assert.equal(await plain.close(), false);
  assert.equal(store.heads.size, 1);
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
  assert.deepEqual(sweepOf(all, 42 * day, ['open'], 30 * day, 1000).sort(), ['a', 'b']);
  // Through the worker: an old session of another file goes when a file is opened.
  const store = new MemorySessionStore();
  const seed = new Keeper().plan([{ buf: enc.encode('x'), off: 0, len: 1 }], [], 0, 0, 1, 'p')!;
  await store.put('old\u00001\u00001', { ...seed.head, time: Date.now() - 60 * day }, seed.add, seed.drop);
  await store.put('new\u00001\u00001', { ...seed.head, time: Date.now() }, seed.add, seed.drop);
  const d = connect(new File([text], 'd.json', { lastModified: 5 }), store);
  await sessionOf(d);
  await d.close();
  assert.deepEqual([...store.heads.keys()], ['new\u00001\u00001']);
  assert.equal([...store.partMap.keys()].filter((k) => k.startsWith('old')).length, 0, 'its bytes too');
});

test('sessions: a keep writes what is new (typing after a big paste writes bytes, not the paste again); put back whole', async () => {
  const d = open(enc.encode(text), 'k.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const ed = new HugeEditor(d);
  const store = new MemorySessionStore();
  const k = new Keeper();
  // (Typed keys go into a shared buffer, as the worker puts them: a run of them one piece.)
  const arena = new Arena();
  const keepOnce = async () => {
    const p = k.plan(d.src.list, ed.history.steps, ed.history.applied, ed.droppedSteps, d.src.base.size, 'p')!;
    await store.put('k', p.head, p.add, p.drop);
  };
  ed.apply([{ a: 6, b: 6, put: piecesOf(enc.encode('y'.repeat(4 << 20))) }]);
  await keepOnce();
  assert.ok(store.written >= 4 << 20);
  const before = store.written;
  for (let i = 0; i < 20; i++) {
    ed.apply([{ a: 7 + i, b: 7 + i, put: arena.put(enc.encode('z')) }], Infinity, true);
    await keepOnce();
  }
  // (Each keep: the new key's byte, the step it joined, the head: pieces and buffers, not the paste again.)
  assert.ok(store.written - before < 20 * 512, `typing wrote ${store.written - before} bytes`);
  // Undone past the paste and redone: no bytes are lost; dropped from history: its chunk goes.
  const want = dec.decode(d.src.read(0, d.src.size));
  const kept = (await store.get('k')) as Head;
  const back = await new Keeper().load(kept, (names) => store.parts('k', names));
  const d2 = open(enc.encode(text), 'k.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const { opsOf } = await import('../lib/huge/session-store');
  d2.edit(opsOf(back.pieces, d2.src.base.size));
  assert.equal(dec.decode(d2.src.read(0, d2.src.size)), want);
  ed.clear();
  d.edit([{ a: 6, b: 6 + (4 << 20) + 20, put: [] }]);
  await keepOnce();
  const chunks = [...store.partMap].filter(([name]) => /\.c\d+$/.test(name));
  assert.equal(chunks.reduce((n, [, v]) => n + v.length, 0), 0, 'no bytes left kept');
});

// The third review (REVIEW-3.md): B1, C2, C5, C6, C8 and the keep cost (D3, D4), from review3-session-orders.cjs.

/** The next summary pushed that `ok` takes. */
const pushed = (doc: HugeClient, ok: (s: HugeSummary) => boolean) => new Promise<HugeSummary>((done) => (doc.onSummary = (s) => ok(s) && done(s)));
/** The generations of the parts kept (one per writer and start: never two in one session). */
const gensOf = (store: MemorySessionStore) => new Set([...store.partMap.keys()].map((k) => k.slice(k.lastIndexOf('\u0000') + 1).split('.')[0]));
const day = 24 * 3600 * 1000;

test('sessions B1 (REVIEW-3): two tabs on one file: one keeps, the other says another tab has it; never mixed bytes, never replaced', async () => {
  const file = () => new File([text], 't.json', { lastModified: 5 });
  // The reviewer's order: A edits, B edits, A edits, a keep after each; B closes, then A.
  {
    const store = new MemorySessionStore();
    const a = connect(file(), store);
    await sessionOf(a);
    const b = connect(file(), store);
    await sessionOf(b);
    assert.equal((await a.summary()).keeping, 'yes');
    assert.equal((await b.summary()).keeping, 'other-tab');
    await a.replace([{ a: 6, b: 10, text: 'tabA' }]);
    await sleep(1200);
    await b.replace([{ a: 17, b: 21, text: 'TAB-B-WAS-HERE' }]);
    await sleep(1200);
    await a.replace([{ a: 28, b: 32, text: 'tabA2' }]);
    await sleep(1200);
    const wantA = await textOf(a);
    assert.equal(await b.close(), false, "B's edits aren't kept: A has the file");
    assert.equal(await a.close(), true);
    assert.equal(gensOf(store).size, 1);
    const r = connect(file(), store);
    assert.equal((await sessionOf(r))?.steps, 2);
    await r.restoreSession();
    assert.equal(await textOf(r), wantA, "A's edits, A's bytes");
    await r.close();
  }
  // The other order: A closes first. B, edited meanwhile, takes the file over but not A's session: it stays A's,
  // B's edits aren't kept ('other-tab-kept'), and nothing B does (drop, discard, close) touches it.
  {
    const store = new MemorySessionStore();
    const a = connect(file(), store);
    await sessionOf(a);
    const b = connect(file(), store);
    await sessionOf(b);
    await a.replace([{ a: 6, b: 10, text: 'tabA' }]);
    await sleep(1200);
    await b.replace([{ a: 17, b: 21, text: 'TAB-B-WAS-HERE' }]);
    await sleep(1200);
    await a.replace([{ a: 28, b: 32, text: 'tabA2' }]);
    const wantA = await textOf(a);
    const takes = pushed(b, (s) => s.keeping !== 'other-tab');
    assert.equal(await a.close(), true);
    const s = await takes;
    assert.equal(s.keeping, 'other-tab-kept');
    assert.equal(s.session, null, 'not on offer (the UI would drop it on the next key)');
    assert.equal(s.setAside, null);
    const heads = structuredClone([...store.heads]);
    await b.replace([{ a: 0, b: 0, text: ' ' }]);
    await sleep(1200);
    await b.dropSession(true);
    await b.dropSession();
    assert.equal((await b.summary()).keeping, 'other-tab-kept');
    assert.equal(await b.close(), false, "B's edits aren't kept: A's are");
    assert.deepEqual([...store.heads], heads, "A's session as A left it");
    assert.equal(gensOf(store).size, 1);
    const r = connect(file(), store);
    assert.equal((await sessionOf(r))?.steps, 2);
    await r.restoreSession();
    assert.equal(await textOf(r), wantA, "A's edits, A's bytes");
    await r.close();
  }
  // A kept nothing (no edits): B takes over and keeps its own.
  {
    const store = new MemorySessionStore();
    const a = connect(file(), store);
    await sessionOf(a);
    const b = connect(file(), store);
    await sessionOf(b);
    await b.replace([{ a: 17, b: 21, text: 'tabB' }]);
    const wantB = await textOf(b);
    const takes = pushed(b, (s) => s.keeping !== 'other-tab');
    assert.equal(await a.close(), false);
    assert.equal((await takes).keeping, 'yes');
    assert.equal(await b.close(), true);
    const r = connect(file(), store);
    await sessionOf(r);
    await r.restoreSession();
    assert.equal(await textOf(r), wantB);
    await r.close();
  }
  // B unedited when A closes: A's session offered in B, and put back.
  {
    const store = new MemorySessionStore();
    const a = connect(file(), store);
    await sessionOf(a);
    const b = connect(file(), store);
    await sessionOf(b);
    await a.replace([{ a: 6, b: 10, text: 'tabA' }]);
    const wantA = await textOf(a);
    const offered = pushed(b, (s) => !!s.session);
    await a.close();
    assert.equal((await offered).session?.restorable, true);
    await b.restoreSession();
    assert.equal(await textOf(b), wantA);
    await b.close();
  }
  // Closed before it got the file: it never keeps (nor waits on).
  {
    const store = new MemorySessionStore();
    const a = connect(file(), store);
    await sessionOf(a);
    const b = connect(file(), store);
    await sessionOf(b);
    await b.replace([{ a: 6, b: 10, text: 'tabB' }]);
    assert.equal(await b.close(), false);
    assert.equal(await a.close(), false);
    assert.equal(store.heads.size, 0);
  }
});

test('sessions C2 (REVIEW-3): another tab\'s sweep leaves a session open in a tab; swept once it\'s closed', async () => {
  const store = new MemorySessionStore();
  const x = () => new File([text], 'x.json', { lastModified: 5 });
  const a = connect(x(), store);
  await sessionOf(a);
  await a.replace([{ a: 6, b: 10, text: 'kept' }]);
  await sleep(1200);
  // (Its last keep long ago: the tab left open. Another tab opens another file, and sweeps.)
  for (const m of store.meta.values()) m.time -= 31 * day;
  const other = connect(new File([text], 'y.json', { lastModified: 9 }), store);
  await sessionOf(other);
  await sleep(50);
  assert.equal(store.heads.size, 1, 'open in a tab: not swept');
  await a.replace([{ a: 17, b: 21, text: 'more' }]);
  const want = await textOf(a);
  assert.equal(await a.close(), true);
  await other.close();
  const r = connect(x(), store);
  assert.equal((await sessionOf(r))?.steps, 2);
  await r.restoreSession();
  assert.equal(await textOf(r), want);
  await r.close();
  for (const m of store.meta.values()) m.time -= 31 * day;
  const later = connect(new File([text], 'y.json', { lastModified: 9 }), store);
  await sessionOf(later);
  await sleep(50);
  assert.equal(store.heads.size, 0, 'closed: swept');
  assert.equal(store.partMap.size, 0);
  await later.close();
});

test('sessions C5 (REVIEW-3): a first edit sets the offer aside, not gone: reofferSession undoes and offers it again; gone at close', async () => {
  const store = new MemorySessionStore();
  const file = () => new File([text], 'u.json', { lastModified: 5 });
  const d1 = connect(file(), store);
  await d1.ready;
  await d1.replace([{ a: 6, b: 10, text: 'kept' }]);
  const keptDoc = await textOf(d1);
  assert.equal(await d1.close(), true);
  // A key by accident while it's offered (the UI: dropSession(true)), kept a second later, then a second key.
  const d2 = connect(file(), store);
  const offer = await sessionOf(d2);
  assert.equal(offer?.restorable, true);
  await d2.replace([{ a: 1, b: 1, text: 'x' }]);
  await d2.dropSession(true);
  let s = await d2.summary();
  assert.equal(s.session, null);
  assert.deepEqual(s.setAside, { ...offer, restorable: false });
  await sleep(1200);
  await d2.replace([{ a: 2, b: 2, text: 'y' }]);
  // The toast's Undo: the keys undone, their history gone, the session on offer again, whole.
  const back = await d2.reofferSession();
  assert.equal(back?.canUndo, false);
  assert.equal(back?.canRedo, false);
  assert.equal(await textOf(d2), text);
  s = await d2.summary();
  assert.equal(s.setAside, null);
  assert.deepEqual(s.session, offer);
  await sleep(1200);
  assert.equal(store.heads.size, 1, "the keys' keeps gone, nothing kept over it");
  await d2.restoreSession();
  assert.equal(await textOf(d2), keptDoc);
  assert.equal(await d2.close(), true);
  // Its key undone in the document (not the toast) and closed: nothing of this document's to keep, so it stays.
  const u = connect(file(), store);
  await sessionOf(u);
  await u.replace([{ a: 1, b: 1, text: 'x' }]);
  await u.dropSession(true);
  await sleep(1200);
  await u.undo();
  assert.equal(await u.close(), false);
  const u2 = connect(file(), store);
  assert.equal((await sessionOf(u2))?.steps, 1);
  await u2.restoreSession();
  assert.equal(await textOf(u2), keptDoc);
  await u2.close();
  // Not brought back: gone at close, the new edits kept.
  const d3 = connect(file(), store);
  await sessionOf(d3);
  await d3.replace([{ a: 1, b: 1, text: 'y' }]);
  await d3.dropSession(true);
  assert.equal(await d3.close(), true);
  assert.equal(store.heads.size, 1);
  assert.equal(gensOf(store).size, 1);
  const d4 = connect(file(), store);
  assert.equal((await sessionOf(d4))?.steps, 1);
  await d4.restoreSession();
  assert.equal(await textOf(d4), text.slice(0, 1) + 'y' + text.slice(1));
  assert.equal(await d4.reofferSession(), null, 'none set aside');
  await d4.close();
  // A tab that ended without closing (one set aside, nothing kept after it): offered again at the next open.
  const d5 = connect(file(), store);
  await sessionOf(d5);
  await d5.replace([{ a: 1, b: 1, text: 'z' }]);
  await d5.dropSession(true);
  const left = new MemorySessionStore();
  for (const [k, v] of store.heads) left.heads.set(k, v);
  for (const [k, v] of store.meta) left.meta.set(k, v);
  for (const [k, v] of store.partMap) left.partMap.set(k, v);
  await d5.close();
  const d6 = connect(file(), left);
  assert.equal((await sessionOf(d6))?.steps, 1);
  await d6.restoreSession();
  assert.equal(await textOf(d6), text.slice(0, 1) + 'y' + text.slice(1));
  await d6.close();
});

test('sessions C6 (REVIEW-3): two files with the same name, size and time each keep their own session', async () => {
  const store = new MemorySessionStore();
  const other = text.replace('CCCC', 'DDDD');
  const one = () => new File([text], 'c.json', { lastModified: 5 });
  const two = () => new File([other], 'c.json', { lastModified: 5 });
  for (const f of [one, two]) {
    const d = connect(f(), store);
    await sessionOf(d);
    await d.replace([{ a: 0, b: 0, text: f === one ? '1' : '2' }]);
    assert.equal(await d.close(), true);
  }
  assert.equal(store.heads.size, 2);
  for (const f of [one, two]) {
    const d = connect(f(), store);
    assert.equal((await sessionOf(d))?.steps, 1);
    await d.restoreSession();
    assert.equal((await textOf(d))[0], f === one ? '1' : '2');
    await d.close();
  }
  // The fingerprint: a change of a few bytes anywhere in its samples (first and last 64 KiB, 32 blocks between).
  const big = new Uint8Array(4 << 20).fill(0x20);
  const a = await fingerprint(new Blob([big]));
  for (const at of [10, (4 << 20) - 10, Math.floor((4 << 20) / 33) * 7 + 100]) {
    const b = big.slice();
    b[at] = 0x21;
    assert.notEqual(await fingerprint(new Blob([b])), a, `${at}`);
  }
});

test('sessions C8 (REVIEW-3): edits before the look ends: the session found is set aside, and these edits kept', async () => {
  const store = new MemorySessionStore();
  const file = () => new File([text], 'e.json', { lastModified: 5 });
  const d1 = connect(file(), store);
  await d1.ready;
  await d1.replace([{ a: 6, b: 10, text: 'kept' }]);
  assert.equal(await d1.close(), true);
  // The look slow (big parts, a busy disk): the user edits first.
  let slow = true;
  const late = Object.assign(store, {
    get: async (k: string) => {
      if (slow) await sleep(400);
      return MemorySessionStore.prototype.get.call(store, k);
    },
  });
  const d2 = connect(file(), late);
  const s0 = await d2.ready;
  assert.equal(s0.session, undefined, 'still looking');
  const found = pushed(d2, (s) => s.session !== undefined);
  await d2.replace([{ a: 0, b: 0, text: ' ' }]);
  const s = await found;
  assert.equal(s.session, null);
  assert.equal(s.setAside?.steps, 1);
  slow = false;
  const want = await textOf(d2);
  assert.equal(await d2.close(), true, 'these edits kept');
  const d3 = connect(file(), store);
  assert.equal((await sessionOf(d3))?.steps, 1);
  await d3.restoreSession();
  assert.equal(await textOf(d3), want);
  await d3.close();
  // The look ends before a slow sweep: the session offered while old ones are still being swept.
  const slowList = Object.assign(new MemorySessionStore(), {});
  const d4 = connect(file(), slowList);
  await d4.ready;
  await d4.replace([{ a: 6, b: 10, text: 'kept' }]);
  await d4.close();
  slowList.list = async () => (await sleep(2000), MemorySessionStore.prototype.list.call(slowList));
  const t0 = performance.now();
  const d5 = connect(file(), slowList);
  assert.equal((await sessionOf(d5))?.steps, 1);
  assert.ok(performance.now() - t0 < 1500, 'offered before the sweep ends');
  await d5.close();
});

test('sessions D3/D4 (REVIEW-3): a keep after many keys writes what is new (O(log n) parts a buffer); list() reads meta only', async () => {
  const d = open(enc.encode(text), 'k.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const ed = new HugeEditor(d);
  const store = new MemorySessionStore();
  const k = new Keeper();
  const arena = new Arena();
  const keepOnce = async () => {
    const p = k.plan(d.src.list, ed.history.steps, ed.history.applied, ed.droppedSteps, d.src.base.size, 'p')!;
    const was = store.written;
    await store.put('k', p.head, p.add, p.drop);
    return { written: store.written - was, head: p.head };
  };
  // 6,000 keys in runs of 30 (a keep after each run), each run a new line somewhere else.
  const cost: number[] = [];
  let head: Head | null = null;
  for (let run = 0; run < 200; run++) {
    let at = 1 + ((run * 7919) % Math.max(1, d.src.size - 2));
    ed.apply([{ a: at, b: at, put: arena.put(enc.encode('\n')) }]);
    at++;
    for (let i = 0; i < 29; i++, at++) ed.apply([{ a: at, b: at, put: arena.put(enc.encode('k')) }], Infinity, true);
    const r = await keepOnce();
    cost.push(r.written);
    head = r.head;
  }
  // (Per keep: the run's bytes, a segment of at most 256 steps, the head: pieces and parts, not all the keys again.)
  const lastTen = cost.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const firstTen = cost.slice(1, 11).reduce((a, b) => a + b, 0) / 10;
  assert.ok(lastTen < 8 * 1024, `keep at 6,000 keys ${lastTen} B vs ${firstTen} B`);
  console.log(`keep: ${firstTen} B a keep at first, ${lastTen} B at 6,000 keys`);
  // (The buffers' table, from its blocks: each buffer's parts.)
  const names = Array.from({ length: head!.bufs.length / 2 }, (_, j) => `${head!.gen}.b${head!.bufs[j * 2]}`);
  const blocks = await store.parts('k', names);
  const bufs = names.flatMap((n) => Array.from(blocks.get(n)!));
  let maxParts = 0;
  for (let j = 0; j < bufs.length; j += 3 + bufs[j + 2] * 3) maxParts = Math.max(maxParts, bufs[j + 2]);
  assert.ok(maxParts >= 1 && maxParts <= 16, `parts in a buffer: ${maxParts}`);
  // (The pieces' table: in blocks, the last keep wrote a few.)
  assert.ok(head!.pieces.length / 2 > 4, `${head!.pieces.length / 2} blocks`);
  const k2 = new Keeper();
  const back = await k2.load(head!, (names) => store.parts('k', names));
  const d2 = open(enc.encode(text), 'k.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const { opsOf } = await import('../lib/huge/session-store');
  d2.edit(opsOf(back.pieces, d2.src.base.size));
  assert.equal(dec.decode(d2.src.read(0, d2.src.size)), dec.decode(d.src.read(0, d.src.size)));
  assert.equal(back.steps.length, 400);
  // Put back, then kept again unchanged: nothing written but the head (its parts known as stored).
  const ed2 = new HugeEditor(d2);
  ed2.restoreHistory(back.steps, head!.applied, head!.dropped);
  const again = k2.plan(d2.src.list, ed2.history.steps, ed2.history.applied, ed2.droppedSteps, d2.src.base.size, 'p')!;
  assert.deepEqual([again.add.length, again.drop.length], [0, 0]);
  // list(): each session's key, time and bytes only.
  assert.deepEqual(await store.list(), [{ key: 'k', time: head!.time, bytes: head!.bytes }]);
});

test('sessions M2 (REVIEW-4): a set-aside session stays the file\'s when this visit\'s edits can\'t be kept', async () => {
  const fileOf = () => new File([text], 't.json', { lastModified: 5 });
  const store = new MemorySessionStore();
  // An earlier visit kept S0.
  const p = connect(fileOf(), store);
  await p.ready;
  await p.replace([{ a: 6, b: 10, text: 'S0S0' }]);
  const s0 = await textOf(p);
  assert.equal(await p.close(), true);
  // This visit edits instead of restoring (S0 set aside), then every keep fails (storage full).
  const a = connect(fileOf(), store);
  assert.ok(await sessionOf(a));
  await a.replace([{ a: 17, b: 21, text: 'tabA' }]);
  await a.dropSession(true);
  const put = store.put;
  store.put = async () => {
    throw new Error('QuotaExceededError');
  };
  await sleep(1200);
  assert.equal(await a.close(), false, "close says these edits weren't kept");
  store.put = put;
  // Reopen: S0 is offered and restores whole.
  const r = connect(fileOf(), store);
  assert.ok(await sessionOf(r), 'S0 still offered');
  await r.restoreSession();
  assert.equal(await textOf(r), s0);
  await r.close();
});
