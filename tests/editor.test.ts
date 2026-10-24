import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, frames, installDom } from './dom';
import { Editor } from '../lib/engine/editor';

installDom();

const events = { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} };

function editor(text = '') {
  const { el, ta } = editorElement();
  const ed = new Editor(el as unknown as HTMLElement, events);
  ed.init(text);
  frames();
  return { ed, el, ta };
}

interface History {
  undo_: { del: string; ins: string }[];
  redo_: { del: string; ins: string }[];
  histChars: number;
}
const history = (ed: object) => ed as unknown as History;
const stored = (h: History) => h.undo_.reduce((n, c) => n + c.del.length + c.ins.length, 0);

test('the undo history counts the characters merged typing stores', () => {
  const { ed, ta } = editor('{}');
  const h = history(ed);
  ta.setSelectionRange(1, 1);
  for (const c of 'abc') ta.type(c);
  assert.equal(h.undo_.length, 1, 'typing merges into one step');
  assert.equal(ed.text, '{abc}');
  assert.equal(h.histChars, stored(h));
  ed.undo();
  assert.equal(ed.text, '{}');
  assert.equal(h.histChars, 0);
  ed.redo();
  assert.equal(h.histChars, stored(h));
});

test('the undo history counts the characters merged deleting stores', () => {
  const { ed, ta } = editor('{"abcdef": 1}');
  const h = history(ed);
  ta.setSelectionRange(8, 8);
  for (let k = 0; k < 4; k++) ta.backspace();
  assert.equal(ed.text, '{"ab": 1}');
  assert.equal(h.undo_.length, 1, 'deleting merges into one step');
  assert.equal(h.histChars, stored(h));
  ed.undo();
  assert.equal(h.histChars, 0);
});

test('the undo history keeps its count while dropping its oldest steps', () => {
  const { ed, ta } = editor('[]');
  const h = history(ed);
  for (let k = 0; k < 520; k++) ed.replace(1, 1, k ? '1,' : '1');
  ta.setSelectionRange(1, 1);
  for (const c of '22,') ta.type(c);
  assert.equal(h.undo_.length, 500);
  assert.equal(h.histChars, stored(h));
  while (h.undo_.length) ed.undo();
  assert.equal(h.histChars, 0);
});
