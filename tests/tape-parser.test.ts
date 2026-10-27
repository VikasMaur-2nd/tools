import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAX_DEPTH, parse as oldParse, type ParseOptions } from '../lib/json/parser';
import { parse, parser, type TapeOptions } from '../lib/json/tape-parser';
import { KEY_NAME, VALUE_EXTRA, W, keyKindOf, sizeOf, valueKindOf, valueOf, type Tape } from '../lib/json/tape';
import { tapeOf } from '../lib/json/tape-send';
import { MESSAGES, genDeep, genLoose, mutate, rng, type Rng } from './oracle/compare';

// FUZZ_SEED=<n> / FUZZ_SCALE=<x> (env) re-run with another seed / more cases; `pnpm test --slow` runs
// millions of fuzzed documents and the big corpora.
const SEED = Number(process.env.FUZZ_SEED) || 0;
const SLOW = !!process.env.TEST_SLOW;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (SLOW ? 50 : 1);
const cases = (k: number) => Math.round(k * SCALE);

const show = (s: string) => {
  const j = JSON.stringify(s.length > 400 ? s.slice(0, 400) : s).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s.length > 400 ? `${j}… (${s.length} chars)` : j;
};

/**
 * The first difference between the tape parser's tape and the tape of parser.ts's tree (null if
 * none): the head, every node (kind, size, offsets, parent, key) and its value as JNode.v has it.
 * Value kinds may differ only where tapeOf keeps the value aside (VALUE_EXTRA) and the tape parser
 * reads it back from the source.
 */
export function diffTape(want: Tape, got: Tape, src: string): string | null {
  const a = want.head;
  const b = got.head;
  for (const k of ['nodes', 'depth', 'exact', 'multi'] as const) if (a[k] !== b[k]) return `head.${k}: ${a[k]} vs ${b[k]}`;
  for (const k of ['issues', 'warnings'] as const) {
    if (a[k].length !== b[k].length) return `head.${k}.length: ${a[k].length} vs ${b[k].length}`;
    for (let j = 0; j < a[k].length; j++) {
      if (a[k][j].p !== b[k][j].p || a[k][j].m !== b[k][j].m) return `head.${k}[${j}]: ${JSON.stringify(a[k][j])} vs ${JSON.stringify(b[k][j])}`;
    }
  }
  if (JSON.stringify(a.error) !== JSON.stringify(b.error)) return `head.error: ${JSON.stringify(a.error)} vs ${JSON.stringify(b.error)}`;
  if (Object.keys(b).join() !== 'issues,warnings,error,nodes,depth,exact,multi') return `head fields: ${Object.keys(b)}`;
  if (want.count !== got.count) return `count: ${want.count} vs ${got.count}`;
  if (got.nodes.length < got.count * W) return `nodes buffer too short: ${got.nodes.length}`;
  if (want.keys.length !== got.keys.length) return `keys.length: ${want.keys.length} vs ${got.keys.length}`;
  for (let k = 0; k < want.keys.length; k++) if (want.keys[k] !== got.keys[k]) return `keys[${k}]: ${JSON.stringify(want.keys[k])} vs ${JSON.stringify(got.keys[k])}`;
  const x = want.nodes;
  const y = got.nodes;
  for (let i = 0; i < want.count; i++) {
    const o = i * W;
    if ((x[o] & 0x1f) !== (y[o] & 0x1f) || x[o + 1] !== y[o + 1] || x[o + 2] !== y[o + 2] || x[o + 3] !== y[o + 3] || x[o + 4] !== y[o + 4] || sizeOf(want, i) !== sizeOf(got, i)) {
      const f = (t: Tape) => JSON.stringify([t.nodes[o] & 7, keyKindOf(t, i), sizeOf(t, i), t.nodes[o + 1], t.nodes[o + 2], t.nodes[o + 3], t.nodes[o + 4]]);
      return `node ${i} [kind, keyKind, size, start, end, parent, key]: ${f(want)} vs ${f(got)}`;
    }
    const vw = valueKindOf(want, i);
    const vg = valueKindOf(got, i);
    if (vw !== vg && vw !== VALUE_EXTRA) return `node ${i} value kind: ${vw} vs ${vg}`;
    const v1 = valueOf(want, i, src);
    const v2 = valueOf(got, i, src);
    if (v1 !== v2) return `node ${i} value: ${JSON.stringify(v1)} vs ${JSON.stringify(v2)}`;
  }
  return null;
}

/** Parses `src` in steps of `every` values with an expired deadline. */
function stepped(src: string, options: TapeOptions, every: number): Tape {
  const { step, at } = parser(src, options, every);
  let pos = at();
  let back = 0;
  for (let k = 0; ; k++) {
    const t = step(0);
    if (at() < pos) assert.ok(++back === 1, 'progress went back twice');
    pos = at();
    if (t) {
      assert.equal(step(0), t, 'a finished parse keeps its tape');
      return t;
    }
    assert.ok(k < 4 * src.length + 16, 'no progress');
  }
}

/** The tape parser gives what parser.ts gives (one-shot, and stepped when `steps` lists step sizes). */
function same(src: string, options: ParseOptions = {}, steps: number[] = []): Tape {
  const old = oldParse(src, options);
  const want = tapeOf(old, src);
  const opts: TapeOptions = { ...options, maxDepth: MAX_DEPTH };
  const got = parse(src, opts);
  const d = diffTape(want, got, src);
  if (d) assert.fail(`one-shot: ${d}\ninput: ${show(src)} ${JSON.stringify(options)}`);
  for (const every of steps) {
    const ds = diffTape(want, stepped(src, opts, every), src);
    if (ds) assert.fail(`steps of ${every}: ${ds}\ninput: ${show(src)} ${JSON.stringify(options)}`);
  }
  return got;
}

// ── Generators ───────────────────────────────────────────────────────────

const KEYS = ['id', 'name', 'type', 'value', 'a', 'b', 'x', '', 'é', '中', '😀', 'k\\n', 'q\\"', '\\u0041b', '0', '12', '01', '4294967295', '12345678901', 'dup', 'long key with spaces'];
const STRS = ['', 'a', 'hello world', 'é', '中文', '😀', '\\"', '\\\\', '\\/', '\\b\\f\\n\\r\\t', '\\u0041', '\\uD83D\\uDE00', '\\ud800', '\\uDFFF', ' ', '\u007f', 'x'.repeat(40)];
const NUMBERS = ['0', '-0', '1', '-12', '3.5', '1e5', '1E-7', '-2.5e+10', '9007199254740993', '123456789012345678901234567890', '0.1', '1.0', '100', '5e-324', '1e400', '0.0000001', '0.000001', '-0.0', '123456789012345', '1234567890123456', '-123456789012345'];
const SPACE = ['', '', '', ' ', '\n', '\r\n', '\t', '\n  '];

/** Strict JSON (mostly: what the fast path takes), occasionally deep, wide or with duplicate keys. */
function genStrict(r: Rng, maxDepth: number): string {
  const ws = () => r.pick(SPACE);
  const value = (d: number): string => {
    const k = d >= maxDepth ? r.int(8) : r.int(12);
    if (k < 1) return r.pick(['null', 'true', 'false']);
    if (k < 4) return r.pick(NUMBERS);
    if (k < 8) return '"' + r.pick(STRS) + (r.chance(0.2) ? r.pick(STRS) : '') + '"';
    if (k < 10) {
      const len = r.chance(0.1) ? 17 + r.int(30) : r.int(5);
      const items = Array.from({ length: len }, () => ws() + value(d + 1) + ws());
      return '[' + ws() + items.join(',') + ']';
    }
    const len = r.chance(0.1) ? 14 + r.int(30) : r.int(6);
    const items = Array.from({ length: len }, () => ws() + '"' + (r.chance(0.7) ? r.pick(KEYS) : 'k' + r.int(40)) + '"' + ws() + ':' + ws() + value(d + 1) + ws());
    return '{' + ws() + items.join(',') + '}';
  };
  return ws() + value(0) + ws();
}

const LOOSE_BITS = ['//c\n', '/*c*/', '#h\n', ',', ',,', "'s'", '`t`', '“q”', 'NaN', '+1', '.5', '1.', '007', '0x1F', 'True', 'None', 'undefined', 'abc', 'f(', ')', 'cb(1)', ' ', '\u000b', '﻿', '}', ']', ':', '=', '"\n"', '"\\q"', '"\\x41"', '\u0001', '\ud800', '\\', '"'];

/** Breaks a strict document in a few places with loose constructs or broken bytes: the fast path hands over there. */
function loosen(r: Rng, s: string): string {
  for (let ops = 1 + r.int(3); ops > 0; ops--) {
    const p = r.int(s.length + 1);
    const k = r.int(10);
    if (k < 6) s = s.slice(0, p) + r.pick(LOOSE_BITS) + s.slice(p);
    else if (k < 8) s = s.slice(0, p) + s.slice(p + 1 + r.int(3));
    else s = mutate(r, s);
  }
  return s;
}

// ── Corpora on this host (skipped where missing) ─────────────────────────

const CORPUS = process.env.TAPE_CORPUS || join(homedir(), '.cache/selftest/pbench-data');
const FIXTURES = process.env.TAPE_FIXTURES || join(homedir(), '.cache/tool-kumar-harness/fixtures/v1');

function files(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('tape parser: the same as parser.ts', () => {
  test('small documents of every kind, one-shot and stopping after every value', () => {
    const docs = [
      '',
      '  ',
      '1',
      '"a"',
      'true',
      'null',
      '[]',
      '{}',
      '[1,2,3]',
      '{"a":1,"b":[true,false,null],"c":{"d":"e"}}',
      ' { "a" : 1 , "b" : [ 1 , 2 ] } ',
      '{"a":1,"a":2}',
      '{"a":{"a":1},"a":2}',
      '{"0":1,"1":2}',
      '{"a\\n":1}',
      '"\\u0041\\n\\ud800"',
      '[1e5, -0, 0.5, 1.50, 0.0000001, 12345678901234567]',
      '[01, +1, .5, 1., 0x1F, -0x1f, 1e]',
      "{a: 1, 'b': 'c', `d`: `e`, “f”: ‘g’}",
      '[1,,2,]',
      '{,"a":1,}',
      '// c\n{"a":1 /* c */}',
      '# h\n[1]',
      '﻿[1]',
      '```json\n{"a":1}\n```\nprose',
      '1\n2\n3',
      '{"a":1}\n{"b":2}',
      'cb({"a":[1,2]})',
      'f(g(1), 2)',
      '[f(1), g({"a":2}), h()]',
      '{"a": ObjectId("x")}',
      '[NaN, Infinity, -Infinity, undefined, None, True, tru, nul]',
      '[hello world, http://x.y/z, a // c\n]',
      '{"a":1',
      '[1, 2',
      '"abc',
      '{"a"',
      '{"a":',
      '[1 2]',
      '{"a":1 "b":2}',
      '{"a" 1}',
      '1 }',
      '1 x',
      '[1] [2',
      '\u0001',
      '[ 1]',
    ];
    for (const src of docs) {
      same(src, {}, [1, 2, 5]);
      same(src, { lines: true }, [1, 3]);
    }
  });

  test(`random loose, broken and multi-value documents (seed ${SEED || 1}, ${cases(30000)} cases) reach every message`, () => {
    const r = rng(SEED || 1);
    const seen = new Set<number>();
    const note = (m: string) => {
      for (let k = 0; k < MESSAGES.length; k++) if (MESSAGES[k].test(m)) seen.add(k);
    };
    for (let it = 0, total = cases(30000); it < total; it++) {
      let src = genLoose(r, 1 + r.int(6));
      if (r.chance(0.4)) src = mutate(r, src);
      const options = r.chance(0.1) ? { lines: true } : {};
      let t: Tape;
      try {
        t = same(src, options, it % 16 === 0 ? [1] : it % 16 === 8 ? [1 + r.int(7)] : []);
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
      for (const x of t.head.issues) note(x.m);
      for (const x of t.head.warnings) note(x.m);
      if (t.head.error) note(t.head.error.m);
    }
    const missing = MESSAGES.map((m, k) => (seen.has(k) ? '' : String(m))).filter(Boolean);
    assert.deepEqual(missing, [], 'messages the corpus never produced');
  });

  test(`strict documents, and strict ones broken in a few places (${cases(20000)} cases)`, () => {
    const r = rng((SEED || 1) + 1);
    let strict = 0;
    for (let it = 0, total = cases(20000); it < total; it++) {
      let src = genStrict(r, 1 + r.int(7));
      if (r.chance(0.15)) src = Array.from({ length: 2 + r.int(4) }, () => genStrict(r, 3)).join(r.pick(['\n', '\r\n', '\n\n', ' ']));
      if (r.chance(0.5)) src = loosen(r, src);
      const options = r.chance(0.1) ? { lines: true } : {};
      let t: Tape;
      try {
        t = same(src, options, it % 16 === 0 ? [1] : it % 16 === 8 ? [2 + r.int(30)] : []);
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
      if (!t.head.issues.length && !t.head.error) strict++;
    }
    assert.ok(strict > cases(9000), `strict: ${strict}`);
  });

  test('every truncation of small documents', () => {
    const r = rng((SEED || 1) + 2);
    const docs = [
      '{"a":[1,2.5e3,"x\\ny",true,null],"b":{"c":"d","e":[]},"f":{}}',
      "{a: 'b', c: [1,,2,], d: f(1), /* c */ e: NaN}",
      '[{"id":1,"name":"a"},{"id":2,"name":"b","id":3}]',
      '1\n{"a":2}\n[3]',
      '```json\n{"a": "\\u00e9\\ud83d\\ude00"}\n```',
    ];
    for (let k = 0; k < cases(40); k++) docs.push(genStrict(r, 4), genLoose(r, 3));
    for (const doc of docs) {
      for (let p = 0; p <= doc.length; p++) {
        const src = doc.slice(0, p);
        same(src, {}, p % 7 === 0 ? [1] : []);
        if (p % 5 === 0) same(src, { lines: true });
      }
    }
  });

  test(`byte mutations: insertions, deletions and replacements of every kind of character (${cases(20000)} cases)`, () => {
    const r = rng((SEED || 1) + 3);
    const chars: string[] = [];
    for (let c = 0; c < 128; c++) chars.push(String.fromCharCode(c));
    chars.push(' ', 'é', ' ', ' ', '　', '﻿', '“', '”', '‘', '’', '\ud800', '\udc00', '😀', '٠');
    for (let it = 0, total = cases(20000); it < total; it++) {
      let src = r.chance(0.5) ? genStrict(r, 4) : genLoose(r, 3);
      for (let ops = 1 + r.int(4); ops > 0; ops--) {
        const p = r.int(src.length + 1);
        const k = r.int(3);
        if (k === 0) src = src.slice(0, p) + r.pick(chars) + src.slice(p);
        else if (k === 1) src = src.slice(0, p) + src.slice(p + 1);
        else src = src.slice(0, p) + r.pick(chars) + src.slice(p + 1);
      }
      try {
        same(src, r.chance(0.1) ? { lines: true } : {}, it % 32 === 0 ? [1] : []);
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
    }
  });

  test('more issues and duplicate keys than the cap (500), wide objects', () => {
    const r = rng(5);
    const docs = [
      '[' + 'a\n'.repeat(3000) + ']',
      '{' + Array.from({ length: 1200 }, (_, k) => `"k${k % 300}": ${k}`).join(',') + '}',
      '{' + Array.from({ length: 900 }, () => `'dup': 1,`).join('') + '}',
      Array.from({ length: 800 }, (_, k) => `{"a":${k},"a":1} // c`).join('\n'),
      Array.from({ length: 300 }, () => genLoose(r, 3)).join('\n'),
      // Keys also used by nested objects, before and after 16 members.
      '{' + Array.from({ length: 60 }, (_, k) => `"k${k}": {"k${k + 1}": {"k${k}": 1}}, "x${k % 20}": 0`).join(',') + '}',
      '{' + Array.from({ length: 40 }, (_, k) => `"k${k % 25}": [{"k${k % 25}": 1}]`).join(',') + '}',
      '[' + Array.from({ length: 200 }, (_, k) => `{"id":${k},"id":${k},"n":{"id":1}}`).join(',') + ']',
    ];
    for (const src of docs) {
      same(src, {}, [1, 13]);
      same(src, { lines: true }, [7]);
    }
  });

  test('deep documents, up to and past MAX_DEPTH', () => {
    const r = rng((SEED || 1) + 4);
    for (let it = 0; it < 300; it++) same(genDeep(r, 1 + r.int(1500)), {}, it % 8 === 0 ? [1] : []);
    for (const levels of [MAX_DEPTH, MAX_DEPTH + 1]) {
      same('['.repeat(levels) + ']'.repeat(levels));
      same('{"a":'.repeat(levels) + '1' + '}'.repeat(levels));
      same('['.repeat(levels) + '1');
      same('f('.repeat(levels) + '1');
      same('[{"a":f('.repeat(levels >> 2) + 'x');
    }
  });

  test('JSONTestSuite, the simdjson corpus and the harness fixtures (where present)', (t) => {
    const suite = files(join(CORPUS, 'jts'), (f) => f.endsWith('.json'));
    const simd = files(join(CORPUS, 'simd'), (f) => f.endsWith('.json'));
    const fixtures = files(FIXTURES, (f) => /\.(json|jsonl|ndjson|txt)$/.test(f));
    if (!suite.length && !simd.length && !fixtures.length) return t.skip('no corpus on this host');
    let count = 0;
    for (const f of [...suite, ...simd, ...fixtures]) {
      if (!SLOW && statSync(f).size > 2_000_000) continue;
      const src = readFileSync(f, 'utf8');
      const small = src.length < 20_000;
      same(src, {}, small ? [1, 3] : [997]);
      if (small || SLOW) {
        same(src, { lines: true });
        same(loosen(rng(src.length), src));
      }
      count++;
    }
    assert.ok(count > 300, `files: ${count}`);
  });
});

describe('tape parser: beyond parser.ts', () => {
  test('nesting is limited by memory only', () => {
    const levels = 2_000_000;
    const t = parse('['.repeat(levels) + ']'.repeat(levels));
    assert.equal(t.head.error, null);
    assert.equal(t.head.depth, levels - 1);
    assert.equal(t.count, levels);
    assert.equal(sizeOf(t, 0), levels);
    assert.equal(t.nodes[(levels - 1) * W + 3], levels - 2);
    const o = parse('{"a":'.repeat(levels) + '1' + '}'.repeat(levels));
    assert.equal(o.head.depth, levels);
    assert.equal(o.keys.length, 1);
    assert.equal(keyKindOf(o, levels), KEY_NAME);
    const deep = parse('['.repeat(10) + ']'.repeat(10), { maxDepth: 8 });
    assert.deepEqual(deep.head.error, { p: 9, m: 'Nesting is too deep to parse' });
  });

  test('a big document parses in steps, each stopping at its deadline', () => {
    const src = JSON.stringify(Array.from({ length: 100_000 }, (_, k) => ({ id: k, name: 'item ' + k, tags: ['a', 'b'], n: k / 7 })));
    const { step, at } = parser(src);
    let t: Tape | undefined;
    let steps = 0;
    let pos = 0;
    while (!(t = step(performance.now() + 1))) {
      steps++;
      assert.ok(at() > pos, 'progress');
      pos = at();
    }
    assert.ok(steps > 3, `steps: ${steps}`);
    assert.equal(diffTape(tapeOf(oldParse(src), src), t, src), null);
  });

  test('parses in steps interleave', () => {
    const r = rng(9);
    const docs = Array.from({ length: 40 }, () => (r.chance(0.5) ? genStrict(r, 5) : genLoose(r, 4)));
    const ps = docs.map((d) => parser(d, { maxDepth: MAX_DEPTH }, 1));
    const out: (Tape | undefined)[] = docs.map(() => undefined);
    for (let left = docs.length; left; ) {
      for (let k = 0; k < docs.length; k++) {
        if (out[k]) continue;
        out[k] = ps[k].step(0);
        if (out[k]) left--;
      }
    }
    docs.forEach((d, k) => assert.equal(diffTape(tapeOf(oldParse(d), d), out[k]!, d), null));
  });

  test('values are read back from the source: no string per value', () => {
    const src = '{"a":"x","b":"y\\nz","c":12.50,"d":-0x1F,"e":\'q\',"f":abc ,"g":f("h"),"h":+1}';
    const t = parse(src);
    const values = [];
    for (let k = 1; k < t.count; k++) values.push([valueKindOf(t, k), valueOf(t, k, src)]);
    assert.deepEqual(values, [
      [4, 'x'],
      [6, 'y\nz'],
      [4, '12.50'],
      [6, '-31'],
      [4, 'q'],
      [5, 'abc'],
      [7, 'h'],
      [6, '1'],
    ]);
    assert.deepEqual([...t.extra!.keys()], [7]);
  });
});

test('decodeString with a limit gives the start of the full decode, for every limit', async () => {
  const { decodeString } = await import('../lib/json/decode');
  for (const body of ['plain text', 'a\\nb\\"c\\\\d\\u00e9e\\ud83d\\ude00f\\/g', "\\x41 'quoted' \\\nnext", '']) {
    for (const quote of ['"', "'"]) {
      const src = quote + body + quote + ' tail';
      const full = decodeString(src, 0);
      for (let max = 0; max <= full.length + 2; max++) assert.equal(decodeString(src, 0, max), full.slice(0, max), `${src} ${max}`);
    }
  }
});

test('a long string with escapes from a tape is decoded only when read, and its head without decoding the rest', async () => {
  const { lazyResult } = await import('../lib/json/lazy');
  const text = JSON.stringify('line\n"quoted" é '.repeat(10_000));
  const res = lazyResult(parse(text), text);
  const root = res.root!;
  assert.equal(root._v, undefined, 'not decoded yet');
  assert.equal(root.z!.head(root, 30), JSON.parse(text).slice(0, 30));
  assert.equal(root._v, undefined, 'still not decoded');
  assert.equal(root.v, JSON.parse(text));
});
