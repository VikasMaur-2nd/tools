/*
 * The huge tree's rows, worked out from what is open instead of listed: no array proportional to the
 * document (or to an open container of millions) is ever made.
 *
 * Each open container (`Open`) lists a window of its items, PAGE at a time ("Show next 1,000"), and its
 * open items by index. A row is found from its number by walking the open containers, skipping runs of
 * closed items in one step, so finding one costs about the open items above it, whatever the item counts.
 * Nodes are read from the source a page of FETCH at a time and kept in a bounded cache (NodeCache).
 */
import { ARR } from '../json/parser';
import { nodeBytes, type HugeNode, type HugeSource } from './source';

/** Items an open container lists per page ("Show next 1,000"). */
export const PAGE = 1000;
/** Items an open container lists at most at once: past it, its window slides. */
export const MAX_WINDOW = 50_000;
/** Items read from the source per request. */
export const FETCH = 200;
/** Pages of FETCH nodes kept (the least recently used go first)... */
export const CACHE_PAGES = 400;
/** ...and their bytes at most (nodeBytes: texts and names): a page of long strings weighs ~800 KB, of records ~40 KB. */
export const CACHE_BYTES = 16 << 20;

export class Open {
  /** The items listed: [from, from + shown), cut to the count. */
  from = 0;
  shown = PAGE;
  /** Open items by index, and their indexes in order. */
  readonly kids = new Map<number, Open>();
  order: number[] = [];
  /** Rows of this container's subtree, its own row included (see TreeModel.recount). */
  rows = 1;

  constructor(
    public node: HugeNode,
    /** Item indexes from the root down to this container. */
    readonly path: readonly number[],
  ) {}

  /** How many items are listed now. */
  get listed() {
    return Math.max(0, Math.min(this.shown, this.node.count - this.from));
  }

  /** Items before the window (a "Show previous" row). */
  get before() {
    return this.from > 0;
  }

  /** Items after the window, known or still to be indexed (a "Show next" row). */
  get after() {
    return this.from + this.listed < this.node.count;
  }
}

/** A row: a value (the root, or item `i` of `parent`), or a paging row of `parent`. */
export type Row =
  | { kind: 'node'; parent: Open | null; i: number; depth: number; open: Open | null }
  | { kind: 'prev' | 'next'; parent: Open; depth: number };

/** What the cursor is on: a value by its index path, or a container's paging row. */
export interface Cursor {
  path: readonly number[];
  kind: 'node' | 'prev' | 'next';
}

const sameCursor = (a: Cursor | null, b: Cursor | null) => !!a && !!b && a.kind === b.kind && a.path.length === b.path.length && a.path.every((x, k) => x === b.path[k]);

export class TreeModel {
  root: Open | null = null;
  cursor: Cursor | null = null;

  /** Sets the root (a new document), everything closed but it. */
  setRoot(node: HugeNode) {
    this.root = new Open(node, []);
    this.cursor = null;
    this.recount();
  }

  get count() {
    return this.root ? this.root.rows : 0;
  }

  /** Recounts every open container's rows (after a change to what is open, a window or a count). */
  recount() {
    const visit = (o: Open): number => {
      let rows = 1 + (o.before ? 1 : 0) + o.listed + (o.after ? 1 : 0);
      const end = o.from + o.listed;
      for (const k of o.order) if (k >= o.from && k < end) rows += visit(o.kids.get(k)!) - 1;
      return (o.rows = rows);
    };
    if (this.root) visit(this.root);
  }

  /** The open container at `path` (null: it or one above it is closed). */
  openAt(path: readonly number[]): Open | null {
    let o = this.root;
    for (let k = 0; o && k < path.length; k++) o = o.kids.get(path[k]) ?? null;
    return o;
  }

  /** Row `r`. */
  rowAt(r: number): Row | null {
    const root = this.root;
    if (!root || r < 0 || r >= root.rows) return null;
    let o = root;
    let parent: Open | null = null;
    let i = 0;
    for (let depth = 0; ; depth++) {
      if (r === 0) return { kind: 'node', parent, i, depth, open: o };
      r--;
      if (o.before) {
        if (r === 0) return { kind: 'prev', parent: o, depth: depth + 1 };
        r--;
      }
      const end = o.from + o.listed;
      let pos = o.from;
      let into: Open | null = null;
      for (const k of o.order) {
        if (k < pos || k >= end) continue;
        const closed = k - pos;
        if (r < closed) return { kind: 'node', parent: o, i: pos + r, depth: depth + 1, open: null };
        r -= closed;
        const kid = o.kids.get(k)!;
        if (r < kid.rows) {
          into = kid;
          i = k;
          break;
        }
        r -= kid.rows;
        pos = k + 1;
      }
      if (into) {
        parent = o;
        o = into;
        continue;
      }
      if (r < end - pos) return { kind: 'node', parent: o, i: pos + r, depth: depth + 1, open: null };
      r -= end - pos;
      return r === 0 && o.after ? { kind: 'next', parent: o, depth: depth + 1 } : null;
    }
  }

  /** The row of the value at index path `path` (-1: hidden in a closed container or outside its window). */
  rowOf(path: readonly number[]): number {
    let o = this.root;
    if (!o) return -1;
    let row = 0;
    for (let d = 0; d < path.length; d++) {
      const idx = path[d];
      if (idx < o.from || idx >= o.from + o.listed) return -1;
      row += 1 + (o.before ? 1 : 0) + (idx - o.from);
      for (const k of o.order) {
        if (k >= idx) break;
        if (k >= o.from) row += o.kids.get(k)!.rows - 1;
      }
      if (d === path.length - 1) break;
      const next = o.kids.get(idx);
      if (!next) return -1;
      o = next;
    }
    return row;
  }

  /** The row the cursor is on (-1: none, or hidden). */
  cursorRow(c: Cursor | null = this.cursor): number {
    if (!c) return -1;
    if (c.kind === 'node') return this.rowOf(c.path);
    const o = this.openAt(c.path);
    if (!o) return -1;
    const at = this.rowOf(c.path);
    if (at < 0) return -1;
    if (c.kind === 'prev') return o.before ? at + 1 : -1;
    return o.after ? at + o.rows - 1 : -1;
  }

  /** The cursor for row `r`. */
  cursorOf(row: Row): Cursor {
    if (row.kind !== 'node') return { path: row.parent.path, kind: row.kind };
    return { path: row.parent ? [...row.parent.path, row.i] : [], kind: 'node' };
  }

  /** Moves the cursor to row `r` (true if it moved). */
  moveTo(r: number): boolean {
    const row = this.rowAt(r);
    if (!row) return false;
    const c = this.cursorOf(row);
    if (sameCursor(c, this.cursor)) return false;
    this.cursor = c;
    return true;
  }

  /** Opens container `node`, item `i` of `parent` (the root: parent null). */
  open(parent: Open | null, i: number, node: HugeNode): Open | null {
    if (node.t < ARR) return null;
    if (!parent) return this.root;
    let o = parent.kids.get(i);
    if (o) {
      o.node = node;
      return o;
    }
    o = new Open(node, [...parent.path, i]);
    parent.kids.set(i, o);
    parent.order = insertSorted(parent.order, i);
    this.recount();
    return o;
  }

  /** Closes item `i` of `parent` (its items' state goes with it); a cursor inside it moves onto it. */
  close(parent: Open, i: number) {
    if (!parent.kids.delete(i)) return;
    parent.order = parent.order.filter((k) => k !== i);
    const c = this.cursor;
    const p = parent.path;
    if (c && c.path.length > p.length && p.every((x, k) => x === c.path[k]) && c.path[p.length] === i && (c.path.length > p.length + 1 || c.kind !== 'node')) {
      this.cursor = { path: [...p, i], kind: 'node' };
    }
    this.recount();
  }

  /** Closes everything but the root. */
  collapseAll() {
    const root = this.root;
    if (!root) return;
    root.kids.clear();
    root.order = [];
    root.from = 0;
    root.shown = PAGE;
    this.cursor = { path: [], kind: 'node' };
    this.recount();
  }

  /** "Show next 1,000": lists the next page (the window slides past MAX_WINDOW). */
  next(o: Open) {
    o.shown += PAGE;
    if (o.shown > MAX_WINDOW) {
      const drop = o.shown - MAX_WINDOW;
      o.from += drop;
      o.shown = MAX_WINDOW;
    }
    this.recount();
  }

  /** "Show previous 1,000". */
  prev(o: Open) {
    const from = Math.max(0, o.from - PAGE);
    o.shown = Math.min(MAX_WINDOW, o.shown + (o.from - from));
    o.from = from;
    this.recount();
  }

  /** Makes item `i` of `o` listed: the window grows to it when near, else moves to its page. */
  show(o: Open, i: number) {
    if (i >= o.from && i < o.from + o.shown) return;
    const page = Math.floor(i / PAGE) * PAGE;
    if (i >= o.from && page + PAGE - o.from <= MAX_WINDOW) o.shown = page + PAGE - o.from;
    else if (i < o.from && o.from + o.shown - page <= MAX_WINDOW) {
      o.shown += o.from - page;
      o.from = page;
    } else {
      o.from = page;
      o.shown = PAGE;
    }
    this.recount();
  }

  /**
   * Opens the containers along `chain` (nodes from the root down, as the source's resolve/locate give them)
   * and lists each next one, then puts the cursor on its last node. Returns its index path.
   */
  reveal(chain: readonly HugeNode[]): number[] {
    let o = this.root;
    const path: number[] = [];
    if (!o || !chain.length) return path;
    o.node = chain[0];
    for (let k = 1; k < chain.length; k++) {
      const n = chain[k];
      this.show(o, n.i);
      path.push(n.i);
      if (k === chain.length - 1) break;
      o = this.open(o, n.i, n)!;
    }
    this.recount();
    this.cursor = { path, kind: 'node' };
    return path;
  }

  /** Every open container, the root first (to refresh the counts of those still being indexed). */
  opens(): Open[] {
    const out: Open[] = [];
    const visit = (o: Open) => {
      out.push(o);
      for (const k of o.order) visit(o.kids.get(k)!);
    };
    if (this.root) visit(this.root);
    return out;
  }
}

function insertSorted(xs: number[], v: number) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return [...xs.slice(0, lo), v, ...xs.slice(lo)];
}

/**
 * Items of open containers read from the source FETCH at a time, kept for the pages used last (CACHE_PAGES,
 * CACHE_BYTES; never the ones in view). `get` answers from what is here and asks for what is missing; `loaded` is
 * called as pages arrive.
 */
export class NodeCache {
  /**
   * Pages by container and number: the items read so far (a source may answer with fewer than asked: the
   * rest is asked for next), whether the last read added none (not asked again until a refresh), their bytes.
   */
  private pages = new Map<string, { list: HugeNode[]; stuck: boolean; bytes: number }>();
  private bytes = 0;
  /** The pages of the rows drawn last (keepOnly): kept whatever they weigh. */
  private inView = new Set<string>();
  private asked = new Map<string, AbortController>();
  /** Called when asked-for pages arrive (redraw). */
  loaded: () => void = () => undefined;
  /** Called when a read fails (not aborted). */
  failed: (e: unknown) => void = () => undefined;
  private gen = 0;

  constructor(private readonly src: Pick<HugeSource, 'children'>) {}

  private key(parent: HugeNode, page: number) {
    return `${parent.at}:${parent.depth}:${page}`;
  }

  /** Item `i` of `parent`, if read (and asks for what its page lacks if not). */
  get(parent: HugeNode, i: number): HugeNode | undefined {
    const page = Math.floor(i / FETCH);
    const key = this.key(parent, page);
    const have = this.pages.get(key);
    if (have) {
      // Most recently used last.
      this.pages.delete(key);
      this.pages.set(key, have);
      const n = have.list[i - page * FETCH];
      if (n) return n;
      // (A page read before the index got that far, or answered in part: the rest is read now.)
      if (!have.stuck && i < parent.count && !this.asked.has(key)) this.fetch(parent, page, key, have.list);
      return undefined;
    }
    if (!this.asked.has(key)) this.fetch(parent, page, key, []);
    return undefined;
  }

  /** Is item `i` of `parent` being read? */
  pending(parent: HugeNode, i: number) {
    return this.asked.has(this.key(parent, Math.floor(i / FETCH)));
  }

  private fetch(parent: HugeNode, page: number, key: string, have: HugeNode[]) {
    const c = new AbortController();
    this.asked.set(key, c);
    const gen = this.gen;
    this.src.children(parent, page * FETCH + have.length, FETCH - have.length, c.signal).then(
      (got) => {
        if (gen !== this.gen || this.asked.get(key) !== c) return;
        this.asked.delete(key);
        const list = got.length ? have.concat(got) : have;
        let bytes = 0;
        for (const n of list) bytes += nodeBytes(n);
        this.put(key, { list, stuck: !got.length, bytes });
        if (got.length) this.loaded();
      },
      (e: unknown) => {
        if (this.asked.get(key) === c) this.asked.delete(key);
        if (!c.signal.aborted && gen === this.gen) this.failed(e);
      },
    );
  }

  /** Keeps a page read, letting go of the ones used longest ago (not `key`, nor those in view) past the limits. */
  private put(key: string, p: { list: HugeNode[]; stuck: boolean; bytes: number }) {
    this.drop(key);
    this.pages.set(key, p);
    this.bytes += p.bytes;
    for (const k of this.pages.keys()) {
      if (this.pages.size <= CACHE_PAGES && this.bytes <= CACHE_BYTES) break;
      if (k !== key && !this.inView.has(k)) this.drop(k);
    }
  }

  private drop(key: string) {
    const p = this.pages.get(key);
    if (!p) return;
    this.pages.delete(key);
    this.bytes -= p.bytes;
  }

  /** Drops the pages of containers still being indexed (their last pages grow), or all. */
  refresh(all = false) {
    if (all) {
      this.clear();
      return;
    }
    for (const [key, p] of this.pages) if (p.list.length < FETCH) this.drop(key);
  }

  /** Stops every read and forgets every page. */
  clear() {
    this.gen++;
    for (const c of this.asked.values()) c.abort();
    this.asked.clear();
    this.pages.clear();
    this.bytes = 0;
  }

  /** The view draws the rows of the pages `keep`: they stay; reads of others (scrolled away) stop. */
  keepOnly(keep: Set<string>) {
    this.inView = keep;
    for (const [key, c] of this.asked) {
      if (keep.has(key)) continue;
      c.abort();
      this.asked.delete(key);
    }
  }

  /** The page key of item `i` of `parent` (see keepOnly). */
  pageKey(parent: HugeNode, i: number) {
    return this.key(parent, Math.floor(i / FETCH));
  }

  get size() {
    return this.pages.size;
  }

  /** nodeBytes of the pages kept. */
  get weight() {
    return this.bytes;
  }
}
