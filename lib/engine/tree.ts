import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { preview } from '../json/format';
import { parsePath, resolve } from '../json/path';
import type { ValueHint } from '../json/smart';
import { escapeHtml } from './highlight';

/** Value hints (dates, JWTs, nested JSON…) load after first paint: they're just tooltips. */
let valueHints: ((n: JNode) => ValueHint[]) | null = null;
let hintsLoading = false;

/*
 * Virtualized tree: only the rows in view (+ overscan) exist in the DOM.
 * Rows are a flat array of visible nodes in document order; expand/collapse
 * splices that array instead of rebuilding it.
 */

export const RH = 24;
const IND = 16;
const OVERSCAN = 24;
const MAX_MATCHES = 100_000;
const SEP = String.fromCharCode(1);

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

const keyOf = (n: JNode) => {
  let k = '';
  for (let p: JNode | null = n; p && p.u; p = p.u) k = SEP + String(p.key) + k;
  return k;
};

export class TreeView {
  readonly el: HTMLElement;
  private sizer: HTMLElement;
  private rowsEl: HTMLElement;
  private acts: HTMLElement;
  private ev: TreeEvents;
  private ro: ResizeObserver;

  root: JNode | null = null;
  rows: JNode[] = [];
  sel: JNode | null = null;
  private limit = Infinity;
  private toggles = new Map<string, boolean>();
  private q = '';
  private qn = '';
  private cs = false;
  matches: JNode[] = [];
  private matchSet: Set<JNode> | null = null;
  mi = -1;
  private rFirst = -1;
  private rLast = -1;
  private raf = 0;
  private hover = -1;

  constructor(el: HTMLElement, ev: TreeEvents) {
    this.el = el;
    this.ev = ev;
    this.sizer = el.querySelector('.tv-sizer') as HTMLElement;
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
    cancelAnimationFrame(this.raf);
  }

  // ── Model ──────────────────────────────────────────────────────────────

  setRoot(root: JNode | null, reset: boolean, nodes = 0) {
    if (reset) {
      this.toggles.clear();
      this.limit = nodes <= 50_000 ? Infinity : nodes <= 500_000 ? 3 : 2;
      this.el.scrollTop = 0;
    }
    this.root = root;
    if (!root) this.sel = null;
    this.rebuild();
  }

  private rebuild() {
    this.rows = this.root ? this.flatten(this.root, '', true) : [];
    this.sizer.style.height = this.rows.length * RH + 'px';
    this.render(true);
  }

  private flatten(start: JNode, startKey: string, self: boolean): JNode[] {
    const rows: JNode[] = [];
    const useT = this.toggles.size > 0;
    const limit = this.limit;
    const walk = (n: JNode, key: string) => {
      rows.push(n);
      if (n.t < ARR) return;
      let open = n.d < limit;
      if (useT) {
        const t = this.toggles.get(key);
        if (t !== undefined) open = t;
      }
      n.x = open;
      if (open) {
        const list = kids(n);
        for (let i = 0; i < list.length; i++) walk(list[i], useT ? key + SEP + String(list[i].key) : '');
      }
    };
    if (self) walk(start, startKey);
    else {
      const list = kids(start);
      for (let i = 0; i < list.length; i++) walk(list[i], useT ? startKey + SEP + String(list[i].key) : '');
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
    this.sizer.style.height = this.rows.length * RH + 'px';
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
    this.el.scrollTop = 0;
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
    const st = this.el.scrollTop;
    const vh = this.el.clientHeight;
    if (top < st || top + RH > st + vh) {
      this.el.scrollTop = center ? top - vh / 2 + RH / 2 : top < st ? top : top - vh + RH;
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
    this.mi = -1;
    const root = this.root;
    if (q && root) {
      // `$.a[0]` / `/a/0` jump to that node; if it doesn't resolve, it's plain text ($ref, /v1/users…).
      const segs = q[0] === '$' || (q[0] === '/' && q.length > 1) ? parsePath(q) : null;
      const hit = segs && segs.length ? resolve(root, segs) : null;
      if (hit) this.matches = [hit];
      else {
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
      this.matchSet = new Set(this.matches);
      if (this.matches.length) {
        // Prefer the first match at or after the current selection.
        const from = this.sel ? this.sel.s : 0;
        let idx = this.matches.findIndex((m) => m.s >= from);
        if (idx < 0) idx = 0;
        this.mi = idx;
        if (jump) this.gotoMatch();
      }
    }
    this.render(true);
    return { total: this.matches.length, index: this.mi };
  }

  step(dir: 1 | -1) {
    const n = this.matches.length;
    if (!n) return { total: 0, index: -1 };
    this.mi = (this.mi + dir + n) % n;
    this.gotoMatch();
    return { total: n, index: this.mi };
  }

  private gotoMatch() {
    const m = this.matches[this.mi];
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
    if (!valueHints && !hintsLoading && this.rows.length) {
      hintsLoading = true;
      void import('../json/smart').then((m) => {
        valueHints = (n) => m.valueHints(n);
        this.render(true);
      });
    }
    const st = this.el.scrollTop;
    const vh = this.el.clientHeight;
    const vf = Math.floor(st / RH);
    const vl = Math.min(this.rows.length, Math.ceil((st + vh) / RH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return;
    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(this.rows.length, vl + OVERSCAN);
    this.rFirst = first;
    this.rLast = last;
    let html = '';
    for (let i = first; i < last; i++) html += this.row(this.rows[i], i);
    this.rowsEl.style.transform = `translateY(${first * RH}px)`;
    this.rowsEl.innerHTML = html;
    const si = this.sel ? this.indexOf(this.sel) : -1;
    if (si >= first && si < last) this.el.setAttribute('aria-activedescendant', 'tv-sel');
    else this.el.removeAttribute('aria-activedescendant');
    this.placeActs();
  }

  private mark(raw: string): string {
    if (!this.q || !this.matchSet) return escapeHtml(raw);
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
    if (sel) cls += ' sel';
    if (this.matchSet?.has(n)) cls += n === this.matches[this.mi] ? ' hit cur' : ' hit';
    const cont = n.t >= ARR;
    let h = `<div class="${cls}" data-i="${i}" role="treeitem" aria-level="${n.d + 1}"`;
    if (n.u) h += ` aria-setsize="${kids(n.u).length}" aria-posinset="${typeof n.key === 'number' ? n.key + 1 : kids(n.u).indexOf(n) + 1}"`;
    if (cont) h += ` aria-expanded="${n.x}"`;
    if (sel) h += ' id="tv-sel" aria-selected="true"';
    h += ` style="padding-left:${n.d * IND + 6}px">`;
    if (n.d) h += `<i class="tv-g" style="width:${n.d * IND}px"></i>`;
    h += cont ? `<b class="tv-t${n.x ? ' o' : ''}"></b>` : '<b class="tv-t n"></b>';
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
        const s = n.v as string;
        const shown = JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
        const hint = valueHints?.(n)[0];
        let extra = '';
        let vcls = 'tv-s';
        if (s.length < 64 && COLOR.test(s)) extra = `<i class="tv-sw" style="background:${s}"></i>`;
        else if (s.length < 2048 && URL_RE.test(s)) vcls += ' url';
        if (hint?.kind === 'json') extra += '<button type="button" class="tv-x" data-n="1" title="Expand this JSON string into real JSON">JSON</button>';
        else if (hint?.kind === 'jwt') extra += '<span class="tv-x">JWT</span>';
        let title = hint ? hint.label : '';
        if (s.length > 60) title = (title ? title + '\n\n' : '') + (s.length > 2000 ? s.slice(0, 2000) + '…' : s);
        h += `${extra}<span class="${vcls}"${title ? ` title="${escapeHtml(title)}"` : ''}>${this.mark(shown)}</span>`;
        break;
      }
      case NUM: {
        const raw = n.v as string;
        const hint = (raw.length === 10 || raw.length === 13) && valueHints ? valueHints(n)[0] : undefined;
        h += `<span class="tv-n"${hint ? ` title="${escapeHtml(hint.label)}"` : ''}>${this.mark(raw)}</span>`;
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
    this.acts.style.transform = `translateY(${i * RH}px)`;
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

  // ── Interaction ────────────────────────────────────────────────────────

  private choose(n: JNode, how: 'pointer' | 'key') {
    this.sel = n;
    this.scrollToSel(false);
    this.render(true);
    this.ev.select(n, how);
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
