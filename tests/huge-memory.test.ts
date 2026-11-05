/*
 * What huge mode's views hold on to while browsing (REVIEW-GPT item 4): a page of children read from the core is
 * kept only within KEEP bytes, nodes carry strings of their own (not slices of a page), and the tree's and the
 * table's caches stay within their byte budgets, never letting go of what is in view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource, KEEP } from '../lib/huge/core-source';
import { CACHE_BYTES, FETCH, NodeCache } from '../lib/huge/tree-model';
import { BLOCK, MAX_BYTES, SparseLines } from '../lib/huge/lines-model';
import { parse } from '../lib/json/tape-parser';
import { ARR, NUM, OBJ, STR } from '../lib/json/parser';
import { CELL, PREVIEW, rowBytes, type HugeNode, type HugeRow, type HugeSource, type IndexState } from '../lib/huge/source';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** The core's worker run in this process (as in huge-core-source.test.ts). */
function inProcess(bytes: Uint8Array): Port {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const core = (bytes: Uint8Array<ArrayBuffer>, keep?: number) => {
  const blob = new Blob([bytes]);
  return new CoreSource(blob, 'a.json', (onProgress) => new HugeClient(blob, { name: 'a.json' }, onProgress, inProcess(bytes)), keep);
};

const ended = (src: HugeSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done) return done(src.state());
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

/** The reviewer's document: records each holding one long string. */
const longRecords = (n: number, chars: number) => {
  const record = '{"id":0,"payload":"' + 'x'.repeat(chars) + '"}';
  return enc.encode('[' + Array.from({ length: n }, (_, i) => record.replace('"id":0', `"id":${i}`)).join(',') + ']');
};

/** Reads items [0, n) of `parent` through the tree's cache, as scrolling down the tree does. */
async function readAll(cache: NodeCache, parent: HugeNode, n: number) {
  for (let i = 0; i < n; i++) {
    for (let k = 0; !cache.get(parent, i); k++) {
      if (k > 200) throw new Error(`item ${i} never came`);
      await new Promise<void>((r) => {
        cache.loaded = r;
        setTimeout(r, 20);
      });
    }
  }
}

/** The pages the nodes' containers still read from (white box: CoreSource's refs). */
function pagesHeld(src: CoreSource, nodes: HugeNode[]) {
  const refs = (src as unknown as { refs: WeakMap<HugeNode, { kept?: { view: unknown; bytes: number } }> }).refs;
  const kept = new Set<{ view: unknown; bytes: number }>();
  for (const n of nodes) {
    const k = refs.get(n)?.kept;
    if (k?.view) kept.add(k);
  }
  return { pages: kept.size, bytes: [...kept].reduce((b, k) => b + k.bytes, 0) };
}

test("the reviewer's 200 records of 100,000 characters: pages kept within KEEP, every record still opens", async () => {
  const src = core(longRecords(200, 100_000));
  await ended(src);
  const root = await src.root();
  const cache = new NodeCache(src);
  cache.failed = (e) => assert.fail(String(e));
  await readAll(cache, root, 200);
  const nodes = Array.from({ length: 200 }, (_, i) => cache.get(root, i)!);
  assert.ok(src.keeping.bytes <= KEEP, `pages kept: ${src.keeping.bytes} bytes (${src.keeping.pages} pages), at most ${KEEP}`);
  const held = pagesHeld(src, nodes);
  assert.ok(held.bytes <= KEEP, `the cached records hold ${held.pages} pages of ${held.bytes} bytes`);
  assert.ok(src.keeping.pages < 5, 'the 20 MB read is not all kept');
  for (const n of nodes) assert.ok(n.text.length <= PREVIEW && n.t === OBJ);
  // Every record opens, whether its page is still kept (read from it) or was let go (read again from the worker).
  for (const i of [0, 1, 100, 199]) {
    const kids = await src.children(nodes[i], 0, 10);
    assert.deepEqual(
      kids.map((k) => [k.key, k.t, k.text.length, !!k.clipped]),
      [
        ['id', NUM, String(i).length, false],
        ['payload', STR, PREVIEW, true],
      ],
      `record ${i}`,
    );
    assert.equal(kids[0].text, String(i));
  }
  assert.ok(pagesHeld(src, nodes).pages <= src.keeping.pages);
  cache.clear();
  src.destroy();
});

test('browsing 30 MB of long strings (tree, opened records, table rows) retains a few MB, not the pages', async () => {
  const keep = 4 << 20;
  const src = core(longRecords(300, 100_000), keep);
  await ended(src);
  const root = await src.root();
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  // The tree: every record read through its cache, and every record opened (as if expanded one after another).
  const cache = new NodeCache(src);
  await readAll(cache, root, 300);
  const opened: HugeNode[][] = [];
  for (let i = 0; i < 300; i++) opened.push(await src.children(cache.get(root, i)!, 0, 10));
  // The table: every row with its cells.
  const rows: HugeRow[] = [];
  // (A source may answer with fewer than asked: the rest is asked for next.)
  for (let i = 0; i < 300; ) {
    const got = await src.rows(root, i, 50, 50);
    assert.ok(got.length, `rows from ${i}`);
    rows.push(...got);
    i += got.length;
  }
  assert.equal(rows.length, 300);
  assert.ok(rows.every((r) => r.cells!.get('payload')!.text.length === CELL && r.cells!.get('payload')!.clipped), 'cells cut to what the table draws');
  gc();
  gc();
  const held = process.memoryUsage().heapUsed - before;
  // (Held: 300 previews and 300 cells of short text, 300 opened payloads of PREVIEW characters, the pages kept
  // within `keep`. Before: every page read, ~30 MB of text, and its decoded strings.)
  assert.ok(held < 12 << 20, `retained ${(held / 1048576).toFixed(1)} MB after reading 30 MB`);
  assert.ok(src.keeping.bytes <= keep);
  assert.ok(opened.length === 300 && cache.size > 0, 'all of it still held by the test');
  cache.clear();
  src.destroy();
});

/** A source of containers whose items are long strings (fake: no worker). */
function fakeSource(chars: number): Pick<HugeSource, 'children'> {
  const text = 'y'.repeat(chars);
  return {
    children: async (c, from, n) =>
      Array.from({ length: Math.max(0, Math.min(n, c.count - from)) }, (_, k) => ({ at: c.at + from + k, end: c.at + from + k + 1, t: STR, key: from + k, i: from + k, depth: c.depth + 1, count: 0, text, clipped: true })),
  };
}

const container = (at: number, count: number): HugeNode => ({ at, end: at + count + 1, t: ARR, key: undefined, i: 0, depth: 0, count, text: '' });

test("the tree's cache: within CACHE_BYTES, never letting go of the pages in view", async () => {
  const cache = new NodeCache(fakeSource(PREVIEW));
  // Pages of FETCH strings of PREVIEW characters: ~800 KB each, so CACHE_BYTES holds about 20 of 400.
  const parents = Array.from({ length: 60 }, (_, k) => container(k * 1_000_000, FETCH));
  const view = parents[0];
  for (const p of parents) {
    await readAll(cache, p, 1);
    // (The tree draws the first container's rows all along: its page is in view.)
    cache.keepOnly(new Set([cache.pageKey(view, 0)]));
    assert.ok(cache.weight <= CACHE_BYTES + 1_000_000, `${cache.weight} bytes kept`);
  }
  assert.ok(cache.size < 30, `${cache.size} pages kept`);
  assert.ok(cache.get(view, 0), 'the page in view stays');
  assert.equal(cache.get(parents[1], 0), undefined, 'one used long ago went');
  cache.clear();
  assert.equal(cache.weight, 0);
});

test("the table's rows: within MAX_BYTES, the blocks near the view kept", async () => {
  const cell = (k: number): HugeNode => ({ at: k, end: k + 1, t: STR, key: 'c', i: 0, depth: 2, count: 0, text: 'z'.repeat(CELL), clipped: true });
  const lines = new SparseLines<HugeRow>(async (from, n) => Array.from({ length: n }, (_, k) => ({ node: { ...cell(from + k), t: OBJ, text: '{…}' }, cells: new Map(Array.from({ length: 50 }, (_, c) => [`c${c}`, cell(c)])) })), rowBytes);
  lines.count = 100 * BLOCK;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // (A block of 128 rows of 50 cells of 300 characters: ~4 MB; MAX_BYTES holds about 4.)
  for (let b = 0; b < 40; b++) {
    lines.want(b * BLOCK, b * BLOCK + 40);
    await tick();
    await tick();
    assert.ok(lines.get(b * BLOCK), `block ${b} in view is there`);
  }
  assert.ok(lines.weight <= MAX_BYTES + 3 * rowBytes(lines.get(39 * BLOCK)!) * BLOCK, `${lines.weight} bytes kept`);
  assert.ok(lines.held < 10, `${lines.held} blocks kept`);
  assert.equal(lines.get(0), undefined, 'a block scrolled past long ago went');
});
