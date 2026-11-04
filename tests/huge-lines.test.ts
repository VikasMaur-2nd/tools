import test from 'node:test';
import assert from 'node:assert/strict';
import { AHEAD, BLOCK, MAX_BLOCKS, SparseLines } from '../lib/huge/lines-model';
import { MAX_HITS, StreamFind } from '../lib/huge/find';
import type { HugeLine, HugeSource } from '../lib/huge/source';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Lines "line k", read after a microtask; records every read and every abort. */
function fakeLines(count: number) {
  const reads: number[] = [];
  const aborts: number[] = [];
  const read = (from: number, n: number, signal: AbortSignal) => {
    reads.push(from);
    signal.addEventListener('abort', () => aborts.push(from));
    return new Promise<HugeLine[]>((ok, fail) =>
      queueMicrotask(() => {
        if (signal.aborted) return fail(new DOMException('Aborted', 'AbortError'));
        const out: HugeLine[] = [];
        for (let k = from; k < Math.min(count, from + n); k++) out.push({ text: `line ${k}`, more: 0, at: k * 10 });
        ok(out);
      }),
    );
  };
  return { reads, aborts, read };
}

test('lines in view are read a block at a time, with blocks ahead in the direction of scrolling', async () => {
  const f = fakeLines(1_000_000_000);
  const lines = new SparseLines(f.read);
  lines.count = 1_000_000_000;
  let loaded = 0;
  lines.loaded = () => loaded++;
  assert.equal(lines.get(5), undefined, 'placeholder until read');
  lines.want(0, 40);
  assert.deepEqual(f.reads, [0, BLOCK, 2 * BLOCK].slice(0, 1 + AHEAD));
  await tick();
  assert.equal(lines.get(5)!.text, 'line 5');
  assert.ok(loaded >= 1);
  // Far down (a 1-billion-line document): only blocks around the view are read.
  f.reads.length = 0;
  const far = 987_654_321;
  lines.want(far, far + 40);
  const b = Math.floor(far / BLOCK);
  assert.deepEqual(f.reads.sort((x, y) => x - y), [(b - 1) * BLOCK, b * BLOCK, (b + 1) * BLOCK, (b + 2) * BLOCK].filter((x) => x <= Math.floor((far + 39) / BLOCK) * BLOCK + AHEAD * BLOCK));
  await tick();
  assert.equal(lines.get(far)!.text, `line ${far}`);
  // Scrolling up reads ahead upwards.
  f.reads.length = 0;
  lines.want(far - 3 * BLOCK, far - 3 * BLOCK + 40);
  assert.ok(f.reads.some((x) => x < (b - 3) * BLOCK), 'a block above is read ahead');
});

test('blocks kept are bounded; reads scrolled away are dropped', async () => {
  const f = fakeLines(10_000_000);
  const lines = new SparseLines(f.read);
  lines.count = 10_000_000;
  for (let k = 0; k < 300; k++) {
    lines.want(k * 4 * BLOCK, k * 4 * BLOCK + 50);
    await tick();
  }
  assert.ok(lines.held <= MAX_BLOCKS, `${lines.held} blocks held`);
  // A jump before the reads answer: the old ones are aborted.
  f.aborts.length = 0;
  lines.want(100 * BLOCK, 100 * BLOCK + 50);
  lines.want(9_000_000, 9_000_050);
  assert.ok(f.aborts.includes(100 * BLOCK));
  await tick();
  assert.equal(lines.get(100 * BLOCK), undefined);
  assert.equal(lines.get(9_000_000)!.text, 'line 9000000');
});

test('a short last block is read again once the count grows (indexing goes on)', async () => {
  let count = 100;
  const f = fakeLines(1e9);
  const lines = new SparseLines((from, n, s) => f.read(from, Math.min(n, count - from), s));
  lines.count = count;
  lines.want(60, 100);
  await tick();
  assert.equal(lines.get(99)!.text, 'line 99');
  assert.equal(lines.get(110), undefined);
  count = lines.count = 400;
  f.reads.length = 0;
  lines.want(90, 130);
  assert.ok(f.reads.includes(0), 'the first block, short before, is read again');
  await tick();
  assert.equal(lines.get(110)!.text, 'line 110');
});

/** A source whose find answers from a list of offsets, in batches of `per`, a tick apart. */
function fakeFind(all: number[], per = 3, size = 1_000_000) {
  let resume: (() => void) | null = null;
  const src: Pick<HugeSource, 'find' | 'size'> = {
    size,
    find: async (_q, _from, hits, signal) => {
      for (let k = 0; k < all.length; k += per) {
        await new Promise<void>((r) => (resume = r));
        if (signal.aborted) return;
        hits(all.slice(k, k + per), Math.min(size, all[Math.min(all.length - 1, k + per - 1)] + 1));
      }
      await new Promise<void>((r) => (resume = r));
    },
  };
  const step = async () => {
    const r = resume;
    resume = null;
    r?.();
    await tick();
  };
  return { src, step };
}

test('find: the first match after the view becomes current as it arrives; Next waits for more', async () => {
  const jumps: number[] = [];
  const f = fakeFind([10, 20, 30, 400, 500, 600, 700]);
  const find = new StreamFind(f.src, (at) => jumps.push(at), () => undefined);
  find.start('x', 250);
  await f.step();
  assert.deepEqual(jumps, [], 'none after the view yet');
  assert.equal(find.view().total, 3);
  await f.step();
  assert.deepEqual(jumps, [400]);
  assert.equal(find.view().index, 3);
  find.step(1);
  find.step(1);
  assert.deepEqual(jumps, [400, 500, 600]);
  // Past what was found: waits, and goes on as the next arrives.
  find.step(1);
  assert.equal(find.view().waiting, true);
  await f.step();
  assert.deepEqual(jumps, [400, 500, 600, 700]);
  assert.equal(find.view().waiting, false);
  // The end: Next wraps round once the search is over.
  find.step(1);
  assert.equal(find.view().waiting, true);
  await f.step();
  assert.equal(find.view().done, true);
  assert.deepEqual(jumps.slice(-1), [10]);
  find.step(-1);
  assert.deepEqual(jumps.slice(-1), [700]);
});

test('find: a new query drops the old search; the count stops at its limit', async () => {
  const many = Array.from({ length: MAX_HITS + 50 }, (_, k) => k * 2);
  const f = fakeFind(many, 40_000, 1e9);
  const jumps: number[] = [];
  const find = new StreamFind(f.src, (at) => jumps.push(at), () => undefined);
  find.start('a');
  await f.step();
  find.start('b');
  assert.equal(find.view().total, 0);
  for (let k = 0; k < 4; k++) await f.step();
  const v = find.view();
  assert.equal(v.total, MAX_HITS);
  assert.equal(v.more, true);
  assert.equal(v.done, true);
  assert.equal(jumps[jumps.length - 1], 0);
});
