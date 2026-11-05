/*
 * The lines of a huge document (as written, or pretty), drawn like the Format view's (same markup and
 * classes) over TallScroll from SparseLines: only lines read so far are drawn as text, the others as
 * placeholders until they arrive, so scrolling never waits for a read. Lines don't wrap: a long one is cut
 * at COLS characters and says how much more there is.
 */
import { escapeHtml, highlightLine } from '../engine/highlight';
import type { TallScroll } from '../engine/tall';
import { kit } from './kit';
import { rt } from '../i18n/ui';
import { SparseLines } from './lines-model';
import type { HugeLine, HugeSource, LineMode } from './source';

const RH = 20;
/** The rows' padding above the first line (see .cv-rows). */
const PAD = 10;
const OVERSCAN = 30;
/** Characters of a line read and drawn at most. */
export const COLS = 4000;

export interface HugeLinesEvents {
  /** A line was clicked: the value at offset `at` (raw: the character clicked; pretty: the line's value). */
  pick(at: number): void;
  /** A line was double-clicked (as written): edit the text there, at offset `at`. */
  edit?(at: number): void;
  failed(e: unknown): void;
}

export class HugeLinesView {
  readonly lines: SparseLines;
  private sc: TallScroll;
  private sizer: HTMLElement;
  private rowsEl: HTMLElement;
  private ro: ResizeObserver;
  private rFirst = -1;
  private rLast = -1;
  private y = NaN;
  private raf = 0;
  private cw = 7.8;
  private measured = false;
  /** The longest line seen (characters): the rows' width. */
  private widest = 0;
  private html = new Map<number, string>();
  /** The line to show as current (the selection's, or the match's), and the match's offset in the file (raw: its column follows). */
  private cur = -1;
  private curAt = -1;
  /** The match's column is still to be scrolled to (its line wasn't read yet). */
  private toCol = false;
  /** The file's error: its line and column (marked there). */
  private errLine = -1;
  private errCol = -1;
  private q = '';
  private qn = '';
  private cs = false;
  private dead = false;
  private marked = false;

  constructor(
    readonly el: HTMLElement,
    private readonly src: HugeSource,
    readonly mode: LineMode,
    private readonly indent: string,
    private readonly ev: HugeLinesEvents,
  ) {
    this.lines = new SparseLines((from, n, signal) => src.lines(mode, from, n, COLS, indent, signal));
    this.lines.loaded = () => {
      this.html.clear();
      this.redraw();
    };
    this.lines.failed = (e) => ev.failed(e);
    this.lines.count = src.lineCount(mode);
    this.sizer = el.querySelector('.cv-sizer') as HTMLElement;
    this.rowsEl = el.querySelector('.cv-rows') as HTMLElement;
    this.sc = new kit.Scroll(el);
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    el.addEventListener('dblclick', this.onDouble);
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
    this.fit();
  }

  destroy() {
    this.dead = true;
    this.lines.reset();
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('dblclick', this.onDouble);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
  }

  /** The index counted more lines (or finished): the scroll range grows. */
  grow() {
    const n = this.src.lineCount(this.mode);
    // (A line read up to the front grows with it: read again.)
    const reading = this.lines.forget((l) => !!l.reading);
    if (n === this.lines.count && !reading) return;
    this.lines.count = n;
    this.html.clear();
    this.fit();
    this.redraw();
  }

  get count() {
    return this.lines.count;
  }

  /** The lines changed (a file turned out to have several top-level values): read again. */
  reload() {
    this.lines.reset();
    this.html.clear();
    this.lines.count = this.src.lineCount(this.mode);
    this.fit();
    this.redraw();
  }

  private fit() {
    this.sc.fit(this.lines.count * RH + 2 * PAD, this.sizer);
    // Line numbers as wide as the longest.
    this.el.style.setProperty('--cv-gw', `${Math.max(4, String(this.lines.count).length) + 1}ch`);
  }

  private redraw() {
    if (this.dead || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render(true);
    });
  }

  private onScroll = () => {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
  };

  private measure() {
    const probe = document.createElement('span');
    probe.textContent = 'x'.repeat(100);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    this.rowsEl.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (w > 0) {
      this.cw = w;
      this.measured = true;
    }
  }

  /** The first and last line in view. */
  get visible(): [number, number] {
    const st = Math.max(0, this.sc.top - PAD);
    return [Math.floor(st / RH), Math.min(this.lines.count, Math.ceil((st + this.sc.height) / RH))];
  }

  render(force: boolean) {
    if (this.dead || this.el.hidden) return;
    if (!this.measured) this.measure();
    const [vf, vl] = this.visible;
    if (!force && vf >= this.rFirst && vl <= this.rLast) return this.place();
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(this.lines.count, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    // Reads what is in view, and ahead in the direction of scrolling.
    this.lines.want(first, last);
    if (this.html.size > 2000) this.html.clear();
    let out = '';
    let widest = this.widest;
    for (let k = first; k < last; k++) {
      const line = this.lines.get(k);
      if (line) widest = Math.max(widest, line.text.length + (line.more ? 16 : 0));
      out += this.row(k, line);
    }
    this.rowsEl.innerHTML = out;
    if (!this.marked && this.lines.get(first)) {
      this.marked = true;
      performance.mark('tk:huge:lines');
    }
    if (this.toCol) this.scrollToCol();
    if (widest !== this.widest) {
      this.widest = widest;
      this.sizer.style.width = `calc(var(--cv-gw) + 24px + ${Math.ceil(widest * this.cw) + 48}px)`;
    }
    this.place();
  }

  private row(k: number, line: HugeLine | undefined): string {
    const cur = (k === this.cur ? ' hg-cur' : '') + (k === this.errLine ? ' hg-errl' : '');
    if (!line) {
      const w = 6 + ((k * 13) % 40);
      return `<div class="cv-l hg-ph${cur}"><span class="cv-n">${k + 1}</span><span class="cv-c"><i class="hg-sk" style="width:${w}ch"></i></span></div>`;
    }
    let h = this.html.get(k);
    if (h === undefined) {
      h = line.text ? highlightLine(line.text, 0, line.text.length, null) : ' ';
      if (line.more) h += `<span class="hg-more">${escapeHtml(rt('… {size} more', { size: rt.bytes(line.more) }))}</span>`;
      else if (line.reading) h += `<span class="hg-more hg-reading">${escapeHtml(rt('…still reading'))}</span>`;
      this.html.set(k, h);
    }
    const err = k === this.errLine && this.errCol >= 0 && this.errCol <= line.text.length ? `<i class="hg-errc" style="left:${(this.errCol * this.cw).toFixed(1)}px;width:${this.cw.toFixed(1)}px"></i>` : '';
    return `<div class="cv-l${cur}" data-l="${k}"><span class="cv-n">${k + 1}</span><span class="cv-c">${err}${this.marks(k, line)}${h}</span></div>`;
  }

  /** The column of offset `at` on raw line `line` (-1: not on it, or a pretty line). */
  private colAt(line: HugeLine, at: number) {
    if (this.mode !== 'raw' || at < line.at) return -1;
    return this.src.colOf ? this.src.colOf(line, at) : at - line.at;
  }

  /** The current match's column on line `line` (-1: not known: the first match on the line is it). */
  private curCol(line: HugeLine) {
    return this.curAt < 0 ? -1 : this.colAt(line, this.curAt);
  }

  /** Find highlights on line `k`. */
  private marks(k: number, line: HugeLine) {
    if (!this.q) return '';
    const text = line.text;
    const hay = this.cs ? text : text.toLowerCase();
    const col = k === this.cur ? this.curCol(line) : -1;
    let out = '';
    let first = true;
    for (let i = hay.indexOf(this.qn); i >= 0; i = hay.indexOf(this.qn, i + this.qn.length)) {
      // The current match: at its column (as written) or the first on its line (pretty).
      const isCur = k === this.cur && (col >= 0 ? i === col : first);
      first = false;
      out += `<i class="cv-hit${isCur ? ' cur' : ''}" style="left:${(i * this.cw).toFixed(1)}px;width:${(this.qn.length * this.cw).toFixed(1)}px"></i>`;
    }
    return out;
  }

  private place() {
    // (The rows' own padding puts the first line PAD below the top.)
    const y = this.rFirst * RH + this.sc.shift;
    if (y !== this.y) this.rowsEl.style.transform = `translateY(${(this.y = y)}px)`;
  }

  /** Shows line `k` as current (centred if out of view); `at`: the match there (its offset in the file). */
  goto(k: number, at = -1, center = true) {
    this.cur = k;
    this.curAt = at;
    const top = PAD + k * RH;
    const st = this.sc.top;
    const vh = this.sc.height;
    if (top < st || top + RH > st + vh) this.sc.top = center ? top - vh / 2 + RH / 2 : top < st ? top : top - vh + RH;
    this.toCol = true;
    this.render(true);
  }

  /** Scrolls sideways to the current match's column, once its line is read. */
  private scrollToCol() {
    const line = this.lines.get(this.cur);
    if (!line) return;
    this.toCol = false;
    const col = this.curCol(line);
    if (col < 0) {
      this.el.scrollLeft = 0;
      return;
    }
    const x = col * this.cw;
    const view = this.el.clientWidth - 120;
    if (x < this.el.scrollLeft || x > this.el.scrollLeft + view) this.el.scrollLeft = Math.max(0, x - view / 3);
  }

  /** Marks the file's error: line `k` (0-based), column `col` (0-based; raw lines only). */
  setError(k: number, col: number) {
    this.errLine = k;
    this.errCol = this.mode === 'raw' ? col : -1;
    this.render(true);
  }

  /** The query to highlight. */
  setFind(q: string) {
    this.q = q;
    this.cs = q !== q.toLowerCase();
    this.qn = this.cs ? q : q.toLowerCase();
    this.render(true);
  }

  /** The line at the top of the view. */
  get topLine() {
    return this.visible[0];
  }

  /** The offset of the character under (x) on line `k` (as written), or the line's start. */
  private atIn(r: HTMLElement, k: number, x: number): number {
    const line = this.lines.get(k);
    if (!line) return -1;
    if (this.mode !== 'raw') return line.at;
    const c = r.querySelector('.cv-c') as HTMLElement;
    const col = Math.max(0, Math.min(line.text.length, Math.round((x - c.getBoundingClientRect().left) / this.cw)));
    return this.src.atOf ? this.src.atOf(line, col) : line.at + col;
  }

  private onDouble = (e: MouseEvent) => {
    const r = (e.target as HTMLElement).closest('.cv-l[data-l]') as HTMLElement | null;
    if (!r || this.mode !== 'raw' || !this.ev.edit) return;
    const at = this.atIn(r, Number(r.dataset.l), e.clientX);
    if (at >= 0) this.ev.edit(at);
  };

  /** The current line's start (where editing the text begins from the keyboard), or -1. */
  get currentAt(): number {
    const k = this.cur >= 0 ? this.cur : this.topLine;
    return this.curAt >= 0 ? this.curAt : (this.lines.get(k)?.at ?? -1);
  }

  private onClick = (e: MouseEvent) => {
    const r = (e.target as HTMLElement).closest('.cv-l[data-l]') as HTMLElement | null;
    if (!r) return;
    const k = Number(r.dataset.l);
    const line = this.lines.get(k);
    if (!line) return;
    let at = line.at;
    if (this.mode === 'raw') {
      const c = r.querySelector('.cv-c') as HTMLElement;
      const col = Math.max(0, Math.min(line.text.length - 1, Math.floor((e.clientX - c.getBoundingClientRect().left) / this.cw)));
      at = this.src.atOf ? this.src.atOf(line, col) : at + col;
    }
    this.cur = k;
    this.curAt = -1;
    this.render(true);
    this.ev.pick(at);
  };
}
