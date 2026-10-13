import { escapeHtml } from './highlight';

/* Virtualized read-only code viewer with lazily highlighted lines. */

const RH = 20;
const OVERSCAN = 30;

export type LineHighlighter = (line: string) => string;

export class CodeView {
  readonly el: HTMLElement;
  private sizer: HTMLElement;
  private rows: HTMLElement;
  private ro: ResizeObserver;
  private lines: string[] = [];
  private html = new Map<number, string>();
  private hl: LineHighlighter = escapeHtml;
  private rFirst = -1;
  private rLast = -1;
  private raf = 0;
  text = '';

  constructor(el: HTMLElement) {
    this.el = el;
    this.sizer = el.querySelector('.cv-sizer') as HTMLElement;
    this.rows = el.querySelector('.cv-rows') as HTMLElement;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
  }

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  setText(text: string, hl: LineHighlighter) {
    if (text === this.text && hl === this.hl) return;
    const keepScroll = this.text && text.slice(0, 64) === this.text.slice(0, 64);
    this.text = text;
    this.hl = hl;
    this.lines = text ? text.split('\n') : [];
    this.html.clear();
    const digits = String(this.lines.length).length;
    this.el.style.setProperty('--cv-gw', `${Math.max(3, digits) + 3}ch`);
    this.sizer.style.height = this.lines.length * RH + 24 + 'px';
    if (!keepScroll) {
      this.el.scrollTop = 0;
      this.el.scrollLeft = 0;
    }
    this.render(true);
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
    const n = this.lines.length;
    const vf = Math.floor(st / RH);
    const vl = Math.min(n, Math.ceil((st + vh) / RH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return;
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(n, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    let out = '';
    for (let i = first; i < last; i++) {
      let h = this.html.get(i);
      if (h === undefined) {
        const line = this.lines[i];
        h = line.length > 5000 ? escapeHtml(line) : this.hl(line);
        this.html.set(i, h);
      }
      out += `<div class="cv-l"><span class="cv-n">${i + 1}</span><span class="cv-c">${h || ' '}</span></div>`;
    }
    this.rows.style.transform = `translateY(${first * RH}px)`;
    this.rows.innerHTML = out;
  }
}
