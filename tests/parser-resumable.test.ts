import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARR, JNode, MAX_DEPTH, parse, parser, type ParseOptions, type ParseResult } from '../lib/json/parser';
import { stringify } from '../lib/json/format';
import { parseRecursive } from './oracle/parser';
import { MESSAGES, diffResults, genDeep, genLoose, mutate, rng } from './oracle/compare';

// FUZZ_SEED=<n> / FUZZ_SCALE=<x> (env) re-run with another seed / more cases, as in parser.test.ts.
const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = Number(process.env.FUZZ_SCALE) || 1;
const cases = (n: number) => Math.round(n * SCALE);

const show = (s: string) => {
  const j = JSON.stringify(s.length > 400 ? s.slice(0, 400) : s).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s.length > 400 ? `${j}… (${s.length} chars)` : j;
};

/** The oracle overflowed: the one difference the new parser is meant to have. */
const tooDeepForOracle = (r: ParseResult) => r.error?.m === 'Nesting is too deep to parse';

/** Runs `step` with an expired deadline until it finishes: it stops after each value (`every` = 1). */
function stepwise(src: string, options: ParseOptions = {}): { res: ParseResult; steps: number } {
  const { step, at: pos } = parser(src, options, 1);
  let at = pos();
  let back = 0;
  for (let steps = 1; ; steps++) {
    const res = step(0);
    // (Several top-level values: it starts over at the first one, once.)
    if (pos() < at) assert.ok(++back === 1, 'progress went back twice');
    at = pos();
    if (res) {
      assert.equal(step(0), res, 'a finished parse keeps its result');
      return { res, steps };
    }
    assert.ok(steps < 4 * src.length + 16, 'no progress');
  }
}

function same(src: string, options: ParseOptions = {}, sliced = false): ParseResult {
  const want = parseRecursive(src, options);
  const got = parse(src, options);
  if (tooDeepForOracle(want)) {
    assert.ok(got.error?.m !== 'Nesting is too deep to parse', 'the resumable parser has no stack to overflow');
    return got;
  }
  const d = diffResults(want, got);
  if (d) assert.fail(`one-shot differs from the recursive parser: ${d}\ninput: ${show(src)} ${JSON.stringify(options)}`);
  if (sliced) {
    const { res } = stepwise(src, options);
    const ds = diffResults(want, res);
    if (ds) assert.fail(`stepwise differs: ${ds}\ninput: ${show(src)} ${JSON.stringify(options)}`);
  }
  return got;
}

describe('resumable parser: identical to the recursive parser', () => {
  test(`random loose, broken and multi-value documents (seed ${SEED || 1}, ${cases(40000)} cases) reach every message`, () => {
    const r = rng(SEED || 1);
    const seen = new Set<number>();
    const note = (m: string) => {
      for (let k = 0; k < MESSAGES.length; k++) if (MESSAGES[k].test(m)) seen.add(k);
    };
    let errors = 0;
    let roots = 0;
    for (let it = 0, total = cases(40000); it < total; it++) {
      let src = genLoose(r, 1 + r.int(6));
      if (r.chance(0.4)) src = mutate(r, src);
      const options = r.chance(0.1) ? { lines: true } : {};
      let res: ParseResult;
      try {
        res = same(src, options, it % 8 === 0);
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
      for (const x of res.issues) note(x.m);
      for (const x of res.warnings) note(x.m);
      if (res.error) {
        note(res.error.m);
        errors++;
      } else if (res.root) roots++;
    }
    const missing = MESSAGES.map((m, k) => (seen.has(k) ? '' : String(m))).filter(Boolean);
    assert.deepEqual(missing, [], 'messages the corpus never produced');
    assert.ok(errors > cases(4000) && roots > cases(4000), `errors ${errors}, roots ${roots}`);
  });

  test(`stepwise: stopping after every value gives the one-shot result (${cases(6000)} cases)`, () => {
    const r = rng((SEED || 1) + 7);
    let stopped = 0;
    for (let it = 0, total = cases(6000); it < total; it++) {
      let src = genLoose(r, 1 + r.int(5));
      if (r.chance(0.4)) src = mutate(r, src);
      const options = r.chance(0.1) ? { lines: true } : {};
      const want = parse(src, options);
      const { res, steps } = stepwise(src, options);
      const d = diffResults(want, res);
      if (d) assert.fail(`iteration ${it}: ${d}\ninput: ${show(src)}`);
      // (One value per step; JSON Lines go over their first value twice.)
      if (steps >= want.nodes) stopped++;
    }
    assert.ok(stopped > cases(5000), `stopped at every value in ${stopped} documents`);
  });

  test('more issues and duplicate keys than the cap (500)', () => {
    const r = rng(5);
    const docs = [
      '[' + 'a\n'.repeat(5000) + ']',
      '{' + Array.from({ length: 1200 }, (_, k) => `"k${k % 300}": ${k}`).join(',') + '}',
      '{' + Array.from({ length: 900 }, () => `'dup': 1,`).join('') + '}',
      Array.from({ length: 800 }, (_, k) => `{"a":${k},"a":1} // c`).join('\n'),
      Array.from({ length: 300 }, () => genLoose(r, 3)).join('\n'),
    ];
    for (const src of docs) {
      same(src, {}, true);
      same(src, { lines: true }, true);
    }
  });

  test('JSON Lines: re-parsed into one array, with a fence, separators and the lines option', () => {
    const docs = ['1\n2\n3', '{"a":1}\n{"a":2,"a":3}\n', '```json\n1\n2\n```\nprose', '1;2,3', '[1]\n[2', '{"a":[1,2]}', '', '   ', '\ufeff 1 2', '1 }', '1 ]] x', '"a" "b" // c\n"c"'];
    for (const src of docs) {
      same(src, {}, true);
      same(src, { lines: true }, true);
    }
  });

  test('deep documents the recursive parser can still handle', () => {
    const r = rng(11);
    for (let it = 0; it < 300; it++) {
      const src = genDeep(r, 1 + r.int(1200));
      same(src, {}, it % 4 === 0);
    }
  });

  test('example documents in public/', () => {
    const dir = join(__dirname, '..', '..', 'public', 'examples');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      same(src, {}, true);
      same(mutate(rng(f.length), src), {}, true);
    }
  });
});

describe('resumable parser: deep nesting', () => {
  test('nesting is limited by MAX_DEPTH, not the call stack', () => {
    const levels = MAX_DEPTH + 1;
    const src = '['.repeat(levels) + ']'.repeat(levels);
    const res = parse(src);
    assert.equal(res.error, null);
    assert.equal(res.depth, MAX_DEPTH);
    assert.equal(res.nodes, levels);
    assert.equal(res.exact, true);
    assert.equal(stringify(res.root!, ''), src);
    const objects = '{"a":'.repeat(MAX_DEPTH) + '1' + '}'.repeat(MAX_DEPTH);
    const o = parse(objects);
    assert.equal(o.depth, MAX_DEPTH);
    assert.equal(stringify(o.root!, ''), objects);
    // Each node keeps its container, depth and key.
    let n: JNode = o.root!;
    while (n.t >= ARR) {
      const c = (n.v as JNode[])[0];
      assert.ok(c.u === n && c.d === n.d + 1 && c.key === 'a');
      n = c;
    }
    // One level more is refused where it starts, in one go or in steps.
    const deeper = '['.repeat(levels + 1) + ']'.repeat(levels + 1);
    const want = { p: levels, m: 'Nesting is too deep to parse' };
    assert.deepEqual(parse(deeper).error, want);
    assert.deepEqual(stepwise(deeper).res.error, want);
  });

  test('unclosed and broken deep documents are repaired or rejected like shallow ones', () => {
    const levels = MAX_DEPTH;
    const open = parse('['.repeat(levels) + '1');
    assert.ok(open.root);
    assert.equal(open.issues.length, 500);
    assert.equal(open.issues[0].m, "Unexpected end of input: missing ']'");
    const value = parse('{"a":'.repeat(levels));
    assert.equal(value.root, null);
    assert.deepEqual(value.error, { p: levels * 5, m: 'Unexpected end of input: expected a value' });
    assert.equal(value.nodes, levels + 1);
    const calls = parse('f('.repeat(levels) + '1');
    assert.equal(calls.root?.v, '1');
    assert.equal(calls.nodes, 1);
    assert.equal(calls.issues.length, 500);
    // Same results, a level at a time, as the recursive parser gives at a depth it can reach.
    for (const src of ['['.repeat(500), '{"a":'.repeat(500), 'f('.repeat(500) + '1', '[{"a":f('.repeat(300) + 'x']) same(src, {}, true);
  });

  test('a deep document parses in steps', () => {
    const src = '[{"k":'.repeat(50_000) + 'null' + '}]'.repeat(50_000);
    const { step } = parser(src, {}, 64);
    let res: ParseResult | undefined;
    let steps = 0;
    while (!(res = step(0))) steps++;
    assert.ok(steps > 1000);
    assert.equal(diffResults(parse(src), res), null);
  });
});

describe('resumable parser: steps', () => {
  test('a step stops at its deadline and progress moves forward', () => {
    const src = JSON.stringify(Array.from({ length: 200_000 }, (_, k) => ({ id: k, name: 'item ' + k, tags: ['a', 'b'] })));
    const { step, at: pos } = parser(src);
    let res: ParseResult | undefined;
    let steps = 0;
    let at = 0;
    while (!(res = step(performance.now() + 2))) {
      steps++;
      assert.ok(pos() > at, 'progress');
      at = pos();
    }
    assert.ok(steps > 3, `steps: ${steps}`);
    assert.equal(pos(), src.length);
    assert.equal(diffResults(parseRecursive(src), res), null);
  });

  test('an error ends the parse; later calls return the same result', () => {
    const { step } = parser('[1, 2, @]', {}, 1);
    let res: ParseResult | undefined;
    while (!(res = step(0)));
    assert.deepEqual(res.error, { p: 7, m: "Unexpected '@': expected a value" });
    assert.equal(step(Infinity), res);
  });

  test('empty and whitespace-only input finish in the first step', () => {
    for (const src of ['', '  \n', '\ufeff', '// only a comment', '```json\n  ']) {
      const res = parser(src, {}, 1).step(0);
      assert.ok(res);
      assert.equal(diffResults(parseRecursive(src), res), null);
    }
  });
});
