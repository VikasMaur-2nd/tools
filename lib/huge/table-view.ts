/*
 * The huge table: the items of an array (or the members of an object) as rows, read a block at a time as
 * they scroll into view (SparseLines over the source's rows), drawn like the normal table (same markup and
 * classes) over TallScroll. Its columns are the members of the first rows read; a row not read yet is a
 * placeholder. Millions of rows scroll like a few: nothing is listed whole.
 */
import { ARR, BOOL, NUM, OBJ, STR } from '../json/parser';
import { escapeHtml } from '../engine/highlight';
import type { TallScroll } from '../engine/tall';
import { kit } from './kit';
import { rt } from '../i18n/ui';
import { SparseLines } from './lines-model';
import { CELL, rowBytes, type HugeNode, type HugeRow, type HugeSource, type Seg } from './source';

const TRH = 30;
const OVERSCAN = 12;
/** Columns at most. */
export const MAX_COLS = 50;

export interface HugeTableEvents {
  /** A row (or a cell in it) was chosen: the value and its path from the table's container. */
  select(node: HugeNode, rel: Seg[]): void;
  /** A cell holding an array or object was opened: show it as the table. */
  drill(node: HugeNode, rel: Seg[]): void;
  /** The columns and row count changed (the toolbar shows them). */
  shape(rows: number, cols: number): void;
  failed(e: unknown): void;
}

interface Col {
  key: string | null;
  label: string;
  w: number;
}

export class HugeTableView {
  private rows: SparseLines<HugeRow> | null = null;
  private node: HugeNode | null = null;
  private cols: Col[] = [];
  private sc: TallScroll;
  private head: HTMLElement;
  private sizer: HTMLElement;
  private rowsEl: HTMLElement;
  private empty: HTMLElement;
  private ro: ResizeObserver;
  private rFirst = -1;
  private rLast = -1;
  private y = NaN;
  private raf = 0;
  /** The active row (keyboard) and the row Find went to. */
  private ar = -1;
  private hitRow = -1;
  private cw = 7.5;
  private dead = false;

  constructor(
    readonly el: HTMLElement,
    private readonly src: HugeSource,
    private readonly ev: HugeTableEvents,
  ) {
    this.head = el.querySelector('.tb-head') as HTMLElement;
    this.sizer = el.querySelector('.tb-sizer') as HTMLElement;
    this.rowsEl = el.querySelector('.tb-rows') as HTMLElement;
    this.empty = el.querySelector('.tb-empty') as HTMLElement;
    this.sc = new kit.Scroll(el);
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    el.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
  }

  destroy() {
    this.dead = true;
    this.rows?.reset();
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('keydown', this.onKey);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
  }

  /** Shows container `node` (null or a scalar: the table says what it can show). */
  setNode(node: HugeNode | null) {
    this.rows?.reset();
    this.node = node && node.t >= ARR ? node : null;
    this.cols = [];
    this.ar = this.hitRow = -1;
    this.sc.top = 0;
    this.empty.hidden = !!this.node;
    this.head.hidden = !this.node;
    if (!this.node) {
      this.rows = null;
      this.el.removeAttribute('role');
      this.el.removeAttribute('tabindex');
      this.head.innerHTML = this.rowsEl.innerHTML = '';
      this.sc.fit(0, this.sizer);
      this.ev.shape(0, 0);
      return;
    }
    const c = this.node;
    this.el.setAttribute('role', 'grid');
    this.el.tabIndex = 0;
    this.el.setAttribute('aria-label', rt('Table'));
    this.el.setAttribute('aria-rowcount', String(c.count + 1));
    const rows = (this.rows = new SparseLines<HugeRow>((from, n, signal) => this.src.rows(c, from, n, MAX_COLS, signal), rowBytes));
    rows.count = c.count;
    rows.loaded = () => {
      if (!this.cols.length) this.buildCols();
      this.redraw();
    };
    rows.failed = (e) => this.ev.failed(e);
    this.sc.fit(c.count * TRH, this.sizer);
    this.head.innerHTML = '';
    this.render(true);
  }

  /** After an edit: `node` (the same container, read again) with its rows and columns read again, scrolled as it was. */
  reload(node: HugeNode) {
    const top = this.sc.top;
    const ar = this.ar;
    this.setNode(node);
    if (!this.node) return;
    this.sc.top = top;
    this.ar = Math.min(ar, node.count - 1);
    this.render(true);
  }

  /** The container's count grew (indexing). */
  grow(node: HugeNode) {
    if (!this.node || !this.rows || node.at !== this.node.at || node.depth !== this.node.depth) return;
    this.node = node;
    this.rows.count = node.count;
    this.el.setAttribute('aria-rowcount', String(node.count + 1));
    this.sc.fit(node.count * TRH, this.sizer);
    this.ev.shape(node.count, Math.max(0, this.cols.length - 1));
    this.redraw();
  }

  get container() {
    return this.node;
  }

  /** Columns from the rows read so far (the first block): their members, in order of appearance. */
  private buildCols() {
    const rows = this.rows!;
    const isObj = this.node!.t === OBJ;
    const seen = new Map<string, number>();
    let hasValue = false;
    const lens: number[] = [];
    let keyLen = isObj ? 3 : 1;
    // From the first rows read and the rows in view, whichever arrived first (blocks may come in any order).
    let found = 0;
    const where = new Set<number>();
    for (let k = 0; k < Math.min(rows.count, 128); k++) where.add(k);
    for (let k = Math.max(0, this.rFirst); k < Math.min(rows.count, this.rLast, Math.max(0, this.rFirst) + 128); k++) where.add(k);
    for (const k of where) {
      const r = rows.get(k);
      if (!r) continue;
      found++;
      keyLen = Math.max(keyLen, String(r.node.key ?? k).length);
      if (!r.cells) {
        hasValue = true;
        continue;
      }
      for (const [key, cell] of r.cells) {
        if (!seen.has(key)) {
          if (seen.size >= MAX_COLS) continue;
          seen.set(key, seen.size);
          lens.push(key.length + 2);
        }
        const j = seen.get(key)!;
        lens[j] = Math.max(lens[j], cell.t >= ARR ? 6 : cellText(cell).length);
      }
    }
    // (No row read yet: the columns wait for the next ones.)
    if (!found) return;
    const cols: Col[] = [{ key: null, label: isObj ? 'key' : '#', w: Math.round(Math.min(28, Math.max(3, keyLen)) * this.cw + 28) }];
    if (hasValue) cols.push({ key: null, label: 'value', w: Math.round(30 * this.cw + 28) });
    for (const [key, j] of seen) cols.push({ key, label: key, w: Math.round(Math.min(46, Math.max(5, lens[j])) * this.cw + 28) });
    this.cols = cols;
    this.el.style.setProperty('--tb-cols', cols.map((c) => c.w + 'px').join(' '));
    this.el.style.setProperty('--tb-w', cols.reduce((a, c) => a + c.w, 0) + 'px');
    this.el.setAttribute('aria-colcount', String(cols.length));
    this.head.innerHTML = cols.map((c, i) => `<div class="tb-th${i === 0 ? ' tb-c0' : ''}" role="columnheader">${escapeHtml(c.label)}</div>`).join('');
    this.ev.shape(rows.count, cols.length - 1);
  }

  private redraw() {
    if (this.dead || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render(true);
    });
  }

  private onScroll = () => {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
  };

  render(force: boolean) {
    if (this.dead || !this.rows || this.el.hidden) return;
    const n = this.rows.count;
    const st = this.sc.top;
    const vh = this.sc.height - 32;
    const vf = Math.floor(st / TRH);
    const vl = Math.min(n, Math.ceil((st + vh) / TRH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return this.place();
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(n, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    this.rows.want(first, last);
    let html = '';
    for (let r = first; r < last; r++) html += this.row(r, this.rows.get(r));
    this.rowsEl.innerHTML = html;
    if (this.ar >= first && this.ar < last) this.el.setAttribute('aria-activedescendant', `htb-${this.ar}`);
    else this.el.removeAttribute('aria-activedescendant');
    this.place();
  }

  private row(r: number, row: HugeRow | undefined): string {
    const act = r === this.ar;
    const cls = `tb-r${act ? ' sel' : ''}${r === this.hitRow ? ' hit cur' : ''}`;
    const attrs = `role="row" aria-rowindex="${r + 2}"${act ? ` id="htb-${r}" aria-selected="true"` : ''} data-r="${r}"`;
    if (!row) return `<div class="${cls} hg-ph" ${attrs} aria-busy="true"><div class="tb-td tb-c0" role="rowheader">${r}</div><div class="tb-td" role="gridcell"><i class="hg-sk" style="width:${60 + ((r * 29) % 140)}px"></i></div></div>`;
    const isObj = this.node?.t === OBJ;
    let html = `<div class="${cls}" ${attrs}><div class="tb-td tb-c0" role="rowheader" data-c="0">${escapeHtml(isObj ? String(row.node.key) : String(r))}</div>`;
    for (let ci = 1; ci < this.cols.length; ci++) {
      const col = this.cols[ci];
      const c = col.key === null ? (row.cells ? null : row.node) : (row.cells?.get(col.key) ?? null);
      html += `<div class="tb-td" role="gridcell" data-c="${ci}">`;
      if (!c) html += '<span class="tb-x">·</span></div>';
      else if (c.t >= ARR) html += `<button type="button" class="tb-dr" data-c="${ci}" tabindex="-1">${c.t === OBJ ? `{${rt.num(c.count)}}` : `[${rt.num(c.count)}]`}</button></div>`;
      else {
        const cls2 = c.t === STR ? 'tv-s' : c.t === NUM ? 'tv-n' : c.t === BOOL ? 'tv-l' : 'tv-z';
        let t = cellText(c);
        if (t.length > CELL) t = t.slice(0, CELL) + '…';
        else if (c.clipped) t += '…';
        html += `<span class="${cls2}">${escapeHtml(t)}</span></div>`;
      }
    }
    return html + '</div>';
  }

  private place() {
    const y = this.rFirst * TRH + this.sc.shift;
    if (y !== this.y) this.rowsEl.style.transform = `translateY(${(this.y = y)}px)`;
  }

  /** Scrolls to row `r` and makes it the active one (`hit`: the one Find went to). */
  gotoRow(r: number, hit = false) {
    if (!this.rows) return;
    r = Math.max(0, Math.min(this.rows.count - 1, r));
    this.ar = r;
    if (hit) this.hitRow = r;
    const y = r * TRH;
    const st = this.sc.top;
    const vh = this.sc.height - 32;
    if (y < st || y + TRH > st + vh) this.sc.top = Math.max(0, y - vh / 2);
    this.render(true);
  }

  /** The value of row `r` and, for `ci`, its cell, with their path from the container. */
  private pick(r: number, ci: number): { node: HugeNode; rel: Seg[] } | null {
    const row = this.rows?.get(r);
    if (!row) return null;
    const key = row.node.key ?? r;
    const col = this.cols[ci];
    if (ci > 0 && col?.key !== null && col && row.cells?.get(col.key)) return { node: row.cells.get(col.key)!, rel: [key, col.key] };
    return { node: row.node, rel: [key] };
  }

  /** A right click on a cell: selects its value (the edit menu acts on it). */
  pickAt(t: HTMLElement) {
    const r = t.closest('.tb-r') as HTMLElement | null;
    if (!r) return;
    const ri = Number(r.dataset.r);
    const cell = t.closest('[data-c]') as HTMLElement | null;
    const p = this.pick(ri, cell ? Number(cell.dataset.c) : 0);
    this.el.focus({ preventScroll: true });
    this.ar = ri;
    this.render(true);
    if (p) this.ev.select(p.node, p.rel);
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const r = t.closest('.tb-r') as HTMLElement | null;
    if (!r) return;
    const ri = Number(r.dataset.r);
    const cell = t.closest('[data-c]') as HTMLElement | null;
    const p = this.pick(ri, cell ? Number(cell.dataset.c) : 0);
    this.el.focus({ preventScroll: true });
    this.ar = ri;
    this.render(true);
    if (!p) return;
    if (t.closest('.tb-dr')) this.ev.drill(p.node, p.rel);
    else this.ev.select(p.node, p.rel);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target !== this.el || !this.rows) return;
    const n = this.rows.count;
    if (!n) return;
    const page = Math.max(1, Math.floor((this.sc.height - 32) / TRH) - 1);
    let r = this.ar;
    switch (e.key) {
      case 'ArrowDown':
        r = Math.min(n - 1, r + 1);
        break;
      case 'ArrowUp':
        r = Math.max(0, r - 1);
        break;
      case 'PageDown':
        r = Math.min(n - 1, r + page);
        break;
      case 'PageUp':
        r = Math.max(0, r - page);
        break;
      case 'Home':
        r = 0;
        break;
      case 'End':
        r = n - 1;
        break;
      case 'Enter': {
        const p = this.pick(r, 0);
        if (p) (p.node.t >= ARR ? this.ev.drill : this.ev.select)(p.node, p.rel);
        e.preventDefault();
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    this.gotoRow(r);
    const p = this.pick(r, 0);
    if (p) this.ev.select(p.node, p.rel);
  };
}

/** A scalar cell's text: a string decoded, the rest as written (the node's text either way). */
const cellText = (c: HugeNode) => c.text;
