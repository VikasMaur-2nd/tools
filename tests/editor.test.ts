import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, frames, installDom } from './dom';
import { Editor } from '../lib/engine/editor';
import { lineStarts, scanFolds } from '../lib/engine/lines';

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

interface Folds {
  close: Int32Array;
  folded: Map<number, number>;
  foldsFor: object | null;
}
const folds = (ed: object) => ed as unknown as Folds;
const tick = () => new Promise((r) => setTimeout(r, 0));
/** `n` objects of three lines each in an array. */
const objects = (n: number) => '[\n' + Array.from({ length: n }, (_, i) => `  {\n    "k": ${i}\n  }`).join(',\n') + '\n]';

test('an edit that opens or closes blocks in a long document finds them after it shows, keeping folds', async () => {
  const { ed } = editor(objects(7_000));
  const f = folds(ed);
  const lines = ed.lineCol(ed.length).line;
  assert.equal(f.close[0], lines - 1, 'the array spans the document');
  ed.toggleFold(1);
  ed.toggleFold(lines - 4);
  assert.deepEqual([...f.folded.keys()], [1, lines - 4]);
  // "[" becomes "[x": the array no longer opens a block.
  ed.replace(1, 1, 'x');
  assert.equal(ed.text.slice(0, 3), '[x\n');
  assert.ok(f.foldsFor, 'the structure around the edit is being found');
  assert.equal(f.close[0], -1);
  assert.equal(f.close[1], 3, 'blocks after the edit are known at once');
  assert.deepEqual([...f.folded.keys()], [1, lines - 4], 'folds the edit cannot change stay');
  for (let k = 0; k < 100 && f.foldsFor; k++) await tick();
  assert.equal(f.foldsFor, null);
  assert.deepEqual([...f.close], [...scanFolds(ed.text, lineStarts(ed.text).ls).close]);
  assert.deepEqual([...f.folded.keys()], [1, lines - 4]);
  ed.undo();
  for (let k = 0; k < 100 && f.foldsFor; k++) await tick();
  assert.equal(f.close[0], lines - 1, 'undo brings the block back');
  assert.deepEqual([...f.folded.keys()], [1, lines - 4]);
});

test('typing while the structure is being found keeps what is known', async () => {
  const { ed } = editor(objects(7_000));
  const f = folds(ed);
  ed.replace(1, 1, 'x');
  assert.ok(f.foldsFor);
  // A new line before the second object's: the lines after it move.
  const at = ed.text.indexOf('},\n') + 3;
  ed.replace(at, at, '\n');
  assert.ok(f.foldsFor);
  assert.equal(f.close[1], 3);
  assert.equal(f.close[5], -1, 'the line edited is found later');
  assert.equal(f.close[8], 10, 'the third object moved down a line');
  for (let k = 0; k < 100 && f.foldsFor; k++) await tick();
  assert.deepEqual([...f.close], [...scanFolds(ed.text, lineStarts(ed.text).ls).close]);
});

test('a long paste into a long document finds the blocks around it after it shows', async () => {
  const { ed } = editor(objects(7_000));
  const f = folds(ed);
  const lines = ed.lineCol(ed.length).line;
  ed.toggleFold(1);
  ed.toggleFold(lines - 4);
  // Over 64K characters: the line starts are found again; a stray "{" opens a block.
  const at = ed.text.indexOf('},\n', ed.length >> 1) + 3;
  ed.replace(at, at, '{\n' + objects(3_000).slice(2, -2) + ',\n');
  assert.ok(f.foldsFor);
  const added = 9_000 + 1;
  assert.deepEqual([...f.folded.keys()], [1, lines - 4 + added], 'folds the edit cannot change stay');
  for (let k = 0; k < 200 && f.foldsFor; k++) await tick();
  assert.deepEqual([...f.close], [...scanFolds(ed.text, lineStarts(ed.text).ls).close]);
  assert.deepEqual([...f.folded.keys()], [1, lines - 4 + added]);
});

test('a short document finds its new structure at once', () => {
  const { ed } = editor(objects(10));
  const f = folds(ed);
  ed.replace(1, 1, 'x');
  assert.equal(f.foldsFor, null);
  assert.deepEqual([...f.close], [...scanFolds(ed.text, lineStarts(ed.text).ls).close]);
});

test('typing that keeps the structure lets the scan in progress go on', async (t) => {
  // (A clock always past each slice's end: a slice scans 4096 lines.)
  let clock = 0;
  t.mock.method(performance, 'now', () => (clock += 100));
  const { ed } = editor(objects(7_000));
  const f = folds(ed);
  ed.replace(1, 1, 'x');
  const scan = f.foldsFor;
  assert.ok(scan);
  await tick();
  // Typing inside a value: the scan goes on (it reads the document as it is now).
  const at = ed.text.indexOf('"k": 5') + 5;
  for (const c of '123') ed.replace(at, at, c);
  assert.equal(f.foldsFor, scan, 'not started over');
  for (let k = 0; k < 100 && f.foldsFor; k++) await tick();
  assert.deepEqual([...f.close], [...scanFolds(ed.text, lineStarts(ed.text).ls).close]);
});
