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

test('typing over a selection is one undo step with the typing that follows', () => {
  const { ed, ta } = editor('{"tag": "b", "n": 5}');
  const h = history(ed);
  ta.setSelectionRange(8, 11);
  for (const c of '"EDITED"') ta.type(c);
  assert.equal(ed.text, '{"tag": "EDITED", "n": 5}');
  assert.equal(h.undo_.length, 1);
  assert.equal(h.histChars, stored(h));
  ed.undo();
  assert.equal(ed.text, '{"tag": "b", "n": 5}');
  assert.deepEqual([ta.selectionStart, ta.selectionEnd], [8, 11], 'the selection is back');
  ed.redo();
  assert.equal(ed.text, '{"tag": "EDITED", "n": 5}');
  // Typing elsewhere afterwards is a step of its own.
  ta.setSelectionRange(23, 24);
  for (const c of '7778') ta.type(c);
  assert.equal(ed.text, '{"tag": "EDITED", "n": 7778}');
  assert.equal(h.undo_.length, 2);
  ed.undo();
  assert.equal(ed.text, '{"tag": "EDITED", "n": 5}');
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

test('a big insert into a bigger text patches its line starts: no whole rescan', () => {
  const doc = Array.from({ length: 30_000 }, (_, i) => `  {"id": ${i}, "name": "Zoë ${i}"},`).join('\n');
  const { ed } = editor(doc);
  const inner = ed as unknown as { ls: number[] };
  const before = inner.ls;
  // A paste of 300K characters at the end (as Ctrl+V again), and one in the middle.
  const ins = '\n' + Array.from({ length: 10_000 }, (_, i) => `  {"id": ${i}, "x": "東京 ${i}"},`).join('\n');
  assert.ok(ins.length > 1 << 16);
  ed.replace(doc.length, doc.length, ins);
  assert.equal(inner.ls, before, 'patched in place');
  assert.deepEqual(inner.ls, lineStarts(ed.text).ls);
  ed.replace(5000, 5000, ins);
  assert.equal(inner.ls, before, 'patched in place');
  assert.deepEqual(inner.ls, lineStarts(ed.text).ls);
});

test('Undo and Redo past a load tell the file name of the document they bring back; Undo can be taken instead', () => {
  const { el } = editorElement();
  const names: (string | null)[] = [];
  let take = false;
  const ed = new Editor(el as unknown as HTMLElement, { ...events, renamed: (n: string | null) => names.push(n), undoing: () => take });
  ed.init('{"a":1}');
  frames();
  ed.setValue('{"b":2}', 0, true, ['a.json', 'b.json']);
  ed.replace(1, 1, ' ');
  ed.undo();
  assert.deepEqual(names, [], 'an edit carries no name');
  ed.undo();
  assert.equal(ed.text, '{"a":1}');
  ed.redo();
  assert.equal(ed.text, '{"b":2}');
  assert.deepEqual(names, ['a.json', 'b.json']);
  take = true;
  ed.undo();
  assert.equal(ed.text, '{"b":2}', 'taken by the listener');
  take = false;
  ed.undo();
  assert.equal(ed.text, '{"a":1}');
  assert.deepEqual(names, ['a.json', 'b.json', 'a.json']);
});

test("an input method's commit reaches the tool once, whichever comes first: its input event or compositionend (F22)", () => {
  // Chromium fires the commit's input event before compositionend, Firefox after it.
  for (const order of ['input first', 'compositionend first']) {
    const changes: string[] = [];
    const { el, ta } = editorElement();
    const ed = new Editor(el as unknown as HTMLElement, { ...events, change: (kind: string) => changes.push(kind) });
    ed.init('{}');
    frames();
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(new Event('compositionstart'));
    // The commit, with no composition update before it (as Playwright's insertText in Firefox).
    ta.dispatchEvent(Object.assign(new Event('beforeinput'), { inputType: 'insertCompositionText', data: '"é"' }));
    ta.value = '{"é"}';
    ta.setSelectionRange(4, 4);
    const input = () => ta.dispatchEvent(Object.assign(new Event('input'), { inputType: 'insertCompositionText', data: '"é"' }));
    if (order === 'input first') input();
    ta.dispatchEvent(new Event('compositionend'));
    if (order !== 'input first') input();
    assert.equal(ed.text, '{"é"}', order);
    assert.equal(changes.length, 1, `${order}: the tool is told once`);
    ed.undo();
    assert.equal(ed.text, '{}', `${order}: one Undo step`);
  }
});

test('a paste over the whole document leaves its file: Undo tells the name back, Redo takes it away again', () => {
  const { el, ta } = editorElement();
  const names: (string | null)[] = [];
  let name: string | null = 'a.json';
  const ed = new Editor(el as unknown as HTMLElement, { ...events, renamed: (n: string | null) => names.push((name = n)), name: () => name });
  ed.init('{"a":1}');
  frames();
  const inner = ed as unknown as { onPaste(e: unknown): void; onBeforeInput(e: unknown): void; onInput(e: unknown): void };
  /** A paste of `text` over `[a, b)` as the browser makes it: the paste event, then (if not taken) its insertion. */
  const paste = (text: string, a = 0, b = ta.value.length) => {
    ta.setSelectionRange(a, b);
    let taken = false;
    inner.onPaste({ clipboardData: { getData: () => text }, preventDefault: () => (taken = true) });
    if (taken) return;
    inner.onBeforeInput({ inputType: 'insertFromPaste', cancelable: true, preventDefault() {} });
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.setSelectionRange(a + text.length, a + text.length);
    inner.onInput({ inputType: 'insertFromPaste' });
  };
  paste('[1]');
  name = null; // (the engine's part: see Engine.onChange)
  assert.equal(ed.text, '[1]');
  paste('2', 1, 2);
  assert.equal(ed.text, '[2]');
  ed.undo();
  assert.deepEqual(names, [], 'a paste over part of it carries no name');
  ed.undo();
  assert.equal(ed.text, '{"a":1}');
  assert.deepEqual(names, ['a.json'], 'Undo: the name of the document it brings back');
  ed.redo();
  assert.equal(ed.text, '[1]');
  assert.deepEqual(names, ['a.json', null]);
  // A big paste, which the editor puts in itself (no browser insertion), the same.
  ed.undo();
  const big = JSON.stringify(Array.from({ length: 6000 }, (_, i) => i));
  assert.ok(big.length > 20_000);
  paste(big);
  name = null;
  assert.equal(ed.text, big);
  ed.undo();
  assert.equal(ed.text, '{"a":1}');
  assert.deepEqual(names, ['a.json', null, 'a.json', 'a.json']);
});
