/**
 * The shape of a huge document, in one streamed pass (a Visitor of walk.ts): every path (array items merged
 * as `[*]`), and for each the kinds of its values with counts, how often a member is there (presence) or null,
 * numbers' range, strings' length range and common formats, arrays' lengths, members per object, a distinct-count
 * estimate (exact up to 64 distinct values, then HyperLogLog), the most common values while few, a few examples,
 * and where each kind first occurs and where a member is first missing (byte offsets, to jump to).
 *
 * Bounded whatever the document: at most MAX_PATHS paths, MAX_KEYS members per object path (more: they are
 * merged as one "other names" path, a map's keys), 64 values a path kept exactly, 2 KiB of HyperLogLog a path.
 */
import { decodeString, validUtf8 } from './reformat';
import { ARR, BOOL, ESC, HI, LONG, NUL, NUM, OBJ, STR, type Visitor } from './walk';

/** Kinds counted per path: null, false, true, number, string, array, object. */
export const K_NULL = 0;
export const K_FALSE = 1;
export const K_TRUE = 2;
export const K_NUM = 3;
export const K_STR = 4;
export const K_ARR = 5;
export const K_OBJ = 6;
export const KINDS = 7;

/** String formats counted (strings up to 256 bytes): ISO date or date-time, email, URL, UUID, a number as text, empty. */
export const FORMATS = ['date', 'email', 'url', 'uuid', 'numeric', 'empty'] as const;

export const MAX_PATHS = 5000;
export const MAX_KEYS = 300;
/** Distinct values kept exactly per path (with their counts: the most common values). */
const EXACT = 64;
/** Characters of a value kept as an example or a common value. */
const SHOW = 160;
const EXAMPLES = 5;
/** HyperLogLog: 2^11 registers (standard error ~2.3%). */
const HLL_BITS = 11;
const HLL_M = 1 << HLL_BITS;

/** What a path's report says (sent to the page: plain data). */
export interface ShapePath {
  id: number;
  parent: number;
  /** A member's name; null for the root, array items (`item`) and other names (`other`). */
  key: string | null;
  item: boolean;
  /** Names past MAX_KEYS of an object path, merged (a map's keys). */
  other: boolean;
  depth: number;
  /** Values here, per kind (K_NULL…K_OBJ). */
  n: number;
  kinds: number[];
  /** Byte where each kind first occurs here (-1: never). */
  first: number[];
  /** Members: objects at the parent path having it (once each), and where the first object lacking it starts (-1: none). */
  present: number;
  missAt: number;
  num: { min: number; max: number; minText: string; maxText: string; mean: number; ints: number } | null;
  str: { min: number; max: number; mean: number; formats: number[] } | null;
  /** Arrays: item counts; objects: member counts. */
  arr: { min: number; max: number; mean: number } | null;
  obj: { min: number; max: number; mean: number } | null;
  /** Distinct scalar values (estimated once past 64: `exact` false). */
  distinct: number;
  exact: boolean;
  /** While exact: the most common values (text as JSON, count, first byte), most first (at most 12). */
  top: [string, number, number][] | null;
  /** The first few distinct values seen (text as JSON, cut at 160 characters; byte). */
  examples: [string, number][];
  /** Object paths: had more than MAX_KEYS names (the rest are `other`). */
  manyKeys: boolean;
}

export interface ShapeReport {
  /** Bytes read (of `size`). */
  bytes: number;
  size: number;
  /** Values at the top of the scope (the records of a list or array scope: its items). */
  records: number;
  paths: ShapePath[];
  /** Paths not made (past MAX_PATHS): their values aren't counted. */
  dropped: number;
  done: boolean;
}

class P {
  n = 0;
  kinds = new Float64Array(KINDS);
  first = new Float64Array(KINDS).fill(-1);
  present = 0;
  missAt = -1;
  /** The parent's instance this member was last seen in. */
  lastInst = -1;
  /** Objects here so far (instances), and members not yet seen missing. */
  inst = 0;
  unset = 0;
  firstObj = -1;
  nMin = Infinity;
  nMax = -Infinity;
  nMinText = '';
  nMaxText = '';
  nSum = 0;
  ints = 0;
  sMin = Infinity;
  sMax = -1;
  sSum = 0;
  fmt = new Float64Array(FORMATS.length);
  fmtSeen = false;
  aMin = Infinity;
  aMax = -1;
  aSum = 0;
  oMin = Infinity;
  oMax = -1;
  oSum = 0;
  /** Exactly kept values: their hash → the value (others with the same hash chained), while few; null: estimated. */
  vals: Map<number, Kept> | null = new Map();
  nVals = 0;
  hll: Uint8Array | null = null;
  ex: [string, number][] = [];
  kids: Map<string, number> | null = null;
  /** Object paths: the member path at each position of the last object (names usually come in the same order). */
  order: number[] | null = null;
  /** Member paths: the name's raw bytes. */
  keyBytes: Uint8Array | null = null;
  item = -1;
  other = -1;
  manyKeys = false;
  constructor(
    readonly id: number,
    readonly parent: number,
    readonly key: string | null,
    readonly isItem: boolean,
    readonly isOther: boolean,
    readonly depth: number,
  ) {}
}

/** A value kept to count it exactly: its kind and canonical bytes (compared on a hash match), count, first byte, text shown. */
interface Kept {
  kind: number;
  bytes: Uint8Array;
  n: number;
  at: number;
  text: string;
  /** Another value with the same hash. */
  next: Kept | null;
}

/** Bytes of a value kept for exact comparison: a longer value makes its path's count an estimate. */
const KEPT_MAX = 16 << 10;
/** Bytes kept for exact comparison across all paths (past it, a path needing more is estimated). */
const KEPT_BUDGET = 32 << 20;

/** FNV-1a over all of b[a, e), then mixed (murmur3's finalizer): 32 bits. */
function hashBytes(b: Uint8Array, a: number, e: number, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = a; i < e; i++) h = Math.imul(h ^ b[i], 0x01000193);
  h ^= e - a;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function hashText(s: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= s.length;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const LIT_HASH = [hashText('null', 1), hashText('false', 1), hashText('true', 1)];
/** K_STR and K_NUM, as module constants (an export read in the module is a property load each time). */
const KS = K_STR;
const KN = K_NUM;
const LIT_BYTES = [new TextEncoder().encode('null'), new TextEncoder().encode('false'), new TextEncoder().encode('true')];

/**
 * `s` as WTF-8 into `out` from 0 (grown if it must be): UTF-8, and a lone surrogate as its own 3 bytes, so
 * different strings never share bytes (a string's identity, whatever escapes spelled it). Returns the buffer
 * and the length.
 */
function wtf8(s: string, out: Uint8Array): [Uint8Array, number] {
  if (out.length < s.length * 3) out = new Uint8Array(s.length * 3 + 16);
  let p = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out[p++] = c;
    else if (c < 0x800) {
      out[p++] = 0xc0 | (c >> 6);
      out[p++] = 0x80 | (c & 63);
    } else {
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
          out[p++] = 0xf0 | (c >> 18);
          out[p++] = 0x80 | ((c >> 12) & 63);
          out[p++] = 0x80 | ((c >> 6) & 63);
          out[p++] = 0x80 | (c & 63);
          continue;
        }
      }
      out[p++] = 0xe0 | (c >> 12);
      out[p++] = 0x80 | ((c >> 6) & 63);
      out[p++] = 0x80 | (c & 63);
    }
  }
  return [out, p];
}

function hllAdd(r: Uint8Array, h: number) {
  const j = h >>> (32 - HLL_BITS);
  const rank = Math.clz32((h << HLL_BITS) | (1 << (HLL_BITS - 1))) + 1;
  if (rank > r[j]) r[j] = rank;
}

/** The HyperLogLog estimate (with the small- and large-range corrections). */
export function hllCount(r: Uint8Array): number {
  let sum = 0;
  let zeros = 0;
  for (let j = 0; j < HLL_M; j++) {
    sum += 2 ** -r[j];
    if (!r[j]) zeros++;
  }
  const alpha = 0.7213 / (1 + 1.079 / HLL_M);
  let e = (alpha * HLL_M * HLL_M) / sum;
  if (e <= 2.5 * HLL_M && zeros) e = HLL_M * Math.log(HLL_M / zeros);
  else if (e > 2 ** 32 / 30) e = -(2 ** 32) * Math.log(1 - e / 2 ** 32);
  return Math.round(e);
}

/** The format of a short string token b[a, e) (index in FORMATS), or -1. */
function formatOf(b: Uint8Array, a: number, e: number): number {
  const len = e - a;
  if (len === 0) return 5;
  if (len > 256) return -1;
  const c = b[a];
  const digit = (x: number) => x >= 48 && x <= 57;
  if (len >= 10 && digit(c) && digit(b[a + 1]) && digit(b[a + 2]) && digit(b[a + 3]) && b[a + 4] === 45 && digit(b[a + 5]) && digit(b[a + 6]) && b[a + 7] === 45 && digit(b[a + 8]) && digit(b[a + 9]) && (len === 10 || b[a + 10] === 84 || b[a + 10] === 32 || b[a + 10] === 116)) return 0;
  if (len === 36 && b[a + 8] === 45 && b[a + 13] === 45 && b[a + 18] === 45 && b[a + 23] === 45) {
    let ok = true;
    for (let i = a; i < e && ok; i++) {
      const x = b[i] | 32;
      if (!(digit(b[i]) || (x >= 97 && x <= 102) || b[i] === 45)) ok = false;
    }
    if (ok) return 3;
  }
  if ((c === 104 || c === 72) && len > 8) {
    // http:// or https://
    const s = (b[a + 1] | 32) === 116 && (b[a + 2] | 32) === 116 && (b[a + 3] | 32) === 112;
    if (s && ((b[a + 4] === 58 && b[a + 5] === 47 && b[a + 6] === 47) || ((b[a + 4] | 32) === 115 && b[a + 5] === 58 && b[a + 6] === 47 && b[a + 7] === 47))) return 2;
  }
  if (len > 64) return -1;
  let at = -1;
  let dot = false;
  let space = false;
  let num = true;
  for (let i = a; i < e; i++) {
    const x = b[i];
    if (x === 64) {
      if (at >= 0) at = -2;
      else if (at === -1) at = i;
    } else if (x === 46 && at >= 0 && i > at + 1 && i < e - 1) dot = true;
    else if (x === 32) space = true;
    if (num && !(digit(x) || (x === 45 && i === a) || x === 46)) num = false;
  }
  if (at > a && dot && !space) return 1;
  if (num && digit(b[e - 1])) return 4;
  return -1;
}

/** Powers of ten a double holds exactly. */
const POW10 = Array.from({ length: 23 }, (_, k) => 10 ** k);
/** Whether the last numberOf was an integer as written (no fraction, no exponent), and read exactly. */
let wasInt = false;
let wasExact = true;

/**
 * A number token as JS reads it (Number(text)): exactly, without making its text in the common case (up to
 * 15 significant digits and a power of ten up to 22: one correctly rounded multiply or divide, Clinger's
 * fast path); otherwise from its text.
 */
export function numberOf(b: Uint8Array, a: number, e: number): number {
  let i = a;
  const neg = b[i] === 45;
  if (neg) i++;
  let m = 0;
  let digits = 0;
  let frac = 0;
  let x = b[i];
  // (Leading zeros aren't significant digits.)
  while (i < e && (x = b[i]) >= 48 && x <= 57) {
    if (m || x !== 48) {
      m = m * 10 + (x - 48);
      digits++;
    }
    i++;
  }
  wasInt = true;
  if (i < e && b[i] === 46) {
    wasInt = false;
    i++;
    while (i < e && (x = b[i]) >= 48 && x <= 57) {
      if (m || x !== 48) {
        m = m * 10 + (x - 48);
        digits++;
      }
      frac++;
      i++;
    }
  }
  let exp = 0;
  if (i < e && (b[i] | 32) === 101) {
    wasInt = false;
    i++;
    let eneg = false;
    if (b[i] === 45 || b[i] === 43) eneg = b[i++] === 45;
    while (i < e && (x = b[i]) >= 48 && x <= 57) {
      exp = exp * 10 + (x - 48);
      i++;
      if (exp > 1e6) break;
    }
    if (eneg) exp = -exp;
  }
  const p = exp - frac;
  wasExact = true;
  if (i === e && digits <= 15 && p >= -22 && p <= 22) {
    const v = p >= 0 ? m * POW10[p] : m / POW10[-p];
    return neg ? -v : v;
  }
  // (More digits: a close value, within a few units in the last place; num() asks for the exact one where it matters.)
  if (i === e && digits <= 40 && p >= -300 && p <= 300) {
    wasExact = false;
    const v = p >= 0 ? m * 10 ** p : m / 10 ** -p;
    return neg ? -v : v;
  }
  return Number(latin(b, a, e));
}

const latin = (b: Uint8Array, a: number, e: number) => {
  let s = '';
  for (let k = a; k < e; k++) s += String.fromCharCode(b[k]);
  return s;
};

/** A boundary at or before `limit` in string token b[a, e) that cuts no escape and no character. */
function safeCut(b: Uint8Array, a: number, limit: number): number {
  let i = a;
  while (i < limit) {
    if (b[i] === 92) {
      const len = b[i + 1] === 117 ? 6 : 2;
      if (i + len > limit) break;
      i += len;
    } else i++;
  }
  while (i > a && (b[i] & 0xc0) === 0x80) i--;
  return i;
}

/** A string value's text as JSON (for examples), cut at SHOW characters. */
function shownString(b: Uint8Array, a: number, e: number, flags: number): string {
  // (Only the start is decoded: a long value needn't be read whole to be shown.)
  const limit = a + SHOW * 4;
  const cut = e > limit || !!(flags & LONG);
  let s = decodeString(b, a, cut ? safeCut(b, a, Math.min(e, limit)) : e, flags & (ESC | HI));
  if (!cut && s.length <= SHOW) return JSON.stringify(s);
  let k = SHOW;
  if (s.length > k && (s.charCodeAt(k - 1) & 0xfc00) === 0xd800) k--;
  s = s.slice(0, k);
  return JSON.stringify(s).slice(0, -1) + '…"';
}

/** UTF-16 length of string token b[a, e) (an escape is one unit; a 4-byte character two). */
function unitsOf(b: Uint8Array, a: number, e: number, flags: number): number {
  if (!flags) return e - a;
  let n = 0;
  for (let i = a; i < e; i++) {
    const c = b[i];
    if (c === 92) {
      n++;
      i += b[i + 1] === 117 ? 5 : 1;
    } else if (c < 0x80 || c >= 0xc0) n += c >= 0xf0 ? 2 : 1;
  }
  return n;
}

export class Shape implements Visitor {
  private paths: P[] = [];
  private dropped = 0;
  // The open containers: their path, start, items so far, members seen.
  private sp = new Int32Array(64);
  private sAt = new Float64Array(64);
  private sCount = new Float64Array(64);
  private sSeen = new Int32Array(64);
  private d = 0;
  /** The path of the value that comes next (after a name: the member's; -1: not counted). */
  private nextPath = -2;
  /** Items of the scope's root once it closed (while open: counted so far). */
  private rootCount = -1;
  /** Bytes of values kept for exact comparison (all paths); canonical string bytes (canon) and their buffer. */
  private keptBytes = 0;
  private scratch: Uint8Array = new Uint8Array(256);
  private cb: Uint8Array = this.scratch;
  private ca = 0;
  private ce = 0;
  /** The walker's `longBytes` (a LONG string's whole length). */
  longBytes = () => 0;

  constructor() {
    this.paths.push(new P(0, -1, null, false, false, 0));
  }

  private make(parent: number, key: string | null, item: boolean, other: boolean): number {
    if (this.paths.length >= MAX_PATHS) {
      this.dropped++;
      return -1;
    }
    const pp = this.paths[parent];
    const p = new P(this.paths.length, parent, key, item, other, pp.depth + 1);
    this.paths.push(p);
    if (!item && !other) {
      // (A member first seen after the first object at its parent path: that object lacked it.)
      if (pp.inst > 1) p.missAt = pp.firstObj;
      else pp.unset++;
    }
    return p.id;
  }

  /** The path of an item of the array at depth d - 1. */
  private itemPath(): number {
    const parent = this.sp[this.d - 1];
    if (parent < 0) return -1;
    const pp = this.paths[parent];
    if (pp.item < 0) pp.item = this.make(parent, null, true, false);
    return pp.item;
  }

  /** The path of the value that starts now (and counts it as an item / member of its container). */
  private here(): number {
    const d = this.d;
    if (d === 0) return 0;
    this.sCount[d - 1]++;
    if (this.nextPath !== -2) {
      const p = this.nextPath;
      this.nextPath = -2;
      return p;
    }
    return this.itemPath();
  }

  private count(id: number, kind: number, at: number): P | null {
    if (id < 0) return null;
    const p = this.paths[id];
    p.n++;
    p.kinds[kind]++;
    if (p.first[kind] < 0) p.first[kind] = at;
    return p;
  }

  /**
   * Counts a scalar at `p`: its kind and canonical bytes b[a, e) (all of them hashed into `h`). True if it is a
   * new value while values are counted exactly (then `keep` it, with its text); a value counts as one seen
   * before only when its bytes equal that one's.
   */
  private seen(p: P, h: number, kind: number, b: Uint8Array, a: number, e: number): boolean {
    if (p.vals) {
      for (let v: Kept | null | undefined = p.vals.get(h); v; v = v.next) {
        if (v.kind !== kind || v.bytes.length !== e - a) continue;
        const kb = v.bytes;
        let k = 0;
        while (k < kb.length && kb[k] === b[a + k]) k++;
        if (k === kb.length) {
          v.n++;
          return false;
        }
      }
      // (New, but too long to keep for comparing, or the budget for that is spent: estimated from now on.)
      if (e - a > KEPT_MAX || this.keptBytes + (e - a) > KEPT_BUDGET) {
        this.estimate(p);
        hllAdd(p.hll!, h);
        return false;
      }
      return true;
    }
    hllAdd(p.hll!, h);
    return false;
  }

  /** A new value (`seen` said so): an example, and kept while few; past EXACT the count is estimated from now on. */
  private keep(p: P, h: number, kind: number, b: Uint8Array, a: number, e: number, t: string, at: number) {
    if (p.ex.length < EXAMPLES) p.ex.push([t, at]);
    if (p.nVals < EXACT) {
      p.vals!.set(h, { kind, bytes: b.slice(a, e), n: 1, at, text: t, next: p.vals!.get(h) ?? null });
      p.nVals++;
      this.keptBytes += e - a;
      return;
    }
    this.estimate(p);
    hllAdd(p.hll!, h);
  }

  /** An example of an estimated path (the first few distinct texts). */
  private example(p: P, t: string, at: number) {
    for (const x of p.ex) if (x[0] === t) return;
    p.ex.push([t, at]);
  }

  /** `p`'s distinct values are estimated from now on (HyperLogLog), from the ones it kept. */
  private estimate(p: P) {
    p.hll = new Uint8Array(HLL_M);
    for (const [h, v] of p.vals!) {
      for (let x: Kept | null = v; x; x = x.next) {
        hllAdd(p.hll, h);
        this.keptBytes -= x.bytes.length;
      }
    }
    p.vals = null;
  }

  /** A string's canonical bytes (escapes decoded, invalid UTF-8 as U+FFFD) into cb[ca, ce): b[a, e) itself when it is already. */
  private canon(b: Uint8Array, a: number, e: number, flags: number) {
    if (!(flags & ESC) && (!(flags & HI) || validUtf8(b, a, e))) {
      this.cb = b;
      this.ca = a;
      this.ce = e;
      return;
    }
    const [buf, n] = wtf8(decodeString(b, a, e, flags), this.scratch);
    this.scratch = this.cb = buf;
    this.ca = 0;
    this.ce = n;
  }

  open(kind: number, at: number) {
    const id = this.here();
    const p = this.count(id, kind === OBJ ? K_OBJ : K_ARR, at);
    const d = this.d++;
    if (d + 1 >= this.sp.length) this.grow();
    this.sp[d] = id;
    this.sAt[d] = at;
    this.sCount[d] = 0;
    this.sSeen[d] = 0;
    if (p && kind === OBJ) {
      p.inst++;
      if (p.firstObj < 0) p.firstObj = at;
    }
  }

  private grow() {
    const n = this.sp.length * 2;
    const g = <T extends Int32Array | Float64Array>(a: T, b: T) => (b.set(a), b);
    this.sp = g(this.sp, new Int32Array(n));
    this.sAt = g(this.sAt, new Float64Array(n));
    this.sCount = g(this.sCount, new Float64Array(n));
    this.sSeen = g(this.sSeen, new Int32Array(n));
  }

  close(kind: number) {
    const d = --this.d;
    const id = this.sp[d];
    this.nextPath = -2;
    if (id < 0) return;
    const p = this.paths[id];
    const n = this.sCount[d];
    if (d === 0) this.rootCount = n;
    if (kind === ARR) {
      if (n < p.aMin) p.aMin = n;
      if (n > p.aMax) p.aMax = n;
      p.aSum += n;
      return;
    }
    if (n < p.oMin) p.oMin = n;
    if (n > p.oMax) p.oMax = n;
    p.oSum += n;
    // Members this object lacks: where each is first missing.
    if (p.unset > 0 && p.kids && this.sSeen[d] < p.kids.size) {
      const inst = p.inst;
      for (const c of p.kids.values()) {
        const q = this.paths[c];
        if (q.lastInst !== inst && q.missAt < 0) {
          q.missAt = this.sAt[d];
          p.unset--;
        }
      }
    }
  }

  key(b: Uint8Array, a: number, e: number, flags: number) {
    const d = this.d - 1;
    const parent = this.sp[d];
    if (parent < 0) {
      this.nextPath = -1;
      return;
    }
    const pp = this.paths[parent];
    // (Objects at a path usually have their names in the same order: the name at this position last time, if it is the same bytes.)
    const pos = this.sCount[d];
    let id = pp.order && pos < pp.order.length ? pp.order[pos] : -1;
    if (id >= 0) {
      const kb = this.paths[id].keyBytes!;
      if (kb.length !== e - a) id = -1;
      else for (let k = 0; k < kb.length; k++) if (kb[k] !== b[a + k]) {
        id = -1;
        break;
      }
    }
    if (id < 0) {
      const name = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
      const known = pp.kids?.get(name);
      if (known !== undefined) id = known;
      else if ((pp.kids?.size ?? 0) >= MAX_KEYS) {
        pp.manyKeys = true;
        if (pp.other < 0) pp.other = this.make(parent, null, false, true);
        id = pp.other;
      } else {
        id = this.make(parent, name, false, false);
        if (id >= 0) {
          (pp.kids ??= new Map()).set(name, id);
          this.paths[id].keyBytes = b.slice(a, e);
        }
      }
      if (id >= 0 && this.paths[id].keyBytes && pos < 4096) {
        const o = (pp.order ??= []);
        if (pos <= o.length) o[pos] = id;
      }
    }
    if (id >= 0) {
      const q = this.paths[id];
      if (q.lastInst !== pp.inst) {
        q.lastInst = pp.inst;
        q.present++;
        if (!q.isOther) this.sSeen[d]++;
      }
    }
    this.nextPath = id;
  }

  str(b: Uint8Array, a: number, e: number, flags: number, at: number) {
    const p = this.count(this.here(), K_STR, at);
    if (!p) return;
    const units = flags & LONG ? this.longBytes() : unitsOf(b, a, e, flags);
    if (units < p.sMin) p.sMin = units;
    if (units > p.sMax) p.sMax = units;
    p.sSum += units;
    // (Formats: looked for in every string of a path that had one among its first 1,000.)
    if (p.kinds[K_STR] <= 1000 || p.fmtSeen) {
      const f = formatOf(b, a, e);
      if (f >= 0) {
        p.fmt[f]++;
        p.fmtSeen = true;
      }
    }
    // (A string longer than the walker keeps: not all of it is here to tell it apart.)
    if (flags & LONG && p.vals) this.estimate(p);
    this.canon(b, a, e, flags);
    const cb = this.cb;
    const ca = this.ca;
    const ce = this.ce;
    const h = hashBytes(cb, ca, ce, STR);
    // (Estimated: the hash alone. Counted exactly: compared.)
    if (!p.vals) {
      hllAdd(p.hll!, h);
      if (p.ex.length < EXAMPLES) this.example(p, shownString(b, a, e, flags), at);
    } else if (this.seen(p, h, KS, cb, ca, ce)) this.keep(p, h, KS, cb, ca, ce, shownString(b, a, e, flags), at);
  }

  num(b: Uint8Array, a: number, e: number, at: number) {
    const p = this.count(this.here(), K_NUM, at);
    if (!p) return;
    let v = numberOf(b, a, e);
    const int = wasInt;
    // (A close value that could be a new smallest or largest: read exactly.)
    if (!wasExact) {
      const tol = Math.abs(v) * 1e-12;
      if (v - tol <= p.nMin || v + tol >= p.nMax) v = Number(latin(b, a, e));
    }
    if (v < p.nMin || (v === p.nMin && !p.nMinText)) {
      p.nMin = v;
      p.nMinText = latin(b, a, Math.min(e, a + SHOW));
    }
    if (v > p.nMax || (v === p.nMax && !p.nMaxText)) {
      p.nMax = v;
      p.nMaxText = latin(b, a, Math.min(e, a + SHOW));
    }
    p.nSum += v;
    if (int) p.ints++;
    const h = hashBytes(b, a, e, NUM);
    // (A number longer than shown is marked cut: it is never taken for the whole value.)
    if (!p.vals) {
      hllAdd(p.hll!, h);
      if (p.ex.length < EXAMPLES) this.example(p, e - a > SHOW ? latin(b, a, a + SHOW) + '…' : latin(b, a, e), at);
    } else if (this.seen(p, h, KN, b, a, e)) this.keep(p, h, KN, b, a, e, e - a > SHOW ? latin(b, a, a + SHOW) + '…' : latin(b, a, e), at);
  }

  lit(kind: number, v: boolean, at: number) {
    const k = kind === NUL ? K_NULL : v ? K_TRUE : K_FALSE;
    const p = this.count(this.here(), k, at);
    if (!p) return;
    const w = LIT_BYTES[k];
    if (this.seen(p, LIT_HASH[k], k, w, 0, w.length)) this.keep(p, LIT_HASH[k], k, w, 0, w.length, kind === NUL ? 'null' : v ? 'true' : 'false', at);
    else if (!p.vals && p.ex.length < EXAMPLES) this.example(p, kind === NUL ? 'null' : v ? 'true' : 'false', at);
  }

  report(bytes: number, size: number, done: boolean): ShapeReport {
    const paths = this.paths.map((p): ShapePath => {
      const parent = p.parent >= 0 ? this.paths[p.parent] : null;
      const scal = p.kinds[K_NULL] + p.kinds[K_FALSE] + p.kinds[K_TRUE] + p.kinds[K_NUM] + p.kinds[K_STR];
      let top: [string, number, number][] | null = null;
      if (p.vals) {
        top = [];
        for (const v of p.vals.values()) for (let x: Kept | null = v; x; x = x.next) top.push([x.text, x.n, x.at]);
        top.sort((x, y) => y[1] - x[1] || x[2] - y[2]);
        top = top.slice(0, 12);
      }
      return {
        id: p.id,
        parent: p.parent,
        key: p.key,
        item: p.isItem,
        other: p.isOther,
        depth: p.depth,
        n: p.n,
        kinds: Array.from(p.kinds),
        first: Array.from(p.first),
        present: p.present,
        missAt: p.isItem || !parent || p.present >= parent.inst ? -1 : p.missAt,
        num: p.kinds[K_NUM] ? { min: p.nMin, max: p.nMax, minText: p.nMinText, maxText: p.nMaxText, mean: p.nSum / p.kinds[K_NUM], ints: p.ints } : null,
        str: p.kinds[K_STR] ? { min: p.sMin, max: p.sMax, mean: p.sSum / p.kinds[K_STR], formats: Array.from(p.fmt) } : null,
        arr: p.kinds[K_ARR] ? { min: p.aMin, max: p.aMax, mean: p.aSum / p.kinds[K_ARR] } : null,
        obj: p.kinds[K_OBJ] ? { min: p.oMin, max: p.oMax, mean: p.oSum / p.kinds[K_OBJ] } : null,
        distinct: !scal ? 0 : p.vals ? p.nVals : hllCount(p.hll!),
        exact: !!p.vals,
        top,
        examples: p.ex.slice(),
        manyKeys: p.manyKeys,
      };
    });
    const records = !this.paths[0].kinds[K_ARR] ? 0 : this.rootCount >= 0 ? this.rootCount : this.d > 0 ? this.sCount[0] : 0;
    return { bytes, size, records, paths, dropped: this.dropped, done };
  }
}

/** Objects at a path's parent (its presence is out of these). */
export function parentObjects(r: ShapeReport, p: ShapePath): number {
  return p.parent >= 0 ? r.paths[p.parent].kinds[K_OBJ] : 0;
}

/** A path's text from the scope: `[*]` for items, `.name` (or `["na me"]`) for members, `.*` for other names. */
export function pathText(r: ShapeReport, p: ShapePath): string {
  const segs: string[] = [];
  for (let q: ShapePath | undefined = p; q && q.parent >= 0; q = r.paths[q.parent]) {
    segs.push(q.item ? '[*]' : q.other ? '.*' : /^[A-Za-z_$][\w$]*$/.test(q.key!) ? '.' + q.key : '[' + JSON.stringify(q.key) + ']');
  }
  return '$' + segs.reverse().join('');
}

export { BOOL, STR, NUM };
