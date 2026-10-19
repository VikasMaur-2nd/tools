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

/** Display columns of code point `cp`. */
export function cpCols(cp: number): number {
  if (cp < 0x1100) return 1;
  return (cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd) ? 2 : 1;
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

/** Number of entries of a container. */
export const count = (n: JNode) => (n.v as JNode[]).length;

/** The label of an entry: its key, or its index in an array. */
export function labelText(n: JNode, build = true): string {
  if (typeof n.key === 'number') {
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
    cols += (i ? 2 : 0) + valueCols(k);
    if (cols > G.valMax) return -1;
  }
  return cols;
}

/** True when `n` gets its own card (a non-empty container that isn't shown inline). */
export const isCard = (n: JNode) => n.t >= ARR && (n.v as JNode[]).length > 0 && inlineCols(n) < 0;

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

const digits = (k: number) => (k < 10 ? 1 : k < 100 ? 2 : k < 1000 ? 3 : k < 10000 ? 4 : k < 100000 ? 5 : String(k).length);

/** Value column width of a row (columns), as valueText would print it. */
function valueCols(k: JNode): number {
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
  done(): T {
    return this.a.slice(0, this.n) as T;
  }
}
const ints = (cap: number) => new Grow((n) => new Int32Array(n), cap);
const floats = (cap: number) => new Grow((n) => new Float32Array(n), cap);

/**
 * Builds the model in steps: call the returned function with a deadline
 * (performance.now() value) until it returns the model. `hint` is the
 * parse's node count (sizes the arrays). `charW` is the advance of one
 * monospace column at G.font.
 */
export function modelBuilder(root: JNode, charW: number, hint = 0): (deadline: number) => GraphModel | null {
  const cap = Math.min(hint || 1024, 1 << 22);
  // Sized up front: growing million-entry arrays of objects is most of the build's garbage.
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

  // Pending visits, popped in document order: node, parent card, depth, port row.
  const sn: JNode[] = [root];
  const sp = ints(256);
  const sd = ints(256);
  const sr = ints(256);
  sp.push(-1);
  sd.push(0);
  sr.push(-1);

  return (deadline: number) => {
    let budget = 0;
    while (sn.length) {
      const n = sn.pop() as JNode;
      const top = --sp.n;
      sd.n--;
      sr.n--;
      const pc = sp.a[top];
      const d = sd.a[top];
      const pr = sr.a[top];
      const c = cards++;
      const first = rowsN;
      node[c] = n;
      parent.push(pc);
      depth.push(d);
      portRow.push(pr);
      rowStart.push(first);
      if (pr >= 0) rowChild.a[pr] = c;
      if (d > maxDepth) maxDepth = d;
      let labelCols = 0;
      let valCols = 0;
      let ports = false;
      let isBus = false;
      let nk = 0;
      if (n.t < ARR) {
        // A primitive root: one row with its value.
        rowNode[rowsN++] = n;
        rowChild.push(-1);
        valCols = valueCols(n);
      } else {
        const list = n.v as JNode[];
        const len = list.length;
        for (let i = 0; i < len; i++) if (isCard(list[i])) nk++;
        isBus = nk > G.portMax || (n.t === ARR && nk === len);
        const arr = n.t === ARR;
        for (let i = 0; i < len; i++) {
          const k = list[i];
          const deep = nk > 0 && isCard(k);
          if (deep && isBus) continue;
          rowNode[rowsN++] = k;
          rowChild.push(-1);
          const lc = arr ? digits(i) : colsOf(k.key as string, G.keyMax, false);
          if (lc > labelCols) labelCols = lc;
          const vc = valueCols(k);
          if (vc > valCols) valCols = vc;
          if (deep) ports = true;
        }
        // Children, pushed last-first so they pop in order. Without a bus every entry has a row.
        if (nk) {
          for (let i = len - 1; i >= 0; i--) {
            const k = list[i];
            if (!isCard(k)) continue;
            sn.push(k);
            sp.push(c);
            sd.push(d + 1);
            sr.push(isBus ? -1 : first + i);
          }
        }
      }
      busA.push(isBus ? 1 : 0);
      kidsN.push(nk);
      const rows = rowsN - first;
      const key = n.key;
      const headCols = (typeof key === 'number' ? digits(key) + 2 : key === undefined ? 4 : colsOf(key, G.headMax, false)) + (n.t >= ARR ? 1 + sizeCols(n) : 0);
      const lw = labelCols * charW;
      const body = rows ? G.padX + (lw ? lw + G.gap : 0) + valCols * charW + G.padX + (ports ? G.port : 0) : 0;
      const head = G.padX + headCols * charW + G.padX + (isBus ? G.port : 0);
      labelW.push(lw);
      w.push(Math.ceil(Math.max(G.minW, body, head)));
      h.push(G.head + (rows ? rows * G.row + G.padY : 0));
      if (++budget === 512) {
        budget = 0;
        if (performance.now() > deadline) return null;
      }
    }
    const n = cards;
    node.length = n;
    rowNode.length = rowsN;
    rowStart.push(rowsN);
    const par = parent.done();
    const end = new Int32Array(n);
    for (let c = 0; c < n; c++) end[c] = 1;
    for (let c = n - 1; c > 0; c--) end[par[c]] += end[c];
    for (let c = 0; c < n; c++) end[c] += c;
    const kids = kidsN.done();
    const kidStart = new Int32Array(n + 1);
    for (let c = 0; c < n; c++) kidStart[c + 1] = kidStart[c] + kids[c];
    const kidList = new Int32Array(Math.max(0, n - 1));
    const fill = kidStart.slice(0, n);
    for (let c = 1; c < n; c++) kidList[fill[par[c]]++] = c;
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
      bus: Uint8Array.from(busA.done()),
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

/** Index of the first item in `list` whose source start is ≥ `s` (items are in document order). */
function lowerBound(len: number, at: (i: number) => number, s: number) {
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The child cards of `c`, in order. */
export const childCards = (m: GraphModel, c: number) => m.kidList.subarray(m.kidStart[c], m.kidStart[c + 1]);

/** The card showing container `n` (-1 when `n` is not a card: a primitive, an empty container, or not in this model). */
export function cardOf(m: GraphModel, n: JNode): number {
  // The chain from the root, then down one child card per level.
  const chain: JNode[] = [];
  for (let p: JNode | null = n; p; p = p.u) chain.push(p);
  if (chain[chain.length - 1] !== m.node[0]) return -1;
  let c = 0;
  for (let i = chain.length - 2; i >= 0; i--) {
    const want = chain[i];
    // Children of c are in document order; find the one at want.s.
    const kids = childCards(m, c);
    const j = lowerBound(kids.length, (x) => m.node[kids[x]].s, want.s);
    if (j >= kids.length || m.node[kids[j]] !== want) return -1;
    c = kids[j];
  }
  return c;
}

/** The row showing entry `n` (-1 if no row does: the root, or a nested container that hangs off a bus). */
export function rowOf(m: GraphModel, n: JNode): number {
  if (!n.u) return m.node[0] === n && n.t < ARR ? 0 : -1;
  const c = cardOf(m, n.u);
  if (c < 0) return -1;
  const a = m.rowStart[c];
  const b = m.rowStart[c + 1];
  const j = a + lowerBound(b - a, (x) => m.rowNode[a + x].s, n.s);
  return j < b && m.rowNode[j] === n ? j : -1;
}

/**
 * Where `n` is drawn: `card` is the card showing it whole (a container with
 * a card), `row` the row showing it in its parent's card (-1: none). A value
 * inside an inline array resolves to that array's row.
 */
export function locate(m: GraphModel, n: JNode): { card: number; row: number } {
  for (let p: JNode | null = n; p; p = p.u) {
    const card = p.t >= ARR ? cardOf(m, p) : -1;
    const row = rowOf(m, p);
    if (card >= 0 || row >= 0) return { card, row };
  }
  return { card: -1, row: -1 };
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
