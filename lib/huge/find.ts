/*
 * Find in a huge file: the source streams the offsets of matches in document order while it reads the
 * file (in its worker), so the first ones show at once and the count grows. The current match is the first
 * at or after where the view is; Next past the matches found so far waits for the next one to arrive.
 */
import type { HugeSource } from './source';

/** Matches kept (the count says "100,000+" past it, and the search stops). */
export const MAX_HITS = 100_000;

export interface FindView {
  q: string;
  /** Matches found so far. */
  total: number;
  /** The current one (-1: none yet). */
  index: number;
  /** How much of the file was searched (0 to 1), and whether it all was. */
  read: number;
  done: boolean;
  /** Stopped at MAX_HITS. */
  more: boolean;
  /** A step waits for matches still to come. */
  waiting: boolean;
}

export class StreamFind {
  q = '';
  hits: number[] = [];
  index = -1;
  private readBytes = 0;
  private done = true;
  private more = false;
  /** A step past the matches found so far: taken when the next arrives (or, at the end, wrapping round). */
  private wait: 1 | -1 | 0 = 0;
  /** The first match at or after this offset becomes current. */
  private from = 0;
  private ctl: AbortController | null = null;
  private seq = 0;

  /**
   * `jump`: go to a match (at its offset), as it becomes current; `changed`: the count or the state
   * changed (redraw the bar); `failed`: the search failed (not aborted).
   */
  constructor(
    private readonly src: Pick<HugeSource, 'find' | 'size'>,
    private readonly jump: (at: number) => void,
    private readonly changed: () => void,
    private readonly failed: (e: unknown) => void = () => undefined,
  ) {}

  /** Searches for `q` (empty: stops), going to the first match at or after offset `from`. */
  start(q: string, from = 0) {
    this.stop();
    const seq = ++this.seq;
    this.q = q;
    this.hits = [];
    this.index = -1;
    this.readBytes = 0;
    this.more = false;
    this.wait = 0;
    this.from = from;
    this.done = !q;
    if (!q) return this.changed();
    const ctl = (this.ctl = new AbortController());
    this.changed();
    this.src
      .find(q, 0, (at, read) => this.onHits(seq, at, read), ctl.signal)
      .then(
        () => {
          if (seq === this.seq && !this.done) this.finish(seq);
        },
        (e: unknown) => {
          if (seq !== this.seq || ctl.signal.aborted) return;
          this.done = true;
          this.failed(e);
          this.changed();
        },
      );
  }

  private onHits(seq: number, at: number[], read: number) {
    if (seq !== this.seq || this.done) return;
    this.readBytes = read;
    const before = this.hits.length;
    for (const x of at) {
      if (this.hits.length >= MAX_HITS) {
        this.more = true;
        break;
      }
      this.hits.push(x);
    }
    if (this.index < 0) {
      // The first match at or after where the view is.
      for (let k = before; k < this.hits.length; k++) {
        if (this.hits[k] >= this.from) {
          this.go(k);
          break;
        }
      }
    } else if (this.wait > 0 && this.hits.length > before) {
      this.wait = 0;
      this.go(this.index + 1);
    }
    if (this.more) {
      // (Enough: the search stops here.)
      this.ctl?.abort();
      this.finish(seq);
      return;
    }
    this.changed();
  }

  private finish(seq: number) {
    if (seq !== this.seq) return;
    this.done = true;
    this.ctl = null;
    this.readBytes = this.src.size;
    const n = this.hits.length;
    if (n && this.index < 0) this.go(0);
    else if (n && this.wait) {
      // Waited past the last match, or before the first: round to the other end.
      this.go(this.wait > 0 ? 0 : n - 1);
    }
    this.wait = 0;
    this.changed();
  }

  private go(k: number) {
    this.index = k;
    this.jump(this.hits[k]);
  }

  /** Next or previous match (wrapping round once the whole file is searched). */
  step(dir: 1 | -1) {
    const n = this.hits.length;
    if (!this.q) return;
    if (this.index < 0) {
      // Nothing current yet: the first found, or wait for one.
      if (n) this.go(dir > 0 ? 0 : n - 1);
      else if (!this.done) this.wait = dir;
      return this.changed();
    }
    const k = this.index + dir;
    if (k >= 0 && k < n) this.go(k);
    else if (!this.done && dir > 0) this.wait = 1;
    else if (!this.done) {
      // Before the first: the last is known only once the search ends.
      this.wait = -1;
    } else this.go((k + n) % n);
    this.changed();
  }

  /** Stops the search (the matches found stay). */
  stop() {
    this.seq++;
    this.ctl?.abort();
    this.ctl = null;
    this.done = true;
    this.wait = 0;
  }

  view(): FindView {
    return {
      q: this.q,
      total: this.hits.length,
      index: this.index,
      read: this.src.size ? Math.min(1, this.readBytes / this.src.size) : 1,
      done: this.done,
      more: this.more,
      waiting: this.wait !== 0,
    };
  }
}
