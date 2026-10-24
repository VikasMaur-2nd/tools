import { ARR, JNode, MAX_WALK_DEPTH, OBJ, STR, parse, parser, tooDeep, type ParseResult, type Parser } from '../json/parser';
import { byteLength, copyText, formatBytes, formatDoc, minifiedBytesIn, reindent, reindenter, stringify, tooLarge } from '../json/format';
import { formatPath, nodeAt, pathOf, resolve, type Seg } from '../json/path';
import { packedPosition, unpacker, type PackedTree } from '../json/pack';
import { applyCodeChange, type CodeChange, type CodeIndex } from '../json/code-index';
import type { DocumentMetrics } from '../json/metrics';
import { Editor, loadSurface, type ChangeKind, type Diagnostic } from './editor';
import { TreeView } from './tree';
import { TableView } from './table';
import type { GraphExport, GraphViewApi } from '../graph/types';
import { CodeView } from './codeview';
import { escapeHtml, highlightLine } from './highlight';
import type { FindResult, LineHighlighter } from './codeview';
import { targetInfo } from './targets';
import { DEFAULT_SETTINGS, store, type ContextMenu, type DiffMenu, type Hint, type IndentId, type MenuArea, type Settings, type Sizes, type Status, type EnginePreset, type Theme, type View } from './store';
import { readJwt, type JwtInput } from '../json/jwt';
import { rt } from '../i18n/ui';
import { idle, soon } from './idle';
import { Doc } from './doc';
import { jsonLines, persistenceAfterChange, persistenceAfterLoad } from './rules';
import { PRIVATE, reportError, track } from '../analytics';
import { noteLoad, watchPastes } from '../analytics/load';
import { getDiffMenu, getEngine } from './instance';
import type { InputSource } from '../analytics/events';
import { snippet, type SnippetFormat } from '../badge';
import { HANDOFF_VERSION, LinkTooLarge, MAX_DOCUMENT, PASTED_LINK, decodeDoc, linkReach, linkHash, parseLink, readHandoff, type HandoffReply, type LinkDoc, type LinkRequest } from '../link';

const KEYS = { doc: 'jf:doc', file: 'jf:file', settings: 'jf:settings', theme: 'jf:theme', cmp: 'jf:cmp' };
const INDENTS: Record<IndentId, string> = { '2': '  ', '4': '    ', tab: '\t' };
const MAX_PERSIST = 2_500_000;
const THEME_COLORS = { light: '#ffffff', dark: '#000000' };

export interface EngineEls {
  editor: HTMLElement;
  tree: HTMLElement;
  table: HTMLElement;
  graph: HTMLElement;
  file: HTMLInputElement;
  code: HTMLElement;
  fmt: HTMLElement;
  /** Compare: the second (modified) document's editor. */
  editor2: HTMLElement;
  /** Compare's differences panel (components/CompareView.tsx draws into it). */
  compare: HTMLElement;
}

export type { EnginePreset } from './store';

export interface EngineOptions {
  /** A landing page: skip restoring the saved document and keep the page's sample out of home-page storage. */
  preserveDocument?: boolean;
}

/** JSON highlighter for soft-wrapped rows (a row may start inside a string). */
const jsonRow: LineHighlighter = (t, inStr, esc) => {
  if (!inStr) return highlightLine(t, 0, t.length, null);
  let i = esc ? 1 : 0;
  for (; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 92) i++;
    else if (c === 34) {
      i++;
      break;
    }
  }
  i = Math.min(i, t.length);
  return `<span class="ts">${escapeHtml(t.slice(0, i))}</span>` + highlightLine(t, i, t.length, null);
};

type ConvertModule = typeof import('../convert');

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Over quota: never leave an older document behind to be "restored" later.
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  }
};

function loadSettings(): Settings {
  try {
    const s = JSON.parse(read(KEYS.settings) ?? '{}') as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS, ...s };
    out.split = Math.min(0.8, Math.max(0.2, Number(out.split) || 0.5));
    out.splitCmp = Math.min(0.85, Math.max(0.4, Number(out.splitCmp) || 0.66));
    if (!['2', '4', 'tab'].includes(out.indent)) out.indent = '2';
    if (!['system', 'light', 'dark'].includes(out.theme)) out.theme = 'system';
    if (!['format', 'tree', 'table', 'graph', 'convert', 'compare'].includes(out.view)) out.view = 'format';
    if (!['format', 'tree', 'table', 'graph', 'convert'].includes(out.prevView)) out.prevView = 'format';
    out.minify = !!out.minify;
    out.sortKeys = !!out.sortKeys;
    out.wrap = out.wrap !== false;
    // String output is a one-off conversion, not a preference: a new visit shows the document itself.
    out.escape = false;
    if (out.tsStyle !== 'type') out.tsStyle = 'interface';
    if (out.csharpLib !== 'newtonsoft') out.csharpLib = 'stj';
    out.rootName = String(out.rootName || 'Root').slice(0, 60);
    return out;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Bytes pretty-printing adds over minified output: per non-empty container a
 * newline + indent before each child and before the closer, and a space after
 * every object key's colon (all ASCII). Works in steps: undefined until done
 * (a big tree is walked between input events).
 */
function prettyExtraIn(root: JNode, unit: number): (until: number) => number | undefined {
  if (root.t < ARR) return () => 0;
  let extra = 0;
  const stack: JNode[] = [root];
  return (until) => {
    for (let i = 1; stack.length; i++) {
      const n = stack.pop() as JNode;
      const list = n.v as JNode[];
      const k = list.length;
      if (k) {
        extra += k * (1 + (n.d + 1) * unit) + 1 + n.d * unit + (n.t === OBJ ? k : 0);
        for (const c of list) if (c.t >= ARR) stack.push(c);
      }
      if ((i & 1023) === 0 && stack.length && performance.now() >= until) return undefined;
    }
    return extra;
  };
}

/** Opened JSON Lines files: even one record reads as a list of records. */
const LINES_FILE = /\.(jsonl|ndjson)$/i;
/** From this size, a load in the Format view draws its output before the editor (see `load`). */
const OUTPUT_FIRST = 200_000;
/** From this size, that output is re-indented in a worker. */
const WORKER_MIN = 2_000_000;
/** From this size, a new document is parsed here in steps (see analyzeInSteps). */
const STEPS_MIN = 1_000_000;
/** The first step's length in ms. It runs at once, as a parse in one go did: a document parsed by then is ready as soon. */
const FIRST_STEP = 100;
/** The next steps' length in ms: input waits at most about this long. (10 to 50 ms are ready about as soon.) */
const STEP = 20;
/**
 * A big load (from STEPS_MIN) shows "Parsing… N%" from its start to its result (see progress). In the
 * Format view its steps take these shares of it, as measured on 70 MB in Chromium, Firefox and Safari:
 * the text goes to the formatting worker (to FORMAT_SENT), which makes the output (FORMAT_MADE), the page
 * receives and draws it (FORMATTED), the editor takes the text once that has painted (EDITOR), then the
 * analysis worker gets it (ANALYSIS_SENT of the rest) and parses it (the rest, see queueAnalysis).
 */
const FORMAT_SENT = 0.05;
const FORMAT_MADE = 0.32;
const FORMATTED = 0.37;
const EDITOR = 0.5;
const ANALYSIS_SENT = 0.1;

/** JWT-shaped, for a clearer error when a part doesn't decode. */
const JWT_RE = /^(?:[Bb]earer\s+)?eyJ[^\s.]*\.[^\s.]+\.[^\s.]*$/;

/** Cheap guess at what non-JSON input is, to offer a one-click conversion. */
function sniff(text: string): Hint {
  const t = text.slice(0, 4000).trim();
  if (t.includes('\\"') && /^"?\s*[[{]/.test(t)) return 'unescape';
  if (t[0] === '<') return 'xml';
  if (t[0] === '{' || t[0] === '[') {
    // `[table]` headers followed by key = value lines → TOML
    return /^\[[\w.\s"'-]+\]\s*$/m.test(t) && /^\s*[\w."'-]+\s*=\s*\S/m.test(t) ? 'toml' : null;
  }
  const head = t.slice(0, 4000);
  if (/^\s*[\w."'-]+\s*=\s*\S/m.test(head) && !/^\s*[\w."'-]+\s*:\s/m.test(head)) return 'toml';
  if (/^(---|- |[\w"'][^\n:]*:(\s|$))/m.test(head)) return 'yaml';
  const lines = head.split('\n', 3);
  if (lines.length > 1) {
    for (const d of [',', '\t', ';', '|']) {
      const n = lines[0].split(d).length;
      if (n > 1 && lines[1].split(d).length === n) return 'csv';
    }
  }
  return null;
}

/**
 * The service worker is registered once per page (a client navigation mounts the tool again, with a new
 * engine), and its news of a new version goes to the tool open then, or to the next one (see registerSW).
 */
let swStarted = false;
let updateWaiting = false;

export class Engine {
  readonly ed: Editor;
  /** Compare: the modified document. */
  readonly ed2: Editor;
  private cmpTimer = 0;
  /** Which editor the file picker loads into. */
  private fileTarget: 1 | 2 = 1;
  readonly tree: TreeView;
  readonly table: TableView;
  private graph: GraphViewApi | null = null;
  private graphLoad: Promise<void> | null = null;
  private graphRoot: { root: JNode | null; reset: boolean; nodes: number } = { root: null, reset: true, nodes: 0 };
  private themeMedia: MediaQueryList;
  readonly code: CodeView;
  readonly fmt: CodeView;
  private els: EngineEls;
  private fmtTimer = 0;
  private expTimer = 0;
  /** Text that `good` was parsed from (needed by the native formatting fast path). */
  private goodText = '';
  private goodVer: object | null = null;
  private conv: ConvertModule | null = null;
  private convTimer = 0;

  /** Result for `parsed`. */
  private res: ParseResult | null = null;
  private parsed = '';
  /** The editor version `parsed` came from (see synced). */
  private parsedVer: object | null = null;
  /** Last result with a usable tree (shown dimmed while the text is broken). */
  private good: ParseResult | null = null;
  /** The input is a JWT: `res` and the views describe its decoded document. */
  private jwt: JwtInput | null = null;
  private sel: JNode | null = null;
  private selPath: Seg[] | null = null;
  private tablePath: Seg[] = [];
  private resetNext = true;
  private timer = 0;
  private persistTimer = 0;
  private toastTimer = 0;
  private toastId = 0;
  private dragDepth = 0;
  private settings: Settings;
  /** Settings as stored; differs from `settings` while a landing page's preset is shown. */
  private saved: Settings;
  private presetting = false;
  private persistEnabled: boolean;
  /** Current find query (applies to the open view). */
  private query = '';
  private dead = false;

  constructor(els: EngineEls, options: EngineOptions = {}) {
    this.els = els;
    this.persistEnabled = !options.preserveDocument;
    this.settings = this.saved = loadSettings();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    store.set({ settings: this.settings, mac });
    this.themeMedia = matchMedia('(prefers-color-scheme: dark)');
    this.themeMedia.addEventListener('change', this.onSystemTheme);
    this.applyTheme(this.settings.theme);

    this.ed = new Editor(els.editor, {
      change: this.onChange,
      caret: this.onCaret,
      nav: this.onNav,
      escape: () => this.leaveEditor(),
      copyAll: () => void this.copyAll(),
      flush: this.flushLoad,
      // A big document pasted over everything opens like a file: output first, then the editor.
      fullPaste: (text) => {
        if (this.settings.autoFormat || text.length < OUTPUT_FIRST || this.settings.view !== 'format') return false;
        this.refocus = true;
        this.load(text, null, true, true);
        return true;
      },
    });
    this.ed.indentUnit = INDENTS[this.settings.indent];
    this.ed2 = new Editor(els.editor2, {
      change: this.onCompareChange,
      caret: () => undefined,
      nav: () => undefined,
      escape: () => document.querySelector<HTMLElement>('.pane-view [role="tab"][aria-selected="true"]')?.focus(),
      copyAll: () => void this.copy(this.ed2.text, 'Copied the modified document'),
    });
    this.ed2.indentUnit = INDENTS[this.settings.indent];
    if (!this.ed2.text) {
      const savedCmp = read(KEYS.cmp);
      if (savedCmp) this.ed2.init(savedCmp);
    }
    this.tree = new TreeView(els.tree, {
      select: (n, how) => this.selectFromView(n, how === 'search' ? 'search' : 'tree'),
      copy: (n, what) => (what === 'path' ? this.copyPath(n) : this.copyValue(n)),
      open: (n) => this.openInEditor(n),
      escape: () => this.focusEditor(),
      nested: (n) => void this.expandNested(n),
    });
    this.table = new TableView(els.table, {
      select: (n) => this.selectFromView(n, 'table'),
      drill: (n) => this.tableShow(n),
    });
    this.code = new CodeView(els.code);
    this.fmt = new CodeView(els.fmt);
    this.fmt.onReady = () => {
      this.fmtWorkerId = this.pendingFmtWorkerId;
      this.fmtWorkerText = this.fmt.text;
      if (this.fmtWorkerId) this.worker?.postMessage({ id: this.fmtWorkerId, prepare: true });
      if (this.markOutput) {
        this.markOutput = false;
        requestAnimationFrame(() => performance.mark('tk:formatted'));
      }
      if (this.settings.view === 'format' && this.goodVer !== null && this.goodVer === this.fmtSrcVer) this.runFormat();
    };
    for (const [view, code] of [['format', this.fmt], ['convert', this.code]] as const) code.onFind = (result) => {
      if (this.settings.view === view && this.query) store.set({ find: { ...store.get().find, ...result } });
    };
    this.applyWrap();

    // Restore: text typed/restored before hydration wins, then saved doc. A landing
    // page replaces it with its own sample at once, so it isn't parsed there.
    if (!this.ed.text && !options.preserveDocument) {
      const saved = read(KEYS.doc);
      if (saved) this.ed.init(saved);
    }
    store.set({ fileName: read(KEYS.file) });
    this.analyzeInSteps();
    if (this.settings.view === 'graph') this.setView('graph');
    if (this.ed2.text) this.analyzeCompare();
    delete document.documentElement.dataset.doc;

    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointerdown', this.onPress, { capture: true, passive: true });
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('dragenter', this.onDragEnter);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('drop', this.onDrop);
    window.addEventListener('pagehide', this.persistNow);
    window.addEventListener('hashchange', this.openLink);
    this.ed.el.addEventListener('copy', this.onCopy);
    this.ed2.el.addEventListener('copy', this.onCopy2);
    els.file.addEventListener('change', this.onFile);

    store.set({ ready: true });
    watchPastes();
    void this.openLink();
    this.handleLaunch();
    if (!matchMedia('(pointer: coarse)').matches || !this.ed.text) this.ed.focus();
    this.registerSW();
    this.warmUp();
    // Warm the optional example after the editor can respond to input.
    idle(() => { if (!this.dead) void import('./sample').catch(() => {}); });
  }

  destroy() {
    this.worker?.terminate();
    this.analysisWorker?.terminate();
    clearTimeout(this.analysisTimer);
    this.dead = true;
    // Whatever is still on its way drops itself (each step checks its sequence), and nothing more starts.
    this.loadSeq++;
    this.sizeSeq++;
    this.fmtStatSeq++;
    this.convSeq++;
    this.viewSeq++;
    clearTimeout(this.sizeTimer);
    this.requests[1]?.abort();
    this.requests[2]?.abort();
    window.removeEventListener('load', this.warmSoon);
    clearTimeout(this.warmTimer);
    if (this.persistIdle) cancelIdleCallback(this.persistIdle);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointerdown', this.onPress, true);
    window.removeEventListener('contextmenu', this.onContextMenu);
    // What this tool showed for itself closes with it (a client navigation mounts another). A notice with
    // an action stays until dismissed: the next tool shows it (its timer, a plain one's, is cleared below).
    const { toast, find } = store.get();
    store.set({
      menu: null, palette: false, shortcuts: false, graphExport: false, dragging: false,
      find: { open: false, q: '', total: 0, index: -1, seq: find.seq + 1 },
      ...(toast && !toast.action && { toast: null }),
    });
    window.removeEventListener('dragenter', this.onDragEnter);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('dragleave', this.onDragLeave);
    window.removeEventListener('drop', this.onDrop);
    window.removeEventListener('pagehide', this.persistNow);
    window.removeEventListener('hashchange', this.openLink);
    this.handoffEnd?.();
    this.ed.el.removeEventListener('copy', this.onCopy);
    this.ed2.el.removeEventListener('copy', this.onCopy2);
    clearTimeout(this.cmpTimer);
    this.ed2.destroy();
    this.els.file.removeEventListener('change', this.onFile);
    clearTimeout(this.timer);
    clearTimeout(this.persistTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.convTimer);
    clearTimeout(this.fmtTimer);
    clearTimeout(this.expTimer);
    this.persistNow();
    this.ed.destroy();
    this.themeMedia.removeEventListener('change', this.onSystemTheme);
    this.graph?.destroy();
    this.tree.destroy();
    this.table.destroy();
    this.code.destroy();
    this.fmt.destroy();
  }

  get indent() {
    return INDENTS[this.settings.indent];
  }

  // ── Pipeline ───────────────────────────────────────────────────────────

  private onChange = (kind: ChangeKind) => {
    if (this.dead) return;
    this.loadSeq++; // Invalidate queued worker replies and unpacking as soon as typing resumes.
    this.progressStatus = null; // (and a big load's progress: what follows says nothing of it)
    this.workerParse = null;
    this.reindentJob = null;
    this.worker?.postMessage({ id: this.loadSeq, cancel: true });
    this.analysisWorker?.postMessage({ id: this.loadSeq, cancel: true });
    clearTimeout(this.analysisTimer);
    this.measuredSizes = null;
    this.fmtStatSeq++;
    this.persistEnabled = persistenceAfterChange(this.persistEnabled, kind);
    if (kind === 'paste' && this.ed.pasteFull) {
      this.resetNext = true;
      if (store.get().fileName) {
        store.set({ fileName: null });
        write(KEYS.file, null);
      }
      if (this.settings.autoFormat) setTimeout(this.autoFormat, 0);
    }
    this.ed.setBrackets(-1, -1);
    clearTimeout(this.fmtTimer);
    clearTimeout(this.convTimer);
    clearTimeout(this.sizeTimer);
    this.sizeSeq++;
    // (Per key: length and blank don't build a big document's text, see Editor.text.)
    const len = this.ed.length;
    if (this.ed.blank || kind === 'paste' && this.ed.pasteFull || len < WORKER_MIN && (this.workerDoc?.length ?? 0) >= WORKER_MIN) this.releaseWorkerDocuments();
    if (kind === 'paste' && this.ed.pasteFull && !this.ed.blank) {
      // A whole document arrived at once: no typing to wait out.
      const text = this.ed.text;
      const now = () => {
        this.loaded = true;
        this.analyzeInSteps();
      };
      if (!this.outputFirst(text, null, now)) {
        this.loadSeq++;
        clearTimeout(this.timer);
        this.timer = window.setTimeout(now, 0);
      }
    } else if (this.ed.blank) {
      this.analyze();
    } else {
      if (len > 1_000_000) store.set({ status: { kind: 'parsing' } });
      clearTimeout(this.timer);
      this.timer = window.setTimeout(this.analyzeTyped, len < 100_000 ? 60 : len < 250_000 ? 160 : len < WORKER_MIN ? 500 : 200);
    }
    if (this.persistEnabled) this.persistSoon();
  };

  /** Pretty-prints compact JSON right after it is pasted (one undo step reverts it). */
  private autoFormat = () => {
    if (this.dead) return;
    const ed = this.ed;
    const text = ed.text;
    const lines = ed.ls.length;
    if (lines > 3 && text.length / lines < 160) return;
    // Parse without building views for the minified text: they'd be replaced at once.
    const r = text === this.parsed && this.res ? this.res : parse(text);
    if (!r.root || r.error || r.issues.length) return;
    const pretty = this.unlessTooLarge(() => formatDoc(text, r, this.indent));
    if (pretty === null || pretty === text) return;
    clearTimeout(this.timer);
    ed.setValue(pretty);
    this.analyze();
    this.toast(`Auto-formatted · ${this.mod}Z to undo`, 'info');
  };

  private packed: { id: number; tree: PackedTree; text: string; metrics?: DocumentMetrics; document?: Doc } | null = null;
  private goodPacked: Engine['packed'] = null;

  private materializeGood() {
    if (!this.goodPacked) return;
    const { tree, text } = this.goodPacked;
    const res = unpacker(tree, text)(Infinity)!;
    if (this.packed?.id === this.loadSeq && this.packed.text === text) {
      this.analyze(res, this.goodMetrics ?? undefined);
      return;
    }
    this.good = res;
    this.goodPacked = null;
    this.tree.setRoot(this.good.root, false, this.good.nodes, false);
    this.setGraphRoot(this.good.root, false, this.good.nodes);
    this.sel = this.selPath ? resolve(this.good.root, this.selPath) : null;
    this.tree.select(this.sel, { scroll: false });
  }

  /** Commands that need nodes materialize a deferred Format-view tree on demand. */
  private fresh(): ParseResult | null {
    // (A document still on its way arrives first: commands act on what is shown.)
    this.flushLoad();
    // A parse in steps is finished now, from where it got to.
    const steps = this.steps;
    if (steps?.seq === this.loadSeq && steps.ver === this.ed.version) {
      this.steps = null;
      this.analyze(steps.p.step(Infinity));
    }
    if (this.packed?.id === this.loadSeq) {
      const { tree, text, metrics } = this.packed;
      this.viewSeq++;
      this.packed = null;
      this.analyze(unpacker(tree, text)(Infinity), metrics);
    }
    if (this.ed.text !== this.parsed || (!this.res && this.ed.text.trim())) {
      clearTimeout(this.timer);
      this.analyze();
    }
    return this.res;
  }

  /**
   * After typing: a big document's output is re-indented in the worker and
   * drawn first, its analysis follows when the page is idle (see outputFirst),
   * so neither blocks the keys.
   */
  private analyzeTyped = () => {
    const ver = this.ed.version;
    const text = this.ed.length >= WORKER_MIN ? ver as Doc : this.ed.text;
    if (!this.outputFirst(text, store.get().fileName, (res, metrics) => this.ed.version === ver && this.analyze(res, metrics), true)) this.analyze();
  };

  /** A new document being parsed in steps (see analyzeInSteps). */
  private steps: { p: Parser; seq: number; ver: object } | null = null;

  /**
   * Analyses a new document. A big one is parsed here in steps, the first at once (one it finishes is ready
   * as soon as in one go): input is handled between them, the status shows how far it got, and an edit or
   * another load drops it (fresh() finishes it for a command). Until it is done the views show nothing of
   * the previous document.
   */
  private analyzeInSteps() {
    const text = this.ed.length >= STEPS_MIN && this.resetNext ? this.ed.text : '';
    if (!text || readJwt(text, this.indent)) return this.analyze();
    const seq = this.loadSeq;
    const ver = this.ed.version;
    const p = parser(text, { lines: LINES_FILE.test(store.get().fileName ?? '') });
    this.steps = { p, seq, ver };
    // (Putting the text in the editor scheduled a typed analysis, which analyze() would cancel.)
    clearTimeout(this.timer);
    this.packed = this.goodPacked = null;
    this.res = this.good = null;
    this.goodMetrics = null;
    this.goodText = '';
    this.goodVer = null;
    this.sel = null;
    this.selPath = null;
    this.tablePath = [];
    this.tree.setRoot(null, true);
    this.setGraphRoot(null, true);
    this.table.setNode(null);
    this.ed.setDiagnostics([]);
    this.ed.setScope(-1, -1);
    // (The load this parse is part of goes on from where it got to.)
    const from = Math.max(0, this.progressShown());
    store.set({ empty: false, stale: false, status: (this.progressStatus = { kind: 'parsing', progress: from }), stats: null, sizes: null, path: null, hint: null });
    const show = this.span(from, 1);
    let shownAt = 0;
    let res: ParseResult | undefined;
    let ms = 0;
    // Then its size in UTF-8 bytes for the status bar, counted in steps too (in one go: 200 ms at 50 MB).
    let bytes = 0;
    let at = 0;
    const run = () => {
      if (this.steps?.p !== p) return;
      if (seq !== this.loadSeq || this.dead) {
        this.steps = null;
        return;
      }
      const t0 = performance.now();
      const until = t0 + (ms ? STEP : FIRST_STEP);
      if (!res) {
        res = p.step(until);
        ms += performance.now() - t0;
      }
      if (res) {
        while (at < text.length && performance.now() < until) {
          let end = Math.min(text.length, at + 1_000_000);
          // (A surrogate pair is counted whole. Ranges of the text, not slices: reading those is slower.)
          if ((text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end++;
          bytes += byteLength(text, at, end);
          at = end;
        }
        if (at >= text.length) {
          this.steps = null;
          this.counted = { ver, bytes, ms };
          this.analyze(res);
          return;
        }
      } else if (t0 >= shownAt + 150) {
        // (A few redraws of the status bar a second, as the whole percent grows; JSON Lines go over their first record twice.)
        show(p.at() / text.length);
        shownAt = t0;
      }
      soon(run);
    };
    run();
  }

  /** The status a big load shows, "Parsing… N%" (see startProgress). Any other status ends it. */
  private progressStatus: Status | null = null;

  /** A big document starts loading: from now to its result, the status bar shows it working. */
  private startProgress() {
    store.set({ status: (this.progressStatus = { kind: 'parsing', progress: 0 }) });
  }

  /** How far the big load shown got (0 to 1), or -1 if none is (another status replaced it). */
  private progressShown(): number {
    const s = store.get().status;
    return s === this.progressStatus && s.kind === 'parsing' ? s.progress ?? 0 : -1;
  }

  /** Moves the big load shown on to `p` (0 to 1 of it): forward only, by whole percents, short of 100. */
  private progress(p: number) {
    const shown = this.progressShown();
    const next = Math.floor(100 * Math.min(0.99, p) + 1e-9) / 100;
    if (shown >= 0 && next > shown) store.set({ status: (this.progressStatus = { kind: 'parsing', progress: next }) });
  }

  /** `progress` for a step of a load that goes from `from` to `to` of it: `f` (0 to 1) of the step done. */
  private span(from: number, to: number) {
    return (f: number) => this.progress(from + (to - from) * f);
  }

  /** A document version parsed in steps: its UTF-8 size, counted meanwhile, and the time its steps took. */
  private counted: { ver: object; bytes: number; ms: number } | null = null;

  private goodMetrics: DocumentMetrics | null = null;

  /** Publish analysis; a Format-only result can retain its packed tree until needed. */
  analyze(parsed?: ParseResult, metrics?: DocumentMetrics, lazy = false) {
    if (!lazy) this.packed = null;
    this.steps = null;
    clearTimeout(this.timer);
    const ed = this.ed;
    const text = ed.text;
    const reset = this.resetNext;
    this.resetNext = false;
    this.parsed = text;
    this.parsedVer = ed.version;

    if (ed.blank) {
      this.releaseWorkerDocuments();
      this.fmtWorkerId = this.pendingFmtWorkerId = 0;
      this.res = null;
      this.good = null;
      this.goodPacked = null;
      this.goodMetrics = null;
      this.jwt = null;
      ed.setJwt(null);
      this.goodText = '';
      this.goodVer = null;
      this.sel = null;
      this.selPath = null;
      this.tablePath = [];
      this.tree.setRoot(null, true);
      this.setGraphRoot(null, true);
      this.table.setNode(null);
      ed.setDiagnostics([]);
      ed.setScope(-1, -1);
      store.set({ empty: true, stale: false, status: { kind: 'empty' }, stats: null, sizes: null, path: null, hint: null });
      this.measure(null, '');
      this.syncTableState();
      this.afterDoc();
      return;
    }

    const t0 = performance.now();
    const jwt = readJwt(text, this.indent);
    const src = jwt ? jwt.json : text;
    const res = parsed ?? parse(src, { lines: !jwt && LINES_FILE.test(store.get().fileName ?? '') });
    const lines = !jwt && (metrics?.records !== undefined || jsonLines(text, res));
    // (Used once: it holds that version's text.)
    const counted = this.counted?.ver === ed.version ? this.counted : null;
    this.counted = null;
    const ms = counted?.ms ?? performance.now() - t0;
    this.res = res;
    this.jwt = jwt;
    ed.setJwt(jwt ? jwt.at : null);
    if (reset) {
      this.sel = null;
      this.selPath = null;
      this.tablePath = [];
      if (this.query) this.closeFind();
    }

    if (lazy) {
      this.goodMetrics = metrics ?? null;
      this.goodPacked = this.packed;
      this.good = null;
      this.sel = null;
      this.selPath = packedPosition(this.packed!.tree, ed.caret, this.packed!.document ?? text)?.path ?? null;
      this.tree.releaseRoot();
      this.setGraphRoot(null, true);
      // Format already has the worker's output. Nodes are needed only by commands and other views.
      this.goodText = src;
      this.goodVer = ed.version;
      ed.setScope(-1, -1);
    } else if (res.root) {
      this.goodMetrics = metrics ?? null;
      this.goodPacked = null;
      this.good = res;
      this.goodText = src;
      this.goodVer = ed.version;
      this.tree.setRoot(res.root, reset, res.nodes, this.settings.view === 'tree');
      this.setGraphRoot(res.root, reset, res.nodes);
      this.sel = this.selPath ? resolve(res.root, this.selPath) : null;
      this.tree.select(this.sel, { scroll: false });
      if (this.settings.view === 'graph') this.graph?.select(this.sel);
      if (this.settings.view === 'table') {
        this.table.setNode(resolve(res.root, this.tablePath) ?? res.root, true);
      } else this.table.setNode(null);
      ed.setScope(this.sel && this.sel.t >= ARR ? this.sel.s : -1, this.sel ? this.sel.e : -1);
    } else if (reset || !this.good && !this.goodPacked) {
      if (reset) this.fmtWorkerId = this.pendingFmtWorkerId = 0;
      this.good = null;
      this.goodPacked = null;
      this.goodMetrics = null;
      this.goodText = '';
      this.goodVer = null;
      this.tree.setRoot(null, true);
      this.setGraphRoot(null, true);
      this.table.setNode(null);
      ed.setScope(-1, -1);
    }

    // Diagnostics → editor squiggles (a decoded JWT's positions aren't in the editor).
    const diags: Diagnostic[] = [];
    if (!jwt) {
      for (let i = 0; i < res.issues.length && i < 300 && !lines; i++) diags.push({ p: res.issues[i].p, cls: 'me' });
      if (res.error) diags.push({ p: res.error.p, cls: 'me' });
      for (let i = 0; i < res.warnings.length && i < 300; i++) diags.push({ p: res.warnings[i].p, cls: 'mw' });
    }
    ed.setDiagnostics(diags);

    let hint: Hint = null;
    if (jwt || lines) hint = null;
    else if (metrics?.unescape || res.root?.t === STR && /^\s*[[{]/.test(res.root.v as string)) hint = 'unescape';
    else if (res.error || res.issues.length) hint = sniff(text.length >= WORKER_MIN ? (ed.version as Doc).slice(0, 4000) : text);

    store.set({
      empty: false,
      stale: !lazy && !res.root && !!(this.good || this.goodPacked),
      status: jwt ? this.jwtStatus(jwt) : lines ? this.linesStatus(res, metrics?.records) : text.length <= 1_000_000 && JWT_RE.test(text.trim()) ? { kind: 'error', msg: "This looks like a JWT, but a part isn't valid base64url JSON", p: 0, ...this.ed.lineCol(0) } : this.statusOf(res),
      stats: { bytes: metrics?.bytes ?? counted?.bytes ?? byteLength(text), lines: ed.ls.length, nodes: res.nodes, depth: res.depth, ms },
      path: lazy && this.selPath ? formatPath(this.selPath) : this.sel ? formatPath(pathOf(this.sel)) : null,
      hint,
    });
    // The tree may have been hidden (empty state) while it was rebuilt; draw it once shown.
    if (this.settings.view === 'tree') requestAnimationFrame(() => { if (!this.dead) this.tree.render(true); });
    // Format/convert re-run their find when their text updates; the tree and table do it here.
    if (this.query && (this.settings.view === 'tree' || this.settings.view === 'table' || this.settings.view === 'graph')) this.refind(false);
    this.syncTableState();
    this.updateBrackets();
    if (metrics && (res.root || lazy && this.packed!.tree.nodes.length) && !jwt) store.set({ sizes: this.measuredSizes?.id === this.loadSeq ? this.measuredSizes.sizes : { min: metrics.min, stale: false } });
    else this.measure(res.root && !jwt ? res : null, text);
    this.afterDoc();
  }

  /** Valid JSON Lines: the wrapping into an array is how they're viewed, not an issue. */
  private linesStatus(res: ParseResult, records?: number): Status {
    const w = res.warnings[0];
    const jsonl = records ?? (res.root!.v as JNode[]).length;
    return w ? { kind: 'valid', warnings: res.warnings.length, msg: w.m, p: w.p, ...this.ed.lineCol(w.p), jsonl } : { kind: 'valid', warnings: 0, jsonl };
  }

  /** A decoded JWT (signature not verified); the UI shows its expiry live. */
  private jwtStatus({ alg, exp, iat, nbf }: JwtInput): Status {
    return { kind: 'valid', warnings: 0, jwt: { alg, exp, iat, nbf } };
  }

  private sizeTimer = 0;
  private sizeSeq = 0;

  /**
   * Minified and compressed sizes of the document, measured after typing
   * settles (one minify + native compression per codec, never on the
   * keystroke). Invalid documents have none.
   */
  /**
   * The minified document for `measure`: a big strict one in short steps (in one go it would block the
   * page for seconds), with the same text formatDoc makes. null if superseded.
   */
  /** Strict `text`'s minified size, counted in short steps; null if superseded or not strict. */
  private minifiedSize(text: string, seq: number): Promise<number | null> {
    const run = minifiedBytesIn(text);
    return new Promise((done) => {
      const step = () => {
        if (seq !== this.sizeSeq) return done(null);
        const n = run(performance.now() + 8);
        if (n === undefined) soon(step);
        else done(n);
      };
      step();
    });
  }

  private minified(text: string, res: ParseResult, seq: number): Promise<string | null> {
    if (text.length < 1_000_000 || res.error || res.issues.length || res.multi) return Promise.resolve(formatDoc(text, res, ''));
    const run = reindenter(text, '');
    return new Promise((done) => {
      const step = () => {
        if (seq !== this.sizeSeq) return done(null);
        const out = run(performance.now() + 8);
        if (out === undefined) soon(step);
        else done(out ?? formatDoc(text, res, ''));
      };
      step();
    });
  }

  private measure(res: ParseResult | null, text: string) {
    clearTimeout(this.sizeTimer);
    const seq = ++this.sizeSeq;
    const prev = store.get().sizes;
    if (!res) {
      if (prev) store.set({ sizes: null });
      return;
    }
    if (prev && !prev.stale) store.set({ sizes: { ...prev, stale: true } });
    this.sizeTimer = window.setTimeout(
      () => idle(async () => {
        if (seq !== this.sizeSeq) return;
        // Beyond 32 MB nothing is compressed: a strict document that big has its size counted in steps,
        // and the minified copy (decoded at once, a long task) isn't made at all.
        if (text.length > 32_000_000 && !res.error && !res.issues.length && !res.multi) {
          const bytes = await this.minifiedSize(text, seq);
          if (seq !== this.sizeSeq) return;
          if (bytes !== null && bytes > 32_000_000) return void store.set({ sizes: { min: bytes, stale: false } });
        }
        const min = await this.minified(text, res, seq);
        if (min === null || seq !== this.sizeSeq) return;
        const blob = new Blob([min]);
        const sizes: Sizes = { min: blob.size, stale: false };
        // Beyond this, compressing on every edit costs more than the number is worth.
        if (blob.size <= 32_000_000) {
          const encoders = await import('./sizes').catch(() => null);
          if (seq !== this.sizeSeq) return;
          if (encoders) Object.assign(sizes, await encoders.compressedSizes(blob, () => seq === this.sizeSeq));
        }
        if (seq === this.sizeSeq) store.set({ sizes });
      }),
      text.length > 1_000_000 ? 700 : 200,
    );
  }

  /** The document was just loaded whole (file, paste, URL): no typing to wait out. */
  private loaded = false;

  /** Keeps the secondary views (convert, compare) in step with the document. */
  private afterDoc() {
    const v = this.settings.view;
    const now = this.loaded;
    this.loaded = false;
    if (v === 'format') this.scheduleFormat(now ? 0 : this.ed.length > 1_000_000 ? 250 : 60);
    else if (v === 'convert') this.scheduleConvert(now ? 0 : 150);
    else if (v === 'compare') store.set({ docText: this.ed.text });
  }

  private statusOf(res: ParseResult): Status {
    const first = res.issues[0];
    const err = res.error;
    const at = (p: number) => this.ed.lineCol(p);
    if (!first && !err) {
      const w = res.warnings[0];
      return w ? { kind: 'valid', warnings: res.warnings.length, msg: w.m, p: w.p, ...at(w.p) } : { kind: 'valid', warnings: 0 };
    }
    if (err && (!first || err.p <= first.p)) return { kind: 'error', msg: err.m, p: err.p, ...at(err.p) };
    if (err) return { kind: 'error', msg: first.m, p: first.p, ...at(first.p) };
    return { kind: 'fixable', msg: first.m, p: first.p, count: res.issues.length, ...at(first.p) };
  }

  /** Is the viewer showing positions that match the current text? */
  private get synced() {
    return !this.packed && !!this.res?.root && this.parsedVer === this.ed.version && !this.jwt;
  }

  // ── Selection sync ─────────────────────────────────────────────────────

  private onCaret = () => {
    if (!this.ed || this.dead) return; // fired while the editor itself is still being constructed
    const [s, e] = this.ed.selection;
    const { line, col } = this.ed.lineCol(s);
    store.set({ cursor: { line, col, sel: Math.abs(e - s) } });
    this.updateBrackets();
  };

  /** Caret moved by the user → reveal the node under it in the tree. */
  private onNav = () => {
    if (this.packed?.id === this.loadSeq) {
      const at = packedPosition(this.packed.tree, this.ed.caret, this.packed.document ?? this.packed.text);
      this.selPath = at?.path ?? null;
      store.set({ path: at ? formatPath(at.path) : null });
      this.ed.setScope(-1, -1);
      return;
    }
    if (!this.synced) return;
    const n = nodeAt(this.res!.root, this.ed.caret, this.ed.text);
    if (!n || n === this.sel) return;
    this.setSel(n);
    this.tree.select(n, { scroll: true });
    if (this.settings.view === 'graph') this.graph?.select(n, { scroll: true });
    this.ed.setScope(-1, -1);
  };

  private updateBrackets() {
    if (this.packed?.id === this.loadSeq) {
      const off = this.ed.caret;
      const at = packedPosition(this.packed.tree, off, this.packed.document ?? this.packed.text);
      const close = at ? at.end - 1 : -1;
      const c = (this.packed.document ?? this.packed.text).charCodeAt(close);
      const match = at && (c === 125 || c === 93) && (off === at.start || off === at.start + 1 || off === close || off === at.end);
      this.ed.setBrackets(match ? at.start : -1, match ? close : -1);
      return;
    }
    if (!this.synced) return;
    const off = this.ed.caret;
    const t = this.ed.text;
    for (let n: JNode | null = nodeAt(this.res!.root, off, t); n; n = n.u) {
      if (n.t < ARR) continue;
      const close = n.e - 1;
      const cc = t.charCodeAt(close);
      if ((cc === 125 || cc === 93) && (off === n.s || off === n.s + 1 || off === close || off === n.e)) {
        this.ed.setBrackets(n.s, close);
        return;
      }
      break;
    }
    this.ed.setBrackets(-1, -1);
  }

  private setSel(n: JNode | null) {
    this.sel = n;
    this.selPath = n ? pathOf(n) : null;
    store.set({ path: n ? formatPath(this.selPath!) : null });
  }

  private selectFromView(n: JNode, from: 'tree' | 'table' | 'graph' | 'search') {
    this.setSel(n);
    if (from === 'table' || from === 'graph') this.tree.select(n, { scroll: true, center: true });
    if (this.synced) {
      this.ed.setScope(n.s, n.e);
      if (!this.ed.isVisible(n.s)) this.ed.reveal(n.s, true);
    }
  }

  /** Reveals an offset of the document in the editor (used by Compare). */
  jumpTo(off: number) {
    this.ed.select(off, off, true);
  }

  private openInEditor(n: JNode) {
    this.flushLoad();
    if (!this.synced) return;
    this.ed.select(n.s, n.e);
  }

  // ── Commands: editing ──────────────────────────────────────────────────

  private transform(fn: (r: ParseResult, text: string) => string, done: (r: ParseResult) => string) {
    const r = this.fresh();
    if (!r) {
      this.toast('Nothing to format yet. Paste some JSON first.', 'info');
      this.ed.focus();
      return;
    }
    if (!r.root) {
      this.toast("Can't do that yet. Fix the error first.", 'err');
      this.gotoError();
      return;
    }
    // A JWT input is rewritten from its decoded document (undoable).
    const jwt = this.jwt;
    const before = this.ed.text;
    // Keep the caret on the same node across the rewrite.
    const at = jwt ? null : nodeAt(r.root, this.ed.caret, before);
    const path = at ? pathOf(at) : null;
    const next = this.unlessTooLarge(() => fn(r, jwt ? jwt.json : before));
    if (next === null) return;
    const msg = done(r) + (jwt ? ` · replaced the JWT with its decoded JSON · ${this.mod}Z to undo` : '');
    if (next === before) {
      this.toast(msg.replace(/ ·.*/, '') + ' · no changes', 'info');
      return;
    }
    this.ed.setValue(next);
    this.analyze();
    const target = path && this.res?.root ? resolve(this.res.root, path) : null;
    if (target) this.ed.setCaret(target.s);
    this.toast(msg, 'ok');
  }

  /** `make()`, or null (and a toast, if `report`) when its output would be too large to hold (see MAX_TEXT). */
  private unlessTooLarge<T>(make: () => T, report = true): T | null {
    try {
      return make();
    } catch (e) {
      if (!tooLarge(e)) throw e;
      if (report) this.toast('The result is too large', 'err');
      return null;
    }
  }

  private fixed = (r: ParseResult) => (r.issues.length ? ` · fixed ${r.issues.length} issue${r.issues.length > 1 ? 's' : ''}` : '');

  format(report = true) {
    if (report) track('feature_used', { feature: 'format_input' });
    this.transform(
      (r, t) => formatDoc(t, r, this.indent),
      (r) => 'Formatted' + this.fixed(r),
    );
  }

  minify() {
    track('feature_used', { feature: 'minify_input' });
    this.transform(
      (r, t) => formatDoc(t, r, ''),
      (r) => 'Minified' + this.fixed(r),
    );
  }

  sortKeys() {
    track('feature_used', { feature: 'sort_input' });
    this.transform(
      (r) => stringify(r.root!, this.indent, true),
      (r) => 'Sorted keys' + this.fixed(r),
    );
  }

  repair() {
    const r = this.fresh();
    if (r?.root && !r.issues.length) {
      this.toast('Already valid JSON, nothing to repair', 'info');
      return;
    }
    track('feature_used', { feature: 'repair' });
    this.format(false);
  }

  stringifyDoc() {
    track('feature_used', { feature: 'escape' });
    this.transform(
      (r, t) => JSON.stringify(formatDoc(t, r, '')),
      () => 'Escaped to a JSON string',
    );
  }

  unescapeDoc() {
    this.flushLoad();
    const text = this.ed.text;
    const r = this.fresh();
    let inner: string | null = null;
    if (r?.root?.t === STR) inner = r.root.v as string;
    else {
      try {
        const v: unknown = JSON.parse('"' + text.trim().replace(/^"|"$/g, '').replace(/\n/g, '\\n') + '"');
        if (typeof v === 'string') inner = v;
      } catch {
        inner = null;
      }
    }
    if (inner === null) {
      this.toast("This doesn't look like an escaped JSON string", 'err');
      return;
    }
    const pr = parse(inner);
    const next = pr.root && !pr.error ? this.unlessTooLarge(() => formatDoc(inner, pr, this.indent)) : inner;
    if (next === null) return;
    this.ed.setValue(next);
    this.analyze();
    track('feature_used', { feature: 'unescape' });
    this.toast('Unescaped', 'ok');
  }

  /** Converts the current text from another format into JSON (undoable). */
  async importAs(fmt: 'yaml' | 'xml' | 'csv' | 'toml') {
    const r = this.fresh();
    if (r?.root && !r.error && !r.issues.length) {
      this.toast(`This is already valid JSON, nothing to convert from ${fmt.toUpperCase()}`, 'info');
      return;
    }
    try {
      const { importToJson } = await import('../convert/import');
      if (this.dead) return;
      const r = importToJson(this.ed.text, fmt, this.indent);
      if ('error' in r) {
        this.toast(`Couldn't read ${fmt.toUpperCase()}: ${r.error}${r.line ? ` (line ${r.line})` : ''}`, 'err');
        return;
      }
      this.ed.setValue(r.json);
      this.analyze();
      track('feature_used', { feature: `import_${fmt}` });
      this.toast(`Converted ${fmt.toUpperCase()} to JSON · ${this.mod}Z to undo`, 'ok');
    } catch (error) {
      reportError(error, 'import');
      this.toast('Conversion failed', 'err');
    }
  }

  /** Turns a string value that holds JSON (`"{\"a\":1}"`) into real JSON, in place. */
  async expandNested(n: JNode | null = this.sel) {
    this.flushLoad();
    if (n === this.sel && this.packed && this.selPath) { this.fresh(); n = this.sel; }
    if (!n || n.t !== STR || !this.synced) return this.toast('Select a string that contains JSON', 'info');
    const { embeddedJson } = await import('../json/smart');
    const inner = embeddedJson(n.v as string);
    if (inner === null) return this.toast("This string doesn't contain JSON", 'info');
    const text = this.ed.text;
    const next = text.slice(0, n.s) + inner + text.slice(n.e);
    const r = parse(next);
    if (!r.root || r.error) return this.toast("Couldn't expand this value", 'err');
    const minified = this.ed.ls.length === 1;
    const path = pathOf(n);
    const out = this.unlessTooLarge(() => formatDoc(next, r, minified ? '' : this.indent));
    if (out === null) return;
    this.ed.setValue(out);
    this.analyze();
    const target = this.res?.root ? resolve(this.res.root, path) : null;
    if (target) {
      this.setSel(target);
      this.tree.select(target, { center: true });
      this.ed.setCaret(target.s);
    }
    track('feature_used', { feature: 'expand_nested' });
    this.toast(`Expanded nested JSON · ${this.mod}Z to undo`, 'ok');
  }

  /** Replaces a JWT input with its decoded header, payload and claims, to edit them. */
  decodeJwt() {
    const jwt = this.fresh() && this.jwt;
    if (!jwt) return this.toast('The input is not a JWT', 'info');
    this.ed.setValue(jwt.json);
    this.analyze();
    track('feature_used', { feature: 'decode_jwt' });
    this.toast(`Replaced the JWT with its decoded JSON (signature not verified) · ${this.mod}Z to undo`, 'ok');
  }

  gotoError() {
    const s = store.get().status;
    if (s.kind === 'error' || s.kind === 'fixable' || (s.kind === 'valid' && s.p !== undefined)) {
      const p = (s as { p: number }).p;
      this.ed.select(p, p, true);
    } else if (s.kind === 'valid') this.toast(this.jwt ? 'No errors, this JWT decodes' : 'No errors, this is valid JSON', 'ok');
  }

  undo() {
    this.flushLoad();
    this.ed.undo();
  }

  redo() {
    this.flushLoad();
    this.ed.redo();
  }

  /** Downloads an .xlsx of the data without changing the current view. */
  async exportExcel() {
    const current = this.fresh();
    if (!current?.root) this.materializeGood();
    const root = current?.root ?? this.good?.root;
    if (!root) return this.toast('Paste or open valid JSON first', 'info');
    if ((current?.root ? current : this.good)!.depth > MAX_WALK_DEPTH) return this.toast('Nesting is too deep to convert', 'err');
    try {
      const { records, toXlsx } = await import('../convert/xlsx');
      const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
      this.saveBlob(await toXlsx(records(root), { sheetName: base.slice(0, 31) || 'Sheet1' }), `${base}.xlsx`);
      track('feature_used', { feature: 'export_xlsx' });
    } catch (e) {
      this.toast(tooDeep(e) ? 'Nesting is too deep to convert' : "Couldn't create the Excel file", 'err');
    }
  }

  // ── Commands: documents ────────────────────────────────────────────────

  /** `outputFirst`: the caller reads nothing back afterwards, so a big document may draw its output first. */
  load(text: string, name: string | null, persist = true, outputFirst = false) {
    this.pendingLoad = null;
    this.releaseWorkerDocuments();
    this.persistEnabled = persistenceAfterLoad(this.persistEnabled, persist);
    this.resetNext = true;
    this.loadSeq++; // drops what an earlier load still has pending
    store.set({ fileName: name });
    if (persist) write(KEYS.file, name);
    if (text.length >= STEPS_MIN) this.startProgress();
    if (outputFirst && this.outputFirst(text, name, () => this.finishLoad(text, persist, true))) {
      // Until the editor has it, input would act on the old document: the first input hands it over at once.
      this.pendingLoad = { seq: this.loadSeq, text, persist };
      return;
    }
    this.finishLoad(text, persist, false);
  }

  /** A load whose output is drawn first and whose editor text is still to come (see flushLoad). */
  private pendingLoad: { seq: number; text: string; persist: boolean } | null = null;

  /**
   * Input arrived in the editor before a pending load reached it (a key, a paste or a cut right after
   * pasting a big document): give the editor the document now, so the input acts on what is shown.
   */
  private flushLoad = (edit = false) => {
    const p = this.pendingLoad;
    if (!p) return;
    this.pendingLoad = null;
    if (p.seq !== this.loadSeq) return;
    // The load's deferred steps are dropped; the analysis draws its output as usual.
    this.loadSeq++;
    this.finishLoad(p.text, p.persist, true);
    // Arrived for an edit: editable at once, not in the quiet view.
    if (edit) this.ed.takeOver();
    this.onCaret();
  };

  /**
   * A big strict-JSON document in the Format view: draws its output first,
   * re-indented straight from the text (in a worker, or here in slices), and
   * calls `next` (its analysis) once that has painted. False if it doesn't apply.
   */
  private outputFirst(text: string | Doc, name: string | null, next: (res?: ParseResult, metrics?: DocumentMetrics) => void, typed = false, retained?: Doc): boolean {
    const s = this.settings;
    if (text.length < OUTPUT_FIRST || !typed && (s.view !== 'format' || s.sortKeys || LINES_FILE.test(name ?? '')) || text.length < WORKER_MIN && readJwt(text.toString(), this.indent)) return false;
    const seq = ++this.loadSeq;
    const fast = text.length >= WORKER_MIN;
    // A big load (not typing) shows how far it got, here its output's steps (see FORMAT_SENT).
    if (!typed && text.length >= STEPS_MIN && this.progressShown() < 0) this.startProgress();
    const showing = !typed && fast && this.progressShown() >= 0;
    const document = retained ?? (typed ? this.ed.version as Doc : Doc.of(text.toString()));
    const analysisDocument = typed ? this.ed.version as Doc : document;
    const analysisInput = analysisDocument === document ? text : analysisDocument;
    const baseText = this.fmt.text;
    const baseId = this.fmtWorkerText === baseText ? this.fmtWorkerId : 0;
    clearTimeout(this.fmtTimer);
    clearTimeout(this.timer);
    const key = this.fmtSettings();
    const indent = s.minify || s.escape ? '' : this.indent;
    // The worker's parse (after typing) is rebuilt in short slices, input handled between them, then analysed.
    const analyse = (tree?: PackedTree, metrics?: DocumentMetrics) => {
      if (seq !== this.loadSeq) return;
      if (!tree) return next();
      const analysisText = analysisInput.toString();
      if (typed && tree.nodes.length && this.fmtSrcVer === analysisDocument && this.settings.view === 'format' && analysisText.length >= WORKER_MIN) {
        this.packed = { id: seq, tree, text: analysisText, metrics, document: analysisDocument };
        this.analyze({ ...tree.head, root: null }, metrics, true);
        return;
      }
      const step = unpacker(tree, analysisText);
      const run = () => {
        if (seq !== this.loadSeq) return;
        const res = step(performance.now() + 8);
        if (res) next(res, metrics);
        else soon(run);
      };
      run();
    };
    const done = (out: string | null, tree?: PackedTree, metrics?: DocumentMetrics, index?: CodeIndex, display?: string, change?: CodeChange & { base: number }, patch?: string, inline = false) => {
      if (seq !== this.loadSeq) return;
      if (typed && fast) this.queueAnalysis(seq, analysisDocument, name, analyse);
      if (out === null || key !== this.fmtSettings() || typed && this.settings.view !== 'format') {
        if (!typed || !fast) analyse(tree, metrics);
        return;
      }
      // On a first document the views are still hidden (empty state): show the output now.
      if (this.progressShown() < 0) store.set({ empty: false, status: { kind: 'parsing' } });
      else {
        store.set({ empty: false });
        if (showing) this.progress(FORMATTED);
      }
      this.fmt.el.hidden = false;
      // (Id 0: the output shown was drawn here, so the worker had nothing to compare it with.)
      const base = !!change?.base && change.base === baseId && baseText === this.fmt.text;
      this.drawFormat(out, key, index, display, base ? change : undefined, base ? patch : undefined, base && inline, typed ? document : null);
      this.pendingFmtWorkerId = seq;
      // The rest (editor, analysis) a moment after the output has painted, when the page is idle:
      // the output can be scrolled and searched right away, without that work in the way.
      if (!typed || !fast) setTimeout(() => idle(() => analyse(tree, metrics), 1000), 300);
    };
    const made = showing ? this.span(FORMAT_SENT, FORMAT_MADE) : undefined;
    const here = () => {
      const run = reindenter(text.toString(), indent);
      const step = () => {
        if (seq !== this.loadSeq) return;
        const out = run(performance.now() + 40);
        if (out === undefined) {
          made?.(run.at() / text.length);
          soon(step);
        } else soon(() => done(out));
      };
      step();
    };
    // A warm worker leaves the page free; a cold one would cost more than smaller documents take here.
    // Typing: the worker parses too, so nothing big is left for the page.
    const w = text.length < WORKER_MIN && !this.workerWarm && !typed ? null : this.reindentWorker();
    if (!w) {
      if (text.length < WORKER_MIN) done(reindent(text.toString(), indent));
      else here();
    } else {
      let got = 0;
      const arrived = showing ? (chars: number, size: number) => this.progress(FORMAT_MADE + ((FORMATTED - FORMAT_MADE) * (got += chars)) / size) : undefined;
      this.reindentJob = { id: seq, done, fallback: here, baseText, baseIndex: this.fmt.inlineIndex({ starts: new Int32Array(0), maxLen: 0 }), baseSlice: this.fmt.snapshotText(), outParts: [], displayParts: [], made, arrived };
      const request = { id: seq, indent, parse: typed && !fast, fast, reuseIndex: true, sortKeys: s.sortKeys, lines: LINES_FILE.test(name ?? ''), escape: s.escape, base: baseId, progress: showing };
      this.postDocument(w, request, document, false, undefined, showing ? this.span(0, FORMAT_SENT) : undefined);
    }
    return true;
  }

  /** Bumped by every load: a deferred step of an older one is dropped. */
  private loadSeq = 0;
  /** null: unavailable (it failed to start), so loads re-indent on the main thread. */
  private worker: Worker | null | undefined;
  /** The worker has run its warm-up (see reindent.worker.ts). */
  private workerWarm = false;
  /** Workers that failed to load or start (see onerror). */
  private workerFails = 0;
  private measuredSizes: { id: number; sizes: Sizes } | null = null;
  private workerParse: { id: number; tree: PackedTree; metrics?: DocumentMetrics } | null = null;
  /** `made`, `arrived`: a big load shows how far the worker got, then how much of its output arrived. */
  private reindentJob: { id: number; done: (out: string | null, tree?: PackedTree, metrics?: DocumentMetrics, index?: CodeIndex, display?: string, change?: CodeChange & { base: number }, patch?: string, inline?: boolean) => void; fallback: () => void; baseText: string; baseIndex: CodeIndex; baseSlice: (a: number, b: number) => string; outParts: string[]; displayParts: string[]; made?: (f: number) => void; arrived?: (chars: number, size: number) => void } | null = null;

  private workerDoc: Doc | null = null;
  private workerDocId = 0;
  private analysisWorker: Worker | null = null;
  private analysisFails = 0;
  private analysisDoc: Doc | null = null;
  private analysisDocId = 0;
  private analysisTimer = 0;

  /** A new document keeps the warmed formatter, but drops every old document and analysis task. */
  private releaseWorkerDocuments() {
    clearTimeout(this.analysisTimer);
    this.analysisWorker?.terminate();
    this.analysisWorker = null;
    this.analysisDoc = this.workerDoc = null;
    this.analysisDocId = this.workerDocId = 0;
    this.reindentJob = this.workerParse = null;
    this.fmtWorkerId = this.pendingFmtWorkerId = 0;
    this.fmtWorkerText = '';
    this.worker?.postMessage({ id: this.loadSeq, clear: true });
  }

  /** Both workers retain their input. Shared document versions send only a bounded replacement. `sent`: how much of a big one went. */
  private postDocument(w: Worker, request: { id: number; [key: string]: unknown }, document: Doc, analysis: boolean, next?: () => void, sent?: (f: number) => void) {
    const before = analysis ? this.analysisDoc : this.workerDoc;
    const edit = before && document.changeFrom(before);
    const remember = () => {
      if (analysis) { this.analysisDoc = document; this.analysisDocId = request.id; }
      else { this.workerDoc = document; this.workerDocId = request.id; }
      next?.();
    };
    if (edit) {
      w.postMessage({ ...request, edit, sourceBase: analysis ? this.analysisDocId : this.workerDocId });
      remember();
      return;
    }
    if (document.length < WORKER_MIN) {
      w.postMessage({ ...request, text: document.toString() });
      remember();
      return;
    }
    w.postMessage({ ...request, start: true });
    let at = 0;
    const send = () => {
      if (this.dead || request.id !== this.loadSeq || (analysis ? this.analysisWorker : this.worker) !== w) return;
      const until = performance.now() + 8;
      do {
        const end = Math.min(document.length, at + 256_000);
        w.postMessage({ id: request.id, chunk: document.slice(at, end), last: end === document.length });
        at = end;
      } while (at < document.length && performance.now() < until);
      sent?.(at / document.length);
      if (at < document.length) soon(send);
      else remember();
    };
    soon(send);
  }

  /** Full stats and packed nodes may follow output, but must never block its worker. */
  /**
   * Parses `document` in the analysis worker after `wait` ms (a typing pause), then `done(tree, metrics)`.
   * `failed`: the worker couldn't do it (a load then analyses here; typing never does). `showing`: a big
   * load, whose percent goes on from where it got to (ANALYSIS_SENT of the rest to send the text).
   */
  private queueAnalysis(id: number, document: Doc, name: string | null, done: (tree?: PackedTree, metrics?: DocumentMetrics) => void, wait = 2200, failed?: () => void, showing = false) {
    clearTimeout(this.analysisTimer);
    this.analysisTimer = window.setTimeout(() => {
      if (id !== this.loadSeq || this.dead) return;
      if (this.analysisFails >= 3) return failed?.();
      const from = showing ? this.progressShown() : -1;
      const sentTo = from + ANALYSIS_SENT * (1 - from);
      const sent = from >= 0 ? this.span(from, sentTo) : undefined;
      const worked = from >= 0 ? this.span(sentTo, 1) : undefined;
      try {
        const w = this.analysisWorker ??= new Worker(new URL('./reindent.worker.ts', import.meta.url));
        const good = this.fmtSrcVer instanceof Doc && this.fmtSrcVer !== document && this.fmtSrcVer !== this.goodVer ? this.fmtSrcVer : null;
        w.onmessage = (e: MessageEvent<{ id: number; tree?: PackedTree; metrics?: DocumentMetrics; sizes?: Sizes; reset?: boolean; good?: boolean; progress?: number }>) => {
          if (e.data.id !== this.loadSeq) return;
          if (e.data.reset) { this.analysisDoc = null; this.queueAnalysis(id, document, name, done); }
          else if (e.data.progress !== undefined) worked?.(e.data.progress);
          else if (e.data.good && e.data.tree && good) {
            this.good = null;
            this.goodVer = good;
            this.goodText = good.toString();
            this.goodMetrics = e.data.metrics ?? null;
            this.goodPacked = { id: -1, tree: e.data.tree, text: this.goodText, metrics: e.data.metrics };
            this.tree.releaseRoot();
            this.setGraphRoot(null, true);
            if (this.settings.view === 'tree' || this.settings.view === 'table' || this.settings.view === 'graph' || this.settings.view === 'convert') this.setView(this.settings.view);
          }
          else if (e.data.tree) done(e.data.tree, e.data.metrics);
          else if (e.data.sizes) { this.measuredSizes = { id, sizes: e.data.sizes }; store.set({ sizes: e.data.sizes }); }
        };
        w.onerror = (e) => {
          e.preventDefault();
          // Ignore duplicate failure events and never move this full parse onto the typing thread.
          if (this.analysisWorker !== w) return;
          reportError(e.error ?? new Error(), 'worker');
          this.analysisFails++;
          w.terminate(); this.analysisWorker = null; this.analysisDoc = null;
          if (id === this.loadSeq) failed?.();
        };
        const request = { id, analysis: true, lines: LINES_FILE.test(name ?? ''), escape: this.settings.escape, progress: !!worked };
        const current = () => this.postDocument(w, request, document, true, undefined, sent);
        if (good) this.postDocument(w, { ...request, good: true, progress: false }, good, true, current);
        else current();
      } catch (error) { reportError(error, 'worker'); this.analysisFails++; this.analysisWorker?.terminate(); this.analysisWorker = null; this.analysisDoc = null; failed?.(); }
    }, wait);
  }

  /** The re-indenting worker, started on first use or when a file is about to arrive. */
  private reindentWorker(): Worker | null {
    if (this.dead) return null;
    if (this.worker !== undefined) return this.worker;
    try {
      const w = new Worker(new URL('./reindent.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; out: string | null; tree?: PackedTree; metrics?: DocumentMetrics; index?: CodeIndex; display?: string; change?: CodeChange & { base: number }; sizes?: Sizes; patch?: string; chunk?: string; field?: 'out' | 'display'; size?: number; chunkedOut?: boolean; chunkedDisplay?: boolean; inline?: boolean; indexReuse?: boolean; reset?: boolean; progress?: number }>) => {
        if (e.data.id === -1) return void (this.workerWarm = true);
        if (e.data.id !== this.loadSeq) return;
        if (e.data.sizes) {
          this.measuredSizes = { id: e.data.id, sizes: e.data.sizes };
          store.set({ sizes: e.data.sizes });
          return;
        }
        if (e.data.tree) return void (this.workerParse = { id: e.data.id, tree: e.data.tree, metrics: e.data.metrics });
        const job = this.reindentJob;
        if (e.data.reset) { this.workerDoc = null; job?.fallback(); return; }
        if (!job || job.id !== e.data.id) return;
        if (e.data.progress !== undefined) return void job.made?.(e.data.progress);
        if (e.data.chunk !== undefined) {
          (e.data.field === 'display' ? job.displayParts : job.outParts).push(e.data.chunk);
          if (e.data.field === 'out' && e.data.size) job.arrived?.(e.data.chunk.length, e.data.size);
          return;
        }
        this.reindentJob = null;
        const out = e.data.patch !== undefined && e.data.change ? applyCodeChange(job.baseText, e.data.patch, e.data.change, job.baseSlice) : e.data.chunkedOut ? job.outParts.join('') : e.data.out;
        const display = e.data.chunkedDisplay ? job.displayParts.join('') : e.data.display;
        job.done(out, this.workerParse?.id === job.id ? this.workerParse.tree : undefined, this.workerParse?.metrics, e.data.indexReuse && e.data.index ? { ...e.data.index, close: job.baseIndex.close, depth: job.baseIndex.depth } : e.data.index, display, e.data.change, e.data.patch, e.data.inline);
        this.workerParse = null;
      };
      w.onerror = (e) => {
        // It couldn't load (offline before it was ever cached, blocked, or its start cut short by a
        // navigation): work here instead, and start another on a later use, a few times over.
        e.preventDefault();
        reportError(e.error ?? new Error(), 'worker');
        this.workerDoc = null;
        this.worker = ++this.workerFails < 3 ? undefined : null;
        w.terminate();
        const job = this.reindentJob;
        this.reindentJob = null;
        job?.fallback();
      };
      this.worker = w;
      const doc = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Zoë ${i}`, tags: ['a', 'b'], n: 1.5e3, ok: true, x: null, s: 'say "hi"\n' })));
      w.postMessage({ id: -1, text: doc, indent: '  ', warm: 12 });
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  /** A paste was loaded as a document: the editor keeps the focus it had. */
  private refocus = false;

  /** `split`: the output is already shown, so the editor and the analysis go in separate tasks (input is handled between them). */
  private finishLoad(text: string, persist: boolean, split = false) {
    this.pendingLoad = null;
    const loading = this.progressShown() >= 0 ? this.progressStatus : null;
    this.ed.setValue(text, 0, true);
    if (loading) {
      // (The editor's change said "Parsing…": the load goes on. With its output shown first, the editor's step is done too.)
      store.set({ status: (this.progressStatus = loading) });
      if (this.progressShown() >= FORMATTED) this.progress(EDITOR);
    }
    const document = this.ed.version as Doc;
    if (this.workerDoc?.flat === text && document.flat === text) this.workerDoc = document;
    if (this.fmtSrcVer === null && (this.fmtWorkerId || this.pendingFmtWorkerId)) this.fmtSrcVer = document;
    if (this.refocus) {
      // Pasted in the editor: the user is editing, so it arrives editable (not in the quiet view,
      // where a selection by keyboard would select nothing and the next paste would add to it).
      this.ed.takeOver();
      this.ed.focus();
    }
    this.refocus = false;
    const seq = this.loadSeq;
    const rest = () => {
      if (seq !== this.loadSeq) return;
      this.loaded = true;
      // A big document in the Format view is parsed and measured by the analysis worker, its tree kept
      // packed until a command needs nodes (as after typing): the page would block on it for seconds.
      // The other views need every node at once; without a worker, the page parses it too.
      if (text.length >= WORKER_MIN && this.settings.view === 'format' && this.analysisFails < 3) {
        const here = () => seq === this.loadSeq && this.analyzeInSteps();
        // (Putting the text in the editor scheduled a typed analysis, which analyze() would cancel.)
        clearTimeout(this.timer);
        const showing = this.progressShown() >= 0;
        store.set(showing ? { empty: false } : { empty: false, status: { kind: 'parsing' } });
        this.queueAnalysis(seq, document, store.get().fileName, (tree, metrics) => {
          if (seq !== this.loadSeq) return;
          if (!tree) return here();
          if (tree.nodes.length && this.fmtSrcVer === document && this.settings.view === 'format') {
            this.packed = { id: seq, tree, text, metrics, document };
            this.analyze({ ...tree.head, root: null }, metrics, true);
            return;
          }
          // (The view changed meanwhile: its nodes, rebuilt in short slices.)
          const step = unpacker(tree, text);
          const run = () => {
            if (seq !== this.loadSeq) return;
            const res = step(performance.now() + 8);
            if (res) this.analyze(res, metrics);
            else soon(run);
          };
          run();
        }, 0, here, showing);
      } else this.analyzeInSteps();
      this.ed.el.scrollTop = 0;
      if (persist) this.persistSoon();
    };
    if (split) soon(rest);
    else rest();
  }

  /**
   * The newest document asked for in each editor (1: the input, 2: Compare's) by a file, a link, a URL or
   * the clipboard: a newer request aborts it (a download stops), so one that arrives late is dropped
   * instead of replacing a newer one, and says nothing. destroy() aborts both.
   */
  private requests: Record<1 | 2, AbortController | null> = { 1: null, 2: null };

  /** A new request for a document in `editors` (see requests): its signal aborts once it is superseded. */
  private request(...editors: (1 | 2)[]): AbortSignal {
    const c = new AbortController();
    for (const k of editors) {
      this.requests[k]?.abort();
      this.requests[k] = c;
    }
    if (this.dead) c.abort();
    return c.signal;
  }

  /** The request for what a link or a handoff asks for: the editors it fills. */
  private requestFor(r: { a?: unknown; b?: unknown }) {
    return this.request(...(r.a ? [1 as const] : []), ...(r.b ? [2 as const] : []));
  }

  openFile(target: 1 | 2 = 1) {
    this.reindentWorker();
    void loadSurface();
    this.fileTarget = target;
    this.els.file.value = '';
    this.els.file.click();
  }

  private onFile = () => {
    const f = this.els.file.files?.[0];
    if (!f) return;
    if (this.fileTarget === 2) void this.loadCompareFile(f);
    else void this.loadFile(f, 'file');
  };

  async loadFile(f: File, source: InputSource = 'file') {
    const signal = this.request(1);
    performance.clearMarks('tk:formatted');
    performance.mark('tk:input');
    this.markOutput = true;
    if (f.size > MAX_DOCUMENT) {
      this.toast('That file is too large to open in a browser tab', 'err');
      return;
    }
    // A big file shows it is being opened while it is read too.
    const before = store.get().status;
    let reading: Status | null = null;
    if (f.size >= STEPS_MIN) {
      this.startProgress();
      reading = this.progressStatus;
    }
    // (Not opened: what was shown before stays, a load still running included.)
    const unshow = () => {
      if (reading && !this.dead && store.get().status === reading) store.set({ status: (this.progressStatus = before) });
    };
    try {
      const text = await f.text();
      if (signal.aborted) return unshow();
      if (/\.(csv|tsv|ya?ml|xml|toml)$/i.test(f.name)) {
        const { detectFormat, importToJson } = await import('../convert/import');
        if (signal.aborted) return unshow();
        const fmt = detectFormat(text, f.name);
        if (fmt !== 'json' && fmt !== 'unknown') {
          const r = importToJson(text, fmt, this.indent);
          if ('json' in r) {
            noteLoad(source, 1, f.name);
            this.load(r.json, f.name.replace(/\.[^.]+$/, '.json'));
            this.toast(`Converted ${f.name} to JSON`, 'ok');
            return;
          }
          this.toast(`Couldn't read ${f.name}: ${r.error}`, 'err');
        }
      }
      noteLoad(source, 1, f.name);
      this.load(text, f.name, true, true);
      this.toast(`Opened ${f.name}`, 'ok');
    } catch {
      unshow();
      if (!signal.aborted) this.toast(`Couldn't read ${f.name}`, 'err');
    }
  }

  async paste() {
    const signal = this.request(1);
    try {
      const text = await navigator.clipboard.readText();
      if (signal.aborted) return;
      if (!text) {
        this.toast('Your clipboard is empty', 'info');
        return;
      }
      noteLoad('paste_button');
      this.load(text, null);
      if (this.settings.autoFormat) this.autoFormat();
    } catch {
      if (signal.aborted) return;
      this.ed.focus();
      this.toast(`Press ${this.mod}V to paste`, 'info');
    }
  }

  async sample() {
    const signal = this.request(1);
    // (Typing meanwhile keeps what was typed.)
    const ver = this.ed.version;
    try {
      const { SAMPLE } = await import('./sample');
      if (signal.aborted || ver !== this.ed.version) return;
      noteLoad('sample', 1, 'sample.json');
      this.load(SAMPLE, 'sample.json');
      this.toast('Loaded a sample. Try the tree, table and search.', 'info');
    } catch {
      this.toast("Couldn't read sample.json", 'err');
    }
  }

  clear() {
    track('feature_used', { feature: 'clear' });
    // (A document still on its way isn't wanted any more.)
    this.request(1);
    this.resetNext = true;
    store.set({ fileName: null });
    write(KEYS.file, null);
    this.ed.setValue('');
    this.analyze();
    this.ed.focus();
  }

  async copyAll() {
    this.flushLoad();
    if (!this.ed.text) return this.toast('Nothing to copy yet', 'info');
    track('feature_used', { feature: 'copy_input' });
    await this.copy(this.ed.text, 'Copied to clipboard');
  }

  copyValue(n: JNode | null = this.sel) {
    if (n === this.sel && this.goodPacked && this.selPath) { this.materializeGood(); n = this.sel; }
    if (!n) return this.toast('Select a node first', 'info');
    track('feature_used', { feature: 'copy_value' });
    const text = this.unlessTooLarge(() => copyText(n, this.indent));
    if (text !== null) void this.copy(text, n.t >= ARR ? 'Copied value as JSON' : 'Copied value');
  }

  copyPath(n: JNode | null = this.sel) {
    if (n) track('feature_used', { feature: 'copy_path' });
    if (n === this.sel && this.goodPacked && this.selPath) return void this.copy(formatPath(this.selPath), 'Copied path');
    if (!n) return this.toast('Select a node first', 'info');
    void this.copy(formatPath(pathOf(n)), 'Copied path');
  }

  /** Copies `text`, then says `msg` (none: quietly, as the copy key does). */
  private async copy(text: string, msg?: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.className = PRIVATE;
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (msg) this.toast(msg, 'ok');
  }

  // ── Compare (second editor) ────────────────────────────────────────────

  private onCompareChange = () => {
    clearTimeout(this.cmpTimer);
    const len = this.ed2.text.length;
    this.cmpTimer = window.setTimeout(this.analyzeCompare, len < 100_000 ? 60 : len < 1_000_000 ? 160 : 400);
  };

  /** Squiggles for the modified document + publish it to the Compare panel. */
  private analyzeCompare = () => {
    clearTimeout(this.cmpTimer);
    const text = this.ed2.text;
    const diags: Diagnostic[] = [];
    if (text.trim()) {
      const r = parse(text);
      for (let i = 0; i < r.issues.length && i < 300; i++) diags.push({ p: r.issues[i].p, cls: 'me' });
      if (r.error) diags.push({ p: r.error.p, cls: 'me' });
      for (let i = 0; i < r.warnings.length && i < 300; i++) diags.push({ p: r.warnings[i].p, cls: 'mw' });
    }
    this.ed2.setDiagnostics(diags);
    store.set({ cmpText: text });
    write(KEYS.cmp, text && text.length <= MAX_PERSIST ? text : null);
  };

  /** Called by the Compare panel with per-line marks for both editors. */
  compareMarks(left: Uint8Array | null, right: Uint8Array | null) {
    const on = this.settings.view === 'compare';
    this.ed.setLineMarks(on ? left : null);
    this.ed2.setLineMarks(on ? right : null);
  }

  /** Reveal a difference in both documents without moving focus. */
  compareJump(left: number | undefined, right: number | undefined) {
    if (left !== undefined) this.ed.point(left);
    if (right !== undefined) this.ed2.point(right);
  }

  loadCompare(text: string, name: string | null) {
    store.set({ cmpFile: name });
    this.ed2.setValue(text, 0);
    this.analyzeCompare();
  }

  async loadCompareFile(f: File, source: InputSource = 'file') {
    const signal = this.request(2);
    try {
      const text = await f.text();
      if (signal.aborted) return;
      this.loadCompare(text, f.name);
      noteLoad(source, 2, f.name);
      if (this.settings.view !== 'compare') this.setView('compare');
      this.toast(`Comparing with ${f.name}`, 'ok');
    } catch {
      if (!signal.aborted) this.toast(`Couldn't read ${f.name}`, 'err');
    }
  }

  async pasteCompare() {
    const signal = this.request(2);
    try {
      const text = await navigator.clipboard.readText();
      if (signal.aborted) return;
      if (!text) return this.toast('Your clipboard is empty', 'info');
      this.loadCompare(text, null);
      noteLoad('paste_button', 2);
    } catch {
      if (signal.aborted) return;
      this.ed2.focus();
      this.toast(`Press ${this.mod}V to paste`, 'info');
    }
  }

  formatCompare() {
    const text = this.ed2.text;
    if (!text.trim()) return this.toast('Paste the modified JSON first', 'info');
    const r = parse(text);
    if (!r.root) return this.toast("Can't format it yet. Fix the error first.", 'err');
    track('feature_used', { feature: 'compare_format' });
    const out = this.unlessTooLarge(() => formatDoc(text, r, this.indent));
    if (out !== null) this.ed2.setValue(out);
    this.analyzeCompare();
  }

  clearCompare() {
    this.request(2);
    store.set({ cmpFile: null });
    this.ed2.setValue('');
    this.analyzeCompare();
    this.ed2.focus();
  }

  /** Swap original and modified (both undoable). */
  swapCompare() {
    track('feature_used', { feature: 'compare_swap' });
    this.flushLoad();
    const a = this.ed.text;
    const b = this.ed2.text;
    const fa = store.get().fileName;
    const fb = store.get().cmpFile;
    this.resetNext = true;
    this.ed.setValue(b);
    this.ed2.setValue(a);
    store.set({ fileName: fb, cmpFile: fa });
    write(KEYS.file, fb);
    this.analyze();
    this.analyzeCompare();
    this.persistSoon();
  }

  setSplitCmp(splitCmp: number) {
    this.setSettings({ splitCmp: Math.min(0.85, Math.max(0.4, splitCmp)) });
  }

  private onCopy2 = (e: ClipboardEvent) => {
    const ed = this.ed2;
    if (!ed.text || ed.selectedText()) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', ed.text);
    this.toast('Copied the modified document', 'ok');
  };

  /** Copy with nothing selected copies the whole document. */
  private onCopy = (e: ClipboardEvent) => {
    const ed = this.ed;
    if (!ed.text || ed.selectedText()) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', ed.text);
    this.toast('Copied the whole document', 'ok');
  };

  download() {
    this.flushLoad();
    if (!this.ed.text) return this.toast('Nothing to download yet', 'info');
    const name = store.get().fileName || 'data.json';
    track('feature_used', { feature: 'download_input' });
    this.save(this.ed.text, /\.[a-z0-9]+$/i.test(name) ? name : name + '.json', 'application/json');
  }

  private save(text: string, name: string, type: string) {
    this.saveBlob(new Blob([text], { type }), name);
  }

  private saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.toast(`Saved ${name}`, 'ok');
  }

  /**
   * Copies a link to `/` that opens what is on screen: the document in this view,
   * or both documents in Compare. The documents travel in the link (lib/link.ts).
   * `as`: the link alone, or a "View in Tool Kumar" ("Compare in Tool Kumar")
   * button around it in Markdown or HTML, as /integrate's builder makes them (lib/badge.ts).
   */
  async share(as: SnippetFormat = 'link') {
    this.flushLoad();
    const comparing = this.settings.view === 'compare';
    const a = this.ed.text;
    const b = comparing ? this.ed2.text : '';
    if (!a.trim() && !b.trim()) return this.toast('Nothing to share yet', 'info');
    // Valid JSON travels minified (a shorter link) and opens formatted; anything else as typed.
    const r = this.fresh();
    const rb = b.trim() ? parse(b) : null;
    const compact = (text: string, r: ParseResult | null) => (r?.root && !r.error && !r.issues.length ? formatDoc(text, r, '') : text);
    try {
      const hash = await linkHash({
        a: a.trim() ? { text: this.jwt ? a.trim() : compact(a, r) } : undefined,
        b: rb ? { text: compact(b, rb) } : undefined,
        view: this.settings.view,
        to: this.settings.target,
      });
      track('feature_used', { feature: comparing ? 'share_compare' : 'share_link', value: as });
      const url = `${location.origin}/${hash}`;
      const copied = {
        link: comparing ? 'Comparison link copied. Both documents live in the link, not on a server.' : 'Share link copied. The data lives in the link, not on a server.',
        markdown: comparing ? 'Markdown button copied. Both documents live in its link, not on a server.' : 'Markdown button copied. The data lives in its link, not on a server.',
        html: comparing ? 'HTML button copied. Both documents live in its link, not on a server.' : 'HTML button copied. The data lives in its link, not on a server.',
      };
      await this.copy(snippet(as, url, comparing ? 'compare' : 'view', 'auto', location.origin), copied[as]);
      // Always copied, but a link past what browsers open says so (lib/link.ts).
      const reach = linkReach(url.length);
      const size = formatBytes(url.length);
      if (reach === 'click') {
        this.toast(`Link copied (${size}). It opens when clicked, but pasted into Chrome's or Edge's address bar it gets cut at 500 KB.`, 'info', undefined, 7000);
      } else if (reach === 'not-firefox') {
        this.toast(
          `Link copied (${size}). It opens when clicked in Chrome, Edge and Safari, but not Firefox, which stops at about 1 MB. Pasted into Chrome's or Edge's address bar, it gets cut at 500 KB.`,
          'info',
          undefined,
          9000,
        );
      } else if (reach === 'none') {
        if (comparing) this.toast(`Link copied, but at ${size} it is too long for any browser to open (they stop at about 2 MB). Share the documents as files instead.`, 'err', undefined, 9000);
        else this.toast(`Link copied, but at ${size} it is too long for any browser to open (they stop at about 2 MB). Share the JSON as a file instead.`, 'err', { label: 'Download', run: () => this.download() });
      }
    } catch {
      this.toast("Your browser can't create share links", 'err');
    }
  }

  /** Opens what a link's fragment asks for (lib/link.ts), then takes it out of the address bar. */
  private openLink = async () => {
    const link = parseLink(location.hash);
    if (!link) return;
    // Exactly as long as Chrome's and Edge's address bar keeps of a paste: the rest of it was dropped (lib/link.ts).
    const cut = location.href.length === PASTED_LINK;
    history.replaceState(null, '', location.pathname + location.search);
    if (link === 'handoff') return this.awaitHandoff();
    const broken = () =>
      cut
        ? this.toast('That link was cut short: Chrome and Edge keep only the first 500 KB of a link pasted into the address bar. Open it by clicking it instead.', 'err', undefined, 9000)
        : this.toast('That share link is broken or incomplete', 'err');
    if (link === 'broken') return broken();
    const signal = this.requestFor(link);
    const docs: (LinkDoc | undefined)[] = [];
    try {
      for (const d of [link.a, link.b]) docs.push(d && 'data' in d ? { text: await decodeDoc(d.data) } : d);
    } catch (e) {
      if (signal.aborted) return;
      return e instanceof LinkTooLarge ? this.toast('That share link is too large to open', 'err') : broken();
    }
    if (!signal.aborted) void this.openRequest({ a: docs[0], b: docs[1], view: link.view, to: link.to }, signal);
  };

  /** Ends the wait for a handoff (see awaitHandoff). */
  private handoffEnd: (() => void) | null = null;

  /**
   * `/#handoff`: the page that opened this tab sends documents too big for a link
   * by postMessage (lib/link.ts, app/(en)/integrate/snippets.ts). Only that page is heard, once.
   */
  private awaitHandoff() {
    const opener = window.opener as Window | null;
    if (!opener) return;
    const reply = (m: HandoffReply, origin = '*') => {
      try {
        opener.postMessage(m, origin);
      } catch {
        // The opener navigated away or closed.
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== opener) return;
      const r = readHandoff(e.data);
      if (!r) return;
      if (typeof r === 'string') {
        this.toast(r === 'too_large' ? 'That file is too large to open in a browser tab' : "Couldn't open what the other page sent", 'err');
        return reply({ toolkumar: 'error', reason: r }, e.origin);
      }
      end();
      reply({ toolkumar: 'opened' }, e.origin);
      void this.openRequest(r, this.requestFor(r), /^https?:\/\//.test(e.origin) ? new URL(e.origin).host : '');
    };
    const end = () => {
      removeEventListener('message', onMessage);
      clearTimeout(timer);
      this.handoffEnd = null;
    };
    const timer = window.setTimeout(end, 120_000);
    this.handoffEnd?.();
    this.handoffEnd = end;
    addEventListener('message', onMessage);
    reply({ toolkumar: 'ready', version: HANDOFF_VERSION });
  }

  /**
   * Loads what a link or a handoff (`from`: the sending site's host, '' if it has none) asks for:
   * the original, Compare's document, the view. The previous documents stay one undo away.
   * `signal`: its request (see requests).
   */
  private async openRequest(r: LinkRequest, signal: AbortSignal, from?: string) {
    const got = await Promise.all([r.a, r.b].map((d) => (!d ? undefined : 'url' in d ? this.fetchText(d.url, signal) : { text: d.text, name: null, host: '' })));
    if (signal.aborted || this.dead || got.includes(null)) return; // (fetchText said why)
    const [a, b] = got;
    const source = (d: LinkDoc): InputSource => (from !== undefined ? 'handoff' : 'url' in d ? 'link_url' : 'link');
    // Small valid JSON opens formatted; a big document opens like a file, output first.
    const open = (text: string) => {
      const res = text.length <= 2_000_000 ? parse(text) : null;
      return res?.root && !res.error && !res.issues.length ? this.unlessTooLarge(() => formatDoc(text, res, this.indent), false) : null;
    };
    const had = !!this.ed.text.trim();
    if (a) {
      noteLoad(source(r.a!), 1, a.name);
      const pretty = open(a.text);
      this.load(pretty ?? a.text, a.name, true, pretty === null);
    }
    if (b) {
      noteLoad(source(r.b!), 2, b.name);
      this.loadCompare(open(b.text) ?? b.text, b.name);
    }
    const view = r.view ?? (b ? 'compare' : undefined);
    if (view === 'convert') this.setConvert(r.to ? { target: r.to } : {});
    else if (view && view !== this.settings.view) this.setView(view);
    const msg =
      from !== undefined ? (from ? `Opened JSON sent by ${from}` : 'Opened JSON sent by another page')
      : b ? 'Loaded the shared comparison'
      : a?.host ? `Loaded ${a.host}`
      : 'Loaded shared JSON';
    this.toast(a && had ? `${msg} · ${this.mod}Z restores your previous document` : msg, 'ok');
  }

  /** Fetches a document from a URL; null, after saying why, when that fails (quietly, once `signal` aborts it). */
  private async fetchText(raw: string, signal: AbortSignal): Promise<{ text: string; name: string; host: string } | null> {
    let url: URL;
    try {
      url = new URL(raw.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      this.toast('Enter a valid http(s) URL', 'err');
      return null;
    }
    this.toast('Fetching…', 'info');
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' }, signal });
      if (signal.aborted) return null;
      if (!res.ok) {
        this.toast(`Request failed: ${res.status} ${res.statusText}`, 'err');
        return null;
      }
      const text = await res.text();
      const name = url.pathname.split('/').pop() || url.hostname;
      return { text, name: /\.json$/i.test(name) ? name : name + '.json', host: url.hostname };
    } catch {
      if (!signal.aborted) this.toast("Couldn't fetch. The server must allow cross-origin requests (CORS).", 'err');
      return null;
    }
  }

  async fetchUrl(raw: string) {
    const signal = this.request(1);
    const got = await this.fetchText(raw, signal);
    if (!got || signal.aborted) return;
    // Auto-format reads the editor right after: only then is the load done in place.
    noteLoad('url');
    this.load(got.text, got.name, true, !this.settings.autoFormat);
    if (this.settings.autoFormat) this.autoFormat();
    this.toast(`Loaded ${got.host}`, 'ok');
  }

  // ── Commands: view ─────────────────────────────────────────────────────

  private setGraphRoot(root: JNode | null, reset: boolean, nodes = 0) {
    this.graphRoot = { root, reset, nodes };
    this.graph?.setRoot(root, reset, nodes, this.settings.view === 'graph');
  }

  private loadGraph() {
    return this.graphLoad ??= import('../graph/view').then(({ GraphView }) => {
      if (this.dead) return;
      const graph = new GraphView(this.els.graph, {
        select: (n) => this.selectFromView(n, 'graph'),
        open: (n) => this.openInEditor(n),
        copy: (n, what) => what === 'path' ? this.copyPath(n) : this.copyValue(n),
        escape: () => this.focusEditor(),
      });
      const { root, reset, nodes } = this.graphRoot;
      graph.setRoot(root, reset, nodes, false);
      this.graph = graph;
    }).catch((error) => {
      this.graphLoad = null;
      reportError(error, 'import');
      if (!this.dead) {
        this.toast("Couldn't load the graph. Try opening it again.", 'err');
        if (this.settings.view === 'graph') this.setView('format');
      }
    });
  }

  private viewSeq = 0;

  setView(view: View, ready?: () => void) {
    this.flushLoad();
    store.set({ menu: null });
    const viewSeq = ++this.viewSeq;
    if (view === 'graph') {
      this.graphShow = { seq: viewSeq, ready };
      // The tab opens at once; the graph draws when its code has arrived (usually prefetched already).
      if (!this.graph) void this.loadGraph().then(() => this.showGraph(viewSeq));
    }
    const packed = this.packed?.id === this.loadSeq ? this.packed : this.goodPacked;
    if (view !== 'format' && view !== 'compare' && packed) {
      const { tree, text, metrics } = packed;
      const seq = this.loadSeq;
      const step = unpacker(tree, text);
      const run = () => {
        if (this.dead || seq !== this.loadSeq || viewSeq !== this.viewSeq) return;
        const res = step(performance.now() + 8);
        if (!res) return soon(run);
        if (packed.id === this.loadSeq) this.analyze(res, metrics);
        else {
          this.good = res;
          this.goodPacked = null;
          this.tree.setRoot(res.root, false, res.nodes, false);
          this.setGraphRoot(res.root, false, res.nodes);
          this.sel = this.selPath ? resolve(res.root, this.selPath) : null;
          this.tree.select(this.sel, { scroll: false });
        }
        this.setView(view, ready);
      };
      soon(run);
      return;
    }
    const prev = this.settings.view;
    if (prev === 'graph' && view !== 'graph') this.graph?.deactivate();
    if (prev !== view && !this.presetting) track('view_opened', { view, ...(view === 'convert' && { target: targetInfo(this.settings.target).id }) });
    if (this.query && prev !== view) this.findIn(prev, '');
    this.setSettings(view === 'compare' && prev !== 'compare' ? { view, prevView: prev } : { view });
    if (this.query) requestAnimationFrame(() => this.dead || (this.settings.view === 'compare' ? this.closeFind() : this.refind(true)));
    if (view === 'table') {
      const root = this.good?.root ?? null;
      const base = this.sel ? (this.sel.t >= ARR ? this.sel : this.sel.u) : root;
      this.tableShow(base);
    } else this.table.setNode(null);
    if (view === 'tree') {
      this.tree.activate();
      requestAnimationFrame(() => { if (!this.dead) this.tree.render(true); });
    }
    if (view === 'format') this.scheduleFormat(0);
    if (view === 'convert') this.scheduleConvert(0);
    if (view === 'compare') {
      store.set({ docText: this.ed.text, cmpText: this.ed2.text });
      requestAnimationFrame(() => {
        if (this.dead) return;
        this.ed2.render(true);
        if (!this.ed2.text) this.ed2.focus();
      });
    } else this.compareMarks(null, null);
    if (view === 'graph') requestAnimationFrame(() => this.showGraph(viewSeq));
    else ready?.();
  }

  /** The Graph view opened by setView call `seq`: draw it once both the view is shown and its code is loaded. */
  private graphShow: { seq: number; ready?: () => void } | null = null;
  private showGraph(seq: number) {
    const show = this.graphShow;
    if (this.dead || !this.graph || !show || show.seq !== seq || seq !== this.viewSeq || this.settings.view !== 'graph') return;
    this.graphShow = null;
    this.graph.activate();
    this.graph.select(this.sel, { scroll: true });
    if (this.query) this.refind(true);
    show.ready?.();
  }

  /** Leaves Compare for the view that was open before it. */
  closeCompare() {
    if (this.settings.view !== 'compare') return;
    track('feature_used', { feature: 'compare_close' });
    this.setView(this.settings.prevView);
    this.ed.focus();
  }

  /** Folding in an editor (1: input, 2: Compare's modified document); level 0 unfolds everything. */
  foldEditor(which: 1 | 2, level: number) {
    const ed = which === 2 ? this.ed2 : this.ed;
    track('feature_used', { feature: 'fold_input', level });
    if (level) ed.foldLevel(level);
    else ed.unfoldAll();
  }

  // ── Format view (output) ───────────────────────────────────────────────

  setFormat(patch: Partial<Pick<Settings, 'minify' | 'sortKeys' | 'escape'>>) {
    if (!this.presetting) {
      if (patch.sortKeys !== undefined && patch.sortKeys !== this.settings.sortKeys) track('format_option_changed', { option: 'sort_keys', value: String(patch.sortKeys) });
      const style = patch.escape ? 'string' : patch.minify !== undefined ? (patch.minify ? 'minify' : 'pretty') : null;
      const was = this.settings.escape ? 'string' : this.settings.minify ? 'minify' : 'pretty';
      if (style && style !== was) track('format_option_changed', { option: 'style', value: style });
    }
    this.setSettings(patch);
    if (this.settings.view !== 'format') this.setView('format');
    else this.scheduleFormat(0);
  }

  private scheduleFormat(delay: number) {
    clearTimeout(this.fmtTimer);
    this.fmtTimer = window.setTimeout(this.runFormat, delay);
  }

  /** The formatted document for the current settings (from the last valid parse), before any escaping. */
  private formatted(): string {
    if (this.formatCurrent(this.fmtSettings())) return this.fmtText;
    const r = this.good;
    if (!r?.root) return '';
    const s = this.settings;
    return formatDoc(this.goodText, r, s.minify || s.escape ? '' : this.indent, s.sortKeys);
  }

  /** The Format view's output: the formatted document, or it as one JSON string literal. */
  private output(): string {
    const text = this.formatted();
    return this.settings.escape && text ? JSON.stringify(text) : text;
  }

  /** What the Format view last drew: the source text and the settings it used. */
  private fmtSrcVer: object | null = null;
  private fmtWorkerId = 0;
  private fmtWorkerText = '';
  private pendingFmtWorkerId = 0;
  private fmtKey = '';
  private fmtText = '';
  private fmtVersion = 0;
  private fmtCounts: { version: number; pretty: number; minified: number; escaped: number } | null = null;
  /** User Timing for DevTools: a file opened (tk:input) → its output painted (tk:formatted). */
  private markOutput = false;

  /** Keep accepted output while analysis catches up, then match the newest good document. */
  private formatCurrent(key: string): boolean {
    return key === this.fmtKey && (this.goodVer !== null && this.goodVer === this.fmtSrcVer || !!(this.fmtWorkerId || this.pendingFmtWorkerId) && (this.parsedVer !== this.ed.version || !this.res?.root));
  }

  private runFormat = () => {
    if (this.settings.view !== 'format') return;
    // Reformat the accepted source promptly even while its tree is still being analysed.
    if (this.fmtKey !== this.fmtSettings() && this.fmtSrcVer instanceof Doc && this.fmtSrcVer !== this.goodVer && (this.fmtWorkerId || this.pendingFmtWorkerId)) {
      const retained = this.fmtSrcVer;
      if (this.outputFirst(retained, store.get().fileName, (res, metrics) => this.analyze(res, metrics), true, retained)) return;
    }
    if (this.packed && this.fmtKey !== this.fmtSettings()) this.fresh();
    if (this.fmtKey !== this.fmtSettings()) this.materializeGood();
    // Already drawn for this document and settings (a big load draws it before its analysis).
    const key = this.fmtSettings();
    const drawn = this.formatCurrent(key);
    let text: string;
    try {
      text = drawn ? this.fmtText : this.formatted();
      if (!drawn) this.drawFormat(text, key);
    } catch (e) {
      if (!tooLarge(e)) throw e;
      // (Pretty-printing very deep nesting: about 2·depth² characters.) The view says so instead.
      this.drawFormat('', key);
      store.set({ fmt: { lines: 0, pretty: 0, minified: 0, escaped: 0, tooLarge: true } });
      return;
    }
    if (this.fmtSrcVer !== this.goodVer) return; // This output's metrics are still being analysed.
    // Size of the shown variant is measured; the other differs only by whitespace,
    // which is computed from the tree (no second format of big documents).
    const seq = ++this.fmtStatSeq;
    const stats = () => {
      if (seq !== this.fmtStatSeq) return;
      const cached = this.fmtCounts;
      if (cached?.version === this.fmtVersion) {
        store.set({ fmt: { lines: this.fmt.lineCount, pretty: cached.pretty, minified: cached.minified, escaped: cached.escaped } });
        return;
      }
      const metrics = this.goodMetrics;
      const root = this.good?.root;
      if (metrics || !root) return counts(metrics ? metrics.extra + metrics.units * this.indent.length : 0);
      // (No worker measured it: the tree is walked here, a big one in short steps.)
      const walk = prettyExtraIn(root, this.indent.length);
      const step = () => {
        if (seq !== this.fmtStatSeq) return;
        const extra = walk(text.length > 500_000 ? performance.now() + 8 : Infinity);
        if (extra === undefined) soon(step);
        else counts(extra);
      };
      step();
    };
    const counts = (extra: number) => {
      const { minify, escape } = this.settings;
      const metrics = this.goodMetrics;
      const bytes = metrics ? metrics.min + (this.settings.minify || this.settings.escape ? 0 : extra) : byteLength(text);
      const min = !text ? 0 : minify || escape ? bytes : bytes - extra;
      const sizes = { pretty: text ? min + extra : 0, minified: min, escaped: escape && text ? metrics?.escaped ?? byteLength(this.fmt.text) : 0 };
      this.fmtCounts = { version: this.fmtVersion, ...sizes };
      store.set({ fmt: { lines: this.fmt.lineCount, ...sizes } });
    };
    // A big document's sizes wait for a quiet moment (they only label the Pretty / Minify buttons).
    if (text.length > 500_000) idle(stats, 1000);
    else stats();
  };
  private fmtStatSeq = 0;

  /** The Format view's settings, as a key: output is redrawn when they or the document change. */
  private fmtSettings() {
    const { minify, escape, sortKeys } = this.settings;
    return `${minify}${escape}${sortKeys}${this.indent}`;
  }

  /** Shows `text` (the formatted `src`) in the Format view. */
  private drawFormat(text: string, key: string, index?: CodeIndex, display?: string, change?: CodeChange, patch?: string, inline = false, version: object | null = this.goodVer) {
    if (store.get().fmt.tooLarge) store.set({ fmt: { ...store.get().fmt, tooLarge: false } });
    if (!change) this.fmtWorkerId = 0;
    this.pendingFmtWorkerId = 0;
    this.fmtVersion++;
    this.fmtStatSeq++;
    const { minify, escape } = this.settings;
    this.fmtSrcVer = version;
    this.fmtKey = key;
    this.fmtText = text;
    const out = display ?? (escape && text ? JSON.stringify(text) : text);
    this.fmt.setText(out, jsonRow, true, null, index, change, patch, inline);
    this.noteExpiry(minify || escape ? '' : out);
  }

  /**
   * A decoded JWT's formatted output labels the payload's exp line with how long
   * until (or since) it expires, kept current while the view is open.
   */
  private noteExpiry(out: string) {
    clearTimeout(this.expTimer);
    const exp = this.jwt?.exp;
    const at = exp === undefined || !out ? -1 : out.indexOf('"payload"');
    const m = at < 0 ? null : /\n[ \t]*"exp":[ \t]*-?\d/g;
    if (m) m.lastIndex = at;
    const hit = m?.exec(out);
    if (!hit || exp === undefined) return this.fmt.setNotes(null);
    let line = 1;
    for (let i = out.indexOf('\n'); i >= 0 && i < hit.index; i = out.indexOf('\n', i + 1)) line++;
    const left = exp - Date.now() / 1000;
    const text = escapeHtml(left > 0 ? rt('expires in {duration}', { duration: rt.dur(left, true) }) : rt('expired {duration} ago', { duration: rt.dur(-left, true) }));
    this.fmt.setNotes(new Map([[line, `<span class="cv-note-tag${left > 0 ? '' : ' warn'}">${text}</span>`]]));
    this.expTimer = window.setTimeout(() => this.settings.view === 'format' && this.noteExpiry(out), Math.abs(left) < 3600 ? 1000 : 30_000);
  }

  /** Replaces the input with the Format view's output (undoable). */
  useOutput() {
    const r = this.fresh();
    if (!r?.root) return this.toast(r ? "Can't do that yet. Fix the error first." : 'Nothing to format yet', r ? 'err' : 'info');
    track('feature_used', { feature: 'use_output' });
    const s = this.settings;
    const fixed = this.fixed(r);
    this.transform(
      (res, t) => (s.escape ? JSON.stringify(formatDoc(t, res, '', s.sortKeys)) : formatDoc(t, res, s.minify ? '' : this.indent, s.sortKeys)),
      () => (s.escape ? 'Escaped input to a JSON string' : s.minify ? 'Minified input' : 'Formatted input') + fixed,
    );
  }

  copyOutput() {
    const out = this.fmt.text || this.unlessTooLarge(() => this.output());
    if (out === null) return;
    if (!out) return store.get().fmt.tooLarge ? this.toast('The result is too large', 'err') : this.toast('Nothing to copy yet', 'info');
    track('feature_used', { feature: 'copy_output' });
    void this.copy(out, this.settings.escape ? 'Copied as a JSON string' : this.settings.minify ? 'Copied minified JSON' : 'Copied formatted JSON');
  }

  downloadOutput() {
    const out = this.fmt.text || this.unlessTooLarge(() => this.output());
    if (out === null) return;
    if (!out) return store.get().fmt.tooLarge ? this.toast('The result is too large', 'err') : this.toast('Nothing to download yet', 'info');
    track('feature_used', { feature: 'download_output' });
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    this.save(out, `${base}${this.settings.escape ? '.escaped' : this.settings.minify ? '.min' : ''}.json`, 'application/json');
  }

  // ── Convert ────────────────────────────────────────────────────────────

  setConvert(patch: Partial<Pick<Settings, 'target' | 'rootName' | 'tsStyle' | 'csharpLib'>>) {
    if (!this.presetting) {
      const s = this.settings;
      // The target and options come from fixed lists. The root type name is typed, so it is never sent.
      if (patch.target && patch.target !== s.target) {
        track('convert_target_selected', { target: targetInfo(patch.target).id, group: targetInfo(patch.target).group === 'Types' ? 'types' : 'data' });
      }
      if (patch.tsStyle && patch.tsStyle !== s.tsStyle) track('convert_option_changed', { option: 'ts_style', value: patch.tsStyle });
      if (patch.csharpLib && patch.csharpLib !== s.csharpLib) track('convert_option_changed', { option: 'csharp_lib', value: patch.csharpLib });
    }
    this.setSettings(patch);
    if (this.settings.view !== 'convert') this.setView('convert');
    else this.scheduleConvert(patch.rootName !== undefined ? 200 : 0);
  }

  private scheduleConvert(delay: number) {
    clearTimeout(this.convTimer);
    this.convSeq++;
    this.convTimer = window.setTimeout(() => void this.runConvert(), delay);
  }

  /** Bumped by each conversion asked for: one still loading its code then is dropped (the newer one shows). */
  private convSeq = 0;

  private async loadConverters(): Promise<ConvertModule> {
    if (!this.conv) {
      store.set({ convert: { ...store.get().convert, loading: true } });
      const mod = await import('../convert');
      // The module's start-up and the first conversion run as two shorter tasks.
      await new Promise((r) => setTimeout(r, 0));
      this.conv = mod;
    }
    return this.conv;
  }

  private async runConvert() {
    if (this.settings.view !== 'convert') return;
    const seq = ++this.convSeq;
    // (The view closed or changed meanwhile: opening it again converts what it shows then.)
    const current = () => seq === this.convSeq && !this.dead && this.settings.view === 'convert';
    const root = this.good?.root;
    if (!root) {
      this.code.setText('', escapeHtml);
      store.set({ convert: { loading: false, error: 'Paste or open valid JSON on the left to convert it.', lines: 0, bytes: 0 } });
      return;
    }
    if (this.good!.depth > MAX_WALK_DEPTH) {
      this.code.setText('', escapeHtml);
      store.set({ convert: { loading: false, error: 'Nesting is too deep to convert', lines: 0, bytes: 0 } });
      return;
    }
    try {
      const mod = await this.loadConverters();
      if (!current()) return;
      const s = this.settings;
      const info = targetInfo(s.target);
      // CSV and Excel share one flattening (dotted columns) over the main array of
      // records; Excel is a binary download, so its preview is the same table.
      const xlsx = info.id === 'xlsx' || info.id === 'csv' ? await import('../convert/xlsx') : null;
      if (!current()) return;
      const out = xlsx
        ? xlsx.toCsv(xlsx.records(root))
        : mod.convert(root, info.id, { rootName: s.rootName || 'Root', tsStyle: s.tsStyle, csharpLib: s.csharpLib });
      if (xlsx) this.code.setText(out, (line, _s, _e, state) => mod.csvLine(line, state), false, { start: mod.CSV_START, scan: mod.csvScan });
      else this.code.setText(out, (line) => mod.highlightCode(line, info.lang));
      store.set({ convert: { loading: false, error: null, lines: out ? out.split('\n').length : 0, bytes: out.length } });
    } catch (e) {
      if (!current()) return;
      // The CSV and Excel preview isn't behind convert(), which reports deep nesting itself.
      const deep = tooDeep(e);
      if (!deep) reportError(e, 'conversion');
      this.code.setText('', escapeHtml);
      store.set({ convert: { loading: false, error: deep ? 'Nesting is too deep to convert' : e instanceof Error ? e.message : 'Conversion failed', lines: 0, bytes: 0 } });
    }
  }

  copyConvert() {
    if (!this.code.text) return this.toast('Nothing to copy yet', 'info');
    track('feature_used', { feature: 'copy_convert' });
    void this.copy(this.code.text, `Copied ${targetInfo(this.settings.target).label}`);
  }

  async downloadConvert() {
    const s0 = this.settings;
    const info = targetInfo(s0.target);
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    const name =
      info.id === 'java'
        ? `${s0.rootName || 'Root'}.java` // a public Java class must live in a file of the same name
        : info.id === 'typescript' || info.id === 'zod'
          ? `${base}.${info.id === 'zod' ? 'schema.' : ''}ts`
          : `${base}.${info.ext}`;
    if (info.id === 'xlsx') {
      const root = this.good?.root;
      if (!root) return this.toast('Paste or open valid JSON first', 'info');
      if (this.good!.depth > MAX_WALK_DEPTH) return this.toast('Nesting is too deep to convert', 'err');
      try {
        const { records, toXlsx } = await import('../convert/xlsx');
        this.saveBlob(await toXlsx(records(root), { sheetName: base.slice(0, 31) || 'Sheet1' }), name);
      } catch (error) {
        if (tooDeep(error)) return this.toast('Nesting is too deep to convert', 'err');
        reportError(error, 'export');
        this.toast("Couldn't create the Excel file", 'err');
      }
      return;
    }
    if (!this.code.text) return this.toast('Nothing to download yet', 'info');
    this.save(this.code.text, name, info.mime);
  }

  tableShow(n: JNode | null) {
    this.tablePath = n ? pathOf(n) : [];
    this.table.setNode(n);
    this.syncTableState();
  }

  tableGoto(segs: Seg[]) {
    const root = this.good?.root ?? null;
    this.tableShow(resolve(root, segs) ?? root);
  }

  private syncTableState() {
    const n = this.table.node;
    store.set({ table: { segs: n ? pathOf(n) : [], rows: this.table.rowCount, cols: this.table.colCount, ok: !!n } });
  }

  copyCSV() {
    const csv = this.table.toCSV();
    if (!csv) return this.toast('Open an array or object in the table first', 'info');
    track('feature_used', { feature: 'copy_csv' });
    void this.copy(csv, 'Copied table as CSV');
  }

  downloadCSV() {
    const csv = this.table.toCSV();
    if (!csv) return this.toast('Open an array or object in the table first', 'info');
    track('feature_used', { feature: 'download_csv' });
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    this.save(csv, `${base}.csv`, 'text/csv');
  }

  // ── Folding (acts on the open view: format, convert or tree) ────────────

  private foldView() {
    const v = this.settings.view;
    if (v !== 'format' && v !== 'convert' && v !== 'tree' && v !== 'graph') this.setView('format');
    return this.settings.view;
  }

  expandAll() {
    const v = this.foldView();
    track('feature_used', { feature: 'expand_all', view: v });
    if (v === 'graph') this.graph?.expandAll();
    else if (v === 'tree') this.tree.expandAll();
    else (v === 'format' ? this.fmt : this.code).unfoldAll();
  }

  collapseAll() {
    if (this.settings.view === 'graph') this.graph?.collapseAll();
    else this.expandTo(1, false);
    track('feature_used', { feature: 'collapse_all', view: this.settings.view });
  }

  /** Show `level` levels; everything deeper is folded. */
  expandTo(level: number, report = true) {
    const v = this.foldView();
    if (report) track('feature_used', { feature: 'expand_level', view: v, level });
    if (v === 'graph') this.graph?.expandTo(level);
    else if (v === 'tree') this.tree.expandTo(level);
    else (v === 'format' ? this.fmt : this.code).foldLevel(level);
  }

  // ── Find (searches the open view) ───────────────────────────────────────

  private findIn(view: View, q: string): FindResult {
    switch (view) {
      case 'graph':
        return this.graph?.search(q, true) ?? { total: 0, index: -1 };
      case 'tree':
        return this.tree.search(q, true);
      case 'format':
        return this.fmt.find(q);
      case 'convert':
        return this.code.find(q);
      case 'table':
        return this.table.find(q);
      default:
        return { total: 0, index: -1 };
    }
  }

  find(q: string, external = false) {
    // One event per search (not per keystroke). Whether it is a JSONPath is all that is kept of the query.
    if (q && !this.query) track('feature_used', { feature: 'find', view: this.settings.view, jsonpath: q.trimStart().startsWith('$') });
    this.query = q;
    const f = store.get().find;
    store.set({ find: { open: true, q, seq: f.seq + (external ? 1 : 0), ...this.findIn(this.settings.view, q) } });
  }

  /** Re-applies the query to the current view (after data or view changes). */
  private refind(jump: boolean) {
    const v = this.settings.view;
    const r = v === 'graph' && this.graph ? this.graph.search(this.query, jump) : v === 'tree' ? this.tree.search(this.query, jump) : this.findIn(v, this.query);
    store.set({ find: { ...store.get().find, total: r.total, index: r.index, note: r.note } });
  }

  findStep(dir: 1 | -1) {
    const v = this.settings.view;
    const r: FindResult =
      v === 'graph' && this.graph ? this.graph.step(dir) : v === 'tree' ? this.tree.step(dir) : v === 'format' ? this.fmt.step(dir) : v === 'convert' ? this.code.step(dir) : v === 'table' ? this.table.step(dir) : { total: 0, index: -1 };
    store.set({ find: { ...store.get().find, ...r } });
  }

  /** Enter in the find bar: run a pending query, otherwise go to the next match. */
  findSubmit(q: string, dir: 1 | -1) {
    if (q !== this.query) this.find(q);
    else this.findStep(dir);
  }

  closeFind() {
    if (this.query) this.findIn(this.settings.view, '');
    this.query = '';
    store.set({ find: { open: false, q: '', total: 0, index: -1, seq: store.get().find.seq + 1 } });
  }

  // ── Copy / download what the open view shows ────────────────────────────

  copyView() {
    switch (this.settings.view) {
      case 'graph':
      case 'tree':
        return this.sel ? this.copyValue(this.sel) : this.copyOutput();
      case 'table':
        return this.copyCSV();
      case 'convert':
        return this.copyConvert();
      default:
        return this.copyOutput();
    }
  }

  downloadView() {
    switch (this.settings.view) {
      case 'graph':
        return this.openGraphExport();
      case 'table':
        return this.downloadCSV();
      case 'convert':
        return void this.downloadConvert();
      default:
        return this.downloadOutput();
    }
  }

  private withGraph(run: () => void) {
    if (this.settings.view === 'graph' && this.graph) run();
    else this.setView('graph', run);
  }

  fitGraph() {
    this.withGraph(() => {
      track('feature_used', { feature: 'graph_fit' });
      this.graph?.fit();
    });
  }

  zoomGraph(factor: number) {
    if (!this.graph || this.settings.view !== 'graph') return;
    track('feature_used', { feature: factor > 1 ? 'graph_zoom_in' : 'graph_zoom_out' });
    this.graph.zoomBy(factor);
  }

  /** The graph's export dialog (format, area, background, size, name). */
  openGraphExport() {
    this.withGraph(() => store.set({ graphExport: true }));
  }

  /** What an export with these options would produce (for the dialog). */
  graphExportPreview(opts: GraphExport) {
    return this.graph && this.settings.view === 'graph' ? this.graph.exportPreview(opts) : Promise.resolve(null);
  }

  /** The document's name without its extension, for downloads. */
  private docBase() {
    return (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
  }

  /** Downloads the graph as an image; `name` without an extension (default: the document's name). */
  downloadGraph(opts: GraphExport | 'png' | 'svg', name?: string) {
    const o: GraphExport = typeof opts === 'string' ? { format: opts, area: 'all', background: 'theme', scale: 2 } : opts;
    this.withGraph(() => {
      if (!this.graph) return;
      track('feature_used', { feature: o.format === 'png' ? 'graph_export_png' : o.format === 'jpeg' ? 'graph_export_jpeg' : 'graph_export_svg' });
      const file = `${name?.trim() || this.docBase()}.${o.format === 'jpeg' ? 'jpg' : o.format}`;
      let reduced: [number, number] | null = null;
      void this.graph.exportImage(o, (w, h) => (reduced = [w, h])).then((blob) => {
        if (this.dead) return;
        this.saveBlob(blob, file);
        if (reduced) this.reducedToast(reduced);
      }).catch((error) => {
        reportError(error, 'export');
        if (!this.dead) this.toast(rt("Couldn't download graph: {error}", { error: rt.msg(error instanceof Error ? error.message : 'Graph export failed') }), 'err');
      });
    });
  }

  /** Copies the graph as a PNG image. Call from the click itself: browsers only allow it during user input. */
  copyGraphImage(opts?: GraphExport) {
    const graph = this.graph;
    if (!graph || this.settings.view !== 'graph') return;
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      this.toast(rt("Copying images isn't supported in this browser. Download it instead."), 'err');
      return;
    }
    track('feature_used', { feature: 'graph_copy_image' });
    // The item takes the image's promise right away, which Safari needs to keep the user's permission.
    let reduced: [number, number] | null = null;
    // Without options (menu, palette): the export dialog's last choices, loaded with the image.
    const chosen = opts ? Promise.resolve(opts) : import('../graph/export-prefs').then((m) => m.exportOptions(m.loadExportPrefs()));
    const png = chosen.then((o) => graph.exportImage({ ...o, format: 'png' }, (w, h) => (reduced = [w, h])));
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => {
        if (this.dead) return;
        if (reduced) this.reducedToast(reduced);
        else this.toast(rt('Copied the image'), 'ok');
      },
      (error) => {
        if (this.dead) return;
        const msg = error instanceof Error && error.name !== 'NotAllowedError' ? error.message : "The browser didn't allow it";
        this.toast(rt("Couldn't copy the image: {error}", { error: rt.msg(msg) }), 'err');
      },
    );
  }

  /** The browser couldn't make the image as big as planned (iPhones and iPads allow smaller canvases). */
  private reducedToast([width, height]: [number, number]) {
    this.toast(rt('This device allows smaller images: it was reduced to {width} × {height} px.', { width: rt.num(width), height: rt.num(height) }), 'info');
  }

  /** Shows the start (root) or the end (lowest card) of the graph. */
  graphJump(to: 'start' | 'end') {
    this.withGraph(() => {
      track('feature_used', { feature: 'graph_jump' });
      this.graph?.jump(to);
    });
  }

  /** Opens the find bar for the open view, prefilled with the editor selection. */
  focusSearch() {
    if (this.settings.view === 'compare') this.setView('format');
    const picked = this.ed.hasFocus() ? this.ed.selectedText() : '';
    if (picked && picked.length < 100 && !picked.includes('\n')) this.find(picked, true);
    else store.set({ find: { ...store.get().find, open: true } });
    // The find bar focuses its input when it opens; re-focus if it was already open.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('.findbar input');
      input?.focus();
      input?.select();
    });
  }

  focusTree() {
    if (this.settings.view !== 'tree') this.setView('tree', () => requestAnimationFrame(() => this.tree.focus()));
    else this.tree.focus();
  }

  /** Esc in the editor: move focus to the viewer without changing views. */
  private leaveEditor() {
    if (this.settings.view === 'graph' && !store.get().empty) this.graph?.focus();
    else if (this.settings.view === 'tree' && !store.get().empty) this.tree.focus();
    else document.querySelector<HTMLElement>('.pane-view [role="tab"][aria-selected="true"]')?.focus();
  }

  focusEditor() {
    this.ed.focus();
  }

  /** Files opened from the OS with the installed app (manifest file_handlers). */
  private handleLaunch() {
    type LaunchParams = { files?: { getFile(): Promise<File> }[] };
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
    lq?.setConsumer(async (p) => {
      const h = p.files?.[0];
      const f = await h?.getFile();
      if (f && !this.dead) void this.loadFile(f, 'launch');
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────

  private setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    store.settings(patch);
    if (this.presetting) return;
    this.saved = { ...this.saved, ...patch };
    write(KEYS.settings, JSON.stringify(this.saved));
  }

  /**
   * Shows a landing page's sample in its view. The visitor's saved document and
   * settings stay as they were (a format page doesn't leave the homepage sorting
   * keys); changes the visitor then makes are saved as usual.
   */
  applyPreset(p: EnginePreset) {
    const s = p.settings ?? {};
    this.presetting = true;
    try {
      this.load(p.initialText ?? '', p.initialFileName ?? null, false);
      if (s.view === 'convert') {
        this.setConvert({ target: s.target ?? 'typescript', rootName: s.rootName ?? 'Root', tsStyle: s.tsStyle ?? 'interface' });
      } else if (s.view) {
        this.setView(s.view);
        if (s.view === 'format') this.setFormat({ minify: s.minify ?? false, sortKeys: s.sortKeys ?? false, escape: s.escape ?? false });
      }
    } finally {
      this.presetting = false;
    }
    if (p.initialImport) window.setTimeout(() => { if (!this.dead) void this.importAs(p.initialImport!); }, 0);
  }

  setIndent(indent: IndentId) {
    if (indent !== this.settings.indent) track('format_option_changed', { option: 'indent', value: indent });
    this.setSettings({ indent });
    this.ed.indentUnit = INDENTS[indent];
    this.ed2.indentUnit = INDENTS[indent];
    if (this.settings.view === 'format') this.scheduleFormat(0);
  }

  setTheme(theme: Theme) {
    track('feature_used', { feature: 'theme', value: theme });
    this.setSettings({ theme });
    this.applyTheme(theme);
  }

  cycleTheme() {
    const order: Theme[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.settings.theme) + 1) % 3];
    this.setTheme(next);
    this.toast(`Theme: ${next === 'system' ? 'match system' : next}`, 'info');
  }

  /** Soft wrap on or off, in both editors and both code views. */
  toggleWrap() {
    track('feature_used', { feature: 'wrap', on: !this.settings.wrap });
    this.setSettings({ wrap: !this.settings.wrap });
    this.applyWrap();
  }

  private applyWrap() {
    const on = this.settings.wrap;
    this.ed.setWrap(on);
    this.ed2.setWrap(on);
    this.fmt.setWrap(on);
    this.code.setWrap(on);
  }

  toggleAutoFormat() {
    track('feature_used', { feature: 'auto_format', on: !this.settings.autoFormat });
    this.setSettings({ autoFormat: !this.settings.autoFormat });
    this.toast(`Auto-format on paste ${this.settings.autoFormat ? 'on' : 'off'}`, 'info');
  }

  setSplit(split: number) {
    this.setSettings({ split: Math.min(0.8, Math.max(0.2, split)) });
  }

  private onSystemTheme = () => {
    if (this.settings.theme === 'system') this.graphThemeChanged();
  };

  private graphThemeChanged() {
    requestAnimationFrame(() => { if (!this.dead) this.graph?.themeChanged(); });
  }

  private applyTheme(theme: Theme) {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    write(KEYS.theme, theme === 'system' ? null : theme);
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      const media = m.getAttribute('media') ?? '';
      const own = media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
      m.content = theme === 'system' ? own : THEME_COLORS[theme];
    });
    this.graphThemeChanged();
  }

  // ── UI helpers ─────────────────────────────────────────────────────────

  get mod() {
    return store.get().mac ? '⌘' : 'Ctrl+';
  }

  /** `ms`: how long it stays, for messages longer than a glance (default 2.2 s, errors 4 s; with an action, until dismissed). */
  toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info', action?: { label: string; run: () => void }, ms?: number) {
    // (Gone: a late confirmation would show in the next tool, without the timer that hides it.)
    if (this.dead) return;
    clearTimeout(this.toastTimer);
    store.set({ toast: { id: ++this.toastId, msg, kind, action } });
    if (!action) this.toastTimer = window.setTimeout(() => store.set({ toast: null }), ms ?? (kind === 'err' ? 4000 : 2200));
  }

  openPalette(mode: 'commands' | 'url' = 'commands') {
    track('feature_used', { feature: mode === 'url' ? 'load_url_dialog' : 'palette' });
    store.set({ palette: mode, shortcuts: false });
  }

  private onKey = (e: KeyboardEvent) => {
    const s = store.get();
    // (The open context menu has the keys.)
    if (s.palette || s.shortcuts || s.menu || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
    const k = e.key.toLowerCase();
    let run: (() => void) | null = null;
    // The menu key or Shift+F10 (also on macOS, which has neither): the context menu, at the caret or selection.
    const area = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !mod && !e.altKey) ? this.menuArea(t) : null;
    if (area) {
      this.menuKeyAt = e.timeStamp;
      run = () => this.openMenu(area, t);
    } else if (mod && !e.altKey && (k === 'k' || (e.shiftKey && k === 'p'))) run = () => this.openPalette();
    else if (mod && !e.altKey && e.key === 'Enter' && this.ed2.hasFocus()) run = () => this.formatCompare();
    else if (mod && !e.altKey && e.key === 'Enter') run = e.shiftKey ? () => this.minify() : () => this.useOutput();
    else if (e.altKey && e.shiftKey && !mod && e.code === 'KeyF') run = () => this.format();
    else if (mod && !e.shiftKey && !e.altKey && k === 's') run = () => this.download();
    else if (mod && !e.shiftKey && !e.altKey && k === 'o') run = () => this.openFile();
    else if (mod && !e.shiftKey && !e.altKey && k === 'f') run = () => this.focusSearch();
    // Alt+Z like VS Code (on macOS, Option+Z types Ω: not while typing).
    else if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ' && !(s.mac && typing)) run = () => this.toggleWrap();
    // On macOS, Option+digit types characters (#, €…): never steal it while typing.
    else if (e.altKey && !mod && /^Digit[1-6]$/.test(e.code) && !(s.mac && typing)) {
      const views: View[] = ['format', 'tree', 'table', 'graph', 'convert', 'compare'];
      run = () => this.setView(views[Number(e.code.slice(5)) - 1]);
    }
    else if (!typing && !mod && !e.altKey) {
      if (e.key === '/') run = () => this.focusSearch();
      else if (e.key === '?') run = () => store.set({ shortcuts: true });
    }
    if (run) {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  };

  // ── Context menu (components/ContextMenu.tsx) ─────────────────────────

  private menuSeq = 0;
  /** What the open menu's Copy copies: the selection it opened on (null: none, Copy copies everything). */
  private menuClip: (() => string) | null = null;
  /** The node it opened on (tree, table, graph). */
  private menuNode: JNode | null = null;
  /** Compare's differences: what it opened on. */
  private menuDiff: DiffMenu | null = null;
  /** When a key last opened it: the browser may send its own contextmenu event for that key too. */
  private menuKeyAt = -Infinity;
  /** The last press: a long press on a touch screen keeps the phone's own menu. */
  private press = { type: '', at: -Infinity };

  private onPress = (e: PointerEvent) => {
    this.press = { type: e.pointerType, at: e.timeStamp };
  };

  /** The content area at `el` that has a context menu (null: the browser's menu). */
  private menuArea(el: Element): MenuArea | null {
    const { editor, editor2, fmt, code, tree, table, graph, compare } = this.els;
    return editor.contains(el) ? 'input'
      : editor2.contains(el) ? 'compare'
      : fmt.contains(el) ? 'format'
      : code.contains(el) ? 'convert'
      : tree.contains(el) ? 'tree'
      : table.contains(el) ? 'table'
      : graph.contains(el) ? 'graph'
      // (Its differences, not the options above them: one is a text field.)
      : compare.contains(el) && el.closest('.cmp-lw') ? 'diff'
      : null;
  }

  private onContextMenu = (e: MouseEvent) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const area = this.menuArea(t);
    if (!area) return;
    // The browser's own event for the key that just opened the menu.
    if (store.get().menu?.keyboard && e.timeStamp - this.menuKeyAt < 1000) return void e.preventDefault();
    // Shift+right-click: the browser's own menu. A touch's long press: the phone's (text selection, copy, paste).
    if (e.shiftKey || (e as PointerEvent).pointerType === 'touch' || (this.press.type === 'touch' && e.timeStamp - this.press.at < 2000)) return;
    e.preventDefault();
    this.openMenu(area, t, { x: e.clientX, y: e.clientY });
  };

  /** The text selected on screen inside `el`, for Copy (null: none). */
  private shownClip(el: HTMLElement) {
    const s = window.getSelection();
    const text = s?.rangeCount && el.contains(s.anchorNode) ? s.toString() : '';
    return text ? () => text : null;
  }

  /**
   * Opens the context menu for `area`: at a right click's point (which first moves the caret or
   * selects the node there, as a click would), or from the keyboard at the caret or selected node.
   */
  private openMenu(area: MenuArea, target: Element, at?: { x: number; y: number }) {
    const els = this.els;
    const host = area === 'input' ? els.editor : area === 'compare' ? els.editor2 : area === 'format' ? els.fmt : area === 'convert' ? els.code : area === 'diff' ? els.compare : els[area];
    const box = host.getBoundingClientRect();
    const menu: ContextMenu = {
      id: ++this.menuSeq, area, keyboard: !at, x: at?.x ?? box.left + 16, y: at?.y ?? box.top + 16, top: at?.y ?? box.top + 16,
      blank: false, sel: false, cut: false, paste: false, undo: false, redo: false, fold: null, node: null, diff: null,
    };
    let clip: (() => string) | null = null;
    let node: JNode | null = null;
    if (area === 'input' || area === 'compare') {
      const ed = area === 'input' ? this.ed : this.ed2;
      // (A document still on its way arrives first, as for a click.)
      if (area === 'input') this.flushLoad();
      const line = at ? ed.menuAt(at.x, at.y) : ed.lineOf(ed.caret);
      if (!at) {
        const c = ed.caretBox();
        Object.assign(menu, { x: c.x, y: c.bottom, top: c.top });
      }
      clip = ed.clip();
      Object.assign(menu, { blank: !ed.length, fold: ed.foldTarget(line), cut: ed.canCut, paste: ed.canPaste, undo: ed.canUndo, redo: ed.canRedo });
    } else if (area === 'format' || area === 'convert') {
      const cv = area === 'format' ? this.fmt : this.code;
      if (at) menu.fold = cv.foldTarget(cv.lineAt(at.y));
      clip = this.shownClip(cv.el);
    } else if (area === 'diff') {
      // (The row under the pointer is selected first, as a click selects it.)
      const d = getDiffMenu(at ? target : null);
      if (!d) return;
      menu.diff = d;
      if (!at && d.box) Object.assign(menu, { x: d.box.left + 24, y: d.box.bottom, top: d.box.top });
      clip = this.shownClip(els.compare);
    } else {
      // The node under the pointer is selected first, as a click selects it.
      if (at) node = area === 'tree' ? this.tree.pick(target) : area === 'table' ? this.table.pick(target) : (this.graph?.pickAt(at.x, at.y) ?? null);
      else if (area === 'tree') {
        node = this.tree.sel;
        const r = this.tree.selBox();
        if (r) Object.assign(menu, { x: r.left + 24, y: r.bottom, top: r.top });
      } else node = this.sel;
      if (node) menu.node = { open: area === 'tree' && node.t >= ARR ? !!node.x : null, str: node.t === STR };
      if (area !== 'graph') clip = this.shownClip(this.els[area]);
    }
    this.menuClip = clip;
    this.menuNode = node;
    this.menuDiff = menu.diff;
    menu.sel = !!clip;
    track('feature_used', { feature: 'context_menu', value: area });
    store.set({ menu });
  }

  /** Where focus goes back to when the menu closes. */
  menuFocus(area: MenuArea) {
    if (area === 'input') this.ed.focus();
    else if (area === 'compare') this.ed2.focus();
    else if (area === 'format' || area === 'convert') (area === 'format' ? this.fmt : this.code).el.focus({ preventScroll: true });
    else if (area === 'tree') this.tree.focus();
    else if (area === 'graph') this.graph?.focus();
    else if (area === 'diff') this.menuDiff?.focus();
  }

  private menuEditor(area: MenuArea) {
    return area === 'compare' ? this.ed2 : this.ed;
  }

  /** Fold or Unfold the block the menu opened on. */
  menuFold(area: MenuArea, line: number) {
    if (area === 'input' || area === 'compare') this.menuEditor(area).toggleFold(line);
    else if (area === 'format' || area === 'convert') (area === 'format' ? this.fmt : this.code).toggle(line);
  }

  /** Copy: the selection the menu opened on, else everything the area shows. */
  menuCopy(area: MenuArea) {
    const clip = this.menuClip;
    if (clip) return void this.copy(clip());
    if (area === 'input') void this.copyAll();
    else if (area === 'compare') {
      if (!this.ed2.length) return this.toast('Nothing to copy yet', 'info');
      void this.copy(this.ed2.text, 'Copied the modified document');
    } else if (area === 'convert') this.copyConvert();
    else this.copyOutput();
  }

  menuCut(area: MenuArea) {
    const ed = this.menuEditor(area);
    if (!this.menuClip || !ed.canCut) return;
    void this.copy(this.menuClip());
    ed.cut();
  }

  /** Paste: the browser asks to read the clipboard (or shows its own Paste button); without it, the paste key still works. */
  async menuPaste(area: MenuArea) {
    const ed = this.menuEditor(area);
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      ed.focus();
      return this.toast(`Press ${this.mod}V to paste`, 'info');
    }
    if (this.dead) return;
    if (!text) return this.toast('Your clipboard is empty', 'info');
    noteLoad('paste', area === 'compare' ? 2 : 1);
    ed.paste(text);
  }

  menuSelectAll(area: MenuArea) {
    this.menuEditor(area).selectEverything();
  }

  menuUndo(area: MenuArea, redo: boolean) {
    if (area === 'input') return redo ? this.redo() : this.undo();
    if (redo) this.ed2.redo();
    else this.ed2.undo();
  }

  /** Tree: expand or collapse the node the menu opened on. */
  menuToggle() {
    const n = this.menuNode;
    if (n && n.t >= ARR) this.tree.toggle(n, !n.x);
  }

  /** Tree and graph: select the node's text in the input editor. */
  menuShow() {
    if (this.menuNode) this.openInEditor(this.menuNode);
  }

  private hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  private onDragEnter = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    this.reindentWorker();
    this.dragDepth++;
    store.set({ dragging: true });
  };

  private onDragOver = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  private onDragLeave = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    if (--this.dragDepth <= 0) {
      this.dragDepth = 0;
      store.set({ dragging: false });
    }
  };

  private onDrop = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    store.set({ dragging: false });
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    // Dropped on the Compare column: that's the modified document.
    if ((e.target as HTMLElement | null)?.closest?.('.pane-cmp')) void this.loadCompareFile(f, 'drop');
    else void this.loadFile(f, 'drop');
  };

  // ── Persistence & offline ──────────────────────────────────────────────

  /** A save waiting for an idle moment (see persistSoon); destroy() saves at once instead. */
  private persistIdle = 0;

  private persistSoon() {
    if (!this.persistEnabled) return;
    clearTimeout(this.persistTimer);
    // Big synchronous localStorage writes happen when the user is idle.
    this.persistTimer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        cancelIdleCallback(this.persistIdle);
        this.persistIdle = requestIdleCallback(this.persistNow, { timeout: 3000 });
      } else this.persistNow();
    }, 800);
  }

  private persistNow = () => {
    clearTimeout(this.persistTimer);
    if (!this.persistEnabled) return;
    const n = this.ed.length;
    write(KEYS.doc, n && n <= MAX_PERSIST ? this.ed.text : null);
  };

  /** Offers to reload into the new version the service worker has cached. */
  private offerUpdate() {
    this.toast('A new version is ready', 'info', { label: 'Reload', run: () => location.reload() });
  }

  /** Once per page (see swStarted): offline caching, and a notice when a new version is ready. */
  private registerSW() {
    // (One became ready while no tool was open: this one says so.)
    if (updateWaiting) {
      updateWaiting = false;
      this.offerUpdate();
    }
    if (swStarted || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    swStarted = true;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type !== 'updated') return;
      const open = getEngine();
      if (open) open.offerUpdate();
      else updateWaiting = true;
    });
    const go = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          // Load the lazy features once so they're cached for offline use and survive a
          // deploy while this tab stays open: one module per idle period, never a long task.
          const mods = [
            () => import('./sizes'),
            () => import('../convert'),
            () => import('../convert/import'),
            () => import('../convert/xlsx'),
            () => import('../json/smart'),
          ];
          const next = () => {
            const load = mods.shift();
            if (load) return void load().then(() => idle(next), () => idle(next));
            // Hand the SW every asset this page loaded so the app works offline.
            const urls = performance
              .getEntriesByType('resource')
              .map((e) => e.name)
              .filter((u) => u.startsWith(location.origin) && !u.includes('/_vercel/'));
            const home = /^\/[a-z]{2}(?=\/|$)/.exec(location.pathname)?.[0] || '/';
            reg.active?.postMessage({ type: 'cache', urls: [...new Set([location.origin + '/', location.origin + home, location.origin + location.pathname, ...urls])] });
          };
          idle(next);
        })
        .catch(() => {});
    };
    // Offline caching is never urgent: start well after the page has settled.
    if (document.readyState === 'complete') setTimeout(go, 4000);
    else window.addEventListener('load', () => setTimeout(go, 4000), { once: true });
  }

  /**
   * Gets the open path hot before a first file arrives, one short step per idle
   * period: the re-indenter and parser optimized (on text beyond Latin-1 too, since
   * engines optimize for the kinds of strings they have seen), each common script's
   * fallback font found, and the worker started.
   */
  private warmUp() {
    if (process.env.NODE_ENV !== 'production') return;
    const go = () =>
      import('./sample').then(({ SAMPLE }) => {
        if (this.dead) return;
        const doc = `[${Array(150).fill(SAMPLE).join(',')},"Zürich – 東京"]`;
        const steps: (() => unknown)[] = [];
        for (let k = 0; k < 4; k++) steps.push(() => reindent(doc, k & 1 ? '' : '  '), () => parse(doc));
        steps.push(
          () => {
            // First uses that cost: a number format (a big load's "Parsing… N%", about 20 ms), the fonts' glyphs.
            new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'percent' }).format(0);
            const x = document.createElement('canvas').getContext('2d');
            const cs = getComputedStyle(this.ed.el);
            if (!x) return;
            x.font = `${cs.fontSize} ${cs.fontFamily}`;
            for (const c of 'é Я α 中 あ 한 ب א ह ไ ✓ 😀'.split(' ')) x.measureText(c);
          },
          () => this.reindentWorker(),
          () => loadSurface(),
          () => import('../graph/view').catch(() => {}),
        );
        const next = () => {
          const step = steps.shift();
          if (!step || this.dead) return;
          step();
          idle(next);
        };
        idle(next);
      });
    this.warmSoon = () => {
      this.warmTimer = window.setTimeout(go, 4000);
    };
    if (document.readyState === 'complete') this.warmSoon();
    else window.addEventListener('load', this.warmSoon, { once: true });
  }

  /** The warm-up's wait for the page to settle (see warmUp): destroy() cancels it, and the steps left stop. */
  private warmTimer = 0;
  private warmSoon = () => {};
}
