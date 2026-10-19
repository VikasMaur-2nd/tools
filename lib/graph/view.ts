/*
 * The graph view: a canvas node-link diagram of the document (loaded on
 * demand the first time the Graph tab opens). This file owns the DOM, input
 * and state; painting is in ./render, camera math in ./camera.
 *
 * Builds are time-sliced (model, then layout, ~8 ms per task) and cancelled
 * by a newer document. The canvas only redraws on rAF when something
 * changed, and only what is in view.
 */
import { ARR, BOOL, NUL, NUM, STR, kids, type JNode } from '../json/parser';
import { formatPath, parsePath, pathOf, resolve, type Seg } from '../json/path';
import { soon } from '../engine/idle';
import { rt } from '../i18n/ui';
import { PRIVATE } from '../analytics';
import { G, cardOf, cardOfRow, childCards, fit, headText, labelText, locate, modelBuilder, valueText, type GraphModel } from './model';
import { cardAt, layouter, type GraphLayout } from './layout';
import { charWidth, readTheme, type GraphTheme } from './theme';
import { MARGIN, ZOOM_MAX, clamp, ease, fitCam, follow, initialCam, lerpCam, minZoom, zoomAt, type Cam } from './camera';
import { paint, partAt } from './render';
import { MINI_H, MINI_W, Minimap } from './minimap';
import type { FindResult, GraphEvents, GraphViewApi } from './types';

const MAX_MATCHES = 100_000;
const SLICE = 8;
const NOTE_AFTER = 150;
const TIP_DELAY = 450;
const DRAG = 4;

const ICON = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class GraphView implements GraphViewApi {
  private host: HTMLElement;
  private ev: GraphEvents;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private note: HTMLElement;
  private live: HTMLElement;
  private tip: HTMLElement;
  private ctl: HTMLElement;
  private pct: HTMLButtonElement;
  private mini: Minimap;
  private ro: ResizeObserver;
  private th: GraphTheme;

  private root: JNode | null = null;
  private nodes = 0;
  private active = false;
  private dirty = true;
  private reset = true;
  private token = 0;
  private building = false;
  /** Paths of collapsed cards, kept across edits of the same document. */
  private keep: Seg[][] = [];
  private keepFor: GraphLayout | null = null;
  private m: GraphModel | null = null;
  private L: GraphLayout | null = null;

  private cam: Cam = { x: -MARGIN, y: -MARGIN, s: 1 };
  private camSet = false;
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private raf = 0;
  private anim: { from: Cam; to: Cam; t0: number; ms: number } | null = null;

  private card = -1;
  private row = -1;
  private hoverCard = -1;
  private hoverRow = -1;
  /** A selection made before the layout exists. */
  private pending: { n: JNode; scroll: boolean; center: boolean } | null = null;

  private q = '';
  private matches: JNode[] = [];
  private mi = -1;
  private hitRow: Uint8Array | null = null;
  private hitCard: Uint8Array | null = null;
  private hitFor: GraphModel | null = null;

  private ptrs = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; cam: Cam; moved: boolean; id: number } | null = null;
  private pinch: { d: number; cam: Cam; cx: number; cy: number } | null = null;
  private miniDrag = false;
  private tipTimer = 0;

  constructor(host: HTMLElement, ev: GraphEvents) {
    this.host = host;
    this.ev = ev;
    host.classList.add('gv');
    if (!host.hasAttribute('tabindex')) host.tabIndex = 0;
    host.setAttribute('aria-roledescription', rt('graph'));
    host.setAttribute('aria-label', rt('JSON graph. Arrow keys move, Enter opens, Space collapses, + and - zoom.'));
    host.textContent = '';
    this.cv = el('canvas', 'gv-canvas ' + PRIVATE) as HTMLCanvasElement;
    this.cv.setAttribute('aria-hidden', 'true');
    this.ctx = this.cv.getContext('2d', { alpha: false });
    this.note = el('div', 'gv-note');
    this.note.hidden = true;
    this.note.setAttribute('role', 'status');
    this.live = el('div', 'gv-live ' + PRIVATE);
    this.live.setAttribute('aria-live', 'polite');
    this.tip = el('div', 'gv-tip ' + PRIVATE);
    this.tip.hidden = true;
    this.ctl = el('div', 'gv-ctl');
    this.ctl.hidden = true;
    const btn = (cls: string, label: string, html: string, fn: () => void) => {
      const b = el('button', 'gv-btn ' + cls) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.dataset.tip = label;
      b.dataset.tipUp = '';
      b.innerHTML = html;
      // Clicking keeps the focus where it was (the graph keeps its arrow keys); Tab still reaches the buttons.
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      this.ctl.append(b);
      return b;
    };
    btn('gv-out', rt('Zoom out'), ICON('M3.5 8h9'), () => this.zoomBy(1 / 1.25));
    this.pct = btn('gv-pct', rt('Zoom to 100%'), '100%', () => this.zoomTo(1));
    btn('gv-in', rt('Zoom in'), ICON('M3.5 8h9M8 3.5v9'), () => this.zoomBy(1.25));
    btn('gv-fit', rt('Fit to screen'), ICON('M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10'), () => this.fit());
    const mc = el('canvas', 'gv-mini ' + PRIVATE) as HTMLCanvasElement;
    mc.style.width = MINI_W + 'px';
    mc.style.height = MINI_H + 'px';
    mc.hidden = true;
    mc.setAttribute('aria-hidden', 'true');
    this.mini = new Minimap(mc);
    host.append(this.cv, this.ctl, mc, this.note, this.tip, this.live);
    this.th = readTheme(host);

    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('pointercancel', this.onUp);
    this.cv.addEventListener('pointerleave', this.onLeave);
    this.cv.addEventListener('dblclick', this.onDbl);
    this.cv.addEventListener('wheel', this.onWheel, { passive: false });
    mc.addEventListener('pointerdown', this.onMiniDown);
    mc.addEventListener('pointermove', this.onMiniMove);
    mc.addEventListener('pointerup', this.onMiniUp);
    host.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(host);
  }

  destroy() {
    this.token++;
    this.active = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.tipTimer);
    this.ro.disconnect();
    this.host.removeEventListener('keydown', this.onKey);
    this.host.textContent = '';
    this.mini.release();
    this.m = this.L = null;
    this.root = null;
  }

  // ── Document and build ─────────────────────────────────────────────────

  setRoot(root: JNode | null, reset: boolean, nodes: number, active: boolean) {
    if (!reset && this.L && this.keepFor !== this.L) {
      // Remember collapsed cards by path, to restore them in the edited document
      // (once per layout: edits arrive per keystroke, even while the view is hidden).
      const { m, collapsed } = this.L;
      this.keep = [];
      this.keepFor = this.L;
      for (let c = 0; c < m.n; c++) if (collapsed[c]) this.keep.push(pathOf(m.node[c]));
    } else if (reset) this.keep = [];
    this.reset = this.reset || reset;
    this.root = root;
    this.nodes = nodes;
    this.dirty = true;
    this.token++;
    this.building = false;
    this.matches = [];
    this.hitFor = null;
    if (active) this.activate();
  }

  activate() {
    this.active = true;
    this.measure();
    if (this.dirty) this.build();
    else this.redraw();
  }

  deactivate() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.anim = null;
    this.mini.release();
    this.hideTip();
  }

  private build() {
    this.dirty = false;
    const token = ++this.token;
    const root = this.root;
    if (!root) {
      this.m = this.L = null;
      this.card = this.row = -1;
      this.note.hidden = true;
      this.redraw();
      return;
    }
    const t0 = performance.now();
    this.building = true;
    const font = this.th.font;
    const step = modelBuilder(root, charWidth(font), this.nodes);
    let lay: ((deadline: number) => GraphLayout | null) | null = null;
    let m: GraphModel | null = null;
    const run = () => {
      if (token !== this.token) return;
      const deadline = performance.now() + SLICE;
      if (!m) {
        m = step(deadline);
        // The model's final pass and the layouter's setup each touch every card: give them their own tasks.
        if (m && m.n >= 50_000) {
          soon(run);
          return;
        }
      }
      if (m && !lay) {
        lay = layouter(m, this.restoreCollapsed(m));
        if (m.n >= 50_000) {
          soon(run);
          return;
        }
      }
      if (m && lay) {
        const L = lay(deadline);
        if (L) {
          this.building = false;
          this.note.hidden = true;
          this.adopt(L);
          return;
        }
      }
      if (performance.now() - t0 > NOTE_AFTER) {
        this.note.hidden = false;
        this.note.textContent = m ? rt('Laying out {n} cards…', { n: rt.num((m as GraphModel).n) }) : rt('Building the graph…');
      }
      soon(run);
    };
    run();
  }

  private restoreCollapsed(m: GraphModel) {
    const col = new Uint8Array(m.n);
    if (!this.reset && this.keep.length && this.root) {
      for (const segs of this.keep) {
        const n = resolve(this.root, segs);
        const c = n ? cardOf(m, n) : -1;
        if (c >= 0) col[c] = 1;
      }
    }
    return col;
  }

  private adopt(L: GraphLayout) {
    const prevSel = this.selNode();
    const first = this.reset || !this.camSet;
    this.reset = false;
    this.m = L.m;
    this.L = L;
    this.card = this.row = -1;
    if (prevSel && !this.pending) this.pending = { n: prevSel, scroll: false, center: false };
    if (first) {
      this.cam = initialCam(L.width, L.height, this.vw, this.vh, this.minZ());
      this.camSet = this.vw > 0;
    }
    if (this.q) this.search(this.q, false);
    const p = this.pending;
    this.pending = null;
    if (p) this.select(p.n, { scroll: p.scroll, center: p.center });
    this.redraw();
  }

  /** Re-lays out after collapsing/expanding, keeping card `keepCard` (if any) still on screen. */
  private relayout(keepCard = -1, then?: () => void) {
    const L0 = this.L;
    if (!L0) return;
    const m = L0.m;
    const sx = keepCard >= 0 ? (L0.x[keepCard] - this.cam.x) * this.cam.s : 0;
    const sy = keepCard >= 0 ? (L0.y[keepCard] - this.cam.y) * this.cam.s : 0;
    const token = ++this.token;
    const step = layouter(m, L0.collapsed);
    const t0 = performance.now();
    const run = () => {
      if (token !== this.token) return;
      const L = step(performance.now() + (m.n < 50_000 ? Infinity : SLICE));
      if (!L) {
        if (performance.now() - t0 > NOTE_AFTER) {
          this.note.hidden = false;
          this.note.textContent = rt('Laying out {n} cards…', { n: rt.num(m.n) });
        }
        soon(run);
        return;
      }
      this.note.hidden = true;
      this.L = L;
      if (keepCard >= 0 && L.shown[keepCard]) this.cam = { x: L.x[keepCard] - sx / this.cam.s, y: L.y[keepCard] - sy / this.cam.s, s: this.cam.s };
      this.mini.release();
      then?.();
      this.redraw();
    };
    run();
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  private measure() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width === this.vw && r.height === this.vh && dpr === this.dpr) return;
    this.vw = r.width;
    this.vh = r.height;
    this.dpr = dpr;
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.cv.style.width = r.width + 'px';
    this.cv.style.height = r.height + 'px';
    this.mini.release();
    if (this.L && !this.camSet && this.vw > 0) {
      this.cam = initialCam(this.L.width, this.L.height, this.vw, this.vh, this.minZ());
      this.camSet = true;
    }
    // Resizing clears the canvas: repaint now, not a frame later (no flash).
    if (this.active) this.draw();
  }

  private redraw() {
    if (!this.active || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.active || !this.ctx) return;
    const a = this.anim;
    if (a) {
      const t = Math.min(1, (now - a.t0) / a.ms);
      this.cam = lerpCam(a.from, a.to, ease(t), this.vw, this.vh);
      if (t >= 1) this.anim = null;
      else this.redraw();
    }
    this.draw();
  };

  /** Paints the current state now (also used by benchmarks). */
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = this.L;
    if (!L) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = this.th.bg;
      ctx.fillRect(0, 0, this.vw, this.vh);
      this.ctl.hidden = true;
      (this.mini.el as HTMLElement).hidden = true;
      return;
    }
    this.ctl.hidden = false;
    this.ensureHits();
    const cur = this.matches[this.mi];
    const at = cur && this.m ? locate(this.m, cur) : null;
    paint(ctx, L, this.th, this.cam, this.vw, this.vh, {
      card: this.card,
      row: this.row,
      hoverCard: this.hoverCard,
      hoverRow: this.hoverRow,
      hitRow: this.hitRow,
      hitCard: this.hitCard,
      curRow: at ? at.row : -1,
      curCard: at && at.row < 0 ? at.card : -1,
      dpr: this.dpr,
      grid: true,
    });
    this.pct.textContent = Math.round(this.cam.s * 100) + '%';
    // Minimap only when part of the graph is off-screen.
    const c = this.cam;
    const all = c.x <= 0 && c.y <= 0 && c.x + this.vw / c.s >= L.width && c.y + this.vh / c.s >= L.height;
    const small = this.vw < MINI_W * 2.5 || this.vh < MINI_H * 2.5;
    this.mini.el.hidden = all || small;
    if (!all && !small) this.mini.draw(L, this.th, c, this.vw, this.vh, this.dpr);
  }

  themeChanged() {
    this.th = readTheme(this.host);
    this.mini.release();
    this.redraw();
  }

  // ── Camera ─────────────────────────────────────────────────────────────

  private minZ() {
    const L = this.L;
    return L ? minZoom(L.width, L.height, this.vw, this.vh) : 0.02;
  }

  private moveTo(to: Cam, animate = true) {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce || !this.active) {
      this.anim = null;
      this.cam = to;
    } else {
      this.anim = { from: { ...this.cam }, to, t0: performance.now(), ms: 240 };
    }
    this.redraw();
  }

  private setCam(c: Cam) {
    this.anim = null;
    this.cam = c;
    this.hideTip();
    this.redraw();
  }

  fit() {
    const L = this.L;
    if (!L) return;
    this.moveTo(fitCam(L.width, L.height, this.vw, this.vh, this.minZ()));
  }

  zoomBy(f: number) {
    const base = this.anim ? this.anim.to : this.cam;
    this.moveTo(zoomAt(base, f, this.vw / 2, this.vh / 2, this.minZ(), ZOOM_MAX));
  }

  private zoomTo(s: number) {
    this.zoomBy(s / (this.anim ? this.anim.to : this.cam).s);
  }

  focus() {
    this.host.focus({ preventScroll: true });
  }

  /** Brings the selection into view. */
  private reveal(center: boolean, animate = true) {
    const L = this.L;
    const c = this.card;
    if (!L || c < 0 || !L.shown[c]) return;
    const m = L.m;
    let by = L.y[c];
    let bh = m.h[c];
    if (this.row >= 0) {
      by = L.y[c] + G.head + (this.row - m.rowStart[c]) * G.row;
      bh = G.row;
      // Show the card's header too when the row is near it.
      if (by - L.y[c] < this.vh / this.cam.s / 2) {
        bh += by - L.y[c];
        by = L.y[c];
      }
    }
    const base = this.anim ? this.anim.to : this.cam;
    let target = follow(base, L.x[c], by, m.w[c], bh, this.vw, this.vh, center);
    // Text too small to read: zoom in to 100% around the target.
    if (center && target.s < 0.6) target = follow({ ...target, s: 1 }, L.x[c], by, m.w[c], bh, this.vw, this.vh, true);
    if (target.x !== base.x || target.y !== base.y || target.s !== base.s) this.moveTo(target, animate);
    else this.redraw();
  }

  // ── Selection ──────────────────────────────────────────────────────────

  private selNode(): JNode | null {
    const m = this.m;
    if (!m || this.card < 0) return null;
    return this.row >= 0 ? m.rowNode[this.row] : m.node[this.card];
  }

  select(n: JNode | null, opts: { scroll?: boolean; center?: boolean } = {}) {
    const m = this.m;
    if (!n) {
      this.card = this.row = -1;
      this.redraw();
      return;
    }
    if (!m || this.building || this.dirty) {
      this.pending = { n, scroll: !!opts.scroll, center: !!opts.center };
      return;
    }
    // A container with a card is outlined; anything else highlights the row
    // showing it (a value inside an inline array: that array's row).
    const at = locate(m, n);
    let card = at.card;
    let row = -1;
    if (card < 0 && at.row >= 0) {
      row = at.row;
      card = cardOfRow(m, row);
    }
    if (card < 0) return;
    this.card = card;
    this.row = row;
    this.announce();
    const L = this.L;
    if (!L) return;
    if (opts.scroll || opts.center) {
      if (!L.shown[card]) {
        // Expand collapsed ancestors, then reveal.
        for (let a = m.parent[card]; a >= 0; a = m.parent[a]) L.collapsed[a] = 0;
        this.keepFor = null;
        this.relayout(-1, () => this.reveal(!!opts.center));
        return;
      }
      this.reveal(!!opts.center);
    } else this.redraw();
  }

  /** Selects card c / row r (from the pointer or keyboard) and tells the engine. */
  private choose(c: number, r: number, how: 'pointer' | 'key') {
    const m = this.m;
    if (!m) return;
    this.card = c;
    this.row = r;
    this.announce();
    if (how === 'key') this.reveal(false);
    else this.redraw();
    this.ev.select(r >= 0 ? m.rowNode[r] : m.node[c], how);
  }

  private announce() {
    const n = this.selNode();
    if (!n) return;
    const type = n.t === STR ? rt('string') : n.t === NUM ? rt('number') : n.t === BOOL ? rt('boolean') : n.t === NUL ? 'null' : n.t === ARR ? rt('array') : rt('object');
    const key = n.key === undefined ? rt('root') : typeof n.key === 'number' ? `[${n.key}]` : fit(n.key, 60, false);
    const val = n.t >= ARR ? rt.n(kids(n).length, '{n} item', '{n} items') : valueText(n);
    this.live.textContent = `${key}, ${type}, ${val}, ${formatPath(pathOf(n))}`;
  }

  // ── Collapse ───────────────────────────────────────────────────────────

  private toggle(c: number, open?: boolean) {
    const L = this.L;
    if (!L || !L.m.kids[c]) return;
    const next = open === undefined ? !L.collapsed[c] : !open;
    if (!!L.collapsed[c] === next) return;
    L.collapsed[c] = next ? 1 : 0;
    this.keepFor = null;
    this.relayout(c);
  }

  private setAll(fn: (c: number, m: GraphModel) => boolean) {
    const L = this.L;
    if (!L) return;
    const m = L.m;
    for (let c = 0; c < m.n; c++) L.collapsed[c] = m.kids[c] && fn(c, m) ? 1 : 0;
    this.keepFor = null;
    // The selection's card may become hidden: select its nearest shown ancestor.
    let keep = this.card >= 0 ? this.card : 0;
    for (let a = m.parent[keep]; a >= 0; a = m.parent[a]) if (L.collapsed[a]) keep = a;
    if (keep !== this.card) {
      this.card = keep;
      this.row = -1;
    }
    this.relayout(keep, () => this.fitIfLost());
  }

  private fitIfLost() {
    const L = this.L;
    if (!L) return;
    const c = this.cam;
    if (c.x > L.width || c.y > L.height || c.x + this.vw / c.s < 0 || c.y + this.vh / c.s < 0) this.cam = initialCam(L.width, L.height, this.vw, this.vh, this.minZ());
  }

  expandAll() {
    this.setAll(() => false);
  }

  collapseAll() {
    this.setAll((c) => c === 0);
    this.cam = initialCam(this.L?.width ?? 0, this.L?.height ?? 0, this.vw, this.vh, this.minZ());
  }

  expandTo(level: number) {
    this.setAll((c, m) => m.depth[c] >= level - 1);
  }

  // ── Find ───────────────────────────────────────────────────────────────

  search(q: string, jump: boolean): FindResult {
    this.q = q;
    this.matches = [];
    this.mi = -1;
    this.hitFor = null;
    const root = this.root;
    let note: string | undefined;
    if (q && root) {
      const segs = q[0] === '$' || (q[0] === '/' && q.length > 1) ? parsePath(q) : null;
      const hit = segs && segs.length ? resolve(root, segs) : null;
      if (!hit && q[0] === '$' && /\*|\.\.|\?|@|\[-?\d*:-?\d*\]/.test(q)) {
        note = 'Wildcards, filters and slices are not supported. Use a concrete path such as $.users[0].name';
      }
      if (hit) this.matches = [hit];
      else {
        const cs = q !== q.toLowerCase();
        const qn = cs ? q : q.toLowerCase();
        const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
        const stack: JNode[] = [root];
        while (stack.length && this.matches.length < MAX_MATCHES) {
          const n = stack.pop() as JNode;
          let h = typeof n.key === 'string' && has(n.key);
          if (!h) {
            if (n.t === STR || n.t === NUM) h = has(n.v as string);
            else if (n.t === BOOL) h = has(n.v ? 'true' : 'false');
            else if (n.t === NUL) h = has('null');
          }
          if (h) this.matches.push(n);
          if (n.t >= ARR) {
            const list = kids(n);
            for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
          }
        }
      }
      if (this.matches.length) {
        const sel = this.selNode();
        const from = sel ? sel.s : 0;
        let idx = this.matches.findIndex((x) => x.s >= from);
        if (idx < 0) idx = 0;
        this.mi = idx;
        if (jump) this.gotoMatch();
      }
    }
    this.redraw();
    return { total: this.matches.length, index: this.mi, note: this.matches.length ? undefined : note };
  }

  step(dir: 1 | -1): FindResult {
    const n = this.matches.length;
    if (!n) return { total: 0, index: -1 };
    this.mi = (this.mi + dir + n) % n;
    this.gotoMatch();
    return { total: n, index: this.mi };
  }

  private gotoMatch() {
    const hit = this.matches[this.mi];
    if (!hit) return;
    this.select(hit, { center: true });
    this.ev.select(hit, 'search');
  }

  /** Per-row / per-card hit flags for the current model. */
  private ensureHits() {
    const m = this.m;
    if (!m || this.hitFor === m) return;
    this.hitFor = m;
    if (!this.matches.length) {
      this.hitRow = this.hitCard = null;
      return;
    }
    const hr = new Uint8Array(m.rows);
    const hc = new Uint8Array(m.n);
    for (const n of this.matches) {
      const { card, row } = locate(m, n);
      if (row >= 0) hr[row] = 1;
      else if (card >= 0) hc[card] = 1;
    }
    this.hitRow = hr;
    this.hitCard = hc;
  }

  // ── Pointer ────────────────────────────────────────────────────────────

  private local(e: { clientX: number; clientY: number }) {
    const r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Card and part (row, -1 header, -2 chevron) under screen point; card -1 when none. */
  private pick(sx: number, sy: number): [number, number] {
    const L = this.L;
    if (!L) return [-1, -1];
    const wx = this.cam.x + sx / this.cam.s;
    const wy = this.cam.y + sy / this.cam.s;
    const c = cardAt(L, wx, wy);
    return c < 0 ? [-1, -1] : [c, partAt(L, c, wx, wy)];
  }

  private onDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    this.focus();
    const p = this.local(e);
    this.ptrs.set(e.pointerId, p);
    this.cv.setPointerCapture(e.pointerId);
    this.anim = null;
    this.hideTip();
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cam: { ...this.cam }, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.down = null;
      return;
    }
    this.down = { x: p.x, y: p.y, cam: { ...this.cam }, moved: false, id: e.pointerId };
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const pc = this.pinch;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const z = zoomAt(pc.cam, d / pc.d, pc.cx, pc.cy, this.minZ(), ZOOM_MAX);
      this.setCam({ x: z.x - (cx - pc.cx) / z.s, y: z.y - (cy - pc.cy) / z.s, s: z.s });
      return;
    }
    const dn = this.down;
    if (dn && dn.id === e.pointerId) {
      const dx = p.x - dn.x;
      const dy = p.y - dn.y;
      if (!dn.moved && Math.hypot(dx, dy) > DRAG) {
        dn.moved = true;
        this.host.classList.add('gv-drag');
      }
      if (dn.moved) this.setCam({ x: dn.cam.x - dx / dn.cam.s, y: dn.cam.y - dy / dn.cam.s, s: dn.cam.s });
      return;
    }
    if (e.pointerType === 'touch') return;
    // Hover.
    const [c, part] = this.pick(p.x, p.y);
    const r = c >= 0 && part >= 0 ? part : -1;
    if (c !== this.hoverCard || r !== this.hoverRow) {
      this.hoverCard = c;
      this.hoverRow = c >= 0 ? r : -1;
      this.host.classList.toggle('gv-hot', c >= 0);
      this.redraw();
      this.hideTip();
      if (c >= 0) this.tipTimer = window.setTimeout(() => this.showTip(c, r, p.x, p.y), TIP_DELAY);
    }
  };

  private onUp = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    if (this.pinch) {
      if (this.ptrs.size < 2) this.pinch = null;
      this.down = null;
      return;
    }
    const dn = this.down;
    this.down = null;
    this.host.classList.remove('gv-drag');
    if (!dn || dn.moved || e.type === 'pointercancel') return;
    const p = this.local(e);
    const [c, part] = this.pick(p.x, p.y);
    if (c < 0) return;
    if (part === -2) {
      this.choose(c, -1, 'pointer');
      this.toggle(c);
      return;
    }
    this.choose(c, part, 'pointer');
  };

  private onLeave = () => {
    if (this.hoverCard >= 0) {
      this.hoverCard = this.hoverRow = -1;
      this.redraw();
    }
    this.hideTip();
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    const [c, part] = this.pick(p.x, p.y);
    if (c < 0 || !this.m) return;
    if (part === -2) return;
    if (part < 0) this.toggle(c);
    else if (this.m.rowChild[part] < 0) this.ev.open(this.m.rowNode[part]);
    else {
      // A port row: go to its card.
      const k = this.m.rowChild[part];
      if (this.L?.shown[k]) this.choose(k, -1, 'key');
      else this.toggle(c, true);
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.L) return;
    e.preventDefault();
    this.hideTip();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
    const base = this.anim ? this.anim.to : this.cam;
    if (e.ctrlKey || e.metaKey) {
      const p = this.local(e);
      const f = Math.exp(-e.deltaY * unit * 0.0025);
      this.setCam(zoomAt(base, clamp(f, 0.5, 2), p.x, p.y, this.minZ(), ZOOM_MAX));
      return;
    }
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    this.setCam({ x: base.x + dx / base.s, y: base.y + dy / base.s, s: base.s });
  };

  // Minimap navigation.
  private onMiniDown = (e: PointerEvent) => {
    e.stopPropagation();
    this.miniDrag = true;
    this.mini.el.setPointerCapture(e.pointerId);
    this.miniGo(e);
  };
  private onMiniMove = (e: PointerEvent) => {
    if (this.miniDrag) this.miniGo(e);
  };
  private onMiniUp = () => {
    this.miniDrag = false;
  };
  private miniGo(e: PointerEvent) {
    const r = this.mini.el.getBoundingClientRect();
    const [wx, wy] = this.mini.toWorld(e.clientX - r.left, e.clientY - r.top);
    const s = this.cam.s;
    this.setCam({ x: wx - this.vw / 2 / s, y: wy - this.vh / 2 / s, s });
  }

  // ── Tooltip ────────────────────────────────────────────────────────────

  private showTip(c: number, r: number, sx: number, sy: number) {
    const m = this.m;
    if (!m || this.down) return;
    let text = '';
    if (r >= 0) {
      const n = m.rowNode[r];
      const lab = labelText(n);
      const val = valueText(n);
      const fullKey = n.key === undefined ? '' : String(n.key);
      const fullVal = n.t === STR ? JSON.stringify(n.v) : n.t >= ARR ? val : String(n.v ?? 'null');
      if (lab === fullKey && val === fullVal) return;
      text = (fullKey ? fullKey + ': ' : '') + (fullVal.length > 2000 ? fullVal.slice(0, 2000) + '…' : fullVal);
    } else {
      const n = m.node[c];
      if (typeof n.key !== 'string' || headText(n) === n.key) return;
      text = n.key;
    }
    this.tip.textContent = text;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    const x = Math.min(Math.max(8, sx + 12), this.vw - tw - 8);
    this.tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(sy + 18)}px)`;
  }

  private hideTip() {
    clearTimeout(this.tipTimer);
    if (!this.tip.hidden) this.tip.hidden = true;
  }

  // ── Keyboard ───────────────────────────────────────────────────────────

  private onKey = (e: KeyboardEvent) => {
    if (e.target !== this.host || e.altKey) return;
    const m = this.m;
    const L = this.L;
    if (!m || !L) {
      if (e.key === 'Escape') this.ev.escape();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const c = this.card;
    const r = this.row;
    const done = () => e.preventDefault();
    if (k === 'Escape') {
      done();
      this.ev.escape();
      return;
    }
    if (!mod && (k === '+' || k === '=')) return done(), this.zoomBy(1.25);
    if (!mod && (k === '-' || k === '_')) return done(), this.zoomBy(1 / 1.25);
    if (!mod && k === '0') return done(), this.fit();
    if (mod) return;
    if (c < 0 && /^Arrow|^Home$|^Enter$|^ $/.test(k)) {
      done();
      this.choose(0, -1, 'key');
      return;
    }
    const r0 = m.rowStart[c];
    const r1 = m.rowStart[c + 1];
    const sib = (dir: 1 | -1) => {
      const p = m.parent[c];
      if (p < 0) return -1;
      // Children are in card order: binary search (a bus can have a million of them).
      const list = childCards(m, p);
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] < c) lo = mid + 1;
        else hi = mid;
      }
      const i = lo + dir;
      return i >= 0 && i < list.length ? list[i] : -1;
    };
    switch (k) {
      case 'ArrowDown': {
        done();
        if (r < 0 && r1 > r0) return this.choose(c, r0, 'key');
        if (r >= 0 && r + 1 < r1) return this.choose(c, r + 1, 'key');
        const s = sib(1);
        if (s >= 0) this.choose(s, -1, 'key');
        return;
      }
      case 'ArrowUp': {
        done();
        if (r > r0) return this.choose(c, r - 1, 'key');
        if (r === r0) return this.choose(c, -1, 'key');
        const s = sib(-1);
        if (s >= 0) this.choose(s, m.rowStart[s + 1] > m.rowStart[s] ? m.rowStart[s + 1] - 1 : -1, 'key');
        return;
      }
      case 'ArrowRight': {
        done();
        const target = r >= 0 ? m.rowChild[r] : m.kids[c] ? m.kidList[m.kidStart[c]] : -1;
        if (target < 0) return;
        if (L.collapsed[c]) {
          L.collapsed[c] = 0;
          this.keepFor = null;
          this.card = target;
          this.row = -1;
          this.relayout(c, () => this.choose(target, -1, 'key'));
          return;
        }
        this.choose(target, -1, 'key');
        return;
      }
      case 'ArrowLeft': {
        done();
        if (r >= 0) return this.choose(c, -1, 'key');
        const p = m.parent[c];
        if (p < 0) return;
        this.choose(p, m.portRow[c], 'key');
        return;
      }
      case 'Home':
        done();
        this.choose(0, -1, 'key');
        return;
      case 'Enter': {
        done();
        const n = this.selNode();
        if (n) this.ev.open(n);
        return;
      }
      case ' ':
        done();
        this.toggle(c);
        return;
      case 'c':
      case 'C':
      case 'p':
      case 'P': {
        const n = this.selNode();
        if (!n) return;
        done();
        this.ev.copy(n, k.toLowerCase() === 'c' ? 'value' : 'path');
        return;
      }
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────

  async exportImage(kind: 'png' | 'svg'): Promise<Blob> {
    const L = this.L;
    if (!L) throw new Error('Nothing to export');
    let mod: typeof import('./export');
    try {
      mod = await import('./export');
    } catch {
      throw new Error('Export unavailable');
    }
    // The document as it is laid out (collapsed branches stay collapsed), without the selection.
    if (kind === 'svg') return new Blob([mod.toSVG(L, this.th)], { type: 'image/svg+xml' });
    return mod.toPNG(L, this.th);
  }

}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
