// What the X → JSON importers (lib/convert/import.ts) must agree on with the specifications they read:
// YAML 1.2, XML 1.0, TOML 1.0 and RFC 4180 CSV. Each case is a document a reference parser (PyYAML's
// safe_load, xml.etree.ElementTree, Python's tomllib and csv) reads the same way, unless a comment says why not.
import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { importToJson, type ImportFormat } from '../lib/convert/import';

/** The JSON value `text` converts to; fails the test on an error or output that is not strict JSON. */
const val = (text: string, fmt: ImportFormat): unknown => {
  const r = importToJson(text, fmt, '');
  if ('error' in r) return assert.fail(`${JSON.stringify(text)}: unexpected error ${r.error} at ${r.line}:${r.col}`);
  const p = parse(r.json);
  assert.ok(p.root && !p.error && p.issues.length === 0, `invalid JSON output: ${r.json.slice(0, 200)}`);
  return JSON.parse(r.json);
};
/** The error `text` converts to: [message, line, col]. */
const err = (text: string, fmt: ImportFormat): [string, number | undefined, number | undefined] => {
  const r = importToJson(text, fmt, '');
  if (!('error' in r)) return assert.fail(`${JSON.stringify(text)}: expected an error, got ${r.json.slice(0, 200)}`);
  return [r.error, r.line, r.col];
};
const same = (fmt: ImportFormat, cases: [string, unknown][]) => {
  for (const [text, want] of cases) assert.deepEqual(val(text, fmt), want, JSON.stringify(text));
};
const fails = (fmt: ImportFormat, cases: [string, string | RegExp, number, number][]) => {
  for (const [text, msg, line, col] of cases) {
    const [m, l, c] = err(text, fmt);
    if (typeof msg === 'string') assert.equal(m, msg, JSON.stringify(text));
    else assert.match(m, msg, JSON.stringify(text));
    assert.deepEqual([l, c], [line, col], `${JSON.stringify(text)}: ${m}`);
  }
};

describe('YAML', () => {
  test('node properties on the line after the key belong to the value', () => {
    same('yaml', [
      ['a:\n  &x 1\nb: *x\n', { a: 1, b: 1 }],
      ['---\n&x a\n', 'a'],
      ['a:\n  !!str 123\n', { a: '123' }],
      ['a:\n  &x\n  c: 1\nb: *x\n', { a: { c: 1 }, b: { c: 1 } }],
      ['a: &x\n  !!str 1\nb: *x\n', { a: '1', b: '1' }],
      ['a:\n  &x\n  !!map\n  b: 1\nc: *x\n', { a: { b: 1 }, c: { b: 1 } }],
      ['- &x\n  - 1\n- *x\n', [[1], [1]]],
      ['a:\n  &x\nb: *x\n', { a: null, b: null }],
      ['a: &x # comment\n  b: 1\nc: *x\n', { a: { b: 1 }, c: { b: 1 } }],
      // a sequence may sit at its key's indentation after them, as without them
      ['a:\n  &x\n- 1\n', { a: [1] }],
    ]);
  });

  test('properties in front of an implicit key on its line are the key\'s; the mapping starts at them', () => {
    same('yaml', [
      ['&a a: b\nc: d\n', { a: 'b', c: 'd' }],
      ['&a a: b\nc: *a\n', { a: 'b', c: 'a' }],
      ['- &x a: 1\n  b: 2\n- *x\n', [{ a: 1, b: 2 }, 'a']],
      ['a: 1\n&k b: 2\nc: *k\n', { a: 1, b: 2, c: 'b' }],
      ['&k 1: a\nb: *k\n', { '1': 'a', b: 1 }],
      ['!!str a: b\n', { a: 'b' }],
      ['"q": 1\n&k "r s": 2\nt: *k\n', { q: 1, 'r s': 2, t: 'r s' }],
      // properties before the line break are the mapping's, those on the key's line the key's
      ['a: &m\n  &k b: 1\nc: *m\nd: *k\n', { a: { b: 1 }, c: { b: 1 }, d: 'b' }],
      ['- !!map\n  !!str 1: x\n', [{ '1': 'x' }]],
      // a typed tag on a key makes the key that value's JSON text
      ['!!int 012: a\n!!null : b\n', { '12': 'a', null: 'b' }],
      // a merge key is one only untagged (or tagged !!merge)
      ['<<: {a: 1}\nb: 2\n', { a: 1, b: 2 }],
      ['!!merge <<: {a: 1}\n', { a: 1 }],
      ['!!str <<: 1\n', { '<<': 1 }],
      ['{!!str <<: 1}', { '<<': 1 }],
    ]);
    fails('yaml', [['a: &x b: c\n', /Mapping values are not allowed here/, 1, 8]]);
  });

  test('a block scalar at the end of the input without a line break has none to keep', () => {
    same('yaml', [
      ['a: |\n  x', { a: 'x' }],
      ['a: >\n  x', { a: 'x' }],
      ['a: |+\n  x', { a: 'x' }],
      ['a: |-\n  x', { a: 'x' }],
      ['a: |\n  x\n', { a: 'x\n' }],
      ['a: |+\n  x\n', { a: 'x\n' }],
      // trailing spaces with no line break after them are no empty line
      ['a: |+\n  x\n  ', { a: 'x\n' }],
      ['a: |+\n  x\n\n  ', { a: 'x\n\n' }],
      ['a: >+\n  x\n\n  ', { a: 'x\n\n' }],
      ['a: |\n  x\n ', { a: 'x\n' }],
      // more spaces than the indentation are content
      ['a: |\n  x\n     ', { a: 'x\n   ' }],
      ['a: |-\n  x\n     ', { a: 'x\n   ' }],
      ['a: |+\n\n', { a: '\n' }],
      ['a: |+\n', { a: '' }],
      ['a: |+', { a: '' }],
      ['a: |\n   ', { a: '' }],
      ['- |+\n  x\n\n- y', ['x\n\n', 'y']],
      ['a: >\n  x\n  y', { a: 'x y' }],
    ]);
  });

  test('an empty flow entry is an error', () => {
    fails('yaml', [
      ['x: [a,,b]\n', "Unexpected ',': expected a value", 1, 7],
      ['x: [,]\n', "Unexpected ',': expected a value", 1, 5],
      ['x: [, a]\n', "Unexpected ',': expected a value", 1, 5],
      ['x: {a: 1,,}\n', "Unexpected ',': expected a value", 1, 10],
      ['x: {,}\n', "Unexpected ',': expected a value", 1, 5],
    ]);
    same('yaml', [
      ['x: [a,]\n', { x: ['a'] }],
      ['x: [a, ]\n', { x: ['a'] }],
      ['x: {a: 1, }\n', { x: { a: 1 } }],
      ['x: [!!str , b]\n', { x: ['', 'b'] }],
    ]);
  });

  test('core schema tags build their type from any scalar style, and reject what is not of it', () => {
    same('yaml', [
      ["a: !!int '12'\n", { a: 12 }],
      // (012 is decimal in YAML 1.2; PyYAML reads it as YAML 1.1 octal, 10)
      ['a: !!int "-0x1F"\nb: !!int 0o17\nc: !!int 012\nd: !!int +7\n', { a: -31, b: 15, c: 12, d: 7 }],
      ["a: !!bool 'true'\nb: !!bool \"False\"\n", { a: true, b: false }],
      ['a: !!null "null"\nb: !!null \'\'\nc: !!null ~\nd: !!null\n', { a: null, b: null, c: null, d: null }],
      ["a: !!float '1.5'\nb: !!float 1\nc: !!float .5\nd: !!float -.INF\ne: !!float 1e3\n", { a: 1.5, b: 1, c: 0.5, d: null, e: 1000 }],
      ['a: !!str\nb: 1\n', { a: '', b: 1 }],
      ['a: !!str 123\nb: !!str true\nc: !!str ~\n', { a: '123', b: 'true', c: '~' }],
      ['a: !!str |\n  12\nb: !!int |-\n  12\nc: !!str >-\n  folded\n  x\n', { a: '12\n', b: 12, c: 'folded x' }],
      ['a: !<tag:yaml.org,2002:int> "12"\nb: !<tag:yaml.org,2002:str> 12\n', { a: 12, b: '12' }],
      ['a: [!!int "1", !!str 2, !<tag:yaml.org,2002:str> 3, !!str, !!null ""]\n', { a: [1, '2', '3', '', null] }],
      ['a: {!!str 1: x, !!int 012: y, b: !!null, c: !!str}\n', { a: { '1': 'x', '12': 'y', b: null, c: '' } }],
      ['a: !!seq [1]\nb: !!map {c: 1}\nc: !!seq\n- 1\nd: !!map\n  e: 2\n', { a: [1], b: { c: 1 }, c: [1], d: { e: 2 } }],
      // the non-specific tag makes a scalar a string (YAML 1.2 §6.9.1; PyYAML resolves it as untagged)
      ['- ! 12\n- ! true\n- !\n- ! [1]\n', ['12', 'true', '', [1]]],
      // an application's own tags are left out, the value read as if untagged (CloudFormation's !Ref …)
      ['a: !Ref 12\nb: !Ref "12"\nc: !GetAtt [B, Arn]\n', { a: 12, b: '12', c: ['B', 'Arn'] }],
      // YAML 1.1 types JSON has no form for keep their text
      ['a: !!binary aGk=\nb: !!binary 1234\nc: !!timestamp 2001-12-14\n', { a: 'aGk=', b: '1234', c: '2001-12-14' }],
    ]);
    fails('yaml', [
      ['a: !!int abc\n', 'The value does not match its tag !!int', 1, 4],
      ['a: !!int 1.5\n', 'The value does not match its tag !!int', 1, 4],
      ['a: !!int\n', 'The value does not match its tag !!int', 1, 4],
      ['a: !!float x\n', 'The value does not match its tag !!float', 1, 4],
      // YAML 1.2's bool is true / false only
      ['a: !!bool yes\n', 'The value does not match its tag !!bool', 1, 4],
      ["a: !!null 'x'\n", 'The value does not match its tag !!null', 1, 4],
      ['a: !!str [1]\n', 'The value does not match its tag !!str', 1, 4],
      ['a: !!map [1]\n', 'The value does not match its tag !!map', 1, 4],
      ['a: !!seq x\n', 'The value does not match its tag !!seq', 1, 4],
      ['a: !!map\n', 'The value does not match its tag !!map', 1, 4],
      ['- !!str\n  a: 1\n', 'The value does not match its tag !!str', 1, 3],
      ['a:\n  !!int\n  x\n', 'The value does not match its tag !!int', 2, 3],
      ['a: [1, !!int x]\n', 'The value does not match its tag !!int', 1, 8],
    ]);
  });

  test('a collection is no mapping key, also in a flow mapping', () => {
    fails('yaml', [['{[a]: 1}', 'Collections cannot be used as mapping keys', 1, 2]]);
  });
});

describe('XML', () => {
  test('a comment runs to the first --> after its opening <!--', () => {
    same('xml', [
      ['<r><!-->hidden--></r>', { r: null }],
      ['<r><!--->x--></r>', { r: null }],
      ['<r>a<!-- c -->b</r>', { r: 'ab' }],
    ]);
    fails('xml', [
      ['<r><!---></r>', 'Unterminated comment: missing -->', 1, 4],
      // a processing instruction needs its target too
      ['<r><?>x</r>', 'Unterminated processing instruction: missing ?>', 1, 4],
    ]);
  });

  test('a character reference must stand for an XML Char', () => {
    same('xml', [
      ['<r>&#x10FFFF;&#xFFFD;&#xE000;&#xD7FF;&#x20;</r>', { r: '\u{10FFFF}\ufffd\ue000\ud7ff ' }],
      ['<r>&#9;&#xA;&#13;</r>', { r: '\t\n\r' }],
      ['<r>&#x0000000041;&#65;</r>', { r: 'AA' }],
    ]);
    fails('xml', [
      ['<r>&#xD800;</r>', 'Invalid character reference &#xD800;', 1, 4],
      // two halves of a surrogate pair are two invalid references, not one character
      ['<r>&#xD800;&#xDC00;</r>', 'Invalid character reference &#xD800;', 1, 4],
      ['<r>x &#0;</r>', 'Invalid character reference &#0;', 1, 6],
      ['<r>&#x110000;</r>', 'Invalid character reference &#x110000;', 1, 4],
      ['<r>&#xFFFE;</r>', 'Invalid character reference &#xFFFE;', 1, 4],
      ['<r>&#8;</r>', 'Invalid character reference &#8;', 1, 4],
      ['<r>&#99999999999999999999;</r>', 'Invalid character reference &#99999999999999999999;', 1, 4],
      ['<r>\n  <a b="x&#xDFFF;"/></r>', 'Invalid character reference &#xDFFF;', 2, 10],
    ]);
  });

  test('only literal XML whitespace is trimmed: characters references stand for and other spaces stay', () => {
    same('xml', [
      ['<r>&#160;x&#32;</r>', { r: '\u00a0x ' }],
      ['<r>&#32;</r>', { r: ' ' }],
      ['<r> \t\n x \r\n</r>', { r: 'x' }],
      ['<r>\u00a0x\u00a0</r>', { r: '\u00a0x\u00a0' }],
      ['<r>\u2003x\u3000</r>', { r: '\u2003x\u3000' }],
      ['<r> &#10; x &#9; </r>', { r: '\n x \t' }],
      ['<r>  </r>', { r: null }],
      ['<r><![CDATA[  x  ]]></r>', { r: 'x' }],
      ['<r> &amp; </r>', { r: '&' }],
      ['<r>text <b>bold</b> tail</r>', { r: { b: 'bold', '#text': 'text  tail' } }],
      ['<r a=" &#10;x&#9; " b="\tl\nm "/>', { r: { '@a': ' \nx\t ', '@b': ' l m ' } }],
    ]);
    // U+00A0 is no XML whitespace, so it is text outside the root element
    fails('xml', [['\u00a0<r/>', 'Text is not allowed before the root element', 1, 1]]);
  });
});
