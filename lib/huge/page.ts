/**
 * A page of children (client.ts children()) as JNodes: what the tree, the table and the graph show. The page's
 * tape and text make a lazy tree (lazy.ts), whose root stands for the container and whose children are the
 * page's, with their real keys (an array's items are numbered from the page's `from`).
 */
import { lazyResult } from '../json/lazy';
import type { JNode } from '../json/parser';
import { receiver, type Tape } from '../json/tape';
import type { Bytes, HugeNode, HugePage } from './types';
import { utf8At, utf8Table } from './utf8';

/** Text units between the entries of a page's table of bytes (PageNodes.bytesTo). */
const STEP = 4096;

export class PageNodes {
  readonly tape: Tape;
  /** Stands for the container: its children are the page's. */
  readonly root: JNode | null;
  private stubs: Map<number, HugeNode>;
  /**
   * UTF-8 bytes of the text before each multiple of STEP (made when first needed): a byte is found in at most STEP
   * units, not in all of its run (a page of long records is one run of up to 4 MiB, and each node has two ends).
   */
  private table: Float64Array | null = null;

  constructor(readonly page: HugePage) {
    this.tape = receiver(page.tape)(Infinity)!;
    this.root = lazyResult(this.tape, page.text).root;
    this.stubs = new Map(page.stubs);
  }

  /** The page's children. */
  get children(): JNode[] {
    return this.root ? ((this.root.v as JNode[]) ?? []) : [];
  }

  /** The big child `n` stands for (its children come from client.children()), or null. */
  stub(n: JNode): HugeNode | null {
    return this.root && n.zi !== undefined && n.z === this.root.z ? (this.stubs.get(n.zi) ?? null) : null;
  }

  /** The document byte of offset `off` of the page's text (-1 in text the page added: brackets, stubs). */
  byteOf(off: number): Bytes {
    const m = this.page.map;
    let lo = 0;
    let hi = m.length / 2 - 1;
    if (hi < 0 || off < m[0]) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (m[mid * 2] <= off) lo = mid;
      else hi = mid - 1;
    }
    // (The end of a run of the document where added text starts: the run's end.)
    if (m[lo * 2 + 1] < 0 && lo > 0 && m[lo * 2] === off && m[lo * 2 - 1] >= 0) lo--;
    const at = m[lo * 2];
    const byte = m[lo * 2 + 1];
    if (byte < 0) return -1;
    return byte + this.bytesTo(off) - this.bytesTo(at);
  }

  /** UTF-8 bytes of the page's text before offset `off` (utf8.ts: the worker's rule too). */
  private bytesTo(off: number): number {
    const s = this.page.text;
    this.table ??= utf8Table(s, 0, s.length, STEP);
    return utf8At(s, this.table, 0, off, STEP);
  }

  /** `n`'s text as bytes of the document: [start, end). */
  span(n: JNode): [Bytes, Bytes] {
    const s = this.stub(n);
    return s ? [s.start, s.end] : [this.byteOf(n.s), this.byteOf(n.e)];
  }
}
