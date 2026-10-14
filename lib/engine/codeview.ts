import { escapeHtml } from './highlight';

/*
 * Virtualized read-only code viewer with lazily highlighted lines.
 * - Long lines soft-wrap into fixed-width rows (monospace), so a minified
 *   multi-megabyte line reads like a paragraph and virtualization still works.
 * - Brace/bracket blocks fold from the gutter (JSON and C-like code).
 * - Find highlights matches and jumps between them, unfolding as needed.
 */

const RH = 20;
const OVERSCAN = 30;
const PAD_X = 16;
const MAX_HITS = 100_000;

/**
 * Highlights a slice of a line. `inString` is set when the slice starts inside
 * a JSON string (a wrapped continuation row), `esc` when that string's previous
 * character was a backslash.
 */
export type LineHighlighter = (text: string, inString: boolean, esc: boolean) => string;

const plain: LineHighlighter = (t) => escapeHtml(t);

export interface FindResult {
  total: number;
  index: number;
  /** Why a query can't match as written (the tree's path search). */
  note?: string;
}

export class CodeView {
  readonly el: HTMLElement;
  private sizer: HTMLElement;
  private rows: HTMLElement;
  private ro: ResizeObserver;
  private lines: string[] = [];
  /** Visible lines (folded blocks removed), in order. */
  private vis = new Int32Array(0);
  /** First visual row of each visible line (length = vis + 1). */
  private rowStart = new Int32Array(1);
  /** For a line that opens a foldable block: the line that closes it, else -1. */
  private close = new Int32Array(0);
  /** Nesting depth of each block opener. */
  private depth = new Int32Array(0);
  private folded = new Set<number>();
  private cols = 80;
  private cw = 7.8;
  private hl: LineHighlighter = plain;
  /** Track JSON string state across wrapped rows. */
  private json = false;
  /** Per long line: string state at each row boundary (bit 1 = in string, bit 2 = escape pending). */
  private states = new Map<number, number[]>();
  private html = new Map<number, string>();
  private rFirst = -1;
  private rLast = -1;
  private raf = 0;
  private width = 0;
  // find
  private q = '';
  private hits: number[] = []; // flat [line, col, line, col, …]
  private hitLines = new Map<number, number[]>();
  private hi = -1;
  text = '';

  get lineCount() {
    return this.lines.length;
  }

  constructor(el: HTMLElement) {
    this.el = el;
    this.sizer = el.querySelector('.cv-sizer') as HTMLElement;
    this.rows = el.querySelector('.cv-rows') as HTMLElement;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    this.ro = new ResizeObserver(() => {
      if (this.el.clientWidth !== this.width) this.reflow(true);
      else this.render(true);
    });
    this.ro.observe(el);
    document.fonts?.ready.then(() => {
      if (this.el.isConnected && this.lines.length) this.reflow(true);
    });
  }

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  /** `json`: the text is JSON (enables correct highlighting of wrapped strings). */
  setText(text: string, hl: LineHighlighter, json = false) {
    if (text === this.text && hl === this.hl) return;
    const prevLines = this.lines.length;
    const keepScroll = this.text && text.slice(0, 64) === this.text.slice(0, 64);
    this.text = text;
    this.hl = hl;
    this.json = json;
    this.lines = text ? text.split('\n') : [];
    // Folds survive edits that keep the shape (same line count), e.g. changing a value.
    if (this.lines.length !== prevLines) this.folded.clear();
    this.scanFolds();
    const digits = String(this.lines.length).length;
    this.el.style.setProperty('--cv-gw', `${Math.max(3, digits) + 5}ch`);
    if (!keepScroll) this.el.scrollTop = 0;
    if (this.q) this.runFind(false);
    this.reflow(false);
  }

  // ── Folding ────────────────────────────────────────────────────────────

  /** Lines ending in `{` or `[` open a block that the matching `}`/`]` line closes. */
  private scanFolds() {
    const n = this.lines.length;
    const close = new Int32Array(n).fill(-1);
    const depth = new Int32Array(n);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      const line = this.lines[i];
      let a = 0;
      while (a < line.length && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
      const first = line.charCodeAt(a);
      if ((first === 125 || first === 93) && stack.length) {
        const o = stack.pop() as number;
        if (i > o + 1) close[o] = i;
      }
      let b = line.length - 1;
      while (b >= 0 && (line.charCodeAt(b) === 32 || line.charCodeAt(b) === 9)) b--;
      const last = line.charCodeAt(b);
      if ((last === 123 || last === 91) && !(b === a && (first === 125 || first === 93))) {
        depth[i] = stack.length;
        stack.push(i);
      }
    }
    this.close = close;
    this.depth = depth;
    for (const o of this.folded) if (close[o] < 0) this.folded.delete(o);
  }

  private buildVisible() {
    const n = this.lines.length;
    if (!this.folded.size) {
      const v = new Int32Array(n);
      for (let i = 0; i < n; i++) v[i] = i;
      this.vis = v;
      return;
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i);
      if (this.folded.has(i)) i = this.close[i];
    }
    this.vis = Int32Array.from(out);
  }

  toggle(line: number) {
    if (this.close[line] < 0) return;
    if (this.folded.has(line)) this.folded.delete(line);
    else this.folded.add(line);
    this.reflow(true, line);
  }

  /** Folds every block nested `level` deep or deeper (1 keeps only the outermost block open). */
  foldLevel(level: number) {
    this.folded.clear();
    for (let i = 0; i < this.close.length; i++) if (this.close[i] >= 0 && this.depth[i] >= level) this.folded.add(i);
    this.el.scrollTop = 0;
    this.reflow(false);
  }

  unfoldAll() {
    this.folded.clear();
    this.reflow(true);
  }

  /** Unfolds every block hiding `line`. */
  private reveal(line: number) {
    let changed = false;
    for (const o of this.folded) {
      if (o < line && this.close[o] >= line) {
        this.folded.delete(o);
        changed = true;
      }
    }
    if (changed) this.reflow(true);
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  /** Recomputes visible lines and wrapping (on text, fold or width changes). */
  private reflow(keepPosition: boolean, anchor = -1) {
    const firstLine = anchor >= 0 ? anchor : keepPosition ? this.lineAtRow(Math.floor(this.el.scrollTop / RH)) : -1;
    const anchorTop = anchor >= 0 ? this.rowOfLine(anchor) * RH - this.el.scrollTop : 0;
    this.width = this.el.clientWidth;
    this.measure();
    const gutter = (Math.max(3, String(this.lines.length).length) + 5) * this.cw;
    this.cols = Math.max(20, Math.floor((this.width - gutter - PAD_X * 2) / this.cw));
    this.buildVisible();
    const vis = this.vis;
    const rs = new Int32Array(vis.length + 1);
    let r = 0;
    for (let i = 0; i < vis.length; i++) {
      rs[i] = r;
      const len = this.lines[vis[i]].length;
      r += !this.folded.has(vis[i]) && len > this.cols ? Math.ceil(len / this.cols) : 1;
    }
    rs[vis.length] = r;
    this.rowStart = rs;
    this.states.clear();
    this.html.clear();
    this.sizer.style.height = r * RH + 24 + 'px';
    if (firstLine >= 0) this.el.scrollTop = Math.max(0, this.rowOfLine(firstLine) * RH - anchorTop);
    this.render(true);
  }

  private measure() {
    const probe = document.createElement('span');
    probe.className = 'cv-c';
    probe.textContent = '0'.repeat(200);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    this.rows.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 200;
    probe.remove();
    if (w > 0) this.cw = w;
  }

  /** Index into `vis` of the visible line containing visual row `row`. */
  private visOfRow(row: number) {
    const rs = this.rowStart;
    let lo = 0;
    let hi = this.vis.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rs[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  private lineAtRow(row: number) {
    return this.vis.length ? this.vis[this.visOfRow(row)] : 0;
  }

  /** First visual row of `line` (or of the folded block that contains it). */
  private rowOfLine(line: number) {
    const vis = this.vis;
    let lo = 0;
    let hi = vis.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (vis[mid] <= line) lo = mid;
      else hi = mid - 1;
    }
    return this.rowStart[Math.max(0, lo)] ?? 0;
  }

  /** JSON string state at the start of wrapped row `sub` of line `ln`. */
  private stateAt(ln: number, sub: number): number {
    if (!this.json || sub === 0) return 0;
    let st = this.states.get(ln);
    if (!st) this.states.set(ln, (st = [0]));
    const line = this.lines[ln];
    const cols = this.cols;
    for (let k = st.length; k <= sub; k++) {
      let s = st[k - 1];
      const end = Math.min(line.length, k * cols);
      for (let i = (k - 1) * cols; i < end; i++) {
        const c = line.charCodeAt(i);
        if (s & 2) s &= ~2;
        else if (s & 1) {
          if (c === 92) s |= 2;
          else if (c === 34) s = 0;
        } else if (c === 34) s = 1;
      }
      st.push(s);
    }
    return st[sub];
  }

  private onScroll = () => {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
  };

  private onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
    if (t) this.toggle(Number(t.dataset.f));
  };

  render(force: boolean) {
    const st = this.el.scrollTop;
    const vh = this.el.clientHeight;
    const total = this.rowStart[this.vis.length] ?? 0;
    const vf = Math.floor(st / RH);
    const vl = Math.min(total, Math.ceil((st + vh) / RH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return;
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(total, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    const cur = this.hi >= 0 ? this.hits[this.hi * 2] : -1;
    const curCol = this.hi >= 0 ? this.hits[this.hi * 2 + 1] : -1;
    const w = (this.q.length * this.cw).toFixed(1);
    let out = '';
    let vi = total ? this.visOfRow(first) : 0;
    for (let row = first; row < last; row++) {
      while (vi + 1 < this.vis.length && this.rowStart[vi + 1] <= row) vi++;
      const ln = this.vis[vi];
      const sub = row - this.rowStart[vi];
      const foldedHere = this.folded.has(ln);
      const line = this.lines[ln];
      const wrapped = !foldedHere && line.length > this.cols;
      const a = wrapped ? sub * this.cols : 0;
      let h = this.html.get(row);
      if (h === undefined) {
        const s = this.stateAt(ln, sub);
        h = this.hl(wrapped ? line.slice(a, a + this.cols) : line, (s & 1) === 1, (s & 2) === 2);
        if (foldedHere) {
          const end = this.close[ln];
          const n = end - ln - 1;
          h += `<button type="button" class="cv-ph" data-f="${ln}" title="Unfold">⋯ ${n} line${n === 1 ? '' : 's'}</button>${this.hl(this.lines[end].trim(), false, false)}`;
        }
        this.html.set(row, h);
      }
      // Find highlights for this row's slice.
      let marks = '';
      const lh = this.q ? this.hitLines.get(ln) : undefined;
      if (lh) {
        const b = wrapped ? a + this.cols : line.length;
        for (const col of lh) {
          if (col < a || col >= b) continue;
          const isCur = ln === cur && col === curCol;
          marks += `<i class="cv-hit${isCur ? ' cur' : ''}" style="left:${((col - a) * this.cw).toFixed(1)}px;width:${w}px"></i>`;
        }
      }
      let gut: string;
      if (sub) gut = '';
      else if (this.close[ln] >= 0) gut = `<b class="cv-f${foldedHere ? ' c' : ''}" data-f="${ln}" title="${foldedHere ? 'Unfold' : 'Fold'}"></b>${ln + 1}`;
      else gut = String(ln + 1);
      out += `<div class="cv-l"><span class="cv-n">${gut}</span><span class="cv-c">${marks}${h || ' '}</span></div>`;
    }
    this.rows.style.transform = `translateY(${first * RH}px)`;
    this.rows.innerHTML = out;
  }

  // ── Find ───────────────────────────────────────────────────────────────

  find(q: string): FindResult {
    this.q = q;
    this.runFind(true);
    this.render(true);
    return { total: this.hits.length / 2, index: this.hi };
  }

  step(dir: 1 | -1): FindResult {
    const n = this.hits.length / 2;
    if (n) {
      this.hi = (this.hi + dir + n) % n;
      this.goto();
    }
    return { total: n, index: this.hi };
  }

  private runFind(jump: boolean) {
    this.hits = [];
    this.hitLines.clear();
    this.hi = -1;
    const q = this.q;
    if (!q) return;
    // Smart case: lowercase queries match any case.
    const cs = q !== q.toLowerCase();
    const qn = cs ? q : q.toLowerCase();
    const hits = this.hits;
    for (let ln = 0; ln < this.lines.length && hits.length < MAX_HITS * 2; ln++) {
      const line = cs ? this.lines[ln] : this.lines[ln].toLowerCase();
      let p = line.indexOf(qn);
      if (p < 0) continue;
      const cols: number[] = [];
      while (p >= 0) {
        hits.push(ln, p);
        cols.push(p);
        p = line.indexOf(qn, p + qn.length);
      }
      this.hitLines.set(ln, cols);
    }
    if (!hits.length) return;
    // Start from the first match at or below the top of the view.
    const top = this.lineAtRow(Math.floor(this.el.scrollTop / RH));
    let i = 0;
    while (i * 2 < hits.length && hits[i * 2] < top) i++;
    this.hi = i * 2 < hits.length ? i : 0;
    if (jump) this.goto();
  }

  private goto() {
    const ln = this.hits[this.hi * 2];
    const col = this.hits[this.hi * 2 + 1];
    this.reveal(ln);
    const row = this.rowOfLine(ln) + (this.lines[ln].length > this.cols ? Math.floor(col / this.cols) : 0);
    const y = row * RH;
    const vh = this.el.clientHeight;
    if (y < this.el.scrollTop || y + RH > this.el.scrollTop + vh) this.el.scrollTop = Math.max(0, y - vh / 2 + RH);
    this.render(true);
  }
}
