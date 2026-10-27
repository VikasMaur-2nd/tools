import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { EVENT_PROPS, clean } from '../lib/analytics/events';
import type { Settings } from '../lib/engine/store';
import { formatDoc } from '../lib/json/format';
import { readJwt } from '../lib/json/jwt';
import { parse } from '../lib/json/parser';
import { decodeDoc, linkHash, parseLink } from '../lib/link';
import { descriptor } from '../lib/webmcp/descriptor';
import { MAX_RESULT, TOOLS, cap, cleanName, locator, type Doc, type Page } from '../lib/webmcp/tools';

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const JWT = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u('{"sub":"u1","name":"Ada","exp":1822348800}')}.c2ln`;

/** The page as the engine would act on it: the real parser and formatter, actions recorded. */
function fakePage(initial = '', fileName: string | null = null) {
  let text = initial;
  let indent = '  ';
  const calls: string[] = [];
  const files: { name: string; file: Blob }[] = [];
  const settings: ReturnType<Page['settings']> & Pick<Settings, 'view'> = {
    minify: false, escape: false, sortKeys: false, target: 'typescript', rootName: 'Root', tsStyle: 'interface', csharpLib: 'stj', view: 'format',
  };
  let shareFails = false;
  const page: Page = {
    doc(): Doc {
      const jwt = readJwt(text, indent);
      const src = jwt ? jwt.json : text;
      return { text, res: text.trim() ? parse(src) : null, src, jwt };
    },
    indent: () => indent,
    open(t, name) {
      calls.push(`open ${name}`);
      text = t;
    },
    show: (v) => void calls.push(`show ${v}`),
    format(o) {
      calls.push(`format ${o.style} ${o.sortKeys} ${o.indent ?? '-'}`);
      if (o.indent) indent = o.indent === 'tab' ? '\t' : ' '.repeat(Number(o.indent));
    },
    convert: (o) => void calls.push(`convert ${o.target} ${o.rootName ?? '-'} ${o.tsStyle ?? '-'} ${o.csharpLib ?? '-'}`),
    repair() {
      calls.push('repair');
      text = formatDoc(text, parse(text), indent);
    },
    imported(json, from) {
      calls.push(`imported ${from}`);
      text = json;
    },
    compare: () => void calls.push('compare'),
    fileName: () => fileName,
    settings: () => settings,
    save(file, name, feature) {
      calls.push(`save ${name} ${feature}`);
      files.push({ name, file });
    },
    async graphImage(format, name) {
      calls.push(`graph ${format} ${name ?? '-'}`);
      return { file: `${name ?? 'data'}.${format === 'jpeg' ? 'jpg' : format}`, size: 2048 };
    },
    async shareUrl() {
      if (shareFails) throw new Error('no CompressionStream');
      if (!text.trim()) return null;
      const r = parse(text);
      const compact = r.root && !r.error && !r.issues.length ? formatDoc(text, r, '') : text;
      return { url: `https://tools.vikasmaur.com/${await linkHash({ a: { text: compact }, view: settings.view })}`, comparing: false };
    },
  };
  return { page, calls, files, settings, text: () => text, failShare: () => (shareFails = true) };
}

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  assert.ok(t, name);
  return t;
};
const run = async (name: string, page: Page, input: Record<string, unknown> = {}) => tool(name).run(input, page);

describe('definitions', () => {
  test('every tool has a valid, unique name, a title, a description and an object schema', () => {
    const names = new Set<string>();
    for (const t of TOOLS) {
      assert.match(t.name, /^[A-Za-z0-9_.-]{1,128}$/);
      assert.ok(!names.has(t.name), t.name);
      names.add(t.name);
      assert.ok(t.title && t.description.length > 40, t.name);
      const schema = JSON.parse(JSON.stringify(t.inputSchema));
      assert.equal(schema.type, 'object');
      for (const r of schema.required ?? []) assert.ok(r in schema.properties, `${t.name}.${r}`);
    }
  });

  test('tools that return document content say so; only tools that leave the document alone are read-only', () => {
    for (const t of TOOLS) {
      if (t.name !== 'show_view') assert.equal(t.annotations.untrustedContentHint, true, t.name);
    }
    const readOnly = TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort();
    assert.deepEqual(readOnly, ['check_json', 'decode_jwt', 'get_json_value', 'share_link', 'show_view']);
  });

  test("analytics carries each tool's name and nothing else from the call", () => {
    assert.deepEqual(EVENT_PROPS.agent_tool_used, ['tool', 'ok']);
    for (const t of TOOLS) assert.deepEqual(clean('agent_tool_used', { tool: t.name, ok: true, input: '{"secret":1}' }), { tool: t.name, ok: true });
  });

  test('Excel is left out of the conversion targets (a binary download)', () => {
    const to = (tool('convert_json').inputSchema as { properties: { to: { enum: string[] } } }).properties.to.enum;
    assert.ok(to.includes('typescript') && to.includes('csv') && to.includes('jsonl'));
    assert.ok(!to.includes('xlsx'));
  });
});

describe('check_json', () => {
  test('valid JSON: its shape, size, values and depth', async () => {
    const r = await run('check_json', fakePage('{"a":[1,2],"b":"x"}').page);
    assert.equal(r.ok, true);
    assert.match(r.text, /^Valid JSON: an object with 2 keys \(19 B, 5 values, nesting depth 2\)\.$/);
  });

  test('fixable JSON: each issue with its line and column', async () => {
    const r = await run('check_json', fakePage('{\n  "a": 1,\n}').page);
    assert.equal(r.ok, true);
    assert.match(r.text, /^Not valid JSON yet: 1 issue, all of which repair_json fixes/);
    assert.match(r.text, /- line 2, column 9: /);
  });

  test("an error repair can't fix is reported with its position", async () => {
    const r = await run('check_json', fakePage('{"a": "unterminated').page);
    assert.equal(r.ok, true);
    assert.match(r.text, /isn't valid JSON: .*\(line 1, column \d+\)\. This has to be fixed by hand/);
  });

  test('empty editor, JSON Lines, duplicate keys and a JWT', async () => {
    assert.deepEqual(await run('check_json', fakePage('  ').page), { ok: false, text: 'The editor is empty. Open a document with open_json first.' });
    assert.match((await run('check_json', fakePage('{"a":1}\n{"a":2}\n').page)).text, /^Valid JSON Lines with 2 records/);
    assert.match((await run('repair_json', fakePage('{"a":1}\n{"a":2}\n').page)).text, /already valid JSON Lines/);
    assert.match((await run('check_json', fakePage('{"a":1} {"a":2}').page)).text, /^Not valid JSON yet: 1 issue/);
    assert.match((await run('check_json', fakePage('{"a":1,"a":2}').page)).text, /Warnings:\n- line 1, column \d+: Duplicate key/);
    assert.match((await run('check_json', fakePage(JWT).page)).text, /^The document is a JWT signed with HS256\./);
  });
});

describe('open_json and show_view', () => {
  test('opens the text, shows the view asked for and checks it', async () => {
    const f = fakePage('{}');
    const r = await run('open_json', f.page, { text: '[1,2,3]', name: ' data.json ', view: 'graph' });
    assert.deepEqual(f.calls, ['open data.json', 'show graph']);
    assert.equal(f.text(), '[1,2,3]');
    assert.match(r.text, /^Valid JSON: an array of 3 items/);
  });

  test('bad arguments are explained, and nothing changes', async () => {
    const f = fakePage('{}');
    assert.match((await run('open_json', f.page, {})).text, /^Error: give the document as text/);
    assert.match((await run('open_json', f.page, { text: '{}', view: 'pie' })).text, /^Error: view must be one of "format", "tree", "table", "graph"/);
    assert.match((await run('show_view', f.page, { view: 'compare' })).text, /^Error: view must be one of/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(await run('show_view', f.page, { view: 'table' }), { ok: true, text: 'Showing the table view.' });
  });
});

describe('get_json_value', () => {
  const doc = '{"users":[{"id":1,"name":"Ada","tags":["a"]},{"id":2,"name":"Lin"}],"total":2}';

  test('reads a value by JSONPath or JSON Pointer, with its keys', async () => {
    const { page } = fakePage(doc);
    const r = await run('get_json_value', page, { path: '$.users[0]' });
    assert.match(r.text, /^\$\.users\[0\] is an object with 3 keys:\n- "id": number\n- "name": string\n- "tags": array\n\nValue:\n\{\n {2}"id": 1,/);
    assert.match((await run('get_json_value', page, { path: '/users/1/name' })).text, /^\$\.users\[1\]\.name is a string\.\n\nValue \(the string itself\):\nLin$/);
    assert.match((await run('get_json_value', page)).text, /^\$ is an object with 2 keys/);
  });

  test('a path that goes nowhere says where it stops and what is there', async () => {
    const { page } = fakePage(doc);
    const missing = await run('get_json_value', page, { path: '$.users[0].email' });
    assert.equal(missing.ok, false);
    assert.equal(missing.text, 'Nothing at $.users[0].email: $.users[0] has no key "email". It has the keys "id", "name", "tags".');
    assert.match((await run('get_json_value', page, { path: '$.users[5]' })).text, /\$\.users has no item 5\. It has 2 items\./);
    assert.match((await run('get_json_value', page, { path: '$.users[' })).text, /^Error: can't read the path/);
  });

  test('a path that is not text, or not a JSON Pointer, is refused; a huge one is quoted back short', async () => {
    const { page } = fakePage(doc);
    for (const path of [12, null, ['$'], { a: 1 }]) assert.equal((await run('get_json_value', page, { path })).text, 'Error: path must be text, such as $.users[0].name or /users/0/name.');
    assert.match((await run('get_json_value', page, { path: '/users/~2' })).text, /^Error: can't read the path "\/users\/~2"\. .*~ is written ~0 and \/ is ~1/);
    const huge = await run('get_json_value', page, { path: '$' + '.a'.repeat(50_000) });
    assert.equal(huge.ok, false);
    assert.ok(huge.text.length < 1000, `${huge.text.length} characters`);
  });
});

describe('repair_json', () => {
  test('repairs in place and lists what it fixed', async () => {
    const f = fakePage("{a: 'x', b: True,}");
    const r = await run('repair_json', f.page);
    assert.equal(r.ok, true);
    assert.deepEqual(f.calls, ['repair']);
    assert.match(r.text, /^Repaired \d+ issues:\n- line 1, column 2: /);
    assert.ok(r.text.endsWith('The document now reads:\n{\n  "a": "x",\n  "b": true\n}'));
  });

  test('valid JSON is left alone', async () => {
    const f = fakePage('{"a":1}');
    assert.match((await run('repair_json', f.page)).text, /already valid JSON/);
    assert.deepEqual(f.calls, []);
  });
});

describe('format_json', () => {
  const doc = '{"b":1,"a":{"c":[true,null]}}';

  test('pretty, minified, escaped and sorted output, shown in the page', async () => {
    const f = fakePage(doc);
    assert.equal((await run('format_json', f.page, { indent: '4', sort_keys: true })).text, '{\n    "a": {\n        "c": [\n            true,\n            null\n        ]\n    },\n    "b": 1\n}');
    assert.equal((await run('format_json', f.page, { style: 'minified' })).text, doc);
    assert.equal((await run('format_json', f.page, { style: 'escaped' })).text, JSON.stringify(doc));
    assert.deepEqual(f.calls, ['format pretty true 4', 'format minified false -', 'format escaped false -']);
    assert.equal(f.text(), doc, 'the document itself is unchanged');
  });

  test('a fixable document is formatted repaired, with a note; bad options are explained', async () => {
    const f = fakePage('[1,2,]');
    assert.equal((await run('format_json', f.page, { style: 'minified' })).text, 'The document has 1 issue; this output fixes them (repair_json fixes the document itself).\n\n[1,2]');
    assert.match((await run('format_json', f.page, { style: 'compact' })).text, /^Error: style must be one of "pretty", "minified", "escaped"\.$/);
    assert.match((await run('format_json', f.page, { indent: 3 })).text, /^Error: indent must be one of/);
  });
});

describe('convert_json', () => {
  const doc = '{"id":1,"name":"Ada","tags":["x"]}';

  test('generates code with the options asked for, and shows it', async () => {
    const f = fakePage(doc);
    const r = await run('convert_json', f.page, { to: 'typescript', root_name: 'User', typescript_style: 'type' });
    assert.equal(r.ok, true);
    assert.match(r.text, /type User = \{/);
    assert.match(r.text, /name: string;/);
    assert.match((await run('convert_json', f.page, { to: 'csharp', csharp_library: 'Newtonsoft.Json' })).text, /JsonProperty\("name"\)/);
    assert.deepEqual(f.calls, ['convert typescript User type -', 'convert csharp - - newtonsoft']);
  });

  test('data formats, CSV included', async () => {
    const { page } = fakePage('[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"}]');
    assert.equal((await run('convert_json', page, { to: 'csv' })).text, 'id,name\r\n1,Ada\r\n2,Lin\r\n');
    assert.match((await run('convert_json', page, { to: 'yaml' })).text, /- id: 1\n {2}name: Ada/);
  });

  test('unknown targets and broken documents are explained', async () => {
    const { page } = fakePage(doc);
    assert.match((await run('convert_json', page, { to: 'xlsx' })).text, /^Error: to must be one of "typescript", "zod"/);
    assert.match((await run('convert_json', page, { to: 'go', typescript_style: 'class' })).text, /^Error: typescript_style/);
    assert.match((await run('convert_json', fakePage('{"a":').page, { to: 'go' })).text, /isn't valid JSON/);
  });
});

describe('import_to_json', () => {
  test('turns YAML into JSON in place', async () => {
    const f = fakePage('name: Ada\nage: 36\n');
    const r = await run('import_to_json', f.page, { from: 'yaml' });
    assert.equal(r.text, 'Turned the YAML into JSON:\n\n{\n  "name": "Ada",\n  "age": 36\n}');
    assert.deepEqual(f.calls, ['imported yaml']);
    assert.equal(f.text(), '{\n  "name": "Ada",\n  "age": 36\n}');
  });

  test('JSON stays JSON; unreadable text is explained', async () => {
    assert.match((await run('import_to_json', fakePage('{"a":1}').page, { from: 'yaml' })).text, /already valid JSON/);
    const bad = await run('import_to_json', fakePage('<a><b></a>').page, { from: 'xml' });
    assert.equal(bad.ok, false);
    assert.match(bad.text, /^Couldn't read the document as XML: /);
    assert.match((await run('import_to_json', fakePage('a: 1').page, { from: 'ini' })).text, /^Error: from must be one of/);
  });
});

describe('compare_json', () => {
  test('lists the differences and a JSON Patch, and opens Compare', async () => {
    const f = fakePage('{"id":7,"role":"admin","tags":["beta"]}');
    const r = await run('compare_json', f.page, { modified: '{"role":"editor","id":7,"tags":["beta","staff"]}' });
    assert.deepEqual(f.calls, ['compare']);
    assert.match(r.text, /^2 differences: 1 added, 1 changed\.\n/);
    assert.match(r.text, /- changed \$\.role: "admin" → "editor"/);
    assert.match(r.text, /- added \$\.tags\[1\]: "staff"/);
    const patch = JSON.parse(r.text.slice(r.text.indexOf('JSON Patch:\n') + 12));
    assert.deepEqual(patch, [{ op: 'replace', path: '/role', value: 'editor' }, { op: 'add', path: '/tags/1', value: 'staff' }]);
  });

  test('the listed changes and the patch share MAX_RESULT', async () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `user ${i}`, note: 'x'.repeat(40) }));
    const f = fakePage(JSON.stringify(rows));
    const r = await run('compare_json', f.page, { modified: '[]' });
    assert.match(r.text, /^20,000 differences( at least)?: 20,000 removed\./);
    assert.ok(r.text.length <= MAX_RESULT + 300, `${r.text.length} characters`);
    assert.match(r.text, /JSON Patch:\n\[/);
  });

  test('same documents, and an invalid other document', async () => {
    const { page } = fakePage('{"a":1,"b":2}');
    assert.equal((await run('compare_json', page, { modified: '{"b":2,"a":1}' })).text, 'The documents are the same (ignoring key order).');
    assert.match((await run('compare_json', page, { modified: '{"a":}' })).text, /^The other document isn't valid JSON: .*\(line 1, column 6\)/);
  });
});

describe('decode_jwt', () => {
  test('decodes the open token, signature unverified', async () => {
    const r = await run('decode_jwt', fakePage(JWT).page);
    assert.match(r.text, /^The decoded JWT \(its signature was not verified\):\n/);
    const doc = JSON.parse(r.text.slice(r.text.indexOf('\n') + 1));
    assert.deepEqual(doc.payload, { sub: 'u1', name: 'Ada', exp: 1822348800 });
    assert.match((await run('decode_jwt', fakePage('{"a":1}').page)).text, /not a JWT/);
  });
});

describe('download_file', () => {
  const doc = '{"b":1,"a":[{"id":1,"name":"Ada"}]}';
  const body = (f: { file: Blob }) => f.file.text();

  test('the document as it is, under its own name or one the agent gives', async () => {
    const f = fakePage('name: Ada\n', 'people.yaml');
    const r = await run('download_file', f.page, { what: 'document' });
    assert.equal(r.ok, true);
    assert.match(r.text, /^Downloading people\.yaml \(10 B\)\. It goes where this browser saves downloads\. If the browser asks/);
    await run('download_file', f.page, { what: 'document', name: '../secret/Team List.yaml' });
    assert.deepEqual(f.calls, ['save people.yaml download_input', 'save Team List.yaml download_input']);
    assert.equal(await body(f.files[0]), 'name: Ada\n');
    const g = fakePage(doc);
    await run('download_file', g.page, { what: 'document' });
    assert.deepEqual(g.calls, ['save data.json download_input']);
  });

  test('the formatted output, as the Format view settings make it', async () => {
    const f = fakePage(doc, 'orders.json');
    Object.assign(f.settings, { minify: true, sortKeys: true });
    await run('download_file', f.page, { what: 'formatted' });
    assert.equal(f.calls[0], 'save orders.min.json download_output');
    assert.equal(await body(f.files[0]), '{"a":[{"id":1,"name":"Ada"}],"b":1}');
    Object.assign(f.settings, { minify: false, sortKeys: false });
    await run('download_file', f.page, { what: 'formatted', name: 'pretty.json' });
    assert.equal(f.calls[1], 'save pretty.json download_output');
    assert.equal(await body(f.files[1]), formatDoc(doc, parse(doc), '  '));
  });

  test('converted code: the target asked for (shown in the page too), named as the page names it', async () => {
    const f = fakePage(doc, 'orders.json');
    await run('download_file', f.page, { what: 'converted' });
    await run('download_file', f.page, { what: 'converted', to: 'zod' });
    await run('download_file', f.page, { what: 'converted', to: 'java' });
    await run('download_file', f.page, { what: 'converted', to: 'csv', name: 'rows.csv' });
    assert.deepEqual(f.calls, [
      'save orders.ts download_convert',
      'convert zod - - -', 'save orders.schema.ts download_convert',
      'convert java - - -', 'save Root.java download_convert',
      'convert csv - - -', 'save rows.csv download_convert',
    ]);
    assert.match(await body(f.files[0]), /export interface Root \{/);
    assert.match(await body(f.files[1]), /z\.object/);
    assert.equal(f.files[3].file.type, 'text/csv');
  });

  test('an Excel workbook of the records', async () => {
    const f = fakePage(doc);
    const r = await run('download_file', f.page, { what: 'excel' });
    assert.equal(r.ok, true);
    assert.deepEqual(f.calls, ['save data.xlsx export_xlsx']);
    const bytes = new Uint8Array(await f.files[0].file.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b], 'a zip (PK) file');
  });

  test('a graph image, waiting for it to be made', async () => {
    const f = fakePage(doc);
    assert.equal((await run('download_file', f.page, { what: 'graph', image_format: 'svg', name: 'chart.svg' })).text, 'Downloading chart.svg (2.0 KB). It goes where this browser saves downloads.');
    await run('download_file', f.page, { what: 'graph' });
    assert.deepEqual(f.calls, ['graph svg chart', 'graph png -']);
  });

  test('nothing to download, a broken document and bad arguments are explained', async () => {
    assert.match((await run('download_file', fakePage('').page, { what: 'document' })).text, /editor is empty/);
    assert.match((await run('download_file', fakePage('{"a":').page, { what: 'converted' })).text, /isn't valid JSON/);
    assert.match((await run('download_file', fakePage(doc).page, { what: 'pdf' })).text, /^Error: what must be one of "document", "formatted", "converted", "excel", "graph"/);
    assert.match((await run('download_file', fakePage(doc).page, { what: 'graph', image_format: 'gif' })).text, /^Error: image_format/);
    assert.match((await run('download_file', fakePage(doc).page, { what: 'converted', to: 'xlsx' })).text, /^Error: to must be one of/);
  });

  test('file names from the agent lose folders and characters file systems refuse', () => {
    assert.equal(cleanName('../../etc/passwd'), 'passwd');
    assert.equal(cleanName('C:\\Users\\me\\re:port?.json'), 'report.json');
    assert.equal(cleanName('  .hidden  '), 'hidden');
    assert.equal(cleanName('a\u0000b\nc'), 'abc');
    assert.equal(cleanName('x'.repeat(300)).length, 100);
  });
});

describe('share_link', () => {
  test('a link that opens the document, the data inside it', async () => {
    const r = await run('share_link', fakePage('{ "a": [1, 2] }').page);
    assert.equal(r.ok, true);
    const url = r.text.split('\n')[1];
    assert.match(url, /^https:\/\/tools\.vikasmaur\.com\/#/);
    const link = parseLink(new URL(url).hash);
    assert.ok(link && typeof link === 'object' && link.a && 'data' in link.a);
    assert.equal(await decodeDoc(link.a.data), '{"a":[1,2]}');
    assert.equal(link.view, 'format');
  });

  test('as a Markdown or HTML button', async () => {
    const { page } = fakePage('{"a":1}');
    assert.match((await run('share_link', page, { as: 'markdown' })).text, /\n\[!\[View in Tool Kumar\]\(https:\/\/tools\.vikasmaur\.com\/badges\/[^)]+\)\]\(https:\/\/tools\.vikasmaur\.com\/#/);
    assert.match((await run('share_link', page, { as: 'html' })).text, /\n<a href="https:\/\/tools\.vikasmaur\.com\/#[^"]+"><picture>/);
    assert.match((await run('share_link', page, { as: 'qr' })).text, /^Error: as must be one of "link", "markdown", "html"/);
  });

  test('nothing open, a link too long to hand over, and a browser without compression', async () => {
    assert.match((await run('share_link', fakePage('').page)).text, /editor is empty/);
    // Random text barely compresses: a link far past what a tool returns.
    let big = '';
    for (let i = 0; big.length < 80_000; i++) big += ((i * 2654435761) >>> 0).toString(36);
    const long = await run('share_link', fakePage(JSON.stringify({ big })).page);
    assert.equal(long.ok, false);
    assert.match(long.text, /^The link is [\d.]+ KB, too long to hand over here\. The user can copy it with Share in the page/);
    const f = fakePage('{"a":1}');
    f.failShare();
    assert.equal((await run('share_link', f.page)).text, "This browser can't make share links.");
  });
});

describe('helpers', () => {
  test('long output is cut with a note, never between surrogate halves', () => {
    const long = 'x'.repeat(MAX_RESULT - 1) + '😀' + 'y'.repeat(10);
    const out = cap(long);
    assert.ok(out.startsWith('x'.repeat(MAX_RESULT - 1) + '\n…\n[Cut at 49,999 of 50,011 characters.'));
    assert.equal(cap('short'), 'short');
  });

  test('line and column are 1-based, for offsets in any order', () => {
    const at = locator('ab\ncd\n\nef');
    assert.equal(at(0), 'line 1, column 1');
    assert.equal(at(4), 'line 2, column 2');
    assert.equal(at(8), 'line 4, column 2');
    assert.equal(at(2), 'line 1, column 3');
    assert.equal(at(3), 'line 2, column 1');
  });
});

describe('/.well-known/mcp.json', () => {
  test('lists every tool the page registers, with no endpoint (they run in the page)', () => {
    const d = descriptor('https://tools.vikasmaur.com');
    assert.deepEqual(d.tools.map((t) => t.name), TOOLS.map((t) => t.name));
    for (const t of d.tools) {
      assert.ok(t.description.length > 40 && t.title, t.name);
      assert.ok(!('endpoint' in t), t.name);
    }
    assert.equal(d.homepage, 'https://tools.vikasmaur.com');
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d, 'plain JSON');
  });
});
