/**
 * Line diff for the Compare panel's "Diff" view.
 *
 * - `canonLines` serializes a parsed document exactly like
 *   `stringify(root, '  ', sortKeys)`, but line by line and recording the
 *   source offset each line comes from, so a row of the diff of the canonical
 *   texts can reveal its node in the user's own (differently formatted) text.
 * - `diffLines` is a patience diff: lines that occur exactly once on both sides
 *   anchor the alignment (longest increasing subsequence) and the gaps between
 *   anchors are diffed again; gaps without such a line (brackets, repeated
 *   values) use Myers' O(ND) linear-space algorithm shared with the structural
 *   diff. Work is capped: past the budget the remaining gaps become removals +
 *   additions, so even 100k-line documents finish in tens of milliseconds.
 *   Changed groups are then slid to the most natural spot for JSON (a whole
 *   block, starting at the lowest indentation), like git's indent heuristic.
 * - `pairLines` + `wordDiff` emphasize what changed inside a modified line.
 * - `buildRows` turns hunks into the virtualized view model (context lines,
 *   collapsed unchanged regions, unified or side-by-side rows).
 */

import { BOOL, NUL, NUM, OBJ, STR, kids, type JNode } from '../json/parser';
import { quote } from '../json/format';
import { align } from './diff';

// ── Canonical lines ──────────────────────────────────────────────────────

export interface Canon {
  lines: string[];
  /** Source offset per line: the node it starts (closing-bracket lines: the bracket). */
  offs: Int32Array;
}

const byKey = (x: JNode, y: JNode) => {
  const p = x.key as string;
  const q = y.key as string;
  return p < q ? -1 : p > q ? 1 : 0;
};

/** `stringify(root, indent, sortKeys).split('\n')`, plus where each line came from. */
export function canonLines(root: JNode, sortKeys = false, indent = '  '): Canon {
  const lines: string[] = [];
  const offs: number[] = [];
  const pads = [''];
  const w = (n: JNode, d: number, head: string, tail: string) => {
    let text: string;
    switch (n.t) {
      case NUL:
        text = 'null';
        break;
      case BOOL:
        text = n.v ? 'true' : 'false';
        break;
      case NUM:
        text = n.v as string;
        break;
      case STR:
        text = quote(n.v as string);
        break;
      default: {
        let list = kids(n);
        const obj = n.t === OBJ;
        if (!list.length) {
          text = obj ? '{}' : '[]';
          break;
        }
        if (obj && sortKeys) list = list.slice().sort(byKey);
        const pad = pads[d + 1] ?? (pads[d + 1] = pads[d] + indent);
        lines.push(head + (obj ? '{' : '['));
        offs.push(n.s);
        const last = list.length - 1;
        for (let i = 0; i <= last; i++) w(list[i], d + 1, obj ? pad + quote(list[i].key as string) + ': ' : pad, i < last ? ',' : '');
        lines.push(pads[d] + (obj ? '}' : ']') + tail);
        offs.push(Math.max(n.s, n.e - 1));
        return;
      }
    }
    lines.push(head + text + tail);
    offs.push(n.s);
  };
  w(root, 0, '', '');
  return { lines, offs: Int32Array.from(offs) };
}

// ── Line diff ────────────────────────────────────────────────────────────

/** A changed region: lines a[a0, a1) were replaced by b[b0, b1). Lines between hunks are equal. */
export interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

export interface LineDiff {
  hunks: Hunk[];
  added: number;
  removed: number;
  /** False when the work budget ran out (the diff is still valid, just not minimal). */
  exact: boolean;
}

/** Total work units (≈ line visits) before falling back; ≈ 30–60 ms. */
const WORK = 3e7;
/** Work cap of one Myers run. */
const MYERS = 4e6;
/** Myers window (lines per side) for large gaps without anchors. */
const WIN = 1024;
/** Lines of a window's edit script that are kept (its tail is redone in the next window). */
const KEEP = 768;

/** Longest strictly increasing subsequence of `v` (indices, ascending). */
function lis(v: readonly number[]): number[] {
  const tails: number[] = [];
  const prev = new Int32Array(v.length);
  for (let x = 0; x < v.length; x++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (v[tails[mid]] < v[x]) lo = mid + 1;
      else hi = mid;
    }
    prev[x] = lo ? tails[lo - 1] : -1;
    tails[lo] = x;
  }
  const out: number[] = [];
  for (let x = tails.length ? tails[tails.length - 1] : -1; x >= 0; x = prev[x]) out.push(x);
  return out.reverse();
}

/** Line diff of `a` → `b`. */
export function diffLines(a: readonly string[], b: readonly string[], budget = WORK): LineDiff {
  const na = a.length;
  const nb = b.length;
  const ids = new Map<string, number>();
  const intern = (src: readonly string[]) => {
    const t = new Int32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      let v = ids.get(src[i]);
      if (v === undefined) ids.set(src[i], (v = ids.size));
      t[i] = v;
    }
    return t;
  };
  const ta = intern(a);
  const tb = intern(b);
  const ca = new Uint8Array(na);
  const cb = new Uint8Array(nb);
  // per line id: index if seen once in the current range, -2 if repeated, -1 unseen
  const ua = new Int32Array(ids.size).fill(-1);
  const ub = new Int32Array(ids.size).fill(-1);
  const ea: number[] = [];
  const eb: number[] = [];
  let work = 0;
  let exact = true;

  const st = [0, na, 0, nb];
  while (st.length) {
    const top = st.length - 4;
    let a0 = st[top];
    let a1 = st[top + 1];
    let b0 = st[top + 2];
    let b1 = st[top + 3];
    st.length = top;
    while (a0 < a1 && b0 < b1 && ta[a0] === tb[b0]) {
      a0++;
      b0++;
    }
    while (a0 < a1 && b0 < b1 && ta[a1 - 1] === tb[b1 - 1]) {
      a1--;
      b1--;
    }
    if (a0 === a1 || b0 === b1 || work > budget) {
      if (a0 < a1 && b0 < b1) exact = false;
      ca.fill(1, a0, a1);
      cb.fill(1, b0, b1);
      continue;
    }
    work += 3 * (a1 - a0 + b1 - b0);
    for (let i = a0; i < a1; i++) ua[ta[i]] = ua[ta[i]] === -1 ? i : -2;
    for (let j = b0; j < b1; j++) ub[tb[j]] = ub[tb[j]] === -1 ? j : -2;
    const ci: number[] = [];
    const cj: number[] = [];
    let common = 0;
    for (let i = a0; i < a1; i++) {
      const t = ta[i];
      const u = ub[t];
      if (u === -1) continue;
      common++;
      if (ua[t] === i && u >= 0) {
        ci.push(i);
        cj.push(u);
      }
    }
    for (let i = a0; i < a1; i++) ua[ta[i]] = -1;
    for (let j = b0; j < b1; j++) ub[tb[j]] = -1;

    if (ci.length) {
      let pa = a0;
      let pb = b0;
      for (const x of lis(cj)) {
        if (pa < ci[x] || pb < cj[x]) st.push(pa, ci[x], pb, cj[x]);
        pa = ci[x] + 1;
        pb = cj[x] + 1;
      }
      if (pa < a1 || pb < b1) st.push(pa, a1, pb, b1);
      continue;
    }
    if (!common) {
      ca.fill(1, a0, a1);
      cb.fill(1, b0, b1);
      continue;
    }

    // No line occurs once on both sides (brackets, repeated values): Myers,
    // in overlapping windows when the gap is large.
    let x = a0;
    let y = b0;
    while (x < a1 && y < b1 && work <= budget) {
      const xe = Math.min(a1, x + WIN);
      const ye = Math.min(b1, y + WIN);
      const last = (a1 - x) * (b1 - y) <= 4 * WIN * WIN;
      const ex = last ? a1 : xe;
      const ey = last ? b1 : ye;
      const cap = Math.max(1, Math.min(MYERS, budget - work));
      ea.length = 0;
      eb.length = 0;
      const spent = align(ta.subarray(x, ex), tb.subarray(y, ey), ea, eb, cap);
      work += spent + ex - x + ey - y;
      if (spent > cap) exact = false;
      // keep what the window's far end can't have distorted: up to the last match before KEEP
      let end = ea.length;
      if (!last) {
        end = 0;
        for (let k = 0; k < ea.length; k++) if (ea[k] >= 0 && eb[k] >= 0 && (ea[k] < KEEP || eb[k] < KEEP)) end = k + 1;
        if (!end) {
          exact = false;
          ca.fill(1, x, x + KEEP);
          cb.fill(1, y, y + KEEP);
          x += KEEP;
          y += KEEP;
          continue;
        }
      }
      let nx = x;
      let ny = y;
      for (let k = 0; k < end; k++) {
        if (eb[k] < 0) ca[x + ea[k]] = 1;
        else if (ea[k] < 0) cb[y + eb[k]] = 1;
        else {
          nx = x + ea[k] + 1;
          ny = y + eb[k] + 1;
        }
      }
      if (last) {
        x = a1;
        y = b1;
      } else {
        x = nx;
        y = ny;
      }
    }
    if (x < a1 && y < b1) exact = false;
    if (x < a1) ca.fill(1, x, a1);
    if (y < b1) cb.fill(1, y, b1);
  }

  slideAll(ta, tb, a, b, ca, cb);

  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  for (let i = 0, j = 0; i < na || j < nb; ) {
    if ((i < na && ca[i]) || (j < nb && cb[j])) {
      const a0 = i;
      const b0 = j;
      while (i < na && ca[i]) i++;
      while (j < nb && cb[j]) j++;
      hunks.push({ a0, a1: i, b0, b1: j });
      removed += i - a0;
      added += j - b0;
    } else {
      i++;
      j++;
    }
  }
  return { hunks, added, removed, exact };
}

/** How unnatural a changed block looks (lower = better): starts deep or with a closer, ends with an opener. */
function shape(first: string, last: string): number {
  let ind = 0;
  while (first.charCodeAt(ind) === 32) ind++;
  const f = first.charCodeAt(ind);
  const l = last.charCodeAt(last.length - 1);
  return 2 * ind + (f === 125 || f === 93 ? 1 : 0) + (l === 123 || l === 91 ? 1 : 0);
}

/**
 * Slides the pure insertion / removal group [g0, g1) of one side (other side
 * at position `o`) to its best equivalent position. Returns the shift.
 */
function slide(t: Int32Array, lines: readonly string[], c: Uint8Array, oc: Uint8Array, g0: number, g1: number, o: number): number {
  let up = 0;
  while (g0 - up > 0 && o - up > 0 && !c[g0 - up - 1] && !oc[o - up - 1] && t[g0 - up - 1] === t[g1 - up - 1]) up++;
  let dn = 0;
  while (g1 + dn < t.length && o + dn < oc.length && !c[g1 + dn] && !oc[o + dn] && t[g0 + dn] === t[g1 + dn]) dn++;
  if (!up && !dn) return 0;
  let best = 0;
  let cost = Infinity;
  for (let d = -up; d <= dn; d++) {
    const s = shape(lines[g0 + d], lines[g1 + d - 1]);
    if (s <= cost) {
      cost = s;
      best = d;
    }
  }
  if (best) {
    c.fill(0, g0, g1);
    c.fill(1, g0 + best, g1 + best);
  }
  return best;
}

function slideAll(ta: Int32Array, tb: Int32Array, a: readonly string[], b: readonly string[], ca: Uint8Array, cb: Uint8Array) {
  const na = ta.length;
  const nb = tb.length;
  for (let i = 0, j = 0; i < na || j < nb; ) {
    if ((i < na && ca[i]) || (j < nb && cb[j])) {
      const i0 = i;
      const j0 = j;
      while (i < na && ca[i]) i++;
      while (j < nb && cb[j]) j++;
      const d = i0 === i ? slide(tb, b, cb, ca, j0, j, i) : j0 === j ? slide(ta, a, ca, cb, i0, i, j) : 0;
      i += d;
      j += d;
    } else {
      i++;
      j++;
    }
  }
}

// ── Modified-line pairing and word emphasis ──────────────────────────────

/** 0…1 likeness of two lines from their common prefix / suffix (indentation excluded). */
export function similarity(x: string, y: string): number {
  const lx = x.length;
  const ly = y.length;
  let ws = 0;
  while (ws < lx && ws < ly && x.charCodeAt(ws) === 32 && y.charCodeAt(ws) === 32) ws++;
  let p = ws;
  while (p < lx && p < ly && x.charCodeAt(p) === y.charCodeAt(p)) p++;
  let s = 0;
  const lim = Math.min(lx, ly) - p;
  while (s < lim && x.charCodeAt(lx - 1 - s) === y.charCodeAt(ly - 1 - s)) s++;
  const den = Math.max(lx, ly) - ws;
  if (!den) return 1;
  let r = (p - ws + s) / den;
  // same property name: a changed value, however different
  if (r < 0.5 && x.charCodeAt(ws) === 34) {
    const k = x.indexOf('": ', ws + 1);
    if (k > 0 && p > k + 2) r = 0.5;
  }
  return r;
}

export interface Pairs {
  /** Partner line in `b` of each line of `a` (-1 = none), and vice versa. */
  pa: Int32Array;
  pb: Int32Array;
}

/** Pairs the removed and added lines of each hunk that are edits of each other (in order). */
export function pairLines(a: readonly string[], b: readonly string[], hunks: readonly Hunk[]): Pairs {
  const pa = new Int32Array(a.length).fill(-1);
  const pb = new Int32Array(b.length).fill(-1);
  for (const h of hunks) {
    let j = h.b0;
    for (let i = h.a0; i < h.a1 && j < h.b1; i++) {
      const end = Math.min(h.b1, j + 8);
      let best = -1;
      let bs = 0.5;
      for (let k = j; k < end; k++) {
        const s = similarity(a[i], b[k]);
        if (s >= bs && (best < 0 || s > bs)) {
          bs = s;
          best = k;
        }
      }
      if (best >= 0) {
        pa[i] = best;
        pb[best] = i;
        j = best + 1;
      }
    }
  }
  return { pa, pb };
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;
const isNum = (c: number) => isDigit(c) || c === 46 || c === 101 || c === 69 || c === 43 || c === 45;

/** Token boundaries of a JSON-ish line: whitespace runs, numbers, words, escapes, single punctuation. */
export function tokenize(s: string): number[] {
  const out = [0];
  const n = s.length;
  for (let i = 0; i < n; ) {
    const c = s.charCodeAt(i);
    let j = i + 1;
    if (c === 32 || c === 9) while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    else if (isDigit(c) || (c === 45 && isDigit(s.charCodeAt(j)))) while (j < n && isNum(s.charCodeAt(j))) j++;
    else if (isWord(c)) while (j < n && isWord(s.charCodeAt(j))) j++;
    else if (c === 92) j = Math.min(n, i + (s.charCodeAt(j) === 117 ? 6 : 2));
    out.push((i = j));
  }
  return out;
}

/** Lines longer than this get character-level (common prefix / suffix) emphasis only. */
const MAX_WORD = 4000;

const blank = (s: string, a: number, b: number) => {
  for (let i = a; i < b; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
};

/**
 * What changed between two versions of a line, as flat `[start, end, …]`
 * ranges on each side. Token-level LCS; changed tokens separated only by
 * whitespace merge into one range.
 */
export function wordDiff(x: string, y: string): [number[], number[]] {
  const lx = x.length;
  const ly = y.length;
  if (lx > MAX_WORD || ly > MAX_WORD) {
    let p = 0;
    while (p < lx && p < ly && x.charCodeAt(p) === y.charCodeAt(p)) p++;
    let s = 0;
    const lim = Math.min(lx, ly) - p;
    while (s < lim && x.charCodeAt(lx - 1 - s) === y.charCodeAt(ly - 1 - s)) s++;
    return [p < lx - s ? [p, lx - s] : [], p < ly - s ? [p, ly - s] : []];
  }
  const bx = tokenize(x);
  const by = tokenize(y);
  const ids = new Map<string, number>();
  const intern = (src: string, bd: number[]) => {
    const t = new Int32Array(bd.length - 1);
    for (let k = 0; k < t.length; k++) {
      const w = src.slice(bd[k], bd[k + 1]);
      let v = ids.get(w);
      if (v === undefined) ids.set(w, (v = ids.size));
      t[k] = v;
    }
    return t;
  };
  const tx = intern(x, bx);
  const ty = intern(y, by);
  const ea: number[] = [];
  const eb: number[] = [];
  align(tx, ty, ea, eb, 2e5);
  const rx: number[] = [];
  const ry: number[] = [];
  const add = (r: number[], src: string, s: number, e: number) => {
    if (r.length && blank(src, r[r.length - 1], s)) r[r.length - 1] = e;
    else r.push(s, e);
  };
  for (let k = 0; k < ea.length; k++) {
    if (eb[k] < 0) add(rx, x, bx[ea[k]], bx[ea[k] + 1]);
    else if (ea[k] < 0) add(ry, y, by[eb[k]], by[eb[k] + 1]);
  }
  return [rx, ry];
}

// ── View rows ────────────────────────────────────────────────────────────

/** Unchanged line (both sides). */
export const ROW_EQ = 0;
/** Unified: removed line. */
export const ROW_DEL = 1;
/** Unified: added line. */
export const ROW_ADD = 2;
/** Side by side: removed (left) and / or added (right) line; -1 = blank filler. */
export const ROW_MOD = 3;
/** Collapsed unchanged lines. */
export const ROW_GAP = 4;

export interface Row {
  k: number;
  /** Line index on each side (-1 = none). Gap: first hidden line. */
  a: number;
  b: number;
  /** Line to reveal on each side (where the change sits when the row has no line there). */
  ja: number;
  jb: number;
  /** Gap: hidden line count. */
  n: number;
}

/** Context lines kept around each hunk; longer unchanged runs collapse. */
export const CONTEXT = 3;

/**
 * Rows for a diff of `na` → `nb` lines. Unchanged runs longer than
 * 2 × `ctx` collapse into one gap row (keyed by its first hidden left line)
 * unless that key is in `open`.
 */
export function buildRows(d: LineDiff, na: number, nb: number, pairs: Pairs, open: ReadonlySet<number>, split: boolean, ctx = CONTEXT): Row[] {
  const rows: Row[] = [];
  const clA = (i: number) => Math.max(0, Math.min(i, na - 1));
  const clB = (j: number) => Math.max(0, Math.min(j, nb - 1));
  const push = (k: number, a: number, b: number, ja: number, jb: number) => rows.push({ k, a, b, ja, jb, n: 0 });
  const same = (a: number, b: number, n: number, first: boolean, last: boolean) => {
    const head = first ? 0 : ctx;
    const hide = n - head - (last ? 0 : ctx);
    let k = 0;
    if (n > 2 * ctx && hide > 1 && !open.has(a + head)) {
      for (; k < head; k++) push(ROW_EQ, a + k, b + k, a + k, b + k);
      rows.push({ k: ROW_GAP, a: a + head, b: b + head, ja: a + head, jb: b + head, n: hide });
      k += hide;
    }
    for (; k < n; k++) push(ROW_EQ, a + k, b + k, a + k, b + k);
  };
  const { pa } = pairs;
  let i = 0;
  let j = 0;
  for (const h of d.hunks) {
    same(i, j, h.a0 - i, i === 0 && j === 0, false);
    if (!split) {
      for (let x = h.a0; x < h.a1; x++) push(ROW_DEL, x, -1, x, clB(h.b0));
      for (let y = h.b0; y < h.b1; y++) push(ROW_ADD, -1, y, clA(h.a0), y);
    } else {
      // unpaired lines side by side, then the next pair on one row
      let x = h.a0;
      let y = h.b0;
      while (x < h.a1 || y < h.b1) {
        let px = x;
        while (px < h.a1 && pa[px] < 0) px++;
        const py = px < h.a1 ? pa[px] : h.b1;
        for (let k = 0, m = Math.max(px - x, py - y); k < m; k++) {
          const u = x + k < px ? x + k : -1;
          const v = y + k < py ? y + k : -1;
          push(ROW_MOD, u, v, u < 0 ? clA(px) : u, v < 0 ? clB(py) : v);
        }
        if (px < h.a1) push(ROW_MOD, px, py, px, py);
        x = px + 1;
        y = py + 1;
      }
    }
    i = h.a1;
    j = h.b1;
  }
  same(i, j, na - i, i === 0 && j === 0, true);
  return rows;
}
