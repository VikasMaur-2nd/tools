import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids, tooDeep, type ParseResult } from './parser';

const byKey = (a: JNode, b: JNode) => {
  const x = a.key as string;
  const y = b.key as string;
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Longest text written here: V8's maximum string length. Firefox and Safari allow longer ones, but such an
 * output (pretty-printing very deep nesting, 2·depth² characters) would only exhaust memory. Writing more
 * throws `tooLong()`, a RangeError like the engine's own (see `tooLarge`).
 */
export const MAX_TEXT = 2 ** 29 - 24;
const tooLong = () => new RangeError('Invalid string length');
/** An output too large to make: past MAX_TEXT, or more than the engine or memory could hold. */
export const tooLarge = (e: unknown) => e instanceof RangeError && /string length|array buffer|array length|allocation/i.test(e.message);

// Strings that JSON.stringify would escape (quotes, backslash, control chars, lone surrogates).
const NEEDS_ESCAPE = /["\\\x00-\x1f\ud800-\udfff]/;
export const quote = (s: string) => (NEEDS_ESCAPE.test(s) ? JSON.stringify(s) : '"' + s + '"');

/**
 * Serializes a node tree. `indent` is the indent unit ('' = minified).
 * Numbers are written from their original source text, so nothing is lost.
 * Open containers are kept on a list rather than the call stack, so any depth the parser accepts can be written.
 */
export function stringify(root: JNode, indent: string, sortKeys = false): string {
  let out = '';
  const nl = indent ? '\n' : '';
  const colon = indent ? ': ' : ':';
  const pads = [''];
  const seps: string[] = [];
  const pad = (d: number) => {
    while (pads.length <= d) pads.push(pads[pads.length - 1] + indent);
    return pads[d];
  };
  // The open containers: their items, whether they're objects, and the item being written.
  const lists: JNode[][] = [];
  const objs: boolean[] = [];
  const at: number[] = [];
  let node = root;
  for (;;) {
    if (out.length > MAX_TEXT) throw tooLong();
    switch (node.t) {
      case NUL:
        out += 'null';
        break;
      case BOOL:
        out += node.v ? 'true' : 'false';
        break;
      case NUM:
        out += node.v as string;
        break;
      case STR:
        out += quote(node.v as string);
        break;
      default: {
        let list = kids(node);
        const isObj = node.t === OBJ;
        if (!list.length) {
          out += isObj ? '{}' : '[]';
          break;
        }
        if (isObj && sortKeys) list = list.slice().sort(byKey);
        out += (isObj ? '{' : '[') + nl + pad(lists.length + 1);
        lists.push(list);
        objs.push(isObj);
        at.push(0);
        if (isObj) out += quote(list[0].key as string) + colon;
        node = list[0];
        continue;
      }
    }
    // The node is written: on to the next item, closing the containers that are done.
    for (;;) {
      const d = lists.length;
      if (!d) return out;
      const list = lists[d - 1];
      const i = ++at[d - 1];
      if (i < list.length) {
        out += seps[d] ?? (seps[d] = ',' + nl + pad(d));
        if (objs[d - 1]) out += quote(list[i].key as string) + colon;
        node = list[i];
        break;
      }
      lists.pop();
      at.pop();
      out += nl + pad(d - 1) + (objs.pop() ? '}' : ']');
      if (out.length > MAX_TEXT) throw tooLong();
    }
  }
}

/** Deepest nesting written with the native JSON.stringify (see formatDoc). */
const NATIVE_DEPTH = 1000;
/** Widest indentation pretty-printed (see formatDoc): 5,000 levels at two spaces. */
export const MAX_INDENT = 10_000;

/**
 * Formats a parsed document. Uses the native engine when it is guaranteed to
 * reproduce the document exactly (≈3× faster on large inputs).
 */
export function formatDoc(src: string, res: ParseResult, indent: string, sortKeys = false): string {
  // Nesting so deep that its pretty form is unreadable and huge (lines indented by over 10,000 characters,
  // 2·depth² in all) isn't made: it would take seconds to make and show, if it fits at all.
  if (res.depth * indent.length > MAX_INDENT) throw tooLong();
  // (Not for deep nesting: the engines write it recursively, and Firefox runs out of stack from about 5,000
  // levels, while Safari takes seconds to; written from the tree below instead.)
  if (res.exact && !sortKeys && res.depth <= NATIVE_DEPTH) {
    try {
      return JSON.stringify(JSON.parse(src), null, indent || undefined);
    } catch (e) {
      // Nesting deeper than the engine can write after all: written from the tree below.
      if (!tooDeep(e)) throw e;
    }
  }
  // Strict JSON with numbers the engine would round: re-indented straight from the text.
  const fast = !sortKeys && !res.error && !res.issues.length && !res.multi ? reindent(src, indent) : null;
  return fast ?? stringify(res.root as JNode, indent, sortKeys);
}

/** A JSON number, from its first character (sticky). */
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
/** Characters a string token must be re-quoted for (global, searched forward once). */
const SPECIAL = /[\\\x00-\x1f\ud800-\udfff]/g;

/**
 * Re-indents strict JSON text in one pass, checking its grammar as it goes:
 * the same text `stringify` makes from the parsed tree (numbers and plain
 * strings are copied, strings with escapes or surrogates are re-quoted), without
 * building the tree. Null if the text isn't strict JSON (comments, trailing
 * commas…), which the full parser then reports or repairs.
 */
export function reindent(src: string, indent: string): string | null {
  return reindenter(src, indent)(Infinity) as string | null;
}

/**
 * Size of strict JSON's minified text (what `reindent(src, '')` makes) without making it: the UTF-8
 * bytes of its tokens, with the strings it re-quotes (escapes, surrogates) measured as re-quoted.
 * Null if a string doesn't parse (not strict JSON).
 */
export function minifiedBytes(src: string): number | null {
  return minifiedBytesIn(src)(Infinity) as number | null;
}

/** `minifiedBytes` in steps: undefined until done, so a big document is measured between input events. */
export function minifiedBytesIn(src: string): (until: number) => number | null | undefined {
  const n = src.length;
  let i = 0;
  let size = 0;
  return (until) => {
    while (i < n) {
      const stop = Math.min(n, i + 65_536);
      while (i < stop) {
        const c = src.charCodeAt(i);
        if (c !== 34) {
          // Between tokens only ASCII is valid, and whitespace goes.
          if (c !== 32 && c !== 10 && c !== 13 && c !== 9) size++;
          i++;
          continue;
        }
        const a = i;
        let special = false;
        let bytes = 2;
        for (i++; i < n; i++) {
          const d = src.charCodeAt(i);
          if (d === 34) break;
          if (d === 92) {
            special = true;
            i++;
          } else if (d < 32) special = true;
          else if (d < 0x80) bytes++;
          else if (d < 0x800) bytes += 2;
          else if (d >= 0xd800 && d <= 0xdfff) special = true;
          else bytes += 3;
        }
        i++;
        if (!special) size += bytes;
        else {
          try {
            size += byteLength(quote(JSON.parse(src.slice(a, i)) as string));
          } catch {
            return null;
          }
        }
      }
      if (i < n && performance.now() >= until) return undefined;
    }
    return size;
  };
}

/** Copy of `buf` (its first `len` units) with room for `k` more. */
function grown(buf: Uint16Array, len: number, k: number) {
  if (len + k > MAX_TEXT) throw tooLong();
  const next = new Uint16Array(Math.min(MAX_TEXT, Math.max(buf.length * 2, len + k)));
  next.set(buf.subarray(0, len));
  return next;
}

/** A re-indent in steps (see `reindenter`). */
export interface Reindenter {
  (until: number): string | null | undefined;
  /** The source offset reached so far (how far a big document got, for a progress bar). */
  at(): number;
}

/**
 * `reindent` in steps: each call works until the time `until` (from
 * performance.now()) and returns undefined if there's more to do, so a big
 * document is re-indented without one long freeze.
 */
export function reindenter(src: string, indent: string): Reindenter {
  const n = src.length;
  const unit = indent.length;
  const iu = unit ? indent.charCodeAt(0) : 0;
  const same = indent === (unit ? String.fromCharCode(iu).repeat(unit) : '');
  const stack: number[] = []; // 123 object, 91 array
  // Output is written as UTF-16 code units and decoded once: millions of small
  // string pieces would cost far more in garbage collection than the work itself.
  // What may come next (want): 0 value, 1 value or close (array start), 2 key or
  // close (object start), 3 key, 4 colon, 5 comma or close, 6 end of text.
  // special: the next backslash, control character or surrogate (one forward search overall).
  const st: Reindent = { src, indent, n, unit, iu, same, stack, buf: new Uint16Array(n + (n >> 1) + 64), len: 0, i: 0, want: 0, special: -1 };
  return Object.assign((until: number) => step(st, until), { at: () => st.i });
}

interface Reindent {
  src: string;
  indent: string;
  n: number;
  unit: number;
  iu: number;
  same: boolean;
  stack: number[];
  buf: Uint16Array;
  len: number;
  i: number;
  want: number;
  special: number;
}

/** Runs a reindent until `until`; the loop works on locals (closure or object reads per character are slow). */
function step(st: Reindent, until: number): string | null | undefined {
  {
    const { src, indent, n, unit, iu, same, stack } = st;
    let { buf, len, i, want, special } = st;
    for (let steps = 1; ; steps++) {
      if ((steps & 4095) === 0 && performance.now() > until) {
        st.buf = buf;
        st.len = len;
        st.i = i;
        st.want = want;
        st.special = special;
        return undefined;
      }
      let c = src.charCodeAt(i);
      while (c === 32 || c === 10 || c === 13 || c === 9) c = src.charCodeAt(++i);
      if (i >= n) return want === 6 ? new TextDecoder('utf-16le').decode(buf.subarray(0, len)) : null;
      if (want === 6) return null;
      // Room for any punctuation plus a line break and its indent.
      const depth = stack.length + 1;
      if (len + 8 + depth * unit > buf.length) buf = grown(buf, len, 8 + depth * unit);
      let br = -1; // write a line break and indent for this depth after the punctuation
      if (want === 4) {
        if (c !== 58) return null;
        buf[len++] = 58;
        if (unit) buf[len++] = 32;
        i++;
        want = 0;
        continue;
      }
      if (want === 5) {
        const top = stack[stack.length - 1];
        if (c === 44) {
          buf[len++] = 44;
          br = stack.length;
          i++;
          want = top === 123 ? 3 : 0;
        } else if ((c === 125 && top === 123) || (c === 93 && top === 91)) {
          stack.pop();
          if (unit) {
            buf[len++] = 10;
            for (let k = stack.length * unit; k > 0; k--) buf[len++] = same ? iu : indent.charCodeAt(k % unit);
          }
          buf[len++] = c;
          i++;
          want = stack.length ? 5 : 6;
          continue;
        } else return null;
      } else if (want === 1 || want === 2) {
        // A container's close right after its open, or its first item (the open is written now).
        if ((want === 1 && c === 93) || (want === 2 && c === 125)) {
          stack.pop();
          buf[len++] = want === 1 ? 91 : 123;
          buf[len++] = c;
          i++;
          want = stack.length ? 5 : 6;
          continue;
        }
        buf[len++] = want === 2 ? 123 : 91;
        br = stack.length;
      }
      if (br >= 0 && unit) {
        buf[len++] = 10;
        for (let k = br * unit; k > 0; k--) buf[len++] = same ? iu : indent.charCodeAt(k % unit);
      }
      // After a comma, read on; after an open, the item at `i` comes next.
      if (want === 0 || want === 3) {
        if (br >= 0 && c === 44) continue;
      }
      if (c === 34) {
        let j = i + 1;
        for (;;) {
          j = src.indexOf('"', j);
          if (j < 0) return null;
          let b = j - 1;
          while (src.charCodeAt(b) === 92) b--;
          if ((j - b) % 2) break;
          j++;
        }
        if (special < i) {
          SPECIAL.lastIndex = i;
          special = SPECIAL.exec(src)?.index ?? n;
        }
        let s: string | null = null;
        if (special < j) {
          try {
            s = quote(JSON.parse(src.slice(i, j + 1)) as string);
          } catch {
            return null;
          }
        }
        const k = s ? s.length : j + 1 - i;
        if (len + k > buf.length) buf = grown(buf, len, k);
        if (s) for (let m = 0; m < k; m++) buf[len++] = s.charCodeAt(m);
        else for (let m = i; m <= j; m++) buf[len++] = src.charCodeAt(m);
        i = j + 1;
        want = want === 2 || want === 3 ? 4 : stack.length ? 5 : 6;
        continue;
      }
      if (want === 2 || want === 3) return null;
      if (c === 123 || c === 91) {
        // Very deep nesting is left to the parser (it reports what it can't hold).
        if (stack.length > 500) return null;
        stack.push(c);
        i++;
        want = c === 123 ? 2 : 1;
        continue;
      }
      let end = i;
      if (c === 116 && src.startsWith('true', i)) end = i + 4;
      else if (c === 102 && src.startsWith('false', i)) end = i + 5;
      else if (c === 110 && src.startsWith('null', i)) end = i + 4;
      else {
        NUMBER.lastIndex = i;
        if (NUMBER.test(src)) end = NUMBER.lastIndex;
      }
      if (end === i) return null;
      // A literal ends at whitespace or a delimiter (not "truex" or "1x").
      const d = src.charCodeAt(end);
      if (end < n && !(d === 32 || d === 10 || d === 13 || d === 9 || d === 44 || d === 93 || d === 125)) return null;
      if (len + end - i > buf.length) buf = grown(buf, len, end - i);
      for (let m = i; m < end; m++) buf[len++] = src.charCodeAt(m);
      i = end;
      want = stack.length ? 5 : 6;
    }
  }
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
  if (node.t < ARR) return scalar(node);
  // Containers with an explicit stack: as deep as the parser goes.
  const top = node.t === ARR ? [] : {};
  const open: JNode[] = [node];
  const into: (unknown[] | Record<string, unknown>)[] = [top];
  const next: number[] = [0];
  while (open.length) {
    const k = open.length - 1;
    const list = kids(open[k]);
    if (next[k] === list.length) {
      open.pop();
      into.pop();
      next.pop();
      continue;
    }
    const c = list[next[k]++];
    const v = c.t < ARR ? scalar(c) : c.t === ARR ? [] : {};
    const o = into[k];
    if (Array.isArray(o)) o.push(v);
    // a plain assignment to "__proto__" would set the prototype and drop the key (JSON.parse keeps it)
    else if (c.key === '__proto__') Object.defineProperty(o, '__proto__', { value: v, enumerable: true, writable: true, configurable: true });
    else o[c.key as string] = v;
    if (c.t >= ARR) {
      open.push(c);
      into.push(v as unknown[] | Record<string, unknown>);
      next.push(0);
    }
  }
  return top;
}

function scalar(node: JNode): unknown {
  if (node.t !== NUM) return node.v;
  const raw = node.v as string;
  const n = Number(raw);
  return String(n) === raw || (Number.isFinite(n) && sci(String(n)) === sci(raw)) ? n : raw;
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

/** UTF-8 byte length of `s` (or of its characters [from, to): don't split a surrogate pair), without allocating. */
export function byteLength(s: string, from = 0, to = s.length): number {
  let b = 0;
  for (let i = from; i < to; i++) {
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
