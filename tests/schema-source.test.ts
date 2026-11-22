import test from 'node:test';
import assert from 'node:assert/strict';
import { importToJson, locateImport, type ImportFormat } from '../lib/convert/import';
import { validateTexts } from '../lib/schema/index';

// Schema errors for input in another format (YAML, CSV, XML, TOML): each error's JSON Pointer back to the place in
// the text the input is, for the Schema view to show and jump to (components/SchemaView.tsx).

/** The text at each place: from its offset to the end of its line. */
const at = (text: string, format: ImportFormat, pointers: string[], options = {}) =>
  locateImport(text, format, options, pointers)!.map(({ p, exact }) => `${exact ? '' : '~'}${text.slice(p).split('\n')[0]}`);

test('YAML: keys, items, flow collections, several documents; a merge key\'s values at the nearest key written', () => {
  const yaml = 'name: Ada\nage: "36"\ntags:\n  - admin\n  - { role: owner, level: 2 }\nflow: [1, x]\nbase: &b\n  city: Rome\nhome:\n  <<: *b\n';
  assert.deepEqual(at(yaml, 'yaml', ['', '/age', '/tags/0', '/tags/1/level', '/flow/1', '/home', '/home/city', '/nope']), [
    'name: Ada',
    'age: "36"',
    '- admin',
    'level: 2 }',
    'x]',
    'home:',
    '~home:',
    '~name: Ada',
  ]);
  assert.deepEqual(at('---\na: 1\n---\nb: 2\n', 'yaml', ['/0/a', '/1/b']), ['a: 1', 'b: 2']);
});

test('CSV: a record\'s cells by column name (or index without a header); a missing cell at its record', () => {
  const csv = 'id,name,email\n1,Ada,ada@example.com\n2,"Grace\nHopper",\n3,Alan\n';
  assert.deepEqual(at(csv, 'csv', ['', '/1', '/1/name', '/2/id', '/2/email', '/0/email'], { header: true }), [
    'id,name,email',
    '2,"Grace',
    '"Grace',
    '3,Alan',
    '~3,Alan',
    'ada@example.com',
  ]);
  assert.deepEqual(at('a;b\nc;d\n', 'csv', ['/1/1', '/0/0'], { header: false, delimiter: ';' }), ['d', 'a;b']);
  // (A BOM and a sep= line move nothing.)
  const sep = '﻿sep=;\nx;y\n1;2\n';
  assert.deepEqual(at(sep, 'csv', ['/0/y'], { header: true, delimiter: ';' }), ['2']);
});

test('XML: elements, repeated ones, attributes, text', () => {
  const xml = '<user id="7">\n  <name>Ada</name>\n  <tag>a</tag>\n  <tag>b</tag>\n  <note lang="en">hi</note>\n</user>\n';
  assert.deepEqual(at(xml, 'xml', ['/user', '/user/@id', '/user/name', '/user/tag/1', '/user/note/#text', '/user/note/@lang']), [
    '<user id="7">',
    'id="7">',
    '<name>Ada</name>',
    '<tag>b</tag>',
    '<note lang="en">hi</note>',
    'lang="en">hi</note>',
  ]);
});

test('TOML: keys, dotted keys, tables, arrays of tables, arrays', () => {
  const toml = 'title = "x"\nowner.name = "Ada"\n[server]\nports = [80, 443]\n[[items]]\nid = 1\n[[items]]\nid = 2\n';
  assert.deepEqual(at(toml, 'toml', ['/title', '/owner/name', '/server/ports/1', '/items/1', '/items/1/id']), [
    'title = "x"',
    'owner.name = "Ada"',
    '443]',
    '[[items]]',
    'id = 2',
  ]);
  assert.equal(locateImport('a = ', 'toml', {}, ['/a']), null, 'a text that doesn\'t convert');
});

test('every error of a schema check, for each format, has a place in the text', () => {
  const schema = JSON.stringify({ items: { required: ['id', 'email'], properties: { id: { type: 'integer' }, email: { format: 'email', type: 'string' } } } });
  const sources: [ImportFormat, string][] = [
    ['yaml', '- id: "1"\n  email: x\n- id: 2\n'],
    ['csv', 'id,email\n"1",x\n2\n'],
    ['toml', 'x = 1\n'],
  ];
  for (const [format, text] of sources) {
    const conv = importToJson(text, format, '', { header: true, types: false });
    assert.ok('json' in conv, format);
    const r = validateTexts({ schema, doc: conv.json, draft: null, formats: true });
    const places = locateImport(text, format, { header: true, types: false }, r.errors.map((e) => e.pointer))!;
    assert.equal(places.length, r.errors.length, format);
    for (const pl of places) assert.ok(pl.p >= 0 && pl.p <= text.length, `${format}: ${pl.p}`);
  }
});

test('reading for places changes nothing importToJson makes', () => {
  const yaml = 'a: [1, {b: 2}]\nc:\n  - d\n';
  const before = importToJson(yaml, 'yaml', '');
  locateImport(yaml, 'yaml', {}, ['/a/1/b']);
  assert.deepEqual(importToJson(yaml, 'yaml', ''), before);
});
