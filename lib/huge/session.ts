/*
 * A huge file, open: what huge mode's views get. The session owns the source (the core's index, or
 * SmallSource), the views the UI mounts (tree, lines, table), the selection, Find, "Go to", copying and
 * saving values, and the index's progress. The engine only routes a big file here (Engine.loadFile) and
 * hands over the keys and the view switch while it is open (HugeHook); opening any other document closes it.
 */
import { ARR, OBJ, STR, parse } from '../json/parser';
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
import { HUGE_VIEWS, HugeStore, type Ask, type EditUI, type HugeUI, type HugeView } from './state';
import { HugeEditing, adjustPath, boxText, dedent, editError, kindOf, valueJson, type Effect, type EditOp, type ValueKind } from './edits';
import { pickExisting, pickFile, pickSave, pickers, watchDrops, writable } from './handles';
import { planSave, readable, sameFile, type SaveChoice } from './save-plan';
import { PASTE_MAX } from './text-window';
import { HugeTasks } from './tasks';
import { HugeTableView } from './table-view';
import { HugeGraph } from './graph';
import { HugeTreeView } from './tree-view';
import type { Open } from './tree-model';
import type { HugeNode, HugeSource, IndexState, LineMode, Seg } from './source';
import type { Editor } from '../engine/editor';

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
  /** The normal tool's editor (huge mode makes another of its kind for "Edit as text": see kit.ts). */
  readonly ed: Editor;
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
  /** The file's size and last change (Save tells the opened file from another by them). */
  size: number;
  lastModified: number;
  /** The file's handle, when huge mode opened it (its Open file, or a drop on it): Save writes into it. */
  handle: FileSystemFileHandle | null;
  /** The file itself (read before saving over a picked file, to check it still is as it was opened). */
  file: Blob;
}

/** Where an edit was asked from (the huge_edit event). */
export type EditFrom = Events['huge_edit']['from'];
/** The most a value's text may be for the edit box (more: the text dialog). */
const BOX_MAX = 64 * 1024;
/** Typing joined into one undo step by the core: changes this close together (ms, editor.ts TYPING_MS). */
const TYPING_PAUSE = 1000;

/** What the Format view's editing window does for the session (components/huge/HugeFormatEdit.tsx). */
export interface FormatEditApi {
  /** Resolves once everything typed is taken in by the document. */
  flush(): Promise<void>;
  /** The caret's byte in the document. */
  caretByte(): number;
  /** The window read again where it is (after undo). */
  reload(): Promise<void>;
  /** The caret at byte `at` (the window read there if it's outside). */
  goto(at: number): Promise<void>;
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
  private graph: HugeGraph | null = null;
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
  /** The Shape panel's and the commands' work (made when first shown). */
  private work: HugeTasks | null = null;
  private closers: (() => void)[] = [];
  /** Edits (null: the source can't edit). */
  private editing: HugeEditing | null = null;
  /** The opened file's handle (Save writes into it), its size and last change as last saved or opened. */
  private handle: FileSystemFileHandle | null;
  private file: { size: number; lastModified: number };
  /** The opened file (or the one saved in place): what the document reads. */
  private opened: Blob;
  /** "Save changes to big.json" is asked: its answer. */
  private saveAnswer: ((a: SaveChoice) => void) | null = null;
  private saving: { stop(): void } | null = null;
  private restoreOffered = false;
  /** Where the edit box or text dialog was opened from (the huge_edit event). */
  private editFrom: EditFrom = 'menu';

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
      graph: null,
      edit: src.edits ? { ready: false, edited: false, steps: 0, canUndo: false, canRedo: false, busy: false, saving: null, restore: null, confirm: false, saveAsk: false, inPlace: !!meta.handle } : null,
      box: null,
      textEdit: null,
      menu: null,
      fe: null,
      feInfo: null,
    });
    this.handle = meta.handle;
    this.file = { size: meta.size, lastModified: meta.lastModified };
    this.opened = meta.file;
    if (src.edits) {
      this.editing = new HugeEditing({
        src,
        selPath: () => this.sel?.path ?? null,
        changed: (fx, select) => this.afterEdit(fx, select),
        refused: (msg) => this.host.toast(msg, 'info'),
        failed: (e) => this.failed(e),
      });
      window.addEventListener('beforeunload', this.onUnload);
      // (A file dropped meanwhile brings its handle: saved in place.)
      this.closers.push(watchDrops());
      // The palette's edit commands (components/dialogs.tsx).
      const cmd = (e: Event) => this.command((e as CustomEvent<string>).detail);
      window.addEventListener('tk:huge-cmd', cmd);
      this.closers.push(() => window.removeEventListener('tk:huge-cmd', cmd));
    }
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
    const edits = this.ui.get().edit;
    this.dead = true;
    this.find.stop();
    this.stopState();
    this.saving?.stop();
    this.answerSave('cancel');
    window.removeEventListener('beforeunload', this.onUnload);
    clearTimeout(this.growTimer);
    // (Closing keeps the edits not kept yet, then ends the core's worker.)
    const kept = this.src.destroy();
    // Replaced by another document with unsaved edits: they are kept, and offered when the file is opened again.
    if (!back && edits?.edited) {
      const { host, meta } = this;
      void kept.then(() => host.toast(rt.n(edits.steps, 'Your {n} unsaved change to {name} is kept: reopen it to restore it', 'Your {n} unsaved changes to {name} are kept: reopen it to restore them', { name: meta.name }), 'info', undefined, 8000));
    }
    this.tree?.destroy();
    this.lines?.destroy();
    this.table?.destroy();
    this.graph?.destroy();
    this.graph = null;
    this.work?.destroy();
    this.work = null;
    for (const f of this.closers.splice(0)) f();
    this.tree = this.lines = null;
    this.table = null;
    if (current === this) setCurrent(null);
    if (store.get().huge === this.viewer) store.set({ huge: null });
    if (back) this.host.focusEditor();
  }

  get closed() {
    return this.dead;
  }

  /** Runs `f` when the session closes (a decompressed file's storage is let go then). */
  onClose(f: () => void) {
    if (this.dead) f();
    else this.closers.push(f);
  }

  private failed(e: unknown) {
    if (this.dead) return;
    reportError(e, 'huge');
    this.host.toast(`Couldn't read ${this.meta.name}`, 'err');
  }

  // ── Index progress ─────────────────────────────────────────────────────

  private onState = (st: IndexState) => {
    if (this.dead) return;
    const was = this.ui.get().index;
    const wasEnded = was.done || was.cancelled;
    const now = performance.now();
    this.samples.push([now, st.bytes]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 3000) this.samples.shift();
    const [t0, b0] = this.samples[0];
    const rate = now > t0 + 200 ? ((st.bytes - b0) / (now - t0)) * 1000 : 0;
    const ended = st.done || st.cancelled;
    const eta = !ended && rate > 0 && now - this.began > 400 ? (this.src.size - st.bytes) / rate : null;
    this.ui.set({ index: st, rate, eta, took: ended ? (this.ui.get().took ?? now - this.began) : null, ...(st.docSize !== undefined && { size: st.docSize }) });
    this.editState(st);
    // A second top-level value appeared: the root is the list of them now, and pretty lines shifted by its "[".
    if (st.multi !== this.multi) {
      this.multi = st.multi;
      if (this.root && this.root.at >= 0) {
        this.root = null;
        this.lines?.reload();
      }
    }
    if (!this.root) void this.readRoot();
    if (ended && !wasEnded) {
      this.report(st.error ? 'error' : st.cancelled ? 'cancelled' : 'done');
      if (st.error && st.bytes < 1) this.host.toast(`${this.meta.name} isn't valid JSON`, 'err');
    }
    // (The Format view's text being edited: the other views read the document again when that ends; each key's
    // state would otherwise send them all to the worker, ahead of the next key.)
    if (this.ui.get().fe) return;
    // The views take the counts that grew, at most once a second (and at once when it ends, or when the
    // Format view's first lines are there to read). Done before (an edit's state): nothing grew.
    if (ended) {
      if (!wasEnded) this.grow(true);
    } else if (this.lines && !this.lines.count && this.src.lineCount(this.lines.mode) > 0) this.grow(false);
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
    if (all) void this.refreshGraph();
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

  /** The indent unit the tool writes with (Settings). */
  get indent() {
    return this.host.indent;
  }

  /** The Shape panel's and the Convert view's work over the file (lib/huge/tasks.ts). */
  get tasks(): HugeTasks {
    return (this.work ??= new HugeTasks(this));
  }

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
      edit: (at) => this.editing && this.formatEdit(at),
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

  mountGraph(el: HTMLElement) {
    this.graph?.destroy();
    const graph = (this.graph = new HugeGraph(el, {
      src: this.src,
      select: (node, path) => this.select(node, path, 'graph'),
      copy: (node, path, what) => (what === 'path' ? this.copyPath(path) : void this.copyValue(node, path)),
      escape: () => document.querySelector<HTMLElement>('.hg [role="tab"][aria-selected="true"]')?.focus(),
      changed: (path, shown, full) => this.ui.set({ graph: { path: formatPath(path), up: path.length > 0, shown, full } }),
      failed: (e) => this.failed(e),
    }));
    graph.onUp = () => void this.graphUp();
    graph.onFrom = () => void this.graphFrom();
    if (this.ui.get().view === 'graph') {
      graph.activate();
      void this.graphFor();
    }
    return () => {
      if (this.graph === graph) this.graph = null;
      graph.destroy();
    };
  }

  /**
   * The graph for the selection: the part it shows already has it (selected there), or the part from the selected
   * container (the container holding a selected value; the file's root with nothing selected).
   */
  private async graphFor() {
    const g = this.graph;
    if (!g || !this.root) return;
    const sel = this.sel;
    if (g.rootPath && (!sel || g.has(sel.path))) return g.select(sel?.path ?? null);
    if (!sel || !sel.path.length) return g.show(this.root, []);
    if (sel.node.t >= ARR) return g.show(sel.node, sel.path, sel.path);
    const up = sel.path.slice(0, -1);
    const chain = await this.src.resolve(up);
    if (this.dead || this.graph !== g || !chain) return;
    await g.show(chain[chain.length - 1], up, sel.path);
  }

  /** The graph's root one level up (the old root stays selected). */
  async graphUp() {
    const g = this.graph;
    const path = g?.rootPath;
    if (!g || !path?.length) return;
    const up = path.slice(0, -1);
    const chain = up.length ? await this.src.resolve(up) : [this.root!];
    if (this.dead || this.graph !== g || !chain?.length) return;
    await g.show(chain[chain.length - 1], up, path);
  }

  /** The graph from the selected value (its container for a value). */
  async graphFrom() {
    const g = this.graph;
    const sel = this.sel;
    if (!g || !sel) return;
    if (sel.node.t >= ARR) return g.show(sel.node, sel.path, sel.path);
    const up = sel.path.slice(0, -1);
    const chain = up.length ? await this.src.resolve(up) : [this.root!];
    if (this.dead || this.graph !== g || !chain?.length) return;
    await g.show(chain[chain.length - 1], up, sel.path);
  }

  /** Indexing ended: the graph's counts are read again (its root and selection kept). */
  private async refreshGraph(moved?: Seg[]) {
    const g = this.graph;
    let path = moved ?? g?.rootPath;
    if (!g || !path) return;
    let chain = path.length ? await this.src.resolve(path) : [await this.src.root()];
    // (Gone after an edit: from the root.)
    if (!chain?.length && moved) {
      path = [];
      chain = [await this.src.root()];
    }
    if (this.dead || this.graph !== g || !chain?.length) return;
    await g.refresh(chain[chain.length - 1], this.sel?.path ?? null, moved ? path : undefined);
  }

  graphFit() {
    this.graph?.fit();
  }

  graphZoom(f: number) {
    this.graph?.zoomBy(f);
  }

  graphCollapse() {
    this.graph?.collapseAll();
  }

  /** Saves the graph shown as an image (PNG at twice the size, or SVG). */
  async graphExport(format: 'png' | 'svg') {
    const g = this.graph;
    if (!g) return;
    try {
      const blob = await g.exportImage({ format, area: 'all', background: 'theme', scale: 2 });
      if (this.dead) return;
      track('feature_used', { feature: format === 'png' ? 'graph_export_png' : 'graph_export_svg' });
      this.host.saveBlob(blob, `${this.meta.name.replace(/\.[^.]+$/, '')}-graph.${format}`);
    } catch {
      this.host.toast("Couldn't make the image", 'err');
    }
  }

  /** The page's theme changed: the graph draws in the new colours. */
  themeChanged() {
    this.graph?.theme();
  }

  setView(view: HugeView) {
    const was = this.ui.get().view;
    if (view === was) return;
    if (this.ui.get().fe) void this.exitFormatEdit(false);
    if (view === 'graph') {
      this.graph?.activate();
      void this.graphFor();
    } else if (was === 'graph') this.graph?.deactivate();
    // The table shows the selected container (or the one holding the selected value).
    if (view === 'table' && this.sel) void this.tableForSel();
    this.ui.set({ view, ask: null });
    track('view_opened', { view, via: 'other' });
    // Find follows the view without searching again (its matches are places in the file, whatever the view):
    // the current one is shown in this view. Shape and Convert read the whole file themselves: a search still
    // running stops there rather than read alongside them.
    const q = this.ui.get().find.q;
    if (q && (view === 'format' || view === 'tree' || view === 'table')) {
      const at = this.find.index >= 0 ? this.find.hits[this.find.index] : -1;
      if (at >= 0) requestAnimationFrame(() => !this.dead && void this.jumpTo(at));
    } else if (q && (view === 'shape' || view === 'convert')) this.find.stop();
  }

  setMode(mode: LineMode) {
    this.modeSet = true;
    if (mode === this.ui.get().mode) return;
    if (this.ui.get().fe) void this.exitFormatEdit(false);
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

  private select(node: HugeNode, path: Seg[], from: 'tree' | 'table' | 'lines' | 'graph') {
    this.sel = { node, path };
    this.ui.set({ sel: { path: formatPath(path), t: node.t, bytes: node.end < 0 ? -1 : node.end - node.at, count: node.count, partial: !!node.partial, named: typeof path[path.length - 1] === 'string', root: !path.length } });
    if (from !== 'lines' && this.lines) void this.showLine(node.at, false);
    // The tree follows a choice in the graph (and the graph one elsewhere, when it shows that value).
    if (from === 'graph') void this.src.resolve(path).then((chain) => chain && !this.dead && this.tree?.reveal(chain, null));
    else this.graph?.select(path);
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
    // (Editing the Format view's text: the window goes there.)
    if (this.fe && hit) return this.fe.goto(at);
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
    if ((view === 'tree' || view === 'table' || view === 'graph') && (q[0] === '$' || (q[0] === '/' && q.length > 1))) {
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
    // (In the Graph: the match selected there, or the part around it shown.)
    if (view === 'graph') void this.graphFor();
  }

  /** Goes to the value at byte `at` (the Shape panel's places): the tree, opened to it, and selected. */
  async revealAt(at: number) {
    const chain = await this.src.locate(at);
    if (this.dead || !chain.length) return;
    if (this.ui.get().view !== 'tree') this.setView('tree');
    const node = chain[chain.length - 1];
    // (The tree mounts in the next frame when it wasn't shown yet.)
    await new Promise((r) => requestAnimationFrame(r));
    if (this.dead) return;
    this.tree?.setFind('', node.at);
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
    const view = this.ui.get().view;
    if (view === 'table') {
      if (node.t >= ARR) this.showTable(node, segs);
      else if (chain.length > 1) {
        this.showTable(chain[chain.length - 2], segs.slice(0, -1));
        this.table?.gotoRow(node.i, true);
      }
    } else if (view !== 'tree' && view !== 'graph') this.setView('tree');
    this.tree?.setFind('', node.at);
    this.tree?.reveal(chain, null);
    this.select(node, segs, 'tree');
    // (The Graph stays: the value selected there, or the part around it shown.)
    if (view === 'graph') void this.graphFor();
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
  async saveValue(node: HugeNode | undefined = this.sel?.node, path: Seg[] | undefined = this.sel?.path) {
    if (!node) return this.host.toast('Select a value to save it as a file', 'info');
    if (node.end < 0) return this.host.toast('That value is still being indexed. Try again once it is.', 'info');
    track('feature_used', { feature: 'download_output' });
    const base = this.meta.name.replace(/\.[^.]+$/, '');
    const last = path?.length ? String(path[path.length - 1]).replace(/[^\w.-]+/g, '_').slice(0, 40) : '';
    try {
      // (The document's bytes: its edits too. A Blob of the file's slices and the edits', nothing copied.)
      const blob = await this.src.slice(node);
      if (!this.dead) this.host.saveBlob(blob, `${base}${last ? '-' + last : ''}.${node.t === STR ? 'txt' : 'json'}`);
    } catch (e) {
      this.failed(e);
    }
  }

  private async copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.host.toast(msg, 'ok');
    } catch {
      this.host.toast("Couldn't copy: your browser refused the clipboard", 'err');
    }
  }

  // ── Editing ────────────────────────────────────────────────────────────

  /** Leaving the page with unsaved edits: the browser asks (they are kept for next time too: a session). */
  private onUnload = (e: BeforeUnloadEvent) => {
    if (!this.ui.get().edit?.edited) return;
    e.preventDefault();
    e.returnValue = '';
  };

  private setEdit(patch: Partial<EditUI>) {
    const e = this.ui.get().edit;
    if (e) this.ui.set({ edit: { ...e, ...patch } });
  }

  /** The edit state, from the source's: after each edit, undo or save, and as the document is read again. */
  private editState(st: IndexState = this.src.state()) {
    const ui = this.ui.get().edit;
    const e = st.edit;
    const ed = this.editing;
    if (!ui || !e || !ed) return;
    let restore = ui.restore;
    // A kept session of this file: offered once, before anything is edited.
    if (e.session && !this.restoreOffered && !e.edited && st.done) {
      this.restoreOffered = true;
      restore = { steps: e.session.steps, time: e.session.time };
    }
    if (!e.session) restore = null;
    this.setEdit({ ready: st.done && !ui.saving, edited: e.edited, steps: e.edited ? e.steps : 0, canUndo: e.canUndo, canRedo: e.canRedo, busy: ed.busy || (e.edited && !st.done), restore, inPlace: !!this.handle });
  }

  /** Edits can be asked now; else says why. */
  private canEdit(): boolean {
    const e = this.ui.get().edit;
    if (!e || !this.editing || this.dead) return false;
    if (e.saving) {
      this.host.toast('Wait for the save to finish', 'info');
      return false;
    }
    if (!this.src.state().done) {
      this.host.toast('The file is still being read: it can be edited once it is', 'info');
      return false;
    }
    return true;
  }

  /** Runs edit `op` (one undo step): the views read the document again after it. */
  async edit(op: EditOp, from: EditFrom): Promise<boolean> {
    if (!this.canEdit()) return false;
    this.setEdit({ busy: true });
    const ok = await this.editing!.run(op, from);
    if (!this.dead) this.editState();
    return ok;
  }

  undo(from: EditFrom) {
    if (this.fe) return void this.formatUndo('undo', from);
    if (this.ui.get().edit?.canUndo) void this.edit({ op: 'undo' }, from);
    else if (this.editing) this.host.toast('Nothing to undo', 'info');
  }

  redo(from: EditFrom) {
    if (this.fe) return void this.formatUndo('redo', from);
    if (this.ui.get().edit?.canRedo) void this.edit({ op: 'redo' }, from);
    else if (this.editing) this.host.toast('Nothing to redo', 'info');
  }

  /**
   * After an edit: every view reads the document again (nodes from before it are stale), with what was open open
   * again (moved as `fx` says), and `select` selected (where the edit says; else where the selection was, or the
   * nearest value above it that's still there).
   */
  private async afterEdit(fx: Effect, select: Seg[] | null) {
    if (this.dead) return;
    const tree = this.tree;
    const opens = tree ? tree.openPaths().slice(1).map((p) => adjustPath(p, fx)).filter((p): p is Seg[] => !!p) : [];
    const graphPath = this.graph?.rootPath ? (adjustPath(this.graph.rootPath, fx) ?? this.graph.rootPath.slice(0, -1)) : null;
    let tablePath = adjustPath(this.tableAt.path, fx) ?? this.tableAt.path.slice(0, -1);
    const root = await this.src.root();
    if (this.dead) return;
    this.root = root;
    const at = async (p: Seg[]) => (p.length ? await this.src.resolve(p) : [root]);
    let path = select ?? (this.sel ? adjustPath(this.sel.path, fx) : null);
    let chain = path ? await at(path) : null;
    while (path && !chain && path.length) {
      path = path.slice(0, -1);
      chain = await at(path);
    }
    if (this.dead) return;
    if (tree) {
      const chains: HugeNode[][] = [];
      for (const p of opens) {
        const c = await this.src.resolve(p);
        if (c) chains.push(c);
      }
      if (this.dead) return;
      tree.reload(root, chains, chain);
    }
    if (chain && path) this.select(chain[chain.length - 1], path, 'tree');
    else {
      this.sel = null;
      this.ui.set({ sel: null });
    }
    // The table: the same container (or the one above it, gone), read again where it was scrolled.
    let tc = await at(tablePath);
    while (!tc && tablePath.length) {
      tablePath = tablePath.slice(0, -1);
      tc = await at(tablePath);
    }
    const tn = tc?.[tc.length - 1];
    if (this.dead) return;
    if (tn && tn.t >= ARR) {
      this.tableAt = { node: tn, path: tablePath };
      this.table?.reload(tn);
      this.ui.set({ table: { ...this.ui.get().table, path: formatPath(tablePath), rows: tn.count, ok: true } });
    }
    this.lines?.reload();
    this.ui.set({ lines: this.lines?.count ?? this.src.lineCount(this.ui.get().mode) });
    if (graphPath) void this.refreshGraph(graphPath);
    // Find's matches were places in the document before the edit: searched again.
    const f = this.ui.get().find;
    if (f.open && f.q) this.runFind(f.q);
  }

  /** The value an edit acts on: the selected one (or the root). */
  private target(): { node: HugeNode; path: Seg[] } | null {
    return this.sel ?? (this.root ? { node: this.root, path: [] } : null);
  }

  /** Where the edit box opens: over the selected row's value (or name) in the tree, its cell in the table. */
  private anchor(part: 'value' | 'name'): { x: number; y: number; w: number } | null {
    const view = this.ui.get().view;
    let el: Element | null = null;
    let box: DOMRect | null = null;
    if (view === 'tree') {
      const row = document.querySelector('#hg-tree #htv-sel');
      if (!row) return null;
      const r = row.getBoundingClientRect();
      const k = part === 'name' ? row.querySelector('.tv-k') : row.querySelector('.tv-c, .tv-root');
      const x = k ? (part === 'name' ? k.getBoundingClientRect().left : k.getBoundingClientRect().right + 6) : r.left;
      return { x, y: r.top, w: Math.max(240, r.right - x - 8) };
    }
    if (view === 'table') {
      el = document.querySelector('#hg-table .tb-r.on .tb-td.on') ?? document.querySelector('#hg-table .tb-r.on');
      box = el?.getBoundingClientRect() ?? null;
      return box ? { x: box.left, y: box.top, w: Math.max(240, box.width) } : null;
    }
    return null;
  }

  /** Edits the selected value: in the edit box, or (a container, a long string) as text. */
  async editValue(from: EditFrom) {
    const t = this.target();
    if (!t || !this.canEdit()) return;
    if (t.node.t >= ARR) return this.openText(from);
    let json: string | null = null;
    if (t.node.clipped) {
      // (A long string: its whole text, if the box can hold it; else the text dialog.)
      if (t.node.end - t.node.at > BOX_MAX) return this.openText(from);
      json = await this.src.edits!.nodeText(t.node, BOX_MAX).catch(() => null);
      if (json === null || this.dead) return this.openText(from);
    }
    this.editFrom = from;
    this.ui.set({ box: { mode: 'value', path: t.path, i: t.node.i, label: formatPath(t.path), index: 0, named: false, kind: kindOf(t.node.t), text: boxText(t.node, json), name: '', at: this.anchor('value') } });
  }

  /** Renames the selected object member. */
  renameSel(from: EditFrom) {
    const t = this.target();
    if (!t || !this.canEdit()) return;
    const key = t.path[t.path.length - 1];
    if (typeof key !== 'string') return void this.host.toast('Only the members of an object have names', 'info');
    this.editFrom = from;
    this.ui.set({ box: { mode: 'rename', path: t.path, i: t.node.i, label: formatPath(t.path), index: 0, named: true, kind: 'string', text: '', name: key, at: this.anchor('name') } });
  }

  /** Inserts a value after the selected one, or inside it (a container: at its end). */
  insertSel(where: 'after' | 'inside', from: EditFrom) {
    const t = this.target();
    if (!t || !this.canEdit()) return;
    const inside = where === 'inside' || !t.path.length;
    if (inside && t.node.t < ARR) return void this.host.toast('Only an array or an object can hold values', 'info');
    const path = inside ? t.path : t.path.slice(0, -1);
    const index = inside ? t.node.count : t.node.i + 1;
    // (Into an object: the container itself, or the selected value's, when its last step is a name.)
    const named = inside ? t.node.t === OBJ && !this.listRoot(t) : typeof t.path[t.path.length - 1] === 'string';
    this.editFrom = from;
    this.ui.set({ box: { mode: 'insert', path, label: formatPath(path), index, named, kind: 'string', text: '', name: '', at: this.anchor('value') } });
  }

  /** The root of several top-level values (an array of them, as shown). */
  private listRoot(t: { path: Seg[]; node: HugeNode }) {
    return !t.path.length && this.src.state().multi;
  }

  removeSel(from: EditFrom) {
    const t = this.target();
    if (!t || !this.canEdit()) return;
    if (!t.path.length) return void this.host.toast("The root value can't be deleted: edit it instead", 'info');
    void this.edit({ op: 'remove', path: t.path, i: t.node.i }, from);
  }

  duplicateSel(from: EditFrom) {
    const t = this.target();
    if (!t || !this.canEdit()) return;
    if (!t.path.length) return void this.host.toast("The root value can't be duplicated", 'info');
    void this.edit({ op: 'duplicate', path: t.path, i: t.node.i }, from);
  }

  /** The edit box's answer: the edit made, or why what was typed can't be (the box stays then). */
  async commitBox(kind: ValueKind, text: string, name: string): Promise<string | null> {
    const b = this.ui.get().box;
    if (!b) return null;
    let op: EditOp;
    if (b.mode === 'rename') {
      if (name === b.name) {
        this.closeBox();
        return null;
      }
      op = { op: 'rename', path: b.path, i: b.i, name };
    } else {
      const v = valueJson(kind, text);
      if ('error' in v) return v.error;
      op = b.mode === 'value' ? { op: 'set', path: b.path, i: b.i, json: v.json } : { op: 'insert', parent: b.path, index: b.index, json: v.json, name: b.named ? name : null };
    }
    this.closeBox();
    await this.edit(op, this.editFrom);
    return null;
  }

  /** Closes the edit box (focus back to the view). */
  closeBox() {
    this.ui.set({ box: null });
    this.focusView();
  }

  private focusView() {
    const view = this.ui.get().view;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#hg-${view} .hg-focus, #hg-${view}`)?.focus({ preventScroll: true }));
  }

  /** Opens the selected value as text in the normal editor (its dialog), read from the document (≤ 64 MB). */
  async openText(from: EditFrom) {
    const t = this.target();
    if (!t || !this.canEdit()) return;
    this.editFrom = from;
    const path = t.path;
    this.ui.set({ box: null, textEdit: { path, label: formatPath(path), text: null, i: t.node.i } });
    try {
      const text = dedent(await this.src.edits!.nodeText(t.node));
      const te = this.ui.get().textEdit;
      if (!this.dead && te && te.path === path) this.ui.set({ textEdit: { ...te, text } });
    } catch (e) {
      if (this.dead) return;
      this.ui.set({ textEdit: null });
      const m = editError(e);
      if (m) this.host.toast(rt(m), 'info');
      else this.failed(e);
    }
  }

  /**
   * The text dialog's Apply: its text in place of the value (one undo step), written as the document is if it's
   * JSON; else as typed (applied anyway), the document then invalid until it's fixed.
   */
  async applyText(text: string): Promise<boolean> {
    const te = this.ui.get().textEdit;
    if (!te) return false;
    const ok = await this.edit({ op: 'text', path: te.path, i: te.i, text }, this.editFrom);
    if (ok && !this.dead) this.closeText();
    return ok;
  }

  closeText() {
    this.ui.set({ textEdit: null });
    this.focusView();
  }

  /** A kept session of this file: its edits put back (undo goes on where it was). */
  async restoreEdits() {
    this.setEdit({ restore: null });
    await this.edit({ op: 'restore' }, 'banner');
  }

  /** The kept session not wanted: dropped. */
  async discardRestore() {
    this.setEdit({ restore: null });
    await this.src.edits?.dropSession().catch((e: unknown) => this.failed(e));
  }

  /**
   * Saves the document (save-plan.ts says where). Into the opened file when huge mode has its handle (asking for
   * write permission first). Else, in Chromium, asked: the opened file overwritten (picked again with the open
   * picker, and checked to be it before anything is written), or a new file (the save picker, another name
   * suggested); else downloaded. `as`: always a new file (Save as). In place, the file is then the document: no
   * edits, no undo.
   */
  async save(as = false): Promise<boolean> {
    // (What's typed in the Format view goes first.)
    await this.fe?.flush();
    const ed = this.src.edits;
    const e = this.ui.get().edit;
    if (!ed || !e || this.dead || e.saving || e.saveAsk) return false;
    if (!as && !e.edited) {
      this.host.toast('No changes to save', 'info');
      return false;
    }
    if (!this.src.state().done) {
      this.host.toast('The file is still being read: it can be saved once it is', 'info');
      return false;
    }
    const name = this.meta.name;
    const plan = await planSave<FileSystemFileHandle>({
      as,
      name,
      handle: this.handle,
      ...pickers(),
      writable,
      ask: () => this.askSave(),
      pickExisting,
      pickSave: async (n) => (await pickSave(n)) ?? null,
      isOpened: (h) => this.isOpened(h),
      intact: () => this.intact(),
    });
    if (this.dead) return false;
    if ('stop' in plan) {
      const why = plan.stop;
      if (why === 'not_opened') this.host.toast(rt("That isn't {name} as it was opened: nothing was written. Pick {name} itself, or save as a new file", { name }), 'err', undefined, 10_000);
      else if (why === 'not_allowed') this.host.toast(rt('Writing to {name} wasn’t allowed: nothing was written', { name }), 'info');
      else if (why === 'changed') this.host.toast(rt('Nothing was written: {name} has changed since it was opened (picking it in the save window may have emptied it), and saving reads it as it was', { name }), 'err', undefined, 15_000);
      if (why !== 'cancel') track('huge_save', { how: why === 'changed' ? 'save_as' : 'in_place', outcome: why, size: hugeSize(this.src.state().docSize ?? this.src.size), ms: 0 });
      return false;
    }
    const { handle } = plan;
    const inPlace = plan.how === 'in_place';
    // (A Convert command or the Shape pass reads the opened file's bytes: saving over it waits for them.)
    if (inPlace && this.work?.busy) {
      this.host.toast('A command is reading this file: save once it ends (or stop it)', 'info');
      return false;
    }
    const how = plan.how;
    const began = performance.now();
    const size = this.src.state().docSize ?? this.src.size;
    this.setEdit({ saving: { written: 0, size }, ready: false });
    const run = ed.save(handle, inPlace, (written, total) => this.setEdit({ saving: { written, size: total } }));
    this.saving = run;
    const report = (outcome: Events['huge_save']['outcome']) => track('huge_save', { how, outcome, size: hugeSize(size), ms: Math.round(performance.now() - began) });
    try {
      const r = await run.done;
      if (this.dead) return true;
      report('done');
      if (how === 'download' && r.blob) this.host.saveBlob(r.blob, name);
      if (inPlace && handle) {
        // (The document reads the saved file now.)
        this.handle = handle;
        const f = await handle.getFile();
        this.file = { size: f.size, lastModified: f.lastModified };
        this.opened = f;
      }
      this.host.toast(inPlace ? rt('Saved {name}', { name }) : handle ? rt('Saved as {name}', { name: handle.name }) : rt('Downloading {name}', { name }), 'ok');
      return true;
    } catch (err) {
      if (this.dead) return false;
      const m = err instanceof Error ? err.message : '';
      report(m === 'Cancelled' ? 'stopped' : 'failed');
      if (m !== 'Cancelled' && m !== 'Save failed') reportError(err, 'huge');
      this.host.toast(rt(editError(err) ?? "Couldn't save the file"), m === 'Cancelled' ? 'info' : 'err');
      return false;
    } finally {
      this.saving = null;
      if (!this.dead) {
        this.setEdit({ saving: null });
        this.editState();
      }
    }
  }

  stopSave() {
    this.saving?.stop();
  }

  /** "Save changes to big.json": overwrite it, save a new file, or not. */
  private askSave(): Promise<SaveChoice> {
    this.answerSave('cancel');
    return new Promise((done) => {
      this.saveAnswer = done;
      this.setEdit({ saveAsk: true });
    });
  }

  /** The answer to "Save changes to big.json" (the dialog's buttons, Esc; closing says cancel). */
  answerSave(a: SaveChoice) {
    const done = this.saveAnswer;
    if (!done) return;
    this.saveAnswer = null;
    if (this.dead) return done('cancel');
    this.setEdit({ saveAsk: false });
    if (a === 'cancel') this.focusView();
    done(a);
  }

  /** Is `h` the opened file, as it was opened (or last saved): its name, size and last change? */
  private async isOpened(h: FileSystemFileHandle): Promise<boolean> {
    try {
      if (this.handle && !(await h.isSameEntry(this.handle))) return false;
      return sameFile(await h.getFile(), { name: this.meta.name, ...this.file });
    } catch {
      return false;
    }
  }

  /** The opened file still reads as it was (its handle's file the same, its first and last bytes there). */
  private async intact(): Promise<boolean> {
    if (this.handle) {
      try {
        const f = await this.handle.getFile();
        if (f.size !== this.file.size || f.lastModified !== this.file.lastModified) return false;
      } catch {
        return false;
      }
    }
    return readable(this.opened);
  }

  /** The close button: with unsaved edits, asks first. */
  askClose() {
    if (this.ui.get().edit?.edited) this.setEdit({ confirm: true });
    else this.close(true);
  }

  /** The answer to "close with unsaved edits": saved first, closed without them (dropped), or stay. */
  async answerClose(a: 'save' | 'discard' | 'cancel') {
    this.setEdit({ confirm: false });
    if (a === 'cancel') return this.focusView();
    if (a === 'save' && !(await this.save())) return;
    if (a === 'discard') await this.src.edits?.dropSession().catch(() => undefined);
    this.close(true);
  }

  /** Huge mode's Open file: the system's picker where there is one (its handle kept for Save), else the file input. */
  async openFile() {
    if (!(await pickFile((f) => void this.host.loadFile(f, 'file', false)))) this.host.openFile();
  }

  // ── Editing the Format view's text ─────────────────────────────────────

  /** The window being edited (components/huge/HugeFormatEdit.tsx), while it is. */
  private fe: FormatEditApi | null = null;
  private feSeq = 0;
  /** Something was typed since editing began: the other views read the document again when it ends. */
  private feTyped = false;
  private typedAt = 0;

  /** Edits the Format view's text (As written) at byte `at` (default: its current line, or the selection's). */
  formatEdit(at?: number) {
    if (!this.canEdit()) return;
    if (this.ui.get().view !== 'format') this.setView('format');
    if (this.ui.get().mode !== 'raw') this.setMode('raw');
    const pos = at ?? this.lines?.currentAt ?? this.sel?.node.at ?? 0;
    this.ui.set({ fe: { id: ++this.feSeq, at: Math.max(0, pos) }, feInfo: null });
  }

  /** Leaves the Format view's editing: what's typed goes first; the views read the document again. */
  async exitFormatEdit(focus = true) {
    const fe = this.fe;
    if (!this.ui.get().fe) return;
    await fe?.flush();
    const at = fe?.caretByte() ?? -1;
    this.ui.set({ fe: null, feInfo: null });
    if (this.dead) return;
    if (this.feTyped) {
      this.feTyped = false;
      await this.afterEdit({}, this.sel?.path ?? null);
    }
    if (at >= 0 && this.lines) {
      const k = await this.src.lineOf('raw', at);
      if (!this.dead && this.lines) this.lines.goto(k, at, true);
    }
    if (focus) this.focusView();
  }

  /** The window component's hooks (returns how to let go of them). */
  bindFormatEdit(api: FormatEditApi) {
    this.fe = api;
    return () => {
      if (this.fe === api) this.fe = null;
    };
  }

  /** A change typed in the window was taken in (the huge_edit event once per pause: the core joins typing so). */
  formatTyped() {
    const now = performance.now();
    this.feTyped = true;
    if (now - this.typedAt > TYPING_PAUSE) track('huge_edit', { op: 'type', from: 'format' });
    this.typedAt = now;
  }

  formatFailed(e: unknown) {
    const m = editError(e);
    if (m) this.host.toast(rt(m), 'info');
    else this.failed(e);
  }

  /** Where the window's caret is (the view bar shows it). */
  formatInfo(info: { line: number; col: number; first: number; last: number }) {
    this.ui.set({ feInfo: info });
  }

  pasteTooBig(n: number) {
    this.host.toast(rt('Paste up to {max} at a time here (this is {size}): insert a bigger value from the tree, as a value or as text', { max: rt.bytes(PASTE_MAX), size: rt.bytes(n) }), 'info', undefined, 8000);
  }

  /** Undo or redo while the window is edited: what's typed goes first, then the window is read again. */
  private async formatUndo(op: 'undo' | 'redo', from: EditFrom) {
    const fe = this.fe;
    const ed = this.src.edits;
    if (!fe || !ed) return;
    await fe.flush();
    const e = this.ui.get().edit;
    if (!(op === 'undo' ? e?.canUndo : e?.canRedo)) return void this.host.toast(op === 'undo' ? 'Nothing to undo' : 'Nothing to redo', 'info');
    try {
      await (op === 'undo' ? ed.undo() : ed.redo());
    } catch (err) {
      return this.formatFailed(err);
    }
    // (A typing after this starts a new step.)
    this.typedAt = 0;
    this.feTyped = true;
    track('huge_edit', { op, from });
    this.editState();
    await fe.reload();
  }

  // ── Keys ───────────────────────────────────────────────────────────────

  /** The open dialog's keys (edit as text: Ctrl+Enter, Ctrl+F): the engine sees keys first, then huge mode. */
  private dialogKey: ((e: KeyboardEvent) => boolean) | null = null;

  /** A dialog takes the keys it uses (true: taken); returns how to give them back. */
  takeKeys(f: (e: KeyboardEvent) => boolean) {
    this.dialogKey = f;
    return () => {
      if (this.dialogKey === f) this.dialogKey = null;
    };
  }

  private key(e: KeyboardEvent): boolean {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    // In huge mode's dialogs, the edit box and the menu: their own keys; the tool's commands (which would act on the
    // editor hidden behind) do nothing there; typing, Esc and the rest go on to them.
    // The Format view's editing window: undo and redo are the document's (the editor's own would undo its window).
    if ((e.target as HTMLElement | null)?.closest?.('.hg-fe') && mod && !e.altKey && (k === 'z' || (k === 'y' && !e.shiftKey))) {
      if (k === 'y' || e.shiftKey) this.redo('format');
      else this.undo('format');
      return true;
    }
    const inDialog = (e.target as HTMLElement | null)?.closest?.('.hg-modal, .hg-box, .hg-menu');
    if (inDialog) {
      if (this.dialogKey?.(e)) return true;
      return mod && !e.altKey && (e.key === 'Enter' || /^[fgkos]$/.test(k));
    }
    // Alt+digit: the views as numbered in the normal tool (Alt+4 is Graph), Shape seventh. On macOS not while typing (Option+digit types).
    const t = e.target as HTMLElement | null;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || !!t?.isContentEditable;
    if (e.altKey && !mod && !e.shiftKey && /^Digit[1-7]$/.test(e.code) && !(/Mac|iPhone|iPad/.test(navigator.platform) && typing)) {
      this.setView(HUGE_VIEWS[Number(e.code.slice(5)) - 1]);
      return true;
    }
    if (mod && !e.shiftKey && !e.altKey && k === 'g') {
      this.openAsk();
      return true;
    }
    // Saving the document (Shift: Save as); a source that can't edit saves the selected value, as before.
    if (mod && !e.altKey && k === 's') {
      if (this.editing) void this.save(e.shiftKey);
      else if (!e.shiftKey) void this.saveValue();
      return true;
    }
    if (this.editing && !typing && this.editKey(e, mod, k, t)) return true;
    // The editor's commands (Format input, Minify, Use output, Wrap): nothing to act on in huge mode.
    if ((mod && e.key === 'Enter') || (e.altKey && e.shiftKey && !mod && e.code === 'KeyF') || (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ')) {
      this.host.toast('Not available for files this large yet', 'info');
      return true;
    }
    return false;
  }

  /**
   * Editing's keys: undo and redo anywhere but in a text field; in the tree, table and graph: F2 edits the value
   * (Shift+F2: renames), Delete deletes, Ctrl+Enter inserts after (Shift: inside), Ctrl+D duplicates, Ctrl+E edits
   * as text, the menu key or Shift+F10 opens the edit menu.
   */
  private editKey(e: KeyboardEvent, mod: boolean, k: string, t: HTMLElement | null): boolean {
    if (mod && !e.altKey && (k === 'z' || (k === 'y' && !e.shiftKey))) {
      if (k === 'y' || e.shiftKey) this.redo('key');
      else this.undo('key');
      return true;
    }
    // The Format view: F2 or Enter edits its text there.
    if (t?.closest('#hg-format') && !mod && !e.altKey && !e.shiftKey && (e.key === 'F2' || e.key === 'Enter')) {
      this.formatEdit();
      return true;
    }
    if (!t?.closest('#hg-tree, #hg-table, #hg-graph') || e.altKey) return false;
    if (e.key === 'F2' && !mod && e.shiftKey) this.renameSel('key');
    else if (e.key === 'F2' && !mod) void this.editValue('key');
    else if (e.key === 'Delete' && !mod && !e.shiftKey) this.removeSel('key');
    else if (e.key === 'Enter' && mod) this.insertSel(e.shiftKey ? 'inside' : 'after', 'key');
    else if (k === 'd' && mod && !e.shiftKey) this.duplicateSel('key');
    else if (k === 'e' && mod && !e.shiftKey) void this.openText('key');
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !mod)) this.openMenu(null);
    else return false;
    return true;
  }

  /** Can the document be edited (the source can)? */
  get editable() {
    return !!this.editing;
  }

  /** A right click in the tree or table: selects the value under it. */
  pickUnder(t: HTMLElement) {
    if (t.closest('#hg-tree')) this.tree?.pickAt(t);
    else if (t.closest('#hg-table')) this.table?.pickAt(t);
  }

  /** A command from the palette (or the edit menu). */
  command(id: string, from: EditFrom = 'palette') {
    if (this.dead) return;
    switch (id) {
      case 'huge-undo':
        return this.undo(from);
      case 'huge-redo':
        return this.redo(from);
      case 'huge-save':
        return void this.save(false);
      case 'huge-save-as':
        return void this.save(true);
      case 'huge-edit':
        return void this.editValue(from);
      case 'huge-text':
        return void this.openText(from);
      case 'huge-rename':
        return this.renameSel(from);
      case 'huge-insert':
        return this.insertSel('after', from);
      case 'huge-insert-inside':
        return this.insertSel('inside', from);
      case 'huge-duplicate':
        return this.duplicateSel(from);
      case 'huge-delete':
        return this.removeSel(from);
    }
  }

  /** The edit menu: at (x, y), or (null) under the selected row. */
  openMenu(at: { x: number; y: number } | null) {
    if (!this.editing) return;
    const a = at ?? this.anchor('value') ?? { x: 0, y: 0 };
    this.ui.set({ menu: { x: a.x, y: 'w' in a ? a.y + 26 : a.y, keyboard: !at } });
  }

  closeMenu(focus = true) {
    this.ui.set({ menu: null });
    if (focus) this.focusView();
  }

  /** What the status bar and the UI read now (tests). */
  snapshot(): HugeUI {
    return this.ui.get();
  }
}

