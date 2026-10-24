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

/** A key pressed with the table focused. */
const press = (el: FakeElement, key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
  let prevented = false;
  el.dispatchEvent({ type: 'keydown', key, target: el, ...mods, preventDefault: () => (prevented = true) } as unknown as Event);
  return prevented;
};

test('the table is a grid: a labelled tab stop with rows and cells at their virtual positions', () => {
  const { el, view } = table('[{"a":1,"b":[2]},{"a":3},{"a":4,"b":{}}]');
  const rows = el.querySelector('.tb-rows')!;
  const head = el.querySelector('.tb-head')!;
  assert.equal(el.getAttribute('role'), 'grid');
  assert.ok(el.getAttribute('aria-label'));
  assert.equal(el.tabIndex, 0);
  assert.equal(el.getAttribute('aria-rowcount'), '4', 'three items and the header row');
  assert.equal(el.getAttribute('aria-colcount'), '3');
  assert.equal((head.innerHTML.match(/role="columnheader"/g) ?? []).length, 3);
  assert.deepEqual([...rows.innerHTML.matchAll(/role="row" aria-rowindex="(\d+)"/g)].map((m) => m[1]), ['2', '3', '4']);
  assert.equal((rows.innerHTML.match(/role="rowheader"/g) ?? []).length, 3);
  assert.equal((rows.innerHTML.match(/role="gridcell"/g) ?? []).length, 6);
  // Drill buttons are reached with the grid's keys, not with Tab.
  assert.ok(!/<button(?![^>]*tabindex="-1")/.test(rows.innerHTML), 'no tab stops inside');
  assert.ok(!/<button/.test(head.innerHTML), 'header cells are cells');
  // Sorting is announced on the column.
  const th = new FakeElement('div');
  th.className = 'tb-th';
  th.dataset.c = '1';
  (view as unknown as { onClick(e: unknown): void }).onClick({ target: th });
  // (The cell clicked is the active one.)
  assert.match(head.innerHTML, /<div class="tb-th asc act" role="columnheader" aria-sort="ascending" id="tb-h-1" data-c="1"/);
  assert.equal(el.getAttribute('aria-activedescendant'), 'tb-h-1');
  press(el, 'ArrowDown');
  assert.match(head.innerHTML, /<div class="tb-th asc" role="columnheader" aria-sort="ascending" data-c="1"/);
  assert.match(rows.innerHTML, /<div class="tb-td act" role="gridcell" data-c="1"|<div class="tb-td act" id="tb-0-1" role="gridcell"/);
  assert.equal(el.getAttribute('aria-activedescendant'), 'tb-0-1');
  // No array or object: not a grid, not a tab stop.
  view.setNode(null);
  assert.equal(el.getAttribute('role'), null);
  assert.equal(el.tabIndex, -1);
});

test('the arrow keys, Home, End and the page keys move the active cell, selecting what it shows', () => {
  const { el, view, picked } = table('[{"a":1,"b":"x"},{"a":2},{"a":3,"b":"z"}]');
  el.focus();
  el.dispatchEvent({ type: 'focus', target: el } as unknown as Event);
  const active = () => el.getAttribute('aria-activedescendant');
  const html = () => el.querySelector('.tb-rows')!.innerHTML + el.querySelector('.tb-head')!.innerHTML;
  const cell = () => new RegExp(`<div class="[^"]*\\bact\\b[^"]*"[^>]*id="${active()}"`).test(html());
  assert.ok(active() && cell(), 'focus shows an active cell');
  assert.ok(press(el, 'ArrowRight'));
  assert.equal(picked.at(-1)?.v, '1', 'column a of the first row');
  press(el, 'ArrowRight');
  assert.equal(picked.at(-1)?.v, 'x');
  press(el, 'ArrowRight');
  assert.equal(picked.at(-1)?.v, 'x', 'stops at the last column');
  press(el, 'ArrowDown');
  assert.equal(picked.at(-1)?.key, 1, 'a missing value selects its row');
  press(el, 'End', { ctrlKey: true });
  assert.equal(picked.at(-1)?.v, 'z', 'Ctrl+End: the last cell');
  press(el, 'Home');
  assert.equal(picked.at(-1)?.key, 2, 'Home: the row label');
  press(el, 'Home', { ctrlKey: true });
  assert.equal(picked.at(-1)?.key, 0, 'Ctrl+Home: the first row');
  press(el, 'PageDown');
  assert.equal(picked.at(-1)?.key, 2, 'PageDown: as far as a page goes');
  press(el, 'PageUp');
  assert.equal(picked.at(-1)?.key, 0);
  assert.ok(cell(), 'the active cell is drawn with its id');
  assert.equal(press(el, 'x'), false, 'other keys are left alone');
  assert.equal(view.sel, picked.at(-1));
});

test('Enter sorts from a header cell and drills into a cell that holds an array or object', () => {
  const { el, drilled, drawn } = table('[{"a":2,"b":[1,2]},{"a":1}]');
  el.focus();
  el.dispatchEvent({ type: 'focus', target: el } as unknown as Event);
  press(el, 'ArrowRight');
  press(el, 'ArrowUp');
  assert.match(el.getAttribute('aria-activedescendant') ?? '', /./);
  assert.ok(press(el, 'Enter'), 'sorts by a');
  assert.deepEqual(drawn().map((x) => x.r), [1, 0]);
  press(el, ' ');
  assert.deepEqual(drawn().map((x) => x.r), [0, 1], 'Space sorts too (descending)');
  press(el, 'ArrowDown');
  press(el, 'ArrowRight');
  assert.ok(press(el, 'Enter'));
  assert.equal(drilled.length, 1);
  assert.deepEqual(drilled[0].v && (drilled[0].v as JNode[]).length, 2, 'into b');
});
