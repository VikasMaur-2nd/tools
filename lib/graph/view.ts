/*
 * The graph view: a canvas node-link diagram of the document (loaded on
 * demand the first time the Graph tab opens). This file owns the DOM, input
 * and state; painting is in ./render, camera math in ./camera.
 *
 * Builds are time-sliced (model, then layout, ~8 ms per task) and cancelled
 * by a newer document; so are searches (by a newer query too). The canvas
 * only redraws on rAF when something changed, and only what is in view.
 */
import { ARR, BOOL, JNode, NUL, NUM, STR, kids } from '../json/parser';
import { formatPath, parsePath, pathOf, resolve, type Seg } from '../json/path';
import { nodeAtIndex, tapeOfNode } from '../json/lazy';
import { KEY_NAME, W, nextOf, startOf, valueOf, type Tape } from '../json/tape';
import { idle, soon } from '../engine/idle';
import { rt } from '../i18n/ui';
import { PRIVATE } from '../analytics';
import { G, cardFinder, cardHeadText, cardKey, cardNode, cardOfRow, cardPath, cardSizeText, childCards, entryCount, fit, locate, locateIndex, modelBuilder, rowEntry, rowKey, rowKind, rowLabelText, rowValue, rowValueText, valueText, type GraphModel } from './model';
import { cardAt, layouter, type GraphLayout } from './layout';
import { charWidth, readTheme, type GraphTheme } from './theme';
import { MARGIN, ZOOM_MAX, bound, clamp, ease, fitCam, follow, initialCam, lerpCam, lodOf, minZoom, zoomAt, type Cam } from './camera';
import { grid, paint, partAt, releasePaint } from './render';
import { MINI_H, MINI_W, Minimap } from './minimap';
import type { ExportPreview, FindResult, GraphEvents, GraphExport, GraphViewApi } from './types';
import type { ExportArea } from './export';

const MAX_MATCHES = 100_000;
let valueHints: ((n: JNode) => { label: string }[]) | null = null;
let hintsLoading = false;
const SLICE = 8;
const NOTE_AFTER = 150;
const TIP_DELAY = 450;
const DRAG = 4;
/** How far past the graph's edges the view can be pushed, in views. */
const PAN_SLACK = 0.5;
/** Edits to a graph this big rebuild after a pause in typing this long. */
const EDIT_SETTLE_CARDS = 20_000;
const EDIT_SETTLE_MS = 250;

// Diagonal arrows (out / in), unlike Fit's corner brackets.
const FULL_ON = 'M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9';
const FULL_OFF = 'M13.5 6.5h-4v-4M9.5 6.5l4-4M2.5 9.5h4v4M6.5 9.5l-4 4';
const ICON = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * Find in keys and values, in document order, up to `max` hits: smart case (a
 * lowercase query matches any case), numbers by their text, true, false and
 * null by name. `step` runs until `deadline` and says whether it is done; `hits`
 * holds what it found so far. It keeps an index into each open container, so
 * a wide array's children are never copied, and looks at the clock every 1024
 * entries, deep or wide.
 */
export function textSearch(root: JNode, q: string, max: number): { hits: JNode[]; step: (deadline: number) => boolean } {
  const cs = q !== q.toLowerCase();
  const qn = cs ? q : q.toLowerCase();
  const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
  const yes = { t: has('true'), f: has('false'), n: has('null') };
  const hit = (n: JNode) => {
    if (typeof n.key === 'string' && has(n.key)) return true;
    if (n.t === STR || n.t === NUM) return has(n.v as string);
    return n.t === BOOL ? (n.v ? yes.t : yes.f) : n.t === NUL && yes.n;
  };
  const hits: JNode[] = hit(root) ? [root] : [];
  // The open containers, outermost first, and the index of the next child in each.
  const lists: JNode[][] = root.t >= ARR ? [kids(root)] : [];
  const next = [0];
  let depth = lists.length;
  const step = (deadline: number) => {
    let k = 0;
    while (depth && hits.length < max) {
      const d = depth - 1;
      const list = lists[d];
      let i = next[d];
      let late = false;
      while (i < list.length) {
        const n = list[i++];
        if (hit(n) && hits.push(n) >= max) break;
        const open = n.t >= ARR && kids(n).length > 0;
        if (open) {
          lists[depth] = kids(n);
          next[depth++] = 0;
        }
        if (!(++k & 1023) && performance.now() >= deadline) late = true;
        if (open || late) break;
      }
      next[d] = i;
      // (Done with this container, unless one of its children was just opened.)
      if (i === list.length && depth === d + 1) depth--;
      if (late) return false;
    }
    return true;
  };
  return { hits, step };
}

/**
 * `textSearch` on a tape (a document a worker parsed): the same hits, as tape indexes, under node
 * `from` (the root). The nodes are in document order on the tape, so it is one pass, and nothing is
 * made: values are read from the source, each property name is tested once.
 */
export function tapeTextSearch(t: Tape, src: string, from: number, q: string, max: number): { hits: number[]; step: (deadline: number) => boolean } {
  const cs = q !== q.toLowerCase();
  const qn = cs ? q : q.toLowerCase();
  const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
  const yes = { t: has('true'), f: has('false'), n: has('null') };
  // Per property name: 0 not tested yet, 1 a hit, 2 not.
  const keyHit = new Int8Array(t.keys.length);
  const a = t.nodes;
  const hits: number[] = [];
  const end = nextOf(t, from);
  let i = from;
  const step = (deadline: number) => {
    let k = 0;
    for (; i < end && hits.length < max; i++) {
      const meta = a[i * W];
      let hit = false;
      if (((meta >> 3) & 3) === KEY_NAME) {
        const key = a[i * W + 4];
        if (!keyHit[key]) keyHit[key] = has(t.keys[key]) ? 1 : 2;
        hit = keyHit[key] === 1;
      }
      if (!hit) {
        const kind = meta & 7;
        if (kind === STR || kind === NUM) hit = has(valueOf(t, i, src) as string);
        else if (kind === BOOL) hit = valueOf(t, i, src) ? yes.t : yes.f;
        else hit = kind === NUL && yes.n;
      }
      if (hit) hits.push(i);
      if (!(++k & 1023) && performance.now() >= deadline) {
        i++;
        return false;
      }
    }
    return true;
  };
  return { hits, step };
}

/** Keep live-region updates bounded for deep documents. Copy path still uses the full path. */
const ANNOUNCE_SEGMENTS = 4;
function announcePath(n: JNode) {
  const tail: Seg[] = [];
  for (let p: JNode | null = n; p?.u && tail.length < ANNOUNCE_SEGMENTS; p = p.u) tail.push(p.key as Seg);
  tail.reverse();
  const path = formatPath(tail);
  return n.d > tail.length ? '$…' + path.slice(1) : path;
}

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
  private full: HTMLButtonElement;
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
  /** The camera is still where the graph opened (or Fit put it): a resize places it again. */
  private fitted = false;
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
  /** Bumped by every search (and a new document): a search still running in steps stops. */
  private findSeq = 0;
  private matches: JNode[] = [];
  /** A text search's matches on a tape (see tapeTextSearch): indexes under `matchOn`, the root searched; `matches` is empty then. */
  private matchAt: number[] | null = null;
  private matchOn: JNode | null = null;
  private mi = -1;
  private hitRow: Uint8Array | null = null;
  private hitCard: Uint8Array | null = null;
  private hitFor: GraphModel | null = null;

  private ptrs = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; cam: Cam; moved: boolean; id: number } | null = null;
  private pinch: { d: number; cam: Cam; cx: number; cy: number } | null = null;
  /** Pointer offset from the view's top-left while dragging on the minimap (world px). */
  private miniGrab: { dx: number; dy: number } | null = null;
  private tipTimer = 0;
  private editTimer = 0;

  constructor(host: HTMLElement, ev: GraphEvents) {
    this.host = host;
    this.ev = ev;
    host.classList.add('gv');
    if (!host.hasAttribute('tabindex')) host.tabIndex = 0;
    host.setAttribute('aria-roledescription', rt('graph'));
    host.setAttribute('aria-label', rt('JSON graph. Arrow keys move, Enter opens, Space collapses, + and - zoom, F full screen.'));
    host.textContent = '';
    this.cv = el('canvas', 'gv-canvas ' + PRIVATE) as HTMLCanvasElement;
    this.cv.setAttribute('aria-hidden', 'true');
    this.ctx = this.cv.getContext('2d', { alpha: false });
    // ("Laying out 12,345 cards…")
    this.note = el('div', 'gv-note ' + PRIVATE);
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
    // Full screen (where the browser allows it on an element): the graph alone, Esc to leave.
    this.full = btn('gv-full', rt('Full screen'), ICON(FULL_ON), () => this.toggleFull());
    this.full.hidden = !document.fullscreenEnabled;
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
    mc.addEventListener('pointercancel', this.onMiniUp);
    mc.addEventListener('lostpointercapture', this.onMiniUp);
    mc.addEventListener('wheel', this.onMiniWheel, { passive: false });
    host.addEventListener('keydown', this.onKey);
    document.addEventListener('fullscreenchange', this.onFull);
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(host);
  }

  destroy() {
    this.token++;
    this.findSeq++;
    this.active = false;
    clearTimeout(this.editTimer);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.tipTimer);
    this.ro.disconnect();
    this.host.removeEventListener('keydown', this.onKey);
    document.removeEventListener('fullscreenchange', this.onFull);
    if (document.fullscreenElement === this.host) void document.exitFullscreen().catch(() => {});
    this.host.textContent = '';
    this.mini.release();
    releasePaint();
    this.m = this.L = this.keepFor = null;
    this.root = null;
    this.matches = [];
    this.matchAt = this.matchOn = null;
    this.keep = [];
    this.pending = null;
  }

  // ── Document and build ─────────────────────────────────────────────────

  setRoot(root: JNode | null, reset: boolean, nodes: number, active: boolean) {
    if (!reset && this.L && this.keepFor !== this.L) {
      // Remember collapsed cards by path, to restore them in the edited document
      // (once per layout: edits arrive per keystroke, even while the view is hidden).
      const { m, collapsed } = this.L;
      this.keep = [];
      this.keepFor = this.L;
      // Hidden descendants carry the same flag as their collapsed ancestor.
      // Save only the effective roots, so Show levels on a 100k chain keeps one
      // path instead of copying every suffix.
      for (let c = 0; c < m.n; c++) {
        if (collapsed[c] && (m.parent[c] < 0 || !collapsed[m.parent[c]])) this.keep.push(cardPath(m, c));
      }
    } else if (reset) {
      this.keep = [];
      this.keepFor = null;
    }
    if (reset && this.L) {
      // A different document: don't show the old one's graph while the new one builds.
      this.m = this.L = null;
      this.card = this.row = -1;
      this.mini.release();
      releasePaint();
      this.redraw();
    }
    this.reset = this.reset || reset;
    this.root = root;
    this.nodes = nodes;
    this.dirty = true;
    this.token++;
    this.findSeq++;
    this.building = false;
    this.matches = [];
    this.matchAt = this.matchOn = null;
    this.hitFor = null;
    clearTimeout(this.editTimer);
    if (!active) return;
    // Typing in a big document: rebuild once the edits pause, not on every key.
    if (!reset && this.L && this.L.m.n > EDIT_SETTLE_CARDS) this.editTimer = window.setTimeout(() => this.active && this.activate(), EDIT_SETTLE_MS);
    else this.activate();
  }

  activate() {
    this.active = true;
    // Value hints (dates, epoch times) label tooltips; they load once the page is idle.
    if (!valueHints && !hintsLoading) {
      hintsLoading = true;
      idle(() => void import('../json/smart').then((mod) => (valueHints = mod.valueHints), () => (hintsLoading = false)));
    }
    this.measure();
    if (this.dirty) this.build();
    else this.redraw();
  }

  deactivate() {
    this.active = false;
    clearTimeout(this.editTimer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.anim = null;
    this.mini.release();
    releasePaint();
    this.hideTip();
  }

  private build() {
    this.dirty = false;
    const token = ++this.token;
    const root = this.root;
    if (!root) {
      this.m = this.L = this.keepFor = null;
      this.keep = [];
      releasePaint();
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
      const find = cardFinder(m, this.root);
      for (const segs of this.keep) {
        const c = find(segs);
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
    // The collapsed cards it restored are in it now: the next edit reads them from it (and nothing keeps the old layout).
    this.keep = [];
    this.keepFor = null;
    this.card = this.row = -1;
    if (prevSel && !this.pending) this.pending = { n: prevSel, scroll: false, center: false };
    if (first) {
      this.cam = initialCam(L.width, L.height, this.vw, this.vh, this.minZ());
      this.camSet = this.vw > 0;
      this.fitted = true;
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
    // Hidden (another view is open): keep the last size, so showing it again changes nothing.
    if (!r.width || !r.height) return;
    if (r.width === this.vw && r.height === this.vh && dpr === this.dpr) return;
    const [ow, oh] = [this.vw, this.vh];
    this.vw = r.width;
    this.vh = r.height;
    this.dpr = dpr;
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.cv.style.width = r.width + 'px';
    this.cv.style.height = r.height + 'px';
    this.mini.release();
    if (this.L && this.vw > 0 && (!this.camSet || this.fitted)) {
      this.anim = null;
      this.cam = initialCam(this.L.width, this.L.height, this.vw, this.vh, this.minZ());
      this.camSet = true;
    } else if (this.camSet && ow > 0 && oh > 0) {
      // Keep what was in the middle of the view in the middle (full screen, a moved splitter, a rotated phone).
      this.cam = this.bounded({ x: this.cam.x + (ow - this.vw) / 2 / this.cam.s, y: this.cam.y + (oh - this.vh) / 2 / this.cam.s, s: this.cam.s });
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
      grid(ctx, this.th, this.cam, this.vw, this.vh, this.dpr);
      this.ctl.hidden = true;
      (this.mini.el as HTMLElement).hidden = true;
      return;
    }
    this.ctl.hidden = false;
    this.ensureHits();
    const at = this.m && this.mi >= 0 && this.mi < this.matchCount() ? this.locateMatch(this.m, this.mi) : null;
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

  /** Keeps a camera in reach of the graph (see bound). */
  private bounded(c: Cam, slack = PAN_SLACK): Cam {
    const L = this.L;
    return L && this.vw > 0 ? bound(c, L.width, L.height, this.vw, this.vh, slack) : c;
  }

  private moveTo(to: Cam, animate = true) {
    this.fitted = false;
    to = this.bounded(to);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce || !this.active) {
      this.anim = null;
      this.cam = to;
    } else {
      this.anim = { from: { ...this.cam }, to, t0: performance.now(), ms: 240 };
    }
    this.redraw();
  }

  private setCam(c: Cam, slack = PAN_SLACK) {
    this.fitted = false;
    this.anim = null;
    this.cam = this.bounded(c, slack);
    this.hideTip();
    this.redraw();
  }

  fit() {
    const L = this.L;
    if (!L) return;
    this.moveTo(fitCam(L.width, L.height, this.vw, this.vh, this.minZ()));
    this.fitted = true;
  }

  /** Selects and shows the root ('start') or the lowest card of the graph ('end'). */
  jump(to: 'start' | 'end') {
    const L = this.L;
    if (!L) return;
    let c = 0;
    if (to === 'end') {
      // The lowest card: the last of some column.
      let bottom = -Infinity;
      for (let d = 0; d < L.levels.length; d++) {
        const level = L.levels.at(d);
        const k = level[level.length - 1];
        if (k !== undefined && L.y[k] + L.m.h[k] > bottom) {
          bottom = L.y[k] + L.m.h[k];
          c = k;
        }
      }
    }
    this.choose(c, -1, 'key');
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

  private toggleFull() {
    if (document.fullscreenElement === this.host) void document.exitFullscreen().catch(() => {});
    else void this.host.requestFullscreen().then(() => this.focus(), () => {});
  }

  /** Full screen started or ended (also by Esc): update the button. */
  private onFull = () => {
    const on = document.fullscreenElement === this.host;
    const label = rt(on ? 'Exit full screen' : 'Full screen');
    this.full.setAttribute('aria-label', label);
    this.full.dataset.tip = label;
    this.full.innerHTML = ICON(on ? FULL_OFF : FULL_ON);
  };

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
    return this.row >= 0 ? rowEntry(m, this.row) : cardNode(m, this.card);
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
    let at = locate(m, n);
    // Selection objects from the previous parse are stale after an edit. Their
    // path is resolved once against the new root, then direct model IDs handle
    // all subsequent lookups.
    if (at.card < 0 && at.row < 0 && this.root) {
      const current = resolve(this.root, pathOf(n));
      if (current) {
        at = locate(m, current);
      }
    }
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

  pickAt(clientX: number, clientY: number): JNode | null {
    const m = this.m;
    if (!m) return null;
    const p = this.local({ clientX, clientY });
    const [c, part] = this.pick(p.x, p.y);
    if (c < 0) return null;
    // (The chevron and the header pick the card.)
    const r = part >= 0 ? part : -1;
    this.focus();
    this.choose(c, r, 'pointer');
    return r >= 0 ? rowEntry(m, r) : cardNode(m, c);
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
    this.ev.select(r >= 0 ? rowEntry(m, r) : cardNode(m, c), how);
  }

  private announce() {
    const n = this.selNode();
    if (!n) return;
    const type = n.t === STR ? rt('string') : n.t === NUM ? rt('number') : n.t === BOOL ? rt('boolean') : n.t === NUL ? 'null' : n.t === ARR ? rt('array') : rt('object');
    const key = n.key === undefined ? rt('root') : typeof n.key === 'number' ? `[${n.key}]` : fit(n.key, 60, false);
    // (Counted off the model: kids() would make all of a big container's children.)
    const val = n.t >= ARR ? rt.n(entryCount(this.m!, this.card, this.row), '{n} item', '{n} items') : valueText(n);
    this.live.textContent = `${key}, ${type}, ${val}, ${announcePath(n)}`;
  }

  // ── Collapse ───────────────────────────────────────────────────────────

  private toggle(c: number, open?: boolean) {
    const L = this.L;
    if (!L || !L.m.kids[c]) return;
    const next = open === undefined ? !L.collapsed[c] : !open;
    if (!!L.collapsed[c] === next) return;
    L.collapsed[c] = next ? 1 : 0;
    this.keepFor = null;
    this.fitted = false;
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

  /**
   * Find: a path jumps to its node; text is searched in steps of SLICE ms, so a big
   * document never holds up typing in the find bar. One that takes more than a
   * step answers with what it found so far (no current match yet), then tells
   * the engine the result (`found`); an engine that doesn't listen gets it at once.
   */
  search(q: string, jump: boolean): FindResult {
    this.q = q;
    this.matches = [];
    this.matchAt = this.matchOn = null;
    this.mi = -1;
    this.hitFor = null;
    const seq = ++this.findSeq;
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
        // A document a worker parsed is searched on its tape: no node is made for what doesn't match.
        const z = tapeOfNode(root);
        const find = z ? tapeTextSearch(z.tape, z.src, z.i, q, MAX_MATCHES) : textSearch(root, q, MAX_MATCHES);
        const later = this.ev.found;
        if (z) {
          this.matchAt = find.hits as number[];
          this.matchOn = root;
        } else this.matches = find.hits as JNode[];
        if (!find.step(later ? performance.now() + SLICE : Infinity)) {
          const run = () => {
            if (seq !== this.findSeq) return;
            if (!find.step(performance.now() + SLICE)) return void soon(run);
            later!(this.settle(jump, note));
          };
          soon(run);
          // (The engine shows this count meanwhile, as for a long search in the code views.)
          return { total: find.hits.length, index: -1 };
        }
      }
    }
    return this.settle(jump, note);
  }

  private matchCount() {
    return this.matchAt ? this.matchAt.length : this.matches.length;
  }

  /** Match k's node (one found on a tape is made now). */
  private matchNode(k: number): JNode | null {
    const at = this.matchAt;
    if (!at) return this.matches[k] ?? null;
    return k < at.length && this.matchOn ? nodeAtIndex(this.matchOn, at[k]) : null;
  }

  /** Where match k is drawn in model `m` (-1s: not in it, such as a match in a newer document). */
  private locateMatch(m: GraphModel, k: number): { card: number; row: number } {
    const at = this.matchAt;
    if (!at) return locate(m, this.matches[k]);
    return m.tape && m.tape.root === this.matchOn ? locateIndex(m, at[k]) : { card: -1, row: -1 };
  }

  /** The search is done: the current match is the first at or after the selection. */
  private settle(jump: boolean, note?: string): FindResult {
    this.hitFor = null;
    const total = this.matchCount();
    if (total) {
      const sel = this.selNode();
      const from = sel ? sel.s : 0;
      const at = this.matchAt;
      let idx = -1;
      if (at) {
        const t = tapeOfNode(this.matchOn!)!.tape;
        idx = at.findIndex((i) => startOf(t, i) >= from);
      } else idx = this.matches.findIndex((x) => x.s >= from);
      if (idx < 0) idx = 0;
      this.mi = idx;
      if (jump) this.gotoMatch();
    }
    this.redraw();
    return { total, index: this.mi, note: total ? undefined : note };
  }

  step(dir: 1 | -1): FindResult {
    const n = this.matchCount();
    if (!n) return { total: 0, index: -1 };
    this.mi = (this.mi + dir + n) % n;
    this.gotoMatch();
    return { total: n, index: this.mi };
  }

  private gotoMatch() {
    const hit = this.matchNode(this.mi);
    if (!hit) return;
    this.select(hit, { center: true });
    this.ev.select(hit, 'search');
  }

  /** Per-row / per-card hit flags for the current model. */
  private ensureHits() {
    const m = this.m;
    if (!m || this.hitFor === m) return;
    this.hitFor = m;
    const count = this.matchCount();
    if (!count) {
      this.hitRow = this.hitCard = null;
      return;
    }
    const hr = new Uint8Array(m.rows);
    const hc = new Uint8Array(m.n);
    for (let k = 0; k < count; k++) {
      const { card, row } = this.locateMatch(m, k);
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
    else if (this.m.rowChild[part] < 0) this.ev.open(rowEntry(this.m, part));
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

  // Minimap navigation: press on the view's rectangle and drag it, or press
  // elsewhere to move the view there (then keep dragging). It stops exactly at
  // the graph's edges, so the top and the end are one click away.
  private onMiniDown = (e: PointerEvent) => {
    if (e.button > 0 || !this.L) return;
    e.preventDefault();
    e.stopPropagation();
    this.focus();
    this.hideTip();
    const [wx, wy] = this.miniPoint(e);
    const c = this.anim ? this.anim.to : this.cam;
    const vw = this.vw / c.s;
    const vh = this.vh / c.s;
    if (this.onMiniRect(e)) this.miniGrab = { dx: wx - c.x, dy: wy - c.y };
    else {
      this.miniGrab = { dx: vw / 2, dy: vh / 2 };
      this.setCam({ x: wx - vw / 2, y: wy - vh / 2, s: c.s }, 0);
    }
    this.mini.el.setPointerCapture(e.pointerId);
    this.mini.el.classList.add('gv-mini-drag');
  };

  private onMiniMove = (e: PointerEvent) => {
    const g = this.miniGrab;
    if (!g) {
      this.mini.el.classList.toggle('gv-mini-on', this.onMiniRect(e));
      return;
    }
    const [wx, wy] = this.miniPoint(e);
    this.setCam({ x: wx - g.dx, y: wy - g.dy, s: this.cam.s }, 0);
  };

  private onMiniUp = () => {
    this.miniGrab = null;
    this.mini.el.classList.remove('gv-mini-drag');
  };

  /** Wheel over the minimap acts on the view (it would scroll the page otherwise). */
  private onMiniWheel = (e: WheelEvent) => {
    if (!this.L) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
    if (e.ctrlKey || e.metaKey) this.zoomBy(clamp(Math.exp(-e.deltaY * unit * 0.0025), 0.5, 2));
    else this.setCam({ x: this.cam.x + (e.deltaX * unit) / this.cam.s, y: this.cam.y + (e.deltaY * unit) / this.cam.s, s: this.cam.s });
  };

  /** World point under the pointer on the minimap. */
  private miniPoint(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.mini.el.getBoundingClientRect();
    return this.mini.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  /** Whether the pointer is on the view's rectangle (with a few pixels to spare, it can be thin). */
  private onMiniRect(e: { clientX: number; clientY: number }) {
    const r = this.mini.el.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const c = this.cam;
    const m = this.mini;
    const x0 = m.ox + c.x * m.sx;
    const y0 = m.oy + c.y * m.sy;
    const x1 = x0 + Math.max(3, (this.vw / c.s) * m.sx);
    const y1 = y0 + Math.max(3, (this.vh / c.s) * m.sy);
    return mx >= x0 - 3 && mx <= x1 + 3 && my >= y0 - 3 && my <= y1 + 3;
  }

  // ── Tooltip ────────────────────────────────────────────────────────────

  private showTip(c: number, r: number, sx: number, sy: number) {
    const m = this.m;
    if (!m || this.down) return;
    let text = '';
    // (Read off the model: a tape model's tooltip makes no node.)
    if (r >= 0) {
      const t = rowKind(m, r);
      const key = rowKey(m, r);
      const v = rowValue(m, r);
      const lab = rowLabelText(m, r);
      const val = rowValueText(m, r);
      const fullKey = key === undefined ? '' : String(key);
      const fullVal = t === STR ? JSON.stringify(v) : t >= ARR ? val : String(v ?? 'null');
      // What a value means (a date, an epoch time…), like the tree's tooltips.
      const hint = (t === STR || t === NUM) && valueHints ? (valueHints(m.tape ? new JNode(t, v, 0, 0, null, key) : m.rowNode[r])[0]?.label ?? '') : '';
      // Zoomed out too far for text: the tooltip is the only way to read a row.
      const cut = lab !== fullKey || val !== fullVal || lodOf(this.cam.s) > 0;
      if (!cut && !hint) return;
      if (cut) text = (fullKey ? fullKey + ': ' : '') + (fullVal.length > 2000 ? fullVal.slice(0, 2000) + '…' : fullVal);
      if (hint) text = hint + (text ? '\n' + text : '');
    } else {
      const key = cardKey(m, c);
      const head = cardHeadText(m, c);
      const size = cardSizeText(m, c);
      if (lodOf(this.cam.s) > 0) text = (typeof key === 'string' ? key : head) + (size !== null ? ' ' + size : '');
      else if (typeof key !== 'string' || head === key) return;
      else text = key;
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
    if (!mod && (k === 'f' || k === 'F') && document.fullscreenEnabled) return done(), this.toggleFull();
    if (mod) return;
    if (c < 0 && /^Arrow|^Enter$|^ $/.test(k)) {
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
        this.jump('start');
        return;
      case 'End':
        done();
        this.jump('end');
        return;
      case 'PageDown':
      case 'PageUp': {
        done();
        const base = this.anim ? this.anim.to : this.cam;
        const dy = (this.vh / base.s) * 0.85 * (k === 'PageDown' ? 1 : -1);
        this.moveTo({ x: base.x, y: base.y + dy, s: base.s });
        return;
      }
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

  /** The card a branch export starts from: the selected card, or a port row's card. */
  private branchCard() {
    const m = this.m;
    if (!m || this.card < 0) return -1;
    return this.row >= 0 && m.rowChild[this.row] >= 0 ? m.rowChild[this.row] : this.card;
  }

  private exportArea(opts: GraphExport): ExportArea {
    if (opts.area === 'view') return { kind: 'rect', x: this.cam.x, y: this.cam.y, w: this.vw / this.cam.s, h: this.vh / this.cam.s };
    if (opts.area === 'branch' && this.branchCard() >= 0) return { kind: 'branch', card: this.branchCard() };
    return { kind: 'all' };
  }

  /** Image px per world px: the visible area keeps its on-screen size (1× = what you see). */
  private exportScale(opts: GraphExport) {
    return opts.area === 'view' ? opts.scale * this.cam.s : opts.scale;
  }

  private background(opts: GraphExport) {
    return opts.background === 'theme' ? this.th.bg : opts.background === 'transparent' ? null : opts.background;
  }

  private async exporter() {
    try {
      return await import('./export');
    } catch {
      throw new Error('Export unavailable');
    }
  }

  async exportImage(opts: GraphExport, onReduced?: (width: number, height: number) => void): Promise<Blob> {
    const L = this.L;
    if (!L) throw new Error('Nothing to export');
    const mod = await this.exporter();
    const area = this.exportArea(opts);
    const background = this.background(opts);
    // The document as it is laid out (collapsed branches stay collapsed), without the selection.
    if (opts.format === 'svg') return new Blob([mod.toSVG(L, this.th, { area, background })], { type: 'image/svg+xml' });
    return mod.toPNG(L, this.th, { area, background, scale: this.exportScale(opts), type: opts.format === 'jpeg' ? 'image/jpeg' : 'image/png', onReduced });
  }

  async exportPreview(opts: GraphExport): Promise<ExportPreview | null> {
    const L = this.L;
    if (!L) return null;
    const mod = await this.exporter();
    const branch = this.branchCard() >= 0;
    const size = mod.exportSize(L, this.exportArea(opts));
    const preview: ExportPreview = { width: Math.ceil(size.width), height: Math.ceil(size.height), cards: size.cards, reduced: false, branch, scale: 1 };
    if (opts.format === 'svg') {
      if (size.cards > mod.EXPORT_LIMITS.svgCards || size.rows > mod.EXPORT_LIMITS.svgRows) {
        preview.error = 'The graph is too large for SVG. Collapse some branches or export PNG.';
        // (Too many rows, in long arrays: the sentence says it all.)
        if (size.cards > mod.EXPORT_LIMITS.svgCards) {
          preview.limit = 'cards';
          preview.maxCards = mod.EXPORT_LIMITS.svgCards;
        }
      }
      return preview;
    }
    try {
      const want = this.exportScale(opts);
      const scale = mod.pngScale(size.width, size.height, want);
      preview.width = Math.ceil(size.width * scale);
      preview.height = Math.ceil(size.height * scale);
      preview.reduced = scale < want - 1e-9;
      preview.scale = scale;
    } catch (e) {
      preview.error = e instanceof Error ? e.message : 'Graph export failed';
      if (Number.isFinite(size.width) && Number.isFinite(size.height)) preview.limit = 'size';
    }
    return preview;
  }


}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
