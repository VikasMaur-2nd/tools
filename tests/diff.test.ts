import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { formatPath } from '../lib/json/path';
import { align, canonNum, diff, numHash, parseIgnoreList, type Change, type DiffOptions, type DiffResult } from '../lib/diff/diff';
import { patchText, pointer, toPatch } from '../lib/diff/patch';
import { LineMap, MARK_ADDED, MARK_CHANGED, MARK_REMOVED, lineMarks } from '../lib/diff/lines';
import { cpuNow } from './timing';

// ── helpers ──────────────────────────────────────────────────────────────

type J = null | boolean | number | string | J[] | { [k: string]: J };

const root = (src: string): JNode => {
  const r = parse(src);
  assert.ok(r.root && !r.error, `parse failed: ${r.error?.m}`);
  return r.root;
};

const run = (a: string, b: string, o?: DiffOptions): DiffResult => diff(root(a), root(b), o);

/** `kind path` lines, e.g. `changed $.a[1]`. */
const lines = (r: DiffResult) => r.changes.map((c) => `${c.kind} ${formatPath(c.path)}`);

const isObj = (v: J | undefined): v is { [k: string]: J } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Minimal strict RFC 6902 (add / remove / replace) applier. */
function applyPatch(doc: J, ops: { op: string; path: string; value?: J }[]): J {
  let out: J = structuredClone(doc);
  for (const op of ops) {
    const segs = op.path === '' ? [] : op.path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!segs.length) {
      assert.notEqual(op.op, 'remove');
      out = op.value as J;
      continue;
    }
    let parent: J = out;
    for (const s of segs.slice(0, -1)) {
      const next: J | undefined = Array.isArray(parent) ? parent[Number(s)] : isObj(parent) ? parent[s] : undefined;
      assert.ok(next !== undefined, `bad pointer ${op.path}`);
      parent = next;
    }
    const last = segs[segs.length - 1];
    if (Array.isArray(parent)) {
      const i = last === '-' ? parent.length : Number(last);
      assert.ok(Number.isInteger(i) && i >= 0, `bad index in ${op.path}`);
      if (op.op === 'add') {
        assert.ok(i <= parent.length, `add out of range ${op.path}`);
        parent.splice(i, 0, op.value as J);
      } else {
        assert.ok(i < parent.length, `${op.op} out of range ${op.path}`);
        if (op.op === 'remove') parent.splice(i, 1);
        else parent[i] = op.value as J;
      }
    } else {
      assert.ok(isObj(parent), `not a container at ${op.path}`);
      if (op.op !== 'add') assert.ok(Object.hasOwn(parent, last), `missing member ${op.path}`);
      if (op.op === 'remove') delete parent[last];
      else parent[last] = op.value as J;
    }
  }
  return out;
}

/** diff(a, b) → patch text → JSON.parse → apply to a must give b. */
function assertPatchRoundTrip(a: string, b: string, o?: DiffOptions, canon = (v: J) => v) {
  const r = run(a, b, o);
  assert.equal(r.truncated, false);
  const ops = JSON.parse(patchText(toPatch(r.changes), '  ')) as { op: string; path: string; value?: J }[];
  const got = applyPatch(JSON.parse(a) as J, ops);
  assert.deepEqual(canon(got), canon(JSON.parse(b) as J), `patch mismatch\nA: ${a}\nB: ${b}\nP: ${JSON.stringify(ops)}`);
  return r;
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, chance: (p: number) => next() < p };
}
type Rng = ReturnType<typeof prng>;

const KEYS = ['a', 'b', 'c', 'id', 'name', 'x/y', 't~s', 'list', 'n'];

function genValue(rng: Rng, depth: number): J {
  const r = rng.int(depth > 3 ? 5 : 8);
  switch (r) {
    case 0:
      return null;
    case 1:
      return rng.chance(0.5);
    case 2:
      return rng.int(20) - 5;
    case 3:
      return rng.chance(0.5) ? rng.next() * 100 : rng.int(1e6);
    case 4:
      return 'v' + rng.int(12);
    case 5:
    case 6: {
      const out: J[] = [];
      const n = rng.int(7);
      for (let i = 0; i < n; i++) out.push(genValue(rng, depth + 1));
      return out;
    }
    default: {
      const out: { [k: string]: J } = {};
      const n = rng.int(6);
      for (let i = 0; i < n; i++) out[KEYS[rng.int(KEYS.length)]] = genValue(rng, depth + 1);
      return out;
    }
  }
}

/** Random edits: replace, insert, delete, nested edits, key add / remove. */
function mutate(rng: Rng, v: J, depth: number): J {
  if (rng.chance(0.08)) return genValue(rng, depth);
  if (Array.isArray(v)) {
    const out = v.map((x) => (rng.chance(0.3) ? mutate(rng, x, depth + 1) : structuredClone(x)));
    const edits = rng.int(4);
    for (let e = 0; e < edits; e++) {
      const op = rng.int(3);
      if (op === 0) out.splice(rng.int(out.length + 1), 0, genValue(rng, depth + 1));
      else if (op === 1 && out.length) out.splice(rng.int(out.length), 1);
      else if (out.length > 1) {
        const [x] = out.splice(rng.int(out.length), 1);
        out.splice(rng.int(out.length + 1), 0, x);
      }
    }
    return out;
  }
  if (isObj(v)) {
    const out: { [k: string]: J } = {};
    const keys = Object.keys(v);
    if (rng.chance(0.3)) keys.reverse();
    for (const k of keys) {
      if (rng.chance(0.15)) continue;
      out[k] = rng.chance(0.4) ? mutate(rng, v[k], depth + 1) : structuredClone(v[k]);
    }
    if (rng.chance(0.3)) out[KEYS[rng.int(KEYS.length)]] = genValue(rng, depth + 1);
    return out;
  }
  return rng.chance(0.5) ? genValue(rng, depth) : v;
}

/** Order-insensitive canonical form for multiset comparisons. */
function canonUnordered(v: J): J {
  if (Array.isArray(v)) {
    return v
      .map(canonUnordered)
      .map((x) => [JSON.stringify(x), x] as const)
      .sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0))
      .map((p) => p[1]);
  }
  if (isObj(v)) {
    const o: { [k: string]: J } = {};
    for (const k of Object.keys(v)) o[k] = canonUnordered(v[k]);
    return o;
  }
  return v;
}

// ── tests ────────────────────────────────────────────────────────────────

describe('diff: basics', () => {
  test('identical documents (any formatting) have no changes', () => {
    const a = '{"a":1,"b":[1,2,{"c":null}],"d":"x"}';
    const b = '{\n  "a": 1,\n  "b": [1, 2, { "c": null }],\n  "d": "x"\n}';
    const r = run(a, b);
    assert.deepEqual(r.changes, []);
    assert.deepEqual(r.summary, { added: 0, removed: 0, changed: 0, type: 0, total: 0 });
    assert.equal(r.error, null);
    assert.equal(run('[]', '[]').changes.length, 0);
    assert.equal(run('"s"', '"s"').changes.length, 0);
  });

  test('key order is ignored by default and reported when significant', () => {
    assert.deepEqual(lines(run('{"a":1,"b":2,"c":3}', '{"c":3,"b":2,"a":1}')), []);
    const r = run('{"a":1,"b":2}', '{"b":2,"a":1}', { ignoreKeyOrder: false });
    assert.equal(r.changes.length, 1);
    assert.equal(r.changes[0].order, true);
    assert.equal(r.changes[0].kind, 'changed');
    assert.deepEqual(toPatch(r.changes), []);
    // same order with an added key: no order change
    assert.deepEqual(lines(run('{"a":1,"b":2}', '{"a":1,"x":0,"b":2}', { ignoreKeyOrder: false })), ['added $.x']);
  });

  test('object keys added, removed and changed', () => {
    const r = run('{"a":1,"b":2,"c":{"d":true}}', '{"a":1,"c":{"d":false},"e":"new"}');
    assert.deepEqual(lines(r), ['removed $.b', 'changed $.c.d', 'added $.e']);
    assert.deepEqual(r.summary, { added: 1, removed: 1, changed: 1, type: 0, total: 3 });
    const added = r.changes[2];
    assert.equal(added.right?.v, 'new');
    assert.equal(added.leftParent?.t, 5);
  });

  test('nested changes report full paths', () => {
    const r = run('{"a":{"b":{"c":[1,{"d":"x","e y":1}]}}}', '{"a":{"b":{"c":[1,{"d":"y","e y":1}]}}}');
    assert.deepEqual(lines(r), ['changed $.a.b.c[1].d']);
    assert.equal(r.changes[0].left?.v, 'x');
    assert.equal(r.changes[0].right?.v, 'y');
    assert.deepEqual(lines(run('{"a":{"e y":1}}', '{"a":{"e y":2}}')), ['changed $.a["e y"]']);
  });

  test('type changes', () => {
    assert.deepEqual(lines(run('{"a":1}', '{"a":"1"}')), ['type $.a']);
    assert.deepEqual(lines(run('{"a":{}}', '{"a":[]}')), ['type $.a']);
    assert.deepEqual(lines(run('[null]', '[0]')), ['type $[0]']);
    assert.deepEqual(lines(run('{"a":true}', '{"a":"true"}')), ['type $.a']);
    const r = run('[1,2]', '{"0":1}');
    assert.deepEqual(lines(r), ['type $']);
    assert.equal(r.summary.type, 1);
    assert.deepEqual(toPatch(r.changes).map((o) => [o.op, o.path]), [['replace', '']]);
  });

  test('duplicate keys follow JSON.parse (last one wins)', () => {
    assert.deepEqual(lines(run('{"k":1,"k":2}', '{"k":3,"k":2}')), []);
    assert.deepEqual(lines(run('{"k":1,"k":2}', '{"k":2}')), []);
    assert.deepEqual(lines(run('{"k":1,"k":2}', '{"k":1}')), ['changed $.k']);
  });

  test('duplicate keys inside array elements: the last one wins there too (aligned by hash)', () => {
    for (const o of [{}, { ignoreArrayOrder: true }, { ignoreKeyOrder: false }]) {
      assert.deepEqual(lines(run('[{"a":1,"a":2}]', '[{"a":2,"a":1}]', o)), ['changed $[0].a'], JSON.stringify(o));
      assert.deepEqual(lines(run('{"x":[{"a":1,"a":2}]}', '{"x":[{"a":2,"a":1}]}', o)), ['changed $.x[0].a'], JSON.stringify(o));
      assert.deepEqual(lines(run('[0,{"a":1,"a":2},9]', '[0,{"a":2},9]', o)), [], JSON.stringify(o));
      assert.deepEqual(lines(run('[0,{"a":1,"a":2},9]', '[0,{"a":1},9]', o)), ['changed $[1].a'], JSON.stringify(o));
    }
    // (wide objects: the duplicate is found through the key hashes)
    const wide = (last: number) => '{' + Array.from({ length: 20 }, (_, i) => `"k${i}":${i}`).join(',') + `,"k3":${last}}`;
    assert.deepEqual(lines(run(`[${wide(3)}]`, `[${wide(4)}]`)), ['changed $[0].k3']);
    assert.deepEqual(lines(run(`[${wide(3)}]`, `[${wide(3)}]`)), []);
  });

  test('an empty array and an empty object never compare equal, in any mode', () => {
    for (const o of [{}, { ignoreArrayOrder: true }, { ignoreKeyOrder: false }, { ignoreArrayOrder: true, ignoreKeyOrder: false }]) {
      const k = JSON.stringify(o);
      assert.deepEqual(lines(run('[[]]', '[{}]', o)), ['type $[0]'], k);
      assert.deepEqual(lines(run('{"x":[{"v":[]}]}', '{"x":[{"v":{}}]}', o)), ['type $.x[0].v'], k);
      assertPatchRoundTrip('[[],{},1]', '[["é"],{},1]', o, o.ignoreArrayOrder ? canonUnordered : undefined);
      assertPatchRoundTrip('[{},[]]', '[[],[]]', o, o.ignoreArrayOrder ? canonUnordered : undefined);
    }
  });
});

describe('diff: numbers and strings', () => {
  test('numbers compare by exact decimal value', () => {
    assert.deepEqual(lines(run('[1.0, 1e2, -0, 0.10, 1E+3, 2.50e-1, 0]', '[1, 100, 0, 0.1, 1000, 0.25, 0.0]')), []);
    assert.deepEqual(lines(run('[1]', '[2]')), ['changed $[0]']);
    assert.deepEqual(lines(run('[0.1]', '[0.10000000000000001]')), ['changed $[0]']);
  });

  test('big integers never lose precision', () => {
    // equal as JS doubles, different as JSON numbers
    assert.equal(Number('12345678901234567890'), Number('12345678901234567891'));
    assert.deepEqual(lines(run('{"n":12345678901234567890}', '{"n":12345678901234567891}')), ['changed $.n']);
    assert.deepEqual(lines(run('{"n":12345678901234567890}', '{"n":12345678901234567890.000}')), []);
    assert.deepEqual(lines(run('{"n":12345678901234567890}', '{"n":1.234567890123456789e19}')), []);
  });

  test('canonNum', () => {
    assert.equal(canonNum('100'), '1e2');
    assert.equal(canonNum('1e2'), '1e2');
    assert.equal(canonNum('1.0'), '1');
    assert.equal(canonNum('-0.0'), '0');
    assert.equal(canonNum('0.5'), '5e-1');
    assert.equal(canonNum('-12.340e1'), '-1234e-1');
    assert.equal(canonNum('123'), '123');
  });

  test('numHash agrees with canonNum on equal and different values', () => {
    const rng = prng(11);
    const digits = (n: number) => {
      let s = String(1 + rng.int(9));
      for (let i = 1; i < n; i++) s += rng.int(10);
      return s.replace(/0+$/, '') || '1';
    };
    /** Renders D × 10^E in one of several equivalent JSON spellings. */
    const render = (neg: boolean, d: string, e: number): string => {
      let out: string;
      switch (rng.int(5)) {
        case 0:
          out = d + 'e' + e;
          break;
        case 1:
          out = d + '000E' + (e - 3);
          break;
        case 2:
          out = d.length > 1 ? d[0] + '.' + d.slice(1) + (e + d.length - 1 >= 0 ? 'e+' : 'e') + (e + d.length - 1) : d + '.0e' + e;
          break;
        default:
          if (e >= 0 && e < 12) out = d + '0'.repeat(e) + (rng.chance(0.5) ? '.00' : '');
          else if (e < 0 && -e < 15) out = -e >= d.length ? '0.' + '0'.repeat(-e - d.length) + d : d.slice(0, d.length + e) + '.' + d.slice(d.length + e) + '0';
          else out = d + 'e' + e;
      }
      return (neg ? '-' : '') + out;
    };
    for (let round = 0; round < 3000; round++) {
      const d = digits(1 + rng.int(25));
      const e = rng.int(40) - 20;
      const neg = rng.chance(0.3);
      const x = render(neg, d, e);
      const same = render(neg, d, e);
      const other = rng.chance(0.5) ? render(neg, d, e + 1) : render(!neg, d, e);
      assert.equal(canonNum(x), canonNum(same), `${x} vs ${same}`);
      assert.equal(numHash(x, 7), numHash(same, 7), `${x} vs ${same}`);
      assert.notEqual(canonNum(x), canonNum(other));
      assert.notEqual(numHash(x, 7), numHash(other, 7), `${x} vs ${other}`);
    }
    assert.equal(numHash('0', 1), numHash('-0.000e5', 1));
  });

  test('exponents beyond 32 and 53 bits are compared exactly', () => {
    const differ = [
      ['1', '1e4294967296'],
      ['1', '1e-4294967296'],
      ['25', '2.5e4294967297'],
      ['1e9007199254740992', '1e9007199254740993'],
      ['1e-9007199254740992', '1e-9007199254740993'],
      ['1e18446744073709551616', '1e0'],
      ['1e123456789012345678901234567890', '1e123456789012345678901234567891'],
      ['1e4294967296', '1e8589934592'],
    ];
    for (const [a, b] of differ) {
      assert.notEqual(canonNum(a), canonNum(b), `${a} vs ${b}`);
      assert.notEqual(numHash(a, 7), numHash(b, 7), `${a} vs ${b}`);
      assert.deepEqual(lines(run(`[${a}]`, `[${b}]`)), ['changed $[0]'], `${a} vs ${b}`);
      assert.deepEqual(lines(run(`{"x":[${a},true,{"v":${a}}]}`, `{"x":[${b},true,{"v":${b}}]}`, { ignoreArrayOrder: true })), ['changed $.x[0]', 'changed $.x[2].v']);
    }
    const same = [
      ['1e9007199254740993', '10e9007199254740992'],
      ['1e9007199254740993', '0.01e9007199254740995'],
      ['1e4294967296', '0.1e4294967297'],
      ['1e5', '1e00000000000000000000000005'],
      ['-2.5e-18446744073709551617', '-25e-18446744073709551618'],
      ['1e123456789012345678901234567890', '1000e123456789012345678901234567887'],
    ];
    for (const [a, b] of same) {
      assert.equal(canonNum(a), canonNum(b), `${a} vs ${b}`);
      assert.equal(numHash(a, 7), numHash(b, 7), `${a} vs ${b}`);
      assert.deepEqual(lines(run(`[${a}]`, `[${b}]`)), [], `${a} vs ${b}`);
    }
    assert.equal(canonNum('1e9007199254740993'), '1e9007199254740993');
    assert.equal(canonNum('-12.5e-123456789012345678901234567890'), '-125e-123456789012345678901234567891');
  });

  test('numHash is equal exactly when canonNum is (any exponent size)', () => {
    const rng = prng(23);
    // exponents near the 32- and 53-bit wrap points, and far beyond
    const bases = [0n, 1n << 31n, 1n << 32n, 1n << 52n, 1n << 53n, 1n << 64n, 10n ** 20n];
    const pick = () => {
      const b = bases[rng.int(bases.length)];
      const e = b + BigInt(rng.int(7) - 3);
      return rng.chance(0.5) ? e : -e;
    };
    /** D × 10^E in a random JSON spelling (mantissa shifted, padded with zeros, exponent zero-padded). */
    const render = (neg: boolean, d: string, e: bigint): string => {
      const z = rng.int(3);
      let m = d + '0'.repeat(z);
      let x = e - BigInt(z);
      const shift = rng.int(m.length + 2);
      if (shift && shift <= m.length) {
        m = m.slice(0, m.length - shift) + '.' + m.slice(m.length - shift);
        if (m[0] === '.') m = '0' + m;
        x += BigInt(shift);
      }
      let es = (x < 0n ? -x : x).toString();
      if (rng.chance(0.2)) es = '00' + es;
      const sign = x < 0n ? '-' : rng.chance(0.3) ? '+' : '';
      return (neg ? '-' : '') + m + (rng.chance(0.5) ? 'e' : 'E') + sign + es;
    };
    const pool: string[] = [];
    for (let k = 0; k < 400; k++) {
      const d = String(1 + rng.int(9)) + (rng.chance(0.5) ? String(rng.int(1000)).padStart(3, '0').replace(/0+$/, '') : '');
      const e = pick();
      const neg = rng.chance(0.3);
      for (const x of [e, e, e + 1n, e + (1n << 32n), e - (1n << 32n)]) {
        const s = render(neg, d, x);
        // the exact canonical form, worked out with big integers
        assert.equal(canonNum(s), (neg ? '-' : '') + d + (x ? 'e' + x : ''), s);
        pool.push(s);
      }
    }
    for (let i = 0; i < pool.length; i++) {
      const ci = canonNum(pool[i]);
      const hi = numHash(pool[i], 5);
      for (let j = i + 1; j < pool.length; j++) {
        assert.equal(ci === canonNum(pool[j]), hi === numHash(pool[j], 5), `${pool[i]} vs ${pool[j]}`);
      }
    }
  });

  test('case-insensitive strings', () => {
    assert.deepEqual(lines(run('{"s":"Hello"}', '{"s":"hELLO"}', { caseInsensitiveStrings: true })), []);
    assert.deepEqual(lines(run('{"s":"Hello"}', '{"s":"hELLO"}')), ['changed $.s']);
    // case-insensitive ids still align
    assert.deepEqual(lines(run('[{"id":"A","v":1},{"id":"B","v":2}]', '[{"id":"b","v":2},{"id":"a","v":1}]', { caseInsensitiveStrings: true, ignoreArrayOrder: true })), []);
  });
});

describe('diff: arrays', () => {
  test('an insertion in the middle is one addition (LCS)', () => {
    const a = Array.from({ length: 20 }, (_, i) => i);
    const b = [...a.slice(0, 10), 99, ...a.slice(10)];
    const r = run(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(lines(r), ['added $[10]']);
    assert.equal(r.changes[0].right?.v, '99');

    const objs = Array.from({ length: 12 }, (_, i) => ({ v: i, tag: 't' + i }));
    const objs2 = [...objs.slice(0, 3), { v: 100, tag: 'new' }, ...objs.slice(3, 7), ...objs.slice(8)];
    assert.deepEqual(lines(run(JSON.stringify(objs), JSON.stringify(objs2))), ['added $[3]', 'removed $[7]']);
  });

  test('in-place edits pair up as changes instead of remove + add', () => {
    assert.deepEqual(lines(run('[1,2,3]', '[1,5,3]')), ['changed $[1]']);
    assert.deepEqual(lines(run('[{"a":1,"b":2},{"a":3,"b":4}]', '[{"a":1,"b":20},{"a":3,"b":4}]')), ['changed $[0].b']);
    // unequal gap: the similar element is paired, the other one is removed
    assert.deepEqual(
      lines(run('[{"a":1,"b":2,"c":3},{"x":1},9]', '[{"a":1,"b":2,"c":4},9]')),
      ['changed $[0].c', 'removed $[1]'],
    );
  });

  test('arrays of objects are matched by id-like keys', () => {
    const a = '[{"id":1,"v":"a"},{"id":2,"v":"b"},{"id":3,"v":"c"}]';
    const b = '[{"id":2,"v":"B"},{"id":3,"v":"c"},{"id":4,"v":"d"}]';
    assert.deepEqual(lines(run(a, b)), ['removed $[0]', 'changed $[1].v', 'added $[2]']);
    for (const key of ['_id', 'uuid', 'key', 'name']) {
      const x = `[{"${key}":"p","n":1},{"${key}":"q","n":2},{"${key}":"r","n":3}]`;
      const y = `[{"${key}":"q","n":2},{"${key}":"r","n":30}]`;
      assert.deepEqual(lines(run(x, y)), ['removed $[0]', 'changed $[2].n'], key);
    }
    // moved record: ordered compare reports remove + add, unordered sees only the field change
    const m1 = '[{"id":1,"v":1},{"id":2,"v":2},{"id":3,"v":3}]';
    const m2 = '[{"id":3,"v":3},{"id":1,"v":1},{"id":2,"v":20}]';
    assert.deepEqual(lines(run(m1, m2)), ['added $[0]', 'changed $[1].v', 'removed $[2]']);
    assert.deepEqual(lines(run(m1, m2, { ignoreArrayOrder: true })), ['changed $[1].v']);
  });

  test('ignoreArrayOrder compares arrays as multisets', () => {
    assert.deepEqual(lines(run('[1,2,3]', '[3,1,2]', { ignoreArrayOrder: true })), []);
    assert.deepEqual(lines(run('[[1,2],[3]]', '[[3],[2,1]]', { ignoreArrayOrder: true })), []);
    assert.deepEqual(lines(run('[{"a":1},{"b":2}]', '[{"b":2},{"a":1}]', { ignoreArrayOrder: true })), []);
    assert.deepEqual(lines(run('[1,1,2]', '[1,2,2]', { ignoreArrayOrder: true })), ['changed $[1]']);
    assert.deepEqual(lines(run('[1,2,3]', '[3,2]', { ignoreArrayOrder: true })), ['removed $[0]']);
    assert.deepEqual(lines(run('[1,2]', '[2,1,7]', { ignoreArrayOrder: true })), ['added $[2]']);
    assert.notDeepEqual(lines(run('[1,2,3]', '[3,1,2]')), []);
  });

  test('long arrays with scattered edits stay minimal', () => {
    const rng = prng(7);
    const a = Array.from({ length: 10000 }, (_, i) => ({ k: i, s: 'item ' + i }));
    const b = a.slice();
    const removed = [9000, 5000, 120];
    for (const i of removed) b.splice(i, 1);
    b.splice(4000, 0, { k: -1, s: 'new' });
    b[7000] = { k: b[7000].k, s: 'edited' };
    const t0 = cpuNow();
    const r = assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b));
    const ms = cpuNow() - t0;
    assert.equal(r.summary.removed, 3);
    assert.equal(r.summary.added, 1);
    assert.equal(r.summary.changed, 1);
    assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms of CPU time`);
    void rng;
  });

  test('large runs of edited elements stay aligned around an insertion or a removal', () => {
    for (const n of [50, 70, 200, 3000]) {
      const a = Array.from({ length: n }, (_, i) => ({ k: 'r' + i, y: i }));
      // every record edited (an updatedAt), one inserted at 10
      const b: J[] = a.map((o) => ({ ...o, y: o.y + 1 }));
      b.splice(10, 0, { k: 'new', y: 0 });
      const r = assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b));
      assert.deepEqual(r.summary, { added: 1, removed: 0, changed: n, type: 0, total: n + 1 }, `${n}`);
      assert.deepEqual(lines(r).slice(9, 12), ['changed $[9].y', 'added $[10]', 'changed $[10].y'], `${n}`);
      assert.ok(lines(r).every((l) => l === 'added $[10]' || /^changed \$\[\d+\]\.y$/.test(l)), `${n}`);
      // one removed at 10 and one appended: runs of equal length, not edits in place
      const c: J[] = a.map((o) => ({ ...o, y: o.y + 1 }));
      c.splice(10, 1);
      c.push({ k: 'new', y: 0 });
      const q = assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(c));
      assert.deepEqual(q.summary, { added: 1, removed: 1, changed: n - 1, type: 0, total: n + 1 }, `${n}`);
      assert.deepEqual(lines(q).slice(9, 12), ['changed $[9].y', 'removed $[10]', 'changed $[11].y'], `${n}`);
      // arrays as elements: their items anchor them
      const x = Array.from({ length: n }, (_, i) => [i, 'x' + i, 2 * i]);
      const z: J[] = x.map((t) => [t[0], t[1], (t[2] as number) + 1]);
      z.splice(10, 0, [-1, 'new', 0]);
      const t = assertPatchRoundTrip(JSON.stringify(x), JSON.stringify(z));
      assert.deepEqual(t.summary, { added: 1, removed: 0, changed: n, type: 0, total: n + 1 }, `${n} arrays`);
    }
    // nothing in common between the edited elements: in place
    assert.deepEqual(lines(run('[{"y":1},{"y":2},{"y":3}]', '[{"y":5},{"y":6},{"y":7}]')), ['changed $[0].y', 'changed $[1].y', 'changed $[2].y']);
    // ignoreArrayOrder: shuffled and every record edited, paired by what they still share
    const rng = prng(5);
    const a = Array.from({ length: 500 }, (_, i) => ({ k: 'r' + i, y: i }));
    const b = a.map((o) => ({ ...o, y: o.y + 1 }));
    for (let i = b.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [b[i], b[j]] = [b[j], b[i]];
    }
    const u = assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b), { ignoreArrayOrder: true }, canonUnordered);
    assert.deepEqual(u.summary, { added: 0, removed: 0, changed: 500, type: 0, total: 500 });
  });

  test('anchoring large runs stays fast', () => {
    const n = 50000;
    const a = JSON.stringify(Array.from({ length: n }, (_, i) => ({ title: 'User ' + i, email: `u${i}@x.io`, score: i % 100, updatedAt: 1000 + i })));
    const list = Array.from({ length: n }, (_, i) => ({ title: 'User ' + i, email: `u${i}@x.io`, score: i % 100, updatedAt: 5e6 + i }));
    const same = JSON.stringify(list);
    list.splice(10, 0, { title: 'new', email: '', score: 0, updatedAt: 1 });
    const b = JSON.stringify(list);
    const ra = root(a);
    for (const [label, rb, changes] of [['in place', root(same), n], ['insertion', root(b), n + 1]] as const) {
      const t0 = cpuNow();
      const r = diff(ra, rb);
      const ms = cpuNow() - t0;
      assert.equal(r.summary.total, changes, label);
      assert.ok(ms < 4000, `${label}: ${ms.toFixed(0)} ms of CPU time`);
    }
  });

  test('worst cases fall back without quadratic blowups', () => {
    const rng = prng(42);
    const n = 20000;
    const a = Array.from({ length: n }, (_, i) => i);
    const b = a.slice();
    for (let i = n - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [b[i], b[j]] = [b[j], b[i]];
    }
    let t0 = cpuNow();
    assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b));
    const shuffle = cpuNow() - t0;
    assert.ok(shuffle < 4000, `shuffle took ${shuffle.toFixed(0)} ms of CPU time`);
    t0 = cpuNow();
    const r = run(JSON.stringify(a), JSON.stringify(b), { ignoreArrayOrder: true });
    assert.equal(r.changes.length, 0);
    assert.ok(cpuNow() - t0 < 2000);
    // completely disjoint arrays
    t0 = cpuNow();
    assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(a.map((x) => x + n)));
    assert.ok(cpuNow() - t0 < 4000);
  });

  test('align() produces a valid edit script', () => {
    const rng = prng(3);
    for (let round = 0; round < 300; round++) {
      const a = Int32Array.from({ length: rng.int(40) }, () => rng.int(6));
      const b = Int32Array.from({ length: rng.int(40) }, () => rng.int(6));
      for (const budget of [1e7, 50]) {
        const ea: number[] = [];
        const eb: number[] = [];
        align(a, b, ea, eb, budget);
        const ia: number[] = [];
        const ib: number[] = [];
        for (let x = 0; x < ea.length; x++) {
          if (ea[x] >= 0) ia.push(ea[x]);
          if (eb[x] >= 0) ib.push(eb[x]);
          if (ea[x] >= 0 && eb[x] >= 0) assert.equal(a[ea[x]], b[eb[x]]);
        }
        assert.deepEqual(ia, Array.from(a, (_, i) => i));
        assert.deepEqual(ib, Array.from(b, (_, i) => i));
      }
    }
  });
});

describe('diff: ignore paths', () => {
  const a = '{"meta":{"updatedAt":"2024","v":1},"items":[{"id":1,"ts":1,"x":1},{"id":2,"ts":2,"x":2}],"deep":{"updatedAt":5}}';
  const b = '{"meta":{"updatedAt":"2025","v":1},"items":[{"id":1,"ts":9,"x":1},{"id":2,"ts":8,"x":3}],"deep":{"updatedAt":6}}';

  test('absolute, anywhere and wildcard patterns', () => {
    assert.deepEqual(lines(run(a, b)), ['changed $.meta.updatedAt', 'changed $.items[0].ts', 'changed $.items[1].ts', 'changed $.items[1].x', 'changed $.deep.updatedAt']);
    assert.deepEqual(lines(run(a, b, { ignorePaths: ['$.meta.updatedAt'] })), ['changed $.items[0].ts', 'changed $.items[1].ts', 'changed $.items[1].x', 'changed $.deep.updatedAt']);
    assert.deepEqual(lines(run(a, b, { ignorePaths: ['updatedAt', '$.items[*].ts'] })), ['changed $.items[1].x']);
    assert.deepEqual(lines(run(a, b, { ignorePaths: ['ts', '$..updatedAt', '/items/1/x'] })), []);
    assert.deepEqual(lines(run(a, b, { ignorePaths: ['$.items', '$.meta', 'deep'] })), []);
  });

  test('ignored fields do not disturb array alignment', () => {
    const x = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ v: i, at: i })));
    const y = JSON.stringify([{ v: -1, at: 0 }, ...Array.from({ length: 30 }, (_, i) => ({ v: i, at: i * 7 }))]);
    assert.deepEqual(lines(run(x, y, { ignorePaths: ['at'] })), ['added $[0]']);
  });

  test('an ignored id-like field never decides which elements pair up', () => {
    const x = '[{"id":1,"v":"a"},{"id":5,"v":"b"}]';
    const y = '[{"id":2,"v":"a"},{"id":5,"v":"b"}]';
    assert.deepEqual(lines(run(x, y)), ['removed $[0]', 'added $[0]']);
    for (const ignore of ['id', '$[*].id', '..id', '/0/id', '$[0].id']) {
      for (const o of [{}, { ignoreArrayOrder: true }]) {
        const r = assertPatchRoundTrip(x, y, { ...o, ignorePaths: [ignore] }, () => null);
        assert.deepEqual(lines(r), [], `${ignore} ${JSON.stringify(o)}`);
      }
    }
    // the next id-like key still pairs them
    const p = '[{"id":1,"name":"a","v":1},{"id":2,"name":"b","v":2}]';
    const q = '[{"id":7,"name":"x","v":0},{"id":8,"name":"a","v":1},{"id":9,"name":"b","v":20}]';
    assert.deepEqual(lines(run(p, q, { ignorePaths: ['id'] })), ['added $[0]', 'changed $[1].v']);
    // ignored deeper down only: still an id here
    assert.deepEqual(lines(run('{"a":[{"id":1,"v":1}],"b":[{"id":1}]}', '{"a":[{"id":2,"v":1}],"b":[{"id":2}]}', { ignorePaths: ['$.b[*].id'] })), ['changed $.a[0].id']);
  });

  test('parseIgnoreList splits on commas / newlines outside brackets and quotes', () => {
    assert.deepEqual(parseIgnoreList(' $.a.b, updatedAt\n$["x, y"] ; $.items[*].ts ,, '), ['$.a.b', 'updatedAt', '$["x, y"]', '$.items[*].ts']);
    assert.deepEqual(lines(run('{"x, y":1,"z":1}', '{"x, y":2,"z":1}', { ignorePaths: parseIgnoreList('$["x, y"]') })), []);
  });
});

describe('diff: JSON Patch', () => {
  test('pointer escaping', () => {
    assert.equal(pointer([]), '');
    assert.equal(pointer(['a/b', 'm~n', 0, '']), '/a~1b/m~0n/0/');
    const r = assertPatchRoundTrip('{"a/b":{"m~n":1}}', '{"a/b":{"m~n":2}}');
    assert.equal(toPatch(r.changes)[0].path, '/a~1b/m~0n');
  });

  test('patch values are lossless', () => {
    const r = run('{"n":1}', '{"n":12345678901234567890123}');
    assert.equal(patchText(toPatch(r.changes), ''), '[{"op":"replace","path":"/n","value":12345678901234567890123}]');
  });

  test('applying the patch reproduces the right document', () => {
    const cases: [string, string][] = [
      ['{"a":1}', '{"a":1}'],
      ['[1,2,3]', '[0,1,2,3,4]'],
      ['[1,2,3,4,5]', '[2,4]'],
      ['[[1,2],[3,4]]', '[[1],[3,4,5],[6]]'],
      ['{"a":[{"id":1,"x":[1,2]},{"id":2}]}', '{"a":[{"id":0},{"id":2,"y":1},{"id":1,"x":[2,3]}]}'],
      ['{"a":{"b":[1,{"c":2}]}}', '{"a":{"b":[{"c":3},1]}}'],
      ['1', '[1]'],
    ];
    for (const [a, b] of cases) assertPatchRoundTrip(a, b);
  });

  test('fuzz: patch round trip (ordered and unordered)', () => {
    const rng = prng(20241013);
    for (let round = 0; round < 400; round++) {
      const a = genValue(rng, 0);
      const b = mutate(rng, a, 0);
      const sa = JSON.stringify(a, null, rng.chance(0.5) ? 2 : undefined);
      const sb = JSON.stringify(b);
      assertPatchRoundTrip(sa, sb);
      assertPatchRoundTrip(sa, sb, { ignoreArrayOrder: true }, canonUnordered);
    }
  });

  test('fuzz: id-keyed record arrays', () => {
    const rng = prng(99);
    for (let round = 0; round < 100; round++) {
      const a = Array.from({ length: rng.int(30) }, (_, i) => ({ id: i, v: rng.int(5), tags: ['x', rng.int(3)] }));
      const b: J[] = structuredClone(a);
      for (let e = rng.int(6); e > 0; e--) {
        const op = rng.int(4);
        if (op === 0) b.splice(rng.int(b.length + 1), 0, { id: 1000 + round * 10 + e, v: 0, tags: [] });
        else if (op === 1 && b.length) b.splice(rng.int(b.length), 1);
        else if (op === 2 && b.length) {
          const i = rng.int(b.length);
          b[i] = { ...(b[i] as { [k: string]: J }), v: 99 };
        } else if (b.length > 1) {
          const [x] = b.splice(rng.int(b.length), 1);
          b.splice(rng.int(b.length + 1), 0, x);
        }
      }
      assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b));
      assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b), { ignoreArrayOrder: true }, canonUnordered);
    }
  });
});

describe('diff: limits and line mapping', () => {
  test('deep nesting', () => {
    let depth = 0;
    for (const d of [2500, 2000, 1500, 1000, 600]) {
      const src = '['.repeat(d) + '1' + ']'.repeat(d);
      if (parse(src).root) {
        depth = d;
        break;
      }
    }
    assert.ok(depth > 0);
    const r = run('['.repeat(depth) + '1' + ']'.repeat(depth), '['.repeat(depth) + '2' + ']'.repeat(depth));
    assert.equal(r.error, null);
    assert.equal(r.changes.length, 1);
    assert.equal(r.changes[0].path.length, depth);
    let o1 = '1';
    let o2 = '1';
    for (let i = 0; i < depth / 2; i++) {
      o1 = `{"k":${o1}}`;
      o2 = `{"k":${o2},"z":0}`;
    }
    assert.equal(run(o1, o2).changes.length, depth / 2);
  });

  test('maxChanges truncates', () => {
    const a = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ v: i })));
    const b = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ v: -i - 1 })));
    const r = run(a, b, { maxChanges: 10 });
    assert.equal(r.truncated, true);
    assert.equal(r.changes.length, 10);
  });

  test('LineMap and change line ranges', () => {
    const left = '{\n  "a": 1,\n  "b": {\n    "c": 2\n  },\n  "d": 3\n}';
    const right = '{\n  "a": 1,\n  "d": 4,\n  "e": [\n    1\n  ]\n}';
    const r = run(left, right);
    assert.deepEqual(lines(r), ['removed $.b', 'changed $.d', 'added $.e']);
    const lm = new LineMap(left);
    const rm = new LineMap(right);
    assert.equal(lm.count, 7);
    assert.equal(lm.line(0), 1);
    assert.equal(lm.line(left.indexOf('"c"')), 4);
    assert.equal(lm.col(left.indexOf('"c"')), 5);
    assert.equal(lm.offset(2), 2);
    assert.deepEqual(lm.range(r.changes[0].left!), [3, 5]);
    assert.equal(r.changes[0].right, undefined);
    assert.deepEqual(rm.range(r.changes[2].right!), [4, 6]);
    assert.deepEqual(Array.from(lineMarks(r.changes, 'left', lm)), [0, 0, MARK_REMOVED, MARK_REMOVED, MARK_REMOVED, MARK_CHANGED, 0]);
    assert.deepEqual(Array.from(lineMarks(r.changes, 'right', rm)), [0, 0, MARK_CHANGED, MARK_ADDED, MARK_ADDED, MARK_ADDED, 0]);
    // jump targets (as Compare reveals them): the node itself, or the container an addition belongs in
    const leftAt = (c: Change) => (c.left ?? c.leftParent)?.s;
    assert.equal(leftAt(r.changes[0]), left.indexOf('{', 1));
    assert.equal(leftAt(r.changes[2]), 0);
  });
});
