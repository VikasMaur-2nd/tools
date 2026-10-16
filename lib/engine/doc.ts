/**
 * The editor's document: a base string with a few ranges of it replaced.
 *
 * Engines keep `s.slice(0, a) + c + s.slice(b)` as a rope and copy all of it
 * the first time anything reads a character: for 50M characters of other
 * scripts that is 100 MB copied, and as much garbage, on every key. A Doc
 * edits in time proportional to the edit (typing grows one replacement), and
 * `slice` of a range inside one piece is a view, not a copy. `toString`
 * builds the whole text once per version, for whoever needs all of it (the
 * parser after a pause, copying the document). Docs are immutable: an edit
 * returns a new version, so versions compare by identity.
 */

/** An edit this close (characters) to a replacement joins it, copying the text between. */
const GAP = 4096;
/** ... unless that makes a replacement longer than this. */
const JOIN = 1 << 18;
/** More replacements, or one longer than this, and the document is rebuilt as one string. */
const MAX_PIECES = 48;
const MAX_LEN = 1 << 22;

/** What versions sharing a base know about it. */
interface Base {
  /** Has a tab (null: not looked yet). */
  tab: boolean | null;
}

export class Doc {
  readonly length: number;
  /** The whole text, once built. */
  private str: string | null;
  private tab: boolean | null = null;
  /** The replacement `charCodeAt` found last (reads come in runs). */
  private hit = -1;

  private constructor(
    /** The text the unreplaced parts come from. */
    private readonly base: string,
    /** Replaced base ranges [x, y), sorted and disjoint, ... */
    private readonly x: number[],
    private readonly y: number[],
    /** ... their text, and where it starts in the document. */
    private readonly m: string[],
    private readonly at: number[],
    private readonly info: Base,
  ) {
    let n = base.length;
    for (let k = 0; k < m.length; k++) n += m[k].length - (y[k] - x[k]);
    this.length = n;
    this.str = m.length ? null : base;
  }

  static of(s: string): Doc {
    return new Doc(s, [], [], [], [], { tab: null });
  }

  /** The text when it is one string already (no replacements), else null. */
  get flat(): string | null {
    return this.m.length ? null : this.base;
  }

  /** Does the text have a tab? (May say so for one that was deleted.) */
  get tabs(): boolean {
    if (this.tab === null) {
      if (this.info.tab === null) this.info.tab = this.base.indexOf('\t') !== -1;
      this.tab = this.info.tab || this.m.some((s) => s.indexOf('\t') !== -1);
    }
    return this.tab;
  }

  /** Tells a document without replacements whether its text has a tab (found anyway while loading it). */
  knowTabs(tab: boolean) {
    if (!this.m.length) this.info.tab ??= tab;
  }

  toString(): string {
    return (this.str ??= this.slice(0, this.length));
  }

  /** The last replacement starting at or before `i` (-1: none). */
  private find(i: number): number {
    const at = this.at;
    const h = this.hit;
    if (h >= 0 && at[h] <= i && (h + 1 === at.length || at[h + 1] > i)) return h;
    let lo = -1;
    let hi = at.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= i) lo = mid;
      else hi = mid - 1;
    }
    return (this.hit = lo);
  }

  charCodeAt(i: number): number {
    if (!this.m.length) return this.base.charCodeAt(i);
    const k = this.find(i);
    if (k < 0) return this.base.charCodeAt(i);
    const r = i - this.at[k];
    const m = this.m[k];
    return r < m.length ? m.charCodeAt(r) : this.base.charCodeAt(this.y[k] + r - m.length);
  }

  /**
   * Calls `f` with each piece of [a, b) in order: the string holding it and
   * the range of that string (stops early if `f` returns true).
   */
  each(a: number, b: number, f: (s: string, i: number, j: number) => boolean | void): void {
    a = Math.max(0, a);
    b = Math.min(this.length, b);
    const { base, y, m, at } = this;
    let k = m.length ? this.find(a) : -1;
    let p = a;
    while (p < b) {
      if (k >= 0 && p < at[k] + m[k].length) {
        const e = Math.min(b, at[k] + m[k].length);
        if (f(m[k], p - at[k], e - at[k])) return;
        p = e;
        continue;
      }
      // The base between replacement k and the next.
      const from = k >= 0 ? at[k] + m[k].length : 0;
      const shift = (k >= 0 ? y[k] : 0) - from;
      const next = k + 1 < m.length ? at[k + 1] : Infinity;
      const e = Math.min(b, next);
      if (e > p && f(base, p + shift, e + shift)) return;
      p = e;
      if (p >= next) k++;
    }
  }

  /** Text [a, b): a view of one piece, or a copy of the pieces. */
  slice(a = 0, b = this.length): string {
    a = Math.max(0, Math.min(this.length, a));
    b = Math.max(a, Math.min(this.length, b));
    if (!this.m.length) return this.base.slice(a, b);
    // (Never from `str`: slicing a text nobody has read yet would copy all of it.)
    let out = '';
    this.each(a, b, (s, i, j) => void (out += i === 0 && j === s.length ? s : s.slice(i, j)));
    return out;
  }

  /** First index of the character `ch` in [from, to), or -1. */
  indexOf(ch: string, from = 0, to = this.length): number {
    let r = -1;
    let at = Math.max(0, from);
    this.each(from, to, (s, i, j) => {
      // Searched in a view: a search in the base would run on past the piece.
      const k = (j - i === s.length ? s : s.slice(i, j)).indexOf(ch);
      if (k >= 0) r = at + k;
      at += j - i;
      return k >= 0;
    });
    return r;
  }

  /** Document offset `d` (outside every replacement, or at one's edge) in the base. */
  private toBase(d: number): number {
    const { y, m, at } = this;
    let k = this.find(d);
    // At a replacement's start: the base before it.
    while (k >= 0 && d < at[k] + m[k].length) k--;
    return k < 0 ? d : y[k] + d - at[k] - m[k].length;
  }

  /** This text with [a, b) replaced by `ins`. */
  edit(a: number, b: number, ins: string): Doc {
    const n = this.length;
    a = Math.max(0, Math.min(n, a));
    b = Math.max(a, Math.min(n, b));
    if (a === b && !ins) return this;
    if (a === 0 && b === n) return Doc.of(ins);
    const { x, y, m, at } = this;
    const K = m.length;
    const end = (k: number) => at[k] + m[k].length;
    // Replacements within `gap` of [a, b): joined with it into one.
    const span = (gap: number) => {
      let i = 0;
      while (i < K && end(i) < a - gap) i++;
      let j = i - 1;
      while (j + 1 < K && at[j + 1] <= b + gap) j++;
      const lo = j >= i ? Math.min(a, at[i]) : a;
      const hi = j >= i ? Math.max(b, end(j)) : b;
      return { i, j, lo, hi, len: hi - lo - (b - a) + ins.length };
    };
    let s = span(GAP);
    if (s.j >= s.i && s.len > JOIN) s = span(0);
    const { i, j, lo, hi, len } = s;
    if (len > MAX_LEN || K - (j - i + 1) + 1 > MAX_PIECES) return Doc.of(this.slice(0, a) + ins + this.slice(b));
    const mid = this.slice(lo, a) + ins + this.slice(b, hi);
    const nx = j >= i && lo === at[i] ? x[i] : this.toBase(lo);
    const ny = j >= i && hi === end(j) ? y[j] : this.toBase(hi);
    const d = ins.length - (b - a);
    const X = x.slice(0, i);
    const Y = y.slice(0, i);
    const M = m.slice(0, i);
    const A = at.slice(0, i);
    // (A replacement that restores what it replaced is dropped.)
    if (!(nx === ny && !mid)) {
      X.push(nx);
      Y.push(ny);
      M.push(mid);
      A.push(lo);
    }
    for (let k = j + 1; k < K; k++) {
      X.push(x[k]);
      Y.push(y[k]);
      M.push(m[k]);
      A.push(at[k] + d);
    }
    return new Doc(this.base, X, Y, M, A, this.info);
  }
}
