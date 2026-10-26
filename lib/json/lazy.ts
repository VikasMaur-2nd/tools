/*
 * JNodes made from a tape only when they are read. The root is one node; a container makes its
 * children (one level, in one go) the first time its `v` is read, so showing a 100 MB document's
 * first rows makes a few hundred objects instead of millions. Once made, a node stays (its parent
 * holds it), so identity is stable: the views compare nodes with ===.
 *
 * Every node made here keeps its tape (`z`) and index (`zi`): code that only needs to count or scan
 * a big subtree reads the tape instead of making its nodes (see `tapeOfNode`).
 */
import { ARR, JNode, type ParseResult, type TapeLink } from './parser';
import { endOf, kindOf, keyOf, nextOf, startOf, valueOf, type Tape } from './tape';
import type { Key } from './parser';

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
    const n = new JNode(kind, kind >= ARR ? undefined : valueOf(t, i, this.src), startOf(t, i), u ? u.d + 1 : 0, u, keyOf(t, i));
    n.e = endOf(t, i);
    n.z = this;
    n.zi = i;
    return n;
  }

  fill(n: JNode): JNode[] {
    const t = this.tape;
    const i = n.zi;
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
