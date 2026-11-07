/**
 * Protocol Buffers (proto3) messages from a JSON example, typed so that protobuf's JSON mapping
 * (protojson, JsonFormat, json_format…) reads the example back: nulls and mixed values become
 * google.protobuf.Value, nested arrays ListValue, dictionaries map<string, …>, date-times Timestamp.
 */
import type { JNode } from '../json/parser';
import { type ConvertOptions, type Obj, type Shape, infer, isNull, kind, lit, pascal, snake } from './infer';

const VALUE = 'google.protobuf.Value';
const LIST = 'google.protobuf.ListValue';
const STRUCT = 'google.protobuf.Struct';
const TIME = 'google.protobuf.Timestamp';
// Integers beyond int64 (Shape.big 2) have no exact protobuf type: double reads them, rounded.
const SCALAR: Record<string, string> = { bool: 'bool', int: 'int64', big: 'double', float: 'double', str: 'string' };

const ascii = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** A message name: PascalCase ASCII (proto identifiers are letters, digits and underscores, from a letter). */
function typeName(key: string): string {
  const n = pascal(ascii(key)).replace(/[^A-Za-z0-9]/g, '');
  return !n || /^[A-Za-z]/.test(n) ? n : 'X' + n;
}

/** lower_snake_case ASCII, from a letter ('' if nothing is left). */
function ident(key: string): string {
  const s = snake(ascii(key))
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return /^[0-9]/.test(s) ? 'the_' + s : s;
}
const fieldName = (key: string) => ident(key) || 'field';

/** The JSON name protoc gives a field (each '_' dropped, the character after it upper-cased). */
const jsonName = (f: string) => f.replace(/_+(.?)/g, (_, c: string) => c.toUpperCase());

/** Keys protobuf takes no json_name for: "[…]" (extension syntax), a NUL, a lone surrogate (not UTF-8). */
const UNNAMED = /^\[[\s\S]*\]$|\0|[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;

/** Packages the Java and C++ generators would write as a keyword (package int; namespace int): they get a '_'. */
const RESERVED = new Set(
  'abstract and asm assert auto bool boolean break byte case catch char class const continue default delete do double else enum explicit export extends extern false final finally float for friend goto if implements import inline instanceof int interface long mutable namespace native new not null operator or package private protected public register return short signed sizeof static strictfp struct super switch synchronized template this throw throws transient true try typedef typeid typename union unsigned using virtual void volatile while xor'.split(' '),
);

/** Field numbers 19000-19999 are reserved for the protobuf implementation. */
const fieldNumber = (i: number) => (i < 19000 ? i : i + 1000);

export function toProto(root: JNode, o: ConvertOptions): string {
  // Mixed values are google.protobuf.Value: objects inside them get no message.
  const m = infer(root, o, '', typeName, false);
  const imports = new Set<string>();
  const seen = new Set<Obj>();
  const ref = (t: Obj) => (seen.add(t), t.name);
  const wkt = (t: string) => (imports.add(t === TIME ? 'google/protobuf/timestamp.proto' : 'google/protobuf/struct.proto'), t);

  // One type for a value, nulls aside: neither repeated nor a map (lists and maps nest as ListValue and Struct).
  const single = (s: Shape): string => {
    const k = kind(s);
    if (k === 'unknown' || k === 'null' || k === 'union') return wkt(VALUE);
    if (k === 'arr') return wkt(LIST);
    if (k === 'map') return wkt(STRUCT);
    if (k === 'obj') return ref(s.obj!);
    return k === 'str' && s.fmt === 'date-time' ? wkt(TIME) : SCALAR[k];
  };
  // A list item or a map value: protobuf JSON rejects a null one unless it is a Value.
  const item = (s: Shape) => (isNull(s) ? wkt(VALUE) : single(s));
  const type = (s: Shape, opt: boolean): string => {
    const k = kind(s);
    if (k === 'arr') return 'repeated ' + item(s.arr!);
    if (k === 'map') return `map<string, ${item(s.obj!.map!)}>`;
    const t = single(s);
    // Scalars track presence only when `optional`; messages (Timestamp, Value too) always do, and read null as unset.
    return (opt || isNull(s)) && SCALAR[k] === t ? 'optional ' + t : t;
  };
  const rounded = (s: Shape): boolean => {
    const k = kind(s);
    return k === 'big' || (k === 'arr' ? rounded(s.arr!) : k === 'map' && rounded(s.obj!.map!));
  };
  const line = (s: Shape, opt: boolean, name: string, n: number, opts = '', notes: string[] = []) => {
    if (rounded(s)) notes = ['integers beyond int64: double rounds them', ...notes];
    return `  ${type(s, opt)} ${name} = ${fieldNumber(n)}${opts};${notes.length ? ' // ' + notes.join('; ') : ''}`;
  };

  const props = (t: Obj) => [...t.props.values()];
  // Each message's field names. Keys that are field names already keep them; the others are named after
  // them, those protobuf takes no JSON name for last (they mustn't take the name a usable key derives to).
  // Proto3 field names must differ ignoring case and underscores (protoc, protobuf-go).
  const named = new Map<Obj, string[]>();
  for (const t of m.types) {
    const ps = props(t);
    const fs: string[] = [];
    const names = new Set<string>();
    const loose = new Set<string>();
    // The next number to try per name without underscores: names tried before stay taken.
    const next = new Map<string, number>();
    const rank = (i: number) => (ps[i].key === fieldName(ps[i].key) ? 2 : UNNAMED.test(ps[i].key) ? 0 : 1);
    for (const i of ps.map((_, i) => i).sort((a, b) => rank(b) - rank(a) || a - b)) {
      const base = fieldName(ps[i].key);
      const bare = base.replace(/_/g, '');
      let f = base;
      let n = next.get(bare) ?? 2;
      while (names.has(f) || loose.has(f.replace(/_/g, ''))) f = `${base}_${n++}`;
      next.set(bare, n);
      names.add(f);
      loose.add(f.replace(/_/g, ''));
      fs[i] = f;
    }
    named.set(t, fs);
  }
  // When every key is its field's name and some have underscores (snake_case), printers keep them when told to
  // use proto names, so no field needs a json_name. Otherwise those keys get one, for the default printer.
  const all = m.types.flatMap((t) => props(t).map((p, i) => [p.key, named.get(t)![i]]));
  const protoNames = all.some(([k]) => k.includes('_')) && all.every(([k, f]) => k === f);

  const message = (t: Obj): string => {
    const ps = props(t);
    const fs = named.get(t)!;
    const names = new Set(fs);
    // json_name where the key isn't the JSON name protoc derives. Parsers read a field by its name and its JSON
    // name, so none of these may stand for two fields (protoc, upb); fields without json_name come first.
    const want = ps.map((p, i) => p.key !== jsonName(fs[i]) && !protoNames);
    const taken = new Set(fs.flatMap((f, i) => (want[i] ? [] : [jsonName(f)])));
    const rows = ps.map((p, i) => {
      let opts = '';
      const notes: string[] = [];
      if (want[i]) {
        if (UNNAMED.test(p.key) || taken.has(p.key) || (names.has(p.key) && p.key !== fs[i])) {
          notes.push(`protobuf can't take JSON key ${JSON.stringify(p.key)} as this field's JSON name`);
          taken.add(jsonName(fs[i]));
        } else {
          opts = ` [json_name = ${lit(p.key)}]`;
          taken.add(p.key);
        }
      }
      return line(p.s, p.opt, fs[i], i + 1, opts, notes);
    });
    return `message ${t.name} {\n${rows.join('\n')}\n}`;
  };

  let top = '';
  if (m.obj) ref(m.obj);
  else {
    // A message is a JSON object: any other root is held in one field.
    const k = kind(m.root);
    const [why, name] =
      k === 'arr'
        ? ['The JSON is an array: this message holds it as {"items": [...]}.', 'items']
        : k === 'map'
          ? ['The JSON object has data for keys: this message holds it as {"entries": {...}}.', 'entries']
          : ['The JSON is a single value: this message holds it as {"value": ...}.', 'value'];
    top = `// ${why}\nmessage ${m.name} {\n${line(m.root, false, name, 1)}\n}`;
  }
  // Messages appear in the inferred order (parents first); `message` finds the ones its fields refer to.
  // (A Set's iteration goes on to the ones added meanwhile.)
  const done = new Map<Obj, string>();
  for (const t of seen) done.set(t, message(t));
  const body = [top, ...m.types.filter((t) => done.has(t)).map((t) => done.get(t)!)].filter(Boolean).join('\n\n');
  const pkg = ident(o.rootName) || 'root';
  const head = ['syntax = "proto3";', '', `package ${RESERVED.has(pkg) ? pkg + '_' : pkg};`];
  if (imports.size) head.push('', ...[...imports].sort().map((i) => `import "${i}";`));
  if (protoNames) head.push('', '// Keys are snake_case field names: print JSON with proto field names (e.g. protojson UseProtoNames) to keep them.');
  return `${head.join('\n')}\n\n${body}\n`;
}
