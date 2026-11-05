/*
 * The lines of a huge document, read when they come into view: a sparse, asynchronous line model. Lines
 * are read BLOCK at a time; the blocks around the view are kept (MAX_BLOCKS, MAX_BYTES; the least recently drawn go
 * first), the next ones in the direction of scrolling are read ahead, and reads of blocks scrolled far away
 * are dropped. Drawing never waits: a line not read yet is drawn as a placeholder until it arrives.
 */
import type { HugeLine } from './source';

/** Lines per read. */
export const BLOCK = 128;
/** Blocks kept... */
export const MAX_BLOCKS = 96;
/** ...and their bytes at most (as `weigh` counts them), past the blocks near the view, which stay. */
export const MAX_BYTES = 16 << 20;
/** Blocks read ahead of the view in the direction it moves (and one behind). */
export const AHEAD = 2;

export type ReadLines<T = HugeLine> = (from: number, n: number, signal: AbortSignal) => Promise<T[]>;

/** A line's bytes, about: its text as UTF-16 and the object. */
const lineBytes = (l: HugeLine) => 48 + 2 * l.text.length;

/** Items (lines, table rows) read a block at a time as they come into view. */
export class SparseLines<T = HugeLine> {
  /** Lines there are (so far, while indexing). */
  count = 0;
  private blocks = new Map<number, T[]>();
  /** Bytes of each block kept, and in all. */
  private weights = new Map<number, number>();
  private bytes = 0;
  /** The blocks near the view (see `want`): kept whatever they weigh. */
  private lo = 0;
  private hi = -1;
  /** Blocks whose last read added nothing (not asked again until the count grows). */
  private stuck = new Map<number, number>();
  private asked = new Map<number, AbortController>();
  private gen = 0;
  /** Where the view was last (to read ahead in the direction it moves). */
  private lastFirst = 0;
  /** Called when asked-for lines arrive. */
  loaded: () => void = () => undefined;
  failed: (e: unknown) => void = () => undefined;

  /** `weigh`: an item's bytes, about (lines: their text). */
  constructor(
    private read: ReadLines<T>,
    private weigh: (item: T) => number = lineBytes as unknown as (item: T) => number,
  ) {}

  /** Line `k`, if read. */
  get(k: number): T | undefined {
    const b = Math.floor(k / BLOCK);
    const list = this.blocks.get(b);
    if (!list) return undefined;
    return list[k - b * BLOCK];
  }

  /**
   * The view shows lines [first, last): reads the blocks they are in that aren't here yet, and AHEAD more in
   * the direction it moved; drops reads of blocks no longer near it. Returns how many blocks it asked for.
   */
  want(first: number, last: number): number {
    const dir = first >= this.lastFirst ? 1 : -1;
    this.lastFirst = first;
    const end = Math.min(last, this.count);
    if (end <= first) return 0;
    const b0 = Math.floor(first / BLOCK);
    const b1 = Math.floor((end - 1) / BLOCK);
    const lo = Math.max(0, dir > 0 ? b0 - 1 : b0 - AHEAD);
    const hi = Math.min(Math.floor(Math.max(0, this.count - 1) / BLOCK), dir > 0 ? b1 + AHEAD : b1 + 1);
    this.lo = lo;
    this.hi = hi;
    // Reads of blocks well away from the view are no longer wanted.
    for (const [b, c] of this.asked) {
      if (b >= lo - 1 && b <= hi + 1) continue;
      c.abort();
      this.asked.delete(b);
    }
    let asked = 0;
    // The blocks in view first, then the ones ahead.
    const order: number[] = [];
    for (let b = b0; b <= b1; b++) order.push(b);
    for (let b = b1 + 1; b <= hi; b++) order.push(b);
    for (let b = b0 - 1; b >= lo; b--) order.push(b);
    for (const b of order) {
      const have = this.blocks.get(b) ?? [];
      if (have.length) {
        // Most recently used last; a block read in part (answered short, or the count grew since) is completed.
        this.blocks.delete(b);
        this.blocks.set(b, have);
      }
      if (have.length >= Math.min(BLOCK, this.count - b * BLOCK) || this.stuck.get(b) === this.count) continue;
      if (this.asked.has(b)) continue;
      this.fetch(b, have);
      asked++;
    }
    return asked;
  }

  private fetch(b: number, have: T[]) {
    const c = new AbortController();
    this.asked.set(b, c);
    const gen = this.gen;
    const count = this.count;
    this.read(b * BLOCK + have.length, BLOCK - have.length, c.signal).then(
      (lines) => {
        if (gen !== this.gen || this.asked.get(b) !== c) return;
        this.asked.delete(b);
        if (!lines.length) {
          // (Nothing more there for now: asked again once the count changes.)
          this.stuck.set(b, count);
          return;
        }
        this.stuck.delete(b);
        this.put(b, have.concat(lines));
        this.loaded();
      },
      (e: unknown) => {
        if (this.asked.get(b) === c) this.asked.delete(b);
        if (!c.signal.aborted && gen === this.gen) this.failed(e);
      },
    );
  }

  /** Lets go of the blocks holding an item `stale` says will change (a line still being read): read again when drawn. */
  forget(stale: (item: T) => boolean): boolean {
    let any = false;
    for (const [b, list] of this.blocks) {
      if (!list.some(stale)) continue;
      this.blocks.delete(b);
      this.bytes -= this.weights.get(b) ?? 0;
      this.weights.delete(b);
      this.stuck.delete(b);
      any = true;
    }
    return any;
  }

  /** Keeps block `b`, letting go of the blocks used longest ago (not `b`, nor those near the view) past the limits. */
  private put(b: number, list: T[]) {
    let w = 0;
    for (const x of list) w += this.weigh(x);
    this.bytes += w - (this.weights.get(b) ?? 0);
    this.weights.set(b, w);
    this.blocks.delete(b);
    this.blocks.set(b, list);
    for (const k of this.blocks.keys()) {
      if (this.blocks.size <= MAX_BLOCKS && this.bytes <= MAX_BYTES) break;
      if (k === b || (k >= this.lo && k <= this.hi)) continue;
      this.blocks.delete(k);
      this.bytes -= this.weights.get(k) ?? 0;
      this.weights.delete(k);
    }
  }

  /** Forgets every line (another mode or indent), and stops every read. */
  reset() {
    this.gen++;
    for (const c of this.asked.values()) c.abort();
    this.asked.clear();
    this.blocks.clear();
    this.weights.clear();
    this.bytes = 0;
    this.stuck.clear();
  }

  /** Blocks held and reads in flight (tests, and the memory bound). */
  get held() {
    return this.blocks.size;
  }

  /** Bytes of the blocks kept (as `weigh` counts them). */
  get weight() {
    return this.bytes;
  }

  get reading() {
    return this.asked.size;
  }
}
