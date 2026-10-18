import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_PROPS, clean, countBucket, errorKind, fileKind, loadedProps, round2, sizeBucket, sizeKb } from '../lib/analytics/events';
import { beforeSend, cleanUrl, maskAttribute } from '../lib/analytics/redact';
import { parse } from '../lib/json/parser';

/*
 * Analytics must never carry document content: these pin the allow-lists, the
 * rounding, the URL and attribute redaction, and that every view showing the
 * document is kept out of session replay.
 */

test('clean keeps listed tokens, numbers and booleans, nothing else', () => {
  assert.equal(clean('not_an_event', { a: 1 }), null);
  assert.deepEqual(clean('view_opened', { view: 'tree', via: 'keyboard', extra: 'x' }), { view: 'tree', via: 'keyboard' });
  const p = clean('feature_used', {
    feature: 'find',
    via: 'pointer',
    value: 'has spaces in it',
    view: '{"a":1}',
    level: 2,
    on: true,
    jsonpath: false,
  })!;
  assert.deepEqual(p, { feature: 'find', via: 'pointer', level: 2, on: true, jsonpath: false });
  assert.deepEqual(clean('format_option_changed', { option: 'style', value: '/home/me/secret.json' }), { option: 'style' });
  assert.deepEqual(clean('format_option_changed', { option: 'style', value: 'x'.repeat(41) }), { option: 'style' });
  assert.deepEqual(clean('json_loaded', { source: 'file', size_kb: NaN, depth: Infinity }), { source: 'file' });
});

test('every event lists its properties', () => {
  for (const [name, props] of Object.entries(EVENT_PROPS)) {
    assert.match(name, /^[a-z_]+$/);
    assert.ok(props.length > 0, name);
  }
});

test('sizes and counts are ranges or two significant digits', () => {
  assert.equal(round2(1_234_567), 1_200_000);
  assert.equal(round2(99), 99);
  assert.equal(round2(0.4), 0);
  assert.equal(round2(12.34), 12);
  assert.equal(sizeBucket(0), '0-1KB');
  assert.equal(sizeBucket(1024), '1-10KB');
  assert.equal(sizeBucket(50 * 1024), '10-100KB');
  assert.equal(sizeBucket(3 * 1024 * 1024), '1-10MB');
  assert.equal(sizeBucket(500 * 1024 * 1024), '100MB+');
  assert.equal(sizeKb(1000), 0);
  assert.equal(sizeKb(123_456), 120);
  assert.equal(countBucket(0), '0');
  assert.equal(countBucket(7), '1-9');
  assert.equal(countBucket(4321), '1k-9.9k');
  assert.equal(countBucket(5_000_000), '1M+');
});

test('file kind comes from the extension only', () => {
  assert.equal(fileKind('customer-records-acme.json'), 'json');
  assert.equal(fileKind('export.NDJSON'), 'jsonl');
  assert.equal(fileKind('config.yml'), 'yaml');
  assert.equal(fileKind('notes.docx'), 'other');
  assert.equal(fileKind('README'), 'other');
  assert.equal(fileKind(null), 'none');
});

test('every parser message maps to a category, never to its text', () => {
  const broken = [
    '{"a": 1,}',
    '{"a" 1}',
    '{a: 1}',
    "{'a': 1}",
    '{"a": "x\ny"}',
    '{"a": tru}',
    '{"a": True}',
    '{"a": None}',
    '{"a": NaN}',
    '{"a": 01}',
    '{"a": .5}',
    '{"a": 1.}',
    '{"a": +1}',
    '{"a": 0x1F}',
    '{"a": 1e}',
    '{"a": "\\x41"}',
    '{"a": "\\q"}',
    '{"a": "\\u12"}',
    '// note\n{"a": 1}',
    '{"a": 1} {"b": 2}',
    '{"a": [1, 2,, 3]}',
    '{"a": [1 2]}',
    '{"a": 1 "b": 2}',
    '{"a": [1, 2}',
    '{"a": {"b": 1]',
    '{"a": ObjectId("1")}',
    '﻿{"a": 1}',
    '{"a": hello world}',
    '{"a": "unterminated',
    '{"a": 1, "a": 2}',
    '{"a": 1',
    '[1, 2',
    '',
    '@',
    '[' .repeat(100000),
    '```json\n{"a": 1}\n```',
    '```json\n{"a": 1}\n``` and more',
  ];
  const seen = new Set<string>();
  for (const text of broken) {
    const r = parse(text);
    for (const i of [...r.issues, ...r.warnings, ...(r.error ? [r.error] : [])]) {
      const kind = errorKind(i.m)!;
      assert.notEqual(kind, 'other', `no category for parser message: ${i.m}`);
      assert.match(kind, /^[a-z_]+$/);
      seen.add(kind);
    }
  }
  assert.ok(seen.size >= 15, [...seen].join(' '));
  assert.equal(errorKind('Duplicate key "password"'), 'duplicate_key');
  assert.equal(errorKind(undefined), undefined);
});

test('a loaded document is reported as kinds, ranges and a category only', () => {
  const raw = {
    source: 'file' as const,
    editor: 1 as const,
    file: 'SECRET-customers.json',
    bytes: 123_456,
    status: 'fixable',
    msg: "Unexpected 'SECRET': strings must be wrapped in double quotes",
    count: 12,
    stats: { nodes: 4321, depth: 7, ms: 12.34 },
    jsonl: false,
    jwt: false,
  };
  const p = clean('json_loaded', loadedProps(raw))!;
  assert.deepEqual(p, {
    source: 'file', editor: 1, file_kind: 'json', size: '100KB-1MB', size_kb: 120, validity: 'fixable', error_kind: 'unquoted_string',
    issues: '10-99', nodes: '1k-9.9k', depth: 7, parse_ms: 12, jsonl: false, jwt: false,
  });
  assert.ok(!JSON.stringify(p).includes('SECRET'));
  assert.deepEqual(clean('json_loaded', loadedProps({ source: 'paste', editor: 2, file: null, bytes: 10, status: 'unknown' })), {
    source: 'paste', editor: 2, file_kind: 'none', size: '0-1KB', size_kb: 0, validity: 'unknown',
  });
});

test('URLs lose fragments and query strings, keep utm_ tags', () => {
  assert.equal(cleanUrl('https://tools.vikasmaur.com/#j=SECRET'), 'https://tools.vikasmaur.com/');
  assert.equal(cleanUrl('https://tools.vikasmaur.com/?url=https%3A%2F%2Finternal%2Fapi&utm_source=hn'), 'https://tools.vikasmaur.com/?utm_source=hn');
  assert.equal(cleanUrl('https://tools.vikasmaur.com/tools/json-diff?x=1#y'), 'https://tools.vikasmaur.com/tools/json-diff');
  assert.equal(cleanUrl('tools.vikasmaur.com'), 'tools.vikasmaur.com');
  assert.equal(cleanUrl('$direct'), '$direct');
});

test('beforeSend drops unexpected events and strips URLs', () => {
  assert.equal(beforeSend({ event: '$autocapture', properties: {} }), null);
  assert.equal(beforeSend({ event: '$exception', properties: {} }), null);
  assert.equal(beforeSend({ event: '$copy_autocapture', properties: {} }), null);
  assert.equal(beforeSend(null), null);
  const e = beforeSend({
    event: '$pageview',
    properties: { $current_url: 'https://tools.vikasmaur.com/?url=x#j=SECRET', $pathname: '/', $elements_chain: 'div:text="SECRET"', $el_text: 'SECRET', n: 3 },
    $set_once: { $initial_current_url: 'https://tools.vikasmaur.com/#j=SECRET' },
  })!;
  assert.equal(e.properties!.$current_url, 'https://tools.vikasmaur.com/');
  assert.equal(e.properties!.$pathname, '/');
  assert.equal(e.properties!.n, 3);
  assert.ok(!('$elements_chain' in e.properties!) && !('$el_text' in e.properties!));
  assert.equal(e.$set_once!.$initial_current_url, 'https://tools.vikasmaur.com/');
  assert.ok(!JSON.stringify(e).includes('SECRET'));
  const vitals = beforeSend({
    event: '$web_vitals',
    properties: { $web_vitals_LCP_event: { navigationURL: 'https://tools.vikasmaur.com/?ref=SECRET', $current_url: 'https://tools.vikasmaur.com/#j=SECRET', entries: [{ url: 'https://x.test/?q=SECRET' }] } },
  })!;
  assert.ok(!JSON.stringify(vitals).includes('SECRET'), JSON.stringify(vitals));
  const heat = beforeSend({
    event: '$$heatmap',
    properties: { $heatmap_data: { 'https://tools.vikasmaur.com/?ref=SECRET': [{ x: 1, y: 2 }], 'https://tools.vikasmaur.com/#j=SECRET': [{ x: 3, y: 4 }] } },
  })!;
  assert.deepEqual(heat.properties!.$heatmap_data, { 'https://tools.vikasmaur.com/': [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
  const snap = { event: '$snapshot', properties: { $snapshot_data: [1] } };
  assert.equal(beforeSend(snap), snap);
  assert.ok(beforeSend({ event: 'feature_used', properties: { feature: 'repair' } }));
});

test('replay masks readable attributes and keeps layout ones', () => {
  assert.equal(maskAttribute('title', 'Duplicate key "password"'), '********* *** **********');
  assert.equal(maskAttribute('aria-label', 'Copy'), '****');
  assert.equal(maskAttribute('data-tip', 'Copy path'), '**** ****');
  assert.equal(maskAttribute('data-path', '$.users[0].email'), '****************');
  assert.equal(maskAttribute('data-theme', 'dark'), 'dark');
  assert.equal(maskAttribute('class', 'btn icon'), 'btn icon');
  assert.equal(maskAttribute('style', '--split: 50%'), '--split: 50%');
  assert.equal(maskAttribute('href', 'data:application/json,{"a":1}'), '');
  assert.equal(maskAttribute('href', 'blob:https://tools.vikasmaur.com/1234'), '');
  assert.equal(maskAttribute('href', '/tools/json-diff?x=1#y'), '/tools/json-diff');
  assert.equal(maskAttribute('href', 'https://tools.vikasmaur.com/#j=SECRET'), 'https://tools.vikasmaur.com/');
  assert.equal(maskAttribute('d', 'M4 6H20V12'), 'M4 6H20V12');
});

test('every view that shows the document is kept out of session replay', () => {
  const tool = readFileSync(join(process.cwd(), 'components/JsonTool.tsx'), 'utf8');
  for (const [what, re] of [
    ['both editors', /className=\{`ed \$\{PRIVATE\}`\}/],
    ['the viewer (output, tree, table, convert, compare, find, errors)', /className=\{`view \$\{PRIVATE\}/],
    ['the tree path', /className=\{`path \$\{PRIVATE\}`\}/],
    ['the table location', /className=\{`crumbs \$\{PRIVATE\}`\}/],
    ['the file input', /ref=\{fileRef\} className=\{PRIVATE\}/],
  ] as const) assert.match(tool, re, what);
  assert.equal(tool.match(/className=\{`fname \$\{PRIVATE\}`\}/g)?.length, 2, 'both file names');
  const dialogs = readFileSync(join(process.cwd(), 'components/dialogs.tsx'), 'utf8');
  assert.match(dialogs, /className=\{PRIVATE\}\s+autoFocus\s+type="url"/, 'the Load from URL field');
  const index = readFileSync(join(process.cwd(), 'lib/analytics/index.ts'), 'utf8');
  assert.match(index, /export const PRIVATE = 'ph-no-capture';/);
  const ph = readFileSync(join(process.cwd(), 'lib/analytics/posthog.ts'), 'utf8');
  for (const opt of ["blockClass: 'ph-no-capture'", "maskTextSelector: '*'", 'maskAllInputs: true', 'recordBody: false', 'recordHeaders: false', 'autocapture: false', 'capture_exceptions: false', 'enable_recording_console_log: false', 'disable_capture_url_hashes: true']) {
    assert.ok(ph.includes(opt), opt);
  }
});
