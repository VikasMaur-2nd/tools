/*
 * The pretty-printed form of a document (what format.ts `stringify(root, indent)` writes), read off its
 * tape and source text a line at a time and never made whole. A 100 MB document's pretty form is
 * 150–300 MB of text (twice that as UTF-16 with any character past Latin-1), and as many again while it
 * is made and sent between threads; read off the tape, it costs four numbers a line.
 *
 * Every value is a line, and every container with items a line more, its close. A line's text is its
 * indentation, its property name, its value (a container's open bracket) and the comma after it.
 */
import { ARR, BOOL, NUL, NUM, OBJ, STR } from './parser';
import { quote, MAX_INDENT } from './format';
import { KEY_NAME, SIZE_BIG, VALUE_DECODE, VALUE_FALSE, VALUE_SLICE, W, valueOf, type Tape } from './tape';
import type { CodeIndex } from './code-index';

/** A document's pretty lines: the code view's index of them (see codeIndexer), and what each line is. */
export interface PrettyIndex extends CodeIndex {
  /** Per line: its node, or -1 - c for the line that closes container c. */
  node: Int32Array<ArrayBuffer>;
  /** Per line: 1 if it is printable ASCII only (its rows are counted from its length: see wrap.ts asciiRows). */
  ascii: Uint8Array<ArrayBuffer>;
  /** Characters in all (lines joined with \n). */
  length: number;
}

/**
 * Characters a string's text may need escaped for (see `plain`): quotes, backslashes, control characters, and a
 * surrogate that isn't in a pair (a pair is matched whole, then passed over: see `special`).
 */
const SPECIAL = /["\\\x00-\x1f]|[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g;
/** Characters past printable ASCII, searched forward (see `ascii`). */
const WIDER = /[^\x20-\x7e]/g;
const PRINTABLE = /^[\x20-\x7e]*$/;

/** Where the first character from `at` that may need escaping is (see SPECIAL), or src.length. */
function special(src: string, at: number): number {
  SPECIAL.lastIndex = at;
  for (let m; (m = SPECIAL.exec(src)); ) if (m[0].length === 1) return m.index;
  return src.length;
}

/**
 * Whether the string token src[a, b) is written as it stands: in double quotes (a string cut off at the end
 * has no closing one), with nothing JSON.stringify would escape (a quote, a control character or a lone
 * surrogate) between them, and only escapes it writes the same way (\" \\ \b \f \n \r \t).
 */
function plain(src: string, a: number, b: number): boolean {
  if (b - a < 2 || src.charCodeAt(a) !== 34 || src.charCodeAt(b - 1) !== 34) return false;
  for (let i = a + 1; i < b - 1; i++) {
    const c = src.charCodeAt(i);
    if (c === 92) {
      const e = src.charCodeAt(++i);
      if (i >= b - 1 || !(e === 34 || e === 92 || e === 98 || e === 102 || e === 110 || e === 114 || e === 116)) return false;
      continue;
    }
    if (c < 0x20 || c === 34) return false;
    if (c >= 0xd800 && c <= 0xdfff) {
      if (c >= 0xdc00 || i + 1 >= b - 1) return false;
      const d = src.charCodeAt(i + 1);
      if (d < 0xdc00 || d > 0xdfff) return false;
      i++;
    }
  }
  return true;
}

/** Where prettyIndexer got to (its loop works on locals, written back here between steps). */
interface Indexing {
  i: number;
  line: number;
  pos: number;
  maxLen: number;
  /** The open containers with items: how many, and each one's node, opening line and subtree end. */
  top: number;
  special: number;
  wider: number;
}

/**
 * The pretty lines of `t` (parsed from `src`) for indent unit `indent` (not ''), in steps: call it with a
 * deadline (a performance.now() value) until it returns them. Null if they can't be written (nesting so deep
 * the indentation alone is huge, see format.ts MAX_INDENT; or more text than offsets can count).
 */
export function prettyIndexer(t: Tape, src: string, indent: string): (until: number) => PrettyIndex | null | undefined {
  const n = t.count;
  const nodes = t.nodes;
  const unit = indent.length;
  if (!n || !unit || t.head.depth * unit > MAX_INDENT) return () => null;
  // Pass 1: lines = nodes + containers with items (each closes on a line of its own).
  let lines = n;
  for (let i = 0; i < n; i++) {
    const m = nodes[i * W];
    if ((m & 7) >= ARR && (m >>> 8) !== 1) lines++;
  }
  const starts = new Int32Array(lines);
  const close = new Int32Array(lines).fill(-1);
  const depth = new Int32Array(lines);
  const node = new Int32Array(lines);
  const ascii = new Uint8Array(lines);
  // Quoted property names' lengths, by key index (-1: not yet measured), and whether each is printable ASCII.
  const keyLen = new Int32Array(t.keys.length).fill(-1);
  const keyAscii = new Uint8Array(t.keys.length);
  const padAscii = PRINTABLE.test(indent);
  const levels = t.head.depth + 2;
  const openNode = new Int32Array(levels);
  const openLine = new Int32Array(levels);
  const openEnd = new Int32Array(levels);
  const big = t.big;
  const st: Indexing = { i: 0, line: 0, pos: 0, maxLen: 0, top: 0, special: -1, wider: -1 };
  return (until) => {
    let { i, line, pos, maxLen, top, special: sp, wider } = st;
    for (let k = 0; i < n; i++, k++) {
      if ((k & 4095) === 4095 && performance.now() >= until) {
        Object.assign(st, { i, line, pos, maxLen, top, special: sp, wider });
        return undefined;
      }
      // Containers whose subtree ended: each closes on its own line (with a comma when it has a next sibling).
      while (top && i >= openEnd[top - 1]) {
        top--;
        const c = openNode[top];
        const end = openEnd[top];
        close[openLine[top]] = line;
        const len = top * unit + 1 + (top && end < openEnd[top - 1] ? 1 : 0);
        starts[line] = pos;
        ascii[line] = padAscii || !top ? 1 : 0;
        node[line++] = -1 - c;
        if (len > maxLen) maxLen = len;
        pos += len + 1;
      }
      const o = i * W;
      const m = nodes[o];
      const kind = m & 7;
      let size = m >>> 8;
      if (size >= SIZE_BIG) size = big!.get(i)!;
      // (A comma after it: its subtree isn't the last of its parent's.)
      const comma = top && i + size < openEnd[top - 1] ? 1 : 0;
      let len = top * unit;
      let plainLine = padAscii || !top;
      if (((m >> 3) & 3) === KEY_NAME) {
        const key = nodes[o + 4];
        let q = keyLen[key];
        if (q < 0) {
          const k = quote(t.keys[key]);
          q = keyLen[key] = k.length;
          keyAscii[key] = PRINTABLE.test(k) ? 1 : 0;
        }
        len += q + 2;
        plainLine &&= keyAscii[key] === 1;
      }
      const vk = (m >> 5) & 7;
      if (kind >= ARR) {
        if (size === 1) len += 2 + comma;
        else {
          len += 1;
          depth[line] = top;
          openNode[top] = i;
          openLine[top] = line;
          openEnd[top++] = i + size;
        }
      } else {
        if (kind === NUL) len += 4;
        else if (kind === BOOL) len += vk === VALUE_FALSE ? 5 : 4;
        else if (vk === VALUE_SLICE) {
          const a = nodes[o + 1];
          const b = nodes[o + 2];
          if (kind === NUM) len += b - a;
          else {
            // (Read forward through the text once: the next character that may need escaping.)
            if (sp <= a) sp = special(src, a + 1);
            if ((b - a >= 2 && src.charCodeAt(a) === 34 && src.charCodeAt(b - 1) === 34 && sp >= b - 1) || plain(src, a, b)) {
              len += b - a;
              if (plainLine) {
                if (wider < a) {
                  WIDER.lastIndex = a;
                  wider = WIDER.exec(src)?.index ?? src.length;
                }
                plainLine = wider >= b;
              }
            } else {
              const q = quote(valueOf(t, i, src) as string);
              len += q.length;
              plainLine &&= PRINTABLE.test(q);
            }
          }
        } else if (kind === STR && vk === VALUE_DECODE && plain(src, nodes[o + 1], nodes[o + 2])) {
          // (Escapes JSON.stringify writes the same way: the token as it stands.)
          const a = nodes[o + 1];
          const b = nodes[o + 2];
          len += b - a;
          if (plainLine) {
            if (wider < a) {
              WIDER.lastIndex = a;
              wider = WIDER.exec(src)?.index ?? src.length;
            }
            plainLine = wider >= b;
          }
        } else {
          const v = valueOf(t, i, src) as string;
          const q = kind === STR ? quote(v) : v;
          len += q.length;
          plainLine &&= PRINTABLE.test(q);
        }
        len += comma;
      }
      starts[line] = pos;
      ascii[line] = plainLine ? 1 : 0;
      node[line++] = i;
      if (len > maxLen) maxLen = len;
      pos += len + 1;
      if (pos > 0x7fff0000) return null;
    }
    while (top) {
      top--;
      const c = openNode[top];
      const end = openEnd[top];
      close[openLine[top]] = line;
      const len = top * unit + 1 + (top && end < openEnd[top - 1] ? 1 : 0);
      starts[line] = pos;
      ascii[line] = padAscii || !top ? 1 : 0;
      node[line++] = -1 - c;
      if (len > maxLen) maxLen = len;
      pos += len + 1;
    }
    Object.assign(st, { i, line, pos, maxLen, top, special: sp, wider });
    return { starts, close, depth, node, ascii, maxLen, length: pos - 1 };
  };
}

/** The pretty text of `t` as lines and slices of it (see prettyIndexer for `index`). */
export class PrettyText {
  readonly length: number;
  private pads: string[] = [''];

  constructor(
    private readonly t: Tape,
    private readonly src: string,
    private readonly indent: string,
    readonly index: PrettyIndex,
  ) {
    this.length = index.length;
  }

  private pad(d: number) {
    const pads = this.pads;
    while (pads.length <= d) pads.push(pads[pads.length - 1] + this.indent);
    return pads[d];
  }

  /** Line `k` (without its line break). */
  line(k: number): string {
    const { t, src } = this;
    const nodes = t.nodes;
    const x = this.index.node[k];
    const i = x < 0 ? -1 - x : x;
    const o = i * W;
    const m = nodes[o];
    const kind = m & 7;
    // Depth and the comma: from the parent (the root has neither).
    const p = nodes[o + 3];
    let d = 0;
    for (let a = p; a >= 0; a = nodes[a * W + 3]) d++;
    const s = (j: number) => {
      const z = nodes[j * W] >>> 8;
      return z < SIZE_BIG ? z : t.big!.get(j)!;
    };
    const last = p < 0 || i + s(i) >= p + s(p);
    if (x < 0) return this.pad(d) + (kind === OBJ ? '}' : ']') + (last ? '' : ',');
    let out = this.pad(d);
    if (((m >> 3) & 3) === KEY_NAME) out += quote(t.keys[nodes[o + 4]]) + ': ';
    if (kind >= ARR) {
      if ((m >>> 8) !== 1) return out + (kind === OBJ ? '{' : '[');
      out += kind === OBJ ? '{}' : '[]';
    } else if (kind === NUL) out += 'null';
    else if (kind === BOOL) out += ((m >> 5) & 7) === VALUE_FALSE ? 'false' : 'true';
    else if (kind === NUM) out += valueOf(t, i, src) as string;
    else if ((((m >> 5) & 7) === VALUE_SLICE || ((m >> 5) & 7) === VALUE_DECODE) && plain(src, nodes[o + 1], nodes[o + 2])) out += src.slice(nodes[o + 1], nodes[o + 2]);
    else out += quote(valueOf(t, i, src) as string);
    return last ? out : out + ',';
  }

  /** Line holding offset `at`. */
  lineAt(at: number): number {
    const st = this.index.starts;
    let lo = 0;
    let hi = st.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (st[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The text [a, b): the lines it spans, made and cut. */
  slice(a = 0, b = this.length): string {
    a = Math.max(0, a);
    b = Math.min(this.length, b);
    if (a >= b) return '';
    const st = this.index.starts;
    let k = this.lineAt(a);
    let out = '';
    for (let at = st[k]; at < b && k < st.length; k++) {
      const text = k + 1 < st.length ? this.line(k) + '\n' : this.line(k);
      out += text.slice(Math.max(0, a - at), b - at);
      at += text.length;
    }
    return out;
  }
}
