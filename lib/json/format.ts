import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids, type ParseResult } from './parser';

const byKey = (a: JNode, b: JNode) => {
  const x = a.key as string;
  const y = b.key as string;
  return x < y ? -1 : x > y ? 1 : 0;
};

// Strings that JSON.stringify would escape (quotes, backslash, control chars, lone surrogates).
const NEEDS_ESCAPE = /["\\\x00-\x1f\ud800-\udfff]/;
export const quote = (s: string) => (NEEDS_ESCAPE.test(s) ? JSON.stringify(s) : '"' + s + '"');

/**
 * Serializes a node tree. `indent` is the indent unit ('' = minified).
 * Numbers are written from their original source text, so nothing is lost.
 */
export function stringify(root: JNode, indent: string, sortKeys = false): string {
  let out = '';
  const nl = indent ? '\n' : '';
  const colon = indent ? ': ' : ':';
  const pads = [''];

  const w = (node: JNode, d: number) => {
    switch (node.t) {
      case NUL:
        out += 'null';
        return;
      case BOOL:
        out += node.v ? 'true' : 'false';
        return;
      case NUM:
        out += node.v as string;
        return;
      case STR:
        out += quote(node.v as string);
        return;
    }
    let list = kids(node);
    const isObj = node.t === OBJ;
    if (!list.length) {
      out += isObj ? '{}' : '[]';
      return;
    }
    if (isObj && sortKeys) list = list.slice().sort(byKey);
    const inner = pads[d + 1] ?? (pads[d + 1] = pads[d] + indent);
    const sep = ',' + nl + inner;
    out += (isObj ? '{' : '[') + nl + inner;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (i) out += sep;
      if (isObj) out += quote(c.key as string) + colon;
      w(c, d + 1);
    }
    out += nl + pads[d] + (isObj ? '}' : ']');
  };

  w(root, 0);
  return out;
}

/**
 * Formats a parsed document. Uses the native engine when it is guaranteed to
 * reproduce the document exactly (≈3× faster on large inputs).
 */
export function formatDoc(src: string, res: ParseResult, indent: string, sortKeys = false): string {
  if (res.exact && !sortKeys) return JSON.stringify(JSON.parse(src), null, indent || undefined);
  return stringify(res.root as JNode, indent, sortKeys);
}

/** Text to copy for a node: raw text for strings, JSON for everything else. */
export function copyText(node: JNode, indent: string): string {
  if (node.t === STR) return node.v as string;
  return stringify(node, indent);
}

/** `1.50e3` → `15e1`: digits without leading/trailing zeros + decimal exponent. */
const sci = (raw: string) => {
  const ei = raw.search(/[eE]/);
  let m = ei < 0 ? raw : raw.slice(0, ei);
  let exp = ei < 0 ? 0 : Number(raw.slice(ei + 1));
  const neg = m[0] === '-';
  if (neg) m = m.slice(1);
  const dot = m.indexOf('.');
  if (dot >= 0) {
    exp -= m.length - dot - 1;
    m = m.slice(0, dot) + m.slice(dot + 1);
  }
  m = m.replace(/^0+/, '');
  if (!m) return '0';
  const z = m.length - m.replace(/0+$/, '').length;
  return (neg ? '-' : '') + m.slice(0, m.length - z) + 'e' + (exp + z);
};

/** Converts a node to a plain JS value (numbers that would lose precision stay strings). */
export function toValue(node: JNode): unknown {
  switch (node.t) {
    case NUL:
      return null;
    case BOOL:
      return node.v;
    case NUM: {
      const raw = node.v as string;
      const n = Number(raw);
      return String(n) === raw || (Number.isFinite(n) && sci(String(n)) === sci(raw)) ? n : raw;
    }
    case STR:
      return node.v;
    case ARR: {
      // a loop rather than .map(): one stack frame per level, like the parser
      const out: unknown[] = [];
      for (const c of kids(node)) out.push(toValue(c));
      return out;
    }
    default: {
      const o: Record<string, unknown> = {};
      for (const c of kids(node)) {
        const k = c.key as string;
        // a plain assignment to "__proto__" would set the prototype and drop the key (JSON.parse keeps it)
        if (k === '__proto__') Object.defineProperty(o, k, { value: toValue(c), enumerable: true, writable: true, configurable: true });
        else o[k] = toValue(c);
      }
      return o;
    }
  }
}

/** Short one-line rendering of a primitive. */
export function primText(node: JNode, max = 300): string {
  switch (node.t) {
    case NUL:
      return 'null';
    case BOOL:
      return node.v ? 'true' : 'false';
    case NUM:
      return node.v as string;
    case STR: {
      const s = node.v as string;
      return JSON.stringify(s.length > max ? s.slice(0, max) + '…' : s);
    }
  }
  return '';
}

/** Collapsed preview such as `{id: 1, name: "Ada", …}`. */
export function preview(node: JNode, budget = 90): string {
  const isObj = node.t === OBJ;
  const list = kids(node);
  let s = isObj ? '{' : '[';
  for (let i = 0; i < list.length; i++) {
    if (s.length > budget) {
      s += ', …';
      break;
    }
    const c = list[i];
    const v = c.t === OBJ ? (kids(c).length ? '{…}' : '{}') : c.t === ARR ? (kids(c).length ? '[…]' : '[]') : primText(c, 40);
    s += (i ? ', ' : '') + (isObj ? keyLabel(c.key as string) + ': ' + v : v);
  }
  return s + (isObj ? '}' : ']');
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const keyLabel = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));

/** Rough UTF-8 byte length without allocating. */
export function byteLength(s: string): number {
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      b += 4;
      i++;
    } else b += 3;
  }
  return b;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
