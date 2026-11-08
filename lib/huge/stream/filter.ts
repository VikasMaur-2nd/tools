/**
 * Field conditions on records (Extract's filter, Shape's "find records where…"): a path within the record
 * (names, indices, `*` for any item or member), an operation, a value. A record matches when all (or any) of
 * its conditions hold; a condition holds when it holds for any value its path reaches (`missing`: none).
 */
import { ARR, BOOL, NUL, NUM, OBJ, STR, kids, type JNode } from '../../json/parser';

export type Op = 'exists' | 'missing' | 'eq' | 'ne' | 'contains' | 'starts' | 'lt' | 'le' | 'gt' | 'ge' | 'is';
export type TypeName = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
/** A number as typed (JSON number syntax), compared exactly: never through a double (IDs past 2^53, long decimals). */
export interface Num {
  num: string;
}
export type Value = string | Num | number | boolean | null;

const isNum = (v: unknown): v is Num => typeof v === 'object' && v !== null && typeof (v as Num).num === 'string';

/** A decimal number exactly: sign × 0.digits × 10^exp (digits without leading or trailing zeros; zero: sign 0). */
interface Dec {
  sign: number;
  digits: string;
  /** A number while it is exact as one; a bigint past that (exponents of more than 15 digits). */
  exp: number | bigint;
}

const NUMBER = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([-+]?\d+))?$/;

function decOf(text: string): Dec | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  let digits = m[2] + (m[3] ?? '');
  let lead = 0;
  while (lead < digits.length && digits.charCodeAt(lead) === 48) lead++;
  let end = digits.length;
  while (end > lead && digits.charCodeAt(end - 1) === 48) end--;
  if (end === lead) return { sign: 0, digits: '', exp: 0 };
  digits = digits.slice(lead, end);
  const e = m[4] ?? '0';
  const shift = m[2].length - lead;
  const exp: number | bigint = e.replace(/^[-+]/, '').length <= 15 ? Number(e) + shift : BigInt(e) + BigInt(shift);
  return { sign: m[1] ? -1 : 1, digits, exp };
}

/** a vs b exactly: -1, 0, 1. */
function cmpDec(a: Dec, b: Dec): number {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  let mag: number;
  if (a.exp !== b.exp && !(typeof a.exp !== typeof b.exp && BigInt(a.exp) === BigInt(b.exp))) {
    mag = (typeof a.exp === 'number' && typeof b.exp === 'number' ? a.exp < b.exp : BigInt(a.exp) < BigInt(b.exp)) ? -1 : 1;
  } else {
    // (Same exponent: the digits, compared as written; a longer run, all else equal, is the bigger.)
    mag = a.digits === b.digits ? 0 : a.digits < b.digits ? -1 : 1;
  }
  return a.sign * mag;
}

/** The condition value's decimal, made once per condition. */
const decs = new WeakMap<Num, Dec | null>();
const condDec = (v: Num) => {
  let d = decs.get(v);
  if (d === undefined) decs.set(v, (d = decOf(v.num.trim())));
  return d;
};

/** A document number (its text as written) against a condition's number: -1, 0, 1, or NaN if either isn't one. */
function cmpNum(text: string, v: Num | number): number {
  const b = typeof v === 'number' ? decOf(String(v)) : condDec(v);
  const a = decOf(text);
  return a && b ? cmpDec(a, b) : NaN;
}

export interface Cond {
  /** Within the record: names, indices, '*' (any item or member). [] is the record itself. */
  path: (string | number)[];
  op: Op;
  /** eq / ne / contains / starts / lt… : what to compare with; is: a TypeName. */
  value?: Value;
  /** Strings compare letter case too (default: any case for contains / starts, exact for eq). */
  caseSensitive?: boolean;
}

export interface Filter {
  conds: Cond[];
  /** All conditions (default) or any. */
  any?: boolean;
}

const TYPES: Record<TypeName, number> = { null: NUL, boolean: BOOL, number: NUM, string: STR, array: ARR, object: OBJ };

/** The values `path` reaches from `n` (`*`: every item or member). */
function reach(n: JNode, path: (string | number)[], at: number, out: JNode[]) {
  if (at === path.length) {
    out.push(n);
    return;
  }
  if (n.t !== ARR && n.t !== OBJ) return;
  const seg = path[at];
  const list = kids(n);
  if (seg === '*') {
    for (const c of list) reach(c, path, at + 1, out);
    return;
  }
  if (n.t === ARR) {
    const i = typeof seg === 'number' ? seg : /^\d+$/.test(seg) ? Number(seg) : -1;
    if (i >= 0 && i < list.length) reach(list[i], path, at + 1, out);
    return;
  }
  // (Duplicate names: each is reached.)
  for (const c of list) if (c.key === String(seg)) reach(c, path, at + 1, out);
}

/** A scalar's text as compared (strings decoded; numbers and literals as written). */
const textOf = (n: JNode): string => (n.t === NUL ? 'null' : n.t === BOOL ? (n.v ? 'true' : 'false') : (n.v as string));

function holds(n: JNode, c: Cond): boolean {
  const v = c.value;
  switch (c.op) {
    case 'exists':
      return true;
    case 'is':
      return TYPES[v as TypeName] === n.t;
    case 'eq':
    case 'ne': {
      let same: boolean;
      if (v === null) same = n.t === NUL;
      else if (typeof v === 'boolean') same = n.t === BOOL && n.v === v;
      else if (typeof v === 'number' || isNum(v)) same = n.t === NUM && cmpNum(n.v as string, v) === 0;
      else if (v === undefined) same = false;
      else if (n.t === STR) same = c.caseSensitive === false ? (n.v as string).toLowerCase() === (v as string).toLowerCase() : n.v === v;
      else same = n.t === NUM && (n.v as string) === v;
      return c.op === 'eq' ? same : !same;
    }
    case 'contains':
    case 'starts': {
      if (n.t === ARR || n.t === OBJ) return false;
      const t = textOf(n);
      const q = isNum(v) ? v.num : String(v ?? '');
      const cs = !!c.caseSensitive;
      const a = cs ? t : t.toLowerCase();
      const b = cs ? q : q.toLowerCase();
      return c.op === 'contains' ? a.includes(b) : a.startsWith(b);
    }
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge': {
      let d: number;
      if (typeof v === 'number' || isNum(v)) {
        if (n.t !== NUM) return false;
        d = cmpNum(n.v as string, v);
      } else if (typeof v === 'string' && n.t === STR) {
        // (Text such as ISO dates compares as written.)
        const x = n.v as string;
        d = x < v ? -1 : x > v ? 1 : 0;
      } else return false;
      return c.op === 'lt' ? d < 0 : c.op === 'le' ? d <= 0 : c.op === 'gt' ? d > 0 : d >= 0;
    }
    default:
      return false;
  }
}

/** Whether condition `c` holds for record `rec`. */
export function test(rec: JNode, c: Cond): boolean {
  const vals: JNode[] = [];
  reach(rec, c.path, 0, vals);
  if (c.op === 'missing') return vals.length === 0;
  if (c.op === 'ne') return vals.length > 0 && vals.every((n) => holds(n, c));
  for (const n of vals) if (holds(n, c)) return true;
  return false;
}

/** Whether record `rec` matches `f` (no conditions: every record). */
export function matches(rec: JNode, f: Filter | null | undefined): boolean {
  if (!f || !f.conds.length) return true;
  if (f.any) return f.conds.some((c) => test(rec, c));
  return f.conds.every((c) => test(rec, c));
}

/** A condition's value as typed: null, true / false, a number (kept as written), or text ("quoted" is always text). */
export function valueOf(text: string): Value {
  const t = text.trim();
  if (t === 'null') return null;
  if (t === 'true' || t === 'false') return t === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(t)) return { num: t };
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return text;
}

/** A scalar's JSON text as the Shape panel shows it (a string in quotes, a number as written) as a condition value. */
export function condValueOf(json: string): Value {
  if (json[0] === '"') return JSON.parse(json) as string;
  return valueOf(json);
}

/** A condition value as the Convert form shows it, which `valueOf` reads back as the same value. */
export function formValue(v: Value | undefined): string {
  if (v === undefined) return '';
  if (isNum(v)) return v.num;
  if (typeof v === 'string') {
    // (Text that would read as another value is quoted.)
    const back = valueOf(v);
    return back === v ? v : JSON.stringify(v);
  }
  return JSON.stringify(v);
}

/** A condition's path as typed: names with dots, `[*]` any item, `[3]` an index, `["a.b"]` a name with signs. */
export function condPath(segs: (string | number)[]): string {
  let s = '';
  for (const x of segs) {
    if (x === '*') s += '[*]';
    else if (typeof x === 'number') s += `[${x}]`;
    else if (/^[A-Za-z_$][\w$-]*$/.test(x)) s += (s ? '.' : '') + x;
    else s += `[${JSON.stringify(x)}]`;
  }
  return s;
}

/** condPath's text back to segments (null: not a path). A leading `$.` or `$` is allowed. */
export function parseCondPath(text: string): (string | number)[] | null {
  let s = text.trim().replace(/^\$\.?/, '');
  const out: (string | number)[] = [];
  while (s.length) {
    let m: RegExpExecArray | null;
    if ((m = /^\.?([^.[\]"]+)/.exec(s))) out.push(m[1].trim());
    else if ((m = /^\[\s*\*\s*\]/.exec(s))) out.push('*');
    else if ((m = /^\[\s*(\d+)\s*\]/.exec(s))) out.push(Number(m[1]));
    else if ((m = /^\[\s*("(?:[^"\\]|\\.)*")\s*\]/.exec(s))) {
      try {
        out.push(JSON.parse(m[1]) as string);
      } catch {
        return null;
      }
    } else return null;
    s = s.slice(m[0].length);
  }
  return out.length ? out : null;
}

/** The form's conditions as a filter (those whose path doesn't read are left out; null: none). */
export function filterOf(f: { conds: { path: string; op: Op; value: string }[]; any: boolean }): Filter | null {
  const conds: Cond[] = [];
  for (const c of f.conds) {
    const path = parseCondPath(c.path);
    if (!path) continue;
    const needs = c.op !== 'exists' && c.op !== 'missing';
    conds.push({ path, op: c.op, value: needs ? (c.op === 'is' ? c.value : c.op === 'contains' || c.op === 'starts' ? c.value : valueOf(c.value)) : undefined });
  }
  return conds.length ? { conds, any: f.any } : null;
}
