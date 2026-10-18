import { ARR, NUM, OBJ, STR, kids, parse, type JNode } from '../json/parser';

export type DifferenceKind = 'changed value' | 'same value, different spelling' | 'duplicate members' | 'missing path' | 'extra path' | 'string changed' | 'type changed';
export type PrecisionDifference = { kind: DifferenceKind; path: string; before?: string; after?: string };
export type PrecisionResult = {
  valid: boolean;
  error?: string;
  numbers: number;
  differences: PrecisionDifference[];
};

/** Compare decimal values without IEEE-754 conversion or expanding large exponents. */
function decimal(raw: string): string {
  const [mantissa, exponent = '0'] = raw.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const dot = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '').replace(/^0+/, '');
  if (!digits) return '0';
  const trimmed = digits.replace(/0+$/, '');
  const power = BigInt(exponent) - BigInt(dot < 0 ? 0 : unsigned.length - dot - 1) + BigInt(digits.length - trimmed.length);
  return `${negative ? '-' : ''}${trimmed}e${power}`;
}

const value = (node: JNode) => node.t === STR ? JSON.stringify(node.v) : node.t >= ARR ? node.t === OBJ ? 'object' : 'array' : String(node.v);
const property = (path: string, key: string) => /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

function signature(node: JNode): string {
  const parts: string[] = [];
  const visit = (current: JNode) => {
    parts.push(`${current.t}:`);
    if (current.t === NUM) { parts.push(decimal(current.v as string)); return; }
    if (current.t < ARR) { parts.push(JSON.stringify(current.v)); return; }
    const children = current.t === OBJ ? kids(current).slice().sort((a, b) => String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0) : kids(current);
    parts.push('[');
    for (const child of children) {
      parts.push(JSON.stringify(child.key), ':');
      visit(child);
      parts.push(',');
    }
    parts.push(']');
  };
  visit(node);
  return parts.join('');
}

export function checkPrecision(original: string, output: string): PrecisionResult {
  const result: PrecisionResult = { valid: true, numbers: 0, differences: [] };
  const trees: JNode[] = [];
  for (const [name, text] of [['Original', original], ['Tool output', output]]) {
    const parsed = parse(text);
    const issue = parsed.error ?? parsed.issues[0];
    if (!parsed.root || issue || parsed.multi) {
      result.valid = false;
      result.error = `${name} is not valid JSON. ${issue?.m ?? 'Expected one JSON value.'} JavaScript display forms such as Infinity, NaN and unquoted keys are not JSON. Copy or export the tool's JSON text.`;
      return result;
    }
    trees.push(parsed.root);
  }
  const add = (kind: DifferenceKind, path: string, before?: string, after?: string) => result.differences.push({ kind, path, before, after });
  const compare = (a: JNode, b: JNode, path: string) => {
    if (a.t === NUM) result.numbers++;
    if (a.t === NUM || b.t === NUM) {
      if (a.t !== b.t || decimal(a.v as string) !== decimal(b.v as string)) add('changed value', path, value(a), value(b));
      else if (a.v !== b.v) add('same value, different spelling', path, value(a), value(b));
      return;
    }
    if (a.t !== b.t) { add('type changed', path, value(a), value(b)); return; }
    if (a.t === OBJ) {
      const group = (node: JNode) => {
        const map = new Map<string, JNode[]>();
        for (const child of kids(node)) {
          const key = child.key as string;
          const list = map.get(key) ?? [];
          list.push(child);
          map.set(key, list);
        }
        return map;
      };
      const left = group(a), right = group(b);
      for (const key of new Set([...left.keys(), ...right.keys()])) {
        const aa = left.get(key) ?? [], bb = right.get(key) ?? [];
        const p = property(path, key);
        if ((aa.length > 1 || bb.length > 1) && aa.length !== bb.length) {
          add('duplicate members', p, `${aa.length} members`, `${bb.length} members`);
        }
        const pairs = new Map<number, number>();
        const used = new Set<number>();
        if (aa.length !== bb.length && aa.length && bb.length) {
          // A tool may retain either the first or last duplicate. Match preserved values first.
          const available = new Map<string, number[]>();
          for (let i = 0; i < bb.length; i++) {
            const key = signature(bb[i]);
            const indices = available.get(key) ?? [];
            indices.push(i); available.set(key, indices);
          }
          for (let i = aa.length - 1; i >= 0; i--) {
            const j = available.get(signature(aa[i]))?.pop();
            if (j !== undefined) { pairs.set(i, j); used.add(j); }
          }
        }
        let j = bb.length - 1;
        for (let i = aa.length - 1; i >= 0; i--) {
          if (pairs.has(i)) continue;
          while (used.has(j)) j--;
          if (j >= 0) { pairs.set(i, j); used.add(j--); }
        }
        const repeated = Math.max(aa.length, bb.length) > 1;
        for (let i = 0; i < aa.length; i++) {
          const member = repeated ? `${p} [member ${i + 1}]` : p;
          const paired = pairs.get(i);
          if (paired === undefined) add('missing path', member, value(aa[i]));
          else compare(aa[i], bb[paired], member);
        }
        for (let i = 0; i < bb.length; i++) {
          if (!used.has(i)) add('extra path', repeated ? `${p} [output member ${i + 1}]` : p, undefined, value(bb[i]));
        }
      }
    } else if (a.t === ARR) {
      const aa = kids(a), bb = kids(b);
      for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
        if (!aa[i]) add('extra path', `${path}[${i}]`, undefined, value(bb[i]));
        else if (!bb[i]) add('missing path', `${path}[${i}]`, value(aa[i]));
        else compare(aa[i], bb[i], `${path}[${i}]`);
      }
    } else if (a.v !== b.v) add(a.t === STR ? 'string changed' : 'changed value', path, value(a), value(b));
  };
  compare(trees[0], trees[1], '$');
  return result;
}
