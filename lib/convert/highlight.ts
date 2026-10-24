/**
 * Tiny syntax highlighter for converter output. Emits HTML using the app's
 * token classes; no span ever crosses a line break, so the result can be split
 * into lines, and stripping the tags gives back the exact input.
 */

/** Marks `src[a, b)` with a token class; calls must be ordered and non-overlapping. */
export type Emit = (a: number, b: number, cls: string) => void;

const ESC_RE = /[&<>"]/g;
const E: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => (/[&<>"]/.test(s) ? s.replace(ESC_RE, (c) => E[c]) : s);
const set = (s = '') => new Set(s.split(' '));

/**
 * Per language: flags, keywords, lower-case type names. Flags: c = // and
 * block comments, h = # comments, s = '...' strings, b = `...` strings,
 * t = triple quotes, $ = $ in identifiers, k = `name:` is a key,
 * = = `name =` is a key, K = Capitalized names are types even before ':',
 * g = first word of an indented line is a field (Go), p = `Name {` is a
 * property (C#), H = [table] headers, - = dashes in identifiers (TOML).
 */
const LANGS: Record<string, [string, string, string?]> = {
  typescript: ['csb$k', 'export import from interface type const let var function return as readonly extends typeof keyof new class enum declare', 'string number boolean unknown any never void object bigint'],
  json: ['k', ''],
  go: ['cbg', 'package import type struct map interface func var const return chan', 'string int int64 float64 bool any byte rune error'],
  python: ['hstk', 'from import class def return pass as and or not is in if else lambda', 'str int float bool list dict'],
  rust: ['ck', 'pub struct enum use impl fn let mut as crate self super mod where type trait', 'i64 u64 i128 f64 bool str usize'],
  java: ['ct', 'public private protected static final class record interface enum import package extends implements new return void abstract', 'long double boolean int'],
  csharp: ['cp', 'public private protected internal static class record struct using namespace get set init required new return', 'string long double bool int object decimal'],
  kotlin: ['ctk', 'import package class data val var fun object enum typealias'],
  swift: ['ctkK', 'import struct class enum case let var func init throws try switch if else return protocol extension typealias self'],
  dart: ['cst$k', 'class final const factory required this return if typedef import', 'int double num bool dynamic void'],
  php: ['chs$k', 'php declare final class public private protected readonly function static return new fn isset', 'int float string bool array mixed self'],
  toml: ['hst=H-', ''],
};
// Plain JavaScript (error-guide examples) reads well with the TypeScript rules.
LANGS.javascript = LANGS.typescript;
const TL = set('true false True False');
const TZ = set('null nil None undefined');
const isDigit = (c: number) => c >= 48 && c <= 57;
const isCap = (c: number) => c >= 65 && c <= 90;

/** Where the scanned text next has what can open a token that goes on past its line, from an offset on (-1: nowhere; see codeRows). */
type Find = (i: number) => number;

/** A language's flags and word lists, made once (see LANGS). */
interface Lang {
  lc: string;
  bc: boolean;
  sq: boolean;
  bt: boolean;
  tq: boolean;
  dollar: boolean;
  colon: boolean;
  eq: boolean;
  capT: boolean;
  goF: boolean;
  csP: boolean;
  hdr: boolean;
  dash: boolean;
  kw: Set<string>;
  ty: Set<string>;
  /** What can open a token that goes on past its line (see Find). */
  multi: RegExp | null;
}

const langs = new Map<string, Lang>();
function langOf(name: string): Lang | undefined {
  let l = langs.get(name);
  if (!l && LANGS[name]) {
    const [f, kws, tys] = LANGS[name];
    const fl = (c: string) => f.includes(c);
    const [bc, sq, bt, tq, dollar, colon, eq, capT, goF, csP, hdr, dash] = 'csbt$k=KgpH-'.split('').map(fl);
    const alts = [...(tq ? (sq ? ['"""', "'''"] : ['"""']) : []), ...(bc ? ['/\\*'] : []), ...(bt ? ['`'] : [])];
    const multi = alts.length ? new RegExp(alts.join('|'), 'g') : null;
    l = { lc: fl('c') ? '//' : fl('h') ? '#' : '', bc, sq, bt, tq, dollar, colon, eq, capT, goF, csP, hdr, dash, kw: set(kws), ty: set(tys), multi };
    langs.set(name, l);
  }
  return l;
}

/*
 * The state a piece of code starts in, for colouring it apart from the text before it (a row of a
 * view, see codeRows): bits 0-3 what it starts inside, 4-7 that token's class, 8-9 its quote
 * (" ' `), then flags. Pieces are coloured with the text around them to hand (`src`), as whole
 * documents are: a token's class can depend on what follows it.
 */
const C_LINE = 0; // between tokens, none yet on the line (IND: after indentation)
const C_MID = 1; // between tokens (SIGN: a '-' before a digit starts a number)
const C_LC = 2; // a line comment
const C_BC = 3; // a block comment (FLAG: its closing "*/" began at the piece's end; OPEN: 1 of its "/*" to come)
const C_STR = 4; // a string (FLAG: an escape is pending)
const C_TQ = 5; // a triple-quoted string (bits 12-13: 1-2 of its closing quotes went before, 3: closed and more quotes go on; OPEN: 1-2 of its opening quotes to come)
const C_HDR = 6; // a TOML table header (FLAG: past its opening brackets)
const C_WORD = 7; // a word
const C_NUM = 8; // a number
const FLAG = 1 << 10;
const IND = 1 << 11;
const SIGN = 1 << 14;
/** Shift of OPEN (bits 15-16): characters of a token's opening still to come (the piece ended inside it). */
const OPEN = 15;
const CLS = ['', 'tk', 'ts', 'tc', 'tn', 'tl', 'tz', 'tw', 'tt', 'tb', 'tp'];
const QUOTE = [34, 39, 96];
const tokenState = (mode: number, cls: string, q = 34, flags = 0) => mode | (CLS.indexOf(cls) << 4) | (QUOTE.indexOf(q) << 8) | flags;

/**
 * Colours `src[from, to)` from `state` (the start of a document: C_LINE), reporting tokens to `emit`
 * (cut to the piece); returns the state at `to`.
 */
function code(src: string, l: Lang, emit: Emit | null, from = 0, to = src.length, state = C_LINE, find?: Find): number {
  const { lc, bc, sq, bt, tq, dollar, colon, eq, capT, goF, csP, hdr, dash, kw, ty } = l;
  const n = src.length;
  const isId = (c: number, start: boolean) =>
    (c >= 97 && c <= 122) || isCap(c) || c === 95 || c > 127 || (dollar && c === 36) || (!start && (isDigit(c) || (dash && c === 45)));
  const keyAt = (j: number) => {
    while (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9) j++;
    const c = src.charCodeAt(j);
    const d = src.charCodeAt(j + 1);
    return eq ? c === 61 && d !== 61 : colon && ((c === 58 && d !== 58) || (c === 63 && d === 58));
  };
  const eol = (i: number) => {
    const j = src.indexOf('\n', i);
    return j < 0 ? n : j;
  };
  const put = (a: number, b: number, cls: string) => {
    if (a < from) a = from;
    if (b > to) b = to;
    if (emit && a < b) emit(a, b, cls);
  };
  /** End of the string from `j` (after its opening quote `q`); `esc`: `j` is escaped. Sets `escTo`: `to` is. */
  let escTo = false;
  const strEnd = (j: number, q: number, esc: boolean) => {
    if (esc) {
      if (j === to) escTo = true;
      j++;
    }
    while (j < n) {
      const d = src.charCodeAt(j);
      if (d === 92) {
        if (j + 1 === to) escTo = true;
        j += 2;
      } else if (d === q) return j + 1;
      else if (d === 10 && q !== 96) return j;
      else j++;
    }
    return n;
  };
  const number = (j: number) => {
    for (;;) {
      const d = src.charCodeAt(j);
      if ((isId(d, false) && d !== 45) || d === 46 || ((d === 43 || d === 45) && (src.charCodeAt(j - 1) | 32) === 101)) j++;
      else return j;
    }
  };
  const word = (j: number) => {
    while (j < n && isId(src.charCodeAt(j), false)) j++;
    return j;
  };
  /** A TOML header's parts: [i, a) its brackets, [a, b) its name, [b, j) the rest. */
  const header = (i: number, a: number, j: number) => {
    let b = j;
    while (b > a && src.charCodeAt(b - 1) !== 93) b--;
    while (b > a && src.charCodeAt(b - 1) === 93) b--;
    put(i, a, 'tb');
    put(a, b, 'tt');
    put(b, j, 'tb');
  };
  /**
   * Triple-quoted string from its closing quotes at `e` (-1: none), searched for from `start`: its end, and
   * the state if it goes on past `to`.
   */
  const tqEnd = (e: number, q: number, cls: string, start: number): [number, number] => {
    let j = e < 0 ? n : e + 3;
    if (e >= 0) while (src.charCodeAt(j) === q) j++;
    const pend = e < 0 || e >= to ? 0 : e + 3 > to ? to - e : 3;
    return [j, tokenState(C_TQ, cls, q, (pend << 12) | (start > to ? (start - to) << OPEN : 0))];
  };

  let i = from;
  // Only the state after whole lines is wanted (layout): a line where no token can open that goes on past it
  // (nor a string past an escaped line break) leaves the next one at its start.
  if (!emit && find && (state & 15) <= C_MID) {
    for (;;) {
      const e = src.indexOf('\n', i);
      if (e < 0 || e >= to || src.charCodeAt(e - 1) === 92) break;
      const k = find(i);
      if (k >= 0 && k < e) break;
      i = e + 1;
      state = C_LINE;
    }
  }
  let first = (state & 15) === C_LINE;
  let indented = (state & IND) !== 0;
  let sign = first || (state & SIGN) !== 0;
  const mode = state & 15;
  // The token the piece starts inside goes on.
  if (mode > C_MID) {
    const cls = CLS[(state >> 4) & 15];
    const q = QUOTE[(state >> 8) & 3];
    const flag = (state & FLAG) !== 0;
    let j: number;
    const skip = (state >> OPEN) & 3;
    let next = state & ~FLAG & ~(3 << 12) & ~(3 << OPEN);
    if (mode === C_LC) j = eol(i);
    else if (mode === C_BC) {
      const e = flag && src.charCodeAt(i) === 47 ? i - 1 : src.indexOf('*/', i + skip);
      j = e < 0 ? n : e + 2;
      if (e === to - 1) next |= FLAG;
      if (i + skip > to) next |= (i + skip - to) << OPEN;
    } else if (mode === C_STR) {
      j = strEnd(i, q, flag);
      if (escTo) next |= FLAG;
    } else if (mode === C_TQ) {
      const pend = (state >> 12) & 3;
      if (pend === 3) {
        j = i;
        while (src.charCodeAt(j) === q) j++;
        next = state;
      } else {
        [j, next] = tqEnd(pend ? i - pend : src.indexOf(String.fromCharCode(q, q, q), i + skip), q, cls, i + skip);
      }
    } else if (mode === C_HDR) {
      j = eol(i);
      let a = i;
      if (!flag) while (src.charCodeAt(a) === 91) a++;
      header(i, a, j);
      if (j > to) return to >= a ? state | FLAG : state;
      i = j;
    } else j = mode === C_NUM ? number(i) : word(i);
    if (mode !== C_HDR) {
      put(i, j, cls);
      if (j > to) return next;
      i = j;
    }
    first = false;
    sign = false;
  }
  while (i < to) {
    const c = src.charCodeAt(i);
    let j = i + 1;
    let cls = '';
    let mode = C_MID;
    let q = 34;
    let after = 0;
    if (c === 32 || c === 9 || c === 13) {
      i++;
      if (first) indented = true;
      continue;
    }
    if (c === 10) {
      i++;
      first = true;
      indented = false;
      sign = true;
      continue;
    }
    if (lc && src.startsWith(lc, i)) {
      j = eol(i);
      cls = 'tc';
      mode = C_LC;
    } else if (bc && src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      j = e < 0 ? n : e + 2;
      cls = 'tc';
      mode = C_BC;
      if (e === to - 1) after = FLAG;
      if (i + 2 > to) after |= (i + 2 - to) << OPEN;
    } else if (hdr && c === 91 && first && !indented) {
      // TOML [table] / [[array]] header
      j = eol(i);
      let a = i;
      while (src.charCodeAt(a) === 91) a++;
      header(i, a, j);
      if (j > to) return tokenState(C_HDR, 'tb', 34, to >= a ? FLAG : 0);
      first = false;
      i = j;
      continue;
    } else if (c === 34 || (sq && c === 39) || (bt && c === 96)) {
      q = c;
      if (tq && c !== 96 && src.charCodeAt(i + 1) === c && src.charCodeAt(i + 2) === c) {
        const e = src.indexOf(src.slice(i, i + 3), i + 3);
        j = e < 0 ? n : e + 3;
        while (src.charCodeAt(j) === c) j++;
        cls = keyAt(j) ? 'tk' : 'ts';
        if (j > to) {
          put(i, j, cls);
          return tqEnd(e, c, cls, i + 3)[1];
        }
      } else {
        escTo = false;
        j = strEnd(i + 1, c, false);
        cls = keyAt(j) ? 'tk' : 'ts';
        mode = C_STR;
        if (escTo) after = FLAG;
      }
    } else if (isDigit(c) || (c === 45 && isDigit(src.charCodeAt(i + 1)) && sign)) {
      j = number(j);
      cls = 'tn';
      mode = C_NUM;
    } else if (isId(c, true)) {
      j = word(j);
      const w = src.slice(i, j);
      cls =
        capT && isCap(c)
          ? 'tt'
          : keyAt(j)
            ? 'tk'
            : TL.has(w)
              ? 'tl'
              : TZ.has(w)
                ? 'tz'
                : kw.has(w)
                  ? 'tw'
                  : (goF && first && indented) || (csP && src.startsWith(' {', j))
                    ? 'tk'
                    : ty.has(w) || isCap(c)
                      ? 'tt'
                      : '';
      mode = C_WORD;
    } else cls = c === 123 || c === 125 || c === 91 || c === 93 || c === 40 || c === 41 ? 'tb' : 'tp';
    first = false;
    sign = c === 61 || c === 58 || c === 44 || c === 91 || c === 40 || c === 123;
    put(i, j, cls);
    if (j > to) return tokenState(mode, cls, q, after);
    i = j;
  }
  return first ? C_LINE | (indented ? IND : 0) : C_MID | (sign ? SIGN : 0);
}

const Y_NUM = /^[-+]?(?:\d[\d.]*(?:e[-+]?\d+)?|\.inf|\.nan)$/i;

/*
 * YAML state (see code's): bits 0-2 what the piece starts in, 3-6 a class, then the indentation owning
 * the block scalar in effect plus one (0: none). A piece that starts after a line's colouring is
 * known (its value, comment or block text: one class to the end of the line) goes on in that class;
 * one that starts before it colours its line again from the start (only its first few characters).
 */
const Y_LINE = 0; // at a line start (bits 7+: the block scalar in effect)
const Y_HEAD = 1; // before the line's value: coloured from the line start again (bits 7+: as at the line start)
const Y_REST = 2; // the rest of the line in one class (bits 7+: the block scalar after the line)
const yState = (mode: number, cls: string, block: number) => mode | (CLS.indexOf(cls) << 3) | ((block + 1) << 7);

function yaml(src: string, emit: Emit | null, from = 0, to = src.length, state = Y_LINE, find?: Find): number {
  const n = src.length;
  const put = (a: number, b: number, cls: string) => {
    if (a < from) a = from;
    if (b > to) b = to;
    if (emit && a < b) emit(a, b, cls);
  };
  let block = (state >> 7) - 1; // indentation owning the current block scalar
  let lo = from; // offset of the current line
  if ((state & 7) === Y_REST) {
    let e = src.indexOf('\n', from);
    if (e < 0) e = n;
    put(from, e, CLS[(state >> 3) & 15]);
    if (e >= to) return state;
    lo = e + 1;
  } else if ((state & 7) === Y_HEAD) lo = src.lastIndexOf('\n', from - 1) + 1;
  for (;;) {
    if (lo >= to && lo > from) return yState(Y_LINE, '', block);
    let e = src.indexOf('\n', lo);
    if (e < 0) e = n;
    // Only the block scalar after a whole line is wanted (layout): most lines can't start one.
    if (!emit && to >= e && find) {
      let k = 0;
      while (src.charCodeAt(lo + k) === 32) k++;
      if (block >= 0 && (k > block || lo + k === e)) {
        if (e >= to) return yState(Y_REST, '', block);
        lo = e + 1;
        continue;
      }
      const bar = find(lo);
      if (bar < 0 || bar >= e) {
        if (e >= to) return yState(Y_REST, '', -1);
        block = -1;
        lo = e + 1;
        continue;
      }
    }
    const ln = src.slice(lo, e);
    const start = block;
    /** The state at `to` if it falls in this line: before position `at` of it, the line is coloured again. */
    const at = (p: number, rest: number) => (to < lo + p ? yState(Y_HEAD, '', start) : rest);
    let i = 0;
    while (ln.charCodeAt(i) === 32) i++;
    const ind = i;
    let end = -1;
    if (block >= 0) {
      if (ind > block || ind === ln.length) {
        put(lo + ind, lo + ln.length, 'ts');
        end = at(ind, yState(Y_REST, 'ts', block));
      } else block = -1;
    }
    // (The block scalar after the line, whatever `end` says about the piece.)
    let next = block;
    if (end < 0) {
      let owner = ind;
      const gap = () => {
        while (ln.charCodeAt(i) === 32) i++;
      };
      while (ln[i] === '-' && (ln[i + 1] === ' ' || i + 1 === ln.length)) {
        owner = i;
        put(lo + i, lo + i + 1, 'tp');
        i++;
        gap();
      }
      if (ln[i] === '#') {
        put(lo + i, lo + ln.length, 'tc');
        end = at(i, yState(Y_REST, 'tc', -1));
        next = -1;
      } else {
        let k = -1;
        if (ln[i] === '"') {
          let j = i + 1;
          while (j < ln.length && ln[j] !== '"') j += ln[j] === '\\' ? 2 : 1;
          if (ln[j + 1] === ':') k = j + 1;
        } else if (ln[i] !== "'") {
          const a = ln.indexOf(': ', i);
          k = a >= 0 ? a : ln.endsWith(':') ? ln.length - 1 : -1;
        }
        if (k >= 0) {
          owner = i;
          put(lo + i, lo + k, 'tk');
          put(lo + k, lo + k + 1, 'tp');
          i = k + 1;
          gap();
        }
        const v = ln.slice(i);
        next = -1;
        if (!v) end = at(ln.length + 1, yState(Y_REST, '', -1));
        else {
          if (/^[|>][-+\d]*$/.test(v)) block = owner;
          const cls =
            block >= 0
              ? 'tp'
              : v === '[]' || v === '{}'
                ? 'tb'
                : v === 'null' || v === '~'
                  ? 'tz'
                  : v === 'true' || v === 'false'
                    ? 'tl'
                    : Y_NUM.test(v)
                      ? 'tn'
                      : 'ts';
          put(lo + i, lo + ln.length, cls);
          end = at(i, yState(Y_REST, cls, block));
          next = block;
        }
      }
    }
    if (e >= to) return end;
    lo = e + 1;
    block = next;
  }
}

const CSV_NUM = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

// Whitespace, '/', '>' end a tag name; '=' and quotes also end an attribute name.
const isWs = (c: number) => c === 32 || c === 10 || c === 9 || c === 13;

function xml(src: string, emit: Emit): void {
  const n = src.length;
  let i = 0;
  while (i < n) {
    let j: number;
    if (src.startsWith('<!--', i) || src.startsWith('<?', i)) {
      const end = src[i + 1] === '!' ? '-->' : '?>';
      const e = src.indexOf(end, i);
      j = e < 0 ? n : e + end.length;
      emit(i, j, 'tc');
    } else if (src.charCodeAt(i) === 60) {
      j = i + (src.charCodeAt(i + 1) === 47 ? 2 : 1);
      emit(i, j, 'tp');
      i = j;
      for (let c = src.charCodeAt(j); j < n && !isWs(c) && c !== 47 && c !== 62; c = src.charCodeAt(++j));
      emit(i, j, 'tk');
      for (i = j; i < n && src.charCodeAt(i) !== 62; i = j) {
        const c = src.charCodeAt(i);
        j = i + 1;
        if (c === 34 || c === 39) {
          const e = src.indexOf(src[i], j);
          j = e < 0 ? n : e + 1;
          emit(i, j, 'ts');
        } else if (c === 47 || c === 61) emit(i, j, 'tp');
        else if (!isWs(c)) {
          for (let d = src.charCodeAt(j); j < n && !isWs(d) && d !== 61 && d !== 47 && d !== 62 && d !== 34 && d !== 39; d = src.charCodeAt(++j));
          emit(i, j, 'tt');
        }
      }
      j = i < n ? i + 1 : n;
      emit(i, j, 'tp');
    } else {
      j = src.indexOf('<', i);
      if (j < 0) j = n;
      const t = src.slice(i, j);
      if (t.trim()) emit(i, j, CSV_NUM.test(t) ? 'tn' : t === 'true' || t === 'false' ? 'tl' : 'ts');
    }
    i = j;
  }
}

function csv(src: string, emit: Emit): void {
  const n = src.length;
  let i = 0;
  let row = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    let j = i + 1;
    if (c === 44) emit(i, j, 'tp');
    else if (c === 10) row++;
    else if (c !== 13) {
      if (c === 34) {
        for (;;) {
          const e = src.indexOf('"', j);
          if (e < 0) {
            j = n;
            break;
          }
          j = e + 1;
          if (src.charCodeAt(j) !== 34) break;
          j++;
        }
      }
      for (let d = src.charCodeAt(j); j < n && d !== 44 && d !== 10 && d !== 13; d = src.charCodeAt(++j));
      const v = c === 34 ? '' : src.slice(i, j);
      emit(i, j, !row ? 'tk' : c === 34 ? 'ts' : CSV_NUM.test(v) ? 'tn' : v === 'true' || v === 'false' ? 'tl' : 'ts');
    }
    i = j;
  }
}

/*
 * CSV by column ("rainbow"): each field takes its column's colour (cc0…cc7,
 * repeating) and the header record is bold, so a value's column is clear at a
 * glance. A row of the view can start mid-record (a quoted field with a line
 * break, or a wrapped row), so the view passes in the state where it starts:
 * column << 2 | header << 1 | inside quotes.
 */

/** State at the start of a CSV document: column 0 of the header record. */
export const CSV_START = 2;

/** CSV state after `s[a, b)` from `state`. */
export function csvScan(s: string, a: number, b: number, state: number): number {
  let col = state >> 2;
  let head = state & 2;
  let q = state & 1;
  for (let i = a; i < b; i++) {
    const c = s.charCodeAt(i);
    if (q) {
      if (c === 34) {
        if (s.charCodeAt(i + 1) === 34) i++;
        else q = 0;
      }
    } else if (c === 44) col++;
    else if (c === 34) q = 1;
    else if (c === 10) {
      col = 0;
      head = 0;
    }
  }
  return (col << 2) | head | q;
}

/** Highlights a piece of one CSV line that starts in `state` (see `csvScan`). */
export function csvLine(src: string, state: number): string {
  const n = src.length;
  const head = state & 2 ? ' ch' : '';
  let col = state >> 2;
  let q = state & 1;
  let out = '';
  for (let i = 0; i < n; ) {
    const c = src.charCodeAt(i);
    if (!q && (c === 44 || c === 13)) {
      out += c === 44 ? '<span class="tp">,</span>' : '\r';
      if (c === 44) col++;
      i++;
      continue;
    }
    let j = i;
    for (; j < n; j++) {
      const d = src.charCodeAt(j);
      if (q) {
        if (d === 34) {
          if (src.charCodeAt(j + 1) === 34) j++;
          else q = 0;
        }
      } else if (d === 44 || d === 13) break;
      else if (d === 34) q = 1;
    }
    out += `<span class="cc${col % 8}${head}">${esc(src.slice(i, j))}</span>`;
    i = j;
  }
  return out;
}

/** Reports `src`'s tokens to `emit` in order, as highlightCode colours them (`lang` is a `Target.lang`). */
export function codeTokens(src: string, lang: string, emit: Emit): void {
  if (lang === 'yaml') yaml(src, emit);
  else if (lang === 'xml') xml(src, emit);
  else if (lang === 'csv') csv(src, emit);
  else if (LANGS[lang]) code(src, langOf(lang)!, emit);
}

/** Highlights converter output as HTML (`lang` is a `Target.lang`). */
export function highlightCode(src: string, lang: string): string {
  // Small pieces are joined in batches: far less GC work than one huge rope.
  const chunks: string[] = [];
  let parts: string[] = [];
  const put = (s: string) => {
    if (parts.push(s) > 2048) {
      chunks.push(parts.join(''));
      parts = [];
    }
  };
  let pend = 0; // start of not-yet-written plain text
  const emit: Emit = (a, b, cls) => {
    if (!cls || a >= b) return;
    if (a > pend) put(esc(src.slice(pend, a)));
    pend = b;
    const open = `<span class="${cls}">`;
    const s = src.slice(a, b);
    if (s.indexOf('\n') < 0) put(open + esc(s) + '</span>');
    else put(s.split('\n').map((p) => (p ? open + esc(p) + '</span>' : '')).join('\n'));
  };
  codeTokens(src, lang, emit);
  if (pend < src.length) put(esc(src.slice(pend)));
  chunks.push(parts.join(''));
  return chunks.join('');
}

/**
 * A code view's row highlighter and scanner for `lang` (see CodeView): each row is coloured from the
 * state the text before it leaves, so rows colour as the whole document does (a YAML block scalar's
 * lines are text, a TOML multi-line string is one). `src` and `at`: the text the row is in and where
 * it starts (without them, the row is coloured on its own).
 */
export function codeRows(lang: string) {
  const l = lang === 'yaml' ? null : langOf(lang);
  if (!l && lang !== 'yaml') return { hl: (row: string) => highlightCode(row, lang), scanner: null };
  // Layout scans a text a line at a time, in order: each search runs on from the last one.
  const re = l ? l.multi : /[|>]/g;
  let scanned = '';
  let from = 0;
  let found = -1;
  let text = '';
  const find: Find = (i) => {
    if (!re) return -1;
    if (text !== scanned || i < from || (found >= 0 && found < i)) {
      text = scanned;
      from = i;
      re.lastIndex = i;
      found = re.exec(text)?.index ?? -1;
    }
    return found;
  };
  const run = (src: string, emit: Emit | null, a: number, b: number, state: number) => {
    scanned = src;
    return l ? code(src, l, emit, a, b, state, find) : yaml(src, emit, a, b, state, find);
  };
  return {
    hl: (row: string, _str: boolean, _esc: boolean, state: number, src = row, at = 0) => {
      let out = '';
      let p = at;
      run(src, (a, b, cls) => {
        if (!cls) return;
        if (a > p) out += esc(src.slice(p, a));
        out += `<span class="${cls}">${esc(src.slice(a, b))}</span>`;
        p = b;
      }, at, at + row.length, state);
      return p < at + row.length ? out + esc(src.slice(p, at + row.length)) : out;
    },
    scanner: { start: 0, scan: (s: string, a: number, b: number, state: number) => run(s, null, a, b, state) },
  };
}
