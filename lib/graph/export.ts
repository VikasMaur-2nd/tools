/* Framework-free, on-demand graph export. Both formats use the same geometry. */
import { PRIVATE } from '../analytics';
import { ARR, BOOL, NUL, NUM, STR } from '../json/parser';
import { compactNum } from './render';
import { anchorY, cardsIn, groupsIn, portY, rowY, type GraphLayout } from './layout';
import { G, headText, labelText, sizeText, valueText } from './model';
import type { GraphTheme } from './theme';

export const EXPORT_LIMITS = { svgCards: 20_000, pngPixels: 120_000_000, pngSide: 16_384 };

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

function bounds(L: GraphLayout): [number, number] {
  let width = L.width;
  for (const level of L.levels) {
    for (const c of level) {
      if (L.shown[c] && L.collapsed[c] && L.m.kids[c]) {
        width = Math.max(width, L.x[c] + L.m.w[c] + 8 + pillWidth(L, c));
      }
    }
  }
  if (!Number.isFinite(width) || !Number.isFinite(L.height) || width < 0 || L.height < 0) {
    throw new Error('The graph has invalid dimensions. Try opening the graph again.');
  }
  return [half(width) + MARGIN * 2, half(L.height) + MARGIN * 2];
}

type Ink = 'bg' | 'card' | 'head' | 'border' | 'edge' | 'chevron' | 'pill' | 'dot' | 'fg' | 'strong' | 'muted' | 'key' | 'str' | 'num' | 'bool' | 'nul' | 'selected';
type Command = ['M' | 'L', number, number] | ['Q', number, number, number, number] |
  ['C', number, number, number, number, number, number] | ['Z'];
interface Painter {
  rect(x: number, y: number, w: number, h: number, ink: Ink): void;
  roundRect(x: number, y: number, w: number, h: number, r: number, ink: Ink): void;
  text(x: number, y: number, text: string, ink: Ink, end?: boolean): void;
  path(commands: Command[], ink: Ink): void;
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

function card(L: GraphLayout, p: Painter, c: number, y0: number, y1: number, selected?: number) {
  const m = L.m;
  const x = L.x[c];
  const y = L.y[c];
  const w = m.w[c];
  const h = m.h[c];
  const n = m.node[c];
  p.roundRect(x, y, w, h, 6, 'card');
  p.roundRect(x, y, w, G.head, 6, 'head');
  if (h > G.head) {
    p.rect(x, y + G.head - 6, w, 6, 'head');
    p.path([['M', x, y + G.head], ['L', x + w, y + G.head]], 'border');
  }
  p.roundRect(x, y, w, h, 6, 'border');
  if (y + G.head >= y0 && y <= y1) {
    p.text(x + G.padX, y + G.head / 2, headText(n), 'strong');
    if (n.t >= ARR) p.text(x + w - G.padX - (m.bus[c] ? G.port : 0), y + G.head / 2, sizeText(n), 'muted', true);
    if (m.bus[c] && m.kids[c]) p.roundRect(x + w - 3, y + G.head / 2 - 3, 6, 6, 3, 'dot');
    if (L.collapsed[c] && m.kids[c]) {
      const cy = y + G.head / 2;
      p.path([['M', x + 3, cy - 3], ['L', x + 6, cy], ['L', x + 3, cy + 3]], 'chevron');
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
    const entry = m.rowNode[r];
    const cy = rowY(L, c, r);
    if (m.labelW[c]) p.text(x + G.padX, cy, labelText(entry), typeof entry.key === 'number' ? 'muted' : 'key');
    p.text(x + G.padX + (m.labelW[c] ? m.labelW[c] + G.gap : 0), cy, valueText(entry), valueInk(entry.t));
    if (m.rowChild[r] >= 0) p.roundRect(x + w - 3, cy - 3, 6, 6, 3, 'dot');
  }
  if (c === selected) p.roundRect(x - 2, y - 2, w + 4, h + 4, 8, 'selected');
}

function draw(L: GraphLayout, p: Painter, y0 = -Infinity, y1 = Infinity, selected?: number) {
  for (let d = 0; d < L.groups.length; d++) {
    const [a, b] = groupsIn(L, d, y0, y1);
    for (let i = a; i < b; i++) {
      const c = L.groups[d][i];
      if (L.shown[c] && L.gy1[d][i] >= y0 - 3) edges(L, p, c, y0 - 3, y1 + 3);
    }
  }
  for (let d = 0; d < L.levels.length; d++) {
    const [a, b] = cardsIn(L, d, y0 - 3, y1 + 3);
    for (let i = a; i < b; i++) {
      const c = L.levels[d][i];
      if (L.shown[c]) card(L, p, c, y0 - 3, y1 + 3, selected);
    }
  }
}

class SVG implements Painter {
  out: string[] = [];
  private escaped = new Map<string, string>();
  rect(x: number, y: number, w: number, h: number, ink: Ink) {
    this.out.push(`<rect class="${ink}" x="${half(x)}" y="${half(y)}" width="${half(w)}" height="${half(h)}"/>`);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, ink: Ink) {
    this.out.push(`<rect class="${ink}" x="${half(x)}" y="${half(y)}" width="${half(w)}" height="${half(h)}" rx="${r}"/>`);
  }
  text(x: number, y: number, s: string, ink: Ink, end = false) {
    let escaped = this.escaped.get(s);
    if (escaped === undefined) {
      escaped = xml(s);
      // Keys and common values repeat heavily; keep the cache bounded for unique documents.
      if (this.escaped.size < 2048) this.escaped.set(s, escaped);
    }
    this.out.push(`<text class="${ink}${end ? ' end' : ''} ${PRIVATE}" x="${half(x)}" y="${half(y)}" dy="-1">${escaped}</text>`);
  }
  path(commands: Command[], ink: Ink) {
    let d = '';
    for (const command of commands) {
      d += command[0];
      for (let i = 1; i < command.length; i++) d += (i > 1 ? ' ' : '') + half(command[i] as number);
    }
    this.out.push(`<path class="${ink}" d="${d}"/>`);
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
    `.selected{fill:none;stroke:${css(theme.accent)};stroke-width:2}` +
    `text{font-family:${css(theme.family)};font-size:${G.font}px;dominant-baseline:central;white-space:pre}.end{text-anchor:end}`;
}

/** A standalone SVG, with a 24 px margin and no external fonts or resources. */
export function toSVG(L: GraphLayout, theme: GraphTheme, opts?: { selected?: number }): string {
  if (L.shownCount > EXPORT_LIMITS.svgCards) throw new Error(SVG_TOO_LARGE);
  const [w, h] = bounds(L);
  const p = new SVG();
  p.out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="${PRIVATE}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${styles(theme)}</style>`);
  p.rect(0, 0, w, h, 'bg');
  p.out.push(`<g transform="translate(${MARGIN} ${MARGIN})">`);
  draw(L, p, -Infinity, Infinity, opts?.selected);
  p.out.push('</g></svg>');
  return p.out.join('');
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
class Canvas implements Painter {
  constructor(private ctx: Context, private theme: GraphTheme) {
    ctx.font = `${G.font}px ${theme.family}`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }
  private paint(ink: Ink) {
    const { ctx, theme } = this;
    if (ink === 'edge' || ink === 'chevron' || ink === 'border' || ink === 'pill' || ink === 'selected') {
      ctx.strokeStyle = ink === 'selected' ? theme.accent : ink === 'chevron' ? theme.muted : ink === 'edge' ? theme.edge : theme.border;
      ctx.lineWidth = ink === 'selected' ? 2 : ink === 'edge' || ink === 'chevron' ? 1.25 : 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = ink === 'dot' ? theme.edge : theme[ink === 'strong' ? 'fg' : ink];
      ctx.fill();
    }
  }
  rect(x: number, y: number, w: number, h: number, ink: Ink) {
    this.ctx.beginPath();
    this.ctx.rect(half(x), half(y), half(w), half(h));
    this.paint(ink);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, ink: Ink) {
    this.ctx.beginPath();
    this.ctx.roundRect(half(x), half(y), half(w), half(h), r);
    this.paint(ink);
  }
  text(x: number, y: number, s: string, ink: Ink, end = false) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme[ink === 'strong' ? 'fg' : ink as 'fg'];
    ctx.textAlign = end ? 'right' : 'left';
    ctx.font = (ink === 'strong' ? '600 ' : '') + `${G.font}px ${this.theme.family}`;
    // Apply the same XML-invalid character replacement to both formats.
    ctx.fillText(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu, '\ufffd'), half(x), half(y));
  }
  path(commands: Command[], ink: Ink) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const command of commands) {
      switch (command[0]) {
        case 'M': ctx.moveTo(half(command[1]), half(command[2])); break;
        case 'L': ctx.lineTo(half(command[1]), half(command[2])); break;
        case 'Q': ctx.quadraticCurveTo(half(command[1]), half(command[2]), half(command[3]), half(command[4])); break;
        case 'C': ctx.bezierCurveTo(half(command[1]), half(command[2]), half(command[3]), half(command[4]), half(command[5]), half(command[6])); break;
        case 'Z': ctx.closePath(); break;
      }
    }
    this.paint(ink);
  }
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Draw directly into one bounded canvas; clipping strips avoids extra full-size bitmaps. */
export async function toPNG(L: GraphLayout, theme: GraphTheme, opts?: { scale?: number }): Promise<Blob> {
  const [w, h] = bounds(L);
  const scale = pngScale(w, h, opts?.scale);
  const width = Math.ceil(w * scale);
  const height = Math.ceil(h * scale);
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.className = PRIVATE;
    canvas.width = width;
    canvas.height = height;
  } else throw new Error('PNG export needs a browser with canvas support.');
  try {
    // Software backing avoids GPU texture limits and readback copies during PNG encoding.
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true }) as Context | null;
    if (!ctx) throw new Error('PNG export could not create a canvas. Try a smaller graph.');
    // Keep each paint batch near two million pixels and at most 512 rows.
    const strip = Math.max(1, Math.min(512, Math.floor(2_000_000 / width)));
    for (let top = 0; top < height; top += strip) {
      const sh = Math.min(strip, height - top);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, width, sh);
      ctx.clip();
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, top, width, sh);
      ctx.setTransform(scale, 0, 0, scale, MARGIN * scale, MARGIN * scale);
      draw(L, new Canvas(ctx, theme), top / scale - MARGIN, (top + sh) / scale - MARGIN);
      ctx.restore();
      await pause();
    }
    if (ctx.isContextLost()) throw new Error('PNG export ran out of canvas memory. Try a smaller graph.');
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG export could not encode the image. Try a smaller graph.'));
    }, 'image/png'));
  } finally {
    // Release the potentially large backing store once encoding has finished.
    canvas.width = 0;
    canvas.height = 0;
  }
}
