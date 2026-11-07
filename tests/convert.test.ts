import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { convert, highlightCode, type ConvertOptions } from '../lib/convert';
import { infer, singular } from '../lib/convert/infer';
import { records, toCsv } from '../lib/convert/xlsx';
import { TARGETS } from '../lib/engine/targets';

const doc = (src: string) => {
  const r = parse(src);
  assert.ok(r.root, r.error?.m);
  return r.root;
};
const conv = (src: string, target: string, opts: Partial<ConvertOptions> = {}) => convert(doc(src), target, { rootName: 'Root', ...opts });
/** What the Convert view shows for a target: CSV and Excel show the main records as CSV. */
const shown = (root: JNode, target: string) => (target === 'csv' || target === 'xlsx' ? toCsv(records(root)) : convert(root, target, { rootName: 'Root' }));
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
    ['typescript', 'zod', 'json-schema', 'csharp', 'dart', 'java', 'python', 'go', 'kotlin', 'swift', 'php', 'rust', 'protobuf', 'csv', 'xlsx', 'yaml', 'xml', 'toml', 'jsonl'],
  );
  assert.ok(TARGETS.every((t) => t.group === (['csv', 'xlsx', 'yaml', 'xml', 'toml', 'jsonl'].includes(t.id) ? 'Data' : 'Types')));
  // every target but CSV and Excel (xlsx.ts) has a converter
  for (const t of TARGETS) {
    if (t.id === 'csv' || t.id === 'xlsx') assert.throws(() => conv('1', t.id));
    else assert.equal(typeof conv('1', t.id), 'string', t.id);
  }
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
  // A date or date-time on a day that doesn't exist is no date (Zod's .date() and .datetime() reject it too).
  const days = JSON.parse(conv('{"a":"2024-02-29","b":"2023-02-29","c":"2024-04-31","d":"2023-02-28T10:00:00Z","e":"1900-02-29T10:00:00Z","f":"2000-02-29T10:00:00Z"}', 'json-schema')).properties;
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => days[k].format), ['date', undefined, undefined, 'date-time', undefined, 'date-time']);
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

// The outputs below were compiled with protoc and read the documents back with protobuf's JSON parser (json_format).
test('Protocol Buffers (proto3)', () => {
  const nested = '{"user-id":42,"profile":{"city":"London","created_at":"2026-10-14T09:00:00Z"},"items":[{"price":12,"note":null},{"price":12.5,"note":"gift"}]}';
  assert.equal(
    conv(nested, 'protobuf'),
    'syntax = "proto3";\n\npackage root;\n\nimport "google/protobuf/timestamp.proto";\n\n' +
      'message Root {\n  int64 user_id = 1 [json_name = "user-id"];\n  Profile profile = 2;\n  repeated Item items = 3;\n}\n\n' +
      'message Profile {\n  string city = 1;\n  google.protobuf.Timestamp created_at = 2 [json_name = "created_at"];\n}\n\n' +
      'message Item {\n  double price = 1;\n  optional string note = 2;\n}\n',
  );
  const out = conv(API, 'protobuf');
  has(
    out,
    'syntax = "proto3";\n\npackage root;\n\nimport "google/protobuf/struct.proto";\nimport "google/protobuf/timestamp.proto";\n\nmessage Root {\n',
    '  double id = 1; // integers beyond int64: double rounds them\n  int64 page = 2;\n',
    '  string first_name = 3 [json_name = "first-name"];\n  bool the_1abc = 4 [json_name = "1abc"];\n  string class = 5;\n  string type = 6;\n',
    '  google.protobuf.Timestamp created_at = 7;\n',
    '  repeated google.protobuf.Value empty = 10;\n  map<string, google.protobuf.Value> meta = 11;\n  repeated User users = 12;\n  Address billing = 13;\n',
    '  string field = 16 [json_name = "名前"];\n',
    'message User {\n  int64 id = 1;\n  string name = 2;\n  Address address = 3;\n  optional string nick = 4;\n  repeated string roles = 5;\n}',
  );
  // Every field line: a type, an ASCII snake_case name, a number.
  for (const l of out.split('\n').filter((l) => l.startsWith('  '))) assert.match(l, /^ {2}(?:optional |repeated )?(?:map<string, [\w.]+>|[\w.]+) [a-z][a-z\d_]* = \d+(?: \[json_name = "[^"]*"\])?;(?: \/\/ .*)?$/, l);

  // Nulls: a scalar field is optional; list items and map values that can be null are Values; null alone is a Value.
  assert.equal(conv('{"a":[1,null],"m":{"1":null,"2":3},"n":null,"t":[{"x":"2024-01-02T03:04:05Z"},{"x":null}]}', 'protobuf').split('message Root {\n')[1].split('\n}')[0],
    '  repeated google.protobuf.Value a = 1;\n  map<string, google.protobuf.Value> m = 2;\n  google.protobuf.Value n = 3;\n  repeated TItem t = 4;');
  has(conv('{"t":[{"x":"2024-01-02T03:04:05Z"},{"x":null}]}', 'protobuf'), 'message TItem {\n  google.protobuf.Timestamp x = 1;\n}');
  // Lists of lists and of dictionaries, maps of lists and of maps.
  has(conv('{"a":[[1],[2]],"b":[{"1":"x"}],"c":{"1":[1]},"d":{"1":{"2":3}}}', 'protobuf'),
    '  repeated google.protobuf.ListValue a = 1;\n  repeated google.protobuf.Struct b = 2;\n  map<string, google.protobuf.ListValue> c = 3;\n  map<string, google.protobuf.Struct> d = 4;');
  // optionalAll: scalars track presence; lists, maps and messages can't be (and needn't be) optional.
  has(conv('{"a":1,"c":{"d":true},"e":[1]}', 'protobuf', { optionalAll: true }), '  optional int64 a = 1;\n  C c = 2;\n  repeated int64 e = 3;', '  optional bool d = 1;');
  // Timestamp only for date-times protobuf reads: years 0001-9999, real days, at most 9 fractional digits.
  assert.equal(
    conv('{"a":"2024-02-29T00:00:00.123456789Z","b":"0000-01-01T00:00:00Z","c":"2023-02-29T00:00:00Z","d":"2024-04-31T00:00:00Z","e":"2024-01-01T00:00:00.1234567891Z"}', 'protobuf').split('message Root {\n')[1].split('\n}')[0],
    '  google.protobuf.Timestamp a = 1;\n  string b = 2;\n  string c = 3;\n  string d = 4;\n  string e = 5;',
  );
  // The range is in UTC: an offset can carry the first or last day out of it.
  assert.equal(
    conv('{"a":"0001-01-01T00:59:59+01:00","b":"0001-01-01T01:00:00+01:00","c":"9999-12-31T23:30:00-01:00","d":"9999-12-31T22:59:59-01:00","e":"0001-01-01T00:00:00-05:00"}', 'protobuf').split('message Root {\n')[1].split('\n}')[0],
    '  string a = 1;\n  google.protobuf.Timestamp b = 2;\n  string c = 3;\n  google.protobuf.Timestamp d = 4;\n  google.protobuf.Timestamp e = 5;',
  );
  // The package is the root's name in snake_case.
  has(conv('{"a":1}', 'protobuf', { rootName: 'User Profile' }), 'syntax = "proto3";\n\npackage user_profile;\n\nmessage UserProfile {');
  has(conv('{"a":1}', 'protobuf', { rootName: '日本' }), '\npackage root;\n');
  // A package the Java and C++ generators would write as a keyword gets a '_'.
  has(conv('{"a":1}', 'protobuf', { rootName: 'int' }), '\npackage int_;\n\nmessage Int {');
});

test('Protocol Buffers: JSON names', () => {
  const root = (src: string) => conv(src, 'protobuf').split('message Root {\n')[1].split('\n}')[0];
  // camelCase keys are the JSON names protoc derives from snake_case fields.
  assert.equal(root('{"firstName":"a","userId":1,"x":2}'), '  string first_name = 1;\n  int64 user_id = 2;\n  int64 x = 3;');
  // snake_case keys alone: the field names, printed as they are with proto field names (said once, at the top).
  const snake = conv('{"first_name":"a","name":"b"}', 'protobuf');
  has(snake, 'syntax = "proto3";\n\npackage root;\n\n// Keys are snake_case field names: print JSON with proto field names (e.g. protojson UseProtoNames) to keep them.\n\nmessage Root {\n  string first_name = 1;\n  string name = 2;\n}');
  // Mixed with other keys: json_name keeps them under the default printer.
  assert.equal(root('{"first_name":"a","lastName":"b"}'), '  string first_name = 1 [json_name = "first_name"];\n  string last_name = 2;');
  assert.ok(!conv('{"first_name":"a","lastName":"b"}', 'protobuf').includes('UseProtoNames'));
  // ...and so when a snake_case key can't keep its name as the field's (proto names would print "a_b_2").
  assert.equal(conv('{"ab":1,"a_b":2}', 'protobuf'), 'syntax = "proto3";\n\npackage root;\n\nmessage Root {\n  int64 ab = 1;\n  int64 a_b_2 = 2 [json_name = "a_b"];\n}\n');
  // Keys that are field names keep them; the others are named after them, with a json_name.
  assert.equal(root('{"userId":1,"user_id":2}'), '  int64 user_id_2 = 1 [json_name = "userId"];\n  int64 user_id = 2 [json_name = "user_id"];');
  assert.equal(root('{"":1,"field":2}'), '  int64 field_2 = 1 [json_name = ""];\n  int64 field = 2;');
  // Field names differ ignoring case and underscores (protoc, protobuf-go); JSON names only need to differ.
  assert.equal(root('{"id":1,"ID":2,"Id":3}'), '  int64 id = 1;\n  int64 id_2 = 2 [json_name = "ID"];\n  int64 id_3 = 3 [json_name = "Id"];');
  assert.equal(
    root('{"fooBar":1,"foo_bar":2,"foobar":3}'),
    '  int64 foo_bar_3 = 1 [json_name = "fooBar"];\n  int64 foo_bar = 2 [json_name = "foo_bar"];\n  int64 foobar_2 = 3 [json_name = "foobar"];',
  );
  // Keys protobuf takes no JSON name for ("[…]" is extension syntax; NUL; a lone surrogate isn't UTF-8) say so, after any other note.
  assert.equal(
    root('{"[0]":1,"k\\u0000":2,"x\\ud800":3,"[big]":12345678901234567890}'),
    '  int64 the_0 = 1; // protobuf can\'t take JSON key "[0]" as this field\'s JSON name\n' +
      '  int64 k = 2; // protobuf can\'t take JSON key "k\\u0000" as this field\'s JSON name\n' +
      '  int64 x = 3; // protobuf can\'t take JSON key "x\\ud800" as this field\'s JSON name\n' +
      '  double big = 4; // integers beyond int64: double rounds them; protobuf can\'t take JSON key "[big]" as this field\'s JSON name',
  );
  // ...and they don't take the field (and derived JSON name) a usable key would get, whatever the order.
  assert.equal(root('{"[fooBar]":"s","fooBar":2}'), '  string foo_bar_2 = 1; // protobuf can\'t take JSON key "[fooBar]" as this field\'s JSON name\n  int64 foo_bar = 2;');
  // Many keys that differ in case only, or share a name (other scripts all derive to "field"): linear.
  for (const keys of [
    Array.from({ length: 20000 }, (_, i) => (i % 2 ? `K${i}X` : `k${i}x`)),
    Array.from({ length: 20000 }, (_, i) => String.fromCharCode(0x4e00 + i)),
    Array.from({ length: 4096 }, (_, i) => [...'aaaaaaaaaaaa'].map((c, b) => (i >> b) & 1 ? 'A' : c).join('')),
  ]) {
    const t0 = Date.now();
    const out = conv(JSON.stringify(Object.fromEntries(keys.map((k) => [k, 1]))), 'protobuf');
    assert.ok(Date.now() - t0 < 3000, `${keys[1]}: ${Date.now() - t0} ms`);
    assert.equal(new Set([...out.matchAll(/^ {2}int64 (\w+) = /gm)].map((m) => m[1])).size, keys.length);
  }
  has(conv(JSON.stringify(Object.fromEntries(['日', '本', '語'].map((k) => [k, 1]))), 'protobuf'), '  int64 field = 1 [json_name = "日"];\n  int64 field_2 = 2 [json_name = "本"];\n  int64 field_3 = 3 [json_name = "語"];');
  // Names are ASCII identifiers: accents dropped, other scripts and punctuation give way, keys escaped in json_name.
  assert.equal(
    root('{"naïve":1,"日本":2,"10":3,"a\\"b\\nc":4,"$ref":5}'),
    '  int64 naive = 1 [json_name = "naïve"];\n  int64 field = 2 [json_name = "日本"];\n  int64 the_10 = 3 [json_name = "10"];\n  int64 a_b_c = 4 [json_name = "a\\"b\\nc"];\n  int64 ref = 5 [json_name = "$ref"];',
  );
  has(conv('{"日本":{"a":1},"2x":{"b":1}}', 'protobuf'), '  Type field = 1 [json_name = "日本"];\n  The2x the_2x = 2 [json_name = "2x"];', 'message Type {', 'message The2x {');
});

test('Protocol Buffers: a root that is not an object, field numbers', () => {
  assert.equal(conv('[1,2]', 'protobuf'), 'syntax = "proto3";\n\npackage root;\n\n// The JSON is an array: this message holds it as {"items": [...]}.\nmessage Root {\n  repeated int64 items = 1;\n}\n');
  assert.equal(conv('"x"', 'protobuf'), 'syntax = "proto3";\n\npackage root;\n\n// The JSON is a single value: this message holds it as {"value": ...}.\nmessage Root {\n  string value = 1;\n}\n');
  has(conv('null', 'protobuf'), 'import "google/protobuf/struct.proto";', '  google.protobuf.Value value = 1;');
  has(conv('[[1],[2]]', 'protobuf'), '  repeated google.protobuf.ListValue items = 1;');
  has(conv('[{"id":1,"email":"a"},{"id":2}]', 'protobuf', { rootName: 'users' }), 'message Users {\n  repeated User items = 1;\n}\n\nmessage User {\n  int64 id = 1;\n  optional string email = 2;\n}');
  assert.equal(
    conv('{"2024-01-01":{"n":1}}', 'protobuf'),
    'syntax = "proto3";\n\npackage root;\n\n// The JSON object has data for keys: this message holds it as {"entries": {...}}.\nmessage Root {\n  map<string, RootItem> entries = 1;\n}\n\nmessage RootItem {\n  int64 n = 1;\n}\n',
  );
  has(conv('{}', 'protobuf'), '  map<string, google.protobuf.Value> entries = 1;');
  // 19000-19999 are reserved: the 19000th field is 20000.
  const many = conv(JSON.stringify(Object.fromEntries(Array.from({ length: 19001 }, (_, i) => [`f${i + 1}`, 1]))), 'protobuf');
  has(many, '  int64 f18999 = 18999;\n  int64 f19000 = 20000;\n  int64 f19001 = 20001;\n}');
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
    const out = shown(doc(src), t.id);
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
  protobuf: /^message (\w+) \{/gm,
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
  for (const t of TARGETS) assert.equal(typeof shown(root, t.id), 'string');
});

// Record components cannot shadow Object methods, even when they are valid identifiers.
test('Java record components preserve keys that name Object methods', () => {
  const out = conv('{"toString":"Ada","hashCode":42,"getClass":"user","wait":true,"clone":null,"finalize":false,"notify":1,"notifyAll":2}', 'java');
  for (const name of ['toString', 'hashCode', 'getClass', 'wait', 'clone', 'finalize', 'notify', 'notifyAll']) {
    assert.ok(out.includes(`@JsonProperty("${name}")`), name);
    assert.match(out, new RegExp(`\\b${name}_[,)\\s]`), name);
  }
});

test('Zod: a "__proto__" key is a field, not the prototype of the shape', () => {
  const out = conv('{"__proto__":1,"constructor":"c","a":true}', 'zod');
  has(out, '  ["__proto__"]: z.number().int(),', '  constructor: z.string(),');
  // what the object literal makes, with a stand-in for z
  const chain: unknown = new Proxy(function () {}, { get: () => chain, apply: () => chain });
  const body = /z\.object\((\{[\s\S]*?\n\})\)/.exec(out)![1];
  const shape = new Function('z', `return ${body};`)(chain) as object;
  assert.deepEqual(Object.keys(shape), ['__proto__', 'constructor', 'a']);
  assert.equal(Object.getPrototypeOf(shape), Object.prototype);
});

test('Rust: no rename_all over a field serde cannot camelCase', () => {
  // serde_derive panics camelCasing a field that starts with a non-ASCII letter
  const out = conv('{"日本":1,"firstName":"a","lastName":"b","userId":2}', 'rust');
  assert.ok(!out.includes('rename_all'), out);
  has(out, '    pub 日本: i64,', '    #[serde(rename = "firstName")]\n    pub first_name: String,');
});

test('C#: properties never hide the members of object', () => {
  const out = conv('{"toString":"x","equals":1,"getHashCode":2,"getType":"t","memberwiseClone":3,"referenceEquals":4,"finalize":5,"name":"n"}', 'csharp');
  for (const name of ['ToString', 'Equals', 'GetHashCode', 'GetType', 'MemberwiseClone', 'ReferenceEquals', 'Finalize']) {
    const key = name[0].toLowerCase() + name.slice(1);
    has(out, `    [JsonPropertyName("${key}")]\n    public required `, ` ${name}Value { get; set; }`);
  }
  has(out, ' Name { get; set; }');
});

test("Python: fields never shadow BaseModel's members", () => {
  const out = conv('{"model_dump":1,"model_validate":"v","model_fields":[1],"model_config":true,"model_name":"m","parse_obj":2,"copy":3,"name":"n"}', 'python');
  has(
    out,
    'from pydantic import BaseModel, ConfigDict, Field\n',
    'class Root(BaseModel):\n    model_config = ConfigDict(protected_namespaces=())\n\n    model_dump_: int = Field(alias="model_dump")\n',
    '    model_validate_: str = Field(alias="model_validate")',
    '    model_fields_: List[int] = Field(alias="model_fields")',
    '    model_config_: bool = Field(alias="model_config")',
    '    model_name: str\n',
    '    parse_obj_: int = Field(alias="parse_obj")',
    '    copy_: int = Field(alias="copy")',
    '    name: str\n',
  );
  // no protected names: no config
  const plain = conv('{"name":"n","copy":1}', 'python');
  assert.ok(!plain.includes('ConfigDict'), plain);
  has(plain, 'from pydantic import BaseModel, Field\n');
});
