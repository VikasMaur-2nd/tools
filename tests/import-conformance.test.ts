// What the X → JSON importers (lib/convert/import.ts) must agree on with the specifications they read:
// YAML 1.2, XML 1.0, TOML 1.0 and RFC 4180 CSV. Each case is a document a reference parser (PyYAML's
// safe_load, xml.etree.ElementTree, Python's tomllib and csv) reads the same way, unless a comment says why not.
import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { detectFormat, importToJson, type ImportFormat } from '../lib/convert/import';

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

describe('TOML', () => {
  test('an escape must stand for a Unicode scalar value', () => {
    same('toml', [
      ['a = "\\uD7FF\\uE000\\U0010FFFF\\U0001F600"\n', { a: '\ud7ff\ue000\u{10FFFF}\u{1F600}' }],
      // a literal string has no escapes
      ["a = '\\ud800'\n", { a: '\\ud800' }],
    ]);
    fails('toml', [
      ['a = "\\ud800"\n', 'Invalid escape sequence \\ud800', 1, 6],
      ['a = "x\\uDFFF"\n', 'Invalid escape sequence \\uDFFF', 1, 7],
      // two halves of a surrogate pair are two invalid escapes, not one character
      ['a = "\\ud83d\\ude00"\n', 'Invalid escape sequence \\ud83d', 1, 6],
      ['a = "\\U0000D800"\n', 'Invalid escape sequence \\U0000D800', 1, 6],
      ['a = """\n\\U00110000"""\n', 'Invalid escape sequence \\U00110000', 2, 1],
      ['a = "\\u12"\n', 'Invalid escape sequence \\u', 1, 6],
    ]);
  });

  test('dates and times must exist: months, days of the month, hours, minutes, seconds, offsets', () => {
    same('toml', [
      ['a = 2024-02-29\nb = 2000-02-29\nc = 2023-12-31\nd = 2023-04-30\n', { a: '2024-02-29', b: '2000-02-29', c: '2023-12-31', d: '2023-04-30' }],
      ['a = 1979-05-27T23:59:59.999+23:59\nb = 00:00:00\nc = 1979-05-27 00:00:00-23:59\n', { a: '1979-05-27T23:59:59.999+23:59', b: '00:00:00', c: '1979-05-27T00:00:00-23:59' }],
      // RFC 3339 has a leap second 60 and the year 0000; tomllib rejects them only because Python's datetime has neither
      ['a = 2016-12-31T23:59:60Z\nb = 23:59:60\nc = 0000-01-01\n', { a: '2016-12-31T23:59:60Z', b: '23:59:60', c: '0000-01-01' }],
      // written in RFC 3339's form: T between date and time, Z for UTC; a local time keeps its fraction
      ['a = 1979-05-27t07:32:00z\nb = 1979-05-27 07:32:00Z\nc = 1979-05-27 07:32:00.5\nd = 07:32:00.999999\n', { a: '1979-05-27T07:32:00Z', b: '1979-05-27T07:32:00Z', c: '1979-05-27T07:32:00.5', d: '07:32:00.999999' }],
      ['a = [1979-05-27, 07:32:00, 1]\nb = {d = 2000-02-29}\n', { a: ['1979-05-27', '07:32:00', 1], b: { d: '2000-02-29' } }],
    ]);
    fails('toml', [
      ['a = 2024-13-45\n', "Invalid date or time '2024-13-45'", 1, 5],
      ['a = 2024-00-10\n', "Invalid date or time '2024-00-10'", 1, 5],
      ['a = 2024-01-00\n', "Invalid date or time '2024-01-00'", 1, 5],
      ['a = 2023-02-29\n', "Invalid date or time '2023-02-29'", 1, 5],
      ['a = 1900-02-29\n', "Invalid date or time '1900-02-29'", 1, 5],
      ['a = 2024-02-30\n', "Invalid date or time '2024-02-30'", 1, 5],
      ['a = 2024-04-31\n', "Invalid date or time '2024-04-31'", 1, 5],
      ['a = 1979-05-27T25:00:00\n', "Invalid date or time '1979-05-27T25:00:00'", 1, 5],
      ['a = 1979-05-27 24:00:00\n', "Invalid date or time '1979-05-27 24:00:00'", 1, 5],
      ['a = 1979-05-27T07:60:00\n', "Invalid date or time '1979-05-27T07:60:00'", 1, 5],
      ['a = 07:32:61\n', "Invalid date or time '07:32:61'", 1, 5],
      ['a = 1979-05-27T07:32:00+24:00\n', "Invalid date or time '1979-05-27T07:32:00+24:00'", 1, 5],
      ['a = 1979-05-27T07:32:00-01:60\n', "Invalid date or time '1979-05-27T07:32:00-01:60'", 1, 5],
      // a date or time of the wrong shape is no number either
      ['a = 2024-1-01\n', "Invalid date or time '2024-1-01'", 1, 5],
      ['a = 1979-05-27T07:32:00Q\n', "Invalid date or time '1979-05-27T07:32:00Q'", 1, 5],
      ['a = 2024-\n', "Invalid date or time '2024-'", 1, 5],
      ['a = 12:3\n', "Invalid date or time '12:3'", 1, 5],
      ['n = 012\n', "Invalid number '012'", 1, 5],
      ['n = 1e10-5\n', "Invalid number '1e10-5'", 1, 5],
    ]);
  });

  test('dotted keys may add to a table a deeper [header] created on its way, not to one a [header] defined', () => {
    same('toml', [
      ['[a.b.c]\nz = 9\n[a]\nb.d = 1\n', { a: { b: { c: { z: 9 }, d: 1 } } }],
      ['[a.b.c]\n[a]\nb.d.e = 1\nb.f = 2\n[a.b.g]\nh = 3\n', { a: { b: { c: {}, d: { e: 1 }, f: 2, g: { h: 3 } } } }],
      ['[[a.b.c]]\n[a]\nb.d = 1\n', { a: { b: { c: [{}], d: 1 } } }],
      ['[x.y.z]\nb.c = 1\n[x]\ny.w = 2\n', { x: { y: { z: { b: { c: 1 } }, w: 2 } } }],
      ['[[t]]\n[t.a.x]\n[[t]]\na.y = 1\n', { t: [{ a: { x: {} } }, { a: { y: 1 } }] }],
    ]);
    fails('toml', [
      // [a.b] defined it
      ['[a.b]\nc = 1\n[a]\nb.d = 2\n', 'Cannot add keys to "b": it is already defined', 4, 1],
      ['[a.b.c]\n[a.b]\n[a]\nb.d = 1\n', 'Cannot add keys to "b": it is already defined', 4, 1],
      // so did the dotted keys, for any [header] after them
      ['[a.b.c]\n[a]\nb.d = 1\n[a.b]\n', 'Table [a.b] is defined more than once', 4, 1],
      ['[a]\nb.c = 1\n[a.b]\n', 'Table [a.b] is defined more than once', 3, 1],
      // inline tables and arrays stay closed
      ['a = {b = 1}\na.c = 2\n', 'Cannot add keys to "a": it is already defined', 2, 1],
      ['[[a.b]]\n[a]\nb.c = 1\n', 'Cannot add keys to "b": it is already defined', 3, 1],
      ['[a.b.c]\n[a]\nb.c.d = 1\n', 'Cannot add keys to "b.c": it is already defined', 3, 1],
    ]);
  });
});

describe('CSV', () => {
  test('a file that quotes every field gets its numbers and booleans, but whitespace inside quotes is kept', () => {
    same('csv', [
      ['"b"\n"3\t"\n', [{ b: '3\t' }]],
      ['"b"\n"\n0"\n', [{ b: '\n0' }]],
      ['"a","b"\n" 1","true "\n"2","TRUE"\n', [{ a: ' 1', b: 'true ' }, { a: 2, b: true }]],
      ['"a","b","c"\r\n"\r\n3","0.5\n","1e3"\r\n', [{ a: '\r\n3', b: '0.5\n', c: 1000 }]],
      ['"a","b"\n"",""\n', [{ a: '', b: '' }]],
      // (text after the closing quote is kept with the field, so is its whitespace)
      ['"a"\n"3" \n', [{ a: '3 ' }]],
    ]);
    const r = importToJson('"x","y"\n" 7","8"\n', 'csv', '', { header: false });
    assert.ok('json' in r);
    assert.deepEqual(JSON.parse(r.json), [['x', 'y'], [' 7', 8]]);
    // unquoted fields are trimmed around a number as before; quoted ones in a file that does not quote every field stay strings
    same('csv', [['a,b\n 1 ,"2"\n', [{ a: 1, b: '2' }]]]);
  });
});

describe('YAML explicit keys', () => {
  // JSON to YAML writes keys longer than 1024 characters as "? key" / ": value": YAML allows no longer implicit key.
  const long = 'k'.repeat(1100);

  test('a scalar key after "?", its value after ":" at the same indentation (none: null)', () => {
    same('yaml', [
      [`? ${long}\n: 1\n`, { [long]: 1 }],
      ['? a\n: 1\nb: 2\n? c\n', { a: 1, b: 2, c: null }],
      ['? a\n? b\n', { a: null, b: null }],
      ['? a # c\n: b # c\n', { a: 'b' }],
      ['?\n  a\n: 1\n', { a: 1 }],
      ['? a\n  b\n: 1\n', { 'a b': 1 }],
      ['? a\n:\n', { a: null }],
      // quoted and block scalar keys
      ['? "q\\tk"\n: v\n', { 'q\tk': 'v' }],
      ["? 'it''s'\n: v\n", { "it's": 'v' }],
      ['? |\n  two\n  lines\n: v\n', { 'two\nlines\n': 'v' }],
      ['? >-\n  folded\n  key\n: v\n', { 'folded key': 'v' }],
      // a plain key keeps its text, as an implicit key does; a typed tag makes it its value's JSON text
      ['? 1.0\n: x\n? !!str 12\n: y\n? !!int 0x1F\n: z\n', { '1.0': 'x', '12': 'y', '31': 'z' }],
      ['? &k a\n: 1\nb: *k\n', { a: 1, b: 'a' }],
      ['? <<\n: {m: 1}\nz: 2\n', { m: 1, z: 2 }],
      ['? "<<"\n: 1\n', { '<<': 1 }],
    ]);
  });

  test('the value may be any block node: below the ":", or a compact sequence or mapping on its line', () => {
    same('yaml', [
      ['? a\n:\n  b: 1\n', { a: { b: 1 } }],
      ['? a\n: b: 1\n  c: 2\nd: 3\n', { a: { b: 1, c: 2 }, d: 3 }],
      ['? a\n: - 1\n  - 2\n', { a: [1, 2] }],
      ['? a\n:\n- 1\n- 2\n', { a: [1, 2] }],
      ['? a\n: |\n  t\n', { a: 't\n' }],
      ['? a\n: [1, {b: 2}]\n', { a: [1, { b: 2 }] }],
    ]);
  });

  test('inside mappings and sequence items, as the exporter nests them', () => {
    same('yaml', [
      [`x:\n  ? ${long}\n  : 1\n  b: 2\ny: 3\n`, { x: { [long]: 1, b: 2 }, y: 3 }],
      [`- ? ${long}\n  : v\n- b\n`, [{ [long]: 'v' }, 'b']],
      [`- a: 1\n  ? ${long}\n  :\n    - ? ${long}\n      : null\n`, [{ a: 1, [long]: [{ [long]: null }] }]],
      ['---\n? a\n: 1\n---\n? b\n', [{ a: 1 }, { b: null }]],
    ]);
  });

  test('flow mappings and sequences', () => {
    same('yaml', [
      ['{? a : b, c: d}', { a: 'b', c: 'd' }],
      ['{? a}', { a: null }],
      ['{? a, ? b: 1}', { a: null, b: 1 }],
      ['[? a : b, c]', [{ a: 'b' }, 'c']],
      ['[a, ? b]', ['a', { b: null }]],
      [`x: {? "${long}": 1}`, { x: { [long]: 1 } }],
    ]);
  });

  test('a list or mapping is no key; nor is "?" a value on its key\'s line', () => {
    fails('yaml', [
      ['? - a\n: 1\n', 'Collections cannot be used as mapping keys', 1, 1],
      ['? a: b\n: 1\n', 'Collections cannot be used as mapping keys', 1, 1],
      ['x:\n  ? [a]\n  : 1\n', 'Collections cannot be used as mapping keys', 2, 3],
      ['? {a: 1}\n', 'Collections cannot be used as mapping keys', 1, 1],
      ['x: {? [a]: b}\n', 'Collections cannot be used as mapping keys', 1, 5],
      ['a: ? b\n', "Plain values cannot start with '?'. Wrap the value in quotes", 1, 4],
      // ": value" belongs at the "?"'s indentation
      ['? a\n  : b\n', 'Bad indentation of a mapping entry', 2, 3],
      ['? a\n: 1\na: 2\n', 'Duplicate key "a"', 3, 1],
      // properties go after the "?" (or on a line before the mapping)
      ['&x ? a\n: 1\n', 'Expected a mapping key (key: value)', 1, 1],
    ]);
    same('yaml', [['x: &m\n  ? a\n  : 1\ny: *m\n', { x: { a: 1 }, y: { a: 1 } }]]);
  });

  test('a document that starts with an explicit key reads as YAML', () => {
    assert.equal(detectFormat(`? ${long}\n: 1\n`), 'yaml');
    assert.equal(detectFormat('# c\n? a\n: 1\n'), 'yaml');
    assert.equal(detectFormat('?\n  a\n: 1\n'), 'yaml');
  });
});
