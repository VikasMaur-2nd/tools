// Pure line bookkeeping for the editor: line starts, the widest line (in
// columns, tabs expanded), and the per-line facts that decide fold structure.
// The full computations run on loads; patchLines updates the same state for
// a bounded edit in time proportional to the edit (plus an O(lines) shift).

/** Must match `tab-size` in CSS. */
export const TAB = 4;

/** Text read by offset: a string, or the editor's document (see Doc). */
export interface Chars {
  readonly length: number;
  charCodeAt(i: number): number;
  /** (A Doc stops searching at `to`; a string searches on.) */
  indexOf(s: string, from?: number, to?: number): number;
}

/** End (exclusive, before the '\n') of line `ln`. */
export const lineEndIn = (ls: number[], len: number, ln: number) => (ln + 1 < ls.length ? ls[ln + 1] - 1 : len);

/** Line holding offset `off`. */
export function lineOfIn(ls: number[], off: number) {
  let lo = 0;
  let hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Columns of t[s, e) with tabs expanded to TAB stops (equals e - s without tabs). */
export function lineWidth(t: Chars, s: number, e: number) {
  let tab = t.indexOf('\t', s, e);
  if (tab === -1 || tab >= e) return e - s;
  // Tab to tab with the native search: a huge line costs its tabs, not its characters.
  let col = tab - s;
  while (tab !== -1 && tab < e) {
    col += TAB - (col % TAB);
    const next = t.indexOf('\t', tab + 1, e);
    const end = next === -1 || next >= e ? e : next;
    col += end - tab - 1;
    tab = end < e ? next : -1;
  }
  return col;
}

/** Line starts of `t`, its widest line in columns, and whether it has a tab. */
export function lineStarts(t: string) {
  const ls = [0];
  let max = 0;
  let prev = 0;
  for (let p = t.indexOf('\n'); p !== -1; p = t.indexOf('\n', p + 1)) {
    if (p - prev > max) max = p - prev;
    ls.push(p + 1);
    prev = p + 1;
  }
  if (t.length - prev > max) max = t.length - prev;
  const tabs = t.indexOf('\t') !== -1;
  if (max && tabs) max = maxWidth(t, ls);
  return { ls, max, tabs };
}

/** Widest line of `t` in columns. */
export function maxWidth(t: Chars, ls: number[]) {
  let max = 0;
  // The next tab, found once for all the lines before it (a search per line could run to the end each time).
  let tab = t.indexOf('\t', 0);
  for (let ln = 0; ln < ls.length; ln++) {
    const s = ls[ln];
    const e = lineEndIn(ls, t.length, ln);
    if (tab !== -1 && tab < s) tab = t.indexOf('\t', s);
    const w = tab === -1 || tab >= e ? e - s : lineWidth(t, s, e);
    if (w > max) max = w;
  }
  return max;
}

/** `ls.splice(at, del, ...items)`, without passing a long `items` as arguments (past the engine's limit that throws). */
function splice(ls: number[], at: number, del: number, items: number[]) {
  if (items.length < 4096) {
    ls.splice(at, del, ...items);
    return;
  }
  const tail = ls.slice(at + del);
  ls.length = at;
  for (let i = 0; i < items.length; i++) ls.push(items[i]);
  for (let i = 0; i < tail.length; i++) ls.push(tail[i]);
}

/**
 * Updates `ls` (in place) and the widest-line width for `old`[a, b) replaced
 * by `ins` (giving `next`). Returns the new width, and the line range that
 * changed: lines [la, la + added] of `next` replace lines [la, lb] of `old`.
 * `widths: false` skips measuring (each costs its line) and returns `max` unchanged.
 * `tabs: false`: the text has no tabs (a line is as wide as it is long).
 */
export function patchLines(ls: number[], old: Chars, next: Chars, a: number, b: number, ins: string, max: number, widths = true, tabs = true) {
  const la = lineOfIn(ls, a);
  const lb = lineOfIn(ls, b);
  const width = (t: Chars, s: number, e: number) => (tabs ? lineWidth(t, s, e) : e - s);
  let oldMax = 0;
  for (let ln = la; widths && ln <= lb; ln++) {
    const w = width(old, ls[ln], lineEndIn(ls, old.length, ln));
    if (w > oldMax) oldMax = w;
  }
  const starts: number[] = [];
  for (let p = ins.indexOf('\n'); p !== -1; p = ins.indexOf('\n', p + 1)) starts.push(a + p + 1);
  const d = ins.length - (b - a);
  if (d) for (let i = lb + 1; i < ls.length; i++) ls[i] += d;
  if (lb > la || starts.length) splice(ls, la + 1, lb - la, starts);
  const added = starts.length;
  // Widths not wanted (soft wrap: lines are as wide as the view): `max` is then stale, the caller knows.
  if (!widths) return { max, la, lb, added };
  let newMax = 0;
  for (let ln = la; ln <= la + added; ln++) {
    const w = width(next, ls[ln], lineEndIn(ls, next.length, ln));
    if (w > newMax) newMax = w;
  }
  // The widest line was among the edited ones and every replacement is narrower: rescan.
  const most = oldMax < max || newMax >= max ? Math.max(max, newMax) : tabs ? maxWidth(next, ls) : widest(ls, next.length);
  return { max: most, la, lb, added };
}

/** Widest line by line starts alone (no tabs). */
export function widest(ls: number[], len: number) {
  let max = 0;
  for (let ln = 0; ln < ls.length; ln++) max = Math.max(max, lineEndIn(ls, len, ln) - ls[ln]);
  return max;
}

/**
 * The facts about line t[s, e) that scanFolds reads: blank / comment, opens
 * with a closer, ends with an opener, is only a closer (`}` or `},`). Two
 * lines with equal signatures play the same part in the fold structure.
 */
export function foldSig(t: Chars, s: number, e: number) {
  let a = s;
  while (a < e && (t.charCodeAt(a) === 32 || t.charCodeAt(a) === 9)) a++;
  if (a === e) return 0;
  const first = t.charCodeAt(a);
  if (first === 47 && t.charCodeAt(a + 1) === 47) return 0;
  let b = e - 1;
  while (b > a && (t.charCodeAt(b) === 32 || t.charCodeAt(b) === 9 || t.charCodeAt(b) === 13)) b--;
  const closer = first === 125 || first === 93;
  const only = b === a || (b === a + 1 && t.charCodeAt(b) === 44);
  const last = t.charCodeAt(b);
  const opener = (last === 123 || last === 91) && !(b === a && closer);
  return 1 | (closer ? 2 : 0) | (only ? 4 : 0) | (opener ? 8 : 0);
}

/** Fold structure: for each line, the line its block closes on (-1 if none) and its depth. */
export function scanFolds(t: Chars, ls: number[]) {
  const n = ls.length;
  const close = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const sig = foldSig(t, ls[i], lineEndIn(ls, t.length, i));
    if (!sig) continue;
    if (sig & 2 && stack.length) {
      const o = stack.pop() as number;
      if (i > o + 1 && sig & 4) close[o] = i;
    }
    if (sig & 8) {
      depth[i] = stack.length;
      stack.push(i);
    }
  }
  return { close, depth };
}

/**
 * The fold structure after lines [la, lb] became lines [la, la + added], all
 * of them neither opening nor closing a block (foldSig without 2 or 8): the
 * blocks are the same, the lines after the edit only move. Blocks around the
 * edit keep 3+ lines (they hold the edited lines and their own two).
 */
export function shiftFoldLines(close: Int32Array, depth: Int32Array, la: number, lb: number, added: number) {
  const d = added - (lb - la);
  if (!d) return { close, depth };
  const n = close.length + d;
  const c = new Int32Array(n);
  const dp = new Int32Array(n);
  c.set(close.subarray(0, la + 1));
  dp.set(depth.subarray(0, la + 1));
  c.fill(-1, la + 1, la + added + 1);
  c.set(close.subarray(lb + 1), la + added + 1);
  dp.set(depth.subarray(lb + 1), la + added + 1);
  // (No block closes on an edited line: every one closing after line la closes after lb.)
  for (let i = 0; i < n; i++) if (c[i] > la) c[i] += d;
  return { close: c, depth: dp };
}
