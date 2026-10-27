import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { documentMetrics } from '../lib/json/metrics';
import { lazyResult, madeCount } from '../lib/json/lazy';
import { tapeOf } from '../lib/json/tape-send';

test('documentMetrics reads a tape without making its nodes, with the same counts', () => {
  const docs = ['{"a":[1,2,{"b":[]}],"c":{}}', '[]', '{}', '"s"', '[[[[1]]],[2,[3,{"x":{"y":[4]}}]]]', JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ i, a: [i, { b: i }] })))];
  for (const text of docs) {
    const res = parse(text);
    const lazy = lazyResult(tapeOf(res, text), text);
    const want = documentMetrics(text, res);
    const got = documentMetrics(text, lazy, undefined, want.min);
    assert.deepEqual(got, want, text.slice(0, 40));
    assert.equal(madeCount(lazy.root), lazy.root ? 1 : 0);
  }
});
