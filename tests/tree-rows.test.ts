import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeView, type TreeEvents } from '../lib/engine/tree';
import { ARR, parse, type JNode } from '../lib/json/parser';
import { lazyResult, madeCount, nodeAtIndex } from '../lib/json/lazy';
import { tapeOf } from '../lib/json/tape-send';
import { rng } from './oracle/compare';
import { genStrict, loosen } from './oracle/tape';

// The Tree of a document from a tape (rows as tape indexes, nodes made for the rows used) against the same
// Tree of the document as the page parses it (rows as nodes): every row drawn the same after every action.
// (Nodes are compared with assert.ok(a === b): a failed equal would print a node with its whole tape.)

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

class Viewport extends EventTarget {
  hidden = true;
  clientHeight = 480;
  scrollTop = 0;
  querySelector() {
    return { style: {} };
  }
}

const events: TreeEvents = { select() {}, copy() {}, open() {}, escape() {}, nested() {} };
const view = () => new TreeView(new Viewport() as unknown as HTMLElement, events);
type Inner = { row(n: JNode, i: number): string };

/** Every row as the Tree draws it. */
const drawn = (t: TreeView) => Array.from({ length: t.count }, (_, r) => (t as unknown as Inner).row(t.rowNode(r), r));

function preorder(root: JNode): JNode[] {
  const out: JNode[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    if (n.t >= ARR) for (let i = (n.v as JNode[]).length - 1; i >= 0; i--) stack.push((n.v as JNode[])[i]);
  }
  return out;
}

const QUERIES = ['a', 'id', 'name', '1', 'null', 'true', 'é', 'zzz', '$[0]', '$.a', '/0/a', '$.dup'];

test('a Tree from a tape lists, opens, closes, reveals and finds every row as from nodes', () => {
  const r = rng(17);
  let docs = 0;
  for (let it = 0; it < 160; it++) {
    const text = it % 4 === 3 ? loosen(r, genStrict(r, 4)) : genStrict(r, 4);
    const res = parse(text);
    if (!res.root) continue;
    docs++;
    const pre = preorder(res.root);
    const lazy = lazyResult(tapeOf(res, text), text);
    const a = view();
    const b = view();
    a.setRoot(res.root, true, res.nodes);
    b.setRoot(lazy.root, true, res.nodes);
    assert.equal(madeCount(lazy.root), 1, 'no node made for a row');
    const label = (what: string) => `${what} in ${JSON.stringify(text).slice(0, 160)}`;
    const same = (what: string) => {
      assert.equal(b.count, a.count, label(`${what}: rows`));
      assert.deepEqual(drawn(b), drawn(a), label(what));
      const sa = a.sel ? a.indexOf(a.sel) : -2;
      const sb = b.sel ? b.indexOf(b.sel) : -2;
      assert.equal(sb, sa, label(`${what}: the selected row`));
    };
    same('opened');
    for (let step = 0; step < 30; step++) {
      const k = r.int(12);
      const count = a.count;
      let what = '';
      if (k < 4 && count) {
        const row = r.int(count);
        const deep = r.chance(0.2);
        what = `toggle row ${row}${deep ? ' deep' : ''}`;
        a.toggle(a.rowNode(row), undefined, deep);
        b.toggle(b.rowNode(row), undefined, deep);
      } else if (k === 4) {
        what = 'expand all';
        a.expandAll();
        b.expandAll();
      } else if (k === 5) {
        what = 'collapse all';
        a.collapseAll();
        b.collapseAll();
      } else if (k === 6) {
        const level = 1 + r.int(4);
        what = `expand to ${level}`;
        a.expandTo(level);
        b.expandTo(level);
      } else if (k === 7 || k === 8) {
        const i = r.int(pre.length);
        what = `${k === 7 ? 'reveal' : 'select'} node ${i}`;
        const nb = nodeAtIndex(lazy.root!, i)!;
        assert.ok(nb.s === pre[i].s && nb.d === pre[i].d, label(`${what}: the same node`));
        if (k === 7) {
          a.reveal(pre[i]);
          b.reveal(nb);
        } else {
          a.select(pre[i]);
          b.select(nb);
        }
      } else if (k === 9) {
        const q = r.pick(QUERIES);
        what = `find ${q}`;
        assert.deepEqual(b.search(q, true), a.search(q, true), label(what));
      } else if (k === 10 && a.matchCount) {
        what = 'next match';
        assert.deepEqual(b.step(1), a.step(1), label(what));
      } else continue;
      same(what);
    }
  }
  assert.ok(docs > 100, `${docs} documents`);
});

test('a Tree from a tape makes nodes only for the rows it uses', async () => {
  const text = JSON.stringify(Array.from({ length: 200_000 }, (_, i) => (i % 3 ? i : { id: i, tags: ['x', i] })));
  const res = parse(text);
  const lazy = lazyResult(tapeOf(res, text), text);
  const t = view();
  t.setRoot(lazy.root, true, res.nodes);
  assert.equal(madeCount(lazy.root), 1, 'listed, nothing made');
  assert.ok(t.count > 200_000);
  // Rows used: the first screen, one far down, and what selecting and opening that one needs.
  const kept = Array.from({ length: 40 }, (_, r) => t.rowNode(r));
  const far = t.rowNode(t.count - 5);
  t.select(far);
  t.toggle(far);
  t.toggle(far);
  assert.ok(madeCount(lazy.root) < 60, `${madeCount(lazy.root)} made`);
  assert.ok(kept.length && t.rowNode(0) === kept[0], 'the same node while held');
  // The root's last item: its set's size and its place read off the tape.
  const html = (t as unknown as Inner).row(t.rowNode(t.count - 1), t.count - 1);
  assert.match(html, /aria-level="2" aria-setsize="200000" aria-posinset="200000"/);
});

test('path.ts on a tree from a tape: nodeAt at every offset and resolve of any path find the same nodes', async () => {
  const { nodeAt, pathOf, resolve } = await import('../lib/json/path');
  const r = rng(41);
  for (let it = 0; it < 120; it++) {
    const text = it % 4 === 3 ? loosen(r, genStrict(r, 4)) : genStrict(r, 4);
    const res = parse(text);
    if (!res.root) continue;
    const label = `${JSON.stringify(text).slice(0, 160)}`;
    for (let off = -1; off <= text.length + 1; off++) {
      const want = nodeAt(res.root, off, text);
      const lazy = lazyResult(tapeOf(res, text), text);
      const got = nodeAt(lazy.root, off, text);
      // (Two values with nothing between them (loose input) both hold the offset where they meet: the node
      // search takes either, the tape's the later, as for a packed tree's caret.)
      const touch = !!want && !!got && got.d === want.d && want.e === off && got.s === off;
      assert.ok(!want === !got && (!want || touch || (got!.s === want.s && got!.e === want.e && got!.d === want.d)), `offset ${off} in ${label}`);
      if (got) assert.equal(madeCount(lazy.root), got.d + 1, 'the node and its ancestors only');
    }
    const lazy = lazyResult(tapeOf(res, text), text);
    for (const n of preorder(res.root)) {
      const segs = pathOf(n);
      const got = resolve(lazy.root, segs);
      const want = resolve(res.root, segs);
      // (A path through a duplicated key leads to the first: null on both when that one isn't a container.)
      assert.ok(!got === !want && (!want || (got!.s === want.s && got!.d === want.d)), `${JSON.stringify(segs)} in ${label}`);
    }
    for (const segs of [['nope'], [99], ['0', 'x'], [-1]] as (string | number)[][]) assert.ok((resolve(lazy.root, segs) === null) === (resolve(res.root, segs) === null), JSON.stringify(segs));
  }
});

test('within counts a subtree\'s nodes to a depth, no further than just past a cap', () => {
  const r = rng(53);
  for (let it = 0; it < 120; it++) {
    const text = genStrict(r, 4);
    const res = parse(text);
    if (!res.root) continue;
    const lazy = lazyResult(tapeOf(res, text), text);
    const z = lazy.root!.z!;
    const pre = preorder(res.root);
    for (const levels of [1, 2, 3]) {
      const all = pre.filter((n) => n.d <= levels).length;
      assert.equal(z.within(lazy.root!, levels), all, text);
      for (const max of [0, 1, all - 1, all, all + 5]) {
        const got = z.within(lazy.root!, levels, max);
        assert.ok(all <= max ? got === all : got > max && got <= all, `${levels} levels, cap ${max}: ${got} of ${all} in ${text}`);
      }
    }
  }
});
