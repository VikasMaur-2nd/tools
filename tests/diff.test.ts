import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { formatPath } from '../lib/json/path';
import { align, canonNum, diff, leftOffset, numHash, parseIgnoreList, type DiffOptions, type DiffResult } from '../lib/diff/diff';
import { patchText, pointer, toPatch } from '../lib/diff/patch';
import { LineMap, MARK_ADDED, MARK_CHANGED, MARK_REMOVED, changeLines, lineMarks } from '../lib/diff/lines';

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

  test('numeric tolerance and case-insensitive strings', () => {
    assert.deepEqual(lines(run('[1.0001, 5]', '[1, 5.0004]', { numericTolerance: 0.001 })), []);
    assert.deepEqual(lines(run('[1.1]', '[1]', { numericTolerance: 0.001 })), ['changed $[0]']);
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
    const t0 = Date.now();
    const r = assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b));
    const ms = Date.now() - t0;
    assert.equal(r.summary.removed, 3);
    assert.equal(r.summary.added, 1);
    assert.equal(r.summary.changed, 1);
    assert.ok(ms < 3000, `took ${ms} ms`);
    void rng;
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
    let t0 = Date.now();
    assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(b));
    assert.ok(Date.now() - t0 < 4000, `shuffle took ${Date.now() - t0} ms`);
    t0 = Date.now();
    const r = run(JSON.stringify(a), JSON.stringify(b), { ignoreArrayOrder: true });
    assert.equal(r.changes.length, 0);
    assert.ok(Date.now() - t0 < 2000);
    // completely disjoint arrays
    t0 = Date.now();
    assertPatchRoundTrip(JSON.stringify(a), JSON.stringify(a.map((x) => x + n)));
    assert.ok(Date.now() - t0 < 4000);
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
    assert.deepEqual(changeLines(r.changes[0], 'left', lm), [3, 5]);
    assert.equal(changeLines(r.changes[0], 'right', rm), null);
    assert.deepEqual(changeLines(r.changes[2], 'right', rm), [4, 6]);
    assert.deepEqual(Array.from(lineMarks(r.changes, 'left', lm)), [0, 0, MARK_REMOVED, MARK_REMOVED, MARK_REMOVED, MARK_CHANGED, 0]);
    assert.deepEqual(Array.from(lineMarks(r.changes, 'right', rm)), [0, 0, MARK_CHANGED, MARK_ADDED, MARK_ADDED, MARK_ADDED, 0]);
    // jump targets: the node itself, or the container an addition belongs in
    assert.equal(leftOffset(r.changes[0]), left.indexOf('{', 1));
    assert.equal(leftOffset(r.changes[2]), 0);
  });
});
