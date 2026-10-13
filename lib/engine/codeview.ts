import { escapeHtml } from './highlight';

/*
 * Virtualized read-only code viewer with lazily highlighted lines.
 * Long lines soft-wrap into fixed-width rows (monospace), so a minified
 * multi-megabyte line reads like a paragraph and virtualization still works.
 */

const RH = 20;
const OVERSCAN = 30;
const PAD_X = 16;

/**
 * Highlights a slice of a line. `inString` is set when the slice starts inside
 * a JSON string (a wrapped continuation row), `esc` when that string's previous
 * character was a backslash.
 */
export type LineHighlighter = (text: string, inString: boolean, esc: boolean) => string;

const plain: LineHighlighter = (t) => escapeHtml(t);

export class CodeView {
  readonly el: HTMLElement;
  private sizer: HTMLElement;
  private rows: HTMLElement;
  private ro: ResizeObserver;
  private lines: string[] = [];
  /** First visual row of each line (length = lines + 1). */
  private rowStart = new Int32Array(1);
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
  text = '';

  get lineCount() {
    return this.lines.length;
  }

  constructor(el: HTMLElement) {
    this.el = el;
    this.sizer = el.querySelector('.cv-sizer') as HTMLElement;
    this.rows = el.querySelector('.cv-rows') as HTMLElement;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => {
      if (this.el.clientWidth !== this.width) this.reflow(true);
      else this.render(true);
    });
    this.ro.observe(el);
  }

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  /** `json`: the text is JSON (enables correct highlighting of wrapped strings). */
  setText(text: string, hl: LineHighlighter, json = false) {
    if (text === this.text && hl === this.hl) return;
    const keepScroll = this.text && text.slice(0, 64) === this.text.slice(0, 64);
    this.text = text;
    this.hl = hl;
    this.json = json;
    this.lines = text ? text.split('\n') : [];
    const digits = String(this.lines.length).length;
    this.el.style.setProperty('--cv-gw', `${Math.max(3, digits) + 3}ch`);
    if (!keepScroll) this.el.scrollTop = 0;
    this.reflow(false);
  }

  /** Recomputes wrapping (on text or width changes). */
  private reflow(keepPosition: boolean) {
    const firstLine = keepPosition ? this.lineOfRow(Math.floor(this.el.scrollTop / RH)) : -1;
    this.width = this.el.clientWidth;
    this.measure();
    const gutter = (Math.max(3, String(this.lines.length).length) + 3) * this.cw;
    this.cols = Math.max(20, Math.floor((this.width - gutter - PAD_X * 2) / this.cw));
    const n = this.lines.length;
    const rs = new Int32Array(n + 1);
    let r = 0;
    for (let i = 0; i < n; i++) {
      rs[i] = r;
      const len = this.lines[i].length;
      r += len > this.cols ? Math.ceil(len / this.cols) : 1;
    }
    rs[n] = r;
    this.rowStart = rs;
    this.states.clear();
    this.html.clear();
    this.sizer.style.height = r * RH + 24 + 'px';
    if (firstLine >= 0) this.el.scrollTop = rs[firstLine] * RH;
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

  private lineOfRow(row: number) {
    const rs = this.rowStart;
    let lo = 0;
    let hi = this.lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rs[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
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

  render(force: boolean) {
    const st = this.el.scrollTop;
    const vh = this.el.clientHeight;
    const total = this.rowStart[this.lines.length] ?? 0;
    const vf = Math.floor(st / RH);
    const vl = Math.min(total, Math.ceil((st + vh) / RH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return;
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(total, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    let out = '';
    let ln = total ? this.lineOfRow(first) : 0;
    for (let row = first; row < last; row++) {
      while (ln + 1 < this.lines.length && this.rowStart[ln + 1] <= row) ln++;
      const sub = row - this.rowStart[ln];
      let h = this.html.get(row);
      if (h === undefined) {
        const line = this.lines[ln];
        const slice = line.length > this.cols ? line.slice(sub * this.cols, (sub + 1) * this.cols) : line;
        const s = this.stateAt(ln, sub);
        h = this.hl(slice, (s & 1) === 1, (s & 2) === 2);
        this.html.set(row, h);
      }
      out += `<div class="cv-l"><span class="cv-n">${sub ? '' : ln + 1}</span><span class="cv-c">${h || ' '}</span></div>`;
    }
    this.rows.style.transform = `translateY(${first * RH}px)`;
    this.rows.innerHTML = out;
  }
}
