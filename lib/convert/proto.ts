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

/** A field name: lower_snake_case ASCII. */
function fieldName(key: string): string {
  const s = snake(ascii(key))
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return !s ? 'field' : /^[0-9]/.test(s) ? 'the_' + s : s;
}

/** The JSON name protoc gives a field (each '_' dropped, the character after it upper-cased). */
const jsonName = (f: string) => f.replace(/_+(.?)/g, (_, c: string) => c.toUpperCase());

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
  const line = (s: Shape, opt: boolean, name: string, n: number, opts = '', note = '') =>
    `  ${type(s, opt)} ${name} = ${fieldNumber(n)}${opts};${rounded(s) ? ' // integers beyond int64: double rounds them' : note}`;

  // Keys written in snake_case are the field names already, and printers keep them when told to use proto
  // names: json_name on each is only needed when other keys (camelCase, punctuation) want the default printer.
  const props = (t: Obj) => [...t.props.values()];
  let snakeKeys = false;
  let otherKeys = false;
  for (const t of m.types) {
    for (const p of props(t)) {
      const f = fieldName(p.key);
      if (p.key === f) snakeKeys ||= p.key !== jsonName(f);
      else otherKeys = true;
    }
  }
  const protoNames = snakeKeys && !otherKeys;

  const message = (t: Obj): string => {
    const ps = props(t);
    const fs: string[] = [];
    const names = new Set<string>();
    // protoc wants the JSON names it derives from field names to differ ignoring case (lower-cased here).
    const defaults = new Set<string>();
    // Keys that are field names already keep them; the others are named after them.
    const exact = (i: number) => +(ps[i].key === fieldName(ps[i].key));
    for (const i of ps.map((_, i) => i).sort((a, b) => exact(b) - exact(a) || a - b)) {
      const base = fieldName(ps[i].key);
      let f = base;
      for (let n = 2; names.has(f) || defaults.has(jsonName(f).toLowerCase()); n++) f = `${base}_${n}`;
      names.add(f);
      defaults.add(jsonName(f).toLowerCase());
      fs[i] = f;
    }
    // json_name where the key isn't the JSON name protoc derives. The JSON names in effect (json_name, else the
    // derived one) must differ ignoring case too (protoc), and parsers read a field by its name as well (upb):
    // while two fields clash, the later one's json_name goes (or the earlier one's, if only it has one).
    const wanted = ps.map((p, i) => p.key !== jsonName(fs[i]) && !(protoNames && p.key === fs[i]));
    const custom = [...wanted];
    const byName = new Map(fs.map((f, i) => [f, i]));
    for (let clash = true; clash; ) {
      clash = false;
      const owner = new Map<string, number>();
      for (let i = 0; i < ps.length && !clash; i++) {
        const low = (custom[i] ? ps[i].key : jsonName(fs[i])).toLowerCase();
        const j = owner.get(low) ?? (custom[i] ? byName.get(low) : undefined);
        if (j === undefined || j === i) owner.set(low, i);
        else {
          custom[custom[i] ? i : j] = false;
          clash = true;
        }
      }
    }
    const rows = ps.map((p, i) =>
      line(
        p.s,
        p.opt,
        fs[i],
        i + 1,
        custom[i] ? ` [json_name = ${lit(p.key)}]` : '',
        wanted[i] && !custom[i] ? ` // JSON key ${JSON.stringify(p.key)}: too close to another field's name for protobuf JSON` : '',
      ),
    );
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
  const head = ['syntax = "proto3";'];
  if (imports.size) head.push('', ...[...imports].sort().map((i) => `import "${i}";`));
  if (protoNames) head.push('', '// Keys are snake_case field names: print JSON with proto field names (e.g. protojson UseProtoNames) to keep them.');
  return `${head.join('\n')}\n\n${body}\n`;
}
