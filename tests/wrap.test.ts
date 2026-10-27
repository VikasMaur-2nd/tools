import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { asciiCells, asciiRows, CUT, leadOf, Wrapper } from '../lib/engine/wrap';
import { bidiContext, highlightLine, StringStates, stringState } from '../lib/engine/highlight';
import { Doc } from '../lib/engine/doc';

/** Row starts the wrapper adds up for the long line `t[a, b)`, as an array. */
function breaks(w: object, t: string, a: number, b: number) {
  const st = (w as { rowsOf(t: string, a: number, b: number): { length: number; get(r: number): number } }).rowsOf(t, a, b);
  return Int32Array.from({ length: st.length }, (_, r) => st.get(r));
}

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
      const internals = w as unknown as { glyphs: Map<number, number>; joins: Set<number> };
      internals.glyphs.set(0x200d, 0);
      internals.joins.add(0x200d);
      for (let k = 0; k < 400; k++) {
        let s = '';
        for (let n = rnd(900); n > 0; n--) {
          const r = rnd(40);
          s += r === 0 ? '\t' : r === 1 ? '‍' : String.fromCharCode(32 + rnd(95));
        }
        assert.deepEqual([...breaks(internals, s, 0, s.length)], reference(s, cw, w.width), `cols ${cols}, ${JSON.stringify(s.slice(0, 40))}`);
      }
    }
  });
  test('typing in a long line breaks it exactly as adding it up afresh does', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    const make = (cols: number, cw: number) => {
      const w = new Wrapper(el() as unknown as HTMLElement, 20, false);
      w.fit(cols * cw + cw / 2 + 0.25, cw);
      const x = w as unknown as { glyphs: Map<number, number>; joins: Set<number> };
      for (const [c, g] of [[0x200d, 0], [0x301, 0], [0xe9, cw], [0x4e2d, 2 * cw], [0x1f1ee, 1.5 * cw], [0x1f1f3, 1.5 * cw], [0x2028, 0]]) x.glyphs.set(c, g);
      x.joins.add(0x200d);
      x.joins.add(0x301);
      return x;
    };
    const pick = () => {
      const r = rnd(60);
      return r === 0 ? '\t' : r === 1 ? '\u200d' : r === 2 ? 'e\u0301' : r === 3 ? '中' : r === 4 ? '\u{1f1ee}\u{1f1f3}' : r === 5 ? '\u2028' : r === 6 ? 'é' : String.fromCharCode(32 + rnd(95));
    };
    for (const [cols, cw] of [[8, 8], [37, 7.5], [120, 7.75]] as const) {
      const typed = make(cols, cw);
      let s = '';
      for (let n = 4000; n > 0; n--) s += pick();
      const pre = 'x\n';
      for (let k = 0; k < 300; k++) {
        // Never between the halves of a surrogate pair.
        const low = (i: number) => (s.charCodeAt(i) & 0xfc00) === 0xdc00;
        let at = rnd(s.length + 1);
        if (low(at)) at--;
        let end = Math.min(s.length, at + (rnd(4) === 0 ? rnd(6) : 0));
        if (low(end)) end++;
        s = s.slice(0, at) + (rnd(5) ? pick() : '') + s.slice(end);
        const t = pre + s;
        const fresh = breaks(make(cols, cw), s, 0, s.length);
        assert.deepEqual([...breaks(typed, t, pre.length, t.length)], [...fresh], `cols ${cols}, edit ${k} at ${at}`);
      }
    }
  });
  test('a huge line split or joined: rows near the edit exact at once, all of them once settled', () => {
    let seed = 5;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    type X = Pick<Wrapper, 'rows' | 'rowStart' | 'settle' | 'onRows'> & { glyphs: Map<number, number>; joins: Set<number> };
    const make = () => {
      const w = new Wrapper(el() as unknown as HTMLElement, 20, false);
      w.fit(80 * 8 + 4 + 0.25, 8);
      const x = w as unknown as X;
      for (const [c, g] of [[0xe9, 8], [0x4e2d, 16], [0x1f600, 16]]) x.glyphs.set(c, g);
      return x;
    };
    const pick = () => {
      const r = rnd(40);
      return r === 0 ? 'é' : r === 1 ? '中' : r === 2 ? '😀' : r === 3 ? '\t' : String.fromCharCode(32 + rnd(95));
    };
    let s = '';
    for (let n = 760_000; n > 0; n--) s += pick();
    const lines = (t: string) => {
      const A: number[] = [];
      const B: number[] = [];
      for (let a = 0; ; ) {
        const e = t.indexOf('\n', a);
        A.push(a);
        B.push(e < 0 ? t.length : e);
        if (e < 0) break;
        a = e + 1;
      }
      return [Int32Array.from(A), Int32Array.from(B)] as const;
    };
    const exact = (t: string) => {
      const f = make();
      const [A, B] = lines(t);
      f.rows(t, A, B);
      f.settle();
      return { rows: [...f.rows(t, A, B)], sums: Array.from(A, (a, i) => [...breaks(f, t, a, B[i])]) };
    };
    const w = make();
    let refined = 0;
    w.onRows = () => refined++;
    let t = s;
    w.rows(t, ...lines(t));
    w.settle();
    assert.deepEqual([...breaks(w, t, 0, t.length)], exact(t).sums[0], 'first layout, settled');
    for (const at of [3500, 400_000]) {
      // Enter: split, then Backspace: join again.
      for (const [next, edit] of [
        [t.slice(0, at) + '\n' + t.slice(at), [at, at, at + 1]],
        [t, [at, at + 1, at]],
      ] as [string, [number, number, number]][]) {
        const [A, B] = lines(next);
        w.rows(next, A, B, edit);
        const want = exact(next);
        for (let i = 0; i < A.length; i++) {
          const got = breaks(w, next, A[i], B[i]);
          // Exact at once up to the window past the edit (where the view and the caret are).
          const near = want.sums[i].filter((x) => A[i] + x <= at + 30_000);
          const gotN = [...got.subarray(0, near.length)];
          const bad = gotN.findIndex((x, k) => x !== near[k]);
          assert.ok(bad < 0 && gotN.length === near.length, `near the edit: line ${i}, edit at ${at}: first diff row ${bad} got ${gotN.slice(Math.max(0, bad - 2), bad + 3)} want ${near.slice(Math.max(0, bad - 2), bad + 3)} of ${near.length} (got ${got.length})`);
        }
        const before = refined;
        w.settle();
        assert.ok(refined >= before, 'told when refined');
        assert.deepEqual([...w.rows(next, A, B)], want.rows, `rows once settled, edit at ${at}`);
        for (let i = 0; i < A.length; i++) assert.deepEqual([...breaks(w, next, A[i], B[i])], want.sums[i], `breaks once settled: line ${i}, edit at ${at}`);
        t = next;
      }
    }
  });

  test('rows() after an edit, told or not where it was, matches a fresh count on long lines', () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    type X = Pick<Wrapper, 'rows' | 'rowStart' | 'odd'> & { glyphs: Map<number, number>; joins: Set<number> };
    const make = (cols: number, cw: number) => {
      const w = new Wrapper(el() as unknown as HTMLElement, 20, false);
      w.fit(cols * cw + cw / 2 + 0.25, cw);
      const x = w as unknown as X;
      for (const [c, g] of [[0x200d, 0], [0x301, 0], [0xe9, cw], [0x4e2d, 2 * cw], [0x1f600, 2 * cw], [0x1f1ee, 1.5 * cw], [0x1f1f3, 1.5 * cw], [0x2028, 0]]) x.glyphs.set(c, g);
      x.joins.add(0x200d);
      x.joins.add(0x301);
      return x;
    };
    const pick = () => {
      const r = rnd(50);
      return r === 0 ? '\t' : r === 1 ? '‍' : r === 2 ? 'é' : r === 3 ? '中' : r === 4 ? '\u{1f1ee}\u{1f1f3}' : r === 5 ? ' ' : r === 6 ? 'é' : r === 7 ? '😀' : String.fromCharCode(32 + rnd(95));
    };
    const lines = (t: string) => {
      const A: number[] = [];
      const B: number[] = [];
      let a = 0;
      for (;;) {
        const e = t.indexOf('\n', a);
        A.push(a);
        B.push(e < 0 ? t.length : e);
        if (e < 0) break;
        a = e + 1;
      }
      return [Int32Array.from(A), Int32Array.from(B)] as const;
    };
    for (const [cols, cw] of [[8, 8], [37, 7.5], [120, 7.75]] as const) {
      const told = make(cols, cw);
      const guessed = make(cols, cw);
      const long = () => {
        let s = '';
        for (let n = 5000 + rnd(1500); n > 0; n--) s += pick();
        return s;
      };
      let t = long() + '\n' + long() + '\n' + long();
      told.rows(t, ...lines(t));
      guessed.rows(t, ...lines(t));
      for (let k = 0; k < 200; k++) {
        const low = (i: number) => (t.charCodeAt(i) & 0xfc00) === 0xdc00;
        let at = rnd(t.length + 1);
        if (low(at)) at--;
        let end = Math.min(t.length, at + (rnd(4) === 0 ? rnd(8) : 0));
        if (low(end)) end++;
        let ins = rnd(5) ? pick() : '';
        // (Only long lines: shorter ones would be measured, and tests have no layout.)
        if (rnd(30) === 0 && at - t.lastIndexOf('\n', at - 1) > 3600 && (t.indexOf('\n', end) < 0 ? t.length : t.indexOf('\n', end)) - end > 3600) ins += '\n';
        t = t.slice(0, at) + ins + t.slice(end);
        const [A, B] = lines(t);
        const a = told.rows(t, A, B, [at, end, at + ins.length]);
        const g = guessed.rows(t, A, B);
        const fresh = make(cols, cw);
        const f = fresh.rows(t, A, B);
        assert.deepEqual([...a], [...f], `told: cols ${cols}, edit ${k} at ${at}`);
        assert.deepEqual([...g], [...f], `guessed: cols ${cols}, edit ${k} at ${at}`);
        for (let i = 0; i < A.length; i++) {
          if (B[i] - A[i] <= 3000 || !fresh.odd[i]) continue;
          const want = [...breaks(fresh, t, A[i], B[i])];
          assert.deepEqual([...breaks(told, t, A[i], B[i])], want, `told breaks: line ${i}, edit ${k}`);
          assert.deepEqual([...breaks(guessed, t, A[i], B[i])], want, `guessed breaks: line ${i}, edit ${k}`);
          const r = rnd(want.length);
          assert.equal(told.rowStart(t, A[i], B[i], r, 1), want[r]);
        }
      }
    }
  });

  test('a huge new text in place of the old: rows near the start at once, all of them when idle, no task long', () => {
    let seed = 13;
    const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), (seed >>> 16) % n);
    type X = Pick<Wrapper, 'rows' | 'settle'> & { glyphs: Map<number, number>; joins: Set<number> };
    const make = () => {
      const w = new Wrapper(el() as unknown as HTMLElement, 20, false) as unknown as X;
      (w as unknown as Wrapper).fit(60 * 8 + 4 + 0.25, 8);
      for (const [c, g] of [[0xc4, 8], [0x6771, 16], [0x4eac, 16], [0x1f680, 16], [0x200d, 0]]) w.glyphs.set(c, g);
      w.joins.add(0x200d);
      return w;
    };
    const parts = ['abcdefghij ', 'Ä', '東京 ', '\\n ', '🚀', '\u200d', 'x'];
    const huge = (n: number) => {
      let s = '"';
      while (s.length < n) s += parts[rnd(parts.length)];
      return s + '"';
    };
    // As the output view does: the whole text replaced, one line before and after.
    const w = make();
    const first = huge(5000);
    w.rows(first, Int32Array.of(0), Int32Array.of(first.length));
    const t = huge(600_000);
    const one = (s: string) => [Int32Array.of(0), Int32Array.of(s.length)] as const;
    const t0 = performance.now();
    const est = w.rows(t, ...one(t), [0, first.length, t.length])[0];
    const ms = performance.now() - t0;
    const fresh = make();
    fresh.rows(t, ...one(t));
    fresh.settle();
    const want = [...breaks(fresh, t, 0, t.length)];
    const got = [...breaks(w, t, 0, t.length)];
    const near = want.filter((x) => x <= 32_768);
    assert.deepEqual(got.slice(0, near.length), near, 'exact near the start');
    assert.equal((w as unknown as { pending: unknown[] }).pending.length, 1, 'the rest estimated, to be refined');
    assert.ok(est > 0 && ms < 100, `${ms.toFixed(0)} ms for the first rows`);
    w.settle();
    assert.deepEqual([...breaks(w, t, 0, t.length)], want, 'exact once settled');
  });

  test('a document of pieces breaks exactly as the same text in one string', () => {
    let seed = 17;
    const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), (seed >>> 16) % n);
    const make = () => {
      const w = new Wrapper(el() as unknown as HTMLElement, 20, false);
      w.fit(37 * 7.5 + 3.75 + 0.25, 7.5);
      const x = w as unknown as { glyphs: Map<number, number>; joins: Set<number> };
      for (const [c, g] of [[0x200d, 0], [0x301, 0], [0xe9, 7.5], [0x4e2d, 15], [0x1f600, 15], [0x2028, 0]]) x.glyphs.set(c, g);
      x.joins.add(0x200d);
      x.joins.add(0x301);
      return w;
    };
    const pick = () => {
      const r = rnd(30);
      return r === 0 ? '\t' : r === 1 ? '\u200d' : r === 2 ? 'e\u0301' : r === 3 ? '中' : r === 4 ? '😀' : r === 5 ? '\u2028' : r === 6 ? 'é' : String.fromCharCode(32 + rnd(95));
    };
    let s = '';
    for (let n = 20_000; n > 0; n--) s += pick();
    let doc = Doc.of(s);
    for (let k = 0; k < 30; k++) {
      // Edits at code point boundaries, as the editor makes them.
      let at = rnd(doc.length);
      if ((doc.charCodeAt(at) & 0xfc00) === 0xdc00) at--;
      doc = doc.edit(at, at, pick() + pick());
      const flat = doc.toString();
      assert.equal(doc.flat, null);
      assert.deepEqual([...breaks(make(), doc as unknown as string, 0, doc.length)], [...breaks(make(), flat, 0, flat.length)], `edit ${k}`);
    }
  });
  test('a variation selector may start a row until a line holding it is measured, then joins', () => {
    const w = new Wrapper(el() as unknown as HTMLElement, 20, false);
    w.fit(10 * 8 + 4 + 0.25, 8);
    const x = w as unknown as { glyphs: Map<number, number>; ctx: unknown; font: string; learn(lines: string[]): void };
    x.glyphs.set(0x263a, 8);
    x.ctx = { font: '', measureText: () => ({ width: 8 }) };
    x.font = 'test';
    // Nine cells, the smiley's tenth, then U+FE0F's 2.5 cells don't fit.
    const s = 'aaaaaaaaa☺️bb';
    assert.deepEqual([...breaks(w, s, 0, s.length)], [0, 10]);
    assert.deepEqual([...breaks(w, s, 0, s.length)], [0, 10], 'read from the tables');
    x.learn([s]);
    // (Another line: rows of one seen before are reused.)
    const t = 'ccccccccc☺️dd';
    assert.deepEqual([...breaks(w, t, 0, t.length)], [0, 11]);
  });
});

test("a row's bidi context stops at a forced break, which would break the drawn row", () => {
  // The row after a line separator starts right after it: its context before is the text after the break.
  const t = 'name: עברית, note: a\u2028b, x: 1';
  const at = t.indexOf('b');
  assert.equal(bidiContext(t, 0, at, true), '');
  assert.equal(bidiContext(t, 0, at - 2, true), '<span class="ctx">name: עברית, note: </span>');
  // After a row: up to the next break.
  const u = 'x, y: שלום\u2029z';
  assert.equal(bidiContext(u, 0, u.length, false), '<span class="ctx">x, y: שלום</span>');
  for (const c of ['\v', '\f', '\u0085', '\u2028', '\u2029']) {
    assert.equal(bidiContext(`a${c}b`, 0, 3, true), '<span class="ctx">b</span>', JSON.stringify(c));
    assert.equal(bidiContext(`a${c}b`, 0, 3, false), '<span class="ctx">a</span>', JSON.stringify(c));
  }
  // Without one, the whole range (whole code points).
  assert.equal(bidiContext('ab😀', 0, 3, true), '<span class="ctx">ab</span>');
});

describe('binary text', () => {
  const el = () => ({ className: '', style: {}, setAttribute() {}, appendChild() {}, remove() {}, replaceChildren() {} });
  (globalThis as { document?: unknown }).document ??= { createElement: el };
  type X = Pick<Wrapper, 'rows' | 'rowStart' | 'rowAt' | 'odd' | 'fit'> & { ctx: unknown; font: string; glyphs: Map<number, number> };
  /** A wrapper whose canvas measures `width(c)` and counts its measurements; laying out lines in the DOM throws. */
  const make = (exact: boolean, width: (c: number) => number, cols = 40, cw = 8) => {
    const w = new Wrapper(el() as unknown as HTMLElement, 20, exact) as unknown as X;
    w.fit(cols * cw + cw / 2 + 0.25, cw);
    const seen: number[] = [];
    w.ctx = { font: '', measureText: (s: string) => (seen.push(s.codePointAt(0)!), { width: width(s.codePointAt(0)!) }) };
    w.font = 'test';
    (w as unknown as { measure(lines: string[]): number[] }).measure = () => {
      throw new Error('laid out in the DOM');
    };
    return { w, seen };
  };
  let seed = 9;
  // (32-bit arithmetic: every byte value comes up.)
  const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), (seed >>> 16) % n);
  /** Random bytes decoded as UTF-8 (as a binary file opened by mistake reads). */
  const binary = (bytes: number) => new TextDecoder().decode(Uint8Array.from({ length: bytes }, () => rnd(256)));
  const linesOf = (t: string) => {
    const A: number[] = [];
    const B: number[] = [];
    for (let a = 0; ; ) {
      const e = t.indexOf('\n', a);
      A.push(a);
      B.push(e < 0 ? t.length : e);
      if (e < 0) break;
      a = e + 1;
    }
    return [Int32Array.from(A), Int32Array.from(B)] as const;
  };

  test('views that draw their rows cut binary lines every few code units: no layout, no glyph measured', () => {
    const t = binary(200_000);
    const { w } = make(false, (c) => (c >= 0x1100 ? 16 : 8));
    const [A, B] = linesOf(t);
    // (A random line without a control character is text, laid out as such.)
    const laidOut: string[] = [];
    (w as unknown as { measure(lines: string[]): number[] }).measure = (lines) => (laidOut.push(...lines), lines.map(() => 1));
    const rows = w.rows(t, A, B);
    const per = 20;
    let cut = 0;
    for (let k = 0; k < A.length; k++) {
      if (w.odd[k] !== CUT) continue;
      cut++;
      // Rows of 20 code units (40 columns, two cells a glyph at most), after a forced break, never inside a pair.
      const s = t.slice(A[k], B[k]);
      const st = [0];
      for (let i = 0, n = 0; i < s.length; ) {
        const c = s.charCodeAt(i);
        const step = (c & 0xfc00) === 0xd800 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 2 : 1;
        if (n >= per) {
          st.push(i);
          n = 0;
        }
        n += step;
        i += step;
        if (/[\v\f\x85\u2028\u2029]/.test(String.fromCharCode(c)) && i < s.length) {
          st.push(i);
          n = 0;
        }
      }
      assert.deepEqual([...Array(rows[k]).keys()].map((r) => w.rowStart(t, A[k], B[k], r, CUT)), st, `line ${k}`);
      for (let r = 1; r < st.length; r++) assert.equal(w.rowAt(t, A[k], B[k], A[k] + st[r], CUT, st.length), r);
    }
    assert.ok(cut > A.length * 0.9, `most lines are binary (${cut} of ${A.length})`);
    assert.ok(laidOut.every((l) => !/[\0-\x08\x0e-\x1f\x7f-\x9f]/.test(l)), 'no binary line laid out');
  });

  test('a textarea editor still measures garbage exactly (its rows must match the textarea)', () => {
    const { w } = make(true, () => 8);
    const t = 'ab\u0000cd�' + 'x'.repeat(100);
    assert.throws(() => w.rows(t, Int32Array.of(0), Int32Array.of(t.length)), /laid out in the DOM/);
    assert.notEqual(w.odd[0], CUT);
  });

  test('text without garbage is laid out as before', () => {
    const { w } = make(false, () => 8);
    for (const s of ['"é ü 東京 🚀 עברית"'.repeat(8), '\t"tab\tmid"'.repeat(12)]) {
      assert.throws(() => w.rows(s, Int32Array.of(0), Int32Array.of(s.length)), /laid out in the DOM/, s.slice(0, 20));
      assert.equal(w.odd[0], 1);
    }
  });
});
