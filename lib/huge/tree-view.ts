/*
 * The huge tree: TreeModel's rows drawn like the normal tree's (same markup and classes, so it looks and
 * reads the same to screen readers), over TallScroll. A row whose node hasn't been read yet is a
 * placeholder until its page arrives; a container of millions lists a page of 1,000 at a time, with
 * "Show previous" / "Show next 1,000" rows and "Go to index…".
 */
import { ARR, BOOL, NUL, NUM, OBJ, STR } from '../json/parser';
import { escapeHtml } from '../engine/highlight';
import type { TallScroll } from '../engine/tall';
import { kit } from './kit';
import { rt } from '../i18n/ui';
import { PRIVATE } from '../analytics';
import { NodeCache, PAGE, TreeModel, type Cursor, type Open, type Row } from './tree-model';
import type { HugeNode, HugeSource, Seg } from './source';

const RH = 24;
const IND = 16;
const IND_DEPTH = 30;
const OVERSCAN = 24;

export interface HugeTreeEvents {
  /** The cursor moved onto a value (`how`: by pointer or key), with its path. */
  select(node: HugeNode, path: Seg[], how: 'pointer' | 'key'): void;
  copy(node: HugeNode, path: Seg[], what: 'value' | 'path'): void;
  /** "Go to index…" in container `o`. */
  gotoIndex(o: Open): void;
  escape(): void;
  failed(e: unknown): void;
}

export class HugeTreeView {
  readonly model = new TreeModel();
  readonly cache: NodeCache;
  private sc: TallScroll;
  private sizer: HTMLElement;
  private rowsEl: HTMLElement;
  private acts: HTMLElement;
  private ro: ResizeObserver;
  private rFirst = -1;
  private rLast = -1;
  private y = NaN;
  private raf = 0;
  private hover = -1;
  private q = '';
  private qn = '';
  private cs = false;
  /** The value Find went to (its offset). */
  private hit = -1;
  /** A selection made before its row's node was read: reported once it is. */
  private selPending: 'pointer' | 'key' | null = null;
  private dead = false;
  private marked = false;

  constructor(
    readonly el: HTMLElement,
    private readonly src: HugeSource,
    private readonly ev: HugeTreeEvents,
  ) {
    this.cache = new NodeCache(src);
    this.cache.loaded = () => this.redraw();
    this.cache.failed = (e) => ev.failed(e);
    this.sizer = el.querySelector('.tv-sizer') as HTMLElement;
    this.rowsEl = el.querySelector('.tv-rows') as HTMLElement;
    this.acts = el.querySelector('.tv-acts') as HTMLElement;
    this.sc = new kit.Scroll(el);
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('mouseover', this.onOver);
    el.addEventListener('mouseleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(el);
  }

  destroy() {
    this.dead = true;
    this.cache.clear();
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('mouseover', this.onOver);
    this.el.removeEventListener('mouseleave', this.onLeave);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
  }

  /** The root as the index has it now (its count grew, or it ended): what is open stays open. */
  updateRoot(root: HugeNode) {
    const o = this.model.root;
    if (!o || o.node.at !== root.at || o.node.depth !== root.depth) return;
    o.node = root;
    this.cache.refresh(!root.partial);
    this.model.recount();
    this.redraw();
  }

  setRoot(root: HugeNode) {
    this.model.setRoot(root);
    this.cache.clear();
    this.sc.top = 0;
    this.fit();
    this.render(true);
  }

  private fit() {
    this.sc.fit(this.model.count * RH, this.sizer);
  }

  /** Redraws in the next frame (pages arrived, counts grew). */
  redraw() {
    if (this.dead || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.fit();
      this.render(true);
      if (this.selPending) {
        const how = this.selPending;
        const n = this.cursorNode();
        if (n) {
          this.selPending = null;
          this.ev.select(n, this.cursorPath(), how);
        }
      }
    });
  }

  // ── Nodes and paths ─────────────────────────────────────────────────────

  /** A node row's value (undefined: not read yet). */
  nodeOf(row: Row): HugeNode | undefined {
    if (row.kind !== 'node') return undefined;
    if (row.open) return row.open.node;
    return this.cache.get(row.parent!.node, row.i);
  }

  /** The value the cursor is on (undefined: none, or not read yet). */
  cursorNode(): HugeNode | undefined {
    const c = this.model.cursor;
    if (!c || c.kind !== 'node') return undefined;
    if (!c.path.length) return this.model.root?.node;
    const open = this.model.openAt(c.path);
    if (open) return open.node;
    const parent = this.model.openAt(c.path.slice(0, -1));
    return parent ? this.cache.get(parent.node, c.path[c.path.length - 1]) : undefined;
  }

  /** The cursor's path as keys ($.a[3].b). */
  cursorPath(c: Cursor | null = this.model.cursor): Seg[] {
    if (!c) return [];
    const segs: Seg[] = [];
    let o = this.model.root;
    for (let k = 0; o && k < c.path.length; k++) {
      const i = c.path[k];
      const kid = o.kids.get(i);
      const n = kid?.node ?? this.cache.get(o.node, i);
      segs.push(n?.key ?? i);
      o = kid ?? null;
    }
    return segs;
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  /** Opens the containers down to the last of `chain` and puts the cursor on it (centred). */
  reveal(chain: HugeNode[], how: 'key' | 'pointer' | null = 'key') {
    if (!chain.length || !this.model.root) return;
    this.model.reveal(chain);
    this.fit();
    this.scrollToCursor(true);
    this.render(true);
    if (how) this.ev.select(chain[chain.length - 1], this.cursorPath(), how);
  }

  /** Goes to item `i` of container `o` (its page is listed). */
  gotoIndex(o: Open, i: number) {
    this.model.show(o, i);
    this.model.cursor = { path: [...o.path, i], kind: 'node' };
    this.fit();
    this.scrollToCursor(true);
    this.render(true);
    this.selected('key');
  }

  collapseAll() {
    this.model.collapseAll();
    this.fit();
    this.sc.top = 0;
    this.render(true);
    this.selected('key');
  }

  /** Marks the find match at offset `at` (its row: once revealed) and the query's text in rows. */
  setFind(q: string, at: number) {
    this.q = q;
    this.cs = q !== q.toLowerCase();
    this.qn = this.cs ? q : q.toLowerCase();
    this.hit = at;
    this.render(true);
  }

  /** Re-reads the counts of open containers still being indexed (call as indexing advances). */
  async refreshCounts(all = false) {
    const opens = this.model.opens().filter((o) => all || o.node.partial);
    if (!opens.length) return;
    this.cache.refresh(all);
    for (const o of opens) {
      try {
        let fresh: HugeNode | undefined;
        if (!o.path.length) fresh = await this.src.root();
        else {
          const parent = this.model.openAt(o.path.slice(0, -1));
          if (!parent) continue;
          fresh = (await this.src.children(parent.node, o.path[o.path.length - 1], 1))[0];
        }
        if (this.dead) return;
        if (fresh && fresh.at === o.node.at) o.node = fresh;
      } catch (e) {
        if (!this.dead) this.ev.failed(e);
        return;
      }
    }
    this.model.recount();
    this.redraw();
  }

  focus() {
    this.el.focus({ preventScroll: true });
    if (!this.model.cursor && this.model.count) {
      this.model.moveTo(0);
      this.render(true);
      this.selected('key');
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private onScroll = () => {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
  };

  render(force: boolean) {
    if (this.dead || this.el.hidden) return;
    const count = this.model.count;
    const st = this.sc.top;
    const vh = this.sc.height;
    const vf = Math.floor(st / RH);
    const vl = Math.min(count, Math.ceil((st + vh) / RH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) {
      if (this.sc.shift + this.rFirst * RH !== this.y) this.place();
      return;
    }
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(count, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    const cur = this.model.cursorRow();
    const keep = new Set<string>();
    let html = '';
    let items = false;
    for (let r = first; r < last; r++) {
      const row = this.model.rowAt(r);
      if (!row) break;
      if (row.kind === 'node' && row.parent && !row.open) {
        keep.add(this.cache.pageKey(row.parent.node, row.i));
        items ||= !!this.nodeOf(row);
      }
      html += this.row(row, r, r === cur);
    }
    // (Tests and timing read when the first items of the file were drawn.)
    if (items && !this.marked) {
      this.marked = true;
      performance.mark('tk:huge:rows');
    }
    // (Reads for rows scrolled away are dropped.)
    this.cache.keepOnly(keep);
    this.rowsEl.innerHTML = html;
    if (cur >= first && cur < last) this.el.setAttribute('aria-activedescendant', 'htv-sel');
    else this.el.removeAttribute('aria-activedescendant');
    this.place();
  }

  private place() {
    const y = this.rFirst * RH + this.sc.shift;
    if (y !== this.y) this.rowsEl.style.transform = `translateY(${(this.y = y)}px)`;
    this.placeActs();
  }

  private mark(raw: string): string {
    if (!this.q) return escapeHtml(raw);
    const hay = this.cs ? raw : raw.toLowerCase();
    let i = hay.indexOf(this.qn);
    if (i < 0) return escapeHtml(raw);
    let out = '';
    let p = 0;
    while (i >= 0) {
      out += escapeHtml(raw.slice(p, i)) + '<mark>' + escapeHtml(raw.slice(i, i + this.qn.length)) + '</mark>';
      p = i + this.qn.length;
      i = hay.indexOf(this.qn, p);
    }
    return out + escapeHtml(raw.slice(p));
  }

  private indent(depth: number) {
    const deep = depth > IND_DEPTH;
    const pad = deep ? 'calc(var(--tv-indent) + 6px)' : depth * IND + 6 + 'px';
    const guide = depth ? `<i class="tv-g" style="width:${deep ? 'var(--tv-indent)' : depth * IND + 'px'}"></i>` : '';
    return { deep, pad, guide };
  }

  private row(row: Row, r: number, cur: boolean): string {
    const { deep, pad, guide } = this.indent(row.depth);
    const sel = cur ? ' sel" id="htv-sel" aria-selected="true' : '';
    if (row.kind !== 'node') {
      const o = row.parent;
      const next = row.kind === 'next';
      const left = next ? o.node.count - (o.from + o.listed) : o.from;
      const n = Math.min(PAGE, left);
      const label = next ? rt('Show next {n}', { n: rt.num(n) }) : rt('Show previous {n}', { n: rt.num(n) });
      const more = next && o.node.partial ? rt('{n}+ more (still counting)', { n: rt.num(left) }) : rt.n(left, '{n} more', '{n} more');
      return `<div class="tv-r hg-page${sel}" data-i="${r}" role="treeitem" aria-level="${row.depth + 1}" aria-label="${escapeHtml(`${label} · ${more}`)}" style="padding-left:${pad}">${guide}<b class="tv-t n"></b><button type="button" class="hg-pg" data-a="${row.kind}" tabindex="-1">${escapeHtml(label)}</button><span class="hg-left ${PRIVATE}">${escapeHtml(more)}</span><button type="button" class="hg-pg hg-go" data-a="goto" tabindex="-1">${escapeHtml(rt('Go to index…'))}</button></div>`;
    }
    const n = this.nodeOf(row);
    const depthTag = deep ? `<span class="tv-depth ${PRIVATE}" aria-hidden="true">↳${row.depth}</span>` : '';
    const parent = row.parent;
    const pos = parent ? ` aria-setsize="${parent.node.count}" aria-posinset="${row.i + 1}"` : '';
    if (!n) {
      // Not read yet: a placeholder, its width varying a little from row to row.
      const w = 90 + ((row.i * 37) % 120);
      return `<div class="tv-r hg-ph${deep ? ' tv-deep' : ''}${sel}" data-i="${r}" role="treeitem" aria-level="${row.depth + 1}"${pos} aria-busy="true" aria-label="${escapeHtml(rt('Loading…'))}" style="padding-left:${pad}">${guide}<b class="tv-t n"></b>${depthTag}<i class="hg-sk" style="width:${w}px"></i></div>`;
    }
    const cont = n.t >= ARR;
    const isHit = this.hit >= 0 && n.at === this.hit;
    let cls = 'tv-r';
    if (deep) cls += ' tv-deep';
    if (isHit) cls += ' hit cur';
    let h = `<div class="${cls}${sel}" data-i="${r}" role="treeitem" aria-level="${row.depth + 1}"${pos}`;
    if (cont) h += ` aria-expanded="${!!row.open}"`;
    h += ` style="padding-left:${pad}">${guide}`;
    h += cont ? `<b class="tv-t${row.open ? ' o' : ''}"></b>` : '<b class="tv-t n"></b>';
    h += depthTag;
    if (!parent) h += '<span class="tv-root">root</span>';
    else if (typeof n.key === 'number') h += `<span class="tv-i">${n.key}</span><span class="tv-c">:</span>`;
    else if (n.key === '') h += '<span class="tv-k empty">""</span><span class="tv-c">:</span>';
    else h += `<span class="tv-k">${this.mark(String(n.key))}</span><span class="tv-c">:</span>`;
    if (cont) {
      const isObj = n.t === OBJ;
      // (Still being read and not counted yet: an ellipsis.)
      const count = n.partial && !n.count ? '…' : rt.num(n.count) + (n.partial ? '+' : '');
      h += `<span class="tv-b"${n.partial ? ` title="${escapeHtml(rt('Still counting: the file is being indexed'))}"` : ''}>${isObj ? '{' : '['}${count}${isObj ? '}' : ']'}</span>`;
      if (!row.open && n.count && n.text) h += `<span class="tv-p">${this.mark(n.text)}</span>`;
      return h + '</div>';
    }
    switch (n.t) {
      case STR: {
        const s = n.text;
        const shown = JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
        const title = s.length > 60 ? ` title="${escapeHtml(s.length > 2000 ? s.slice(0, 2000) + '…' : s)}"` : '';
        h += `<span class="tv-s"${title}>${this.mark(n.clipped && s.length <= 400 ? shown.slice(0, -1) + '…"' : shown)}</span>`;
        if (n.clipped) h += `<span class="hg-size ${PRIVATE}">${escapeHtml(rt.bytes(n.end - n.at))}</span>`;
        break;
      }
      case NUM:
        h += `<span class="tv-n">${this.mark(n.text)}</span>`;
        break;
      case BOOL:
        h += `<span class="tv-l">${this.mark(n.text)}</span>`;
        break;
      case NUL:
        h += `<span class="tv-z">${this.mark('null')}</span>`;
        break;
    }
    return h + '</div>';
  }

  private placeActs() {
    if (!this.acts) return;
    let i = this.hover;
    const cur = this.model.cursorRow();
    if (i < 0) i = cur;
    const row = i >= 0 ? this.model.rowAt(i) : null;
    if (!row || row.kind !== 'node' || !this.nodeOf(row)) {
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
    }
  };

  private onLeave = () => {
    this.hover = -1;
    this.placeActs();
  };

  // ── Interaction ─────────────────────────────────────────────────────────

  private scrollToCursor(center: boolean) {
    const i = this.model.cursorRow();
    if (i < 0) return;
    const top = i * RH;
    const st = this.sc.top;
    const vh = this.sc.height;
    if (top < st || top + RH > st + vh) this.sc.top = center ? top - vh / 2 + RH / 2 : top < st ? top : top - vh + RH;
  }

  /** The cursor moved: tell the session (once its node is read). */
  private selected(how: 'pointer' | 'key') {
    const n = this.cursorNode();
    if (n) {
      this.selPending = null;
      this.ev.select(n, this.cursorPath(), how);
    } else this.selPending = this.model.cursor?.kind === 'node' ? how : null;
  }

  private moveTo(r: number, how: 'pointer' | 'key') {
    if (!this.model.moveTo(r)) return;
    this.scrollToCursor(false);
    this.render(true);
    this.selected(how);
  }

  /** Opens or closes the container at row `r`. */
  private toggle(r: number, open?: boolean) {
    const row = this.model.rowAt(r);
    if (!row || row.kind !== 'node' || !row.parent) return;
    const n = this.nodeOf(row);
    if (!n || n.t < ARR) return;
    const want = open ?? !row.open;
    if (want === !!row.open) return;
    if (want) this.model.open(row.parent, row.i, n);
    else this.model.close(row.parent, row.i);
    this.fit();
    this.render(true);
  }

  /** Runs a paging row's action. */
  private page(row: Row, action: string) {
    if (row.kind === 'node') return;
    const o = row.parent;
    if (action === 'goto') return this.ev.gotoIndex(o);
    const at = this.model.cursorRow();
    if (action === 'next') this.model.next(o);
    else {
      // Show previous: the rows above grow; the view keeps its place.
      const before = this.model.count;
      this.model.prev(o);
      this.sc.top += (this.model.count - before) * RH;
    }
    this.fit();
    // The cursor stays on the paging row it was on (it moved with the window).
    if (at >= 0) this.scrollToCursor(false);
    this.render(true);
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const act = t.closest('.tv-acts button[data-a]') as HTMLElement | null;
    if (act) {
      const row = this.model.rowAt(Number(this.acts.dataset.i));
      const n = row && this.nodeOf(row);
      if (row && n) this.ev.copy(n, this.cursorPath(this.model.cursorOf(row)), act.dataset.a === 'path' ? 'path' : 'value');
      return;
    }
    const r = t.closest('.tv-r') as HTMLElement | null;
    if (!r) return;
    const i = Number(r.dataset.i);
    const row = this.model.rowAt(i);
    if (!row) return;
    this.el.focus({ preventScroll: true });
    const btn = t.closest('button[data-a]') as HTMLElement | null;
    if (row.kind !== 'node') {
      this.moveTo(i, 'pointer');
      if (btn) this.page(row, btn.dataset.a!);
      return;
    }
    this.moveTo(i, 'pointer');
    const n = this.nodeOf(row);
    if (n && n.t >= ARR && row.parent && (t.classList.contains('tv-t') || !window.getSelection()?.toString())) this.toggle(i);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target !== this.el) return;
    const count = this.model.count;
    if (!count) return;
    let i = this.model.cursorRow();
    const row = i >= 0 ? this.model.rowAt(i) : null;
    const n = row ? this.nodeOf(row) : undefined;
    const page = Math.max(1, Math.floor(this.sc.height / RH) - 1);
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        i = Math.min(count - 1, i + 1);
        break;
      case 'ArrowUp':
        i = Math.max(0, i - 1);
        break;
      case 'PageDown':
        i = Math.min(count - 1, i + page);
        break;
      case 'PageUp':
        i = Math.max(0, i - page);
        break;
      case 'Home':
        i = 0;
        break;
      case 'End':
        i = count - 1;
        break;
      case 'ArrowRight':
        if (row?.kind === 'node' && n && n.t >= ARR) {
          if (!row.open) this.toggle(i, true);
          else if (n.count) i++;
        }
        break;
      case 'ArrowLeft':
        if (row?.kind === 'node' && row.open && row.parent) this.toggle(i, false);
        else if (row && row.parent) i = this.model.rowOf(row.parent.path);
        break;
      case ' ':
      case 'Enter':
        if (row && row.kind !== 'node') this.page(row, row.kind);
        else if (row?.kind === 'node' && n && n.t >= ARR) this.toggle(i);
        break;
      case 'Escape':
        this.ev.escape();
        break;
      case 'c':
      case 'C':
        if (n && (mod || (!e.altKey && !e.shiftKey))) {
          if (mod && window.getSelection()?.toString()) return;
          this.ev.copy(n, this.cursorPath(), 'value');
        } else handled = false;
        break;
      case 'p':
      case 'P':
        if (n && !mod) this.ev.copy(n, this.cursorPath(), 'path');
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (i < 0) i = 0;
    this.moveTo(i, 'key');
  };
}
