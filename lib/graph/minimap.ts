/*
 * Minimap: the whole layout drawn once at low resolution (cached bitmap),
 * plus the viewport's rectangle on top. Click or drag it to move the camera.
 */
import type { GraphLayout } from './layout';
import type { GraphTheme } from './theme';
import { paint } from './render';
import type { Cam } from './camera';

export const MINI_W = 168;
export const MINI_H = 112;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private bmp: HTMLCanvasElement | null = null;
  private key: GraphLayout | null = null;
  private theme: GraphTheme | null = null;
  /** Scale and offset of the cached drawing (world → minimap px). */
  s = 1;
  ox = 0;
  oy = 0;

  constructor(el: HTMLCanvasElement) {
    this.el = el;
  }

  /** Drops the bitmap (inactive view, theme change). */
  release() {
    this.bmp = null;
    this.key = null;
  }

  draw(L: GraphLayout, th: GraphTheme, cam: Cam, vw: number, vh: number, dpr: number) {
    const W = MINI_W;
    const H = MINI_H;
    if (this.el.width !== W * dpr) {
      this.el.width = W * dpr;
      this.el.height = H * dpr;
    }
    if (!this.bmp || this.key !== L || this.theme !== th) {
      const s = Math.min((W - 8) / Math.max(1, L.width), (H - 8) / Math.max(1, L.height));
      this.s = s;
      this.ox = (W - L.width * s) / 2;
      this.oy = (H - L.height * s) / 2;
      const b = this.bmp ?? document.createElement('canvas');
      b.width = W * dpr;
      b.height = H * dpr;
      const ctx = b.getContext('2d');
      if (!ctx) return;
      paint(ctx, L, th, { x: -this.ox / s, y: -this.oy / s, s }, W, H, { card: -1, row: -1, hoverRow: -1, hoverCard: -1, hitRow: null, hitCard: null, curRow: -1, curCard: -1, dpr, lod: 2 });
      this.bmp = b;
      this.key = L;
      this.theme = th;
    }
    const ctx = this.el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bmp, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = this.ox + cam.x * this.s;
    const y = this.oy + cam.y * this.s;
    const w = Math.max(3, (vw / cam.s) * this.s);
    const h = Math.max(3, (vh / cam.s) * this.s);
    ctx.fillStyle = th.rowSel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = th.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.globalAlpha = 1;
  }

  /** World point under minimap point (mx, my). */
  toWorld(mx: number, my: number): [number, number] {
    return [(mx - this.ox) / this.s, (my - this.oy) / this.s];
  }
}
