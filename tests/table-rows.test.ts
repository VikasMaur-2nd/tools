import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installDom } from './dom';
import { TableView } from '../lib/engine/table';
import { ARR, parse, type JNode } from '../lib/json/parser';
import { lazyResult, madeCount, nodeAtIndex } from '../lib/json/lazy';
import { tapeOf } from '../lib/json/tape-send';
import { rng } from './oracle/compare';
import { genStrict, loosen } from './oracle/tape';
import { toCsv } from '../lib/convert/xlsx';

// The Table of a node from a tape (items as tape indexes, nodes made for the rows drawn or used) against the
// same Table of the node as the page parses it: rows, cells, sorts, find and CSV the same.
// (Nodes are compared with assert.ok(a === b): a failed equal would print a node with its whole tape.)

installDom();

function table() {
  const el = new FakeElement();
  for (const c of ['tb-head', 'tb-sizer', 'tb-rows', 'tb-empty']) el.appendChild(new FakeElement()).className = c;
  el.clientHeight = 600;
  const picked: JNode[] = [];
  const view = new TableView(el as unknown as HTMLElement, { select: (n) => picked.push(n), drill: () => {} });
  /** Clicks column `c`'s header (sorts by it). */
  const sort = (c: number) => {
    const th = new FakeElement('button');
    th.className = 'tb-th';
    th.dataset.c = String(c);
    (view as unknown as { onClick(e: unknown): void }).onClick({ target: th });
  };
  type Inner = { rowsHtml(a: number, b: number): string; order: Int32Array; cols: { label: string; w: number }[] };
  const inner = view as unknown as Inner;
  /** Every row as drawn, the column labels and widths, and the display order. */
  const all = () => ({ html: inner.rowsHtml(0, view.rowCount), cols: inner.cols.map((c) => `${c.label}:${c.w}`), order: [...inner.order] });
  return { el, view, sort, all, picked };
}

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

const QUERIES = ['a', 'id', '1', 'null', 'true', 'é', 'zzz', '0'];

test('a Table from a tape shows, sorts, finds and copies every row as from nodes', () => {
  const r = rng(29);
  let tables = 0;
  for (let it = 0; it < 360; it++) {
    const text = it % 5 === 4 ? loosen(r, genStrict(r, 3)) : genStrict(r, 3);
    const res = parse(text);
    if (!res.root) continue;
    const pre = preorder(res.root);
    const lazy = lazyResult(tapeOf(res, text), text);
    // The root, and a few containers in it (as drilled into).
    const at = [0, ...Array.from({ length: 3 }, () => r.int(pre.length))].filter((i, k, xs) => pre[i].t >= ARR && xs.indexOf(i) === k);
    for (const i of at) {
      tables++;
      const a = table();
      const b = table();
      const nb = nodeAtIndex(lazy.root!, i)!;
      a.view.setNode(pre[i]);
      b.view.setNode(nb);
      const label = (what: string) => `${what}, node ${i} of ${JSON.stringify(text).slice(0, 160)}`;
      assert.equal(b.view.rowCount, a.view.rowCount, label('rows'));
      assert.equal(b.view.colCount, a.view.colCount, label('columns'));
      assert.deepEqual(b.all(), a.all(), label('shown'));
      assert.equal(toCsv(b.view.exportNode()!), toCsv(a.view.exportNode()!), label('CSV'));
      for (const q of QUERIES) assert.deepEqual(b.view.find(q), a.view.find(q), label(`find ${q}`));
      assert.deepEqual(b.all(), a.all(), label('shown after find'));
      for (let c = 0; c < a.view.colCount; c++) {
        for (let k = 0; k < 3; k++) {
          a.sort(c);
          b.sort(c);
          assert.deepEqual(b.all(), a.all(), label(`sorted by ${c}, ${k}`));
        }
      }
      a.sort(Math.min(1, a.view.colCount - 1));
      b.sort(Math.min(1, b.view.colCount - 1));
      assert.equal(toCsv(b.view.exportNode()!, { order: b.view.exportOrder() }), toCsv(a.view.exportNode()!, { order: a.view.exportOrder() }), label('CSV sorted'));
      // Selecting a cell: the same node (by place) to the engine, and the one every view gets.
      const step = (v: TableView) => (v as unknown as { activate(r: number, c: number): void }).activate(0, Math.min(1, v.colCount - 1));
      if (a.view.rowCount) {
        step(a.view);
        step(b.view);
        const pa = a.picked.at(-1)!;
        const pb = b.picked.at(-1)!;
        assert.ok(pa.s === pb.s && pa.e === pb.e && pa.d === pb.d, label('the cell selected'));
        assert.ok(pb.z === null || nodeAtIndex(lazy.root!, pb.zi) === pb, label('the same node every view gets'));
      }
    }
  }
  assert.ok(tables > 150, `${tables} tables`);
});

test('a Table from a tape makes no node for a row it doesn\'t draw: sorted and found', () => {
  const text = JSON.stringify(Array.from({ length: 100_000 }, (_, i) => ({ id: 100_000 - i, name: `n${i % 97}`, v: i % 5 ? i / 3 : null, tags: [i] })));
  const res = parse(text);
  const lazy = lazyResult(tapeOf(res, text), text);
  const { view, sort } = table();
  view.setNode(lazy.root);
  // (The hidden test viewport draws the first rows.)
  const drawn = madeCount(lazy.root);
  assert.ok(drawn < 100 * 6, `${drawn} made to draw`);
  assert.equal(view.rowCount, 100_000);
  assert.equal(view.colCount, 5);
  for (let c = 1; c < 5; c++) sort(c);
  assert.equal(view.find('n96').total, 1030);
  assert.ok(madeCount(lazy.root) < 100 * 6 * 3, `${madeCount(lazy.root)} made after sorting and finding`);
  // (An export makes the rows: convert/xlsx flattens nodes.)
  assert.equal(toCsv(view.exportNode()!).split('\r\n').length, 100_002);
});
