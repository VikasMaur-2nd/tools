/*
 * Graph colours and font, read from the page's CSS variables (app/globals.css)
 * so the canvas, the minimap and exported images match the light/dark theme.
 */
import { G } from './model';

export interface GraphTheme {
  /** Canvas background. */
  bg: string;
  /** Background dots (screen only; defaults to the border colour). */
  grid?: string;
  /** Card body and header fills. */
  card: string;
  head: string;
  border: string;
  edge: string;
  fg: string;
  muted: string;
  faint: string;
  key: string;
  str: string;
  num: string;
  bool: string;
  nul: string;
  accent: string;
  rowHover: string;
  rowSel: string;
  hit: string;
  hitCur: string;
  /** CSS font shorthand for graph text, e.g. `12px "JetBrains Mono", monospace`. */
  font: string;
  /** Font family list alone (SVG export). */
  family: string;
  dark: boolean;
}

const FALLBACK_FAMILY = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Reads the theme from `el`'s computed style (any element under the themed root). */
export function readTheme(el: Element): GraphTheme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const family = v('--font-mono', FALLBACK_FAMILY);
  const page = v('--bg', '#ffffff');
  const dark = isDark(page);
  // Cards sit a step above the canvas: white on off-white, near-black on black.
  return {
    bg: dark ? page : v('--bg-2', '#fafafa'),
    grid: v('--line-2', '#dcdcdc'),
    card: dark ? v('--bg-2', '#0a0a0a') : page,
    head: dark ? v('--bg-3', '#161616') : v('--bg-2', '#fafafa'),
    border: v('--line-2', '#dcdcdc'),
    edge: v('--faint', '#a3a3a3'),
    fg: v('--fg', '#0a0a0a'),
    muted: v('--muted', '#6a6a6a'),
    faint: v('--faint', '#a3a3a3'),
    key: v('--c-key', '#1d4ed8'),
    str: v('--c-str', '#047857'),
    num: v('--c-num', '#b45309'),
    bool: v('--c-bool', '#7c3aed'),
    nul: v('--c-null', '#be123c'),
    accent: v('--accent', '#0a0a0a'),
    rowHover: v('--row-hover', 'rgba(0,0,0,0.035)'),
    rowSel: v('--row-sel', 'rgba(0,0,0,0.07)'),
    hit: v('--hit', 'rgba(250,204,21,0.4)'),
    hitCur: v('--hit-cur', 'rgba(249,115,22,0.45)'),
    font: `${G.font}px ${family}`,
    family,
    dark,
  };
}

/** True for a dark colour: `#rgb`, `#rrggbb` or `rgb(…)` (minified CSS shortens hex). */
export function isDark(color: string) {
  let r: number;
  let g: number;
  let b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    const n = parseInt(h, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
    if (!rgb) return false;
    [r, g, b] = [+rgb[1], +rgb[2], +rgb[3]];
  }
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
}

/** Advance of one monospace column in `font` (measured once per font). */
const advances = new Map<string, number>();
export function charWidth(font: string): number {
  let w = advances.get(font);
  if (w === undefined) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return G.font * 0.6;
    ctx.font = font;
    w = ctx.measureText('0'.repeat(100)).width / 100 || G.font * 0.6;
    advances.set(font, w);
  }
  return w;
}
