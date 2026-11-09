// Regressions from the audit of the code and data emitters: output that the target's own compiler or parser rejects
// or reads back differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { convert, type ConvertOptions } from '../lib/convert';

const doc = (src: string) => {
  const r = parse(src);
  assert.ok(r.root, r.error?.m);
  return r.root;
};
const conv = (src: string, target: string, opts: Partial<ConvertOptions> = {}) => convert(doc(src), target, { rootName: 'Root', ...opts });
const has = (out: string, ...parts: string[]) => {
  for (const p of parts) assert.ok(out.includes(p), `expected to find:\n${p}\n--- in ---\n${out}`);
};

test('PHP: class names never take a built-in class or a keyword, whatever their case', () => {
  const classes = (src: string, o: Partial<ConvertOptions> = {}) => [...conv(src, 'php', o).matchAll(/^final class (\w+)/gm)].map((m) => m[1]);
  // "Cannot declare class Error, because the name is already in use"
  assert.deepEqual(classes('{"error":{"code":1,"message":"x"}}'), ['Root', 'ErrorClass']);
  const builtin = ['exception', 'directory', 'closure', 'generator', 'iterator', 'attribute', 'dateTime', 'arrayObject', 'stdClass', 'pdo', 'traversable', 'jsonSerializable'];
  assert.deepEqual(
    // (one shape each: alike ones are one type)
    classes(JSON.stringify(Object.fromEntries(builtin.map((k) => [k, { [k + 1]: 1 }])))),
    ['Root', 'ExceptionClass', 'DirectoryClass', 'ClosureClass', 'GeneratorClass', 'IteratorClass', 'AttributeClass', 'DateTimeClass', 'ArrayObjectClass', 'StdClassClass', 'PdoClass', 'TraversableClass', 'JsonSerializableClass'],
  );
  // keywords in another case: `class ReadOnly` and `class ForEach` are parse errors
  assert.deepEqual(classes('{"readOnly":{"a":1},"forEach":{"b":1},"endWhile":{"c":1}}'), ['Root', 'ReadOnlyClass', 'ForEachClass', 'EndWhileClass']);
  // class names differing only in case are one name
  assert.deepEqual(classes('{"userId":{"a":1},"userID":{"b":"x"}}'), ['Root', 'UserId', 'UserID2']);
  assert.deepEqual(classes('{"a":1}', { rootName: 'exception' }), ['ExceptionClass']);
  // (other languages still compare names exactly)
  has(conv('{"userId":{"a":1},"userID":{"b":"x"}}', 'csharp'), 'public class UserId\n', 'public class UserID\n');
});

test('Python: a field with a default never hides a type its class uses', () => {
  // `Address: Optional[Address] = None`: Python 3.14 reads the annotation after the class body, which bound Address to None.
  const out = conv('{"items":[{"Address":{"city":"x"}},{}]}', 'python');
  has(out, 'from pydantic import BaseModel, Field\n', 'class Item(BaseModel):\n    address: Optional[Address] = Field(default=None, alias="Address")\n');
  // the field keeps a name of its own when the snake_case one is the type's too
  has(conv('{"名前":{"a":1},"x":[{"名前":{"a":2}},{}]}', 'python'), '    名前_: Optional[名前] = Field(default=None, alias="名前")\n');
  // a required field without an alias binds nothing: it keeps the key's name
  has(conv('{"Address":{"city":"x"}}', 'python'), '    Address: Address\n');
  // a field named like a type another field uses
  const two = conv('{"items":[{"Other":{"a":1},"other":{"b":"x"}},{"Other":{"a":2}}]}', 'python');
  has(two, '    Other: Other\n', '    other: Optional[Other2] = None\n');
});

test('Python: identifiers are compared as Python reads them (NFKC)', () => {
  // `ﬁle` is the identifier `file`, and `ｎａｍｅ` is `name`: each gets an alias, and the two `name`s two fields.
  has(conv('{"ﬁle":1,"ｎａｍｅ":"x","name":"y"}', 'python'), '    file: int = Field(alias="ﬁle")\n    name: str = Field(alias="ｎａｍｅ")\n    name2: str = Field(alias="name")\n');
  // `＿x` is `_x`: private to Pydantic
  has(conv('{"＿x":1}', 'python'), '    x: int = Field(alias="＿x")\n');
  // class names too
  const cls = [...conv('{"Ｎａｍｅ":{"a":1},"name":{"b":2}}', 'python').matchAll(/^class (\S+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(cls, ['Name', 'Name2', 'Root']);
});

test('Go: the key "-" is a field, not a skipped one', () => {
  // encoding/json skips a field tagged `json:"-"`: the key "-" is `json:"-,"`
  has(conv('{"-":1,"a":2}', 'go'), 'Field int64 `json:"-,"`');
  has(conv('[{"-":1},{}]', 'go'), '`json:"-,omitempty"`');
});

test('Dart: fields never hide the types the class names', () => {
  const out = conv('{"num":1,"int":2,"double":1.5,"bool":true,"dynamic":"x","n":{"num":2.5}}', 'dart');
  has(
    out,
    '  final int num_;\n  final int int_;\n  final double double_;\n  final bool bool_;\n  final String dynamic_;\n',
    "    num_: json['num'] as int,",
    "    double_: (json['double'] as num).toDouble(),",
    "    'dynamic': dynamic_,",
    "  factory N.fromJson(Map<String, dynamic> json) => N(\n    num_: (json['num'] as num).toDouble(),",
  );
  assert.ok(!/final \S+ (?:num|int|double|bool|dynamic);|this\.(?:num|int|double|bool|dynamic),/.test(out), out);
});

test('C#: a member made unique never takes its class name', () => {
  // CS0542: renumbering "a_" (A) past "a" gave A2 inside class A2
  const out = conv('{"a":{"x":1},"b":{"a":{"a":1,"a_":2}}}', 'csharp');
  has(out, 'public class A2\n{\n    [JsonPropertyName("a")]\n    public required long A { get; set; }\n\n    [JsonPropertyName("a_")]\n    public required long A3 { get; set; }\n}');
});

test('Swift: type names never take the names the JSONValue helper uses', () => {
  const out = conv('{"decoder":{"a":1},"encoder":{"b":1},"u":[1,"x"]}', 'swift');
  has(out, 'struct DecoderClass: Codable {', 'struct EncoderClass: Codable {', 'let decoder: DecoderClass', 'init(from decoder: Decoder) throws');
  assert.ok(!/struct (?:Decoder|Encoder):/.test(out), out);
});
