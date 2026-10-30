import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, frames, installDom } from './dom';
import { Editor, loadSurface } from '../lib/engine/editor';

// The big-document editor's textarea holds a passage around the caret. Text the browser puts in it itself (a paste
// event without text, a drop) leaves it before the edit is made: anything that lays the page out during the edit
// laid the whole of it out too (Firefox, 4.75M characters: 25 s a paste).

installDom();

type Inner = { surface: unknown; layout(): void; onBeforeInput(e: unknown): void; onInput(e: unknown): void };

test('text the browser puts in the big-document editor\'s textarea is out of it while the edit is made, then the passage is back', async () => {
  await loadSurface();
  const { el, ta } = editorElement();
  const seen: number[] = [];
  const ed = new Editor(el as unknown as HTMLElement, { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} });
  const doc = '[' + '{"a":"東京"},'.repeat(30_000) + '0]';
  ed.setValue(doc, doc.length - 1);
  frames();
  const inner = ed as unknown as Inner;
  assert.ok(inner.surface, 'the big-document editor');
  // (What the textarea holds whenever the editor lays the page out.)
  const layout = inner.layout;
  inner.layout = function (this: Inner) {
    seen.push(ta.value.length);
    return layout.call(this);
  };
  // As the browser pastes 500,000 characters at the caret (before the closing bracket).
  const ins = ',' + '"😀 é"'.repeat(100_000);
  inner.onBeforeInput({ inputType: 'insertFromPaste', cancelable: true, preventDefault() {} });
  const at = ta.selectionStart;
  ta.value = ta.value.slice(0, at) + ins + ta.value.slice(ta.selectionEnd);
  ta.setSelectionRange(at + ins.length, at + ins.length);
  inner.onInput({ inputType: 'insertFromPaste' });
  assert.equal(ed.text, doc.slice(0, -1) + ins + ']');
  assert.ok(seen.length && seen.every((n) => n === 0), `the textarea was empty while the edit was laid out (${seen})`);
  assert.ok(ta.value.length > 0 && ta.value.length <= 4096 + 8, `the passage is back (${ta.value.length})`);
  assert.equal(ed.caret, doc.length - 1 + ins.length, 'the caret after it');
});
