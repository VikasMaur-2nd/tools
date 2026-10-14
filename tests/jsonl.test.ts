import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { formatDoc } from '../lib/json/format';
import { convert } from '../lib/convert';
import { jsonLines } from '../lib/engine/engine';
import { TOOL_PAGES } from '../lib/tool-pages';

const isLines = (text: string) => jsonLines(text, parse(text));

describe('JSON Lines input', () => {
  test('one strict value per line reads as a list of records', () => {
    assert.ok(isLines('{"a":1}\n{"a":2}\n'));
    assert.ok(isLines('{"a":1}\r\n\r\n[1,2]\n"x"\n'), 'CRLF, blank lines and non-object values');
    const r = parse('{"a":1}\n{"a":2}\n');
    assert.equal(r.multi, true);
    assert.equal(r.exact, false, 'a wrapped document is not the source text');
    assert.equal(formatDoc('{"a":1}\n{"a":2}\n', r, ''), '[{"a":1},{"a":2}]');
  });

  test('loose layouts stay loose JSON with an issue', () => {
    assert.equal(isLines('{"a":1}, {"a":2}'), false, 'comma-separated');
    assert.equal(isLines('{"a":1} {"a":2}'), false, 'two values on one line');
    assert.equal(isLines('{\n  "a": 1\n}\n{"a":2}'), false, 'a record spanning lines');
    assert.equal(isLines("{'a':1}\n{\"a\":2}"), false, 'a record that needs repair');
    assert.equal(isLines('{"a":1}'), false, 'a single document');
  });

  test('a .jsonl file with one record is still a list', () => {
    const r = parse('{"id":1}\n', { lines: true });
    assert.equal(r.multi, true);
    assert.deepEqual(r.issues, []);
    assert.equal(formatDoc('{"id":1}\n', r, ''), '[{"id":1}]');
    assert.ok(jsonLines('{"id":1}\n', r));
    assert.equal(formatDoc('[1,2]\n[3]\n', parse('[1,2]\n[3]\n'), ''), '[[1,2],[3]]', 'array-valued lines stay elements');
  });

  test('large integers keep their digits', () => {
    const text = '{"id":9007199254740993}\n{"id":2}\n';
    assert.equal(formatDoc(text, parse(text), ''), '[{"id":9007199254740993},{"id":2}]');
  });
});

describe('JSON Lines export', () => {
  test('one compact value per line', () => {
    const root = parse('[{"id":9007199254740993,"tags":["a"]}, {"b": {"c": null}}]').root!;
    assert.equal(convert(root, 'jsonl', { rootName: 'Root' }), '{"id":9007199254740993,"tags":["a"]}\n{"b":{"c":null}}\n');
    assert.equal(convert(parse('{"a":1}').root!, 'jsonl', { rootName: 'Root' }), '{"a":1}\n', 'a non-array document is one line');
    assert.equal(convert(parse('[]').root!, 'jsonl', { rootName: 'Root' }), '');
  });
});

describe('line-oriented landing pages', () => {
  const page = (slug: string) => TOOL_PAGES.find((p) => p.slug === slug)!;
  test('JSONL pages open real JSON Lines files', () => {
    for (const slug of ['jsonl-viewer', 'ndjson-to-json', 'jsonl-to-csv']) {
      const p = page(slug);
      assert.match(p.preset.initialFileName ?? '', /\.(jsonl|ndjson)$/, slug);
      assert.ok(isLines(p.sample), slug);
    }
    assert.equal(page('jsonl-to-csv').preset.settings?.target, 'csv');
    assert.equal(page('json-to-jsonl').preset.settings?.target, 'jsonl');
  });

  test('format pages set their output style', () => {
    assert.equal(page('sort-json-keys').preset.settings?.sortKeys, true);
    assert.equal(page('json-escape').preset.settings?.escape, true);
    assert.equal(page('json-to-table').preset.settings?.view, 'table');
    const repair = parse(page('json-repair').sample);
    assert.ok(repair.root && !repair.error && repair.issues.length > 5, 'the repair sample is broken but repairable');
  });
});
