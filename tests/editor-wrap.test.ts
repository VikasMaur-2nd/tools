import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, FakeElement, installDom } from './dom';
import { Editor } from '../lib/engine/editor';
import { Wrapper } from '../lib/engine/wrap';

// A big text laid out afresh is wrapped in steps (Editor.wrapInSteps): its rows, once there, are exactly
// those of a layout in one go, whatever happened meanwhile, and the view stays on what it showed.

installDom();

const events = { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} };
const CW = 7.8;

type Inner = {
  wrapper: Wrapper;
  wy: Int32Array | null;
  wodd: Uint8Array;
  wrapJob: unknown;
  view: boolean;
  rows: number;
  src: string;
  sc: { top: number };
  close: Int32Array;
  lineBounds(A: Int32Array, B: Int32Array, n: number): void;
  viewAt(): { off: number; dy: number };
  kAt(r: number): number;
  yOf(k: number): number;
  rowSpan(k: number, sub: number): [number, number];
};

/** Gives wrapper `w` a canvas and a layout box: glyphs a cell wide (two for wide ones); a laid-out line takes a row per 40 characters. */
function fake(w: Wrapper) {
  Object.assign(w, {
    ctx: { font: '', measureText: (s: string) => ({ width: s.codePointAt(0)! >= 0x1100 ? 2 * CW : CW }) },
    font: 'test',
    measure: (lines: string[]) => lines.map((l) => Math.ceil(l.length / 40)),
  });
}

/** A text of `n` short lines with a block, narrow and wide non-ASCII ones, and long ones of both kinds. */
function text(n: number) {
  const out = ['[', '  {', '    "a": 1,', '    "b": "é"', '  },'];
  for (let i = 0; i < n; i++) {
    const k = i % 400;
    out.push(k === 7 ? `"é${i}",` : k === 13 ? `"中文${i}",` : k === 21 ? `"${'ab'.repeat(70)}${i}",` : k === 33 ? `"${'é中'.repeat(45)}",` : `${i},`);
  }
  out.push('0]');
  return out.join('\n');
}

/** An editor showing `t` loaded (the quiet view), wrapping. */
function open(t: string) {
  const { el } = editorElement();
  const ed = new Editor(el as unknown as HTMLElement, events);
  ed.init('');
  ed.setWrap(true);
  const inner = ed as unknown as Inner;
  fake(inner.wrapper);
  ed.setValue(t, 0, true);
  return { ed, inner, el };
}

/** Runs tasks until the editor's layout in steps is done. */
async function settle(inner: Inner, until = () => !inner.wrapJob) {
  for (let i = 0; i < 200_000 && !until(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(until(), 'done');
}

/** The visual row starts a layout in one go gives the editor's display rows now. */
function expected(inner: Inner) {
  const n = inner.rows;
  const A = new Int32Array(n);
  const B = new Int32Array(n);
  inner.lineBounds(A, B, n);
  const w = new Wrapper(new FakeElement() as unknown as HTMLElement, 20, false);
  w.fit(inner.wrapper.cols * CW + CW / 2 + 0.25, CW);
  fake(w);
  const rows = w.rows(inner.src, A, B);
  const wy = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) wy[k + 1] = wy[k] + rows[k];
  return { wy, odd: w.odd };
}

const same = (inner: Inner, what: string) => {
  const want = expected(inner);
  assert.ok(inner.wy && inner.wy.length === want.wy.length, `${what}: rows`);
  const k = inner.wy!.findIndex((y, i) => y !== want.wy[i]);
  assert.equal(k, -1, `${what}: first different row start at display row ${k}`);
  assert.deepEqual(inner.wodd, want.odd, `${what}: odd`);
};

test('a big text laid out afresh is wrapped in steps, ending with exactly the rows of a layout in one go', async () => {
  const t = text(220_000);
  assert.ok(t.length < 2_000_000);
  const { inner } = open(t);
  assert.ok(inner.view && !inner.wrapper.exact, 'the quiet view');
  assert.ok(inner.wrapJob, 'laid out in steps');
  // Meanwhile: rows from the lines' lengths.
  assert.ok(inner.wodd.every((x) => x === 0));
  assert.ok(inner.wy![inner.rows] > inner.rows);
  await settle(inner);
  same(inner, 'laid out');
  assert.ok(inner.wodd.some((x) => x === 1), 'some lines measured');
});

test('an edit while a text is wrapped in steps starts them over; the next edit reuses what they counted', async () => {
  const t = text(220_000);
  const { ed, inner } = open(t);
  assert.ok(inner.wrapJob);
  await new Promise((r) => setImmediate(r));
  // A long line of wide characters inserted before line "10," (the caret then on that ASCII line).
  const at = t.indexOf('\n10,\n') + 1;
  ed.replace(at, at, `"${'中文 and more '.repeat(12)}",\n`);
  assert.ok(inner.wrapJob, 'still in steps');
  await settle(inner);
  same(inner, 'after the edit');
  // An edit once they are done is laid out at once, reusing the others' counts.
  const p = ed.text.indexOf('\n10,\n') + 3;
  ed.replace(p, p, 'é');
  assert.ok(!inner.wrapJob, 'at once');
  same(inner, 'after the next edit');
});

/** As the editor's ResizeObserver does when its width changes to `w`. */
function resize(ed: Editor, el: { clientWidth: number }, w: number) {
  el.clientWidth = w;
  const x = ed as unknown as { sc: { onResize(): void }; layout(): void; render(force: boolean): void };
  x.sc.onResize();
  x.layout();
  x.render(true);
}

test('a new width lays a big text out in steps too; a fold meanwhile starts them over, with the fold', async () => {
  const { ed, inner, el } = open(text(220_000));
  // (The blocks are found in steps too.)
  await settle(inner, () => !inner.wrapJob && inner.close[1] === 4);
  resize(ed, el, 600);
  assert.ok(inner.wrapJob, 'in steps');
  const before = inner.rows;
  ed.toggleFold(1);
  assert.equal(inner.rows, before - 3);
  await settle(inner);
  same(inner, 'folded');
});

test('the line and character at the top of the view stay there when the rows in steps replace the first ones', async () => {
  const { inner } = open(text(220_000));
  assert.ok(inner.wrapJob);
  // Somewhere deep, its rows before counted again (measured lines take more rows than their length gave).
  const target = 150_000;
  inner.sc.top = 10 + target * 20 + 7;
  const at = inner.viewAt();
  await settle(inner);
  const top = inner.sc.top;
  assert.notEqual(top, 10 + target * 20 + 7, 'the view moved with its rows');
  const r = Math.floor((top - 10) / 20);
  const k = inner.kAt(r);
  const [a, b] = inner.rowSpan(k, r - inner.yOf(k));
  assert.ok(a <= at.off && at.off < Math.max(b, a + 1), `the character at the top is still on the top row (${a} <= ${at.off} < ${b})`);
  assert.equal(top - (10 + r * 20), at.dy, 'as far into its row');
});
