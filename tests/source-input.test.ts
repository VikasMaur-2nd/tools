import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { convertSource, otherFormat, sourceColors } from '../lib/engine/source';
import { formatOf, formatOfName, plainJson } from '../lib/engine/rules';

/** The text of colour HTML: its tags taken out, its entities read. */
const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('input in another format', () => {
  test('converts to compact JSON, or says where and why it does not', () => {
    assert.deepEqual(convertSource('name: Ada\ntags:\n  - json\n', 'yaml', {}), { json: '{"name":"Ada","tags":["json"]}' });
    assert.deepEqual(convertSource('id;name\n1;Ada\n', 'csv', { delimiter: ';' }), { json: '[{"id":1,"name":"Ada"}]' });
    assert.deepEqual(convertSource('id,name\n1,Ada\n', 'csv', { header: false, types: false }), { json: '[["id","name"],["1","Ada"]]' });
    assert.deepEqual(convertSource('<a><b>1</b></a>', 'xml', {}), { json: '{"a":{"b":"1"}}' });
    assert.deepEqual(convertSource('x = 1\n[t]\ny = "z"\n', 'toml', {}), { json: '{"x":1,"t":{"y":"z"}}' });
    const bad = convertSource('a: 1\nb: [1, 2\n', 'yaml', {});
    assert.ok('error' in bad);
    assert.ok(bad.p >= 0 && bad.p <= 'a: 1\nb: [1, 2\n'.length);
    // (No place to point at, nesting too deep: the start.)
    const n = 200_000;
    const deep = convertSource('<a>'.repeat(n) + '</a>'.repeat(n), 'xml', {});
    assert.ok('error' in deep);
    assert.equal(deep.p, 0);
  });

  test('text that clearly is another format says which; its own format, or a guess, says nothing', () => {
    assert.equal(otherFormat('{"a": 1}', 'yaml'), 'json');
    assert.equal(otherFormat('{"a": 1}', 'csv'), 'json');
    assert.equal(otherFormat('name: Ada\nage: 36\n', 'csv'), 'yaml');
    assert.equal(otherFormat('<a>1</a>', 'yaml'), 'xml');
    assert.equal(otherFormat('id,name\n1,Ada\n', 'csv'), null);
    assert.equal(otherFormat('id\tname\n1\tAda\n', 'csv'), null, 'TSV is CSV with tabs');
    assert.equal(otherFormat('name: Ada\n', 'yaml'), null);
    assert.equal(otherFormat('just some words', 'csv'), null);
  });

  test('file names say what a document is read as; anything else is JSON', () => {
    const cases: [string | null, string][] = [
      ['a.yaml', 'yaml'], ['a.YML', 'yaml'], ['a.csv', 'csv'], ['a.tsv', 'csv'], ['a.xml', 'xml'], ['Cargo.toml', 'toml'],
      ['a.json', 'json'], ['a.jsonl', 'json'], ['a.txt', 'json'], ['yaml', 'json'], [null, 'json'],
    ];
    for (const [name, want] of cases) assert.equal(formatOfName(name), want, String(name));
    assert.equal(formatOf('toml'), 'toml');
    assert.equal(formatOf('exe'), 'json');
    assert.equal(formatOf(null), 'json');
  });

  test('text pasted over everything is plainly JSON when it is an object or array JSON.parse reads', () => {
    for (const t of ['{"a": 1}', ' \n[1, 2]\n', '[]', '{}']) assert.equal(plainJson(t), true, t);
    // (YAML flow style, JSON with a trailing comma or comments, JSON Lines, a bare value: read as they were.)
    for (const t of ['{a: 1}', '[1, 2,]', '{"a": 1} // note', '{"a":1}\n{"a":2}', '42', '"x"', 'a: 1', '[a],b\n1,2', '']) assert.equal(plainJson(t), false, t);
    assert.equal(plainJson('[' + '0,'.repeat(2_600_000) + '0]'), false, 'past 5 MB it is not checked');
  });
});

describe('the editor colours another format', () => {
  test('each line keeps its text; YAML keys, CSV columns and the header row are coloured', () => {
    const yaml = 'name: Ada\n# note\nage: 36\n';
    const c = sourceColors('yaml');
    const first = c(yaml, 0, 9, 0);
    assert.equal(plain(first), 'name: Ada');
    assert.match(first, /<span class="tk">name<\/span>/);
    assert.equal(plain(c(yaml, 10, 16, 0)), '# note');
    assert.match(c(yaml, 10, 16, 0), /class="tc"/);

    const csv = 'a;"b;c"\n1;2\n';
    const k = sourceColors('csv', ';');
    const head = k(csv, 0, 7, 0);
    assert.equal(plain(head), 'a;"b;c"');
    assert.equal(head, '<span class="cc0 ch">a</span><span class="tp">;</span><span class="cc1 ch">&quot;b;c&quot;</span>');
    assert.equal(k(csv, 8, 11, 0), '<span class="cc0">1</span><span class="tp">;</span><span class="cc1">2</span>');
    // (A document read from offset 8 on: its first line isn't the header.)
    assert.doesNotMatch(sourceColors('csv', ';')(csv.slice(8), 0, 3, 8), / ch/);
    assert.doesNotMatch(sourceColors('csv', ';', false)(csv, 0, 7, 0), / ch/, 'no header row: none is bold');
  });

  test('a piece of a line (a soft-wrapped row) colours as the whole line does, with markup in it escaped', () => {
    const xml = '<a href="x&amp;y">1 < 2</a>';
    const c = sourceColors('xml');
    const whole = c(xml, 0, xml.length, 0);
    assert.equal(plain(whole), xml);
    const parts = [c(xml, 0, 10, 0), c(xml, 10, 20, 0), c(xml, 20, xml.length, 0)];
    assert.equal(parts.map(plain).join(''), xml);
    assert.doesNotMatch(parts.join(''), /<a href|< 2/, 'the text is escaped');
  });

  test('diagnostics are underlined on top of the colours', () => {
    const toml = 'x = 1\ny = [1, 2\n';
    const html = sourceColors('toml')(toml, 6, 15, 0, [{ a: 11, b: 12, cls: 'me' }]);
    assert.equal(plain(html), 'y = [1, 2');
    assert.match(html, /<span class="tn me">1<\/span>/);
  });
});
