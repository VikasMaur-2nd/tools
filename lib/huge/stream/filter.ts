/**
 * Field conditions on records (Extract's filter, Shape's "find records where…"): a path within the record
 * (names, indices, `*` for any item or member), an operation, a value. A record matches when all (or any) of
 * its conditions hold; a condition holds when it holds for any value its path reaches (`missing`: none).
 */
import { ARR, BOOL, NUL, NUM, OBJ, STR, kids, type JNode } from '../../json/parser';

export type Op = 'exists' | 'missing' | 'eq' | 'ne' | 'contains' | 'starts' | 'lt' | 'le' | 'gt' | 'ge' | 'is';
export type TypeName = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
export type Value = string | number | boolean | null;

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
      else if (typeof v === 'number') same = n.t === NUM && Number(n.v) === v;
      else if (v === undefined) same = false;
      else if (n.t === STR) same = c.caseSensitive === false ? (n.v as string).toLowerCase() === v.toLowerCase() : n.v === v;
      else same = n.t === NUM && (n.v as string) === v;
      return c.op === 'eq' ? same : !same;
    }
    case 'contains':
    case 'starts': {
      if (n.t === ARR || n.t === OBJ) return false;
      const t = textOf(n);
      const q = String(v ?? '');
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
      if (typeof v === 'number') {
        if (n.t !== NUM) return false;
        const x = Number(n.v);
        d = x < v ? -1 : x > v ? 1 : x === v ? 0 : NaN;
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

/** A condition's value as typed: null, true / false, a number, or text ("quoted" is always text). */
export function valueOf(text: string): Value {
  const t = text.trim();
  if (t === 'null') return null;
  if (t === 'true' || t === 'false') return t === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return text;
}
