import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARR, BOOL, NUL, NUM, OBJ, STR, kids, parse, type JNode } from '../lib/json/parser';
import { stringify } from '../lib/json/format';
import { Shape, hllCount, pathText, MAX_KEYS, K_NULL, K_FALSE, K_TRUE, K_NUM, K_STR, K_ARR, K_OBJ, type ShapeReport } from '../lib/huge/stream/shape';
import { rng } from './oracle/compare';
import { enc } from './huge-oracle';
import { docOf, normal, walkAll } from './huge-stream-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

interface Want {
  n: number;
  kinds: number[];
  first: number[];
  present: number;
  missAt: number;
  parentObjs: number;
  nmin: number;
  nmax: number;
  smin: number;
  smax: number;
  amin: number;
  amax: number;
  omin: number;
  omax: number;
  vals: Set<string>;
  lastInst: number;
}

/** The same statistics, from the normal parser's tree (the oracle). */
function oracle(root: JNode, byteOf: (s: number) => number): Map<string, Want> {
  const m = new Map<string, Want>();
  const objs = new Map<string, JNode[]>();
  const get = (path: string): Want => {
    let w = m.get(path);
    if (!w) m.set(path, (w = { n: 0, kinds: [0, 0, 0, 0, 0, 0, 0], first: [-1, -1, -1, -1, -1, -1, -1], present: 0, missAt: -1, parentObjs: 0, nmin: Infinity, nmax: -Infinity, smin: Infinity, smax: -1, amin: Infinity, amax: -1, omin: Infinity, omax: -1, vals: new Set(), lastInst: -1 }));
    return w;
  };
  const seg = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '[' + JSON.stringify(k) + ']');
  const walk = (n: JNode, path: string) => {
    const w = get(path);
    w.n++;
    const k = n.t === NUL ? K_NULL : n.t === BOOL ? (n.v ? K_TRUE : K_FALSE) : n.t === NUM ? K_NUM : n.t === STR ? K_STR : n.t === ARR ? K_ARR : K_OBJ;
    w.kinds[k]++;
    const at = n.u === null && n.s < 0 ? -1 : byteOf(n.s);
    if (w.first[k] < 0) w.first[k] = at;
    if (n.t === NUM) {
      const v = Number(n.v);
      w.nmin = Math.min(w.nmin, v);
      w.nmax = Math.max(w.nmax, v);
    }
    if (n.t === STR) {
      w.smin = Math.min(w.smin, (n.v as string).length);
      w.smax = Math.max(w.smax, (n.v as string).length);
    }
    if (n.t < ARR) w.vals.add(n.t + ':' + stringify(n, ''));
    if (n.t === ARR) {
      w.amin = Math.min(w.amin, kids(n).length);
      w.amax = Math.max(w.amax, kids(n).length);
      for (const c of kids(n)) walk(c, path + '[*]');
    }
    if (n.t === OBJ) {
      w.omin = Math.min(w.omin, kids(n).length);
      w.omax = Math.max(w.omax, kids(n).length);
      (objs.get(path) ?? objs.set(path, []).get(path)!).push(n);
      const seen = new Set<string>();
      for (const c of kids(n)) {
        const cp = path + seg(c.key as string);
        if (!seen.has(cp)) {
          seen.add(cp);
          get(cp).present++;
        }
        walk(c, cp);
      }
    }
  };
  walk(root, '$');
  // Members: where the first object at the parent path lacking each starts.
  for (const [path, list] of objs) {
    for (const [cp, w] of m) {
      if (!cp.startsWith(path) || cp === path) continue;
      const rest = cp.slice(path.length);
      // (Only direct members.)
      const direct = /^(\.[A-Za-z_$][\w$]*|\["(?:[^"\\]|\\.)*"\])$/.test(rest);
      if (!direct) continue;
      w.parentObjs = list.length;
      const key = rest[0] === '.' ? rest.slice(1) : (JSON.parse(rest.slice(1, -1)) as string);
      const lack = list.find((o) => !kids(o).some((c) => c.key === key));
      w.missAt = lack ? byteOf(lack.s) : -1;
    }
  }
  return m;
}

function shapeOf(bytes: Uint8Array, multi: boolean, max = 64): ShapeReport {
  const r = rng(bytes.length);
  const s = new Shape();
  walkAll(r, bytes, s, multi, max);
  return s.report(bytes.length, bytes.length, true);
}

test('shape: every path’s counts, kinds, presence, first places and ranges are the normal tree’s', () => {
  const r = rng(SEED + 11);
  let checked = 0;
  for (let n = 0; n < 300 * SCALE; n++) {
    const { doc, name } = docOf(r);
    const bytes = enc.encode(doc);
    const nm = normal(bytes, name);
    if (!nm) continue;
    const multi = nm.res.multi || /\.jsonl$/.test(name);
    // (Parsed as stored, line ends and all, so a node's text offset maps to its byte.)
    const text = new TextDecoder().decode(bytes);
    const byteOf = (s: number) => enc.encode(text.slice(0, s)).length;
    const want = oracle(parse(text, { lines: /\.jsonl$/.test(name) }).root!, byteOf);
    const got = shapeOf(bytes, multi, r.pick([1, 7, 64, 4096]));
    const where = `\ndoc ${show(doc)}`;
    const paths = new Map(got.paths.map((p) => [pathText(got, p), p]));
    assert.equal(paths.size, want.size, `paths: ${[...paths.keys()]} vs ${[...want.keys()]}${where}`);
    for (const [path, w] of want) {
      const p = paths.get(path);
      assert.ok(p, `missing ${path}${where}`);
      const at = `${path}${where}`;
      assert.equal(p.n, w.n, `n ${at}`);
      assert.deepEqual(p.kinds, w.kinds, `kinds ${at}`);
      // (The list of several values has no place of its own.)
      if (path !== '$' || !multi) assert.deepEqual(p.first, w.first, `first ${at}`);
      if (p.parent >= 0 && !p.item) {
        assert.equal(p.present, w.present, `present ${at}`);
        assert.equal(p.missAt, w.missAt, `missAt ${at}`);
      }
      if (w.kinds[K_NUM]) {
        // (0 and -0 tie: either may be shown.)
        assert.ok(p.num!.min === w.nmin, `nmin ${p.num!.min} vs ${w.nmin} ${at}`);
        assert.ok(p.num!.max === w.nmax, `nmax ${p.num!.max} vs ${w.nmax} ${at}`);
      }
      if (w.kinds[K_STR]) {
        assert.equal(p.str!.min, w.smin, `smin ${at}`);
        assert.equal(p.str!.max, w.smax, `smax ${at}`);
      }
      if (w.kinds[K_ARR]) assert.deepEqual([p.arr!.min, p.arr!.max], [w.amin, w.amax], `arr ${at}`);
      if (w.kinds[K_OBJ]) assert.deepEqual([p.obj!.min, p.obj!.max], [w.omin, w.omax], `obj ${at}`);
      // Distinct values: exact while few (raw text, so `"A"` and `"A"` are two).
      if (p.exact) assert.ok(p.distinct >= w.vals.size, `distinct ${p.distinct} vs ${w.vals.size} ${at}`);
    }
    if (got.records !== (nm.res.root!.t === ARR ? kids(nm.res.root!).length : 0)) assert.fail(`records ${got.records}${where}`);
    checked++;
  }
  assert.ok(checked > 150 * SCALE, `checked ${checked}`);
});

test('shape: distinct counts are exact up to 64 values, then estimated within a few percent', () => {
  for (const count of [10, 64, 65, 1000, 50_000, 400_000]) {
    const parts = ['['];
    for (let i = 0; i < count * 2; i++) parts.push((i ? ',' : '') + `{"k":${i % count},"s":"v${i % count}"}`);
    parts.push(']');
    const got = shapeOf(enc.encode(parts.join('')), false, 1 << 20);
    for (const key of ['$[*].k', '$[*].s']) {
      const p = got.paths.find((q) => pathText(got, q) === key)!;
      if (count <= 64) {
        assert.equal(p.distinct, count, key);
        assert.ok(p.exact);
        assert.equal(p.top![0][1], 2, 'each value twice');
      } else {
        const err = Math.abs(p.distinct - count) / count;
        assert.ok(err < 0.08, `${key}: ${p.distinct} for ${count} (${(err * 100).toFixed(1)}%)`);
        assert.equal(p.exact, false);
      }
    }
  }
  // An empty register set counts nothing.
  assert.equal(hllCount(new Uint8Array(2048)), 0);
});

test('shape: a map’s many names merge into one path; presence, formats and examples', () => {
  const recs: string[] = [];
  for (let i = 0; i < 2000; i++) recs.push(`"user${i}": {"email": ${i % 4 ? `"u${i}@example.com"` : 'null'}, "at": "2024-01-0${1 + (i % 9)}T10:00:00Z"${i % 10 ? '' : ', "vip": true'}}`);
  const got = shapeOf(enc.encode('{' + recs.join(',') + '}'), false, 1 << 16);
  const byPath = new Map(got.paths.map((p) => [pathText(got, p), p]));
  const root = byPath.get('$')!;
  assert.ok(root.manyKeys);
  const other = byPath.get('$.*')!;
  assert.equal(other.n, 2000 - MAX_KEYS);
  // The members of the merged values are paths below it.
  const email = byPath.get('$.*.email')!;
  assert.equal(email.kinds[K_NULL], (2000 - MAX_KEYS) / 4);
  assert.equal(email.str!.formats[1], email.kinds[K_STR], 'emails');
  const at = byPath.get('$.*.at')!;
  assert.equal(at.str!.formats[0], at.n, 'dates');
  const vip = byPath.get('$.*.vip')!;
  assert.equal(vip.present, (2000 - MAX_KEYS) / 10);
  assert.ok(vip.missAt > 0);
  assert.ok(email.examples.length > 0 && email.examples.length <= 5);
});

test('shape: memory stays bounded on a document with ever new paths', () => {
  const parts = ['['];
  for (let i = 0; i < 20_000; i++) parts.push((i ? ',' : '') + `{"a${i}": {"b${i}": [${i}]}}`);
  parts.push(']');
  const got = shapeOf(enc.encode(parts.join('')), false, 1 << 16);
  assert.ok(got.paths.length <= 5000);
  assert.ok(got.dropped > 0 || got.paths.some((p) => p.manyKeys));
});
