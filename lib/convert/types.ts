/** TypeScript, Zod and JSON Schema emitters. */
import type { JNode } from '../json/parser';
import { quote } from '../json/format';
import { type ConvertOptions, type Obj, type Shape, KA, KB, KF, KI, KN, KO, KS, core, hasBig, infer, members } from './infer';

const TS_RESERVED = 'Record Array Object String Number Boolean Date Map Set Promise Error Function Symbol JSON';
const IDENT = /^[A-Za-z_$][\w$]*$/;
const tsKey = (k: string) => (IDENT.test(k) ? k : quote(k));
// In an object literal `__proto__: x` sets the prototype instead of adding a key.
const objKey = (k: string) => (k === '__proto__' ? '["__proto__"]' : tsKey(k));
const BIG = ' // exceeds Number.MAX_SAFE_INTEGER: precision is lost as a JS number';
const props = (t: Obj) => [...t.props.values()];

export function toTypeScript(root: JNode, o: ConvertOptions): string {
  const m = infer(root, o, TS_RESERVED);
  const ty = (s: Shape): string => {
    const k = s.k;
    const t: string[] = [];
    if (k & KB) t.push('boolean');
    if (k & (KI | KF)) t.push('number');
    if (k & KS) t.push('string');
    if (k & KA) {
      const e = ty(s.arr!);
      t.push(e.includes('|') ? `(${e})[]` : e + '[]');
    }
    if (k & KO) t.push(s.obj!.map ? `Record<string, ${ty(s.obj!.map)}>` : s.obj!.name);
    if (k & KN) t.push('null');
    return t.join(' | ') || 'unknown';
  };
  const out: string[] = [];
  if (!m.obj) out.push(`export type ${m.name} = ${ty(m.root)};${hasBig(m.root) ? BIG : ''}`);
  for (const t of m.types) {
    const body = props(t)
      .map((p) => `  ${tsKey(p.key)}${p.opt ? '?' : ''}: ${ty(p.s)};${hasBig(p.s) ? BIG : ''}`)
      .join('\n');
    out.push(o.tsStyle === 'type' ? `export type ${t.name} = {\n${body}\n};` : `export interface ${t.name} {\n${body}\n}`);
  }
  return out.join('\n\n') + '\n';
}

const ZFMT: Record<string, string> = {
  'date-time': '.datetime({ offset: true })',
  date: '.date()',
  uuid: '.uuid()',
  email: '.email()',
  uri: '.url()',
};

export function toZod(root: JNode, o: ConvertOptions): string {
  const m = infer(root, o, TS_RESERVED);
  const one = (s: Shape): string => {
    switch (s.k) {
      case KB:
        return 'z.boolean()';
      case KI:
        return s.big ? 'z.number()' : 'z.number().int()';
      case KF:
        return 'z.number()';
      case KS:
        return 'z.string()' + (s.fmt ? ZFMT[s.fmt] : '');
      case KA:
        return `z.array(${zt(s.arr!)})`;
    }
    return s.obj!.map ? `z.record(z.string(), ${zt(s.obj!.map)})` : s.obj!.name + 'Schema';
  };
  const zt = (s: Shape): string => {
    const ms = members(s);
    const t = ms.length > 1 ? `z.union([${ms.map(one).join(', ')}])` : ms.length ? one(ms[0]) : s.k ? 'z.null()' : 'z.unknown()';
    return ms.length && s.k & KN ? t + '.nullable()' : t;
  };
  const field = (s: Shape, opt: boolean) => {
    const t = zt(s);
    return !opt ? t : t.endsWith('.nullable()') ? t.slice(0, -11) + '.nullish()' : t + '.optional()';
  };
  const out = ['import { z } from "zod";'];
  const decl = (n: string, schema: string) => `export const ${n}Schema = ${schema};\nexport type ${n} = z.infer<typeof ${n}Schema>;`;
  for (const t of m.deps) {
    const body = props(t)
      .map((p) => `  ${objKey(p.key)}: ${field(p.s, p.opt)},${hasBig(p.s) ? BIG : ''}`)
      .join('\n');
    out.push(decl(t.name, `z.object({\n${body}\n})`));
  }
  if (!m.obj) out.push(decl(m.name, zt(m.root)));
  return out.join('\n\n') + '\n';
}

/* ---------- JSON Schema (draft 2020-12) ---------- */

type J = string | number | boolean | J[] | Map<string, J>;

const prim = (v: J) => (typeof v === 'string' ? quote(v) : String(v));

/** Pretty-prints into `o` with 2-space indent; Maps keep key order (even numeric keys). */
function pj(v: J, ind: string, o: string[]): void {
  if (typeof v !== 'object') return void o.push(prim(v));
  const i2 = ind + '  ';
  if (Array.isArray(v)) {
    const s = v.every((x) => typeof x !== 'object') ? '[' + v.map(prim).join(', ') + ']' : '';
    if (!v.length || (s && s.length + ind.length < 80)) return void o.push(s);
    v.forEach((x, i) => {
      o.push((i ? ',\n' : '[\n') + i2);
      pj(x, i2, o);
    });
    return void o.push('\n' + ind + ']');
  }
  if (!v.size) return void o.push('{}');
  let i = 0;
  for (const [k, x] of v) {
    o.push((i++ ? ',\n' : '{\n') + i2 + quote(k) + ': ');
    pj(x, i2, o);
  }
  o.push('\n' + ind + '}');
}

export function toJSONSchema(root: JNode, o: ConvertOptions): string {
  const m = infer(root, o);
  const sch = (s: Shape): Map<string, J> => {
    const k = core(s);
    const r = new Map<string, J>();
    const ref = k & KO && !s.obj!.map ? s.obj!.name : '';
    const types: string[] = [];
    if (k & KB) types.push('boolean');
    if (k & KI) types.push('integer');
    if (k & KF) types.push('number');
    if (k & KS) types.push('string');
    if (k & KA) types.push('array');
    if (k & KO && !ref) types.push('object');
    if (s.k & KN) types.push('null');
    if (types.length) r.set('type', types.length > 1 ? types : types[0]);
    if (k & KS && s.fmt) r.set('format', s.fmt);
    if (k & KA && s.arr!.k) r.set('items', sch(s.arr!));
    if (k & KO && !ref && s.obj!.map!.k) r.set('additionalProperties', sch(s.obj!.map!));
    if (!ref) return r;
    const rm = new Map<string, J>([['$ref', '#/$defs/' + ref]]);
    return r.size ? new Map([['anyOf', [rm, r]]]) : rm;
  };
  const def = (t: Obj, r = new Map<string, J>()) => {
    const ps = new Map<string, J>();
    const req: string[] = [];
    for (const p of t.props.values()) {
      ps.set(p.key, sch(p.s));
      if (!p.opt) req.push(p.key);
    }
    r.set('type', 'object');
    r.set('properties', ps);
    if (req.length) r.set('required', req);
    return r;
  };
  const top = new Map<string, J>([
    ['$schema', 'https://json-schema.org/draft/2020-12/schema'],
    ['title', m.name],
  ]);
  if (m.obj) def(m.obj, top);
  else for (const [k, v] of sch(m.root)) top.set(k, v);
  const defs = m.types.filter((t) => t !== m.obj);
  if (defs.length) top.set('$defs', new Map(defs.map((t) => [t.name, def(t)])));
  const out: string[] = [];
  pj(top, '', out);
  return out.join('') + '\n';
}
