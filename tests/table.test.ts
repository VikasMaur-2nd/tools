import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installDom } from './dom';
import { TableView } from '../lib/engine/table';
import { parse, type JNode } from '../lib/json/parser';
import { tabulate, toCsv } from '../lib/convert/xlsx';

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

test('numbers sort by their exact value, beyond what a double holds', () => {
  const { drawn, sort } = table(
    '[1e400, 9007199254740993, -1e-400, 2e400, 9007199254740992, 0, 1e-400, -0, 1e9007199254740993, 1e9007199254740992, 0.1, 0.10000000000000001]',
  );
  sort(1);
  assert.deepEqual(drawn().map((x) => x.r), [2, 5, 7, 6, 10, 11, 4, 1, 0, 3, 9, 8]);
  sort(1);
  assert.deepEqual(drawn().map((x) => x.r), [8, 9, 3, 0, 1, 4, 11, 10, 6, 5, 7, 2], 'descending; equal values keep their order');
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

test('a press that focuses the table leaves the rows under the pointer alone', () => {
  const { el, view } = table(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ n: i }))));
  const rows = el.querySelector('.tb-rows')!;
  const sc = (view as unknown as { sc: { top: number } }).sc;
  // The active cell scrolled out of view.
  sc.top = 150 * 30;
  view.render(false);
  const drawn = rows.innerHTML;
  // A press: focus without :focus-visible. The click that follows places the active cell.
  el.focusVisible = false;
  el.focus();
  el.dispatchEvent({ type: 'focus', target: el } as unknown as Event);
  assert.equal(rows.innerHTML, drawn, 'not redrawn');
  // Tab: the active cell moves into view.
  el.blur();
  el.focusVisible = true;
  el.focus();
  el.dispatchEvent({ type: 'focus', target: el } as unknown as Event);
  assert.match(el.getAttribute('aria-activedescendant') ?? '', /^tb-15\d-0$/);
});

test('scrolling on draws only the rows coming into view, and they read as a full redraw does', () => {
  const { el, view } = table(JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ n: i, s: 'v' + i, o: i % 3 ? null : [i] }))));
  const rows = el.querySelector('.tb-rows')!;
  const sc = (view as unknown as { sc: { top: number } }).sc;
  // How many rows were drawn, all told, and would have been with every range drawn whole.
  let drawn = 0;
  let full = 0;
  const count = (html: string) => (html.match(/role="row"/g) ?? []).length;
  const set = Object.getOwnPropertyDescriptor(FakeElement.prototype, 'innerHTML')!;
  Object.defineProperty(rows, 'innerHTML', { get: set.get, set(v: string) { drawn += count(v); set.set!.call(this, v); } });
  const add = rows.insertAdjacentHTML.bind(rows);
  rows.insertAdjacentHTML = (w: string, v: string) => { drawn += count(v); add(w, v); };
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
  view.find('v1');
  for (let k = 0; k < 300; k++) {
    // Mostly small steps either way, now and then a jump.
    sc.top = Math.max(0, Math.min(500 * 30, sc.top + (rnd() < 0.1 ? (rnd() - 0.5) * 9000 : (rnd() - 0.45) * 400)));
    const v = view as unknown as { rFirst: number; rLast: number; rowsHtml(a: number, b: number): string };
    const range = `${v.rFirst}-${v.rLast}`;
    view.render(false);
    if (`${v.rFirst}-${v.rLast}` !== range) full += v.rLast - v.rFirst;
    // The same rows drawn in one go.
    assert.equal(rows.innerHTML, v.rowsHtml(v.rFirst, v.rLast), `step ${k} at ${sc.top}`);
  }
  // Scrolling down smoothly, a wheel's worth at a time: about two fifths of the rows a whole redraw would draw.
  sc.top = 0;
  view.render(true);
  drawn = full = 0;
  for (let k = 0; k < 100; k++) {
    const v = view as unknown as { rFirst: number; rLast: number };
    const range = `${v.rFirst}-${v.rLast}`;
    sc.top += 120;
    view.render(false);
    if (`${v.rFirst}-${v.rLast}` !== range) full += v.rLast - v.rFirst;
  }
  assert.ok(full > 800 && drawn < full / 2, `${drawn} rows drawn, ${full} redrawn whole`);
});

/** The table's CSV export: what Copy as CSV and Download CSV write. */
const csv = (view: TableView) => toCsv(view.exportNode()!, { order: view.exportOrder() });

test('the CSV and Excel exports write the table shown: its sub-table, in its order, nested objects as dotted columns', () => {
  const doc = '{"meta":{"n":2},"users":[{"name":"Bo","address":{"city":"Oslo","zip":"0150"},"tags":["a","b"]},{"name":"Al","address":{"city":"Rome"}}]}';
  const { view, sort } = table(doc);
  // The object at the root: its own table (a row per member), not some array within it.
  assert.equal(view.exportNode(), view.node);
  const users = view.node!.v as JNode[];
  view.setNode(users[1]);
  assert.equal(view.exportNode(), users[1]);
  const lines = csv(view).trimEnd().split('\r\n');
  assert.equal(lines[0], 'name,address.city,address.zip,tags');
  assert.deepEqual(lines.slice(1), ['Bo,Oslo,0150,"a, b"', 'Al,Rome,,']);
  // Sorted by name: the rows exported in that order, the columns still the document's, the document untouched.
  sort(1);
  assert.equal(view.exportNode(), users[1]);
  assert.deepEqual(Array.from(view.exportOrder()!), [1, 0]);
  assert.deepEqual(csv(view).trimEnd().split('\r\n'), [lines[0], 'Al,Rome,,', 'Bo,Oslo,0150,"a, b"']);
  assert.equal(tabulate(view.exportNode()!).headers.join(','), lines[0]);
  sort(1);
  sort(1);
  assert.equal(view.exportOrder(), null);
  view.setNode(null);
  assert.equal(view.exportNode(), null);
});

test('a sorted table exports its columns in document order: sorting moves rows, not columns', () => {
  // Record 1 has a key the others lack: first-seen column order would change with the row order.
  const { view, sort } = table('[{"id":1,"b":"y"},{"id":2,"a":"x"},{"id":3,"a":"w"}]');
  const head = csv(view).split('\r\n')[0];
  assert.equal(head, 'id,b,a');
  for (let k = 0; k < 2; k++) {
    sort(0);
    const out = csv(view).trimEnd().split('\r\n');
    assert.equal(out[0], head, `sorted ${k ? 'descending' : 'ascending'}: the same columns`);
  }
  assert.deepEqual(csv(view).trimEnd().split('\r\n').slice(1), ['3,,w', '2,,x', '1,y,']);
});

test('a duplicated key shows its last value, as everything else reads it (JSON.parse, Compare, YAML)', () => {
  assert.equal(csv(table('[{"a":1,"a":2},{"a":3}]').view), 'a\r\n2\r\n3\r\n');
  // (Rows of many keys are looked up through a map.)
  const wide = '{' + Array.from({ length: 14 }, (_, i) => `"k${i}":${i}`).join(',') + ',"k0":"last"}';
  const { view } = table(`[${wide}]`);
  assert.equal(csv(view).split('\r\n')[1].split(',')[0], 'last');
  const cell = (view as unknown as { cell(it: JNode, key: string): JNode | undefined }).cell((view.node!.v as JNode[])[0], 'k0');
  assert.equal(cell?.v, 'last');
});

test("Find doesn't match an array's row numbers (an object's keys are data, and match)", () => {
  const rows = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ name: 'n' + String.fromCharCode(97 + (i % 26)), ok: i % 2 === 0 })));
  assert.deepEqual(table(rows).view.find('1'), { total: 0, index: -1 });
  assert.deepEqual(table('["a", "b1", "c"]').view.find('1'), { total: 1, index: 0 });
  assert.deepEqual(table('{"k1": "x", "k2": "y1", "z": "q"}').view.find('1'), { total: 2, index: 0 });
});

test('sorting an object table by its keys sorts them, both ways, as text cells sort', () => {
  const { view, drawn, sort } = table('{"b":1,"a":2,"c":0,"a10":3,"a9":4}');
  const keys = () => drawn().map((x) => ['b', 'a', 'c', 'a10', 'a9'][x.r]);
  sort(0);
  assert.deepEqual(keys(), ['a', 'a9', 'a10', 'b', 'c']);
  assert.ok(view.el.querySelector('.tb-head')!.innerHTML.includes('aria-sort="ascending"'));
  sort(0);
  assert.deepEqual(keys(), ['c', 'b', 'a10', 'a9', 'a']);
  sort(0);
  assert.deepEqual(keys(), ['b', 'a', 'c', 'a10', 'a9']);
  // an array's row numbers: its order, or the other way
  const arr = table('[3,1,2]');
  arr.sort(0);
  assert.deepEqual(arr.drawn().map((x) => x.r), [0, 1, 2]);
  arr.sort(0);
  assert.deepEqual(arr.drawn().map((x) => x.r), [2, 1, 0]);
});

test("the row label and value columns never take a member's name", () => {
  const labels = (json: string) => (table(json).view as unknown as { cols: { label: string }[] }).cols.map((c) => c.label);
  assert.deepEqual(labels('[{"key":1,"#":2,"value":3},4]'), ['_#', '_value', 'key', '#', 'value']);
  assert.deepEqual(labels('{"a":{"key":1,"_key":2},"b":5}'), ['__key', 'value', 'key', '_key']);
  assert.deepEqual(labels('[{"a":1},2]'), ['#', 'value', 'a']);
});
