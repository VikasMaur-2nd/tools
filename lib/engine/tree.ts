import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { preview } from '../json/format';
import { parsePath, resolve } from '../json/path';
import { idle } from './idle';
import type { ValueHint } from '../json/smart';
import { escapeHtml } from './highlight';
import { TallScroll } from './tall';
import { rt } from '../i18n/ui';
import { PRIVATE } from '../analytics';

/** Value hints (dates, JWTs, nested JSON…) load after first paint: they're just tooltips. */
let valueHints: ((n: JNode) => ValueHint[]) | null = null;
let hintsLoading = false;

/*
 * Virtualized tree: only the rows in view (+ overscan) exist in the DOM.
 * Rows are a flat array of visible nodes in document order; expand/collapse
 * splices that array instead of rebuilding it.
 */

const RH = 24;
const IND = 16;
const IND_DEPTH = 30;
const OVERSCAN = 24;
const MAX_MATCHES = 100_000;

const COLOR = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\(\s*[\d.%\s,/+-]+\))$/i;
const URL_RE = /^https?:\/\/[^\s"<>]+$/i;

export interface TreeEvents {
  select(node: JNode, how: 'pointer' | 'key' | 'search'): void;
  copy(node: JNode, what: 'value' | 'path'): void;
  open(node: JNode): void;
  escape(): void;
  /** Expand a string that contains JSON into real JSON. */
  nested(node: JNode): void;
}

/** Persistent path overrides, shared by successive parses without retaining JNodes. */
interface Expansion {
  open?: boolean;
  children?: Map<string, Expansion>;
}

function childExpansion(parent: Expansion | undefined, n: JNode, create = false): Expansion | undefined {
  if (!parent) return;
  // One edge per property name, whatever it holds. Duplicate keys share a path, as do an index and the
  // same digits as a key (an edit that turns an array into an object keeps its items' state).
  const key = String(n.key);
  let child = parent.children?.get(key);
  if (!child && create) (parent.children ??= new Map()).set(key, (child = {}));
  return child;
}

/** `n`'s place among its parent's items, which are in document order: found by offset, not by a scan (wide objects). */
function siblingIndex(n: JNode) {
  const list = kids(n.u as JNode);
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = list[mid];
    if (x === n) return mid;
    if (x.s < n.s) lo = mid + 1;
    else hi = mid - 1;
  }
  return list.indexOf(n);
}

/** Rows a new big document opens with at most (fewer levels open when they would be more; the root's always). */
const OPEN_ROWS = 500_000;
/** With fewer levels open: deeper containers open too while the rows before them are fewer than this (the first records show whole). */
const FIRST_ROWS = 2_000;

/**
 * How many levels a new document opens with: all of a small one, three or two of a bigger one, and fewer
 * when that many rows would be more than OPEN_ROWS (a tree from a tape counts them there; a tree from the
 * page's parser has every node made already, so only its rows cost). And whether that took levels away.
 */
function openLevels(root: JNode | null, nodes: number): [number, boolean] {
  if (nodes <= 50_000) return [Infinity, false];
  const most = nodes <= 500_000 ? 3 : 2;
  let levels = most;
  const z = root?.z;
  if (z) while (levels > 1 && z.within(root!, levels) > OPEN_ROWS) levels--;
  return [levels, levels < most];
}

export class TreeView {
  readonly el: HTMLElement;
  private sizer: HTMLElement;
  private sc: TallScroll;
  private rowsEl: HTMLElement;
  private acts: HTMLElement;
  private ev: TreeEvents;
  private expandTip = escapeHtml(rt('Expand this JSON string into real JSON'));
  private ro: ResizeObserver;

  root: JNode | null = null;
  rows: JNode[] = [];
  sel: JNode | null = null;
  private limit = Infinity;
  /** The first containers one level past `limit` open too (see FIRST_ROWS). */
  private first = false;
  /** The next root is a new document's: how many levels it opens with is still to decide. */
  private newDoc = false;
  private dirty = false;
  private toggles: Expansion = {};
  private q = '';
  private qn = '';
  private cs = false;
  matches: JNode[] = [];
  private matchSet: Set<JNode> | null = null;
  /** A search on a tree made from a tape: its matches' tape indexes, in document order (else null: `matches`). */
  private hits: number[] | null = null;
  private hitSet: Set<number> | null = null;
  mi = -1;
  private rFirst = -1;
  private rLast = -1;
  /** translateY of the drawn rows. */
  private y = NaN;
  private raf = 0;
  private hover = -1;

  constructor(el: HTMLElement, ev: TreeEvents) {
    this.el = el;
    this.ev = ev;
    this.sizer = el.querySelector('.tv-sizer') as HTMLElement;
    this.sc = new TallScroll(el);
    this.rowsEl = el.querySelector('.tv-rows') as HTMLElement;
    this.acts = el.querySelector('.tv-acts') as HTMLElement;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    el.addEventListener('dblclick', this.onDbl);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('mouseover', this.onOver);
    el.addEventListener('mouseleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
  }

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('dblclick', this.onDbl);
    this.el.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('mouseover', this.onOver);
    this.el.removeEventListener('mouseleave', this.onLeave);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
  }

  // ── Model ──────────────────────────────────────────────────────────────

  setRoot(root: JNode | null, reset: boolean, nodes = 0, active = true) {
    if (reset) {
      this.toggles = {};
      this.sc.top = 0;
    }
    // (A new document's first tree may come after a release: see releaseRoot.)
    if (reset || this.newDoc) {
      [this.limit, this.first] = openLevels(root, nodes);
      this.newDoc = false;
    }
    this.root = root;
    this.sel = null;
    this.dirty = true;
    if (active || !root) this.activate();
  }

  /** Drop obsolete node objects while Format retains the newer packed tree. Keep expansion and scroll, unless it is a new document (`reset`). */
  releaseRoot(reset = false) {
    if (reset) {
      this.toggles = {};
      this.sc.top = 0;
      this.newDoc = true;
    }
    this.root = null;
    this.rows = [];
    this.sel = null;
    this.matches = [];
    this.matchSet = null;
    this.hits = this.hitSet = null;
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
    this.rows = this.root ? this.flatten(this.root, this.toggles, true) : [];
    this.sc.fit(this.rows.length * RH, this.sizer);
    this.render(true);
  }

  private flatten(start: JNode, startExpansion: Expansion | undefined, self: boolean): JNode[] {
    const rows: JNode[] = [];
    const useT = !!startExpansion?.children;
    const limit = this.limit;
    const first = this.first;
    // Open containers being listed (a list rather than the call stack, so any depth can be shown):
    // their items, the next item, and their position in the override trie.
    const lists: JNode[][] = [];
    const at: number[] = [];
    const expansions: (Expansion | undefined)[] = [];
    const visit = (n: JNode, expansion: Expansion | undefined) => {
      rows.push(n);
      if (n.t < ARR) return;
      const open = expansion?.open ?? (n.d < limit || (first && rows.length < FIRST_ROWS));
      n.x = open;
      if (open) {
        lists.push(kids(n));
        at.push(0);
        expansions.push(expansion);
      }
    };
    if (self) visit(start, startExpansion);
    else {
      lists.push(kids(start));
      at.push(0);
      expansions.push(startExpansion);
    }
    while (lists.length) {
      const d = lists.length - 1;
      const list = lists[d];
      const i = at[d]++;
      if (i < list.length) visit(list[i], useT ? childExpansion(expansions[d], list[i]) : undefined);
      else {
        lists.pop();
        at.pop();
        expansions.pop();
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
    // Find the branch once, then carry its trie entry alongside each descendant.
    const ancestors: JNode[] = [];
    for (let p = n; p.u; p = p.u) ancestors.push(p);
    let expansion = this.toggles;
    for (let i = ancestors.length - 1; i >= 0; i--) expansion = childExpansion(expansion, ancestors[i], true)!;
    if (deep) {
      const stack = [n];
      const expansions = [expansion];
      while (stack.length) {
        const c = stack.pop() as JNode;
        const entry = expansions.pop()!;
        entry.open = open;
        for (const k of kids(c)) {
          if (k.t < ARR) continue;
          stack.push(k);
          expansions.push(childExpansion(entry, k, true)!);
        }
      }
    } else expansion.open = open;
    n.x = open;
    const i = this.indexOf(n);
    if (i < 0) {
      this.rebuild();
      return;
    }
    let j = i + 1;
    while (j < this.rows.length && this.rows[j].d > n.d) j++;
    const sub = open ? this.flatten(n, expansion, false) : [];
    this.rows = this.rows.slice(0, i + 1).concat(sub, this.rows.slice(j));
    this.sc.fit(this.rows.length * RH, this.sizer);
    this.render(true);
  }

  expandAll() {
    this.limit = Infinity;
    this.first = false;
    this.toggles = {};
    this.rebuild();
    this.scrollToSel(true);
  }

  collapseAll() {
    this.limit = 1;
    this.first = false;
    this.toggles = {};
    this.rebuild();
    this.sc.top = 0;
  }

  expandTo(level: number) {
    this.limit = level;
    this.first = false;
    this.toggles = {};
    this.rebuild();
  }

  /** Expands every collapsed ancestor of `n`. */
  reveal(n: JNode) {
    let changed = false;
    const ancestors: JNode[] = [];
    for (let p = n.u; p; p = p.u) {
      ancestors.push(p);
      if (!p.x) changed = true;
    }
    if (!changed) return;
    let expansion = this.toggles;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const p = ancestors[i];
      if (p.u) expansion = childExpansion(expansion, p, true)!;
      if (p.x) continue;
      p.x = true;
      expansion.open = true;
    }
    this.rebuild();
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

  focus() {
    this.el.focus({ preventScroll: true });
    if (!this.sel && this.rows.length) this.choose(this.rows[0], 'key');
  }

  // ── Search ─────────────────────────────────────────────────────────────

  search(q: string, jump: boolean) {
    this.q = q;
    this.cs = q !== q.toLowerCase();
    this.qn = this.cs ? q : q.toLowerCase();
    this.matches = [];
    this.matchSet = null;
    this.hits = this.hitSet = null;
    this.mi = -1;
    const root = this.root;
    let note: string | undefined;
    if (q && root) {
      // `$.a[0]` / `/a/0` jump to that node; if it doesn't resolve, it's plain text ($ref, /v1/users…).
      const segs = q[0] === '$' || (q[0] === '/' && q.length > 1) ? parsePath(q) : null;
      const hit = segs && segs.length ? resolve(root, segs) : null;
      // Wildcards, recursive descent, filters and slices are JSONPath queries, not one location.
      if (!hit && q[0] === '$' && /\*|\.\.|\?|@|\[-?\d*:-?\d*\]/.test(q)) {
        note = 'Wildcards, filters and slices are not supported. Use a concrete path such as $.users[0].name';
      }
      const z = root.z;
      if (hit) this.matches = [hit];
      else if (z) {
        // On the tape: no node is made for a document's values, only for the matches gone to (see matchAt).
        this.hits = z.search(root, this.qn, this.cs, MAX_MATCHES);
        this.hitSet = new Set(this.hits);
      } else {
        const qn = this.qn;
        const cs = this.cs;
        const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
        const stack: JNode[] = [root];
        while (stack.length && this.matches.length < MAX_MATCHES) {
          const n = stack.pop() as JNode;
          let hit = typeof n.key === 'string' && has(n.key);
          if (!hit) {
            if (n.t === STR || n.t === NUM) hit = has(n.v as string);
            else if (n.t === BOOL) hit = has(n.v ? 'true' : 'false');
            else if (n.t === NUL) hit = has('null');
          }
          if (hit) this.matches.push(n);
          if (n.t >= ARR) {
            const list = kids(n);
            for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
          }
        }
      }
      if (!this.hits) this.matchSet = new Set(this.matches);
      if (this.matchCount) {
        // Prefer the first match at or after the current selection.
        const from = this.sel ? this.sel.s : 0;
        let idx = -1;
        if (this.hits) idx = this.hits.findIndex((h) => z!.start(h) >= from);
        else idx = this.matches.findIndex((m) => m.s >= from);
        if (idx < 0) idx = 0;
        this.mi = idx;
        if (jump) this.gotoMatch();
      }
    }
    this.render(true);
    return { total: this.matchCount, index: this.mi, note: this.matchCount ? undefined : note };
  }

  /** How many matches the search found. */
  get matchCount() {
    return this.hits ? this.hits.length : this.matches.length;
  }

  /** Match `k` (made from the tape when the search ran there). */
  private matchAt(k: number): JNode | null {
    if (!this.hits) return this.matches[k] ?? null;
    return this.root?.z && k >= 0 && k < this.hits.length ? this.root.z.nodeAt(this.root, this.hits[k]) : null;
  }

  private isMatch(n: JNode) {
    return this.hits ? n.z !== null && n.z === this.root?.z && this.hitSet!.has(n.zi) : !!this.matchSet?.has(n);
  }

  private isCurrent(n: JNode) {
    return this.hits ? n.z === this.root?.z && this.hits[this.mi] === n.zi : n === this.matches[this.mi];
  }

  step(dir: 1 | -1) {
    const n = this.matchCount;
    if (!n) return { total: 0, index: -1 };
    this.mi = (this.mi + dir + n) % n;
    this.gotoMatch();
    return { total: n, index: this.mi };
  }

  private gotoMatch() {
    const m = this.matchAt(this.mi);
    if (!m) return;
    this.select(m, { center: true });
    this.ev.select(m, 'search');
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private onScroll = () => {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render(false);
    });
  };

  render(force: boolean) {
    // A hidden tree draws when it is shown (the engine renders it on a view change
    // and after a load); measuring it while hidden would force a page layout.
    if (this.el.hidden || this.dirty) return;
    if (!valueHints && !hintsLoading && this.rows.length) {
      // Hints decorate rows that are already readable, so they load when the page is idle.
      hintsLoading = true;
      idle(() =>
        void import('../json/smart').then((m) => {
          valueHints = (n) => m.valueHints(n);
          this.render(true);
        }),
      );
    }
    const st = this.sc.top;
    const vh = this.el.clientHeight;
    const vf = Math.floor(st / RH);
    const vl = Math.min(this.rows.length, Math.ceil((st + vh) / RH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) {
      // Scaled scrolling (see TallScroll) moves the drawn rows too.
      if (this.sc.shift + this.rFirst * RH !== this.y) this.placeRows();
      return;
    }
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(this.rows.length, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    let html = '';
    for (let i = first; i < last; i++) html += this.row(this.rows[i], i);
    this.rowsEl.innerHTML = html;
    const si = this.sel ? this.indexOf(this.sel) : -1;
    if (si >= first && si < last) this.el.setAttribute('aria-activedescendant', 'tv-sel');
    else this.el.removeAttribute('aria-activedescendant');
    this.placeRows();
  }

  private placeRows() {
    const y = this.rFirst * RH + this.sc.shift;
    if (y !== this.y) this.rowsEl.style.transform = `translateY(${(this.y = y)}px)`;
    this.placeActs();
  }

  private mark(raw: string): string {
    if (!this.q || !(this.matchSet || this.hitSet)) return escapeHtml(raw);
    const hay = this.cs ? raw : raw.toLowerCase();
    const q = this.qn;
    let i = hay.indexOf(q);
    if (i < 0) return escapeHtml(raw);
    let out = '';
    let p = 0;
    while (i >= 0) {
      out += escapeHtml(raw.slice(p, i)) + '<mark>' + escapeHtml(raw.slice(i, i + q.length)) + '</mark>';
      p = i + q.length;
      i = hay.indexOf(q, p);
    }
    return out + escapeHtml(raw.slice(p));
  }

  private row(n: JNode, i: number): string {
    const sel = n === this.sel;
    let cls = 'tv-r';
    const deep = n.d > IND_DEPTH;
    if (deep) cls += ' tv-deep';
    if (sel) cls += ' sel';
    if (this.isMatch(n)) cls += this.isCurrent(n) ? ' hit cur' : ' hit';
    const cont = n.t >= ARR;
    let h = `<div class="${cls}" data-i="${i}" role="treeitem" aria-level="${n.d + 1}"`;
    if (n.u) h += ` aria-setsize="${kids(n.u).length}" aria-posinset="${typeof n.key === 'number' ? n.key + 1 : siblingIndex(n) + 1}"`;
    if (cont) h += ` aria-expanded="${n.x}"`;
    if (sel) h += ' id="tv-sel" aria-selected="true"';
    h += ` style="padding-left:${deep ? 'calc(var(--tv-indent) + 6px)' : n.d * IND + 6 + 'px'}">`;
    if (n.d) h += `<i class="tv-g" style="width:${deep ? 'var(--tv-indent)' : n.d * IND + 'px'}"></i>`;
    h += cont ? `<b class="tv-t${n.x ? ' o' : ''}"></b>` : '<b class="tv-t n"></b>';
    if (deep) h += `<span class="tv-depth ${PRIVATE}" aria-hidden="true">↳${n.d}</span>`;
    if (!n.u) h += '<span class="tv-root">root</span>';
    else if (typeof n.key === 'number') h += `<span class="tv-i">${n.key}</span><span class="tv-c">:</span>`;
    else if (n.key === '') h += '<span class="tv-k empty">""</span><span class="tv-c">:</span>';
    else h += `<span class="tv-k">${this.mark(n.key as string)}</span><span class="tv-c">:</span>`;

    if (cont) {
      const len = kids(n).length;
      const isObj = n.t === OBJ;
      h += `<span class="tv-b">${isObj ? '{' : '['}${len}${isObj ? '}' : ']'}</span>`;
      if (!n.x && len) h += `<span class="tv-p">${escapeHtml(preview(n))}</span>`;
      return h + '</div>';
    }
    switch (n.t) {
      case STR: {
        // (A long string not decoded yet: only its start, which is all a row shows.)
        const whole = n._v !== undefined || !n.z;
        const s = whole ? (n.v as string) : n.z!.head(n, 2001);
        const shown = JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
        // Badges (nested JSON, JWT) need their hint now; other hints only label the
        // tooltip, built on hover (date labels load the browser's locale data).
        const c0 = s.charCodeAt(0);
        const badge = whole && (c0 === 123 || c0 === 91 || c0 === 34 || c0 === 101 || c0 === 66 || c0 === 98 || c0 <= 32);
        const hint = badge ? valueHints?.(n)[0] : undefined;
        let extra = '';
        let vcls = 'tv-s';
        if (s.length < 64 && COLOR.test(s)) extra = `<i class="tv-sw" style="background:${s}"></i>`;
        else if (s.length < 2048 && URL_RE.test(s)) vcls += ' url';
        if (hint?.kind === 'json') extra += '<button type="button" class="tv-x" data-n="1" title="' + this.expandTip + '">JSON</button>';
        else if (hint?.kind === 'jwt') extra += '<span class="tv-x">JWT</span>';
        let title = hint ? hint.label : '';
        if (s.length > 60) title = (title ? title + '\n\n' : '') + (s.length > 2000 ? s.slice(0, 2000) + '…' : s);
        h += `${extra}<span class="${vcls}"${title ? ` title="${escapeHtml(title)}"` : ''}${badge ? '' : ' data-h'}>${this.mark(shown)}</span>`;
        break;
      }
      case NUM: {
        const raw = n.v as string;
        h += `<span class="tv-n"${raw.length === 10 || raw.length === 13 ? ' data-h' : ''}>${this.mark(raw)}</span>`;
        break;
      }
      case BOOL:
        h += `<span class="tv-l">${this.mark(n.v ? 'true' : 'false')}</span>`;
        break;
      case NUL:
        h += `<span class="tv-z">${this.mark('null')}</span>`;
        break;
    }
    return h + '</div>';
  }

  /** Floating copy buttons follow the hovered (or selected) row. */
  private placeActs() {
    let i = this.hover;
    if (i < 0 && this.sel) i = this.indexOf(this.sel);
    if (i < 0 || i >= this.rows.length) {
      this.acts.hidden = true;
      return;
    }
    this.acts.hidden = false;
    this.acts.style.transform = `translateY(${i * RH + this.sc.shift}px)`;
    this.acts.dataset.i = String(i);
  }

  private onOver = (e: MouseEvent) => {
    const r = (e.target as HTMLElement).closest('.tv-r') as HTMLElement | null;
    if (!r) return;
    const i = Number(r.dataset.i);
    if (i !== this.hover) {
      this.hover = i;
      this.placeActs();
      this.hintTitle(r, this.rows[i]);
    }
  };

  /** A value's hint (date, epoch, color, link…) becomes its tooltip the first time its row is hovered. */
  private hintTitle(r: HTMLElement, n: JNode | undefined) {
    const v = r.querySelector<HTMLElement>('[data-h]');
    if (!v || !n || !valueHints) return;
    v.removeAttribute('data-h');
    const label = valueHints(n)[0]?.label;
    if (label) v.title = v.title ? label + '\n\n' + v.title : label;
  }

  private onLeave = () => {
    this.hover = -1;
    this.placeActs();
  };

  // ── Interaction ────────────────────────────────────────────────────────

  private choose(n: JNode, how: 'pointer' | 'key') {
    this.sel = n;
    this.scrollToSel(false);
    if (!this.markSel()) this.render(true);
    this.ev.select(n, how);
  }

  /**
   * Moves the selection's mark to its row in place, if that row is drawn: a row redrawn under the pointer
   * keeps the browser from pairing two clicks into a double-click (see onDbl). False if it isn't drawn.
   */
  private markSel() {
    const i = this.sel ? this.indexOf(this.sel) : -1;
    const to = i >= this.rFirst && i < this.rLast ? this.rowsEl.querySelector<HTMLElement>(`.tv-r[data-i="${i}"]`) : null;
    if (!to) return false;
    const from = this.rowsEl.querySelector<HTMLElement>('#tv-sel');
    if (from !== to) {
      if (from) {
        from.classList.remove('sel');
        from.removeAttribute('id');
        from.removeAttribute('aria-selected');
      }
      to.classList.add('sel');
      to.id = 'tv-sel';
      to.setAttribute('aria-selected', 'true');
    }
    this.el.setAttribute('aria-activedescendant', 'tv-sel');
    return true;
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const btn = t.closest('button[data-a]') as HTMLElement | null;
    if (btn) {
      const n = this.rows[Number(this.acts.dataset.i)];
      if (n) this.ev.copy(n, btn.dataset.a === 'path' ? 'path' : 'value');
      return;
    }
    const r = t.closest('.tv-r') as HTMLElement | null;
    if (!r) return;
    const n = this.rows[Number(r.dataset.i)];
    if (!n) return;
    if (t.dataset.n) {
      this.ev.nested(n);
      return;
    }
    if (t.classList.contains('url') && (e.metaKey || e.ctrlKey)) {
      window.open(n.v as string, '_blank', 'noopener,noreferrer');
      return;
    }
    this.el.focus({ preventScroll: true });
    this.choose(n, 'pointer');
    if (n.t >= ARR && (t.classList.contains('tv-t') || !window.getSelection()?.toString())) {
      this.toggle(n, !n.x, e.altKey || e.shiftKey);
    }
  };

  /** The node of the row at `el` (a right click), selected as a click selects it, without toggling. */
  pick(el: Element): JNode | null {
    const r = el.closest('.tv-r') as HTMLElement | null;
    const n = r ? this.rows[Number(r.dataset.i)] : undefined;
    if (!n) return null;
    this.el.focus({ preventScroll: true });
    if (n !== this.sel) this.choose(n, 'pointer');
    return n;
  }

  /** Where the selected node's row is on screen (null: not drawn). */
  selBox() {
    const i = this.sel ? this.indexOf(this.sel) : -1;
    return i < 0 ? null : (this.rowsEl.querySelector(`.tv-r[data-i="${i}"]`)?.getBoundingClientRect() ?? null);
  }

  private onDbl = (e: MouseEvent) => {
    const r = (e.target as HTMLElement).closest('.tv-r') as HTMLElement | null;
    const n = r && this.rows[Number(r.dataset.i)];
    if (n && n.t < ARR) this.ev.open(n);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target !== this.el) return;
    const rows = this.rows;
    if (!rows.length) return;
    let i = this.sel ? this.indexOf(this.sel) : -1;
    const n = i >= 0 ? rows[i] : null;
    const page = Math.max(1, Math.floor(this.el.clientHeight / RH) - 1);
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        i = Math.min(rows.length - 1, i + 1);
        break;
      case 'ArrowUp':
        i = Math.max(0, i - 1);
        break;
      case 'PageDown':
        i = Math.min(rows.length - 1, i + page);
        break;
      case 'PageUp':
        i = Math.max(0, i - page);
        break;
      case 'Home':
        i = 0;
        break;
      case 'End':
        i = rows.length - 1;
        break;
      case 'ArrowRight':
        if (n && n.t >= ARR) {
          if (!n.x) this.toggle(n, true);
          else if (kids(n).length) i++;
        }
        break;
      case 'ArrowLeft':
        if (n && n.t >= ARR && n.x) this.toggle(n, false);
        else if (n && n.u) i = this.indexOf(n.u);
        break;
      case ' ':
        if (n && n.t >= ARR) this.toggle(n, !n.x, e.shiftKey);
        break;
      case 'Enter':
        if (n) {
          if (n.t >= ARR && !mod) this.toggle(n, !n.x, e.shiftKey);
          else this.ev.open(n);
        }
        break;
      case '*':
        if (n) this.toggle(n, true, true);
        break;
      case 'Escape':
        this.ev.escape();
        break;
      case 'c':
      case 'C':
        if (n && (mod || (!e.altKey && !e.shiftKey))) {
          if (mod && window.getSelection()?.toString()) return;
          this.ev.copy(n, 'value');
        } else handled = false;
        break;
      case 'p':
      case 'P':
        if (n && !mod) this.ev.copy(n, 'path');
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (i < 0) i = 0;
    const next = this.rows[i];
    if (next && next !== this.sel) this.choose(next, 'key');
  };
}
