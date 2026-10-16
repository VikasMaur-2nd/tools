import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSlices } from '../lib/json/text-slices';
import { applyCodeChange, codeChange } from '../lib/json/code-index';

test('output slices preserve repeated edits and every UTF-16 boundary', () => {
  let text = 'é😀東京 abc\n'.repeat(600);
  let slices = TextSlices.from(text);
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let k = 0; k < 1000; k++) {
    const a = rnd(text.length + 1);
    const b = Math.min(text.length, a + rnd(20));
    const insert = ['', 'x', 'é😀\n', '東京'][rnd(4)];
    const next = text.slice(0, a) + insert + text.slice(b);
    const change = codeChange(text, next);
    const patch = next.slice(change.prefix, next.length - change.suffix);
    assert.equal(applyCodeChange(text, patch, change, (a, b) => slices.slice(a, b)), next);
    slices = slices.patch(change.prefix, change.suffix, patch);
    text = next;
    assert.equal(slices.length, text.length);
    assert.equal(slices.slice(), text);
    for (let j = 0; j < 4; j++) {
      const start = rnd(text.length + 1);
      const end = Math.min(text.length, start + rnd(100));
      assert.equal(slices.slice(start, end), text.slice(start, end));
    }
  }
});

test('output slices retain snapshots and handle full replacement and deletion', () => {
  const old = TextSlices.from('before');
  const next = old.patch(2, 2, 'X');
  assert.equal(old.slice(), 'before');
  assert.equal(next.slice(), 'beXre');
  assert.equal(next.patch(0, 0, '').slice(), '');
  assert.equal(TextSlices.from('').patch(0, 0, 'new').slice(), 'new');
  assert.equal(next.patch(0, 0, 'replacement').slice(), 'replacement');
});
