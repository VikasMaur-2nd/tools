/*
 * JNodes made from a tape only when they are read. The root is one node; a container makes its
 * children (one level, in one go) the first time its `v` is read, so showing a 100 MB document's
 * first rows makes a few hundred objects instead of millions. Once made, a node stays (its parent
 * holds it), so identity is stable: the views compare nodes with ===.
 *
 * Every node made here keeps its tape (`z`) and index (`zi`): code that only needs to count or scan
 * a big subtree reads the tape instead of making its nodes (see `tapeOfNode`).
 */
import { ARR, BOOL, JNode, NUL, NUM, STR, type ParseResult, type TapeLink, type Val } from './parser';
import { decodeString } from './decode';
import { containerOf, endOf, kindOf, KEY_NAME, VALUE_DECODE, valueKindOf, keyKindOf, keyOf, nextOf, nodeAtOffset, nodesWithin, startOf, valueOf, W, type Tape } from './tape';
import type { Key } from './parser';

/** Strings with escapes longer than this (source characters) are decoded only when read. */
const LONG_STRING = 65_536;

/** Makes the nodes of one tape over one source text. */
export class Filler implements TapeLink {
  constructor(
    readonly tape: Tape,
    readonly src: string,
  ) {}

  /** Makes node `i` (a child of `u`, or the root). */
  make(i: number, u: JNode | null): JNode {
    const t = this.tape;
    const kind = kindOf(t, i);
    // (A long string with escapes is decoded when read: a view showing its start reads `head` instead.)
    const lazy = kind >= ARR || (valueKindOf(t, i) === VALUE_DECODE && kind === STR && endOf(t, i) - startOf(t, i) > LONG_STRING);
    const n = new JNode(kind, lazy ? undefined : valueOf(t, i, this.src), startOf(t, i), u ? u.d + 1 : 0, u, keyOf(t, i));
    n.e = endOf(t, i);
    n.z = this;
    n.zi = i;
    return n;
  }

  within(n: JNode, levels: number): number {
    return nodesWithin(this.tape, n.zi, levels);
  }

  childKeys(n: JNode, f: (key: Key) => void) {
    eachChildKey(n, f);
  }

  search(n: JNode, qn: string, cs: boolean, max: number): number[] {
    return tapeSearch(this.tape, this.src, n.zi, qn, cs, max);
  }

  nodeAt(root: JNode, i: number): JNode | null {
    return nodeAtIndex(root, i);
  }

  start(i: number): number {
    return startOf(this.tape, i);
  }

  containerAt(off: number): [number, number] | null {
    const c = containerOf(this.tape, nodeAtOffset(this.tape, off, this.src));
    return c < 0 ? null : [startOf(this.tape, c), endOf(this.tape, c)];
  }

  head(n: JNode, max: number): string {
    if (n._v !== undefined) return (n._v as string).slice(0, max);
    return decodeString(this.src, n.s, max);
  }

  fill(n: JNode): Val {
    const t = this.tape;
    const i = n.zi;
    if (n.t < ARR) return (n._v = valueOf(t, i, this.src));
    const list: JNode[] = [];
    const end = nextOf(t, i);
    for (let c = i + 1; c < end; c = nextOf(t, c)) list.push(this.make(c, n));
    n._v = list;
    return list;
  }
}

/** The tape's tree as a ParseResult whose nodes are made when read. */
export function lazyResult(tape: Tape, src: string): ParseResult {
  const root = tape.count ? new Filler(tape, src).make(0, null) : null;
  return { ...tape.head, root };
}

/** The tape `n` was made from and its index there, if it was (a node edited since is not). */
export function tapeOfNode(n: JNode): { tape: Tape; src: string; i: number } | null {
  const z = n.z;
  return z instanceof Filler ? { tape: z.tape, src: z.src, i: n.zi } : null;
}

/** Whether `n`'s children have been made. */
export const filled = (n: JNode) => n._v !== undefined;

/** How many of `root`'s nodes have been made (tests). */
export function madeCount(root: JNode | null): number {
  let k = 0;
  const stack = root ? [root] : [];
  while (stack.length) {
    const n = stack.pop()!;
    k++;
    if (n.t >= ARR && n._v !== undefined) for (const c of n._v as JNode[]) stack.push(c);
  }
  return k;
}

/** Calls `f` with the key of each of `n`'s children, in order, without making them if they aren't yet. */
export function eachChildKey(n: JNode, f: (key: Key) => void) {
  if (n._v === undefined && n.z instanceof Filler) {
    const t = n.z.tape;
    const end = nextOf(t, n.zi);
    for (let c = n.zi + 1; c < end; c = nextOf(t, c)) f(keyOf(t, c));
  } else for (const c of n.v as JNode[]) f(c.key);
}

/**
 * The node at tape index `i` of the tree whose root is `root` (made from that tape), made with its
 * ancestors' children (the same objects every time), or null if `i` isn't in it.
 */
export function nodeAtIndex(root: JNode, i: number): JNode | null {
  const z = root.z;
  if (!(z instanceof Filler)) return null;
  const t = z.tape;
  if (i < root.zi || i >= nextOf(t, root.zi)) return null;
  let n = root;
  while (n.zi !== i) {
    const list = n.v as JNode[];
    // The last child starting at or before `i` holds it (children are in tape order).
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid].zi <= i) lo = mid;
      else hi = mid - 1;
    }
    n = list[lo];
  }
  return n;
}

/**
 * Tree search on a tape: the indexes of the nodes under `from` whose property name or value contains
 * `qn` (lowercased unless `cs`), in document order, at most `max`. The same test as on nodes
 * (TreeView.search), each property name tested once.
 */
export function tapeSearch(t: Tape, src: string, from: number, qn: string, cs: boolean, max: number): number[] {
  const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
  const keyHit = new Int8Array(t.keys.length);
  const nul = has('null');
  const yes = has('true');
  const no = has('false');
  const out: number[] = [];
  const end = nextOf(t, from);
  const a = t.nodes;
  for (let i = from; i < end && out.length < max; i++) {
    let hit = false;
    if (keyKindOf(t, i) === KEY_NAME) {
      const k = a[i * W + 4];
      if (!keyHit[k]) keyHit[k] = has(t.keys[k]) ? 1 : 2;
      hit = keyHit[k] === 1;
    }
    if (!hit) {
      const kind = kindOf(t, i);
      if (kind === STR || kind === NUM) hit = has(valueOf(t, i, src) as string);
      else if (kind === BOOL) hit = valueOf(t, i, src) ? yes : no;
      else if (kind === NUL) hit = nul;
    }
    if (hit) out.push(i);
  }
  return out;
}
