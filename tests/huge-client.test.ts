/**
 * The page-side client (client.ts) and the worker (serve.ts) talking through an in-process port: indexing in
 * slices with progress, queries answered while indexing, transfers, find streamed and stopped, failures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { Prefetch } from '../lib/huge/prefetch';
import { BlockSource } from '../lib/huge/bytes';
import { Wait } from '../lib/huge/wait';
import { PageNodes } from '../lib/huge/page';
import type { HugeProgress } from '../lib/huge/types';
import { hugeMod, tapeMod, memSource, normalStatus } from './huge-oracle';
import { Records } from './huge-sources';

/** Two ends of a channel; messages are structured-cloned as postMessage would (transfers move buffers). */
function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m, t) => setImmediate(() => b.onmessage?.({ data: structuredClone(m, { transfer: t as Transferable[] }) })) };
  const b: Port = { onmessage: null, postMessage: (m, t) => setImmediate(() => a.onmessage?.({ data: structuredClone(m, { transfer: t as Transferable[] }) })) };
  return [a, b];
}

/** A client on a worker that reads `bytes` (a Blob stands for the file; the worker reads the bytes). */
function connect(bytes: Uint8Array | Records, onProgress?: (p: HugeProgress) => void, name = 'a.json') {
  const [page, worker] = channel();
  const file = new Blob([(bytes instanceof Uint8Array ? bytes : bytes.read(0, bytes.size)) as BlobPart]);
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => (bytes instanceof Uint8Array ? memSource(bytes) : bytes));
  return new HugeClient(file, { name, every: 1 << 16, big: 1 << 14 }, onProgress, page);
}

test('client: progress while indexing, then the summary; pages, lines, paths, text', async () => {
  const src = new Records(400_000);
  const seen: HugeProgress[] = [];
  const doc = connect(src, (p) => seen.push(p));
  // A query before indexing is done: answered from what's read.
  const early = await doc.summary();
  assert.equal(early.done, false);
  const s = await doc.ready;
  assert.equal(s.done, true);
  assert.equal(s.error, null);
  assert.equal(s.root!.count, 400_000);
  assert.ok(seen.length > 0 && seen.every((p) => p.size === src.size && p.bytes <= src.size));
  const page = await doc.children(s.root!, 123_456, 50);
  const view = new PageNodes(page);
  assert.equal(view.children.length, 50);
  assert.equal(view.children[0].key, 123_456);
  assert.deepEqual(view.span(view.children[0]), [src.start(123_456), src.start(123_456) + src.len]);
  const lines = await doc.prettyLines(1 + 11 * 7, 3);
  assert.deepEqual(lines.text, ['  {', '    "id": 7,', '    "name": "item 7           ",']);
  const raw = await doc.rawLines(5, 1);
  assert.equal(raw.text[0], src.text(5) + ',');
  const at = await doc.resolve('$[399999].tags[3]');
  assert.deepEqual(at!.path, [399_999, 'tags', 3]);
  assert.equal((await doc.text(at!.node.start, at!.node.end)).text, 'true');
  assert.equal(await doc.resolve('$[400000]'), null);
  const loc = await doc.locate(src.start(42) + 2);
  assert.deepEqual(loc!.path, [42, 'id']);
  assert.equal(doc.blob(0, 10).size, 10);
  doc.close();
});

test('client: find streams batches and stops when asked', async () => {
  const src = new Records(200_000);
  const doc = connect(src);
  await doc.ready;
  // Every record has "tags": 200,000 matches; stop after the first batch.
  const batches: number[] = [];
  await new Promise<void>((done) => {
    const stop = doc.find('"TAGS"', { caseSensitive: false }, (b) => {
      batches.push(b.matches.length);
      if (b.done) done();
      else stop();
    });
  });
  const total = batches.reduce((a, b) => a + b, 0);
  assert.ok(total > 0 && total < 200_000, `stopped early: ${total}`);
  // From a place, the next match only.
  const one: number[] = [];
  await new Promise<void>((done) =>
    doc.find('item 77 ', { from: src.start(70), limit: 1 }, (b) => {
      one.push(...b.matches);
      if (b.done) done();
    }),
  );
  assert.deepEqual(one, [src.start(77) + src.text(77).indexOf('item 77 ')]);
  doc.close();
});

test('client: a broken document reports the first problem; queries still answer before it', async () => {
  const bytes = new TextEncoder().encode('[1, 2, {"a": [true, false]}, 4,, 5]');
  const doc = connect(bytes);
  const s = await doc.ready;
  const want = normalStatus(bytes)!;
  assert.equal(s.error!.msg, want.msg);
  assert.equal(s.error!.col, want.col);
  const page = await doc.children(s.root!, 0, 10);
  assert.equal(page.count, 4);
  doc.close();
});

test('client: failures carry fixed messages, never the document', async () => {
  // A known one passes: nesting too deep to indent.
  const doc = connect(new TextEncoder().encode('[[[1]]]'));
  await doc.ready;
  await assert.rejects(doc.prettyLines(0, 5, ' '.repeat(20_000)), /^Error: Nesting is too deep to format$/);
  doc.close();
  await assert.rejects(doc.summary(), /Closed/);
  // An unexpected one whose message holds document text is replaced.
  const [page, worker] = channel();
  serve(worker, async () => {
    throw new Error('{"secret": "value"}');
  }, () => memSource(new Uint8Array(0)));
  const bad = new HugeClient(new Blob([]), {}, undefined, page);
  await assert.rejects(bad.ready, (e: Error) => e.message === 'Query failed');
  bad.close();
});

test('client: the indexing pass reads ahead from a Blob (prefetch.ts), the same index', async () => {
  const src = new Records(150_000);
  const bytes = src.read(0, src.size);
  const [page, worker] = channel();
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes), (f) => new Prefetch(f, 1 << 20, 2));
  const doc = new HugeClient(new Blob([bytes as BlobPart]), { name: 'a.json' }, undefined, page);
  const s = await doc.ready;
  assert.equal(s.error, null);
  assert.equal(s.root!.count, 150_000);
  assert.equal(s.lines, 150_001);
  const at = await doc.resolve([149_999, 'v']);
  assert.equal(at!.node.start, src.start(149_999) + src.text(149_999).indexOf('0.5'));
  doc.close();
});

test('client: queries sent before the worker has its modules wait for the document', async () => {
  const [page, worker] = channel();
  let release: () => void = () => {};
  const loaded = new Promise<void>((done) => (release = done));
  const bytes = new TextEncoder().encode('{"a": [1, 2, 3], "b": "x"}');
  serve(worker, async () => {
    await loaded;
    return { huge: hugeMod, parsers: { wasm: tapeMod, parse } };
  }, () => memSource(bytes));
  const doc = new HugeClient(new Blob([bytes as BlobPart]), {}, undefined, page);
  const early = doc.resolve('$.a[2]');
  setTimeout(release, 20);
  const at = await early;
  assert.deepEqual(at!.path, ['a', 2]);
  await doc.ready;
  doc.close();
});

test('client: queries over async blocks (BlockSource) wait for their reads; the JS parser loads late; stop', async () => {
  const src = new Records(80_000);
  const bytes = src.read(0, src.size);
  const file = new Blob([bytes as BlobPart]);
  // A parser that isn't there for the first queries (as the worker loads it after the document is made).
  let ready = false;
  const later = new Promise<void>((done) => setTimeout(() => ((ready = true), done()), 30));
  const lateParse: typeof parse = (text, options) => {
    if (!ready) throw new Wait(() => later);
    return parse(text, options);
  };
  const [page, worker] = channel();
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse: lateParse } }), (f) => Object.assign(new BlockSource(f, 1 << 16, 8), { cached: true }), (f) => new Prefetch(f, 1 << 20, 2));
  const doc = new HugeClient(file, { name: 'a.json' }, undefined, page);
  const s0 = await doc.summary();
  assert.ok(s0.root);
  const s = await doc.ready;
  assert.equal(s.root!.count, 80_000);
  const at = await doc.resolve([79_999, 'tags', 2]);
  assert.equal(at!.node.start, src.start(79_999) + src.text(79_999).indexOf('null'));
  assert.equal(at!.chain.length, 3);
  assert.equal((await doc.prettyLines(1 + 11 * 500, 2)).text[1], '    "id": 500,');
  const found: number[] = [];
  await new Promise<void>((done) => doc.find('item 77777 ', { limit: 1 }, (b) => (found.push(...b.matches), b.done && done())));
  assert.deepEqual(found, [src.start(77_777) + src.text(77_777).indexOf('item 77777 ')]);
  doc.close();
  // Stop: ready resolves stopped, what's read browsable.
  const [p2, w2] = channel();
  serve(w2, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), (f) => Object.assign(new BlockSource(f), { cached: true }), (f) => new Prefetch(f, 1 << 16, 2));
  const big = new Records(400_000);
  const doc2 = new HugeClient(new Blob([big.read(0, big.size) as BlobPart]), {}, undefined, p2);
  await doc2.summary();
  await doc2.stop();
  const st = await doc2.ready;
  assert.ok(st.stopped && !st.done);
  const pg = await doc2.children(st.root!, 0, 10);
  assert.equal(pg.count, Math.min(10, st.root!.count ?? 0));
  doc2.close();
});
