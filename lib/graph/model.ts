/*
 * The graph view's model: the document as cards and rows, in flat arrays.
 *
 * Every non-empty object or array becomes a card (a primitive root gets one
 * too). A card lists its entries as rows: primitives and empty containers
 * show their value; a nested container is a "port" row that an edge leaves
 * from. When a card has many nested containers, or is an array of nothing
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

/** Value column text of a row: a primitive, `{}`/`[]`, or a nested container's size (`{3}`, `[12]`). */
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
    default:
      s = sizeText(n);
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

class Grow {
  a: Int32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Int32Array(Math.max(16, cap));
  }
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

class GrowF {
  a: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Float32Array(Math.max(16, cap));
  }
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

const nested = (k: JNode) => k.t >= ARR && (k.v as JNode[]).length > 0;

/**
 * Builds the model in steps: call the returned function with a deadline
 * (performance.now() value) until it returns the model. `hint` is the
 * parse's node count (sizes the arrays). `charW` is the advance of one
 * monospace column at G.font.
 */
export function modelBuilder(root: JNode, charW: number, hint = 0): (deadline: number) => GraphModel | null {
  const cap = Math.min(hint || 1024, 1 << 20);
  const node: JNode[] = [];
  const rowNode: JNode[] = [];
  const parent = new Grow(cap >> 2);
  const depth = new Grow(cap >> 2);
  const rowStart = new Grow(cap >> 2);
  const portRow = new Grow(cap >> 2);
  const kidsN = new Grow(cap >> 2);
  const rowChild = new Grow(cap);
  const w = new GrowF(cap >> 2);
  const h = new GrowF(cap >> 2);
  const labelW = new GrowF(cap >> 2);
  const busArr: number[] = [];
  let maxDepth = 0;

  // Pending visits, popped in document order: [node, parent card, depth, port row].
  const sn: JNode[] = [root];
  const sp: number[] = [-1];
  const sd: number[] = [0];
  const sr: number[] = [-1];

  const visit = (n: JNode, pc: number, d: number, pr: number) => {
    const c = node.length;
    node.push(n);
    parent.push(pc);
    depth.push(d);
    portRow.push(pr);
    rowStart.push(rowNode.length);
    if (pr >= 0) rowChild.a[pr] = c;
    if (d > maxDepth) maxDepth = d;
    let labelCols = 0;
    let valueCols = 0;
    let ports = false;
    let isBus = false;
    let nk = 0;
    if (n.t < ARR) {
      // A primitive root: one row with its value.
      rowNode.push(n);
      rowChild.push(-1);
      valueText(n, false);
      valueCols = fitCols;
    } else {
      const list = n.v as JNode[];
      for (let i = 0; i < list.length; i++) if (nested(list[i])) nk++;
      isBus = nk > G.portMax || (n.t === ARR && nk === list.length);
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        const deep = nested(k);
        if (deep && isBus) continue;
        rowNode.push(k);
        rowChild.push(-1);
        labelText(k, false);
        if (fitCols > labelCols) labelCols = fitCols;
        valueText(k, false);
        if (fitCols > valueCols) valueCols = fitCols;
        if (deep) ports = true;
      }
      // Children, pushed last-first so they pop in order. Without a bus every entry has a row.
      const first = rowStart.a[c];
      for (let i = list.length - 1; i >= 0; i--) {
        const k = list[i];
        if (!nested(k)) continue;
        sn.push(k);
        sp.push(c);
        sd.push(d + 1);
        sr.push(isBus ? -1 : first + i);
      }
    }
    busArr.push(isBus ? 1 : 0);
    kidsN.push(nk);
    const rows = rowNode.length - rowStart.a[c];
    headText(n, false);
    const headCols = fitCols + (n.t >= ARR ? 1 + sizeText(n).length : 0);
    const lw = labelCols * charW;
    const body = rows ? G.padX + (lw ? lw + G.gap : 0) + valueCols * charW + G.padX + (ports ? G.port : 0) : 0;
    const head = G.padX + headCols * charW + G.padX + (isBus ? G.port : 0);
    labelW.push(lw);
    w.push(Math.ceil(Math.max(G.minW, body, head)));
    h.push(G.head + (rows ? rows * G.row + G.padY : 0));
  };

  return (deadline: number) => {
    let i = 0;
    while (sn.length) {
      const n = sn.pop() as JNode;
      visit(n, sp.pop() as number, sd.pop() as number, sr.pop() as number);
      if ((++i & 1023) === 0 && performance.now() > deadline) return null;
    }
    const n = node.length;
    rowStart.push(rowNode.length);
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
      bus: Uint8Array.from(busArr),
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
