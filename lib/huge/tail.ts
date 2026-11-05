/**
 * After an edit, the index past it is kept as a tail: the old checkpoints and directory records with their
 * positions moved with the edits, their counts as they were. Reading on from the checkpoint before the edit,
 * the indexer meets the tail's checkpoints; at the first where its state is the same (state, open containers,
 * their starts and names, see HugeDoc.same), the rest of the tail up to the next edit is the document's again,
 * its counts shifted by what the edit changed (HugeDoc.take). So an edit costs a stretch of reading and a pass
 * over the checkpoints, never the file.
 *
 * `dirty`: the stretches changed since the tail was made ([start, end) pairs, sorted, current positions): the
 * tail's checkpoints in them are dead, and its counts after each differ from the ones before by what that edit
 * changed, so each stretch between two is taken (re-synced) on its own.
 */
import { DW, FW } from './skeleton';
import { HugeIndex } from './index';

/** What comes after the tail's last checkpoint: the end of the document (the stats there), or nothing known (read on). */
export type TailEnd = { kind: 'done'; final: Float64Array } | { kind: 'open' };

export class Tail {
  readonly ix = new HugeIndex(true);
  /** Per checkpoint: in a changed stretch (not a place to re-sync). */
  dead: Uint8Array = new Uint8Array(64);
  dirty: number[] = [];
  /** Duplicate-name pairs [name, first name] (current positions). */
  pairs: number[] = [];
  /** The first checkpoint, directory record and pair not taken back yet. */
  next = 0;
  nextBig = 0;
  nextPair = 0;

  constructor(public end: TailEnd) {}

  /** Marks checkpoint `k` (once added) dead or not. */
  setDead(k: number, v: boolean) {
    if (k >= this.dead.length) {
      const d = new Uint8Array(Math.max(k + 1, this.dead.length * 2));
      d.set(this.dead);
      this.dead = d;
    }
    this.dead[k] = v ? 1 : 0;
  }

  /** The first live checkpoint at `k` or after (-1: none). */
  live(k: number): number {
    for (; k < this.ix.n; k++) if (!this.dead[k]) return k;
    return -1;
  }

  /** The first dirty stretch that starts after byte `pos` (its index in pairs, or -1). */
  dirtyAfter(pos: number): number {
    for (let j = 0; j < this.dirty.length; j += 2) if (this.dirty[j] > pos) return j;
    return -1;
  }

  /**
   * Bytes [a, b) were replaced by `len` bytes: positions from `b` on move by `len - (b - a)`; checkpoints in
   * [a, b) die; [a, a + len) is dirty (joined with dirty stretches it touches).
   */
  replaced(a: number, b: number, len: number) {
    const delta = len - (b - a);
    const at = (p: number) => (p >= b ? p + delta : p);
    const ix = this.ix;
    for (let k = this.next; k < ix.n; k++) {
      const p = ix.pos[k];
      if (p >= a && p < b) {
        this.setDead(k, true);
        ix.pos[k] = a;
      } else if (p >= b) ix.pos[k] = p + delta;
      if (ix.sep[k] >= b) ix.sep[k] += delta;
    }
    const F = ix.frames;
    for (let o = 0; o < ix.nf * FW; o += FW) {
      if (F[o + 2] >= b) F[o + 2] += delta;
      if (F[o + 3] >= b) F[o + 3] += delta;
    }
    // Directory records: moved; a value that starts in [a, b), or ends in it, is gone (one around it stays).
    const D = ix.dir;
    let w = this.nextBig * DW;
    for (let o = w; o < ix.nd * DW; o += DW) {
      const st = D[o];
      const en = D[o + 1];
      if (b > a && ((st >= a && st < b) || (st < a && en > a && en <= b))) continue;
      if (w !== o) D.copyWithin(w, o, o + DW);
      D[w] = at(st);
      D[w + 1] = at(en);
      if (D[w + 9] >= b) D[w + 9] += delta;
      w += DW;
    }
    ix.nd = w / DW;
    ix.dirChanged();
    const P = this.pairs;
    w = this.nextPair;
    for (let j = this.nextPair; j < P.length; j += 2) {
      const p = P[j];
      const f = P[j + 1];
      if ((p >= a && p < b) || (f >= a && f < b)) continue;
      P[w++] = at(p);
      P[w++] = at(f);
    }
    P.length = w;
    if (this.end.kind === 'done') {
      const fin = this.end.final;
      fin[0] += delta;
      if (fin[17] >= b) fin[17] += delta;
    }
    // The dirty stretches: moved, and joined with the new one where they touch it.
    let s = a;
    let e = a + len;
    const out: number[] = [];
    for (let j = 0; j < this.dirty.length; j += 2) {
      const ds = this.dirty[j];
      const de = this.dirty[j + 1];
      if (de < a) out.push(ds, de);
      else if (ds > b) out.push(ds + delta, de + delta);
      else {
        s = Math.min(s, ds);
        e = Math.max(e, de >= b ? de + delta : a + len);
      }
    }
    out.push(s, e);
    out.sort((x, y) => x - y);
    // (Pairs stay pairs: the sort above only works because stretches don't overlap; re-pair in order.)
    this.dirty = out;
  }

  /** Bytes a stretch of the tail takes (its share of the index's memory). */
  get bytes(): number {
    return this.ix.bytes + this.dead.byteLength + this.pairs.length * 8;
  }
}
