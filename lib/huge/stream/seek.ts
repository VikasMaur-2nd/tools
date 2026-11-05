/**
 * "Where is it?" for the Shape panel: the next value at a shape path (array items as '*') of a given kind, or
 * the next object at a path lacking a member, from a byte on (a Visitor of walk.ts). It can also count them
 * all. Matches before `from` are passed over (a walk may start before it: at the container's first record).
 */
import { K_ARR, K_FALSE, K_NULL, K_NUM, K_OBJ, K_STR, K_TRUE } from './shape';
import { decodeString } from './reformat';
import { NUL, OBJ, type Visitor } from './walk';

export interface SeekTarget {
  /** From the scope's root: names, and '*' for an array's items. */
  path: (string | number)[];
  /** A value of this kind there (K_NULL…K_OBJ), or (`missing`) an object at the path's parent lacking its last name. */
  kind?: number;
  missing?: boolean;
}

const latin = (b: Uint8Array, a: number, e: number) => {
  let s = '';
  for (let k = a; k < e; k++) s += String.fromCharCode(b[k]);
  return s;
};

export class Seek implements Visitor {
  /** Matches found at or after `from` (counting: all of them; else the first). */
  found = 0;
  /** The first match's byte (-1: none yet). */
  first = -1;
  /** The first few matches (counting). */
  some: number[] = [];
  private readonly path: (string | number)[];
  private readonly kind: number;
  private readonly missing: boolean;
  private readonly name: string;
  /** Per depth: the value there is on the path (1), and for the parent objects of `missing`, the member was seen (2). */
  private on = new Uint8Array(64);
  private at = new Float64Array(64);
  private d = 0;
  private name0: string | null = null;
  /** The walk may stop (one match was asked for); `onStop` is told at once. */
  stop = false;
  onStop: (() => void) | null = null;

  constructor(
    target: SeekTarget,
    private readonly from: number,
    private readonly count = false,
  ) {
    this.missing = !!target.missing;
    this.path = this.missing ? target.path.slice(0, -1) : target.path;
    this.name = this.missing ? String(target.path[target.path.length - 1]) : '';
    this.kind = target.kind ?? -1;
  }

  private hit(at: number) {
    if (at < this.from) return;
    this.found++;
    if (this.first < 0) this.first = at;
    if (this.some.length < 100) this.some.push(at);
    if (!this.count) {
      this.stop = true;
      this.onStop?.();
    }
  }

  /** Whether the value starting now (at depth d, the walker's) is on the path; d = 0 is the root. */
  private onPath(): boolean {
    const d = this.d;
    if (d === 0) return true;
    if (!this.on[d - 1] || d > this.path.length) return false;
    const seg = this.path[d - 1];
    const k = this.name0;
    this.name0 = null;
    if (seg === '*') return k === null;
    return k !== null && k === String(seg);
  }

  private value(kind: number, at: number): boolean {
    const on = this.onPath();
    if (on && this.d === this.path.length && !this.missing && this.kind === kind) this.hit(at);
    return on;
  }

  open(kind: number, at: number) {
    const on = this.value(kind === OBJ ? K_OBJ : K_ARR, at);
    const d = ++this.d;
    if (d >= this.on.length) {
      const g = new Uint8Array(this.on.length * 2);
      g.set(this.on);
      this.on = g;
      const h = new Float64Array(this.at.length * 2);
      h.set(this.at);
      this.at = h;
    }
    this.on[d - 1] = on ? 1 : 0;
    this.at[d - 1] = at;
  }

  close(kind: number) {
    const d = --this.d;
    // An object on the parent path that never had the member.
    if (this.missing && kind === OBJ && this.on[d] === 1 && d === this.path.length) this.hit(this.at[d]);
    this.on[d] = 0;
    this.name0 = null;
  }

  key(b: Uint8Array, a: number, e: number, flags: number) {
    const k = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
    // (The member a `missing` target looks for, in an object on the path: seen.)
    if (this.missing && this.d - 1 === this.path.length && this.on[this.d - 1] && k === this.name) this.on[this.d - 1] = 2;
    this.name0 = k;
  }

  str(_b: Uint8Array, _a: number, _e: number, _f: number, at: number) {
    this.value(K_STR, at);
  }

  num(_b: Uint8Array, _a: number, _e: number, at: number) {
    this.value(K_NUM, at);
  }

  lit(kind: number, v: boolean, at: number) {
    this.value(kind === NUL ? K_NULL : v ? K_TRUE : K_FALSE, at);
  }
}

