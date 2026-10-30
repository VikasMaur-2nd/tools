import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, frames, installDom } from './dom';
import { Editor } from '../lib/engine/editor';
import { Wrapper } from '../lib/engine/wrap';

// Big text the browser puts in the textarea itself (a paste event without text, as Firefox's synthetic one, a drop,
// a phone keyboard's paste) before the big-document editor's module is there. Firefox took minutes to lay out a
// textarea of millions of characters, and as long again to lay out one such line to match it.

installDom();

const events = { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} };

type Inner = {
  view: boolean;
  vcaret: number;
  surface: unknown;
  wrapper: Wrapper;
  onBeforeInput(e: unknown): void;
  onInput(e: unknown): void;
};

/** As the browser inserts `text` at the textarea's caret: beforeinput, the insertion, input. */
function insert(inner: Inner, ta: { value: string; selectionStart: number; selectionEnd: number; setSelectionRange(a: number, b: number): void }, text: string, inputType: string) {
  inner.onBeforeInput({ inputType, cancelable: true, preventDefault() {} });
  const at = ta.selectionStart;
  ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd);
  ta.setSelectionRange(at + text.length, at + text.length);
  inner.onInput({ inputType });
}

// (One test, run at once: the big-document editor's module, asked for here, would arrive between two.)
test('big text the browser puts in the textarea before the big-document editor comes: the quiet view at once, or rows not matched to the textarea', () => {
  // Pasted or dropped, over two million characters: the quiet view, the textarea emptied, the caret after it.
  for (const inputType of ['insertFromPaste', 'insertFromDrop']) {
    const { el, ta } = editorElement();
    const ed = new Editor(el as unknown as HTMLElement, events);
    ed.init('');
    frames();
    const inner = ed as unknown as Inner;
    const text = '[' + '"東京😀", '.repeat(300_000) + '1]';
    assert.ok(text.length > 2_000_000);
    insert(inner, ta, text, inputType);
    assert.equal(ed.text, text, inputType);
    assert.equal(inner.view, true, `${inputType}: the quiet view`);
    assert.equal(ta.value, '', `${inputType}: the textarea emptied`);
    assert.equal(inner.vcaret, text.length, `${inputType}: the caret after it`);
  }
  // Typed (not a paste: no quiet view) into a text that wants the big-document editor (a line of 10,000
  // characters): soft-wrapped without matching the textarea until that editor comes.
  const { el, ta } = editorElement();
  const ed = new Editor(el as unknown as HTMLElement, events);
  ed.init('');
  ed.setWrap(true);
  const inner = ed as unknown as Inner;
  Object.assign(inner.wrapper, {
    ctx: { font: '', measureText: () => ({ width: 7.8 }) },
    font: 'test',
    measure: () => {
      throw new Error('laid out in the DOM');
    },
  });
  frames();
  insert(inner, ta, '"' + 'é'.repeat(10_000) + '"', 'insertText');
  assert.equal(inner.view, false);
  assert.equal(inner.surface, null);
  assert.equal(inner.wrapper.exact, false, 'not matched to the textarea');
});
