/*
 * The commands' scopes (lib/huge/tasks.ts): CSV, Extract and Split on an object find its records array; positions
 * after invalid UTF-8 are the bytes' (REVIEW-3 B4: a U+FFFD standing for one byte was counted as 3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { HugeTasks } from '../lib/huge/tasks';
import { OBJ } from '../lib/huge/types';
import { parse } from '../lib/json/tape-parser';
import type { HugeSession } from '../lib/huge/session';
import type { HugeSource, IndexState } from '../lib/huge/source';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';

function inProcess(bytes: Uint8Array): Port {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const ended = (src: HugeSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done) return done(src.state());
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

const cat = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(out);
};

test('REVIEW-3 B4: the records array of a small object, after invalid UTF-8: its bytes', async () => {
  for (const bad of [[0xe9], [0xe2, 0x82], [0xff, 0xfe]]) {
    const bytes = cat('{"note": "caf', bad, ' ', bad, ' ', bad, '", "rows": [{"a": 1}, {"a": 2}]}');
    const blob = new Blob([bytes as BlobPart]);
    const src = new CoreSource(blob, 'r.json', (p) => new HugeClient(blob, { name: 'r.json' }, p, inProcess(bytes)));
    await ended(src);
    const session = { src, indent: '  ', selected: null, meta: { name: 'r.json' }, ui: { get: () => ({ edit: null }) } } as unknown as HugeSession;
    const tasks = new HugeTasks(session);
    const root = await src.root();
    const at = { scope: { start: 0, end: bytes.length, multi: false }, path: [], node: root, t: OBJ, count: root.count };
    const r = await (tasks as unknown as { records(at: unknown, blob: () => Promise<Blob>): Promise<{ scope: { start: number; end: number } }> }).records(at, async () => blob);
    const want = [Buffer.from(bytes).indexOf('[{'), Buffer.from(bytes).lastIndexOf(']') + 1];
    assert.deepEqual([r.scope.start, r.scope.end], want, `the rows' bytes (${bad})`);
    tasks.destroy();
    await src.destroy();
  }
});

test('REVIEW-3 B3: a command on the selected value: the second of two members named alike, by its index path', async () => {
  const text = '{"a": {"v": 1}, "a": {"v": 2, "w": [3]}}';
  const bytes = enc.encode(text);
  const blob = new Blob([bytes as BlobPart]);
  const src = new CoreSource(blob, 'd.json', (p) => new HugeClient(blob, { name: 'd.json' }, p, inProcess(bytes)));
  await ended(src);
  const chain = (await src.resolve(['a'], undefined, [1]))!;
  const selected = { node: chain.at(-1)!, path: ['a'], at: [1] };
  const session = { src, indent: '  ', selected, meta: { name: 'd.json' }, ui: { get: () => ({ edit: null }) } } as unknown as HugeSession;
  const tasks = new HugeTasks(session);
  const summary = await (src as unknown as { doc: { summary(): Promise<unknown> } }).doc.summary();
  const at = await (tasks as unknown as { scopeIn(s: unknown, t: string): Promise<{ scope: { start: number; end: number } }> }).scopeIn(summary, 'value');
  assert.equal(text.slice(at.scope.start, at.scope.end), '{"v": 2, "w": [3]}', 'the second "a"');
  tasks.destroy();
  await src.destroy();
});

test('A big object\'s records array (bestArray) is the one records() picks: wrappers unwrapped, tables and records kept', async () => {
  const { records: recordsOf } = await import('../lib/convert/xlsx');
  const { parse: parseNodes } = await import('../lib/json/parser');
  const docs = [
    { meta: { page: 1 }, data: [{ a: 1 }, { a: 2 }] },
    { result: { items: [{ a: 1 }, { a: 2 }, { a: 3 }], next: null }, other: [{ b: 1 }] },
    { alice: { age: 30, orders: [{ id: 1 }, { id: 2 }] }, bob: { age: 40, orders: [{ id: 3 }] } },
    { '2026-01-01': { n: 1, list: [{ x: 1 }] }, '2026-01-02': { n: 2 } },
    { id: 1, items: [{ a: 1 }, { a: 2 }] },
    { jsonrpc: '2.0', id: 7, result: [{ a: 1 }] },
    { data: { id: 5, tags: [{ t: 1 }, { t: 2 }] }, list: [{ z: 1 }] },
    { a: 1, b: 'x' },
  ];
  for (const doc of docs) {
    const text = JSON.stringify(doc);
    const bytes = enc.encode(text);
    const blob = new Blob([bytes as BlobPart]);
    const src = new CoreSource(blob, 'r.json', (p) => new HugeClient(blob, { name: 'r.json' }, p, inProcess(bytes)));
    await ended(src);
    const session = { src, indent: '  ', selected: null, meta: { name: 'r.json' }, ui: { get: () => ({ edit: null }) } } as unknown as HugeSession;
    const tasks = new HugeTasks(session);
    const best = await (tasks as unknown as { bestArray(n: unknown, blob: () => Promise<Blob>): Promise<{ start: number; end: number } | null> }).bestArray(((await (src as unknown as { doc: { summary(): Promise<{ root: unknown }> } }).doc.summary()).root), async () => blob);
    const root = parseNodes(text).root!;
    const rec = recordsOf(root);
    const want = rec === root ? null : text.slice(rec.s, rec.e);
    assert.equal(best && text.slice(best.start, best.end), want, text);
    tasks.destroy();
    await src.destroy();
  }
});
