import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCodeChange, codeChange, codeChanger, codeIndexer } from '../lib/json/code-index';
import { documentMetrics } from '../lib/json/metrics';
import { byteLength, formatDoc, minifiedBytes } from '../lib/json/format';
import { parse } from '../lib/json/parser';

test('code index preserves empty and trailing lines and nested fold pairs', () => {
  for (const text of ['', 'one', 'one\n', '\n\n', '{\n  "a": [\n    1,\n    2\n  ]\n}\n']) {
    const index = codeIndexer(text)(Infinity)!;
    const lines = text ? text.split('\n') : [];
    assert.equal(index.starts.length, lines.length);
    for (let i = 0; i < lines.length; i++) assert.equal(text.slice(index.starts[i], i + 1 < lines.length ? index.starts[i + 1] - 1 : text.length), lines[i]);
    assert.equal(index.maxLen, Math.max(0, ...lines.map((line) => line.length)));
  }
  const index = codeIndexer('{\n  "a": [\n    1,\n    2\n  ]\n}')(Infinity)!;
  assert.deepEqual([...index.close], [5, 4, -1, -1, -1, -1]);
  assert.equal(index.depth[1], 1);
});

test('code index resumes across growing buffers and container boundaries', () => {
  const text = '[\n' + Array.from({ length: 12000 }, (_, i) => `  {\n    "id": ${i}\n  }`).join(',\n') + '\n]';
  const step = codeIndexer(text);
  let calls = 0;
  let result;
  while (!(result = step(0))) calls++;
  assert.ok(calls > 20);
  const full = codeIndexer(text)(Infinity)!;
  assert.deepEqual(result, full);
  assert.equal(result.close[0], 36001);
});

test('worker size metrics match formatted UTF-8 output for every indent', () => {
  for (const text of ['{}', '42', '{"é":["😀",{"wide":12345678901234567890,"k":-0}],"empty":[]}', '{a:1,b:[2,3,]}', '{"a":1}\n{"b":2}']) {
    const res = parse(text);
    const metrics = documentMetrics(text, res);
    assert.equal(metrics.bytes, byteLength(text));
    assert.equal(metrics.min, byteLength(formatDoc(text, res, '')));
    for (const indent of ['  ', '    ', '\t']) {
      assert.equal(metrics.min + metrics.extra + metrics.units * indent.length, byteLength(formatDoc(text, res, indent)));
    }
  }
});

test('the minified size of strict JSON, counted without minifying, matches the minified output', () => {
  const samples = [
    '{}', '[]', '42', '"a b"', ' { "a" : [ 1 , 2 ] } ', '{\r\n\t"k": "tab\\t and \\" quote",\r\n\t"v": [1e5, -0.5, true, null]\r\n}',
    JSON.stringify({ é: ['😀 東京', { 'a "b"': 'x\\y', s: '   spaces   ' }], big: 12345678901234567890, n: [1.0, 2.50] }, null, 2),
    '{"z":["\\u0061\\ud800",1.20e+9],"a":1,"a":900719925474099312345}',
    '{ "esc": "\\u00e9\\n\\t\\/", "pair": "\\ud83d\\ude00", "raw": "😀", "ctl": "\\u0001" }',
    '[' + Array.from({ length: 300 }, (_, i) => `{"id": ${i}, "name": "Zoë ${i}\\n", "tags": [ "a" , "b" ]}`).join(' ,\n ') + ']',
  ];
  for (const text of samples) {
    const res = parse(text);
    assert.ok(res.root && !res.error && !res.issues.length, text.slice(0, 40));
    assert.equal(minifiedBytes(text, byteLength(text)), byteLength(formatDoc(text, res, '')), text.slice(0, 40));
  }
});

test('output changes keep only disjoint, exact prefixes and suffixes', () => {
  for (const [before, after, expected] of [
    ['abc', 'abc', { prefix: 3, suffix: 0 }],
    ['abc', 'axbc', { prefix: 1, suffix: 2 }],
    ['a\nb\nc', 'a\nc', { prefix: 2, suffix: 1 }],
    ['', 'new', { prefix: 0, suffix: 0 }],
  ] as const) assert.deepEqual(codeChange(before, after), expected);
  const before = 'prefix'.repeat(2000) + 'x' + 'suffix'.repeat(2000);
  const after = before.replace('x' + 'suffix', 'y' + 'suffix');
  assert.deepEqual(codeChange(before, after), { prefix: 12000, suffix: 12000 });
});

test('output changes found in steps match the one-pass comparison', () => {
  const body = 'é😀東京 "k": [1, 2],\n'.repeat(60000);
  for (const [before, after] of [
    [body, body],
    [body, 'x' + body],
    [body, body + 'x'],
    [body, body.slice(0, 500000) + 'ZQX' + body.slice(500000)],
    [body, body.slice(0, 700001) + body.slice(700005)],
    ['', body],
    [body, ''],
    ['short', body],
  ] as const) {
    const step = codeChanger(before, after);
    let calls = 0;
    let found;
    while (!(found = step(0))) calls++;
    assert.deepEqual(found, codeChange(before, after));
    if (before.length > 1e6 && after.length > 1e6) assert.ok(calls > 2, 'it yields between steps');
    assert.equal(applyCodeChange(before, after.slice(found.prefix, after.length - found.suffix), found), after);
  }
});

test('output patches reconstruct insertions, removals and Unicode edits exactly', () => {
  const before = 'head\n' + 'é😀東京 abc\n'.repeat(800) + 'tail';
  for (let i = 0; i <= before.length; i += 37) {
    for (const insert of ['', 'x', '😀\n']) {
      const after = before.slice(0, i) + insert + before.slice(i + 3);
      const change = codeChange(before, after);
      const patch = after.slice(change.prefix, after.length - change.suffix);
      assert.equal(applyCodeChange(before, patch, change), after);
    }
  }
  assert.equal(applyCodeChange(before, '', { prefix: before.length, suffix: 0 }), before);
});

test('worker metrics preserve the nested JSON string hint without a materialized root', () => {
  const src = JSON.stringify('  {"nested":true}');
  assert.equal(documentMetrics(src, parse(src)).unescape, true);
  assert.equal(documentMetrics('"ordinary text"', parse('"ordinary text"')).unescape, undefined);
});
