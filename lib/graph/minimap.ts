/*
 * Minimap: the whole layout drawn once at low resolution (cached bitmap),
 * plus the viewport's rectangle on top. Click or drag it to move the camera.
 *
 * The box takes the graph's shape (no empty margins). A graph far taller
 * (or wider) than the box can show at one scale, such as a long array of
 * records, gets a narrow strip instead, stretched along its short side, so
 * the strip works like a scrollbar that also shows where the cards are.
 */
import { G } from './model';
import type { GraphLayout } from './layout';
import type { GraphTheme } from './theme';
import type { Cam } from './camera';

/** Largest box, and the smallest view that shows one (CSS px). */
export const MINI_W = 168;
export const MINI_H = 112;
/** Thickness of a strip, and its longest side. */
const STRIP = 44;
const STRIP_MAX = 320;
/** Inner padding. */
const PAD = 4;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private bmp: HTMLCanvasElement | null = null;
  private key: GraphLayout | null = null;
  private theme: GraphTheme | null = null;
  private dpr = 0;
  private box = '';
  /** World → minimap px, per axis. */
  sx = 1;
  sy = 1;
  ox = 0;
  oy = 0;
  w = MINI_W;
  h = MINI_H;

  constructor(el: HTMLCanvasElement) {
    this.el = el;
  }

  /** Drops the bitmap (inactive view, theme change). */
  release() {
    this.bmp = null;
    this.key = null;
  }

  /** Box size and scales for `L` in a vw × vh view. */
  private fit(L: GraphLayout, vh: number) {
    const lw = Math.max(1, L.width);
    const lh = Math.max(1, L.height);
    const s = Math.min((MINI_W - 2 * PAD) / lw, (MINI_H - 2 * PAD) / lh);
    let w = Math.ceil(lw * s + 2 * PAD);
    let h = Math.ceil(lh * s + 2 * PAD);
    if (w >= STRIP && h >= STRIP) {
      this.sx = this.sy = s;
    } else if (w < STRIP) {
      // Tall: a vertical strip as long as the view allows.
      w = STRIP;
      h = Math.max(MINI_H, Math.min(STRIP_MAX, Math.round(vh * 0.55)));
      this.sx = (w - 2 * PAD) / lw;
      this.sy = (h - 2 * PAD) / lh;
    } else {
      // Wide: a horizontal strip.
      h = STRIP;
      w = STRIP_MAX;
      this.sx = (w - 2 * PAD) / lw;
      this.sy = (h - 2 * PAD) / lh;
    }
    this.w = w;
    this.h = h;
    this.ox = (w - lw * this.sx) / 2;
    this.oy = (h - lh * this.sy) / 2;
  }

  draw(L: GraphLayout, th: GraphTheme, cam: Cam, vw: number, vh: number, dpr: number) {
    if (!this.bmp || this.key !== L || this.theme !== th || this.dpr !== dpr) {
      this.fit(L, vh);
      const box = `${this.w}x${this.h}`;
      if (box !== this.box || this.dpr !== dpr) {
        this.el.width = this.w * dpr;
        this.el.height = this.h * dpr;
        this.el.style.width = this.w + 'px';
        this.el.style.height = this.h + 'px';
        this.box = box;
      }
      const b = this.bmp ?? document.createElement('canvas');
      b.width = this.w * dpr;
      b.height = this.h * dpr;
      const ctx = b.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overview(ctx, L, th, this.sx, this.sy, this.ox, this.oy);
      this.bmp = b;
      this.key = L;
      this.theme = th;
      this.dpr = dpr;
    }
    const ctx = this.el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.drawImage(this.bmp, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The view's rectangle, kept inside the box (the view can be pushed a little past the graph).
    const x0 = Math.min(this.w - 4, Math.max(1, this.ox + cam.x * this.sx));
    const y0 = Math.min(this.h - 4, Math.max(1, this.oy + cam.y * this.sy));
    const x1 = Math.max(x0 + 3, Math.min(this.w - 1, this.ox + (cam.x + vw / cam.s) * this.sx));
    const y1 = Math.max(y0 + 3, Math.min(this.h - 1, this.oy + (cam.y + vh / cam.s) * this.sy));
    ctx.fillStyle = th.rowSel;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = th.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0) - 1, Math.round(y1 - y0) - 1);
    ctx.globalAlpha = 1;
  }

  /** World point under minimap point (mx, my). */
  toWorld(mx: number, my: number): [number, number] {
    return [(mx - this.ox) / this.sx, (my - this.oy) / this.sy];
  }
}

/**
 * Every column's cards as blocks, neighbours less than a pixel apart merged
 * (binary search to the next card a pixel lower), so the work is bounded by
 * the box's pixels, not the number of cards.
 */
function overview(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, sx: number, sy: number, ox: number, oy: number) {
  const { m, y, colX } = L;
  const gap = 1 / sy;
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, ox * 2 + L.width * sx, oy * 2 + L.height * sy);
  // Big enough to read as cards: outlined like the canvas. Otherwise solid blocks that stand out.
  const outline = sx * G.minW > 6 && sy * G.head > 3;
  ctx.fillStyle = outline ? th.card : th.border;
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = 0; d < L.levels.length; d++) {
    const list = L.levels.at(d);
    const x = ox + colX[d] * sx;
    let i = 0;
    while (i < list.length) {
      const top = y[list[i]];
      let bot = top + m.h[list[i]];
      let w = m.w[list[i]];
      let j = i + 1;
      for (;;) {
        // Cards starting within a pixel of the block join it.
        let lo = j;
        let hi = list.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (y[list[mid]] < bot + gap) lo = mid + 1;
          else hi = mid;
        }
        if (lo === j) break;
        const last = list[lo - 1];
        bot = Math.max(bot, y[last] + m.h[last]);
        w = Math.max(w, m.w[last]);
        j = lo;
      }
      const by = oy + top * sy;
      ctx.rect(x, by, Math.max(1, w * sx), Math.max(1, (bot - top) * sy));
      i = j;
    }
  }
  ctx.fill();
  if (outline) ctx.stroke();
}
