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

describe('cursive letters joined across a row break', () => {
  const el = () => ({ className: '', style: {}, setAttribute() {}, appendChild() {}, remove() {} });
  (globalThis as { document?: unknown }).document ??= { createElement: el };
  const at = (s: string) => [s.replace('|', ''), s.indexOf('|')] as const;
  const joins = (gecko: boolean, s: string) => {
    const g = globalThis as { CSS?: unknown };
    const prev = g.CSS;
    g.CSS = { supports: () => gecko };
    try {
      const [t, i] = at(s);
      return new Wrapper(el() as unknown as HTMLElement, 20).joinsAt(t, i);
    } finally {
      g.CSS = prev;
    }
  };

  test('a word cut between two joining letters stays joined in Gecko only', () => {
    assert.equal(joins(true, 'ال|قاهرة'), true); // lam (dual) → qaf
    assert.equal(joins(false, 'ال|قاهرة'), false);
  });

  test('letters that only join backwards, or never, end the join', () => {
    assert.equal(joins(true, 'القاهر|ة'), false); // reh joins only the letter before it
    assert.equal(joins(true, 'با|ب'), false); // alef
    assert.equal(joins(true, 'ب|ء'), false); // hamza never joins
    assert.equal(joins(true, 'ab|cd'), false);
  });

  test('marks are skipped, and other cursive scripts count', () => {
    assert.equal(joins(true, 'بَ|ب'), true); // fatha over beh
    assert.equal(joins(true, 'ܒ|ܒ'), true); // Syriac beth
    assert.equal(joins(true, '𞤀|𞤁'), true); // Adlam, outside the BMP
  });
});

describe('row breaks added up for long lines', () => {
  const el = () => ({ className: '', style: {}, setAttribute() {}, appendChild() {}, remove() {} });
  (globalThis as { document?: unknown }).document ??= { createElement: el };
  const TAB = 4;
  const tabTo = (x: number, cw: number) => {
    const stop = TAB * cw;
    const g = (Math.floor(x / stop) + 1) * stop - x;
    return g < cw / 2 ? g + stop : g;
  };
  // The character-by-character original, for ASCII, tabs and a zero-width joiner of width 0.
  const reference = (s: string, cw: number, max: number) => {
    const starts = [0];
    let w = 0;
    let joined = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      let g = c === 9 ? tabTo(w, cw) : c === 0x200d ? 0 : cw;
      if (!joined && c !== 0x200d && w + g > max && i > starts[starts.length - 1]) {
        starts.push(i);
        w = 0;
        if (c === 9) g = tabTo(0, cw);
      }
      w += g;
      joined = c === 0x200d;
    }
    return starts;
  };

  test('the ASCII fast path breaks exactly where adding up one by one does', () => {
    let seed = 3;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    // Cell widths exact in binary: the two ways of adding up then agree to the last bit.
    for (const [cols, cw] of [[8, 8], [37, 7.5], [60, 6.25], [120, 7.75]] as const) {
      const w = new Wrapper(el() as unknown as HTMLElement, 20, false);
      w.fit(cols * cw + cw / 2 + 0.25, cw);
      const internals = w as unknown as { sum(s: string): Int32Array; glyphs: Map<number, number>; joins: Set<number> };
      internals.glyphs.set(0x200d, 0);
      internals.joins.add(0x200d);
      for (let k = 0; k < 400; k++) {
        let s = '';
        for (let n = rnd(900); n > 0; n--) {
          const r = rnd(40);
          s += r === 0 ? '\t' : r === 1 ? '‍' : String.fromCharCode(32 + rnd(95));
        }
        assert.deepEqual([...internals.sum(s)], reference(s, cw, w.width), `cols ${cols}, ${JSON.stringify(s.slice(0, 40))}`);
      }
    }
  });
});
