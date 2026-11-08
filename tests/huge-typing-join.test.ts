/*
 * REVIEW-2 #11: deleting keys in a typing run join it, as typed keys do (lib/huge/editor.ts apply): Backspace and
 * Delete at the caret are one undo step and one "change" with the typing around them, not one each.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeDoc } from '../lib/huge/doc';
import { HugeEditor } from '../lib/huge/editor';
import { piecesOf } from '../lib/huge/pieces';
import { parse } from '../lib/json/tape-parser';
import { enc, hugeMod, tapeMod } from './huge-oracle';

function open(text: string) {
  const bytes = enc.encode(text);
  const d = new HugeDoc({ size: bytes.length, read: (a: number, n: number) => bytes.subarray(a, a + n) }, hugeMod, { wasm: tapeMod, parse });
  d.step(Infinity);
  const e = new HugeEditor(d);
  const text_ = () => new TextDecoder().decode(d.src.read(0, d.src.size));
  const type = (at: number, s: string) => e.apply([{ a: at, b: at, put: piecesOf(enc.encode(s)) }], Infinity, true);
  const del = (a: number, b: number) => e.apply([{ a, b, put: [] }], Infinity, true);
  return { e, text: text_, type, del };
}

test("REVIEW-2 #11: Backspace after typing joins the run (the reviewer's case): one step, undone at once", () => {
  const { e, text, type, del } = open('{"name": "abcdefghij"}');
  for (const [i, ch] of [...'xyz'].entries()) type(19 + i, ch);
  assert.equal(e.applied, 1);
  // Five Backspaces: "zyx", then "ih" of the file ("xyz" was typed between its i and j).
  for (let k = 0; k < 5; k++) del(21 - k, 22 - k);
  assert.equal(text(), '{"name": "abcdefgj"}');
  assert.equal(e.applied, 1, 'one step, one change');
  e.undo();
  assert.equal(text(), '{"name": "abcdefghij"}', 'undone at once');
  assert.equal(e.applied, 0);
  e.redo();
  assert.equal(text(), '{"name": "abcdefgj"}');
});

test('Backspace alone, Delete forward, and typing after deleting: one run; a key elsewhere starts another', () => {
  const { e, text, type, del } = open('{"name": "abcdefghij"}');
  // Backspace ×3 at the end of the name.
  for (let k = 0; k < 3; k++) del(19 - k, 20 - k);
  assert.equal(text(), '{"name": "abcdefg"}');
  assert.equal(e.applied, 1);
  // Typed on where the caret is now.
  type(17, 'X');
  assert.equal(text(), '{"name": "abcdefgX"}');
  assert.equal(e.applied, 1, 'typing after deleting goes on with the run');
  // Delete (forward) at the start of the name: elsewhere: a new step.
  del(10, 11);
  assert.equal(text(), '{"name": "bcdefgX"}');
  assert.equal(e.applied, 2);
  // Delete again at the same caret: joins it.
  del(10, 11);
  del(10, 11);
  assert.equal(text(), '{"name": "defgX"}');
  assert.equal(e.applied, 2);
  e.undo();
  assert.equal(text(), '{"name": "abcdefgX"}');
  e.undo();
  assert.equal(text(), '{"name": "abcdefghij"}');
  e.redo();
  e.redo();
  assert.equal(text(), '{"name": "defgX"}');
});

test('not typing (a node edit), or a replace of a selection: steps of their own', () => {
  const { e, text, type, del } = open('{"name": "abcdefghij"}');
  type(20, 'x');
  e.apply([{ a: 19, b: 21, put: [] }], Infinity, false);
  assert.equal(e.applied, 2, 'not typing');
  assert.equal(text(), '{"name": "abcdefghi"}');
  del(18, 19);
  assert.equal(e.applied, 3, 'after a step that is not typing: a new one');
  // A selection typed over at the caret: a replace of its own.
  e.apply([{ a: 10, b: 12, put: piecesOf(enc.encode('Z')) }], Infinity, true);
  assert.equal(text(), '{"name": "Zcdefgh"}');
  assert.equal(e.applied, 4);
});
