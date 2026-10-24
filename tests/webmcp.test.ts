import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { EVENT_PROPS, clean } from '../lib/analytics/events';
import { formatDoc } from '../lib/json/format';
import { readJwt } from '../lib/json/jwt';
import { parse } from '../lib/json/parser';
import { MAX_RESULT, TOOLS, cap, locator, type Doc, type Page } from '../lib/webmcp/tools';

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const JWT = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u('{"sub":"u1","name":"Ada","exp":1822348800}')}.c2ln`;

/** The page as the engine would act on it: the real parser and formatter, actions recorded. */
function fakePage(initial = '') {
  let text = initial;
  let indent = '  ';
  const calls: string[] = [];
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
  };
  return { page, calls, text: () => text };
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
    assert.deepEqual(readOnly, ['check_json', 'decode_jwt', 'get_json_value', 'show_view']);
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
