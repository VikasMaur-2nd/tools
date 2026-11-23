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

test('a property name\'s error is at its key: a CSV column\'s header cell, a YAML, XML or TOML key (review 2, finding 7)', () => {
  const key = (text: string, format: ImportFormat, pointers: string[], options = {}) =>
    locateImport(text, format, options, pointers, pointers.map(() => true))!.map(({ p, exact }) => `${exact ? '' : '~'}${text.slice(p).split('\n')[0]}`);
  // CSV: `name,Bad Header` / `Ada,ok`: propertyNames fails for "Bad Header", in record 0: its header cell, not "ok".
  const csv = 'name,Bad Header\nAda,ok\n';
  const r = validateTexts({ schema: JSON.stringify({ items: { propertyNames: { pattern: '^[a-z]+$' } } }), doc: (importToJson(csv, 'csv', '', { header: true }) as { json: string }).json, draft: null, formats: false });
  assert.deepEqual(r.errors.map((e) => [e.pointer, e.key]), [['/0/Bad Header', true]]);
  assert.deepEqual(key(csv, 'csv', ['/0/Bad Header'], { header: true }), ['Bad Header']);
  assert.deepEqual(at(csv, 'csv', ['/0/Bad Header'], { header: true }), ['ok'], 'its value is still its cell');
  // A column the header doesn't name (a longer record): the header row, not exact.
  assert.deepEqual(key('a,b\n1,2,3\n', 'csv', ['/0/column_3'], { header: true }), ['~a,b']);
  // YAML, XML, TOML: the key, as for its value.
  assert.deepEqual(key('name: Ada\nBad Key: 1\n', 'yaml', ['/Bad Key']), ['Bad Key: 1']);
  assert.deepEqual(key('<r>\n  <Bad>1</Bad>\n  <ok a="1"/>\n</r>\n', 'xml', ['/r/Bad', '/r/ok/@a']).map((s) => s.trim()), ['<Bad>1</Bad>', 'a="1"/>']);
  assert.deepEqual(key('name = "Ada"\n"Bad Key" = 1\n', 'toml', ['/Bad Key']), ['"Bad Key" = 1']);
});

test('a text read for places is read once while it and its options stay the same; CSV places write no JSON (review 2, finding 6)', () => {
  const rows = Array.from({ length: 150_000 }, (_, i) => `${i},user ${i},user${i}@example.com,${i % 97}`);
  const csv = 'id,name,email,score\n' + rows.join('\n') + '\n';
  const cpu = () => {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  };
  const time = (f: () => void) => {
    const t = cpu();
    f();
    return cpu() - t;
  };
  let first: unknown;
  const read = time(() => (first = locateImport(csv, 'csv', { header: true }, ['/149999/email'])));
  let again: unknown;
  const reuse = time(() => (again = locateImport(csv, 'csv', { header: true }, ['/149999/email', '/5/id'])));
  assert.deepEqual((again as unknown[])[0], (first as unknown[])[0]);
  assert.ok(reuse < Math.max(2, read / 10), `read ${read.toFixed(1)} ms, again ${reuse.toFixed(1)} ms`);
  // Another option: read again (the header row is a record now).
  assert.equal(locateImport(csv, 'csv', { header: false }, ['/1/0'])![0].p, csv.indexOf('0,user 0'));
  // Reading for places takes well under converting (no JSON is written).
  const convert = time(() => importToJson(csv, 'csv', '', { header: true }));
  const fresh = csv + '\n';
  const locate = time(() => locateImport(fresh, 'csv', { header: true }, ['/0/id']));
  assert.ok(locate < convert, `locate ${locate.toFixed(1)} ms, convert ${convert.toFixed(1)} ms`);
});
