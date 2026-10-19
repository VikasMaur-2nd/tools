/*
 * Graph layout: a left-to-right tidy tree of the model's cards.
 *
 * Columns: a card's x depends only on its depth (each column is as wide as
 * its widest shown card). Rows: each subtree keeps a contour, its top and
 * bottom edge at every column it reaches, and siblings are packed as close
 * as their contours allow (so a deep subtree doesn't push a shallow
 * neighbour's cards down in columns it never reaches). A parent sits level
 * with its first child, so the first edge is horizontal, and no child sits
 * above the row its edge starts from. Contours are merged cheapest-first
 * (cost = the shorter one), which keeps the whole pass linear in the number
 * of cards, without recursion, for any depth.
 */
import { G, type GraphModel } from './model';

export interface GraphLayout {
  m: GraphModel;
  /** Collapsed cards (their descendants are not shown). */
  collapsed: Uint8Array;
  /** Card is shown (no collapsed ancestor). */
  shown: Uint8Array;
  /** Card top-left (px). Hidden cards have NaN. */
  x: Float64Array;
  y: Float64Array;
  /** Column left edge and width, per depth. */
  colX: Float64Array;
  colW: Float64Array;
  /** Shown cards per column, top to bottom. */
  levels: Int32Array[];
  /**
   * Edge groups per column: shown, expanded cards with children, top to
   * bottom, with the vertical extent of their edges (gy0 … gy1) and the
   * running maximum of gy1 (for binary search).
   */
  groups: Int32Array[];
  gy0: Float64Array[];
  gy1: Float64Array[];
  gmax: Float64Array[];
  /** Size of the whole drawing; everything lies in [0, width] × [0, height]. */
  width: number;
  height: number;
  /** Shown cards. */
  shownCount: number;
}

/** A subtree's contour: per column, its top and bottom (stored minus `off`), deepest column first. */
interface Contour {
  top: number[];
  bot: number[];
  off: number;
}

/** Port y of the edge into `c`, relative to its parent's top. */
function portRel(m: GraphModel, c: number) {
  const r = m.portRow[c];
  return r < 0 ? G.head / 2 : G.head + (r - m.rowStart[m.parent[c]]) * G.row + G.row / 2;
}

/**
 * Lays out the shown cards in steps: call the returned function with a
 * deadline until it returns the layout. `collapsed` marks cards whose
 * children are hidden (it is kept, not copied).
 */
export function layouter(m: GraphModel, collapsed: Uint8Array = new Uint8Array(m.n)): (deadline: number) => GraphLayout | null {
  const n = m.n;
  const { parent, depth, kidStart, kidList, h } = m;
  const shown = new Uint8Array(n);
  if (n) shown[0] = 1;
  for (let c = 1; c < n; c++) shown[c] = shown[parent[c]] && !collapsed[parent[c]] ? 1 : 0;
  const rel = new Float64Array(n);
  const cont: (Contour | undefined)[] = new Array(n);
  let c = n - 1;
  const gap = G.sibGap;

  return (deadline: number) => {
    let i = 0;
    for (; c >= 0; c--) {
      if ((++i & 511) === 0 && performance.now() > deadline) return null;
      if (!shown[c]) continue;
      const a = kidStart[c];
      const b = kidStart[c + 1];
      if (collapsed[c] || a === b) {
        cont[c] = { top: [0], bot: [h[c]], off: 0 };
        continue;
      }
      // Pack the children top to bottom in block coordinates (first child's top = 0).
      const k0 = kidList[a];
      let acc = cont[k0]!;
      cont[k0] = undefined;
      const p0 = portRel(m, k0);
      rel[k0] = 0;
      for (let j = a + 1; j < b; j++) {
        const k = kidList[j];
        const next = cont[k]!;
        cont[k] = undefined;
        const la = acc.top.length;
        const lb = next.top.length;
        const common = la < lb ? la : lb;
        // No higher than its port (edges never climb), then clear of the siblings above.
        let d = m.portRow[k] < 0 ? -Infinity : portRel(m, k) - p0;
        for (let l = 1; l <= common; l++) {
          const need = acc.bot[la - l] + acc.off - (next.top[lb - l] + next.off) + gap;
          if (need > d) d = need;
        }
        rel[k] = d;
        if (la >= lb) {
          for (let l = 1; l <= lb; l++) acc.bot[la - l] = next.bot[lb - l] + next.off + d - acc.off;
        } else {
          for (let l = 1; l <= la; l++) next.top[lb - l] = acc.top[la - l] + acc.off - (next.off + d);
          next.off += d;
          acc = next;
        }
      }
      // The parent's top, in block coordinates: its first port level with the first child's header.
      const pt = G.head / 2 - p0;
      for (let j = a; j < b; j++) rel[kidList[j]] -= pt;
      acc.off -= pt;
      acc.top.push(-acc.off);
      acc.bot.push(h[c] - acc.off);
      cont[c] = acc;
    }
    return finish(m, collapsed, shown, rel);
  };
}

function finish(m: GraphModel, collapsed: Uint8Array, shown: Uint8Array, rel: Float64Array): GraphLayout {
  const n = m.n;
  const { parent, depth, w, h, kidStart, kidList } = m;
  const x = new Float64Array(n).fill(NaN);
  const y = new Float64Array(n).fill(NaN);
  let cols = 0;
  let minY = 0;
  let shownCount = 0;
  if (n) y[0] = 0;
  for (let c = 0; c < n; c++) {
    if (!shown[c]) continue;
    shownCount++;
    if (c) y[c] = y[parent[c]] + rel[c];
    if (y[c] < minY) minY = y[c];
    if (depth[c] + 1 > cols) cols = depth[c] + 1;
  }
  const colW = new Float64Array(cols);
  const counts = new Int32Array(cols);
  const gcounts = new Int32Array(cols);
  let maxY = 0;
  for (let c = 0; c < n; c++) {
    if (!shown[c]) continue;
    y[c] -= minY;
    const d = depth[c];
    if (w[c] > colW[d]) colW[d] = w[c];
    counts[d]++;
    if (!collapsed[c] && kidStart[c + 1] > kidStart[c]) gcounts[d]++;
    if (y[c] + h[c] > maxY) maxY = y[c] + h[c];
  }
  const colX = new Float64Array(cols);
  for (let d = 1; d < cols; d++) colX[d] = colX[d - 1] + colW[d - 1] + G.colGap;
  const levels = Array.from(counts, (k) => new Int32Array(k));
  const groups = Array.from(gcounts, (k) => new Int32Array(k));
  const gy0 = Array.from(gcounts, (k) => new Float64Array(k));
  const gy1 = Array.from(gcounts, (k) => new Float64Array(k));
  const gmax = Array.from(gcounts, (k) => new Float64Array(k));
  counts.fill(0);
  gcounts.fill(0);
  // Pre-order visits each column's cards top to bottom.
  for (let c = 0; c < n; c++) {
    if (!shown[c]) continue;
    const d = depth[c];
    x[c] = colX[d];
    levels[d][counts[d]++] = c;
    const a = kidStart[c];
    const b = kidStart[c + 1];
    if (collapsed[c] || a === b) continue;
    const g = gcounts[d]++;
    groups[d][g] = c;
  }
  // Group extents need the children's y, which the pass above has finished.
  for (let d = 0; d < cols; d++) {
    const list = groups[d];
    let run = -Infinity;
    for (let g = 0; g < list.length; g++) {
      const c = list[g];
      const first = kidList[kidStart[c]];
      const last = kidList[kidStart[c + 1] - 1];
      const top = Math.min(y[c], y[first] + G.head / 2);
      const bot = Math.max(y[c] + h[c], y[last] + G.head / 2);
      gy0[d][g] = top;
      gy1[d][g] = bot;
      if (bot > run) run = bot;
      gmax[d][g] = run;
    }
  }
  const width = cols ? colX[cols - 1] + colW[cols - 1] : 0;
  return { m, collapsed, shown, x, y, colX, colW, levels, groups, gy0, gy1, gmax, width, height: maxY, shownCount };
}

/** Lays out everything at once (tests, small documents). */
export function layoutGraph(m: GraphModel, collapsed?: Uint8Array): GraphLayout {
  const step = layouter(m, collapsed);
  let l: GraphLayout | null = null;
  while (!(l = step(Infinity)));
  return l;
}

// ── Queries ──────────────────────────────────────────────────────────────

/** Range [from, to) of `levels[d]` whose cards overlap y0 … y1. */
export function cardsIn(L: GraphLayout, d: number, y0: number, y1: number): [number, number] {
  const list = L.levels[d];
  if (!list) return [0, 0];
  const { y, m } = L;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = list[mid];
    if (y[c] + m.h[c] < y0) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (y[list[mid]] <= y1) lo = mid + 1;
    else hi = mid;
  }
  return [from, lo];
}

/** Range [from, to) of `groups[d]` that may have edges in y0 … y1 (check gy1[d][g] ≥ y0 for each). */
export function groupsIn(L: GraphLayout, d: number, y0: number, y1: number): [number, number] {
  const max = L.gmax[d];
  const top = L.gy0[d];
  if (!max) return [0, 0];
  let lo = 0;
  let hi = max.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (max[mid] < y0) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  hi = max.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (top[mid] <= y1) lo = mid + 1;
    else hi = mid;
  }
  return [from, lo];
}

/** Column at x (-1 outside every column). */
export function columnAt(L: GraphLayout, px: number): number {
  const { colX, colW } = L;
  let lo = 0;
  let hi = colX.length - 1;
  if (hi < 0 || px < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (colX[mid] <= px) lo = mid;
    else hi = mid - 1;
  }
  return px <= colX[lo] + colW[lo] ? lo : -1;
}

/** The shown card under a point (-1: none). */
export function cardAt(L: GraphLayout, px: number, py: number): number {
  const d = columnAt(L, px);
  if (d < 0) return -1;
  const [a, b] = cardsIn(L, d, py, py);
  for (let i = a; i < b; i++) {
    const c = L.levels[d][i];
    if (px <= L.x[c] + L.m.w[c] && py >= L.y[c] && py <= L.y[c] + L.m.h[c]) return c;
  }
  return -1;
}

/** Row of card `c` at y (-1: the header or padding). */
export function rowAt(L: GraphLayout, c: number, py: number): number {
  const i = Math.floor((py - L.y[c] - G.head) / G.row);
  const { rowStart } = L.m;
  return i >= 0 && i < rowStart[c + 1] - rowStart[c] ? rowStart[c] + i : -1;
}

/** Where the edge into card `c` starts (its parent's port), absolute. */
export function portY(L: GraphLayout, c: number) {
  return L.y[L.m.parent[c]] + portRel(L.m, c);
}

/** Where the edge into card `c` ends (middle of its header), absolute. */
export const anchorY = (L: GraphLayout, c: number) => L.y[c] + G.head / 2;

/** Centre y of row r of card c. */
export const rowY = (L: GraphLayout, c: number, r: number) => L.y[c] + G.head + (r - L.m.rowStart[c]) * G.row + G.row / 2;
