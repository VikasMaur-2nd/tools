/**
 * Structural type inference shared by every code emitter.
 *
 * One linear pass merges every value found at the same structural position into
 * a `Shape`: all elements of an array merge into one shape, all objects at a
 * position merge into one `Obj` (keys missing from some instances become
 * optional, `null`s make a shape nullable). Objects whose keys are data (ids,
 * dates) or that never have keys become dictionaries. Identical object shapes
 * are then deduplicated and given unique PascalCase names.
 */
import { ARR, BOOL, JNode, NUL, NUM, STR, kids } from '../json/parser';
import type { FlatOptions, FlatResult } from './flat';
import { isDataKey } from './keys';

export interface ConvertOptions {
  /** Name of the top-level type (default "Root"). */
  rootName: string;
  /** TypeScript: `interface` declarations (default) or `type` aliases. */
  tsStyle?: 'interface' | 'type';
  /** Make every property optional. */
  optionalAll?: boolean;
  /** C#: System.Text.Json (default) or Newtonsoft.Json attributes. */
  csharpLib?: 'stj' | 'newtonsoft';
  /** Flatten and unflatten: separator, array style, escapes and depth (default: lib/convert/flat.ts FLAT_DEFAULTS). */
  flat?: Partial<FlatOptions>;
  /** Flatten and unflatten: their notes, or the error that left no output. */
  report?: (r: FlatResult) => void;
}

/** Kind bits of a shape. */
export const KN = 1,
  KB = 2,
  KI = 4,
  KF = 8,
  KS = 16,
  KA = 32,
  KO = 64;

export interface Shape {
  /** Kinds seen (K* bits); 0 = nothing seen, e.g. the elements of `[]`. */
  k: number;
  /** Largest integer seen: 0 = safe in JS, 1 = needs int64, 2 = beyond int64. */
  big: number;
  /** Format matched by every string seen (null = none). */
  fmt?: string | null;
  arr?: Shape;
  obj?: Obj;
}

interface Prop {
  key: string;
  s: Shape;
  /** Number of instances that have the key. */
  n: number;
  st: number;
  opt: boolean;
}

export interface Obj {
  /** Number of instances merged. */
  n: number;
  props: Map<string, Prop>;
  name: string;
  id: number;
  /** Value shape when the object is a dictionary rather than a record. */
  map?: Shape;
}

export interface Model {
  root: Shape;
  /** Name of the top-level type. */
  name: string;
  /** Named record type of the root, if the root is an object. */
  obj: Obj | null;
  /** Named types, root first (parents before children). */
  types: Obj[];
  /** Named types, dependencies first. */
  deps: Obj[];
}

const DATE = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
// Conservative: every string at a position must match for a format to be reported. A date-time is one every
// target reads: protobuf's Timestamp takes years 0001-9999 and at most 9 fractional digits.
const FMT: Record<string, RegExp> = {
  'date-time': new RegExp(`^(?!0000)${DATE}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`),
  date: new RegExp(`^${DATE}$`),
  uuid: /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
  email: /^[\w+-]+(?:\.[\w+-]+)*@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i,
  uri: /^https?:\/\/[a-z\d](?:[a-z\d.-]*[a-z\d])?(?::\d{1,5})?(?:[/?#](?:[\w.~:/?#@!$&'()*+,;=-]|%[\da-f]{2})*)?$/i,
};

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** A date's day exists (RFC 3339 5.7: February 29 only in leap years). */
function realDay(v: string): boolean {
  const y = +v.slice(0, 4);
  const m = +v.slice(5, 7);
  const d = +v.slice(8, 10);
  return d <= DAYS[m - 1] && (m !== 2 || d < 29 || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)));
}
/** A date-time's instant is in 0001-9999 in UTC too (the offset can carry the first and last days out of it). */
function inRange(v: string): boolean {
  const day = v.slice(0, 10);
  const off = /([+-])(\d\d):(\d\d)$/.exec(v);
  if (!off || (day !== '0001-01-01' && day !== '9999-12-31')) return true;
  const utc = +v.slice(11, 13) * 60 + +v.slice(14, 16) - (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +off[3]);
  return day === '0001-01-01' ? utc >= 0 : utc < 1440;
}
const matches = (f: string, v: string) => FMT[f].test(v) && ((f !== 'date' && f !== 'date-time') || realDay(v)) && (f !== 'date-time' || inRange(v));

function fmtOf(v: string, prev: string | undefined): string | null {
  if (v.length > 2048) return null;
  if (prev) return matches(prev, v) ? prev : null;
  for (const f in FMT) if (matches(f, v)) return f;
  return null;
}

const le = (a: string, b: string) => a.length < b.length || (a.length === b.length && a <= b);
function bigOf(raw: string): number {
  const neg = raw.charCodeAt(0) === 45;
  const d = neg ? raw.slice(1) : raw;
  return le(d, '9007199254740991') ? 0 : le(d, neg ? '9223372036854775808' : '9223372036854775807') ? 1 : 2;
}

const shape = (): Shape => ({ k: 0, big: 0 });
let stamp = 0;

function add(s: Shape, n: JNode): void {
  switch (n.t) {
    case NUL:
      s.k |= KN;
      return;
    case BOOL:
      s.k |= KB;
      return;
    case NUM: {
      const r = n.v as string;
      if (r.indexOf('.') < 0 && r.indexOf('e') < 0 && r.indexOf('E') < 0) {
        s.k |= KI;
        if (r.length > 15 && s.big < 2) s.big = Math.max(s.big, bigOf(r));
      } else s.k |= KF;
      return;
    }
    case STR:
      s.k |= KS;
      if (s.fmt !== null) s.fmt = fmtOf(n.v as string, s.fmt);
      return;
    case ARR: {
      s.k |= KA;
      const a = s.arr || (s.arr = shape());
      const l = kids(n);
      for (let i = 0; i < l.length; i++) add(a, l[i]);
      return;
    }
  }
  s.k |= KO;
  const o = s.obj || (s.obj = { n: 0, props: new Map(), name: '', id: -1 });
  o.n++;
  const st = ++stamp;
  const l = kids(n);
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    const key = c.key as string;
    let p = o.props.get(key);
    if (!p) o.props.set(key, (p = { key, s: shape(), n: 0, st: 0, opt: false }));
    if (p.st !== st) {
      p.st = st;
      p.n++;
    }
    add(p.s, c);
  }
}

/** Merges `b` into `a` (b's sub-shapes are adopted, b must not be used afterwards). */
function merge(a: Shape, b: Shape): void {
  if (b.k & KS) a.fmt = a.k & KS ? (a.fmt === b.fmt ? a.fmt : null) : b.fmt;
  a.k |= b.k;
  if (b.big > a.big) a.big = b.big;
  if (b.arr) {
    if (a.arr) merge(a.arr, b.arr);
    else a.arr = b.arr;
  }
  const bo = b.obj;
  if (!bo) return;
  const ao = a.obj;
  if (!ao) {
    a.obj = bo;
    return;
  }
  ao.n += bo.n;
  for (const p of bo.props.values()) {
    const q = ao.props.get(p.key);
    if (!q) ao.props.set(p.key, p);
    else {
      q.n += p.n;
      merge(q.s, p.s);
    }
  }
}

function fin(s: Shape, all: boolean): void {
  if (s.arr) fin(s.arr, all);
  const o = s.obj;
  if (!o) return;
  const ps = [...o.props.values()];
  if (ps.every((p) => isDataKey(p.key))) {
    const v = shape();
    for (const p of ps) merge(v, p.s);
    o.map = v;
    fin(v, all);
    return;
  }
  for (const p of ps) {
    p.opt = all || p.n < o.n;
    fin(p.s, all);
  }
}

/* ---------- naming ---------- */

const SPLIT = new RegExp('[^\\p{L}\\p{Nd}]+', 'u');
const DIGIT0 = new RegExp('^\\p{Nd}', 'u');

/** Splits a key into words: `firstName`, `first_name`, `XMLHttp2` ... */
function words(s: string): string[] {
  const w = s
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(SPLIT)
    .filter(Boolean);
  if (w.length && DIGIT0.test(w[0])) w.unshift('the');
  return w;
}

const cap = (w: string, lower: boolean) => w.charAt(0).toUpperCase() + (lower ? w.slice(1).toLowerCase() : w.slice(1));

/** PascalCase; `init` = initialisms to keep upper-case (Go). */
export function pascal(s: string, init?: Set<string>): string {
  const lower = !/[a-z]/.test(s);
  return words(s)
    .map((w) => (init && init.has(w.toUpperCase()) ? w.toUpperCase() : cap(w, lower)))
    .join('');
}

export function camel(s: string): string {
  const lower = !/[a-z]/.test(s);
  return words(s)
    .map((w, i) => (i ? cap(w, lower) : lower || !/[a-z]/.test(w) ? w.toLowerCase() : w.charAt(0).toLowerCase() + w.slice(1)))
    .join('');
}

export const snake = (s: string) => words(s).join('_').toLowerCase();

// (A Map: an object would find "constructor" on Object.prototype.)
const IRREG = new Map<string, string>([
  ['people', 'person'],
  ['children', 'child'],
  ['men', 'man'],
  ['women', 'woman'],
  ['indices', 'index'],
  ['matrices', 'matrix'],
  ['vertices', 'vertex'],
  ['analyses', 'analysis'],
  ['aliases', 'alias'],
  ['data', ''],
]);

/** Singular form of an English plural, or null when the word isn't plural. */
export function singular(w: string): string | null {
  const l = w.toLowerCase();
  const irr = IRREG.get(l);
  if (irr !== undefined) return irr ? (w === l ? irr : cap(irr, false)) : null;
  if (/(?:ss|us|is|news|series|species)$/.test(l)) return null;
  const up = w === w.toUpperCase() && w !== l;
  if (/[^aeiou]ies$/.test(l) && !/(?:movie|cookie|zombie|rookie|calorie|selfie|pie|tie|lie)s$/.test(l)) return w.slice(0, -3) + (up ? 'Y' : 'y');
  if (/(?:ss|x|ch|sh|[tbpnrc]us|ias)es$/.test(l)) return w.slice(0, -2);
  return l.length > 1 && l.endsWith('s') ? w.slice(0, -1) : null;
}

/** Name hint for the items of an array / values of a map named `hint`. */
function item(hint: string): string {
  const w = words(hint);
  const last = w.pop() || '';
  const s = singular(last);
  return [...w, s || last, s ? '' : 'Item'].join(' ');
}

/**
 * Infers the type model of a document. `reserved` lists type names that would
 * clash with the target language (they get a "Class" suffix); `pc` turns a key
 * into a type name. Without `unions`, mixed values become the language's
 * "any" type, so objects inside them are neither named nor emitted. `fold`
 * maps a name to what the language compares (PHP: ASCII case-insensitive), for
 * both the reserved check and uniqueness.
 */
export function infer(
  node: JNode,
  o: ConvertOptions,
  reserved = '',
  pc: (s: string) => string = pascal,
  unions = true,
  fold: (s: string) => string = (s) => s,
): Model {
  stamp = 0;
  const root = shape();
  add(root, node);
  fin(root, !!o.optionalAll);

  // Deduplicate identical object shapes (bottom-up structural signatures).
  const reg = new Map<string, Obj>();
  const canon = (s: Shape): string => {
    let r = s.k + ',' + s.big + ',' + (s.fmt || '');
    if (s.arr) r += '[' + canon(s.arr) + ']';
    const ob = s.obj;
    if (ob) {
      if (ob.map) r += '{' + canon(ob.map) + '}';
      else {
        const parts: string[] = [];
        for (const p of ob.props.values()) parts.push(JSON.stringify(p.key) + (p.opt ? '?' : ':') + canon(p.s));
        const sig = parts.sort().join(';');
        let c = reg.get(sig);
        if (!c) {
          reg.set(sig, (c = ob));
          ob.id = reg.size;
        }
        s.obj = c;
        r += '#' + c.id;
      }
    }
    return r;
  };
  canon(root);

  const res = new Set(reserved.split(' ').map(fold));
  const used = new Set<string>();
  const unique = (n: string) => {
    if (res.has(fold(n))) n += 'Class';
    let u = n;
    for (let i = 2; used.has(fold(u)); i++) u = n + i;
    used.add(fold(u));
    return u;
  };
  const types: Obj[] = [];
  const deps: Obj[] = [];
  // `it`: hint already names an item (nested arrays don't stack "ItemItem").
  // Only types the emitter will reference are named (and so emitted).
  const name = (s: Shape, hint: string, it = false): void => {
    if (!unions && kind(s) === 'union') return;
    if (s.arr) name(s.arr, it ? hint : item(hint), true);
    const ob = s.obj;
    if (!ob) return;
    if (ob.map) return name(ob.map, item(hint), true);
    if (ob.name) return;
    ob.name = unique(pc(hint) || 'Type');
    types.push(ob);
    for (const p of ob.props.values()) name(p.s, p.key);
    deps.push(ob);
  };
  const rootName = o.rootName.trim() || 'Root';
  const obj = root.obj && !root.obj.map && root.k === KO ? root.obj : null;
  const top = obj ? '' : unique(pc(rootName) || 'Root');
  name(root, rootName);
  return { root, name: obj ? obj.name : top, obj, types, deps };
}

/* ---------- helpers for emitters ---------- */

/** Kind bits without null; int+float collapse to float. */
export function core(s: Shape): number {
  const k = s.k & ~KN;
  return k & KF ? k & ~KI : k;
}

export type Kind = 'unknown' | 'null' | 'union' | 'bool' | 'int' | 'big' | 'float' | 'str' | 'arr' | 'map' | 'obj';

export function kind(s: Shape): Kind {
  const k = core(s);
  if (!k) return s.k ? 'null' : 'unknown';
  if (k & (k - 1)) return 'union';
  if (k === KB) return 'bool';
  if (k === KI) return s.big > 1 ? 'big' : 'int';
  if (k === KF) return 'float';
  if (k === KS) return 'str';
  if (k === KA) return 'arr';
  return s.obj!.map ? 'map' : 'obj';
}

/** Splits a union shape into one shape per (non-null) kind. */
export const members = (s: Shape): Shape[] =>
  [KB, KI, KF, KS, KA, KO].filter((b) => core(s) & b).map((b) => ({ ...s, k: b }));

/** Per-language primitive table for `typeOf`. */
export interface Prim {
  bool: string;
  int: string;
  big: string;
  float: string;
  str: string;
  /** Unknown / mixed values. */
  any: string;
  arr(t: string): string;
  map(t: string): string;
  nul(t: string): string;
  /** `any` needs `nul()` to admit null. */
  an?: boolean;
  /** Native unions. */
  un?(ts: string[]): string;
}

/** Type expression of a shape; `force` makes it nullable (optional properties). */
export function typeOf(s: Shape, P: Prim, force = false): string {
  const k = kind(s);
  const any = k === 'unknown' || k === 'null' || (k === 'union' && !P.un);
  const t = any
    ? P.any
    : k === 'union'
      ? P.un!(members(s).map((m) => typeOf(m, P)))
      : k === 'obj'
        ? s.obj!.name
        : k === 'arr'
          ? P.arr(typeOf(s.arr!, P))
          : k === 'map'
            ? P.map(typeOf(s.obj!.map!, P))
            : P[k as 'bool' | 'int' | 'big' | 'float' | 'str'];
  return force || (s.k & KN && (!any || P.an)) ? P.nul(t) : t;
}

export const isNull = (s: Shape) => !!(s.k & KN);

/** Integers that lose precision as JS numbers, here or in array elements. */
export const hasBig = (s: Shape): boolean => s.big > 0 || (!!s.arr && hasBig(s.arr));

/** Returns a function that makes names unique within one scope. */
export function uniq(): (n: string) => string {
  const u = new Set<string>();
  return (n) => {
    let r = n;
    for (let i = 2; u.has(r); i++) r = n + i;
    u.add(r);
    return r;
  };
}

const LIT: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
/**
 * Quoted string literal with C-style escapes. `q` = quote char, `brace` =
 * `\u{X}` escapes (Rust, Swift), `dollar` = escape `$` (Kotlin, Dart).
 */
export function lit(s: string, q = '"', brace = false, dollar = false): string {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    if (ch === q || ch === '\\' || (dollar && ch === '$')) r += '\\' + ch;
    else if (c < 32 || c === 127) r += LIT[ch] || (brace ? `\\u{${c.toString(16)}}` : '\\u' + c.toString(16).padStart(4, '0'));
    else r += ch;
  }
  return q + r + q;
}
