/*
 * A parse tree as a worker hands it to the page: the tape (tape.ts), transferred, not copied.
 *
 * The page doesn't rebuild the nodes: `unpacker` reads the property names (in slices, so no single
 * task is long) and gives a ParseResult whose nodes are made only when read (lazy.ts). Caret paths
 * are found on the tape itself (`packedPosition`), without making any node.
 */
import type { ParseResult } from './parser';
import { lazyResult } from './lazy';
import { containerOf, emptyTape, KEY_INDEX, nodeAtOffset, receiver, W, type SentTape, type Tape } from './tape';

export type PackedTree = SentTape;

// (The Format view reads a big document's pretty text off its tape: with the tape's code, not the first load.)
export { tapeOfNode } from './lazy';
export { PrettyText, prettyIndexer } from './pretty';

const received = new WeakMap<PackedTree, Tape>();

/** The tape of a packed tree, its property names read in steps (see `unpacker`). */
function tapeIn(p: PackedTree): (until: number) => Tape | undefined {
  const known = received.get(p);
  if (known) return () => known;
  const read = receiver(p);
  return (until) => {
    const t = read(until);
    if (t) received.set(p, t);
    return t;
  };
}

/** The tape of a packed tree, read in one go. */
export const tapeOfPacked = (p: PackedTree): Tape => (p.count ? tapeIn(p)(Infinity)! : emptyTape(p.head));

/**
 * The tree of a packed tree over `src`: call the returned function with a deadline (performance.now()
 * value) until it returns the ParseResult. Its nodes are made when read.
 */
export function unpacker(p: PackedTree, src: string): (until: number) => ParseResult | undefined {
  if (!p.count) {
    const done = { ...p.head, root: null } as ParseResult;
    return () => done;
  }
  const read = tapeIn(p);
  return (until) => {
    const t = read(until);
    return t && lazyResult(t, src);
  };
}

/** Caret path and nearest container, without making nodes or walking the whole tree. */
export function packedPosition(tree: PackedTree, off: number, src: Pick<string, 'indexOf'>) {
  if (!tree.count) return null;
  const t = tapeOfPacked(tree);
  const node = nodeAtOffset(t, off, src);
  if (node < 0) return null;
  const a = t.nodes;
  const path: (string | number)[] = [];
  for (let i = node; a[i * W + 3] >= 0; i = a[i * W + 3]) {
    const o = i * W;
    path.push(((a[o] >> 3) & 3) === KEY_INDEX ? a[o + 4] : t.keys[a[o + 4]]);
  }
  path.reverse();
  const container = containerOf(t, node);
  return { path, start: container >= 0 ? a[container * W + 1] : -1, end: container >= 0 ? a[container * W + 2] : -1 };
}
