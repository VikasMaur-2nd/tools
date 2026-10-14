/**
 * Tiny syntax highlighter for converter output. Emits HTML using the app's
 * token classes; no span ever crosses a line break, so the result can be split
 * into lines, and stripping the tags gives back the exact input.
 */

/** Marks `src[a, b)` with a token class; calls must be ordered and non-overlapping. */
type Emit = (a: number, b: number, cls: string) => void;

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

function code(src: string, [f, kws, tys]: [string, string, string?], emit: Emit): void {
  const kw = set(kws);
  const ty = set(tys);
  const fl = (c: string) => f.includes(c);
  const lc = fl('c') ? '//' : fl('h') ? '#' : '';
  const [bc, sq, bt, tq, dollar, colon, eq, capT, goF, csP, hdr, dash] = 'csbt$k=KgpH-'.split('').map(fl);
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
  let i = 0;
  let first = true; // first token of the line
  let indented = false;
  let prev = 0; // previous non-space character (0 = line start)
  while (i < n) {
    const c = src.charCodeAt(i);
    let j = i + 1;
    let cls = '';
    if (c === 32 || c === 9 || c === 13) {
      i++;
      if (first) indented = true;
      continue;
    }
    if (c === 10) {
      i++;
      first = true;
      indented = false;
      prev = 0;
      continue;
    }
    if (lc && src.startsWith(lc, i)) {
      j = eol(i);
      cls = 'tc';
    } else if (bc && src.startsWith('/*', i)) {
      j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      cls = 'tc';
    } else if (hdr && c === 91 && first && !indented) {
      // TOML [table] / [[array]] header
      j = eol(i);
      let a = i;
      while (src.charCodeAt(a) === 91) a++;
      let b = j;
      while (b > a && src.charCodeAt(b - 1) !== 93) b--;
      while (b > a && src.charCodeAt(b - 1) === 93) b--;
      emit(i, a, 'tb');
      emit(a, b, 'tt');
      emit(b, j, 'tb');
      first = false;
      i = j;
      continue;
    } else if (c === 34 || (sq && c === 39) || (bt && c === 96)) {
      if (tq && c !== 96 && src.charCodeAt(i + 1) === c && src.charCodeAt(i + 2) === c) {
        const e = src.indexOf(src.slice(i, i + 3), i + 3);
        j = e < 0 ? n : e + 3;
        while (src.charCodeAt(j) === c) j++;
      } else {
        while (j < n) {
          const d = src.charCodeAt(j);
          if (d === 92) j += 2;
          else if (d === c) {
            j++;
            break;
          } else if (d === 10 && c !== 96) break;
          else j++;
        }
        if (j > n) j = n;
      }
      cls = keyAt(j) ? 'tk' : 'ts';
    } else if (isDigit(c) || (c === 45 && isDigit(src.charCodeAt(i + 1)) && (!prev || '=:,[({'.includes(String.fromCharCode(prev))))) {
      for (;;) {
        const d = src.charCodeAt(j);
        if ((isId(d, false) && d !== 45) || d === 46 || ((d === 43 || d === 45) && (src.charCodeAt(j - 1) | 32) === 101)) j++;
        else break;
      }
      cls = 'tn';
    } else if (isId(c, true)) {
      while (j < n && isId(src.charCodeAt(j), false)) j++;
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
    } else cls = c === 123 || c === 125 || c === 91 || c === 93 || c === 40 || c === 41 ? 'tb' : 'tp';
    first = false;
    prev = c;
    emit(i, j, cls);
    i = j;
  }
}

const Y_NUM = /^[-+]?(?:\d[\d.]*(?:e[-+]?\d+)?|\.inf|\.nan)$/i;

function yaml(src: string, emit: Emit): void {
  let block = -1; // indentation owning the current block scalar
  let o = 0; // offset of the current line
  for (const ln of src.split('\n')) {
    const lo = o;
    o += ln.length + 1;
    let i = 0;
    while (ln.charCodeAt(i) === 32) i++;
    const ind = i;
    if (block >= 0) {
      if (ind > block || ind === ln.length) {
        emit(lo + ind, lo + ln.length, 'ts');
        continue;
      }
      block = -1;
    }
    let owner = ind;
    const gap = () => {
      while (ln.charCodeAt(i) === 32) i++;
    };
    while (ln[i] === '-' && (ln[i + 1] === ' ' || i + 1 === ln.length)) {
      owner = i;
      emit(lo + i, lo + i + 1, 'tp');
      i++;
      gap();
    }
    if (ln[i] === '#') {
      emit(lo + i, lo + ln.length, 'tc');
      continue;
    }
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
      emit(lo + i, lo + k, 'tk');
      emit(lo + k, lo + k + 1, 'tp');
      i = k + 1;
      gap();
    }
    const v = ln.slice(i);
    if (!v) continue;
    if (/^[|>][-+\d]*$/.test(v)) block = owner;
    emit(
      lo + i,
      lo + ln.length,
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
                : 'ts',
    );
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
  if (lang === 'yaml') yaml(src, emit);
  else if (lang === 'xml') xml(src, emit);
  else if (lang === 'csv') csv(src, emit);
  else if (LANGS[lang]) code(src, LANGS[lang], emit);
  if (pend < src.length) put(esc(src.slice(pend)));
  chunks.push(parts.join(''));
  return chunks.join('');
}
