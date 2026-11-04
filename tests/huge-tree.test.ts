import test from 'node:test';
import assert from 'node:assert/strict';
import { ARR, NUM, OBJ } from '../lib/json/parser';
import { FETCH, MAX_WINDOW, NodeCache, Open, PAGE, TreeModel, type Row } from '../lib/huge/tree-model';
import { SmallSource } from '../lib/huge/small-source';
import type { HugeNode } from '../lib/huge/source';

/** A container of `count` items at `at` (a fake: the model only reads its kind and count). */
const box = (count: number, at = 0, depth = 0, i = 0): HugeNode => ({ at, end: at + 1, t: count % 2 ? ARR : OBJ, key: i, i, depth, count, text: '' });

/** Every row by walking the open containers whole: the model must agree with it everywhere. */
function oracle(m: TreeModel): string[] {
  const out: string[] = [];
  const visit = (o: Open, label: string) => {
    out.push(`node ${label}`);
    if (o.before) out.push(`prev ${label}`);
    for (let i = o.from; i < o.from + o.listed; i++) {
      const kid = o.kids.get(i);
      const name = `${label}/${i}`;
      if (kid) visit(kid, name);
      else out.push(`node ${name}`);
    }
    if (o.after) out.push(`next ${label}`);
  };
  if (m.root) visit(m.root, '');
  return out;
}

/** Resolves once `src` has indexed everything. */
export const indexed = (src: SmallSource) => new Promise<void>((done) => {
  if (src.state().done) return done();
  const stop = src.onState((s) => s.done && (stop(), done()));
});

const label = (r: Row | null) => {
  if (!r) return 'none';
  const path = r.kind === 'node' ? (r.parent ? [...r.parent.path, r.i] : []) : r.parent.path;
  return `${r.kind} ${path.map((x) => '/' + x).join('')}`;
};

test('rows found from open containers match a full walk through random opens, closes and paging', () => {
  let seed = 0x5eed;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const m = new TreeModel();
  m.setRoot(box(2_345));
  let at = 1;
  for (let step = 0; step < 400; step++) {
    const rows = oracle(m);
    assert.equal(m.count, rows.length, `row count at step ${step}`);
    // Every row (or a sample of a long list) maps both ways.
    for (let k = 0; k < 40; k++) {
      const r = random(rows.length);
      const row = m.rowAt(r);
      assert.equal(label(row), rows[r], `row ${r} at step ${step}`);
      assert.equal(m.cursorRow(m.cursorOf(row!)), r, `cursor round trip for row ${r}`);
    }
    assert.equal(m.rowAt(rows.length), null);
    // A random action on a random row.
    const r = random(rows.length);
    const row = m.rowAt(r)!;
    const act = random(10);
    if (row.kind === 'next') m.next(row.parent);
    else if (row.kind === 'prev') m.prev(row.parent);
    else if (row.open && row.parent && act < 4) m.close(row.parent, row.i);
    else if (!row.open && row.parent && act < 8) m.open(row.parent, row.i, box(random(5) ? random(30) : 1_000 + random(3_000), at++, row.depth, row.i));
    else if (row.open && act === 9) m.show(row.open, random(Math.max(1, row.open.node.count)));
  }
});

test('a container of ten million items lists a page and finds any row at once', () => {
  const m = new TreeModel();
  m.setRoot(box(10_000_000));
  assert.equal(m.count, 1 + PAGE + 1);
  assert.equal(label(m.rowAt(PAGE + 1)), 'next ');
  // Going to item 7,654,321 lists its page.
  m.show(m.root!, 7_654_321);
  assert.equal(m.root!.from, 7_654_000);
  assert.equal(m.count, 1 + 1 + PAGE + 1);
  assert.equal(m.rowOf([7_654_321]), 2 + 321);
  // Show next up to the window's limit, then the window slides.
  for (let k = 0; k < MAX_WINDOW / PAGE + 5; k++) m.next(m.root!);
  assert.equal(m.root!.shown, MAX_WINDOW);
  assert.equal(m.root!.from, 7_654_000 + 6 * PAGE);
  // Finding a row stays cheap however many items are listed.
  const t0 = performance.now();
  for (let r = 0; r < 10_000; r++) m.rowAt((r * 7919) % m.count);
  assert.ok(performance.now() - t0 < 200, `${performance.now() - t0} ms for 10k lookups`);
});

test('reveal opens the containers on a path and lists each item on it', () => {
  const m = new TreeModel();
  m.setRoot(box(5_000_000));
  const chain = [box(5_000_000), { ...box(3_000, 10, 1, 4_321_000), key: 4_321_000 }, { ...box(0, 20, 2, 2_500), t: NUM, count: 0 } as HugeNode];
  const path = m.reveal(chain);
  assert.deepEqual(path, [4_321_000, 2_500]);
  const r = m.cursorRow();
  assert.ok(r > 0);
  const row = m.rowAt(r)!;
  assert.equal(row.kind, 'node');
  assert.equal(row.kind === 'node' && row.i, 2_500);
  assert.equal(m.root!.from, 4_321_000);
  // The inner container's window grew to include item 2,500 (near its first page).
  const inner = m.openAt([4_321_000])!;
  assert.equal(inner.from, 0);
  assert.equal(inner.shown, 3 * PAGE);
});

test('closing a container moves a cursor inside it onto it', () => {
  const m = new TreeModel();
  m.setRoot(box(10));
  const a = m.open(m.root!, 3, box(5, 5, 1, 3))!;
  m.open(a, 2, box(5, 9, 2, 2));
  m.cursor = { path: [3, 2, 1], kind: 'node' };
  m.close(m.root!, 3);
  assert.deepEqual(m.cursor, { path: [3], kind: 'node' });
  assert.equal(m.cursorRow(), 4);
});

test('a container still being indexed grows its rows as its count does', () => {
  const m = new TreeModel();
  const partial = { ...box(400), partial: true };
  m.setRoot(partial);
  assert.equal(m.count, 401);
  m.root!.node = { ...partial, count: 2_400 };
  m.recount();
  assert.equal(m.count, 1 + PAGE + 1);
});

test('the node cache reads a page at a time, keeps a bounded number and drops reads scrolled away', async () => {
  const doc = JSON.stringify(Array.from({ length: 5_000 }, (_, i) => ({ i })));
  const src = new SmallSource(doc, 'a.json');
  await indexed(src);
  const root = await src.root();
  let reads = 0;
  const cache = new NodeCache({ children: (c, from, n, s) => (reads++, src.children(c, from, n, s)) });
  let loads = 0;
  cache.loaded = () => loads++;
  assert.equal(cache.get(root, 450), undefined);
  assert.equal(cache.get(root, 401), undefined);
  assert.equal(reads, 1, 'one read for the page');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(loads, 1);
  const n = cache.get(root, 450)!;
  assert.equal(n.i, 450);
  assert.equal(n.t, OBJ);
  assert.equal(n.key, 450);
  assert.equal(Math.floor(450 / FETCH), 2);
  // A read no longer wanted is aborted, and its answer dropped.
  cache.get(root, 4_000);
  cache.keepOnly(new Set());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(loads, 1);
  src.destroy();
});
