import { ARR, JNode, OBJ, STR, parse, type ParseResult } from '../json/parser';
import { byteLength, copyText, formatDoc, reindent, reindenter, stringify } from '../json/format';
import { formatPath, nodeAt, pathOf, resolve, type Seg } from '../json/path';
import { packedPosition, unpacker, type PackedTree } from '../json/pack';
import { applyCodeChange, type CodeChange, type CodeIndex } from '../json/code-index';
import type { DocumentMetrics } from '../json/metrics';
import { Editor, loadSurface, type ChangeKind, type Diagnostic } from './editor';
import { TreeView } from './tree';
import { TableView } from './table';
import { CodeView } from './codeview';
import { escapeHtml, highlightLine } from './highlight';
import type { FindResult, LineHighlighter } from './codeview';
import { targetInfo } from './targets';
import { DEFAULT_SETTINGS, store, type Hint, type IndentId, type Settings, type Sizes, type Status, type EnginePreset, type Theme, type View } from './store';
import { readJwt, type JwtInput } from '../json/jwt';
import { rt } from '../i18n/ui';
import { idle, soon } from './idle';
import { jsonLines, persistenceAfterChange, persistenceAfterLoad } from './rules';

const KEYS = { doc: 'jf:doc', file: 'jf:file', settings: 'jf:settings', theme: 'jf:theme', cmp: 'jf:cmp' };
const INDENTS: Record<IndentId, string> = { '2': '  ', '4': '    ', tab: '\t' };
const MAX_PERSIST = 2_500_000;
const THEME_COLORS = { light: '#ffffff', dark: '#000000' };

export interface EngineEls {
  editor: HTMLElement;
  tree: HTMLElement;
  table: HTMLElement;
  file: HTMLInputElement;
  code: HTMLElement;
  fmt: HTMLElement;
  /** Compare: the second (modified) document's editor. */
  editor2: HTMLElement;
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
    if (!['format', 'tree', 'table', 'convert', 'compare'].includes(out.view)) out.view = 'format';
    if (!['format', 'tree', 'table', 'convert'].includes(out.prevView)) out.prevView = 'format';
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
 * every object key's colon (all ASCII).
 */
function prettyExtra(root: JNode, unit: number): number {
  if (root.t < ARR) return 0;
  let extra = 0;
  const stack: JNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as JNode;
    const list = n.v as JNode[];
    const k = list.length;
    if (!k) continue;
    extra += k * (1 + (n.d + 1) * unit) + 1 + n.d * unit + (n.t === OBJ ? k : 0);
    for (const c of list) if (c.t >= ARR) stack.push(c);
  }
  return extra;
}

/** Opened JSON Lines files: even one record reads as a list of records. */
const LINES_FILE = /\.(jsonl|ndjson)$/i;
/** From this size, a load in the Format view draws its output before the editor (see `load`). */
const OUTPUT_FIRST = 200_000;
/** From this size, that output is re-indented in a worker. */
const WORKER_MIN = 2_000_000;

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


export class Engine {
  readonly ed: Editor;
  /** Compare: the modified document. */
  readonly ed2: Editor;
  private cmpTimer = 0;
  /** Which editor the file picker loads into. */
  private fileTarget: 1 | 2 = 1;
  readonly tree: TreeView;
  readonly table: TableView;
  readonly code: CodeView;
  readonly fmt: CodeView;
  private els: EngineEls;
  private fmtTimer = 0;
  private expTimer = 0;
  /** Text that `good` was parsed from (needed by the native formatting fast path). */
  private goodText = '';
  private conv: ConvertModule | null = null;
  private convTimer = 0;

  /** Result for `parsed`. */
  private res: ParseResult | null = null;
  private parsed = '';
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
    this.applyTheme(this.settings.theme);

    this.ed = new Editor(els.editor, {
      change: this.onChange,
      caret: this.onCaret,
      nav: this.onNav,
      escape: () => this.leaveEditor(),
      mode: (viewOnly) => store.set({ viewOnly }),
      copyAll: () => void this.copyAll(),
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
      mode: () => undefined,
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
      if (this.markOutput) {
        this.markOutput = false;
        requestAnimationFrame(() => performance.mark('tk:formatted'));
      }
      if (this.settings.view === 'format' && this.goodText === this.fmtSrc) this.runFormat();
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
    this.analyze();
    if (this.ed2.text) this.analyzeCompare();
    delete document.documentElement.dataset.doc;

    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('dragenter', this.onDragEnter);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('drop', this.onDrop);
    window.addEventListener('pagehide', this.persistNow);
    window.addEventListener('hashchange', this.loadHash);
    this.ed.el.addEventListener('copy', this.onCopy);
    this.ed2.el.addEventListener('copy', this.onCopy2);
    els.file.addEventListener('change', this.onFile);

    store.set({ ready: true });
    void this.loadHash();
    this.loadQueryUrl();
    this.handleLaunch();
    if (!matchMedia('(pointer: coarse)').matches || !this.ed.text) this.ed.focus();
    this.registerSW();
    this.warmUp();
    // Warm the optional example after the editor can respond to input.
    idle(() => { if (!this.dead) void import('./sample').catch(() => {}); });
  }

  destroy() {
    this.worker?.terminate();
    this.dead = true;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('dragenter', this.onDragEnter);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('dragleave', this.onDragLeave);
    window.removeEventListener('drop', this.onDrop);
    window.removeEventListener('pagehide', this.persistNow);
    window.removeEventListener('hashchange', this.loadHash);
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
    this.loadSeq++; // Invalidate queued worker replies and unpacking as soon as typing resumes.
    this.workerParse = null;
    if (this.reindentJob && this.worker) {
      // A synchronous worker parse cannot consume a cancellation message until it finishes.
      this.worker.terminate();
      this.worker = undefined;
      this.workerWarm = false;
      this.reindentJob = null;
    }
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
    const len = this.ed.text.length;
    if (kind === 'paste' && this.ed.pasteFull && this.ed.text.trim()) {
      // A whole document arrived at once: no typing to wait out.
      const text = this.ed.text;
      const now = () => {
        this.loaded = true;
        this.analyze();
      };
      if (!this.outputFirst(text, null, now)) {
        this.loadSeq++;
        clearTimeout(this.timer);
        this.timer = window.setTimeout(now, 0);
      }
    } else if (!this.ed.text.trim()) {
      this.analyze();
    } else {
      if (len > 1_000_000) store.set({ status: { kind: 'parsing' } });
      clearTimeout(this.timer);
      this.timer = window.setTimeout(this.analyzeTyped, len < 100_000 ? 60 : len < 250_000 ? 160 : len < 5_000_000 ? 500 : 700);
    }
    if (this.persistEnabled) this.persistSoon();
  };

  /** Pretty-prints compact JSON right after it is pasted (one undo step reverts it). */
  private autoFormat = () => {
    const ed = this.ed;
    const text = ed.text;
    const lines = ed.ls.length;
    if (lines > 3 && text.length / lines < 160) return;
    // Parse without building views for the minified text: they'd be replaced at once.
    const r = text === this.parsed && this.res ? this.res : parse(text);
    if (!r.root || r.error || r.issues.length) return;
    const pretty = formatDoc(text, r, this.indent);
    if (pretty === text) return;
    clearTimeout(this.timer);
    ed.setValue(pretty);
    this.analyze();
    this.toast(`Auto-formatted · ${this.mod}Z to undo`, 'info');
  };

  private packed: { id: number; tree: PackedTree; text: string; metrics?: DocumentMetrics } | null = null;
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
    this.sel = this.selPath ? resolve(this.good.root, this.selPath) : null;
    this.tree.select(this.sel, { scroll: false });
  }

  /** Commands that need nodes materialize a deferred Format-view tree on demand. */
  private fresh(): ParseResult | null {
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
    const text = this.ed.text;
    if (!this.outputFirst(text, store.get().fileName, (res, metrics) => this.analyze(res, metrics), true)) this.analyze();
  };

  private goodMetrics: DocumentMetrics | null = null;

  /** Publish analysis; a Format-only result can retain its packed tree until needed. */
  analyze(parsed?: ParseResult, metrics?: DocumentMetrics, lazy = false) {
    if (!lazy) this.packed = null;
    clearTimeout(this.timer);
    const ed = this.ed;
    const text = ed.text;
    const reset = this.resetNext;
    this.resetNext = false;
    this.parsed = text;

    if (!text.trim()) {
      this.res = null;
      this.good = null;
      this.goodPacked = null;
      this.goodMetrics = null;
      this.jwt = null;
      ed.setJwt(null);
      this.goodText = '';
      this.sel = null;
      this.selPath = null;
      this.tablePath = [];
      this.tree.setRoot(null, true);
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
    const ms = performance.now() - t0;
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
      this.selPath = packedPosition(this.packed!.tree, ed.caret, text)?.path ?? null;
      this.tree.releaseRoot();
      // Format already has the worker's output. Nodes are needed only by commands and other views.
      this.goodText = src;
      ed.setScope(-1, -1);
    } else if (res.root) {
      this.goodMetrics = metrics ?? null;
      this.goodPacked = null;
      this.good = res;
      this.goodText = src;
      this.tree.setRoot(res.root, reset, res.nodes, this.settings.view === 'tree');
      this.sel = this.selPath ? resolve(res.root, this.selPath) : null;
      this.tree.select(this.sel, { scroll: false });
      if (this.settings.view === 'table') {
        this.table.setNode(resolve(res.root, this.tablePath) ?? res.root, true);
      } else this.table.setNode(null);
      ed.setScope(this.sel && this.sel.t >= ARR ? this.sel.s : -1, this.sel ? this.sel.e : -1);
    } else if (reset || !this.good && !this.goodPacked) {
      this.good = null;
      this.goodPacked = null;
      this.goodMetrics = null;
      this.goodText = '';
      this.tree.setRoot(null, true);
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
    else if (res.error || res.issues.length) hint = sniff(text);

    store.set({
      empty: false,
      stale: !lazy && !res.root && !!(this.good || this.goodPacked),
      status: jwt ? this.jwtStatus(jwt) : lines ? this.linesStatus(res, metrics?.records) : text.length <= 1_000_000 && JWT_RE.test(text.trim()) ? { kind: 'error', msg: "This looks like a JWT, but a part isn't valid base64url JSON", p: 0, ...this.ed.lineCol(0) } : this.statusOf(res),
      stats: { bytes: metrics?.bytes ?? byteLength(text), lines: ed.ls.length, nodes: res.nodes, depth: res.depth, ms },
      path: lazy && this.selPath ? formatPath(this.selPath) : this.sel ? formatPath(pathOf(this.sel)) : null,
      hint,
    });
    // The tree may have been hidden (empty state) while it was rebuilt; draw it once shown.
    if (this.settings.view === 'tree') requestAnimationFrame(() => this.tree.render(true));
    // Format/convert re-run their find when their text updates; the tree and table do it here.
    if (this.query && (this.settings.view === 'tree' || this.settings.view === 'table')) this.refind(false);
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
        const blob = new Blob([formatDoc(text, res, '')]);
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
    if (v === 'format') this.scheduleFormat(now ? 0 : this.ed.text.length > 1_000_000 ? 250 : 60);
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
    return !this.packed && !!this.res?.root && this.parsed === this.ed.text && !this.jwt;
  }

  // ── Selection sync ─────────────────────────────────────────────────────

  private onCaret = () => {
    if (!this.ed) return; // fired while the editor itself is still being constructed
    const [s, e] = this.ed.selection;
    const { line, col } = this.ed.lineCol(s);
    store.set({ cursor: { line, col, sel: Math.abs(e - s) } });
    this.updateBrackets();
  };

  /** Caret moved by the user → reveal the node under it in the tree. */
  private onNav = () => {
    if (this.packed?.id === this.loadSeq) {
      const at = packedPosition(this.packed.tree, this.ed.caret, this.packed.text);
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
    this.ed.setScope(-1, -1);
  };

  private updateBrackets() {
    if (this.packed?.id === this.loadSeq) {
      const off = this.ed.caret;
      const at = packedPosition(this.packed.tree, off, this.packed.text);
      const close = at ? at.end - 1 : -1;
      const c = this.packed.text.charCodeAt(close);
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

  private selectFromView(n: JNode, from: 'tree' | 'table' | 'search') {
    this.setSel(n);
    if (from === 'table') this.tree.select(n, { scroll: true, center: true });
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
    const next = fn(r, jwt ? jwt.json : before);
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

  private fixed = (r: ParseResult) => (r.issues.length ? ` · fixed ${r.issues.length} issue${r.issues.length > 1 ? 's' : ''}` : '');

  format() {
    this.transform(
      (r, t) => formatDoc(t, r, this.indent),
      (r) => 'Formatted' + this.fixed(r),
    );
  }

  minify() {
    this.transform(
      (r, t) => formatDoc(t, r, ''),
      (r) => 'Minified' + this.fixed(r),
    );
  }

  sortKeys() {
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
    this.format();
  }

  stringifyDoc() {
    this.transform(
      (r, t) => JSON.stringify(formatDoc(t, r, '')),
      () => 'Escaped to a JSON string',
    );
  }

  unescapeDoc() {
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
    const next = pr.root && !pr.error ? formatDoc(inner, pr, this.indent) : inner;
    this.ed.setValue(next);
    this.analyze();
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
      const r = importToJson(this.ed.text, fmt, this.indent);
      if ('error' in r) {
        this.toast(`Couldn't read ${fmt.toUpperCase()}: ${r.error}${r.line ? ` (line ${r.line})` : ''}`, 'err');
        return;
      }
      this.ed.setValue(r.json);
      this.analyze();
      this.toast(`Converted ${fmt.toUpperCase()} to JSON · ${this.mod}Z to undo`, 'ok');
    } catch {
      this.toast('Conversion failed', 'err');
    }
  }

  /** Turns a string value that holds JSON (`"{\"a\":1}"`) into real JSON, in place. */
  async expandNested(n: JNode | null = this.sel) {
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
    this.ed.setValue(formatDoc(next, r, minified ? '' : this.indent));
    this.analyze();
    const target = this.res?.root ? resolve(this.res.root, path) : null;
    if (target) {
      this.setSel(target);
      this.tree.select(target, { center: true });
      this.ed.setCaret(target.s);
    }
    this.toast(`Expanded nested JSON · ${this.mod}Z to undo`, 'ok');
  }

  /** Replaces a JWT input with its decoded header, payload and claims, to edit them. */
  decodeJwt() {
    const jwt = this.fresh() && this.jwt;
    if (!jwt) return this.toast('The input is not a JWT', 'info');
    this.ed.setValue(jwt.json);
    this.analyze();
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
    this.ed.undo();
  }

  redo() {
    this.ed.redo();
  }

  /** Downloads an .xlsx of the data without changing the current view. */
  async exportExcel() {
    const current = this.fresh();
    if (!current?.root) this.materializeGood();
    const root = current?.root ?? this.good?.root;
    if (!root) return this.toast('Paste or open valid JSON first', 'info');
    try {
      const { records, toXlsx } = await import('../convert/xlsx');
      const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
      this.saveBlob(await toXlsx(records(root), { sheetName: base.slice(0, 31) || 'Sheet1' }), `${base}.xlsx`);
    } catch {
      this.toast("Couldn't create the Excel file", 'err');
    }
  }

  // ── Commands: documents ────────────────────────────────────────────────

  /** `outputFirst`: the caller reads nothing back afterwards, so a big document may draw its output first. */
  load(text: string, name: string | null, persist = true, outputFirst = false) {
    this.persistEnabled = persistenceAfterLoad(this.persistEnabled, persist);
    this.resetNext = true;
    this.loadSeq++; // drops what an earlier load still has pending
    store.set({ fileName: name });
    if (persist) write(KEYS.file, name);
    if (outputFirst && this.outputFirst(text, name, () => this.finishLoad(text, persist, true))) return;
    this.finishLoad(text, persist);
  }

  /**
   * A big strict-JSON document in the Format view: draws its output first,
   * re-indented straight from the text (in a worker, or here in slices), and
   * calls `next` (its analysis) once that has painted. False if it doesn't apply.
   */
  private outputFirst(text: string, name: string | null, next: (res?: ParseResult, metrics?: DocumentMetrics) => void, typed = false): boolean {
    const s = this.settings;
    if (text.length < OUTPUT_FIRST || !typed && (s.view !== 'format' || s.sortKeys || LINES_FILE.test(name ?? '')) || readJwt(text, this.indent)) return false;
    const seq = ++this.loadSeq;
    clearTimeout(this.fmtTimer);
    clearTimeout(this.timer);
    const key = this.fmtSettings();
    const indent = s.minify || s.escape ? '' : this.indent;
    // The worker's parse (after typing) is rebuilt in short slices, input handled between them, then analysed.
    const analyse = (tree?: PackedTree, metrics?: DocumentMetrics) => {
      if (seq !== this.loadSeq) return;
      if (!tree) return next();
      if (typed && tree.nodes.length && this.fmtSrc === text && this.settings.view === 'format' && text.length >= WORKER_MIN) {
        this.packed = { id: seq, tree, text, metrics };
        this.analyze({ ...tree.head, root: null }, metrics, true);
        return;
      }
      const step = unpacker(tree, text);
      const run = () => {
        if (seq !== this.loadSeq) return;
        const res = step(performance.now() + 8);
        if (res) next(res, metrics);
        else soon(run);
      };
      run();
    };
    const done = (out: string | null, tree?: PackedTree, metrics?: DocumentMetrics, index?: CodeIndex, display?: string, change?: CodeChange & { base: number }, patch?: string) => {
      if (seq !== this.loadSeq) return;
      if (out === null || key !== this.fmtSettings() || typed && this.settings.view !== 'format') return analyse(tree, metrics);
      // On a first document the views are still hidden (empty state): show the output now.
      store.set({ empty: false, status: { kind: 'parsing' } });
      this.fmt.el.hidden = false;
      this.drawFormat(out, text, key, index, display, change?.base === this.fmtWorkerId ? change : undefined, patch);
      this.pendingFmtWorkerId = seq;
      // The rest (editor, analysis) a moment after the output has painted, when the page is idle:
      // the output can be scrolled and searched right away, without that work in the way.
      setTimeout(() => idle(() => analyse(tree, metrics), 1000), 300);
    };
    const here = () => {
      const run = reindenter(text, indent);
      const step = () => {
        if (seq !== this.loadSeq) return;
        const out = run(performance.now() + 40);
        if (out === undefined) soon(step);
        else soon(() => done(out));
      };
      step();
    };
    // A warm worker leaves the page free; a cold one would cost more than smaller documents take here.
    // Typing: the worker parses too, so nothing big is left for the page.
    const w = text.length < WORKER_MIN && !this.workerWarm && !typed ? null : this.reindentWorker();
    if (!w) {
      if (text.length < WORKER_MIN) done(reindent(text, indent));
      else here();
    } else {
      this.reindentJob = { id: seq, done, fallback: here, baseText: this.fmtText, baseSlice: this.fmt.snapshotText(), outParts: [], displayParts: [] };
      const request = { id: seq, indent, parse: typed, sortKeys: s.sortKeys, lines: LINES_FILE.test(name ?? ''), escape: s.escape, base: this.fmtWorkerId };
      if (text.length < WORKER_MIN) w.postMessage({ ...request, text });
      else {
        w.postMessage({ ...request, start: true });
        let at = 0;
        const send = () => {
          if (this.dead || seq !== this.loadSeq || this.worker !== w) return;
          const until = performance.now() + 8;
          do {
            const end = Math.min(text.length, at + 256_000);
            w.postMessage({ id: seq, chunk: text.slice(at, end), last: end === text.length });
            at = end;
          } while (at < text.length && performance.now() < until);
          if (at < text.length) soon(send);
        };
        soon(send);
      }
    }
    return true;
  }

  /** Bumped by every load: a deferred step of an older one is dropped. */
  private loadSeq = 0;
  /** null: unavailable (it failed to start), so loads re-indent on the main thread. */
  private worker: Worker | null | undefined;
  /** The worker has run its warm-up (see reindent.worker.ts). */
  private workerWarm = false;
  private measuredSizes: { id: number; sizes: Sizes } | null = null;
  private workerParse: { id: number; tree: PackedTree; metrics?: DocumentMetrics } | null = null;
  private reindentJob: { id: number; done: (out: string | null, tree?: PackedTree, metrics?: DocumentMetrics, index?: CodeIndex, display?: string, change?: CodeChange & { base: number }, patch?: string) => void; fallback: () => void; baseText: string; baseSlice: (a: number, b: number) => string; outParts: string[]; displayParts: string[] } | null = null;

  /** The re-indenting worker, started on first use or when a file is about to arrive. */
  private reindentWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      const w = new Worker(new URL('./reindent.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; out: string | null; tree?: PackedTree; metrics?: DocumentMetrics; index?: CodeIndex; display?: string; change?: CodeChange & { base: number }; sizes?: Sizes; patch?: string; chunk?: string; field?: 'out' | 'display'; chunkedOut?: boolean; chunkedDisplay?: boolean }>) => {
        if (e.data.id === -1) return void (this.workerWarm = true);
        if (e.data.id !== this.loadSeq) return;
        if (e.data.sizes) {
          this.measuredSizes = { id: e.data.id, sizes: e.data.sizes };
          store.set({ sizes: e.data.sizes });
          return;
        }
        if (e.data.tree) return void (this.workerParse = { id: e.data.id, tree: e.data.tree, metrics: e.data.metrics });
        const job = this.reindentJob;
        if (!job || job.id !== e.data.id) return;
        if (e.data.chunk !== undefined) {
          (e.data.field === 'display' ? job.displayParts : job.outParts).push(e.data.chunk);
          return;
        }
        this.reindentJob = null;
        const out = e.data.patch !== undefined && e.data.change ? applyCodeChange(job.baseText, e.data.patch, e.data.change, job.baseSlice) : e.data.chunkedOut ? job.outParts.join('') : e.data.out;
        const display = e.data.chunkedDisplay ? job.displayParts.join('') : e.data.display;
        job.done(out, this.workerParse?.id === job.id ? this.workerParse.tree : undefined, this.workerParse?.metrics, e.data.index, display, e.data.change, e.data.patch);
        this.workerParse = null;
      };
      w.onerror = () => {
        // It couldn't load (offline before it was ever cached, or blocked): work here instead.
        this.worker = null;
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
    this.ed.setValue(text, 0, true);
    if (this.refocus) this.ed.focus();
    this.refocus = false;
    const seq = this.loadSeq;
    const rest = () => {
      if (seq !== this.loadSeq) return;
      this.loaded = true;
      this.analyze();
      this.ed.el.scrollTop = 0;
      if (persist) this.persistSoon();
    };
    if (split) soon(rest);
    else rest();
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
    else void this.loadFile(f);
  };

  async loadFile(f: File) {
    performance.clearMarks('tk:formatted');
    performance.mark('tk:input');
    this.markOutput = true;
    if (f.size > 300 * 1024 * 1024) {
      this.toast('That file is too large to open in a browser tab', 'err');
      return;
    }
    try {
      const text = await f.text();
      if (this.dead) return;
      if (/\.(csv|tsv|ya?ml|xml|toml)$/i.test(f.name)) {
        const { detectFormat, importToJson } = await import('../convert/import');
        const fmt = detectFormat(text, f.name);
        if (fmt !== 'json' && fmt !== 'unknown') {
          const r = importToJson(text, fmt, this.indent);
          if ('json' in r) {
            this.load(r.json, f.name.replace(/\.[^.]+$/, '.json'));
            this.toast(`Converted ${f.name} to JSON`, 'ok');
            return;
          }
          this.toast(`Couldn't read ${f.name}: ${r.error}`, 'err');
        }
      }
      this.load(text, f.name, true, true);
      this.toast(`Opened ${f.name}`, 'ok');
    } catch {
      this.toast(`Couldn't read ${f.name}`, 'err');
    }
  }

  async paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        this.toast('Your clipboard is empty', 'info');
        return;
      }
      this.load(text, null);
      if (this.settings.autoFormat) this.autoFormat();
    } catch {
      this.ed.focus();
      this.toast(`Press ${this.mod}V to paste`, 'info');
    }
  }

  async sample() {
    const seq = this.sizeSeq;
    try {
      const { SAMPLE } = await import('./sample');
      if (this.dead || seq !== this.sizeSeq) return;
      this.load(SAMPLE, 'sample.json');
      this.toast('Loaded a sample. Try the tree, table and search.', 'info');
    } catch {
      this.toast("Couldn't read sample.json", 'err');
    }
  }

  clear() {
    this.resetNext = true;
    store.set({ fileName: null });
    write(KEYS.file, null);
    this.ed.setValue('');
    this.analyze();
    this.ed.focus();
  }

  async copyAll() {
    if (!this.ed.text) return this.toast('Nothing to copy yet', 'info');
    await this.copy(this.ed.text, 'Copied to clipboard');
  }

  copyValue(n: JNode | null = this.sel) {
    if (n === this.sel && this.goodPacked && this.selPath) { this.materializeGood(); n = this.sel; }
    if (!n) return this.toast('Select a node first', 'info');
    void this.copy(copyText(n, this.indent), n.t >= ARR ? 'Copied value as JSON' : 'Copied value');
  }

  copyPath(n: JNode | null = this.sel) {
    if (n === this.sel && this.goodPacked && this.selPath) return void this.copy(formatPath(this.selPath), 'Copied path');
    if (!n) return this.toast('Select a node first', 'info');
    void this.copy(formatPath(pathOf(n)), 'Copied path');
  }

  private async copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    this.toast(msg, 'ok');
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

  async loadCompareFile(f: File) {
    try {
      const text = await f.text();
      if (this.dead) return;
      this.loadCompare(text, f.name);
      if (this.settings.view !== 'compare') this.setView('compare');
      this.toast(`Comparing with ${f.name}`, 'ok');
    } catch {
      this.toast(`Couldn't read ${f.name}`, 'err');
    }
  }

  async pasteCompare() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return this.toast('Your clipboard is empty', 'info');
      this.loadCompare(text, null);
    } catch {
      this.ed2.focus();
      this.toast(`Press ${this.mod}V to paste`, 'info');
    }
  }

  formatCompare() {
    const text = this.ed2.text;
    if (!text.trim()) return this.toast('Paste the modified JSON first', 'info');
    const r = parse(text);
    if (!r.root) return this.toast("Can't format it yet. Fix the error first.", 'err');
    this.ed2.setValue(formatDoc(text, r, this.indent));
    this.analyzeCompare();
  }

  clearCompare() {
    store.set({ cmpFile: null });
    this.ed2.setValue('');
    this.analyzeCompare();
    this.ed2.focus();
  }

  /** Swap original and modified (both undoable). */
  swapCompare() {
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
    if (!this.ed.text) return this.toast('Nothing to download yet', 'info');
    const name = store.get().fileName || 'data.json';
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

  async share() {
    const r = this.fresh();
    if (!r?.root) return this.toast('Only valid JSON can be shared', 'err');
    try {
      const text = this.jwt ? this.ed.text.trim() : formatDoc(this.ed.text, r, '');
      const { toBase64Url } = await import('./sizes');
      const data = await toBase64Url(text);
      if (data.length > 60_000) return this.toast('Too large to share as a link (limit ≈ 60 KB compressed)', 'err');
      await this.copy(`${location.origin}${location.pathname}#j=${data}`, 'Share link copied. The data lives in the link, not on a server.');
    } catch {
      this.toast("Your browser can't create share links", 'err');
    }
  }

  private loadHash = async () => {
    const h = location.hash;
    if (!h.startsWith('#j=')) return;
    try {
      const { fromBase64Url } = await import('./sizes');
      const text = await fromBase64Url(h.slice(3));
      history.replaceState(null, '', location.pathname + location.search);
      if (this.dead) return;
      if (text.length > 20_000_000) return this.toast('That share link is too large to open', 'err');
      const had = !!this.ed.text.trim();
      const r = parse(text);
      this.load(r.root && !r.error ? formatDoc(text, r, this.indent) : text, null);
      this.toast(had ? `Loaded shared JSON · ${this.mod}Z restores your previous document` : 'Loaded shared JSON', 'ok');
    } catch {
      this.toast('That share link is broken or incomplete', 'err');
    }
  };

  async fetchUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      return this.toast('Enter a valid http(s) URL', 'err');
    }
    this.toast('Fetching…', 'info');
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
      if (!res.ok) return this.toast(`Request failed: ${res.status} ${res.statusText}`, 'err');
      const text = await res.text();
      if (this.dead) return;
      const name = url.pathname.split('/').pop() || url.hostname;
      // Auto-format reads the editor right after: only then is the load done in place.
      this.load(text, /\.json$/i.test(name) ? name : name + '.json', true, !this.settings.autoFormat);
      if (this.settings.autoFormat) this.autoFormat();
      this.toast(`Loaded ${url.hostname}`, 'ok');
    } catch {
      this.toast("Couldn't fetch. The server must allow cross-origin requests (CORS).", 'err');
    }
  }

  // ── Commands: view ─────────────────────────────────────────────────────

  private viewSeq = 0;

  setView(view: View, ready?: () => void) {
    const viewSeq = ++this.viewSeq;
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
          this.sel = this.selPath ? resolve(res.root, this.selPath) : null;
          this.tree.select(this.sel, { scroll: false });
        }
        this.setView(view, ready);
      };
      soon(run);
      return;
    }
    const prev = this.settings.view;
    if (this.query && prev !== view) this.findIn(prev, '');
    this.setSettings(view === 'compare' && prev !== 'compare' ? { view, prevView: prev } : { view });
    if (this.query) requestAnimationFrame(() => (this.settings.view === 'compare' ? this.closeFind() : this.refind(true)));
    if (view === 'table') {
      const root = this.good?.root ?? null;
      const base = this.sel ? (this.sel.t >= ARR ? this.sel : this.sel.u) : root;
      this.tableShow(base);
    } else this.table.setNode(null);
    if (view === 'tree') {
      this.tree.activate();
      requestAnimationFrame(() => this.tree.render(true));
    }
    if (view === 'format') this.scheduleFormat(0);
    if (view === 'convert') this.scheduleConvert(0);
    if (view === 'compare') {
      store.set({ docText: this.ed.text, cmpText: this.ed2.text });
      requestAnimationFrame(() => {
        this.ed2.render(true);
        if (!this.ed2.text) this.ed2.focus();
      });
    } else this.compareMarks(null, null);
    ready?.();
  }

  /** Leaves Compare for the view that was open before it. */
  closeCompare() {
    if (this.settings.view !== 'compare') return;
    this.setView(this.settings.prevView);
    this.ed.focus();
  }

  /** Folding in an editor (1: input, 2: Compare's modified document); level 0 unfolds everything. */
  foldEditor(which: 1 | 2, level: number) {
    const ed = which === 2 ? this.ed2 : this.ed;
    if (level) ed.foldLevel(level);
    else ed.unfoldAll();
  }

  // ── Format view (output) ───────────────────────────────────────────────

  setFormat(patch: Partial<Pick<Settings, 'minify' | 'sortKeys' | 'escape'>>) {
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
    if (this.packed && this.fmtSrc === this.packed.text && this.fmtKey === this.fmtSettings()) return this.fmtText;
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
  private fmtSrc = '';
  private fmtWorkerId = 0;
  private pendingFmtWorkerId = 0;
  private fmtKey = '';
  private fmtText = '';
  private fmtVersion = 0;
  private fmtCounts: { version: number; pretty: number; minified: number; escaped: number } | null = null;
  /** User Timing for DevTools: a file opened (tk:input) → its output painted (tk:formatted). */
  private markOutput = false;

  private runFormat = () => {
    if (this.settings.view !== 'format') return;
    if (this.packed && this.fmtKey !== this.fmtSettings()) this.fresh();
    if (this.fmtKey !== this.fmtSettings()) this.materializeGood();
    // Already drawn for this document and settings (a big load draws it before its analysis).
    const key = this.fmtSettings();
    const drawn = this.goodText === this.fmtSrc && key === this.fmtKey;
    const text = drawn ? this.fmtText : this.formatted();
    if (!drawn) this.drawFormat(text, this.good ? this.goodText : '', key);
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
      const { minify, escape } = this.settings;
      const metrics = this.goodMetrics;
      const extra = metrics ? metrics.extra + metrics.units * this.indent.length : this.good?.root ? prettyExtra(this.good.root, this.indent.length) : 0;
      const bytes = metrics ? metrics.min + (this.settings.minify || this.settings.escape ? 0 : extra) : byteLength(text);
      const min = !text ? 0 : minify || escape ? bytes : bytes - extra;
      const counts = { pretty: text ? min + extra : 0, minified: min, escaped: escape && text ? metrics?.escaped ?? byteLength(this.fmt.text) : 0 };
      this.fmtCounts = { version: this.fmtVersion, ...counts };
      store.set({ fmt: { lines: this.fmt.lineCount, ...counts } });
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
  private drawFormat(text: string, src: string, key: string, index?: CodeIndex, display?: string, change?: CodeChange, patch?: string) {
    this.fmtWorkerId = 0;
    this.pendingFmtWorkerId = 0;
    this.fmtVersion++;
    this.fmtStatSeq++;
    const { minify, escape } = this.settings;
    this.fmtSrc = src;
    this.fmtKey = key;
    this.fmtText = text;
    const out = display ?? (escape && text ? JSON.stringify(text) : text);
    this.fmt.setText(out, jsonRow, true, null, index, change, patch);
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
    const s = this.settings;
    const fixed = this.fixed(r);
    this.transform(
      (res, t) => (s.escape ? JSON.stringify(formatDoc(t, res, '', s.sortKeys)) : formatDoc(t, res, s.minify ? '' : this.indent, s.sortKeys)),
      () => (s.escape ? 'Escaped input to a JSON string' : s.minify ? 'Minified input' : 'Formatted input') + fixed,
    );
  }

  copyOutput() {
    const out = this.fmt.text || this.output();
    if (!out) return this.toast('Nothing to copy yet', 'info');
    void this.copy(out, this.settings.escape ? 'Copied as a JSON string' : this.settings.minify ? 'Copied minified JSON' : 'Copied formatted JSON');
  }

  downloadOutput() {
    const out = this.fmt.text || this.output();
    if (!out) return this.toast('Nothing to download yet', 'info');
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    this.save(out, `${base}${this.settings.escape ? '.escaped' : this.settings.minify ? '.min' : ''}.json`, 'application/json');
  }

  // ── Convert ────────────────────────────────────────────────────────────

  setConvert(patch: Partial<Pick<Settings, 'target' | 'rootName' | 'tsStyle' | 'csharpLib'>>) {
    this.setSettings(patch);
    if (this.settings.view !== 'convert') this.setView('convert');
    else this.scheduleConvert(patch.rootName !== undefined ? 200 : 0);
  }

  private scheduleConvert(delay: number) {
    clearTimeout(this.convTimer);
    this.convTimer = window.setTimeout(() => void this.runConvert(), delay);
  }

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
    const root = this.good?.root;
    if (!root) {
      this.code.setText('', escapeHtml);
      store.set({ convert: { loading: false, error: 'Paste or open valid JSON on the left to convert it.', lines: 0, bytes: 0 } });
      return;
    }
    try {
      const mod = await this.loadConverters();
      const s = this.settings;
      const info = targetInfo(s.target);
      // CSV and Excel share one flattening (dotted columns) over the main array of
      // records; Excel is a binary download, so its preview is the same table.
      const xlsx = info.id === 'xlsx' || info.id === 'csv' ? await import('../convert/xlsx') : null;
      const out = xlsx
        ? xlsx.toCsv(xlsx.records(root))
        : mod.convert(root, info.id, { rootName: s.rootName || 'Root', tsStyle: s.tsStyle, csharpLib: s.csharpLib });
      if (xlsx) this.code.setText(out, (line, _s, _e, state) => mod.csvLine(line, state), false, { start: mod.CSV_START, scan: mod.csvScan });
      else this.code.setText(out, (line) => mod.highlightCode(line, info.lang));
      store.set({ convert: { loading: false, error: null, lines: out ? out.split('\n').length : 0, bytes: out.length } });
    } catch (e) {
      this.code.setText('', escapeHtml);
      store.set({ convert: { loading: false, error: e instanceof Error ? e.message : 'Conversion failed', lines: 0, bytes: 0 } });
    }
  }

  copyConvert() {
    if (!this.code.text) return this.toast('Nothing to copy yet', 'info');
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
      try {
        const { records, toXlsx } = await import('../convert/xlsx');
        this.saveBlob(await toXlsx(records(root), { sheetName: base.slice(0, 31) || 'Sheet1' }), name);
      } catch {
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
    void this.copy(csv, 'Copied table as CSV');
  }

  downloadCSV() {
    const csv = this.table.toCSV();
    if (!csv) return this.toast('Open an array or object in the table first', 'info');
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    this.save(csv, `${base}.csv`, 'text/csv');
  }

  // ── Folding (acts on the open view: format, convert or tree) ────────────

  private foldView() {
    const v = this.settings.view;
    if (v !== 'format' && v !== 'convert' && v !== 'tree') this.setView('format');
    return this.settings.view;
  }

  expandAll() {
    const v = this.foldView();
    if (v === 'tree') this.tree.expandAll();
    else (v === 'format' ? this.fmt : this.code).unfoldAll();
  }

  collapseAll() {
    this.expandTo(1);
  }

  /** Show `level` levels; everything deeper is folded. */
  expandTo(level: number) {
    const v = this.foldView();
    if (v === 'tree') this.tree.expandTo(level);
    else (v === 'format' ? this.fmt : this.code).foldLevel(level);
  }

  // ── Find (searches the open view) ───────────────────────────────────────

  private findIn(view: View, q: string): FindResult {
    switch (view) {
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
    this.query = q;
    const f = store.get().find;
    store.set({ find: { open: true, q, seq: f.seq + (external ? 1 : 0), ...this.findIn(this.settings.view, q) } });
  }

  /** Re-applies the query to the current view (after data or view changes). */
  private refind(jump: boolean) {
    const v = this.settings.view;
    const r = v === 'tree' ? this.tree.search(this.query, jump) : this.findIn(v, this.query);
    store.set({ find: { ...store.get().find, total: r.total, index: r.index, note: r.note } });
  }

  findStep(dir: 1 | -1) {
    const v = this.settings.view;
    const r: FindResult =
      v === 'tree' ? this.tree.step(dir) : v === 'format' ? this.fmt.step(dir) : v === 'convert' ? this.code.step(dir) : v === 'table' ? this.table.step(dir) : { total: 0, index: -1 };
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
      case 'table':
        return this.downloadCSV();
      case 'convert':
        return void this.downloadConvert();
      default:
        return this.downloadOutput();
    }
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
    if (this.settings.view === 'tree' && !store.get().empty) this.tree.focus();
    else document.querySelector<HTMLElement>('.pane-view [role="tab"][aria-selected="true"]')?.focus();
  }

  focusEditor() {
    this.ed.focus();
  }

  /** Makes a huge (view-only) document editable. */
  editAnyway() {
    this.ed.editAnyway();
    this.toast('Editing enabled. Large documents may feel slower to type in.', 'info');
  }

  /** `?url=https://…` loads remote JSON on open (shareable deep link). */
  private loadQueryUrl() {
    const url = new URLSearchParams(location.search).get('url');
    if (!url) return;
    history.replaceState(null, '', location.pathname + location.hash);
    void this.fetchUrl(url);
  }

  /** Files opened from the OS with the installed app (manifest file_handlers). */
  private handleLaunch() {
    type LaunchParams = { files?: { getFile(): Promise<File> }[] };
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
    lq?.setConsumer(async (p) => {
      const h = p.files?.[0];
      if (h) void this.loadFile(await h.getFile());
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
    if (p.initialImport) window.setTimeout(() => void this.importAs(p.initialImport!), 0);
  }

  setIndent(indent: IndentId) {
    this.setSettings({ indent });
    this.ed.indentUnit = INDENTS[indent];
    this.ed2.indentUnit = INDENTS[indent];
    if (this.settings.view === 'format') this.scheduleFormat(0);
  }

  setTheme(theme: Theme) {
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
    this.setSettings({ autoFormat: !this.settings.autoFormat });
    this.toast(`Auto-format on paste ${this.settings.autoFormat ? 'on' : 'off'}`, 'info');
  }

  setSplit(split: number) {
    this.setSettings({ split: Math.min(0.8, Math.max(0.2, split)) });
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
  }

  // ── UI helpers ─────────────────────────────────────────────────────────

  get mod() {
    return store.get().mac ? '⌘' : 'Ctrl+';
  }

  toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info', action?: { label: string; run: () => void }) {
    clearTimeout(this.toastTimer);
    store.set({ toast: { id: ++this.toastId, msg, kind, action } });
    if (!action) this.toastTimer = window.setTimeout(() => store.set({ toast: null }), kind === 'err' ? 4000 : 2200);
  }

  openPalette(mode: 'commands' | 'url' = 'commands') {
    store.set({ palette: mode, shortcuts: false });
  }

  private onKey = (e: KeyboardEvent) => {
    const s = store.get();
    if (s.palette || s.shortcuts || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
    const k = e.key.toLowerCase();
    let run: (() => void) | null = null;
    if (mod && !e.altKey && (k === 'k' || (e.shiftKey && k === 'p'))) run = () => this.openPalette();
    else if (mod && !e.altKey && e.key === 'Enter' && this.ed2.hasFocus()) run = () => this.formatCompare();
    else if (mod && !e.altKey && e.key === 'Enter') run = e.shiftKey ? () => this.minify() : () => this.useOutput();
    else if (e.altKey && e.shiftKey && !mod && e.code === 'KeyF') run = () => this.format();
    else if (mod && !e.shiftKey && !e.altKey && k === 's') run = () => this.download();
    else if (mod && !e.shiftKey && !e.altKey && k === 'o') run = () => this.openFile();
    else if (mod && !e.shiftKey && !e.altKey && k === 'f') run = () => this.focusSearch();
    // Alt+Z like VS Code (on macOS, Option+Z types Ω: not while typing).
    else if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ' && !(s.mac && typing)) run = () => this.toggleWrap();
    // On macOS, Option+digit types characters (#, €…): never steal it while typing.
    else if (e.altKey && !mod && /^Digit[1-5]$/.test(e.code) && !(s.mac && typing)) {
      const views: View[] = ['format', 'tree', 'table', 'convert', 'compare'];
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
    if ((e.target as HTMLElement | null)?.closest?.('.pane-cmp')) void this.loadCompareFile(f);
    else void this.loadFile(f);
  };

  // ── Persistence & offline ──────────────────────────────────────────────

  private persistSoon() {
    if (!this.persistEnabled) return;
    clearTimeout(this.persistTimer);
    // Big synchronous localStorage writes happen when the user is idle.
    this.persistTimer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(this.persistNow, { timeout: 3000 });
      else this.persistNow();
    }, 800);
  }

  private persistNow = () => {
    clearTimeout(this.persistTimer);
    if (!this.persistEnabled) return;
    const t = this.ed.text;
    write(KEYS.doc, t && t.length <= MAX_PERSIST ? t : null);
  };

  private registerSW() {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'updated') {
        this.toast('A new version is ready', 'info', { label: 'Reload', run: () => location.reload() });
      }
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
        const doc = `[${Array(150).fill(SAMPLE).join(',')},"Zürich – 東京"]`;
        const steps: (() => unknown)[] = [];
        for (let k = 0; k < 4; k++) steps.push(() => reindent(doc, k & 1 ? '' : '  '), () => parse(doc));
        steps.push(
          () => {
            const x = document.createElement('canvas').getContext('2d');
            const cs = getComputedStyle(this.ed.el);
            if (!x) return;
            x.font = `${cs.fontSize} ${cs.fontFamily}`;
            for (const c of 'é Я α 中 あ 한 ب א ह ไ ✓ 😀'.split(' ')) x.measureText(c);
          },
          () => this.reindentWorker(),
          () => loadSurface(),
        );
        const next = () => {
          const step = steps.shift();
          if (!step) return;
          step();
          idle(next);
        };
        idle(next);
      });
    if (document.readyState === 'complete') setTimeout(go, 4000);
    else window.addEventListener('load', () => setTimeout(go, 4000), { once: true });
  }
}
