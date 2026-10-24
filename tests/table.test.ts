import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installDom } from './dom';
import { TableView } from '../lib/engine/table';
import { parse, type JNode } from '../lib/json/parser';

installDom();

function table(json: string) {
  const el = new FakeElement();
  for (const c of ['tb-head', 'tb-sizer', 'tb-rows', 'tb-empty']) el.appendChild(new FakeElement()).className = c;
  el.clientHeight = 600;
  const picked: JNode[] = [];
  const drilled: JNode[] = [];
  const view = new TableView(el as unknown as HTMLElement, { select: (n) => picked.push(n), drill: (n) => drilled.push(n) });
  view.setNode(parse(json).root);
  const rows = el.querySelector('.tb-rows')!;
  /** Drawn rows: item index and classes, in display order. */
  const drawn = () => [...rows.innerHTML.matchAll(/<div class="(tb-r[^"]*)"[^>]*? data-r="(\d+)"/g)].map((m) => ({ r: Number(m[2]), cls: m[1] }));
  /** Clicks column `c`'s header (sorts by it). */
  const sort = (c: number) => {
    const th = new FakeElement('button');
    th.className = 'tb-th';
    th.dataset.c = String(c);
    (view as unknown as { onClick(e: unknown): void }).onClick({ target: th });
  };
  return { el, view, drawn, sort, picked, drilled };
}

test('table search hits stay on their rows through a sort', () => {
  const { view, drawn, sort } = table('["zebra", "apple", "zebu"]');
  assert.deepEqual(view.find('ze'), { total: 2, index: 0 });
  const hits = () => drawn().filter((x) => / hit/.test(x.cls)).map((x) => x.r);
  const cur = () => drawn().find((x) => / cur/.test(x.cls))?.r;
  assert.deepEqual(hits(), [0, 2]);
  assert.equal(cur(), 0);
  // By value, ascending: apple, zebra, zebu.
  sort(1);
  assert.deepEqual(drawn().map((x) => x.r), [1, 0, 2]);
  assert.deepEqual(hits(), [0, 2], 'zebra and zebu, not apple');
  assert.equal(cur(), 0, 'zebra is still the current hit');
  // Descending: zebu, zebra, apple. Next goes on in the order shown.
  sort(1);
  assert.deepEqual(drawn().map((x) => x.r), [2, 0, 1]);
  assert.deepEqual(view.step(1), { total: 2, index: 0 });
  assert.equal(cur(), 2);
});

test('a sort tells the find bar where the current hit went', () => {
  const { view, sort } = table('["zebra", "apple", "zebu"]');
  const told: unknown[] = [];
  view.onFind = (r) => told.push(r);
  view.find('ze');
  sort(1);
  sort(1);
  assert.deepEqual(told, [{ total: 2, index: 0 }, { total: 2, index: 1 }]);
});
