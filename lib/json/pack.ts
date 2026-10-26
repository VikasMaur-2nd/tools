/*
 * A parse tree as a worker hands it to the page: the tape (tape.ts), transferred, not copied.
 *
 * The page doesn't rebuild the nodes: `unpacker` reads the property names (in slices, so no single
 * task is long) and gives a ParseResult whose nodes are made only when read (lazy.ts). Caret paths
 * are found on the tape itself (`packedPosition`), without making any node.
 */
import { OBJ, type ParseResult } from './parser';
import { lazyResult } from './lazy';
import { emptyTape, KEY_INDEX, receiver, sendable, tapeOf, W, type SentTape, type Tape } from './tape';

export type PackedTree = SentTape;

/** Packs `res` (parsed from `src`); post it with `packedTransfer(tree)`. */
export function packTree(res: ParseResult, src: string): PackedTree {
  return sendable(tapeOf(res, src)).sent;
}

/** A tape ready to post. */
export function packTape(tape: Tape): PackedTree {
  return sendable(tape).sent;
}

/** The buffers to transfer with a packed tree. */
export const packedTransfer = (p: PackedTree): ArrayBuffer[] => [p.nodes.buffer, p.text.buffer, p.offsets.buffer, p.extraAt.buffer];

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
  const count = tree.count;
  const a = tree.nodes;
  if (!count || off < a[1] || off > a[2]) return null;
  const t = tapeOfPacked(tree);
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
  if (node < 0) return null;
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
  const path: (string | number)[] = [];
  for (let i = node; parent(i) >= 0; i = parent(i)) {
    const o = i * W;
    path.push(((a[o] >> 3) & 3) === KEY_INDEX ? a[o + 4] : t.keys[a[o + 4]]);
  }
  path.reverse();
  let container = node;
  while (container >= 0 && (a[container * W] & 7) < 4) container = parent(container);
  return { path, start: container >= 0 ? a[container * W + 1] : -1, end: container >= 0 ? a[container * W + 2] : -1 };
}
