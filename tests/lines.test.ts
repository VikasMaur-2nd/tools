import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { foldScanner, foldSig, lineEndIn, lineOfIn, lineStarts, lineWidth, maxWidth, patchLines, scanFolds, shiftFoldLines } from '../lib/engine/lines';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHA = ['\n', '\n', '\t', ' ', ' ', '{', '}', '[', ']', ',', ':', '"', 'a', 'b', '1', '/', '\r'];

function piece(r: () => number, max: number) {
  const n = Math.floor(r() * (max + 1));
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[Math.floor(r() * ALPHA.length)];
  return s;
}

/** Widest line computed the slow, obvious way. */
function slowMax(t: string) {
  let max = 0;
  for (const line of t.split('\n')) {
    let col = 0;
    for (const ch of line) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
    if (col > max) max = col;
  }
  return max;
}

describe('lines', () => {
  test('lineStarts and widths match a plain split', () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const t = piece(r, 60);
      const { ls, max } = lineStarts(t);
      const starts = [0];
      for (let p = 0; p < t.length; p++) if (t[p] === '\n') starts.push(p + 1);
      assert.deepEqual(ls, starts);
      assert.equal(max, slowMax(t));
      assert.equal(maxWidth(t, ls), slowMax(t));
      for (let ln = 0; ln < ls.length; ln++) {
        const e = lineEndIn(ls, t.length, ln);
        assert.equal(lineWidth(t, ls[ln], e), slowMax(t.slice(ls[ln], e)));
        assert.equal(lineOfIn(ls, ls[ln]), ln);
      }
    }
  });

  test('patchLines after random edits equals a full computation', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      let t = piece(r, 200);
      const { ls } = lineStarts(t);
      let { max } = lineStarts(t);
      for (let step = 0; step < 200; step++) {
        const a = Math.floor(r() * (t.length + 1));
        const b = Math.min(t.length, a + Math.floor(r() * (r() < 0.8 ? 3 : 40)));
        const ins = piece(r, r() < 0.8 ? 2 : 30);
        const next = t.slice(0, a) + ins + t.slice(b);
        const before = ls.length;
        const res = patchLines(ls, t, next, a, b, ins, max);
        const full = lineStarts(next);
        assert.deepEqual(ls, full.ls, `seed ${seed} step ${step}: line starts`);
        assert.equal(res.max, full.max, `seed ${seed} step ${step}: width`);
        assert.equal(ls.length, before - (res.lb - res.la) + res.added, 'line count bookkeeping');
        max = res.max;
        t = next;
      }
    }
  });

  test('patchLines inserts and removes hundreds of thousands of lines (no argument-count limit)', () => {
    const many = '\n'.repeat(300_000);
    for (const [t, a, b, ins] of [['{"a":1}', 3, 3, many], ['x\ny\nz', 2, 3, many + 'q'], [many + 'end', 5, 250_000, 'y\n'.repeat(5000)]] as const) {
      const { ls, max } = lineStarts(t);
      const next = t.slice(0, a) + ins + t.slice(b);
      // (No tabs: the editor says so, and each line's width is its length.)
      const res = patchLines(ls, t, next, a, b, ins, max, true, false);
      const full = lineStarts(next);
      assert.ok(ls.length === full.ls.length && ls.every((v, k) => v === full.ls[k]), 'line starts');
      assert.equal(res.max, full.max);
    }
  });

  test('patchLines keeps the widest line without rescanning', () => {
    for (let seed = 100; seed <= 140; seed++) {
      const r = rng(seed);
      let t = piece(r, 200);
      const { ls } = lineStarts(t);
      let { max } = lineStarts(t);
      for (let step = 0; step < 200; step++) {
        const a = Math.floor(r() * (t.length + 1));
        const b = Math.min(t.length, a + Math.floor(r() * 5));
        const ins = piece(r, 4);
        const next = t.slice(0, a) + ins + t.slice(b);
        max = patchLines(ls, t, next, a, b, ins, max).max;
        assert.equal(max, slowMax(next), `seed ${seed} step ${step}: width`);
        t = next;
      }
      assert.deepEqual(ls, lineStarts(t).ls);
    }
  });

  test('scanFolds is unchanged by a one-line edit that keeps the line signature', () => {
    let skipped = 0;
    for (let seed = 200; seed <= 260; seed++) {
      const r = rng(seed);
      let t = piece(r, 300);
      const { ls } = lineStarts(t);
      let { max } = lineStarts(t);
      let folds = scanFolds(t, ls);
      for (let step = 0; step < 200; step++) {
        const a = Math.floor(r() * (t.length + 1));
        const b = Math.min(t.length, a + Math.floor(r() * 4));
        const ins = piece(r, 3);
        const next = t.slice(0, a) + ins + t.slice(b);
        const la = lineOfIn(ls, a);
        const one = la === lineOfIn(ls, b) && !ins.includes('\n');
        const sig = one ? foldSig(t, ls[la], lineEndIn(ls, t.length, la)) : -1;
        max = patchLines(ls, t, next, a, b, ins, max).max;
        const same = one && foldSig(next, ls[la], lineEndIn(ls, next.length, la)) === sig;
        const full = scanFolds(next, ls);
        if (same) {
          skipped++;
          assert.deepEqual(folds.close, full.close, `seed ${seed} step ${step}: close`);
          assert.deepEqual(folds.depth, full.depth, `seed ${seed} step ${step}: depth`);
        }
        folds = full;
        t = next;
      }
    }
    assert.ok(skipped > 1000, `the fast path should be common (${skipped})`);
  });

  test('edits of lines that neither open nor close a block move the fold structure as a rescan finds it', () => {
    let shifted = 0;
    const plain = (s: number) => (s & 10) === 0;
    for (let seed = 300; seed <= 340; seed++) {
      const r = rng(seed);
      let t = piece(r, 400);
      const { ls } = lineStarts(t);
      let folds = scanFolds(t, ls);
      for (let step = 0; step < 150; step++) {
        const a = Math.floor(r() * (t.length + 1));
        const b = Math.min(t.length, a + Math.floor(r() * 6));
        // Enter, Backspace over line breaks, or a little text.
        const ins = r() < 0.5 ? '\n' + ' '.repeat(Math.floor(r() * 3)) : piece(r, 3);
        const next = t.slice(0, a) + ins + t.slice(b);
        const la = lineOfIn(ls, a);
        const lb = lineOfIn(ls, b);
        const was = Array.from({ length: lb - la + 1 }, (_, k) => foldSig(t, ls[la + k], lineEndIn(ls, t.length, la + k)));
        const { added } = patchLines(ls, t, next, a, b, ins, 0, false);
        const now = Array.from({ length: added + 1 }, (_, k) => foldSig(next, ls[la + k], lineEndIn(ls, next.length, la + k)));
        const full = scanFolds(next, ls);
        if (was.every(plain) && now.every(plain)) {
          shifted++;
          const got = shiftFoldLines(folds.close, folds.depth, la, lb, added);
          assert.deepEqual(got.close, full.close, `seed ${seed} step ${step}: close`);
          assert.deepEqual(got.depth, full.depth, `seed ${seed} step ${step}: depth`);
        }
        folds = full;
        t = next;
      }
    }
    assert.ok(shifted > 500, `the fast path should be common (${shifted})`);
  });

  test('scanFolds matches the editor loop it replaced', () => {
    const r = rng(9);
    for (let i = 0; i < 300; i++) {
      const t = piece(r, 200);
      const { ls } = lineStarts(t);
      const ref = oldScan(t, ls);
      const got = scanFolds(t, ls);
      assert.deepEqual(got.close, ref.close);
      assert.deepEqual(got.depth, ref.depth);
    }
  });

  test('foldScanner in steps finds what scanFolds finds in one go', () => {
    const r = rng(17);
    for (let i = 0; i < 40; i++) {
      // Several thousand lines, so the scan stops many times (every 4096 lines, the clock always past).
      const t = Array.from({ length: 12 }, () => piece(r, 2000)).join('\n'.repeat(1 + Math.floor(r() * 900)));
      const { ls } = lineStarts(t);
      const scan = foldScanner(t, ls);
      let got: ReturnType<typeof scan>;
      let steps = 0;
      while (!(got = scan(0))) steps++;
      assert.ok(ls.length <= 4096 || steps > 0, 'stops on the way');
      const ref = scanFolds(t, ls);
      assert.deepEqual(got.close, ref.close);
      assert.deepEqual(got.depth, ref.depth);
    }
  });

  test('scanFolds finds blocks whose closer is alone on its line', () => {
    const t = '{\n  "a": [\n    1\n  ],\n  // x {\n  "b": 2\n}';
    const { ls } = lineStarts(t);
    const { close, depth } = scanFolds(t, ls);
    assert.deepEqual([...close], [6, 3, -1, -1, -1, -1, -1]);
    assert.equal(depth[1], 1);
  });
});

/** The editor's scanFolds loop before it moved to lines.ts, verbatim. */
function oldScan(t: string, ls: number[]) {
  const n = ls.length;
  const close = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = ls[i];
    const e = lineEndIn(ls, t.length, i);
    let a = s;
    while (a < e && (t.charCodeAt(a) === 32 || t.charCodeAt(a) === 9)) a++;
    if (a === e) continue;
    const first = t.charCodeAt(a);
    if (first === 47 && t.charCodeAt(a + 1) === 47) continue;
    let b = e - 1;
    while (b > a && (t.charCodeAt(b) === 32 || t.charCodeAt(b) === 9 || t.charCodeAt(b) === 13)) b--;
    if ((first === 125 || first === 93) && stack.length) {
      const o = stack.pop() as number;
      if (i > o + 1 && (b === a || (b === a + 1 && t.charCodeAt(b) === 44))) close[o] = i;
    }
    const last = t.charCodeAt(b);
    if ((last === 123 || last === 91) && !(b === a && (first === 125 || first === 93))) {
      depth[i] = stack.length;
      stack.push(i);
    }
  }
  return { close, depth };
}
