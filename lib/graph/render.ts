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
let gridTile: { canvas: HTMLCanvasElement; size: number; color: string; dpr: number } | null = null;

/** Dots every GRID world px, aligned with the camera (one pattern fill). */
function grid(ctx: CanvasRenderingContext2D, th: GraphTheme, cam: Cam, vw: number, vh: number, dpr: number) {
  const step = GRID * cam.s;
  if (step < GRID_MIN) return;
  const size = Math.max(2, Math.round(step * dpr));
  const color = th.grid ?? th.border;
  if (!gridTile || gridTile.size !== size || gridTile.color !== color || gridTile.dpr !== dpr) {
    const canvas = gridTile?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, size, size);
    g.fillStyle = color;
    const dot = Math.max(1, Math.round(dpr * Math.min(1.5, cam.s * 1.25)));
    g.fillRect(0, 0, dot, dot);
    gridTile = { canvas, size, color, dpr };
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
export function valueColor(t: GraphTheme, n: JNode): string {
  switch (n.t) {
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

/** Index of the first card in `list` whose top is greater than `y`. */
function firstBelow(L: GraphLayout, list: Int32Array, from: number, to: number, y: number) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (L.y[list[mid]] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
  let d0 = 0;
  while (d0 < cols && colX[d0] + colW[d0] + G.colGap < wx0) d0++;
  let d1 = d0;
  while (d1 < cols && colX[d1] <= wx1) d1++;

  // ── Edges ──
  ctx.strokeStyle = th.edge;
  ctx.lineWidth = Math.max(1.25, lod === 2 ? px : 1.25);
  ctx.beginPath();
  for (let d = Math.max(0, d0 - 1); d < Math.min(cols - 1, d1); d++) {
    const [a, b] = groupsIn(L, d, wy0, wy1);
    const list = L.groups[d];
    const gy1 = L.gy1[d];
    for (let g = a; g < b; ) {
      const c = list[g];
      if (gy1[g] >= wy0) edgesOf(ctx, L, c, ox, oy, wy0, wy1, lod, px);
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
    for (let c = target; m.parent[c] >= 0; c = m.parent[c]) edgeInto(ctx, L, c, ox, oy);
    ctx.stroke();
  }

  // ── Cards ──
  ctx.font = th.font;
  ctx.textBaseline = 'middle';
  for (let d = d0; d < d1; d++) {
    const list = L.levels[d];
    const [a, b] = cardsIn(L, d, wy0, wy1);
    if (lod === 2) {
      blocks(ctx, L, th, list, a, b, colX[d] - ox, colW[d], oy, px, p);
      continue;
    }
    for (let i = a; i < b; i++) card(ctx, L, th, list[i], ox, oy, wy0, wy1, lod, px, p);
  }

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

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

function edgesOf(ctx: CanvasRenderingContext2D, L: GraphLayout, p: number, ox: number, oy: number, wy0: number, wy1: number, lod: number, px: number) {
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
    const ex = x[c] - ox;
    ctx.moveTo(sx, sy);
    if (Math.abs(ey - sy) < 0.5) ctx.lineTo(ex, ey);
    else {
      const mx = (sx + ex) / 2;
      ctx.bezierCurveTo(mx, sy, mx, ey, ex, ey);
    }
  }
}

/** Low zoom: card blocks, neighbours closer than ~1.5 px merged (at most one block per pixel row). */
function blocks(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, list: Int32Array, a: number, b: number, cx: number, cw: number, oy: number, px: number, p: Paint) {
  const { m, y } = L;
  ctx.fillStyle = th.head;
  ctx.strokeStyle = th.border;
  ctx.lineWidth = px;
  ctx.beginPath();
  const merged = 1.5 * px;
  let i = a;
  while (i < b) {
    const c = list[i];
    const top = y[c];
    let bot = top + m.h[c];
    let w = m.w[c];
    let j = i + 1;
    // Absorb every card that starts within 1.5 px of the block's bottom.
    for (;;) {
      const k = firstBelow(L, list, j, b, bot + merged);
      if (k <= j) break;
      const lc = list[k - 1];
      bot = Math.max(bot, y[lc] + m.h[lc]);
      if (k - j < 8) for (let q = j; q < k; q++) w = Math.max(w, m.w[list[q]]);
      else w = cw;
      j = k;
    }
    const hgt = Math.max(bot - top, px);
    if (j - i === 1 && hgt > 4 * px) rrect(ctx, cx, top - oy, w, hgt, Math.min(R, hgt / 4));
    else ctx.rect(cx, top - oy, w, hgt);
    i = j;
  }
  ctx.fill();
  ctx.stroke();
  // Selection / hits still show as coloured blocks.
  for (let q = a; q < b; q++) {
    const c = list[q];
    let col: string | null = null;
    if (p.hitCard && p.curCard === c) col = th.hitCur;
    else if (c === p.card) col = th.accent;
    if (col) {
      ctx.fillStyle = col;
      ctx.fillRect(cx, y[c] - oy, m.w[c], Math.max(m.h[c], 2 * px));
    }
  }
}

function card(ctx: CanvasRenderingContext2D, L: GraphLayout, th: GraphTheme, c: number, ox: number, oy: number, wy0: number, wy1: number, lod: number, px: number, p: Paint) {
  const { m } = L;
  const cx = L.x[c] - ox;
  const cy = L.y[c] - oy;
  const w = m.w[c];
  const h = m.h[c];
  const n = m.node[c];
  // Body and header band.
  ctx.fillStyle = th.card;
  ctx.beginPath();
  rrect(ctx, cx, cy, w, h, R);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.hitCard && p.hitCard[c] ? (c === p.curCard ? th.hitCur : th.hit) : th.head;
  ctx.fillRect(cx, cy, w, G.head);
  if (c === p.card && p.row < 0) {
    ctx.fillStyle = th.rowSel;
    ctx.fillRect(cx, cy, w, G.head);
  } else if (c === p.hoverCard && p.hoverRow < 0) {
    ctx.fillStyle = th.rowHover;
    ctx.fillRect(cx, cy, w, G.head);
  }
  ctx.fillStyle = th.border;
  ctx.fillRect(cx, cy + G.head - px / 2, w, px);
  // Rows in view.
  const r0 = m.rowStart[c];
  const r1 = m.rowStart[c + 1];
  const top = cy + G.head;
  const ra = Math.max(r0, r0 + Math.floor((wy0 - oy - top) / G.row));
  const rb = Math.min(r1, r0 + Math.ceil((wy1 - oy - top) / G.row));
  const vx = cx + G.padX + (m.labelW[c] ? m.labelW[c] + G.gap : 0);
  for (let r = ra; r < rb; r++) {
    const ry = top + (r - r0) * G.row;
    const hit = p.hitRow && p.hitRow[r];
    if (r === p.row) {
      ctx.fillStyle = th.rowSel;
      ctx.fillRect(cx, ry, w, G.row);
    } else if (r === p.hoverRow) {
      ctx.fillStyle = th.rowHover;
      ctx.fillRect(cx, ry, w, G.row);
    }
    if (hit) {
      ctx.fillStyle = r === p.curRow ? th.hitCur : th.hit;
      ctx.fillRect(cx, ry, w, G.row);
    }
  }
  if (lod === 0) {
    for (let r = ra; r < rb; r++) {
      const k = m.rowNode[r];
      const my = top + (r - r0) * G.row + G.row / 2;
      const value = rowValue(m, r);
      if (m.labelW[c]) {
        ctx.fillStyle = typeof k.key === 'number' ? th.muted : th.key;
        ctx.fillText(rowLabel(r), cx + G.padX, my);
      }
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
      ctx.fillStyle = valueColor(th, k);
      ctx.fillText(value, tx, my);
    }
    // Header: label, then the size badge right-aligned.
    ctx.fillStyle = th.fg;
    ctx.font = '600 ' + th.font;
    ctx.fillText(headText(n), cx + headX(m, c), cy + G.head / 2);
    ctx.font = th.font;
    if (n.t >= ARR) {
      ctx.fillStyle = th.muted;
      ctx.textAlign = 'right';
      ctx.fillText(sizeText(n), cx + w - G.padX - (m.bus[c] ? G.port : 0), cy + G.head / 2);
      ctx.textAlign = 'left';
    }
  } else {
    // Skeleton: bars as long as the text would be.
    const cw = m.charW;
    const bh = 6;
    ctx.globalAlpha = 0.45;
    for (let r = ra; r < rb; r++) {
      const k = m.rowNode[r];
      const by = top + (r - r0) * G.row + (G.row - bh) / 2;
      if (m.labelW[c]) {
        labelText(k, false);
        ctx.fillStyle = typeof k.key === 'number' ? th.muted : th.key;
        ctx.fillRect(cx + G.padX, by, fitCols * cw, bh);
      }
      valueText(k, false);
      ctx.fillStyle = valueColor(th, k);
      ctx.fillRect(swatch(k) ? vx + SWATCH_COLS * cw : vx, by, fitCols * cw, bh);
    }
    headText(n, false);
    ctx.fillStyle = th.fg;
    ctx.fillRect(cx + headX(m, c), cy + (G.head - 8) / 2, fitCols * cw, 8);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // Border.
  ctx.strokeStyle = th.border;
  ctx.lineWidth = px;
  ctx.beginPath();
  rrect(ctx, cx + px / 2, cy + px / 2, w - px, h - px, R);
  ctx.stroke();
  // Port dots: one per port row in view, on the right edge; a bus has one on the header.
  ctx.fillStyle = th.edge;
  ctx.beginPath();
  const dr = 3;
  if (m.bus[c] && m.kids[c]) {
    ctx.moveTo(cx + w + dr, cy + G.head / 2);
    ctx.arc(cx + w, cy + G.head / 2, dr, 0, Math.PI * 2);
  }
  if (m.kids[c] && !m.bus[c]) {
    for (let r = ra; r < rb; r++) {
      if (m.rowChild[r] < 0) continue;
      const my = top + (r - r0) * G.row + G.row / 2;
      ctx.moveTo(cx + w + dr, my);
      ctx.arc(cx + w, my, dr, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  // Chevron (cards with children) and the collapsed pill.
  if (m.kids[c]) {
    const col = L.collapsed[c];
    if (lod === 0) {
      // Always there (collapsing is discoverable), stronger on hover and when collapsed.
      const chx = cx + G.padX + 1;
      const chy = cy + G.head / 2;
      ctx.strokeStyle = col || (c === p.hoverCard && p.hoverRow < 0) ? th.muted : th.faint;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (col) {
        ctx.moveTo(chx - 1.5, chy - 3);
        ctx.lineTo(chx + 1.5, chy);
        ctx.lineTo(chx - 1.5, chy + 3);
      } else {
        ctx.moveTo(chx - 2.5, chy - 1.5);
        ctx.lineTo(chx, chy + 1.5);
        ctx.lineTo(chx + 2.5, chy - 1.5);
      }
      ctx.stroke();
    }
    if (col) {
      const hidden = m.end[c] - c - 1;
      const label = '+' + compactNum(hidden);
      const pw = label.length * m.charW + 12;
      const pxl = cx + w + 8;
      const pyl = cy + (G.head - 18) / 2;
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

