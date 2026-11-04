/*
 * A huge file, open: what huge mode's views get. The session owns the source (the core's index, or
 * SmallSource), the views the UI mounts (tree, lines, table), the selection, Find, "Go to", copying and
 * saving values, and the index's progress. The engine only routes a big file here (Engine.loadFile) and
 * hands over the keys and the view switch while it is open (HugeHook); opening any other document closes it.
 */
import { ARR, STR, parse } from '../json/parser';
import { stringify } from '../json/format';
import { formatPath, parsePath } from '../json/path';
import { rt } from '../i18n/ui';
import { reportError, track } from '../analytics';
import { store } from '../engine/store';
import type { ReactNode } from 'react';
import type { Portal } from './kit';
import { fileKind, type Events, type InputSource } from '../analytics/events';
import { StreamFind } from './find';
import { HugeLinesView } from './lines-view';
import { HugeStore, type Ask, type HugeUI, type HugeView } from './state';
import { HugeTableView } from './table-view';
import { HugeTreeView } from './tree-view';
import type { Open } from './tree-model';
import type { HugeNode, HugeSource, IndexState, LineMode, Seg } from './source';

/** Bytes a value may have to be copied (bigger: save it as a file). */
export const COPY_MAX = 16 * 1024 * 1024;
/** How often the views re-read counts that grow while indexing (ms). */
const GROW_EVERY = 1000;

/** What the session needs of the engine (the Engine itself). */
export interface HugeHost {
  toast(msg: string, kind?: 'ok' | 'err' | 'info', action?: { label: string; run: () => void }, ms?: number): void;
  readonly indent: string;
  openFile(): void;
  saveBlob(blob: Blob, name: string): void;
  /** Back to the editor (huge mode closed by the user). */
  focusEditor(): void;
  /** Opens a file (again: as text, whatever it looks like). */
  loadFile(f: File, source: InputSource, asText: boolean): Promise<void>;
}

/** What the engine asks of huge mode while it is open (once closed, it takes nothing: every answer is false). */
export interface HugeHook {
  /** A key the tool's shortcuts would take: true if huge mode took it (and stopped it). */
  key(e: KeyboardEvent): boolean;
  /** A view switch (tabs, Alt+digit, the palette): true if huge mode took it. */
  view(v: HugeView): boolean;
  /** Find (Ctrl+F, /): true if huge mode took it. */
  find(): boolean;
  /** Another document replaces the huge one. */
  close(): void;
}

export interface HugeOpen {
  name: string;
  source: InputSource;
  /** Opened in huge mode by the debug override (localStorage['tk:hugeMin']). */
  forced: boolean;
}

let seq = 0;
/** The open session (components/huge/HugeTool.tsx reads it). */
export let current: HugeSession | null = null;
const setCurrent = (s: HugeSession | null) => {
  current = s;
};

type HugeSize = Events['huge_opened']['size'];
const SIZES: [number, HugeSize][] = [
  [300 * 1024 ** 2, '0-300MB'],
  [1024 ** 3, '300MB-1GB'],
  [10 * 1024 ** 3, '1-10GB'],
  [100 * 1024 ** 3, '10-100GB'],
];
export const hugeSize = (bytes: number): HugeSize => SIZES.find(([edge]) => bytes < edge)?.[1] ?? '100GB+';

export class HugeSession {
  readonly id = ++seq;
  readonly ui: HugeStore;
  private tree: HugeTreeView | null = null;
  private lines: HugeLinesView | null = null;
  private table: HugeTableView | null = null;
  private root: HugeNode | null = null;
  /** The selected value and its path. */
  private sel: { node: HugeNode; path: Seg[] } | null = null;
  /** The table's container and its path. */
  private tableAt: { node: HugeNode | null; path: Seg[] } = { node: null, path: [] };
  private find: StreamFind;
  /** The Format view's mode was chosen (by the user, or once from the file's shape). */
  private modeSet = false;
  private stopState: () => void;
  private began = performance.now();
  private samples: [number, number][] = [];
  private grewAt = 0;
  private growTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private reported = false;
  private dead = false;
  /** The container a "Go to index" bar is for. */
  private askOpen: Open | null = null;
  private rootBusy = false;
  /** The file has several top-level values (as last seen). */
  private multi = false;

  /**
   * `viewer`: its UI (components/huge/HugeTool.tsx) as JsonTool renders it (the store holds it while the
   * session is open).
   */
  constructor(
    private readonly host: HugeHost,
    readonly src: HugeSource,
    readonly meta: HugeOpen,
    private readonly viewer: (portal: Portal) => ReactNode,
  ) {
    const index = src.state();
    // (Starts in the view the tool shows, when huge mode has it.)
    const shown = store.get().settings.view;
    const view = shown === 'format' || shown === 'tree' || shown === 'table' ? shown : 'tree';
    this.ui = new HugeStore({
      name: meta.name,
      size: src.size,
      view,
      mode: 'raw',
      index,
      rate: 0,
      eta: null,
      took: null,
      sel: null,
      find: { q: '', total: 0, index: -1, read: 0, done: true, more: false, waiting: false, open: false, seq: 0 },
      ask: null,
      table: { path: '$', rows: 0, cols: 0, ok: false },
      lines: 0,
      noRoot: false,
    });
    this.find = new StreamFind(src, (at) => void this.jumpTo(at), () => this.ui.set({ find: { ...this.ui.get().find, ...this.find.view() } }), (e) => this.failed(e));
    this.stopState = src.onState(this.onState);
  }

  /** Shows the file: huge mode takes the viewer and the keys. */
  async start() {
    if (current && current !== this) current.close();
    setCurrent(this);
    store.set({ huge: this.viewer });
    this.onState(this.src.state());
    await this.readRoot();
  }

  /** Reads the root (again as indexing goes on, until the first value is there). */
  private async readRoot() {
    if (this.dead || this.root || this.rootBusy) return;
    this.rootBusy = true;
    try {
      const root = await this.src.root();
      if (this.dead) return;
      if (!this.root && !performance.getEntriesByName('tk:huge:root').length) performance.mark('tk:huge:root');
      this.root = root;
      this.ui.set({ noRoot: false });
      this.tableAt = { node: root, path: [] };
      this.tree?.setRoot(root);
      this.table?.setNode(root);
      this.ui.set({ table: { path: '$', rows: root.count, cols: 0, ok: root.t >= ARR } });
    } catch (e) {
      if (this.dead) return;
      // Not even a first value yet: tried again as indexing goes on; at its end, the error says why.
      const st = this.src.state();
      if (st.done) {
        this.ui.set({ noRoot: true });
        if (!st.error) this.failed(e);
      }
    } finally {
      this.rootBusy = false;
    }
  }

  readonly hook: HugeHook = {
    key: (e) => {
      if (this.dead || !this.key(e)) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    },
    view: (v) => !this.dead && (this.setView(v), true),
    find: () => !this.dead && (this.openFind(), true),
    close: () => this.close(),
  };

  /** Leaves huge mode (`back`: the user closed it, back to the editor). */
  close(back = false) {
    if (this.dead) return;
    this.report(this.src.state().done ? 'done' : 'replaced');
    this.dead = true;
    this.find.stop();
    this.stopState();
    clearTimeout(this.growTimer);
    this.src.destroy();
    this.tree?.destroy();
    this.lines?.destroy();
    this.table?.destroy();
    this.tree = this.lines = null;
    this.table = null;
    if (current === this) setCurrent(null);
    if (store.get().huge === this.viewer) store.set({ huge: null });
    if (back) this.host.focusEditor();
  }

  get closed() {
    return this.dead;
  }

  private failed(e: unknown) {
    if (this.dead) return;
    reportError(e, 'huge');
    this.host.toast(`Couldn't read ${this.meta.name}`, 'err');
  }

  // ── Index progress ─────────────────────────────────────────────────────

  private onState = (st: IndexState) => {
    if (this.dead) return;
    const now = performance.now();
    this.samples.push([now, st.bytes]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 3000) this.samples.shift();
    const [t0, b0] = this.samples[0];
    const rate = now > t0 + 200 ? ((st.bytes - b0) / (now - t0)) * 1000 : 0;
    const ended = st.done || st.cancelled;
    const eta = !ended && rate > 0 && now - this.began > 400 ? (this.src.size - st.bytes) / rate : null;
    this.ui.set({ index: st, rate, eta, took: ended ? (this.ui.get().took ?? now - this.began) : null });
    // A second top-level value appeared: the root is the list of them now, and pretty lines shifted by its "[".
    if (st.multi !== this.multi) {
      this.multi = st.multi;
      if (this.root && this.root.at >= 0) {
        this.root = null;
        this.lines?.reload();
      }
    }
    if (!this.root) void this.readRoot();
    if (ended) {
      this.report(st.error ? 'error' : st.cancelled ? 'cancelled' : 'done');
      if (st.error && st.bytes < 1) this.host.toast(`${this.meta.name} isn't valid JSON`, 'err');
    }
    // The views take the counts that grew, at most once a second (and at once when it ends, or when the
    // Format view's first lines are there to read).
    if (ended) this.grow(true);
    else if (this.lines && !this.lines.count && this.src.lineCount(this.lines.mode) > 0) this.grow(false);
    // (Four times as often in the first seconds: the first rows and counts show at once.)
    else if (!this.growTimer) this.growTimer = setTimeout(() => this.grow(false), Math.max(0, (now - this.began < 3000 ? GROW_EVERY / 4 : GROW_EVERY) - (now - this.grewAt)));
  };

  private grow(all: boolean) {
    clearTimeout(this.growTimer);
    this.growTimer = 0;
    if (this.dead) return;
    this.grewAt = performance.now();
    if (!this.modeSet) this.pickMode();
    this.lines?.grow();
    this.ui.set({ lines: this.lines?.count ?? this.src.lineCount(this.ui.get().mode) });
    void this.tree?.refreshCounts(all);
    if (this.root?.partial || all) {
      void this.src.root().then((r) => {
        if (this.dead) return;
        this.root = r;
        // (A tree shown meanwhile has the root as it was: it takes this one.)
        this.tree?.updateRoot(r);
        const t = this.tableAt.node;
        if (t && t.at === r.at && t.depth === r.depth) {
          this.tableAt.node = r;
          this.table?.grow(r);
        }
      }, () => undefined);
    }
  }

  /** A file of one long line (minified) reads Pretty; one with lines, as written. */
  private pickMode() {
    const st = this.src.state();
    if (st.bytes < Math.min(this.src.size, 64 * 1024) && !st.done && !st.cancelled) return;
    this.modeSet = true;
    const mode: LineMode = st.lines <= 1 || st.bytes / Math.max(1, st.lines) > 2000 ? 'pretty' : 'raw';
    if (mode !== this.ui.get().mode) this.ui.set({ mode, lines: this.src.lineCount(mode) });
  }

  /** The huge_opened event, once: when indexing ends, or when the file is closed first. */
  private report(outcome: 'done' | 'error' | 'cancelled' | 'replaced') {
    if (this.reported) return;
    this.reported = true;
    const st = this.src.state();
    track('huge_opened', {
      source: this.meta.source,
      file_kind: fileKind(this.meta.name),
      size: hugeSize(this.src.size),
      outcome,
      jsonl: st.jsonl,
      index_ms: Math.round(performance.now() - this.began),
      forced: this.meta.forced,
    });
  }

  /** Can indexing stop while the file stays open? (Else Cancel closes the file.) */
  get canStop() {
    return !!this.src.cancel;
  }

  /** Cancel: stops indexing (browsing what was read goes on), or closes the file if its source can't stop. */
  cancel() {
    if (this.src.cancel) this.src.cancel();
    else this.close(true);
  }

  // ── Views ──────────────────────────────────────────────────────────────

  mountTree(el: HTMLElement) {
    this.tree?.destroy();
    const tree = (this.tree = new HugeTreeView(el, this.src, {
      select: (node, path) => this.select(node, path, 'tree'),
      copy: (node, path, what) => (what === 'path' ? this.copyPath(path) : void this.copyValue(node, path)),
      gotoIndex: (o) => this.askIndex(o),
      escape: () => undefined,
      failed: (e) => this.failed(e),
    }));
    if (this.root) tree.setRoot(this.root);
    // (Back in the tree: the selection made elsewhere shows there.)
    if (this.sel) void this.src.locate(this.sel.node.at).then((chain) => !this.dead && this.tree === tree && tree.reveal(chain, null));
    return () => {
      if (this.tree === tree) this.tree = null;
      tree.destroy();
    };
  }

  mountLines(el: HTMLElement) {
    this.lines?.destroy();
    if (!this.modeSet) this.pickMode();
    const mode = this.ui.get().mode;
    const lines = (this.lines = new HugeLinesView(el, this.src, mode, this.host.indent, {
      pick: (at) => void this.pickAt(at),
      failed: (e) => this.failed(e),
    }));
    this.ui.set({ lines: lines.count });
    if (this.sel) void this.showLine(this.sel.node.at, false);
    else lines.render(true);
    return () => {
      if (this.lines === lines) this.lines = null;
      lines.destroy();
    };
  }

  mountTable(el: HTMLElement) {
    this.table?.destroy();
    const table = (this.table = new HugeTableView(el, this.src, {
      select: (node, rel) => this.select(node, [...this.tableAt.path, ...rel], 'table'),
      drill: (node, rel) => this.showTable(node, [...this.tableAt.path, ...rel]),
      shape: (rows, cols) => this.ui.set({ table: { ...this.ui.get().table, rows, cols, ok: true } }),
      failed: (e) => this.failed(e),
    }));
    if (this.tableAt.node) table.setNode(this.tableAt.node);
    return () => {
      if (this.table === table) this.table = null;
      table.destroy();
    };
  }

  setView(view: HugeView) {
    const was = this.ui.get().view;
    if (view === was) return;
    // The table shows the selected container (or the one holding the selected value).
    if (view === 'table' && this.sel) void this.tableForSel();
    this.ui.set({ view, ask: null });
    track('view_opened', { view, via: 'other' });
    // Find follows the view: the same query, from where that view is.
    const q = this.ui.get().find.q;
    if (q) requestAnimationFrame(() => !this.dead && this.runFind(q));
  }

  setMode(mode: LineMode) {
    this.modeSet = true;
    if (mode === this.ui.get().mode) return;
    this.ui.set({ mode, lines: this.src.lineCount(mode) });
  }

  /** The table's container: `node` at `path`. */
  showTable(node: HugeNode, path: Seg[]) {
    if (node.t < ARR) return;
    this.tableAt = { node, path };
    this.table?.setNode(node);
    this.ui.set({ table: { path: formatPath(path), rows: node.count, cols: 0, ok: true } });
    if (this.ui.get().view !== 'table') this.setView('table');
  }

  /** Shows the table of the container at `path` (the breadcrumbs). */
  async tableGoto(path: Seg[]) {
    const chain = await this.src.resolve(path);
    if (this.dead || !chain) return;
    this.showTable(chain[chain.length - 1], path);
  }

  get tablePath() {
    return this.tableAt.path;
  }

  private async tableForSel() {
    const sel = this.sel;
    if (!sel) return;
    if (sel.node.t >= ARR) return this.showTable(sel.node, sel.path);
    if (!sel.path.length) return;
    const parent = await this.src.resolve(sel.path.slice(0, -1));
    if (this.dead || !parent) return;
    this.showTable(parent[parent.length - 1], sel.path.slice(0, -1));
  }

  // ── Selection ──────────────────────────────────────────────────────────

  private select(node: HugeNode, path: Seg[], from: 'tree' | 'table' | 'lines') {
    this.sel = { node, path };
    this.ui.set({ sel: { path: formatPath(path), t: node.t, bytes: node.end < 0 ? -1 : node.end - node.at, count: node.count, partial: !!node.partial } });
    if (from !== 'lines' && this.lines) void this.showLine(node.at, false);
  }

  /** A click in the Format view: selects the value there. */
  private async pickAt(at: number) {
    const chain = await this.src.locate(at);
    if (this.dead || !chain.length) return;
    const node = chain[chain.length - 1];
    this.select(node, chain.slice(1).map((n) => n.key as Seg), 'lines');
    this.tree?.reveal(chain, null);
  }

  /** The line showing offset `at` in the Format view. */
  private async showLine(at: number, hit: boolean) {
    const lines = this.lines;
    if (!lines) return;
    const k = await this.src.lineOf(lines.mode, Math.max(0, at));
    if (this.dead || this.lines !== lines) return;
    lines.goto(k, hit && lines.mode === 'raw' ? at : -1, true);
  }

  // ── Find ───────────────────────────────────────────────────────────────

  openFind() {
    const f = this.ui.get().find;
    this.ui.set({ find: { ...f, open: true, seq: f.seq + 1 }, ask: null });
  }

  closeFind() {
    this.find.stop();
    this.tree?.setFind('', -1);
    this.lines?.setFind('');
    this.ui.set({ find: { q: '', total: 0, index: -1, read: 0, done: true, more: false, waiting: false, open: false, seq: this.ui.get().find.seq + 1 } });
  }

  /** Searches the file for `q` (a $.path in the tree goes there). */
  runFind(q: string) {
    const view = this.ui.get().view;
    if ((view === 'tree' || view === 'table') && (q[0] === '$' || (q[0] === '/' && q.length > 1))) {
      const segs = parsePath(q);
      if (segs) {
        this.find.stop();
        void this.gotoPath(segs, q);
        return;
      }
    }
    this.tree?.setFind(q, -1);
    this.lines?.setFind(q);
    this.find.start(q, this.position());
  }

  findStep(dir: 1 | -1) {
    this.find.step(dir);
  }

  /** Where the open view is: Find goes to the first match from here. */
  private position() {
    const view = this.ui.get().view;
    if (view === 'format' && this.lines) {
      const top = this.lines.lines.get(this.lines.topLine);
      return top ? top.at : 0;
    }
    return this.sel ? this.sel.node.at : 0;
  }

  /** Goes to a match: its value in the tree or the table, its line in the Format view. */
  private async jumpTo(at: number) {
    const view = this.ui.get().view;
    const q = this.ui.get().find.q;
    if (view === 'format') return this.showLine(at, true);
    const chain = await this.src.locate(at);
    if (this.dead || !chain.length) return;
    const node = chain[chain.length - 1];
    if (view === 'table') {
      const tn = this.tableAt.node;
      const d = tn ? chain.findIndex((n) => n.at === tn.at && n.depth === tn.depth) : -1;
      if (d >= 0 && chain[d + 1]) this.table?.gotoRow(chain[d + 1].i, true);
      this.select(node, chain.slice(1).map((n) => n.key as Seg), 'table');
      return;
    }
    this.tree?.setFind(q, node.at);
    this.tree?.reveal(chain, null);
    this.select(node, chain.slice(1).map((n) => n.key as Seg), 'tree');
  }

  /** Goes to the value at `segs` (from Find's $.path or the "Go to" bar). */
  async gotoPath(segs: Seg[], q?: string) {
    const chain = await this.src.resolve(segs);
    if (this.dead) return;
    if (!chain) {
      if (q !== undefined) this.ui.set({ find: { ...this.ui.get().find, q, total: 0, index: -1, done: true } });
      else this.host.toast('No value at that path', 'info');
      return;
    }
    const node = chain[chain.length - 1];
    if (q !== undefined) this.ui.set({ find: { ...this.ui.get().find, q, total: 1, index: 0, done: true, read: 1 } });
    if (this.ui.get().view === 'table') {
      if (node.t >= ARR) this.showTable(node, segs);
      else if (chain.length > 1) {
        this.showTable(chain[chain.length - 2], segs.slice(0, -1));
        this.table?.gotoRow(node.i, true);
      }
    } else if (this.ui.get().view !== 'tree') this.setView('tree');
    this.tree?.setFind('', node.at);
    this.tree?.reveal(chain, null);
    this.select(node, segs, 'tree');
  }

  // ── Go to ──────────────────────────────────────────────────────────────

  /** Opens the "Go to" bar for the open view (line, index in the selected container, or row). */
  openAsk() {
    const s = this.ui.get();
    let ask: Ask = { kind: 'path' };
    if (s.view === 'format') ask = { kind: 'line', max: this.lines?.count ?? s.lines };
    else if (s.view === 'table' && this.tableAt.node) ask = { kind: 'row', max: this.tableAt.node.count };
    this.askOpen = null;
    this.ui.set({ ask, find: { ...s.find, open: false } });
  }

  private askIndex(o: Open) {
    this.askOpen = o;
    this.ui.set({ ask: { kind: 'index', max: o.node.count, partial: !!o.node.partial } });
  }

  closeAsk() {
    this.ui.set({ ask: null });
  }

  /** The "Go to" bar's answer. False: not understood (the bar stays). */
  answer(text: string): boolean {
    const ask = this.ui.get().ask;
    if (!ask) return false;
    const t = text.trim().replace(/[\s,_]/g, '');
    if (ask.kind === 'path') {
      const segs = text.trim() ? parsePath(text.trim()[0] === '$' || text.trim()[0] === '/' ? text.trim() : '$.' + text.trim()) : null;
      if (!segs) return false;
      void this.gotoPath(segs);
      this.closeAsk();
      return true;
    }
    if (!/^\d+$/.test(t)) return false;
    const n = Number(t);
    if (ask.kind === 'line') {
      if (n < 1 || n > ask.max) return false;
      this.lines?.goto(n - 1, -1, true);
    } else if (ask.kind === 'row') {
      if (n >= ask.max) return false;
      this.table?.gotoRow(n);
    } else {
      const o = this.askOpen;
      if (!o || n >= ask.max) return false;
      this.tree?.gotoIndex(o, n);
      this.tree?.focus();
    }
    this.closeAsk();
    return true;
  }

  /** The problem the status bar shows: the normal path's (once the file is read), else where reading stopped. */
  problem() {
    const st = this.src.state();
    const b = st.status;
    if (b && b.kind !== 'valid') return { kind: b.kind, msg: b.msg ?? '', at: b.at, line: b.line, col: b.col };
    if (b?.warnings && b.msg) return { kind: 'warning' as const, msg: b.msg, at: b.at, line: b.line, col: b.col };
    return st.error ? { kind: 'error' as const, ...st.error } : null;
  }

  /** Go to error (or the issue, or the first warning): its line in the Format view, as written, marked. */
  async gotoError() {
    const err = this.problem();
    if (!err) return;
    this.setMode('raw');
    if (this.ui.get().view !== 'format') this.setView('format');
    // (The Format view mounts in the next frame.)
    await new Promise((r) => requestAnimationFrame(r));
    if (this.dead) return;
    this.lines?.setError(err.line - 1, err.col - 1);
    this.lines?.goto(err.line - 1, err.at, true);
  }

  // ── Copy and save ──────────────────────────────────────────────────────

  get selected() {
    return this.sel;
  }

  copyPath(path: Seg[] | undefined = this.sel?.path) {
    if (!path) return this.host.toast('Select a value first', 'info');
    track('feature_used', { feature: 'copy_path' });
    void this.copy(formatPath(path), 'Copied path');
  }

  /** Copies a value (as the normal tool does: a string as itself, the rest as indented JSON) if it isn't too big. */
  async copyValue(node: HugeNode | undefined = this.sel?.node, path: Seg[] | undefined = this.sel?.path) {
    if (!node) return this.host.toast('Select a value first', 'info');
    track('feature_used', { feature: 'copy_value' });
    if (node.end < 0) return this.host.toast('That value is still being indexed. Try again once it is.', 'info');
    const bytes = node.end - node.at;
    const save = { label: 'Save as file', run: () => this.saveValue(node, path) };
    if (bytes > COPY_MAX) return this.host.toast(`That value is too large to copy (${rt.bytes(bytes)})`, 'info', save);
    try {
      const raw = await this.src.raw(node, COPY_MAX);
      if (this.dead) return;
      if (raw === null) return this.host.toast(`That value is too large to copy (${rt.bytes(bytes)})`, 'info', save);
      let text = raw;
      if (node.t === STR) text = JSON.parse(raw) as string;
      else if (node.t >= ARR) {
        const res = parse(raw);
        if (res.root && !res.error) text = stringify(res.root, this.host.indent);
      }
      await this.copy(text, node.t >= ARR ? 'Copied value as JSON' : 'Copied value');
    } catch (e) {
      this.failed(e);
    }
  }

  /** Saves a value (any size: its bytes as written) as a file. */
  saveValue(node: HugeNode | undefined = this.sel?.node, path: Seg[] | undefined = this.sel?.path) {
    if (!node) return this.host.toast('Select a value to save it as a file', 'info');
    if (node.end < 0) return this.host.toast('That value is still being indexed. Try again once it is.', 'info');
    track('feature_used', { feature: 'download_output' });
    const base = this.meta.name.replace(/\.[^.]+$/, '');
    const last = path?.length ? String(path[path.length - 1]).replace(/[^\w.-]+/g, '_').slice(0, 40) : '';
    this.host.saveBlob(this.src.blob(node), `${base}${last ? '-' + last : ''}.${node.t === STR ? 'txt' : 'json'}`);
  }

  private async copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.host.toast(msg, 'ok');
    } catch {
      this.host.toast("Couldn't copy: your browser refused the clipboard", 'err');
    }
  }

  // ── Keys ───────────────────────────────────────────────────────────────

  private key(e: KeyboardEvent): boolean {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && k === 'g') {
      this.openAsk();
      return true;
    }
    if (mod && !e.shiftKey && !e.altKey && k === 's') {
      this.saveValue();
      return true;
    }
    // The editor's commands (Format input, Minify, Use output, Wrap): nothing to act on in huge mode.
    if ((mod && e.key === 'Enter') || (e.altKey && e.shiftKey && !mod && e.code === 'KeyF') || (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ')) {
      this.host.toast('Not available for files this large yet', 'info');
      return true;
    }
    return false;
  }

  /** What the status bar and the UI read now (tests). */
  snapshot(): HugeUI {
    return this.ui.get();
  }
}

