/** Typed-language emitters: Go, Python, Rust, Java, C#, Kotlin, Swift, Dart, PHP. */
import type { JNode } from '../json/parser';
import { type ConvertOptions, type Obj, type Prim, type Shape, camel, infer, isNull, kind, lit, pascal, snake, typeOf, uniq } from './infer';

const props = (t: Obj) => [...t.props.values()];
// Languages without union types: mixed values are `any`, so objects inside them get no type.
const inferNU = (root: JNode, o: ConvertOptions, reserved: string, pc?: (s: string) => string) => infer(root, o, reserved, pc, false);
const set = (s: string) => new Set(s.split(' '));
const has = (body: string, re: string) => new RegExp(re).test(body);

/* ---------- Go ---------- */

const GO_INIT = set('ACL API ASCII CPU CSS DNS EOF GUID HTML HTTP HTTPS ID IP JSON QPS RAM RPC SLA SMTP SQL SSH TCP TLS TTL UDP UI UID UUID URI URL UTF8 VM XML XMPP XSRF XSS');
const goName = (s: string) => {
  const n = pascal(s, GO_INIT);
  // Exported identifiers must start with an upper-case letter.
  return n && n[0] === n[0].toLowerCase() ? 'X' + n : n;
};
// Characters encoding/json accepts in a tag name.
const GO_TAG = new RegExp('^[\\p{L}\\p{Nd}!#$%&()*+\\-./:;<=>?@[\\]^_{|}~ ]+$', 'u');

export function toGo(root: JNode, o: ConvertOptions): string {
  const m = inferNU(root, o, '', goName);
  const P: Prim = {
    bool: 'bool',
    int: 'int64',
    big: '*big.Int',
    float: 'float64',
    str: 'string',
    any: 'any',
    arr: (t) => '[]' + t,
    map: (t) => 'map[string]' + t,
    nul: (t) => (/^(?:\[|map\[|\*|any$)/.test(t) ? t : '*' + t),
  };
  const out: string[] = [];
  if (!m.obj) out.push(`type ${m.name} ${typeOf(m.root, P)}`);
  for (const t of m.types) {
    const u = uniq();
    let w0 = 0;
    let w1 = 0;
    const rows = props(t).map((p) => {
      const r = [
        u(goName(p.key) || 'Field'),
        // Optional structs become pointers so `omitempty` can drop them.
        typeOf(p.s, P, p.opt && kind(p.s) === 'obj'),
        GO_TAG.test(p.key) ? `\`json:"${p.key}${p.opt ? ',omitempty' : ''}"\`` : `\`json:"-"\` // key ${JSON.stringify(p.key)} can't be expressed in a tag`,
      ];
      w0 = Math.max(w0, r[0].length);
      w1 = Math.max(w1, r[1].length);
      return r;
    });
    out.push(`type ${t.name} struct {\n${rows.map((r) => `\t${r[0].padEnd(w0)} ${r[1].padEnd(w1)} ${r[2]}`).join('\n')}\n}`);
  }
  const body = out.join('\n\n');
  return `package main\n\n${body.includes('*big.Int') ? 'import "math/big"\n\n' : ''}${body}\n`;
}

/* ---------- Python (Pydantic v2) ---------- */

const PY_RES = set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield str int float bool list dict Any Dict List Optional Union Field BaseModel RootModel copy json schema construct validate model_config',
);
const PY_ID = new RegExp('^[\\p{L}_][\\p{L}\\p{Nd}_]*$', 'u');

export function toPython(root: JNode, o: ConvertOptions): string {
  const m = infer(root, o, 'BaseModel Field RootModel Any Dict List Optional Union None True False');
  const P: Prim = {
    bool: 'bool',
    int: 'int',
    big: 'int',
    float: 'float',
    str: 'str',
    any: 'Any',
    arr: (t) => `List[${t}]`,
    map: (t) => `Dict[str, ${t}]`,
    nul: (t) => (t === 'Any' ? t : `Optional[${t}]`),
    un: (ts) => `Union[${ts.join(', ')}]`,
  };
  const out: string[] = [];
  for (const t of m.deps) {
    const u = uniq();
    const lines = props(t).map((p) => {
      const ok = PY_ID.test(p.key) && !PY_RES.has(p.key) && p.key[0] !== '_';
      let f = ok ? p.key : snake(p.key) || 'field';
      if (!ok && PY_RES.has(f)) f += '_';
      f = u(f);
      const alias = f !== p.key ? `alias=${lit(p.key)}` : '';
      const def = p.opt ? (alias ? ` = Field(default=None, ${alias})` : ' = None') : alias ? ` = Field(${alias})` : '';
      return `    ${f}: ${typeOf(p.s, P, p.opt)}${def}`;
    });
    out.push(`class ${t.name}(BaseModel):\n${lines.join('\n')}`);
  }
  if (!m.obj) {
    const ty = typeOf(m.root, P);
    out.push(`class ${m.name}(RootModel[${ty}]):\n    root: ${ty}`);
  }
  const body = out.join('\n\n\n');
  const typing = ['Any', 'Dict', 'List', 'Optional', 'Union'].filter((n) => has(body, `\\b${n}\\b`));
  const pyd = ['BaseModel', 'Field', 'RootModel'].filter((n) => body.includes(n === 'Field' ? '= Field(' : `(${n}`));
  return (typing.length ? `from typing import ${typing.join(', ')}\n\n` : '') + `from pydantic import ${pyd.join(', ')}\n\n\n${body}\n`;
}

/* ---------- Rust (serde) ---------- */

const RS_KW = set(
  'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try gen',
);
// serde's `rename_all = "camelCase"` applied to a snake_case field.
const serdeCamel = (f: string) => f.replace(/_+(.?)/g, (_, c: string) => (c >= 'a' && c <= 'z' ? c.toUpperCase() : c));

export function toRust(root: JNode, o: ConvertOptions): string {
  const m = inferNU(root, o, 'String Vec Option Box Result Value HashMap Self Some None Ok Err Serialize Deserialize Debug Clone');
  const P: Prim = {
    bool: 'bool',
    int: 'i64',
    big: 'i128',
    float: 'f64',
    str: 'String',
    any: 'serde_json::Value',
    arr: (t) => `Vec<${t}>`,
    map: (t) => `HashMap<String, ${t}>`,
    nul: (t) => `Option<${t}>`,
  };
  const out: string[] = [];
  if (!m.obj) out.push(`pub type ${m.name} = ${typeOf(m.root, P)};`);
  for (const t of m.types) {
    const u = uniq();
    const fs = props(t).map((p) => {
      let f = snake(p.key) || 'field';
      if (RS_KW.has(f)) f = /^(?:self|Self|super|crate)$/.test(f) ? f + '_' : 'r#' + f;
      f = u(f);
      return { p, f, bare: f.replace(/^r#/, '') };
    });
    // Use rename_all when it saves attributes.
    const ca = fs.filter((x) => serdeCamel(x.bare) !== x.p.key).length + 1 < fs.filter((x) => x.bare !== x.p.key).length;
    const lines = fs.map(({ p, f, bare }) => {
      const at: string[] = [];
      if ((ca ? serdeCamel(bare) : bare) !== p.key) at.push(`rename = ${lit(p.key, '"', true)}`);
      if (p.opt) at.push('skip_serializing_if = "Option::is_none"');
      return (at.length ? `    #[serde(${at.join(', ')})]\n` : '') + `    pub ${f}: ${typeOf(p.s, P, p.opt)},`;
    });
    out.push(`#[derive(Debug, Clone, Serialize, Deserialize)]\n${ca ? '#[serde(rename_all = "camelCase")]\n' : ''}pub struct ${t.name} {\n${lines.join('\n')}\n}`);
  }
  const body = out.join('\n\n');
  return `use serde::{Deserialize, Serialize};\n${body.includes('HashMap<') ? 'use std::collections::HashMap;\n' : ''}\n${body}\n`;
}

/* ---------- Java (records + Jackson) ---------- */

const JAVA_KW = set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits _ clone finalize getClass hashCode notify notifyAll toString wait',
);
const BOX: Record<string, string> = { boolean: 'Boolean', long: 'Long', double: 'Double' };
const box = (t: string) => BOX[t] || t;

export function toJava(root: JNode, o: ConvertOptions): string {
  const m = inferNU(
    root,
    o,
    'String Object Long Double Boolean Integer List Map Record BigInteger JsonProperty Override Class Number Character Byte Short Float Void Math System Exception Error Thread Runtime Iterable Comparable Enum',
  );
  const P: Prim = {
    bool: 'boolean',
    int: 'long',
    big: 'BigInteger',
    float: 'double',
    str: 'String',
    any: 'Object',
    arr: (t) => `List<${box(t)}>`,
    map: (t) => `Map<String, ${box(t)}>`,
    nul: box,
  };
  // One public top-level type (the file is Root.java); the others are nested public records.
  const rec = (t: Obj, ind: string, body: string) => {
    const u = uniq();
    const cs = props(t).map((p) => {
      let f = camel(p.key) || 'field';
      if (JAVA_KW.has(f)) f += '_';
      f = u(f);
      return `${f !== p.key ? `@JsonProperty(${lit(p.key)}) ` : ''}${typeOf(p.s, P, p.opt)} ${f}`;
    });
    const head = `${ind}public record ${t.name}(`;
    const line = head + cs.join(', ') + ') {' + body;
    return line.length <= 100 && !body.includes('\n') ? line : `${head}\n${ind}    ${cs.join(`,\n${ind}    `)}\n${ind}) {${body}`;
  };
  const nested = m.types.filter((t) => t !== m.obj).map((t) => rec(t, '    ', '}'));
  const inner = nested.length ? `\n${nested.join('\n\n')}\n}` : '}';
  const body = m.obj
    ? rec(m.obj, '', inner)
    : `// ${m.name}: ${box(typeOf(m.root, P))}` + (nested.length ? `\npublic final class ${m.name} {\n    private ${m.name}() {}\n${inner}` : '');
  const imp = [
    body.includes('@JsonProperty(') && 'com.fasterxml.jackson.annotation.JsonProperty',
    has(body, '\\bBigInteger\\b') && 'java.math.BigInteger',
    has(body, '\\bList<') && 'java.util.List',
    has(body, '\\bMap<') && 'java.util.Map',
  ].filter(Boolean);
  return (imp.length ? imp.map((i) => `import ${i};`).join('\n') + '\n\n' : '') + body + '\n';
}

/* ---------- C# (System.Text.Json or Newtonsoft.Json) ---------- */

export function toCSharp(root: JNode, o: ConvertOptions): string {
  const nj = o.csharpLib === 'newtonsoft';
  const m = inferNU(
    root,
    o,
    'String Object List Dictionary JsonElement JToken JsonProperty JsonPropertyName Decimal Math Console Type Attribute Exception Task Guid DateTime Int32 Int64 Double Boolean',
  );
  const P: Prim = {
    bool: 'bool',
    int: 'long',
    big: 'decimal',
    float: 'double',
    str: 'string',
    any: nj ? 'JToken' : 'JsonElement',
    arr: (t) => `List<${t}>`,
    map: (t) => `Dictionary<string, ${t}>`,
    nul: (t) => t + '?',
    an: true,
  };
  const out: string[] = [];
  if (!m.obj) out.push(`// ${m.name}: ${typeOf(m.root, P)}`);
  for (const t of m.types) {
    const u = uniq();
    const ps = props(t).map((p) => {
      let f = pascal(p.key) || 'Field';
      if (f === t.name) f += 'Value'; // members can't share the class name
      return `    [${nj ? 'JsonProperty' : 'JsonPropertyName'}(${lit(p.key)})]\n    public ${p.opt ? '' : 'required '}${typeOf(p.s, P, p.opt)} ${u(f)} { get; set; }`;
    });
    out.push(`public class ${t.name}\n{\n${ps.join('\n\n')}\n}`);
  }
  const body = out.join('\n\n');
  const use = [
    has(body, '\\b(?:List|Dictionary)<') && 'System.Collections.Generic',
    ...(nj ? ['Newtonsoft.Json', has(body, '\\bJToken\\b') && 'Newtonsoft.Json.Linq'] : [has(body, '\\bJsonElement\\b') && 'System.Text.Json', 'System.Text.Json.Serialization']),
  ].filter(Boolean);
  return use.map((u) => `using ${u};`).join('\n') + '\n\n' + body + '\n';
}

/* ---------- Kotlin (kotlinx.serialization) ---------- */

const KT_KW = set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while');

export function toKotlin(root: JNode, o: ConvertOptions): string {
  const m = inferNU(root, o, 'String Int Long Double Boolean List Map Set Any Unit Nothing Array Pair Triple Serializable SerialName JsonElement Char Number Float Short Byte Result');
  const P: Prim = {
    bool: 'Boolean',
    int: 'Long',
    big: 'Double',
    float: 'Double',
    str: 'String',
    any: 'JsonElement',
    arr: (t) => `List<${t}>`,
    map: (t) => `Map<String, ${t}>`,
    nul: (t) => t + '?',
    an: true,
  };
  const out: string[] = [];
  if (!m.obj) out.push(`typealias ${m.name} = ${typeOf(m.root, P)}`);
  for (const t of m.types) {
    const u = uniq();
    const ps = props(t).map((p) => {
      const f = u(camel(p.key) || 'field');
      const ty = typeOf(p.s, P, p.opt);
      const sn = f !== p.key ? `@SerialName(${lit(p.key, '"', false, true)}) ` : '';
      return `    ${sn}val ${KT_KW.has(f) ? '`' + f + '`' : f}: ${ty}${ty.endsWith('?') ? ' = null' : ''},`;
    });
    out.push(`@Serializable\ndata class ${t.name}(\n${ps.join('\n')}\n)`);
  }
  const body = out.join('\n\n');
  const imp = [
    body.includes('@SerialName(') && 'kotlinx.serialization.SerialName',
    body.includes('@Serializable') && 'kotlinx.serialization.Serializable',
    has(body, '\\bJsonElement\\b') && 'kotlinx.serialization.json.JsonElement',
  ].filter(Boolean);
  return (imp.length ? imp.map((i) => `import ${i}`).join('\n') + '\n\n' : '') + body + '\n';
}

/* ---------- Swift (Codable) ---------- */

const SW_KW = set(
  'associatedtype class deinit enum extension fileprivate func import inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super throw throws true try Any',
);
const JSON_VALUE = `/// Any JSON value (used where the type is unknown or mixed).
enum JSONValue: Codable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}`;

export function toSwift(root: JNode, o: ConvertOptions): string {
  const m = inferNU(
    root,
    o,
    'String Int Double Bool Data Date URL Array Dictionary Set Optional Codable Decodable Encodable CodingKeys CodingKey Error Any AnyObject Type Self Character Float Decimal UUID Never Void Protocol JSONValue',
  );
  const P: Prim = {
    bool: 'Bool',
    int: 'Int',
    big: 'Decimal',
    float: 'Double',
    str: 'String',
    any: 'JSONValue',
    arr: (t) => `[${t}]`,
    map: (t) => `[String: ${t}]`,
    nul: (t) => t + '?',
    an: true,
  };
  const out: string[] = [];
  if (!m.obj) out.push(`typealias ${m.name} = ${typeOf(m.root, P)}`);
  for (const t of m.types) {
    const u = uniq();
    const fs = props(t).map((p) => {
      let f = camel(p.key) || 'field';
      if (/^(?:self|Self|Type|Protocol|init)$/.test(f)) f += '_';
      f = u(f);
      return { p, f, id: SW_KW.has(f) ? '`' + f + '`' : f };
    });
    const lines = fs.map((x) => `    let ${x.id}: ${typeOf(x.p.s, P, x.p.opt)}`);
    if (fs.some((x) => x.f !== x.p.key)) {
      const cases: string[] = [];
      let group: string[] = [];
      const flush = () => {
        if (group.length) cases.push(`        case ${group.join(', ')}`);
        group = [];
      };
      for (const x of fs) {
        if (x.f === x.p.key) {
          if (group.join(', ').length + x.id.length > 80) flush();
          group.push(x.id);
        } else {
          flush();
          cases.push(`        case ${x.id} = ${lit(x.p.key, '"', true)}`);
        }
      }
      flush();
      lines.push('', '    enum CodingKeys: String, CodingKey {', ...cases, '    }');
    }
    out.push(`struct ${t.name}: Codable {\n${lines.join('\n')}\n}`);
  }
  if (has(out.join('\n'), '\\bJSONValue\\b')) out.push(JSON_VALUE);
  return `import Foundation\n\n${out.join('\n\n')}\n`;
}

/* ---------- Dart (null-safe classes with fromJson / toJson) ---------- */

// Dart identifiers are ASCII-only.
const dartId = (s: string, pre: string) => s.replace(/[^\w$]/g, '').replace(/^(?=\d)/, pre);

const DART_KW = set(
  'assert break case catch class const continue default do else enum extends false final finally for if in is new null rethrow return super switch this throw true try var void while with hashCode runtimeType toString noSuchMethod toJson fromJson',
);

export function toDart(root: JNode, o: ConvertOptions): string {
  const m = inferNU(root, o, 'String List Map Set Object Function Type Iterable Future Stream DateTime Duration Uri Null Never Record Symbol MapEntry Comparable Pattern', (s) =>
    dartId(pascal(s), 'N'),
  );
  const P: Prim = {
    bool: 'bool',
    int: 'int',
    big: 'num',
    float: 'double',
    str: 'String',
    any: 'dynamic',
    arr: (t) => `List<${t}>`,
    map: (t) => `Map<String, ${t}>`,
    nul: (t) => (t === 'dynamic' ? t : t + '?'),
  };
  // Decodes the dynamic expression `x`.
  const dec = (s: Shape, x: string, force = false): string => {
    const q = force || isNull(s) ? '?' : '';
    switch (kind(s)) {
      case 'float':
        return `(${x} as num${q})${q}.toDouble()`;
      case 'obj': {
        const c = `${s.obj!.name}.fromJson(${x} as Map<String, dynamic>)`;
        return q ? `${x} == null ? null : ${c}` : c;
      }
      case 'arr': {
        const e = dec(s.arr!, 'e');
        return e === 'e' ? `${x} as List<dynamic>${q}` : `(${x} as List<dynamic>${q})${q}.map((e) => ${e}).toList()`;
      }
      case 'map': {
        const e = dec(s.obj!.map!, 'e');
        return e === 'e' ? `${x} as Map<String, dynamic>${q}` : `(${x} as Map<String, dynamic>${q})${q}.map((k, e) => MapEntry(k, ${e}))`;
      }
      case 'bool':
      case 'int':
      case 'big':
      case 'str':
        return `${x} as ${typeOf(s, P, force)}`;
    }
    return x;
  };
  const enc = (s: Shape, x: string, force = false): string => {
    const q = force || isNull(s) ? '?' : '';
    const k = kind(s);
    if (k === 'obj') return `${x}${q}.toJson()`;
    if (k === 'arr' || k === 'map') {
      const e = enc(k === 'arr' ? s.arr! : s.obj!.map!, 'e');
      if (e === 'e') return x;
      return k === 'arr' ? `${x}${q}.map((e) => ${e}).toList()` : `${x}${q}.map((k, e) => MapEntry(k, ${e}))`;
    }
    return x;
  };
  const out: string[] = [];
  if (!m.obj) out.push(`typedef ${m.name} = ${typeOf(m.root, P)};`);
  for (const t of m.types) {
    const u = uniq();
    const fs = props(t).map((p) => {
      let f = dartId(camel(p.key), 'n') || 'field';
      if (DART_KW.has(f)) f += '_';
      const ty = typeOf(p.s, P, p.opt);
      return { p, f: u(f), ty, k: lit(p.key, "'", false, true) };
    });
    const n = t.name;
    out.push(
      [
        `class ${n} {`,
        ...fs.map((x) => `  final ${x.ty} ${x.f};`),
        '',
        `  const ${n}({`,
        ...fs.map((x) => `    ${x.ty.endsWith('?') || x.ty === 'dynamic' ? '' : 'required '}this.${x.f},`),
        '  });',
        '',
        `  factory ${n}.fromJson(Map<String, dynamic> json) => ${n}(`,
        ...fs.map((x) => `    ${x.f}: ${dec(x.p.s, `json[${x.k}]`, x.p.opt)},`),
        '  );',
        '',
        '  Map<String, dynamic> toJson() => {',
        ...fs.map((x) => `    ${x.p.opt ? `if (${x.f} != null) ` : ''}${x.k}: ${enc(x.p.s, x.f, x.p.opt)},`),
        '  };',
        '}',
      ].join('\n'),
    );
  }
  return out.join('\n\n') + '\n';
}

/* ---------- PHP 8.1+ (readonly promoted properties + fromArray) ---------- */

const PHP_RES =
  'Array Bool Callable Class Default Enum False Float Fn Function Int Iterable List Match Mixed Never New Null Object Parent Print Readonly Self Static String True Void Abstract And As Break Case Catch Clone Const Continue Declare Die Do Echo Else Empty Eval Exit Extends Final Finally For Foreach Global Goto If Implements Include Instanceof Insteadof Interface Isset Namespace Or Private Protected Public Require Return Switch Throw Trait Try Unset Use Var While Xor Yield';

// Single quotes unless escapes are needed (then double quotes with `$` escaped).
const phpStr = (k: string) => (/[\x00-\x1f\x7f]/.test(k) ? lit(k, '"', true, true) : lit(k, "'"));

export function toPHP(root: JNode, o: ConvertOptions): string {
  const m = inferNU(root, o, PHP_RES);
  const P: Prim = {
    bool: 'bool',
    int: 'int',
    big: 'float',
    float: 'float',
    str: 'string',
    any: 'mixed',
    arr: () => 'array',
    map: () => 'array',
    nul: (t) => (t === 'mixed' ? t : '?' + t),
  };
  // Docblock type (arrays with element types).
  const doc = (s: Shape): string => {
    const k = kind(s);
    const t =
      k === 'arr'
        ? ((e) => (e.includes('|') ? `(${e})[]` : e + '[]'))(doc(s.arr!))
        : k === 'map'
          ? `array<string, ${doc(s.obj!.map!)}>`
          : k === 'obj'
            ? s.obj!.name
            : typeOf(s, P).replace('?', '');
    return isNull(s) && t !== 'mixed' ? t + '|null' : t;
  };
  const dec = (s: Shape, x: string, force = false): string => {
    const k = kind(s);
    const nul = force || isNull(s);
    let c = '';
    if (k === 'obj') c = `${s.obj!.name}::fromArray(${x})`;
    else if (k === 'arr' || k === 'map') {
      const e = dec(k === 'arr' ? s.arr! : s.obj!.map!, '$x');
      if (e !== '$x') c = `array_map(static fn ($x) => ${e}, ${x})`;
    }
    if (!c) return force ? `${x} ?? null` : x;
    return nul ? `isset(${x}) ? ${c} : null` : c;
  };
  const out: string[] = [];
  if (!m.obj) out.push(`// ${m.name}: ${doc(m.root)}`);
  for (const t of m.types) {
    const u = uniq();
    const fs = props(t).map((p) => {
      let f = camel(p.key) || 'field';
      if (f === 'this') f += '_';
      return { p, f: u(f) };
    });
    const params = fs.map(({ p, f }) => {
      const k = kind(p.s);
      const d = k === 'arr' || k === 'map' ? `        /** @var ${doc(p.s)}${p.opt && !isNull(p.s) ? '|null' : ''} */\n` : '';
      return `${d}        public readonly ${typeOf(p.s, P, p.opt)} $${f},`;
    });
    const args = fs.map(({ p, f }) => `            ${f}: ${dec(p.s, `$data[${phpStr(p.key)}]`, p.opt)},`);
    out.push(
      `final class ${t.name}\n{\n    public function __construct(\n${params.join('\n')}\n    ) {\n    }\n\n` +
        `    public static function fromArray(array $data): self\n    {\n        return new self(\n${args.join('\n')}\n        );\n    }\n}`,
    );
  }
  return `<?php\n\ndeclare(strict_types=1);\n\n${out.join('\n\n')}\n`;
}
