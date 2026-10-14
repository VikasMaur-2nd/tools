import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { stringify } from '../json/format';
import { pathOf } from '../json/path';
import { escapeHtml } from './highlight';

/* Virtualized grid of an array (rows = items) or object (rows = properties). */

export const TRH = 30;
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

const cellText = (n: JNode): string => {
  switch (n.t) {
    case STR:
      return n.v as string;
    case NUM:
      return n.v as string;
    case BOOL:
      return n.v ? 'true' : 'false';
    case NUL:
      return 'null';
  }
  return '';
};

const csvEscape = (s: string) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

const typeRank = (n: JNode | undefined) => (n === undefined ? 9 : n.t === NUM ? 0 : n.t === STR ? 1 : n.t === BOOL ? 2 : n.t === NUL ? 3 : 4);

export class TableView {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private sizer: HTMLElement;
  private rowsEl: HTMLElement;
  private empty: HTMLElement;
  private ev: TableEvents;
  private ro: ResizeObserver;

  node: JNode | null = null;
  private nodeKey: string | null = null;
  private items: JNode[] = [];
  private order: number[] = [];
  private cols: Col[] = [];
  private sortCol = -1;
  private sortDir = 1;
  private rFirst = -1;
  private rLast = -1;
  private raf = 0;
  private cw = 7.6;
  sel: JNode | null = null;

  constructor(el: HTMLElement, ev: TableEvents) {
    this.el = el;
    this.ev = ev;
    this.head = el.querySelector('.tb-head') as HTMLElement;
    this.sizer = el.querySelector('.tb-sizer') as HTMLElement;
    this.rowsEl = el.querySelector('.tb-rows') as HTMLElement;
    this.empty = el.querySelector('.tb-empty') as HTMLElement;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
  }

  destroy() {
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  get rowCount() {
    return this.items.length;
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
    this.items = this.node ? kids(this.node) : [];
    if (!keepSort || !same) {
      this.sortCol = -1;
      this.sortDir = 1;
      this.el.scrollTop = 0;
      this.el.scrollLeft = 0;
    }
    this.buildCols();
    this.applySort();
    if (this.fq) this.find(this.fq);
    else this.render(true);
  }

  private buildCols() {
    const items = this.items;
    const isObj = this.node?.t === OBJ;
    const seen = new Map<string, number>();
    let hasValue = false;
    for (let r = 0; r < items.length; r++) {
      const it = items[r];
      if (it.t === OBJ) {
        for (const c of kids(it)) {
          const k = c.key as string;
          if (!seen.has(k) && seen.size < MAX_COLS) seen.set(k, 0);
        }
      } else hasValue = true;
    }
    const cols: Col[] = [{ key: null, idx: true, label: isObj ? 'key' : '#', w: 0 }];
    if (hasValue) cols.push({ key: null, label: 'value', w: 0 });
    for (const k of seen.keys()) cols.push({ key: k, label: k, w: 0 });

    // Width from a sample of content.
    const sample = Math.min(items.length, 400);
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      let len = col.label.length + 2;
      for (let r = 0; r < sample; r++) {
        const it = items[r];
        let l: number;
        if (ci === 0) l = isObj ? String(it.key).length : String(r).length;
        else {
          const c = this.cell(it, col);
          l = !c ? 1 : c.t >= ARR ? 6 : cellText(c).length;
        }
        if (l > len) len = l;
      }
      col.w = Math.round(Math.min(ci === 0 ? 28 : 46, Math.max(ci === 0 ? 3 : 5, len)) * this.cw + 28);
    }
    this.cols = cols;
    const tpl = cols.map((c) => c.w + 'px').join(' ');
    this.el.style.setProperty('--tb-cols', tpl);
    const total = cols.reduce((a, c) => a + c.w, 0);
    this.el.style.setProperty('--tb-w', total + 'px');
    this.renderHead();
  }

  private cell(it: JNode, col: Col): JNode | undefined {
    if (col.key === null) return it.t === OBJ ? undefined : it;
    if (it.t !== OBJ) return undefined;
    const list = kids(it);
    if (list.length > 12) {
      let m = this.maps.get(it);
      if (!m) {
        m = new Map();
        for (const c of list) if (!m.has(c.key as string)) m.set(c.key as string, c);
        this.maps.set(it, m);
      }
      return m.get(col.key);
    }
    for (let i = 0; i < list.length; i++) if (list[i].key === col.key) return list[i];
    return undefined;
  }

  private maps = new WeakMap<JNode, Map<string, JNode>>();

  // ── Find (rows whose key or any cell contains the query) ────────────────

  private fq = '';
  private fhits: number[] = []; // display positions in `order`
  private fi = -1;
  private fset: Set<number> | null = null;

  find(q: string) {
    this.fq = q;
    this.fhits = [];
    this.fi = -1;
    this.fset = null;
    if (q && this.node) {
      const cs = q !== q.toLowerCase();
      const qn = cs ? q : q.toLowerCase();
      const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
      const isObj = this.node.t === OBJ;
      for (let r = 0; r < this.order.length; r++) {
        const it = this.items[this.order[r]];
        let hit = has(isObj ? String(it.key) : String(this.order[r]));
        for (let ci = 1; !hit && ci < this.cols.length; ci++) {
          const c = this.cell(it, this.cols[ci]);
          if (c && c.t < ARR) hit = has(cellText(c));
        }
        if (hit) this.fhits.push(r);
      }
      this.fset = new Set(this.fhits);
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
    this.sel = this.items[this.order[r]];
    const y = r * TRH;
    const vh = this.el.clientHeight - 32;
    if (y < this.el.scrollTop || y + TRH > this.el.scrollTop + vh) this.el.scrollTop = Math.max(0, y - vh / 2);
  }

  private applySort() {
    const n = this.items.length;
    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    if (this.sortCol > 0) {
      const col = this.cols[this.sortCol];
      const vals = this.items.map((it) => this.cell(it, col));
      const dir = this.sortDir;
      const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      order.sort((a, b) => {
        const x = vals[a];
        const y = vals[b];
        const rx = typeRank(x);
        const ry = typeRank(y);
        if (rx !== ry) return rx - ry; // missing values always last
        if (!x || !y) return 0;
        let c = 0;
        if (x.t === NUM) c = Number(x.v) - Number(y.v);
        else if (x.t === STR) c = coll.compare(x.v as string, y.v as string);
        else if (x.t === BOOL) c = Number(x.v) - Number(y.v);
        else if (x.t >= ARR) c = kids(x).length - kids(y).length;
        return c * dir;
      });
    } else if (this.sortCol === 0 && this.sortDir < 0) order.reverse();
    this.order = order;
  }

  private renderHead() {
    let h = '';
    this.cols.forEach((c, i) => {
      const s = i === this.sortCol ? (this.sortDir > 0 ? ' asc' : ' desc') : '';
      h += `<button class="tb-th${i === 0 ? ' tb-c0' : ''}${s}" data-c="${i}" title="Sort by ${escapeHtml(c.label)}">${escapeHtml(c.label)}</button>`;
    });
    this.head.innerHTML = h;
    this.empty.hidden = !!this.node;
    this.head.hidden = !this.node;
  }

  private onScroll = () => {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render(false);
    });
  };

  render(force: boolean) {
    const st = this.el.scrollTop;
    const vh = this.el.clientHeight;
    const n = this.order.length;
    this.sizer.style.height = n * TRH + 'px';
    const vf = Math.floor(st / TRH);
    const vl = Math.min(n, Math.ceil((st + vh) / TRH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return;
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(n, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    const isObj = this.node?.t === OBJ;
    let html = '';
    for (let r = first; r < last; r++) {
      const idx = this.order[r];
      const it = this.items[idx];
      const hit = this.fset?.has(r) ? (r === this.fhits[this.fi] ? ' hit cur' : ' hit') : '';
      html += `<div class="tb-r${it === this.sel ? ' sel' : ''}${hit}" data-r="${idx}">`;
      html += `<div class="tb-td tb-c0" data-c="0">${escapeHtml(isObj ? String(it.key) : String(idx))}</div>`;
      for (let ci = 1; ci < this.cols.length; ci++) {
        const c = this.cell(it, this.cols[ci]);
        if (!c) html += '<div class="tb-td"><span class="tb-x">·</span></div>';
        else if (c.t >= ARR) {
          const len = kids(c).length;
          html += `<div class="tb-td" data-c="${ci}"><button class="tb-dr" data-c="${ci}">${c.t === OBJ ? `{${len}}` : `[${len}]`}</button></div>`;
        } else {
          const cls = c.t === STR ? 'tv-s' : c.t === NUM ? 'tv-n' : c.t === BOOL ? 'tv-l' : 'tv-z';
          let t = cellText(c);
          if (t.length > 300) t = t.slice(0, 300) + '…';
          html += `<div class="tb-td" data-c="${ci}"><span class="${cls}">${escapeHtml(t)}</span></div>`;
        }
      }
      html += '</div>';
    }
    this.rowsEl.style.transform = `translateY(${first * TRH}px)`;
    this.rowsEl.innerHTML = html;
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const th = t.closest('.tb-th') as HTMLElement | null;
    if (th) {
      const c = Number(th.dataset.c);
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
      this.renderHead();
      this.applySort();
      this.render(true);
      return;
    }
    const row = t.closest('.tb-r') as HTMLElement | null;
    if (!row) return;
    const it = this.items[Number(row.dataset.r)];
    if (!it) return;
    const cellEl = t.closest('[data-c]') as HTMLElement | null;
    const ci = cellEl ? Number(cellEl.dataset.c) : 0;
    const c = ci > 0 ? this.cell(it, this.cols[ci]) : it;
    if (!c) return;
    if (t.closest('.tb-dr')) {
      this.ev.drill(c);
      return;
    }
    this.sel = it;
    this.render(true);
    this.ev.select(c);
  }

  toCSV(): string {
    if (!this.node) return '';
    const cols = this.cols.slice(this.node.t === OBJ ? 0 : 1);
    const lines = [cols.map((c) => csvEscape(c.idx ? 'key' : c.label)).join(',')];
    for (const idx of this.order) {
      const it = this.items[idx];
      lines.push(
        cols
          .map((col) => {
            if (col.idx) return csvEscape(String(it.key));
            const c = this.cell(it, col);
            if (!c || c.t === NUL) return '';
            return csvEscape(c.t >= ARR ? stringify(c, '') : cellText(c));
          })
          .join(','),
      );
    }
    return lines.join('\r\n');
  }
}
