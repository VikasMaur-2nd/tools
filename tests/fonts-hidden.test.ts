import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, editorElement, fakeDocument, installDom } from './dom';
import { Editor } from '../lib/engine/editor';
import { CodeView } from '../lib/engine/codeview';

// The code font, or its subset for another script, can arrive while an editor or a view is hidden, as
// Compare's editor is in the other views. It has no width then: wrapped, a 7 MB one-line document became
// one row, drawn whole, and froze the page for seconds. The font waits until the element shows.
installDom();
const fontsArrived: (() => void)[] = [];
(fakeDocument as unknown as { fonts: unknown }).fonts = {
  ready: new Promise(() => {}),
  addEventListener: (_type: string, fn: () => void) => fontsArrived.push(fn),
  removeEventListener() {},
};
const observers: (() => void)[] = [];
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  constructor(fn: () => void) {
    observers.push(fn);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};
// (The fake DOM's elements have no boxes: hidden until given one.)
const show = (el: FakeElement) => ((el as unknown as { getClientRects: () => unknown[] }).getClientRects = () => [{ width: 800, height: 600 }]);

/** Records calls of `names` on `o`, still running them. */
function spy(o: object, names: string[]) {
  const calls: string[] = [];
  const t = o as Record<string, (...a: unknown[]) => unknown>;
  for (const n of names) {
    const f = t[n].bind(o);
    t[n] = (...a: unknown[]) => {
      calls.push(n);
      return f(...a);
    };
  }
  return calls;
}

test("a font arriving while an editor is hidden waits until it shows", () => {
  const { el } = editorElement();
  observers.length = 0;
  const ed = new Editor(el as unknown as HTMLElement, { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} });
  ed.init('{"a": 1}');
  const calls = spy(ed, ['measure', 'layout', 'render']);
  for (const f of fontsArrived) f();
  assert.equal(calls.length, 0, `hidden: nothing measured, laid out or drawn (${calls})`);
  show(el);
  for (const fire of observers) fire();
  assert.deepEqual(calls, ['measure', 'layout', 'render'], 'shown: the font is measured, then the rows laid out');
  // Shown, a later font applies at once.
  calls.length = 0;
  for (const f of fontsArrived) f();
  assert.deepEqual(calls.slice(0, 1), ['measure']);
  assert.equal(calls.at(-1), 'render');
});

test('a font arriving while the output view is hidden waits until it shows', () => {
  const el = new FakeElement();
  for (const c of ['cv-sizer', 'cv-rows']) el.appendChild(new FakeElement()).className = c;
  el.clientWidth = 800;
  el.clientHeight = 600;
  (el as unknown as { isConnected: boolean }).isConnected = true;
  observers.length = 0;
  const code = new CodeView(el as unknown as HTMLElement);
  code.setText('{\n  "a": 1\n}', (s) => s, true, null);
  const calls = spy(code, ['measure', 'reflow', 'render']);
  for (const f of fontsArrived) f();
  assert.equal(calls.length, 0, `hidden: nothing measured or laid out (${calls})`);
  show(el);
  for (const fire of observers) fire();
  assert.equal(calls[0], 'measure', 'shown: the font is measured');
  assert.ok(calls.includes('reflow') || calls.includes('render'), 'and the view redrawn');
});
