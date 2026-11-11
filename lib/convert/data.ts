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

// (`... ` starting a line ends the document: a top-level key or string can't start so.)
const yPlain = (s: string) =>
  s !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]|^\.\.\.(?:\s|$)/.test(s) && !/\s$|: |\s#|:$|[\t\n]/.test(s) && !Y_RESERVED.test(s) && !Y_BAD.test(s);
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
  // An implicit key ("key: value") is at most 1024 characters: a longer one is an explicit "? key" with ": value" below.
  const key = (k: string, ind: string) => {
    const s = yPlain(k) ? k : yQuote(k);
    return s.length > 1024 ? '? ' + s + '\n' + ind + ':' : s + ':';
  };
  // Non-empty mapping / sequence; `inline`: the first entry continues the current line (after "- ").
  const block = (n: JNode, ind: string, inline: boolean): void => {
    const isObj = n.t === OBJ;
    const list = isObj ? entries(n) : kids(n);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      b.add((i || !inline ? '\n' + ind : '') + (isObj ? key(c.key as string, ind) : '- '));
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

/*
 * Element and attribute names use only characters that both editions of XML 1.0 allow in names: the 5th edition
 * takes almost any character, the 4th only the letters, digits and marks of Unicode 2.0, and Expat (so Python, PHP,
 * Perl…) still reads names by the 4th (`<ſ/>`, `<ー/>`, `<ﬀ/>`, `<µs/>` are not well-formed there). Everything else
 * (and ":", which namespaces reserve) becomes "_". The non-ASCII ranges, as Expat accepts them: base-36 pairs of
 * (gap since the end of the last range or U+0000, length - 1); NameStartChar, then the characters that may only follow.
 */
const XN_START_CP =
  '5c,m,1,u,1,1l,2,a,2,7,1,1g,1,1v,9,z,3,1,4,t,1k,2g,i,6,5g,0,1,2,1,0,1,j,1,17,1,6,3,0,1,0,1,0,1,0,1,h,d,b,1,1t,1,b,1,z,e,1g,2,1,2,1,3,r,2,7,2,1,1j,11,2,0,7,11,21,q,5,2,1a,p,6,9,12,1y,2,4,1,e,1,3,1,0,f,1,f2,1g,3,0,q,9,z,7,2,1,2,l,1,6,1,0,3,3,y,1,1,2,e,1,j,5,4,1,2,l,1,6,1,1,1,1,1,1,v,3,1,0,j,2,g,6,1,0,1,2,1,l,1,6,1,1,1,4,3,0,y,0,10,7,2,1,2,l,1,6,1,1,2,3,3,0,u,1,1,2,z,5,3,2,1,3,3,1,1,0,1,1,3,1,3,2,3,7,1,2,23,7,1,2,1,m,1,9,1,4,12,1,z,7,1,2,1,m,1,9,1,4,10,0,1,1,z,7,1,2,1,m,1,f,12,1,4f,19,1,0,1,1,c,5,1n,1,1,0,2,1,1,0,2,0,6,3,1,6,1,2,1,0,1,0,2,1,1,1,1,0,1,1,9,0,2,4,3f,7,1,w,8m,11,a,12,9,0,1,1,1,2,1,0,1,1,1,4,15,0,1,0,1,0,b,0,1,0,1,0,3,1,3,0,5,2,1,0,1,0,1,0,1,0,3,1,3,1,1,0,14,0,9,0,2,0,2,1,7,1,1,0,1,6,14,0,4,0,8,0,2di,4b,4,2h,6,l,2,5,2,11,2,5,2,7,1,0,1,0,1,0,1,u,2,1g,1,6,1,0,3,2,1,6,3,3,2,5,4,c,5,2,1,6,89,0,3,1,2,0,29,2,2v8,0,p,8,n,2b,c,2h,a,13,5oz,g4l,2fu,8mb';
const XN_MORE_CP =
  '53,0,ew,1,1a,1x,q,1,11,0,6z,3,7e,g,1,m,1,2,1,0,1,1,1,0,3f,0,a,7,d,9,6,0,2t,e,2,1,1,3,2,9,ef,2,1k,0,1,f,3,3,d,1,2,9,h,2,1k,0,1,6,2,1,2,2,9,0,a,1,2,9,i,0,1l,0,1,4,4,1,2,2,o,b,f,2,1k,0,1,7,1,2,1,2,o,9,h,2,1k,0,1,5,3,1,2,2,8,1,e,9,i,1,1m,4,3,2,1,3,9,0,f,8,h,2,1m,6,1,2,1,3,7,1,f,9,i,1,1m,6,1,2,1,3,7,1,f,9,i,1,1m,5,2,2,1,3,9,0,e,9,5d,0,2,6,b,8,1,9,2f,0,2,5,1,1,9,0,1,5,2,9,1q,1,6,9,b,0,1,0,1,0,4,1,1d,j,1,5,4,5,1,0,1,k,3,6,1,0,3di,c,4,0,2zn,0,10,5,1,4,2r,1,2,1,2l,2';
/** A character class body for the ranges of `enc`. */
const xnRanges = (enc: string) => {
  const n = enc.split(',').map((x) => parseInt(x, 36));
  const u = (c: number) => '\\u' + c.toString(16).padStart(4, '0');
  let s = '';
  for (let i = 0, p = 0; i < n.length; i += 2) {
    const a = p + n[i];
    p = a + n[i + 1];
    s += u(a) + (p > a ? '-' + u(p) : '');
    p++;
  }
  return s;
};
/** [characters to replace, a valid first character], made when a name first needs them. */
let XN: [RegExp, RegExp] | null = null;
const xnInit = (): [RegExp, RegExp] => {
  const start = xnRanges(XN_START_CP);
  return [new RegExp(`[^\\w.\\-${start}${xnRanges(XN_MORE_CP)}]`, 'gu'), new RegExp(`^[A-Z_a-z${start}]`, 'u')];
};
const xname = (k: string) => {
  if (/^[A-Za-z_][\w.-]*$/.test(k)) return /^xml/i.test(k) ? '_' + k : k;
  XN ??= xnInit();
  const n = k.replace(XN[0], '_');
  return XN[1].test(n) && !/^xml/i.test(n) ? n : '_' + n;
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
