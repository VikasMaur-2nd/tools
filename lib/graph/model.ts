/*
 * The graph view's model: the document as cards and rows, in flat arrays.
 *
 * Every non-empty object or array becomes a card (a primitive root gets one
 * too), except a small array of primitives, which is shown inline as a value
 * (`[51.5, -0.1]`, see `inlineCols`). A card lists its entries as rows:
 * primitives, empty and inline containers show their value; a nested
 * container is a "port" row that an edge leaves from. When a card has many nested containers, or is an array of nothing
 * but containers, its children hang off one "bus" edge instead and the rows
 * list only the primitives (each child card's header names its key/index).
 *
 * Cards are numbered in depth-first pre-order, so a card's descendants are
 * the cards `c + 1 … end[c] - 1` and a parent always comes before its
 * children. Sizes are in CSS pixels at zoom 1 and only depend on character
 * counts (the graph is drawn in a monospace font), so the model can be built
 * for millions of nodes without measuring text.
 *
 * A document parsed to a tape (its root came from one, see lib/json/lazy.ts) is
 * built from the tape: cards and rows are tape indexes, texts and widths are read
 * off the tape and the source, and a node is made only when one is asked for
 * (selection, open, copy: cardNode / rowEntry). Drawing makes none.
 */
import { ARR, BOOL, NUL, NUM, OBJ, STR, type JNode, type Key, type Kind } from '../json/parser';
import { nodeAtIndex, tapeOfNode } from '../json/lazy';
import { pathOf, resolve, type Seg } from '../json/path';
import { KEY_INDEX, KEY_NAME, VALUE_RAW, VALUE_SLICE, W, childCount, keyOf, nextOf, parentOf, sizeOf, valueOf, type Tape } from '../json/tape';

/** Geometry shared by the model, layout, renderer and exporters (CSS px at zoom 1). */
export const G = {
  /** Font size of all graph text. */
  font: 12,
  /** Row height. */
  row: 20,
  /** Header height (key/index of the card and its entry count). */
  head: 26,
  /** Horizontal padding inside a card. */
  padX: 10,
  /** Padding under the last row. */
  padY: 4,
  /** Space between the label column and the value column. */
  gap: 14,
  /** Extra width on cards with port rows (the edge's start dot). */
  port: 10,
  /** Room before the header label of a card with children (its collapse chevron). */
  chev: 8,
  minW: 120,
  /** Column limits, in monospace columns (wide characters count 2). */
  keyMax: 24,
  valMax: 40,
  headMax: 32,
  /** Horizontal space between columns (edges are drawn here). */
  colGap: 80,
  /** Vertical space between sibling subtrees. */
  sibGap: 14,
  /** More nested containers than this and a card uses a bus. */
  portMax: 32,
  /** A small array of primitives (up to this many, fitting valMax) is shown inline in its row: `[51.5, -0.1]`. */
  inlineMax: 8,
} as const;

export interface GraphModel {
  /** Number of cards; card 0 is the root. */
  n: number;
  /** Card → the container it shows (or the primitive root). Empty in a tape model: use cardNode. */
  node: JNode[];
  /** Card → parent card (-1 for the root). */
  parent: Int32Array;
  /** Card → column (root 0). */
  depth: Int32Array;
  /** Card → one past its last descendant (pre-order). */
  end: Int32Array;
  /** Rows of card c are rowStart[c] … rowStart[c + 1] - 1. Length n + 1. */
  rowStart: Int32Array;
  /** Row → the entry it shows (a primitive, an empty container, or a nested container on a port row). Empty in a tape model: use rowEntry. */
  rowNode: JNode[];
  /** Row → the child card its edge leads to (-1: none). */
  rowChild: Int32Array;
  /** Card → the parent's port row its edge starts from (-1: the parent's bus, or the root). */
  portRow: Int32Array;
  /** Card → 1 when its children hang off a bus (from the header) rather than port rows. */
  bus: Uint8Array;
  /** Card → number of child cards. */
  kids: Int32Array;
  /** Child cards of c, in order: kidList[kidStart[c]] … kidList[kidStart[c + 1] - 1]. */
  kidStart: Int32Array;
  kidList: Int32Array;
  /** Card size (px). */
  w: Float32Array;
  h: Float32Array;
  /** Card → width of its label column (px; values start at padX + labelW + gap). */
  labelW: Float32Array;
  /** Deepest column. */
  maxDepth: number;
  /** Character advance used for the sizes. */
  charW: number;
  /** Total rows. */
  rows: number;
  /** Built from a tape: its cards and rows as tape indexes (null: from nodes, `node` and `rowNode`). */
  tape: TapeModel | null;
}

export interface TapeModel {
  doc: TapeDoc;
  /** The root the model was built from: nodes are made under it, the same objects the other views get. */
  root: JNode;
  /** Card → tape index of the node it shows. */
  card: Int32Array;
  /** Row → tape index of the entry it shows. */
  row: Int32Array;
}

// ── Display text ─────────────────────────────────────────────────────────
// Rows are one line: strings show JSON escapes (\n, \", …) and everything is
// cut to a column budget with "…". Width in columns: East Asian wide and
// emoji characters take two, the rest one.

const ESC: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r', 34: '\\"', 92: '\\\\' };

/**
 * Display columns of code point `cp`: East Asian wide/fullwidth and emoji
 * take two, combining marks and joiners none. Erring wide is safe (a little
 * spare room); erring narrow would overflow the card.
 */
function cpCols(cp: number): number {
  if (cp < 0x300) return 1;
  if (cp <= 0x36f || cp === 0x200b || cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;
  if (cp < 0x1100) return 1;
  return cp <= 0x115f ||
    (cp >= 0x231a && cp <= 0x23ff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1;
}

/**
 * `s` cut to `max` columns ("…" takes one), optionally as a JSON string body
 * (escapes shown). Returns the text when `build`, and its width in `fitCols`.
 */
export let fitCols = 0;
export function fit(s: string, max: number, quoted: boolean, build = true): string {
  return fitIn(s, 0, s.length, max, quoted, build);
}

/** `fit` of s.slice(from, to), without making that string (a value in a tape's source). */
function fitIn(s: string, from: number, to: number, max: number, quoted: boolean, build: boolean): string {
  let cols = 0;
  let out = '';
  for (let i = from; i < to; i++) {
    let cp = s.charCodeAt(i);
    let piece: string | null = null;
    let w: number;
    if (quoted && (cp < 32 || cp === 34 || cp === 92)) {
      piece = ESC[cp] ?? '\\u' + cp.toString(16).padStart(4, '0');
      w = piece.length;
    } else if (cp < 32 || cp === 0x2028 || cp === 0x2029) {
      // Unquoted text (keys): control characters would break the line.
      piece = cp === 10 ? '↵' : '·';
      w = 1;
    } else {
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < to) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
      }
      w = cpCols(cp);
    }
    // Room for this piece, and for "…" if more follows.
    const last = i === to - 1 || (cp > 0xffff && i === to - 2);
    if (cols + w > (last ? max : max - 1)) {
      fitCols = cols + 1;
      return build ? out + '…' : '';
    }
    cols += w;
    if (build) out += piece ?? (cp > 0xffff ? s.slice(i, i + 2) : s[i]);
    if (cp > 0xffff) i++;
  }
  fitCols = cols;
  return out;
}

/** A colour value (same rule as the tree view): drawn with a swatch before its text. */
const COLOR = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\(\s*[\d.%\s,/+-]+\))$/i;
/** Columns reserved for the swatch, and its size in px. */
export const SWATCH_COLS = 2;
export const SWATCH_PX = 9;

export function swatch(n: JNode): boolean {
  return n.t === STR && isColor(n.v as string);
}

function isColor(s: string): boolean {
  const c = s.charCodeAt(0) | 32;
  return (c === 35 || c === 114 || c === 104) && s.length < 64 && COLOR.test(s);
}

/** Number of entries of a container. */
const count = (n: JNode) => (n.v as JNode[]).length;

/** The label of an entry: its key, or its index in an array. */
export function labelText(n: JNode, build = true): string {
  if (typeof n.key === 'number') {
    if (!build) {
      fitCols = digits(n.key);
      return '';
    }
    const s = String(n.key);
    fitCols = s.length;
    return s;
  }
  if (n.key === undefined) {
    fitCols = 0;
    return '';
  }
  return fit(n.key, G.keyMax, false, build);
}

/**
 * Columns of `n` shown inline (`["a", 1]`), or -1 when it isn't: only
 * arrays of 1 … G.inlineMax primitives whose whole text fits G.valMax.
 */
export function inlineCols(n: JNode): number {
  if (n.t !== ARR) return -1;
  const list = n.v as JNode[];
  const len = list.length;
  if (!len || len > G.inlineMax) return -1;
  let cols = 2;
  for (let i = 0; i < len; i++) {
    const k = list[i];
    if (k.t >= ARR) return -1;
    cols += (i ? 2 : 0) + plainCols(k);
    if (cols > G.valMax) return -1;
  }
  return cols;
}

/** True when `n` gets its own card (a non-empty container that isn't shown inline). */
const isCard = (n: JNode) => n.t >= ARR && (n.v as JNode[]).length > 0 && inlineCols(n) < 0;

/**
 * Value texts that stand in for a node's own, set by huge-file mode (lib/huge/graph.ts) for what it hasn't read:
 * "+980 more" (an empty array standing for the next items) or a container's size (`[1,234]`). Null in the
 * normal tool, which never pays more than this check.
 */
let notes: WeakMap<JNode, string> | null = null;
export const setValueNotes = (m: WeakMap<JNode, string> | null) => {
  notes = m;
};
/** The note standing in for `n`'s value, if huge mode set one. */
export const valueNote = (n: JNode) => (notes === null ? undefined : notes.get(n));

/** Value column text of a row: a primitive, `{}`/`[]`, an inline array, or a nested container's size (`{3}`, `[12]`). */
export function valueText(n: JNode, build = true): string {
  let s: string;
  if (notes !== null) {
    const note = notes.get(n);
    if (note !== undefined) {
      fitCols = note.length;
      return build ? note : '';
    }
  }
  switch (n.t) {
    case STR: {
      const body = fit(n.v as string, G.valMax - 2, true, build);
      fitCols += 2;
      return build ? '"' + body + '"' : '';
    }
    case NUM:
      return fit(n.v as string, G.valMax, false, build);
    case BOOL:
      s = n.v ? 'true' : 'false';
      break;
    case NUL:
      s = 'null';
      break;
    default: {
      const cols = inlineCols(n);
      if (cols < 0) {
        s = sizeText(n);
        break;
      }
      fitCols = cols;
      if (!build) return '';
      // Fits by construction: every item at full length.
      const list = n.v as JNode[];
      s = '[';
      for (let i = 0; i < list.length; i++) s += (i ? ', ' : '') + valueText(list[i], true);
      fitCols = cols;
      return s + ']';
    }
  }
  fitCols = s.length;
  return s;
}

/** `{3}` / `[12]` / `{}` / `[]`. */
export const sizeText = (n: JNode) => sizeTextOf(n.t, count(n));
const sizeTextOf = (t: Kind, c: number) => (t === OBJ ? (c ? `{${c}}` : '{}') : c ? `[${c}]` : '[]');

/** A card's header label: its key, `[index]`, or `root`. */
/** x offset of a card's header label (after the chevron of a card with children). */
export const headX = (m: GraphModel, c: number) => G.padX + (m.kids[c] ? G.chev : 0);

export function headText(n: JNode, build = true): string {
  if (typeof n.key === 'number') {
    const s = `[${n.key}]`;
    fitCols = s.length;
    return s;
  }
  if (n.key === undefined) {
    fitCols = 4;
    return 'root';
  }
  return fit(n.key, G.headMax, false, build);
}

// ── Building ─────────────────────────────────────────────────────────────

/** Columns of `s` cut to `max` (as `fit` counts them), without building the text. */
function colsOf(s: string, max: number, quoted: boolean): number {
  return colsIn(s, 0, s.length, max, quoted);
}

/** `colsOf` of s.slice(from, to), without making that string. */
function colsIn(s: string, from: number, to: number, max: number, quoted: boolean): number {
  const n = to - from;
  // Fast path: printable ASCII with nothing to escape (most keys and values).
  const lim = from + (n <= max ? n : max + 1);
  let i = from;
  for (; i < lim; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126 || (quoted && (c === 34 || c === 92))) break;
  }
  if (i === lim) return n <= max ? n : max;
  fitIn(s, from, to, max, quoted, false);
  return fitCols;
}

/** Columns of sizeText(n). */
const sizeCols = (n: JNode) => {
  const c = (n.v as JNode[]).length;
  return c ? digits(c) + 2 : 2;
};

const digits = (k: number) => {
  let n = 1;
  while (k >= 10) {
    k = Math.floor(k / 10);
    n++;
  }
  return n;
};

/** Value column width of a row (columns): valueText, plus a colour value's swatch. */
function valueCols(k: JNode): number {
  return plainCols(k) + (k.t === STR && swatch(k) ? SWATCH_COLS : 0);
}

/** Columns of valueText(k). */
function plainCols(k: JNode): number {
  switch (k.t) {
    case STR:
      return colsOf(k.v as string, G.valMax - 2, true) + 2;
    case NUM:
      return colsOf(k.v as string, G.valMax, false);
    case BOOL:
      return k.v ? 4 : 5;
    case NUL:
      return 4;
    default: {
      const c = (k.v as JNode[]).length;
      const inline = c && k.t === ARR ? inlineCols(k) : -1;
      return inline >= 0 ? inline : c ? digits(c) + 2 : 2;
    }
  }
}

/**
 * A tape and its source text, read as the functions above read nodes (texts, widths, inline arrays,
 * colours), by tape index and without making nodes: a string's text is measured on the source.
 */
export class TapeDoc {
  readonly a: Int32Array;
  /** Columns of each property name as a row label and as a card header (-1: not counted yet). */
  private keyCols: Int16Array;
  private headColsOf: Int16Array;
  /** The source range of the last value `inSrc` found there. */
  private from = 0;
  private to = 0;
  /**
   * While a model is built: inlineCols of small arrays by node (0: not known yet, 1: not inline, 2 + cols),
   * as the build asks up to four times for each.
   */
  inline: Uint8Array | null = null;

  constructor(
    readonly t: Tape,
    readonly src: string,
  ) {
    this.a = t.nodes;
    this.keyCols = new Int16Array(t.keys.length).fill(-1);
    this.headColsOf = new Int16Array(t.keys.length).fill(-1);
  }

  kind(i: number): Kind {
    return (this.a[i * W] & 7) as Kind;
  }

  /** Whether i's value is a number or string whose text is in the source as is (from … to). */
  private inSrc(i: number): boolean {
    const o = i * W;
    const meta = this.a[o];
    const vk = (meta >> 5) & 7;
    if (vk === VALUE_SLICE && (meta & 7) === STR) {
      this.from = this.a[o + 1] + 1;
      this.to = this.a[o + 2] - 1;
      return true;
    }
    if (vk === VALUE_SLICE || vk === VALUE_RAW) {
      this.from = this.a[o + 1];
      this.to = this.a[o + 2];
      return true;
    }
    return false;
  }

  private str(i: number) {
    return valueOf(this.t, i, this.src) as string;
  }

  /** `inlineCols` of node i. */
  inlineCols(i: number): number {
    const a = this.a;
    if ((a[i * W] & 7) !== ARR) return -1;
    // 1 … G.inlineMax primitives: 2 … G.inlineMax + 1 nodes.
    const size = sizeOf(this.t, i);
    if (size < 2 || size > G.inlineMax + 1) return -1;
    const memo = this.inline;
    if (memo && memo[i]) return memo[i] - 2;
    let cols = 2;
    for (let c = i + 1; c < i + size; c++) {
      if ((a[c * W] & 7) >= ARR || (cols += (c > i + 1 ? 2 : 0) + this.plainCols(c)) > G.valMax) {
        cols = -1;
        break;
      }
    }
    if (memo) memo[i] = cols + 2;
    return cols;
  }

  /** `isCard` of node i. */
  isCard(i: number): boolean {
    return (this.a[i * W] & 7) >= ARR && sizeOf(this.t, i) > 1 && this.inlineCols(i) < 0;
  }

  /** `plainCols` of node i. */
  plainCols(i: number): number {
    switch (this.kind(i)) {
      case STR:
        return (this.inSrc(i) ? colsIn(this.src, this.from, this.to, G.valMax - 2, true) : colsOf(this.str(i), G.valMax - 2, true)) + 2;
      case NUM:
        return this.inSrc(i) ? colsIn(this.src, this.from, this.to, G.valMax, false) : colsOf(this.str(i), G.valMax, false);
      case BOOL:
        return valueOf(this.t, i, this.src) ? 4 : 5;
      case NUL:
        return 4;
      default: {
        if (sizeOf(this.t, i) === 1) return 2;
        const inline = this.inlineCols(i);
        return inline >= 0 ? inline : digits(childCount(this.t, i)) + 2;
      }
    }
  }

  /** `valueCols` of node i. */
  valueCols(i: number): number {
    return this.plainCols(i) + (this.kind(i) === STR && this.color(i) !== null ? SWATCH_COLS : 0);
  }

  /** i's text when it is a colour value (see swatch), else null. */
  color(i: number): string | null {
    if (this.kind(i) !== STR) return null;
    if (!this.inSrc(i)) {
      const s = this.str(i);
      return isColor(s) ? s : null;
    }
    const { from, to, src } = this;
    const c = src.charCodeAt(from) | 32;
    if (to === from || !(c === 35 || c === 114 || c === 104) || to - from >= 64) return null;
    // Not "rgb…" / "hsl…" (most strings starting with r or h): no string to make.
    if (c !== 35 && (c === 114 ? (src.charCodeAt(from + 1) | 32) !== 103 || (src.charCodeAt(from + 2) | 32) !== 98 : (src.charCodeAt(from + 1) | 32) !== 115 || (src.charCodeAt(from + 2) | 32) !== 108)) return null;
    const s = src.slice(from, to);
    return COLOR.test(s) ? s : null;
  }

  /** `valueText` of node i; `entries`: a container's entry count when known (a card's), else it is counted on the tape. */
  valueText(i: number, build = true, entries = -1): string {
    const kind = this.kind(i);
    let s: string;
    switch (kind) {
      case STR: {
        const body = this.inSrc(i) ? fitIn(this.src, this.from, this.to, G.valMax - 2, true, build) : fit(this.str(i), G.valMax - 2, true, build);
        fitCols += 2;
        return build ? '"' + body + '"' : '';
      }
      case NUM:
        return this.inSrc(i) ? fitIn(this.src, this.from, this.to, G.valMax, false, build) : fit(this.str(i), G.valMax, false, build);
      case BOOL:
        s = valueOf(this.t, i, this.src) ? 'true' : 'false';
        break;
      case NUL:
        s = 'null';
        break;
      default: {
        const cols = this.inlineCols(i);
        if (cols < 0) {
          s = sizeTextOf(kind, entries >= 0 ? entries : childCount(this.t, i));
          break;
        }
        fitCols = cols;
        if (!build) return '';
        const end = i + sizeOf(this.t, i);
        s = '[';
        for (let c = i + 1; c < end; c++) s += (c > i + 1 ? ', ' : '') + this.valueText(c, true);
        fitCols = cols;
        return s + ']';
      }
    }
    fitCols = s.length;
    return s;
  }

  /** `labelText` of node i. */
  labelText(i: number, build = true): string {
    const o = i * W;
    const kk = (this.a[o] >> 3) & 3;
    if (kk === KEY_INDEX) {
      const k = this.a[o + 4];
      if (!build) {
        fitCols = digits(k);
        return '';
      }
      const s = String(k);
      fitCols = s.length;
      return s;
    }
    if (kk !== KEY_NAME) {
      fitCols = 0;
      return '';
    }
    return fit(this.t.keys[this.a[o + 4]], G.keyMax, false, build);
  }

  /** `headText` of node i. */
  headText(i: number, build = true): string {
    const o = i * W;
    const kk = (this.a[o] >> 3) & 3;
    if (kk === KEY_INDEX) {
      const s = `[${this.a[o + 4]}]`;
      fitCols = s.length;
      return s;
    }
    if (kk !== KEY_NAME) {
      fitCols = 4;
      return 'root';
    }
    return fit(this.t.keys[this.a[o + 4]], G.headMax, false, build);
  }

  /** Columns of object member i's name as a row label (each name counted once). */
  keyLabelCols(i: number): number {
    const k = this.a[i * W + 4];
    let c = this.keyCols[k];
    if (c < 0) c = this.keyCols[k] = colsOf(this.t.keys[k], G.keyMax, false);
    return c;
  }

  /** Columns of i's header label (headText). */
  headCols(i: number): number {
    const o = i * W;
    const kk = (this.a[o] >> 3) & 3;
    if (kk === KEY_INDEX) return digits(this.a[o + 4]) + 2;
    if (kk !== KEY_NAME) return 4;
    const k = this.a[o + 4];
    let c = this.headColsOf[k];
    if (c < 0) c = this.headColsOf[k] = colsOf(this.t.keys[k], G.headMax, false);
    return c;
  }
}

class Grow<T extends Int32Array | Float32Array> {
  a: T;
  n = 0;
  constructor(make: (n: number) => T, cap: number) {
    this.a = make(Math.max(64, cap));
  }
  push(v: number) {
    if (this.n === this.a.length) this.grow();
    this.a[this.n++] = v;
  }
  private grow() {
    const b = new (this.a.constructor as new (n: number) => T)(this.a.length * 2);
    b.set(this.a);
    this.a = b;
  }
  /** The filled part, as a view: copying to the exact size at the end of a big build costs a full GC pause. */
  done(): T {
    return this.a.subarray(0, this.n) as T;
  }
}
const ints = (cap: number) => new Grow((n) => new Int32Array(n), cap);
const floats = (cap: number) => new Grow((n) => new Float32Array(n), cap);

/** Runs a generator until it finishes or `deadline` passes (it yields every few hundred units of work). */
export function stepper<T>(it: Generator<void, T>): (deadline: number) => T | null {
  return (deadline: number) => {
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
      if (performance.now() > deadline) return null;
    }
  };
}

/** A container whose rows are being listed or whose children are being visited. */
interface Frame {
  c: number;
  list: JNode[];
  d: number;
  bus: boolean;
  /** Its first row. */
  first: number;
  /** Next entry to look at for a child card. */
  i: number;
}

/** The same on a tape. */
interface TapeFrame {
  c: number;
  /** One past the last node of its subtree. */
  end: number;
  d: number;
  bus: boolean;
  first: number;
  /** Next entry to look at for a child card: its tape index and its position. */
  at: number;
  i: number;
}

/**
 * Builds the model in steps: call the returned function with a deadline
 * (performance.now() value) until it returns the model. Every loop yields,
 * so even a card with a million entries never blocks for long. `hint` is
 * the parse's node count (sizes the arrays). `charW` is the advance of one
 * monospace column at G.font. A root made from a tape is built from the tape.
 */
export function modelBuilder(root: JNode, charW: number, hint = 0): (deadline: number) => GraphModel | null {
  const z = tapeOfNode(root);
  return stepper(z ? buildTape(new TapeDoc(z.tape, z.src), root, charW) : build(root, charW, hint));
}

/** Yields after about this many units of work (entries or cards). */
const CHUNK = 1024;

/** The per-card arrays both builders fill, and the passes that finish a model. */
class Cards {
  n = 0;
  maxDepth = 0;
  readonly parent: Grow<Int32Array>;
  readonly depth: Grow<Int32Array>;
  readonly rowStart: Grow<Int32Array>;
  readonly portRow: Grow<Int32Array>;
  readonly kids: Grow<Int32Array>;
  readonly bus: Grow<Int32Array>;
  readonly w: Grow<Float32Array>;
  readonly h: Grow<Float32Array>;
  readonly labelW: Grow<Float32Array>;

  constructor(
    cap: number,
    readonly charW: number,
  ) {
    this.parent = ints(cap);
    this.depth = ints(cap);
    this.rowStart = ints(cap);
    this.portRow = ints(cap);
    this.kids = ints(cap);
    this.bus = ints(cap);
    this.w = floats(cap);
    this.h = floats(cap);
    this.labelW = floats(cap);
  }

  /** Adds a card: its parent card, column, the parent's row its edge starts from (-1: none) and first row. */
  open(p: number, d: number, r: number, first: number): number {
    this.parent.push(p);
    this.depth.push(d);
    this.portRow.push(r);
    this.rowStart.push(first);
    if (d > this.maxDepth) this.maxDepth = d;
    return this.n++;
  }

  /** The card's rows are listed: its size, from the widest label and value (columns) and its header's. */
  close(rows: number, labelCols: number, valCols: number, headCols: number, ports: boolean, bus: boolean, nk: number) {
    const charW = this.charW;
    this.bus.push(bus ? 1 : 0);
    this.kids.push(nk);
    const lw = labelCols * charW;
    const body = rows ? G.padX + (lw ? lw + G.gap : 0) + valCols * charW + G.padX + (ports ? G.port : 0) : 0;
    const head = G.padX + (nk ? G.chev : 0) + headCols * charW + G.padX + (bus ? G.port : 0);
    this.labelW.push(lw);
    this.w.push(Math.ceil(Math.max(G.minW, body, head)));
    this.h.push(G.head + (rows ? rows * G.row + G.padY : 0));
  }

  /** The model's card arrays, once all `rows` rows are listed. */
  *finish(rows: number) {
    const n = this.n;
    this.rowStart.push(rows);
    const par = this.parent.done();
    const end = new Int32Array(n);
    end.fill(1);
    for (let c = n - 1; c > 0; c--) {
      end[par[c]] += end[c];
      if (c % (CHUNK * 64) === 0) yield;
    }
    for (let c = 0; c < n; c++) end[c] += c;
    yield;
    const kids = this.kids.done();
    const kidStart = new Int32Array(n + 1);
    for (let c = 0; c < n; c++) kidStart[c + 1] = kidStart[c] + kids[c];
    yield;
    const kidList = new Int32Array(Math.max(0, n - 1));
    const fill = kidStart.slice(0, n);
    for (let c = 1; c < n; c++) {
      kidList[fill[par[c]]++] = c;
      if (c % (CHUNK * 64) === 0) yield;
    }
    yield;
    return {
      n,
      parent: par,
      depth: this.depth.done(),
      end,
      rowStart: this.rowStart.done(),
      portRow: this.portRow.done(),
      bus: new Uint8Array(this.bus.done()),
      kids,
      kidStart,
      kidList,
      w: this.w.done(),
      h: this.h.done(),
      labelW: this.labelW.done(),
      maxDepth: this.maxDepth,
      charW: this.charW,
      rows,
    };
  }
}

function* build(root: JNode, charW: number, hint: number): Generator<void, GraphModel> {
  const cap = Math.min(hint || 1024, 1 << 22);
  // Sized up front (the parse's node count bounds both), then trimmed in place:
  // growing million-entry arrays leaves copies for a full GC to clean up.
  const node: JNode[] = hint ? new Array(hint) : [];
  const rowNode: JNode[] = hint ? new Array(hint) : [];
  const cards = new Cards(cap >> 2, charW);
  let rowsN = 0;
  const rowChild = ints(cap);
  let work = 0;
  const stack: Frame[] = [];

  // Depth-first, in document order: a card's rows are listed before any of its
  // children is visited, so cards (and their rows) come out in pre-order.
  // `vn` is the next card to add (null: find one on the stack).
  let vn: JNode | null = root;
  let vp = -1;
  let vd = 0;
  let vr = -1;
  for (;;) {
    if (vn) {
      const n = vn;
      const first = rowsN;
      const c = cards.open(vp, vd, vr, first);
      node[c] = n;
      if (vr >= 0) rowChild.a[vr] = c;
      let labelCols = 0;
      let valCols = 0;
      let ports = false;
      let bus = false;
      let nk = 0;
      if (n.t < ARR) {
        // A primitive root: one row with its value.
        rowNode[rowsN++] = n;
        rowChild.push(-1);
        valCols = valueCols(n);
      } else {
        const list = n.v as JNode[];
        const len = list.length;
        for (let i = 0; i < len; i++) {
          if (isCard(list[i])) nk++;
          if (++work % CHUNK === 0) yield;
        }
        bus = nk > G.portMax || (n.t === ARR && nk === len);
        const arr = n.t === ARR;
        for (let i = 0; i < len; i++) {
          if (++work % CHUNK === 0) yield;
          const k = list[i];
          const deep = nk > 0 && isCard(k);
          if (deep && bus) continue;
          rowNode[rowsN++] = k;
          rowChild.push(-1);
          const lc = arr ? digits(i) : colsOf(k.key as string, G.keyMax, false);
          if (lc > labelCols) labelCols = lc;
          const vc = valueCols(k);
          if (vc > valCols) valCols = vc;
          if (deep) ports = true;
        }
        if (nk) stack.push({ c, list, d: vd, bus, first, i: 0 });
      }
      const key = n.key;
      const headCols = (typeof key === 'number' ? digits(key) + 2 : key === undefined ? 4 : colsOf(key, G.headMax, false)) + (n.t >= ARR ? 1 + sizeCols(n) : 0);
      cards.close(rowsN - first, labelCols, valCols, headCols, ports, bus, nk);
      vn = null;
      if (++work % CHUNK === 0) yield;
    }
    if (!stack.length) break;
    const f = stack[stack.length - 1];
    const { list } = f;
    let i = f.i;
    while (i < list.length && !isCard(list[i])) {
      i++;
      if (++work % CHUNK === 0) yield;
    }
    if (i === list.length) {
      stack.pop();
      continue;
    }
    f.i = i + 1;
    vn = list[i];
    vp = f.c;
    vd = f.d + 1;
    vr = f.bus ? -1 : f.first + i;
  }

  node.length = cards.n;
  rowNode.length = rowsN;
  const parts = yield* cards.finish(rowsN);
  return { ...parts, node, rowNode, rowChild: rowChild.done(), tape: null };
}

/**
 * `build` on a tape: the same model (the same yields too), with tape indexes for cards and rows
 * instead of nodes. Nothing is made: kinds, keys and children are read off the tape, and widths
 * off the source text.
 */
function* buildTape(doc: TapeDoc, root: JNode, charW: number): Generator<void, GraphModel> {
  const t = doc.t;
  const a = doc.a;
  const total = sizeOf(t, root.zi);
  const cap = Math.min(total, 1 << 22);
  doc.inline = new Uint8Array(t.count);
  const cards = new Cards(cap >> 2, charW);
  const cardAt = ints(cap >> 2);
  // A row per node at most: sized once, never grown.
  const rowAt = new Int32Array(total);
  const rowChild = new Int32Array(total);
  let rowsN = 0;
  let work = 0;
  const stack: TapeFrame[] = [];

  // As in `build`; `vn` is a tape index (-1: none).
  let vn = root.zi;
  let vp = -1;
  let vd = 0;
  let vr = -1;
  for (;;) {
    if (vn >= 0) {
      const n = vn;
      const first = rowsN;
      const c = cards.open(vp, vd, vr, first);
      cardAt.push(n);
      if (vr >= 0) rowChild[vr] = c;
      const kind = a[n * W] & 7;
      let labelCols = 0;
      let valCols = 0;
      let ports = false;
      let bus = false;
      let nk = 0;
      let len = 0;
      if (kind < ARR) {
        rowAt[rowsN] = n;
        rowChild[rowsN++] = -1;
        valCols = doc.valueCols(n);
      } else {
        const end = nextOf(t, n);
        for (let k = n + 1; k < end; k = nextOf(t, k)) {
          len++;
          if (doc.isCard(k)) nk++;
          if (++work % CHUNK === 0) yield;
        }
        bus = nk > G.portMax || (kind === ARR && nk === len);
        const arr = kind === ARR;
        for (let k = n + 1, i = 0; k < end; k = nextOf(t, k), i++) {
          if (++work % CHUNK === 0) yield;
          const deep = nk > 0 && doc.isCard(k);
          if (deep && bus) continue;
          rowAt[rowsN] = k;
          rowChild[rowsN++] = -1;
          const lc = arr ? digits(i) : doc.keyLabelCols(k);
          if (lc > labelCols) labelCols = lc;
          const vc = doc.valueCols(k);
          if (vc > valCols) valCols = vc;
          if (deep) ports = true;
        }
        if (nk) stack.push({ c, end, d: vd, bus, first, at: n + 1, i: 0 });
      }
      const headCols = doc.headCols(n) + (kind >= ARR ? 1 + (len ? digits(len) + 2 : 2) : 0);
      cards.close(rowsN - first, labelCols, valCols, headCols, ports, bus, nk);
      vn = -1;
      if (++work % CHUNK === 0) yield;
    }
    if (!stack.length) break;
    const f = stack[stack.length - 1];
    let k = f.at;
    let i = f.i;
    while (k < f.end && !doc.isCard(k)) {
      k = nextOf(t, k);
      i++;
      if (++work % CHUNK === 0) yield;
    }
    if (k >= f.end) {
      stack.pop();
      continue;
    }
    f.at = nextOf(t, k);
    f.i = i + 1;
    vn = k;
    vp = f.c;
    vd = f.d + 1;
    vr = f.bus ? -1 : f.first + i;
  }

  doc.inline = null;
  const parts = yield* cards.finish(rowsN);
  return {
    ...parts,
    node: [],
    rowNode: [],
    rowChild: rowChild.subarray(0, rowsN),
    tape: { doc, root, card: cardAt.done(), row: rowAt.subarray(0, rowsN) },
  };
}

/** Builds the whole model at once (tests, small documents). */
export function buildModel(root: JNode, charW: number, hint = 0): GraphModel {
  const step = modelBuilder(root, charW, hint);
  let m: GraphModel | null = null;
  while (!(m = step(Infinity)));
  return m;
}

// ── Lookups ──────────────────────────────────────────────────────────────

/** The child cards of `c`, in order. */
export const childCards = (m: GraphModel, c: number) => m.kidList.subarray(m.kidStart[c], m.kidStart[c + 1]);

/**
 * Index of `n` itself among `count` nodes in document order (`at(i)`), or -1: a binary search on the
 * start offset, then identity among equal starts (a JSON Lines wrapper starts where its first record
 * does). A node of another parse matches nothing.
 */
function indexIn(count: number, at: (i: number) => JNode, n: JNode, from = 0) {
  let lo = from;
  let hi = from + count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid).s < n.s) lo = mid + 1;
    else hi = mid;
  }
  for (; lo < from + count && at(lo).s === n.s; lo++) if (at(lo) === n) return lo;
  return -1;
}

/**
 * The card showing container `n` (-1 when `n` is not a card: a primitive, an empty container, or not in
 * this model). Cards are in pre-order, so in document order: a binary search, at any depth.
 */
export function cardOf(m: GraphModel, n: JNode): number {
  const z = m.tape;
  if (z) return n.z === z.root.z ? cardOfIndex(m, n.zi) : -1;
  return indexIn(m.n, (i) => m.node[i], n);
}

/**
 * The row showing entry `n` (-1 if no row does: the root, a nested container that hangs off a bus, or a
 * node of another parse). A value inside an inline array is shown by that array's row.
 */
export function rowOf(m: GraphModel, n: JNode): number {
  const z = m.tape;
  if (z) return n.z === z.root.z ? rowOfIndex(m, n.zi) : -1;
  const u = n.u;
  if (!u) return m.node[0] === n && n.t < ARR ? 0 : -1;
  // A card's rows are its entries, in document order.
  const c = cardOf(m, u);
  if (c >= 0) return indexIn(m.rowStart[c + 1] - m.rowStart[c], (i) => m.rowNode[i], n, m.rowStart[c]);
  return u.t === ARR && u.u && inlineCols(u) >= 0 ? rowOf(m, u) : -1;
}

/**
 * Where `n` is drawn: its card if it is one, and the row showing it (a value inside an inline array:
 * that array's row). Both -1 for a node this model doesn't show, such as one from another parse.
 */
export function locate(m: GraphModel, n: JNode): { card: number; row: number } {
  return { card: n.t >= ARR ? cardOf(m, n) : -1, row: rowOf(m, n) };
}

/** The card a row belongs to (binary search over rowStart). */
export function cardOfRow(m: GraphModel, r: number): number {
  let lo = 0;
  let hi = m.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m.rowStart[mid] <= r) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── Tape models: lookups by tape index ───────────────────────────────────

/** Where `i` is in the increasing a[from … to), or -1. */
function search(a: Int32Array, from: number, to: number, i: number) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  return lo < to && a[lo] === i ? lo : -1;
}

/** cardOf the node at tape index `i` of a tape model (cards are in tape order). */
export function cardOfIndex(m: GraphModel, i: number): number {
  return search(m.tape!.card, 0, m.n, i);
}

/** rowOf the node at tape index `i` of a tape model (a card's rows are in tape order). */
export function rowOfIndex(m: GraphModel, i: number): number {
  const z = m.tape!;
  const t = z.doc.t;
  const root = z.card[0];
  if (i === root) return z.doc.kind(i) < ARR ? 0 : -1;
  if (i < root || i >= nextOf(t, root)) return -1;
  const p = parentOf(t, i);
  const c = cardOfIndex(m, p);
  if (c >= 0) return search(z.row, m.rowStart[c], m.rowStart[c + 1], i);
  return p !== root && z.doc.inlineCols(p) >= 0 ? rowOfIndex(m, p) : -1;
}

/** locate the node at tape index `i` of a tape model. */
export function locateIndex(m: GraphModel, i: number): { card: number; row: number } {
  return { card: m.tape!.doc.kind(i) >= ARR ? cardOfIndex(m, i) : -1, row: rowOfIndex(m, i) };
}

// ── Cards and rows, in either kind of model ──────────────────────────────

/** The node card `c` shows (a tape model's is made if it wasn't, with its ancestors' children). */
export function cardNode(m: GraphModel, c: number): JNode {
  const z = m.tape;
  return z ? nodeAtIndex(z.root, z.card[c])! : m.node[c];
}

/** The entry row `r` shows (a tape model's is made if it wasn't, with its ancestors' children). */
export function rowEntry(m: GraphModel, r: number): JNode {
  const z = m.tape;
  return z ? nodeAtIndex(z.root, z.row[r])! : m.rowNode[r];
}

/** Entries of card `c` (a container): its rows, and the child cards on its bus. */
const cardEntries = (m: GraphModel, c: number) => m.rowStart[c + 1] - m.rowStart[c] + (m.bus[c] ? m.kids[c] : 0);

/**
 * Entries of the container card `c` shows (`r` < 0) or row `r` shows, without making them (a tape model's
 * are counted off the model, or the tape for a small inline array).
 */
export function entryCount(m: GraphModel, c: number, r: number): number {
  if (r < 0) return cardEntries(m, c);
  const k = m.rowChild[r];
  if (k >= 0) return cardEntries(m, k);
  const z = m.tape;
  return z ? childCount(z.doc.t, z.row[r]) : (m.rowNode[r].v as JNode[]).length;
}

/** labelText of row `r`'s entry. */
export function rowLabelText(m: GraphModel, r: number, build = true): string {
  const z = m.tape;
  return z ? z.doc.labelText(z.row[r], build) : labelText(m.rowNode[r], build);
}

/** valueText of row `r`'s entry. */
export function rowValueText(m: GraphModel, r: number, build = true): string {
  const z = m.tape;
  if (!z) return valueText(m.rowNode[r], build);
  const k = m.rowChild[r];
  return z.doc.valueText(z.row[r], build, k >= 0 ? cardEntries(m, k) : -1);
}

/** The kind of row `r`'s entry. */
export function rowKind(m: GraphModel, r: number): Kind {
  const z = m.tape;
  return z ? z.doc.kind(z.row[r]) : m.rowNode[r].t;
}

/** Row `r`'s key: an index, a property name, or undefined (a primitive root). */
export function rowKey(m: GraphModel, r: number): Key {
  const z = m.tape;
  return z ? keyOf(z.doc.t, z.row[r]) : m.rowNode[r].key;
}

/** Whether row `r` is an array item (its label is an index). */
export function rowIsItem(m: GraphModel, r: number): boolean {
  const z = m.tape;
  return z ? ((z.doc.a[z.row[r] * W] >> 3) & 3) === KEY_INDEX : typeof m.rowNode[r].key === 'number';
}

/** Row `r`'s value as its node has it, for a primitive (null for a container). */
export function rowValue(m: GraphModel, r: number): string | boolean | null {
  const z = m.tape;
  if (z) return valueOf(z.doc.t, z.row[r], z.doc.src);
  const n = m.rowNode[r];
  return n.t >= ARR ? null : (n.v as string | boolean | null);
}

/** Row `r`'s colour when its value is one (drawn with a swatch, see `swatch`), else null. */
export function rowColor(m: GraphModel, r: number): string | null {
  const z = m.tape;
  if (z) return z.doc.color(z.row[r]);
  const n = m.rowNode[r];
  return swatch(n) ? (n.v as string) : null;
}

/** headText of card `c`. */
export function cardHeadText(m: GraphModel, c: number, build = true): string {
  const z = m.tape;
  return z ? z.doc.headText(z.card[c], build) : headText(m.node[c], build);
}

/** sizeText of card `c` (null: a primitive root). */
export function cardSizeText(m: GraphModel, c: number): string | null {
  const z = m.tape;
  if (!z) {
    const n = m.node[c];
    return n.t >= ARR ? sizeText(n) : null;
  }
  const kind = z.doc.kind(z.card[c]);
  return kind >= ARR ? sizeTextOf(kind, cardEntries(m, c)) : null;
}

/** Card `c`'s key: an index, a property name, or undefined (the root). */
export function cardKey(m: GraphModel, c: number): Key {
  const z = m.tape;
  return z ? keyOf(z.doc.t, z.card[c]) : m.node[c].key;
}

/** pathOf the node card `c` shows (a tape model's read off the tape). */
export function cardPath(m: GraphModel, c: number): Seg[] {
  const z = m.tape;
  if (!z) return pathOf(m.node[c]);
  const t = z.doc.t;
  const segs: Seg[] = [];
  for (let i = z.card[c], root = z.card[0]; i !== root; i = parentOf(t, i)) segs.push(keyOf(t, i) as Seg);
  return segs.reverse();
}

/** Containers wider than this get their children indexed by `cardFinder` (instead of walked per path). */
const SCAN = 64;

/**
 * Finds the cards of paths in `m` (-1: none), as `resolve` from `root` then `cardOf` would. A tape model
 * resolves on its tape without making nodes; a wide container's children are indexed the first time a
 * path goes through it (many paths are looked up at once: the collapsed cards kept across an edit).
 */
export function cardFinder(m: GraphModel, root: JNode): (segs: Seg[]) => number {
  const z = m.tape;
  if (!z || z.root !== root) {
    return (segs) => {
      const n = resolve(root, segs);
      return n ? cardOf(m, n) : -1;
    };
  }
  const t = z.doc.t;
  const a = t.nodes;
  const items = new Map<number, Int32Array>();
  const members = new Map<number, Map<string, number>>();
  const item = (i: number, k: number) => {
    let list = items.get(i);
    if (!list) {
      const end = nextOf(t, i);
      if (k < SCAN) {
        let c = i + 1;
        for (let j = 0; j < k && c < end; j++) c = nextOf(t, c);
        return c < end ? c : -1;
      }
      list = new Int32Array(childCount(t, i));
      for (let c = i + 1, j = 0; c < end; c = nextOf(t, c)) list[j++] = c;
      items.set(i, list);
    }
    return k < list.length ? list[k] : -1;
  };
  // The first member of that name, as `resolve`.
  const member = (i: number, key: string) => {
    let map = members.get(i);
    if (!map) {
      const end = nextOf(t, i);
      let c = i + 1;
      for (let j = 0; c < end && j < SCAN; c = nextOf(t, c), j++) if (t.keys[a[c * W + 4]] === key) return c;
      if (c >= end) return -1;
      map = new Map();
      for (c = i + 1; c < end; c = nextOf(t, c)) {
        const name = t.keys[a[c * W + 4]];
        if (!map.has(name)) map.set(name, c);
      }
      members.set(i, map);
    }
    return map.get(key) ?? -1;
  };
  return (segs) => {
    let i = z.card[0];
    for (const k of segs) {
      const kind = a[i * W] & 7;
      if (kind < ARR) return -1;
      if (kind === OBJ) i = member(i, String(k));
      else {
        const at = typeof k === 'number' || /^\d+$/.test(k) ? Number(k) : -1;
        i = Number.isInteger(at) && at >= 0 ? item(i, at) : -1;
      }
      if (i < 0) return -1;
    }
    return cardOfIndex(m, i);
  };
}
