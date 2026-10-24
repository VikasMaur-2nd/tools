/**
 * Tree expansion model frozen from 5e5fac3 for differential tests. Keep the old
 * path strings, traversal and row splicing unchanged. Only the browser renderer
 * and constructor are replaced with no-ops and a supplied scroll model. One
 * deliberate change since: a path segment is quoted, so a key holding SEP is one
 * segment (it used to read as a nested path: "a\u0001b" aliased a.b).
 */
import { ARR, JNode, kids } from '../../lib/json/parser';

const RH = 24;
const SEP = String.fromCharCode(1);
const seg = (n: JNode) => SEP + JSON.stringify(String(n.key));
const keyOf = (n: JNode) => {
  let k = '';
  for (let p: JNode | null = n; p && p.u; p = p.u) k = seg(p) + k;
  return k;
};

export class OldTreeView {
  root: JNode | null = null;
  rows: JNode[] = [];
  sel: JNode | null = null;
  private limit = Infinity;
  private dirty = false;
  private toggles = new Map<string, boolean>();
  matches: JNode[] = [];
  private matchSet: Set<JNode> | null = null;
  private sizer = {} as HTMLElement;
  constructor(readonly el: { clientHeight: number }, readonly sc: { top: number; fit(height: number, sizer: HTMLElement): void }) {}
  render(_force: boolean) {} // eslint-disable-line @typescript-eslint/no-unused-vars

  setRoot(root: JNode | null, reset: boolean, nodes = 0, active = true) {
    if (reset) {
      this.toggles.clear();
      this.limit = nodes <= 50_000 ? Infinity : nodes <= 500_000 ? 3 : 2;
      this.sc.top = 0;
    }
    this.root = root;
    this.sel = null;
    this.dirty = true;
    if (active || !root) this.activate();
  }

  /** Drop obsolete node objects while Format retains the newer packed tree. Keep expansion and scroll. */
  releaseRoot() {
    this.root = null;
    this.rows = [];
    this.sel = null;
    this.matches = [];
    this.matchSet = null;
    this.dirty = true;
  }

  /** A hidden view retains its settings and selection without flattening the new tree. */
  activate() {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
    if (this.sel) this.reveal(this.sel);
  }

  private rebuild() {
    this.rows = this.root ? this.flatten(this.root, '', true) : [];
    this.sc.fit(this.rows.length * RH, this.sizer);
    this.render(true);
  }

  private flatten(start: JNode, startKey: string, self: boolean): JNode[] {
    const rows: JNode[] = [];
    const useT = this.toggles.size > 0;
    const limit = this.limit;
    // Open containers being listed (a list rather than the call stack, so any depth can be shown):
    // their items, the next item, and their toggle key.
    const lists: JNode[][] = [];
    const at: number[] = [];
    const keys: string[] = [];
    const visit = (n: JNode, key: string) => {
      rows.push(n);
      if (n.t < ARR) return;
      let open = n.d < limit;
      if (useT) {
        const t = this.toggles.get(key);
        if (t !== undefined) open = t;
      }
      n.x = open;
      if (open) {
        lists.push(kids(n));
        at.push(0);
        keys.push(key);
      }
    };
    if (self) visit(start, startKey);
    else {
      lists.push(kids(start));
      at.push(0);
      keys.push(startKey);
    }
    while (lists.length) {
      const d = lists.length - 1;
      const list = lists[d];
      const i = at[d]++;
      if (i < list.length) visit(list[i], useT ? keys[d] + seg(list[i]) : '');
      else {
        lists.pop();
        at.pop();
        keys.pop();
      }
    }
    return rows;
  }

  indexOf(n: JNode) {
    const r = this.rows;
    let lo = 0;
    let hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const x = r[mid];
      if (x === n) return mid;
      if (x.s < n.s || (x.s === n.s && x.d < n.d)) lo = mid + 1;
      else hi = mid - 1;
    }
    return r.indexOf(n);
  }

  toggle(n: JNode, open = !n.x, deep = false) {
    if (n.t < ARR) return;
    if (deep) {
      const stack = [n];
      while (stack.length) {
        const c = stack.pop() as JNode;
        if (c.t < ARR) continue;
        this.toggles.set(keyOf(c), open);
        for (const k of kids(c)) if (k.t >= ARR) stack.push(k);
      }
    } else this.toggles.set(keyOf(n), open);
    n.x = open;
    const i = this.indexOf(n);
    if (i < 0) {
      this.rebuild();
      return;
    }
    let j = i + 1;
    while (j < this.rows.length && this.rows[j].d > n.d) j++;
    const sub = open ? this.flatten(n, keyOf(n), false) : [];
    this.rows = this.rows.slice(0, i + 1).concat(sub, this.rows.slice(j));
    this.sc.fit(this.rows.length * RH, this.sizer);
    this.render(true);
  }

  expandAll() {
    this.limit = Infinity;
    this.toggles.clear();
    this.rebuild();
    this.scrollToSel(true);
  }

  collapseAll() {
    this.limit = 1;
    this.toggles.clear();
    this.rebuild();
    this.sc.top = 0;
  }

  expandTo(level: number) {
    this.limit = level;
    this.toggles.clear();
    this.rebuild();
  }

  /** Expands every collapsed ancestor of `n`. */
  reveal(n: JNode) {
    let changed = false;
    for (let p = n.u; p; p = p.u) {
      if (!p.x) {
        p.x = true;
        this.toggles.set(keyOf(p), true);
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  select(n: JNode | null, opts: { scroll?: boolean; center?: boolean } = {}) {
    this.sel = n;
    if (this.dirty) return;
    if (n) {
      this.reveal(n);
      if (opts.scroll !== false) this.scrollToSel(!!opts.center);
    }
    this.render(true);
  }

  private scrollToSel(center: boolean) {
    if (!this.sel) return;
    const i = this.indexOf(this.sel);
    if (i < 0) return;
    const top = i * RH;
    const st = this.sc.top;
    const vh = this.el.clientHeight;
    if (top < st || top + RH > st + vh) {
      this.sc.top = center ? top - vh / 2 + RH / 2 : top < st ? top : top - vh + RH;
    }
  }

}
