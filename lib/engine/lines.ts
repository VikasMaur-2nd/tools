// Pure line bookkeeping for the editor: line starts, the widest line (in
// columns, tabs expanded), and the per-line facts that decide fold structure.
// The full computations run on loads; patchLines updates the same state for
// a bounded edit in time proportional to the edit (plus an O(lines) shift).

/** Must match `tab-size` in CSS. */
export const TAB = 4;

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
export function lineWidth(t: string, s: number, e: number) {
  const tab = t.indexOf('\t', s);
  if (tab === -1 || tab >= e) return e - s;
  let col = tab - s;
  for (let i = tab; i < e; i++) col = t.charCodeAt(i) === 9 ? col + TAB - (col % TAB) : col + 1;
  return col;
}

/** Line starts of `t` and its widest line in columns. */
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
  if (max && t.indexOf('\t') !== -1) max = maxWidth(t, ls);
  return { ls, max };
}

/** Widest line of `t` in columns. */
export function maxWidth(t: string, ls: number[]) {
  let max = 0;
  for (let ln = 0; ln < ls.length; ln++) {
    const w = lineWidth(t, ls[ln], lineEndIn(ls, t.length, ln));
    if (w > max) max = w;
  }
  return max;
}

/**
 * Updates `ls` (in place) and the widest-line width for `old`[a, b) replaced
 * by `ins` (giving `next`). Returns the new width, and the line range that
 * changed: lines [la, la + added] of `next` replace lines [la, lb] of `old`.
 */
export function patchLines(ls: number[], old: string, next: string, a: number, b: number, ins: string, max: number) {
  const la = lineOfIn(ls, a);
  const lb = lineOfIn(ls, b);
  let oldMax = 0;
  for (let ln = la; ln <= lb; ln++) {
    const w = lineWidth(old, ls[ln], lineEndIn(ls, old.length, ln));
    if (w > oldMax) oldMax = w;
  }
  const starts: number[] = [];
  for (let p = ins.indexOf('\n'); p !== -1; p = ins.indexOf('\n', p + 1)) starts.push(a + p + 1);
  const d = ins.length - (b - a);
  if (d) for (let i = lb + 1; i < ls.length; i++) ls[i] += d;
  if (lb > la || starts.length) ls.splice(la + 1, lb - la, ...starts);
  const added = starts.length;
  let newMax = 0;
  for (let ln = la; ln <= la + added; ln++) {
    const w = lineWidth(next, ls[ln], lineEndIn(ls, next.length, ln));
    if (w > newMax) newMax = w;
  }
  // The widest line was among the edited ones and every replacement is narrower: rescan.
  const width = oldMax < max || newMax >= max ? Math.max(max, newMax) : maxWidth(next, ls);
  return { max: width, la, lb, added };
}

/**
 * The facts about line t[s, e) that scanFolds reads: blank / comment, opens
 * with a closer, ends with an opener, is only a closer (`}` or `},`). Two
 * lines with equal signatures play the same part in the fold structure.
 */
export function foldSig(t: string, s: number, e: number) {
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
export function scanFolds(t: string, ls: number[]) {
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
