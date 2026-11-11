import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids, type CellFn, type Key } from '../json/parser';
import { pathOf } from '../json/path';
import type { FindResult } from './codeview';
import { escapeHtml } from './highlight';
import { TallScroll } from './tall';
import { rt } from '../i18n/ui';

/*
 * Virtualized grid of an array (rows = items) or object (rows = properties).
 * It is one tab stop (an ARIA grid): the arrow keys, Home, End and the page
 * keys move its active cell (aria-activedescendant: the cells come and go as
 * it scrolls), selecting what the cell shows as a click does; Enter sorts by a
 * header cell or opens an array or object cell as the table.
 */

const TRH = 30;
const OVERSCAN = 20;
const MAX_COLS = 120;

interface Col {
  /** Property name; null = the item itself (primitive / non-object items). */
  key: string | null;
  /** The row label column (array index or object key). */
  idx?: boolean;
  label: string;
  w: number;
}

export interface TableEvents {
  select(node: JNode): void;
  drill(node: JNode): void;
}

/** A primitive cell's text, from its kind and value (as JNode.v has it). */
const cellText = (t: number, v: string | boolean | null): string => (t === BOOL ? (v ? 'true' : 'false') : t === NUL ? 'null' : (v as string));

/** Sort rank of a cell of kind `t` (-1: none): numbers, text, booleans, null, arrays and objects, then missing. */
const typeRank = (t: number) => (t < 0 ? 9 : t === NUM ? 0 : t === STR ? 1 : t === BOOL ? 2 : t === NUL ? 3 : 4);

const JSON_NUM = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** A JSON number's text as sign × 0.digits × 10^lead, digits without leading or trailing zeros (0: sign 0). */
function decimal(raw: string) {
  const e = raw.search(/[eE]/);
  const m = raw.slice(raw[0] === '-' ? 1 : 0, e < 0 ? raw.length : e);
  const dot = m.indexOf('.');
  const all = dot < 0 ? m : m.slice(0, dot) + m.slice(dot + 1);
  const z = all.search(/[^0]/);
  if (z < 0) return { sign: 0, lead: 0n, digits: '' };
  const lead = BigInt((dot < 0 ? m.length : dot) - z) + (e < 0 ? 0n : BigInt(raw.slice(e + 1)));
  return { sign: raw[0] === '-' ? -1 : 1, lead, digits: all.slice(z).replace(/0+$/, '') };
}

/**
 * Number texts in value order, exactly: doubles first, and only when two different texts read as the same
 * double (huge or tiny exponents, more digits than a double holds) their decimal digits.
 */
function compareNumbers(a: string, b: string): number {
  const p = Number(a);
  const q = Number(b);
  if (p !== q) return p < q ? -1 : 1;
  if (a === b || !JSON_NUM.test(a) || !JSON_NUM.test(b)) return 0;
  const x = decimal(a);
  const y = decimal(b);
  if (x.sign !== y.sign) return x.sign - y.sign;
  const c = x.lead !== y.lead ? (x.lead < y.lead ? -1 : 1) : x.digits === y.digits ? 0 : x.digits < y.digits ? -1 : 1;
  return c * x.sign;
}

export class TableView {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private sizer: HTMLElement;
  private sc: TallScroll;
  private rowsEl: HTMLElement;
  private empty: HTMLElement;
  private ev: TableEvents;
  private ro: ResizeObserver;

  node: JNode | null = null;
  private nodeKey: string | null = null;
  /** Its items (rows) as nodes; for a node from a tape, as tape indexes (`ti`): no node made for a row not drawn. */
  private items: JNode[] = [];
  private ti: Int32Array | null = null;
  /** Items in display order. */
  private order = new Int32Array(0);
  private cols: Col[] = [];
  private sortCol = -1;
  private sortDir = 1;
  private rFirst = -1;
  private rLast = -1;
  /** Content height the spacer was sized for, and the drawn rows' translateY. */
  private h = -1;
  private y = NaN;
  private raf = 0;
  private cw = 7.6;
  sel: JNode | null = null;
  /** The active cell: display row in `order` (-1: the header row) and column. */
  private ar = 0;
  private ac = 0;
  /** aria-activedescendant as last set. */
  private act = '';

  constructor(el: HTMLElement, ev: TableEvents) {
    this.el = el;
    this.ev = ev;
    this.head = el.querySelector('.tb-head') as HTMLElement;
    this.sizer = el.querySelector('.tb-sizer') as HTMLElement;
    this.sc = new TallScroll(el);
    this.rowsEl = el.querySelector('.tb-rows') as HTMLElement;
    this.empty = el.querySelector('.tb-empty') as HTMLElement;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('focus', this.onFocus);
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
  }

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('focus', this.onFocus);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
  }

  get rowCount() {
    return this.ti ? this.ti.length : this.items.length;
  }

  /** Item `idx` (from a tape: made now, the same object while anything holds it). */
  private item(idx: number): JNode {
    return this.ti ? this.node!.z!.at(this.ti[idx]) : this.items[idx];
  }

  /** Item `idx`'s row label: its key in an object, its index in an array. */
  private label(idx: number) {
    return String(this.node!.t !== OBJ ? idx : this.ti ? this.node!.z!.key(this.ti[idx]) : this.items[idx].key);
  }

  /**
   * A pass over items `idxs` (places among the items), row by row: `each` for their cells under member names
   * `keys` (see cell; true: on to the next row), then `row`. From a tape, read there: no node made for a row.
   */
  private cells(idxs: ArrayLike<number>, keys: (string | null)[], each: CellFn, row?: (r: number) => void) {
    if (this.ti) return this.node!.z!.cells(this.ti, idxs, keys, each, row);
    for (let r = 0; r < idxs.length; r++) {
      const it = this.items[idxs[r]];
      for (let k = 0; k < keys.length; k++) {
        const c = this.cell(it, keys[k]);
        if (each(r, k, c ? c.t : -1, c && c.t < ARR ? (c.v as string | boolean | null) : null, c ?? -1)) break;
      }
      row?.(r);
    }
  }

  /** How many items container cell `c` (see cells) has. */
  private size(c: JNode | number) {
    return typeof c === 'number' ? this.node!.z!.count(c) : kids(c).length;
  }

  get colCount() {
    return this.cols.length;
  }

  setNode(node: JNode | null, keepSort = false) {
    if (!node && !this.node) return; // already empty: nothing to lay out
    const key = node ? pathOf(node).join('\u0001') : null;
    const same = key !== null && key === this.nodeKey;
    this.nodeKey = key;
    this.node = node && node.t >= ARR ? node : null;
    // (Items of millions from a tape stay on the tape.)
    const z = this.node?.z;
    this.ti = z ? z.kids(this.node!.zi) : null;
    this.items = this.node && !z ? kids(this.node) : [];
    if (!keepSort || !same) {
      this.sortCol = -1;
      this.sortDir = 1;
      this.sc.top = 0;
      this.el.scrollLeft = 0;
      this.ar = this.ac = 0;
    }
    this.buildCols();
    this.applySort();
    this.ar = Math.min(this.ar, this.order.length - 1);
    this.ac = Math.min(this.ac, this.cols.length - 1);
    // A grid while it shows an array or object (else the empty note), its rows counted with the header's.
    const el = this.el;
    if (this.node) {
      el.setAttribute('role', 'grid');
      el.setAttribute('aria-label', rt('Table view'));
      el.setAttribute('aria-rowcount', String(this.order.length + 1));
      el.setAttribute('aria-colcount', String(this.cols.length));
      el.tabIndex = 0;
    } else {
      for (const a of ['role', 'aria-label', 'aria-rowcount', 'aria-colcount', 'aria-activedescendant']) el.removeAttribute(a);
      el.tabIndex = -1;
      this.act = '';
    }
    if (this.fq) this.find(this.fq);
    else this.render(true);
  }

  private buildCols() {
    const items = this.items;
    const isObj = this.node?.t === OBJ;
    const seen = new Map<string, number>();
    let hasValue = false;
    const add = (key: Key) => {
      const k = key as string;
      if (seen.size < MAX_COLS && !seen.has(k)) seen.set(k, 0);
    };
    if (this.ti) {
      // (Read off the tape: a big array's rows stay unmade.)
      const [keys, value] = this.node!.z!.columns(this.node!.zi, MAX_COLS);
      for (const k of keys) add(k);
      hasValue = value;
    }
    for (const it of items) {
      if (it.t === OBJ) for (const c of kids(it)) add(c.key);
      else hasValue = true;
    }
    // The row label and value columns give way to members of the same name (`_key`, `__value`…), as in the exports.
    const own = (name: string) => {
      while (seen.has(name)) name = '_' + name;
      return name;
    };
    const cols: Col[] = [{ key: null, idx: true, label: own(isObj ? 'key' : '#'), w: 0 }];
    if (hasValue) cols.push({ key: null, label: own('value'), w: 0 });
    for (const k of seen.keys()) cols.push({ key: k, label: k, w: 0 });

    // Width from a sample of content.
    const sample = Math.min(this.rowCount, 400);
    const lens = cols.map((c) => c.label.length + 2);
    const first = new Int32Array(sample).map((_, r) => r);
    for (const r of first) lens[0] = Math.max(lens[0], this.label(r).length);
    this.cells(first, cols.slice(1).map((c) => c.key), (_r, k, t, v) => void (lens[k + 1] = Math.max(lens[k + 1], t < 0 ? 1 : t >= ARR ? 6 : cellText(t, v).length)));
    cols.forEach((col, ci) => (col.w = Math.round(Math.min(ci === 0 ? 28 : 46, Math.max(ci === 0 ? 3 : 5, lens[ci])) * this.cw + 28)));
    this.cols = cols;
    const tpl = cols.map((c) => c.w + 'px').join(' ');
    this.el.style.setProperty('--tb-cols', tpl);
    const total = cols.reduce((a, c) => a + c.w, 0);
    this.el.style.setProperty('--tb-w', total + 'px');
    this.renderHead();
  }

  /** Row `it`'s cell under member `key` (null: the item itself): of a duplicated key, the last (as JSON.parse and every other view read it). */
  private cell(it: JNode, key: string | null): JNode | undefined {
    if (key === null) return it.t === OBJ ? undefined : it;
    if (it.t !== OBJ) return undefined;
    const list = kids(it);
    if (list.length > 12) {
      let m = this.maps.get(it);
      if (!m) {
        m = new Map();
        for (const c of list) m.set(c.key as string, c);
        this.maps.set(it, m);
      }
      return m.get(key);
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].key === key) return list[i];
    return undefined;
  }

  private maps = new WeakMap<JNode, Map<string, JNode>>();

  // ── Find (rows whose key or any cell contains the query; an array's row numbers aren't its data) ──

  private fq = '';
  /** Rows holding a match: display positions in `order`, and items (which a sort doesn't move). */
  private fhits: number[] = [];
  private fi = -1;
  private fset: Set<number> | null = null;
  /** A sort moved the current match (the find bar shows where it is now). */
  onFind: ((result: FindResult) => void) | null = null;

  find(q: string) {
    this.fq = q;
    this.fhits = [];
    this.fi = -1;
    this.fset = null;
    if (q && this.node) {
      const cs = q !== q.toLowerCase();
      const qn = cs ? q : q.toLowerCase();
      const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
      const hit = new Uint8Array(this.order.length);
      if (this.node.t === OBJ) for (let r = 0; r < hit.length; r++) hit[r] = +has(this.label(this.order[r]));
      this.cells(this.order, this.cols.slice(1).map((c) => c.key), (r, _k, t, v) => hit[r] || (t >= 0 && t < ARR && has(cellText(t, v)) && (hit[r] = 1)));
      for (let r = 0; r < hit.length; r++) if (hit[r]) this.fhits.push(r);
      this.fset = new Set(this.fhits.map((r) => this.order[r]));
      if (this.fhits.length) {
        this.fi = 0;
        this.gotoHit();
      }
    }
    this.render(true);
    return { total: this.fhits.length, index: this.fi };
  }

  step(dir: 1 | -1) {
    const n = this.fhits.length;
    if (n) {
      this.fi = (this.fi + dir + n) % n;
      this.gotoHit();
      this.render(true);
    }
    return { total: n, index: this.fi };
  }

  private gotoHit() {
    const r = this.fhits[this.fi];
    this.sel = this.item(this.order[r]);
    this.ar = r;
    const y = r * TRH;
    const vh = this.el.clientHeight - 32;
    const st = this.sc.top;
    if (y < st || y + TRH > st + vh) this.sc.top = Math.max(0, y - vh / 2);
  }

  private applySort() {
    const n = this.rowCount;
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const dir = this.sortDir;
    const byKey = this.sortCol === 0 && this.node?.t === OBJ;
    const coll = byKey || this.sortCol > 0 ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
    if (byKey) {
      // An object's keys, compared as text cells are (an array's row numbers are its order).
      const keys = Array.from(order, (i) => this.label(i));
      order.sort((a, b) => coll!.compare(keys[a], keys[b]) * dir || a - b);
    } else if (this.sortCol > 0) {
      const col = this.cols[this.sortCol];
      // Each row's cell read once (from a tape, there): its rank, and a number or text to compare.
      const rank = new Uint8Array(n);
      const num = new Float64Array(n);
      const text: (string | undefined)[] = new Array(n);
      this.cells(order, [col.key], (i, _k, t, v, c) => {
        rank[i] = typeRank(t);
        if (t === NUM || t === STR) text[i] = v as string;
        num[i] = t === NUM || t === BOOL ? Number(v) : t >= ARR ? this.size(c) : 0;
      });
      order.sort((a, b) => {
        const rx = rank[a];
        if (rx !== rank[b]) return rx - rank[b]; // missing values always last
        let c = 0;
        // (Numbers: as compareNumbers, its doubles read once.)
        if (rx === 0) c = num[a] !== num[b] ? (num[a] < num[b] ? -1 : 1) : compareNumbers(text[a]!, text[b]!);
        else if (rx === 1) c = coll!.compare(text[a]!, text[b]!);
        // (Booleans, item counts; null and missing: 0.)
        else c = num[a] - num[b];
        // (Ties in the document's order, in every engine.)
        return c * dir || a - b;
      });
    } else if (this.sortCol === 0 && this.sortDir < 0) order.reverse();
    this.order = order;
  }

  /** The matches in their new order after a sort; item `cur` stays the current one. */
  private resorted(set: Set<number>, cur: number) {
    const hits: number[] = [];
    for (let r = 0; r < this.order.length; r++) if (set.has(this.order[r])) hits.push(r);
    this.fhits = hits;
    this.fi = hits.findIndex((r) => this.order[r] === cur);
    if (this.fi < 0 && hits.length) this.fi = 0;
    this.onFind?.({ total: hits.length, index: this.fi });
  }

  private renderHead() {
    let h = '';
    this.cols.forEach((c, i) => {
      const s = i !== this.sortCol ? '' : this.sortDir > 0 ? 'asc' : 'desc';
      const act = this.ar < 0 && i === this.ac;
      h += `<div class="tb-th${i === 0 ? ' tb-c0' : ''}${s ? ' ' + s : ''}${act ? ' act' : ''}" role="columnheader"${s ? ` aria-sort="${s}ending"` : ''}${act ? ` id="tb-h-${i}"` : ''} data-c="${i}" title="${escapeHtml(rt('Sort by {column}', { column: c.label }))}">${escapeHtml(c.label)}</div>`;
    });
    this.head.innerHTML = h;
    this.empty.hidden = !!this.node;
    this.head.hidden = !this.node;
    this.markActive();
  }

  private onScroll = () => {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render(false);
    });
  };

  render(force: boolean) {
    const n = this.order.length;
    if (n * TRH !== this.h) this.sc.fit((this.h = n * TRH), this.sizer);
    const st = this.sc.top;
    const vh = this.el.clientHeight;
    const vf = Math.floor(st / TRH);
    const vl = Math.min(n, Math.ceil((st + vh) / TRH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return this.place();
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(n, vl + OVERSCAN);
    const a = this.rFirst;
    const b = this.rLast;
    this.rFirst = first;
    this.rLast = last;
    const el = this.rowsEl;
    // Scrolled on: the rows still in range stay as they are (anything else that changes them draws all of
    // them), and only the rows coming into range are drawn, some two fifths of them.
    if (!force && first < b && last > a && el.childElementCount === b - a) {
      for (let r = b; r > last; r--) el.lastElementChild!.remove();
      for (let r = a; r < first; r++) el.firstElementChild!.remove();
      if (first < a) el.insertAdjacentHTML('afterbegin', this.rowsHtml(first, Math.min(a, last)));
      if (last > b) el.insertAdjacentHTML('beforeend', this.rowsHtml(Math.max(b, first), last));
    } else el.innerHTML = this.rowsHtml(first, last);
    this.markActive();
    this.place();
  }

  /** Rows [first, last) of `order` as HTML. */
  private rowsHtml(first: number, last: number) {
    const isObj = this.node?.t === OBJ;
    let html = '';
    for (let r = first; r < last; r++) {
      const idx = this.order[r];
      const it = this.item(idx);
      const hit = this.fset?.has(idx) ? (r === this.fhits[this.fi] ? ' hit cur' : ' hit') : '';
      const sel = it === this.sel;
      // The active cell gets a class, and the id aria-activedescendant names.
      const act = r === this.ar ? this.ac : -1;
      html += `<div class="tb-r${sel ? ' sel' : ''}${hit}" role="row" aria-rowindex="${r + 2}"${sel ? ' aria-selected="true"' : ''} data-r="${idx}">`;
      html += `<div class="tb-td tb-c0${act === 0 ? ` act" id="tb-${r}-0` : ''}" role="rowheader" data-c="0">${escapeHtml(isObj ? String(it.key) : String(idx))}</div>`;
      for (let ci = 1; ci < this.cols.length; ci++) {
        const c = this.cell(it, this.cols[ci].key);
        html += `<div class="tb-td${act === ci ? ` act" id="tb-${r}-${ci}` : ''}" role="gridcell" data-c="${ci}">`;
        if (!c) html += '<span class="tb-x">·</span></div>';
        else if (c.t >= ARR) {
          const len = kids(c).length;
          html += `<button class="tb-dr" data-c="${ci}" tabindex="-1">${c.t === OBJ ? `{${len}}` : `[${len}]`}</button></div>`;
        } else {
          const cls = c.t === STR ? 'tv-s' : c.t === NUM ? 'tv-n' : c.t === BOOL ? 'tv-l' : 'tv-z';
          let t = cellText(c.t, c.v as string | boolean | null);
          if (t.length > 300) t = t.slice(0, 300) + '…';
          html += `<span class="${cls}">${escapeHtml(t)}</span></div>`;
        }
      }
      html += '</div>';
    }
    return html;
  }

  /** Points aria-activedescendant at the active cell, while it is drawn. */
  private markActive() {
    const r = this.ar;
    const id = !this.node ? '' : r < 0 ? `tb-h-${this.ac}` : r >= this.rFirst && r < this.rLast ? `tb-${r}-${this.ac}` : '';
    if (id === this.act) return;
    this.act = id;
    if (id) this.el.setAttribute('aria-activedescendant', id);
    else this.el.removeAttribute('aria-activedescendant');
  }

  /** Positions the drawn rows (they move with the scroll offset when it's scaled, see TallScroll). */
  private place() {
    const y = this.rFirst * TRH + this.sc.shift;
    if (y !== this.y) this.rowsEl.style.transform = `translateY(${(this.y = y)}px)`;
  }

  /** Sorts by column `c` (again: the other way; a third time: back to the document's order). */
  private sortBy(c: number) {
    if (this.sortCol === c) {
      if (this.sortDir > 0) this.sortDir = -1;
      else {
        this.sortCol = -1;
        this.sortDir = 1;
      }
    } else {
      this.sortCol = c;
      this.sortDir = 1;
    }
    // (The match and the active row stay on their items.)
    const cur = this.fi >= 0 ? this.order[this.fhits[this.fi]] : -1;
    const at = this.ar >= 0 ? this.order[this.ar] : -1;
    this.applySort();
    if (at >= 0) this.ar = this.order.indexOf(at);
    this.renderHead();
    if (this.fset) this.resorted(this.fset, cur);
    this.render(true);
  }

  /** What a cell stands for: its value, or for the row label (and a missing value) the row's item. */
  private target(it: JNode, ci: number) {
    return (ci > 0 ? this.cell(it, this.cols[ci].key) : undefined) ?? it;
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const th = t.closest('.tb-th') as HTMLElement | null;
    if (th) {
      this.ar = -1;
      this.ac = Number(th.dataset.c);
      this.sortBy(this.ac);
      return;
    }
    const row = t.closest('.tb-r') as HTMLElement | null;
    if (!row) return;
    const it = this.itemAt(row);
    if (!it) return;
    const cellEl = t.closest('[data-c]') as HTMLElement | null;
    const ci = cellEl ? Number(cellEl.dataset.c) : 0;
    const r = Number(row.getAttribute('aria-rowindex')) - 2;
    if (r >= 0) {
      this.ar = r;
      this.ac = ci;
    }
    const c = this.target(it, ci);
    if (t.closest('.tb-dr')) {
      this.ev.drill(c);
      // (The button is gone with the rows it was drawn in: the keys go on in the grid.)
      this.el.focus({ preventScroll: true });
      return;
    }
    this.sel = it;
    this.render(true);
    this.ev.select(c);
  }

  /**
   * Tab lands on the active cell (drawn already); one scrolled out of view gives way to the first row in
   * view. A press focuses the table too: its click places the active cell, and the rows under the pointer
   * stay (drawn again, the click would miss them).
   */
  private onFocus = () => {
    if (!this.node || this.ar < 0 || !this.el.matches(':focus-visible')) return;
    const top = Math.ceil(this.sc.top / TRH);
    const rows = Math.max(1, Math.floor((this.el.clientHeight - 32) / TRH));
    if (this.ar >= top && this.ar < top + rows) return;
    this.ar = Math.min(this.order.length - 1, top);
    this.render(true);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target !== this.el || !this.node || e.altKey) return;
    const n = this.order.length;
    const lastCol = this.cols.length - 1;
    const page = Math.max(1, Math.floor((this.el.clientHeight - 32) / TRH) - 1);
    const mod = e.ctrlKey || e.metaKey;
    let r = this.ar;
    let c = this.ac;
    switch (e.key) {
      case 'ArrowRight':
        c = Math.min(lastCol, c + 1);
        break;
      case 'ArrowLeft':
        c = Math.max(0, c - 1);
        break;
      case 'ArrowDown':
        r = Math.min(n - 1, r + 1);
        break;
      case 'ArrowUp':
        r = Math.max(-1, r - 1);
        break;
      case 'PageDown':
        r = Math.min(n - 1, Math.max(0, r + page));
        break;
      case 'PageUp':
        r = r > 0 ? Math.max(0, r - page) : -1;
        break;
      case 'Home':
        if (mod) r = Math.min(0, n - 1);
        c = 0;
        break;
      case 'End':
        if (mod) r = n - 1;
        c = lastCol;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (r < 0) return this.sortBy(c);
        if (e.key === 'Enter') {
          const v = this.cell(this.item(this.order[r]), this.cols[c].key);
          if (c > 0 && v && v.t >= ARR) return this.ev.drill(v);
        }
        return this.activate(r, c);
      default:
        return;
    }
    e.preventDefault();
    this.activate(r, c);
  };

  /** Makes cell (r, c) the active one: shows it, and selects what it stands for. */
  private activate(r: number, c: number) {
    const head = this.ar < 0 || r < 0;
    this.ar = r;
    this.ac = c;
    if (r >= 0) {
      // Into view: the row under the header, the column right of the row labels.
      const y = r * TRH;
      const vh = this.el.clientHeight - 32;
      const st = this.sc.top;
      if (y < st) this.sc.top = y;
      else if (y + TRH > st + vh) this.sc.top = y + TRH - vh;
    }
    let x = 0;
    for (let k = 0; k < c; k++) x += this.cols[k].w;
    const w = this.cols[c].w;
    const left = this.cols[0].w;
    const sl = this.el.scrollLeft;
    if (c > 0 && x - left < sl) this.el.scrollLeft = x - left;
    else if (x + w > sl + this.el.clientWidth) this.el.scrollLeft = x + w - this.el.clientWidth;
    if (head) this.renderHead();
    if (r < 0) return this.render(true);
    const it = this.item(this.order[r]);
    this.sel = it;
    this.render(true);
    this.ev.select(this.target(it, c));
  }

  /** The item of drawn row `row` (its data-r), if there is one. */
  private itemAt(row: HTMLElement) {
    const idx = Number(row.dataset.r);
    return idx >= 0 && idx < this.rowCount ? this.item(idx) : undefined;
  }

  /** The value of the cell at `el` (a right click), selected as a click selects it. */
  pick(el: Element): JNode | null {
    const row = el.closest('.tb-r') as HTMLElement | null;
    const it = row ? this.itemAt(row) : undefined;
    if (!it) return null;
    const cellEl = el.closest('[data-c]') as HTMLElement | null;
    const ci = cellEl ? Number(cellEl.dataset.c) : 0;
    const c = this.target(it, ci);
    const r = Number(row!.getAttribute('aria-rowindex')) - 2;
    if (r >= 0) {
      this.ar = r;
      this.ac = ci;
    }
    this.sel = it;
    this.render(true);
    this.ev.select(c);
    return c;
  }

  /** What the table shows, to export (CSV, Excel: convert/xlsx flattens it): its array or object. */
  exportNode(): JNode | null {
    return this.node;
  }

  /**
   * The order its rows are shown in (indexes of exportNode's items), or null in document order. The export
   * reorders the rows only: its columns are the document's, whichever column the table is sorted by.
   */
  exportOrder(): Int32Array | null {
    const order = this.order;
    for (let i = 0; i < order.length; i++) if (order[i] !== i) return order;
    return null;
  }
}
