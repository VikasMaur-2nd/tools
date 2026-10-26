/** Data-format emitters: YAML, XML, TOML, JSON Lines. Values are written from the raw tree (exact numbers). */
import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { stringify } from '../json/format';

/** Object members with duplicate keys removed (last value wins, first position kept). */
function entries(n: JNode): JNode[] {
  const l = kids(n);
  if (l.length < 2) return l;
  const at = new Map<string, number>();
  const r: JNode[] = [];
  for (const c of l) {
    const i = at.get(c.key as string);
    if (i === undefined) {
      at.set(c.key as string, r.length);
      r.push(c);
    } else r[i] = c;
  }
  return r;
}

/** String builder: joins pieces in batches (much less GC work than one huge rope). */
function sb() {
  const chunks: string[] = [];
  let parts: string[] = [];
  return {
    add(s: string) {
      if (parts.push(s) > 4096) {
        chunks.push(parts.join(''));
        parts = [];
      }
    },
    done: () => chunks.join('') + parts.join(''),
  };
}

const hex4 = (c: string) => c.charCodeAt(0).toString(16).padStart(4, '0');
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/* ---------- YAML ---------- */

// Plain scalars that a YAML 1.1 or 1.2 parser would read as something other than a string.
const Y_RESERVED = /^(?:[-+]?(?:[\d_.,:]+(?:e[-+]?\d+)?|0[xob]\w+|\.(?:inf|nan))|~|null|true|false|y|yes|n|no|on|off|=|<<|\d{4}-\d\d?-\d\d?(?:[t ].*)?)$/i;
// Characters that must be escaped (non-printable, BOM, line separators, lone surrogates).
const Y_BAD = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\ufeff\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
const Y_ESC: Record<string, string> = { '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' };

const yPlain = (s: string) =>
  s !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/\s$|: |\s#|:$|[\t\n]/.test(s) && !Y_RESERVED.test(s) && !Y_BAD.test(s);
const yQuote = (s: string) =>
  '"' +
  s.replace(/[\ud800-\udbff][\udc00-\udfff]|[\\"\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff\ufffe\uffff\ud800-\udfff]/g, (c) =>
    c.length > 1 ? c : Y_ESC[c] || '\\u' + hex4(c),
  ) +
  '"';
// YAML 1.1 parsers need a '.' and a signed exponent to read 1e5 as a float.
const yNum = (r: string) => {
  const m = /^(-?\d+)(\.\d+)?[eE]([-+]?)(\d+)$/.exec(r);
  return m ? `${m[1]}${m[2] || '.0'}e${m[3] || '+'}${m[4]}` : r;
};

/** Literal block scalar for multi-line strings, or null when it can't represent `s`. */
function yBlock(s: string, ind: string): string | null {
  if (!s.includes('\n') || !/^\S/.test(s) || s.includes('\r') || Y_BAD.test(s)) return null;
  const nl = /\n*$/.exec(s)![0].length;
  const lines = (nl ? s.slice(0, -1) : s).split('\n');
  return '|' + (nl === 0 ? '-' : nl === 1 ? '' : '+') + lines.map((l) => '\n' + (l ? ind + l : '')).join('');
}

export function toYAML(root: JNode): string {
  const b = sb();
  const scalar = (n: JNode, ind: string): string => {
    switch (n.t) {
      case NUL:
        return 'null';
      case BOOL:
        return n.v ? 'true' : 'false';
      case NUM:
        return yNum(n.v as string);
      case STR: {
        const s = n.v as string;
        return yPlain(s) ? s : yBlock(s, ind) ?? yQuote(s);
      }
    }
    return kids(n).length ? '' : n.t === OBJ ? '{}' : '[]';
  };
  const key = (k: string) => (yPlain(k) ? k : yQuote(k));
  // Non-empty mapping / sequence; `inline`: the first entry continues the current line (after "- ").
  const block = (n: JNode, ind: string, inline: boolean): void => {
    const isObj = n.t === OBJ;
    const list = isObj ? entries(n) : kids(n);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      b.add((i || !inline ? '\n' + ind : '') + (isObj ? key(c.key as string) + ':' : '- '));
      const s = scalar(c, ind + '  ');
      if (s) b.add(isObj ? ' ' + s : s);
      else block(c, ind + '  ', !isObj);
    }
  };
  const s = scalar(root, '  ');
  if (s) b.add(s);
  else block(root, '', true);
  return b.done() + '\n';
}

/* ---------- XML ---------- */

const XN_BAD = new RegExp('[^\\p{L}\\p{Nd}._-]', 'gu');
const XN_START = new RegExp('^[\\p{L}_]', 'u');
const xname = (k: string) => {
  const n = k.replace(XN_BAD, '_');
  return XN_START.test(n) && !/^xml/i.test(n) ? n : '_' + n;
};
const X_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\r': '&#13;', '\n': '&#10;', '\t': '&#9;' };
// Characters XML 1.0 can't contain at all are replaced with U+FFFD.
const XT = /[\ud800-\udbff][\udc00-\udfff]|[&<>\r\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\ud800-\udfff]/g;
const XA = /[\ud800-\udbff][\udc00-\udfff]|[&<>"\r\n\t\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\ud800-\udfff]/g;
const xesc = (s: string, re: RegExp) => s.replace(re, (c) => (c.length > 1 ? c : X_ESC[c] || '\ufffd'));

/**
 * Objects become elements, arrays repeat their element, `@key` primitives
 * become attributes and a lone `#text` primitive becomes text content.
 */
export function toXML(root: JNode, rootName: string): string {
  const b = sb();
  const add = b.add;
  add('<?xml version="1.0" encoding="UTF-8"?>');
  const text = (n: JNode) => (n.t === STR ? xesc(n.v as string, XT) : String(n.v));
  const el = (name: string, n: JNode, ind: string): void => {
    if (n.t === ARR) {
      const l = kids(n);
      if (!l.length) add(`\n${ind}<${name}/>`);
      for (const c of l) {
        if (c.t !== ARR) el(name, c, ind);
        else {
          add(`\n${ind}<${name}>`);
          el('item', c, ind + '  ');
          add(`\n${ind}</${name}>`);
        }
      }
      return;
    }
    if (n.t !== OBJ) {
      add(n.t === NUL ? `\n${ind}<${name}/>` : `\n${ind}<${name}>${text(n)}</${name}>`);
      return;
    }
    let attrs = '';
    const seen = new Set<string>();
    const ch: JNode[] = [];
    for (const c of kids(n)) {
      const k = c.key as string;
      const a = k.length > 1 && k[0] === '@' && c.t > NUL && c.t < ARR ? xname(k.slice(1)) : '';
      if (a && !seen.has(a)) {
        seen.add(a);
        attrs += ` ${a}="${xesc(String(c.v), XA)}"`;
      } else ch.push(c);
    }
    if (!ch.length) add(`\n${ind}<${name}${attrs}/>`);
    else if (ch.length === 1 && ch[0].key === '#text' && ch[0].t > NUL && ch[0].t < ARR) add(`\n${ind}<${name}${attrs}>${text(ch[0])}</${name}>`);
    else {
      add(`\n${ind}<${name}${attrs}>`);
      for (const c of ch) el(xname(c.key as string), c, ind + '  ');
      add(`\n${ind}</${name}>`);
    }
  };
  const rn = xname(lower1(rootName));
  if (root.t !== ARR) el(rn, root, '');
  else if (!kids(root).length) add(`\n<${rn}/>`);
  else {
    add(`\n<${rn}>`);
    el('item', root, '  ');
    add(`\n</${rn}>`);
  }
  return b.done() + '\n';
}

/* ---------- TOML ---------- */

const T_ESC: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };
const tEsc = (s: string, re: RegExp) => s.replace(re, (c) => T_ESC[c] || '\\u' + hex4(c));
const tStr = (s: string) => '"' + tEsc(s, /[\\"\x00-\x1f\x7f]/g) + '"';
const tMulti = (s: string) => '"""\n' + tEsc(s, /[\\"\x00-\x08\x0b-\x1f\x7f]/g) + '"""';
const tKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tStr(k));
const MAX64 = '9223372036854775807';
const isAoT = (n: JNode) => n.t === ARR && kids(n).length > 0 && kids(n).every((c) => c.t === OBJ);

export function toTOML(root: JNode, rootName: string): string {
  const L: string[] = [];
  let dropped = false;
  let big = false;
  const num = (r: string) => {
    const d = r.replace('-', '');
    if (/[.eE]/.test(r) || d.length < 19 || (d.length === 19 && d <= (r[0] === '-' ? '9223372036854775808' : MAX64))) return r;
    big = true;
    return '"' + r + '"';
  };
  const inl = (n: JNode): string | null => {
    switch (n.t) {
      case NUL:
        dropped = true;
        return null;
      case BOOL:
        return n.v ? 'true' : 'false';
      case NUM:
        return num(n.v as string);
      case STR:
        return tStr(n.v as string);
    }
    const isObj = n.t === OBJ;
    const ps: string[] = [];
    for (const c of isObj ? entries(n) : kids(n)) {
      const v = inl(c);
      if (v !== null) ps.push(isObj ? tKey(c.key as string) + ' = ' + v : v);
    }
    return isObj ? (ps.length ? '{ ' + ps.join(', ') + ' }' : '{}') : '[' + ps.join(', ') + ']';
  };
  const items = (n: JNode) => kids(n).map(inl).filter((x): x is string => x !== null);
  const kv = (k: string, c: JNode) => {
    if (c.t === NUL) {
      L.push(`# ${k} = null (omitted: TOML has no null)`);
      return;
    }
    dropped = big = false;
    let v = c.t === STR && (c.v as string).includes('\n') ? tMulti(c.v as string) : inl(c)!;
    if (c.t === ARR && v.length > 80 && kids(c).length > 1) v = '[\n' + items(c).map((x) => '  ' + x + ',').join('\n') + '\n]';
    const notes = [dropped && 'null values omitted (TOML has no null)', big && 'beyond the 64-bit integer range, written as a string'].filter(Boolean);
    L.push(`${k} = ${v}${notes.length ? '  # ' + notes.join('; ') : ''}`);
  };
  const table = (n: JNode, path: string, header: string) => {
    const ch = entries(n);
    const simple = ch.filter((c) => !(c.t === OBJ && kids(c).length) && !isAoT(c));
    if (header && simple.length) L.push('', header);
    for (const c of simple) kv(tKey(c.key as string), c);
    for (const c of ch) {
      const p = (path ? path + '.' : '') + tKey(c.key as string);
      if (c.t === OBJ && kids(c).length) table(c, p, `[${p}]`);
      else if (isAoT(c))
        for (const e of kids(c)) {
          L.push('', `[[${p}]]`);
          table(e, p, '');
        }
    }
  };
  if (root.t === OBJ) table(root, '', '');
  else {
    const k = tKey(lower1(rootName));
    L.push(`# A TOML document must be a table: the top-level ${root.t === ARR ? 'array' : 'value'} is stored under "${k}".`);
    if (isAoT(root))
      for (const e of kids(root)) {
        L.push('', `[[${k}]]`);
        table(e, k, '');
      }
    else kv(k, root);
  }
  const s = L.join('\n').replace(/^\n+/, '');
  return s ? s + '\n' : '';
}

/* ---------- JSON Lines (NDJSON) ---------- */

/**
 * One compact JSON value per line: each element of a top-level array, or the
 * whole document when it isn't an array. Numbers keep their source digits.
 */
export function toJSONL(root: JNode): string {
  const vals = root.t === ARR ? (root.v as JNode[]) : [root];
  return vals.map((n) => stringify(n, '') + '\n').join('');
}
