import { bidiContext, escapeHtml, StringStates, stringState, trimWs } from './highlight';
import { LONG_LINE, Wrapper } from './wrap';

/*
 * Virtualized read-only code viewer with lazily highlighted lines.
 * - Long lines soft-wrap (see wrap.ts), so a minified multi-megabyte line
 *   reads like a paragraph and virtualization still works. ASCII rows are
 *   slices of the line; a line of wider glyphs (CJK, emoji…) is laid out by
 *   the browser in one block, or sliced where the browser breaks it if long.
 *   Without wrapping, lines run on and long ones are drawn around the view.
 * - Brace/bracket blocks fold from the gutter (JSON and C-like code).
 * - Find highlights matches and jumps between them, unfolding as needed.
 */

const RH = 20;
const OVERSCAN = 30;
const PAD_X = 16;
const MAX_HITS = 100_000;
/** Columns drawn either side of the view on long lines while not wrapping. */
const H_OVERSCAN = 400;

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
  private cw = 7.8;
  /** Soft wrap (null: lines run on and the view scrolls sideways). */
  private wrapper: Wrapper | null;
  /** Per visible line: 1 where the browser decides the breaks (Wrapper.odd). */
  private odd = new Uint8Array(0);
  /** Offset of each line in `text`. */
  private ls = new Int32Array(0);
  private maxLen = 0;
  /** Columns drawn of long lines while not wrapping. */
  private rColA = 0;
  private rColB = 0;
  private hl: LineHighlighter = plain;
  /** Track JSON string state across wrapped rows. */
  private json = false;
  /** Long lines drawn around the view while not wrapping: string state at the first column drawn. */
  private strs = new StringStates();
  /** Per wrapped line: string state at each row start (see stringState). */
  private states = new Map<number, number[]>();
  private html = new Map<number, string>();
  /** Labels drawn after a line's text (not part of it: copy and find ignore them). */
  private notes: Map<number, string> | null = null;
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
    this.wrapper = new Wrapper(el, RH, false);
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    this.ro = new ResizeObserver(() => {
      if (this.el.clientWidth !== this.width) this.reflow(true);
      else this.render(true);
    });
    this.ro.observe(el);
    document.fonts?.ready.then(this.onFonts);
    document.fonts?.addEventListener('loadingdone', this.onFonts);
  }

  /** The code font (or its subset for another script) arrived: glyph widths and wrapped rows change. */
  private onFonts = () => {
    this.wrapper?.reset();
    if (this.el.isConnected && this.lines.length) this.reflow(true);
  };

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
    this.wrapper?.destroy();
  }

  /** Soft-wraps long lines at the view's width, or lets them run on. */
  setWrap(on: boolean) {
    if (on === !!this.wrapper) return;
    const top = this.lines.length ? this.lineAtRow(Math.floor(this.el.scrollTop / RH)) : -1;
    this.wrapper?.destroy();
    this.wrapper = on ? new Wrapper(this.el, RH, false) : null;
    this.el.classList.toggle('cv-nowrap', !on);
    this.el.scrollLeft = 0;
    this.reflow(true, top);
  }

  /** Puts a small label after each given line (line index → HTML), or clears them. */
  setNotes(notes: Map<number, string> | null) {
    if (!notes && !this.notes) return;
    this.notes = notes;
    this.render(true);
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
    const ls = new Int32Array(this.lines.length);
    let maxLen = 0;
    for (let i = 0, p = 0; i < this.lines.length; i++) {
      const len = this.lines[i].length;
      ls[i] = p;
      p += len + 1;
      if (len > maxLen) maxLen = len;
    }
    this.ls = ls;
    this.maxLen = maxLen;
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
    this.buildVisible();
    const vis = this.vis;
    const n = vis.length;
    const wr = this.wrapper;
    let wrapped: Int32Array | null = null;
    if (wr) {
      if (wr.fit(this.width - gutter - PAD_X * 2, this.cw)) this.el.style.setProperty('--cv-tw', `${wr.width}px`);
      if (wr.cols) {
        const A = new Int32Array(n);
        const B = new Int32Array(n);
        for (let i = 0; i < n; i++) {
          A[i] = this.ls[vis[i]];
          B[i] = A[i] + this.lines[vis[i]].length;
        }
        wrapped = wr.rows(this.text, A, B);
      }
    }
    this.odd = wrapped && wr ? wr.odd : new Uint8Array(n);
    const rs = new Int32Array(n + 1);
    let r = 0;
    for (let i = 0; i < n; i++) {
      rs[i] = r;
      r += wrapped && !this.folded.has(vis[i]) ? wrapped[i] : 1;
    }
    rs[n] = r;
    this.rowStart = rs;
    this.states.clear();
    this.html.clear();
    this.sizer.style.height = r * RH + 24 + 'px';
    // Not wrapping, the longest line sets how far the view scrolls sideways.
    this.sizer.style.width = wr ? '' : `${Math.ceil(gutter + (this.maxLen + 4) * this.cw + PAD_X * 2)}px`;
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

  /** Index into `vis` of `line` (or of the folded block that contains it). */
  private visIndex(line: number) {
    const vis = this.vis;
    let lo = 0;
    let hi = vis.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (vis[mid] <= line) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** First visual row of `line` (or of the folded block that contains it). */
  private rowOfLine(line: number) {
    return this.rowStart[this.visIndex(line)] ?? 0;
  }

  /** Offset in visible line `vi` where its wrapped row `sub` starts. */
  private subStart(vi: number, sub: number) {
    const ln = this.vis[vi];
    const len = this.lines[ln].length;
    if (sub <= 0) return 0;
    if (sub >= this.rowStart[vi + 1] - this.rowStart[vi]) return len;
    const a = this.ls[ln];
    return (this.wrapper as Wrapper).rowStart(this.text, a, a + len, sub, this.odd[vi] === 1);
  }

  /** Is visible line `vi` drawn as one block the browser wraps (wide glyphs, not long)? */
  private isBlock(vi: number) {
    return this.odd[vi] === 1 && this.rowStart[vi + 1] - this.rowStart[vi] > 1 && this.lines[this.vis[vi]].length <= LONG_LINE;
  }

  /** JSON string state at the start of wrapped row `sub` of visible line `vi`. */
  private stateAt(vi: number, sub: number): number {
    if (!this.json || sub === 0) return 0;
    const ln = this.vis[vi];
    let st = this.states.get(ln);
    if (!st) this.states.set(ln, (st = [0]));
    const line = this.lines[ln];
    for (let k = st.length; k <= sub; k++) st.push(stringState(line, this.subStart(vi, k - 1), this.subStart(vi, k), st[k - 1]));
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
    const el = this.el;
    const st = el.scrollTop;
    const vh = el.clientHeight;
    const total = this.rowStart[this.vis.length] ?? 0;
    const vf = Math.floor(st / RH);
    const vl = Math.min(total, Math.ceil((st + vh) / RH));
    // Not wrapping: long lines are drawn only around the columns in view.
    const wide = !this.wrapper && this.maxLen > LONG_LINE;
    const vcA = wide ? Math.max(0, Math.floor(el.scrollLeft / this.cw) - 12) : 0;
    const vcB = vcA + Math.ceil(el.clientWidth / this.cw) + 12;
    if (!force && vf >= this.rFirst && vl <= this.rLast && (!wide || (vcA >= this.rColA && vcB <= this.rColB))) return;
    let first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(total, vl + OVERSCAN);
    let vi = total ? this.visOfRow(first) : 0;
    // A line drawn as one block starts at its first row.
    if (total && this.isBlock(vi)) first = this.rowStart[vi];
    // Rows drawn earlier are kept for scrolling back, within reason.
    if ((wide && (vcA < this.rColA || vcB > this.rColB)) || this.html.size > 4000) this.html.clear();
    this.rFirst = first;
    this.rLast = last;
    this.rColA = wide ? Math.max(0, vcA - H_OVERSCAN) : 0;
    this.rColB = wide ? vcB + H_OVERSCAN : Infinity;
    const cur = this.hi >= 0 ? this.hits[this.hi * 2] : -1;
    const curCol = this.hi >= 0 ? this.hits[this.hi * 2 + 1] : -1;
    const qn = this.q.length;
    let out = '';
    let place = false;
    for (let row = first; row < last; row++) {
      while (vi + 1 < this.vis.length && this.rowStart[vi + 1] <= row) vi++;
      const ln = this.vis[vi];
      const sub = row - this.rowStart[vi];
      const rows = this.rowStart[vi + 1] - this.rowStart[vi];
      const foldedHere = this.folded.has(ln);
      const line = this.lines[ln];
      const block = this.isBlock(vi);
      // This row's slice of the line: [a, b).
      let a = 0;
      let b = line.length;
      if (rows > 1 && !block) {
        a = this.subStart(vi, sub);
        b = this.subStart(vi, sub + 1);
      } else if (wide && b > LONG_LINE) {
        a = Math.min(b, this.rColA);
        b = Math.min(b, this.rColB);
      }
      // A row of other scripts drawn alone gets its neighbours as bidi context.
      const ctx = rows > 1 && !block && this.odd[vi] === 1;
      let h = this.html.get(row);
      if (h === undefined) {
        const s = !this.json || !a ? 0 : rows > 1 ? this.stateAt(vi, sub) : this.strs.at(line, 0, a);
        const se = ctx && b < line.length ? trimWs(line, a, b) : b;
        h = this.hl(a || se < line.length ? line.slice(a, se) : line, (s & 1) === 1, (s & 2) === 2);
        if (ctx) h = `${bidiContext(line, Math.max(0, a - 64), a)}${h}${bidiContext(line, b, Math.min(line.length, b + 64))}${escapeHtml(line.slice(se, b))}`;
        if (foldedHere) {
          const end = this.close[ln];
          const n = end - ln - 1;
          h += `<button type="button" class="cv-ph" data-f="${ln}" title="Unfold">⋯ ${n} line${n === 1 ? '' : 's'}</button>${this.hl(this.lines[end].trim(), false, false)}`;
        }
        this.html.set(row, h);
      }
      // Find highlights for this row's part of each match. Wide glyphs: placed
      // by their rects once drawn (a block's match may span rows).
      const pad = rows === 1 && a ? a * this.cw : 0;
      let marks = '';
      const lh = this.q ? this.hitLines.get(ln) : undefined;
      if (lh) {
        for (const col of lh) {
          if (col >= b || col + qn <= a) continue;
          const from = Math.max(col, a);
          const to = Math.min(col + qn, b);
          const cls = `cv-hit${ln === cur && col === curCol ? ' cur' : ''}`;
          if (this.odd[vi] === 1 && this.wrapper) {
            marks += `<i class="${cls}" data-h="${from - a}" data-n="${to - from}"></i>`;
            place = true;
          } else marks += `<i class="${cls}" style="left:${(pad + (from - a) * this.cw).toFixed(1)}px;width:${((to - from) * this.cw).toFixed(1)}px"></i>`;
        }
      }
      let gut: string;
      if (sub) gut = '';
      else if (this.close[ln] >= 0) gut = `<b class="cv-f${foldedHere ? ' c' : ''}" data-f="${ln}" title="${foldedHere ? 'Unfold' : 'Fold'}"></b>${ln + 1}`;
      else gut = String(ln + 1);
      const note = this.notes?.get(ln);
      const tail = note && b >= line.length ? note : '';
      const sp = pad ? `<i class="cv-sp" style="width:${pad.toFixed(1)}px"></i>` : '';
      out += `<div class="cv-l${block ? ' cv-b' : ''}"><span class="cv-n">${gut}</span><span class="cv-c">${sp}${marks}${h || ' '}${tail}</span></div>`;
      if (block) row += rows - 1;
    }
    this.rows.style.transform = `translateY(${first * RH}px)`;
    this.rows.innerHTML = out;
    if (place) this.placeHits();
  }

  /** Puts find highlights on text the browser lays out (wide glyphs) over the matched characters, one box per row. */
  private placeHits() {
    const rg = document.createRange();
    for (const mark of this.rows.querySelectorAll<HTMLElement>('i[data-h]')) {
      const c = mark.parentElement as HTMLElement;
      if (!textRange(rg, c, Number(mark.dataset.h), Number(mark.dataset.n))) continue;
      const box = c.getBoundingClientRect();
      let at: Element = mark;
      for (const r of rg.getClientRects()) {
        if (!r.width) continue;
        const el = at === mark && !mark.style.cssText ? mark : (mark.cloneNode() as HTMLElement);
        el.style.cssText = `left:${(r.left - box.left).toFixed(1)}px;top:${(r.top - box.top).toFixed(1)}px;width:${r.width.toFixed(1)}px;height:${r.height.toFixed(1)}px;bottom:auto`;
        if (el !== mark) at.after(el);
        at = el;
      }
    }
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
    const vi = this.visIndex(ln);
    // The wrapped row holding the match: the last row starting at or before it.
    let sub = 0;
    const rows = this.rowStart[vi + 1] - this.rowStart[vi];
    if (rows > 1) {
      let hi = rows - 1;
      while (sub < hi) {
        const mid = (sub + hi + 1) >> 1;
        if (this.subStart(vi, mid) <= col) sub = mid;
        else hi = mid - 1;
      }
    }
    const y = (this.rowStart[vi] + sub) * RH;
    const el = this.el;
    const vh = el.clientHeight;
    if (y < el.scrollTop || y + RH > el.scrollTop + vh) el.scrollTop = Math.max(0, y - vh / 2 + RH);
    if (!this.wrapper) {
      const x = col * this.cw;
      const view = el.clientWidth - 80;
      if (x < el.scrollLeft || x > el.scrollLeft + view) el.scrollLeft = Math.max(0, x - view / 3);
    }
    this.render(true);
  }
}

/** Sets `rg` to `len` characters of `el`'s text from offset `from` (text nodes in order, bidi context aside). */
function textRange(rg: Range, el: HTMLElement, from: number, len: number) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement as HTMLElement).closest('.ctx') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  let pos = 0;
  let started = false;
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const end = pos + n.length;
    if (!started && from < end) {
      rg.setStart(n, from - pos);
      started = true;
    }
    if (started && from + len <= end) {
      rg.setEnd(n, from + len - pos);
      return true;
    }
    pos = end;
  }
  return false;
}
