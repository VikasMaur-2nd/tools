import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../lib/json/tape-parser';
import { lf } from '../lib/engine/doc';
import { Skeleton, DONE, FAIL, NEED } from '../lib/huge/skeleton';
import { genStrict, loosen } from './oracle/tape';
import { rng } from './oracle/compare';

const mod = new WebAssembly.Module(readFileSync(join(__dirname, '..', '..', 'lib', 'huge', 'huge.wasm')));
const enc = new TextEncoder();

const source = (b: Uint8Array) => ({ size: b.length, read: (at: number, len: number) => b.subarray(at, at + len) });

function skeleton(doc: string, window = 64) {
  const b = enc.encode(doc);
  const s = new Skeleton(mod);
  assert.ok(s.start(source(b), { window }));
  const r = s.go(window);
  return { r, stats: s.stats(), fail: s.failPos, why: s.why };
}

test('smoke: strict documents agree with the JS tape parser', () => {
  const r = rng(1);
  for (let k = 0; k < 2000; k++) {
    const doc = genStrict(r, 5);
    const text = lf(doc);
    const js = parse(text);
    const strict = !js.head.error && !js.head.issues.length;
    for (const window of [64, 128, 4096]) {
      const got = skeleton(doc, window);
      if (strict) {
        assert.equal(got.r, DONE, `not done: ${JSON.stringify(doc)} window ${window} why ${got.why} at ${got.fail}`);
        assert.equal(got.stats[1], js.head.nodes, `nodes ${JSON.stringify(doc)}`);
        assert.equal(got.stats[4], js.head.depth, `depth ${JSON.stringify(doc)}`);
      } else {
        assert.equal(got.r, FAIL, `not failed: ${JSON.stringify(doc)}`);
      }
    }
  }
});

test('smoke: loose documents fail', () => {
  const r = rng(2);
  for (let k = 0; k < 2000; k++) {
    const doc = loosen(r, genStrict(r, 4));
    const js = parse(lf(doc));
    // (Several top-level values are JSON Lines here: the parser's only issue then is that they're several.)
    const strict = !js.head.error && js.head.issues.every((x) => x.m === 'Multiple top-level values (wrapped in an array)');
    for (const window of [64, 192]) {
      const got = skeleton(doc, window);
      assert.notEqual(got.r, NEED);
      if (strict) assert.equal(got.r, DONE, `should pass: ${JSON.stringify(doc)} window ${window} why ${got.why} at ${got.fail}`);
      else assert.equal(got.r, FAIL, `should fail: ${JSON.stringify(doc)} window ${window}`);
    }
  }
});
