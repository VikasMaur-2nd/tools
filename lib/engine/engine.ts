import { ARR, JNode, MAX_ISSUES, MAX_WALK_DEPTH, OBJ, STR, parse, parser, tooDeep, type ParseResult, type Parser } from '../json/parser';
import { byteLength, copyText, formatBytes, formatDoc, minifiedBytesIn, reindent, reindenter, stringify, tooLarge } from '../json/format';
import { formatPath, nodeAt, pathOf, resolve, type Seg } from '../json/path';
import type { PackedTree, PrettyText } from '../json/pack';
import type { PrettyIndex } from '../json/pretty';
import type { Tape } from '../json/tape';
import { applyCodeChange, type CodeChange, type CodeIndex } from '../json/code-index';
import type { DocumentMetrics } from '../json/metrics';
import { Editor, loadSurface, type ChangeKind, type Diagnostic } from './editor';
import { TreeView } from './tree';
import { TableView } from './table';
import type { GraphExport, GraphViewApi } from '../graph/types';
import { CodeView } from './codeview';
import { escapeHtml, highlightLine } from './highlight';
import type { FindResult, LineHighlighter } from './codeview';
import { convertFileName, isFlat, targetInfo } from './targets';
import { DEFAULT_SETTINGS, paired, store, type ContextMenu, type CsvDelimiter, type DiffMenu, type Hint, type IndentId, type MenuArea, type Settings, type Sizes, type SourceFormat, type Status, type EnginePreset, type Theme, type View } from './store';
import type { JwtInput, readJwt } from '../json/jwt';
import type { SourceReply, SourceRequest } from './source.worker';
import { rt } from '../i18n/ui';
import { idle, soon } from './idle';
import { Doc, lf } from './doc';
import { formatOf, formatOfName, holdsEscapedJson, holdsJson, jsonLines, persistenceAfterChange, persistenceAfterLoad, plainJson, unescapeText } from './rules';
import { PRIVATE, reportError, track } from '../analytics';
import { noteLoad, watchPastes } from '../analytics/load';
import { getDiffMenu, getEngine } from './instance';
import type { InputSource } from '../analytics/events';
import type { SnippetFormat } from '../badge';
import { HANDOFF_VERSION, LINK_DOCUMENT, LinkTooLarge, MAX_DOCUMENT, PASTED_LINK, decodeDoc, linkReach, linkHash, parseLink, readHandoff, type HandoffReply, type LinkDoc, type LinkRequest } from '../link';
import type { HugeHook } from '../huge/session';
import { TallScroll } from './tall';

/** A key held for the palette, the shortcuts or a context menu while it loaded (see Engine.holdKeys). */
export type HeldKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const KEYS = { doc: 'jf:doc', file: 'jf:file', fmt: 'jf:fmt', settings: 'jf:settings', theme: 'jf:theme', cmp: 'jf:cmp' };
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
type SourceModule = typeof import('./source');
type Source = Exclude<SourceFormat, 'json'>;

/** Format names as the interface says them. */
const FORMAT_LABEL: Record<SourceFormat, string> = { json: 'JSON', yaml: 'YAML', csv: 'CSV', xml: 'XML', toml: 'TOML' };
/** A downloaded input's extension and type, by what it is read as. */
const FORMAT_FILE: Record<SourceFormat, [string, string]> = {
  json: ['json', 'application/json'],
  yaml: ['yaml', 'application/yaml'],
  csv: ['csv', 'text/csv'],
  xml: ['xml', 'application/xml'],
  toml: ['toml', 'application/toml'],
};


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
    if (!['format', 'tree', 'table', 'graph', 'convert', 'compare', 'schema'].includes(out.view)) out.view = 'format';
    if (!['format', 'tree', 'table', 'graph', 'convert'].includes(out.prevView)) out.prevView = 'format';
    out.minify = !!out.minify;
    out.sortKeys = !!out.sortKeys;
    out.wrap = out.wrap !== false;
    // String output is a one-off conversion, not a preference: a new visit shows the document itself.
    out.escape = false;
    if (out.tsStyle !== 'type') out.tsStyle = 'interface';
    if (out.csharpLib !== 'newtonsoft') out.csharpLib = 'stj';
    out.csvHeader = out.csvHeader !== false;
    out.csvTypes = out.csvTypes !== false;
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

/**
 * Could the input be a JWT (see readJwt, loaded once one may be)? As readJwt, looks at its first character
 * only: anything but "e" (eyJ…) or "Bearer" isn't.
 */
function mayBeJwt(t: { length: number; charCodeAt(i: number): number }) {
  if (t.length > 1_000_000) return false;
  let i = 0;
  while (i < t.length && t.charCodeAt(i) <= 32) i++;
  const c = t.charCodeAt(i);
  return c === 101 || c === 66 || c === 98;
}
/** From this size, a load in the Format view draws its output before the editor (see `load`). */
const OUTPUT_FIRST = 200_000;
/** From this size, that output is re-indented in a worker. */
const WORKER_MIN = 2_000_000;
/** From this size, an edited document is analysed after a second without input (see onChange). */
const HUGE_TYPED = 16_000_000;
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

/**
 * From this size, an input in another format than JSON converts in a worker and its JSON is parsed here in steps (see
 * convertBig): YAML converts at a few hundred milliseconds a megabyte, which would hold the page after each pause in typing.
 */
const SOURCE_WORKER_MIN = 100_000;

/** JWT-shaped, for a clearer error when a part doesn't decode. */
const JWT_RE = /^(?:[Bb]earer\s+)?eyJ[^\s.]*\.[^\s.]+\.[^\s.]*$/;

/** Cheap guess at what non-JSON input is, to offer a one-click conversion (`whole`: `text` is all of it, not its start). */
function sniff(text: string, whole: boolean): Hint {
  const t = text.slice(0, 4000).trim();
  // (JSON written as a string: offered only if its escapes undone are JSON, when that can be told.)
  if (t.includes('\\"') && /^"?\s*[[{]/.test(t) && (!whole || holdsEscapedJson(text))) return 'unescape';
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
/**
 * The tape's code (pack.ts and what it imports): only documents a worker parsed need it, so it isn't in
 * the first load. Loaded when the page is idle, and waited for by a worker message that brings a tape.
 */
/**
 * What a waiting copy or download gets (see Waiting): the output (a big pretty one as parts, see prettyParts), null
 * when none could be made, or undefined when what it asked for was superseded first (nothing copied or saved).
 */
type Output = string | string[] | null | undefined;

/** A file's base name as an Excel sheet name: at most 31 units, never ending in half a surrogate pair. */
const sheetBase = (base: string) => {
  let s = base.slice(0, 31);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s || 'Sheet1';
};

/**
 * Copies and downloads waiting for an output still being made (see outputPending, convPending): one wait, shared
 * by every one asked for meanwhile (a key held down asks dozens of times), bound to what it asked for (its key:
 * the settings and the document, see Engine.fmtWait and convKey). Its maker hands it the output for that only;
 * asked for something else, or the settings or the document changed first, it ends with nothing (undefined).
 * With null after two minutes (one that never comes, the document turned invalid say: nothing to copy).
 */
class Waiting {
  private w: { key: string; promise: Promise<Output>; done: (out: Output) => void } | null = null;

  get pending() {
    return !!this.w;
  }

  /** The wait for `key` (one for anything else ends, superseded). */
  get(key: string): Promise<Output> {
    if (this.w?.key === key) return this.w.promise;
    this.end();
    let done!: (out: Output) => void;
    const w = { key, promise: new Promise<Output>((r) => (done = r)), done: (out: Output) => done(out) };
    this.w = w;
    setTimeout(() => this.w === w && this.end(null), 120_000);
    return w.promise;
  }

  /** Whether what waits is for `key`. */
  wants(key: string) {
    return this.w?.key === key;
  }

  /** Ends what waits with `out` (nothing: superseded), if it is for `key` (when given). */
  end(out?: Output, key?: string) {
    const w = this.w;
    if (!w || (key !== undefined && w.key !== key)) return;
    this.w = null;
    w.done(out);
  }
}

type Pack = typeof import('../json/pack');
/** Pretty lines a worker indexed with a tape (see drawPretty), by the tape's nodes. */
const prettyIndexes = new WeakMap<Int32Array, { indent: string; index: PrettyIndex }>();
let pack: Pack | null = null;
let packLoad: Promise<Pack> | null = null;
const loadPack = () => (packLoad ??= import('../json/pack').then((m) => (pack = m), (e: unknown) => {
  packLoad = null;
  throw e;
}));

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
  /** The JWT reader (lib/json/jwt.ts): loaded when an input may be a JWT, or when the page is idle. */
  private jwtReader: typeof readJwt | null = null;
  private jwtLoad: Promise<void> | null = null;
  /** An analysis waits for the JWT reader (see waitForJwt). */
  private jwtWait = false;
  /** What the input is read as: in another format than JSON, `res` and the views describe the JSON it converts to. */
  private inFmt: SourceFormat = 'json';
  /** A paste over everything that is plainly JSON, in another format: read as JSON again once it is in (see onChange). */
  private pasteJson = false;
  /** The JSON the input converted to, while it is in another format and converts. */
  private converted: string | null = null;
  /** The reader for other formats (./source.ts): loaded once an input is in one. */
  private srcMod: SourceModule | null = null;
  private srcLoad: Promise<void> | null = null;
  /** An analysis waits for that reader (see waitForSource). */
  private srcWait = false;
  /** CSV input: the separator chosen (`auto`: detected), for this document. */
  private csvDelim: CsvDelimiter = 'auto';
  /** The editor's colours for the input's format, and what they were made for. */
  private colorsKey = 'json';
  /** Converts big inputs in another format (./source.worker.ts): started on first use; null when it couldn't be. */
  private srcWorker: Worker | null | undefined;
  /** The worker is converting (its reply hasn't come): a newer request stops it rather than waits behind it. */
  private srcBusy = false;
  /** Bumped by each conversion asked of the worker, and by a new reading (format, CSV options): older ones are dropped. */
  private srcSeq = 0;
  /** The conversion the worker is making: of that editor version, read that way (`key`, see sourceOptions). */
  private srcWanted: { seq: number; ver: object; key: string } | null = null;
  /** The last conversion the worker made, and that its JSON was parsed (analyze uses it for that version and reading). */
  private srcDone: { ver: object; key: string; conv: { json: string } | { error: string; p: number } } | null = null;
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
  /** Huge-file mode (lib/huge), while a file too big for the editor is open: it has the viewer, the view switch, Find and some keys (a closed one's hook takes nothing). */
  private huge: HugeHook | null = null;

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
      renamed: this.renamed,
      name: () => this.edName,
      undoing: this.undoing,
      reformat: this.reformatted,
      pasteFormats: this.pastedFormats,
      // A big document pasted over everything opens like a file: output first, then the editor.
      fullPaste: (text) => {
        if (this.settings.autoFormat || text.length < OUTPUT_FIRST || this.settings.view !== 'format' || this.pasteFormat(text) !== 'json') return false;
        this.refocus = true;
        this.request(1);
        this.load(text, null, true, true, undefined, 'json');
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
      renamed: this.cmpRenamed,
      name: this.cmpName,
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
    // (Items of millions are made in steps before the table lays them out: its counts change then.)
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
    for (const [view, code] of [['format', this.fmt], ['convert', this.code], ['table', this.table]] as const) code.onFind = (result) => {
      if (this.settings.view === view && this.query) store.set({ find: { ...store.get().find, ...result } });
    };
    this.applyWrap();

    // Restore: text typed/restored before hydration wins, then saved doc. A landing
    // page replaces it with its own sample at once, so it isn't parsed there.
    if (!options.preserveDocument) {
      const saved = read(KEYS.doc);
      if (saved && !this.ed.text) this.ed.init(saved);
      // What the saved document is read as, kept with it: also when the editor already holds it (a tool mounted
      // again keeps its text, and adopts it).
      if (saved && this.ed.length === saved.length && this.ed.text === saved) this.inFmt = formatOf(read(KEYS.fmt));
    }
    store.set({ fileName: (this.edName = read(KEYS.file)) });
    this.publishInput();
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
    // Tests and timing scripts wait for this instead of guessing when the tool answers input.
    performance.mark('tk:engine');
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
    this.huge?.close();
    // (Saved below: the document still on its way is the one kept, see persist.)
    const pending = this.pendingNow();
    this.worker?.terminate();
    this.analysisWorker?.terminate();
    this.srcWorker?.terminate();
    clearTimeout(this.analysisTimer);
    this.dead = true;
    // Whatever is still on its way drops itself (each step checks its sequence), and nothing more starts.
    this.loadSeq++;
    this.sizeSeq++;
    this.fmtStatSeq++;
    this.convSeq++;
    this.viewSeq++;
    this.dropGraphWaiters();
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
    this.persist(pending);
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
    // (A load's text arriving in the editor is that load's document, not a new one: see finishLoad.)
    if (!this.landing) {
      this.newDoc();
      // The file read no longer is the editor's text: the analysis worker is sent the text (see postDocument).
      if (this.fromFile && this.fromFile.doc !== this.ed.version) this.fromFile = null;
    }
    if (kind !== 'set') this.requests[1]?.abort(); // (what was typed or pasted is newer than a document on its way)
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
      // (Its undo step tells the format it was read as before: see pastedFormats.)
      if (this.pasteJson) this.setInputFormat('json', false);
      this.resetNext = true;
      this.edName = null;
      if (store.get().fileName) {
        store.set({ fileName: null });
        write(KEYS.file, null);
      }
      if (this.settings.autoFormat && this.inFmt === 'json') setTimeout(this.autoFormat, 0);
    }
    this.pasteJson = false;
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
      // (A huge document's analysis takes seconds: it starts once input pauses for one, not between pastes.)
      this.timer = window.setTimeout(this.analyzeTyped, len < 100_000 ? 60 : len < 250_000 ? 160 : len < WORKER_MIN ? 500 : len < HUGE_TYPED ? 200 : 1000);
    }
    if (this.persistEnabled) this.persistSoon();
  };

  /** Pretty-prints compact JSON right after it is pasted (one undo step reverts it). */
  private autoFormat = () => {
    if (this.dead || this.inFmt !== 'json') return;
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
    const res = pack!.unpacker(tree, text)(Infinity)!;
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
      this.analyze(pack!.unpacker(tree, text)(Infinity), metrics);
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
    if (this.convertBig()) return;
    const ver = this.ed.version;
    const text = this.ed.length >= WORKER_MIN ? ver as Doc : this.ed.text;
    if (!this.outputFirst(text, store.get().fileName, (res, metrics) => this.ed.version === ver && this.analyze(res, metrics), true)) this.analyze();
  };

  /** A new document being parsed in steps (see analyzeInSteps). */
  private steps: { p: Parser; seq: number; ver: object } | null = null;

  /** Loads the JWT reader, once (a page offline without it reads every input as plain text). */
  private loadJwt() {
    return (this.jwtLoad ??= import('../json/jwt').then(
      (m) => void (this.jwtReader = m.readJwt),
      () => void (this.jwtReader = () => null),
    ));
  }

  /**
   * An input that may be a JWT before the JWT reader has loaded: says "Parsing…" and analyses again once it
   * has. True if the analysis must wait.
   */
  private waitForJwt() {
    if (this.jwtReader || this.inFmt !== 'json' || !mayBeJwt(this.ed.version as Doc)) return false;
    store.set({ status: { kind: 'parsing' } });
    if (!this.jwtWait) {
      this.jwtWait = true;
      void this.loadJwt().then(() => {
        this.jwtWait = false;
        if (!this.dead) this.analyze();
      });
    }
    return true;
  }

  /** Loads the reader for other formats than JSON, once (see waitForSource). */
  private loadSource() {
    return (this.srcLoad ??= import('./source').then(
      (m) => void (this.srcMod = m),
      (e: unknown) => {
        this.srcLoad = null;
        throw e;
      },
    ));
  }

  /**
   * An input in another format than JSON before its reader has loaded: says "Parsing…" and analyses again once it
   * has. True if the analysis must wait. (Offline without it, the status says the conversion failed.)
   */
  private waitForSource() {
    if (this.srcMod || this.inFmt === 'json' || this.ed.blank) return false;
    if (store.get().status.kind !== 'parsing') store.set({ status: { kind: 'parsing' } });
    if (!this.srcWait) {
      this.srcWait = true;
      this.loadSource().then(
        () => {
          this.srcWait = false;
          // (A big one converts in the worker: see convertBig.)
          if (!this.dead) this.analyzeInSteps();
        },
        () => {
          this.srcWait = false;
          if (!this.dead && !this.srcMod && this.inFmt !== 'json') store.set({ status: { kind: 'error', msg: 'Conversion failed', p: 0, line: 1, col: 1, src: this.inFmt } });
        },
      );
    }
    return true;
  }

  /**
   * Analyses a new document. A big one is parsed here in steps, the first at once (one it finishes is ready
   * as soon as in one go): input is handled between them, the status shows how far it got, and an edit or
   * another load drops it (fresh() finishes it for a command). Until it is done the views show nothing of
   * the previous document.
   */
  private analyzeInSteps() {
    if (this.convertBig()) return;
    const text = this.ed.length >= STEPS_MIN && this.resetNext && this.inFmt === 'json' ? this.ed.text : '';
    if (!text || mayBeJwt(text)) return this.analyze();
    const seq = this.loadSeq;
    const ver = this.ed.version;
    const p = parser(text, { lines: LINES_FILE.test(store.get().fileName ?? ''), repair: true });
    this.steps = { p, seq, ver };
    this.blankViews();
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

  /** A new document is on its way (parsed or converted in steps): the views show nothing of the one before meanwhile. */
  private blankViews() {
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
  }

  /** The worker for big inputs in another format (null when it can't start: they convert here). */
  private sourceWorker(): Worker | null {
    if (this.dead) return null;
    if (this.srcWorker !== undefined) return this.srcWorker;
    try {
      const w = new Worker(new URL('./source.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<SourceReply>) => this.sourceConverted(e.data);
      w.onerror = (e) => {
        // (It couldn't load, offline before it was ever cached say: converted here from now on.)
        e.preventDefault();
        w.terminate();
        this.srcWorker = null;
        this.srcBusy = false;
        if (this.srcWanted && !this.dead) {
          this.srcWanted = null;
          this.analyze();
        }
      };
      return (this.srcWorker = w);
    } catch {
      return (this.srcWorker = null);
    }
  }

  /**
   * A big input in another format (from SOURCE_WORKER_MIN): converted in the worker, its JSON then parsed here in steps,
   * input handled meanwhile (see sourceConverted). True if that is under way; false: analyze() converts it here.
   */
  private convertBig(): boolean {
    const fmt = this.inFmt;
    if (fmt === 'json' || !this.srcMod || this.ed.length < SOURCE_WORKER_MIN) return false;
    const ver = this.ed.version;
    const text = this.ed.text;
    const { options, key } = this.sourceOptions(text, fmt);
    // (Converted already: analyze() uses it.)
    if (this.srcDone?.ver === ver && this.srcDone.key === key) return false;
    let w = this.sourceWorker();
    if (!w) return false;
    if (this.srcWanted?.ver === ver && this.srcWanted.key === key) return true;
    // A conversion of an older text or reading still under way is stopped, not waited out (seconds at a few MB).
    if (this.srcBusy) {
      w.terminate();
      this.srcWorker = undefined;
      this.srcBusy = false;
      w = this.sourceWorker();
      if (!w) return false;
    }
    const seq = ++this.srcSeq;
    this.srcWanted = { seq, ver, key };
    clearTimeout(this.timer);
    if (this.resetNext) {
      this.blankViews();
      store.set({ empty: false, stale: false, status: { kind: 'parsing' }, stats: null, sizes: null, path: null, hint: null });
    } else store.set({ status: { kind: 'parsing' } });
    w.postMessage({ seq, text, format: fmt, csv: options } satisfies SourceRequest);
    this.srcBusy = true;
    return true;
  }

  /** The worker's conversion: its JSON is parsed here in short steps, then analysed (dropped if the input changed meanwhile). */
  private sourceConverted(d: SourceReply) {
    this.srcBusy = false;
    const want = this.srcWanted;
    if (this.dead || !want || d.seq !== want.seq) return;
    this.srcWanted = null;
    const current = () => !this.dead && want.seq === this.srcSeq && want.ver === this.ed.version;
    if (!current()) return;
    if ('error' in d) {
      this.srcDone = { ver: want.ver, key: want.key, conv: { error: d.error, p: d.p } };
      return this.analyze();
    }
    const p = parser(d.json, { repair: true });
    const step = () => {
      if (!current()) return;
      const res = p.step(performance.now() + STEP);
      if (!res) return soon(step);
      this.srcDone = { ver: want.ver, key: want.key, conv: { json: d.json } };
      this.analyze(res);
    };
    step();
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
    if (this.waitForJwt() || this.waitForSource()) return;
    // (Outputs asked for meanwhile are made once this analysis has published: see whenAnalysed.)
    if (this.analysed.length) queueMicrotask(() => { for (const f of this.analysed.splice(0)) f(); });
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
      this.converted = null;
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
    const fmt = this.inFmt;
    // Another format: its JSON is what is parsed and shown (or its error, at its place in the input).
    const conv = fmt === 'json' ? null : this.convertInput(text, fmt);
    const converted = conv && 'json' in conv ? conv.json : null;
    const jwt = fmt === 'json' && this.jwtReader && mayBeJwt(text) ? this.jwtReader(text, this.indent) : null;
    const src = jwt ? jwt.json : converted ?? text;
    const res =
      conv && 'error' in conv
        ? { root: null, issues: [], warnings: [], error: { p: conv.p, m: conv.error }, nodes: 0, depth: 0, exact: false, multi: false }
        : parsed ?? parse(src, { lines: fmt === 'json' && !jwt && LINES_FILE.test(store.get().fileName ?? ''), repair: true });
    const lines = fmt === 'json' && !jwt && (metrics?.records !== undefined || jsonLines(text, res));
    // (Used once: it holds that version's text.)
    const counted = this.counted?.ver === ed.version ? this.counted : null;
    this.counted = null;
    const ms = counted?.ms ?? performance.now() - t0;
    this.res = res;
    this.jwt = jwt;
    this.converted = converted;
    this.readGen = this.docGen;
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
      this.selPath = pack!.packedPosition(this.packed!.tree, ed.caret, this.packed!.document ?? text)?.path ?? null;
      this.tree.releaseRoot(reset);
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

    // Diagnostics → editor squiggles (a decoded JWT's positions aren't in the editor, nor are converted JSON's).
    const diags: Diagnostic[] = [];
    if (conv) {
      if ('error' in conv) diags.push({ p: conv.p, cls: 'me' });
    } else if (!jwt) {
      for (let i = 0; i < res.issues.length && i < 300 && !lines; i++) diags.push({ p: res.issues[i].p, cls: 'me' });
      if (res.error) diags.push({ p: res.error.p, cls: 'me' });
      for (let i = 0; i < res.warnings.length && i < 300; i++) diags.push({ p: res.warnings[i].p, cls: 'mw' });
    }
    ed.setDiagnostics(diags);

    let hint: Hint = null;
    // (Another format reads almost anything, CSV above all: text that clearly is something else says so, valid or not.)
    if (conv) hint = this.srcMod!.otherFormat(text, fmt);
    else if (jwt || lines) hint = null;
    // (A worker measured it: a long root string isn't decoded here just for this.)
    else if (metrics ? metrics.unescape : res.root?.t === STR && holdsJson(res.root.v as string)) hint = 'unescape';
    else if (res.error || res.issues.length) hint = text.length >= WORKER_MIN ? sniff((ed.version as Doc).slice(0, 4000), false) : sniff(text, true);

    store.set({
      empty: false,
      stale: !lazy && !res.root && !!(this.good || this.goodPacked),
      status: conv ? this.sourceStatus(conv, fmt as Source) : jwt ? this.jwtStatus(jwt) : lines ? this.linesStatus(res, metrics?.records) : text.length <= 1_000_000 && JWT_RE.test(text.trim()) ? { kind: 'error', msg: "This looks like a JWT, but a part isn't valid base64url JSON", p: 0, ...this.ed.lineCol(0) } : this.statusOf(res),
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
    // (An input in another format has no minified form of its own, as a JWT has none: its JSON's sizes are the Format view's.)
    else this.measure(res.root && !jwt && !conv ? res : null, text);
    this.afterDoc();
  }

  /** Valid JSON Lines: the wrapping into an array is how they're viewed, not an issue. */
  private linesStatus(res: ParseResult, records?: number): Status {
    const w = res.warnings[0];
    const jsonl = records ?? (res.root!.v as JNode[]).length;
    return w ? { kind: 'valid', warnings: res.warnings.length, more: res.warnings.length >= MAX_ISSUES, msg: w.m, p: w.p, ...this.ed.lineCol(w.p), jsonl } : { kind: 'valid', warnings: 0, jsonl };
  }

  /**
   * Converts the input from `fmt` (the reader is loaded: see waitForSource), and keeps the editor's colours and the
   * detected CSV separator in step with it.
   */
  private convertInput(text: string, fmt: Source) {
    const { options, key } = this.sourceOptions(text, fmt);
    const done = this.srcDone;
    if (done?.ver === this.ed.version && done.key === key) return done.conv;
    // (Converted here: one the worker is still making for it isn't wanted.)
    this.srcWanted = null;
    try {
      return this.srcMod!.convertSource(text, fmt, options);
    } catch (error) {
      // (A converter's own failure, not the input's: said as the worker says it.)
      reportError(error, 'import');
      return { error: 'Conversion failed', p: 0 };
    }
  }

  /**
   * How the input is read in `fmt` (the CSV options, its separator detected unless chosen) and that as a key; keeps the
   * editor's colours and the detected separator shown in step with it.
   */
  private sourceOptions(text: string, fmt: Source) {
    const m = this.srcMod!;
    const csv = fmt === 'csv';
    const detected = csv ? m.csvDelimiter(text) : ',';
    const delimiter = csv && this.csvDelim !== 'auto' ? this.csvDelim : detected;
    const { csvHeader: header, csvTypes: types } = this.settings;
    // (Excel's first line `sep=;` names the separator: the header row is the line after it.)
    const head = csv ? (/^\ufeff?sep=.\r?\n/.exec(text.slice(0, 9))?.[0].length ?? 0) : 0;
    const colors = csv ? `csv${delimiter}${header}${head}` : fmt;
    if (colors !== this.colorsKey) {
      this.colorsKey = colors;
      this.ed.setColors(m.sourceColors(fmt, delimiter, header, head));
    }
    if (csv && store.get().input.detected !== detected) store.set({ input: { ...store.get().input, detected } });
    return { options: csv ? { delimiter, header, types } : {}, key: csv ? `csv${delimiter}${header}${types}` : fmt };
  }

  /** An input in another format: valid (its JSON is shown), or where it doesn't read as that format and why. */
  private sourceStatus(conv: { json: string } | { error: string; p: number }, src: Source): Status {
    return 'error' in conv ? { kind: 'error', msg: conv.error, p: conv.p, ...this.ed.lineCol(conv.p), src } : { kind: 'valid', warnings: 0, src };
  }

  /** A decoded JWT (signature not verified); the UI shows its expiry live. */
  private jwtStatus({ alg, exp, iat, nbf, unsigned }: JwtInput): Status {
    return { kind: 'valid', warnings: 0, jwt: { alg, exp, iat, nbf, unsigned } };
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
          Object.assign(sizes, await this.compressed(blob, seq));
        }
        if (seq === this.sizeSeq) store.set({ sizes });
      }),
      text.length > 1_000_000 ? 700 : 200,
    );
  }

  /** Compressed sizes waiting for the formatting worker, by measure() sequence. */
  private sizesWanted = new Map<number, (sizes: Partial<Record<string, number>>) => void>();

  /** Compresses in the formatting worker (encoders can run seconds on the thread that calls them: Firefox's), or here without one. */
  private compressed(blob: Blob, seq: number): Promise<Partial<Record<string, number>>> {
    const w = this.reindentWorker();
    if (!w) return import('./sizes').then((m) => m.compressedSizes(blob, () => seq === this.sizeSeq), () => ({}));
    // (Only the newest is answered: older ones stop.)
    this.sizesWanted.clear();
    return new Promise((done) => {
      this.sizesWanted.set(seq, done);
      w.postMessage({ id: 0, measure: blob, seq });
    });
  }

  /** The document was just loaded whole (file, paste, URL): no typing to wait out. */
  private loaded = false;
  /** The Schema view's watch on the document (components/SchemaView.tsx): null at each new document (newDoc), then the document read (leftDoc). */
  docWatch: ((doc: { text: string; id: number } | null) => void) | null = null;
  /** The generation the conversion's or JWT's JSON was made in (see leftDoc). */
  private readGen = 0;

  /** Keeps the secondary views (convert, compare) in step with the document. */
  private afterDoc() {
    const v = this.settings.view;
    const now = this.loaded;
    this.loaded = false;
    if (v === 'format') this.scheduleFormat(now ? 0 : this.ed.length > 1_000_000 ? 250 : 60);
    else if (v === 'convert') this.scheduleConvert(now ? 0 : 150);
    else if (paired(v)) {
      const doc = this.leftDoc();
      store.set({ docText: doc.text });
      this.docWatch?.(doc);
    }
  }

  /**
   * The document as the Schema view validates it, with which document it is (docId; -1: another reading's text isn't
   * made yet): the input, or the JSON of a conversion or a JWT, which are as recent as the reading that made them.
   */
  leftDoc(): { text: string; id: number } {
    const read = this.jwt !== null || this.converted !== null;
    return { text: this.compareLeft(), id: read ? this.readGen : this.inFmt === 'json' || this.ed.blank ? this.docGen : -1 };
  }

  /**
   * What Compare diffs as the original and the Schema view validates: the input, or the JSON it converts to when it
   * is in another format, or a JWT's (what the other views show).
   */
  private compareLeft() {
    if (this.jwt) return this.jwt.json;
    const json = this.converted;
    if (json === null) return this.inFmt === 'json' ? this.ed.text : '';
    return (this.good && this.unlessTooLarge(() => formatDoc(json, this.good!, this.indent), false)) ?? json;
  }

  private statusOf(res: ParseResult): Status {
    const first = res.issues[0];
    const err = res.error;
    const at = (p: number) => this.ed.lineCol(p);
    if (!first && !err) {
      const w = res.warnings[0];
      return w ? { kind: 'valid', warnings: res.warnings.length, more: res.warnings.length >= MAX_ISSUES, msg: w.m, p: w.p, ...at(w.p) } : { kind: 'valid', warnings: 0 };
    }
    if (err && (!first || err.p <= first.p)) return { kind: 'error', msg: err.m, p: err.p, ...at(err.p) };
    if (err) return { kind: 'error', msg: first.m, p: first.p, ...at(first.p) };
    return { kind: 'fixable', msg: first.m, p: first.p, count: res.issues.length, ...at(first.p) };
  }

  /** Is the viewer showing positions that match the current text? */
  private get synced() {
    return !this.packed && !!this.res?.root && this.parsedVer === this.ed.version && !this.jwt && this.converted === null;
  }

  /** The JSON the views show when it isn't the input's text: a JWT's decoded document, or another format's conversion. */
  private get decoded(): string | null {
    return this.jwt ? this.jwt.json : this.converted;
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
      const at = pack!.packedPosition(this.packed.tree, this.ed.caret, this.packed.document ?? this.packed.text);
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
      const at = pack!.packedPosition(this.packed.tree, off, this.packed.document ?? this.packed.text);
      const close = at ? at.end - 1 : -1;
      const c = (this.packed.document ?? this.packed.text).charCodeAt(close);
      const match = at && (c === 125 || c === 93) && (off === at.start || off === at.start + 1 || off === close || off === at.end);
      this.ed.setBrackets(match ? at.start : -1, match ? close : -1);
      return;
    }
    if (!this.synced) return;
    const off = this.ed.caret;
    const t = this.ed.text;
    // A tree from a tape: its brackets are found on the tape (nodeAt would make the root's children).
    const z = this.res!.root!.z;
    if (z) {
      const at = z.containerAt(off);
      const close = at ? at[1] - 1 : -1;
      const c = t.charCodeAt(close);
      const match = at && (c === 125 || c === 93) && (off === at[0] || off === at[0] + 1 || off === close || off === at[1]);
      this.ed.setBrackets(match ? at[0] : -1, match ? close : -1);
      return;
    }
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
    // A JWT input, or one in another format, is rewritten from its JSON (undoable).
    const jwt = this.jwt;
    const decoded = this.decoded;
    const from = this.inFmt;
    const before = this.ed.text;
    // Keep the caret on the same node across the rewrite.
    const at = decoded !== null ? null : nodeAt(r.root, this.ed.caret, before);
    const path = at ? pathOf(at) : null;
    const next = this.unlessTooLarge(() => fn(r, decoded ?? before));
    if (next === null) return;
    const msg =
      done(r) +
      (jwt ? ` · replaced the JWT with its decoded JSON · ${this.mod}Z to undo` : from !== 'json' ? ` · replaced the ${FORMAT_LABEL[from]} with JSON · ${this.mod}Z to undo` : '');
    if (next === before && from === 'json') {
      this.toast(msg.replace(/ ·.*/, '') + ' · no changes', 'info');
      return;
    }
    this.setJson(next);
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

  // ── AI agents (WebMCP tools, lib/webmcp) ───────────────────────────────

  /** Before an agent's tool runs: the JWT reader is loaded, so a JWT is read as one at once (it loads when idle otherwise). */
  agentReady(): Promise<void> {
    // (An input in another format is read by ./source: without it, it would look empty to the agent.)
    const source = this.inFmt !== 'json' ? this.loadSource().catch(() => undefined) : undefined;
    return Promise.all([this.loadJwt(), source]).then(() => undefined);
  }

  /** The open document as a command sees it, its parse finished now if it was still on its way. */
  agentDoc() {
    const res = this.fresh();
    const text = this.ed.text;
    return { text, res, src: this.decoded ?? text, jwt: this.jwt, format: this.inFmt };
  }

  /**
   * Replaces the input with JSON `next` as one undoable step (the caret at `caret`). An input in another format becomes
   * JSON with it, its file too (example.yaml: example.json); Undo brings back both.
   */
  private setJson(next: string, caret = 0) {
    const from = this.inFmt;
    if (from === 'json') return this.ed.setValue(next, caret);
    const name = this.edName;
    const renamed = name ? name.replace(/\.[a-z0-9]+$/i, '') + '.json' : null;
    this.ed.setValue(next, caret, false, renamed !== name ? [name, renamed] : undefined, [from, 'json']);
    if (renamed !== name) {
      this.edName = renamed;
      store.set({ fileName: renamed });
    }
    this.setInputFormat('json', false);
  }

  /** Replaces the input with JSON `next` as one undoable edit, and says so (`msg`). */
  replaceText(next: string, msg: string) {
    this.flushLoad();
    this.setJson(next);
    this.analyze();
    this.toast(`${msg} · ${this.mod}Z to undo`, 'ok');
  }

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
    // The document's string, or its text read as one (escaped JSON pasted without its quotes), if it is JSON: strict,
    // so prose in a string (`"[citation needed]"`) isn't read loosely into something else.
    const inner = r?.root?.t === STR ? (r.root.v as string) : unescapeText(text);
    const pr = inner === null ? null : parse(inner);
    if (inner === null || !pr!.root || pr!.error || pr!.issues.length) {
      this.toast("This doesn't look like an escaped JSON string", 'err');
      return;
    }
    const next = this.unlessTooLarge(() => formatDoc(inner, pr!, this.indent));
    if (next === null) return;
    this.setJson(next);
    this.analyze();
    track('feature_used', { feature: 'unescape' });
    this.toast('Unescaped', 'ok');
  }

  // ── Input format ───────────────────────────────────────────────────────

  /** Reads the input as `format` (YAML, CSV, XML, TOML or JSON): the text stays as it is, the views show its JSON. */
  setInput(format: SourceFormat) {
    this.flushLoad();
    if (format === this.inFmt) return;
    track('feature_used', { feature: 'input_format', value: format });
    // (One undo step: Undo reads the text as it was read before.)
    this.ed.reformatStep([this.inFmt, format]);
    this.setInputFormat(format);
    this.persistSoon();
  }

  /**
   * Reads the document as `format` from now on, and analyses it again (`analyse`: the caller does). A new reading:
   * the views start over, as for a new document.
   */
  private setInputFormat(format: SourceFormat, analyse = true) {
    if (format === this.inFmt) return;
    this.inFmt = format;
    if (format === 'json') {
      this.colorsKey = 'json';
      this.ed.setColors(null);
    }
    // (What was made for the other reading of the same text isn't this one's: see formatCurrent.)
    this.newDoc();
    this.loadSeq++;
    this.progressStatus = null;
    this.workerParse = null;
    this.reindentJob = null;
    this.worker?.postMessage({ id: this.loadSeq, cancel: true });
    this.analysisWorker?.postMessage({ id: this.loadSeq, cancel: true });
    clearTimeout(this.analysisTimer);
    clearTimeout(this.timer);
    this.measuredSizes = null;
    this.fmtStatSeq++;
    this.fmtKey = '';
    this.fmtSrcVer = null;
    this.packed = this.goodPacked = null;
    // (The parse of the other reading is no answer for a command now: see fresh.)
    this.res = null;
    this.srcSeq++;
    this.srcWanted = this.srcDone = null;
    this.parsed = '';
    this.parsedVer = null;
    this.resetNext = true;
    this.publishInput();
    if (analyse && !this.dead) this.analyzeInSteps();
  }

  /** Undo or Redo went past a step that changed what the input is read as. */
  private reformatted = (format: string) => {
    this.setInputFormat(formatOf(format));
    this.persistSoon();
  };

  /**
   * What text pasted over everything is read as: JSON, when it plainly is (a document left in another format, a
   * JSON response pasted on the CSV page), else what the input was read as. Undo brings the other format back.
   */
  private pasteFormat(text: string): SourceFormat {
    return this.inFmt !== 'json' && plainJson(text) ? 'json' : this.inFmt;
  }

  /** The editor's paste over everything (see EditorEvents.pasteFormats): the formats of its step. */
  private pastedFormats = (text: string): [string, string] | undefined => {
    const to = this.pasteFormat(text);
    this.pasteJson = to !== this.inFmt;
    return this.pasteJson ? [this.inFmt, to] : undefined;
  };

  /** CSV input: the separator (this document's), whether the first row is a header, and whether values are typed. */
  setCsv(patch: { delimiter?: CsvDelimiter; header?: boolean; types?: boolean }) {
    if (patch.delimiter !== undefined && patch.delimiter !== this.csvDelim) {
      this.csvDelim = patch.delimiter;
      const names = { auto: 'auto', ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' } as const;
      track('feature_used', { feature: 'csv_delimiter', value: names[patch.delimiter] });
    }
    const s: Partial<Settings> = {};
    if (patch.header !== undefined && patch.header !== this.settings.csvHeader) {
      s.csvHeader = patch.header;
      track('feature_used', { feature: 'csv_header', on: patch.header });
    }
    if (patch.types !== undefined && patch.types !== this.settings.csvTypes) {
      s.csvTypes = patch.types;
      track('feature_used', { feature: 'csv_types', on: patch.types });
    }
    this.setSettings(s);
    this.publishInput();
    if (this.inFmt !== 'csv') return;
    // (The same text, read another way: what was made for the reading before isn't this one's.)
    this.newDoc();
    this.fmtKey = '';
    this.fmtSrcVer = null;
    this.srcSeq++;
    this.srcWanted = this.srcDone = null;
    // (The parse of the reading before is no answer for a command now: see fresh.)
    this.res = null;
    this.parsed = '';
    this.parsedVer = null;
    this.flushLoad();
    if (!this.convertBig()) this.analyze();
  }

  /** Tells the interface what the input is read as. */
  private publishInput() {
    const { input } = store.get();
    if (input.format !== this.inFmt || input.delimiter !== this.csvDelim) store.set({ input: { ...input, format: this.inFmt, delimiter: this.csvDelim } });
  }

  /** Turns a string value that holds JSON (`"{\"a\":1}"`) into real JSON, in place. */
  async expandNested(n: JNode | null = this.sel) {
    this.flushLoad();
    if (n === this.sel && this.packed && this.selPath) { this.fresh(); n = this.sel; }
    if (!n || n.t !== STR || !this.synced) return this.toast('Select a string that contains JSON', 'info');
    // (Its offsets are into this version of the document: an edit while the code loads drops the expansion.)
    const ver = this.ed.version;
    const { embeddedJson } = await import('../json/smart');
    if (this.dead || ver !== this.ed.version) return;
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
    } else if (s.kind === 'valid') this.toast(this.jwt ? 'No errors, this JWT decodes' : this.inFmt !== 'json' ? `No errors, this is valid ${FORMAT_LABEL[this.inFmt]}` : 'No errors, this is valid JSON', 'ok');
  }

  undo() {
    this.flushLoad();
    this.ed.undo();
  }

  redo() {
    this.flushLoad();
    this.ed.redo();
  }

  /**
   * Downloads an .xlsx without changing the current view: in the Table, of the table shown (its sort
   * included), as Copy / Download CSV write it; elsewhere, of the data's main array of records.
   */
  async exportExcel() {
    const current = this.fresh();
    if (!current?.root) this.materializeGood();
    const root = current?.root ?? this.good?.root;
    if (!root) return this.toast('Paste or open valid JSON first', 'info');
    if ((current?.root ? current : this.good)!.depth > MAX_WALK_DEPTH) return this.toast('Nesting is too deep to convert', 'err');
    const shown = this.settings.view === 'table' ? this.table.exportNode() : null;
    const order = shown ? this.table.exportOrder() : null;
    try {
      const { records, toXlsx } = await import('../convert/xlsx');
      const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
      this.saveBlob(await toXlsx(shown ?? records(root), { sheetName: sheetBase(base), order }), `${base}.xlsx`);
      track('feature_used', { feature: 'export_xlsx' });
    } catch (e) {
      this.toast(tooDeep(e) ? 'Nesting is too deep to convert' : "Couldn't create the Excel file", 'err');
    }
  }

  // ── Commands: documents ────────────────────────────────────────────────

  /** `outputFirst`: the caller reads nothing back afterwards, so a big document may draw its output first. */
  /** `file`: the file `text` was read from, as is (readText), which the analysis worker then reads itself. */
  /**
   * `format`: what the document is read as (default: what its file name says; a document without one, pasted, is read
   * as the one before it was). Undo brings back the one before with the document before.
   */
  load(text: string, name: string | null, persist = true, outputFirst = false, file?: File, format: SourceFormat = name ? formatOfName(name) : this.inFmt) {
    // (A document in the editor: huge mode's file goes.)
    this.huge?.close();
    // Line ends as the editor keeps them, before anything else reads the text: a tree's offsets (from a
    // worker, over this text) must match the editor's, or values and positions shift a character a line.
    text = lf(text);
    this.newDoc();
    this.fromFile = file ? { file, text, doc: null } : null;
    this.pendingLoad = null;
    this.releaseWorkerDocuments();
    this.persistEnabled = persistenceAfterLoad(this.persistEnabled, persist);
    this.resetNext = true;
    this.loadSeq++; // drops what an earlier load still has pending
    // (The name shows at once; it is saved with the document, once the editor has it: see persistNow. The
    // sizes and counts shown were the document before's.)
    store.set({ fileName: name, sizes: null, stats: null });
    const names: [string | null, string | null] = [this.edName, name];
    const formats: [SourceFormat, SourceFormat] = [this.inFmt, format];
    // (A new document: its CSV separator is detected again, a .tsv file's is a tab.)
    this.csvDelim = /\.tsv$/i.test(name ?? '') ? '\t' : 'auto';
    if (format !== this.inFmt) this.setInputFormat(format, false);
    else this.publishInput();
    if (text.length >= STEPS_MIN) this.startProgress();
    // (Its output, read off its tape, comes with its analysis: until then the view shows nothing of the one before.)
    if (this.settings.view === 'format' && this.prettyFromTape(text.length)) this.blankFormat();
    if (outputFirst && this.outputFirst(text, name, () => this.finishLoad(text, persist, true, names, formats))) {
      // Until the editor has it, input would act on the old document: the first input hands it over at once.
      this.pendingLoad = { seq: this.loadSeq, text, persist, names, formats };
      return;
    }
    this.finishLoad(text, persist, false, names, formats);
  }

  /**
   * The file the document was loaded from (see load), its text until the editor has it, then that version: until
   * it changes (then this goes, see onChange), the analysis worker reads the file instead of being sent the text.
   */
  private fromFile: { file: File; text?: string; doc: Doc | null } | null = null;
  /**
   * Bumped by each new document and each change to it, a load's arriving in the editor aside (see landing): a copy
   * or download waiting for an output is for the document of its generation (see Waiting). Only newDoc bumps it.
   */
  private docGen = 0;

  /** What the document is (see docGen): the Schema view checks a reply is for the document still there. */
  get docId() {
    return this.docGen;
  }

  /**
   * The document is another one, or another reading of it (an edit, a load, another input format, CSV options): what
   * was made for the one before isn't this one's, and the Schema view is told at once (docWatch).
   */
  private newDoc() {
    this.docGen++;
    this.supersede();
    this.docWatch?.(null);
  }
  /** A load's text is going into the editor (see finishLoad): its change is that load's. */
  private landing = false;

  /** Undo or Redo brought back a document with its file name (see Editor.setValue). */
  private renamed = (name: string | null) => {
    this.edName = name;
    store.set({ fileName: name });
  };

  /** Undo while a file is still being read: that file is undone once it arrives (see loadFile), not the document before it. */
  private undoing = () => {
    const r = this.reading;
    if (!r || r.aborted) return false;
    this.undoLoad = r;
    return true;
  };

  /** A load whose output is drawn first and whose editor text is still to come (see flushLoad). */
  private pendingLoad: { seq: number; text: string; persist: boolean; names: [string | null, string | null]; formats: [SourceFormat, SourceFormat] } | null = null;
  /** The file name of the document the editor holds (the store's is a loading document's at once). */
  private edName: string | null = null;
  /** The file being read for the input editor (its request), and one an Undo asked to undo once it arrives. */
  private reading: AbortSignal | null = null;
  private undoLoad: AbortSignal | null = null;

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
    this.finishLoad(p.text, p.persist, true, p.names, p.formats);
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
    // (Only JSON: another format's output is its conversion, made with its analysis.)
    if (text.length < OUTPUT_FIRST || !typed && (s.view !== 'format' || s.sortKeys || LINES_FILE.test(name ?? '')) || mayBeJwt(text) || this.inFmt !== 'json') return false;
    // A big document's Pretty output is read off its tape (see runFormat): nothing to make here. A load goes
    // on to the editor and the analysis (finishLoad); after typing, only the analysis runs.
    if (this.prettyFromTape(text.length)) return typed && this.analyzeOnly(retained ?? (typeof text === 'string' ? Doc.of(text) : text), name, next);
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
      const step = pack!.unpacker(tree, analysisText);
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
      const request = { id: seq, indent, parse: typed && !fast, fast, reuseIndex: true, sortKeys: s.sortKeys, lines: LINES_FILE.test(name ?? ''), escape: s.escape, base: baseId, progress: showing };
      // (A worker that let go of a huge document answers an edit with "reset": it gets all of it again.)
      const resend = () => this.postDocument(w, request, document, false);
      this.reindentJob = { id: seq, done, fallback: here, resend, baseText, baseIndex: this.fmt.inlineIndex({ starts: new Int32Array(0), maxLen: 0 }), baseSlice: this.fmt.snapshotText(), outParts: [], displayParts: [], made, arrived };
      this.postDocument(w, request, document, false, undefined, showing ? this.span(0, FORMAT_SENT) : undefined);
    }
    return true;
  }

  /**
   * Whether the Format view reads a document of `length` characters off its tape (see pretty.ts), never making its
   * output whole: a big one (parsed in the worker) shown Pretty, not sorted, not escaped.
   */
  private prettyFromTape(length: number) {
    const s = this.settings;
    return length >= WORKER_MIN && !s.minify && !s.escape && !s.sortKeys;
  }

  /** After typing in a big document shown Pretty (see prettyFromTape): its analysis in the worker, then `next`. */
  private analyzeOnly(document: Doc, name: string | null, next: (res?: ParseResult, metrics?: DocumentMetrics) => void) {
    const seq = ++this.loadSeq;
    clearTimeout(this.timer);
    this.queueAnalysis(seq, document, name, (tree, metrics) => {
      if (seq !== this.loadSeq) return;
      if (!tree) return next();
      const step = pack!.unpacker(tree, document.toString());
      const run = () => {
        if (seq !== this.loadSeq) return;
        const res = step(performance.now() + 8);
        if (res) next(res, metrics);
        else soon(run);
      };
      run();
    }, 0, () => seq === this.loadSeq && next());
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
  private reindentJob: { id: number; done: (out: string | null, tree?: PackedTree, metrics?: DocumentMetrics, index?: CodeIndex, display?: string, change?: CodeChange & { base: number }, patch?: string, inline?: boolean) => void; fallback: () => void; resend?: () => void; baseText: string; baseIndex: CodeIndex; baseSlice: (a: number, b: number) => string; outParts: string[]; displayParts: string[]; made?: (f: number) => void; arrived?: (chars: number, size: number) => void } | null = null;

  private workerDoc: Doc | null = null;
  private workerDocId = 0;
  private analysisWorker: Worker | null = null;
  /** The analysis worker was warmed up (see warmAnalysis) and has had no document yet: it holds nothing. */
  private analysisFresh = false;
  /** The analysis worker has a document to analyse whose tree (or word that it stopped) hasn't come back yet. */
  private analysisBusy = false;
  /**
   * The newest analysis asked for while one was in flight: sent once that one answers (see analysisDone). The
   * worker gets one document at a time, so a burst of big pastes costs one more analysis, not one each.
   */
  private analysisNext: (() => void) | null = null;
  /** Versions sent to be analysed as the output's (see queueAnalysis `good`): each once. */
  private goodSent = new WeakSet<object>();

  /** The analysis in flight answered (its tree, or that it stopped, or failed): the newest asked for goes now. */
  private analysisDone() {
    this.analysisBusy = false;
    const next = this.analysisNext;
    this.analysisNext = null;
    next?.();
  }
  private analysisFails = 0;
  private analysisDoc: Doc | null = null;
  private analysisDocId = 0;
  private analysisTimer = 0;

  /** A new document keeps the warmed formatter, but drops every old document and analysis task. */
  private releaseWorkerDocuments() {
    clearTimeout(this.analysisTimer);
    // (A warmed worker that has had no document holds nothing: it stays, warm, for the next big one.)
    if (!this.analysisFresh) {
      this.analysisWorker?.terminate();
      this.analysisWorker = null;
      this.analysisBusy = false;
    }
    this.analysisNext = null;
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
    // A big file just loaded: the analysis worker reads it itself (reindent.worker.ts readFile), so its text
    // isn't copied over in chunks. (A reset, if the file changed since, sends the text then.)
    if (analysis && this.fromFile?.doc === document) {
      w.postMessage({ ...request, file: this.fromFile.file, size: document.length });
      sent?.(1);
      remember();
      return;
    }
    w.postMessage({ ...request, start: true });
    let at = 0;
    const send = () => {
      if (this.dead || request.id !== this.loadSeq || (analysis ? this.analysisWorker : this.worker) !== w) {
        // (Not all sent: the worker won't answer it, so the newest asked for meanwhile goes now.)
        if (analysis && !this.dead && this.analysisWorker === w && !request.good) this.analysisDone();
        return;
      }
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
      // One at a time: while the worker has one, this waits (only the newest waits: see analysisNext).
      if (this.analysisBusy && this.analysisWorker) {
        this.analysisNext = send;
        return;
      }
      send();
    }, wait);
    const send = () => {
      if (id !== this.loadSeq || this.dead) return;
      if (this.analysisFails >= 3) return failed?.();
      const from = showing ? this.progressShown() : -1;
      const sentTo = from + ANALYSIS_SENT * (1 - from);
      const sent = from >= 0 ? this.span(from, sentTo) : undefined;
      const worked = from >= 0 ? this.span(sentTo, 1) : undefined;
      try {
        const w = this.analysisWorker ??= new Worker(new URL('./reindent.worker.ts', import.meta.url));
        // The output shown is of an older version than this one, not yet the views': it is analysed too, once
        // (its result may come too late to be used, when the text changed again: not sent again for each change).
        const good = this.fmtSrcVer instanceof Doc && this.fmtSrcVer !== document && this.fmtSrcVer !== this.goodVer && !this.goodSent.has(this.fmtSrcVer) ? this.fmtSrcVer : null;
        if (good) this.goodSent.add(good);
        w.onmessage = (e: MessageEvent<{ id: number; tree?: PackedTree; metrics?: DocumentMetrics; sizes?: Sizes; reset?: boolean; good?: boolean; dropped?: boolean; progress?: number; pretty?: { indent: string; index: PrettyIndex } }>) => this.withPack(!!e.data.tree, () => {
          // (The analysis in flight answered, wanted or not: the newest asked for meanwhile goes now.)
          if (!e.data.good && (e.data.tree || e.data.dropped || e.data.reset) && this.analysisWorker === w) this.analysisDone();
          if (e.data.id !== this.loadSeq || e.data.dropped) return;
          if (e.data.tree && e.data.pretty) prettyIndexes.set(e.data.tree.nodes, e.data.pretty);
          if (e.data.reset) { this.analysisDoc = null; this.fromFile = null; this.queueAnalysis(id, document, name, done); }
          else if (e.data.progress !== undefined) worked?.(e.data.progress);
          else if (e.data.good && e.data.tree && good) {
            // (The views already show the editor's current version, which another path parsed meanwhile: this
            // older one would take its place.)
            if (this.goodVer === this.ed.version) return;
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
        });
        w.onerror = (e) => {
          e.preventDefault();
          // Ignore duplicate failure events and never move this full parse onto the typing thread.
          if (this.analysisWorker !== w) return;
          reportError(e.error ?? new Error(), 'worker');
          this.analysisFails++;
          w.terminate(); this.analysisWorker = null; this.analysisDoc = null;
          if (id === this.loadSeq) failed?.();
          this.analysisDone();
        };
        // (The Format view shown Pretty off the tape: the worker indexes its lines too, see drawPretty.)
        const pretty = this.settings.view === 'format' && this.prettyFromTape(document.length) ? this.indent : undefined;
        const request = { id, analysis: true, lines: LINES_FILE.test(name ?? ''), escape: this.settings.escape, progress: !!worked, pretty };
        const current = () => this.postDocument(w, request, document, true, undefined, sent);
        this.analysisFresh = false;
        this.analysisBusy = true;
        if (good) this.postDocument(w, { ...request, good: true, progress: false }, good, true, current);
        else current();
      } catch (error) { reportError(error, 'worker'); this.analysisFails++; this.analysisWorker?.terminate(); this.analysisWorker = null; this.analysisDoc = null; this.analysisBusy = false; failed?.(); }
    };
  }

  /**
   * Makes the analysis worker before a big document comes (when the page is idle, the file picker opens or
   * a file is dragged in), and warms it up: WebAssembly compiled and run a while, so the first big
   * document parses at full speed (see reindent.worker.ts warmTape). `replace`: a document is coming, so a
   * worker that had one (and isn't still analysing it) makes way for a warm one.
   */
  private warmAnalysis(replace = false) {
    if (this.dead || this.analysisFails >= 3) return;
    if (this.analysisWorker) {
      if (!replace || this.analysisFresh || this.analysisBusy) return;
      this.analysisWorker.terminate();
      this.analysisDoc = null;
      this.analysisDocId = 0;
    }
    try {
      const w = new Worker(new URL('./reindent.worker.ts', import.meta.url));
      w.onerror = (e) => {
        e.preventDefault();
        if (this.analysisWorker !== w) return;
        reportError(e.error ?? new Error(), 'worker');
        this.analysisFails++;
        w.terminate();
        this.analysisWorker = null;
        this.analysisFresh = false;
      };
      w.postMessage({ id: -2, warmTape: true });
      this.analysisWorker = w;
      this.analysisFresh = true;
    } catch (error) {
      reportError(error, 'worker');
      this.analysisFails++;
      this.analysisWorker = null;
      this.analysisFresh = false;
    }
  }

  /** Loads the tape's code now (the page does when idle, or when a tape comes). */
  tapeCode(): Promise<unknown> {
    return loadPack();
  }

  /** Workers' messages waiting for the tape's code (see loadPack), in the order they came. */
  private waiting: (() => void)[] | null = null;

  /** Runs a worker's message handler `f`, after the tape's code has loaded if the message brings a tape (`tape`), or one before it did. */
  private withPack(tape: boolean, f: () => void) {
    if (!this.waiting && (pack || !tape)) return f();
    if (this.waiting) return void this.waiting.push(f);
    this.waiting = [f];
    const run = () => void loadPack().then(() => {
      const list = this.waiting ?? [];
      this.waiting = null;
      if (!this.dead) for (const g of list) g();
    }, () => {
      // (Offline before it was ever cached, or a network error: tried again shortly.)
      if (!this.dead) setTimeout(run, 1000);
    });
    run();
  }

  /** The re-indenting worker, started on first use or when a file is about to arrive. */
  private reindentWorker(): Worker | null {
    if (this.dead) return null;
    if (this.worker !== undefined) return this.worker;
    try {
      const w = new Worker(new URL('./reindent.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; out: string | null; tree?: PackedTree; metrics?: DocumentMetrics; index?: CodeIndex; display?: string; change?: CodeChange & { base: number }; sizes?: Sizes; patch?: string; chunk?: string; field?: 'out' | 'display'; size?: number; chunkedOut?: boolean; chunkedDisplay?: boolean; inline?: boolean; indexReuse?: boolean; reset?: boolean; progress?: number; measured?: number }>) => this.withPack(!!e.data.tree, () => {
        if (e.data.measured !== undefined) {
          const done = this.sizesWanted.get(e.data.measured);
          this.sizesWanted.delete(e.data.measured);
          return void done?.((e.data.sizes ?? {}) as Partial<Record<string, number>>);
        }
        if (e.data.id === -1) {
          this.workerWarm = true;
          // A warm worker means a big document may come: its tape's code next, when the page is idle.
          idle(() => void loadPack().catch(() => {}), 2000);
          return;
        }
        if (e.data.id !== this.loadSeq) return;
        if (e.data.sizes) {
          this.measuredSizes = { id: e.data.id, sizes: e.data.sizes };
          store.set({ sizes: e.data.sizes });
          return;
        }
        if (e.data.tree) return void (this.workerParse = { id: e.data.id, tree: e.data.tree, metrics: e.data.metrics });
        const job = this.reindentJob;
        if (e.data.reset) {
          this.workerDoc = null;
          if (job?.resend && job.id === e.data.id) job.resend();
          else job?.fallback();
          return;
        }
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
      });
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
  private finishLoad(text: string, persist: boolean, split: boolean, names: [string | null, string | null], formats: [SourceFormat, SourceFormat]) {
    this.pendingLoad = null;
    const loading = this.progressShown() >= 0 ? this.progressStatus : null;
    this.edName = names[1];
    // (Undo and Redo bring the file names back with the documents. Pasted, the caret goes after it, as a paste's does.)
    this.landing = true;
    try {
      this.ed.setValue(text, this.refocus ? text.length : 0, true, names, formats);
    } finally {
      this.landing = false;
    }
    if (loading) {
      // (The editor's change said "Parsing…": the load goes on. With its output shown first, the editor's step is done too.)
      store.set({ status: (this.progressStatus = loading) });
      if (this.progressShown() >= FORMATTED) this.progress(EDITOR);
    }
    const document = this.ed.version as Doc;
    // (The file's text isn't kept past this: the editor's version stands for it.)
    if (this.fromFile?.text === text) this.fromFile = { file: this.fromFile.file, doc: document };
    if (this.workerDoc?.flat === text && document.flat === text) this.workerDoc = document;
    if (this.fmtSrcVer === null && (this.fmtWorkerId || this.pendingFmtWorkerId)) this.fmtSrcVer = document;
    if (this.refocus) {
      // Pasted in the editor: the user is editing, so it arrives editable (not in the quiet view,
      // where a selection by keyboard would select nothing and the next paste would add to it).
      this.ed.takeOver();
      this.ed.focus();
    }
    const pasted = this.refocus;
    this.refocus = false;
    const seq = this.loadSeq;
    const rest = () => {
      if (seq !== this.loadSeq) return;
      this.loaded = true;
      // A big document in the Format view is parsed and measured by the analysis worker, its tree kept
      // packed until a command needs nodes (as after typing): the page would block on it for seconds.
      // The other views need every node at once; without a worker, the page parses it too.
      if (text.length >= WORKER_MIN && this.settings.view === 'format' && this.analysisFails < 3 && this.inFmt === 'json') {
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
          const step = pack!.unpacker(tree, text);
          const run = () => {
            if (seq !== this.loadSeq) return;
            const res = step(performance.now() + 8);
            if (res) this.analyze(res, metrics);
            else soon(run);
          };
          run();
        }, 0, here, showing);
      } else this.analyzeInSteps();
      // (A file opens at its start; a paste shows where it ends, at the caret.)
      if (!pasted) this.ed.el.scrollTop = 0;
      if (persist) this.persistSoon();
    };
    if (split) soon(rest);
    else rest();
  }

  /**
   * The newest document asked for in each editor (1: the input, 2: Compare's) by a file, a link, a URL or
   * the clipboard: a newer request, Clear, or typing or pasting in that editor aborts it (a download stops),
   * so one that arrives late is dropped instead of replacing a newer one, and says nothing. destroy() aborts both.
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
    this.warmAnalysis(true);
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

  /** `asText`: opened as it reads, binary or not, no format converted (see asks.ts). */
  async loadFile(f: File, source: InputSource = 'file', asText = false) {
    const signal = this.request(1);
    performance.clearMarks('tk:formatted');
    performance.mark('tk:input');
    this.markOutput = true;
    // Too big for the editor: huge-file mode reads it a window at a time (lib/huge, loaded only now).
    // From 300 MiB (less where the device has little memory; tk:hugeMin, in bytes, forces it for smaller files).
    const huge = read('tk:hugeMin');
    // (A .gz file is decompressed there too: to the editor when it is small.)
    if (f.size > Math.min(MAX_DOCUMENT, huge ? +huge : ((navigator as { deviceMemory?: number }).deviceMemory || 8) * 2 ** 26) || /\.gz$/i.test(f.name)) return void import('../huge/open').then((m) => m.openHuge(this, f, source, signal, asText, TallScroll)).then((h) => void (this.huge = h ?? this.huge), () => this.toast(`Couldn't read ${f.name}`, 'err'));
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
    // A binary file's toast reads it again if asked (made here, where no text is in scope: a closure made
    // where one is can keep it alive, and the toast stays until dismissed).
    const again = () => void this.loadFile(f, source, true);
    this.reading = signal;
    try {
      // (Whether it is text at all is asked of what was read: see asks.ts.)
      const [text, { looksBinary, binaryFile }] = await Promise.all([import('../json/read').then((m) => m.readText(f)), import('./asks')]);
      if (this.reading === signal) this.reading = null;
      if (signal.aborted) return unshow();
      // Undone while it was read: it opens, and is undone at once (Redo brings it back).
      const undone = this.undoLoad === signal;
      this.undoLoad = null;
      // (A file that didn't convert opens as text, and its error stays in view: "Opened" would replace it.)
      const open = (format: SourceFormat) => {
        noteLoad(source, 1, f.name);
        // (The file itself goes to the analysis worker only for JSON: another format's JSON is its conversion.)
        this.load(text, f.name, true, true, format === 'json' ? f : undefined, format);
        if (undone) {
          this.flushLoad();
          this.ed.undo();
        } else this.toast(`Opened ${f.name}`, 'ok');
      };
      // Not text (a zip, an image, a video opened by mistake): said so, and read again only when asked (the
      // text, up to hundreds of megabytes, isn't held for as long as the toast stays).
      if (!asText && looksBinary(text)) {
        unshow();
        if (!undone) this.toast(...binaryFile(f.name, again));
        return;
      }
      // A YAML, CSV, XML or TOML file opens as itself, read as that format (its JSON shows on the right).
      open(asText ? 'json' : formatOfName(f.name));
    } catch {
      if (this.reading === signal) this.reading = null;
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
      this.load(text, null, undefined, undefined, undefined, this.pasteFormat(text));
      if (this.settings.autoFormat) this.autoFormat();
    } catch {
      if (signal.aborted) return;
      this.ed.focus();
      this.toast(`Press ${this.mod}V to paste`, 'info');
    }
  }

  async sample() {
    const signal = this.request(1);
    try {
      const { SAMPLE } = await import('./sample');
      if (signal.aborted) return;
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
    const before = this.edName;
    this.edName = null;
    store.set({ fileName: null });
    write(KEYS.file, null);
    this.ed.setValue('', 0, false, [before, null]);
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

  private onCompareChange = (kind: ChangeKind) => {
    if (kind !== 'set') this.requests[2]?.abort();
    // (A paste over everything leaves the file it held, as in the input editor.)
    if (kind === 'paste' && this.ed2.pasteFull) store.set({ cmpFile: null });
    clearTimeout(this.cmpTimer);
    const len = this.ed2.length; // (not .text: no need to join an edited document's pieces for this)
    this.cmpTimer = window.setTimeout(this.analyzeCompare, len < 100_000 ? 60 : len < 1_000_000 ? 160 : 400);
  };

  /** Squiggles for the modified document + publish it to the Compare panel. */
  private analyzeCompare = () => {
    clearTimeout(this.cmpTimer);
    const text = this.ed2.text;
    const diags: Diagnostic[] = [];
    let r: ParseResult | null = null;
    if (text.trim()) {
      r = parse(text);
      for (let i = 0; i < r.issues.length && i < 300; i++) diags.push({ p: r.issues[i].p, cls: 'me' });
      if (r.error) diags.push({ p: r.error.p, cls: 'me' });
      for (let i = 0; i < r.warnings.length && i < 300; i++) diags.push({ p: r.warnings[i].p, cls: 'mw' });
    }
    this.ed2.setDiagnostics(diags);
    // The open panel diffs this parse instead of parsing the text again (closed, nothing holds the tree).
    store.set({ cmpText: text, cmpParsed: r && this.settings.view === 'compare' ? { text, result: r } : null });
    write(KEYS.cmp, text && text.length <= MAX_PERSIST ? text : null);
  };

  /** Called by the Compare panel with per-line marks for both editors (nulls also when it closes). */
  compareMarks(left: Uint8Array | null, right: Uint8Array | null) {
    const on = this.settings.view === 'compare';
    // (Another format's lines aren't the JSON's the panel compared.)
    this.ed.setLineMarks(on && this.inFmt === 'json' ? left : null);
    this.ed2.setLineMarks(on ? right : null);
    if (!on && store.get().cmpParsed) store.set({ cmpParsed: null });
  }

  /** Reveal a difference in both documents without moving focus. */
  compareJump(left: number | undefined, right: number | undefined) {
    if (left !== undefined && this.inFmt === 'json') this.ed.point(left);
    if (right !== undefined) this.ed2.point(right);
  }

  loadCompare(text: string, name: string | null) {
    const before = this.cmpName();
    store.set({ cmpFile: name });
    this.ed2.setValue(text, 0, false, [before, name]);
    this.analyzeCompare();
  }

  /** The Compare editor's file name, and Undo or Redo bringing one back (see Editor.setValue). */
  private cmpName = () => store.get().cmpFile;
  private cmpRenamed = (name: string | null) => store.set({ cmpFile: name });

  /** `asText`: as loadFile's. */
  async loadCompareFile(f: File, source: InputSource = 'file', asText = false) {
    const signal = this.request(2);
    // (Read again when asked, as in loadFile.)
    const again = () => void this.loadCompareFile(f, source, true);
    try {
      const [text, { looksBinary, binaryFile }] = await Promise.all([import('../json/read').then((m) => m.readText(f)), import('./asks')]);
      if (signal.aborted) return;
      if (!asText && looksBinary(text)) return this.toast(...binaryFile(f.name, again));
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
    const before = this.cmpName();
    store.set({ cmpFile: null });
    this.ed2.setValue('', 0, false, [before, null]);
    this.analyzeCompare();
    this.ed2.focus();
  }

  /** Swap original and modified (both undoable). */
  swapCompare() {
    track('feature_used', { feature: 'compare_swap' });
    this.flushLoad();
    // (An input in another format goes over as its JSON, which Compare compared: the modified document is JSON.)
    const json = this.inFmt === 'json';
    // (Its JSON is what goes over: there is none while it doesn't read as its format.)
    if (!json) this.fresh();
    if (!json && this.converted === null) {
      this.toast("Can't do that yet. Fix the error first.", 'err');
      this.gotoError();
      return;
    }
    const a = json ? this.ed.text : this.compareLeft();
    const b = this.ed2.text;
    const name = this.edName;
    const fa = json || !name ? name : name.replace(/\.[a-z0-9]+$/i, '') + '.json';
    const fb = store.get().cmpFile;
    this.resetNext = true;
    this.edName = fb;
    this.ed.setValue(b, 0, false, [name, fb], [this.inFmt, 'json']);
    this.ed2.setValue(a, 0, false, [fb, fa]);
    this.setInputFormat('json', false);
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
    // (Saved as what it is: a YAML input as .yaml.)
    const [ext, type] = FORMAT_FILE[this.inFmt];
    const name = store.get().fileName || `data.${ext}`;
    track('feature_used', { feature: 'download_input' });
    this.save(this.ed.text, /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${ext}`, type);
  }

  private save(text: string, name: string, type: string) {
    this.saveBlob(new Blob([text], { type }), name);
  }

  /** Downloads `blob` as `name` (no prompt: the browser saves it where downloads go). */
  saveBlob(blob: Blob, name: string) {
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
    try {
      // (The button's markup loads meanwhile: shared rarely, it isn't part of the first load.)
      const [link, { snippet }] = await Promise.all([this.shareUrl(), import('../badge')]);
      if (!link) return this.toast('Nothing to share yet', 'info');
      const { url, comparing } = link;
      track('feature_used', { feature: comparing ? 'share_compare' : 'share_link', value: as });
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

  /** The link `share` makes (null: nothing to share). Rejects where the browser can't compress. */
  async shareUrl(): Promise<{ url: string; comparing: boolean } | null> {
    this.flushLoad();
    const comparing = this.settings.view === 'compare';
    const a = this.ed.text;
    const b = comparing ? this.ed2.text : '';
    if (!a.trim() && !b.trim()) return null;
    // Valid JSON travels minified (a shorter link) and opens formatted; anything else as typed.
    const r = this.fresh();
    const rb = b.trim() ? parse(b) : null;
    const compact = (text: string, r: ParseResult | null) => (r?.root && !r.error && !r.issues.length ? formatDoc(text, r, '') : text);
    // (Another format travels as typed, and says what it is.)
    const source = this.inFmt !== 'json';
    const hash = await linkHash({
      a: a.trim() ? { text: this.jwt ? a.trim() : source ? a : compact(a, r) } : undefined,
      b: rb ? { text: compact(b, rb) } : undefined,
      view: this.settings.view,
      to: this.settings.target,
      in: this.inFmt !== 'json' ? this.inFmt : undefined,
    });
    return { url: `${location.origin}/${hash}`, comparing };
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
    // A document past LINK_DOCUMENT opens only when asked (a small link can hold more than a tab can).
    const open = async (max: number) => {
      const signal = this.requestFor(link);
      const docs: (LinkDoc | undefined)[] = [];
      try {
        for (const d of [link.a, link.b]) docs.push(d && 'data' in d ? { text: await decodeDoc(d.data, max) } : d);
      } catch (e) {
        if (signal.aborted) return;
        if (!(e instanceof LinkTooLarge)) return broken();
        if (max < MAX_DOCUMENT) {
          const { bigLink } = await import('./asks');
          if (!signal.aborted) this.toast(...bigLink(() => void open(MAX_DOCUMENT)));
          return;
        }
        return this.toast('That share link is too large to open', 'err');
      }
      if (!signal.aborted) void this.openRequest({ a: docs[0], b: docs[1], view: link.view, to: link.to, in: link.in }, signal);
    };
    await open(LINK_DOCUMENT);
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
      // (Another format, as the link says or its URL's file name does, opens as itself.)
      const format = r.in ?? formatOfName(a.name);
      const pretty = format === 'json' ? open(a.text) : null;
      this.load(pretty ?? a.text, a.name, true, pretty === null, undefined, format);
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
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' }, signal });
      if (signal.aborted) return null;
      if (!res.ok) {
        this.toast(`Request failed: ${res.status} ${res.statusText}`, 'err');
        return null;
      }
      const text = await (await import('../json/read')).readText(res);
      const name = url.pathname.split('/').pop() || url.hostname;
      return { text, name: /\.json$/i.test(name) || formatOfName(name) !== 'json' ? name : name + '.json', host: url.hostname };
    } catch {
      if (signal.aborted) return null;
      const why = res ? 'The connection dropped before the whole file arrived. Try again.' : await this.fetchFailure(url, signal);
      if (why && !signal.aborted) this.toast(why, 'err');
      return null;
    }
  }

  /**
   * Why a request for `url` got no reply the page may read. The browser says the same for a server that doesn't
   * allow cross-origin reads, a blocked http:// link and one it can't reach, so this asks once more for a reply
   * the page may not read: one arrives only if the server is there. null once `signal` aborts.
   */
  private async fetchFailure(url: URL, signal: AbortSignal): Promise<string | null> {
    if (navigator.onLine === false) return "You're offline. Connect to the internet and try again.";
    // (An https page may only ask this device over http.)
    if (url.protocol === 'http:' && location.protocol === 'https:' && !/^(?:(?:.+\.)?localhost|127(?:\.\d+){3}|\[::1\])$/.test(url.hostname))
      return 'Browsers block http:// links on an https page. Try the https:// address.';
    const probe = new AbortController();
    const stop = () => probe.abort();
    signal.addEventListener('abort', stop);
    try {
      await fetch(url, { mode: 'no-cors', signal: probe.signal });
      return "Couldn't fetch. The server must allow cross-origin requests (CORS).";
    } catch {
      return signal.aborted ? null : "Couldn't reach the server. Check the address or try again later.";
    } finally {
      probe.abort(); // (the headers tell enough: the body isn't wanted)
      signal.removeEventListener('abort', stop);
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
        // A big document's search finishes in steps: its final count arrives here (like the code views' onFind).
        found: (r) => {
          if (this.settings.view === 'graph' && this.query) store.set({ find: { ...store.get().find, ...r } });
        },
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
    // (Huge mode has no Schema view: a file too big for the editor isn't validated.)
    if (view === 'schema' ? this.huge : this.huge?.view(view)) return;
    this.flushLoad();
    store.set({ menu: null });
    const viewSeq = ++this.viewSeq;
    if (view !== 'graph') this.dropGraphWaiters();
    if (view === 'graph') {
      this.graphShow = { seq: viewSeq, ready };
      // The tab opens at once; the graph draws when its code has arrived (usually prefetched already).
      if (!this.graph) void this.loadGraph().then(() => this.showGraph(viewSeq));
    }
    const packed = this.packed?.id === this.loadSeq ? this.packed : this.goodPacked;
    if (view !== 'format' && !paired(view) && packed) {
      const { tree, text, metrics } = packed;
      const seq = this.loadSeq;
      // (The Tree and the Table read the root's children at once: they are made in the steps too.)
      const step = pack!.unpacker(tree, text);
      const run = () => {
        if (this.dead || seq !== this.loadSeq || viewSeq !== this.viewSeq) return;
        const res = step(performance.now() + 8);
        if (!res) return soon(run);
        if (packed.id === this.loadSeq) this.analyze(res, metrics);
        // (A newer result was shown while this one was made, the editor's current version: this one is dropped.)
        else if (this.goodPacked === packed) {
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
    // (Compare and Schema have a second editor: closing one goes back to the view open before them.)
    this.setSettings(paired(view) && !paired(prev) ? { view, prevView: prev as Settings['prevView'] } : { view });
    if (this.query) requestAnimationFrame(() => this.dead || (paired(this.settings.view) ? this.closeFind() : this.refind(true)));
    if (view === 'table') {
      const root = this.good?.root ?? null;
      // (A selected primitive root has no container: the table says what it can show, as for an unselected one.)
      const base = this.sel ? (this.sel.t >= ARR ? this.sel : this.sel.u ?? this.sel) : root;
      this.tableShow(base);
    } else this.table.setNode(null);
    if (view === 'tree') {
      this.tree.activate();
      requestAnimationFrame(() => { if (!this.dead) this.tree.render(true); });
    }
    if (view === 'format') this.scheduleFormat(0);
    if (view === 'convert') this.scheduleConvert(0);
    if (view === 'schema') store.set({ docText: this.compareLeft() });
    if (view === 'compare') {
      store.set({ docText: this.compareLeft(), cmpText: this.ed2.text });
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
    for (const w of this.graphWaiters.splice(0)) w.run();
  }

  /** Commands waiting for the Graph view to show (see withGraph). */
  private graphWaiters: { run: () => void; dropped?: () => void }[] = [];

  /** Another view, a graph whose code didn't load, or the tool closing: what waited for the graph never runs. */
  private dropGraphWaiters() {
    for (const w of this.graphWaiters.splice(0)) w.dropped?.();
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
    if (this.formatCurrent(this.fmtSettings())) return this.fmtPretty ? this.fmtPretty.slice() : this.fmtText;
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
  /** What drawFormat last gave the view (the output as shown: escaped when it is). */
  private fmtOut = '';
  /** Or the pretty text read off a big document's tape it gave the view (see drawPretty): never made whole. */
  private fmtPretty: PrettyText | null = null;
  /** Bumped when the Format view is drawn: a pretty index still being made (see drawPretty) is dropped. */
  private prettySeq = 0;
  /**
   * The pretty index being made (see drawPretty), while it is prettySeq's, and what for: only while it is (a tape
   * held here kept its document, and the worker's index of it, alive into the next one's load).
   */
  private prettyMaking = -1;
  private prettyFor: { tape: Tape; indent: string; key: string } | null = null;
  /** The output drawn (empty) is the one too large to make: the view and Copy say so. */
  private fmtTooLarge = false;
  private fmtVersion = 0;
  private fmtCounts: { version: number; pretty: number; minified: number; escaped: number } | null = null;
  /** User Timing for DevTools: a file opened (tk:input) → its output painted (tk:formatted). */
  private markOutput = false;

  /** Keep accepted output while analysis catches up, then match the newest good document. */
  private formatCurrent(key: string): boolean {
    return key === this.fmtKey && (this.goodVer !== null && this.goodVer === this.fmtSrcVer || !!(this.fmtWorkerId || this.pendingFmtWorkerId) && (this.parsedVer !== this.ed.version || !this.res?.root));
  }

  private runFormat = () => {
    if (this.settings.view === 'format') this.makeFormat();
  };

  /** Draws the Format view's output for the current document and settings (also while another view shows: see outputLater). */
  private makeFormat() {
    // Reformat the accepted source promptly even while its tree is still being analysed.
    if (this.fmtKey !== this.fmtSettings() && this.fmtSrcVer instanceof Doc && this.fmtSrcVer !== this.goodVer && (this.fmtWorkerId || this.pendingFmtWorkerId)) {
      const retained = this.fmtSrcVer;
      if (this.outputFirst(retained, store.get().fileName, (res, metrics) => this.analyze(res, metrics), true, retained)) return;
    }
    // A big document's output for other settings (Minify, sorted, escaped) is made in the worker too: here it
    // would hold the page for seconds.
    const ver = this.goodVer;
    if (this.fmtKey !== this.fmtSettings() && ver instanceof Doc && ver.length >= WORKER_MIN && !this.prettyFromTape(ver.length)) {
      if (this.outputFirst(ver, store.get().fileName, (res, metrics) => this.analyze(res, metrics), true, ver)) return;
    }
    if (this.packed && this.fmtKey !== this.fmtSettings()) this.fresh();
    if (this.fmtKey !== this.fmtSettings()) this.materializeGood();
    // Already drawn for this document and settings (a big load draws it before its analysis).
    const key = this.fmtSettings();
    const pretty = this.prettySource();
    if (pretty) return this.drawPretty(pretty.tape, pretty.src, key);
    const drawn = this.formatCurrent(key);
    // (Already found too large to make: the view keeps saying so.)
    if (drawn && this.fmtTooLarge) return;
    let text: string;
    try {
      text = drawn ? this.fmtText : this.formatted();
      if (!drawn) this.drawFormat(text, key);
    } catch (e) {
      if (!tooLarge(e)) throw e;
      // (Pretty-printing very deep nesting: about 2·depth² characters.) The view says so instead.
      this.drawFormat('', key);
      this.fmtTooLarge = true;
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
  }
  private fmtStatSeq = 0;

  /** The Format view's settings, as a key: output is redrawn when they or the document change. */
  private fmtSettings() {
    const { minify, escape, sortKeys } = this.settings;
    return `${minify}${escape}${sortKeys}${this.indent}`;
  }

  /** Shows `text` (the formatted `src`, or its pretty text read off its tape) in the Format view. */
  private drawFormat(text: string | PrettyText, key: string, index?: CodeIndex, display?: string, change?: CodeChange, patch?: string, inline = false, version: object | null = this.goodVer) {
    this.fmtTooLarge = false;
    if (store.get().fmt.tooLarge) store.set({ fmt: { ...store.get().fmt, tooLarge: false } });
    if (!change) this.fmtWorkerId = 0;
    this.pendingFmtWorkerId = 0;
    this.fmtVersion++;
    this.fmtStatSeq++;
    this.prettySeq++;
    // (A pretty index still being made is for output no longer wanted, or is this one: done either way.)
    this.prettyFor = null;
    const { minify, escape } = this.settings;
    this.fmtSrcVer = version;
    this.fmtKey = key;
    const pretty = typeof text === 'string' ? null : text;
    this.fmtPretty = pretty;
    this.fmtText = pretty ? '' : (text as string);
    const out = pretty ? '' : display ?? (escape && text ? JSON.stringify(text) : (text as string));
    this.fmtOut = out;
    if (pretty) this.fmt.setLines(pretty, jsonRow, true);
    else this.fmt.setText(out, jsonRow, true, null, index, change, patch, inline);
    this.noteExpiry(minify || escape ? '' : out);
    // (After the caller has said whether it is the too-large note: see runFormat.)
    if (this.outputWait.pending) queueMicrotask(() => this.outputDrawn());
  }

  /** The Format view shows nothing, and nothing is current there (a big new document's output comes with its analysis). */
  private blankFormat() {
    this.prettySeq++;
    this.prettyFor = null;
    this.fmtKey = '';
    this.fmtSrcVer = null;
    this.fmtPretty = null;
    this.fmtText = this.fmtOut = '';
    this.fmt.setText('', jsonRow, true);
  }

  /** The newest good document's tape and text, when the Format view reads its output off them (see prettyFromTape). */
  private prettySource(): { tape: Tape; src: string } | null {
    if (!pack || !this.prettyFromTape(this.goodText.length)) return null;
    if (this.goodPacked) return { tape: pack.tapeOfPacked(this.goodPacked.tree), src: this.goodPacked.text };
    const z = this.good?.root ? pack.tapeOfNode(this.good.root) : null;
    return z && z.i === 0 ? { tape: z.tape, src: z.src } : null;
  }

  /** Shows the pretty text of `tape` (of `src`), its lines indexed first in short steps. */
  private drawPretty(tape: Tape, src: string, key: string) {
    const ver = this.goodVer;
    if (this.fmtPretty && this.formatCurrent(key)) return this.prettyStats(this.fmtPretty);
    const indent = this.indent;
    // (Already being made for this tape and settings: that one is shown.)
    const f = this.prettyFor;
    if (this.prettyMaking === this.prettySeq && f?.tape === tape && f.indent === indent && f.key === key) return;
    const seq = ++this.prettySeq;
    this.prettyMaking = seq;
    const mine = (this.prettyFor = { tape, indent, key });
    // (Indexed by the worker that parsed it, for this indent, when the Format view was shown: else here, in steps.)
    const made = prettyIndexes.get(tape.nodes);
    const run = made?.indent === indent ? () => made.index : pack!.prettyIndexer(tape, src, indent);
    const step = () => {
      if (seq !== this.prettySeq || this.dead || ver !== this.goodVer || key !== this.fmtSettings()) {
        // (Dropped: nothing is made for it any more, and its tape isn't held.)
        if (this.prettyFor === mine) this.prettyFor = null;
        if (this.prettyMaking === seq) this.prettyMaking = -1;
        return;
      }
      const index = run(performance.now() + 8);
      if (index === undefined) return void soon(step);
      if (index === null) {
        // (Nesting so deep its indentation alone would be huge.) The view says so, as runFormat does.
        this.drawFormat('', key, undefined, undefined, undefined, undefined, false, ver);
        this.fmtTooLarge = true;
        store.set({ fmt: { lines: 0, pretty: 0, minified: 0, escaped: 0, tooLarge: true } });
        return;
      }
      const text = new pack!.PrettyText(tape, src, indent, index);
      this.drawFormat(text, key, undefined, undefined, undefined, undefined, false, ver);
      this.prettyStats(text);
    };
    step();
  }

  /** The Format view's line count and sizes for pretty text read off a tape (its document was measured in the worker). */
  private prettyStats(text: PrettyText) {
    const m = this.goodMetrics;
    if (!m) return;
    const extra = m.extra + m.units * this.indent.length;
    store.set({ fmt: { lines: text.index.starts.length, pretty: m.min + extra, minified: m.min, escaped: 0 } });
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

  /**
   * Replaces the input with the Format view's output (undoable). While Flatten or Unflatten shows: with theirs, and
   * the other direction shows, giving the input back.
   */
  useOutput() {
    const r = this.fresh();
    const s = this.settings;
    const flat = s.view === 'convert' && isFlat(s.target);
    // (Format offers the repaired document; flatten and unflatten take the input only as it is, valid: JSON Lines and
    // other formats as they read, never with repairs.)
    if (!r?.root || (flat && store.get().status.kind !== 'valid')) return this.toast(r ? "Can't do that yet. Fix the error first." : 'Nothing to format yet', r ? 'err' : 'info');
    track('feature_used', { feature: 'use_output' });
    if (flat) {
      // Only the conversion of the text in the editor now, read as it is: checked when it arrives, as the parse
      // above may be an earlier text's while a reader (JWT, YAML…) still loads, and a broken edit keeps the last valid
      // document's on show. And only for this view session: leaving Convert stops its conversion, and the one made on
      // coming back must not act on it. (Other options or another target end its wait with nothing: convFinished.)
      const ver = this.ed.version;
      const at = this.viewSeq;
      void (this.convLater() ?? Promise.resolve(this.convOutput())).then((out) => {
        // (The status is the latest analysis's: of this version once its parse arrived, valid only without repairs.)
        if (out && !this.dead && this.ed.version === ver && store.get().status.kind === 'valid' && this.viewSeq === at) {
          // (A conversion's output is one string.)
          this.replaceText(out as string, s.target === 'flatten' ? 'Flattened input' : 'Unflattened input');
          this.setConvert({ target: s.target === 'flatten' ? 'unflatten' : 'flatten' });
        }
      });
      return;
    }
    const fixed = this.fixed(r);
    this.transform(
      (res, t) => (s.escape ? JSON.stringify(formatDoc(t, res, '', s.sortKeys)) : formatDoc(t, res, s.minify ? '' : this.indent, s.sortKeys)),
      () => (s.escape ? 'Escaped input to a JSON string' : s.minify ? 'Minified input' : 'Formatted input') + fixed,
    );
  }

  copyOutput() {
    const msg = this.settings.escape ? 'Copied as a JSON string' : this.settings.minify ? 'Copied minified JSON' : 'Copied formatted JSON';
    const later = this.outputLater();
    if (later) {
      // The output for these settings is still being made (a big document, after a style change): the copy
      // waits for it, handing the clipboard a promise so the click still counts when the text arrives.
      track('feature_used', { feature: 'copy_output' });
      void this.copyLater(later, msg, () => (store.get().fmt.tooLarge ? this.toast('The result is too large', 'err') : this.toast('Nothing to copy yet', 'info')));
      return;
    }
    const pretty = this.prettyNow();
    if (pretty) {
      // (A big document's pretty output, read off its tape: made in parts, in steps, never one string.)
      track('feature_used', { feature: 'copy_output' });
      void this.copyLater(this.prettyParts(pretty), msg, () => this.toast('Nothing to copy yet', 'info'));
      return;
    }
    const out = this.drawnOutput() || this.unlessTooLarge(() => this.output());
    if (out === null) return;
    if (!out) return store.get().fmt.tooLarge ? this.toast('The result is too large', 'err') : this.toast('Nothing to copy yet', 'info');
    track('feature_used', { feature: 'copy_output' });
    void this.copy(out, msg);
  }

  /** The pretty output read off the tape (see drawPretty), when it is the current document's for these settings. */
  private prettyNow() {
    return this.fmtPretty && this.formatCurrent(this.fmtSettings()) ? this.fmtPretty : null;
  }

  /** `text` as Blob parts, made in short steps (see PrettyText.parts). */
  private prettyParts(text: PrettyText): Promise<string[] | null> {
    // (Asked again while they are made, Copy held down say: the same ones.)
    if (this.partsFor?.text === text) return this.partsFor.parts;
    const run = text.parts();
    const parts = new Promise<string[] | null>((done) => {
      const step = () => {
        if (this.dead) return done(null);
        const got = run(performance.now() + 8);
        if (got) done(got);
        else soon(step);
      };
      step();
    });
    this.partsFor = { text, parts };
    void parts.then(() => {
      if (this.partsFor?.parts === parts) this.partsFor = null;
    });
    return parts;
  }
  private partsFor: { text: PrettyText; parts: Promise<string[] | null> } | null = null;

  downloadOutput() {
    const name = () => `${(store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '')}${this.settings.escape ? '.escaped' : this.settings.minify ? '.min' : ''}.json`;
    const later = this.outputLater();
    if (later) {
      track('feature_used', { feature: 'download_output' });
      const file = name();
      void later.then((out) => {
        // (Superseded: the settings or the document changed before the output for this click came.)
        if (this.dead || out === undefined) return;
        if (!out || !out.length) return store.get().fmt.tooLarge ? this.toast('The result is too large', 'err') : this.toast('Nothing to download yet', 'info');
        if (typeof out === 'string') this.save(out, file, 'application/json');
        else this.saveBlob(new Blob(out, { type: 'application/json' }), file);
      });
      return;
    }
    const pretty = this.prettyNow();
    if (pretty) {
      track('feature_used', { feature: 'download_output' });
      const file = name();
      void this.prettyParts(pretty).then((parts) => parts && this.saveBlob(new Blob(parts, { type: 'application/json' }), file));
      return;
    }
    const out = this.drawnOutput() || this.unlessTooLarge(() => this.output());
    if (out === null) return;
    if (!out) return store.get().fmt.tooLarge ? this.toast('The result is too large', 'err') : this.toast('Nothing to download yet', 'info');
    track('feature_used', { feature: 'download_output' });
    this.save(out, name(), 'application/json');
  }

  /** The Format output last drawn, if it is for the current settings ('' if not): the view may still be taking it in, in steps. */
  private drawnOutput() {
    return this.formatCurrent(this.fmtSettings()) ? this.fmtOut : '';
  }

  /** Copy/Download waiting for the Format output of the current settings (see outputPending). */
  private readonly outputWait = new Waiting();

  /** Copies and downloads waiting for what the settings or the document no longer are end now, with nothing. */
  private supersede() {
    if (!this.outputWait.wants(this.fmtWait())) this.outputWait.end();
    if (!this.convWait.wants(this.convKey())) this.convWait.end();
  }

  /** What a copy or download of the Format output waits for: these settings' output of this document. */
  private fmtWait() {
    return this.fmtSettings() + '\n' + this.docGen;
  }

  /** Run once the editor's text is analysed: at once if it is, else after the analysis on its way publishes. */
  private readonly analysed: (() => void)[] = [];
  private whenAnalysed(f: () => void) {
    if (this.parsedVer === this.ed.version) f();
    else this.analysed.push(f);
  }

  /**
   * The Format output for the document and settings, when the one made last isn't (another view showed while
   * the document changed, or its analysis is still to come): made now, or once analysed. Null when it is.
   */
  private outputLater(): Promise<Output> | null {
    const pending = this.outputPending();
    if (pending || this.parsedVer === this.ed.version && this.formatCurrent(this.fmtSettings())) return pending;
    // (Asked again before it came: the same wait, and nothing made twice.)
    const key = this.fmtWait();
    if (this.outputWait.wants(key)) return this.outputWait.get(key);
    const later = this.outputWait.get(key);
    this.whenAnalysed(() => (this.formatCurrent(this.fmtSettings()) && this.prettyMaking !== this.prettySeq ? this.outputDrawn() : this.makeFormat()));
    return later;
  }

  /**
   * The output the Format view is still making for the current settings (it shows the last settings' until
   * then), or null when what it shows is current. Resolves with the output, or null if it couldn't be made.
   */
  private outputPending(): Promise<Output> | null {
    const making = this.prettyMaking === this.prettySeq;
    if (this.settings.view !== 'format' || !making && (this.fmtKey === this.fmtSettings() || !this.fmtOut && !this.fmtPretty)) return null;
    return this.outputWait.get(this.fmtWait());
  }

  /**
   * Hands waiting copies and downloads the output once it is the one they asked for (after drawFormat). The
   * settings or the document changed since: they get nothing (a minified copy never gets the pretty output).
   */
  private outputDrawn() {
    const w = this.outputWait;
    const key = this.fmtWait();
    if (!w.wants(key)) return w.end();
    if (this.fmtKey !== this.fmtSettings()) return;
    const pretty = this.fmtPretty;
    if (this.fmtTooLarge || !pretty) return w.end(this.fmtTooLarge ? null : this.fmtOut, key);
    // (A big document's pretty output, read off its tape: in parts made in steps, as once it shows, never one string.)
    void this.prettyParts(pretty).then((parts) => w.end(parts, key));
  }

  /** The text a copy waits for (see copyLater). */
  private copying: Promise<unknown> | null = null;

  /** Copies text that is still on its way, keeping the click's permission to write the clipboard where the browser allows. */
  private async copyLater(text: Promise<Output>, msg: string, none: () => void) {
    // (Asked again for the same text while it comes: that copy is already on its way.)
    if (this.copying === text) return;
    this.copying = text;
    void text.finally(() => {
      if (this.copying === text) this.copying = null;
    });
    const blob = text.then((t) => {
      if (!t || !t.length) throw new Error('no output');
      return new Blob(typeof t === 'string' ? [t] : t, { type: 'text/plain' });
    });
    // (Where the clipboard takes no promise, nothing reads it: its failure is handled below.)
    blob.catch(() => {});
    try {
      if (typeof ClipboardItem === 'undefined') throw new Error('no ClipboardItem');
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      if (!this.dead) this.toast(msg, 'ok');
    } catch {
      const t = await text;
      // (Superseded: the settings or the document changed before the text for this click came.)
      if (this.dead || t === undefined) return;
      if (!t || !t.length) return none();
      const s = typeof t === 'string' ? t : this.unlessTooLarge(() => t.join(''));
      if (s !== null) await this.copy(s, msg);
    }
  }

  // ── Convert ────────────────────────────────────────────────────────────

  setConvert(patch: Partial<Pick<Settings, 'target' | 'rootName' | 'tsStyle' | 'csharpLib' | 'flat'>>) {
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

  /**
   * The last conversion made: its sequence and output ('' for none). The code view may still be taking a big
   * output in, in steps, so Copy and Download take it from here.
   */
  private convDone: { seq: number; out: string; ver: object | null; key: string } = { seq: 0, out: '', ver: null, key: '' };

  /** The Convert view's settings and the document, as a key: what a conversion was made for (see convFinished). */
  private convKey() {
    const s = this.settings;
    return `${s.target}\n${s.rootName}\n${s.tsStyle}\n${s.csharpLib}\n${JSON.stringify(s.flat)}\n${this.docGen}`;
  }

  /** Copy/Download waiting for the conversion asked for last (see convPending). */
  private readonly convWait = new Waiting();

  /**
   * A conversion made, for settings `key`: waiting copies and downloads get it if it is what they asked for (the
   * settings and the document at their click), of the document as analysed now; nothing if those changed since.
   */
  private convFinished(seq: number, out: string, ver: object | null, key = this.convKey()) {
    this.convDone = { seq, out, ver, key };
    const w = this.convWait;
    const now = this.convKey();
    if (!w.wants(now)) return w.end();
    // (Of an analysis before the one on its way: the conversion after it comes, see convLater.)
    if (key === now && ver === this.goodVer && this.parsedVer === this.ed.version) w.end(out, now);
  }

  /**
   * The conversion of the document, when the one made last isn't of it (another view showed while the
   * document changed, or its analysis is still to come): made now, or once analysed. Null when it is.
   */
  private convLater(): Promise<Output> | null {
    const key = this.convKey();
    const pending = this.convPending();
    const d = this.convDone;
    if (!pending && this.parsedVer === this.ed.version && d.seq === this.convSeq && d.ver === this.goodVer && d.key === key) return null;
    const later = pending ?? this.convWait.get(key);
    this.whenAnalysed(() => {
      const c = this.convDone;
      // (One already on its way, e.g. the Convert view's after the analysis, hands it over.)
      if (c.seq !== this.convSeq) return;
      if (c.ver === this.goodVer && c.key === this.convKey()) this.convFinished(c.seq, c.out, c.ver, c.key);
      else void this.runConvert(true);
    });
    return later;
  }

  /**
   * The output of the conversion asked for last while it is still being made (the view shows the one
   * before until then), or null when the view's output is current.
   */
  private convPending(): Promise<Output> | null {
    if (this.settings.view !== 'convert' || this.convDone.seq === this.convSeq) return null;
    return this.convWait.get(this.convKey());
  }

  /** The output the Convert view shows or is making for the current settings. */
  private convOutput() {
    return this.convDone.seq === this.convSeq ? this.convDone.out : this.code.text;
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

  /** `anyView`: for Copy or Download while another view shows (see convLater). */
  private async runConvert(anyView = false) {
    if (this.settings.view !== 'convert' && !anyView) return;
    const seq = ++this.convSeq;
    // (The view closed or changed meanwhile: opening it again converts what it shows then.)
    const current = () => seq === this.convSeq && !this.dead && (anyView || this.settings.view === 'convert');
    const ver = this.goodVer;
    const root = this.good?.root;
    if (!root) {
      this.code.setText('', escapeHtml);
      this.convFinished(seq, '', ver);
      store.set({ convert: { loading: false, error: 'Paste or open valid JSON on the left to convert it.', lines: 0, bytes: 0 } });
      return;
    }
    if (this.good!.depth > MAX_WALK_DEPTH) {
      this.code.setText('', escapeHtml);
      this.convFinished(seq, '', ver);
      store.set({ convert: { loading: false, error: 'Nesting is too deep to convert', lines: 0, bytes: 0 } });
      return;
    }
    try {
      const mod = await this.loadConverters();
      if (!current()) return;
      if (this.good!.nodes >= 50_000 && !store.get().convert.loading) {
        // A big document converts for a while: the spinner shows first.
        store.set({ convert: { ...store.get().convert, loading: true } });
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        if (!current()) return;
      }
      const s = this.settings;
      const key = this.convKey();
      const info = targetInfo(s.target);
      // CSV and Excel share one flattening (dotted columns) over the main array of
      // records; Excel is a binary download, so its preview is the same table.
      const xlsx = info.id === 'xlsx' || info.id === 'csv' ? await import('../convert/xlsx') : null;
      if (!current()) return;
      let r: { note: string; warn: boolean; flip: boolean; error?: string } | undefined;
      const out = xlsx
        ? xlsx.toCsv(xlsx.records(root))
        : // (The settings as they are: convert() reads its own, and a cleared root name is "Root". Flatten and
          // unflatten run in slices, typing going on in between: a newer conversion stops this one.)
          await mod.convert(root, info.id, { ...s, report: (x) => (r = x), live: current });
      if (!current()) return;
      if (xlsx) this.code.setText(out, (line, _s, _e, state) => mod.csvLine(line, state), false, { start: mod.CSV_START, scan: mod.csvScan });
      else {
        // (Rows carry the highlighter's state: YAML block scalars and multi-line strings colour as a whole document does.)
        const rows = mod.codeRows(info.lang);
        this.code.setText(out, rows.hl, false, rows.scanner);
      }
      this.convFinished(seq, out, ver, key);
      store.set({ convert: { loading: false, error: r?.error || null, lines: out ? out.split('\n').length : 0, bytes: out.length, flat: r } });
    } catch (e) {
      if (!current()) return;
      // The CSV and Excel preview isn't behind convert(), which reports deep nesting itself.
      const deep = tooDeep(e);
      if (!deep) reportError(e, 'conversion');
      this.code.setText('', escapeHtml);
      this.convFinished(seq, '', ver);
      store.set({ convert: { loading: false, error: deep ? 'Nesting is too deep to convert' : e instanceof Error ? e.message : 'Conversion failed', lines: 0, bytes: 0 } });
    }
  }

  copyConvert() {
    const msg = `Copied ${targetInfo(this.settings.target).label}`;
    const later = this.convLater();
    if (later) {
      // (A big document's conversion after a target change: the copy waits for it, as copyOutput does.)
      track('feature_used', { feature: 'copy_convert' });
      void this.copyLater(later, msg, () => this.toast('Nothing to copy yet', 'info'));
      return;
    }
    const out = this.convOutput();
    if (!out) return this.toast('Nothing to copy yet', 'info');
    track('feature_used', { feature: 'copy_convert' });
    void this.copy(out, msg);
  }

  async downloadConvert() {
    const s0 = this.settings;
    const info = targetInfo(s0.target);
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    const name = convertFileName(info, base, s0.rootName);
    if (info.id === 'xlsx') {
      const root = this.good?.root;
      if (!root) return this.toast('Paste or open valid JSON first', 'info');
      if (this.good!.depth > MAX_WALK_DEPTH) return this.toast('Nesting is too deep to convert', 'err');
      try {
        const { records, toXlsx } = await import('../convert/xlsx');
        this.saveBlob(await toXlsx(records(root), { sheetName: sheetBase(base) }), name);
      } catch (error) {
        if (tooDeep(error)) return this.toast('Nesting is too deep to convert', 'err');
        reportError(error, 'export');
        this.toast("Couldn't create the Excel file", 'err');
      }
      return;
    }
    const later = this.convLater();
    if (later) {
      void later.then((out) => {
        // (Superseded: another target or document before this one's conversion came, never saved under this name.)
        if (this.dead || out === undefined) return;
        if (!out || typeof out !== 'string') return this.toast('Nothing to download yet', 'info');
        this.save(out, name, info.mime);
      });
      return;
    }
    const out = this.convOutput();
    if (!out) return this.toast('Nothing to download yet', 'info');
    this.save(out, name, info.mime);
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

  /**
   * The table shown (its sort included) as CSV, as the Excel export and the CSV converter write it (nested
   * objects as dotted columns): undefined (after saying why) when it can't be.
   */
  private async tableCsv(n: JNode, order: Int32Array | null): Promise<string | undefined> {
    try {
      const { toCsv } = await import('../convert/xlsx');
      return toCsv(n, { order });
    } catch (e) {
      if (tooDeep(e)) this.toast('Nesting is too deep to convert', 'err');
      else if (tooLarge(e)) this.toast('The result is too large', 'err');
      else {
        reportError(e, 'export');
        this.toast('Conversion failed', 'err');
      }
      return undefined;
    }
  }

  copyCSV() {
    const n = this.table.exportNode();
    if (!n) return this.toast('Open an array or object in the table first', 'info');
    track('feature_used', { feature: 'copy_csv' });
    // (The CSV comes from a module loaded on first use: the copy waits for it, keeping the click's permission.)
    void this.copyLater(this.tableCsv(n, this.table.exportOrder()), 'Copied table as CSV', () => this.toast('Nothing to copy yet', 'info'));
  }

  downloadCSV() {
    const n = this.table.exportNode();
    if (!n) return this.toast('Open an array or object in the table first', 'info');
    track('feature_used', { feature: 'download_csv' });
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    void this.tableCsv(n, this.table.exportOrder()).then((csv) => {
      if (csv !== undefined && !this.dead) this.save(csv, `${base}.csv`, 'text/csv');
    });
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

  /** Runs `run` in the Graph view, opening it first; `dropped` if it never shows (see dropGraphWaiters). */
  private withGraph(run: () => void, dropped?: () => void) {
    if (this.settings.view === 'graph' && this.graph) return run();
    this.graphWaiters.push({ run, dropped });
    this.setView('graph');
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
  downloadGraph(opts: GraphExport | 'png' | 'svg' | 'jpeg', name?: string): Promise<{ file: string; size: number } | null> {
    const o: GraphExport = typeof opts === 'string' ? { format: opts, area: 'all', background: 'theme', scale: 2 } : opts;
    // Settles with the saved file, or null (no graph, the view changed before it showed, or the export failed).
    return new Promise((settle) => this.withGraph(() => {
      if (!this.graph) return settle(null);
      track('feature_used', { feature: o.format === 'png' ? 'graph_export_png' : o.format === 'jpeg' ? 'graph_export_jpeg' : 'graph_export_svg' });
      const file = `${name?.trim() || this.docBase()}.${o.format === 'jpeg' ? 'jpg' : o.format}`;
      let reduced: [number, number] | null = null;
      void this.graph.exportImage(o, (w, h) => (reduced = [w, h])).then((blob) => {
        if (this.dead) return settle(null);
        this.saveBlob(blob, file);
        if (reduced) this.reducedToast(reduced);
        settle({ file, size: blob.size });
      }).catch((error) => {
        reportError(error, 'export');
        if (!this.dead) this.toast(rt("Couldn't download graph: {error}", { error: rt.msg(error instanceof Error ? error.message : 'Graph export failed') }), 'err');
        settle(null);
      });
    }, () => settle(null)));
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
    if (this.huge?.find()) return;
    if (paired(this.settings.view)) this.setView('format');
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
    this.supersede();
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
      this.load(p.initialText ?? '', p.initialFileName ?? null, false, false, undefined, p.input ?? formatOfName(p.initialFileName));
      if (p.schema) store.set({ schemaIn: { seq: Date.now(), text: p.schema, sample: true } });
      if (s.view === 'convert') {
        this.setConvert({ target: s.target ?? 'typescript', rootName: s.rootName ?? 'Root', tsStyle: s.tsStyle ?? 'interface', flat: s.flat });
      } else if (s.view) {
        this.setView(s.view);
        if (s.view === 'format') this.setFormat({ minify: s.minify ?? false, sortKeys: s.sortKeys ?? false, escape: s.escape ?? false });
      }
    } finally {
      this.presetting = false;
    }
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

  /** Keys pressed after the palette, the shortcuts or a context menu was asked for, before it showed (see holdKeys). */
  private held: HeldKey[] = [];
  /** What is open shows and has the keys (see takeKeys). */
  private keysTaken = false;

  /**
   * A key pressed while the palette, the shortcuts or a context menu loads (they load when the page is idle):
   * kept for it, out of the editor (Esc closes it). Only keys they use: the browser keeps its own.
   */
  private holdKeys(e: KeyboardEvent) {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key !== 'Escape' && !(plain && (e.key.length === 1 || /^(Backspace|Enter|Tab|Arrow(Up|Down)|Home|End)$/.test(e.key))) && !((e.ctrlKey || e.metaKey) && /^[knp]$/i.test(e.key))) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') store.set({ palette: false, shortcuts: false, menu: null });
    else this.held.push(e);
  }

  /** The keys held for the palette, the shortcuts or the menu now shown (see holdKeys): it has the keys from now. */
  takeKeys(): HeldKey[] {
    this.keysTaken = true;
    return this.held.splice(0);
  }

  /** What was shown is gone: keys are held again while the next one loads. */
  releaseKeys() {
    this.keysTaken = false;
    this.held = [];
  }

  openPalette(mode: 'commands' | 'url' = 'commands') {
    track('feature_used', { feature: mode === 'url' ? 'load_url_dialog' : 'palette' });
    store.set({ palette: mode, shortcuts: false });
  }

  private onKey = (e: KeyboardEvent) => {
    const s = store.get();
    // (The open palette, shortcuts or context menu has the keys; until it shows, they wait for it.)
    if (s.palette || s.shortcuts || s.menu || e.isComposing) {
      if (!this.keysTaken && !e.isComposing) this.holdKeys(e);
      return;
    }
    // (Keys held for what closed before it showed (Esc, a click away) are for nothing now: never replayed.)
    if (this.held.length) this.held = [];
    // (Huge mode's own keys: it stops them itself.)
    if (this.huge?.key(e)) return;
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
    // (The schema editor has its own Ctrl/⌘ keys: components/SchemaView.tsx.)
    else if (mod && t.closest?.('.pane-sch')) return;
    else if (mod && !e.altKey && e.key === 'Enter' && this.ed2.hasFocus()) run = () => this.formatCompare();
    else if (mod && !e.altKey && e.key === 'Enter') run = e.shiftKey ? () => this.minify() : () => this.useOutput();
    else if (e.altKey && e.shiftKey && !mod && e.code === 'KeyF') run = () => this.format();
    else if (mod && !e.shiftKey && !e.altKey && k === 's') run = () => this.download();
    else if (mod && !e.shiftKey && !e.altKey && k === 'o') run = () => this.openFile();
    else if (mod && !e.shiftKey && !e.altKey && k === 'f') run = () => this.focusSearch();
    // Alt+Z like VS Code (on macOS, Option+Z types Ω: not while typing).
    else if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ' && !(s.mac && typing)) run = () => this.toggleWrap();
    // On macOS, Option+digit types characters (#, €…): never steal it while typing.
    else if (e.altKey && !mod && /^Digit[1-7]$/.test(e.code) && !(s.mac && typing)) {
      const views: View[] = ['format', 'tree', 'table', 'graph', 'convert', 'compare', 'schema'];
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
    else if (area === 'table') this.table.el.focus({ preventScroll: true });
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
    if (n && n.t >= ARR) this.tree.toggle(n);
  }

  /** Tree and graph: select the node's text in the input editor. */
  menuShow() {
    if (this.menuNode) this.openInEditor(this.menuNode);
  }

  private hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  private onDragEnter = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    this.reindentWorker();
    this.warmAnalysis(true);
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

  private persistNow = () => this.persist(this.pendingNow());

  /** The load still on its way to the editor (see flushLoad), if it is the latest. */
  private pendingNow() {
    const p = this.pendingLoad;
    return p && p.seq === this.loadSeq ? p : null;
  }

  /** Saves the document, or `pending` (one on its way to the editor as the page is left) when it fits. */
  private persist(pending: Engine['pendingLoad']) {
    clearTimeout(this.persistTimer);
    if (!this.persistEnabled) return;
    const p = pending?.persist && pending.text.length <= MAX_PERSIST ? pending : null;
    const n = p ? p.text.length : this.ed.length;
    const keep = n > 0 && n <= MAX_PERSIST;
    write(KEYS.doc, keep ? (p ? p.text : this.ed.text) : null);
    // The file name goes with the document kept (a name over nothing, or over the one before, would mislead).
    write(KEYS.file, keep ? (p ? p.names[1] : this.edName) : null);
    // (And what it is read as: a YAML document opens as YAML again.)
    write(KEYS.fmt, keep && this.inFmt !== 'json' ? this.inFmt : null);
  }

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
            () => loadPack(),
            () => import('../json/read'),
            () => import('./sizes'),
            () => import('../convert'),
            () => import('../convert/import'),
            () => import('./source'),
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
          () => this.warmAnalysis(),
          () => loadSurface(),
          () => this.loadJwt(),
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
