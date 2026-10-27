/**
 * Differential testing of the resumable parser against the recursive oracle:
 * a field-by-field comparison of two results, and a generator of loose,
 * broken and deep documents that reaches every repair and error path.
 */
import { ARR, type JNode, type ParseResult } from '../../lib/json/parser';

const show = (v: unknown) => JSON.stringify(v)?.slice(0, 120);

/** The first difference between two results (every field, every node, parent links included), or null. */
export function diffResults(a: ParseResult, b: ParseResult): string | null {
  for (const k of ['nodes', 'depth', 'exact', 'multi'] as const) if (a[k] !== b[k]) return `${k}: ${a[k]} vs ${b[k]}`;
  for (const k of ['issues', 'warnings'] as const) {
    if (a[k].length !== b[k].length) return `${k}.length: ${a[k].length} vs ${b[k].length}`;
    for (let i = 0; i < a[k].length; i++) {
      if (a[k][i].p !== b[k][i].p || a[k][i].m !== b[k][i].m) return `${k}[${i}]: ${show(a[k][i])} vs ${show(b[k][i])}`;
    }
  }
  if (show(a.error) !== show(b.error)) return `error: ${show(a.error)} vs ${show(b.error)}`;
  if (!a.root || !b.root) return a.root === b.root ? null : `root: ${!!a.root} vs ${!!b.root}`;
  if (a.root.u !== null || b.root.u !== null) return 'root has a parent';
  // Walk both trees together (iteratively: they may be deeper than the stack).
  const as: JNode[] = [a.root];
  const bs: JNode[] = [b.root];
  while (as.length) {
    const x = as.pop()!;
    const y = bs.pop()!;
    if (x.t !== y.t || x.s !== y.s || x.e !== y.e || x.d !== y.d || x.key !== y.key || x.x !== y.x) {
      return `node at ${x.s}: ${show([x.t, x.s, x.e, x.d, x.key, x.x])} vs ${show([y.t, y.s, y.e, y.d, y.key, y.x])}`;
    }
    if (Object.keys(x).length !== Object.keys(y).length) return `node at ${x.s}: fields ${Object.keys(x)} vs ${Object.keys(y)}`;
    if (x.t < ARR) {
      if (x.v !== y.v) return `value at ${x.s}: ${show(x.v)} vs ${show(y.v)}`;
      continue;
    }
    const xs = x.v as JNode[];
    const ys = y.v as JNode[];
    if (xs.length !== ys.length) return `children at ${x.s}: ${xs.length} vs ${ys.length}`;
    for (let i = xs.length - 1; i >= 0; i--) {
      if (xs[i].u !== x || ys[i].u !== y) return `parent of child ${i} at ${x.s}`;
      as.push(xs[i]);
      bs.push(ys[i]);
    }
  }
  return null;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
export type Rng = ReturnType<typeof rng>;

const SPACE = [' ', '  ', '\n', '\r\n', '\t', '\n    '];
const ODD_SPACE = ['\u00a0', '\ufeff', '\u2028', '\u2029', '\u3000', '\u000b', '\u000c', '\u1680', '\u2003', '\u200b', '\u202f', '\u205f'];
const COMMENT = ['// note\n', '/* c */', '/* multi\nline */', '# hash\n', ' # after space\n', '//\n', '/**/'];
const NUMS = ['0', '-0', '1', '-12', '3.5', '1e5', '1E-7', '-2.5e+10', '9007199254740993', '123456789012345678901234567890', '0.1', '1.0', '100', '5e-324', '1e400', '0.0000001'];
const LOOSE_NUMS = ['+1', '.5', '-.5', '1.', '007', '-007', '0x1F', '-0xff', '0XaB', '+.5', '00', '1.e5', '+0'];
const BAD_NUMS = ['0x', '1e', '1e+', '-', '+', '-x', '+a', '.', '-.'];
const WORDS = ['True', 'TRUE', 'False', 'FALSE', 'None', 'NULL', 'Null', 'nil', 'undefined', 'NaN', 'Infinity', '-Infinity', '+Infinity',
  'tru', 'ture', 'treu', 'rtue', 'fals', 'flase', 'fasle', 'fales', 'nul', 'nulll', 'nill', 'nll',
  'hello', 'hello world', 'http://x.y/z', 'a // c', 'b /* c */', 'é', '$x', '_y', 'x-y'];
const STR_BODY = ['', 'a', 'hello', 'é', '中文', '😀', '\\"', '\\\\', '\\/', '\\b\\f\\n\\r\\t', '\\u0041', '\\uD83D\\uDE00', '\\ud800', 'tab\there'];
const BAD_STR_BODY = ['\\x41', '\\q', '\\u12', '\\u12G4', 'line\nbreak', 'ctl\u0001', 'cr\rx', 'cont\\\nx', 'cont\\\r\nx', '\\', '\\x4'];
const KEY_POOL = ['a', 'b', 'id', 'name', '', 'x y', '__proto__', '1', '02', 'a.b', 'k\\n', 'dup'];

/**
 * A random document in loose JSON: every construct the parser repairs, plus some it can't,
 * occasionally deep or wide (dense duplicate keys and more than 16 properties, which switch
 * duplicate detection to a Set).
 */
export function genLoose(r: Rng, maxDepth = 6): string {
  const ws = (): string => {
    if (r.chance(0.6)) return '';
    const k = r.int(10);
    if (k < 6) return r.pick(SPACE);
    if (k < 8) return r.pick(COMMENT);
    return r.pick(ODD_SPACE);
  };
  const str = (): string => {
    const k = r.int(30);
    const body = k < 3 ? r.pick(BAD_STR_BODY) : r.pick(STR_BODY) + (r.chance(0.2) ? r.pick(STR_BODY) : '');
    if (k === 3) return '"' + body; // unterminated
    if (k === 4) return "'" + body.replace(/'/g, '') + "'";
    if (k === 5) return '`' + body.replace(/`/g, '') + '`';
    if (k === 6) return '\u201c' + body + '\u201d';
    if (k === 7) return '\u2018' + body + '\u2019';
    if (k === 8) return '\u201d' + body + '\u201c';
    return '"' + body + '"';
  };
  const key = (): string => {
    const k = r.int(20);
    const name = r.pick(KEY_POOL);
    if (k < 9) return JSON.stringify(name).replace('\\\\n', '\\n');
    if (k < 10) return "'" + name + "'";
    if (k < 11) return '`' + name + '`';
    if (k < 12) return '\u201c' + name + '\u201d';
    if (k < 13) return '\u2018' + name + '\u2019';
    if (k < 15) return r.pick(['abc', 'x_y', '$k', 'a-b', 'a.b.c', '1.5', '-1', 'é', '12']);
    if (k < 16) return str();
    if (k < 17) return r.pick(['', '}', ']', ':', '@', '\u0001', '#']); // nothing or not a key
    return '"' + name + r.int(30) + '"';
  };
  const colon = () => {
    const k = r.int(30);
    if (k < 26) return ':';
    if (k < 27) return '=';
    if (k < 28) return ''; // missing (fine if a value follows)
    if (k < 29) return '@';
    return ':' + ws();
  };
  const sep = (close: string) => {
    const k = r.int(40);
    if (k < 32) return ',';
    if (k < 34) return ',,';
    if (k < 35) return ', ,';
    if (k < 37) return ''; // missing comma
    if (k < 38) return close === '}' ? ']' : '}';
    if (k < 39) return ';';
    return '\n';
  };
  const value = (d: number): string => {
    const k = d >= maxDepth ? r.int(12) : r.int(18);
    if (k < 2) return r.pick(['null', 'true', 'false']);
    if (k < 4) return r.chance(0.8) ? r.pick(NUMS) : r.chance(0.8) ? r.pick(LOOSE_NUMS) : r.pick(BAD_NUMS);
    if (k < 7) return str();
    if (k < 9) return r.pick(WORDS);
    if (k < 10) {
      // JSONP / wrappers: name(…), possibly nested, empty or unclosed
      const name = r.pick(['cb', 'ObjectId', 'ISODate', 'jQuery123', 'f', 'NumberLong']);
      const inner = r.chance(0.15) ? '' : value(d);
      return name + (r.chance(0.2) ? ' ' : '') + '(' + ws() + inner + ws() + (r.chance(0.85) ? ')' : '');
    }
    if (k < 11) return r.pick(['', '@', '}', ']', ')', ':', '\u0002', '#', '*', '<', '\u201c']); // not a value
    if (k < 12) return '-' + r.pick(['Infinity', 'x', '']);
    if (k < 15) {
      const n = r.chance(0.08) ? 17 + r.int(20) : r.int(5);
      let s = '[' + ws();
      if (r.chance(0.08)) s += ',' + ws();
      for (let j = 0; j < n; j++) {
        if (j) s += ws() + sep(']') + ws();
        s += r.chance(0.04) ? '' : value(d + 1);
      }
      if (r.chance(0.1)) s += ',' + ws();
      const end = r.int(20);
      return s + ws() + (end < 16 ? ']' : end < 17 ? '}' : end < 18 ? ')' : '');
    }
    const n = r.chance(0.1) ? 15 + r.int(25) : r.int(5);
    let s = '{' + ws();
    if (r.chance(0.08)) s += r.pick([',', ',,', ', ,']) + ws();
    for (let j = 0; j < n; j++) {
      if (j) s += ws() + sep('}') + ws();
      s += key() + ws() + colon() + ws() + value(d + 1);
    }
    if (r.chance(0.1)) s += r.pick([',', ',,']) + ws();
    const end = r.int(20);
    return s + ws() + (end < 16 ? '}' : end < 17 ? ']' : end < 18 ? ')' : '');
  };
  let doc = '';
  if (r.chance(0.05)) doc += '\ufeff';
  doc += ws();
  const fence = r.chance(0.06);
  if (fence) doc += r.pick(['```json\n', '```\n', '``` js\n']) + ws();
  const count = r.chance(0.12) ? 2 + r.int(4) : 1;
  for (let j = 0; j < count; j++) {
    if (j) doc += r.pick(['\n', '\r\n', ',', ';', ' ', '\n,\n', ';\n']) + ws();
    doc += value(0);
  }
  if (r.chance(0.08)) doc += r.pick([';', ',', ' ;', ';;', '}', ']', ' }]', ' x', ' 1', ' "a"', ' {', ' @']);
  if (fence && r.chance(0.8)) doc += ws() + '```' + r.pick(['', '\n', '\nSome prose.', '  trailing']);
  return doc + ws();
}

const ALPHABET = ['{', '}', '[', ']', ',', ':', '"', "'", '`', '\\', '/', '*', '#', ';', '(', ')', ' ', '\n', '\r', '\t', '=',
  '0', '1', '-', '+', '.', 'e', 'x', 'a', 't', 'f', 'n', 'u', 'l', 'N', 'I', 'T', '_', '$', '\u00e9', '\u0000', '\u0001', '\u000b',
  '\u00a0', '\ufeff', '\u2028', '\u3000', '\u201c', '\u201d', '\u2018', '\u2019', '\ud800', '\ud83d\ude00',
  'true', 'null', '//', '/*', '*/', '```', 'NaN', 'None', '0x1F', 'f(', '\\u', '\\x4', '1e', '-.', '\r\n'];

/** Breaks a document with a few random edits (deletions, insertions, truncation, duplication). */
export function mutate(r: Rng, s: string): string {
  for (let ops = 1 + r.int(3); ops > 0; ops--) {
    const p = r.int(s.length + 1);
    switch (r.int(7)) {
      case 0:
        s = s.slice(0, p) + s.slice(p + 1);
        break;
      case 1:
      case 2:
        s = s.slice(0, p) + r.pick(ALPHABET) + s.slice(p);
        break;
      case 3:
        s = s.slice(0, p) + r.pick(ALPHABET) + s.slice(p + 1);
        break;
      case 4:
        s = s.slice(0, p);
        break;
      case 5:
        s = s.slice(0, p) + s.slice(p, p + r.int(8)) + s.slice(p);
        break;
      default:
        s = s.slice(0, p) + s.slice(p + 1 + r.int(6));
    }
  }
  return s;
}

/** Nested containers `levels` deep in a few shapes (objects, arrays, mixed, calls), optionally left open. */
export function genDeep(r: Rng, levels: number): string {
  const shape = r.int(5);
  let open = '';
  let close = '';
  for (let k = 0; k < levels; k++) {
    const kind = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? r.int(2) : shape === 3 ? r.int(3) : k & 1;
    if (kind === 0) {
      open += '[';
      close = ']' + close;
    } else if (kind === 1) {
      open += '{"k":';
      close = '}' + close;
    } else {
      open += 'f(';
      close = ')' + close;
    }
  }
  const mid = r.pick(['1', '"x"', '[]', '{}', 'null', '']);
  const end = r.int(6);
  if (end === 0) return open + mid; // unclosed
  if (end === 1) return open + mid + close.slice(0, r.int(close.length)); // partly closed
  return open + mid + close;
}

/** Every message the parsers can report, as patterns: a corpus must produce each of them. */
export const MESSAGES: RegExp[] = [
  /^Comments are not allowed in JSON$/,
  /^Invalid whitespace character U\+[0-9A-F]{4}$/,
  /^Invalid unicode escape: expected \\u followed by 4 hex digits$/,
  /^Invalid escape \\x: use \\u00XX instead$/,
  /^Line continuations are not allowed in JSON strings$/,
  /^Invalid escape sequence \\.$/s,
  /^Line breaks inside strings must be escaped as \\n$/,
  /^Control characters inside strings must be escaped$/,
  /^Numbers can't start with '\+'$/,
  /^Hexadecimal numbers are not allowed in JSON$/,
  /^Numbers can't have leading zeros$/,
  /^Numbers need a digit before the decimal point$/,
  /^Numbers need a digit after the decimal point$/,
  /^Property names must use double quotes$/,
  /^Property names must use straight double quotes \("\)$/,
  /^Property names must be wrapped in double quotes$/,
  /^Unexpected comma$/,
  /^Duplicate key ".*"$/s,
  /^Expected ':' after property name$/,
  /^Unexpected extra comma$/,
  /^Trailing commas are not allowed$/,
  /^Unexpected end of input: missing '}'$/,
  /^Expected '}' to close the object, found ']'$/,
  /^Expected ',' between properties$/,
  /^Missing value in array$/,
  /^Unexpected end of input: missing ']'$/,
  /^Expected ']' to close the array, found '}'$/,
  /^Expected ',' between array items$/,
  /^Strings must use double quotes$/,
  /^Strings must use straight double quotes \("\)$/,
  /^Infinity is not valid JSON \(replaced with null\)$/,
  /^Use lowercase (true|false) instead of \w+$/,
  /^Use null instead of \w+$/,
  /^(undefined|NaN) is not valid JSON \(replaced with null\)$/,
  /^Unexpected '\w+'\. Did you mean (true|false|null)\?$/,
  /^.+\(…\) is not valid JSON \(only its argument is kept\)$/s,
  /^Expected '\)'$/,
  /^Unexpected '.*': strings must be wrapped in double quotes$/s,
  /^Unexpected byte order mark \(BOM\)$/,
  /^Markdown code fences are not part of JSON$/,
  /^Unexpected (';'|',')$/,
  /^Text after the closing code fence was ignored$/,
  /^Multiple top-level values \(wrapped in an array\)$/,
  /^Unexpected ('}'|']') after the JSON value$/,
  /^Unterminated string: missing closing quote$/,
  /^Invalid hexadecimal number$/,
  /^Unexpected end of input: expected a number$/,
  /^Invalid number: unexpected .+$/s,
  /^Expected a digit in the exponent$/,
  /^Unexpected end of input: expected a property name$/,
  /^Expected a property name in double quotes, found .+$/s,
  /^Unexpected end of input: expected ':' after property name$/,
  /^Expected ':' after property name, found .+$/s,
  /^Expected ',' or '}' after property value, found .+$/s,
  /^Expected ',' or ']' after array item, found .+$/s,
  /^Unexpected end of input: expected a value$/,
  /^Unexpected .+: expected a value$/s,
  /^Unexpected .+ after the JSON value$/s,
  /^No JSON value$/,
];
