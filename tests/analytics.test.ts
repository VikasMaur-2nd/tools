import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_PROPS, clean, countBucket, errorKind, fileKind, loadedProps, round2, sizeBucket, sizeKb } from '../lib/analytics/events';
import type { Feature, ViewId } from '../lib/analytics/events';
import { beforeSend, cleanUrl, maskAttribute } from '../lib/analytics/redact';
import { ERROR_MESSAGE, exceptionProps } from '../lib/analytics/exceptions';
import { parse } from '../lib/json/parser';
import { TARGETS } from '../lib/engine/targets';
import type { IndentId, MenuArea, Theme, View } from '../lib/engine/store';
import type { SnippetFormat } from '../lib/badge';

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

test('clean lets through only values from each property\'s fixed list, and rounds every number', () => {
  // Plain tokens that aren't on the property's list never pass: an ID, a key or a word from the document.
  assert.deepEqual(clean('command_run', { command: 'customer-4521' }), {});
  assert.deepEqual(clean('command_run', { command: 'to-typescript' }), { command: 'to-typescript' });
  assert.deepEqual(clean('feature_used', { feature: 'password', via: 'mouse', view: 'secret', value: 'acme', on: 'true', jsonpath: 1 }), {});
  assert.deepEqual(clean('feature_used', { feature: 'theme', value: 'dark' }), { feature: 'theme', value: 'dark' });
  assert.deepEqual(clean('view_opened', { view: 'convert', via: 'pointer', target: 'acme_corp' }), { view: 'convert', via: 'pointer' });
  assert.deepEqual(clean('convert_option_changed', { option: 'root_name', value: 'Customer' }), {});
  assert.deepEqual(
    clean('json_loaded', { source: 'clipboard', editor: 3, file_kind: 'secret', size: '12345', validity: 'ok', error_kind: 'password', issues: '17', nodes: 'abc', jsonl: 'yes' }),
    {},
  );
  // Numbers keep two significant digits whatever the call site sends; a list of numbers takes only those.
  assert.deepEqual(clean('json_loaded', { editor: 2, size_kb: 123_456, depth: 7.4, parse_ms: 12.345 }), { editor: 2, size_kb: 120_000, depth: 7, parse_ms: 12 });
  assert.deepEqual(clean('feature_used', { feature: 'expand_level', level: 1234 }), { feature: 'expand_level', level: 1200 });
  assert.deepEqual(clean('feature_used', { feature: 'expand_level', level: -3 }), { feature: 'expand_level', level: 0 });
  // Booleans only where a property is a yes or no.
  assert.deepEqual(clean('feature_used', { feature: 'wrap', on: true, level: true, value: false }), { feature: 'wrap', on: true });
});

test('every value the site sends is on its property\'s list', () => {
  // (lib/engine/commands.ts imports the engine's types: read its IDs from the source.)
  const commands = [...readFileSync(join(process.cwd(), 'lib/engine/commands.ts'), 'utf8').matchAll(/\bid: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(commands.length > 50, `${commands.length} commands`);
  for (const id of [...commands, ...TARGETS.map((t) => `to-${t.id}`)]) assert.deepEqual(clean('command_run', { command: id }), { command: id }, id);
  for (const t of TARGETS) {
    const group = t.group === 'Types' ? 'types' : 'data';
    assert.deepEqual(clean('convert_target_selected', { target: t.id, group, via: 'palette' }), { target: t.id, group, via: 'palette' });
    assert.deepEqual(clean('view_opened', { view: 'convert', via: 'keyboard', target: t.id }), { view: 'convert', via: 'keyboard', target: t.id });
  }
  const values: [string, Record<string, unknown>][] = [
    ...(['interface', 'type'] as const).map((value): [string, Record<string, unknown>] => ['convert_option_changed', { option: 'ts_style', value }]),
    ...(['stj', 'newtonsoft'] as const).map((value): [string, Record<string, unknown>] => ['convert_option_changed', { option: 'csharp_lib', value }]),
    ...['pretty', 'minify', 'string'].map((value): [string, Record<string, unknown>] => ['format_option_changed', { option: 'style', value }]),
    ...[true, false].map((on): [string, Record<string, unknown>] => ['format_option_changed', { option: 'sort_keys', value: String(on) }]),
    ...(['2', '4', 'tab'] satisfies IndentId[]).map((value): [string, Record<string, unknown>] => ['format_option_changed', { option: 'indent', value }]),
    ...(['link', 'markdown', 'html'] satisfies SnippetFormat[]).map((value): [string, Record<string, unknown>] => ['feature_used', { feature: 'share_link', value }]),
    ...(['system', 'light', 'dark'] satisfies Theme[]).map((value): [string, Record<string, unknown>] => ['feature_used', { feature: 'theme', value }]),
    ...(['input', 'compare', 'format', 'convert', 'tree', 'table', 'graph', 'diff'] satisfies MenuArea[]).map((value): [string, Record<string, unknown>] => ['feature_used', { feature: 'context_menu', value }]),
    ...(['format', 'tree', 'table', 'graph', 'convert', 'compare'] satisfies View[]).map((view): [string, Record<string, unknown>] => ['view_opened', { view, via: 'other' }]),
  ];
  for (const [event, props] of values) assert.deepEqual(clean(event, props), props, JSON.stringify(props));
  // Whatever a document is like, its json_loaded event passes whole.
  for (const status of ['valid', 'fixable', 'error', 'parsing']) {
    for (const bytes of [0, 5000, 3e6, 2e9]) {
      for (const msg of ['Unexpected end of input', 'Duplicate key "a"', 'something else', undefined]) {
        const p = loadedProps({ source: 'drop', editor: 1, file: 'x.yml', bytes, status, msg, count: bytes, warnings: 1, stats: { nodes: bytes, depth: 80, ms: bytes / 7 }, jsonl: true, jwt: false });
        const sent = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
        assert.deepEqual(clean('json_loaded', p), sent, JSON.stringify(p));
      }
    }
  }
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
  const search = beforeSend({ event: 'feature_used', properties: { feature: 'find', ph_keyword: 'SECRET', $set_once: { $initial_ph_keyword: 'SECRET' } } })!;
  assert.ok(!JSON.stringify(search).includes('SECRET'));
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

test("replay shows the site's labels and masks attributes that can carry a visitor's data", () => {
  const el = (tagName: string, labelsPrivate = false) => ({ tagName, closest: () => (labelsPrivate ? {} : null) }) as unknown as Element;
  assert.equal(maskAttribute('aria-label', 'Copy', el('BUTTON')), 'Copy');
  assert.equal(maskAttribute('data-tip', 'Copy path', el('BUTTON')), 'Copy path');
  assert.equal(maskAttribute('placeholder', 'Find', el('INPUT')), 'Find');
  // A site control whose tooltip mentions the document (PRIVATE_LABELS).
  assert.equal(maskAttribute('data-tip', '34% smaller', el('BUTTON', true)), '*** *******');
  assert.equal(maskAttribute('value', 'TKSECRET', el('INPUT')), '********');
  assert.equal(maskAttribute('value', 'typescript', el('OPTION')), 'typescript');
  assert.equal(maskAttribute('value', 'go', el('SELECT')), 'go');
  assert.equal(maskAttribute('download', 'customers.json', el('A')), '**************');
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

test('exception reports rebuild every error and cause without document data', () => {
  const secret = 'PRIVATE_CANARY_CUSTOMER_DATA';
  const script = 'https://tools.vikasmaur.com/_next/static/chunks/app-123.js';
  const id = '0199ec80-1234-7123-8abc-0123456789ab';
  const exception = (type: string) => ({
    type, value: secret, module: secret,
    mechanism: { type: secret, source: secret, data: { secret } },
    stacktrace: { type: 'raw', frames: [{
      filename: `${script}?utm_source=${secret}#${secret}`, lineno: 12, colno: 34,
      function: secret, abs_path: secret, context_line: secret,
      pre_context: [secret], post_context: [secret], vars: { [secret]: secret },
      chunk_id: id,
    }, { filename: `https://private.example/${secret}.js`, lineno: 5 }] },
  });
  const payload = {
    event: '$exception',
    properties: {
      token: 'phc_project', distinct_id: id, $device_id: id, $session_id: id, $window_id: id,
      $release_id: id, $lib: 'web', $lib_version: '1.438.12',
      error_source: 'unhandled_error', $exception_list: [exception('TypeError'), exception(secret)],
      $exception_message: secret, $exception_stack_trace_raw: secret, $exception_fingerprint: secret,
      $issue_name: secret, $issue_description: secret, $exception_steps: [{ $message: secret }],
      $current_url: `https://tools.vikasmaur.com/?utm_source=${secret}#j=${secret}`,
      $set: { [secret]: secret }, $set_once: { [secret]: secret }, custom: secret,
    },
    $set: { [secret]: secret }, $set_once: { [secret]: secret }, $unset: [secret],
  };
  const out = beforeSend(payload, new Set([script]))!;
  assert.ok(!JSON.stringify(out).includes(secret));
  assert.equal(out.$set, undefined);
  assert.equal(out.$set_once, undefined);
  assert.equal(out.$unset, undefined);
  assert.deepEqual(out.properties.$exception_list, [
    { type: 'TypeError', value: ERROR_MESSAGE, mechanism: { type: 'generic', handled: false }, stacktrace: { type: 'raw', frames: [{
      platform: 'web:javascript', filename: script, in_app: true, lineno: 12, colno: 34, chunk_id: id,
    }] } },
    { type: 'Error', value: ERROR_MESSAGE, mechanism: { type: 'generic', handled: false }, stacktrace: { type: 'raw', frames: [{
      platform: 'web:javascript', filename: script, in_app: true, lineno: 12, colno: 34, chunk_id: id,
    }] } },
  ]);
  assert.equal(out.properties.token, 'phc_project');
  assert.equal(out.properties.$session_id, id);
  assert.equal(out.properties.$release_id, id);
  // No mutation: neither the original Error data nor SDK payload is changed.
  assert.equal(payload.properties.$exception_list[0].value, secret);
});

test('exception sanitizer rejects unknown stack paths and malformed payloads', () => {
  assert.equal(exceptionProps({}, new Set()), null);
  assert.equal(exceptionProps({ $exception_list: [] }, new Set()), null);
  const data = { $exception_list: [{ type: 'SyntaxError', value: 'SECRET', stacktrace: { frames: [
    { filename: 'data:text/javascript,SECRET' }, { filename: 'blob:https://tools.vikasmaur.com/SECRET' },
    { filename: 'https://tools.vikasmaur.com/_next/static/chunks/SECRET.js' },
    { filename: 'chrome-extension://SECRET/app.js' },
  ] } }], error_source: 'SECRET', distinct_id: 'SECRET', $release_id: 'SECRET' };
  const out = exceptionProps(data, new Set())!;
  assert.ok(!JSON.stringify(out).includes('SECRET'));
  assert.deepEqual(out.$exception_list, [{ type: 'SyntaxError', value: ERROR_MESSAGE, mechanism: { type: 'generic', handled: true } }]);
  assert.equal(out.error_source, 'manual');
  assert.equal(out.distinct_id, undefined);
  assert.equal(out.$release_id, undefined);
});

test('exception sanitizer bounds chained errors, stack depth and coordinates', () => {
  const script = 'https://tools.vikasmaur.com/_next/static/chunks/app.js';
  const out = exceptionProps({ $exception_list: Array.from({ length: 100 }, () => ({
    type: 'Error', stacktrace: { frames: Array.from({ length: 100 }, () => ({ filename: script, lineno: Infinity, colno: -1, chunk_id: 'SECRET' })) },
  })) }, new Set([script]))!;
  const list = out.$exception_list as { stacktrace: { frames: Record<string, unknown>[] } }[];
  assert.equal(list.length, 5);
  assert.equal(list[0].stacktrace.frames.length, 50);
  assert.deepEqual(list[0].stacktrace.frames[0], { platform: 'web:javascript', filename: script, in_app: true });
});

test('every view that shows the document is kept out of session replay', () => {
  const tool = readFileSync(join(process.cwd(), 'components/JsonTool.tsx'), 'utf8');
  for (const [what, re] of [
    ['both editors', /className=\{`ed \$\{PRIVATE\}`\}/],
    ['the viewer (output, tree, table, graph, convert, compare, find, errors)', /className=\{`view \$\{PRIVATE\}/],
    ['the tree path', /className=\{`path \$\{PRIVATE\}`\}/],
    ['the table location', /className=\{`crumbs \$\{PRIVATE\}`\}/],
    ['toasts (file names and export errors)', /className=\{`toasts \$\{PRIVATE\}`\}/],
    ['the file input', /ref=\{fileRef\} className=\{PRIVATE\}/],
    ['the status bar (errors, JWT, sizes, counts)', /className=\{`sb-l \$\{PRIVATE\}`\}/],
    ['the caret position', /className=\{`cursor muted \$\{PRIVATE\}`\}/],
    ['the Minify tooltip ("34% smaller")', /className=\{PRIVATE_LABELS\}/],
  ] as const) assert.match(tool, re, what);
  assert.equal(tool.match(/className=\{`seg-size \$\{PRIVATE\}`\}/g)?.length, 3, 'the output sizes');
  assert.equal(tool.match(/className=\{`fname \$\{PRIVATE\}`\}/g)?.length, 2, 'both file names');
  assert.match(tool, /id="view-graph" className="gv" ref=\{graphRef\}/, 'graph is hosted in the private viewer');
  const dialogs = readFileSync(join(process.cwd(), 'components/dialogs.tsx'), 'utf8');
  assert.match(dialogs, /className=\{PRIVATE\}\s+autoFocus\s+type="url"/, 'the Load from URL field');
  const builder = readFileSync(join(process.cwd(), 'components/LinkBuilder.tsx'), 'utf8');
  assert.equal(builder.match(/className=\{`lb-error \$\{PRIVATE\}`\}/g)?.length, 2, 'builder messages (file names)');
  assert.equal(builder.match(/className=\{`lb-warn \$\{PRIVATE\}`\}/g)?.length, 2, 'builder link-size warnings');
  assert.match(builder, /className=\{`lb-check \$\{PRIVATE\}`\}/, "builder check line (\"Ln 1, Col 8: Unexpected 'T'\")");
  const graphExport = readFileSync(join(process.cwd(), 'components/GraphExport.tsx'), 'utf8');
  assert.match(graphExport, /gx-info\$\{preview\?\.error \? ' err' : ''\} \$\{PRIVATE\}/, 'image size and card count');
  const index = readFileSync(join(process.cwd(), 'lib/analytics/index.ts'), 'utf8');
  assert.match(index, /export const PRIVATE = 'ph-no-capture';/);
  const ph = readFileSync(join(process.cwd(), 'lib/analytics/posthog.ts'), 'utf8');
  assert.ok(!ph.includes('maskTextSelector'), "the site's own text is not masked");
  for (const opt of ["blockClass: 'ph-no-capture'", 'text: true', 'textarea: true', 'search: true', 'url: true', 'select: false', 'recordBody: false', 'recordHeaders: false', 'autocapture: false', 'capture_exceptions: false', 'enable_recording_console_log: false', 'disable_capture_url_hashes: true', 'captureConsoleLogs: false, beforeSend: () => null']) {
    assert.ok(ph.includes(opt), opt);
  }
});

test('graph analytics use fixed view and feature values', () => {
  const view: ViewId = 'graph';
  const features: Feature[] = ['graph_fit', 'graph_zoom_in', 'graph_zoom_out', 'graph_export_png', 'graph_export_jpeg', 'graph_export_svg', 'graph_copy_image', 'graph_jump'];
  assert.deepEqual(clean('view_opened', { view, via: 'pointer' }), { view, via: 'pointer' });
  for (const feature of features) {
    assert.deepEqual(clean('feature_used', { feature, view, via: 'palette', filename: 'secret.json' }), { feature, view, via: 'palette' });
  }
});
