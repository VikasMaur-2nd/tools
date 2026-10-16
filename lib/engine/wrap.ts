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
 *   broken by adding up its glyphs' widths, which is instant at any size.
 */

import { samePrefix } from './highlight';

/** Must match `tab-size` in CSS. */
const TAB = 4;
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
/** Long lines whose breaks were added up (see `sum`). */
const SUMS = 4;

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
export function leadOf(t: string, a: number, b: number, out = [0, 0]): number[] {
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
export function asciiCells(t: string, a: number, b: number, lead = [0, 0]): number {
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
function prefixAt(x: string, xa: number, y: string, ya: number, max: number) {
  let p = 0;
  while (p + 4096 <= max && x.slice(xa + p, xa + p + 4096) === y.slice(ya + p, ya + p + 4096)) p += 4096;
  while (p < max && x.charCodeAt(xa + p) === y.charCodeAt(ya + p)) p++;
  return p;
}

/** Length of the common suffix of `x` before `xb` and `y` before `yb`, at most `max`. */
function suffixAt(x: string, xb: number, y: string, yb: number, max: number) {
  let q = 0;
  while (q + 4096 <= max && x.slice(xb - q - 4096, xb - q) === y.slice(yb - q - 4096, yb - q)) q += 4096;
  while (q < max && x.charCodeAt(xb - 1 - q) === y.charCodeAt(yb - 1 - q)) q++;
  return q;
}

/** Length of the common suffix of `x` and `y`, at most `max`. */
function sameSuffix(x: string, y: string, max: number) {
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
  /** Per line of the last `rows()` call: 1 where the browser decides the breaks. */
  odd = new Uint8Array(0);
  /** Rows must break exactly where a textarea's do (else long lines are summed: see `sum`). */
  exact: boolean;
  private cw = 0;
  private readonly lh: number;
  private readonly box: HTMLElement;
  private readonly scratch: HTMLElement;
  private sized = new Map<string, number>();
  private glyphs = new Map<number, number>();
  private mirrors = new Map<string, Mirror>();
  private sums: { t: string; a: number; b: number; st: Int32Array }[] = [];
  private joins = new Set<number>();
  /** Does this browser keep letters joined across a soft row break (Firefox does)? Measured once. */
  private across: boolean | null = null;
  private range: Range | null = null;
  private readonly lead = [0, 0];
  private trust = true;
  /** An edit announced by `edited()`, for the next `rows()` call. */
  private hint: readonly [number, number, number] | null = null;
  /** How the last `rows()` text differs from the one before: same first `p` and last `q` characters. */
  private diff: { old: string; text: string; p: number; q: number } | null = null;
  /** The last `rows()` call, whose unchanged lines the next one reuses. */
  private last: { text: string; A: Int32Array; B: Int32Array; out: Int32Array; odd: Uint8Array } | null = null;

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
    if (changed) this.forget();
    return changed;
  }

  /** Forgets measurements (the code font arrived, so glyph widths changed). */
  reset() {
    this.cols = 0;
    this.cw = 0;
    this.glyphs.clear();
    this.across = null;
    this.forget();
  }

  /**
   * Announces that the next `rows()` text is the last one with `[a, oldEnd)`
   * replaced by what is now `[a, newEnd)` (same as passing it to `rows()`).
   * Spares `rows()` and long-line breaking from comparing the texts.
   */
  edited(a: number, oldEnd: number, newEnd: number) {
    this.hint = [a, oldEnd, newEnd];
  }

  /**
   * Rows taken by each line `text[A[i], B[i])`. Lines the arithmetic can't
   * size are measured together. Also sets `odd`.
   */
  rows(text: string, A: Int32Array, B: Int32Array, edit?: readonly [number, number, number]): Int32Array {
    const n = A.length;
    const hint = edit ?? this.hint;
    this.hint = null;
    const out = new Int32Array(n);
    const odd = new Uint8Array(n);
    this.odd = odd;
    const cols = this.cols;
    if (!cols) return out.fill(1);
    // An edit changes a few lines: lines before and after it (same text, same
    // place) keep their rows from last time, so typing costs no more in a
    // big document.
    let lo = 0;
    let hi = n;
    const last = this.last;
    if (last) {
      const old = last.text;
      let p: number;
      let q: number;
      // A known edit `[a, oldEnd, newEnd)` spares comparing the texts (two passes over the document).
      if (hint && hint[0] >= 0 && hint[0] <= hint[1] && hint[0] <= hint[2] && hint[1] <= old.length && hint[2] <= text.length && text.length - old.length === hint[2] - hint[1]) {
        p = hint[0];
        q = text.length - hint[2];
      } else {
        p = samePrefix(old, text);
        q = sameSuffix(old, text, Math.min(old.length, text.length) - p);
      }
      this.diff = { old, text, p, q };
      const m = last.A.length;
      while (lo < n && lo < m && B[lo] < p && A[lo] === last.A[lo] && B[lo] === last.B[lo]) lo++;
      const d = text.length - old.length;
      const dk = n - m;
      while (hi > lo && hi - 1 - dk >= lo && hi - 1 - dk < m && A[hi - 1] >= text.length - q && A[hi - 1] - d === last.A[hi - 1 - dk] && B[hi - 1] - d === last.B[hi - 1 - dk]) hi--;
      out.set(last.out.subarray(0, lo));
      odd.set(last.odd.subarray(0, lo));
      out.set(last.out.subarray(hi - dk, m), hi);
      odd.set(last.odd.subarray(hi - dk, m), hi);
    }
    if (!last) this.diff = null;
    this.last = { text, A, B, out, odd };
    if (!this.trust) odd.fill(1, lo, hi);
    else if (lo < hi) {
      const end = B[hi - 1];
      NON_ASCII.lastIndex = A[lo];
      let i = lo;
      for (let m = NON_ASCII.exec(text); m && m.index < end; m = NON_ASCII.exec(text)) {
        const p = m.index;
        while (i < hi && B[i] <= p) i++;
        if (i === hi) break;
        // A character in hidden (folded) lines doesn't count.
        if (p < A[i]) NON_ASCII.lastIndex = A[i];
        else {
          odd[i] = 1;
          NON_ASCII.lastIndex = B[i];
        }
      }
    }
    const tabs = text.indexOf('\t') !== -1;
    const lead = this.lead;
    // Whole documents prune counts of lines that are gone; edits only add.
    const keep = lo === 0 && hi === n ? new Map<string, number>() : this.sized;
    const unsized: number[] = [];
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
        out[k] = this.sum(text, a, b).length;
        continue;
      }
      const s = text.slice(a, b);
      let r = this.sized.get(s) ?? keep.get(s);
      // A long line is laid out once, as the mirror its rows are later read from.
      if (r === undefined && s.length > LONG_LINE) r = this.mirror(s).rows;
      if (r === undefined) unsized.push(k);
      else {
        out[k] = r;
        keep.set(s, r);
      }
    }
    if (unsized.length && !this.exact) {
      // Rows drawn by these views needn't match a textarea: a line a quarter of a row long
      // can't wrap (no character but the widest few is over four cells), so isn't measured.
      const quarter = cols >> 2;
      let w = 0;
      for (const k of unsized) {
        const s = B[k] - A[k] <= quarter ? text.slice(A[k], B[k]) : '';
        if (s && !FORCED.test(s) && !WIDE.test(s)) {
          out[k] = 1;
          keep.set(s, 1);
        } else unsized[w++] = k;
      }
      unsized.length = w;
    }
    if (unsized.length) {
      const lines = unsized.map((k) => text.slice(A[k], B[k]));
      this.learn(lines);
      const big: number[] = [];
      for (let j = 0; j < lines.length; j++) {
        if (this.fits(lines[j])) {
          out[unsized[j]] = 1;
          keep.set(lines[j], 1);
        } else big.push(j);
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
   * line `text[a, b)`. `odd` as set by `rows()`.
   */
  rowStart(text: string, a: number, b: number, r: number, odd: boolean): number {
    if (r <= 0) return 0;
    if (!odd) {
      const [cells, chars] = leadOf(text, a, b, this.lead);
      return Math.min(b - a, r * this.cols - cells + chars);
    }
    if (!this.exact && b - a > LONG_LINE) {
      const st = this.sum(text, a, b);
      return r < st.length ? st[r] : b - a;
    }
    const m = this.mirror(text.slice(a, b));
    return r >= m.rows ? b - a : this.probe(m, b - a, r);
  }

  /** Row of the line `text[a, b)` (taking `rows` rows) that shows offset `off`: the caret before that character. */
  rowAt(text: string, a: number, b: number, off: number, odd: boolean, rows: number): number {
    if (rows <= 1 || off <= a) return 0;
    if (!odd) {
      const [cells, chars] = leadOf(text, a, b, this.lead);
      // Tabs only ever indent the first row (see rows()).
      const col = cells === chars ? off - a : off - a <= chars ? 0 : cells + off - a - chars;
      return Math.min(rows - 1, Math.floor(col / this.cols));
    }
    if (!this.exact && b - a > LONG_LINE) {
      const st = this.sum(text, a, b);
      let lo = 0;
      let hi = st.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (st[mid] <= off - a) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
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
        if (JOINS.test(String.fromCodePoint(c))) this.joins.add(c);
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

  /** The last line `sum` added up: found again by identity, and the start of the next one (see `sum`). */
  private lastSum: { t: string; a: number; b: number; st: Int32Array } | null = null;

  /**
   * Row starts of the long line `t[a, b)`, breaking where its glyphs' widths
   * (each at least as wide as in context, see `fits`) fill a row; never inside
   * a character's cluster or a flag. For views that draw every row themselves.
   * Typing changes one line a character at a time: its rows before the edit
   * are kept, and once a row after it starts where an old row did (shifted),
   * the rest are the old rows, so a key costs a row or two, not the line.
   * Never copies the line, nor keys anything by its text: the edit comes from
   * `rows()` (or `edited()`), else the line is compared with the last one in place.
   */
  private sum(t: string, a: number, b: number): Int32Array {
    const last = this.lastSum;
    if (last && last.a === a && last.b === b && last.t === t) return last.st;
    for (const e of this.sums) if (e.a === a && e.b === b && e.t === t) return (this.lastSum = e).st;
    const len = b - a;
    const cw = this.cw;
    const max = this.width;
    /** Printable ASCII characters a row holds from its start. */
    const full = Math.floor(max / cw);
    // The old rows: after `tail` (the edit's end) a row start `d` past an old one resynchronizes.
    let old: Int32Array | null = null;
    let p = 0;
    let tail = Infinity;
    let d = 0;
    const diff = this.diff;
    if (last && diff && diff.text === t && diff.old === last.t) {
      const dt = t.length - last.t.length;
      const oldEnd = last.t.length - diff.q;
      // An edit wholly before or after the line leaves its rows as they were.
      if (oldEnd < last.a && a === last.a + dt && b === last.b + dt) return this.keepSum(t, a, b, last.st);
      if (diff.p > last.b && a === last.a && b === last.b) return this.keepSum(t, a, b, last.st);
      if (a === last.a && diff.p >= a && b - last.b === dt && oldEnd <= last.b) {
        old = last.st;
        p = diff.p - a;
        tail = t.length - diff.q - a;
        d = dt;
      }
    } else if (last) {
      const ol = last.b - last.a;
      const m = Math.min(ol, len);
      p = prefixAt(last.t, last.a, t, a, m);
      if (p === m && ol === len) return this.keepSum(t, a, b, last.st);
      old = last.st;
      tail = len - suffixAt(last.t, last.b, t, b, m - p);
      d = len - ol;
    }
    let keep = 1;
    if (old) while (keep < old.length && old[keep] < p) keep++;
    // Rows `[0, keep)` are the old ones; `starts` are new; then old rows from `from`, shifted by `d`.
    const starts: number[] = [];
    let from = -1;
    let j = keep;
    let i = old ? old[keep - 1] : 0;
    let done = false;
    const brk = (x: number) => {
      starts.push(x);
      if (x < tail || !old) return false;
      while (j < old.length && old[j] + d < x) j++;
      if (j >= old.length || old[j] + d !== x) return false;
      from = j + 1;
      return (done = true);
    };
    let lastStart = i;
    let w = 0;
    let joined = false;
    let flags = 0;
    let forced = false;
    while (i < len && !done) {
      let c = t.charCodeAt(a + i);
      if (c >= 32 && c < 127 && !joined) {
        // A run of printable ASCII is one cell a character: its breaks are arithmetic.
        RUN.lastIndex = a + i;
        RUN.test(t);
        const e = Math.min(RUN.lastIndex, b) - a;
        // (A row can already be over full: nothing breaks before a joined character.)
        let k = i + Math.max(0, Math.floor((max - w) / cw));
        if (k === lastStart) k++;
        if (k < e) {
          for (; k < e && !done; k += full) brk((lastStart = k));
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
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < len) {
          c = t.codePointAt(a + i) as number;
          if (c > 0xffff) n = 2;
        }
        g = c === 0xfe0f ? 2.5 * cw : (this.glyphs.get(c) ?? this.glyph(c));
        if (this.joins.has(c)) join = true;
        if (c === 11 || c === 12 || c === 0x85 || c === 0x2028 || c === 0x2029) forced = true;
        // Regional indicators pair into flags.
        if (c >= 0x1f1e6 && c <= 0x1f1ff) join ||= flags++ % 2 === 1;
        else flags = 0;
      }
      if (!join && w + g > max && i > lastStart) {
        // (A flag's half can't resynchronize: which half it is depends on what came before.)
        if (flags) starts.push((lastStart = i));
        else brk((lastStart = i));
        w = 0;
        if (c === 9) g = tabTo(0, cw);
      }
      w += g;
      joined = c === 0x200d;
      i += n;
      if (forced && i < len && !done) {
        brk((lastStart = i));
        w = 0;
      }
      forced = false;
    }
    const rest = old && from >= 0 ? old.length - from : 0;
    const out = new Int32Array(keep + starts.length + rest);
    if (old) out.set(old.subarray(0, keep));
    for (let k = 0; k < starts.length; k++) out[keep + k] = starts[k];
    if (old) for (let k = 0, o = keep + starts.length; k < rest; k++) out[o + k] = old[from + k] + d;
    return this.keepSum(t, a, b, out);
  }

  /** Remembers `st` as the row starts of `t[a, b)` (see `sum`). */
  private keepSum(t: string, a: number, b: number, st: Int32Array) {
    const e = { t, a, b, st };
    this.lastSum = e;
    this.sums.push(e);
    if (this.sums.length > SUMS) this.sums.shift();
    return st;
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
    this.diff = null;
    this.hint = null;
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
