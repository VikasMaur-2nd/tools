/* Framework-free, on-demand graph export. Both formats use the same geometry. */
import { PRIVATE } from '../analytics';
import { BOOL, NUL, NUM, STR } from '../json/parser';
import { compactNum } from './render';
import { anchorY, cardsIn, groupsIn, portY, rowY, type GraphLayout } from './layout';
import { G, SWATCH_COLS, SWATCH_PX, cardHeadText, cardSizeText, headX, rowColor, rowIsItem, rowKind, rowLabelText, rowValueText } from './model';
import type { GraphTheme } from './theme';

/** SVG: cards and rows drawn (a long array is one card with a row per item: 20k cards or 100k rows are about 15 MB each). */
export const EXPORT_LIMITS = { svgCards: 20_000, svgRows: 100_000, pngPixels: 120_000_000, pngSide: 16_384 };

const MARGIN = 24;
const MIN_SCALE = 0.25;
const PNG_TOO_LARGE = 'The graph is too large for PNG. Collapse some branches and try again.';
const SVG_TOO_LARGE = 'The graph is too large for SVG. Collapse some branches or export PNG.';
const half = (n: number) => Math.round(n * 2) / 2;

/** XML 1.0 permits paired surrogates, but neither lone surrogates nor FFFE/FFFF. */
const XML_UNSAFE = /[&<>"'\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu;
function xml(s: string): string {
  return s.replace(XML_UNSAFE, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return '\ufffd';
    }
  });
}

/** Return a safe scale for dimensions INCLUDING the export margin, before allocating a canvas. */
export function pngScale(width: number, height: number, requested = 2): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The graph has invalid dimensions. Try opening the graph again.');
  }
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('Choose a positive PNG scale.');
  const fits = (s: number) => {
    const w = Math.ceil(width * s);
    const h = Math.ceil(height * s);
    return w <= EXPORT_LIMITS.pngSide && h <= EXPORT_LIMITS.pngSide && w * h <= EXPORT_LIMITS.pngPixels;
  };
  if (!fits(MIN_SCALE)) throw new Error(PNG_TOO_LARGE);
  let scale = Math.min(Math.max(MIN_SCALE, requested), EXPORT_LIMITS.pngSide / width,
    EXPORT_LIMITS.pngSide / height, Math.sqrt(EXPORT_LIMITS.pngPixels / width / height));
  // Integer canvas dimensions can exceed the area cap even when the unrounded area fits.
  if (!fits(scale)) {
    let lo = MIN_SCALE;
    let hi = scale;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    scale = lo;
  }
  return scale;
}

const pillText = (L: GraphLayout, c: number) => '+' + compactNum(L.m.end[c] - c - 1);
const pillWidth = (L: GraphLayout, c: number) => half(pillText(L, c).length * L.m.charW + 12);

/** What to export: the whole graph, a world rectangle (what's on screen), or one card's branch. */
export type ExportArea = { kind: 'all' } | { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'branch'; card: number };

export interface ImageOptions {
  area?: ExportArea;
  /** A CSS colour, or null for none (transparent). Default: the theme's canvas colour. */
  background?: string | null;
}

/** The world rectangle to draw, the margin around it, and the cards in it ([lo, hi)). */
interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  margin: number;
  lo: number;
  hi: number;
  /** Shown cards in the frame. */
  cards: number;
  /** Output size at scale 1. */
  w: number;
  h: number;
}

const invalid = () => new Error('The graph has invalid dimensions. Try opening the graph again.');

function frame(L: GraphLayout, area: ExportArea = { kind: 'all' }): Frame {
  const m = L.m;
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  let margin = MARGIN;
  let lo = 0;
  let hi = m.n;
  let cards = 0;
  const right = (c: number) => L.x[c] + m.w[c] + (L.collapsed[c] && m.kids[c] ? 8 + pillWidth(L, c) : 0);
  if (area.kind === 'rect') {
    ({ x: x0, y: y0 } = area);
    x1 = x0 + area.w;
    y1 = y0 + area.h;
    margin = 0;
    for (let d = 0; d < L.levels.length; d++) {
      if (L.colX[d] > x1 || L.colX[d] + L.colW[d] < x0) continue;
      const [a, b] = cardsIn(L, d, y0, y1);
      cards += b - a;
    }
  } else if (area.kind === 'branch' && area.card >= 0 && area.card < m.n && L.shown[area.card]) {
    lo = area.card;
    hi = m.end[lo];
    x0 = L.x[lo];
    // Descendants never sit above their branch's top (see layout).
    y0 = L.y[lo];
    x1 = right(lo);
    y1 = y0 + m.h[lo];
    for (let c = lo; c < hi; c++) {
      if (!L.shown[c]) continue;
      cards++;
      x1 = Math.max(x1, right(c));
      y1 = Math.max(y1, L.y[c] + m.h[c]);
    }
  } else {
    x1 = L.width;
    y1 = L.height;
    cards = L.shownCount;
    for (let d = 0; d < L.levels.length; d++) {
      const level = L.levels.at(d);
      for (const c of level) if (L.collapsed[c] && m.kids[c]) x1 = Math.max(x1, right(c));
    }
  }
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 < x0 || y1 < y0) throw invalid();
  return { x0, y0, x1, y1, margin, lo, hi, cards, w: half(x1 - x0) + margin * 2, h: half(y1 - y0) + margin * 2 };
}

/**
 * Rows an SVG of frame `f` draws, counted as `draw` and `card` pick them (cards in
 * the frame, their rows cut to its height) and only up to just past `cap`.
 */
function rowsIn(L: GraphLayout, f: Frame, cap: number): number {
  const m = L.m;
  const y0 = f.y0 - f.margin - 3;
  const y1 = f.y1 + f.margin + 3;
  let rows = 0;
  for (let d = 0; d < L.levels.length && rows <= cap; d++) {
    if (L.colX[d] > f.x1 + 1 || L.colX[d] + L.colW[d] + 120 < f.x0) continue;
    const [a, b] = cardsIn(L, d, y0, y1);
    const list = L.levels.at(d);
    for (let i = a; i < b && rows <= cap; i++) {
      const c = list[i];
      if (c < f.lo || c >= f.hi) continue;
      const start = m.rowStart[c];
      const from = Math.max(start, start + Math.floor((y0 - L.y[c] - G.head) / G.row));
      const to = Math.min(m.rowStart[c + 1], start + Math.ceil((y1 - L.y[c] - G.head) / G.row));
      if (to > from) rows += to - from;
    }
  }
  return rows;
}

/** Size of an export at scale 1, and how many cards and SVG rows it holds (for the export dialog; rows counted up to just past the limit). */
export function exportSize(L: GraphLayout, area?: ExportArea): { width: number; height: number; cards: number; rows: number } {
  const f = frame(L, area);
  return { width: f.w, height: f.h, cards: f.cards, rows: rowsIn(L, f, EXPORT_LIMITS.svgRows) };
}

type Ink = 'bg' | 'card' | 'head' | 'border' | 'edge' | 'chevron' | 'pill' | 'dot' | 'fg' | 'strong' | 'muted' | 'key' | 'str' | 'num' | 'bool' | 'nul';
type Command = ['M' | 'L', number, number] | ['Q', number, number, number, number] |
  ['C', number, number, number, number, number, number] | ['Z'];
interface Painter {
  rect(x: number, y: number, w: number, h: number, ink: Ink): void;
  roundRect(x: number, y: number, w: number, h: number, r: number, ink: Ink): void;
  text(x: number, y: number, text: string, ink: Ink, end?: boolean): void;
  path(commands: Command[], ink: Ink): void;
  /** A colour value's swatch (`color` passed swatch()'s check). */
  swatch(x: number, y: number, size: number, color: string): void;
}

function valueInk(t: number): Ink {
  switch (t) {
    case STR: return 'str';
    case NUM: return 'num';
    case BOOL: return 'bool';
    case NUL: return 'nul';
    default: return 'muted';
  }
}

/** Each edge group is painted behind the cards, including groups crossing a PNG strip. */
function edges(L: GraphLayout, p: Painter, c: number, y0: number, y1: number) {
  const m = L.m;
  const a = m.kidStart[c];
  const b = m.kidStart[c + 1];
  if (L.collapsed[c] || a === b) return;
  const x = L.x[c] + m.w[c];
  if (m.bus[c]) {
    const top = L.y[c] + G.head / 2;
    const last = anchorY(L, m.kidList[b - 1]);
    const trunk = L.colX[m.depth[c] + 1] - G.colGap / 2;
    const endX = L.x[m.kidList[b - 1]];
    const r = Math.min(6, (last - top) / 2, (trunk - x) / 2, (endX - trunk) / 2);
    if (r > 0) {
      p.path([['M', x, top], ['L', trunk - r, top], ['Q', trunk, top, trunk, top + r],
        ['L', trunk, last - r], ['Q', trunk, last, trunk + r, last], ['L', endX, last]], 'edge');
    } else {
      p.path([['M', x, top], ['L', endX, last]], 'edge');
    }
    for (let i = a; i < b - 1; i++) {
      const k = m.kidList[i];
      if (!L.shown[k]) continue;
      const y = anchorY(L, k);
      if (y < y0 || y > y1) continue;
      // The first child continues the horizontal header edge; subsequent stubs join the trunk.
      p.path([['M', y === top ? x : trunk, y], ['L', L.x[k], y]], 'edge');
    }
  } else {
    for (let i = a; i < b; i++) {
      const k = m.kidList[i];
      if (!L.shown[k]) continue;
      const sy = portY(L, k);
      const ey = anchorY(L, k);
      if (Math.max(sy, ey) < y0 || Math.min(sy, ey) > y1) continue;
      const ex = L.x[k];
      const mid = (x + ex) / 2;
      p.path([['M', x, sy], ['C', mid, sy, mid, ey, ex, ey]], 'edge');
    }
  }
}

function card(L: GraphLayout, p: Painter, c: number, y0: number, y1: number) {
  const m = L.m;
  const x = L.x[c];
  const y = L.y[c];
  const w = m.w[c];
  const h = m.h[c];
  p.roundRect(x, y, w, h, 6, 'card');
  p.roundRect(x, y, w, G.head, 6, 'head');
  if (h > G.head) {
    p.rect(x, y + G.head - 6, w, 6, 'head');
    p.path([['M', x, y + G.head], ['L', x + w, y + G.head]], 'border');
  }
  p.roundRect(x, y, w, h, 6, 'border');
  if (y + G.head >= y0 && y <= y1) {
    p.text(x + headX(m, c), y + G.head / 2, cardHeadText(m, c), 'strong');
    const size = cardSizeText(m, c);
    if (size !== null) p.text(x + w - G.padX - (m.bus[c] ? G.port : 0), y + G.head / 2, size, 'muted', true);
    if (m.bus[c] && m.kids[c]) p.roundRect(x + w - 3, y + G.head / 2 - 3, 6, 6, 3, 'dot');
    if (L.collapsed[c] && m.kids[c]) {
      const cy = y + G.head / 2;
      p.path([['M', x + G.padX - 0.5, cy - 3], ['L', x + G.padX + 2.5, cy], ['L', x + G.padX - 0.5, cy + 3]], 'chevron');
      const px = x + w + 8;
      const py = y + (G.head - 18) / 2;
      p.roundRect(px, py, pillWidth(L, c), 18, 9, 'head');
      p.roundRect(px, py, pillWidth(L, c), 18, 9, 'pill');
      p.text(px + 6, cy, pillText(L, c), 'muted');
    }
  }
  const start = m.rowStart[c];
  const from = Math.max(start, start + Math.floor((y0 - y - G.head) / G.row));
  const to = Math.min(m.rowStart[c + 1], start + Math.ceil((y1 - y - G.head) / G.row));
  for (let r = from; r < to; r++) {
    const cy = rowY(L, c, r);
    if (m.labelW[c]) p.text(x + G.padX, cy, rowLabelText(m, r), rowIsItem(m, r) ? 'muted' : 'key');
    let vx = x + G.padX + (m.labelW[c] ? m.labelW[c] + G.gap : 0);
    const color = rowColor(m, r);
    if (color !== null) {
      p.swatch(vx + 1, cy - SWATCH_PX / 2, SWATCH_PX, color);
      vx += SWATCH_COLS * m.charW;
    }
    p.text(vx, cy, rowValueText(m, r), valueInk(rowKind(m, r)));
    if (m.rowChild[r] >= 0) p.roundRect(x + w - 3, cy - 3, 6, 6, 3, 'dot');
  }
}

/** Edges then cards of frame `f` between world y0 and y1 (a PNG strip, or everything). */
function draw(L: GraphLayout, p: Painter, f: Frame, y0 = f.y0, y1 = f.y1) {
  const cols = L.levels.length;
  for (let d = 0; d < L.groups.length; d++) {
    // A column's edges run through the gap to its right.
    if (L.colX[d] > f.x1 || (d + 1 < cols ? L.colX[d + 1] : L.colX[d] + L.colW[d]) < f.x0) continue;
    const [a, b] = groupsIn(L, d, y0, y1);
    for (let i = a; i < b; i++) {
      const c = L.groups.at(d)[i];
      if (L.shown[c] && c >= f.lo && c < f.hi && L.gy1.at(d)[i] >= y0 - 3) edges(L, p, c, y0 - 3, y1 + 3);
    }
  }
  for (let d = 0; d < cols; d++) {
    if (L.colX[d] > f.x1 + 1 || L.colX[d] + L.colW[d] + 120 < f.x0) continue;
    const [a, b] = cardsIn(L, d, y0 - 3, y1 + 3);
    for (let i = a; i < b; i++) {
      const c = L.levels.at(d)[i];
      if (L.shown[c] && c >= f.lo && c < f.hi) card(L, p, c, y0 - 3, y1 + 3);
    }
  }
}

/** Painters take world coordinates and write them relative to (ox, oy), so huge layouts stay precise. */
class SVG implements Painter {
  out: string[] = [];
  private escaped = new Map<string, string>();
  constructor(private ox = 0, private oy = 0) {}
  rect(x: number, y: number, w: number, h: number, ink: Ink) {
    this.out.push(`<rect class="${ink}" x="${half(x - this.ox)}" y="${half(y - this.oy)}" width="${half(w)}" height="${half(h)}"/>`);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, ink: Ink) {
    this.out.push(`<rect class="${ink}" x="${half(x - this.ox)}" y="${half(y - this.oy)}" width="${half(w)}" height="${half(h)}" rx="${r}"/>`);
  }
  text(x: number, y: number, s: string, ink: Ink, end = false) {
    let escaped = this.escaped.get(s);
    if (escaped === undefined) {
      escaped = xml(s);
      // Keys and common values repeat heavily; keep the cache bounded for unique documents.
      if (this.escaped.size < 2048) this.escaped.set(s, escaped);
    }
    this.out.push(`<text class="${ink}${end ? ' end' : ''} ${PRIVATE}" x="${half(x - this.ox)}" y="${half(y - this.oy)}" dy="-1">${escaped}</text>`);
  }
  path(commands: Command[], ink: Ink) {
    let d = '';
    for (const command of commands) {
      d += command[0];
      for (let i = 1; i < command.length; i++) d += (i > 1 ? ' ' : '') + half((command[i] as number) - (i % 2 ? this.ox : this.oy));
    }
    this.out.push(`<path class="${ink}" d="${d}"/>`);
  }
  swatch(x: number, y: number, size: number, color: string) {
    // Inline style: the class only adds the outline.
    this.out.push(`<rect class="border" style="fill:${xml(color)}" x="${half(x - this.ox)}" y="${half(y - this.oy)}" width="${size}" height="${size}"/>`);
  }
}

function styles(theme: GraphTheme): string {
  const fills: Ink[] = ['bg', 'card', 'head', 'fg', 'strong', 'muted', 'key', 'str', 'num', 'bool', 'nul'];
  // Escape CSS delimiters as well as XML, including in caller-supplied font families.
  const css = (s: string) => xml(s.replace(/[{};<>]/g, (c) => '\\' + c.codePointAt(0)!.toString(16) + ' '));
  return fills.map((k) => `.${k}{fill:${css(theme[(k === 'strong' ? 'fg' : k) as keyof GraphTheme] as string)}}`).join('') +
    `.strong{font-weight:600}.pill{fill:none;stroke:${css(theme.border)};stroke-width:1}` +
    `.chevron{fill:none;stroke:${css(theme.muted)};stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}` +
    `.dot{fill:${css(theme.edge)}}.border{fill:none;stroke:${css(theme.border)};stroke-width:1}` +
    `.edge{fill:none;stroke:${css(theme.edge)};stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}` +
    `text{font-family:${css(theme.family)};font-size:${G.font}px;dominant-baseline:central;white-space:pre;font-variant-ligatures:none}.end{text-anchor:end}`;
}

/** A standalone SVG (a 24 px margin unless it's a view rectangle), with no external fonts or resources. */
export function toSVG(L: GraphLayout, theme: GraphTheme, opts: ImageOptions = {}): string {
  const f = frame(L, opts.area);
  if (f.cards > EXPORT_LIMITS.svgCards || rowsIn(L, f, EXPORT_LIMITS.svgRows) > EXPORT_LIMITS.svgRows) throw new Error(SVG_TOO_LARGE);
  const { w, h } = f;
  const p = new SVG(f.x0 - f.margin, f.y0 - f.margin);
  const bg = opts.background === undefined ? theme.bg : opts.background;
  p.out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="${PRIVATE}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${styles(theme)}</style>`);
  if (bg) p.out.push(`<rect style="fill:${xml(bg)}" width="${w}" height="${h}"/>`);
  draw(L, p, f, f.y0 - f.margin, f.y1 + f.margin);
  p.out.push('</svg>');
  return p.out.join('');
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
class Canvas implements Painter {
  constructor(private ctx: Context, private theme: GraphTheme, private ox = 0, private oy = 0) {
    ctx.font = `${G.font}px ${theme.family}`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }
  private paint(ink: Ink) {
    const { ctx, theme } = this;
    if (ink === 'edge' || ink === 'chevron' || ink === 'border' || ink === 'pill') {
      ctx.strokeStyle = ink === 'chevron' ? theme.muted : ink === 'edge' ? theme.edge : theme.border;
      ctx.lineWidth = ink === 'edge' || ink === 'chevron' ? 1.25 : 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = ink === 'dot' ? theme.edge : theme[ink === 'strong' ? 'fg' : ink];
      ctx.fill();
    }
  }
  rect(x: number, y: number, w: number, h: number, ink: Ink) {
    this.ctx.beginPath();
    this.ctx.rect(half(x - this.ox), half(y - this.oy), half(w), half(h));
    this.paint(ink);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, ink: Ink) {
    this.ctx.beginPath();
    this.ctx.roundRect(half(x - this.ox), half(y - this.oy), half(w), half(h), r);
    this.paint(ink);
  }
  text(x: number, y: number, s: string, ink: Ink, end = false) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme[ink === 'strong' ? 'fg' : ink as 'fg'];
    ctx.textAlign = end ? 'right' : 'left';
    ctx.font = (ink === 'strong' ? '600 ' : '') + `${G.font}px ${this.theme.family}`;
    // Apply the same XML-invalid character replacement to both formats.
    ctx.fillText(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu, '\ufffd'), half(x - this.ox), half(y - this.oy));
  }
  path(commands: Command[], ink: Ink) {
    const ctx = this.ctx;
    const X = (v: number) => half(v - this.ox);
    const Y = (v: number) => half(v - this.oy);
    ctx.beginPath();
    for (const command of commands) {
      switch (command[0]) {
        case 'M': ctx.moveTo(X(command[1]), Y(command[2])); break;
        case 'L': ctx.lineTo(X(command[1]), Y(command[2])); break;
        case 'Q': ctx.quadraticCurveTo(X(command[1]), Y(command[2]), X(command[3]), Y(command[4])); break;
        case 'C': ctx.bezierCurveTo(X(command[1]), Y(command[2]), X(command[3]), Y(command[4]), X(command[5]), Y(command[6])); break;
        case 'Z': ctx.closePath(); break;
      }
    }
    this.paint(ink);
  }
  swatch(x: number, y: number, size: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(half(x - this.ox), half(y - this.oy), size, size);
    ctx.strokeStyle = this.theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(half(x - this.ox), half(y - this.oy), size, size);
  }
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface RasterOptions extends ImageOptions {
  /** Pixels per CSS px (reduced automatically to fit the limits). Default 2. */
  scale?: number;
  type?: 'image/png' | 'image/jpeg';
  /** The browser refused a canvas this big (iPhones and iPads allow far smaller ones): the image is width × height instead. */
  onReduced?: (width: number, height: number) => void;
}

const PNG_TOO_LARGE_HERE = 'The graph is too large for an image on this device. Export the visible area or a branch, or try SVG.';

/**
 * The scale to draw a w × h export at: `scale` (from pngScale), or smaller
 * while `works` says the browser can't make a canvas that big (each step
 * halves the area). Throws when not even MIN_SCALE works.
 *
 * Browsers cap a canvas's area below our limits on some devices and don't
 * say so: WebKit on iPhone and iPad allows 4096² px before Safari 18 and
 * 8192² since (CanvasBase::maxCanvasArea), and a bigger canvas just draws
 * nothing. So the canvas itself is checked, not the device guessed.
 */
export function fitRaster(width: number, height: number, scale: number, works: (w: number, h: number) => boolean): number {
  // (The last step is MIN_SCALE itself, whatever the halving lands on before it.)
  for (let s = scale; ; s = Math.max(MIN_SCALE, s * Math.SQRT1_2)) {
    if (works(Math.ceil(width * s), Math.ceil(height * s))) return s;
    if (s <= MIN_SCALE) break;
  }
  throw new Error(PNG_TOO_LARGE_HERE);
}

/** Whether drawing into this canvas works: a pixel in its far corner reads back (over-limit canvases read as transparent, or throw). */
function usable(ctx: Context | null, w: number, h: number) {
  if (!ctx) return false;
  try {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const d = ctx.getImageData(w - 1, h - 1, 1, 1).data;
    ctx.clearRect(w - 1, h - 1, 1, 1);
    return d[0] === 255 && d[1] === 0 && d[2] === 0 && d[3] === 255;
  } catch {
    return false;
  }
}

/** Draw directly into one bounded canvas; clipping strips avoids extra full-size bitmaps. */
export async function toPNG(L: GraphLayout, theme: GraphTheme, opts: RasterOptions = {}): Promise<Blob> {
  const f = frame(L, opts.area);
  const planned = pngScale(f.w, f.h, opts.scale);
  const jpeg = opts.type === 'image/jpeg';
  // JPEG has no transparency.
  const bg = opts.background === undefined || (jpeg && !opts.background) ? theme.bg : opts.background;
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') throw new Error('PNG export needs a browser with canvas support.');
  // A canvas over the browser's own limit is refused silently: check it, and try smaller.
  const made: { canvas?: OffscreenCanvas | HTMLCanvasElement; ctx?: Context | null } = {};
  const scale = fitRaster(f.w, f.h, planned, (w, h) => {
    let c: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
    else {
      c = document.createElement('canvas');
      c.className = PRIVATE;
      c.width = w;
      c.height = h;
    }
    // Software backing avoids GPU texture limits and readback copies during PNG encoding.
    const x = c.getContext('2d', { alpha: !bg, willReadFrequently: true }) as Context | null;
    if (usable(x, w, h)) {
      made.canvas = c;
      made.ctx = x;
      return true;
    }
    c.width = c.height = 0;
    return false;
  });
  const { canvas, ctx } = made;
  if (!canvas || !ctx) throw new Error('PNG export could not create a canvas. Try a smaller graph.');
  const width = Math.ceil(f.w * scale);
  const height = Math.ceil(f.h * scale);
  if (scale < planned) opts.onReduced?.(width, height);
  try {
    const painter = new Canvas(ctx, theme, f.x0 - f.margin, f.y0 - f.margin);
    // Keep each paint batch near two million pixels and at most 512 rows.
    const strip = Math.max(1, Math.min(512, Math.floor(2_000_000 / width)));
    for (let top = 0; top < height; top += strip) {
      const sh = Math.min(strip, height - top);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, width, sh);
      ctx.clip();
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, top, width, sh);
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const wy = f.y0 - f.margin;
      draw(L, painter, f, wy + top / scale, wy + (top + sh) / scale);
      ctx.restore();
      await pause();
    }
    // Safari's OffscreenCanvas context has no isContextLost.
    if (typeof ctx.isContextLost === 'function' && ctx.isContextLost()) throw new Error('PNG export ran out of canvas memory. Try a smaller graph.');
    const type = jpeg ? 'image/jpeg' : 'image/png';
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type, quality: 0.92 });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG export could not encode the image. Try a smaller graph.'));
    }, type, 0.92));
  } finally {
    // Release the potentially large backing store once encoding has finished.
    canvas.width = 0;
    canvas.height = 0;
  }
}
