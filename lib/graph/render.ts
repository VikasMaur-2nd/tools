/*
 * Paints a viewport of the graph layout on a 2D canvas: edges, cards, rows,
 * selection, hover and find hits. Pure (no DOM state): the view and the
 * minimap both call it. Work is bounded by what's visible: cards and edge
 * groups come from binary searches per column, rows inside tall cards are
 * culled, and at low zoom neighbouring cards merge into one block per pixel.
 */
import { ARR, BOOL, NUL, NUM, STR, type JNode } from '../json/parser';
import { G, SWATCH_COLS, SWATCH_PX, fitCols, headText, headX, labelText, sizeText, swatch, valueText } from './model';
import { cardsIn, groupsIn, type GraphLayout } from './layout';
import type { GraphTheme } from './theme';
import { lodOf, type Cam } from './camera';

export interface Paint {
  /** Selected card (-1: none) and row (-1: its header). */
  card: number;
  row: number;
  hoverRow: number;
  hoverCard: number;
  /** Find hits per row / per card header (null: no search). */
  hitRow: Uint8Array | null;
  hitCard: Uint8Array | null;
  curRow: number;
  curCard: number;
  /** Device pixels per CSS px. */
  dpr: number;
  /** Force a level of detail (minimap: 2). */
  lod?: number;
  /** Skip the background fill. */
  clear?: boolean;
  /** Dot grid on the background (on screen, not in the minimap or exports). */
  grid?: boolean;
}

/** Grid spacing (world px) and the smallest on-screen spacing worth drawing. */
const GRID = 24;
const GRID_MIN = 10;
let gridTile: { canvas: HTMLCanvasElement; size: number; dot: number; color: string; dpr: number } | null = null;

/** Dots every GRID world px, aligned with the camera (one pattern fill). */
export function grid(ctx: CanvasRenderingContext2D, th: GraphTheme, cam: Cam, vw: number, vh: number, dpr: number) {
  const step = GRID * cam.s;
  if (step < GRID_MIN) return;
  const size = Math.max(2, Math.round(step * dpr));
  const color = th.grid ?? th.border;
  const dot = Math.max(1, Math.round(dpr * Math.min(1.5, cam.s * 1.25)));
  if (!gridTile || gridTile.size !== size || gridTile.dot !== dot || gridTile.color !== color || gridTile.dpr !== dpr) {
    const canvas = gridTile?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, size, size);
    g.fillStyle = color;
    g.fillRect(0, 0, dot, dot);
    gridTile = { canvas, size, dot, color, dpr };
  }
  const pattern = ctx.createPattern(gridTile.canvas, 'repeat');
  if (!pattern) return;
  // Device-pixel offset of the world origin, wrapped to one tile.
  const ox = ((((-cam.x * cam.s) % step) + step) % step) * dpr;
  const oy = ((((-cam.y * cam.s) % step) + step) % step) * dpr;
  pattern.setTransform(new DOMMatrix([step * dpr / size, 0, 0, step * dpr / size, ox, oy]));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, vw * dpr, vh * dpr);
  ctx.restore();
}

/** Colour of a row's value. */
export const valueColor = (t: GraphTheme, n: JNode) => kindColor(t, n.t);

/** Colour of values of kind `k` (containers and their sizes are muted). */
function kindColor(t: GraphTheme, k: number): string {
  switch (k) {
    case STR:
      return t.str;
    case NUM:
      return t.num;
    case BOOL:
      return t.bool;
    case NUL:
      return t.nul;
    default:
      return t.muted;
  }
}

const R = 6;

/**
 * Row texts are cut, escaped and (for inline arrays) joined on every frame
 * otherwise: cache them per model while panning (bounded; a new model or a
 * full cache starts over).
 */
let textsFor: GraphLayout['m'] | null = null;
const labels = new Map<number, string>();
const values = new Map<number, string>();
const TEXT_CACHE = 40_000;
const selectedPath = new WeakMap<GraphLayout, { target: number; cards: Int32Array }>();
/** Value text of row r (fills the cache for its label too). */
function rowValue(m: GraphLayout['m'], r: number): string {
  if (textsFor !== m || values.size > TEXT_CACHE) {
    textsFor = m;
    labels.clear();
    values.clear();
  }
  let v = values.get(r);
  if (v === undefined) {
    const k = m.rowNode[r];
    v = valueText(k);
    values.set(r, v);
    labels.set(r, labelText(k));
  }
  return v;
}
/** Label text of row r (after rowValue). */
const rowLabel = (r: number) => labels.get(r) as string;

/**
 * Lets go of what painting keeps between frames: the last model's texts and the
 * last frame's strings (pieces of the document, which can hold all of it). For a
 * view that is hidden, emptied or gone; the next frame builds them again.
 */
export function releasePaint() {
  textsFor = null;
  labels.clear();
  values.clear();
  for (const r of [TEXT.key, TEXT.index, TEXT.head, TEXT.size, ...TEXT.value]) r.x.length = r.y.length = r.t.length = r.n = 0;
}

function firstColumn(colX: Float64Array, colW: Float64Array, x: number) {
  let lo = 0;
  let hi = colX.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (colX[mid] + colW[mid] + G.colGap < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function afterColumn(colX: Float64Array, x: number) {
  let lo = 0;
  let hi = colX.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (colX[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function selectedCards(L: GraphLayout, target: number) {
  const cached = selectedPath.get(L);
  if (cached?.target === target) return cached.cards;
  const { parent, depth } = L.m;
  const cards = new Int32Array(depth[target]);
  let c = target;
  for (let i = cards.length - 1; i >= 0; i--) {
    cards[i] = c;
    c = parent[c];
  }
  selectedPath.set(L, { target, cards });
  return cards;
}

/** Paints `L` as seen by `cam` in a vw × vh (CSS px) viewport. */
export function paint(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, cam: Cam, vw: number, vh: number, p: Paint) {
  const { m, x, y, colX, colW } = L;
  const s = cam.s;
  const dpr = p.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (p.clear !== false) {
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, vw, vh);
    if (p.grid) grid(ctx, th, cam, vw, vh, dpr);
  }
  if (!m.n) return;
  const lod = p.lod ?? lodOf(s);
  // World units from here on, relative to the camera origin (Float64 math in JS, small numbers for canvas).
  ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  const ox = cam.x;
  const oy = cam.y;
  const wy0 = oy;
  const wy1 = oy + vh / s;
  const wx0 = ox;
  const wx1 = ox + vw / s;
  const px = 1 / s;
  const cols = colX.length;
  // First and last column in view (a column's edges live in the gap to its right).
  const d0 = firstColumn(colX, colW, wx0);
  const d1 = afterColumn(colX, wx1);

  // ── Edges ──
  ctx.strokeStyle = th.edge;
  ctx.lineWidth = Math.max(1.25, lod === 2 ? px : 1.25);
  ctx.beginPath();
  for (let d = Math.max(0, d0 - 1); d < Math.min(cols - 1, d1); d++) {
    // A column (with its gap) under a pixel wide: its edges are no bigger than the borders of the blocks
    // they join, which cover them, except the ones that span more than a pixel of height.
    const thin = lod === 2 && colX[d + 1] - colX[d] <= px;
    if (thin && column(L, d).ext <= px) continue;
    const [a, b] = groupsIn(L, d, wy0, wy1);
    const list = L.groups.at(d);
    const gy0 = L.gy0.at(d);
    const gy1 = L.gy1.at(d);
    for (let g = a; g < b; ) {
      const c = list[g];
      if (gy1[g] >= wy0 && !(thin && gy1[g] - gy0[g] <= px)) edgesOf(ctx, L, c, ox, oy, wy0, wy1, lod, px, thin);
      // Far out, one parent per pixel row is plenty: jump over the rest (keeps a frame bounded by screen size, not card count).
      g = lod === 2 ? groupFrom(L, list, g + 1, b, y[c] + 1.5 * px) : g + 1;
    }
  }
  ctx.stroke();

  // ── The selection's path from the root, over the other edges ──
  const target = p.row >= 0 && m.rowChild[p.row] >= 0 && L.shown[m.rowChild[p.row]] ? m.rowChild[p.row] : p.card;
  if (target > 0 && target < m.n && L.shown[target]) {
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = Math.max(2, 1.5 * px);
    ctx.beginPath();
    const path = selectedCards(L, target);
    const from = Math.max(1, d0);
    const to = Math.min(d1, path.length + 1);
    for (let d = from; d < to; d++) edgeInto(ctx, L, path[d - 1], ox, oy);
    ctx.stroke();
  }

  // ── Cards ──
  ctx.font = th.font;
  ctx.textBaseline = 'middle';
  if (lod === 2) {
    for (let d = d0; d < d1; d++) {
      const [a, b] = cardsIn(L, d, wy0, wy1);
      blocks(ctx, L, th, d, a, b, ox, oy, px, p);
    }
  } else cards(ctx, L, th, d0, d1, ox, oy, wy0, wy1, lod, px, p);

  // ── Selection outline ──
  const sc = p.card;
  if (sc >= 0 && sc < m.n && L.shown[sc]) {
    const cx = x[sc] - ox;
    const cy = y[sc] - oy;
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    rrect(ctx, cx - px, cy - px, m.w[sc] + 2 * px, m.h[sc] + 2 * px, R + px);
    ctx.stroke();
  }
}

function rrect(ctx: CanvasPath, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  band(ctx, x, y, w, h, r, r);
}

/**
 * Native rounded rectangles, where the browser has them. Frames put hundreds
 * of cards in one path, and there arcTo is very slow in WebKit, and so is
 * closePath in Chromium (each looks back through the whole path).
 */
const NATIVE_ROUND = typeof Path2D !== 'undefined' && typeof Path2D.prototype.roundRect === 'function';
const corners = [0, 0, 0, 0];

/** A rectangle with top corners of radius rt and bottom corners of radius rb (0: square). */
function band(ctx: CanvasPath, x: number, y: number, w: number, h: number, rt: number, rb: number) {
  if (NATIVE_ROUND) {
    if (rt === rb) return ctx.roundRect(x, y, w, h, rt);
    corners[0] = corners[1] = rt;
    corners[2] = corners[3] = rb;
    return ctx.roundRect(x, y, w, h, corners);
  }
  // Ends where it starts, on a straight edge, so it needs no closePath (fills close it anyway).
  ctx.moveTo(x + rt, y);
  ctx.arcTo(x + w, y, x + w, y + h, rt);
  ctx.arcTo(x + w, y + h, x, y + h, rb);
  ctx.arcTo(x, y + h, x, y, rb);
  ctx.arcTo(x, y, x + w, y, rt);
}

/** First index in [from, to) of `list` (cards top to bottom) whose card top is at or below `at`. */
function groupFrom(L: GraphLayout, list: Int32Array, from: number, to: number, at: number) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (L.y[list[mid]] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in [from, to) of kidList whose card top is at or below `at`. */
const kidFrom = (L: GraphLayout, from: number, to: number, at: number) => groupFrom(L, L.m.kidList, from, to, at);

/** Index range of p's children (in kidList) whose anchors may be within y0 … y1. */
function kidsIn(L: GraphLayout, p: number, y0: number, y1: number): [number, number] {
  const { kidStart, kidList, h } = L.m;
  let lo = kidStart[p];
  let hi = kidStart[p + 1];
  const end = hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = kidList[mid];
    if (L.y[c] + h[c] < y0) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (L.y[kidList[mid]] <= y1) lo = mid + 1;
    else hi = mid;
  }
  return [from, lo];
}

/** The one edge into card `c` (same geometry as edgesOf draws it). */
function edgeInto(ctx: CanvasRenderingContext2D, L: GraphLayout, c: number, ox: number, oy: number) {
  const { m, x, y } = L;
  const p = m.parent[c];
  const sx = x[p] + m.w[p] - ox;
  const ex = x[c] - ox;
  const ey = y[c] + G.head / 2 - oy;
  if (m.bus[p]) {
    const py = y[p] + G.head / 2 - oy;
    const tx = L.colX[m.depth[c]] - G.colGap / 2 - ox;
    const dy = ey - py;
    const r = Math.min(R, Math.abs(dy), (ex - tx) / 2);
    ctx.moveTo(sx, py);
    if (r > 0.5) {
      const sg = dy > 0 ? 1 : -1;
      ctx.lineTo(tx, py);
      ctx.lineTo(tx, ey - sg * r);
      ctx.quadraticCurveTo(tx, ey, tx + r, ey);
    } else {
      ctx.lineTo(tx, py);
      ctx.lineTo(tx, ey);
    }
    ctx.lineTo(ex, ey);
    return;
  }
  const sy = y[p] + G.head + (m.portRow[c] - m.rowStart[p]) * G.row + G.row / 2 - oy;
  ctx.moveTo(sx, sy);
  if (Math.abs(ey - sy) < 0.5) ctx.lineTo(ex, ey);
  else {
    const mx = (sx + ex) / 2;
    ctx.bezierCurveTo(mx, sy, mx, ey, ex, ey);
  }
}

/** The edges out of card `p` in view. `thin`: its column is under a pixel wide, so only edges that span more than a pixel of height show. */
function edgesOf(ctx: CanvasRenderingContext2D, L: GraphLayout, p: number, ox: number, oy: number, wy0: number, wy1: number, lod: number, px: number, thin: boolean) {
  const { m, x, y } = L;
  const sx = x[p] + m.w[p] - ox;
  const d = m.depth[p];
  const nx = L.colX[d + 1] - ox;
  const { kidList, rowStart } = m;
  // Port rows that leave from above the viewport still curve into it: widen the child range by the port spread.
  const spread = (rowStart[p + 1] - rowStart[p]) * G.row + G.head;
  let [a, b] = kidsIn(L, p, wy0 - spread, wy1 + spread);
  if (m.bus[p]) {
    const py = y[p] + G.head / 2 - oy;
    const tx = nx - G.colGap / 2;
    if (a >= b) {
      // Trunk only (all stubs off-screen).
      [a, b] = [m.kidStart[p], m.kidStart[p + 1]];
      const fy = y[kidList[a]] + G.head / 2 - oy;
      const ly = y[kidList[b - 1]] + G.head / 2 - oy;
      ctx.moveTo(sx, py);
      ctx.lineTo(tx, py);
      ctx.moveTo(tx, Math.max(Math.min(py, fy), wy0 - oy - 10));
      ctx.lineTo(tx, Math.min(Math.max(py, ly), wy1 - oy + 10));
      return;
    }
    const fy = y[kidList[m.kidStart[p]]] + G.head / 2 - oy;
    const ly = y[kidList[m.kidStart[p + 1] - 1]] + G.head / 2 - oy;
    ctx.moveTo(sx, py);
    ctx.lineTo(tx, py);
    // Trunk, clipped to the view.
    const t0 = Math.max(Math.min(py, fy), wy0 - oy - 10);
    const t1 = Math.min(Math.max(py, ly), wy1 - oy + 10);
    if (t1 > t0) {
      ctx.moveTo(tx, t0);
      ctx.lineTo(tx, t1);
    }
    // Stubs are flat.
    if (thin) return;
    for (let i = a; i < b; ) {
      const c = kidList[i];
      i = lod === 2 ? kidFrom(L, i + 1, b, y[c] + 1.5 * px) : i + 1;
      const ay = y[c] + G.head / 2 - oy;
      const dy = ay - py;
      const r = Math.min(R, Math.abs(dy), (x[c] - ox - tx) / 2);
      if (r > 0.5 && lod < 2) {
        const sg = dy > 0 ? 1 : -1;
        ctx.moveTo(tx, ay - sg * r);
        ctx.quadraticCurveTo(tx, ay, tx + r, ay);
      } else ctx.moveTo(tx, ay);
      ctx.lineTo(x[c] - ox, ay);
    }
    return;
  }
  const r0 = rowStart[p];
  for (let i = a; i < b; ) {
    const c = kidList[i];
    i = lod === 2 ? kidFrom(L, i + 1, b, y[c] + 1.5 * px) : i + 1;
    const sy = y[p] + G.head + (m.portRow[c] - r0) * G.row + G.row / 2 - oy;
    const ey = y[c] + G.head / 2 - oy;
    if (thin && Math.abs(ey - sy) <= px) continue;
    const ex = x[c] - ox;
    ctx.moveTo(sx, sy);
    if (Math.abs(ey - sy) < 0.5) ctx.lineTo(ex, ey);
    else {
      const mx = (sx + ex) / 2;
      ctx.bezierCurveTo(mx, sy, mx, ey, ex, ey);
    }
  }
}

/**
 * Per column of a layout, built the first time it's drawn far out: the space
 * above each card (to the one before it), and per 64 cards the largest space
 * and width. Merging a block of thousands of cards then takes a scan of a few
 * numbers, not a search per pixel. `ext`: the tallest group of edges.
 */
export interface Column {
  gap: Float32Array;
  gapMax: Float32Array;
  wMax: Float32Array;
  ext: number;
}
const columnsOf = new WeakMap<GraphLayout, Column[]>();

export function column(L: GraphLayout, d: number): Column {
  let all = columnsOf.get(L);
  if (!all) columnsOf.set(L, (all = []));
  const known = all[d];
  if (known) return known;
  const { m, y } = L;
  const list = L.levels.at(d);
  const n = list.length;
  const gap = new Float32Array(n);
  const gapMax = new Float32Array((n + 63) >> 6);
  const wMax = new Float32Array((n + 63) >> 6);
  let below = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const g = (gap[i] = y[c] - below);
    below = y[c] + m.h[c];
    const k = i >> 6;
    if (g > gapMax[k]) gapMax[k] = g;
    if (m.w[c] > wMax[k]) wMax[k] = m.w[c];
  }
  let ext = 0;
  const gy0 = L.gy0.at(d);
  const gy1 = L.gy1.at(d);
  if (gy0) for (let g = 0; g < gy0.length; g++) ext = Math.max(ext, gy1[g] - gy0[g]);
  return (all[d] = { gap, gapMax, wMax, ext });
}

/** End (exclusive) of the block that starts at list index i: the first card more than `t` below the one before it, or b. */
export function blockEnd(col: Column, i: number, b: number, t: number) {
  const { gap, gapMax } = col;
  let k = i + 1;
  for (; k < b && k & 63; k++) if (gap[k] > t) return k;
  while (k + 64 <= b && gapMax[k >> 6] <= t) k += 64;
  for (; k < b; k++) if (gap[k] > t) return k;
  return b;
}

/** Widest card in list[i … j). */
export function widest(m: GraphLayout['m'], col: Column, list: Int32Array, i: number, j: number) {
  let w = 0;
  let k = i;
  for (; k < j && k & 63; k++) w = Math.max(w, m.w[list[k]]);
  for (; k + 64 <= j; k += 64) w = Math.max(w, col.wMax[k >> 6]);
  for (; k < j; k++) w = Math.max(w, m.w[list[k]]);
  return w;
}

/** Low zoom: card blocks, neighbours closer than ~1.5 px merged (at most one block per pixel row). */
function blocks(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, d: number, a: number, b: number, ox: number, oy: number, px: number, p: Paint) {
  const { m, y } = L;
  const list = L.levels.at(d);
  const cx = L.colX[d] - ox;
  ctx.fillStyle = th.head;
  ctx.strokeStyle = th.border;
  ctx.lineWidth = px;
  ctx.beginPath();
  const col = column(L, d);
  const merged = 1.5 * px;
  let i = a;
  while (i < b) {
    const c = list[i];
    const top = y[c];
    // Every card that starts within 1.5 px of the one above joins the block.
    const j = blockEnd(col, i, b, merged);
    const last = list[j - 1];
    const bot = y[last] + m.h[last];
    const w = j - i === 1 ? m.w[c] : widest(m, col, list, i, j);
    const hgt = Math.max(bot - top, px);
    if (j - i === 1 && hgt > 4 * px) rrect(ctx, cx, top - oy, w, hgt, Math.min(R, hgt / 4));
    else ctx.rect(cx, top - oy, w, hgt);
    i = j;
  }
  ctx.fill();
  ctx.stroke();
  // The selection and the current find hit still show as coloured blocks (the hit on top).
  if (a >= b) return;
  const y0 = y[list[a]];
  const y1 = y[list[b - 1]];
  for (const [c, col] of [[p.card, th.accent], [p.hitCard ? p.curCard : -1, th.hitCur]] as const) {
    if (c < 0 || c >= m.n || !L.shown[c] || m.depth[c] !== d || y[c] < y0 || y[c] > y1) continue;
    ctx.fillStyle = col;
    ctx.fillRect(cx, y[c] - oy, m.w[c], Math.max(m.h[c], 2 * px));
  }
}

/** Cards in view and their rows in view (lod 0 and 1), reused between frames. */
let shownCards = new Int32Array(512);
let rowsFrom = new Int32Array(512);
let rowsTo = new Int32Array(512);

/** Texts of one style: positions and strings, reused between frames. */
interface Texts {
  x: number[];
  y: number[];
  t: string[];
  n: number;
}
const texts = (): Texts => ({ x: [], y: [], t: [], n: 0 });
const TEXT = { key: texts(), index: texts(), head: texts(), size: texts(), value: [texts(), texts(), texts(), texts(), texts()] };

function put(r: Texts, x: number, y: number, t: string) {
  r.x[r.n] = x;
  r.y[r.n] = y;
  r.t[r.n] = t;
  r.n++;
}

function flush(ctx: CanvasRenderingContext2D, r: Texts, color: string) {
  if (!r.n) return;
  ctx.fillStyle = color;
  for (let i = 0; i < r.n; i++) ctx.fillText(r.t[i], r.x[i], r.y[i]);
  r.n = 0;
}

/** Text and skeleton colours by row kind: strings, numbers, booleans, null, and the muted rest. */
const kindSlot = (t: number) => (t === STR ? 0 : t === NUM ? 1 : t === BOOL ? 2 : t === NUL ? 3 : 4);

/** Card c's header band: the top of its rounded body (all of it when the card has no rows). */
function headPath(ctx: CanvasPath, L: GraphLayout, c: number, ox: number, oy: number) {
  const w = L.m.w[c];
  const h = L.m.h[c];
  const r = Math.min(R, w / 2, h / 2);
  const hh = Math.min(G.head, h);
  band(ctx, L.x[c] - ox, L.y[c] - oy, w, hh, r, hh >= h ? r : 0);
}

/** Row r of card c, inside its rounded body (the last row can reach into the bottom corners). For fills. */
function rowPath(ctx: CanvasPath, L: GraphLayout, c: number, r: number, ox: number, oy: number) {
  const { m } = L;
  const w = m.w[c];
  const x = L.x[c] - ox;
  const ry = L.y[c] - oy + G.head + (r - m.rowStart[c]) * G.row;
  const rad = Math.min(R, w / 2, m.h[c] / 2);
  // The corners' arcs are centred `rad` above the bottom; `cut`: how far below that the row ends.
  const cy = L.y[c] - oy + m.h[c] - rad;
  const cut = ry + G.row - cy;
  if (cut <= 0) return void ctx.rect(x, ry, w, G.row);
  const a = Math.asin(Math.min(1, cut / rad));
  ctx.moveTo(x, ry);
  ctx.lineTo(x + w, ry);
  ctx.lineTo(x + w, cy);
  ctx.arc(x + w - rad, cy, rad, 0, a);
  ctx.lineTo(x + rad - rad * Math.cos(a), ry + G.row);
  ctx.arc(x + rad, cy, rad, Math.PI - a, Math.PI);
}

/**
 * The cards in view, one layer at a time for all of them (bodies, headers,
 * rows, text, borders, dots): a fill per colour per frame instead of several
 * per card. Cards never overlap, so this paints what card-by-card would.
 */
function cards(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, d0: number, d1: number, ox: number, oy: number, wy0: number, wy1: number, lod: number, px: number, p: Paint) {
  const { m, x, y } = L;
  let n = 0;
  for (let d = d0; d < d1; d++) {
    const list = L.levels.at(d);
    const [a, b] = cardsIn(L, d, wy0, wy1);
    if (n + b - a > shownCards.length) {
      const size = Math.max(2 * shownCards.length, n + b - a);
      const grow = (old: Int32Array) => {
        const next = new Int32Array(size);
        next.set(old.subarray(0, n));
        return next;
      };
      shownCards = grow(shownCards);
      rowsFrom = grow(rowsFrom);
      rowsTo = grow(rowsTo);
    }
    for (let i = a; i < b; i++) {
      const c = list[i];
      const r0 = m.rowStart[c];
      const top = y[c] - oy + G.head;
      shownCards[n] = c;
      rowsFrom[n] = Math.max(r0, r0 + Math.floor((wy0 - oy - top) / G.row));
      rowsTo[n] = Math.min(m.rowStart[c + 1], r0 + Math.ceil((wy1 - oy - top) / G.row));
      n++;
    }
  }
  if (!n) return;
  const cs = shownCards;

  // Bodies.
  ctx.fillStyle = th.card;
  ctx.beginPath();
  for (let i = 0; i < n; i++) rrect(ctx, x[cs[i]] - ox, y[cs[i]] - oy, m.w[cs[i]], m.h[cs[i]], R);
  ctx.fill();

  // Header bands, in the find colours for hits; then the selected or hovered header.
  const hitCard = p.hitCard;
  let hits = 0;
  ctx.fillStyle = th.head;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (hitCard && hitCard[cs[i]]) hits++;
    else headPath(ctx, L, cs[i], ox, oy);
  }
  ctx.fill();
  if (hitCard && hits) {
    let cur = false;
    ctx.fillStyle = th.hit;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      if (!hitCard[c]) continue;
      if (c === p.curCard) cur = true;
      else headPath(ctx, L, c, ox, oy);
    }
    ctx.fill();
    if (cur) {
      ctx.fillStyle = th.hitCur;
      ctx.beginPath();
      headPath(ctx, L, p.curCard, ox, oy);
      ctx.fill();
    }
  }
  const over = (c: number, color: string, row: number) => {
    if (c < 0 || c >= m.n || !L.shown[c] || (row >= 0 && (row < m.rowStart[c] || row >= m.rowStart[c + 1]))) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (row < 0) headPath(ctx, L, c, ox, oy);
    else rowPath(ctx, L, c, row, ox, oy);
    ctx.fill();
  };
  if (p.row < 0) over(p.card, th.rowSel, -1);
  if (p.hoverRow < 0 && !(p.hoverCard === p.card && p.row < 0)) over(p.hoverCard, th.rowHover, -1);

  // The line under each header.
  ctx.fillStyle = th.border;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    if (m.h[c] > G.head) ctx.rect(x[c] - ox, y[c] - oy + G.head - px / 2, m.w[c], px);
  }
  ctx.fill();

  // Selected, hovered and found rows.
  if (p.row >= 0) over(p.card, th.rowSel, p.row);
  if (p.hoverRow >= 0 && p.hoverRow !== p.row) over(p.hoverCard, th.rowHover, p.hoverRow);
  if (p.hitRow) {
    const hitRow = p.hitRow;
    let cur = -1;
    ctx.fillStyle = th.hit;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      for (let r = rowsFrom[i]; r < rowsTo[i]; r++) {
        if (!hitRow[r]) continue;
        if (r === p.curRow) cur = i;
        else rowPath(ctx, L, cs[i], r, ox, oy);
      }
    }
    ctx.fill();
    if (cur >= 0) {
      ctx.fillStyle = th.hitCur;
      ctx.beginPath();
      rowPath(ctx, L, cs[cur], p.curRow, ox, oy);
      ctx.fill();
    }
  }

  if (lod === 0) cardTexts(ctx, L, th, cs, n, ox, oy, px);
  else skeletons(ctx, L, th, cs, n, ox, oy);

  // Borders.
  ctx.strokeStyle = th.border;
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    rrect(ctx, x[c] - ox + px / 2, y[c] - oy + px / 2, m.w[c] - px, m.h[c] - px, R);
  }
  ctx.stroke();

  // Port dots: one per port row in view, on the right edge; a bus has one on the header.
  const dr = 3;
  ctx.fillStyle = th.edge;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    if (!m.kids[c]) continue;
    const ex = x[c] - ox + m.w[c];
    const cy = y[c] - oy;
    if (m.bus[c]) {
      ctx.moveTo(ex + dr, cy + G.head / 2);
      ctx.arc(ex, cy + G.head / 2, dr, 0, Math.PI * 2);
      continue;
    }
    const r0 = m.rowStart[c];
    for (let r = rowsFrom[i]; r < rowsTo[i]; r++) {
      if (m.rowChild[r] < 0) continue;
      const my = cy + G.head + (r - r0) * G.row + G.row / 2;
      ctx.moveTo(ex + dr, my);
      ctx.arc(ex, my, dr, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  // Chevrons (cards with children; always there so collapsing is discoverable, stronger on hover and when collapsed),
  // then the pill of each collapsed card.
  if (lod === 0) {
    const strong = new Path2D();
    const faint = new Path2D();
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      if (!m.kids[c]) continue;
      const col = L.collapsed[c];
      const path = col || (c === p.hoverCard && p.hoverRow < 0) ? strong : faint;
      const chx = x[c] - ox + G.padX + 1;
      const chy = y[c] - oy + G.head / 2;
      if (col) {
        path.moveTo(chx - 1.5, chy - 3);
        path.lineTo(chx + 1.5, chy);
        path.lineTo(chx - 1.5, chy + 3);
      } else {
        path.moveTo(chx - 2.5, chy - 1.5);
        path.lineTo(chx, chy + 1.5);
        path.lineTo(chx + 2.5, chy - 1.5);
      }
    }
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = th.faint;
    ctx.stroke(faint);
    ctx.strokeStyle = th.muted;
    ctx.stroke(strong);
  }
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    if (!m.kids[c] || !L.collapsed[c]) continue;
    const label = '+' + compactNum(m.end[c] - c - 1);
    const pw = label.length * m.charW + 12;
    const pxl = x[c] - ox + m.w[c] + 8;
    const pyl = y[c] - oy + (G.head - 18) / 2;
    ctx.fillStyle = th.head;
    ctx.strokeStyle = th.border;
    ctx.lineWidth = px;
    ctx.beginPath();
    rrect(ctx, pxl, pyl, pw, 18, 9);
    ctx.fill();
    ctx.stroke();
    if (lod === 0) {
      ctx.fillStyle = th.muted;
      ctx.fillText(label, pxl + 6, pyl + 9);
    }
  }
}

/** Full detail: row labels and values, colour swatches, header labels and size badges, one fill colour at a time. */
function cardTexts(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, cs: Int32Array, n: number, ox: number, oy: number, px: number) {
  const { m, x, y } = L;
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    const cx = x[c] - ox;
    const cy = y[c] - oy;
    const r0 = m.rowStart[c];
    const top = cy + G.head;
    const vx = cx + G.padX + (m.labelW[c] ? m.labelW[c] + G.gap : 0);
    for (let r = rowsFrom[i]; r < rowsTo[i]; r++) {
      const k = m.rowNode[r];
      const my = top + (r - r0) * G.row + G.row / 2;
      const value = rowValue(m, r);
      if (m.labelW[c]) put(typeof k.key === 'number' ? TEXT.index : TEXT.key, cx + G.padX, my, rowLabel(r));
      // A colour value: its swatch, then the text after the columns the model reserved for it.
      let tx = vx;
      if (swatch(k)) {
        ctx.fillStyle = k.v as string;
        ctx.fillRect(vx + 1, my - SWATCH_PX / 2, SWATCH_PX, SWATCH_PX);
        ctx.strokeStyle = th.border;
        ctx.lineWidth = px;
        ctx.strokeRect(vx + 1, my - SWATCH_PX / 2, SWATCH_PX, SWATCH_PX);
        tx += SWATCH_COLS * m.charW;
      }
      put(TEXT.value[kindSlot(k.t)], tx, my, value);
    }
    const nd = m.node[c];
    put(TEXT.head, cx + headX(m, c), cy + G.head / 2, headText(nd));
    if (nd.t >= ARR) put(TEXT.size, cx + m.w[c] - G.padX - (m.bus[c] ? G.port : 0), cy + G.head / 2, sizeText(nd));
  }
  flush(ctx, TEXT.key, th.key);
  flush(ctx, TEXT.index, th.muted);
  const v = TEXT.value;
  flush(ctx, v[0], th.str);
  flush(ctx, v[1], th.num);
  flush(ctx, v[2], th.bool);
  flush(ctx, v[3], th.nul);
  flush(ctx, v[4], th.muted);
  ctx.font = '600 ' + th.font;
  flush(ctx, TEXT.head, th.fg);
  ctx.font = th.font;
  ctx.textAlign = 'right';
  flush(ctx, TEXT.size, th.muted);
  ctx.textAlign = 'left';
}

/** Skeleton detail: bars as long as the texts would be, one path per colour. */
function skeletons(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, cs: Int32Array, n: number, ox: number, oy: number) {
  const { m, x, y } = L;
  const cw = m.charW;
  const bh = 6;
  const key = new Path2D();
  const head = new Path2D();
  // Index labels share the muted colour with containers.
  const value = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    const cx = x[c] - ox;
    const cy = y[c] - oy;
    const r0 = m.rowStart[c];
    const top = cy + G.head;
    const vx = cx + G.padX + (m.labelW[c] ? m.labelW[c] + G.gap : 0);
    for (let r = rowsFrom[i]; r < rowsTo[i]; r++) {
      const k = m.rowNode[r];
      const by = top + (r - r0) * G.row + (G.row - bh) / 2;
      if (m.labelW[c]) {
        labelText(k, false);
        (typeof k.key === 'number' ? value[4] : key).rect(cx + G.padX, by, fitCols * cw, bh);
        used |= typeof k.key === 'number' ? 1 << 4 : 1 << 5;
      }
      valueText(k, false);
      const slot = kindSlot(k.t);
      value[slot].rect(swatch(k) ? vx + SWATCH_COLS * cw : vx, by, fitCols * cw, bh);
      used |= 1 << slot;
    }
    headText(m.node[c], false);
    head.rect(cx + headX(m, c), cy + (G.head - 8) / 2, fitCols * cw, 8);
  }
  ctx.globalAlpha = 0.45;
  const colors = [th.str, th.num, th.bool, th.nul, th.muted];
  for (let s = 0; s < 5; s++) {
    if (!(used & (1 << s))) continue;
    ctx.fillStyle = colors[s];
    ctx.fill(value[s]);
  }
  if (used & (1 << 5)) {
    ctx.fillStyle = th.key;
    ctx.fill(key);
  }
  ctx.fillStyle = th.fg;
  ctx.fill(head);
  ctx.globalAlpha = 1;
}

/** 1234 → "1,234", 1234567 → "1.2M". */
export function compactNum(n: number) {
  if (n < 10_000) return n < 1000 ? String(n) : n.toLocaleString('en-US');
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Where a click lands on a shown card: the header (-1), a row index, or the chevron (-2). */
export function partAt(L: GraphLayout, c: number, wx: number, wy: number): number {
  const top = L.y[c] + G.head;
  if (wy < top) return L.m.kids[c] && wx - L.x[c] < G.padX + G.chev ? -2 : -1;
  const i = Math.floor((wy - top) / G.row);
  const r0 = L.m.rowStart[c];
  return i >= 0 && r0 + i < L.m.rowStart[c + 1] ? r0 + i : -1;
}

