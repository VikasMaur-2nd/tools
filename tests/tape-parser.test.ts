import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DEPTH, parse as oldParse, type JNode, type ParseOptions } from '../lib/json/parser';
import { parse, parser, warmUp, type TapeOptions } from '../lib/json/tape-parser';
import { KEY_NAME, TRIM_MAX, W, keyKindOf, sizeOf, valueKindOf, valueOf, type Tape } from '../lib/json/tape';
import { tapeOf } from '../lib/json/tape-send';
import { MESSAGES, genDeep, genLoose, mutate, rng } from './oracle/compare';
import { CORPUS, FIXTURES, diffTape, files, genStrict, loosen } from './oracle/tape';

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

/** Parses `src` in steps of `every` values with an expired deadline. */
function stepped(src: string, options: TapeOptions, every: number): Tape {
  const { step, at } = parser(src, options, every);
  let pos = at();
  let back = 0;
  for (let k = 0; ; k++) {
    const t = step(0);
    // (Several top-level values: it starts over at the first one, once; repairing, each of up to 3
    // more passes starts over from the start, and may again for several values.)
    if (at() < pos) assert.ok(++back <= (options.repair ? 7 : 1), `progress went back ${back} times`);
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

const PROSE_OR_QUOTE = /^(Unescaped quote inside a string \(kept in it\)|Text after the JSON value was ignored|Text before the code fence was ignored)$/;

describe('repairs (repair: true): the same in both parsers; documents that parse change only for unescaped quotes and prose', () => {
  const val = (t: Tape, src: string, k = 0): unknown => {
    const kind = t.nodes[k * W] & 7;
    if (kind === 4 || kind === 5) {
      const out: unknown[] = [];
      const names: [string, unknown][] = [];
      for (let c = k + 1; c < k + sizeOf(t, k); c += sizeOf(t, c)) {
        if (kind === 4) out.push(val(t, src, c));
        else names.push([t.keys[t.nodes[c * W + 4]], val(t, src, c)]);
      }
      return kind === 4 ? out : Object.fromEntries(names);
    }
    const v = valueOf(t, k, src);
    return kind === 2 ? Number(v) : v;
  };
  const CASES: [string, string, unknown][] = [
    ['truncated inside a nested string', '{"a": [1, 2], "b": {"c": "hel', { a: [1, 2], b: { c: 'hel' } }],
    ['truncated after a key', '{"a": 1, "b', { a: 1 }],
    ['truncated after a colon', '{"a": 1, "b":', { a: 1, b: null }],
    ['ellipsis in array', '[1, 2, 3, ...]', [1, 2, 3]],
    ['ellipsis in object', '{"a": 1, ...}', { a: 1 }],
    ['ellipsis as a value', '{"a": ..., "b": 2}', { a: null, b: 2 }],
    ['string concatenation', '{"a": "x" + "y" +\n "z"}', { a: 'xyz' }],
    ['missing value', '{"a": , "b": 2}', { a: null, b: 2 }],
    ['missing value before }', '{"a": 1, "b": }', { a: 1, b: null }],
    ['missing closing quote before the next key', '{"a": "b, "c": 1}', { a: 'b', c: 1 }],
    ['missing closing quote at the end of a line', '{"a": "hello\n "b": 2}', { a: 'hello', b: 2 }],
    // (BREAKER-REPORT R7: a single-quoted string left open swallowed the members after it, an apostrophe in one made up a key.)
    ['an apostrophe inside a single-quoted string', `{"name": 'O'Brien', "age": 3}`, { name: "O'Brien", age: 3 }],
    ['a single-quoted string left open before the next member', `{"a": 'x, "b": 2, "c": [1, 2]}`, { a: 'x', b: 2, c: [1, 2] }],
    ['a string left open before an unquoted member', '{"a": "x, b: 1}', { a: 'x', b: 1 }],
    ['a string left open before a member on its line, then another line', `{"a": 'x, 'b': 2\n, "c": 3}`, { a: 'x', b: 2, c: 3 }],
    ['escapes in a string cut at the end of a line', '{"a": "x\\ny\\u0041\n, "b": 1}', { a: 'x\nyA', b: 1 }],
    ['a backslash at the end', '["ab\\', ['ab']],
    ['a cut name', '{"a": 1, "b\n: 2}', { a: 1, b: 2 }],
    ['stringified JSON', '{\\"a\\": \\"b\\"}', { a: 'b' }],
    ['stringified JSON with escapes in it', JSON.stringify('{"a": "x\\ny \\"q\\"", "b": [1, 2.5], "c": {"d": null}}').slice(1, -1), { a: 'x\ny "q"', b: [1, 2.5], c: { d: null } }],
  ];
  test('the repairs pbench scores, and more: values, issues at exact positions', () => {
    for (const [name, src, want] of CASES) {
      assert.ok(oldParse(src).error, `${name}: fails without repairs`);
      const t = same(src, { repair: true }, [1, 3]);
      assert.equal(t.head.error, null, `${name}: ${JSON.stringify(t.head.error)}`);
      assert.deepEqual(val(t, src), want, name);
      assert.ok(t.head.issues.length > 0, name);
    }
    const t = parse('{"a": "b, "c": 1}', { repair: true });
    assert.deepEqual(t.head.issues, [{ p: 8, m: "Missing closing quote: the string was closed before the ','" }]);
    assert.deepEqual(parse('{"a": 1, "b":', { repair: true }).head.issues, [
      { p: 13, m: 'Unexpected end of input: the value is missing (null)' },
      { p: 13, m: "Unexpected end of input: missing '}'" },
    ]);
    assert.deepEqual(parse('[1, ...]', { repair: true }).head.issues, [{ p: 4, m: "Placeholder '...' was skipped" }]);
    assert.deepEqual(parse('{"a": "x" + "y"}', { repair: true }).head.issues, [{ p: 10, m: "Strings joined with '+' (not valid JSON)" }]);
    const sj = '{\\"a\\": \\"b\\"}';
    const st = parse(sj, { repair: true });
    assert.deepEqual(st.head.issues, [{ p: 1, m: 'JSON written as a string (escaped quotes): read with its escapes undone' }]);
    // Offsets are the source's: "b" is \"b\".
    assert.deepEqual([st.nodes[W + 1], st.nodes[W + 2]], [sj.indexOf('\\"b'), sj.lastIndexOf('}')]);
    // What can't be repaired keeps its error.
    assert.deepEqual(parse('{"a": 1 @}', { repair: true }).head.error, { p: 8, m: "Expected ',' or '}' after property value, found '@'" });
  });

  test('unescaped quotes and prose around the value (most parse without repairs, differently)', () => {
    const docs: [string, unknown][] = [
      ['{"a": "say "hi" now"}', { a: 'say "hi" now' }],
      ['["a "b" c", "d"]', ['a "b" c', 'd']],
      ['{"a": 1} that is all', { a: 1 }],
      ['[1, 2]\nThat was the list.', [1, 2]],
      ['{"a": 1} (end)', { a: 1 }],
      ['Here you go:\n```json\n{"a": 1}\n```\nHope this helps', { a: 1 }],
      ['Sure! The data:\n\n  ```\n[true, null]\n  ```', [true, null]],
    ];
    for (const [src, want] of docs) {
      const t = same(src, { repair: true }, [1, 2]);
      assert.equal(t.head.error, null, src);
      assert.deepEqual(val(t, src), want, src);
    }
    assert.deepEqual(parse('{"a": "say "hi" now"}', { repair: true }).head.issues, [
      { p: 11, m: 'Unescaped quote inside a string (kept in it)' },
      { p: 14, m: 'Unescaped quote inside a string (kept in it)' },
    ]);
    assert.deepEqual(parse('{"a": 1} that is all', { repair: true }).head.issues, [{ p: 9, m: 'Text after the JSON value was ignored' }]);
    const llm = 'Here you go:\n```json\n{"a": 1}\n```\nHope this helps';
    assert.deepEqual(parse(llm, { repair: true }).head.issues, [
      { p: 0, m: 'Text before the code fence was ignored' },
      { p: 13, m: 'Markdown code fences are not part of JSON' },
      { p: 34, m: 'Text after the closing code fence was ignored' },
    ]);
    // JSON Lines stay JSON Lines, and so do calls and literals after a value; strings followed by a string or a number end where they end.
    for (const src of ['{"a":1}\n{"a":2}\n[3]', '1\n2\n"x"', '{"a":1}\ntrue\nnull', '{"a":1} cb({"b":2})', '["a" "b", "c" 1]', '{"a":1}\nNaN']) {
      const plain = oldParse(src);
      assert.equal(diffTape(tapeOf(plain, src), same(src, { repair: true }, [1]), src), null, src);
    }
  });

  test(`stringified JSON reads back as the document it was (${cases(3000)} cases)`, () => {
    const r = rng((SEED || 1) + 22);
    let read = 0;
    for (let it = 0, total = cases(3000); it < total; it++) {
      const doc = genStrict(r, 4);
      const src = JSON.stringify(doc).slice(1, -1);
      if (!oldParse(src).error) continue;
      try {
        const t = same(src, { repair: true }, it % 8 === 0 ? [1 + r.int(5)] : []);
        if (t.head.error) continue;
        assert.deepEqual(val(t, src), val(parse(doc), doc));
        read++;
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}\ninput: ${show(src)}`, { cause: e });
      }
    }
    assert.ok(read > cases(1500), `read: ${read}`);
  });

  test(`ordinary JSON holding an escaped quote is never read as JSON written as a string (${cases(4000)} cases)`, () => {
    // (BREAKER-REPORT R3: undoing its escapes cut values apart and made up keys.)
    const AS_STRING = 'JSON written as a string (escaped quotes): read with its escapes undone';
    for (const src of ['{"a":"q\\"x"} @', '{"a": "\\"", "b": ~}', '[{"tag":"a \\"b\\""}, @]', '{"c":"x\\"y\\nd" "e": 1']) {
      for (const t of [same(src, { repair: true }), oldParse(src, { repair: true })]) {
        const issues = 'head' in t ? t.head.issues : t.issues;
        assert.ok(!issues.some((i) => i.m === AS_STRING), `${show(src)}: ${JSON.stringify(issues)}`);
      }
    }
    const r = rng((SEED || 1) + 23);
    for (let it = 0, total = cases(4000); it < total; it++) {
      const doc = JSON.stringify({ s: 'say "hi" ' + it, t: [genStrict(r, 3), 'q"'], u: '\\"' });
      const at = r.int(doc.length + 1);
      const src = doc.slice(0, at) + r.pick(['@', '~', ',', '}', '"', ':', 'x', '\\']) + doc.slice(at);
      const t = same(src, { repair: true });
      assert.ok(!t.head.issues.some((i) => i.m === AS_STRING), `iteration ${it}: ${show(src)}`);
    }
  });

  test(`the same in both parsers; a document that parses without repairs changes only for an unescaped quote or prose (${cases(20000)} cases)`, () => {
    const r = rng((SEED || 1) + 21);
    let repaired = 0;
    let turned = 0;
    for (let it = 0, total = cases(20000); it < total; it++) {
      let src = r.chance(0.5) ? genLoose(r, 1 + r.int(5)) : genStrict(r, 4);
      src = r.chance(0.5) ? mutate(r, src) : loosen(r, src);
      const options = r.chance(0.1) ? { lines: true } : {};
      try {
        const plain = oldParse(src, options);
        const t = same(src, { ...options, repair: true }, it % 16 === 0 ? [1] : it % 16 === 8 ? [1 + r.int(7)] : []);
        // A document that parses without repairs changes only where an unescaped quote or prose is repaired (and never if it has no issues).
        if (!plain.error && diffTape(tapeOf(plain, src), t, src) !== null) {
          assert.ok(plain.issues.length && t.head.issues.some((x) => PROSE_OR_QUOTE.test(x.m)), 'repairs changed a document that parses');
          turned++;
        } else if (plain.error && !t.head.error) repaired++;
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}\ninput: ${show(src)}`, { cause: e });
      }
    }
    assert.ok(repaired > cases(1000) && turned > cases(100), `repaired: ${repaired}, turned: ${turned}`);
  });

  test('loose documents that parse are read as without repairs where their JSON goes on after a quote or around the value', () => {
    // (Missing commas, unquoted words, several values: the repairs for unescaped quotes and prose must not
    // merge values, cut them apart or drop one; see innerQuote() and proseUntil().)
    const docs = [
      '["x" y, "z"]',
      '{a: "x" b: "y"}',
      '{"a": "x" b: "y", "c": "z" d: "w"}',
      '{"name": "Ada" age: 36, "tags": ["a" b, "c"]}',
      '["one" two, "three" four]',
      '{"a": "x" b: 1, "c": 2}',
      '["hi Ada "Ada"", "x"]',
      '{"a": "x\\ny" z: 1}',
      '{"a":1}\nhello\n{"b":2}',
      '"a"\nb\n"c"',
      '{"a":1}\n{"b":2}\nthe end',
      '[1, 2]\n3\nnote',
      'true\nfalse\nnull\nmaybe',
      '{"a": "x"} {"b": "y"} done',
      '{"a":1} // done\n{"b":2}',
      '{"a":1} /* done */',
    ];
    for (const src of docs) {
      const plain = oldParse(src);
      assert.equal(plain.error, null, `${show(src)} parses without repairs`);
      const t = same(src, { repair: true }, [1, 2]);
      assert.deepEqual(val(t, src), val(tapeOf(plain, src), src), show(src));
      assert.ok(!t.head.issues.some((x) => PROSE_OR_QUOTE.test(x.m)), `${show(src)}: ${JSON.stringify(t.head.issues)}`);
    }
    // Neither is text that opens a value before a code fence, nor bytes that aren't text (a binary file),
    // whether or not the document parses.
    for (const src of ['note {"x": 1}\n```json\n{"a": 1}\n```', '{"a": 1}\u0000\u0000\u0000', '{"a": 1} PNG\r\n\u001a\n', '1 ab\ufffdcd', 'x\u0001y\n```json\n{"a": 1}\n```']) {
      const t = same(src, { repair: true });
      assert.ok(!t.head.issues.some((x) => PROSE_OR_QUOTE.test(x.m)), `${show(src)}: ${JSON.stringify(t.head.issues)}`);
    }
    // What they still repair (the lead's examples): prose, and quotes with only words between.
    const kept: [string, unknown][] = [
      ['{"title": "The "Best" Movie", "year": 2020}', { title: 'The "Best" Movie', year: 2020 }],
      ['{"a": "say "hi" now"}', { a: 'say "hi" now' }],
      ['{"q": "it"s", "r": 1}', { q: 'it"s', r: 1 }],
      ['{"a": 1} that is all', { a: 1 }],
      ['{"a": 1}\nHope this helps!\nCheers', { a: 1 }],
      ['Here you go:\n```json\n{"a": 1}\n```\nHope this helps', { a: 1 }],
    ];
    for (const [src, want] of kept) assert.deepEqual(val(same(src, { repair: true }, [1]), src), want, show(src));
  });

  test(`R3 in spirit: what the repairs change in loose documents that parse is only what they say (${cases(6000)} cases)`, () => {
    // Documents as people write them by hand or get them from a model: missing commas, unquoted names and
    // words, quotes in text, several values on lines, prose and code fences around. Each repair is checked
    // against the text itself, not against the parser's code.
    const r = rng((SEED || 1) + 25);
    const WORDS = ['x', 'y', 'Ada', 'it', 'say', 'hi', 'now', 'b', 'note', 'done', 'true', 'null', 'NaN', 'f'];
    const word = () => r.pick(WORDS);
    const text = () => Array.from({ length: 1 + r.int(3) }, () => (r.chance(0.2) ? `"${word()}"` : word())).join(' ');
    const value = (d: number): string => {
      const k = r.int(d > 2 ? 4 : 6);
      if (k === 0) return String(r.int(100));
      if (k === 1) return r.chance(0.3) ? word() : `"${text()}"`;
      if (k === 2) return r.pick(['true', 'null', 'false']);
      if (k === 3) return `"${word()}"`;
      const sep = () => (r.chance(0.2) ? ' ' : r.chance(0.2) ? ',\n' : ', ');
      const items = Array.from({ length: r.int(4) }, () => (k === 4 ? value(d + 1) : `${r.chance(0.3) ? word() : `"${word()}"`}: ${value(d + 1)}`));
      return k === 4 ? `[${items.map((x, j) => (j ? sep() : '') + x).join('')}]` : `{${items.map((x, j) => (j ? sep() : '') + x).join('')}}`;
    };
    /** Members as name@value offset; with `written`, only those whose value has a ':' before it in the text. */
    const members = (t: Tape, written?: string) => {
      const out = new Set<string>();
      for (let k = 0; k < t.count; k++) {
        if (keyKindOf(t, k) !== KEY_NAME) continue;
        const at = t.nodes[k * W + 1];
        if (written !== undefined && !/:[ \t\n\r]*$/.test(written.slice(Math.max(0, at - 8), at))) continue;
        out.add(`${t.keys[t.nodes[k * W + 4]]}@${at}`);
      }
      return out;
    };
    let changed = 0;
    for (let it = 0, total = cases(6000); it < total; it++) {
      let src = Array.from({ length: 1 + (r.chance(0.3) ? r.int(3) : 0) }, () => value(0)).join(r.pick(['\n', ' ', '\n\n']));
      if (r.chance(0.2)) src += r.pick([' ', '\n']) + text() + r.pick(['', '.', '!']);
      if (r.chance(0.1)) src = `${text()}:\n\`\`\`json\n${src}\n\`\`\`` + (r.chance(0.5) ? `\n${text()}` : '');
      const plain = oldParse(src);
      if (plain.error) continue;
      try {
        const t = same(src, { repair: true }, it % 32 === 0 ? [1] : []);
        assert.equal(t.head.error, null);
        if (diffTape(tapeOf(plain, src), t, src) === null) continue;
        changed++;
        let dropped = false;
        for (const x of t.head.issues) {
          if (x.m === 'Unescaped quote inside a string (kept in it)') {
            // A word follows it, and the next quote on its line comes with no JSON in between.
            assert.match(src.slice(x.p + 1), /^[ \t]*[A-Za-z_$\u0080-￿][^"\n\r,:[\]{}\\]*"/, `quote at ${x.p}`);
          } else if (x.m === 'Text after the JSON value was ignored') {
            const rest = src.slice(x.p);
            assert.ok(!/[[{]/.test(rest) && !/(^|[\n\r])[ \t]*(["'\d-]|true|false|null)/.test(rest), `ignored: ${show(rest)}`);
            // What comes before it reads as without repairs (unless a quote in it was repaired too).
            if (!t.head.issues.some((y) => y.m.startsWith('Unescaped quote'))) {
              const first = plain.multi ? (plain.root!.v as JNode[])[0] : plain.root!;
              assert.deepEqual(val(t, src), val(tapeOf({ ...plain, root: first, multi: false }, src), src));
            }
            dropped = true;
          } else if (x.m === 'Text before the code fence was ignored') {
            assert.ok(!/[[{]/.test(src.slice(x.p, src.indexOf('```', x.p))), `ignored before the fence at ${x.p}`);
            dropped = true;
          }
        }
        // No member the text writes (a name, then ':' before its value) is lost to a merged string: members go
        // only with ignored text. (Names the reading without repairs made up from a word after a quote may go.)
        if (!dropped) {
          const kept = members(t);
          for (const m of members(tapeOf(plain, src), src)) assert.ok(kept.has(m), `member ${m} lost`);
        }
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}\ninput: ${show(src)}`, { cause: e });
      }
    }
    assert.ok(changed > cases(100), `changed: ${changed}`);
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

  test('warmUp() leaves nothing behind, also in the middle of a parse in steps', () => {
    const src = '{"a":[1,"x",{"b":null}],"c":true}';
    const p = parser(src, {}, 1);
    p.step(0);
    warmUp();
    let t: Tape | undefined;
    while (!(t = p.step(0)));
    assert.equal(diffTape(tapeOf(oldParse(src), src), t, src), null);
    warmUp();
    same(src, {}, [1]);
  });

  test('a tape of up to TRIM_MAX bytes keeps no room to grow; a bigger one keeps it (no copy)', () => {
    const stepped = (src: string, options: TapeOptions) => {
      const p = parser(src, options, 1);
      let t: Tape | undefined;
      while (!(t = p.step(0)));
      return t;
    };
    const r = rng((SEED || 1) + 31);
    for (let it = 0; it < cases(300); it++) {
      const src = r.chance(0.5) ? genStrict(r, 5) : mutate(r, genLoose(r, 4));
      const options = r.chance(0.2) ? { lines: true } : r.chance(0.5) ? { repair: true } : {};
      for (const t of [parse(src, options), stepped(src, options)]) assert.equal(t.nodes.length, t.count * W, show(src));
    }
    // Around the growth steps (the first tape has room for 4,096 nodes).
    for (const n of [1, 2, 4095, 4096, 4097, 9000, 100_000]) {
      const t = parse('[' + '0,'.repeat(n - 1) + '0]');
      assert.equal(t.count, n + 1);
      assert.equal(t.nodes.length, t.count * W);
    }
    const n = Math.ceil(TRIM_MAX / 4 / W) + 1000;
    const big = parse('[' + '0,'.repeat(n - 2) + '0]');
    assert.equal(big.count, n);
    assert.ok(big.nodes.length > big.count * W, `${big.nodes.length} for ${big.count} nodes`);
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
