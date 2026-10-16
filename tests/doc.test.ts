import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../lib/engine/doc';

test('a document edited anywhere reads like the string edited the same way', () => {
  let seed = 9;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  const word = () => 'ab\tc\nd{é}'.slice(rnd(5), 5 + rnd(5));
  for (let run = 0; run < 8; run++) {
    let s = 'x'.repeat(rnd(3) ? 20_000 + rnd(40_000) : rnd(50));
    let d = Doc.of(s);
    for (let step = 0; step < 200; step++) {
      const n = s.length;
      // Mostly typing near the last edit, sometimes far away, sometimes big.
      const near = rnd(4) > 0 && step > 0;
      let a = near ? Math.max(0, Math.min(n, (d as unknown as { at: number[] }).at[0] ?? 0) + rnd(9000) - 4500) : rnd(n + 1);
      a = Math.max(0, Math.min(n, a));
      const del = rnd(3) === 0 ? rnd(rnd(10) === 0 ? 20_000 : 40) : 0;
      const b = Math.min(n, a + del);
      const ins = rnd(150) === 0 ? 'Z'.repeat(1 + rnd(300_000)) : rnd(4) ? word() : '';
      const prev = d;
      d = d.edit(a, b, ins);
      s = s.slice(0, a) + ins + s.slice(b);
      assert.equal(d.length, s.length, `length, run ${run} step ${step}`);
      if (step % 37 === 0) assert.equal(d.toString(), s, `text, run ${run} step ${step}`);
      for (let k = 0; k < 20; k++) {
        const i = rnd(s.length + 2) - 1;
        assert.equal(d.charCodeAt(i), s.charCodeAt(i), `charCodeAt(${i}), run ${run} step ${step}`);
        const from = Math.max(0, i);
        const j = Math.min(s.length + 3, from + rnd(rnd(8) === 0 ? 50_000 : 300));
        assert.equal(d.slice(from, j), s.slice(from, j), `slice(${from}, ${j})`);
      }
      const from = rnd(s.length + 1);
      const to = from + rnd(60_000);
      const want = s.slice(0, to).indexOf('\n', from);
      assert.equal(d.indexOf('\n', from, to), want, `indexOf from ${from} to ${to}`);
      if (d.tabs === false) assert.equal(s.indexOf('\t'), -1);
      if (s.indexOf('\t') !== -1) assert.ok(d.tabs);
      // Earlier versions stay as they were.
      assert.equal(prev.length, prev.toString().length);
    }
  }
});

test('typing in one place keeps one replacement; undoing it restores the base', () => {
  const base = 'q'.repeat(100_000);
  let d = Doc.of(base);
  for (let i = 0; i < 50; i++) d = d.edit(5000 + i, 5000 + i, 'w');
  const pieces = (d as unknown as { m: string[] }).m;
  assert.equal(pieces.length, 1);
  assert.equal(d.flat, null);
  for (let i = 50; i > 0; i--) d = d.edit(5000 + i - 1, 5000 + i, '');
  assert.equal(d.flat, base);
});

test('edits in many places, or a huge one, make the text one string again', () => {
  let s = 'abcdefghij'.repeat(100_000);
  let d = Doc.of(s);
  for (let i = 0; i < 60; i++) {
    const at = i * 15_000;
    d = d.edit(at, at + 1, 'XY');
    s = s.slice(0, at) + 'XY' + s.slice(at + 1);
  }
  assert.equal(d.toString(), s);
  assert.ok((d as unknown as { m: string[] }).m.length < 60);
  const big = 'Q'.repeat(5_000_000);
  const e = d.edit(10, 20, big);
  assert.equal(e.flat, s.slice(0, 10) + big + s.slice(20));
});

test('pieces are visited in order and views are bounded', () => {
  let d = Doc.of('0123456789'.repeat(10_000));
  d = d.edit(10, 12, 'AB').edit(50_000, 50_001, 'CDE').edit(90_000, 90_000, '\n');
  const parts: string[] = [];
  d.each(5, 99_000, (s, i, j) => void parts.push(s.slice(i, j)));
  assert.equal(parts.join(''), d.toString().slice(5, 99_000));
  // A whole-document replacement is a new base.
  const e = d.edit(0, d.length, 'new');
  assert.equal(e.flat, 'new');
});
