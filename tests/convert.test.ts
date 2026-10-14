import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { convert, highlightCode, TARGETS, type ConvertOptions } from '../lib/convert';
import { infer, singular } from '../lib/convert/infer';

const doc = (src: string) => {
  const r = parse(src);
  assert.ok(r.root, r.error?.m);
  return r.root;
};
const conv = (src: string, target: string, opts: Partial<ConvertOptions> = {}) => convert(doc(src), target, { rootName: 'Root', ...opts });
const has = (out: string, ...parts: string[]) => {
  for (const p of parts) assert.ok(out.includes(p), `expected to find:\n${p}\n--- in ---\n${out}`);
};

const API = JSON.stringify({
  id: 12345678901234567890,
  page: 1,
  'first-name': 'Ada',
  '1abc': true,
  class: 'x',
  type: 'admin',
  createdAt: '2024-01-02T03:04:05Z',
  email: 'ada@example.com',
  tags: ['a', 'b'],
  empty: [],
  meta: {},
  users: [
    { id: 1, name: 'A', address: { street: 'S', city: 'C' }, nick: null },
    { id: 2, name: 'B', nick: 'bee', address: { street: 'T', city: 'D' }, roles: ['admin'] },
  ],
  billing: { street: 'S', city: 'C' },
  categories: [{ name: 'x' }],
  data: [{ k: 1.5 }, { k: 2 }],
  名前: 'ユニコード',
});

test('TARGETS are ordered and complete', () => {
  assert.deepEqual(
    TARGETS.map((t) => t.id),
    ['typescript', 'zod', 'json-schema', 'csharp', 'dart', 'java', 'python', 'go', 'kotlin', 'swift', 'php', 'rust', 'csv', 'yaml', 'xml', 'toml', 'jsonl'],
  );
  assert.ok(TARGETS.every((t) => t.group === (['csv', 'yaml', 'xml', 'toml', 'jsonl'].includes(t.id) ? 'Data' : 'Types')));
  assert.throws(() => conv('1', 'cobol'));
});

test('infer merges arrays of objects, dedupes and names types', () => {
  const m = infer(doc(API), { rootName: 'Root' });
  assert.deepEqual(
    m.types.map((t) => t.name),
    ['Root', 'User', 'Address', 'Category', 'DataItem'],
  );
  const user = m.types[1];
  assert.equal(user.n, 2);
  assert.equal(user.props.get('roles')!.opt, true);
  assert.equal(user.props.get('nick')!.opt, false);
  // billing has the same shape as users[].address: one type
  assert.equal(m.types[0].props.get('billing')!.s.obj, user.props.get('address')!.s.obj);
  assert.equal(m.types[0].props.get('id')!.s.big, 2);
  assert.equal(m.types[0].props.get('createdAt')!.s.fmt, 'date-time');
  assert.equal(m.types[0].props.get('name')?.s, undefined);
});

test('singularization and unique names', () => {
  const cases: [string, string | null][] = [
    ['users', 'user'],
    ['categories', 'category'],
    ['addresses', 'address'],
    ['boxes', 'box'],
    ['statuses', 'status'],
    ['movies', 'movie'],
    ['people', 'person'],
    ['data', null],
    ['status', null],
    ['news', null],
  ];
  for (const [w, s] of cases) assert.equal(singular(w), s, w);
  const m = infer(doc('{"a":{"item":{"x":1}},"b":{"item":{"y":"s"}},"String":{"z":1}}'), { rootName: 'Root' }, 'String');
  assert.deepEqual(
    m.types.map((t) => t.name),
    ['Root', 'A', 'Item', 'B', 'Item2', 'StringClass'],
  );
});

test('formats are only reported when every value matches', () => {
  const out = conv('[{"d":"2024-01-01","u":"https://x.io/a"},{"d":"2024-02-03","u":"not a url"}]', 'json-schema');
  const s = JSON.parse(out);
  assert.equal(s.$defs.RootItem.properties.d.format, 'date');
  assert.equal(s.$defs.RootItem.properties.u.format, undefined);
});

test('TypeScript', () => {
  const out = conv(API, 'typescript');
  has(
    out,
    'export interface Root {\n  id: number; // exceeds Number.MAX_SAFE_INTEGER',
    '  "first-name": string;\n  "1abc": boolean;\n  class: string;',
    '  empty: unknown[];\n  meta: Record<string, unknown>;\n  users: User[];',
    '  billing: Address;',
    'export interface User {\n  id: number;\n  name: string;\n  address: Address;\n  nick: string | null;\n  roles?: string[];\n}',
    '  data: DataItem[];',
  );
  assert.equal(conv('[1, "a", null]', 'typescript'), 'export type Root = (number | string | null)[];\n');
  assert.equal(conv('{"a":1}', 'typescript', { tsStyle: 'type', optionalAll: true }), 'export type Root = {\n  a?: number;\n};\n');
  assert.equal(conv('{"1":{"a":1},"2":{"a":2}}', 'typescript'), 'export type Root = Record<string, RootItem>;\n\nexport interface RootItem {\n  a: number;\n}\n');
});

test('Zod', () => {
  const out = conv(API, 'zod');
  has(
    out,
    'import { z } from "zod";',
    'export const AddressSchema = z.object({',
    '  nick: z.string().nullable(),\n  roles: z.array(z.string()).optional(),',
    '  createdAt: z.string().datetime({ offset: true }),',
    '  email: z.string().email(),',
    '  page: z.number().int(),',
    '  id: z.number(), //',
    'export type Root = z.infer<typeof RootSchema>;',
  );
  // dependencies are declared before use
  assert.ok(out.indexOf('const AddressSchema') < out.indexOf('const UserSchema'));
  has(conv('[{"a":null},{"b":1}]', 'zod'), 'a: z.null().optional()', 'b: z.number().int().optional()');
  has(conv('[{"a":"x"},{"a":null},{}]', 'zod'), 'a: z.string().nullish()');
});

test('JSON Schema', () => {
  const s = JSON.parse(conv(API, 'json-schema'));
  assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(s.type, 'object');
  assert.ok(s.required.includes('first-name'));
  assert.deepEqual(s.properties.users, { type: 'array', items: { $ref: '#/$defs/User' } });
  assert.deepEqual(s.$defs.User.required, ['id', 'name', 'address', 'nick']);
  assert.deepEqual(s.$defs.User.properties.nick, { type: ['string', 'null'] });
  assert.equal(s.properties.email.format, 'email');
  assert.deepEqual(s.$defs.DataItem.properties.k, { type: 'number' });
  const n = JSON.parse(conv('{"a":[{"x":1},null]}', 'json-schema'));
  assert.deepEqual(n.properties.a.items, { anyOf: [{ $ref: '#/$defs/AItem' }, { type: 'null' }] });
});

test('Go', () => {
  const out = conv(API, 'go');
  has(
    out,
    'package main\n\nimport "math/big"\n',
    '\tID         *big.Int ',
    '`json:"id"`',
    '\tFirstName  string ',
    '`json:"first-name"`',
    '\tThe1abc ',
    '\tCreatedAt ',
    'type User struct {',
    '\tNick    *string  `json:"nick"`',
    '\tRoles   []string `json:"roles,omitempty"`',
    '\tX名前 ',
  );
  has(conv('[{"a":{"x":1}},{}]', 'go'), 'A *A `json:"a,omitempty"`', 'type Root []RootItem');
  has(conv('{"user_url":"x"}', 'go'), 'UserURL string `json:"user_url"`');
});

test('Python (Pydantic v2)', () => {
  const out = conv(API, 'python');
  has(
    out,
    'from typing import Any, Dict, List, Optional\n\nfrom pydantic import BaseModel, Field\n\n\nclass Address(BaseModel):',
    '    nick: Optional[str]\n    roles: Optional[List[str]] = None',
    '    first_name: str = Field(alias="first-name")',
    '    the_1abc: bool = Field(alias="1abc")',
    '    class_: str = Field(alias="class")',
    '    empty: List[Any]\n    meta: Dict[str, Any]',
    '    名前: str',
  );
  assert.ok(out.indexOf('class Address') < out.indexOf('class User') && out.indexOf('class User') < out.indexOf('class Root'));
  has(conv('[1, 2.5]', 'python'), 'class Root(RootModel[List[float]]):\n    root: List[float]');
  has(conv('{"v":[1,"a"],"_id":1}', 'python'), 'v: List[Union[int, str]]', 'id: int = Field(alias="_id")');
});

test('Rust (serde)', () => {
  const out = conv(API, 'rust');
  has(
    out,
    'use serde::{Deserialize, Serialize};\nuse std::collections::HashMap;',
    '#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct Root {',
    '    pub id: i128,',
    '    #[serde(rename = "first-name")]\n    pub first_name: String,',
    '    pub r#type: String,',
    '    #[serde(rename = "createdAt")]\n    pub created_at: String,',
    '    pub nick: Option<String>,\n    #[serde(skip_serializing_if = "Option::is_none")]\n    pub roles: Option<Vec<String>>,',
    '    pub empty: Vec<serde_json::Value>,',
  );
  has(conv('{"firstName":"a","lastName":"b","userId":1}', 'rust'), '#[serde(rename_all = "camelCase")]\npub struct Root {\n    pub first_name: String,');
});

test('Java, C#, Kotlin, Swift', () => {
  has(
    conv(API, 'java'),
    'import com.fasterxml.jackson.annotation.JsonProperty;\nimport java.math.BigInteger;\nimport java.util.List;\nimport java.util.Map;',
    'public record Root(\n    BigInteger id,',
    '    @JsonProperty("first-name") String firstName,',
    '    @JsonProperty("class") String class_,',
    ') {\n    public record User(long id, String name, Address address, String nick, List<String> roles) {}\n\n    public record Address(',
  );
  has(
    conv(API, 'csharp'),
    'using System.Collections.Generic;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;',
    '    [JsonPropertyName("first-name")]\n    public required string FirstName { get; set; }',
    '    public required string? Nick { get; set; }',
    '    public List<string>? Roles { get; set; }',
    '    public required Dictionary<string, JsonElement> Meta { get; set; }',
  );
  const nj = conv('{"name":{"name":"x"},"v":[1,"a"]}', 'csharp', { csharpLib: 'newtonsoft' });
  has(nj, 'using Newtonsoft.Json;', 'using Newtonsoft.Json.Linq;', '[JsonProperty("name")]', 'public required string NameValue { get; set; }', 'List<JToken>');
  assert.ok(!nj.includes('System.Text.Json'));
  has(
    conv(API, 'kotlin'),
    'import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement',
    '@Serializable\ndata class Root(',
    '    @SerialName("first-name") val firstName: String,',
    '    val `class`: String,',
    '    val nick: String? = null,\n    val roles: List<String>? = null,',
  );
  const sw = conv(API, 'swift');
  has(sw, 'import Foundation', 'struct User: Codable {\n    let id: Int', '    let roles: [String]?', '        case firstName = "first-name"', '    let `class`: String', 'enum JSONValue: Codable');
  assert.ok(!conv('{"a":1}', 'swift').includes('JSONValue'));
});

test('Dart and PHP', () => {
  const d = conv(API, 'dart');
  has(
    d,
    'class Root {\n  final num id;',
    '  final String firstName;',
    '  final String? nick;\n  final List<String>? roles;',
    "    firstName: json['first-name'] as String,",
    "    users: (json['users'] as List<dynamic>).map((e) => User.fromJson(e as Map<String, dynamic>)).toList(),",
    "    roles: (json['roles'] as List<dynamic>?)?.map((e) => e as String).toList(),",
    "    k: (json['k'] as num).toDouble(),",
    "    if (roles != null) 'roles': roles,",
    "    'billing': billing.toJson(),",
    '  final String field;', // non-ASCII key falls back to an ASCII identifier
  );
  has(conv('{"$k":1}', 'dart'), "json['\\$k']");
  const p = conv(API, 'php');
  has(
    p,
    '<?php\n\ndeclare(strict_types=1);',
    'final class Root\n{\n    public function __construct(\n        public readonly float $id,',
    '        /** @var User[] */\n        public readonly array $users,',
    '        public readonly ?string $nick,',
    '        /** @var string[]|null */\n        public readonly ?array $roles,',
    "            users: array_map(static fn ($x) => User::fromArray($x), $data['users']),",
    "            firstName: $data['first-name'],",
    "            roles: $data['roles'] ?? null,",
  );
});

test('YAML quotes ambiguous strings and keeps numbers exact', () => {
  const src = JSON.stringify({
    plain: 'hello world',
    yes: 'yes',
    no: 'No',
    nul: 'null',
    tilde: '~',
    num: '1.0',
    oct: '0o17',
    date: '2024-01-01',
    lead: ' x',
    colon: 'a: b',
    hash: 'a #b',
    dash: '- x',
    empty: '',
    multi: 'one\ntwo\n',
    strip: 'one\ntwo',
    ctrl: 'a\u0007b',
    list: [1, { a: 1, b: [] }, [2, 3]],
    obj: {},
  }).replace(/}$/, ',"big":12345678901234567890,"exp":1E5}');
  assert.equal(
    conv(src, 'yaml'),
    [
      'plain: hello world',
      '"yes": "yes"',
      '"no": "No"',
      'nul: "null"',
      'tilde: "~"',
      'num: "1.0"',
      'oct: "0o17"',
      'date: "2024-01-01"',
      'lead: " x"',
      'colon: "a: b"',
      'hash: "a #b"',
      'dash: "- x"',
      'empty: ""',
      'multi: |',
      '  one',
      '  two',
      'strip: |-',
      '  one',
      '  two',
      'ctrl: "a\\u0007b"',
      'list:',
      '  - 1',
      '  - a: 1',
      '    b: []',
      '  - - 2',
      '    - 3',
      'obj: {}',
      'big: 12345678901234567890',
      'exp: 1.0e+5',
      '',
    ].join('\n'),
  );
  assert.equal(conv('[]', 'yaml'), '[]\n');
  assert.equal(conv('"a\\nb"', 'yaml'), '|-\n  a\n  b\n');
  assert.equal(conv('{"a":1,"a":2}', 'yaml'), 'a: 2\n');
});

test('CSV', () => {
  assert.equal(
    conv('[{"id":1,"name":"Smith, J","q":"say \\"hi\\""},{"id":2,"tags":["a"],"name":null,"x":"l1\\nl2"}]', 'csv'),
    'id,name,q,tags,x\n1,"Smith, J","say ""hi""",,\n2,,,"[""a""]","l1\nl2"\n',
  );
  assert.equal(conv('{"a":1,"b":{"c":true}}', 'csv'), 'a,b\n1,"{""c"":true}"\n');
  assert.equal(conv('[[1,2],[3,4]]', 'csv'), '1,2\n3,4\n');
  assert.equal(conv('[1,"x"]', 'csv'), 'value\n1\nx\n');
  assert.equal(conv('12345678901234567890', 'csv'), 'value\n12345678901234567890\n');
});

test('XML', () => {
  assert.equal(
    conv('{"a & b":"<x> & \\"y\\"","list":[1,2],"1st":null,"o":{"@id":"7","#text":"t"},"m":[[1],[2]]}', 'xml', { rootName: 'Data' }),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<data>',
      '  <a___b>&lt;x&gt; &amp; "y"</a___b>',
      '  <list>1</list>',
      '  <list>2</list>',
      '  <_1st/>',
      '  <o id="7">t</o>',
      '  <m>',
      '    <item>1</item>',
      '  </m>',
      '  <m>',
      '    <item>2</item>',
      '  </m>',
      '</data>',
      '',
    ].join('\n'),
  );
  has(conv('[{"a":1}]', 'xml'), '<root>\n  <item>\n    <a>1</a>\n  </item>\n</root>');
});

test('TOML', () => {
  assert.equal(
    conv('{"title":"T","n":null,"owner":{"name":"A","dob":"1979"},"servers":[{"ip":"1","tags":["a"]},{"ip":"2"}],"mixed":[1,null],"weird key":{"x":1}}', 'toml'),
    [
      'title = "T"',
      '# n = null (omitted: TOML has no null)',
      'mixed = [1]  # null values omitted (TOML has no null)',
      '',
      '[owner]',
      'name = "A"',
      'dob = "1979"',
      '',
      '[[servers]]',
      'ip = "1"',
      'tags = ["a"]',
      '',
      '[[servers]]',
      'ip = "2"',
      '',
      '["weird key"]',
      'x = 1',
      '',
    ].join('\n'),
  );
  has(conv('[{"a":1}]', 'toml'), '[[root]]\na = 1');
  has(conv('{"big":12345678901234567890}', 'toml'), 'big = "12345678901234567890"  #');
});

test('highlightCode round-trips every target and never spans lines', () => {
  const src = API.replace('"Ada"', '"<b>Ada</b> & \\"co\\"\\nline2"');
  for (const t of TARGETS) {
    const out = conv(src, t.id);
    const html = highlightCode(out, t.lang);
    const text = html
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    assert.equal(text, out, t.id);
    for (const line of html.split('\n')) {
      assert.equal(line.split('<span').length, line.split('</span>').length, `${t.id}: ${line}`);
    }
    assert.ok(!/<(?!\/?span)/.test(html), `${t.id}: unescaped markup`);
    assert.ok(/class="t[ksnlzwtbpc]"/.test(html), t.id);
  }
  assert.equal(highlightCode('a <b>', 'unknown'), 'a &lt;b&gt;');
  assert.equal(highlightCode('key: "v"', 'yaml'), '<span class="tk">key</span><span class="tp">:</span> <span class="ts">&quot;v&quot;</span>');
  assert.equal(highlightCode('x: |\n  a: 1\ny: 2', 'yaml').split('\n')[1], '  <span class="ts">a: 1</span>');
});

test('large inputs are merged in one linear pass', () => {
  const items = [];
  for (let i = 0; i < 50000; i++) items.push({ id: i, name: 'n' + i, score: i % 3 ? i / 2 : null, tags: ['x'], ...(i % 2 ? { opt: true } : {}) });
  const root = doc(JSON.stringify(items));
  const t = Date.now();
  const out = convert(root, 'typescript', { rootName: 'Root' });
  assert.ok(Date.now() - t < 2000);
  assert.equal(out, 'export type Root = RootItem[];\n\nexport interface RootItem {\n  id: number;\n  name: string;\n  score: number | null;\n  tags: string[];\n  opt?: boolean;\n}\n');
});

// Type declarations per language (regression: unused named types were emitted).
const DECL: Record<string, RegExp> = {
  csharp: /^public class (\w+)/gm,
  java: /\b(?:record|class) (\w+)[ (]/g,
  kotlin: /^data class (\w+)\(/gm,
  swift: /^struct (\w+): Codable/gm,
  go: /^type (\w+) /gm,
  rust: /^pub (?:struct|type) (\w+)/gm,
  dart: /^class (\w+) \{/gm,
  php: /^final class (\w+)/gm,
};
const declared = (out: string, lang: string) => [...out.matchAll(DECL[lang])].map((m) => m[1]);

test('only types referenced from the root are emitted', () => {
  for (const lang of Object.keys(DECL)) {
    assert.deepEqual(declared(conv('{"features":["a","b"],"users":[{"tags":["math"]}]}', lang), lang), ['Root', 'User'], lang);
    // Mixed values become the language's "any": objects inside them get no type.
    const mixed = conv('{"users":[{"tags":["math"],"v":1},{"tags":[{"id":1}],"v":{"x":1},"addr":{"city":"c"}}]}', lang);
    assert.deepEqual(declared(mixed, lang), ['Root', 'User', 'Addr'], lang);
    assert.ok(!/\bTag\b/.test(mixed), lang);
  }
  // Languages with unions still reference (and declare) them.
  has(conv('{"tags":["math",{"id":1}]}', 'typescript'), 'tags: (string | Tag)[];', 'export interface Tag {');
  has(conv('{"tags":["math",{"id":1}]}', 'python'), 'tags: List[Union[str, Tag]]', 'class Tag(BaseModel):');
});

test('Java: the root is the only public top-level type', () => {
  const topLevelPublic = (s: string) => s.split('\n').filter((l) => l.startsWith('public ')).length;
  const out = conv(API, 'java');
  assert.equal(topLevelPublic(out), 1);
  assert.ok(out.trimEnd().endsWith('    public record DataItem(double k) {}\n}'));
  const arr = conv('[{"a":1,"b":{"c":"x"}}]', 'java');
  assert.equal(
    arr,
    'import java.util.List;\n\n// Root: List<RootItem>\npublic final class Root {\n    private Root() {}\n\n    public record RootItem(long a, B b) {}\n\n    public record B(String c) {}\n}\n',
  );
  assert.equal(conv('{"a":1}', 'java'), 'public record Root(long a) {}\n');
});

test('deep nesting does not throw', () => {
  const depth = 2000;
  const root = doc('['.repeat(depth) + '{"a":1}' + ']'.repeat(depth));
  for (const t of TARGETS) assert.equal(typeof convert(root, t.id, { rootName: 'Root' }), 'string');
});

// Record components cannot shadow Object methods, even when they are valid identifiers.
test('Java record components preserve keys that name Object methods', () => {
  const out = conv('{"toString":"Ada","hashCode":42,"getClass":"user","wait":true,"clone":null,"finalize":false,"notify":1,"notifyAll":2}', 'java');
  for (const name of ['toString', 'hashCode', 'getClass', 'wait', 'clone', 'finalize', 'notify', 'notifyAll']) {
    assert.ok(out.includes(`@JsonProperty("${name}")`), name);
    assert.match(out, new RegExp(`\\b${name}_[,)\\s]`), name);
  }
});
