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
 */
import { ARR, BOOL, NUL, NUM, OBJ, STR, type JNode } from '../json/parser';

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
  /** Card → the container it shows (or the primitive root). */
  node: JNode[];
  /** Card → parent card (-1 for the root). */
  parent: Int32Array;
  /** Card → column (root 0). */
  depth: Int32Array;
  /** Card → one past its last descendant (pre-order). */
  end: Int32Array;
  /** Rows of card c are rowStart[c] … rowStart[c + 1] - 1. Length n + 1. */
  rowStart: Int32Array;
  /** Row → the entry it shows (a primitive, an empty container, or a nested container on a port row). */
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
  let cols = 0;
  let out = '';
  const n = s.length;
  for (let i = 0; i < n; i++) {
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
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < n) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
      }
      w = cpCols(cp);
    }
    // Room for this piece, and for "…" if more follows.
    const last = i === n - 1 || (cp > 0xffff && i === n - 2);
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
  if (n.t !== STR) return false;
  const s = n.v as string;
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

/** Value column text of a row: a primitive, `{}`/`[]`, an inline array, or a nested container's size (`{3}`, `[12]`). */
export function valueText(n: JNode, build = true): string {
  let s: string;
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
export const sizeText = (n: JNode) => {
  const c = count(n);
  return n.t === OBJ ? (c ? `{${c}}` : '{}') : c ? `[${c}]` : '[]';
};

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
  const n = s.length;
  // Fast path: printable ASCII with nothing to escape (most keys and values).
  const lim = n <= max ? n : max + 1;
  let i = 0;
  for (; i < lim; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126 || (quoted && (c === 34 || c === 92))) break;
  }
  if (i === lim) return n <= max ? n : max;
  fit(s, max, quoted, false);
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

/**
 * Builds the model in steps: call the returned function with a deadline
 * (performance.now() value) until it returns the model. Every loop yields,
 * so even a card with a million entries never blocks for long. `hint` is
 * the parse's node count (sizes the arrays). `charW` is the advance of one
 * monospace column at G.font.
 */
export function modelBuilder(root: JNode, charW: number, hint = 0): (deadline: number) => GraphModel | null {
  return stepper(build(root, charW, hint));
}

/** Yields after about this many units of work (entries or cards). */
const CHUNK = 1024;

function* build(root: JNode, charW: number, hint: number): Generator<void, GraphModel> {
  const cap = Math.min(hint || 1024, 1 << 22);
  // Sized up front (the parse's node count bounds both), then trimmed in place:
  // growing million-entry arrays leaves copies for a full GC to clean up.
  const node: JNode[] = hint ? new Array(hint) : [];
  const rowNode: JNode[] = hint ? new Array(hint) : [];
  let cards = 0;
  let rowsN = 0;
  const parent = ints(cap >> 2);
  const depth = ints(cap >> 2);
  const rowStart = ints(cap >> 2);
  const portRow = ints(cap >> 2);
  const kidsN = ints(cap >> 2);
  const busA = ints(cap >> 2);
  const rowChild = ints(cap);
  const w = floats(cap >> 2);
  const h = floats(cap >> 2);
  const labelW = floats(cap >> 2);
  let maxDepth = 0;
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
      const c = cards++;
      const first = rowsN;
      node[c] = n;
      parent.push(vp);
      depth.push(vd);
      portRow.push(vr);
      rowStart.push(first);
      if (vr >= 0) rowChild.a[vr] = c;
      if (vd > maxDepth) maxDepth = vd;
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
      busA.push(bus ? 1 : 0);
      kidsN.push(nk);
      const rows = rowsN - first;
      const key = n.key;
      const headCols = (typeof key === 'number' ? digits(key) + 2 : key === undefined ? 4 : colsOf(key, G.headMax, false)) + (n.t >= ARR ? 1 + sizeCols(n) : 0);
      const lw = labelCols * charW;
      const body = rows ? G.padX + (lw ? lw + G.gap : 0) + valCols * charW + G.padX + (ports ? G.port : 0) : 0;
      const head = G.padX + (nk ? G.chev : 0) + headCols * charW + G.padX + (bus ? G.port : 0);
      labelW.push(lw);
      w.push(Math.ceil(Math.max(G.minW, body, head)));
      h.push(G.head + (rows ? rows * G.row + G.padY : 0));
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

  const n = cards;
  node.length = n;
  rowNode.length = rowsN;
  rowStart.push(rowsN);
  const par = parent.done();
  const end = new Int32Array(n);
  end.fill(1);
  for (let c = n - 1; c > 0; c--) {
    end[par[c]] += end[c];
    if (c % (CHUNK * 64) === 0) yield;
  }
  for (let c = 0; c < n; c++) end[c] += c;
  yield;
  const kids = kidsN.done();
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
    node,
    parent: par,
    depth: depth.done(),
    end,
    rowStart: rowStart.done(),
    rowNode,
    rowChild: rowChild.done(),
    portRow: portRow.done(),
    bus: new Uint8Array(busA.done()),
    kids,
    kidStart,
    kidList,
    w: w.done(),
    h: h.done(),
    labelW: labelW.done(),
    maxDepth,
    charW,
    rows: rowNode.length,
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
  return indexIn(m.n, (i) => m.node[i], n);
}

/**
 * The row showing entry `n` (-1 if no row does: the root, a nested container that hangs off a bus, or a
 * node of another parse). A value inside an inline array is shown by that array's row.
 */
export function rowOf(m: GraphModel, n: JNode): number {
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
