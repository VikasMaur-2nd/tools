import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARR, JNode, MAX_DEPTH, NO_VALUE, NUM, OBJ, STR, kids, parse, type ParseResult } from '../lib/json/parser';
import { MAX_INDENT, MAX_TEXT, byteLength, formatDoc, preview, primText, stringify, toValue, tooLarge } from '../lib/json/format';
import { formatPath, nodeAt, parsePath, pathOf, resolve, type Seg } from '../lib/json/path';
import { cpuNow } from './timing';

// ── helpers ──────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) so every failure is reproducible from its seed. */
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
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof prng>;

// FUZZ_SEED=<n> / FUZZ_SCALE=<x> (env) re-run the fuzzers with another seed / more cases.
const SEED_OVERRIDE = Number(process.env.FUZZ_SEED) || 0;
const SCALE = Number(process.env.FUZZ_SCALE) || 1;
const seedOf = (s: number) => SEED_OVERRIDE || s;
const casesOf = (n: number) => Math.round(n * SCALE);
/** FUZZ_DUMP=<file> writes the failing input there (exact bytes, for debugging). */
const dump = (src: string) => process.env.FUZZ_DUMP && writeFileSync(process.env.FUZZ_DUMP, src);

/**
 * V8 13.x (Node 24) JSON.parse bug: an escaped key is compared against the expected (transition)
 * key using its *raw* source text, so once a key containing a backslash has been parsed, later keys
 * with escapes can be misread (`"\\n"` as "\\" after "\\"; `"\\\\_"` as "\\\\" after "\\\\").
 * The oracle (JSON.parse) must never see a key containing a backslash, or later comparisons lie.
 */
const POISON = /(?:\\\\|\\u005[cC])(?:[^"\\]|\\.)*"\s*:/;

const strictOk = (r: ParseResult) => r.root !== null && !r.error && r.issues.length === 0;

const nativeParse = (s: string): { ok: true; v: unknown } | { ok: false } => {
  try {
    return { ok: true, v: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
};

const lineCol = (src: string, p: number) => {
  const before = src.slice(0, p);
  const line = before.split('\n').length;
  return { line, col: p - before.lastIndexOf('\n') };
};

/** Unambiguous, copy-pasteable rendering of a test input (non-ASCII escaped). */
const show = (s: string) => {
  const j = JSON.stringify(s.length > 600 ? s.slice(0, 600) : s).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s.length > 600 ? `${j}… (${s.length} chars)` : j;
};

function* walk(n: JNode): Generator<JNode> {
  yield n;
  if (n.t >= ARR) for (const c of kids(n)) yield* walk(c);
}

/** Structural invariants every tree must satisfy (nodeAt's binary search relies on ordering). */
function checkTree(r: ParseResult, src: string) {
  const root = r.root as JNode;
  let count = 0;
  let depth = 0;
  for (const n of walk(root)) {
    count++;
    if (n.d > depth) depth = n.d;
    assert.ok(n.s >= 0 && n.s <= n.e && n.e <= src.length, `node range ${n.s}..${n.e} out of bounds`);
    if (n.t === NUM) assert.equal(typeof n.v, 'string');
    if (n.t < ARR) continue;
    const list = kids(n);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      assert.equal(c.u, n);
      assert.equal(c.d, n.d + 1);
      assert.ok(c.s >= n.s && c.e <= n.e, `child ${c.s}..${c.e} outside parent ${n.s}..${n.e}`);
      if (i) assert.ok(list[i - 1].e <= c.s, 'children overlap / out of order');
      if (n.t === ARR) assert.equal(c.key, i);
      else assert.equal(typeof c.key, 'string');
    }
  }
  assert.equal(r.nodes, count, 'node count');
  assert.equal(r.depth, depth, 'depth');
}

// ── random valid JSON generator ──────────────────────────────────────────

const WS = [' ', '\t', '\n', '\r', '\r\n', '  '];
const SIMPLE_ESC: [string, string][] = [
  ['\\"', '"'],
  ['\\\\', '\\'],
  ['\\/', '/'],
  ['\\b', '\b'],
  ['\\f', '\f'],
  ['\\n', '\n'],
  ['\\r', '\r'],
  ['\\t', '\t'],
];
const SPECIAL_NUMS = [
  '0', '-0', '0.0', '1.0', '1e5', '1E5', '1e+5', '1e-5', '0.000001', '0.0000001', '1e-7', '5e-324',
  '1.7976931348623157e308', '1e400', '-1e400', '123456789012345', '1234567890123456', '9007199254740993',
  '12345678901234567890123', '0.1', '0.30000000000000004', '3.14159265358979323846264338327950288',
  '100', '-100', '1e21', '1e20', '0e0', '-0.0e-0',
];
const KEY_POOL = ['a', 'b', 'id', 'name', '', ' ', 'x y', 'a.b', 'a]b', 'a"b', '\u00e9', '__proto__', '02', '1.5', '-1', '1e3'];
const INT_KEYS = ['0', '2', '10', '4294967294'];

const hex4 = (r: Rng, v: number) => {
  const h = v.toString(16).padStart(4, '0');
  return r.chance(0.5) ? h : h.toUpperCase();
};
const digits = (r: Rng, len: number, nonZeroFirst = false) => {
  let s = nonZeroFirst ? String(1 + r.int(9)) : '';
  while (s.length < len) s += String(r.int(10));
  return s;
};

interface Doc {
  src: string;
  /** What `stringify(root, '')` must produce: raw number text, canonically escaped strings. */
  min: string;
}

function genNumber(r: Rng): string {
  if (r.chance(0.1)) return r.pick(SPECIAL_NUMS);
  const big = r.chance(0.15);
  let s = r.chance(0.3) ? '-' : '';
  s += r.chance(0.25) ? '0' : digits(r, 1 + r.int(big ? 25 : 6), true);
  if (r.chance(0.35)) s += '.' + digits(r, 1 + r.int(big ? 20 : 5));
  if (r.chance(0.15)) s += r.pick(['e', 'E']) + r.pick(['', '+', '-']) + digits(r, 1 + r.int(3));
  return s;
}

function genString(r: Rng, maxLen = 10): { src: string; val: string } {
  let src = '';
  let val = '';
  const len = r.chance(0.1) ? r.int(40) : r.int(maxLen);
  for (let k = 0; k < len; k++) {
    const kind = r.int(24);
    if (kind < 10) {
      let c = 32 + r.int(95);
      if (c === 34 || c === 92) c = 97;
      src += String.fromCharCode(c);
      val += String.fromCharCode(c);
    } else if (kind < 13) {
      const [e, v] = r.pick(SIMPLE_ESC);
      src += e;
      val += v;
    } else if (kind < 15) {
      const v = r.chance(0.5) ? r.int(0x20) : r.int(0x10000);
      src += '\\u' + hex4(r, v);
      val += String.fromCharCode(v);
    } else if (kind < 16) {
      const cp = 0x10000 + r.int(0x100000);
      const hi = 0xd800 + ((cp - 0x10000) >> 10);
      const lo = 0xdc00 + ((cp - 0x10000) & 0x3ff);
      src += '\\u' + hex4(r, hi) + '\\u' + hex4(r, lo);
      val += String.fromCharCode(hi, lo);
    } else if (kind < 19) {
      const c = r.pick([0x7f, 0x80, 0x9f, 0xa0, 0xe9, 0x2028, 0x2029, 0xfeff, 0x201c, 0x4e2d, 0xfffd, 0x3000, 0x2018]);
      src += String.fromCharCode(c);
      val += String.fromCharCode(c);
    } else if (kind < 21) {
      const ch = String.fromCodePoint(0x1f600 + r.int(80));
      src += ch;
      val += ch;
    } else if (kind < 22) {
      // lone surrogates are legal in JSON text (raw or escaped)
      const c = r.chance(0.5) ? 0xd800 + r.int(0x400) : 0xdc00 + r.int(0x400);
      const raw = r.chance(0.5);
      src += raw ? String.fromCharCode(c) : '\\u' + hex4(r, c);
      val += String.fromCharCode(c);
    } else {
      const c = 0x100 + r.int(0xd700);
      src += String.fromCharCode(c);
      val += String.fromCharCode(c);
    }
  }
  return { src: '"' + src + '"', val };
}

function genValue(r: Rng, depth: number, maxDepth: number): Doc {
  const ws = () => (r.chance(0.7) ? '' : r.pick(WS) + (r.chance(0.2) ? r.pick(WS) : ''));
  const k = depth >= maxDepth ? r.int(5) : r.int(9);
  switch (k) {
    case 0:
      return { src: 'null', min: 'null' };
    case 1:
      return r.chance(0.5) ? { src: 'true', min: 'true' } : { src: 'false', min: 'false' };
    case 2: {
      const s = genNumber(r);
      return { src: s, min: s };
    }
    case 3:
    case 4: {
      const s = genString(r);
      return { src: s.src, min: JSON.stringify(s.val) };
    }
    case 5:
    case 6: {
      const n = r.int(r.chance(0.1) ? 20 : 5);
      const src: string[] = [];
      const min: string[] = [];
      for (let j = 0; j < n; j++) {
        const v = genValue(r, depth + 1, maxDepth);
        src.push(ws() + v.src + ws());
        min.push(v.min);
      }
      return { src: '[' + (n ? src.join(',') : ws()) + ']', min: '[' + min.join(',') + ']' };
    }
    default: {
      const n = r.int(r.chance(0.1) ? 24 : 5);
      const src: string[] = [];
      const min: string[] = [];
      for (let j = 0; j < n; j++) {
        let key: { src: string; val: string };
        const kk = r.int(10);
        if (kk < 2) {
          const v = r.pick(KEY_POOL);
          key = { src: JSON.stringify(v), val: v };
        } else if (kk < 3) {
          const v = r.pick(INT_KEYS);
          key = { src: JSON.stringify(v), val: v };
        } else if (kk < 4) {
          key = { src: '"k' + r.int(4) + '"', val: '' };
          key.val = key.src.slice(1, -1);
        } else key = genString(r, 6);
        const v = genValue(r, depth + 1, maxDepth);
        src.push(ws() + key.src + ws() + ':' + ws() + v.src + ws());
        min.push(JSON.stringify(key.val) + ':' + v.min);
      }
      return { src: '{' + (n ? src.join(',') : ws()) + '}', min: '{' + min.join(',') + '}' };
    }
  }
}

function genDoc(r: Rng): Doc {
  const v = genValue(r, 0, 1 + r.int(6));
  const lead = r.chance(0.3) ? r.pick(WS) : '';
  const trail = r.chance(0.3) ? r.pick(WS) : '';
  return { src: lead + v.src + trail, min: v.min };
}

// ── mutations ────────────────────────────────────────────────────────────

const ALPHABET = [
  '{', '}', '[', ']', ',', ':', '"', "'", '`', '\\', '/', '*', '#', ';', '(', ')', ' ', '\n', '\r', '\t',
  '0', '1', '9', '-', '+', '.', 'e', 'E', 'x', 'a', 't', 'f', 'n', 'u', 'l', 'N', 'I', 'T', '_', '$', '\u00e9',
  '\u0000', '\u0001', '\u001f', '\u000b', '\u000c', '\u007f', '\u00a0', '\ufeff', '\u2028', '\u2029', '\u3000',
  '\u201c', '\u201d', '\u2018', '\u2019', '\ud800', '\udc00', '\ud83d\ude00',
  'true', 'null', '//', '/*', '*/', '```', 'NaN', 'None', '0x1F', 'f(', '\\u', '\\u12', '1e', '-.', '\r\n',
];

function mutate(r: Rng, s: string): string {
  const ops = 1 + r.int(3);
  for (let k = 0; k < ops; k++) {
    const p = r.int(s.length + 1);
    switch (r.int(7)) {
      case 0:
        s = s.slice(0, p) + s.slice(p + 1);
        break;
      case 1:
      case 2:
        s = s.slice(0, p) + r.pick(ALPHABET) + s.slice(p);
        break;
      case 3:
        s = s.slice(0, p) + r.pick(ALPHABET) + s.slice(p + 1);
        break;
      case 4:
        s = s.slice(0, p);
        break;
      case 5: {
        const q = p + r.int(8);
        s = s.slice(0, p) + s.slice(p, q) + s.slice(p);
        break;
      }
      default: {
        const q = p + 1 + r.int(6);
        s = s.slice(0, p) + s.slice(q);
      }
    }
  }
  return s;
}

/** Checks everything that must hold for an arbitrary (possibly broken) input. */
function checkAny(src: string): ParseResult {
  const r = parse(src);
  const native = POISON.test(src) ? null : nativeParse(src); // null: oracle unusable, see POISON
  if (native?.ok) {
    assert.ok(strictOk(r), `JSON.parse accepts but parser reports ${JSON.stringify(r.error ?? r.issues[0] ?? 'no root')}`);
    assert.deepEqual(JSON.parse(stringify(r.root as JNode, '')), native.v);
  } else if (native) {
    assert.ok(!strictOk(r), 'JSON.parse rejects but parser reports strictly valid');
  }
  if (r.error) assert.equal(r.root, null);
  if (r.exact && native) {
    assert.ok(native.ok, 'exact=true for a document JSON.parse rejects');
    assert.equal(formatDoc(src, r, '  '), stringify(r.root as JNode, '  '));
  }
  for (const x of [...r.issues, ...r.warnings, ...(r.error ? [r.error] : [])]) {
    assert.ok(x.p >= 0 && x.p <= src.length, `issue position ${x.p} out of range`);
    assert.ok(x.m.length > 0);
  }
  if (r.root) {
    checkTree(r, src);
    // The repaired document must be valid JSON and a fixpoint of parse → stringify.
    const fixed = stringify(r.root, '');
    const pretty = stringify(r.root, '\t', true);
    if (!POISON.test(fixed)) {
      assert.ok(nativeParse(fixed).ok, `repaired output is not valid JSON: ${show(fixed)}`);
      assert.ok(nativeParse(pretty).ok, `sorted/pretty output is not valid JSON: ${show(pretty)}`);
    }
    const again = parse(fixed);
    assert.ok(strictOk(again), `repaired output re-parses with issues: ${show(fixed)}`);
    assert.equal(stringify(again.root as JNode, ''), fixed, 'repair is not a fixpoint');
    if (!POISON.test(fixed)) assert.equal(formatDoc(fixed, again, ''), fixed, 'native fast path disagrees');
    for (let k = 0; k <= src.length; k += 1 + (src.length >> 4)) nodeAt(r.root, k, src);
  }
  return r;
}

const fuzz = (name: string, seed: number, iterations: number, gen: (r: Rng) => string, check: (src: string) => void) =>
  test(`${name} (seed ${seedOf(seed)}, ${casesOf(iterations)} cases)`, () => {
    seed = seedOf(seed);
    const r = prng(seed);
    for (let it = 0, total = casesOf(iterations); it < total; it++) {
      const src = gen(r);
      try {
        check(src);
      } catch (e) {
        dump(src);
        throw new Error(`${name}: iteration ${it} (seed ${seed}) failed: ${(e as Error).message}\ninput: ${show(src)}`, { cause: e });
      }
    }
  });

// ── 1. strict verdict agreement with JSON.parse ──────────────────────────

describe('fuzz: random valid documents', () => {
  let exactSeen = 0;
  let inexactSeen = 0;
  const SEED = seedOf(0x5eed1);
  test(`valid documents (seed ${SEED}, ${casesOf(6000)} cases)`, () => {
    const r = prng(SEED);
    for (let it = 0, total = casesOf(6000); it < total; it++) {
      const doc = genDoc(r);
      const src = doc.src;
      if (POISON.test(src)) continue;
      try {
        const res = parse(src);
        assert.equal(res.error, null);
        assert.deepEqual(res.issues, []);
        assert.ok(res.root);
        checkTree(res, src);
        const want = JSON.parse(src);
        const min = stringify(res.root, '');
        // lossless: numbers keep their source text; strings are re-escaped canonically
        assert.equal(min, doc.min);
        assert.deepEqual(JSON.parse(min), want);
        assert.deepEqual(JSON.parse(stringify(res.root, '  ', true)), want);
        // every node's source range re-parses to the node's own value; a caret inside a leaf finds it
        for (const n of walk(res.root)) {
          assert.deepEqual(JSON.parse(src.slice(n.s, n.e)), JSON.parse(stringify(n, '')));
          if (n.t < ARR) assert.ok(nodeAt(res.root, n.s, src) === n && nodeAt(res.root, n.e - 1, src) === n, `nodeAt ${n.s}`);
        }
        if (res.warnings.length === 0) {
          for (const n of walk(res.root)) {
            const segs = pathOf(n);
            assert.equal(resolve(res.root, segs), n);
            assert.deepEqual(parsePath(formatPath(segs)), segs, `path round trip ${show(formatPath(segs))} -> ${JSON.stringify(parsePath(formatPath(segs)))}`);
          }
        }
        if (res.exact) {
          exactSeen++;
          const native2 = JSON.stringify(want, null, 2);
          assert.equal(stringify(res.root, '  '), native2);
          assert.equal(stringify(res.root, ''), JSON.stringify(want));
          assert.equal(formatDoc(src, res, '  '), native2);
        } else {
          inexactSeen++;
          assert.equal(formatDoc(src, res, '  '), stringify(res.root, '  '));
        }
        assert.equal(formatDoc(src, res, '\t', true), stringify(res.root, '\t', true));
      } catch (e) {
        dump(src);
        throw new Error(`iteration ${it} (seed ${SEED}) failed: ${(e as Error).message}\ninput: ${show(src)}`, { cause: e });
      }
    }
    // make sure both branches were actually exercised
    assert.ok(exactSeen > casesOf(500), `exact docs: ${exactSeen}`);
    assert.ok(inexactSeen > casesOf(500), `inexact docs: ${inexactSeen}`);
  });
});

describe('fuzz: mutated documents', () => {
  fuzz('mutations of valid documents', 0xbadc0de, 25000, (r) => mutate(r, genDoc(r).src), checkAny);
  fuzz(
    'random token soup',
    42,
    15000,
    (r) => {
      let src = '';
      for (let k = r.int(14); k > 0; k--) src += r.pick(ALPHABET);
      return src;
    },
    checkAny,
  );
  test('a document with no value is an error at its end, as in JSON.parse (an editor shows a blank one as empty)', () => {
    for (const s of ['', ' ', '\n\t\r ', '\ufeff', '\u00a0', '// only a comment', '/* a */ /* b */']) {
      for (const r of [parse(s), parse(s, { lines: true }), parse(s, { repair: true })]) {
        assert.equal(r.root, null);
        assert.deepEqual(r.error, { p: s.length, m: NO_VALUE });
        assert.equal(r.exact, false);
        assert.equal(r.multi, false);
      }
    }
  });
  test('BOM is reported, like JSON.parse rejecting it', () => {
    const r = parse('\ufeff{"a":1}');
    assert.ok(!strictOk(r));
    assert.match(r.issues[0].m, /byte order mark/);
    assert.deepEqual(toValue(r.root as JNode), { a: 1 });
  });
});

// ── 2. repairs ───────────────────────────────────────────────────────────

describe('repairs', () => {
  const cases: [string, string, unknown][] = [
    ['trailing comma (array)', '[1, 2, 3,]', [1, 2, 3]],
    ['trailing comma (object)', '{"a": 1, "b": 2,}', { a: 1, b: 2 }],
    ['trailing comma before EOF', '{"a": [1, 2,', { a: [1, 2] }],
    ['line comment', '{\n  // comment\n  "a": 1 // trailing\n}', { a: 1 }],
    ['block comment', '/* head */ {"a": /* inline */ 1} /* tail */', { a: 1 }],
    ['hash comment', '# config\n{\n  "a": 1 # note\n}', { a: 1 }],
    ['single quotes', "{'a': 'it\"s'}", { a: 'it"s' }],
    ['backticks', '{`a`: `b`}', { a: 'b' }],
    ['unquoted keys', '{a: 1, $b_2: 2, c-d: 3, e.f: 4, 5: 5}', { a: 1, $b_2: 2, 'c-d': 3, 'e.f': 4, 5: 5 }],
    ['python literals', '[True, False, None]', [true, false, null]],
    ['upper-case literals', '[TRUE, FALSE, NULL, Null, nil]', [true, false, null, null, null]],
    ['NaN / Infinity / undefined', '[NaN, Infinity, -Infinity, +Infinity, undefined]', [null, null, null, null, null]],
    ['missing commas (array)', '[1 2 "x" true]', [1, 2, 'x', true]],
    ['missing commas (object, newline separated)', '{\n"a": 1\n"b": 2\nc: 3\n}', { a: 1, b: 2, c: 3 }],
    ['truncated input auto-closes', '{"a": [1, {"b": 2', { a: [1, { b: 2 }] }],
    ['truncated after number', '[1, 2.5', [1, 2.5]],
    ['NDJSON', '{"a":1}\n{"a":2}\n{"a":3}\n', [{ a: 1 }, { a: 2 }, { a: 3 }]],
    ['comma separated top-level values', '1, 2, 3', [1, 2, 3]],
    ['JSONP', 'callback({"a": 1});', { a: 1 }],
    ['JSONP with spaces', 'cb ( [1] )', [1]],
    ['ObjectId / ISODate', '{"_id": ObjectId("5f1d"), "t": ISODate("2020-01-01")}', { _id: '5f1d', t: '2020-01-01' }],
    ['empty wrapper call', '{"a": f()}', { a: null }],
    ['markdown code fence', '```json\n{"a": 1}\n```', { a: 1 }],
    ['markdown code fence with NDJSON', '```\n1\n2\n```\n', [1, 2]],
    ['markdown code fence followed by prose', '```json\n{"a": 1}\n```\nThis object has one key.', { a: 1 }],
    ['two fenced blocks: the second is ignored', '```json\n{"a": 1}\n```\n```json\n{"b": 2}\n```', { a: 1 }],
    ['fenced JSONP with semicolon', '```js\ncb({"a": 1});\n```', { a: 1 }],
    ['smart double quotes', '{\u201ca\u201d: \u201cb\u201d}', { a: 'b' }],
    ['smart single quotes', '{\u2018a\u2019: \u2018b\u2019}', { a: 'b' }],
    ['hex numbers', '[0x1F, -0xff, 0XA]', [31, -255, 10]],
    ['leading zeros', '[007, -01, 00.5]', [7, -1, 0.5]],
    ['plus sign', '[+1, +0.5]', [1, 0.5]],
    ['leading dot', '[.5, -.5, +.5]', [0.5, -0.5, 0.5]],
    ['trailing dot', '[1., -2., 3.e2]', [1, -2, 300]],
    ['unescaped newline and tab in string', '{"a": "line1\nline2\tx"}', { a: 'line1\nline2\tx' }],
    ['other control characters in string', '["a\u0001b"]', ['a\u0001b']],
    ['invalid escapes', '["\\x41\\q\\u12"]', ['Aqu12']],
    ['line continuation', '["a\\\nb"]', ['ab']],
    ['mismatched closer in array', '[1, 2}', [1, 2]],
    ['mismatched closer in object', '{"a": 1]', { a: 1 }],
    ['nested mismatch', '{"a": [1, 2}', { a: [1, 2] }],
    ['extra closers', '{"a": 1}}]', { a: 1 }],
    ['equals sign instead of colon', '{"a" = 1}', { a: 1 }],
    ['missing colon', '{"a" 1}', { a: 1 }],
    ['leading / doubled commas', '{, "a": 1,, "b": 2}', { a: 1, b: 2 }],
    ['array holes', '[1,,2]', [1, 2]],
    ['unquoted string values', '{"a": hello world, "b": x}', { a: 'hello world', b: 'x' }],
    ['unquoted values before comments / URLs', '{a: b // c\n, d: e /* f */, u: http://x.y/z}', { a: 'b', d: 'e', u: 'http://x.y/z' }],
    ['CRLF line continuation', '["a\\\r\nb"]', ['ab']],
    ['exotic whitespace', '{\u00a0"a":\u20031,\u3000"b":\u000b2}', { a: 1, b: 2 }],
    ['BOM', '\ufeff[1]', [1]],
    ['trailing semicolon', '{"a": 1};', { a: 1 }],
  ];
  for (const [name, src, want] of cases) {
    test(name, () => {
      const r = checkAny(src);
      assert.equal(r.error, null, `unexpected error ${JSON.stringify(r.error)}`);
      assert.ok(r.issues.length > 0, 'a repair must be reported as an issue');
      assert.ok(!r.exact);
      const out = stringify(r.root as JNode, '  ');
      assert.deepEqual(JSON.parse(out), want);
      assert.deepEqual(JSON.parse(formatDoc(src, r, '')), want);
    });
  }

  test('NDJSON/JSONP do not double count nodes', () => {
    assert.equal(parse('{"a":1}\n{"a":2}').nodes, 5);
    assert.equal(parse('cb({"a":[1,2]})').nodes, 4);
  });

  test('a trailing comma after a single top-level value is reported, not silently wrapped', () => {
    for (const src of ['1,', '{"a":1},', '[1], ', '"x" ,\n', 'true,,']) {
      const r = checkAny(src);
      assert.ok(!strictOk(r), show(src));
      assert.equal(r.root?.t === ARR && src[0] !== '[', false, `wrapped in an array: ${show(src)}`);
      assert.deepEqual(JSON.parse(stringify(r.root as JNode, '')), JSON.parse(src.replace(/[\s,]+$/, '')));
    }
  });

  test('lone dots are not numbers', () => {
    for (const src of ['.', '[.]', '{"a": -.}', '[+.e5]']) {
      const r = checkAny(src);
      assert.ok(r.error, `expected an error for ${show(src)}`);
    }
  });

  test('unrecoverable input sets error and no root', () => {
    for (const src of ['{"a": "abc', '[', '{', '{"a":', '{"a"', '@', '[1, @]', '{"a": 1 @}', '1e', '[-]', '"\\']) {
      const r = checkAny(src);
      assert.ok(r.error, `expected an error for ${show(src)}`);
      assert.equal(r.root, null);
    }
  });
});

describe('tolerant reading keeps values the same (audit regressions)', () => {
  const value = (src: string, options = {}) => {
    const r = parse(src, options);
    assert.equal(r.error, null, `${show(src)}: ${JSON.stringify(r.error)}`);
    return JSON.parse(stringify(r.root as JNode, ''));
  };
  const first = (src: string, options = {}) => parse(src, options).issues[0];

  test('a sign before a word: -Infinity / +NaN are null, anything longer is a bare word as without the sign', () => {
    assert.deepEqual(value('[-Infinity, +Infinity, -NaN, +NaN, NaN]'), [null, null, null, null, null]);
    for (const src of ['[-NaN]', '[+NaN]', '{"a": -NaN}']) assert.deepEqual(first(src, { repair: true }), { p: src.indexOf('NaN') - 1, m: 'NaN is not valid JSON (replaced with null)' }, show(src));
    assert.deepEqual(value('[Infinityx]'), ['Infinityx']);
    assert.deepEqual(value('[-Infinityx, +NaNa, -foo]'), ['-Infinityx', '+NaNa', '-foo']);
    assert.deepEqual(first('[-Infinityx]'), { p: 1, m: "Unexpected '-Infinityx': strings must be wrapped in double quotes" });
    // (Still no value: a sign alone.)
    for (const src of ['[-]', '[- 1]', '[+]']) assert.ok(parse(src, { repair: true }).error, show(src));
  });

  test('\\0 (no digit after it) and \\v stand for U+0000 and U+000B, still reported', () => {
    assert.deepEqual(value('["a\\0b", "\\v", "\\01", "\\0"]'), ['a\u0000b', '\u000b', '01', '\u0000']);
    assert.deepEqual(parse('["a\\0b"]').issues, [{ p: 3, m: 'Invalid escape sequence \\0' }]);
    assert.deepEqual(parse('["\\v"]').issues, [{ p: 2, m: 'Invalid escape sequence \\v' }]);
  });

  test('a comma or semicolon between top-level values is reported where strict JSON fails', () => {
    for (const [src, at, m] of [['1,2', 1, "Unexpected ','"], ['1;2', 1, "Unexpected ';'"], ['{"a":1},\n{"b":2}', 7, "Unexpected ','"], ['1\n2,', 3, "Unexpected ','"]] as const) {
      for (const lines of [false, true]) {
        const r = parse(src, { lines, repair: true });
        assert.equal(r.error, null);
        assert.ok(r.issues.some((x) => x.p === at && x.m === m), `${show(src)} ${lines}: ${JSON.stringify(r.issues)}`);
        assert.equal(r.issues[0].p, Math.min(at, r.issues[0].p));
      }
    }
    assert.deepEqual(first('1,2'), { p: 1, m: "Unexpected ','" });
  });

  test('a number with more right after it (a date, an IP, a version, 0o17) is one bare word, in arrays and objects alike', () => {
    assert.deepEqual(value('[2024-01-15, 2024-02-01]'), ['2024-01-15', '2024-02-01']);
    assert.deepEqual(value('[10.0.0.1, 1.2.3, 0o17, 5px, 1e5x, -1-2, 0x1Fg, 3.5°C]'), ['10.0.0.1', '1.2.3', '0o17', '5px', '1e5x', '-1-2', '0x1Fg', '3.5°C']);
    assert.deepEqual(value('{"d": 2024-01-15, "t": 2024-01-15T10:30:00Z, "ip": 10.0.0.1}'), { d: '2024-01-15', t: '2024-01-15T10:30:00Z', ip: '10.0.0.1' });
    assert.deepEqual(value('2024-01-15'), '2024-01-15');
    assert.deepEqual(parse('[2024-01-15]').issues, [{ p: 1, m: "Unexpected '2024-01-15': strings must be wrapped in double quotes" }], 'one issue: none about the number');
    assert.deepEqual(parse('[1..2]').issues.map((x) => x.m), ["Unexpected '1..2': strings must be wrapped in double quotes"]);
    // Still numbers: a missing comma with a space, and what a number can end with.
    assert.deepEqual(value('[1 2, 3 -4]'), [1, 2, 3, -4]);
    assert.deepEqual(value('[1,2]'), [1, 2]);
    assert.deepEqual(value('[1"a", 2[3], 4{"b":5}]'), [1, 'a', 2, [3], 4, { b: 5 }]);
    assert.deepEqual(value('[1 ]'), [1], 'exotic space after a number');
  });
});

// ── 3. error positions & messages ────────────────────────────────────────

describe('error positions', () => {
  /** First problem a strict parser would report: earliest of issues[0] / error. */
  const first = (src: string) => {
    const r = parse(src);
    const cands = [...(r.issues.length ? [r.issues[0]] : []), ...(r.error ? [r.error] : [])].sort((a, b) => a.p - b.p);
    assert.ok(cands.length, `no problem reported for ${show(src)}`);
    return { ...cands[0], ...lineCol(src, cands[0].p) };
  };
  const cases: [string, string, number, number, RegExp][] = [
    ['missing comma between properties', '{\n  "a": 1\n  "b": 2\n}', 3, 3, /Expected ','/],
    ['missing comma between items', '[\n  1\n  2\n]', 3, 3, /Expected ','/],
    ['trailing comma', '{\n  "a": 1,\n}', 2, 9, /Trailing comma/],
    ['single quotes', "{\n  'a': 1\n}", 2, 3, /double quotes/],
    ['unquoted key', '{\n  a: 1\n}', 2, 3, /double quotes/],
    ['unterminated string', '{\n  "a": "abc\n}', 2, 8, /Line breaks|Unterminated/],
    ['unterminated string at EOF', '{"a": "abc', 1, 7, /Unterminated string/],
    ['comment', '{\n  "a": 1 // x\n}', 2, 10, /Comments/],
    ['leading zero', '{"a": 012}', 1, 7, /leading zeros/],
    ['bad literal', '[\n  tru\n]', 2, 3, /tru/],
    ['bad character', '{"a": @}', 1, 7, /Unexpected '@'/],
    ['missing closer', '{"a": [1, 2}', 1, 12, /Expected '\]'/],
    ['unexpected end', '[1, 2', 1, 6, /end of input/],
    ['control char in string', '["a\tb"]', 1, 4, /Control|escaped/],
    ['missing colon', '{"a" 1}', 1, 6, /Expected ':'/],
    ['bad escape', '["\\q"]', 1, 3, /Invalid escape/],
    ['second top-level value', '{"a":1}\n{"a":2}', 2, 1, /Multiple top-level values/],
    ['garbage after value', '{"a":1} )', 1, 9, /after the JSON value/],
    ['NaN', '{"a": NaN}', 1, 7, /NaN/],
    ['exponent without digits', '[1e]', 1, 4, /exponent/],
    ['trailing comma after top-level value', '{"a":1},', 1, 8, /','/],
  ];
  for (const [name, src, line, col, re] of cases) {
    test(name, () => {
      const f = first(src);
      assert.match(f.m, re);
      assert.deepEqual({ line: f.line, col: f.col }, { line, col }, `${f.m} @${f.p}`);
    });
  }

  test('messages are agreeable with V8 for the same offending token (spot check)', () => {
    // V8 reports "... at position N"; for these inputs the offending token is the same.
    for (const src of ['{"a": @}', '[1, 2 3]', '{"a" 1}', '[tru]', '{"a": 012}']) {
      let p = -1;
      try {
        JSON.parse(src);
      } catch (e) {
        const m = /position (\d+)/.exec((e as Error).message);
        if (m) p = Number(m[1]);
      }
      if (p < 0) continue; // older V8 without positions
      const r = parse(src);
      const ours = Math.min(r.issues[0]?.p ?? Infinity, r.error?.p ?? Infinity);
      assert.ok(Math.abs(ours - p) <= 2, `${show(src)}: ours ${ours}, V8 ${p}`);
    }
  });
});

// ── 4. lossless numbers, duplicates, exact flag ──────────────────────────

describe('lossless numbers', () => {
  test('number text is kept verbatim', () => {
    const nums = ['12345678901234567890123', '-0', '1e5', '1E+05', '0.1000000000000000000001', '1e400', '-1.0', '5e-324', '0.00'];
    const src = '[' + nums.join(',') + ']';
    const r = parse(src);
    assert.ok(strictOk(r));
    assert.deepEqual(kids(r.root as JNode).map((n) => n.v), nums);
    assert.equal(stringify(r.root as JNode, ''), src);
    assert.equal(formatDoc(src, r, ''), src);
    assert.equal(r.exact, false);
  });
  test('big integers survive pretty printing and sorting', () => {
    const src = '{"z": 9007199254740993, "a": {"id": 123456789012345678901234567890}}';
    const r = parse(src);
    const out = formatDoc(src, r, '  ', true);
    assert.match(out, /9007199254740993/);
    assert.match(out, /123456789012345678901234567890/);
    assert.ok(out.indexOf('"a"') < out.indexOf('"z"'));
  });
  test('toValue keeps imprecise numbers as text, exact ones as numbers', () => {
    const r = parse('[1, 1.5, 0.1, 9007199254740993, 1e400, 12345678901234567890, 1.0, 1e5, 2.50, -0, 1E-7]');
    const v = toValue(r.root as JNode) as unknown[];
    assert.deepEqual(v.slice(0, 6), [1, 1.5, 0.1, '9007199254740993', '1e400', '12345678901234567890']);
    assert.deepEqual(v.slice(6), [1, 100000, 2.5, -0, 1e-7]);
  });
  test('toValue matches JSON.parse (incl. "__proto__" keys and duplicates)', () => {
    for (const src of ['{"__proto__": {"a": 1}, "b": [1, {"__proto__": null}]}', '{"a": 1, "a": 2}', '[{"x": "\\u00e9"}, null, true, 0.5]']) {
      const v = toValue(parse(src).root as JNode);
      assert.deepEqual(v, JSON.parse(src), src);
      assert.equal(JSON.stringify(v), JSON.stringify(JSON.parse(src)));
    }
  });
  test('normalized repaired numbers', () => {
    const r = parse('[+1, .5, 1., 007, -00.5e3, 0x10]');
    assert.equal(stringify(r.root as JNode, ''), '[1,0.5,1,7,-0.5e3,16]');
  });
});

describe('duplicate keys', () => {
  test('kept in the tree and reported as warnings (still strictly valid)', () => {
    const src = '{"a": 1, "b": 2, "a": 3}';
    const r = parse(src);
    assert.ok(strictOk(r));
    assert.equal(r.warnings.length, 1);
    assert.equal(r.warnings[0].p, src.lastIndexOf('"a"'));
    assert.match(r.warnings[0].m, /Duplicate key "a"/);
    assert.equal(r.exact, false);
    assert.equal(formatDoc(src, r, ''), '{"a":1,"b":2,"a":3}');
  });
  test('detected in large objects (Set path) and via escapes', () => {
    const keys = Array.from({ length: 30 }, (_, k) => `"k${k}": ${k}`);
    keys.push('"k3": 0', '"k25": 0', '"\\u006b7": 0');
    const r = parse('{' + keys.join(',') + '}');
    assert.deepEqual(
      r.warnings.map((w) => w.m),
      ['Duplicate key "k3"', 'Duplicate key "k25"', 'Duplicate key "k7"'],
    );
  });
  test('duplicate keys in different objects are fine', () => {
    assert.equal(parse('[{"a":1},{"a":2}]').warnings.length, 0);
  });
});

describe('exact flag', () => {
  const exactOf = (src: string) => parse(src).exact;
  test('true for canonical documents', () => {
    for (const src of ['{"a":1}', '[0.5, -1, 123456789012345, 0.000001, 1.5, "\\u0041\\/"]', '"x"', 'null', '{"02": 1, "1.5": 2, "-1": 3}', '[]', '{}'])
      assert.equal(exactOf(src), true, src);
  });
  test('false for integer-like keys that JS would reorder', () => {
    for (const src of ['{"b": 1, "2": 2}', '{"0": 1}', '{"a": {"10": 1}}', '{"4294967294": 1}', '{"\\u0032": 1}'])
      assert.equal(exactOf(src), false, src);
  });
  test('false for non-canonical numbers', () => {
    for (const src of ['1.0', '1e5', '1E5', '0.0000001', '-0', '0.10', '12345678901234567890', '1.7976931348623157e308', '100.0'])
      assert.equal(exactOf(src), false, src);
  });
  test('false for repaired, duplicate-key and NDJSON documents', () => {
    for (const src of ['[1,]', '{"a":1,"a":1}', '1\n2', '1,', '\ufeff1', '// x\n1']) assert.equal(exactOf(src), false, src);
  });
  test('false for keys written with escapes (V8 JSON.parse bug, see POISON)', () => {
    for (const src of ['{"\\n": 1}', '{"\\u0061": 1}', '{"\\/": 1}', '{"a": {"\\"": 1}}', '{"\\\\": 1}', '{"caf\\u00e9": 1}', '{"\\\\_": 1}'])
      assert.equal(exactOf(src), false, src);
    for (const src of ['{"a": 1}', '{"caf\u00e9": 1}', '{"a": "\\n\\u00e9"}']) assert.equal(exactOf(src), true, src);
  });
  test('formatDoc is immune to the V8 escaped-key bug (subprocess)', (t) => {
    // Fresh process: the bug needs a map whose only transition is a key containing a backslash.
    const lib = JSON.stringify(join(__dirname, '..', 'lib', 'json'));
    const code = `
      const { parse } = require(${lib} + '/parser');
      const { formatDoc } = require(${lib} + '/format');
      JSON.parse(String.raw\`{"qz9": 0, "\\\\": 0}\`);
      JSON.parse(String.raw\`{"qz8": 0, "\\\\\\\\": 0}\`);
      const src = String.raw\`{"qz9": 0, "\\n": 1}\`;
      const src2 = String.raw\`{"qz8": 0, "\\\\_": 1}\`;
      process.stdout.write(JSON.stringify([
        Object.keys(JSON.parse(src))[1], formatDoc(src, parse(src), ''),
        Object.keys(JSON.parse(src2))[1], formatDoc(src2, parse(src2), ''),
      ]));`;
    const out = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const [key1, formatted1, key2, formatted2] = JSON.parse(out.stdout) as string[];
    t.diagnostic(`V8 ${process.versions.v8} JSON.parse read the keys "\\n" and "\\\\_" as ${JSON.stringify(key1)} and ${JSON.stringify(key2)}`);
    assert.equal(formatted1, '{"qz9":0,"\\n":1}');
    assert.equal(formatted2, '{"qz8":0,"\\\\_":1}');
  });
  test('native fast path agrees with the custom serializer whenever exact', () => {
    const src = '{"name":"\\u00e9\\ud83d\\ude00","n":[1,0.5,-3],"s":"\\ud800","e":{},"a":[]}';
    const r = parse(src);
    assert.equal(r.exact, true);
    for (const ind of ['', '  ', '\t', '    ']) assert.equal(formatDoc(src, r, ind), stringify(r.root as JNode, ind));
  });
});

// ── 5. paths ─────────────────────────────────────────────────────────────

describe('path.ts', () => {
  test('formatPath', () => {
    assert.equal(formatPath([]), '$');
    assert.equal(formatPath(['users', 0, 'first name']), '$.users[0]["first name"]');
    assert.equal(formatPath(['a', '0', '\u00e9', '$x', '_1']), '$.a["0"]["\u00e9"].$x._1');
    assert.equal(formatPath(['a"b', 'c]d', '']), '$["a\\"b"]["c]d"][""]');
  });
  test('parsePath', () => {
    assert.deepEqual(parsePath('$.a.b[0]["c d"]'), ['a', 'b', 0, 'c d']);
    assert.deepEqual(parsePath(" $.a['x y'][ 2 ] "), ['a', 'x y', 2]);
    assert.deepEqual(parsePath('a.b[0]'), ['a', 'b', 0]);
    assert.deepEqual(parsePath('.a.b'), ['a', 'b']);
    assert.deepEqual(parsePath('$'), []);
    assert.deepEqual(parsePath(''), []);
    assert.deepEqual(parsePath('/a/0'), ['a', 0]);
    assert.deepEqual(parsePath('/a~1b/~0c/~01'), ['a/b', '~c', '~1']);
    assert.deepEqual(parsePath('/'), ['']);
    assert.deepEqual(parsePath('$["a]b"]["c\\"]d"]'), ['a]b', 'c"]d']);
    for (const bad of ['$.a[', '$.a.', '$[x]', '$["a]', '$[\'a]', '/a/~2', '/~', '/a~b'])
      assert.equal(parsePath(bad), null, bad);
  });
  test('formatPath / parsePath round trip (random keys)', () => {
    const r = prng(7);
    const chars = ['a', 'Z', '_', '$', '0', '9', '.', '[', ']', '"', "'", '\\', ' ', '/', '~', '\u00e9', '\u2028', '\n', '\u0000', '\ud83d\ude00'];
    for (let it = 0; it < 3000; it++) {
      const segs: Seg[] = [];
      const n = r.int(5);
      for (let k = 0; k < n; k++) {
        if (r.chance(0.3)) segs.push(r.int(1000));
        else {
          let s = '';
          const len = r.int(6);
          for (let j = 0; j < len; j++) s += r.pick(chars);
          segs.push(s);
        }
      }
      const p = formatPath(segs);
      assert.deepEqual(parsePath(p), segs, `round trip of ${JSON.stringify(segs)} via ${p}`);
    }
  });
  test('resolve', () => {
    const r = parse('{"a": {"b": [10, {"c d": true}]}, "01": "x", "1": "y", "a/b": 1, "": 2}');
    const root = r.root as JNode;
    const at = (q: string) => {
      const segs = parsePath(q);
      assert.ok(segs, q);
      const n = resolve(root, segs);
      return n && JSON.parse(stringify(n, ''));
    };
    assert.equal(at('$.a.b[0]'), 10);
    assert.equal(at('$.a.b["1"]["c d"]'), true);
    assert.equal(at('/a/b/1/c d'), true);
    assert.equal(at('/01'), 'x');
    assert.equal(at('/1'), 'y');
    assert.equal(at('$["01"]'), 'x');
    assert.equal(at('/a~1b'), 1);
    assert.equal(at('/'), 2);
    assert.equal(at('$.a.b[5]'), null);
    assert.equal(at('$.a.b.x'), null);
    assert.equal(at('$.nope.deeper'), null);
    assert.equal(resolve(null, ['a']), null);
    assert.equal(resolve(root, []), root);
  });
  test('nodeAt', () => {
    const src = '{\n  "a": 1,\n  "list": [10, {"x,y": "v", "k": null}],\n  "b": "s"\n}';
    const r = parse(src);
    const root = r.root as JNode;
    const at = (needle: string, delta = 0) => {
      const p = src.indexOf(needle);
      assert.ok(p >= 0, needle);
      const n = nodeAt(root, p + delta, src);
      return n ? formatPath(pathOf(n)) : null;
    };
    assert.equal(at('"a"'), '$.a'); // caret on key → its value
    assert.equal(at('"a"', 2), '$.a');
    assert.equal(at('1,'), '$.a');
    assert.equal(at('"list"'), '$.list');
    assert.equal(at('10'), '$.list[0]');
    assert.equal(at('"x,y"'), '$.list[1]["x,y"]');
    assert.equal(at('"x,y"', 3), '$.list[1]["x,y"]');
    assert.equal(at('"k"'), '$.list[1].k');
    assert.equal(at('null'), '$.list[1].k');
    assert.equal(at('"s"', 1), '$.b');
    assert.equal(at('{'), '$');
    assert.equal(nodeAt(root, src.length + 5, src), null);
    assert.equal(nodeAt(null, 0, src), null);
    // caret right after a comma (before the next key) belongs to the next property
    assert.equal(at(',\n  "b"', 1), '$.b');
  });
});

// ── 6. robustness & performance ──────────────────────────────────────────

describe('robustness', () => {
  test('nesting deeper than MAX_DEPTH is refused, the same in every engine', () => {
    const over = MAX_DEPTH + 2; // containers: the root is at depth 0
    for (const src of ['['.repeat(over), '['.repeat(over) + ']'.repeat(over), '{"a":'.repeat(over) + '1' + '}'.repeat(over), '[{"a":'.repeat(over), '['.repeat(10 * MAX_DEPTH)]) {
      const r = parse(src);
      assert.equal(r.root, null);
      assert.equal(r.error?.m, 'Nesting is too deep to parse');
      assert.equal(r.depth, MAX_DEPTH);
    }
    // Calls(…) take their argument's place: they don't nest.
    const calls = parse('f('.repeat(200_000) + '1');
    assert.equal(calls.root?.v, '1');
  });
  test('documents up to MAX_DEPTH parse and serialize (no recursion)', () => {
    const levels = MAX_DEPTH + 1;
    const src = '['.repeat(levels) + ']'.repeat(levels);
    const r = parse(src);
    assert.ok(strictOk(r));
    assert.equal(r.depth, MAX_DEPTH);
    assert.equal(stringify(r.root as JNode, ''), src);
    assert.equal(stringify(r.root as JNode, '', true), src);
    assert.equal(formatDoc(src, r, ''), src);
    // (Walked in a loop: assert.deepEqual would recurse.)
    let v = toValue(r.root as JNode) as unknown[];
    for (let k = 0; k < MAX_DEPTH; k++) {
      assert.equal(v.length, 1);
      v = v[0] as unknown[];
    }
    assert.deepEqual(v, []);
    const objects = '{"b":1,"a":'.repeat(MAX_DEPTH) + '[]' + '}'.repeat(MAX_DEPTH);
    const o = parse(objects);
    assert.ok(strictOk(o));
    assert.equal(stringify(o.root as JNode, ''), objects);
    assert.equal(stringify(o.root as JNode, '', true), '{"a":'.repeat(MAX_DEPTH) + '[]' + ',"b":1}'.repeat(MAX_DEPTH));
    let ov = toValue(o.root as JNode) as Record<string, unknown>;
    for (let k = 0; k < MAX_DEPTH; k++) {
      assert.deepEqual(Object.keys(ov), ['b', 'a']);
      ov = ov.a as Record<string, unknown>;
    }
    assert.deepEqual(ov, []);
  });
  test('pretty output past MAX_TEXT throws early, as a RangeError tooLarge() recognizes', () => {
    // 2-space pretty-printing of n nested arrays is about 2·n² characters: 17,000 levels is past MAX_TEXT.
    const levels = 17_000;
    const src = '['.repeat(levels) + ']'.repeat(levels);
    const r = parse(src);
    assert.ok(2 * levels * levels > MAX_TEXT);
    for (const sort of [false, true]) {
      const e = (() => {
        try {
          stringify(r.root as JNode, '  ', sort);
        } catch (err) {
          return err;
        }
      })();
      assert.ok(e instanceof RangeError && tooLarge(e), `throws: ${e}`);
      assert.throws(() => formatDoc(src, r, '  ', sort), (err) => tooLarge(err));
    }
    assert.equal(formatDoc(src, r, ''), src);
    assert.equal(tooLarge(new RangeError('Maximum call stack size exceeded')), false);
  });
  test('formatDoc refuses pretty output indented past MAX_INDENT, at once', () => {
    const wide = ' '.repeat(MAX_INDENT / 10); // depth 10 is the deepest this indent may reach
    for (const [levels, ok] of [[11, true], [12, false]] as const) {
      const src = '['.repeat(levels) + ']'.repeat(levels);
      const r = parse(src);
      if (ok) assert.equal(formatDoc(src, r, wide).split('\n').length, 2 * levels - 1);
      else for (const sort of [false, true]) assert.throws(() => formatDoc(src, r, wide, sort), (e) => tooLarge(e));
    }
    // Two spaces: 5,000 levels; a deeper chain is refused before any work.
    const deep = '['.repeat(5_002) + ']'.repeat(5_002);
    const r = parse(deep);
    const t = cpuNow();
    assert.throws(() => formatDoc(deep, r, '  '), (e) => tooLarge(e));
    assert.ok(cpuNow() - t < 20, 'refused at once');
    assert.equal(formatDoc(deep, r, ''), deep);
  });
  test('moderately deep documents parse and pretty-print', () => {
    const d = 1000;
    const src = '['.repeat(d) + '{"a":1}' + ']'.repeat(d);
    const r = parse(src);
    assert.ok(strictOk(r));
    assert.equal(r.depth, d + 1);
    assert.equal(stringify(r.root as JNode, ''), src);
    assert.equal(stringify(r.root as JNode, '  '), JSON.stringify(JSON.parse(src), null, 2));
  });
  test('issue list is capped', () => {
    const r = parse('[' + 'a\n'.repeat(5000) + ']');
    assert.ok(r.issues.length <= 500);
    assert.ok(r.root);
  });
});

describe('performance (smoke)', () => {
  test('~5MB document parses + stringifies in < 3s', () => {
    const r = prng(99);
    const rows: string[] = [];
    let size = 0;
    for (let k = 0; size < 5_000_000; k++) {
      const row = `{"id":${k},"name":${JSON.stringify('user ' + r.int(1e6) + ' \u00e9\u4e2d')},"score":${(r.next() * 1000).toFixed(3)},"big":12345678901234567890,"tags":["a","b\\n","c"],"active":${r.chance(0.5)},"nested":{"x":null,"y":[1,2,3]}}`;
      rows.push(row);
      size += row.length + 1;
    }
    const src = '[' + rows.join(',') + ']';
    const t0 = cpuNow();
    const res = parse(src);
    const out = stringify(res.root as JNode, '  ');
    const ms = cpuNow() - t0;
    assert.ok(strictOk(res));
    assert.ok(out.length > src.length);
    assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms of CPU time`);
  });
});

describe('format helpers', () => {
  test('byteLength matches UTF-8 encoding (incl. lone surrogates)', () => {
    const r = prng(3);
    const pool = ['a', '\u00e9', '\u4e2d', '\ud83d\ude00', '\ud800', '\udc00', '\u007f', '\u0080', '\u07ff', '\u0800', '\uffff'];
    for (let it = 0; it < 2000; it++) {
      let s = '';
      for (let k = r.int(10); k > 0; k--) s += r.pick(pool);
      assert.equal(byteLength(s), Buffer.byteLength(s, 'utf8'), JSON.stringify(s));
    }
  });
  test('stringify escapes what JSON.stringify escapes', () => {
    const r = parse('["\\u0000\\u001f\\"\\\\\\u2028\\ud800\\udc00\\ud800x", {"\\n": 1}]');
    assert.equal(stringify(r.root as JNode, ''), JSON.stringify(JSON.parse(stringify(r.root as JNode, ''))));
    assert.equal(r.root?.t, ARR);
    assert.equal(kids(r.root as JNode)[0].t, STR);
    assert.equal(kids(r.root as JNode)[1].t, OBJ);
  });
  test('primText and preview stay short whatever the values and keys', () => {
    const big = '9'.repeat(1e6);
    const key = 'k'.repeat(1e6);
    const at = (src: string) => parse(src).root as JNode;
    assert.equal(primText(at(big), 160), '9'.repeat(160) + '…');
    assert.equal(primText(at('-1.5e-7')), '-1.5e-7');
    assert.equal(primText(at(`"${'x'.repeat(500)}"`), 160), `"${'x'.repeat(160)}…"`);
    // a cut never splits a surrogate pair
    assert.equal(primText(at(`"${'x'.repeat(159)}😀"`), 160), `"${'x'.repeat(159)}…"`);
    for (const [src, budget] of [
      [`{"${key}": 1}`, 90],
      [`{"a": ${big}}`, 90],
      [`[${big}, 1]`, 90],
      [`{"${key}": "${key}", "b": [${big}]}`, 40],
      [`{"${'\\u0001'.repeat(5000)}": 1}`, 90],
    ] as [string, number][]) {
      const s = preview(at(src), budget);
      assert.ok(s.length <= budget + 300, `${s.length} chars: ${s.slice(0, 120)}`);
    }
    assert.equal(preview(at(`{"${key}": 1, "b": 2}`)), `{"${'k'.repeat(40)}…": 1, b: 2}`);
    assert.equal(preview(at('{"id": 1, "name": "Ada", "tags": ["a"], "n": null}')), '{id: 1, name: "Ada", tags: […], n: null}');
  });
});
