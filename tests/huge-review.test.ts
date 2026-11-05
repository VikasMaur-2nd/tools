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
import { hugeMod, tapeMod, memSource } from './huge-oracle';

const enc = new TextEncoder();
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
