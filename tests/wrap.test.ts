import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { asciiCells, asciiRows, leadOf, Wrapper } from '../lib/engine/wrap';
import { highlightLine, StringStates, stringState } from '../lib/engine/highlight';

describe('soft wrap arithmetic', () => {
  test('printable ASCII takes one cell per character', () => {
    assert.equal(asciiCells('  "a": 1', 0, 8), 8);
    assert.equal(asciiCells('x{"k":"v"}y', 1, 10), 9);
  });

  test('leading tabs indent to the next tab stop', () => {
    assert.deepEqual(leadOf('\t\tx', 0, 3), [8, 2]);
    assert.deepEqual(leadOf('  \tx', 0, 4), [4, 3]);
    assert.equal(asciiCells('\t"a"', 0, 4), 7);
  });

  test('anything else is for the browser to size', () => {
    for (const s of ['"é"', '"中"', '"😀"', 'a\tb', 'a\u0001b', '" "']) assert.equal(asciiCells(s, 0, s.length), -1, s);
  });

  test('rows: full rows plus the rest, at least one', () => {
    assert.equal(asciiRows(0, 80), 1);
    assert.equal(asciiRows(80, 80), 1);
    assert.equal(asciiRows(81, 80), 2);
    assert.equal(asciiRows(800, 80), 10);
  });
});

describe('rows that start inside a string', () => {
  test('stringState follows quotes and escapes', () => {
    const t = '{"a": "x\\"y", "b": 1}';
    assert.equal(stringState(t, 0, 0), 0);
    assert.equal(stringState(t, 0, 2), 1);
    assert.equal(stringState(t, 0, 4), 0);
    assert.equal(stringState(t, 0, 9), 3);
    assert.equal(stringState(t, 0, 10), 1);
    assert.equal(stringState(t, 0, 12), 0);
    assert.equal(stringState(t, 4, 9, 0), stringState(t, 0, 9));
  });

  test('checkpoints give the state a scan from the line start does, in any order', () => {
    const line = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ k: 'v"\\' + i, n: i })));
    const t = 'x\n' + line;
    const states = new StringStates();
    for (const off of [2, 100, 8194, 20000, 61000, 30000, 9, t.length]) assert.equal(states.at(t, 2, off), stringState(t, 2, off), String(off));
  });

  test('a row that continues a string highlights its rest as a string', () => {
    const t = '"hello world", 1';
    const html = highlightLine(t, 7, t.length, null, true, 1);
    assert.match(html, /^<span class="ts">world&quot;<\/span>/);
    assert.match(html, /<span class="tn">1<\/span>/);
  });

  test('a continued key keeps the key colour', () => {
    const t = '"long key": 1';
    assert.match(highlightLine(t, 6, t.length, null, true, 1), /^<span class="tk">key&quot;<\/span>/);
  });

  test('an escape pending at the row start is skipped', () => {
    const t = '"a\\"b" 2';
    assert.match(highlightLine(t, 3, t.length, null, true, 3), /^<span class="ts">&quot;b&quot;<\/span>/);
  });
});

describe('row counts reused across edits', () => {
  // Only the ASCII arithmetic runs here; the hidden measuring box just needs to exist.
  const el = () => ({ className: '', style: {}, setAttribute() {}, appendChild() {}, remove() {} });
  (globalThis as { document?: unknown }).document ??= { createElement: el };
  const fresh = () => {
    const w = new Wrapper(el() as unknown as HTMLElement, 20);
    w.fit(40 * 7.8 + 4, 7.8);
    return w;
  };
  /** Display lines: every line, or with the lines in `hidden` folded away. */
  const lines = (t: string, hidden = new Set<number>()) => {
    const A: number[] = [];
    const B: number[] = [];
    let a = 0;
    t.split('\n').forEach((l, i) => {
      if (!hidden.has(i)) {
        A.push(a);
        B.push(a + l.length);
      }
      a += l.length + 1;
    });
    return [Int32Array.from(A), Int32Array.from(B)] as const;
  };

  test('match a fresh count after every edit and fold', () => {
    let seed = 11;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const word = () => 'abc{}[]":, x'.repeat(1 + rnd(12)).slice(0, 1 + rnd(90));
    let t = Array.from({ length: 60 }, () => (rnd(4) ? '' : '\t') + ' '.repeat(rnd(6)) + word()).join('\n');
    const live = fresh();
    for (let step = 0; step < 400; step++) {
      const at = rnd(t.length + 1);
      const op = rnd(5);
      if (op === 0) t = t.slice(0, at) + '\n' + word() + t.slice(at);
      else if (op === 1) t = t.slice(0, at) + t.slice(Math.min(t.length, at + 1 + rnd(120)));
      else if (op === 2) t = word() + t;
      else t = t.slice(0, at) + word().slice(0, 1 + rnd(4)) + t.slice(at);
      // Tabs only as indentation (a tab mid-line is for the browser to measure).
      t = t.replace(/(?<=[^\n\t ][^\n]*)\t/g, ' ');
      const hidden = new Set(step % 7 === 0 ? [] : [rnd(70), rnd(70), rnd(70)].filter((i) => i > 0));
      const [A, B] = lines(t, hidden);
      const got = Array.from(live.rows(t, A, B));
      const want = Array.from(fresh().rows(t, A, B));
      assert.deepEqual(got, want, `step ${step}`);
    }
  });
});
