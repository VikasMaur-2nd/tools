import test from 'node:test';
import assert from 'node:assert/strict';
import { ARR, JNode, OBJ, parse, type ParseResult } from '../lib/json/parser';
import { formatDoc, minifiedBytes, reindent, stringify } from '../lib/json/format';
import '../lib/json/requote';

let seed = 11;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
const pick = <T>(a: readonly T[]) => a[rnd(a.length)];
const ws = () => pick(['', '', ' ', '\n  ', '\t', '\r\n', '  \n\t ']);
const STRINGS = ['', 'end\\\\', 'q\\\"', '\\\\\\\\', 'plain', 'say \\"hi\\"', 'back\\\\slash', 'slash\\/', 'tab\\tnew\\nline', '\\u00e9t\\u00E9', '\\ud83d\\ude00', '😀 raw', 'été', '中文', '\\ud800 lone', 'ctrl\\u0001', 'a\\b\\f\\r'];
const NUMBERS = ['0', '-0', '1', '-12', '3.14', '1.0', '1e400', '-2.5E-3', '9007199254740993', '12345678901234567890.123', '0.000001', '1E5'];
const value = (d: number): string => {
  const r = rnd(d > 3 ? 4 : 7);
  if (r === 0) return `"${pick(STRINGS)}"`;
  if (r === 1) return pick(NUMBERS);
  if (r === 2) return pick(['true', 'false', 'null']);
  if (r === 3) return `"${pick(STRINGS)}"`;
  if (r === 4 || r === 5) {
    const n = rnd(4);
    const keys = Array.from({ length: n }, () => `"${pick(['a', 'b', 'a', 'key', 'é', '\\u0041', '1'])}"`);
    return `{${ws()}${keys.map((k) => `${k}${ws()}:${ws()}${value(d + 1)}`).join(`${ws()},${ws()}`)}${ws()}}`;
  }
  const n = rnd(4);
  return `[${ws()}${Array.from({ length: n }, () => value(d + 1)).join(`${ws()},${ws()}`)}${ws()}]`;
};

test('reindent matches the tree serializer on strict JSON', () => {
  for (let k = 0; k < 3000; k++) {
    const src = ws() + value(0) + ws();
    const res = parse(src);
    for (const indent of ['  ', '\t', '']) {
      const out = reindent(src, indent);
      if (out === null) continue;
      assert.ok(res.root && !res.error && !res.issues.length, `accepted what the parser rejects: ${src}`);
      assert.equal(out, stringify(res.root!, indent), src);
    }
    if (res.root && !res.error && !res.issues.length) assert.notEqual(reindent(src, '  '), null, `rejected valid JSON: ${src}`);
  }
});

test('reindent leaves anything but strict JSON to the parser', () => {
  for (const bad of ['[1,2,]', '{"a":1,}', '// c\n{}', "{'a':1}", '{a:1}', '[01]', '[1.]', '[+1]', '[NaN]', '[1 2]', '{"a" 1}', '[', '{"a":1', '"un', '[1]]', '[1] 2', '["\\x"]', '["a\nb"]', 'truex', '[True]', '﻿[1]', '[' .repeat(600) + ']'.repeat(600)]) {
    assert.equal(reindent(bad, '  '), null, bad);
  }
});

test('documents nested deeper than the engine can stringify are written from the tree', () => {
  // Built directly: the parser's own limit depends on the stack it runs on. Arrays inside objects inside arrays…
  const depth = 6_000;
  let src = '';
  let close = '';
  const root = new JNode(ARR, [], 0, 0, null, undefined);
  let n = root;
  for (let d = 1; d < depth; d++) {
    const obj = d % 2 === 1;
    src += n.t === OBJ ? '{"k":' : '[';
    close = (n.t === OBJ ? '}' : ']') + close;
    const c = new JNode(obj ? OBJ : ARR, [], src.length, d, n, n.t === OBJ ? 'k' : 0);
    (n.v as JNode[]).push(c);
    n = c;
  }
  src += (n.t === OBJ ? '{}' : '[]') + close;
  const res: ParseResult = { root, issues: [], warnings: [], error: null, nodes: depth, depth: depth - 1, exact: true, multi: false };
  assert.throws(() => JSON.stringify(JSON.parse(src)), RangeError, 'the engine itself overflows, so the fallback is what this tests');
  assert.equal(formatDoc(src, res, ''), src);
  const pretty = formatDoc(src, res, ' ');
  assert.equal(pretty.replace(/\s+/g, ''), src);
  assert.equal(pretty.split('\n').length, 2 * (depth - 1) + 1);
  assert.ok(pretty.startsWith('[\n {\n  "k": [\n   {\n'));
  assert.equal(formatDoc(src, res, '', true), src);
});

test('reindent switches from one-byte to UTF-16 output where the first wide character appears', () => {
  const ascii = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, s: 'plain ' + i })));
  for (const tail of ['"é"', '"\\u00e9"', '"😀"', '"\\ud83d\\ude00"', '"\\ud800"', '"\\u0080"', '"a\\nb"', '"\\u007f"']) {
    const doc = `{"a": ${ascii}, "tail": ${tail}, "more": ${ascii}}`;
    for (const indent of ['', '  ', '\t']) assert.equal(reindent(doc, indent), JSON.stringify(JSON.parse(doc), null, indent), `${tail} ${JSON.stringify(indent)}`);
  }
  // A wide character first, in a key.
  assert.equal(reindent('{"ключ": [1, 2]}', ''), '{"ключ":[1,2]}');
});

test('strings with escapes are re-quoted in place exactly as quote(JSON.parse(token)), and refused where JSON.parse refuses', () => {
  let r = 99;
  const rnd = (n: number) => ((r = (r * 1103515245 + 12345) & 0x7fffffff), r % n);
  const atoms = ['a', 'é', '東', '😀', '\\n', '\\"', '\\\\', '\\/', '\\b', '\\f', '\\r', '\\t', '\\u0000', '\\u001f', '\\u0041', '\\u00e9', '\\uD83D', '\\uDE00', '\\ud83d\\ude00', '\\uDBFF', '\\uDC00', '\ud83d', '\ude00', ' ', '\u007f', '"', '\\x', '\\u12', '\\uZZZZ', '\u0001', '\t', '\\', ' '];
  for (let k = 0; k < 20000; k++) {
    let body = '';
    for (let n = rnd(8); n >= 0; n--) body += atoms[rnd(atoms.length)];
    const token = '"' + body + '"';
    const doc = '[' + token + ', "x\\n"]';
    let want: string | null;
    try {
      want = JSON.stringify(JSON.parse(doc));
    } catch {
      want = null;
    }
    // A raw quote or trailing backslash ends the token early: reindent then sees other text, as the parser would.
    const got = reindent(doc, '');
    if (want !== null) assert.equal(got, want, doc);
    else assert.equal(got, null, doc);
    // (minifiedBytes checks strings, not the grammar around them.)
    if (want !== null) assert.equal(minifiedBytes(doc), new TextEncoder().encode(want).length, doc);
    let token1: string | null;
    try {
      token1 = JSON.stringify(JSON.parse(token));
    } catch {
      token1 = null;
    }
    // A token alone (a raw quote inside ends it early: then it isn't one token).
    if (!body.includes('"') || token1 !== null) assert.equal(minifiedBytes(token), token1 === null ? null : new TextEncoder().encode(token1).length, token);
  }
});

test('strings over 64K characters are re-quoted in place with the same result and the same refusals', () => {
  let r = 5;
  const rnd = (n: number) => ((r = (r * 1103515245 + 12345) & 0x7fffffff), r % n);
  const atoms = ['a', 'é', '東', '😀', '\\n', '\\"', '\\\\', '\\/', '\\b', '\\u0000', '\\u00e9', '\\uD83D', '\\uDE00', '\\ud83d\\ude00', '\ud83d', '\ude00', ' ', '\\x', '\\u12', '\u0001', '\t', ' '];
  for (let k = 0; k < 120; k++) {
    let body = '';
    for (let n = rnd(6); n >= 0; n--) body += atoms[rnd(atoms.length)];
    // A valid filler around the random part, so only that part decides.
    const filler = 'x\\n'.repeat(22_000 + rnd(1000));
    const token = '"' + filler + body + filler + '"';
    for (const doc of [token, '{"k": ' + token + '}', '[' + token + ', "é"]']) {
      let want: string | null;
      try {
        want = JSON.stringify(JSON.parse(doc));
      } catch {
        want = null;
      }
      assert.equal(reindent(doc, ''), want, body);
      if (want !== null) assert.equal(minifiedBytes(doc), new TextEncoder().encode(want).length, body);
      else if (doc === token) assert.equal(minifiedBytes(doc), null, body);
    }
  }
  assert.equal(minifiedBytes('"' + 'x\\n'.repeat(40_000) + '\\'), null, 'unterminated');
});
