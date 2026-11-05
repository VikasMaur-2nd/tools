/**
 * The independent review's findings 1–3 (REVIEW-GPT.md), each in its own scenario first:
 * 1. a Find held every block it scanned (async blocks in Chromium: pinned, never let go);
 * 2. a character outside the BMP (a surrogate pair) cut by a 256-unit stride of the byte↔UTF-16 mapping moved
 *    later spans by 2 bytes (locate, resolve, pretty positions, the bytes copied, saved or edited);
 * 3. raw lines read past what's read (the indexing front, a stop, an error) to the end of the file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { BlockSource } from '../lib/huge/bytes';
import { HugeDoc } from '../lib/huge/doc';
import { HugeEditor } from '../lib/huge/editor';
import { PageNodes } from '../lib/huge/page';
import { hugeMod, tapeMod, memSource } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();
const parsers = { wasm: tapeMod, parse };

function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m) => setImmediate(() => b.onmessage?.({ data: m })) };
  const b: Port = { onmessage: null, postMessage: (m) => setImmediate(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

test('review 1: a Find holds no more blocks than the cache keeps, during it, after it, and when stopped', async () => {
  // (The reviewer's: a 32 MiB string, 1 MiB blocks, 24 kept; a query that isn't in it scans it all.)
  const bytes = enc.encode('"' + 'x'.repeat(32 << 20) + '"');
  const file = new Blob([bytes as BlobPart]);
  const [page, worker] = channel();
  let blocks: BlockSource | null = null;
  serve(worker, async () => ({ huge: hugeMod, parsers }), (f) => (blocks = Object.assign(new BlockSource(f, 1 << 20, 24), { cached: true })), () => ({ ...memSource(bytes), has: () => true, need: () => Promise.resolve() }));
  const c = new HugeClient(file, {}, undefined, page);
  await c.ready;
  // (Pinned counted at every read of the file as the scan goes: a query with no match has no batch till the end.)
  let most = 0;
  let fetches = 0;
  const bs = blocks! as BlockSource;
  const fetch = bs.fetch.bind(bs);
  bs.fetch = (ks, scope) => {
    fetches++;
    most = Math.max(most, bs.pinnedBlocks);
    return fetch(ks, scope).then(() => void (most = Math.max(most, bs.pinnedBlocks)));
  };
  await new Promise<void>((done) => c.find('not-in-file', {}, (b) => b.done && done()));
  assert.ok(fetches >= 8, `reads: ${fetches}`);
  assert.ok(most <= 12, `pinned while finding: ${most}`);
  assert.equal(blocks!.pinnedBlocks, 0, 'pinned after');
  assert.ok(blocks!.heldBlocks <= 24, `held after: ${blocks!.heldBlocks}`);
  // Stopped part way: let go too.
  let stop: () => void = () => {};
  await new Promise<void>((done) => {
    let n = 0;
    stop = c.find('still-not-in-file', {}, (b) => {
      if (++n === 2) stop();
      if (b.done) done();
    });
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(blocks!.pinnedBlocks, 0, 'pinned after a stopped find');
  // A query during a find keeps what it needs (its own blocks), and both answer.
  const findDone = new Promise<void>((done) => c.find('nope', {}, (b) => b.done && done()));
  const s = await c.summary();
  const t = await c.text(30 << 20, (30 << 20) + 10, 10);
  assert.equal(t.text, 'xxxxxxxxxx');
  assert.ok(s.root);
  await findDone;
  assert.equal(blocks!.pinnedBlocks, 0, 'pinned after both');
  c.close();
});

test('review 2: a character outside the BMP cut by a stride: spans, paths, pretty positions, copies and edits stay right', () => {
  for (let n = 240; n <= 270; n++) {
    for (const [pre, post] of [
      ['["', '",123]'],
      ['{"k": "', '", "v": 123}'],
    ]) {
      const text = pre + 'a'.repeat(n) + '😀' + post;
      const b = enc.encode(text);
      const where = ` (padding ${n}, ${pre})`;
      const d = new HugeDoc(memSource(b), hugeMod, parsers);
      d.step(Infinity);
      const at = enc.encode(text.slice(0, text.indexOf('123'))).length;
      const path = pre[0] === '[' ? [1] : ['v'];
      // locate, resolve, the bytes they give, the page's span, the pretty line's position.
      const loc = d.resolve(path)!;
      assert.deepEqual([loc.node.start, loc.node.end], [at, at + 3], 'resolve' + where);
      assert.deepEqual([d.locate(at)!.node.start, d.locate(at)!.node.end], [at, at + 3], 'locate' + where);
      assert.equal(d.text(loc.node.start, loc.node.end, 100).text, '123', 'copied' + where);
      const view = new PageNodes(d.children(d.summary().root!, 0, 5));
      assert.deepEqual(view.span(view.children[1]), [at, at + 3], 'page span' + where);
      const pretty = d.prettyLines(0, 10, '  ', 1 << 16);
      assert.ok(Array.from(pretty.pos).includes(at), `pretty position ${Array.from(pretty.pos)}` + where);
      // Edits at what they give: the bytes changed are the ones meant.
      const ed = new HugeEditor(d);
      ed.setValue(d.resolve(path)!.node, '45678');
      assert.equal(dec.decode(d.src.read(0, d.src.size)), text.replace('123', '45678'), 'set' + where);
      const root = d.summary().root!;
      ed.duplicate(root, 1);
      const dup = pre[0] === '[' ? text.replace('123]', '45678,45678]') : text.replace('"v": 123}', '"v": 45678, "v (copy)": 45678}');
      assert.equal(dec.decode(d.src.read(0, d.src.size)), dup, 'duplicate' + where);
      ed.remove(d.summary().root!, 2);
      ed.remove(d.summary().root!, 1);
      assert.equal(dec.decode(d.src.read(0, d.src.size)), pre + 'a'.repeat(n) + '😀' + (pre[0] === '[' ? '"]' : '"}'), 'removed' + where);
      ed.insert(d.summary().root!, 1, '7', pre[0] === '[' ? null : 'v');
      assert.equal(dec.decode(d.src.read(0, d.src.size)), text.replace('123', '7'), 'inserted' + where);
    }
  }
});

test('review 3: raw lines read no further than what is read (while indexing, stopped, broken), and a long line answers its start', () => {
  // (The reviewer's: 8,200 bytes, one line, 64 read.)
  const bytes = enc.encode('{"a":"' + 'x'.repeat(8192) + '"}');
  let end = 0;
  const src = { ...memSource(bytes), cached: true, read: (at: number, len: number) => ((end = Math.max(end, at + len)), bytes.subarray(at, at + len)) };
  const d = new HugeDoc(src, hugeMod, parsers, { every: 64, big: 64 }, { window: 64, queryWindow: 64 });
  d.step(0);
  const front = d.progress().bytes;
  end = 0;
  const r = d.rawLines(0, 1, 20);
  assert.ok(end <= front + 64, `read through ${end} with ${front} read`);
  assert.equal(r.text[0], '{"a":"xxxxxxxxxxxxxx');
  assert.equal(r.cut[0], 2, 'an unfinished line');
  assert.ok(r.length[0] <= front, `its length so far: ${r.length[0]}`);
  // Stopped there: the same.
  d.stop();
  end = 0;
  d.rawLines(0, 3, 20);
  assert.ok(end <= front + 64, `stopped: read through ${end}`);
  // Broken: no further than the error.
  const broken = enc.encode('[1,\n2,\n' + 'x'.repeat(5000) + '\n,3]');
  let bend = 0;
  const bsrc = { ...memSource(broken), cached: true, read: (at: number, len: number) => ((bend = Math.max(bend, at + len)), broken.subarray(at, at + len)) };
  const bd = new HugeDoc(bsrc, hugeMod, parsers, { every: 64, big: 64 }, { window: 64, queryWindow: 64 });
  bd.step(Infinity);
  assert.ok(bd.summary().error);
  bend = 0;
  const br = bd.rawLines(0, 5, 10);
  assert.ok(bend <= bd.summary().error!.pos + 128, `broken: read through ${bend} (error at ${bd.summary().error!.pos})`);
  assert.deepEqual(br.text.slice(0, 2), ['[1,', '2,']);
  // All read, one long line (10 MiB, no break), minified values or one big string: its start and length come
  // without reading it all (from the last checkpoint on it; big strings skipped by the directory).
  for (const doc of ['[' + '1,'.repeat(5 << 20) + '1]', '["' + 'y'.repeat(10 << 20) + '"]']) {
    const long = enc.encode(doc);
    let lend = 0;
    let reads = 0;
    const lsrc = { ...memSource(long), cached: true, read: (at: number, len: number) => ((lend = Math.max(lend, at + len)), (reads += Math.min(len, long.length - at)), long.subarray(at, at + len)) };
    const ld = new HugeDoc(lsrc, hugeMod, parsers);
    ld.step(Infinity);
    reads = 0;
    const lr = ld.rawLines(0, 1, 50);
    assert.equal(lr.text[0], doc.slice(0, 50));
    assert.equal(lr.cut[0], 1);
    assert.equal(lr.length[0], long.length);
    assert.ok(reads <= 3 << 20, `a long line (${doc.slice(0, 4)}…): read ${reads} bytes`);
  }
});
