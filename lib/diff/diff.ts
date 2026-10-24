/**
 * Structural JSON diff over the lossless parser's node trees.
 *
 * - Objects are compared by key (key order optionally significant); duplicate
 *   keys follow JSON.parse semantics (the last one wins).
 * - Arrays are sequence-aware: elements are aligned with Myers' O((N+M)·D)
 *   linear-space LCS over structural hashes (or over id values when every
 *   element is an object with a unique `id` / `_id` / `uuid` / `key` / `name`),
 *   so one inserted element doesn't mark everything after it as changed.
 *   Unaligned runs are then paired by similarity, so an edited element shows up
 *   as field-level changes instead of a removal plus an addition. The LCS work
 *   is capped; past the cap it falls back to patience-style anchoring
 *   (unique elements + LIS, O(n log n)).
 * - With `ignoreArrayOrder`, arrays are compared as multisets (by id or hash).
 * - Numbers are compared by exact decimal value from their source text
 *   (`1.0` = `1`, `1e2` = `100`, big integers / long decimals never lose
 *   precision).
 *
 * The output is a flat change list in document order. Every change also
 * carries a JSON Pointer that is valid when the changes are applied in list
 * order, which makes RFC 6902 patch generation trivial (see patch.ts).
 */

import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { parsePath, type Seg } from '../json/path';

export type { Seg };

export type DiffKind = 'added' | 'removed' | 'changed' | 'type';

export interface DiffOptions {
  /** Compare objects by key, ignoring property order (default true). */
  ignoreKeyOrder?: boolean;
  /** Compare arrays as multisets (default false). */
  ignoreArrayOrder?: boolean;
  /**
   * Paths to skip. `$.meta.updatedAt`, `$.items[*].ts`, `/a/b` (JSON Pointer)
   * are absolute; a bare key or relative path (`updatedAt`, `meta.etag`,
   * `$..etag`) matches at any depth. `*` matches any key or index.
   */
  ignorePaths?: readonly string[];
  /** Compare strings case-insensitively (default false). */
  caseInsensitiveStrings?: boolean;
  /** Stop after this many changes (default 100 000); sets `truncated`. */
  maxChanges?: number;
  /** Hash seed (default random per run, so collisions can't be precomputed). Fixed for prerendered output. */
  seed?: number;
}

export interface Change {
  kind: DiffKind;
  /**
   * Display path. Array indices are left-side indices, except for an added
   * element itself, whose last segment is its right-side index.
   */
  path: Seg[];
  /** Node in the left document (removed / changed / type). */
  left?: JNode;
  /** Node in the right document (added / changed / type). */
  right?: JNode;
  /** 'added': the left container the node would be inserted into. */
  leftParent?: JNode;
  /** 'removed': the right container the node is missing from. */
  rightParent?: JNode;
  /**
   * JSON Pointer segments of this change when all changes are applied in list
   * order (`'-'` = append). Used to build RFC 6902 patches.
   */
  at: Seg[];
  /** Only the key order differs (kind 'changed', left/right are the objects; ignoreKeyOrder: false). */
  order?: boolean;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  type: number;
  total: number;
}

export interface DiffResult {
  changes: Change[];
  summary: DiffSummary;
  /** `maxChanges` was reached; `changes` is incomplete. */
  truncated: boolean;
  /** Set when the documents couldn't be compared (e.g. nesting too deep). */
  error: string | null;
}

// ── Numbers ──────────────────────────────────────────────────────────────

/**
 * Exact canonical form of a JSON number's text: digits without leading or
 * trailing zeros plus a decimal exponent (`1.50e3` → `15e2`, `100` → `1e2`,
 * `1.0` → `1`, `-0` → `0`). Two numbers are equal iff their forms are equal.
 */
export function canonNum(raw: string): string {
  const n = raw.length;
  let i = raw.charCodeAt(0) === 45 ? 1 : 0;
  const c0 = raw.charCodeAt(i);
  if (c0 >= 49 && c0 <= 57 && raw.charCodeAt(n - 1) !== 48) {
    // fast path: a plain integer without leading / trailing zeros
    for (i++; i < n; i++) {
      const c = raw.charCodeAt(i);
      if (c < 48 || c > 57) break;
    }
    if (i === n) return raw;
  }
  let s = raw;
  let neg = false;
  if (s[0] === '-' || s[0] === '+') {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  const ei = s.search(/[eE]/);
  let m = ei < 0 ? s : s.slice(0, ei);
  let off = 0;
  const dot = m.indexOf('.');
  if (dot >= 0) {
    off -= m.length - dot - 1;
    m = m.slice(0, dot) + m.slice(dot + 1);
  }
  let a = 0;
  let b = m.length;
  while (a < b && m.charCodeAt(a) === 48) a++;
  while (b > a && m.charCodeAt(b - 1) === 48) {
    b--;
    off++;
  }
  if (a === b) return '0';
  const exp = ei < 0 ? off : expPlus(s, ei + 1, off);
  return (neg ? '-' : '') + m.slice(a, b) + (exp ? 'e' + exp : '');
}

const MAX_EXP = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The exponent written at `raw[p…]` (optional sign, digits) plus `off`,
 * exactly: a number within ±(2^53 − 1), else its decimal text. Exponents of
 * up to 15 digits are read without allocating.
 */
function expPlus(raw: string, p: number, off: number): number | string {
  const n = raw.length;
  const c = raw.charCodeAt(p);
  const neg = c === 45;
  if (neg || c === 43) p++;
  while (p < n - 1 && raw.charCodeAt(p) === 48) p++;
  if (n - p <= 15) {
    let x = 0;
    for (; p < n; p++) x = x * 10 + raw.charCodeAt(p) - 48;
    return (neg ? -x : x) + off;
  }
  const t = BigInt((neg ? '-' : '') + raw.slice(p)) + BigInt(off);
  return t >= -MAX_EXP && t <= MAX_EXP ? Number(t) : t.toString();
}

// ── Hashing ──────────────────────────────────────────────────────────────

const fmix = (x: number) => {
  let h = x ^ (x >>> 16);
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
};

/*
 * Hashes are exact 52-bit integers held in a double: two independent 32-bit
 * lanes (the second truncated to 20 bits), so a false match between two
 * elements of 100k-element arrays stays around one in a million.
 */
const TWO32 = 4294967296;
const pack = (lo: number, hi: number) => (hi >>> 12) * TWO32 + (lo >>> 0);
const laneLo = (h: number) => h % TWO32 | 0;
const laneHi = (h: number) => (h / TWO32) | 0;

const strHash = (s: string, seed: number) => {
  let a = seed;
  let b = seed ^ 0x2545f491;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 15);
  }
  return pack(fmix(a ^ s.length), fmix(b + s.length));
};

/** Hash of a number's exact value (equal for `1.0`, `1`, `1e0`), without allocating unless its exponent has 16+ digits. */
export const numHash = (raw: string, seed: number) => {
  const n = raw.length;
  let i = 0;
  let a = seed;
  let b = seed ^ 0x2545f491;
  const c0 = raw.charCodeAt(0);
  if (c0 === 45 || c0 === 43) {
    if (c0 === 45) a = ~a;
    i = 1;
  }
  let e = i;
  while (e < n && (raw.charCodeAt(e) | 32) !== 101) e++;
  let dot = e;
  let first = -1;
  let last = -1;
  for (let p = i; p < e; p++) {
    const c = raw.charCodeAt(p);
    if (c === 46) dot = p;
    else if (c !== 48) {
      if (first < 0) first = p;
      last = p;
    }
  }
  if (first < 0) return pack(fmix(seed ^ 0x30), fmix(seed + 0x30)); // zero, whatever its sign
  for (let p = first; p <= last; p++) {
    const c = raw.charCodeAt(p);
    if (c === 46) continue;
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 15);
  }
  // decimal exponent of the last significant digit
  const off = last < dot ? dot - last - 1 : dot - last;
  const exp = e < n ? expPlus(raw, e + 1, off) : off;
  if (typeof exp === 'string') {
    // beyond ±2^53: its digits
    for (let p = -1; p < exp.length; p++) {
      const c = p < 0 ? 101 : exp.charCodeAt(p);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 15);
    }
    return pack(fmix(a), fmix(b));
  }
  // both 32-bit halves of the exponent count (exponents equal mod 2^32 must not collide)
  const lo = exp | 0;
  const hi = (exp - lo) / TWO32;
  a = Math.imul(a ^ hi, 0x01000193);
  b = Math.imul(b + hi, 0x5bd1e995) ^ (b >>> 15);
  return pack(fmix(a ^ Math.imul(lo, 0x27d4eb2f)), fmix(b + lo));
};

const H_NUL = pack(0x2f0b3c1d, 0x6c62272e);
const H_TRUE = pack(0x5be0cd19, 0x1b873593);
const H_FALSE = pack(0x1f83d9ab, 0x0b4b9e7f);
const S_NUM = 0x6a09e667 | 0;
const S_STR = 0x3c6ef372 | 0;
const S_KEY = 0x510e527f;
const S_ARR = 0x243f6a88;
const S_OBJ = 0x13198a2e;

// ── Ignore patterns ──────────────────────────────────────────────────────

interface Trie {
  end: boolean;
  kids: Map<string, Trie> | null;
  star: Trie | null;
}
/** Active pattern positions for a node; `null` = the node is ignored. */
type Ig = Trie[];
const NO: Ig = [];

const trie = (): Trie => ({ end: false, kids: null, star: null });

function addPattern(root: Trie, segs: Seg[]) {
  let t = root;
  for (const s of segs) {
    const k = String(s);
    let next: Trie | undefined;
    if (k === '*') next = t.star ?? (t.star = trie());
    else {
      if (!t.kids) t.kids = new Map();
      next = t.kids.get(k);
      if (!next) t.kids.set(k, (next = trie()));
    }
    t = next;
  }
  t.end = true;
}

/** Splits a free-text list of ignore paths (commas / newlines / semicolons). */
export function parseIgnoreList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (i < text.length) {
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '[') depth++;
      else if (c === ']') depth = Math.max(0, depth - 1);
      if (depth || (c !== ',' && c !== '\n' && c !== ';')) continue;
    }
    const s = text.slice(start, i).trim();
    if (s) out.push(s);
    start = i + 1;
  }
  return out;
}

function compileIgnore(list: readonly string[]): { abs: Trie | null; any: Trie | null } {
  let abs: Trie | null = null;
  let any: Trie | null = null;
  for (const raw of list) {
    let s = raw.trim();
    if (!s) continue;
    let anywhere = false;
    if (s.startsWith('$..')) {
      anywhere = true;
      s = s.slice(3);
    } else if (s.startsWith('..')) {
      anywhere = true;
      s = s.slice(2);
    } else if (s[0] !== '$' && s[0] !== '/') anywhere = true;
    s = s.replace(/\[\s*\*\s*\]/g, '.*');
    if (anywhere && s[0] === '.') s = s.slice(1);
    const segs = parsePath(s) ?? [s];
    if (!segs.length) continue;
    if (anywhere) addPattern(any ?? (any = trie()), segs);
    else addPattern(abs ?? (abs = trie()), segs);
  }
  return { abs, any };
}

// ── Diff ─────────────────────────────────────────────────────────────────

const ID_KEYS = ['id', '_id', 'uuid', 'key', 'name'];
const STOP = { stop: true };
const OVERFLOW = { overflow: true };

/** LCS work (diagonal steps) allowed per array, and per diff overall. */
const LCS_ARRAY_BUDGET = 8e6;
const LCS_TOTAL_BUDGET = 4e7;
/** Largest k×l gap paired by similarity (beyond: positional). */
const GAP_DP_MAX = 4096;

/** Last child with `key` (JSON.parse semantics for duplicate keys). */
function lastChild(list: JNode[], key: string): JNode | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].key === key) return list[i];
  return undefined;
}

function hasDupKeys(list: JNode[]): boolean {
  const n = list.length;
  if (n < 2) return false;
  if (n <= 12) {
    for (let i = 0; i < n; i++) {
      const k = list[i].key;
      for (let j = i + 1; j < n; j++) if (list[j].key === k) return true;
    }
    return false;
  }
  const set = new Set<string>();
  for (const c of list) {
    const k = c.key as string;
    if (set.has(k)) return true;
    set.add(k);
  }
  return false;
}

function keyMap(list: JNode[]): Map<string, JNode> {
  const m = new Map<string, JNode>();
  for (const c of list) m.set(c.key as string, c);
  return m;
}

class Differ {
  readonly changes: Change[] = [];
  readonly sum: DiffSummary = { added: 0, removed: 0, changed: 0, type: 0, total: 0 };
  private readonly path: Seg[] = [];
  private readonly at: Seg[] = [];
  private readonly hc = new Map<JNode, number>();
  private readonly keyFree: boolean;
  private readonly unordered: boolean;
  private readonly ci: boolean;
  private readonly max: number;
  private readonly anyRoot: Trie | null;
  private readonly ig: boolean;
  readonly root: Ig;
  private lcsLeft = LCS_TOTAL_BUDGET;
  /** Hash seed (see `DiffOptions.seed`). */
  private readonly salt: number;

  constructor(o: DiffOptions) {
    this.keyFree = o.ignoreKeyOrder ?? true;
    this.unordered = o.ignoreArrayOrder ?? false;
    this.ci = o.caseInsensitiveStrings ?? false;
    this.max = o.maxChanges ?? 100000;
    this.salt = o.seed ?? (Math.random() * TWO32) | 0;
    const { abs, any } = compileIgnore(o.ignorePaths ?? []);
    this.anyRoot = any;
    this.ig = !!(abs || any);
    this.root = abs ? [abs] : NO;
  }

  /** Ignore state of a child; `null` when the child is ignored. */
  step(st: Ig, key: string | number): Ig | null {
    if (!this.ig) return st;
    const k = typeof key === 'number' ? String(key) : key;
    let next = NO;
    const n = st.length;
    for (let i = 0; i <= n; i++) {
      const t = i < n ? st[i] : this.anyRoot;
      if (!t) continue;
      const c = t.kids?.get(k);
      if (c) {
        if (c.end) return null;
        if (next === NO) next = [c];
        else next.push(c);
      }
      const w = t.star;
      if (w) {
        if (w.end) return null;
        if (next === NO) next = [w];
        else next.push(w);
      }
    }
    return next;
  }

  private emit(kind: DiffKind, left: JNode | undefined, right: JNode | undefined, lp?: JNode, rp?: JNode, order?: boolean) {
    if (this.changes.length >= this.max) throw STOP;
    this.changes.push({
      kind,
      path: this.path.slice(),
      left,
      right,
      leftParent: lp,
      rightParent: rp,
      at: this.at.slice(),
      order,
    });
    this.sum[kind]++;
    this.sum.total++;
  }

  // ── equality & hashing ──

  private numEq(a: string, b: string): boolean {
    return a === b || canonNum(a) === canonNum(b);
  }

  private strEq(a: string, b: string): boolean {
    return a === b || (this.ci && a.toLowerCase() === b.toLowerCase());
  }

  /** Structural hash consistent with the options (equal values ⇒ equal hashes). */
  hash(n: JNode, ig: Ig): number {
    switch (n.t) {
      case NUL:
        return H_NUL;
      case BOOL:
        return n.v ? H_TRUE : H_FALSE;
      case NUM:
        return numHash(n.v as string, this.salt ^ S_NUM);
      case STR:
        return strHash(this.ci ? (n.v as string).toLowerCase() : (n.v as string), this.salt ^ S_STR);
    }
    // only array elements are looked up again later (when their array is aligned)
    const memoize = n.u !== null && n.u.t === ARR;
    if (memoize) {
      const memo = this.hc.get(n);
      if (memo !== undefined) return memo;
    }
    const list = kids(n);
    const isArr = n.t === ARR;
    const free = isArr ? this.unordered : this.keyFree;
    let a = free ? 0 : isArr ? S_ARR : S_OBJ;
    let b = a ^ 0x7f4a7c15;
    let cnt = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const s = this.step(ig, isArr ? i : (c.key as string));
      if (!s) continue;
      const h = this.hash(c, s);
      let x = laneLo(h);
      let y = laneHi(h);
      if (!isArr) {
        const kh = strHash(c.key as string, this.salt ^ S_KEY);
        x = fmix(laneLo(kh) + Math.imul(x, 0x9e3779b1));
        y = fmix(laneHi(kh) + Math.imul(y, 0x85ebca6b));
      }
      if (free) {
        a = (a + fmix(x)) | 0;
        b = (b + fmix(y ^ 0x27d4eb2f)) | 0;
      } else {
        a = (Math.imul(a ^ x, 0x01000193) + 0x9e3779b9) | 0;
        b = (Math.imul(b ^ y, 0x5bd1e995) + 0x165667b1) | 0;
      }
      cnt++;
    }
    const h = pack(fmix(a ^ Math.imul(cnt, 0x27d4eb2f)), fmix(b + cnt));
    if (memoize) this.hc.set(n, h);
    return h;
  }

  // ── comparison ──

  cmp(l: JNode, r: JNode, il: Ig, ir: Ig) {
    if (l.t !== r.t || l.t < ARR) this.leaf(l, r);
    else if (l.t === OBJ) this.obj(l, r, il, ir);
    else this.arr(l, r, il, ir);
  }

  /** Compares a type mismatch or two primitives (never recurses). */
  private leaf(l: JNode, r: JNode) {
    if (l.t !== r.t) this.emit('type', l, r);
    else if (l.t === BOOL ? l.v !== r.v : l.t === STR ? !this.strEq(l.v as string, r.v as string) : l.t === NUM && !this.numEq(l.v as string, r.v as string)) {
      this.emit('changed', l, r);
    }
  }

  private obj(l: JNode, r: JNode, il: Ig, ir: Ig) {
    const a = kids(l);
    const b = kids(r);
    const n = a.length;
    if (n === b.length) {
      // fast path: identical key sequences (the overwhelmingly common case)
      let same = true;
      for (let i = 0; i < n; i++) {
        if (a[i].key !== b[i].key) {
          same = false;
          break;
        }
      }
      if (same && !hasDupKeys(a)) {
        for (let i = 0; i < n; i++) {
          const k = a[i].key as string;
          const sl = this.step(il, k);
          const sr = sl && this.step(ir, k);
          if (!sr) continue;
          this.path.push(k);
          this.at.push(k);
          const x = a[i];
          const y = b[i];
          if (x.t !== y.t || x.t < ARR) this.leaf(x, y);
          else if (x.t === OBJ) this.obj(x, y, sl, sr);
          else this.arr(x, y, sl, sr);
          this.path.pop();
          this.at.pop();
        }
        return;
      }
    }
    const lm = keyMap(a);
    const rm = keyMap(b);
    if (!this.keyFree && this.orderDiffers(a, b, lm, rm)) this.emit('changed', l, r, undefined, undefined, true);
    for (const c of a) {
      const k = c.key as string;
      if (lm.get(k) !== c) continue;
      const sl = this.step(il, k);
      if (!sl) continue;
      const d = rm.get(k);
      const sr = d ? this.step(ir, k) : NO;
      if (!sr) continue;
      this.path.push(k);
      this.at.push(k);
      if (!d) this.emit('removed', c, undefined, undefined, r);
      else if (c.t !== d.t || c.t < ARR) this.leaf(c, d);
      else if (c.t === OBJ) this.obj(c, d, sl, sr);
      else this.arr(c, d, sl, sr);
      this.path.pop();
      this.at.pop();
    }
    for (const d of b) {
      const k = d.key as string;
      if (rm.get(k) !== d || lm.has(k) || !this.step(ir, k)) continue;
      this.path.push(k);
      this.at.push(k);
      this.emit('added', undefined, d, l);
      this.path.pop();
      this.at.pop();
    }
  }

  /** Whether the keys both objects share appear in a different order. */
  private orderDiffers(a: JNode[], b: JNode[], lm: Map<string, JNode>, rm: Map<string, JNode>): boolean {
    let j = 0;
    for (const c of a) {
      const k = c.key as string;
      if (lm.get(k) !== c || !rm.has(k)) continue;
      while (j < b.length && (rm.get(b[j].key as string) !== b[j] || !lm.has(b[j].key as string))) j++;
      if (j >= b.length || b[j].key !== k) return true;
      j++;
    }
    return false;
  }

  /**
   * Id tokens when every element of both arrays is an object with the same
   * id-like key (string / number value, unique per side): fills `ta` / `tb`
   * and returns true.
   */
  private idTokens(a: JNode[], b: JNode[], ta: number[], tb: number[]): boolean {
    const n = a.length;
    const m = b.length;
    if (!n || !m) return false;
    for (const x of a) if (x.t !== OBJ) return false;
    for (const x of b) if (x.t !== OBJ) return false;
    next: for (const key of ID_KEYS) {
      ta.length = 0;
      tb.length = 0;
      const strs = new Map<string, number>();
      const nums = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const v = lastChild(kids(a[i]), key);
        if (!v || (v.t !== STR && v.t !== NUM)) continue next;
        const map = v.t === NUM ? nums : strs;
        const id = v.t === NUM ? canonNum(v.v as string) : this.ci ? (v.v as string).toLowerCase() : (v.v as string);
        if (map.has(id)) continue next;
        map.set(id, i);
        ta.push(i);
      }
      const seen = new Uint8Array(n + m);
      let shared = 0;
      for (let j = 0; j < m; j++) {
        const v = lastChild(kids(b[j]), key);
        if (!v || (v.t !== STR && v.t !== NUM)) continue next;
        const map = v.t === NUM ? nums : strs;
        const id = v.t === NUM ? canonNum(v.v as string) : this.ci ? (v.v as string).toLowerCase() : (v.v as string);
        let t = map.get(id);
        if (t === undefined) map.set(id, (t = n + j));
        else if (t < n) shared++;
        if (seen[t]) continue next;
        seen[t] = 1;
        tb.push(t);
      }
      // ids that never match are probably not ids (e.g. every `name` was edited)
      if (shared) return true;
    }
    ta.length = 0;
    tb.length = 0;
    return false;
  }

  /** Alignment tokens: id tokens (returns true) or 52-bit structural hashes. */
  private tokens(a: JNode[], b: JNode[], il: Ig, ir: Ig, ta: number[], tb: number[]): boolean {
    if (this.idTokens(a, b, ta, tb)) return true;
    for (let i = 0; i < a.length; i++) ta.push(this.hash(a[i], this.step(il, i) ?? NO));
    for (let j = 0; j < b.length; j++) tb.push(this.hash(b[j], this.step(ir, j) ?? NO));
    return false;
  }

  private arr(l: JNode, r: JNode, il: Ig, ir: Ig) {
    const a = kids(l);
    const b = kids(r);
    const n = a.length;
    const m = b.length;
    if (!n && !m) return;
    const ta: number[] = [];
    const tb: number[] = [];
    const byId = this.tokens(a, b, il, ir, ta, tb);
    if (this.unordered) {
      this.arrUnordered(l, r, a, b, ta, tb, il, ir, byId);
      return;
    }
    // common ends need no alignment (and no allocations)
    const lim = n < m ? n : m;
    let p = 0;
    while (p < lim && ta[p] === tb[p]) p++;
    let s = 0;
    while (s < n - p && s < m - p && ta[n - 1 - s] === tb[m - 1 - s]) s++;
    // a single edited element is always paired (unless matching by id): no alignment needed
    if (!byId && n - p - s === 1 && m - p - s === 1) s++;
    // (pairs are compared inline: one stack frame less per nesting level)
    // Equal hash tokens imply equal values (a false match is ~2^-52 per pair): hash-matched pairs aren't walked again.
    const same = !byId;
    let k = same ? p : 0;
    for (; k < p; k++) {
      const sl = this.step(il, k);
      const sr = sl && this.step(ir, k);
      if (!sr) continue;
      this.path.push(k);
      this.at.push(k);
      const x = a[k];
      const y = b[k];
      if (x.t !== y.t || x.t < ARR) this.leaf(x, y);
      else if (x.t === OBJ) this.obj(x, y, sl, sr);
      else this.arr(x, y, sl, sr);
      this.path.pop();
      this.at.pop();
    }
    if (p < n - s || p < m - s) k = this.middle(l, r, a, b, ta, tb, p, n - s, p, m - s, k, il, ir, byId);
    for (let i = n - s, j = m - s; i < n; i++, j++, k++) {
      if (same && ta[i] === tb[j]) continue;
      const sl = this.step(il, i);
      const sr = sl && this.step(ir, j);
      if (!sr) continue;
      this.path.push(i);
      this.at.push(k);
      const x = a[i];
      const y = b[j];
      if (x.t !== y.t || x.t < ARR) this.leaf(x, y);
      else if (x.t === OBJ) this.obj(x, y, sl, sr);
      else this.arr(x, y, sl, sr);
      this.path.pop();
      this.at.pop();
    }
  }

  /** Aligns and emits a[a0, a1) vs b[b0, b1) (ends already differ). Returns the patch index after it. */
  private middle(l: JNode, r: JNode, a: JNode[], b: JNode[], ta: number[], tb: number[], a0: number, a1: number, b0: number, b1: number, k: number, il: Ig, ir: Ig, byId: boolean): number {
    let ea: number[] = [];
    let eb: number[] = [];
    if (a0 < a1 && b0 < b1) this.lcsLeft -= alignRange(ta, tb, a0, a1, b0, b1, ea, eb, Math.min(LCS_ARRAY_BUDGET, this.lcsLeft), byId ? a.length + b.length : 0);
    else {
      for (let i = a0; i < a1; i++) {
        ea.push(i);
        eb.push(-1);
      }
      for (let j = b0; j < b1; j++) {
        ea.push(-1);
        eb.push(j);
      }
    }

    // Pair the unaligned runs (edits in place) unless elements are matched by id.
    if (!byId) {
      const fa: number[] = [];
      const fb: number[] = [];
      const len = ea.length;
      let x = 0;
      while (x < len) {
        if (ea[x] >= 0 && eb[x] >= 0) {
          fa.push(ea[x]);
          fb.push(eb[x]);
          x++;
          continue;
        }
        const dels: number[] = [];
        const ins: number[] = [];
        for (; x < len && !(ea[x] >= 0 && eb[x] >= 0); x++) {
          if (ea[x] >= 0) dels.push(ea[x]);
          else ins.push(eb[x]);
        }
        const pairs = this.matchGap(a, b, dels, ins);
        let pd = 0;
        let pi = 0;
        for (let q = 0; q <= pairs.length; q += 2) {
          const u = q < pairs.length ? pairs[q] : dels.length;
          const v = q < pairs.length ? pairs[q + 1] : ins.length;
          for (; pd < u; pd++) {
            fa.push(dels[pd]);
            fb.push(-1);
          }
          for (; pi < v; pi++) {
            fa.push(-1);
            fb.push(ins[pi]);
          }
          if (q < pairs.length) {
            fa.push(dels[u]);
            fb.push(ins[v]);
            pd = u + 1;
            pi = v + 1;
          }
        }
      }
      ea = fa;
      eb = fb;
    }

    for (let x = 0; x < ea.length; x++) {
      const i = ea[x];
      const j = eb[x];
      if (i >= 0 && j >= 0) {
        const sl = this.step(il, i);
        const sr = sl && this.step(ir, j);
        if (sr && (byId || ta[i] !== tb[j])) {
          this.path.push(i);
          this.at.push(k);
          const x = a[i];
          const y = b[j];
          if (x.t !== y.t || x.t < ARR) this.leaf(x, y);
          else if (x.t === OBJ) this.obj(x, y, sl, sr);
          else this.arr(x, y, sl, sr);
          this.path.pop();
          this.at.pop();
        }
        k++;
      } else if (i >= 0) {
        if (!this.step(il, i)) {
          k++; // ignored: it stays where it is
          continue;
        }
        this.path.push(i);
        this.at.push(k);
        this.emit('removed', a[i], undefined, undefined, r);
        this.path.pop();
        this.at.pop();
      } else {
        if (!this.step(ir, j)) continue;
        this.path.push(j);
        this.at.push(k);
        this.emit('added', undefined, b[j], l);
        this.path.pop();
        this.at.pop();
        k++;
      }
    }
    return k;
  }

  private arrUnordered(l: JNode, r: JNode, a: JNode[], b: JNode[], ta: number[], tb: number[], il: Ig, ir: Ig, byId: boolean) {
    const n = a.length;
    const m = b.length;
    const pairOf = new Int32Array(n).fill(-1);
    const used = new Uint8Array(m);
    // multiset matching: a chain of right indices per token, consumed in order
    const head = new Map<number, number>();
    const next = new Int32Array(m);
    for (let j = m - 1; j >= 0; j--) {
      next[j] = head.get(tb[j]) ?? -1;
      head.set(tb[j], j);
    }
    for (let i = 0; i < n; i++) {
      const j = head.get(ta[i]);
      if (j === undefined || j < 0) continue;
      pairOf[i] = j;
      used[j] = 1;
      head.set(ta[i], next[j]);
    }
    if (!byId) {
      const dels: number[] = [];
      const ins: number[] = [];
      for (let i = 0; i < n; i++) if (pairOf[i] < 0) dels.push(i);
      for (let j = 0; j < m; j++) if (!used[j]) ins.push(j);
      const pairs = this.matchGap(a, b, dels, ins);
      for (let p = 0; p < pairs.length; p += 2) {
        pairOf[dels[pairs[p]]] = ins[pairs[p + 1]];
        used[ins[pairs[p + 1]]] = 1;
      }
    }
    let removed = 0;
    for (let i = 0; i < n; i++) {
      const sl = this.step(il, i);
      const j = pairOf[i];
      if (j >= 0) {
        const sr = sl && this.step(ir, j);
        if (sl && sr && (byId || ta[i] !== tb[j])) {
          this.path.push(i);
          this.at.push(i - removed);
          const x = a[i];
          const y = b[j];
          if (x.t !== y.t || x.t < ARR) this.leaf(x, y);
          else if (x.t === OBJ) this.obj(x, y, sl, sr);
          else this.arr(x, y, sl, sr);
          this.path.pop();
          this.at.pop();
        }
      } else if (sl) {
        this.path.push(i);
        this.at.push(i - removed);
        this.emit('removed', a[i], undefined, undefined, r);
        this.path.pop();
        this.at.pop();
        removed++;
      }
    }
    for (let j = 0; j < m; j++) {
      if (used[j] || !this.step(ir, j)) continue;
      this.path.push(j);
      this.at.push('-');
      this.emit('added', undefined, b[j], l);
      this.path.pop();
      this.at.pop();
    }
  }

  /**
   * Order-preserving pairing of the removed (`dels`) and inserted (`ins`)
   * elements of one gap, so edited elements diff field by field. Returns
   * flat [u0, v0, u1, v1, …] indices into `dels` / `ins`.
   */
  private matchGap(a: JNode[], b: JNode[], dels: number[], ins: number[]): number[] {
    const k = dels.length;
    const l = ins.length;
    const out: number[] = [];
    if (!k || !l) return out;
    if (k === l || k * l > GAP_DP_MAX) {
      for (let u = 0; u < Math.min(k, l); u++) out.push(u, u);
      return out;
    }
    // weighted LCS over pairwise similarity (element summaries computed once)
    const sa = dels.map((i) => this.sig(a[i]));
    const sb = ins.map((j) => this.sig(b[j]));
    const w = l + 1;
    const dp = new Float64Array((k + 1) * w);
    for (let u = 1; u <= k; u++) {
      for (let v = 1; v <= l; v++) {
        const s = similarity(a[dels[u - 1]], b[ins[v - 1]], sa[u - 1], sb[v - 1]);
        let best = Math.max(dp[(u - 1) * w + v], dp[u * w + v - 1]);
        if (s > 0 && dp[(u - 1) * w + v - 1] + s > best) best = dp[(u - 1) * w + v - 1] + s;
        dp[u * w + v] = best;
      }
    }
    let u = k;
    let v = l;
    while (u > 0 && v > 0) {
      const cur = dp[u * w + v];
      if (cur === dp[(u - 1) * w + v]) u--;
      else if (cur === dp[u * w + v - 1]) v--;
      else {
        out.push(v - 1, u - 1); // reversed below
        u--;
        v--;
      }
    }
    out.reverse(); // → [u0, v0, u1, v1, …] in ascending order
    return out;
  }

  /** Similarity summary: key → value hash (objects), value hash → count (arrays up to 256 items). */
  private sig(x: JNode): Sig {
    if (x.t < ARR) return null;
    const list = kids(x);
    const m: Sig = new Map();
    if (x.t === OBJ) {
      for (const c of list) m.set(c.key as string, this.hash(c, NO));
    } else {
      if (list.length > 256) return null;
      for (const c of list) {
        const h = this.hash(c, NO);
        m.set(h, (m.get(h) ?? 0) + 1);
      }
    }
    return m;
  }
}

type Sig = Map<string | number, number> | null;

/** 0 = unrelated (never paired) … 1 = identical. */
function similarity(x: JNode, y: JNode, sx: Sig, sy: Sig): number {
  if (x.t !== y.t) return 0;
  if (x.t < ARR) return 0.5;
  const nx = kids(x).length;
  const ny = kids(y).length;
  if (!nx && !ny) return 1;
  if (x.t === OBJ) {
    if (!nx || !ny || !sx || !sy) return 0;
    let score = 0;
    for (const [key, h] of sx) {
      const g = sy.get(key);
      if (g === undefined) continue;
      score += g === h ? 2 : 1;
    }
    return score / (sx.size + sy.size);
  }
  if (!sx || !sy) return 0.25;
  let same = 0;
  for (const [h, c] of sx) same += Math.min(c, sy.get(h) ?? 0);
  return 0.1 + (0.9 * 2 * same) / (nx + ny);
}

// ── Sequence alignment ───────────────────────────────────────────────────

type Tokens = ArrayLike<number>;

/**
 * Aligns two token sequences. Appends the edit script to `ea` / `eb`:
 * (i, j) = match, (i, -1) = delete a[i], (-1, j) = insert b[j]. Returns the
 * Myers work spent (above `budget`: it ran out and the script is approximate).
 */
export function align(ta: Tokens, tb: Tokens, ea: number[], eb: number[], budget = LCS_ARRAY_BUDGET): number {
  const n = ta.length;
  const m = tb.length;
  let p = 0;
  while (p < n && p < m && ta[p] === tb[p]) p++;
  let s = 0;
  while (s < n - p && s < m - p && ta[n - 1 - s] === tb[m - 1 - s]) s++;
  for (let i = 0; i < p; i++) {
    ea.push(i);
    eb.push(i);
  }
  let work = 0;
  if (p < n - s && p < m - s) work = alignRange(ta, tb, p, n - s, p, m - s, ea, eb, budget);
  else {
    for (let i = p; i < n - s; i++) {
      ea.push(i);
      eb.push(-1);
    }
    for (let j = p; j < m - s; j++) {
      ea.push(-1);
      eb.push(j);
    }
  }
  for (let i = 0; i < s; i++) {
    ea.push(n - s + i);
    eb.push(m - s + i);
  }
  return work;
}

/**
 * Minimal edit script for a[a0, a1) vs b[b0, b1) (both non-empty). When no
 * token repeats on either side, the LCS is exactly the longest increasing
 * subsequence of the common tokens: O(n log n). Otherwise Myers' linear-space
 * O((N+M)·D) algorithm, within `budget` units of work, else a patience-style
 * approximation. Returns the work spent.
 */
function alignRange(ta: Tokens, tb: Tokens, a0: number, a1: number, b0: number, b1: number, ea: number[], eb: number[], budget: number, dense = 0): number {
  if ((a1 - a0) * (b1 - b0) > 256 && patience(ta, tb, a0, a1, b0, b1, ea, eb, true, dense)) return 0;
  const my = new Myers(ta, tb, budget);
  const mark = ea.length;
  try {
    my.run(a0, a1, b0, b1, ea, eb);
  } catch (e) {
    if (e !== OVERFLOW) throw e;
    ea.length = mark;
    eb.length = mark;
    patience(ta, tb, a0, a1, b0, b1, ea, eb, false, dense);
  }
  return my.work;
}

class Myers {
  work = 0;
  /** Split point found by bisect (relative to the segment). */
  private sx = 0;
  private sy = 0;
  private readonly ta: Tokens;
  private readonly tb: Tokens;
  private readonly limit: number;

  constructor(ta: Tokens, tb: Tokens, limit: number) {
    this.ta = ta;
    this.tb = tb;
    this.limit = limit;
  }

  run(aLo: number, aHi: number, bLo: number, bHi: number, ea: number[], eb: number[]): void {
    const ta = this.ta;
    const tb = this.tb;
    while (aLo < aHi && bLo < bHi && ta[aLo] === tb[bLo]) {
      ea.push(aLo++);
      eb.push(bLo++);
    }
    let sfx = 0;
    while (aLo < aHi - sfx && bLo < bHi - sfx && ta[aHi - 1 - sfx] === tb[bHi - 1 - sfx]) sfx++;
    aHi -= sfx;
    bHi -= sfx;
    if (aLo < aHi && bLo < bHi && this.bisect(aLo, aHi, bLo, bHi)) {
      const x = this.sx;
      const y = this.sy;
      this.run(aLo, aLo + x, bLo, bLo + y, ea, eb);
      this.run(aLo + x, aHi, bLo + y, bHi, ea, eb);
    } else {
      for (let i = aLo; i < aHi; i++) {
        ea.push(i);
        eb.push(-1);
      }
      for (let j = bLo; j < bHi; j++) {
        ea.push(-1);
        eb.push(j);
      }
    }
    for (let t = 0; t < sfx; t++) {
      ea.push(aHi + t);
      eb.push(bHi + t);
    }
  }

  /**
   * Finds the middle snake of a[aLo, aHi) × b[bLo, bHi) (both non-empty, first
   * and last elements differing) and sets sx/sy to the split point. Returns
   * false when the sequences have nothing in common.
   */
  private bisect(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
    const ta = this.ta;
    const tb = this.tb;
    const N = aHi - aLo;
    const M = bHi - bLo;
    const maxD = (N + M + 1) >> 1;
    const off = maxD;
    const len = 2 * maxD + 2;
    const v1 = new Int32Array(len).fill(-1);
    const v2 = new Int32Array(len).fill(-1);
    v1[off + 1] = 0;
    v2[off + 1] = 0;
    const delta = N - M;
    const front = (delta & 1) !== 0;
    let k1s = 0;
    let k1e = 0;
    let k2s = 0;
    let k2e = 0;
    for (let d = 0; d < maxD; d++) {
      this.work += 2 * d + 2;
      if (this.work > this.limit) throw OVERFLOW;
      for (let k1 = -d + k1s; k1 <= d - k1e; k1 += 2) {
        const k1o = off + k1;
        let x1 = k1 === -d || (k1 !== d && v1[k1o - 1] < v1[k1o + 1]) ? v1[k1o + 1] : v1[k1o - 1] + 1;
        let y1 = x1 - k1;
        const x0 = x1;
        while (x1 < N && y1 < M && ta[aLo + x1] === tb[bLo + y1]) {
          x1++;
          y1++;
        }
        this.work += x1 - x0;
        v1[k1o] = x1;
        if (x1 > N) k1e += 2;
        else if (y1 > M) k1s += 2;
        else if (front) {
          const k2o = off + delta - k1;
          if (k2o >= 0 && k2o < len && v2[k2o] !== -1 && x1 >= N - v2[k2o]) return this.split(x1, y1, N, M);
        }
      }
      for (let k2 = -d + k2s; k2 <= d - k2e; k2 += 2) {
        const k2o = off + k2;
        let x2 = k2 === -d || (k2 !== d && v2[k2o - 1] < v2[k2o + 1]) ? v2[k2o + 1] : v2[k2o - 1] + 1;
        let y2 = x2 - k2;
        const x0 = x2;
        while (x2 < N && y2 < M && ta[aHi - 1 - x2] === tb[bHi - 1 - y2]) {
          x2++;
          y2++;
        }
        this.work += x2 - x0;
        v2[k2o] = x2;
        if (x2 > N) k2e += 2;
        else if (y2 > M) k2s += 2;
        else if (!front) {
          const k1o = off + delta - k2;
          if (k1o >= 0 && k1o < len && v1[k1o] !== -1) {
            const x1 = v1[k1o];
            if (x1 >= N - x2) return this.split(x1, off + x1 - k1o, N, M);
          }
        }
      }
    }
    return false;
  }

  private split(x: number, y: number, N: number, M: number): boolean {
    // a split at either corner would recurse forever (can't happen once common ends are trimmed)
    if ((x <= 0 && y <= 0) || (x >= N && y >= M)) return false;
    this.sx = x;
    this.sy = y;
    return true;
  }
}

/**
 * Patience-style alignment: anchors on tokens that occur once on each side
 * (longest increasing subsequence), common ends of the gaps in between, the
 * rest as deletions + insertions. Exact when no token repeats; with `exactOnly`
 * it returns false (emitting nothing) as soon as a repeat is seen. `dense` > 0:
 * tokens are integers below it.
 */
function patience(ta: Tokens, tb: Tokens, a0: number, a1: number, b0: number, b1: number, ea: number[], eb: number[], exactOnly: boolean, dense = 0): boolean {
  // common tokens that occur once on each side, as (ci[x], cj[x]) in a-order
  const ci: number[] = [];
  const cj: number[] = [];
  if (dense) {
    // small-integer tokens (ids): typed arrays instead of maps; -2 = repeated
    const ua = new Int32Array(dense).fill(-1);
    const ub = new Int32Array(dense).fill(-1);
    for (let i = a0; i < a1; i++) {
      const t = ta[i];
      if (ua[t] !== -1 && exactOnly) return false;
      ua[t] = ua[t] === -1 ? i : -2;
    }
    for (let j = b0; j < b1; j++) {
      const t = tb[j];
      if (ub[t] !== -1 && exactOnly) return false;
      ub[t] = ub[t] === -1 ? j : -2;
    }
    for (let i = a0; i < a1; i++) {
      const t = ta[i];
      if (ua[t] === i && ub[t] >= 0) {
        ci.push(i);
        cj.push(ub[t]);
      }
    }
  } else {
    // token → index if unique on that side, -2 if repeated
    const ua = new Map<number, number>();
    for (let i = a0; i < a1; i++) {
      if (ua.has(ta[i])) {
        if (exactOnly) return false;
        ua.set(ta[i], -2);
      } else ua.set(ta[i], i);
    }
    const ub = new Map<number, number>();
    for (let j = b0; j < b1; j++) {
      if (ub.has(tb[j])) {
        if (exactOnly) return false;
        ub.set(tb[j], -2);
      } else ub.set(tb[j], j);
    }
    for (let i = a0; i < a1; i++) {
      if (ua.get(ta[i]) !== i) continue;
      const j = ub.get(ta[i]);
      if (j !== undefined && j >= 0) {
        ci.push(i);
        cj.push(j);
      }
    }
  }
  // longest increasing subsequence of cj
  const tails: number[] = [];
  const prev = new Int32Array(cj.length);
  for (let x = 0; x < cj.length; x++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cj[tails[mid]] < cj[x]) lo = mid + 1;
      else hi = mid;
    }
    prev[x] = lo ? tails[lo - 1] : -1;
    tails[lo] = x;
  }
  const anchors: number[] = [];
  for (let x = tails.length ? tails[tails.length - 1] : -1; x >= 0; x = prev[x]) anchors.push(x);
  anchors.reverse();

  let pa = a0;
  let pb = b0;
  const gap = (ga: number, gb: number) => {
    while (pa < ga && pb < gb && ta[pa] === tb[pb]) {
      ea.push(pa++);
      eb.push(pb++);
    }
    let s = 0;
    while (pa < ga - s && pb < gb - s && ta[ga - 1 - s] === tb[gb - 1 - s]) s++;
    for (let i = pa; i < ga - s; i++) {
      ea.push(i);
      eb.push(-1);
    }
    for (let j = pb; j < gb - s; j++) {
      ea.push(-1);
      eb.push(j);
    }
    for (let t = s; t > 0; t--) {
      ea.push(ga - t);
      eb.push(gb - t);
    }
    pa = ga;
    pb = gb;
  };
  for (const x of anchors) {
    gap(ci[x], cj[x]);
    ea.push(pa++);
    eb.push(pb++);
  }
  gap(a1, b1);
  return true;
}

// ── Entry point ──────────────────────────────────────────────────────────

/** Compares two parsed documents. */
export function diff(left: JNode, right: JNode, options: DiffOptions = {}): DiffResult {
  const d = new Differ(options);
  let truncated = false;
  let error: string | null = null;
  try {
    d.cmp(left, right, d.root, d.root);
  } catch (e) {
    if (e === STOP) truncated = true;
    else if (e instanceof RangeError || (e as Error)?.name === 'InternalError') error = 'Nesting is too deep to compare';
    else throw e;
  }
  return { changes: d.changes, summary: d.sum, truncated, error };
}

/** Offset in the left document to reveal for a change (the node, or the container an addition belongs in). */
export function leftOffset(c: Change): number {
  return (c.left ?? c.leftParent)?.s ?? 0;
}

/** Offset in the right document to reveal for a change. */
export function rightOffset(c: Change): number {
  return (c.right ?? c.rightParent)?.s ?? 0;
}
