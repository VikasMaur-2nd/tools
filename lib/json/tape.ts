/*
 * A parse tree as one flat Int32Array (a "tape"): what the parser builds, what a worker hands to the
 * page (transferred, not copied), and what the views read. Nodes are never objects here: a 100 MB
 * document of 6.7M values takes 134 MB as a tape, against about 1 GB as JNode objects (and 169 MB
 * for JSON.parse's plain values). The views make JNodes only for what they show (see lazy.ts).
 *
 * Nodes are in document order (the root is node 0), W numbers each:
 *   [meta, start, end, parent, key]
 * - meta: kind (bits 0–2: NUL…OBJ as in parser.ts) | key kind << 3 | value kind << 5 | size << 8.
 *   `size` is the number of nodes in its subtree, itself included, so a node's subtree is
 *   [i, i + size) and its next sibling is i + size. A size of SIZE_BIG or more is kept in `big`.
 * - start, end: source offsets (UTF-16 code units) of the value, as JNode.s / JNode.e.
 * - parent: the container's node index, -1 for the root.
 * - key: an array item's index, or an object member's index in `keys` (unique property names).
 *
 * Values are not stored: they are read from the source text on demand (see VALUE_*), so a
 * string or number costs nothing beyond its node. Those that can't be read back with a slice
 * or the parser's own decoding are kept in `extra`.
 */
import { decodeNumber, decodeString } from './decode';
import { ARR, NUM, OBJ, type Key, type Kind, type ParseResult } from './parser';

/** Int32 per node. */
export const W = 5;

export const KEY_NONE = 0;
/** An array item: `key` is its index. */
export const KEY_INDEX = 1;
/** An object member: `key` indexes `keys`. */
export const KEY_NAME = 2;

/** null */
export const VALUE_NULL = 0;
export const VALUE_TRUE = 1;
export const VALUE_FALSE = 2;
/** Containers. */
export const VALUE_NONE = 3;
/** A number: src.slice(start, end). A string: src.slice(start + 1, end - 1) (a quoted string with no escapes). */
export const VALUE_SLICE = 4;
/** A string: src.slice(start, end) (unquoted text the parser kept as a string). */
export const VALUE_RAW = 5;
/** Decoded from the source by the parser's own decoding: a string with escapes or other quotes (decodeString), a loosely written number (decodeNumber). */
export const VALUE_DECODE = 6;
/** In `extra`. */
export const VALUE_EXTRA = 7;

/** Sizes from this up are in `big`. */
export const SIZE_BIG = 0xffffff;

/** A parser's tape of up to this many bytes is cut to its exact size when the parse ends (see `fitted`). */
export const TRIM_MAX = 64 << 20;

/**
 * How far a parser's tape may grow ahead of the nodes it holds. A parser forecasts the tape the whole document
 * needs from how dense it has been, and the rest of the source may be one long string that needs no node. So a
 * forecast is trusted only if it is at most GROW_MAX times the nodes held, or a node per GROW_TEXT characters of
 * source (2 bytes of tape a character: the size of the text itself, as UTF-16; records and pretty-printed
 * documents need less, so they grow once, as they did). Otherwise the tape grows GROW_STEP times over, and
 * forecasts again when that is full.
 */
export const GROW_MAX = 64;
export const GROW_TEXT = 10;
export const GROW_STEP = 4;

/**
 * `nodes` cut to its first `count` nodes: the room a parser kept to grow into doesn't stay with the
 * tape. It is a copy, so a tape bigger than TRIM_MAX keeps its room (~5% there, and copying would add
 * the whole tape again to the peak).
 */
export function fitted(nodes: Int32Array<ArrayBuffer>, count: number): Int32Array<ArrayBuffer> {
  const used = count * W;
  return used < nodes.length && used * 4 <= TRIM_MAX ? nodes.slice(0, used) : nodes;
}

export interface Tape {
  /** W numbers per node; its buffer may be longer (see `count`) above TRIM_MAX bytes. */
  nodes: Int32Array<ArrayBuffer>;
  /** Nodes in use. */
  count: number;
  /** Property names, each once. */
  keys: string[];
  /** Subtree sizes of SIZE_BIG or more, by node index. */
  big: Map<number, number> | null;
  /** Values the source can't give back (VALUE_EXTRA), by node index. */
  extra: Map<number, string> | null;
  /** Everything a ParseResult has but the tree. */
  head: Omit<ParseResult, 'root'>;
}

export const kindOf = (t: Tape, i: number) => (t.nodes[i * W] & 7) as Kind;
export const keyKindOf = (t: Tape, i: number) => (t.nodes[i * W] >> 3) & 3;
export const valueKindOf = (t: Tape, i: number) => (t.nodes[i * W] >> 5) & 7;
export const startOf = (t: Tape, i: number) => t.nodes[i * W + 1];
export const endOf = (t: Tape, i: number) => t.nodes[i * W + 2];
export const parentOf = (t: Tape, i: number) => t.nodes[i * W + 3];
export const isContainerAt = (t: Tape, i: number) => (t.nodes[i * W] & 7) >= ARR;

/** Nodes in `i`'s subtree, itself included. */
export function sizeOf(t: Tape, i: number): number {
  const s = t.nodes[i * W] >>> 8;
  return s < SIZE_BIG ? s : t.big!.get(i)!;
}

/** The node after `i`'s subtree: its next sibling if it has one. */
export const nextOf = (t: Tape, i: number) => i + sizeOf(t, i);

/** `i`'s key: an index, a property name, or undefined for the root. */
export function keyOf(t: Tape, i: number): Key {
  const o = i * W;
  const kk = (t.nodes[o] >> 3) & 3;
  return kk === KEY_INDEX ? t.nodes[o + 4] : kk === KEY_NAME ? t.keys[t.nodes[o + 4]] : undefined;
}

/** `i`'s value as JNode.v has it for a leaf (raw number text, decoded string, boolean or null); null for a container. */
export function valueOf(t: Tape, i: number, src: string): string | boolean | null {
  const o = i * W;
  const meta = t.nodes[o];
  switch ((meta >> 5) & 7) {
    case VALUE_TRUE:
      return true;
    case VALUE_FALSE:
      return false;
    case VALUE_SLICE:
      return (meta & 7) === NUM ? src.slice(t.nodes[o + 1], t.nodes[o + 2]) : src.slice(t.nodes[o + 1] + 1, t.nodes[o + 2] - 1);
    case VALUE_RAW:
      return src.slice(t.nodes[o + 1], t.nodes[o + 2]);
    case VALUE_DECODE:
      return (meta & 7) === NUM ? decodeNumber(src, t.nodes[o + 1], t.nodes[o + 2]) : decodeString(src, t.nodes[o + 1]);
    case VALUE_EXTRA:
      return t.extra!.get(i)!;
    default:
      return null;
  }
}

/** Depth of `i` (the root is 0): its parents counted. */
export function depthOf(t: Tape, i: number): number {
  let d = 0;
  for (let p = parentOf(t, i); p >= 0; p = parentOf(t, p)) d++;
  return d;
}

/** How many children `i` has (walks them: cache it for wide containers). */
export function childCount(t: Tape, i: number): number {
  if (!isContainerAt(t, i)) return 0;
  const end = nextOf(t, i);
  let k = 0;
  for (let c = i + 1; c < end; c = nextOf(t, c)) k++;
  return k;
}

/** The empty tape of a document with no root. */
export function emptyTape(head: Omit<ParseResult, 'root'>): Tape {
  return { nodes: new Int32Array(0), count: 0, keys: [], big: null, extra: null, head };
}

// ── Moving a tape between threads ─────────────────────────────────────────

/** A tape as a worker posts it: strings as raw UTF-16 so receiving it can't block the page (see `sendable`). */
export interface SentTape {
  nodes: Int32Array<ArrayBuffer>;
  count: number;
  /** keys (then extra values) as UTF-16, with offsets[k]..offsets[k + 1] for string k. */
  text: Uint16Array<ArrayBuffer>;
  offsets: Int32Array<ArrayBuffer>;
  keyCount: number;
  /** Node indexes of the extra values (which follow the keys in `text`). */
  extraAt: Int32Array<ArrayBuffer>;
  big: [number, number][];
  head: Omit<ParseResult, 'root'>;
}

/** Reads string `k` of a sent tape (TextDecoder would replace unpaired surrogates, which JSON strings may hold). */
function sentString(s: SentTape, k: number): string {
  const end = s.offsets[k + 1];
  let out = '';
  for (let i = s.offsets[k]; i < end; i += 4096) out += String.fromCharCode(...s.text.subarray(i, Math.min(end, i + 4096)));
  return out;
}

/**
 * A received tape. Property names are read in steps: call the returned function with a deadline
 * (a performance.now() value) until it returns the tape.
 */
export function receiver(s: SentTape): (until: number) => Tape | undefined {
  const keys: string[] = new Array(s.keyCount);
  let k = 0;
  return (until) => {
    while (k < s.keyCount) {
      const end = Math.min(s.keyCount, k + 4096);
      for (; k < end; k++) keys[k] = sentString(s, k);
      if (k < s.keyCount && performance.now() >= until) return undefined;
    }
    let extra: Map<number, string> | null = null;
    if (s.extraAt.length) {
      extra = new Map();
      for (let j = 0; j < s.extraAt.length; j++) extra.set(s.extraAt[j], sentString(s, s.keyCount + j));
    }
    return { nodes: s.nodes, count: s.count, keys, big: s.big.length ? new Map(s.big) : null, extra, head: s.head };
  };
}

/** How many nodes of `i`'s subtree are at most `levels` below it (deeper subtrees are skipped, not walked; past `max` it stops counting). */
export function nodesWithin(t: Tape, i: number, levels: number, max = Infinity): number {
  let k = 0;
  // Ends of the open containers above the current node.
  const ends: number[] = [];
  const last = nextOf(t, i);
  for (let c = i; c < last && k <= max; ) {
    while (ends.length && c >= ends[ends.length - 1]) ends.pop();
    k++;
    const size = sizeOf(t, c);
    if (size > 1 && ends.length < levels) {
      ends.push(c + size);
      c++;
    } else c += size;
  }
  return k;
}

/**
 * The node path.ts `nodeAt` finds at offset `off`, read off the tape: the deepest whose range holds it (a caret
 * on a property name: that property's value), or -1.
 */
export function nodeAtOffset(t: Tape, off: number, src: Pick<string, 'indexOf'>): number {
  const count = t.count;
  const a = t.nodes;
  if (!count || off < a[1] || off > a[2]) return -1;
  const parent = (i: number) => a[i * W + 3];
  // The last node starting at or before `off` (nodes are in document order).
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (a[mid * W + 1] <= off) lo = mid;
    else hi = mid - 1;
  }
  const before = lo;
  let node = before;
  while (node >= 0 && off > a[node * W + 2]) node = parent(node);
  if (node < 0) return -1;
  // Between two members of an object: the member whose key the caret is in or before.
  if ((a[node * W] & 7) === OBJ && off > a[node * W + 1] && before + 1 < count) {
    let next = before + 1;
    while (parent(next) >= 0 && parent(next) !== node) next = parent(next);
    if (parent(next) === node && off < a[next * W + 1]) {
      let prev = before;
      while (parent(prev) >= 0 && parent(prev) !== node) prev = parent(prev);
      const comma = prev === node ? -1 : src.indexOf(',', a[prev * W + 2]);
      if (comma < 0 || comma >= a[next * W + 1] || comma < off) node = next;
    }
  }
  return node;
}

/** `i` if it is a container, else its parent: the nearest container, or -1. */
export function containerOf(t: Tape, i: number): number {
  while (i >= 0 && (t.nodes[i * W] & 7) < ARR) i = t.nodes[i * W + 3];
  return i;
}
