/**
 * The recursive-descent parser that lib/json/parser.ts replaced, frozen as the
 * oracle for differential tests: the resumable parser must give exactly the same
 * result for every input this one can parse (it only goes deeper). Don't edit,
 * except to keep it compiling, or to make a deliberate change of what the parser
 * reads here too, written the recursive way (e.g. bare words that start like a
 * number, signed NaN, \0 and \v).
 */
import { ARR, BOOL, JNode, NO_VALUE, NUL, NUM, NUMBER_TAIL, OBJ, STR, type Issue, type Key, type Kind, type ParseOptions, type ParseResult, type Val } from '../../lib/json/parser';

class ParseError {
  p: number;
  m: string;
  constructor(p: number, m: string) {
    this.p = p;
    this.m = m;
  }
}

const MAX_ISSUES = 500;

const isDigit = (c: number) => c >= 48 && c <= 57;
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
const isSmartQuote = (c: number) => c === 0x201c || c === 0x201d || c === 0x2018 || c === 0x2019;
const isExoticSpace = (c: number) =>
  c === 0xa0 ||
  c === 0xfeff ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200b) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000;
const isIdentStart = (c: number) =>
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  c === 95 ||
  c === 36 ||
  (c > 127 && !isExoticSpace(c) && !isSmartQuote(c));
const isIdent = (c: number) => isIdentStart(c) || isDigit(c);
const isKeyChar = (c: number) => isIdent(c) || c === 45 || c === 46;
const startsValue = (c: number) =>
  c === 123 ||
  c === 91 ||
  c === 34 ||
  c === 39 ||
  c === 96 ||
  c === 45 ||
  c === 43 ||
  c === 46 ||
  isDigit(c) ||
  isIdentStart(c) ||
  isSmartQuote(c);

const INT_KEY = /^(?:0|[1-9]\d{0,9})$/;

/** Whether `String(Number(raw)) === raw`, decided without converting. */
function isCanonical(raw: string): boolean {
  const len = raw.length - (raw.charCodeAt(0) === 45 ? 1 : 0);
  if (len > 15 || raw === '-0') return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 101 || c === 69) return false;
  }
  const dot = raw.indexOf('.');
  if (dot >= 0 && (raw.charCodeAt(raw.length - 1) === 48 || /^-?0\.000000/.test(raw))) return false;
  return true;
}

/** Normalizes a loosely written number (`+1`, `.5`, `1.`, `007`) to valid JSON. */
function normalizeNumber(raw: string): string {
  let sign = '';
  let r = raw;
  if (r[0] === '+' || r[0] === '-') {
    if (r[0] === '-') sign = '-';
    r = r.slice(1);
  }
  let exp = '';
  const ei = r.search(/[eE]/);
  if (ei >= 0) {
    exp = 'e' + r.slice(ei + 1);
    r = r.slice(0, ei);
  }
  const dot = r.indexOf('.');
  let ip = dot < 0 ? r : r.slice(0, dot);
  const fp = dot < 0 ? '' : r.slice(dot + 1);
  ip = ip.replace(/^0+(?=\d)/, '') || '0';
  return sign + ip + (fp ? '.' + fp : '') + exp;
}

export function parseRecursive(src: string, { lines = false }: ParseOptions = {}): ParseResult {
  const n = src.length;
  let i = 0;
  let nodes = 0;
  let depth = 0;
  let exact = true;
  let multi = false;
  let issues: Issue[] = [];
  let warnings: Issue[] = [];

  const fix = (p: number, m: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ p, m });
  };
  const fail = (p: number, m: string): never => {
    throw new ParseError(p, m);
  };
  const describe = (p: number) => {
    const cp = src.codePointAt(p) ?? 0;
    if (cp < 32 || cp === 127) return `control character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    return `'${String.fromCodePoint(cp)}'`;
  };
  const eol = (p: number) => {
    const j = src.indexOf('\n', p);
    return j < 0 ? n : j;
  };
  const atLineStart = (p: number) => {
    let k = p - 1;
    while (k >= 0 && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k--;
    return k < 0 || src.charCodeAt(k) === 10 || src.charCodeAt(k) === 13;
  };

  const ws = () => {
    for (;;) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) {
        i++;
      } else if (c === 47) {
        const c2 = src.charCodeAt(i + 1);
        if (c2 === 47) {
          fix(i, 'Comments are not allowed in JSON');
          i = eol(i);
        } else if (c2 === 42) {
          fix(i, 'Comments are not allowed in JSON');
          const j = src.indexOf('*/', i + 2);
          i = j < 0 ? n : j + 2;
        } else return;
      } else if (c === 35 && (atLineStart(i) || src.charCodeAt(i - 1) === 32 || src.charCodeAt(i - 1) === 9)) {
        fix(i, 'Comments are not allowed in JSON');
        i = eol(i);
      } else if (c === 11 || c === 12 || (c > 127 && isExoticSpace(c))) {
        fix(i, `Invalid whitespace character U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
        i++;
      } else return;
    }
  };

  const word = (w: string) => {
    if (src.startsWith(w, i) && !isIdent(src.charCodeAt(i + w.length))) {
      i += w.length;
      return true;
    }
    return false;
  };

  const leaf = (t: Kind, v: Val, s: number, d: number, u: JNode | null, key: Key) => {
    const nd = new JNode(t, v, s, d, u, key);
    nd.e = i;
    return nd;
  };

  const esc = (): string => {
    const c = src.charCodeAt(i++);
    switch (c) {
      case 34:
        return '"';
      case 92:
        return '\\';
      case 47:
        return '/';
      case 98:
        return '\b';
      case 102:
        return '\f';
      case 110:
        return '\n';
      case 114:
        return '\r';
      case 116:
        return '\t';
      case 117:
        if (isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1)) && isHex(src.charCodeAt(i + 2)) && isHex(src.charCodeAt(i + 3))) {
          const v = parseInt(src.slice(i, i + 4), 16);
          i += 4;
          return String.fromCharCode(v);
        }
        fix(i - 2, 'Invalid unicode escape: expected \\u followed by 4 hex digits');
        return 'u';
    }
    if (i > n) fail(i - 2, 'Unterminated string: missing closing quote');
    if (c === 120 && isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1))) {
      fix(i - 2, 'Invalid escape \\x: use \\u00XX instead');
      const v = parseInt(src.slice(i, i + 2), 16);
      i += 2;
      return String.fromCharCode(v);
    }
    if (c === 10 || c === 13) {
      fix(i - 2, 'Line continuations are not allowed in JSON strings');
      if (c === 13 && src.charCodeAt(i) === 10) i++;
      return '';
    }
    fix(i - 2, `Invalid escape sequence \\${String.fromCharCode(c)}`);
    if (c === 118) return '\v';
    if (c === 48 && !isDigit(src.charCodeAt(i))) return '\0';
    return String.fromCharCode(c);
  };

  /** Reads a string starting at the opening quote; `q`/`q2` are the accepted closing quotes. */
  const str = (q: number, q2 = q): string => {
    const s = i;
    let seg = ++i;
    let out = '';
    for (;;) {
      if (i >= n) fail(s, 'Unterminated string: missing closing quote');
      const c = src.charCodeAt(i);
      if (c === q || c === q2) {
        out += src.slice(seg, i);
        i++;
        return out;
      }
      if (c === 92) {
        out += src.slice(seg, i);
        i++;
        out += esc();
        seg = i;
        continue;
      }
      if (c < 32) {
        fix(i, c === 10 || c === 13 ? 'Line breaks inside strings must be escaped as \\n' : 'Control characters inside strings must be escaped');
      }
      i++;
    }
  };

  const num = (): string => {
    const s = i;
    let clean = true;
    let c = src.charCodeAt(i);
    if (c === 45 || c === 43) {
      if (c === 43) {
        fix(i, "Numbers can't start with '+'");
        clean = false;
      }
      c = src.charCodeAt(++i);
    }
    if (c === 48) {
      c = src.charCodeAt(++i);
      if (c === 120 || c === 88) {
        const hs = ++i;
        while (isHex(src.charCodeAt(i))) i++;
        if (i === hs) fail(i, 'Invalid hexadecimal number');
        fix(s, 'Hexadecimal numbers are not allowed in JSON');
        return (src.charCodeAt(s) === 45 ? '-' : '') + BigInt('0x' + src.slice(hs, i)).toString();
      }
      if (isDigit(c)) {
        fix(s, "Numbers can't have leading zeros");
        clean = false;
        while (isDigit(src.charCodeAt(i))) i++;
      }
    } else if (c >= 49 && c <= 57) {
      do c = src.charCodeAt(++i);
      while (isDigit(c));
    } else if (c === 46 && isDigit(src.charCodeAt(i + 1))) {
      fix(i, 'Numbers need a digit before the decimal point');
      clean = false;
    } else {
      fail(i, i >= n ? 'Unexpected end of input: expected a number' : `Invalid number: unexpected ${describe(i)}`);
    }
    c = src.charCodeAt(i);
    if (c === 46) {
      c = src.charCodeAt(++i);
      if (isDigit(c)) {
        do c = src.charCodeAt(++i);
        while (isDigit(c));
      } else {
        fix(i - 1, 'Numbers need a digit after the decimal point');
        clean = false;
      }
    }
    if (c === 101 || c === 69) {
      c = src.charCodeAt(++i);
      if (c === 43 || c === 45) c = src.charCodeAt(++i);
      if (!isDigit(c)) fail(i, 'Expected a digit in the exponent');
      do c = src.charCodeAt(++i);
      while (isDigit(c));
    }
    const raw = src.slice(s, i);
    if (exact && !isCanonical(raw)) exact = false;
    return clean ? raw : normalizeNumber(raw);
  };

  /** A bare word from `s`, up to the end of its value. */
  const bare = (s: number, d: number, u: JNode | null, key: Key): JNode => {
    while (i < n) {
      const ch = src.charCodeAt(i);
      if (ch === 44 || ch === 125 || ch === 93 || ch === 10 || ch === 13) break;
      // `value // comment` or `value /* comment */` (but keep URLs such as http://x)
      if (ch === 47) {
        const nx = src.charCodeAt(i + 1);
        const pv = src.charCodeAt(i - 1);
        if ((nx === 47 || nx === 42) && (pv === 32 || pv === 9)) break;
      }
      i++;
    }
    let e = i;
    while (e > s && (src.charCodeAt(e - 1) === 32 || src.charCodeAt(e - 1) === 9)) e--;
    const text = src.slice(s, e);
    fix(s, `Unexpected '${text.length > 24 ? text.slice(0, 24) + '…' : text}': strings must be wrapped in double quotes`);
    const nd = new JNode(STR, text, s, d, u, key);
    nd.e = e;
    return nd;
  };

  /** A number, or the bare word it starts when more follows it right away (`2024-01-15`). */
  const number = (s: number, d: number, u: JNode | null, key: Key): JNode => {
    const before = issues.length;
    const v = num();
    const c = src.charCodeAt(i);
    const more = c < 128 ? NUMBER_TAIL[c] === 1 : isIdentStart(c);
    if (!more) return leaf(NUM, v, s, d, u, key);
    issues = issues.slice(0, before);
    return bare(s, d, u, key);
  };

  const looseKey = (c: number): string => {
    if (c === 39) {
      fix(i, 'Property names must use double quotes');
      return str(39);
    }
    if (c === 0x201c || c === 0x201d) {
      fix(i, 'Property names must use straight double quotes (")');
      return str(0x201d, 0x201c);
    }
    if (c === 0x2018 || c === 0x2019) {
      fix(i, 'Property names must use straight double quotes (")');
      return str(0x2019, 0x2018);
    }
    if (c === 96) {
      fix(i, 'Property names must use double quotes');
      return str(96);
    }
    if (isIdentStart(c) || isDigit(c) || c === 45) {
      const s = i;
      while (i < n && isKeyChar(src.charCodeAt(i))) i++;
      fix(s, 'Property names must be wrapped in double quotes');
      return src.slice(s, i);
    }
    if (i >= n) fail(i, 'Unexpected end of input: expected a property name');
    return fail(i, `Expected a property name in double quotes, found ${describe(i)}`);
  };

  const obj = (d: number, u: JNode | null, key: Key): JNode => {
    const node = new JNode(OBJ, [], i, d, u, key);
    const list = node.v as JNode[];
    let set: Set<string> | null = null;
    i++;
    ws();
    let c = src.charCodeAt(i);
    while (c === 44) {
      fix(i, 'Unexpected comma');
      i++;
      ws();
      c = src.charCodeAt(i);
    }
    if (c === 125) {
      i++;
      node.e = i;
      return node;
    }
    for (;;) {
      const ks = i;
      const k = c === 34 ? str(34) : looseKey(c);
      // Not natively reproducible: integer-like keys (JS reorders them) and keys written with
      // escapes (V8 13.x JSON.parse can misread "\n" as "\" after seeing a key containing "\").
      if (exact && (i - ks !== k.length + 2 || (isDigit(k.charCodeAt(0)) && INT_KEY.test(k)))) exact = false;
      let dup = false;
      if (set) {
        dup = set.has(k);
        set.add(k);
      } else {
        for (let j = 0; j < list.length; j++) {
          if (list[j].key === k) {
            dup = true;
            break;
          }
        }
      }
      if (dup && warnings.length < MAX_ISSUES) warnings.push({ p: ks, m: `Duplicate key "${k.length > 40 ? k.slice(0, 40) + '…' : k}"` });
      ws();
      c = src.charCodeAt(i);
      if (c === 58) i++;
      else if (i >= n) fail(i, "Unexpected end of input: expected ':' after property name");
      else if (c === 61) {
        fix(i, "Expected ':' after property name");
        i++;
      } else if (startsValue(c)) fix(i, "Expected ':' after property name");
      else fail(i, `Expected ':' after property name, found ${describe(i)}`);
      list.push(value(d + 1, node, k));
      if (!set && list.length === 16) set = new Set(list.map((x) => x.key as string));
      ws();
      c = src.charCodeAt(i);
      if (c === 44) {
        const cp = i++;
        ws();
        c = src.charCodeAt(i);
        while (c === 44) {
          fix(i, 'Unexpected extra comma');
          i++;
          ws();
          c = src.charCodeAt(i);
        }
        if (c === 125) {
          fix(cp, 'Trailing commas are not allowed');
          i++;
          break;
        }
        if (i >= n) {
          fix(cp, 'Trailing commas are not allowed');
          fix(n, "Unexpected end of input: missing '}'");
          break;
        }
        if (c === 93) {
          fix(cp, 'Trailing commas are not allowed');
          fix(i, "Expected '}' to close the object, found ']'");
          break;
        }
        continue;
      }
      if (c === 125) {
        i++;
        break;
      }
      if (i >= n) {
        fix(n, "Unexpected end of input: missing '}'");
        break;
      }
      if (c === 93) {
        fix(i, "Expected '}' to close the object, found ']'");
        break;
      }
      if (c === 34 || c === 39 || c === 96 || isIdentStart(c) || isSmartQuote(c)) {
        fix(i, "Expected ',' between properties");
        continue;
      }
      fail(i, `Expected ',' or '}' after property value, found ${describe(i)}`);
    }
    node.e = i;
    return node;
  };

  const arr = (d: number, u: JNode | null, key: Key): JNode => {
    const node = new JNode(ARR, [], i, d, u, key);
    const list = node.v as JNode[];
    i++;
    ws();
    let c = src.charCodeAt(i);
    if (c === 93) {
      i++;
      node.e = i;
      return node;
    }
    for (;;) {
      if (c === 44) {
        fix(i, 'Missing value in array');
        i++;
        ws();
        c = src.charCodeAt(i);
        if (c === 93) {
          i++;
          break;
        }
        continue;
      }
      list.push(value(d + 1, node, list.length));
      ws();
      c = src.charCodeAt(i);
      if (c === 44) {
        const cp = i++;
        ws();
        c = src.charCodeAt(i);
        if (c === 93) {
          fix(cp, 'Trailing commas are not allowed');
          i++;
          break;
        }
        if (i >= n) {
          fix(cp, 'Trailing commas are not allowed');
          fix(n, "Unexpected end of input: missing ']'");
          break;
        }
        if (c === 125) {
          fix(cp, 'Trailing commas are not allowed');
          fix(i, "Expected ']' to close the array, found '}'");
          break;
        }
        continue;
      }
      if (c === 93) {
        i++;
        break;
      }
      if (i >= n) {
        fix(n, "Unexpected end of input: missing ']'");
        break;
      }
      if (c === 125) {
        fix(i, "Expected ']' to close the array, found '}'");
        break;
      }
      if (startsValue(c)) {
        fix(i, "Expected ',' between array items");
        continue;
      }
      fail(i, `Expected ',' or ']' after array item, found ${describe(i)}`);
    }
    node.e = i;
    return node;
  };

  const loose = (d: number, u: JNode | null, key: Key, c: number): JNode => {
    const s = i;
    if (c === 39) {
      fix(i, 'Strings must use double quotes');
      return leaf(STR, str(39), s, d, u, key);
    }
    if (c === 0x201c || c === 0x201d) {
      fix(i, 'Strings must use straight double quotes (")');
      return leaf(STR, str(0x201d, 0x201c), s, d, u, key);
    }
    if (c === 0x2018 || c === 0x2019) {
      fix(i, 'Strings must use straight double quotes (")');
      return leaf(STR, str(0x2019, 0x2018), s, d, u, key);
    }
    if (c === 96) {
      fix(i, 'Strings must use double quotes');
      return leaf(STR, str(96), s, d, u, key);
    }
    if (c === 43 || c === 45 || c === 46) {
      if (c !== 46 && isIdentStart(src.charCodeAt(i + 1))) {
        let e = i + 1;
        while (e < n && isIdent(src.charCodeAt(e))) e++;
        const w = src.slice(i + 1, e);
        if (w !== 'Infinity' && w !== 'NaN') return bare(s, d, u, key);
        fix(s, `${w} is not valid JSON (replaced with null)`);
        i = e;
        return leaf(NUL, null, s, d, u, key);
      }
      return number(s, d, u, key);
    }
    if (isIdentStart(c)) {
      while (i < n && isIdent(src.charCodeAt(i))) i++;
      const w = src.slice(s, i);
      switch (w) {
        case 'True':
        case 'TRUE':
          fix(s, `Use lowercase true instead of ${w}`);
          return leaf(BOOL, true, s, d, u, key);
        case 'False':
        case 'FALSE':
          fix(s, `Use lowercase false instead of ${w}`);
          return leaf(BOOL, false, s, d, u, key);
        case 'None':
        case 'NULL':
        case 'Null':
        case 'nil':
          fix(s, `Use null instead of ${w}`);
          return leaf(NUL, null, s, d, u, key);
        case 'undefined':
        case 'NaN':
        case 'Infinity':
          fix(s, `${w} is not valid JSON (replaced with null)`);
          return leaf(NUL, null, s, d, u, key);
        // Typos of the literals: repair to what was obviously meant.
        case 'tru':
        case 'ture':
        case 'treu':
        case 'rtue':
          fix(s, `Unexpected '${w}'. Did you mean true?`);
          return leaf(BOOL, true, s, d, u, key);
        case 'fals':
        case 'flase':
        case 'fasle':
        case 'fales':
          fix(s, `Unexpected '${w}'. Did you mean false?`);
          return leaf(BOOL, false, s, d, u, key);
        case 'nul':
        case 'nulll':
        case 'nill':
        case 'nll':
          fix(s, `Unexpected '${w}'. Did you mean null?`);
          return leaf(NUL, null, s, d, u, key);
      }
      const save = i;
      while (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9) i++;
      if (src.charCodeAt(i) === 40) {
        // JSONP callback(…) or wrappers such as ObjectId("…") / ISODate("…")
        fix(s, `${w}(…) is not valid JSON (only its argument is kept)`);
        i++;
        ws();
        let inner: JNode;
        if (src.charCodeAt(i) === 41) {
          i++;
          inner = leaf(NUL, null, s, d, u, key);
        } else {
          inner = value(d, u, key);
          nodes--;
          ws();
          if (src.charCodeAt(i) === 41) i++;
          else fix(i, "Expected ')'");
        }
        inner.s = s;
        inner.e = i;
        return inner;
      }
      i = save;
      return bare(s, d, u, key);
    }
    if (i >= n) fail(i, 'Unexpected end of input: expected a value');
    return fail(i, `Unexpected ${describe(i)}: expected a value`);
  };

  const value = (d: number, u: JNode | null, key: Key): JNode => {
    ws();
    const s = i;
    const c = src.charCodeAt(i);
    nodes++;
    if (d > depth) depth = d;
    if (c === 34) return leaf(STR, str(34), s, d, u, key);
    if (c === 123) return obj(d, u, key);
    if (c === 91) return arr(d, u, key);
    if (isDigit(c) || (c === 45 && isDigit(src.charCodeAt(i + 1)))) return number(s, d, u, key);
    if (c === 116 && word('true')) return leaf(BOOL, true, s, d, u, key);
    if (c === 102 && word('false')) return leaf(BOOL, false, s, d, u, key);
    if (c === 110 && word('null')) return leaf(NUL, null, s, d, u, key);
    return loose(d, u, key, c);
  };

  let root: JNode | null = null;
  let error: Issue | null = null;
  try {
    if (src.charCodeAt(0) === 0xfeff) {
      fix(0, 'Unexpected byte order mark (BOM)');
      i = 1;
    }
    ws();
    let fence = false;
    if (src.startsWith('```', i)) {
      fix(i, 'Markdown code fences are not part of JSON');
      i = eol(i);
      fence = true;
      ws();
    }
    if (i < n) {
      const before = issues.length;
      const start = i;
      root = value(0, null, undefined);
      const skipTail = () => {
        for (;;) {
          ws();
          const c = src.charCodeAt(i);
          if (c === 59 || c === 44) {
            fix(i, `Unexpected ${describe(i)}`);
            i++;
          } else if (fence && src.startsWith('```', i)) {
            // closing fence: whatever follows (usually prose) is not part of the document
            i += 3;
            ws();
            if (i < n) fix(i, 'Text after the closing code fence was ignored');
            i = n;
          } else return;
        }
      };
      skipTail();
      if ((i < n && startsValue(src.charCodeAt(i))) || lines) {
        // Several top-level values (NDJSON / JSON Lines): re-parse them into one array.
        multi = true;
        issues = issues.slice(0, before);
        warnings = [];
        nodes = 1;
        depth = 0;
        i = start;
        const wrap = new JNode(ARR, [], start, 0, null, undefined);
        const list = wrap.v as JNode[];
        for (;;) {
          ws();
          while (src.charCodeAt(i) === 44 || src.charCodeAt(i) === 59) {
            i++;
            ws();
          }
          if (i >= n || (fence && src.startsWith('```', i))) break;
          if (list.length === 1) fix(i, 'Multiple top-level values (wrapped in an array)');
          list.push(value(1, wrap, list.length));
        }
        wrap.e = i;
        root = wrap;
        skipTail();
      } else if (i < n) {
        let c = src.charCodeAt(i);
        while (c === 125 || c === 93) {
          fix(i, `Unexpected ${describe(i)} after the JSON value`);
          i++;
          ws();
          c = src.charCodeAt(i);
        }
        if (i < n) fail(i, `Unexpected ${describe(i)} after the JSON value`);
      }
    }
  } catch (e) {
    if (e instanceof ParseError) error = { p: e.p, m: e.m };
    else if (e instanceof RangeError || (e as Error)?.name === 'InternalError') error = { p: i, m: 'Nesting is too deep to parse' };
    else throw e;
    root = null;
  }
  if (!error && !root) error = { p: n, m: NO_VALUE };
  issues.sort((a, b) => a.p - b.p);
  // A wrapped document is not the source text, so the native formatting fast path can't apply.
  exact = exact && !!root && !issues.length && !warnings.length && !multi;
  return { root, issues, warnings, error, nodes, depth, exact, multi: multi && !!root };
}
