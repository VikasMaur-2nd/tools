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
  private sums = new Map<string, Int32Array>();
  private joins = new Set<number>();
  private range: Range | null = null;
  private readonly lead = [0, 0];
  private trust = true;

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
    if (cw !== this.cw) this.glyphs.clear();
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

  /** Forgets measurements (the code font arrived, so glyph widths changed). */
  reset() {
    this.cols = 0;
    this.cw = 0;
    this.glyphs.clear();
    this.forget();
  }

  /**
   * Rows taken by each line `text[A[i], B[i])`. Lines the arithmetic can't
   * size are measured together. Also sets `odd`.
   */
  rows(text: string, A: Int32Array, B: Int32Array): Int32Array {
    const n = A.length;
    const out = new Int32Array(n);
    const odd = new Uint8Array(n);
    this.odd = odd;
    const cols = this.cols;
    if (!cols) return out.fill(1);
    if (!this.trust) odd.fill(1);
    NON_ASCII.lastIndex = 0;
    let i = this.trust ? 0 : n;
    for (let m = NON_ASCII.exec(text); m && i < n; m = NON_ASCII.exec(text)) {
      const p = m.index;
      while (i < n && B[i] <= p) i++;
      if (i === n) break;
      // A character in hidden (folded) lines doesn't count.
      if (p < A[i]) NON_ASCII.lastIndex = A[i];
      else {
        odd[i] = 1;
        NON_ASCII.lastIndex = B[i];
      }
    }
    const tabs = text.indexOf('\t') !== -1;
    const lead = this.lead;
    const keep = new Map<string, number>();
    const unsized: number[] = [];
    for (let k = 0; k < n; k++) {
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
      const s = text.slice(a, b);
      let r = this.sized.get(s) ?? keep.get(s);
      // A long line is laid out once, as the mirror its rows are later read from.
      if (r === undefined && s.length > LONG_LINE) r = this.exact ? this.mirror(s).rows : this.sum(s).length;
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
      const st = this.sum(text.slice(a, b));
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
      const st = this.sum(text.slice(a, b));
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
    // Each in its own inline block: nothing joins or shapes across them.
    const els = todo.map((c) => {
      const e = document.createElement('i');
      e.textContent = String.fromCodePoint(c);
      return e;
    });
    this.scratch.replaceChildren(fragment(els));
    els.forEach((e, k) => this.glyphs.set(todo[k], e.getBoundingClientRect().width));
    this.scratch.textContent = '';
  }

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

  /**
   * Row starts of the long line `s`, breaking where its glyphs' widths (each
   * at least as wide as in context, see `fits`) fill a row; never inside a
   * character's cluster or a flag. For views that draw every row themselves.
   */
  private sum(s: string): Int32Array {
    const hit = this.sums.get(s);
    if (hit) return hit;
    this.learn([s]);
    const cw = this.cw;
    const max = this.width;
    const starts = [0];
    let w = 0;
    let joined = false;
    let flags = 0;
    let forced = false;
    for (let i = 0; i < s.length; ) {
      let c = s.charCodeAt(i);
      let n = 1;
      let g: number;
      let join = joined;
      if (c >= 32 && c < 127) g = cw;
      else if (c === 9) g = tabTo(w, cw);
      else {
        if (c >= 0xd800 && c < 0xdc00) {
          c = s.codePointAt(i) as number;
          if (c > 0xffff) n = 2;
        }
        g = c === 0xfe0f ? 2.5 * cw : (this.glyphs.get(c) ?? cw);
        if (this.joins.has(c)) join = true;
        if (c === 11 || c === 12 || c === 0x85 || c === 0x2028 || c === 0x2029) forced = true;
        // Regional indicators pair into flags.
        if (c >= 0x1f1e6 && c <= 0x1f1ff) join ||= flags++ % 2 === 1;
        else flags = 0;
      }
      if (!join && w + g > max && i > starts[starts.length - 1]) {
        starts.push(i);
        w = 0;
        if (c === 9) g = tabTo(0, cw);
      }
      w += g;
      joined = c === 0x200d;
      i += n;
      if (forced && i < s.length) {
        starts.push(i);
        w = 0;
      }
      forced = false;
    }
    const out = Int32Array.from(starts);
    this.sums.set(s, out);
    if (this.sums.size > SUMS) this.sums.delete(this.sums.keys().next().value as string);
    return out;
  }

  /** Where the last patch changed its mirror (rows starting before it are kept). */
  private edit = 0;

  /** Turns mirror `m` into a copy of `s` if they differ by a small edit; false if they don't. */
  private patch(m: Mirror, s: string): boolean {
    const old = m.text;
    const max = Math.min(old.length, s.length);
    let p = 0;
    while (p < max && old.charCodeAt(p) === s.charCodeAt(p)) p++;
    let q = 0;
    while (q < max - p && old.charCodeAt(old.length - 1 - q) === s.charCodeAt(s.length - 1 - q)) q++;
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

  /** Drops every row count and break (they depend on the width, the fonts and the mode). */
  private forget() {
    this.sized.clear();
    for (const m of this.mirrors.values()) m.el.remove();
    this.mirrors.clear();
    this.sums.clear();
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
    const rect = rg.getClientRects()[0] ?? rg.getBoundingClientRect();
    return Math.max(0, Math.floor(((rect.top + rect.bottom) / 2 - top) / this.lh));
  }
}
