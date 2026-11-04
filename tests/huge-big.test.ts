/**
 * Huge-file mode on documents of several GB made on the fly (tests/huge-sources.ts): offsets past 2^31, a
 * string bigger than any window, an error near the end; memory stays what the index needs. `pnpm test --slow`
 * reads 10 GB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH } from '../lib/json/parser';
import { parse } from '../lib/json/tape-parser';
import { HugeDoc } from '../lib/huge/doc';
import { PageNodes } from '../lib/huge/page';
import { hugeMod, tapeMod, normalStatus, enc } from './huge-oracle';
import { LongString, Records } from './huge-sources';

const SLOW = !!process.env.TEST_SLOW;
const GB = 1 << 30;

const open = (src: import('../lib/json/tape-wasm').ByteSource, name = 'big.json') => {
  const d = new HugeDoc(src, hugeMod, { wasm: tapeMod, parse }, { name });
  const t0 = performance.now();
  d.step(Infinity);
  return { d, ms: performance.now() - t0 };
};

test(`records past 2^31 bytes (${SLOW ? 10 : 2.5} GB): counts, pages, paths, lines, find`, () => {
  const per = new Records(1).len + 2;
  const src = new Records(Math.ceil(((SLOW ? 10 : 2.5) * GB) / per));
  const n = src.count;
  const { d, ms } = open(src);
  const s = d.summary();
  assert.equal(s.error, null);
  assert.equal(s.records, 1);
  assert.equal(s.root!.count, n);
  assert.equal(s.root!.end, src.size);
  assert.equal(s.lines, n + 1);
  // Per record: the object, id, name, tags (4 items), v.
  assert.equal(s.nodes, 1 + n * 9);
  assert.equal(s.prettyLines, 2 + n * 11);
  // The index is small: about a checkpoint per MB.
  assert.ok(s.indexBytes < 8 << 20, `index ${s.indexBytes}`);
  console.log(`  ${(src.size / GB).toFixed(2)} GB indexed in ${(ms / 1000).toFixed(1)} s (${(src.size / 1e6 / (ms / 1000)).toFixed(0)} MB/s, synthetic source included), index ${(s.indexBytes / 1e6).toFixed(1)} MB`);

  for (const k of [0, 1, Math.floor(n / 2), n - 1000, n - 1]) {
    const t0 = performance.now();
    const page = d.children(s.root!, k, 1000);
    const ms2 = performance.now() - t0;
    const view = new PageNodes(page);
    assert.equal(page.count, Math.min(1000, n - k));
    assert.equal(page.more, k + page.count < n);
    const first = view.children[0];
    assert.equal(first.key, k);
    assert.deepEqual(view.span(first), [src.start(k), src.start(k) + src.len]);
    assert.equal(JSON.stringify(JSON.parse(page.text).at(0)), JSON.stringify(JSON.parse(src.text(k))));
    if (k === Math.floor(n / 2)) console.log(`  page of 1000 at record ${k}: ${ms2.toFixed(1)} ms`);
  }

  const k = n - 12345;
  const at = d.resolve([k, 'name']);
  assert.ok(at);
  assert.equal(at!.node.start, src.start(k) + src.text(k).indexOf('"item '));
  assert.deepEqual(at!.path, [k, 'name']);
  assert.equal(at!.line, k + 1);
  const loc = d.locate(src.start(k) + 30);
  assert.deepEqual(loc!.path, [k, 'name']);
  assert.equal(loc!.parent!.start, src.start(k));
  assert.equal(loc!.index, 1);

  const raw = d.rawLines(k, 2, 1 << 16);
  assert.deepEqual(raw.text, [src.text(k) + ',', src.text(k + 1) + ',']);
  assert.equal(raw.pos[0], src.start(k));

  // Pretty: `[`, then 11 lines a record.
  const pretty = d.prettyLines(1 + k * 11, 11, '  ', 1 << 16);
  assert.deepEqual(pretty.text.slice(0, 3), ['  {', `    "id": ${k},`, `    "name": "item ${String(k).padEnd(12)}",`]);
  assert.equal(pretty.text[10], '  },');
  assert.equal(pretty.close![0], 1 + k * 11 + 10);
  assert.equal(pretty.pos[1], src.start(k) + 6 + 12 - String(k).length);

  const needle = `item ${String(k).padEnd(12)}`;
  const got: number[] = [];
  for (const b of d.find(needle, { from: src.start(k) - 4096, limit: 1 })) got.push(...b.matches);
  assert.deepEqual(got, [src.start(k) + src.text(k).indexOf('item ')]);
});

test('a string bigger than memory would hold in one piece (3 GB): skipped across windows, paged as a stub', () => {
  const src = new LongString(3 * GB);
  const { d } = open(src);
  const s = d.summary();
  assert.equal(s.error, null);
  assert.equal(s.nodes, 5);
  // Memory: the query skeleton never saw it whole; the indexer's stays its window and buffers.
  assert.ok((d as unknown as { ix: { memoryBytes: number } }).ix.memoryBytes < 32 << 20);
  const page = d.children(s.root!, 0, 10);
  const view = new PageNodes(page);
  assert.equal(page.count, 2);
  const a = view.stub(view.children[0]);
  assert.ok(a);
  assert.equal(a!.kind, 3);
  assert.equal(a!.end - a!.start, 3 * GB + 2);
  assert.equal(view.children[1].key, 'b');
  const lines = d.prettyLines(0, 10, '  ', 100);
  assert.equal(lines.total, 7);
  assert.equal(lines.cut[1], 1);
  assert.ok(lines.text[1].startsWith('  "a": "xxx'));
  assert.equal(lines.text[2], '  "b": [');
  const raw = d.rawLines(0, 1, 50);
  assert.equal(raw.cut[0], 1);
  assert.equal(raw.length[0], src.size - 1);
  assert.deepEqual(d.locate(src.size - 4)?.path, ['b', 1]);
  assert.equal(d.text(0, src.size, 10).text, '{"a": "xxx');
});

test('an error near the end of 2.5 GB: the normal path\'s message, line and column', () => {
  const per = new Records(1).len + 2;
  const n = Math.ceil((2.5 * GB) / per);
  const src = new Records(n, n - 7);
  const { d } = open(src);
  // The normal path's message for the same record, broken the same way, in a small document.
  const small = new Records(10, 3);
  const want = normalStatus(small.read(0, small.size))!;
  const e = d.error!;
  assert.ok(e);
  assert.equal(e.msg, want.msg);
  assert.equal(e.col, want.col);
  assert.equal(e.line, n - 7 + 1);
  assert.equal(e.pos, src.start(n - 7) + (want.p - (small.start(3))));
  // Valid before it: browsable.
  const page = d.children(d.summary().root!, n - 10, 2);
  assert.equal(page.count, 2);
});

test('JSON Lines past 2^31 bytes: records as a list, lines, the last record', () => {
  const per = new Records(1, -1, true).len + 1;
  const src = new Records(Math.ceil((2.2 * GB) / per), -1, true);
  const n = src.count;
  const { d } = open(src, 'big.jsonl');
  const s = d.summary();
  assert.equal(s.error, null);
  assert.equal(s.records, n);
  assert.ok(s.multi && s.jsonl);
  assert.equal(s.root!.kind, 6);
  const page = d.children(s.root!, n - 1, 5);
  assert.equal(page.count, 1);
  assert.equal(page.more, false);
  assert.equal(new PageNodes(page).children[0].key, n - 1);
  assert.deepEqual(d.locate(src.start(n - 1) + 2)?.path, [n - 1, 'id']);
  const pretty = d.prettyLines(s.prettyLines - 3, 3, '  ', 100);
  assert.deepEqual(pretty.text, ['    "v": 0.5', '  }', ']']);
  void MAX_DEPTH;
  void enc;
});
