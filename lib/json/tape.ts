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
import { ARR, NUM, STR, type JNode, type Key, type Kind, type ParseResult } from './parser';

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

export interface Tape {
  /** W numbers per node; its buffer may be longer (see `count`). */
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

/** The parser's decoding of values from the source (set by tape-parser.ts, which owns it). */
export const decoders: {
  /** The string value whose opening quote is at `start`. */
  string: (src: string, start: number) => string;
  /** The value of the loosely written number src.slice(start, end). */
  number: (src: string, start: number, end: number) => string;
} = {
  string: () => {
    throw new Error('tape decoders not installed');
  },
  number: () => {
    throw new Error('tape decoders not installed');
  },
};

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
      return (meta & 7) === NUM ? decoders.number(src, t.nodes[o + 1], t.nodes[o + 2]) : decoders.string(src, t.nodes[o + 1]);
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

/** `t` ready to post, and what to transfer with it. The tape's own buffer is transferred: don't use `t` after. */
export function sendable(t: Tape): { sent: SentTape; transfer: ArrayBuffer[] } {
  const extra = t.extra ? [...t.extra] : [];
  const strs = extra.length ? t.keys.concat(extra.map((x) => x[1])) : t.keys;
  let length = 0;
  for (const s of strs) length += s.length;
  const text = new Uint16Array(length);
  const offsets = new Int32Array(strs.length + 1);
  let at = 0;
  for (let k = 0; k < strs.length; k++) {
    offsets[k] = at;
    const s = strs[k];
    for (let j = 0; j < s.length; j++) text[at++] = s.charCodeAt(j);
  }
  offsets[strs.length] = at;
  const extraAt = new Int32Array(extra.map((x) => x[0]));
  const nodes = t.nodes.length > t.count * W * 1.25 ? t.nodes.slice(0, t.count * W) : t.nodes;
  const sent: SentTape = { nodes, count: t.count, text, offsets, keyCount: t.keys.length, extraAt, big: t.big ? [...t.big] : [], head: t.head };
  return { sent, transfer: [nodes.buffer, text.buffer, offsets.buffer, extraAt.buffer] };
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

// ── From a JNode tree (the old parser's result; tests compare the two) ─────────

/** The tape of `res` (parsed from `src`). */
export function tapeOf(res: ParseResult, src: string): Tape {
  const { root, ...head } = res;
  if (!root) return emptyTape(head);
  let nodes = new Int32Array(Math.max(1, res.nodes) * W + W);
  const keys: string[] = [];
  const keyIndex = new Map<string, number>();
  let extra: Map<number, string> | null = null;
  let big: Map<number, number> | null = null;
  let count = 0;
  // Iterative pre-order; each container's size is set when its subtree is done.
  const stack: { n: JNode; parent: number; at: number; next: number }[] = [];
  const emit = (n: JNode, parent: number): number => {
    const i = count++;
    const o = i * W;
    if (o + W > nodes.length) {
      const grown = new Int32Array(nodes.length * 2);
      grown.set(nodes);
      nodes = grown;
    }
    let kk = KEY_NONE;
    let key = 0;
    if (typeof n.key === 'number') {
      kk = KEY_INDEX;
      key = n.key;
    } else if (typeof n.key === 'string') {
      kk = KEY_NAME;
      let k = keyIndex.get(n.key);
      if (k === undefined) {
        k = keys.length;
        keys.push(n.key);
        keyIndex.set(n.key, k);
      }
      key = k;
    }
    let vk: number;
    const v = n.v;
    if (n.t >= ARR) vk = VALUE_NONE;
    else if (v === true) vk = VALUE_TRUE;
    else if (v === false) vk = VALUE_FALSE;
    else if (v === null) vk = VALUE_NULL;
    else {
      const s = v as string;
      if (n.t === NUM ? n.e - n.s === s.length && src.startsWith(s, n.s) : n.t === STR && src.charCodeAt(n.s) === 34 && n.e - n.s - 2 === s.length && src.startsWith(s, n.s + 1)) vk = VALUE_SLICE;
      else if (n.t === STR && n.e - n.s === s.length && src.startsWith(s, n.s)) vk = VALUE_RAW;
      else {
        vk = VALUE_EXTRA;
        (extra ??= new Map()).set(i, s);
      }
    }
    nodes[o] = n.t | (kk << 3) | (vk << 5) | (1 << 8);
    nodes[o + 1] = n.s;
    nodes[o + 2] = n.e;
    nodes[o + 3] = parent;
    nodes[o + 4] = key;
    return i;
  };
  const setSize = (i: number) => {
    const size = count - i;
    const o = i * W;
    if (size >= SIZE_BIG) {
      (big ??= new Map()).set(i, size);
      nodes[o] = (nodes[o] & 0xff) | (SIZE_BIG << 8);
    } else nodes[o] = (nodes[o] & 0xff) | (size << 8);
  };
  const first = emit(root, -1);
  if (root.t >= ARR) stack.push({ n: root, parent: -1, at: first, next: 0 });
  while (stack.length) {
    const top = stack[stack.length - 1];
    const list = top.n.v as JNode[];
    if (top.next === list.length) {
      setSize(top.at);
      stack.pop();
      continue;
    }
    const child = list[top.next++];
    const at = emit(child, top.at);
    if (child.t >= ARR) stack.push({ n: child, parent: top.at, at, next: 0 });
  }
  return { nodes, count, keys, big, extra, head };
}
