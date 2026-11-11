import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { documentMetrics } from '../lib/json/metrics';
import { lazyResult, madeCount } from '../lib/json/lazy';
import { tapeOf } from '../lib/json/tape-send';
import { HOLDS_JSON_PARSE_MAX, holdsEscapedJson, holdsJson, unescapeText } from '../lib/engine/rules';

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

test('the Unescape banner: only for a string that holds JSON, judged by its ends past HOLDS_JSON_PARSE_MAX', () => {
  const unescape = (text: string) => {
    const res = parse(text);
    const want = documentMetrics(text, res).unescape;
    // (From a tape too: the same answer, made without decoding a long string.)
    assert.equal(documentMetrics(text, lazyResult(tapeOf(res, text), text)).unescape, want, text.slice(0, 40));
    return want ?? false;
  };
  for (const text of ['"{\\"a\\": [1, 2]}"', '"[1,2]"', '"  {\\"a\\":1}\\n "', '"[]"']) assert.equal(unescape(text), true, text);
  // Prose that starts with a bracket, or JSON with more after it: no banner.
  for (const text of ['"[citation needed]"', '"[1, 2] and more"', '"{not json}"', '"[1, 2"', '"ordinary text"', '"{\\"a\\":1}}"']) assert.equal(unescape(text), false, text);
  // A long string is judged by its first and last characters other than whitespace (escaped or not).
  const big = (inner: string) => JSON.stringify('[' + '1,'.repeat(HOLDS_JSON_PARSE_MAX / 2) + inner);
  assert.equal(unescape(big('1]  \n\t')), true);
  assert.equal(unescape(big('1] and more')), false);
  assert.equal(unescape(big('1')), false);
  assert.equal(holdsJson('[1, 2] and more'), false);
  assert.equal(holdsJson(' {"a": 1} '), true);
  assert.equal(holdsJson('[', 93), true, 'the start and the last character given: the pair decides');
});

test('Unescape reads escaped JSON pasted without quotes, raw tabs and line breaks included', () => {
  assert.equal(unescapeText('{\\"a\\":\t1}'), '{"a":\t1}');
  assert.equal(unescapeText('{\\"a\\":1,\r\n\\"b\\":2}'), '{"a":1,\r\n"b":2}');
  assert.equal(unescapeText('  "{\\"a\\":\\n1}"\n'), '{"a":\n1}');
  assert.equal(unescapeText('{"a":1}'), null, 'a quote not escaped');
  assert.equal(unescapeText('{\\"a\\": \\x41}'), null, 'an escape JSON lacks');
  assert.equal(holdsEscapedJson('{\\"a\\":\t1,\r\n\\"b\\":2}'), true);
  assert.equal(holdsEscapedJson('[\\"citation\\" needed]'), false);
});
