/*
 * Soft wrapping for the monospace views (the input editors and the output
 * code views). Rows break exactly where the browser breaks a line styled
 *   white-space: break-spaces; line-break: anywhere; hyphens: none
 * which is how the editor's textarea is styled, so the highlighted copy drawn
 * under it stays on the textarea's glyphs.
 *
 * - Printable ASCII, after leading spaces or tabs, wraps every `cols` cells:
 *   that's arithmetic.
 * - Other text (accents, CJK, emoji, RTL scripts, tabs mid-line) is sized by
 *   the browser. A line that surely fits (its code points, each measured once,
 *   add up to well under a row) takes one row; the rest are laid out together
 *   in a hidden box, one layout for a whole document.
 * - A line's row starts come from the same arithmetic or, for other text, from
 *   probing character rects in a hidden copy of the line split into small text
 *   nodes (in one huge text node every probe walks the whole line).
 * - Views that draw every row themselves (the code views, the editor without
 *   its textarea) needn't match a textarea: a long line of other text is
 *   broken by adding up its glyphs' widths, which is instant at any size. A
 *   line of binary (control characters: a file that isn't text) is cut every
 *   few code units: laying it out, the browser takes seconds a megabyte to
 *   find fonts for all the scripts in it.
 */

import type { Doc } from './doc';
import { samePrefix } from './highlight';
import { TAB } from './lines';

/** The text rows are found for: a string, or the editor's document (read a slice at a time, see Doc). */
export type Src = string | Doc;

/** Text nodes of a mirror end at the first ASCII character after this many characters. */
const CHUNK = 128;
/** Mirrors kept laid out (least recently used are dropped). */
const MIRRORS = 6;
/** A mirror is patched, not rebuilt, when an edit changes at most this many characters. */
const PATCH = 4096;
/** Anything that isn't printable ASCII, a tab or a line break. */
const NON_ASCII = /[^\t\n\x20-\x7e]/g;
/** Longer lines are drawn row by row (sliced), shorter ones whole. */
export const LONG_LINE = 3000;
/** Characters that end a row by themselves. */
const FORCED = /[\v\f\x85\u2028\u2029]/;
/** Code points that never start a row: marks, joiners, variation selectors, skin tones, tags. */
const JOINS = /[\p{M}\u200d\ufe00-\ufe0f\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}]/u;
/**
 * Cursive joining (Unicode 17 ArabicShaping.txt): letters that join the
 * letter after them (types D, L, C) and the letter before them (D, R, C).
 */
const JOINS_NEXT = /[\u0620\u0626\u0628\u062a-\u062e\u0633-\u0647\u0649\u064a\u066e\u066f\u0678-\u0687\u069a-\u06bf\u06c1\u06c2\u06cc\u06ce\u06d0\u06d1\u06fa-\u06fc\u06ff\u0712-\u0714\u071a-\u071d\u071f-\u0727\u0729\u072b\u072d\u072e\u074e-\u0758\u075c-\u076a\u076d-\u0770\u0772\u0775-\u0777\u077a-\u077f\u07ca-\u07ea\u07fa\u0841-\u0845\u0848\u084a-\u0853\u0855\u0860\u0862-\u0865\u0868\u0883-\u0886\u0889-\u088d\u088f\u08a0-\u08a9\u08af\u08b0\u08b3-\u08b8\u08ba-\u08c8\u1807\u180a\u1820-\u1878\u1887-\u18a8\u18aa\u200d\ua840-\ua872\u{10ac0}-\u{10ac4}\u{10acd}\u{10ad3}-\u{10adc}\u{10ade}-\u{10ae0}\u{10aeb}-\u{10aee}\u{10b80}\u{10b82}\u{10b86}-\u{10b88}\u{10b8a}\u{10b8b}\u{10b8d}\u{10b90}\u{10bad}\u{10bae}\u{10d00}-\u{10d21}\u{10d23}\u{10ec3}\u{10ec4}\u{10ec6}\u{10ec7}\u{10f30}-\u{10f32}\u{10f34}-\u{10f44}\u{10f51}-\u{10f53}\u{10f70}-\u{10f73}\u{10f76}-\u{10f81}\u{10fb0}\u{10fb2}\u{10fb3}\u{10fb8}\u{10fbb}\u{10fbc}\u{10fbe}\u{10fbf}\u{10fc1}\u{10fc4}\u{10fca}\u{10fcb}\u{1e900}-\u{1e943}]/u;
const JOINS_PREV = /[\u0620\u0622-\u064a\u066e\u066f\u0671-\u0673\u0675-\u06d3\u06d5\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u077f\u07ca-\u07ea\u07fa\u0840-\u0858\u0860\u0862-\u0865\u0867-\u086a\u0870-\u0886\u0889-\u088f\u08a0-\u08ac\u08ae-\u08c8\u1807\u180a\u1820-\u1878\u1887-\u18a8\u18aa\u200d\ua840-\ua871\u{10ac0}-\u{10ac5}\u{10ac7}\u{10ac9}\u{10aca}\u{10ace}-\u{10ad6}\u{10ad8}-\u{10ae1}\u{10ae4}\u{10aeb}-\u{10aef}\u{10b80}-\u{10b91}\u{10ba9}-\u{10bae}\u{10d01}-\u{10d23}\u{10ec2}-\u{10ec4}\u{10ec6}\u{10ec7}\u{10f30}-\u{10f44}\u{10f51}-\u{10f54}\u{10f70}-\u{10f81}\u{10fb0}\u{10fb2}-\u{10fb6}\u{10fb8}-\u{10fbf}\u{10fc1}-\u{10fc4}\u{10fc9}\u{10fca}\u{1e900}-\u{1e943}]/u;
/** Characters that can be over four cells wide (ligatures, cuneiform, hieroglyphs, musical symbols). */
const WIDE = /[\ufdfa-\ufdfd\ua9c1-\ua9cd\u{12000}-\u{1254f}\u{13000}-\u{1345f}\u{1d000}-\u{1d24f}]/u;
/** A run of printable ASCII (sticky). */
const RUN = /[\x20-\x7e]+/y;
/** Long lines whose breaks were added up (see `rowsOf`). */
const SUMS = 4;
/**
 * What no text file holds: control characters (but tabs and line breaks), noncharacters and lone surrogates.
 * A line with any is binary (a file that isn't text, opened as text): its rows are cut every perRow code
 * units (see `cut`), which costs nothing to count.
 */
const BINARY = /[\0-\x08\x0e-\x1f\x7f-\x84\x86-\x9f\ud800-\udfff\ufffe\uffff]/u;
/** Characters that end a row by themselves, searched for (see FORCED). */
const FORCED_ALL = /[\v\f\x85\u2028\u2029]/g;
/**
 * Per `rows()` flag of a binary line: cut every perRow code units and drawn row by row, never laid out by the
 * browser (every script in it needs a font found, which takes seconds a megabyte).
 */
export const CUT = 2;
/** A line longer than LONG_LINE is binary if its first this many characters are (as a file is: see asks.ts). */
const BINARY_LOOK = 65_536;
/** Binary lines whose rows are kept for lookups (see cuts): the few a frame draws. */
const CUTS = 32;

/** The rows of a binary line `t[a, b)` (see Wrapper.cut): from row `row[k]`, they start `per` code units apart from `off[k]`. */
interface Cuts {
  t: Src;
  a: number;
  b: number;
  per: number;
  /** Rows in all. */
  n: number;
  off: Int32Array;
  row: Int32Array;
}

/** Last index of the ascending `v` whose value is at most `x` (v[0] is). */
function lastAtMost(v: Int32Array, x: number) {
  let lo = 0;
  let hi = v.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (v[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
/**
 * Characters past an edit whose rows are found at once (hundreds of rows: the view and the caret are
 * among them); the rest of a longer line when idle (see refine).
 */
const LAZY_ROWS = 32_768;

/** The text as one string, if it is one. */
const flatOf = (t: Src): string | null => (typeof t === 'string' ? t : t.flat);

/** First character in t[from, to) that isn't printable ASCII, a tab or a line break, or -1. */
const nonAscii = (t: Src, from: number, to: number) => search(NON_ASCII, t, from, to);

/** First match of the global `re` (one character long) in t[from, to), or -1. */
function search(re: RegExp, t: Src, from: number, to: number): number {
  let r = -1;
  let at = from;
  const look = (x: string, i: number, j: number) => {
    // In a view: a search on from `i` in the whole string would run on past `j`.
    re.lastIndex = 0;
    const m = re.exec(i === 0 && j === x.length ? x : x.slice(i, j));
    if (m) r = at + m.index;
    at += j - i;
    return !!m;
  };
  const s = flatOf(t);
  if (s !== null) look(s, Math.max(0, from), Math.min(s.length, to));
  else (t as Doc).each(from, to, look);
  return r;
}

/** Line breaks in t[a, b). */
function breaksIn(t: Src, a: number, b: number) {
  const s = t.slice(a, b);
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/** A run of row starts: `a[i, i + n)`, each plus `d`. */
interface Seg {
  a: Int32Array;
  i: number;
  n: number;
  d: number;
}

/** Runs shorter than this are copied together into one; more runs than MAX_SEGS, and all are. */
const SMALL = 4096;
const MAX_SEGS = 12;

/**
 * Row starts of a long line as runs of arrays shared with its earlier
 * versions: an edit moves every row after it by the edit's length, and
 * copying them all per key would cost the line's rows (600K for 50 MB).
 */
class Starts {
  readonly length: number;
  /** Row index each run starts at. */
  private readonly at: number[];
  private hit = 0;

  constructor(private readonly segs: Seg[]) {
    let n = 0;
    this.at = segs.map((x) => ((n += x.n), n - x.n));
    this.length = n;
  }

  static of(a: Int32Array): Starts {
    return new Starts(a.length ? [{ a, i: 0, n: a.length, d: 0 }] : []);
  }

  /** The run holding row `r`. */
  private seg(r: number): number {
    const at = this.at;
    const h = this.hit;
    if (h < at.length && at[h] <= r && (h + 1 === at.length || at[h + 1] > r)) return h;
    let lo = 0;
    let hi = at.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= r) lo = mid;
      else hi = mid - 1;
    }
    return (this.hit = lo);
  }

  get(r: number): number {
    const k = this.seg(r);
    const x = this.segs[k];
    return x.a[x.i + r - this.at[k]] + x.d;
  }

  /** Rows [from, to), plus `dd`, appended to `out` as runs. */
  part(from: number, to: number, dd: number, out: Seg[] = []): Seg[] {
    to = Math.min(to, this.length);
    if (from >= to) return out;
    for (let k = this.seg(from); k < this.segs.length && this.at[k] < to; k++) {
      const x = this.segs[k];
      const a = Math.max(from, this.at[k]);
      const b = Math.min(to, this.at[k] + x.n);
      if (b > a) out.push({ a: x.a, i: x.i + a - this.at[k], n: b - a, d: x.d + dd });
    }
    return out;
  }

  /** Runs as row starts: neighbouring short runs copied into one, and everything once there are too many. */
  static join(segs: Seg[]): Starts {
    const copy = (run: Seg[]) => {
      const a = new Int32Array(run.reduce((n, x) => n + x.n, 0));
      let o = 0;
      for (const x of run) {
        for (let k = 0; k < x.n; k++) a[o + k] = x.a[x.i + k] + x.d;
        o += x.n;
      }
      return { a, i: 0, n: a.length, d: 0 };
    };
    const out: Seg[] = [];
    let run: Seg[] = [];
    for (const x of segs) {
      if (!x.n) continue;
      if (x.n < SMALL) {
        run.push(x);
        continue;
      }
      if (run.length) out.push(run.length > 1 ? copy(run) : run[0]);
      run = [];
      out.push(x);
    }
    if (run.length) out.push(run.length > 1 ? copy(run) : run[0]);
    return new Starts(out.length > MAX_SEGS ? [copy(out)] : out);
  }

  /** First row in [lo, hi) starting at or after `x` (hi if none). */
  lower(x: number, lo: number, hi: number): number {
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.get(mid) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Last row starting at or before `x` (0 if none). */
  floor(x: number): number {
    let lo = 0;
    let hi = this.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.get(mid) <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

interface SumEntry {
  t: Src;
  /** The text version it is valid for (see rows): lookups never compare texts, which costs their length. */
  v: number;
  a: number;
  b: number;
  st: Starts;
  /** Rows `[0, exact)` are exact, the rest estimated until refined. */
  exact: number;
}

/** Where breaking a line into rows stopped (see breakRows). */
interface BreakState {
  i: number;
  /** Where the run of printable ASCII at `i` ends, if a call stopped inside it (else at most `i`). */
  run: number;
  lastStart: number;
  w: number;
  joined: boolean;
  flags: number;
  forced: boolean;
}

interface Mirror {
  text: string;
  el: HTMLElement;
  nodes: Text[];
  /** Offset of each text node in the line. */
  at: Int32Array;
  rows: number;
  /** Start offset of each row, -1 until probed. */
  starts: Int32Array;
}

/** Leading spaces and tabs of `t[a, b)`: [cells, characters]. */
export function leadOf(t: Src, a: number, b: number, out = [0, 0]): number[] {
  let col = 0;
  let i = a;
  for (; i < b; i++) {
    const c = t.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += TAB - (col % TAB);
    else break;
  }
  out[0] = col;
  out[1] = i - a;
  return out;
}

/** Cells taken by `t[a, b)` when it's printable ASCII after its leading spaces and tabs, else -1. */
export function asciiCells(t: Src, a: number, b: number, lead = [0, 0]): number {
  leadOf(t, a, b, lead);
  for (let j = a + lead[1]; j < b; j++) {
    const c = t.charCodeAt(j);
    if (c < 32 || c > 126) return -1;
  }
  return lead[0] + b - a - lead[1];
}

/**
 * Text nodes for `s[a, b)`, cut before an ASCII character every CHUNK or so
 * characters (never inside a cluster or a joined word), and their offsets.
 */
function chunks(s: string, a: number, b: number): [Text[], number[]] {
  const nodes: Text[] = [];
  const at: number[] = [];
  while (a < b) {
    let e = Math.min(b, a + CHUNK);
    while (e < b && s.charCodeAt(e) > 126) e++;
    nodes.push(document.createTextNode(s.slice(a, e)));
    at.push(a);
    a = e;
  }
  return [nodes, at];
}

/** Width of a tab at `x` px into a row: to the next tab stop, the one after if that's under half a cell away (CSS Text). */
function tabTo(x: number, cw: number) {
  const stop = TAB * cw;
  const g = (Math.floor(x / stop) + 1) * stop - x;
  return g < cw / 2 ? g + stop : g;
}

/** Length of the common prefix of `x` from `xa` and `y` from `ya`, at most `max` (no copies: slices of a string share it). */
function prefixAt(x: Src, xa: number, y: Src, ya: number, max: number) {
  let p = 0;
  while (p + 4096 <= max && x.slice(xa + p, xa + p + 4096) === y.slice(ya + p, ya + p + 4096)) p += 4096;
  while (p < max && x.charCodeAt(xa + p) === y.charCodeAt(ya + p)) p++;
  return p;
}

/** Length of the common suffix of `x` before `xb` and `y` before `yb`, at most `max`. */
function suffixAt(x: Src, xb: number, y: Src, yb: number, max: number) {
  let q = 0;
  while (q + 4096 <= max && x.slice(xb - q - 4096, xb - q) === y.slice(yb - q - 4096, yb - q)) q += 4096;
  while (q < max && x.charCodeAt(xb - 1 - q) === y.charCodeAt(yb - 1 - q)) q++;
  return q;
}

/** Length of the common suffix of `x` and `y`, at most `max`. */
function sameSuffix(x: Src, y: Src, max: number) {
  let q = 0;
  while (q + 4096 <= max && x.slice(x.length - q - 4096, x.length - q) === y.slice(y.length - q - 4096, y.length - q)) q += 4096;
  while (q < max && x.charCodeAt(x.length - 1 - q) === y.charCodeAt(y.length - 1 - q)) q++;
  return q;
}

const fragment = (nodes: Node[]) => {
  const f = document.createDocumentFragment();
  for (const n of nodes) f.appendChild(n);
  return f;
};

/** Rows an ASCII line of `cells` cells takes at `cols` cells per row. */
export const asciiRows = (cells: number, cols: number) => (cells > cols ? Math.ceil(cells / cols) : 1);

export class Wrapper {
  /** Cells per row (0 until the view has a width). */
  cols = 0;
  /** Per line of the last `rows()` call: 1 where the browser decides the breaks, CUT for binary. */
  odd = new Uint8Array(0);
  /** Rows must break exactly where a textarea's do (else long lines are summed: see `rowsOf`). */
  exact: boolean;
  private cw = 0;
  private readonly lh: number;
  private readonly box: HTMLElement;
  private readonly scratch: HTMLElement;
  private sized = new Map<string, number>();
  private glyphs = new Map<number, number>();
  private mirrors = new Map<string, Mirror>();
  private sums: SumEntry[] = [];
  private joins = new Set<number>();
  /** Does this browser keep letters joined across a soft row break (Firefox does)? Measured once. */
  private across: boolean | null = null;
  private range: Range | null = null;
  private readonly lead = [0, 0];
  private trust = true;
  /** How the last `rows()` text differs from the one before: same first `p` and last `q` characters. */
  private diff: { old: Src; text: Src; p: number; q: number } | null = null;
  /** The last `rows()` call, whose unchanged lines the next one reuses. */
  private last: { text: Src; A: Int32Array; B: Int32Array; out: Int32Array; odd: Uint8Array; tabs: boolean } | null = null;
  /** Whether a string text has a tab, told by whoever found out anyway (see knowTabs). */
  private told: { text: string; tabs: boolean } | null = null;

  /** Tells rows() whether `text` has a tab (the editor finds out while counting its lines). */
  knowTabs(text: string, tabs: boolean) {
    this.told = { text, tabs };
  }
  /**
   * rows() reuses its arrays two calls later (the last call's are read by the next): for a caller that
   * keeps neither `odd` nor the counts past the next call. A document of a million lines would
   * otherwise allocate megabytes per key.
   */
  recycle = false;
  private outs: Int32Array<ArrayBuffer>[] = [];
  private odds: Uint8Array<ArrayBuffer>[] = [];
  private flip = 0;

  constructor(host: HTMLElement, lh: number, exact = true) {
    this.lh = lh;
    this.exact = exact;
    this.box = document.createElement('div');
    this.box.className = 'wrap-box';
    this.box.setAttribute('aria-hidden', 'true');
    this.scratch = document.createElement('div');
    this.box.appendChild(this.scratch);
    host.appendChild(this.box);
  }

  destroy() {
    this.box.remove();
    this.pending = [];
    clearTimeout(this.refineTimer);
  }

  /** Text width of a row in px: whole cells plus half a cell, so rounding never decides a break. */
  get width() {
    return this.cols * this.cw + this.cw / 2;
  }

  /** Sets the row width from the space available (px). Returns true if rows must be recomputed. */
  fit(space: number, cw: number): boolean {
    const cols = space > 0 && cw > 0 ? Math.max(8, Math.floor((space - cw / 2) / cw)) : 0;
    if (cols === this.cols && cw === this.cw) return false;
    if (cw !== this.cw) {
      this.glyphs.clear();
      this.ft?.fill(0);
      this.font = '';
    }
    this.cols = cols;
    this.cw = cw;
    this.forget();
    this.box.style.width = this.width + 'px';
    return true;
  }

  /** Whether rows must match a textarea's. Returns true if that changed (rows must be recomputed). */
  setExact(exact: boolean) {
    if (exact === this.exact) return false;
    this.exact = exact;
    this.forget();
    return true;
  }

  /**
   * The browser wrapped ASCII text differently from the arithmetic (it lacks
   * `line-break: anywhere`): measure every line from now on.
   */
  distrust() {
    if (!this.trust) return false;
    this.trust = false;
    this.forget();
    return true;
  }

  /**
   * Fonts finished loading. Rows that must match a textarea are measured
   * afresh; otherwise only the glyphs learned so far are re-measured (on the
   * canvas), and rows recomputed only if one of them changed width noticeably.
   * True if rows must be recomputed.
   */
  fontsLoaded(): boolean {
    if (this.exact || !this.ctx || !this.font) {
      this.reset();
      return true;
    }
    const x = this.ctx;
    x.font = this.font;
    let changed = false;
    for (const [c, w] of this.glyphs) {
      const n = x.measureText(String.fromCodePoint(c)).width + 0.05;
      if (Math.abs(n - w) > 0.01) this.glyphs.set(c, n);
      // A font swapped for one of nearly the same widths moves no break that matters here.
      if (Math.abs(n - w) >= 0.2) changed = true;
    }
    this.ft?.fill(0);
    if (changed) this.forget();
    return changed;
  }

  /** Forgets measurements (the code font arrived, so glyph widths changed). */
  reset() {
    this.cols = 0;
    this.cw = 0;
    this.glyphs.clear();
    this.ft?.fill(0);
    this.across = null;
    this.forget();
  }

  /**
   * Rows taken by each line `text[A[i], B[i])`. Lines the arithmetic can't
   * size are measured together. Also sets `odd`. With an `edit`, `lines` can
   * say which lines [lo, hi) it rewrote (the others only moved): no comparing
   * every line with the last call's to find them. (See `recycle`.)
   */
  rows(text: Src, A: Int32Array, B: Int32Array, edit?: readonly [number, number, number], lines?: readonly [number, number]): Int32Array {
    const n = A.length;
    this.flip ^= 1;
    const f = this.flip;
    const out = this.recycle && this.outs[f]?.length === n ? this.outs[f].fill(0) : (this.outs[f] = new Int32Array(n));
    const odd = this.recycle && this.odds[f]?.length === n ? this.odds[f].fill(0) : (this.odds[f] = new Uint8Array(n));
    this.odd = odd;
    const cols = this.cols;
    if (!cols) return out.fill(1);
    // An edit changes a few lines: lines before and after it (same text, same
    // place) keep their rows from last time, so typing costs no more in a
    // big document.
    let lo = 0;
    let hi = n;
    const last = this.last;
    /** Long lines whose oddness follows from the lines they were and the edit (no scanning them): 0 or 1, else -1. */
    let inherit = -1;
    if (last) {
      const old = last.text;
      let p: number;
      let q: number;
      // A known edit `[a, oldEnd, newEnd)` spares comparing the texts (two passes over the document). One of
      // all of a text as long as before says nothing: it may be the same text (laid out again).
      const told = !!edit && edit[0] >= 0 && edit[0] <= edit[1] && edit[0] <= edit[2] && edit[1] <= old.length && edit[2] <= text.length && text.length - old.length === edit[2] - edit[1] && !(edit[0] === 0 && edit[2] === text.length && old.length === text.length);
      if (told) {
        p = edit![0];
        q = text.length - edit![2];
      } else if (old === text) {
        p = text.length;
        q = 0;
      } else {
        p = samePrefix(old, text);
        q = sameSuffix(old, text, Math.min(old.length, text.length) - p);
      }
      this.diff = { old, text, p, q };
      if (p < Math.min(old.length, text.length) || old.length !== text.length) this.version(old, text, p, q);
      const m = last.A.length;
      const d = text.length - old.length;
      const dk = n - m;
      if (told && lines && lines[0] >= 0 && lines[0] <= lines[1] && lines[1] <= n && lines[1] - dk >= lines[0] && lines[1] - dk <= m) {
        lo = lines[0];
        hi = lines[1];
      } else {
        while (lo < n && lo < m && B[lo] < p && A[lo] === last.A[lo] && B[lo] === last.B[lo]) lo++;
        while (hi > lo && hi - 1 - dk >= lo && hi - 1 - dk < m && A[hi - 1] >= text.length - q && A[hi - 1] - d === last.A[hi - 1 - dk] && B[hi - 1] - d === last.B[hi - 1 - dk]) hi--;
      }
      out.set(last.out.subarray(0, lo));
      odd.set(last.odd.subarray(0, lo));
      out.set(last.out.subarray(hi - dk, m), hi);
      odd.set(last.odd.subarray(hi - dk, m), hi);
      // Lines [lo, hi) are lines [lo, hi - dk) edited: long ones hold other text if those did or the edit
      // brought some (or, rarely, until the line is next laid out afresh, held some it deleted). Only
      // where line counts show no fold opened or closed, and the views draw every row (they break such
      // lines the same either way; a textarea's rows are measured exactly).
      if (told && !this.exact && hi > lo && dk === breaksIn(text, edit![0], edit![2]) - breaksIn(old, edit![0], edit![1])) {
        inherit = nonAscii(text, edit![0], edit![2]) >= 0 ? 1 : 0;
        for (let k = lo; k < hi - dk && !inherit; k++) inherit = last.odd[k] ? 1 : 0;
      }
    }
    if (!last) {
      this.diff = null;
      this.ver++;
    }
    this.verText = text;
    // (A string's tab, looked for over 100 MB, took 0.1 s in Firefox: the same text keeps its answer.)
    const tabs = typeof text !== 'string' ? text.tabs : last?.text === text ? last.tabs : this.told?.text === text ? this.told.tabs : text.indexOf('\t') !== -1;
    this.last = { text, A, B, out, odd, tabs };
    // (Lines cut in another text would keep it alive.)
    if (text !== this.cutText) {
      this.cutLines = [];
      this.cutText = text;
    }
    if (!this.trust) odd.fill(1, lo, hi);
    else {
      const long = (k: number) => inherit >= 0 && B[k] - A[k] > LONG_LINE;
      for (let k0 = lo; k0 < hi; ) {
        if (long(k0)) {
          odd[k0++] = inherit;
          continue;
        }
        let k1 = k0 + 1;
        while (k1 < hi && !long(k1)) k1++;
        // Lines [k0, k1): one search from match to match.
        const end = B[k1 - 1];
        let i = k0;
        for (let p = nonAscii(text, A[k0], end); p >= 0; ) {
          while (i < k1 && B[i] <= p) i++;
          if (i === k1) break;
          // A character in hidden (folded) lines doesn't count.
          if (p < A[i]) p = nonAscii(text, A[i], end);
          else {
            odd[i] = 1;
            p = nonAscii(text, B[i], end);
          }
        }
        k0 = k1;
      }
    }
    const lead = this.lead;
    // Whole documents prune counts of lines that are gone; edits only add. Only counts that were measured
    // are kept: one found as cheaply again isn't (a million lines of a big document held a million strings).
    const keep = lo === 0 && hi === n ? new Map<string, number>() : this.sized;
    const unsized: number[] = [];
    // Rows drawn by these views needn't match a textarea: a line a quarter of a row long can't wrap (no
    // character but the widest few is over four cells), so isn't measured.
    const quarter = this.exact ? -1 : cols >> 2;
    for (let k = lo; k < hi; k++) {
      const a = A[k];
      const b = B[k];
      if (!odd[k]) {
        const cells = tabs ? asciiCells(text, a, b, lead) : b - a;
        // A tab mid-line, or indentation tabs that overflow the first row, wrap their own way.
        if (!tabs || (cells >= 0 && (lead[0] === lead[1] || lead[0] < cols))) {
          out[k] = asciiRows(cells, cols);
          continue;
        }
        odd[k] = 1;
      }
      if (!this.exact && b - a > LONG_LINE) {
        // (Not split between the halves of a pair, which would read as a lone surrogate.)
        let e = Math.min(b, a + BINARY_LOOK);
        if (e < b && (text.charCodeAt(e - 1) & 0xfc00) === 0xd800) e--;
        if (BINARY.test(text.slice(a, e))) {
          odd[k] = CUT;
          out[k] = this.cuts(text, a, b).n;
        } else out[k] = this.rowsOf(text, a, b).length;
        continue;
      }
      const s = text.slice(a, b);
      if (!this.exact && BINARY.test(s)) {
        odd[k] = CUT;
        out[k] = this.cut(s, 0, s.length);
        continue;
      }
      if (s.length <= quarter && !FORCED.test(s) && !WIDE.test(s)) {
        out[k] = 1;
        continue;
      }
      let r = this.sized.get(s) ?? keep.get(s);
      // A long line is laid out once, as the mirror its rows are later read from.
      if (r === undefined && s.length > LONG_LINE) r = this.mirror(s).rows;
      if (r === undefined) unsized.push(k);
      else {
        out[k] = r;
        keep.set(s, r);
      }
    }
    if (unsized.length) {
      const lines = unsized.map((k) => text.slice(A[k], B[k]));
      this.learn(lines);
      const big: number[] = [];
      for (let j = 0; j < lines.length; j++) {
        if (this.fits(lines[j])) out[unsized[j]] = 1;
        else big.push(j);
      }
      const sizes = this.measure(big.map((j) => lines[j]));
      big.forEach((j, x) => {
        out[unsized[j]] = sizes[x];
        keep.set(lines[j], sizes[x]);
      });
    }
    this.sized = keep;
    // Edits only add counts: start afresh (pruning) once enough have piled up.
    if (keep.size > n + 5000) this.last = null;
    return out;
  }

  /**
   * Offset (from the line start) of the first character on row `r` of the
   * line `text[a, b)`. `odd` as set by `rows()`. `cols`: the row width the
   * rows were counted at (a font or a width may have changed it since).
   */
  rowStart(text: Src, a: number, b: number, r: number, odd: number, cols = this.cols): number {
    if (r <= 0) return 0;
    if (!odd) {
      const [cells, chars] = leadOf(text, a, b, this.lead);
      return Math.min(b - a, r * cols - cells + chars);
    }
    if (odd === CUT && !this.exact) {
      const c = this.cuts(text, a, b);
      if (r >= c.n) return b - a;
      const k = lastAtMost(c.row, r);
      return c.off[k] + (r - c.row[k]) * c.per;
    }
    if (!this.exact && b - a > LONG_LINE) {
      const st = this.rowsOf(text, a, b);
      return r < st.length ? st.get(r) : b - a;
    }
    const m = this.mirror(text.slice(a, b));
    return r >= m.rows ? b - a : this.probe(m, b - a, r);
  }

  /** Row of the line `text[a, b)` (taking `rows` rows) that shows offset `off`: the caret before that character. */
  rowAt(text: Src, a: number, b: number, off: number, odd: number, rows: number): number {
    if (rows <= 1 || off <= a) return 0;
    if (!odd) {
      const [cells, chars] = leadOf(text, a, b, this.lead);
      // Tabs only ever indent the first row (see rows()).
      const col = cells === chars ? off - a : off - a <= chars ? 0 : cells + off - a - chars;
      return Math.min(rows - 1, Math.floor(col / this.cols));
    }
    if (odd === CUT && !this.exact) {
      const c = this.cuts(text, a, b);
      const k = lastAtMost(c.off, off - a);
      // (A row a pair's half made one longer ends where the next run starts.)
      return Math.min(c.row[k] + Math.floor((off - a - c.off[k]) / c.per), (k + 1 < c.row.length ? c.row[k + 1] : c.n) - 1);
    }
    if (!this.exact && b - a > LONG_LINE) return this.rowsOf(text, a, b).floor(off - a);
    const m = this.mirror(text.slice(a, b));
    const o = Math.min(b - a - 1, off - a);
    return Math.min(m.rows - 1, this.probeRow(m, o, m.el.getBoundingClientRect().top));
  }

  // ── Measuring ──────────────────────────────────────────────────────────

  /** Learns the width of each code point in `lines` not seen yet (one layout). */
  private learn(lines: string[]) {
    const todo: number[] = [];
    for (const s of lines) {
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if ((c >= 32 && c < 127) || c === 9) continue;
        if (c >= 0xd800 && c < 0xdc00) {
          c = s.codePointAt(i) as number;
          if (c > 0xffff) i++;
        }
        if (this.glyphs.has(c)) continue;
        this.glyphs.set(c, 0);
        todo.push(c);
        if (JOINS.test(String.fromCodePoint(c))) {
          this.joins.add(c);
          // (U+FE0F is in breakIn's tables before it is learned: it now never starts a row.)
          if (c < 0x10000 && this.ft) this.ft[c] = 0;
        }
      }
    }
    if (!todo.length) return;
    // Measured on a canvas in the same fonts: no layout (a forced one would also lay
    // out whatever else just changed on the page). A hair over, as both uses need.
    const x = (this.ctx ??= document.createElement('canvas').getContext('2d'));
    if (!x) return;
    if (!this.font) {
      // Read once per cell width (a style read here would restyle the whole changed page).
      const cs = getComputedStyle(this.scratch);
      this.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    }
    x.font = this.font;
    for (const c of todo) this.glyphs.set(c, x.measureText(String.fromCodePoint(c)).width + 0.05);
  }

  /**
   * Rows of the binary line `t[a, b)` (see BINARY): perRow code units each, two cells or less a glyph (so a row
   * never runs over, a rare wider glyph aside), a row ended after a character that ends one, never between the
   * halves of a surrogate pair. Counted, reading only where a row may end; where rows stop running perRow
   * apart from the line start (a row ended early, or one longer by a pair's half) is pushed to `off` and `row`
   * if given (see Cuts).
   */
  private cut(t: Src, a: number, b: number, off?: number[], row?: number[]): number {
    const per = Math.max(1, this.cols >> 1);
    const len = b - a;
    let n = 0;
    for (let x = 0; ; ) {
      const f = search(FORCED_ALL, t, a + x, b);
      const end = f < 0 ? len : f - a + 1;
      for (;;) {
        n++;
        let y = x + per;
        if (y >= end) break;
        if ((t.charCodeAt(a + y) & 0xfc00) === 0xdc00 && (t.charCodeAt(a + y - 1) & 0xfc00) === 0xd800) {
          if (++y >= end) break;
          off?.push(y);
          row?.push(n);
        }
        x = y;
      }
      if (end >= len) return n;
      x = end;
      off?.push(x);
      row?.push(n);
    }
  }

  /** Binary lines cut for lookups since rows() was last given another text, the latest first. */
  private cutLines: Cuts[] = [];
  private cutText: Src | null = null;

  /** The rows of the binary line `t[a, b)` (see cut): cut once for the text and row width, then looked up. */
  private cuts(t: Src, a: number, b: number): Cuts {
    const per = Math.max(1, this.cols >> 1);
    const all = this.cutLines;
    for (const c of all) if (c.a === a && c.b === b && c.per === per && c.t === t) return c;
    const off = [0];
    const row = [0];
    const n = this.cut(t, a, b, off, row);
    const c = { t, a, b, per, n, off: Int32Array.from(off), row: Int32Array.from(row) };
    if (all.length >= CUTS) all.pop();
    all.unshift(c);
    return c;
  }

  private ctx: CanvasRenderingContext2D | null = null;
  private font = '';

  /**
   * Does `s` surely fit one row? Glyphs measured alone are at least as wide
   * as in context (Arabic letters join narrower, marks stack); a variation
   * selector can turn the character before it into a wider emoji.
   */
  private fits(s: string) {
    if (FORCED.test(s)) return false;
    const cw = this.cw;
    const max = this.width * 0.96 - cw;
    let w = 0;
    for (let i = 0; i < s.length && w <= max; i++) {
      let c = s.charCodeAt(i);
      if (c >= 32 && c < 127) w += cw;
      else if (c === 9) w += TAB * cw;
      else if (c === 0xfe0f) w += 2.5 * cw;
      else {
        if (c >= 0xd800 && c < 0xdc00) {
          c = s.codePointAt(i) as number;
          if (c > 0xffff) i++;
        }
        w += this.glyphs.get(c) ?? Infinity;
      }
    }
    return w <= max;
  }

  /** Rows of each line, laid out together. */
  private measure(lines: string[]): number[] {
    if (!lines.length) return [];
    const els = lines.map((s) => {
      const d = document.createElement('div');
      d.textContent = s;
      return d;
    });
    this.scratch.replaceChildren(fragment(els));
    const out = els.map((d) => Math.max(1, Math.round(d.offsetHeight / this.lh)));
    this.scratch.textContent = '';
    return out;
  }

  /** A laid-out copy of the line `s`, for probing where its rows start. */
  private mirror(s: string): Mirror {
    const hit = this.mirrors.get(s);
    if (hit) {
      this.mirrors.delete(s);
      this.mirrors.set(s, hit);
      return hit;
    }
    // Typing in a long line: patch the copy of its previous text, so the
    // browser reshapes only around the edit (as it does for the textarea).
    let m: Mirror | undefined;
    for (const x of this.mirrors.values()) m = x;
    if (!m || !this.patch(m, s)) {
      const el = document.createElement('div');
      const [nodes, at] = chunks(s, 0, s.length);
      el.appendChild(fragment(nodes));
      this.box.appendChild(el);
      m = { text: s, el, nodes, at: Int32Array.from(at), rows: 0, starts: new Int32Array(0) };
    } else this.mirrors.delete(m.text);
    m.text = s;
    const rows = Math.max(1, Math.round(m.el.offsetHeight / this.lh));
    const starts = new Int32Array(rows).fill(-1);
    // Rows that start before the edit start where they did.
    const keep = m.rows ? Math.min(rows, m.starts.length) : 0;
    for (let r = 0; r < keep; r++) if (m.starts[r] >= 0 && m.starts[r] < this.edit) starts[r] = m.starts[r];
    starts[0] = 0;
    m.rows = rows;
    m.starts = starts;
    this.mirrors.set(s, m);
    if (this.mirrors.size > MIRRORS) {
      const [oldest, old] = this.mirrors.entries().next().value as [string, Mirror];
      old.el.remove();
      this.mirrors.delete(oldest);
    }
    return m;
  }

  /** Version of the text given to rows(); entries of the last one that the edit didn't touch carry over. */
  private ver = 0;
  /** The text of version `ver` (the same object rows() was given: comparing with it costs nothing then). */
  private verText: Src = '';

  /**
   * The text changed from `old` to `text` (same first `p` and last `q`
   * characters): a new version. Remembered lines wholly before the edit keep
   * their rows as they are, lines wholly after it shifted.
   */
  private version(old: Src, text: Src, p: number, q: number) {
    const prev = this.ver++;
    const oldEnd = old.length - q;
    const d = text.length - old.length;
    for (let k = 0; k < this.sums.length; k++) {
      const e = this.sums[k];
      if (e.v !== prev) continue;
      let next: SumEntry | null = null;
      if (e.b < p) next = { ...e, t: text, v: this.ver };
      else if (e.a > oldEnd) next = { ...e, t: text, a: e.a + d, b: e.b + d, v: this.ver };
      if (!next) continue;
      // (lastSum stays the old entry: the edited line's rows are worked out from it, see rowsOf.)
      for (const job of this.pending) if (job.e === e) job.e = next;
      this.sums[k] = next;
    }
  }

  /** The last line `rowsOf` added up: found again by identity, and the start of the next one (see `rowsOf`). */
  private lastSum: SumEntry | null = null;

  /**
   * Row starts of the long line `t[a, b)`, breaking where its glyphs' widths
   * (each at least as wide as in context, see `fits`) fill a row; never inside
   * a character's cluster or a flag. For views that draw every row themselves.
   * Typing changes one line a character at a time: its rows before the edit
   * are kept, and once a row after it starts where an old row did (shifted),
   * the rest are the old rows, so a key costs a row or two, not the line.
   * Never copies the line, nor keys anything by its text: the edit comes from
   * `rows()`, else the line is compared with the last one in place. As runs
   * shared with the line's earlier rows (see Starts).
   */
  private rowsOf(t: Src, a: number, b: number): Starts {
    const last = this.lastSum;
    // (By version, not by text. A text rows() wasn't given, from a direct caller, is a version of its own.)
    if (t !== this.verText) {
      this.ver++;
      this.verText = t;
    }
    if (last && last.v === this.ver && last.a === a && last.b === b) return last.st;
    for (const e of this.sums) if (e.v === this.ver && e.a === a && e.b === b) return (this.lastSum = e).st;
    const len = b - a;
    // The old rows: kept before the edit; after `tail` (the edit's end) a row start `d` past an old one resynchronizes.
    let old: Starts | null = null;
    let exact = 0;
    let p = 0;
    let edit = 0;
    let tail = Infinity;
    let d = 0;
    const diff = this.diff;
    if (last && diff && diff.text === t && diff.old === last.t) {
      const dt = t.length - last.t.length;
      const oldEnd = last.t.length - diff.q;
      // An edit wholly before or after the line leaves its rows as they were.
      if (oldEnd < last.a && a === last.a + dt && b === last.b + dt) return this.keepSum(t, a, b, last.st, last.exact, last).st;
      if (diff.p > last.b && a === last.a && b === last.b) return this.keepSum(t, a, b, last.st, last.exact, last).st;
      // Same start: the rows before the edit stand (a line split or joined there keeps them too). The
      // line that started there may be any of the remembered ones (joining two: the first).
      const base = a === last.a ? last : this.sums.find((e) => e.a === a && e.v === last.v);
      if (base && diff.p >= a) {
        old = base.st;
        exact = base.exact;
        p = Math.min(diff.p, base.b) - a;
        if (base === last && b - last.b === dt && oldEnd <= last.b) {
          tail = t.length - diff.q - a;
          d = dt;
        }
      }
      // Rows near the edit are found at once (the view and the caret are there), however they start.
      edit = Math.max(0, diff.p - a);
    } else if (last) {
      const ol = last.b - last.a;
      const m = Math.min(ol, len);
      p = prefixAt(last.t, last.a, t, a, m);
      if (p === m && ol === len) return this.keepSum(t, a, b, last.st, last.exact, last).st;
      old = last.st;
      exact = last.exact;
      tail = len - suffixAt(last.t, last.b, t, b, m - p);
      d = len - ol;
    }
    // Estimated rows (see below) can't anchor a resynchronization.
    if (old && exact < old.length) tail = Infinity;
    // The first old row starting at or after `p` (rows are in order: no walking the line's rows to it).
    const keep = old ? old.lower(p, 1, Math.min(old.length, exact)) : 1;
    // Rows `[0, keep)` are the old ones; `starts` are new; then old rows from `from`, shifted by `d`.
    const starts: number[] = [];
    let from = -1;
    let j = keep;
    const at = old ? old.get(keep - 1) : 0;
    const brk = (x: number) => {
      starts.push(x);
      if (x < tail || !old) return false;
      while (j < old.length && old.get(j) + d < x) j++;
      if (j >= old.length || old.get(j) + d !== x) return false;
      from = j + 1;
      return true;
    };
    const st: BreakState = { i: at, run: 0, lastStart: at, w: 0, joined: false, flags: 0, forced: false };
    // Rows near the edit now (the view and the caret are there). With no old rows to meet again soon after
    // (a huge line split, joined or new), the rest when idle (see refine).
    const near = Math.max(p, at, edit);
    const stop = len - near > LAZY_ROWS && tail - near > LAZY_ROWS ? near + LAZY_ROWS : len;
    const resynced = this.breakRows(t, a, len, st, stop, brk, (x) => void starts.push(x));
    const runs = old ? old.part(0, keep, 0) : [{ a: Int32Array.of(0), i: 0, n: 1, d: 0 }];
    if (!resynced && st.i < len) {
      // Estimated: rows as long as those found so far are on average (whole rows of printable ASCII
      // without enough of them), from the last exact start.
      const n = starts.length;
      const full = Math.max(1, Math.floor(n >= 16 ? (st.lastStart - starts[0]) / (n - 1) : this.width / this.cw));
      const more = Math.max(0, Math.ceil((len - st.lastStart) / full) - 1);
      const head = keep + n;
      const est = new Int32Array(n + more);
      est.set(starts);
      for (let k = 0; k < more; k++) est[n + k] = st.lastStart + (k + 1) * full;
      runs.push({ a: est, i: 0, n: est.length, d: 0 });
      const e = this.keepSum(t, a, b, Starts.join(runs), head);
      this.refine(e, st);
      return e.st;
    }
    runs.push({ a: Int32Array.from(starts), i: 0, n: starts.length, d: 0 });
    if (old && from >= 0) old.part(from, old.length, d, runs);
    const out = Starts.join(runs);
    return this.keepSum(t, a, b, out, out.length).st;
  }

  /**
   * Breaks `t[a, a + len)` into rows from state `s` until the line ends, `stop`
   * characters in, or `brk` (told each row start) returns true. True if it did.
   * A document of pieces is read a piece at a time (see Doc.each).
   */
  private breakRows(src: Src, a: number, len: number, s: BreakState, stop: number, brk: (x: number) => boolean, push: (x: number) => void): boolean {
    const flat = flatOf(src);
    if (flat !== null) return this.breakIn(flat, a, len, len, s, stop, brk, push);
    let done = false;
    let at = s.i;
    (src as Doc).each(a + s.i, a + Math.min(len, stop), (x, i, j) => {
      // (Line offset `at` is x[i]: the line starts at x[i - at].)
      done = this.breakIn(x, i - at, at + j - i, len, s, stop, brk, push);
      at += j - i;
      return done;
    });
    return done;
  }

  /**
   * breakRows on the text `x` holding the line from `x[base]`, up to line offset `end` (where it
   * or the piece of it in `x` ends). Printable ASCII is counted a run at a time (one cell a character);
   * other glyphs' widths and flags in the BMP come from tables, filled as they are met (see `cache`).
   */
  private breakIn(x: string, base: number, end: number, len: number, s: BreakState, stop: number, brk: (x: number) => boolean, push: (x: number) => void): boolean {
    const cw = this.cw;
    const max = this.width;
    /** Printable ASCII characters a row holds from its start. */
    const full = Math.floor(max / cw);
    const F = (this.ft ??= new Uint8Array(0x10000));
    const W = (this.wt ??= new Float32Array(0x10000));
    const until = Math.min(end, stop);
    let { i, lastStart, w, joined, flags, forced } = s;
    let done = false;
    while (i < until && !done) {
      let c = x.charCodeAt(base + i);
      // (Printable ASCII: c - 32 < 95, unsigned.)
      if (((c - 32) >>> 0) < 95 && !joined) {
        // A run of printable ASCII is one cell a character: its breaks are arithmetic (a run cut at
        // `stop` goes on from there just the same).
        // (Short runs, as in text mixing scripts, are read here; a long one natively, once: where it ends past
        // `stop` is kept for the next call.)
        let e = i + 1;
        if (i < s.run) e = Math.min(s.run, until);
        else {
          const short = Math.min(until, i + 16);
          for (let o = base + e; e < short && ((x.charCodeAt(o) - 32) >>> 0) < 95; o++) e++;
          if (e === short && e < until) {
            RUN.lastIndex = base + e;
            if (RUN.test(x)) {
              const r = Math.min(RUN.lastIndex - base, end);
              if (r > until) s.run = r;
              e = Math.min(r, until);
            }
          }
        }
        // (A row can already be over full: nothing breaks before a joined character.)
        let k = i + Math.max(0, Math.floor((max - w) / cw));
        if (k === lastStart) k++;
        if (k < e) {
          for (; k < e && !done; k += full) done = brk((lastStart = k));
          w = (e - lastStart) * cw;
        } else w += (e - i) * cw;
        flags = 0;
        i = e;
        continue;
      }
      let n = 1;
      let g: number;
      let join = joined;
      if (c === 9) g = tabTo(w, cw);
      else if (c >= 32 && c < 127) g = cw;
      else {
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < end) {
          const lo = x.charCodeAt(base + i + 1);
          if (lo >= 0xdc00 && lo < 0xe000) {
            c = (c - 0xd800) * 0x400 + lo - 0xdc00 + 0x10000;
            n = 2;
          }
        }
        if (c < 0x10000) {
          let f = F[c];
          if (!f) f = this.cache(c);
          g = W[c];
          if (f & 1) join = true;
          if (f & 2) forced = true;
          flags = 0;
        } else {
          g = this.glyphs.get(c) ?? this.glyph(c);
          if (this.joins.has(c)) join = true;
          // Regional indicators pair into flags.
          if (c >= 0x1f1e6 && c <= 0x1f1ff) join ||= flags++ % 2 === 1;
          else flags = 0;
        }
      }
      if (!join && w + g > max && i > lastStart) {
        // (A flag's half can't resynchronize: which half it is depends on what came before.)
        lastStart = i;
        if (flags) push(i);
        else done = brk(i);
        w = 0;
        if (c === 9) g = tabTo(0, cw);
      }
      w += g;
      joined = c === 0x200d;
      i += n;
      if (forced && i < len && !done) {
        done = brk((lastStart = i));
        w = 0;
      }
      forced = false;
    }
    s.i = i;
    s.lastStart = lastStart;
    s.w = w;
    s.joined = joined;
    s.flags = flags;
    s.forced = forced;
    return done;
  }

  /** BMP glyph widths for breakIn, and flags: 4 looked up (else 0), 1 never starts a row, 2 ends one. */
  private wt: Float32Array | null = null;
  private ft: Uint8Array | null = null;

  /** Puts BMP code point `c` in the tables (learning it if new); its flags. */
  private cache(c: number) {
    // (A variation selector can turn the character before it into a wider emoji: it counts for that, and may
    // start a row until a line holding it is measured, as it always did here.)
    const g = c === 0xfe0f ? 2.5 * this.cw : (this.glyphs.get(c) ?? this.glyph(c));
    (this.wt as Float32Array)[c] = g;
    return ((this.ft as Uint8Array)[c] = 4 | (this.joins.has(c) ? 1 : 0) | (c === 11 || c === 12 || c === 0x85 || c === 0x2028 || c === 0x2029 ? 2 : 0));
  }

  /** Lines whose rows past an edit are estimated, finished a slice at a time when the page is idle. */
  private pending: { e: SumEntry; s: BreakState; starts: number[] }[] = [];
  private refineTimer = 0;
  /** Called when estimated rows were replaced by exact ones (the view relayouts). */
  onRows: (() => void) | null = null;

  private refine(e: SumEntry, s: BreakState) {
    this.pending.push({ e, s, starts: [] });
    clearTimeout(this.refineTimer);
    this.refineTimer = setTimeout(this.refineStep, 50) as unknown as number;
  }

  /** Is `e` still the entry for its line (no edit has replaced it)? */
  private live(e: SumEntry) {
    return this.lastSum === e || this.sums.includes(e);
  }

  /** Advances `job` by up to `budget` ms (Infinity: to the end). True when its rows are all exact. */
  private advance(job: { e: SumEntry; s: BreakState; starts: number[] }, budget: number) {
    const { e, s } = job;
    const len = e.b - e.a;
    const until = performance.now() + budget;
    const add = (x: number) => void job.starts.push(x);
    while (s.i < len && performance.now() < until) this.breakRows(e.t, e.a, len, s, s.i + 20_000, (x) => (add(x), false), add);
    if (s.i < len) return false;
    const runs = e.st.part(0, e.exact, 0);
    runs.push({ a: Int32Array.from(job.starts), i: 0, n: job.starts.length, d: 0 });
    const st = Starts.join(runs);
    e.st = st;
    e.exact = st.length;
    // The last rows() call counted the line's estimated rows, and the next one reuses its counts.
    const last = this.last;
    if (last && last.text === e.t) {
      const A = last.A;
      let lo = 0;
      let hi = A.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (A[mid] <= e.a) lo = mid;
        else hi = mid - 1;
      }
      if (A[lo] === e.a && last.B[lo] === e.b) last.out[lo] = st.length;
    }
    return true;
  }

  private refineStep = () => {
    let changed = false;
    const until = performance.now() + 8;
    while (this.pending.length && performance.now() < until) {
      const job = this.pending[0];
      // Superseded (an edit made a new entry, with its own job if it needs one).
      if (!this.live(job.e)) {
        this.pending.shift();
        continue;
      }
      if (!this.advance(job, until - performance.now())) break;
      this.pending.shift();
      changed = true;
    }
    if (this.pending.length) this.refineTimer = setTimeout(this.refineStep, 0) as unknown as number;
    if (changed) this.onRows?.();
  };

  /** Finishes estimated rows now (tests; a view about to need them all). */
  settle() {
    clearTimeout(this.refineTimer);
    let changed = false;
    for (const job of this.pending) if (this.live(job.e) && this.advance(job, Infinity)) changed = true;
    this.pending = [];
    if (changed) this.onRows?.();
  }

  /** Remembers `st` as the row starts of `t[a, b)` (see `rowsOf`); rows from `exact` on are estimated. `from`: the entry it replaces, whose pending refinement it takes over. */
  private keepSum(t: Src, a: number, b: number, st: Starts, exact: number, from?: SumEntry): SumEntry {
    const e: SumEntry = { t, a, b, st, exact, v: this.ver };
    if (from) for (const job of this.pending) if (job.e === from) job.e = e;
    this.lastSum = e;
    this.sums.push(e);
    if (this.sums.length > SUMS) this.sums.shift();
    return e;
  }

  /** Width of code point `c`, measured now (see `learn`). */
  private glyph(c: number) {
    this.learn([String.fromCodePoint(c)]);
    return this.glyphs.get(c) ?? this.cw;
  }

  /** Where the last patch changed its mirror (rows starting before it are kept). */
  private edit = 0;

  /** Turns mirror `m` into a copy of `s` if they differ by a small edit; false if they don't. */
  private patch(m: Mirror, s: string): boolean {
    const old = m.text;
    const p = samePrefix(old, s);
    const q = sameSuffix(old, s, Math.min(old.length, s.length) - p);
    if (old.length - p - q > PATCH || s.length - p - q > PATCH) return false;
    // Re-chunk the text nodes around the edit (one character either side, for clusters).
    const at = m.at;
    const find = (o: number) => {
      let lo = 0;
      let hi = at.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (at[mid] <= o) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const i = find(Math.max(0, p - 1));
    const j = find(Math.min(old.length - 1, old.length - q));
    const from = at[i];
    const to = at[j] + m.nodes[j].length + s.length - old.length;
    const [nodes, starts] = chunks(s, from, to);
    const next = m.nodes[j + 1] ?? null;
    for (let k = i; k <= j; k++) m.nodes[k].remove();
    m.el.insertBefore(fragment(nodes), next);
    const d = s.length - old.length;
    const tail = Array.from(at.subarray(j + 1), (x) => x + d);
    m.nodes.splice(i, j - i + 1, ...nodes);
    m.at = Int32Array.from([...at.subarray(0, i), ...starts, ...tail]);
    this.edit = Math.max(0, p - 16);
    return true;
  }

  /**
   * Is a row that breaks before `t[i]` drawn by the browser with the letters
   * either side still joined? Only where this browser joins across soft breaks:
   * a copy drawn row by row then needs joiners (U+200D) at the cut to match.
   */
  joinsAt(t: string, i: number): boolean {
    if (i <= 0 || i >= t.length || !JOINS_PREV.test(String.fromCodePoint(t.codePointAt(i) as number))) return false;
    // The letter before, past any marks (they're transparent to joining).
    let k = i;
    let c: string;
    do {
      k -= (t.charCodeAt(k - 1) & 0xfc00) === 0xdc00 && k > 1 ? 2 : 1;
      c = String.fromCodePoint(t.codePointAt(k) as number);
    } while (k > 0 && /[\p{Mn}\p{Me}]/u.test(c));
    if (!JOINS_NEXT.test(c)) return false;
    this.across ??= this.joinsAcrossBreaks();
    return this.across;
  }

  /**
   * Gecko shapes a word before breaking it into rows, so its letters stay
   * joined across a soft break; Blink and WebKit shape each row on its own.
   * No measurement shows it (the forms can share one width), hence the check.
   */
  private joinsAcrossBreaks() {
    return typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none');
  }

  /** Drops every row count and break (they depend on the width, the fonts and the mode). */
  private forget() {
    this.sized.clear();
    this.last = null;
    for (const m of this.mirrors.values()) m.el.remove();
    this.mirrors.clear();
    this.sums.length = 0;
    this.lastSum = null;
    this.cutLines = [];
    this.diff = null;
    this.pending = [];
    clearTimeout(this.refineTimer);
  }

  /** First offset on row `r` (binary search between the nearest rows already probed). */
  private probe(m: Mirror, len: number, r: number): number {
    const st = m.starts;
    if (st[r] >= 0) return st[r];
    const top = m.el.getBoundingClientRect().top;
    let lo = r - 1;
    while (st[lo] < 0) lo--;
    let hi = r + 1;
    while (hi < m.rows && st[hi] < 0) hi++;
    let a = st[lo] + 1;
    let b = hi < m.rows ? st[hi] : len;
    // Rows are probed in order while drawing: gallop from the previous row.
    if (hi >= m.rows && lo === r - 1) {
      const step = 2 * Math.ceil(len / m.rows) + 1;
      let c = Math.min(len, a + step);
      while (c < len && this.probeRow(m, c, top) < r) {
        a = c + 1;
        c = Math.min(len, c + step);
      }
      b = c;
    }
    while (a < b) {
      const mid = (a + b) >> 1;
      if (this.probeRow(m, mid, top) >= r) b = mid;
      else a = mid + 1;
    }
    st[r] = a;
    return a;
  }

  /** Row of the character at offset `o` of a mirror whose top is `top`. */
  private probeRow(m: Mirror, o: number, top: number): number {
    const at = m.at;
    let lo = 0;
    let hi = at.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= o) lo = mid;
      else hi = mid - 1;
    }
    const node = m.nodes[lo];
    const k = o - at[lo];
    const rg = (this.range ??= document.createRange());
    rg.setStart(node, k);
    rg.setEnd(node, Math.min(node.length, k + 1));
    // WebKit puts an empty rect at the end of the previous row before a character that starts a row.
    const rects = rg.getClientRects();
    let rect = rects[rects.length - 1] ?? rg.getBoundingClientRect();
    for (const x of rects) {
      if (x.width) {
        rect = x;
        break;
      }
    }
    return Math.max(0, Math.floor(((rect.top + rect.bottom) / 2 - top) / this.lh));
  }
}
