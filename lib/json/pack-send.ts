/*
 * Packing a parse for the page (worker side; see pack.ts for the page's side).
 */
import type { ParseResult } from './parser';
import type { PackedTree } from './pack';
import { sendable, tapeOf } from './tape-send';
import type { Tape } from './tape';

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

