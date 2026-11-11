/*
 * JNodes made from a tape only when they are read. The root is one node; a container makes its
 * children (one level, in one go) the first time its `v` is read, so showing a 100 MB document's
 * first rows makes a few hundred objects instead of millions. Once made, a node stays (its parent
 * holds it), so identity is stable: the views compare nodes with ===.
 *
 * Every node made here keeps its tape (`z`) and index (`zi`): code that only needs to count or scan
 * a big subtree reads the tape instead of making its nodes (see `tapeOfNode`).
 */
import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, type CellFn, type Expansion, type ParseResult, type TapeLink, type TreeRows, type Val } from './parser';
import { decodeString } from './decode';
import { clip, keyLabel, primText, stringify } from './format';
import { writeTape } from './pretty';
import { childCount, containerOf, endOf, isContainerAt, kindOf, KEY_INDEX, KEY_NAME, SIZE_BIG, VALUE_DECODE, VALUE_SLICE, valueKindOf, keyKindOf, keyOf, nextOf, nodeAtOffset, nodesWithin, parentOf, sizeOf, startOf, valueOf, W, type Tape } from './tape';
import type { Key } from './parser';

/** Strings with escapes longer than this (source characters) are decoded only when read. */
const LONG_STRING = 65_536;

/** Makes the nodes of one tape over one source text. */
export class Filler implements TapeLink {
  /** The tree's root (see lazyResult): `at` reaches every other node from it. */
  root: JNode | null = null;
  /**
   * Nodes made one at a time (see `at`), until their parent's children are made, which take them. Held weakly:
   * a node is the same object while anything holds it (views compare nodes with ===), and one nothing holds
   * (a row scrolled past) can go: made again, no one can tell.
   */
  private one = new Map<number, WeakRef<JNode>>();
  /** `one` is swept of nodes gone when it grows to this. */
  private sweepAt = 4096;
  /** Children lists being made in steps (see fillSteps): what `at` finds there meanwhile. */
  private partial = new Map<JNode, JNode[]>();
  /** Child counts of wide containers, and object members' places (see count, pos). */
  private counts = new Map<number, number>();
  private kidLists = new Map<number, Int32Array>();

  constructor(
    readonly tape: Tape,
    readonly src: string,
  ) {}

  /** Makes node `i` (a child of `u`, or the root). */
  make(i: number, u: JNode | null): JNode {
    const t = this.tape;
    const kind = kindOf(t, i);
    // (A long string with escapes is decoded when read: a view showing its start reads `head` instead.)
    const lazy = kind >= ARR || (valueKindOf(t, i) === VALUE_DECODE && kind === STR && endOf(t, i) - startOf(t, i) > LONG_STRING);
    const n = new JNode(kind, lazy ? undefined : valueOf(t, i, this.src), startOf(t, i), u ? u.d + 1 : 0, u, keyOf(t, i));
    n.e = endOf(t, i);
    n.z = this;
    n.zi = i;
    return n;
  }

  /** Nodes made one at a time (see `at`) that are still held (tests). */
  held(): JNode[] {
    const out: JNode[] = [];
    for (const w of this.one.values()) {
      const n = w.deref();
      if (n) out.push(n);
    }
    return out;
  }

  /** Child `c` of `n`, made once: the one `at` made if it's still held. */
  private kid(c: number, n: JNode): JNode {
    const w = this.one.size ? this.one.get(c) : undefined;
    if (w) {
      this.one.delete(c);
      const k = w.deref();
      if (k) return k;
    }
    return this.make(c, n);
  }

  at(i: number): JNode {
    const t = this.tape;
    const root = this.root!;
    // Up from `i` to a node made already (the root, one made here, or a child in its parent's list)...
    const up: number[] = [];
    let n: JNode = root;
    for (let j = i; j !== root.zi; j = parentOf(t, j)) {
      const m = this.one.get(j)?.deref();
      if (m) {
        n = m;
        break;
      }
      up.push(j);
    }
    // ... and down again, making what isn't made.
    for (let q = up.length - 1; q >= 0; q--) {
      const c = up[q];
      const list: JNode[] | undefined = (n._v as JNode[] | undefined) ?? this.partial.get(n);
      const k: JNode | undefined = list && childIn(list, c);
      if (k) n = k;
      else {
        const m = this.make(c, n);
        this.one.set(c, new WeakRef(m));
        n = m;
      }
    }
    if (this.one.size >= this.sweepAt) {
      for (const [j, w] of this.one) if (!w.deref()) this.one.delete(j);
      this.sweepAt = Math.max(4096, this.one.size * 2);
    }
    return n;
  }

  kids(i: number): Int32Array {
    const t = this.tape;
    const a = t.nodes;
    // One walk, its count kept (known already: the list made to size; else grown as it goes).
    const size = sizeOf(t, i);
    let out = new Int32Array(this.counts.get(i) ?? Math.min(size - 1, 1 << 16));
    let k = 0;
    for (let c = i + 1, end = i + size; c < end; ) {
      if (k === out.length) {
        const grown = new Int32Array(Math.min(size - 1, k * 2));
        grown.set(out);
        out = grown;
      }
      out[k++] = c;
      const s = a[c * W] >>> 8;
      c += s < SIZE_BIG ? s : t.big!.get(c)!;
    }
    if (size > 64) this.counts.set(i, k);
    return k === out.length ? out : out.slice(0, k);
  }

  columns(i: number, max: number): [string[], boolean] {
    const t = this.tape;
    const a = t.nodes;
    // (Members of objects are named: their key is an index into the tape's names, each name once.)
    const seen = new Uint8Array(t.keys.length);
    const keys: string[] = [];
    let value = false;
    for (let c = i + 1, end = nextOf(t, i); c < end && !(value && keys.length >= max); c = nextOf(t, c)) {
      if ((a[c * W] & 7) !== OBJ) value = true;
      else if (keys.length < max) {
        for (let m = c + 1, e = nextOf(t, c); m < e && keys.length < max; ) {
          const k = a[m * W + 4];
          if (!seen[k]) {
            seen[k] = 1;
            keys.push(t.keys[k]);
          }
          const s = a[m * W] >>> 8;
          m += s < SIZE_BIG ? s : t.big!.get(m)!;
        }
      }
    }
    return [keys, value];
  }

  cells(items: Int32Array, idxs: ArrayLike<number>, keys: (string | null)[], each: CellFn, row?: (r: number) => void) {
    const t = this.tape;
    for (let r = 0; r < idxs.length; r++) {
      const it = items[idxs[r]];
      const obj = kindOf(t, it) === OBJ;
      // (A wide item's members by name, read once: the last of a name, as `member` finds it.)
      let wide: Map<string, number> | null = null;
      if (obj && keys.length > 1 && sizeOf(t, it) > 13 && childCount(t, it) > 12) {
        wide = new Map();
        for (let c = it + 1, end = nextOf(t, it); c < end; c = nextOf(t, c)) wide.set(keyOf(t, c) as string, c);
      }
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const c = key === null ? (obj ? -1 : it) : !obj ? -1 : wide ? (wide.get(key) ?? -1) : this.member(it, key);
        const kind = c < 0 ? -1 : kindOf(t, c);
        if (each(r, k, kind, kind < 0 || kind >= ARR ? null : valueOf(t, c, this.src), c)) break;
      }
      row?.(r);
    }
  }

  count(i: number): number {
    if (!isContainerAt(this.tape, i)) return 0;
    // (A container's subtree size bounds its children: a small one is counted at once.)
    if (sizeOf(this.tape, i) <= 64) return childCount(this.tape, i);
    let k = this.counts.get(i);
    if (k === undefined) this.counts.set(i, (k = childCount(this.tape, i)));
    return k;
  }

  pos(i: number): number {
    const t = this.tape;
    if (keyKindOf(t, i) === KEY_INDEX) return keyOf(t, i) as number;
    const p = parentOf(t, i);
    if (p < 0) return 0;
    if (sizeOf(t, p) <= 64) {
      let k = 0;
      for (let c = p + 1; c < i; c = nextOf(t, c)) k++;
      return k;
    }
    let list = this.kidLists.get(p);
    if (!list) this.kidLists.set(p, (list = this.kids(p)));
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  key(i: number): Key {
    return keyOf(this.tape, i);
  }

  /** The last member of object `i` named `key` (the value every view reads), or -1. */
  private member(i: number, key: string): number {
    const t = this.tape;
    const end = nextOf(t, i);
    let m = -1;
    for (let c = i + 1; c < end; c = nextOf(t, c)) if (keyOf(t, c) === key) m = c;
    return m;
  }

  preview(n: JNode): string {
    // As format.ts preview, whose output ends within 90 characters: from the first children only.
    const t = this.tape;
    const isObj = n.t === OBJ;
    const end = nextOf(t, n.zi);
    let s = isObj ? '{' : '[';
    for (let c = n.zi + 1, k = 0; c < end; c = nextOf(t, c), k++) {
      if (s.length > 90) {
        s += ', …';
        break;
      }
      const kind = kindOf(t, c);
      const v = kind === OBJ ? (sizeOf(t, c) > 1 ? '{…}' : '{}') : kind === ARR ? (sizeOf(t, c) > 1 ? '[…]' : '[]') : primText(this.make(c, n), 40);
      s += (k ? ', ' : '') + (isObj ? keyLabel(clip(keyOf(t, c) as string, 40)) + ': ' + v : v);
    }
    return s + (isObj ? '}' : ']');
  }

  child(n: JNode, k: string | number): JNode | null {
    const t = this.tape;
    const end = nextOf(t, n.zi);
    if (n.t === OBJ) {
      // (Of a duplicated key, the last: see member.)
      const c = this.member(n.zi, String(k));
      return c < 0 ? null : this.at(c);
    }
    if (typeof k !== 'number' && !/^\d+$/.test(k)) return null;
    let want = Number(k);
    for (let c = n.zi + 1; c < end; c = nextOf(t, c)) if (want-- === 0) return this.at(c);
    return null;
  }

  nodeAtOffset(off: number): JNode | null {
    const i = nodeAtOffset(this.tape, off, this.src);
    return i < 0 ? null : this.at(i);
  }

  json(i: number): string {
    return stringify(this.make(i, null), '');
  }

  rows(n: JNode, exp: Expansion | undefined, self: boolean, limit: number, first: number): Int32Array {
    const t = this.tape;
    const a = t.nodes;
    let out = new Int32Array(Math.min(sizeOf(t, n.zi), 1 << 16));
    let len = 0;
    // As TreeView.flatten: the open containers being listed, where each is in them, its end and depth, and
    // its place in the overrides; and which it is and how many items it has had (its count once listed).
    const useT = !!exp?.children;
    const ps: number[] = [];
    const at: number[] = [];
    const ends: number[] = [];
    const depths: number[] = [];
    const exps: (Expansion | undefined)[] = [];
    const ks: number[] = [];
    /** Lists container `i` (at depth `d`, overrides `e`): open or not, and its items next if open. */
    const container = (i: number, d: number, e: Expansion | undefined, next: number) => {
      const open = e?.open ?? (d < limit || (first > 0 && len + 1 < first && len + 1 + this.childrenUpToAt(i, first) < first));
      out[len++] = i * 2 + (open ? 1 : 0);
      if (open) {
        ps.push(i);
        at.push(i + 1);
        ends.push(next);
        depths.push(d + 1);
        exps.push(e);
        ks.push(0);
      }
    };
    if (self) {
      if (isContainerAt(t, n.zi)) container(n.zi, n.d, exp, nextOf(t, n.zi));
      else out[len++] = n.zi * 2;
    } else {
      ps.push(n.zi);
      at.push(n.zi + 1);
      ends.push(nextOf(t, n.zi));
      depths.push(n.d + 1);
      exps.push(exp);
      ks.push(0);
    }
    while (at.length) {
      const q = at.length - 1;
      const c = at[q];
      if (c >= ends[q]) {
        // (A big container's count kept, as count() keeps it: the rows' setsize would walk its items again,
        // a cache miss each.)
        if (ends[q] - ps[q] > 64) this.counts.set(ps[q], ks[q]);
        ps.pop();
        at.pop();
        ends.pop();
        depths.pop();
        exps.pop();
        ks.pop();
        continue;
      }
      const meta = a[c * W];
      const s = meta >>> 8;
      const next = c + (s < SIZE_BIG ? s : t.big!.get(c)!);
      at[q] = next;
      ks[q]++;
      if (len === out.length) {
        const grown = new Int32Array(len * 2);
        grown.set(out);
        out = grown;
      }
      // (A leaf: a row, no more to decide.)
      if ((meta & 7) < ARR) {
        out[len++] = c * 2;
        continue;
      }
      // (A container, as `container` does, inline: a call each costs a records array's rows.)
      const d = depths[q];
      const e = useT ? exps[q]?.children?.get(String(keyOf(t, c))) : undefined;
      const open = e?.open ?? (d < limit || (first > 0 && len + 1 < first && len + 1 + this.childrenUpToAt(c, first) < first));
      out[len++] = c * 2 + (open ? 1 : 0);
      if (open) {
        ps.push(c);
        at.push(c + 1);
        ends.push(next);
        depths.push(d + 1);
        exps.push(e);
        ks.push(0);
      }
    }
    return len === out.length ? out : out.slice(0, len);
  }

  rowOf(tr: TreeRows, i: number): number {
    // (Rows are in tape order.)
    let lo = 0;
    let hi = tr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const x = tr[mid] >> 1;
      if (x === i) return mid;
      if (x < i) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  toggle(tr: TreeRows | null, n: JNode, open: boolean, deep: boolean, exp: Expansion, limit: number, first: number): TreeRows | null {
    const t = this.tape;
    if (deep) {
      // Each container below gets its trie entry, by key, as TreeView's childExpansion makes them.
      const stack = [n.zi];
      const exps = [exp];
      while (stack.length) {
        const c = stack.pop()!;
        const e = exps.pop()!;
        e.open = open;
        for (let k = c + 1, end = nextOf(t, c); k < end; k = nextOf(t, k)) {
          if (!isContainerAt(t, k)) continue;
          const key = String(keyOf(t, k));
          let x = e.children?.get(key);
          if (!x) (e.children ??= new Map()).set(key, (x = {}));
          stack.push(k);
          exps.push(x);
        }
      }
    } else exp.open = open;
    const i = tr ? this.rowOf(tr, n.zi) : -1;
    if (i < 0) return null;
    // Its rows are those up to the end of its subtree on the tape.
    const rows = tr!;
    const end = nextOf(t, n.zi);
    let j = i + 1;
    for (let hi = rows.length; j < hi; ) {
      const mid = (j + hi) >> 1;
      if (rows[mid] >> 1 < end) j = mid + 1;
      else hi = mid;
    }
    const sub = open ? this.rows(n, exp, false, limit, first) : new Int32Array(0);
    const out = new Int32Array(rows.length - (j - i - 1) + sub.length);
    out.set(rows.subarray(0, i));
    out[i] = n.zi * 2 + (open ? 1 : 0);
    out.set(sub, i + 1);
    out.set(rows.subarray(j), i + 1 + sub.length);
    return out;
  }

  /** How many children `i` has, counted up to `max` (more: max + 1). */
  private childrenUpToAt(i: number, max: number): number {
    const t = this.tape;
    const end = nextOf(t, i);
    let k = 0;
    for (let c = i + 1; c < end && k <= max; c = nextOf(t, c)) k++;
    return k;
  }

  within(n: JNode, levels: number, max?: number): number {
    return nodesWithin(this.tape, n.zi, levels, max);
  }

  search(n: JNode, qn: string, cs: boolean, max: number): number[] {
    return tapeSearch(this.tape, this.src, n.zi, qn, cs, max);
  }

  nodeAt(root: JNode, i: number): JNode | null {
    return nodeAtIndex(root, i);
  }

  start(i: number): number {
    return startOf(this.tape, i);
  }

  containerAt(off: number): [number, number] | null {
    const c = containerOf(this.tape, nodeAtOffset(this.tape, off, this.src));
    return c < 0 ? null : [startOf(this.tape, c), endOf(this.tape, c)];
  }

  head(n: JNode, max: number): string {
    if (n._v !== undefined) return (n._v as string).slice(0, max);
    return decodeString(this.src, n.s, max);
  }

  /**
   * Makes container `n`'s children in steps (call with a deadline until it returns true), so a container
   * of millions doesn't make them all in one task when a view first reads them.
   */
  fillSteps(n: JNode): (until: number) => boolean {
    if (n.t < ARR || n._v !== undefined) return () => true;
    const t = this.tape;
    const end = nextOf(t, n.zi);
    const list: JNode[] = [];
    let c = n.zi + 1;
    return (until) => {
      // (Children made so far are where `at` looks for them meanwhile.)
      if (n._v === undefined) this.partial.set(n, list);
      while (c < end) {
        for (let k = 0; k < 4096 && c < end; k++, c = nextOf(t, c)) list.push(this.kid(c, n));
        if (c < end && performance.now() >= until) return false;
      }
      this.partial.delete(n);
      // (Read in one go meanwhile: those are the children.)
      if (n._v === undefined) n._v = list;
      return true;
    };
  }

  write(n: JNode, indent: string): string {
    return writeTape(this.tape, this.src, n.zi, indent);
  }

  fill(n: JNode): Val {
    const t = this.tape;
    const i = n.zi;
    if (n.t < ARR) return (n._v = valueOf(t, i, this.src));
    const list: JNode[] = [];
    const end = nextOf(t, i);
    // (Being made in steps: those made already are taken as they are.)
    const part = this.partial.size ? this.partial.get(n) : undefined;
    let c = i + 1;
    if (part) {
      for (const k of part) list.push(k);
      if (part.length) c = nextOf(t, part[part.length - 1].zi);
    }
    for (; c < end; c = nextOf(t, c)) list.push(this.kid(c, n));
    n._v = list;
    return list;
  }
}

/** The node at tape index `c` in `list` (children in tape order), if it is there. */
function childIn(list: JNode[], c: number): JNode | undefined {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const z = list[mid].zi;
    if (z === c) return list[mid];
    if (z < c) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** The tape's tree as a ParseResult whose nodes are made when read. */
export function lazyResult(tape: Tape, src: string): ParseResult {
  let root: JNode | null = null;
  if (tape.count) {
    const f = new Filler(tape, src);
    root = f.root = f.make(0, null);
  }
  return { ...tape.head, root };
}

/** The tape `n` was made from and its index there, if it was (a node edited since is not). */
export function tapeOfNode(n: JNode): { tape: Tape; src: string; i: number } | null {
  const z = n.z;
  return z instanceof Filler ? { tape: z.tape, src: z.src, i: n.zi } : null;
}

/** Whether `n`'s children have been made. */
export const filled = (n: JNode) => n._v !== undefined;

/** How many of `root`'s nodes have been made and are still held (tests): in its children lists, and made one at a time. */
export function madeCount(root: JNode | null): number {
  const z = root?.z;
  const stack = root ? [root, ...(z instanceof Filler ? z.held() : [])] : [];
  let k = 0;
  while (stack.length) {
    const n = stack.pop()!;
    k++;
    if (n.t >= ARR && n._v !== undefined) for (const c of n._v as JNode[]) stack.push(c);
  }
  return k;
}

/**
 * The node at tape index `i` of the tree whose root is `root` (made from that tape), made with its ancestors
 * but not their other children (see Filler.at), or null if `i` isn't in it.
 */
export function nodeAtIndex(root: JNode, i: number): JNode | null {
  const z = root.z;
  if (!(z instanceof Filler) || i < root.zi || i >= nextOf(z.tape, root.zi)) return null;
  return z.at(i);
}

/**
 * Tree search on a tape: the indexes of the nodes under `from` whose property name or value contains
 * `qn` (lowercased unless `cs`), in document order, at most `max`. The same test as on nodes
 * (TreeView.search), each property name tested once.
 */
const PRINTABLE_RUN = /^[\x20-\x7e]+$/;

/** Escapes, read in pairs: group 1 is set for one that can make a printable character or join two parts of a string (see tapeSearch). */
const ESCAPE = /\\(?:["\\/bfnrt']|([\s\S]))/g;

/** Where the first escape in `src` from `at` (a string's text) that isn't a quote, slash or control character starts. */
function riskyEscape(src: string, at: number): number {
  ESCAPE.lastIndex = at;
  for (let m; (m = ESCAPE.exec(src)); ) if (m[1] !== undefined) return m.index;
  return Infinity;
}

export function tapeSearch(t: Tape, src: string, from: number, qn: string, cs: boolean, max: number): number[] {
  const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
  // A query of printable ASCII is looked for in the source text itself, one search forward through it, so a
  // string without escapes isn't copied (and lowercased) to be searched; one it may be in is then checked
  // as above. (Lowercased, İ and the Kelvin sign hold an ASCII i and k: they are looked for too.)
  const find = qn && /^[\x20-\x7e]+$/.test(qn)
    ? new RegExp(qn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/i/g, '(?:i|\u0130)').replace(/k/g, '[k\u212a]'), cs ? 'g' : 'gi')
    : null;
  let next = -1;
  // A string with escapes is found the same way when none can make the query's characters or join two parts
  // of it: escapes of quotes, slashes and control characters only (\u, \x and the rest are read decoded).
  const quoteless = !!find && !/["'\\/]/.test(qn);
  let risky = -1;
  const keyHit = new Int8Array(t.keys.length);
  const nul = has('null');
  const yes = has('true');
  const no = has('false');
  const out: number[] = [];
  const end = nextOf(t, from);
  const a = t.nodes;
  for (let i = from; i < end && out.length < max; i++) {
    let hit = false;
    if (keyKindOf(t, i) === KEY_NAME) {
      const k = a[i * W + 4];
      if (!keyHit[k]) keyHit[k] = has(t.keys[k]) ? 1 : 2;
      hit = keyHit[k] === 1;
    }
    if (!hit) {
      const kind = kindOf(t, i);
      const vk = kind === STR && find ? valueKindOf(t, i) : -1;
      if (vk === VALUE_SLICE || (vk === VALUE_DECODE && quoteless)) {
        // (Its text is src[s, e), as valueOf reads it.)
        const s = a[i * W + 1] + 1;
        const e = a[i * W + 2] - 1;
        if (vk === VALUE_DECODE && risky < s) risky = riskyEscape(src, s);
        if (vk === VALUE_DECODE && risky < e) hit = has(valueOf(t, i, src) as string);
        else {
          if (next < s) {
            find!.lastIndex = s;
            next = find!.exec(src)?.index ?? Infinity;
          }
          // (A match of ASCII characters only in a string without escapes is one in its value, as written there.
          // In a string with escapes it may take an escape's letter (\t's t): the value is checked, as is a
          // match through İ or the Kelvin sign. A match in the value is always one in the text: printable
          // characters other than quotes and slashes come from no escape.)
          hit = next + qn.length <= e && (vk === VALUE_SLICE && PRINTABLE_RUN.test(src.slice(next, next + qn.length)) || has(valueOf(t, i, src) as string));
        }
      } else if (kind === STR || kind === NUM) hit = has(valueOf(t, i, src) as string);
      else if (kind === BOOL) hit = valueOf(t, i, src) ? yes : no;
      else if (kind === NUL) hit = nul;
    }
    if (hit) out.push(i);
  }
  return out;
}
