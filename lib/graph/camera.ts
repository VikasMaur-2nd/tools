/*
 * Graph camera: screen = (world - origin) × scale. Pure math (pan, zoom
 * around a point, fit, follow) plus a small tween for animated moves.
 */

export interface Cam {
  /** World point at the viewport's top-left. */
  x: number;
  y: number;
  s: number;
}

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 3;
/** Margin around fitted graphs and followed selections (CSS px). */
export const MARGIN = 24;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Smallest zoom: ZOOM_MIN, or less when that's what it takes to show a huge graph whole. */
export function minZoom(w: number, h: number, vw: number, vh: number) {
  const f = fitScale(w, h, vw, vh);
  return Math.max(1e-4, Math.min(ZOOM_MIN, f));
}

/** Scale that shows a w × h drawing whole in a vw × vh viewport, with margins (no upper clamp). */
export function fitScale(w: number, h: number, vw: number, vh: number) {
  const aw = Math.max(1, vw - 2 * MARGIN);
  const ah = Math.max(1, vh - 2 * MARGIN);
  return Math.min(aw / Math.max(1, w), ah / Math.max(1, h));
}

/** Zooms by `f` keeping the world point under screen (sx, sy) in place. */
export function zoomAt(c: Cam, f: number, sx: number, sy: number, min: number, max = ZOOM_MAX): Cam {
  const s = clamp(c.s * f, min, max);
  const wx = c.x + sx / c.s;
  const wy = c.y + sy / c.s;
  return { x: wx - sx / s, y: wy - sy / s, s };
}

/** The whole drawing centred, at most 100%. */
export function fitCam(w: number, h: number, vw: number, vh: number, min: number): Cam {
  const s = clamp(fitScale(w, h, vw, vh), min, 1);
  return { x: w / 2 - vw / 2 / s, y: h / 2 - vh / 2 / s, s };
}

/** First view of a document: fitted when that stays readable (≥ 0.6), else 100% from the top-left. */
export function initialCam(w: number, h: number, vw: number, vh: number, min: number): Cam {
  const f = fitScale(w, h, vw, vh);
  if (f >= 0.6) return fitCam(w, h, vw, vh, min);
  return { x: -MARGIN, y: -MARGIN, s: 1 };
}

/**
 * The camera moved as little as possible so the box (world coords) is in
 * view with a margin; `center` centres it instead. A box larger than the
 * viewport shows its top-left.
 */
export function follow(c: Cam, bx: number, by: number, bw: number, bh: number, vw: number, vh: number, center = false): Cam {
  const m = MARGIN / c.s;
  const ww = vw / c.s;
  const wh = vh / c.s;
  let { x, y } = c;
  if (center) {
    x = bw + 2 * m > ww ? bx - m : bx + bw / 2 - ww / 2;
    y = bh + 2 * m > wh ? by - m : by + bh / 2 - wh / 2;
  } else {
    if (bx + bw + m > x + ww) x = bx + bw + m - ww;
    if (bx - m < x) x = bx - m;
    if (by + bh + m > y + wh) y = by + bh + m - wh;
    if (by - m < y) y = by - m;
  }
  return { x, y, s: c.s };
}

/** Level of detail at scale s: 0 = full text, 1 = skeleton bars, 2 = blocks (merged under ~1.5 px). */
export const LOD_TEXT = 0.45;
export const LOD_SKEL = 0.15;
export const lodOf = (s: number) => (s >= LOD_TEXT ? 0 : s >= LOD_SKEL ? 1 : 2);

/** Camera between a and b at t ∈ [0, 1] (zoom interpolated geometrically, the screen centre moves linearly). */
export function lerpCam(a: Cam, b: Cam, t: number, vw: number, vh: number): Cam {
  const s = a.s * Math.pow(b.s / a.s, t);
  const ax = a.x + vw / 2 / a.s;
  const ay = a.y + vh / 2 / a.s;
  const bx = b.x + vw / 2 / b.s;
  const by = b.y + vh / 2 / b.s;
  const cx = ax + (bx - ax) * t;
  const cy = ay + (by - ay) * t;
  return { x: cx - vw / 2 / s, y: cy - vh / 2 / s, s };
}

export const ease = (t: number) => 1 - Math.pow(1 - t, 3);
