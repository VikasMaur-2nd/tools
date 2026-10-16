/*
 * Scrolling virtual lists taller than a browser lets an element be.
 *
 * Browsers cap element heights (Firefox at about 17.9 million px, Chromium
 * and Safari at 33.5 million), so a spacer of rows × row height stops
 * growing and the end of a huge document can't be scrolled to. Past MAX_H the
 * spacer is capped and the scroll range scaled: the scrollbar spans the whole
 * document, while the wheel and the scrolling keys still move the content
 * pixel for pixel. Below MAX_H nothing changes.
 *
 * Views work in content coordinates: read and set `top` instead of
 * scrollTop, size spacers with `fit()`, and draw content at y + `shift`.
 *
 * Reading scrollTop or clientHeight lays the page out first if anything
 * changed, so a view that reads them after drawing pays a whole layout
 * per frame. Both are remembered here instead: scrollTop until the element
 * scrolls (its scroll event comes before the frame that draws it) or is
 * scrolled through `top`, clientHeight until it resizes.
 */

/** Tallest spacer used (under every browser's limit). */
export const MAX_H = 15_000_000;

export class TallScroll {
  /** Content height (px). */
  private h = 0;
  private scaled = false;
  /** Content offset while scaled, kept exact (scrollTop is rounded). */
  private pos = 0;
  /** scrollTop when `pos` was last set or read; a different one means the scrollbar moved. */
  private last = -1;
  /** scrollTop, clientHeight and clientWidth as last read (null: read again). */
  private st: number | null = null;
  private vh: number | null = null;
  private vw: number | null = null;
  /** Spacer height last set (-1: none yet), and the viewport height it was scaled for. */
  private sh = -1;
  private fh = -1;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('scroll', this.onScroll, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(this.onResize).observe(el);
  }

  private onScroll = () => {
    this.st = null;
  };

  private onResize = () => {
    this.vh = this.vw = null;
  };

  /** The element's scrollTop. */
  private get scrollTop(): number {
    return (this.st ??= this.el.scrollTop);
  }

  private set scrollTop(v: number) {
    this.el.scrollTop = v;
    // (The browser rounds and clamps it: read it back when next needed.)
    this.st = null;
  }

  /** The viewport's height and width (clientHeight, clientWidth). */
  get height(): number {
    return (this.vh ??= this.el.clientHeight);
  }

  get width(): number {
    return (this.vw ??= this.el.clientWidth);
  }

  /** Sets the content height `h`, sizing `spacers` to hold it; keeps the content offset. */
  fit(h: number, ...spacers: HTMLElement[]) {
    const was = this.scaled;
    const scaled = h > MAX_H;
    const sh = Math.min(h, MAX_H);
    // The same height (and, scaled, the same viewport): nothing moves, and nothing is read.
    if (h === this.h && sh === this.sh && (!scaled || this.height === this.fh)) return;
    const top = was || scaled ? this.top : 0;
    this.h = h;
    this.scaled = scaled;
    if (scaled) this.fh = this.height;
    for (const s of spacers) s.style.height = sh + 'px';
    // A shorter spacer may have clamped scrollTop.
    if (sh < this.sh) this.st = null;
    this.sh = sh;
    if (scaled !== was) {
      const on = scaled ? 'addEventListener' : 'removeEventListener';
      this.el[on]('wheel', this.onWheel as EventListener, { passive: false });
      this.el[on]('keydown', this.onKey as EventListener);
    }
    if (scaled || was) this.top = top;
  }

  /** Content px per scrolled px. */
  private get k() {
    const vh = this.height;
    return (this.h - vh) / Math.max(1, MAX_H - vh);
  }

  /** Content offset at the top of the viewport. */
  get top(): number {
    const st = this.scrollTop;
    if (!this.scaled) return st;
    if (st !== this.last) {
      this.pos = st * this.k;
      this.last = st;
    }
    return this.pos;
  }

  set top(y: number) {
    if (!this.scaled) {
      this.scrollTop = y;
      return;
    }
    this.pos = Math.max(0, Math.min(this.h - this.height, y));
    this.scrollTop = this.pos / this.k;
    this.last = this.scrollTop;
  }

  /** Add to a content y to get where it's drawn in the scroller (0 unless scaled). */
  get shift(): number {
    return this.scaled ? this.scrollTop - this.top : 0;
  }

  /** Moves by `dy` content px; views redraw on the scroll event even when scrollTop stays put. */
  private by(dy: number) {
    const st = this.scrollTop;
    this.top = this.top + dy;
    if (this.scrollTop === st) this.el.dispatchEvent(new Event('scroll'));
  }

  private onWheel = (e: WheelEvent) => {
    // Pinch zoom, sideways and Shift+wheel scrolling stay native.
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    this.by(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1));
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.target !== this.el || e.altKey || e.ctrlKey || e.metaKey) return;
    const page = this.height * 0.875;
    const dy =
      e.key === 'ArrowDown' ? 40
      : e.key === 'ArrowUp' ? -40
      : e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey) ? page
      : e.key === 'PageUp' || (e.key === ' ' && e.shiftKey) ? -page
      : e.key === 'End' ? this.h
      : e.key === 'Home' ? -this.h
      : 0;
    if (!dy) return;
    e.preventDefault();
    this.by(dy);
  };
}
