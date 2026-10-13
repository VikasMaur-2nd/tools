import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { stringify } from '../lib/json/format';
import {
  buildRows,
  canonLines,
  diffLines,
  pairLines,
  similarity,
  tokenize,
  wordDiff,
  ROW_ADD,
  ROW_DEL,
  ROW_EQ,
  ROW_GAP,
  ROW_MOD,
  type LineDiff,
} from '../lib/diff/text';

const root = (src: string): JNode => {
  const r = parse(src);
  assert.ok(r.root && !r.error, `parse failed: ${r.error?.m}`);
  return r.root;
};

/** Asserts the hunks are a valid edit script of a → b and returns the edited line count. */
function check(a: readonly string[], b: readonly string[], d: LineDiff): number {
  let i = 0;
  let j = 0;
  let add = 0;
  let del = 0;
  const eq = (n: number) => {
    for (let k = 0; k < n; k++) assert.equal(a[i + k], b[j + k], `line ${i + k} / ${j + k} should be equal`);
  };
  for (const h of d.hunks) {
    assert.ok(h.a0 >= i && h.b0 >= j && h.a1 >= h.a0 && h.b1 >= h.b0 && (h.a1 > h.a0 || h.b1 > h.b0), 'hunks are ordered and non-empty');
    assert.equal(h.a0 - i, h.b0 - j, 'equal runs have the same length');
    eq(h.a0 - i);
    del += h.a1 - h.a0;
    add += h.b1 - h.b0;
    i = h.a1;
    j = h.b1;
  }
  assert.equal(a.length - i, b.length - j);
  eq(a.length - i);
  assert.equal(d.added, add);
  assert.equal(d.removed, del);
  return add + del;
}

const run = (a: string[], b: string[]) => {
  const d = diffLines(a, b);
  check(a, b, d);
  return d;
};

/** Mulberry32. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('textdiff: canonical lines', () => {
  const docs = [
    '{"b": 1, "a": [1, 2.50, {"z": null, "y": true}], "c": {}, "d": [], "e": "x\\ny \\"q\\""}',
    '[]',
    '"just a string"',
    '[[[]], [{}], {"k": [1e400, -0, 12345678901234567890]}]',
    '{"dup": 1, "dup": 2, "10": "ten", "2": "two"}',
  ];

  test('match stringify(root, "  ", sortKeys) line by line', () => {
    for (const src of docs) {
      const r = root(src);
      for (const sort of [false, true]) {
        assert.deepEqual(canonLines(r, sort).lines, stringify(r, '  ', sort).split('\n'), `${src} (sortKeys ${sort})`);
      }
    }
  });

  test('every line maps to its node in the source text', () => {
    const src = '{\n "a": [1, {"b": null}],\n "c": "x"\n}';
    const { lines, offs } = canonLines(root(src));
    assert.deepEqual(lines, ['{', '  "a": [', '    1,', '    {', '      "b": null', '    }', '  ],', '  "c": "x"', '}']);
    assert.equal(offs.length, lines.length);
    const at = (k: number) => src.slice(offs[k], offs[k] + 4);
    assert.equal(offs[0], 0);
    assert.equal(src[offs[1]], '[');
    assert.equal(src[offs[2]], '1');
    assert.equal(src[offs[3]], '{');
    assert.equal(at(4), 'null');
    assert.equal(src[offs[5]], '}');
    assert.equal(src[offs[6]], ']');
    assert.equal(at(7), '"x"\n');
    assert.equal(offs[8], src.length - 1);
  });
});

describe('textdiff: line diff', () => {
  test('identical, empty and one-sided inputs', () => {
    assert.equal(run(['a', 'b'], ['a', 'b']).hunks.length, 0);
    assert.equal(run([], []).hunks.length, 0);
    assert.deepEqual(run([], ['a', 'b']).hunks, [{ a0: 0, a1: 0, b0: 0, b1: 2 }]);
    assert.deepEqual(run(['a', 'b'], []).hunks, [{ a0: 0, a1: 2, b0: 0, b1: 0 }]);
  });

  test('insertions, removals and replacements are minimal on simple inputs', () => {
    assert.deepEqual(run(['a', 'b', 'c'], ['a', 'x', 'b', 'c']).hunks, [{ a0: 1, a1: 1, b0: 1, b1: 2 }]);
    assert.deepEqual(run(['a', 'b', 'c'], ['a', 'c']).hunks, [{ a0: 1, a1: 2, b0: 1, b1: 1 }]);
    assert.deepEqual(run(['a', 'b', 'c'], ['a', 'B', 'c']).hunks, [{ a0: 1, a1: 2, b0: 1, b1: 2 }]);
    const d = run(['x', 'a', 'y', 'b', 'z'], ['a', 'q', 'b']);
    assert.equal(d.removed, 3);
    assert.equal(d.added, 1);
  });

  test('repeated lines (no unique anchors) still diff minimally', () => {
    const a = ['}', '}', '{', '}', '{', '{'];
    const b = ['}', '{', '}', '{', '}', '{'];
    const d = run(a, b);
    assert.equal(d.added + d.removed, 2);
  });

  test('an inserted array element shows as one whole element', () => {
    const a = stringify(root('[{"id": 1}, {"id": 3}]'), '  ').split('\n');
    const b = stringify(root('[{"id": 1}, {"id": 2}, {"id": 3}]'), '  ').split('\n');
    const d = run(a, b);
    assert.equal(d.hunks.length, 1);
    const h = d.hunks[0];
    assert.equal(h.a1 - h.a0, 0);
    assert.deepEqual(b.slice(h.b0, h.b1), ['  {', '    "id": 2', '  },']);
  });

  test('an inserted property block starts at its key', () => {
    const a = stringify(root('{"a": {"x": 1}, "c": 3}'), '  ').split('\n');
    const b = stringify(root('{"a": {"x": 1}, "b": {"x": 1}, "c": 3}'), '  ').split('\n');
    const d = run(a, b);
    assert.equal(d.hunks.length, 1);
    const h = d.hunks[0];
    assert.deepEqual(b.slice(h.b0, h.b1), ['  "b": {', '    "x": 1', '  },']);
  });

  test('random edits always produce a valid script', () => {
    const r = rng(7);
    for (let t = 0; t < 300; t++) {
      const alpha = 2 + Math.floor(r() * 12);
      const a = Array.from({ length: Math.floor(r() * 40) }, () => String(Math.floor(r() * alpha)));
      const b = a.slice();
      for (let e = Math.floor(r() * 8); e > 0; e--) {
        const p = Math.floor(r() * (b.length + 1));
        if (r() < 0.5 && b.length) b.splice(p, 1);
        else b.splice(p, 0, String(Math.floor(r() * alpha)));
      }
      run(a, b);
    }
  });

  test('a tiny budget falls back gracefully (valid, not exact)', () => {
    const a = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
    const b = a.map((_, i) => a[i ^ 1]); // swapped pairs: two-sided gaps everywhere
    const d = diffLines(a, b, 1000);
    check(a, b, d);
    assert.equal(d.exact, false);
  });

  test('large gaps of repeated lines stay near-minimal (windowed Myers)', () => {
    const r = rng(5);
    const a = Array.from({ length: 20000 }, () => `    ${Math.floor(r() * 3)},`);
    const b = a.slice();
    for (let k = 0; k < 300; k++) b[Math.floor(r() * b.length)] = '    9,';
    b.splice(5000, 0, '    7,', '    7,');
    const d = run(a, b);
    assert.ok(d.removed <= 300 && d.added <= 302, `${d.removed} / ${d.added}`);
  });

  test('stays fast on ~50k-line documents', () => {
    const r = rng(11);
    const items = Array.from({ length: 6000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], v: Math.floor(r() * 100) }));
    const a = JSON.stringify(items, null, 2).split('\n');
    for (let k = 0; k < 300; k++) items[Math.floor(r() * items.length)].v = -1;
    items.splice(3000, 0, { id: -1, name: 'new', tags: [], v: 0 });
    items.splice(100, 5);
    const b = JSON.stringify(items, null, 2).split('\n');
    assert.ok(a.length > 50000);
    let t = performance.now();
    const d = diffLines(a, b);
    const scattered = performance.now() - t;
    check(a, b, d);
    assert.ok(d.exact);
    assert.ok(d.removed < 500 && d.added < 500, `small diff (${d.removed} / ${d.added})`);

    // nothing in common, and unique lines in reverse order (patience's worst case)
    const c = a.map((s) => s + ' ');
    t = performance.now();
    check(a, c, diffLines(a, c));
    check(a, a.slice().reverse(), diffLines(a, a.slice().reverse()));
    const worst = performance.now() - t;
    assert.ok(scattered < 400 && worst < 1500, `scattered ${scattered.toFixed(0)} ms, worst cases ${worst.toFixed(0)} ms`);
  });
});

describe('textdiff: word emphasis', () => {
  const pick = (s: string, r: number[]) => {
    const out: string[] = [];
    for (let k = 0; k < r.length; k += 2) out.push(s.slice(r[k], r[k + 1]));
    return out;
  };

  test('tokenizer keeps numbers, words and escapes whole', () => {
    const s = '  "na_me": -12.5e3, "a\\"b"';
    const b = tokenize(s);
    const toks = b.slice(0, -1).map((p, k) => s.slice(p, b[k + 1]));
    assert.deepEqual(toks, ['  ', '"', 'na_me', '"', ':', ' ', '-12.5e3', ',', ' ', '"', 'a', '\\"', 'b', '"']);
  });

  test('only the changed tokens are emphasized', () => {
    const x = '    "name": "Alice",';
    const y = '    "name": "Bob",';
    const [rx, ry] = wordDiff(x, y);
    assert.deepEqual(pick(x, rx), ['Alice']);
    assert.deepEqual(pick(y, ry), ['Bob']);

    const [nx, ny] = wordDiff('  "n": 1.5', '  "n": 1.75,');
    assert.deepEqual(pick('  "n": 1.5', nx), ['1.5']);
    assert.deepEqual(pick('  "n": 1.75,', ny), ['1.75,']);

    const [cx, cy] = wordDiff('  "a": 1', '  "a": 1,');
    assert.deepEqual(cx, []);
    assert.deepEqual(pick('  "a": 1,', cy), [',']);
  });

  test('changes separated only by whitespace merge', () => {
    const [rx, ry] = wordDiff('"hello big world"', '"goodbye big moon"');
    assert.deepEqual(pick('"hello big world"', rx), ['hello', 'world']);
    assert.deepEqual(pick('"goodbye big moon"', ry), ['goodbye', 'moon']);
    const [sx] = wordDiff('"hello world"', '"goodbye moon"');
    assert.deepEqual(pick('"hello world"', sx), ['hello world']);
  });

  test('very long lines use prefix / suffix emphasis', () => {
    const x = '"' + 'a'.repeat(5000) + 'X' + 'b'.repeat(10) + '"';
    const y = '"' + 'a'.repeat(5000) + 'YY' + 'b'.repeat(10) + '"';
    const [rx, ry] = wordDiff(x, y);
    assert.deepEqual(pick(x, rx), ['X']);
    assert.deepEqual(pick(y, ry), ['YY']);
  });

  test('modified lines pair with their edits, not with unrelated lines', () => {
    assert.ok(similarity('    "name": "Alice",', '    "name": "Bob",') >= 0.5);
    assert.ok(similarity('    "name": "a",', '    "name": "a much longer value",') >= 0.5);
    assert.ok(similarity('  },', '    "x": 1,') < 0.5);
    const a = ['  "a": 1,', '  "b": "old",', '  "c": 3'];
    const b = ['  "a": 1,', '  {', '  "b": "new",', '  "c": 3'];
    const d = run(a, b);
    const { pa, pb } = pairLines(a, b, d.hunks);
    assert.equal(pa[1], 2);
    assert.equal(pb[2], 1);
    assert.equal(pb[1], -1);
  });
});

describe('textdiff: rows', () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const b = a.slice();
  b[10] = 'L10';
  const d = diffLines(a, b);
  const pairs = pairLines(a, b, d.hunks);

  test('unchanged runs collapse around 3 lines of context', () => {
    const rows = buildRows(d, a.length, b.length, pairs, new Set(), false);
    assert.deepEqual(
      rows.map((r) => (r.k === ROW_GAP ? `gap ${r.a}+${r.n}` : `${r.k} ${r.a} ${r.b}`)),
      ['gap 0+7', `${ROW_EQ} 7 7`, `${ROW_EQ} 8 8`, `${ROW_EQ} 9 9`, `${ROW_DEL} 10 -1`, `${ROW_ADD} -1 10`, `${ROW_EQ} 11 11`, `${ROW_EQ} 12 12`, `${ROW_EQ} 13 13`, 'gap 14+6'],
    );
    const open = buildRows(d, a.length, b.length, pairs, new Set([0, 14]), false);
    assert.equal(open.length, 21);
    assert.ok(open.every((r) => r.k !== ROW_GAP));
  });

  test('short runs stay expanded', () => {
    const x = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const y = x.slice();
    y[4] = 'E';
    const dd = diffLines(x, y);
    const rows = buildRows(dd, x.length, y.length, pairLines(x, y, dd.hunks), new Set(), false);
    assert.equal(rows.length, 9);
  });

  test('side by side aligns paired lines and fills the rest', () => {
    const x = ['{', '  "a": 1,', '  "b": 2', '}'];
    const y = ['{', '  "a": 5,', '  "n": [', '  ],', '  "b": 2', '}'];
    const dd = diffLines(x, y);
    const rows = buildRows(dd, x.length, y.length, pairLines(x, y, dd.hunks), new Set(), true);
    const mods = rows.filter((r) => r.k === ROW_MOD).map((r) => [r.a, r.b]);
    assert.deepEqual(mods, [
      [1, 1],
      [-1, 2],
      [-1, 3],
    ]);
    const filler = rows.find((r) => r.k === ROW_MOD && r.a < 0);
    assert.ok(filler && filler.ja >= 0 && filler.ja < x.length);
  });
});
