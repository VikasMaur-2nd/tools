/**
 * A page of children (client.ts children()) as JNodes: what the tree, the table and the graph show. The page's
 * tape and text make a lazy tree (lazy.ts), whose root stands for the container and whose children are the
 * page's, with their real keys (an array's items are numbered from the page's `from`).
 */
import { lazyResult } from '../json/lazy';
import type { JNode } from '../json/parser';
import { receiver, type Tape } from '../json/tape';
import type { Bytes, HugeNode, HugePage } from './types';

/** UTF-8 bytes of `s` (a lone surrogate is 3, as TextEncoder writes U+FFFD). */
export function utf8Length(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 2;
      i++;
    } else n += 2;
  }
  return n;
}

/** Text units between the entries of a page's table of bytes (PageNodes.bytesTo). */
const STEP = 4096;

/**
 * UTF-8 bytes of s[from, to), a pair counted 4 at its first half and 0 at its second (a lone half: 3, as
 * TextEncoder writes U+FFFD): the counts of ranges add up, whichever text units they start and end at.
 */
function bytesIn(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if ((c & 0xfc00) === 0xd800) n += i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 4 : 3;
    else if ((c & 0xfc00) === 0xdc00) n += i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800 ? 0 : 3;
    else n += 3;
  }
  return n;
}

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

  /** UTF-8 bytes of the page's text before offset `off`. */
  private bytesTo(off: number): number {
    const s = this.page.text;
    let t = this.table;
    if (!t) {
      t = this.table = new Float64Array(Math.floor(s.length / STEP) + 1);
      for (let k = 1; k < t.length; k++) t[k] = t[k - 1] + bytesIn(s, (k - 1) * STEP, k * STEP);
    }
    const k = Math.min(t.length - 1, Math.floor(off / STEP));
    return t[k] + bytesIn(s, k * STEP, off);
  }

  /** `n`'s text as bytes of the document: [start, end). */
  span(n: JNode): [Bytes, Bytes] {
    const s = this.stub(n);
    return s ? [s.start, s.end] : [this.byteOf(n.s), this.byteOf(n.e)];
  }
}
