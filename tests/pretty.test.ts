import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, type ParseOptions } from '../lib/json/parser';
import { byteLength, stringify, stringifyNodes } from '../lib/json/format';
import { lazyResult, madeCount, nodeAtIndex } from '../lib/json/lazy';
import { codeIndexer } from '../lib/json/code-index';
import { PrettyText, minifiedTapeBytes, prettyIndexer } from '../lib/json/pretty';
import { tapeOf } from '../lib/json/tape-send';
import { genLoose, mutate, rng } from './oracle/compare';
import { CORPUS, FIXTURES, files, genStrict, loosen } from './oracle/tape';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SLOW = !!process.env.TEST_SLOW;

const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

/**
 * The pretty text read off the tape is format.ts stringify's, character for character, and its index is
 * what codeIndexer makes of that text; slices and lines read back the same.
 */
function same(src: string, indent: string, options: ParseOptions = {}, r = rng(src.length)) {
  const res = parse(src, options);
  if (!res.root) return false;
  const tape = tapeOf(res, src);
  let want: string;
  try {
    want = stringify(res.root, indent);
  } catch (e) {
    // Too long to write: nesting so deep its indentation alone is huge, which has no pretty lines either.
    assert.ok(e instanceof RangeError && res.depth * indent.length > 10_000, String(e));
    assert.equal(prettyIndexer(tape, src, indent)(Infinity), null);
    return true;
  }
  // In steps (an expired deadline each time) and in one go: the same.
  const run = prettyIndexer(tape, src, indent);
  let index = run(0);
  for (let k = 0; index === undefined; k++) {
    assert.ok(k < tape.count + 8, 'no progress');
    index = run(0);
  }
  assert.ok(index, `no pretty lines for ${show(src)}`);
  assert.deepEqual(index, prettyIndexer(tape, src, indent)(Infinity));
  const want_ = codeIndexer(want)(Infinity)!;
  const where = `${show(src)} indent ${JSON.stringify(indent)} ${JSON.stringify(options)}`;
  assert.equal(index.length, want.length, `length: ${where}`);
  assert.deepEqual(Array.from(index.starts), Array.from(want_.starts), `starts: ${where}`);
  assert.deepEqual(Array.from(index.close), Array.from(want_.close), `close: ${where}`);
  assert.deepEqual(Array.from(index.depth), Array.from(want_.depth), `depth: ${where}`);
  assert.equal(index.maxLen, want_.maxLen, `maxLen: ${where}`);
  const lines = want.split('\n');
  assert.deepEqual(Array.from(index.ascii), lines.map((l) => (/^[\x20-\x7e]*$/.test(l) ? 1 : 0)), `ascii: ${where}`);
  const text = new PrettyText(tape, src, indent, index);
  const got = text.slice();
  if (got !== want) {
    let k = 0;
    while (got[k] === want[k]) k++;
    assert.fail(`text differs at ${k}: want ${show(want.slice(k - 20, k + 40))}, got ${show(got.slice(k - 20, k + 40))}: ${where}`);
  }
  // As Blob parts, in steps (an expired deadline each time), small parts and one: the same text.
  for (const size of [1, 64, 1 << 20]) {
    const run = text.parts(size);
    let parts = run(0);
    for (let k = 0; parts === undefined; k++) {
      assert.ok(k < want.length + 8, 'no progress');
      parts = run(0);
    }
    assert.equal(parts.join(''), want, `parts of ${size}: ${where}`);
  }
  for (let k = 0; k < 20; k++) {
    const a = r.int(want.length + 1);
    const b = a + r.int(Math.min(200, want.length - a + 1));
    assert.equal(text.slice(a, b), want.slice(a, b), `slice(${a}, ${b}): ${where}`);
  }
  return true;
}

const CASES = [
  '1', '"a"', 'null', 'true', 'false', '[]', '{}', '[[]]', '[{}]', '{"a":{}}', '{"a":[]}', '[1]', '{"a":1}',
  '[1,2,[3,[4,[]],{}],{"b":{"c":null}}]',
  '{"a":1,"b":{"c":[true,false,null,"x"],"d":{}},"a":2}',
  '{"":"","\\u0041":"\\u0042","\\"q\\"":"\\\\","é":"😀","tab\\t":"line\\nbreak"}',
  '["\\ud800", "\\udc00x", "a\\ud83d\\ude00b", "\\u0000\\u001f"]',
  '[1e10, -0, 0.5, 1E+2, 123456789012345678901234567890, -1.0e-7]',
  '{"k":[{"x":[[[1]]]}],"z":"  "}',
  '  {\n  "a" : [ 1 , 2 ] ,\r\n "b" : "c"\t}  ',
];

test('the pretty text read off the tape is stringify’s, and its index codeIndexer’s', () => {
  for (const indent of ['  ', '    ', '\t', ' ']) for (const src of CASES) assert.ok(same(src, indent), src);
});

test('loose and repaired documents, JSON Lines, and strings that need escaping as written', () => {
  const loose = [
    "{a: 'its', b: \"x\", 'c': 'q', d: “curly”, e: 'say \"hi\"'}",
    '{"a": 0x1F, "b": .5, "c": +1, "d": Infinity, "e": NaN, "f": 1.}',
    '// c\n{"a": [1, 2,], /* x */ "b": True, "c": None,}',
    '{"a": "x\ty", "b": "\u0001"}',
    '{"a":3,"b":"unfinish',
    '{"a": 1, "b": }',
    '[1 2 3]',
    '"{\\"a\\": 1}"',
    'Here is the JSON:\n```json\n{"a": [1, {"b": 2}]}\n```\nHope it helps',
  ];
  for (const src of loose) assert.ok(same(src, '  ', { repair: true }), src);
  assert.ok(same('{"a":1}\n{"a":[2,{}]}\n[]\n"x"\n', '  ', { lines: true }));
  assert.ok(same('{"a":1}\r\n{"b":2}', '    ', { lines: true }));
});

test('fuzzed strict, loose and mutated documents', () => {
  const r = rng(SEED + 7);
  const n = SLOW ? 20_000 : 1_500;
  let checked = 0;
  for (let k = 0; k < n; k++) {
    const indent = ['  ', '    ', '\t'][k % 3];
    const strict = genStrict(r, 6);
    if (same(strict, indent, {}, r)) checked++;
    if (same(loosen(r, strict), indent, { repair: true }, r)) checked++;
    if (same(genLoose(r), indent, { repair: true }, r)) checked++;
    if (same(mutate(r, strict), indent, { repair: true }, r)) checked++;
  }
  assert.ok(checked > n * 2, `checked ${checked}`);
});

test('JSONTestSuite, the simdjson corpus and the harness fixtures (where present)', (t) => {
  const all = [...files(join(CORPUS, 'jts'), (f) => f.endsWith('.json')), ...files(join(CORPUS, 'simd'), (f) => f.endsWith('.json')), ...files(FIXTURES, (f) => /\.(json|jsonl|ndjson)$/.test(f))];
  if (!all.length) return t.skip('no corpus on this host');
  let count = 0;
  for (const f of all) {
    if (statSync(f).size > (SLOW ? 20_000_000 : 1_000_000)) continue;
    const src = readFileSync(f, 'utf8');
    same(src, '  ', { lines: /\.(jsonl|ndjson)$/.test(f), repair: true });
    count++;
  }
  assert.ok(count > 300, `files: ${count}`);
});

test('nesting too deep to indent, and no document, give no pretty lines', () => {
  const deep = '['.repeat(6_000) + ']'.repeat(6_000);
  const res = parse(deep);
  assert.equal(prettyIndexer(tapeOf(res, deep), deep, '  ')(Infinity), null);
  const empty = parse('');
  assert.equal(prettyIndexer(tapeOf(empty, ''), '', '  ')(Infinity), null);
});

/**
 * stringify of a tree read from a tape (written off the tape, see pretty.ts writeTape) is the text written from
 * its nodes, minified and indented, for the whole document and for subtrees; and it makes no node.
 */
function written(src: string, options: ParseOptions = {}, r = rng(src.length)) {
  const res = parse(src, options);
  if (!res.root) return false;
  const tape = tapeOf(res, src);
  const root = lazyResult(tape, src).root!;
  const count = tape.count;
  // (Nesting so deep its indentation alone is longer than a string can be: both throw, as formatDoc never asks.)
  const write = (f: () => string) => {
    try {
      return f();
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      return 'RangeError';
    }
  };
  const indents = ['', '  ', '\t'];
  const whole = indents.map((indent) => write(() => stringify(root, indent)));
  assert.equal(madeCount(root), 1, `no node made: ${show(src)}`);
  if (whole[0] !== 'RangeError') assert.equal(minifiedTapeBytes(tape, src), byteLength(whole[0]), `minified bytes: ${show(src)}`);
  for (const [j, indent] of indents.entries()) {
    const where = `${show(src)} indent ${JSON.stringify(indent)} ${JSON.stringify(options)}`;
    assert.equal(whole[j], write(() => stringifyNodes(res.root!, indent)), `whole document: ${where}`);
    for (let k = 0; k < 3; k++) {
      const n = nodeAtIndex(root, r.int(count))!;
      assert.equal(write(() => stringify(n, indent)), write(() => stringifyNodes(n, indent)), `subtree at ${n.zi}: ${where}`);
    }
  }
  return true;
}

test('a tree read from a tape is written from the tape exactly as from its nodes, making none', () => {
  for (const src of CASES) assert.ok(written(src), src);
  const loose = ["{a: 'its', b: \"x\", d: “curly”}", '{"a": 0x1F, "b": .5, "c": +1, "d": NaN}', '// c\n{"a": [1, 2,], "b": True,}', '{"a":3,"b":"unfinish', '[1 2 3]', '"{\\"a\\": 1}"', '[1][2]{"a":3}'];
  for (const src of loose) assert.ok(written(src, { repair: true }), src);
  assert.ok(written('{"a":1}\n{"a":[2,{}]}\n[]\n"x"\n', { lines: true }));
  const r = rng(SEED + 11);
  for (let k = 0; k < (SLOW ? 6_000 : 600); k++) {
    const strict = genStrict(r, 6);
    written(strict, {}, r);
    written(loosen(r, strict), { repair: true }, r);
    written(genLoose(r), { repair: true }, r);
    written(mutate(r, strict), { repair: true }, r);
  }
  for (const f of [...files(join(CORPUS, 'jts'), (x) => x.endsWith('.json')), ...files(FIXTURES, (x) => /\.(json|jsonl|ndjson)$/.test(x))]) {
    if (statSync(f).size > 1_000_000) continue;
    written(readFileSync(f, 'utf8'), { lines: /\.(jsonl|ndjson)$/.test(f), repair: true });
  }
});
