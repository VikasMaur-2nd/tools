import { ARR, JNode, OBJ, STR, parse, type ParseResult } from '../json/parser';
import { byteLength, copyText, formatDoc, stringify } from '../json/format';
import { formatPath, nodeAt, pathOf, resolve, type Seg } from '../json/path';
import { Editor, type ChangeKind, type Diagnostic } from './editor';
import { TreeView } from './tree';
import { TableView } from './table';
import { CodeView } from './codeview';
import { escapeHtml, highlightLine } from './highlight';
import type { FindResult, LineHighlighter } from './codeview';
import { targetInfo } from './targets';
import { DEFAULT_SETTINGS, store, type Hint, type IndentId, type Settings, type Sizes, type Status, type Theme, type View } from './store';
import { SAMPLE } from './sample';
import { codecs, compressedSize } from './sizes';
import { compact, readJwt, type JwtInput } from '../json/jwt';

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

export interface EnginePreset {
  settings?: Partial<Settings>;
  initialText?: string;
  initialFileName?: string;
  initialImport?: 'yaml' | 'xml' | 'csv' | 'toml';
}

export interface EngineOptions {
  /** Keep an initial landing-page sample out of the user's home-page storage. */
  preserveDocument?: boolean;
}

export function persistenceAfterChange(enabled: boolean, kind: ChangeKind): boolean {
  return enabled || kind !== 'set';
}

export function persistenceAfterLoad(enabled: boolean, persist: boolean): boolean {
  return enabled || persist;
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
    if (out.tsStyle !== 'type') out.tsStyle = 'interface';
    if (out.csharpLib !== 'newtonsoft') out.csharpLib = 'stj';
    out.rootName = String(out.rootName || 'Root').slice(0, 60);
    return out;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * The array of records a spreadsheet should show: the root if it's an array,
 * otherwise the largest array of objects within two levels (`data`, `items`,
 * `results`… in API responses). Falls back to the root.
 */
function records(root: JNode): JNode {
  if (root.t === ARR) return root;
  let best: JNode | null = null;
  const consider = (n: JNode) => {
    if (n.t !== ARR) return;
    const list = n.v as JNode[];
    if (!list.length || !list.some((c) => c.t === OBJ)) return;
    if (!best || list.length > (best.v as JNode[]).length) best = n;
  };
  if (root.t === OBJ) {
    for (const c of root.v as JNode[]) {
      consider(c);
      if (c.t === OBJ) for (const g of c.v as JNode[]) consider(g);
    }
  }
  return best ?? root;
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

/** JWT-shaped, for a clearer error when a part doesn't decode. */
const JWT_RE = /^(?:[Bb]earer\s+)?eyJ[^\s.]*\.[^\s.]+\.[^\s.]*$/;

/** Cheap guess at what non-JSON input is, to offer a one-click conversion. */
function sniff(text: string): Hint {
  const t = text.trim();
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

async function toBase64Url(s: string): Promise<string> {
  const stream = new Blob([s]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fromBase64Url(b64: string): Promise<string> {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
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
  private persistEnabled: boolean;
  /** Current find query (applies to the open view). */
  private query = '';
  private dead = false;

  constructor(els: EngineEls, options: EngineOptions = {}) {
    this.els = els;
    this.persistEnabled = !options.preserveDocument;
    this.settings = loadSettings();
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

    // Restore: text typed/restored before hydration wins, then saved doc.
    if (!this.ed.text) {
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
  }

  destroy() {
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
    const len = this.ed.text.length;
    if (!this.ed.text.trim()) {
      this.analyze();
    } else {
      if (len > 1_000_000) store.set({ status: { kind: 'parsing' } });
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.analyze(), len < 100_000 ? 60 : len < 1_000_000 ? 160 : len < 5_000_000 ? 350 : 700);
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

  private fresh(): ParseResult | null {
    if (this.ed.text !== this.parsed || (!this.res && this.ed.text.trim())) {
      clearTimeout(this.timer);
      this.analyze();
    }
    return this.res;
  }

  analyze() {
    clearTimeout(this.timer);
    const ed = this.ed;
    const text = ed.text;
    const reset = this.resetNext;
    this.resetNext = false;
    this.parsed = text;

    if (!text.trim()) {
      this.res = null;
      this.good = null;
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
    const res = parse(src);
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

    if (res.root) {
      this.good = res;
      this.goodText = src;
      this.tree.setRoot(res.root, reset, res.nodes);
      this.sel = this.selPath ? resolve(res.root, this.selPath) : null;
      this.tree.select(this.sel, { scroll: false });
      if (this.settings.view === 'table') {
        this.table.setNode(resolve(res.root, this.tablePath) ?? res.root, true);
      } else this.table.setNode(null);
      ed.setScope(this.sel && this.sel.t >= ARR ? this.sel.s : -1, this.sel ? this.sel.e : -1);
    } else if (reset || !this.good) {
      this.good = null;
      this.tree.setRoot(null, true);
      this.table.setNode(null);
      ed.setScope(-1, -1);
    }

    // Diagnostics → editor squiggles (a decoded JWT's positions aren't in the editor).
    const diags: Diagnostic[] = [];
    if (!jwt) {
      for (let i = 0; i < res.issues.length && i < 300; i++) diags.push({ p: res.issues[i].p, cls: 'me' });
      if (res.error) diags.push({ p: res.error.p, cls: 'me' });
      for (let i = 0; i < res.warnings.length && i < 300; i++) diags.push({ p: res.warnings[i].p, cls: 'mw' });
    }
    ed.setDiagnostics(diags);

    let hint: Hint = null;
    if (jwt) hint = null;
    else if (res.root?.t === STR && /^\s*[[{]/.test(res.root.v as string)) hint = 'unescape';
    else if (res.error || res.issues.length) hint = sniff(text);

    store.set({
      empty: false,
      stale: !res.root && !!this.good,
      status: jwt ? this.jwtStatus(jwt) : JWT_RE.test(text.trim()) ? { kind: 'error', msg: "This looks like a JWT, but a part isn't valid base64url JSON", p: 0, ...this.ed.lineCol(0) } : this.statusOf(res),
      stats: { bytes: byteLength(text), lines: ed.ls.length, nodes: res.nodes, depth: res.depth, ms },
      path: this.sel ? formatPath(pathOf(this.sel)) : null,
      hint,
    });
    // Format/convert re-run their find when their text updates; the tree and table do it here.
    if (this.query && (this.settings.view === 'tree' || this.settings.view === 'table')) this.refind(false);
    this.syncTableState();
    this.updateBrackets();
    this.measure(res.root && !jwt ? res : null, text);
    this.afterDoc();
  }

  /** "JWT · HS256 · expires in 59m": decoded locally, signature not verified. */
  private jwtStatus(jwt: JwtInput): Status {
    const now = Date.now() / 1000;
    const expired = jwt.exp !== undefined && jwt.exp <= now;
    const when = jwt.exp === undefined ? '' : expired ? ` · expired ${compact(now - jwt.exp)} ago` : ` · expires in ${compact(jwt.exp - now)}`;
    return { kind: 'valid', warnings: 0, jwt: `JWT${jwt.alg ? ' · ' + jwt.alg : ''}${when}`, expired };
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
      async () => {
        const blob = new Blob([formatDoc(text, res, '')]);
        const sizes: Sizes = { min: blob.size, stale: false };
        // Beyond this, compressing on every edit costs more than the number is worth.
        if (blob.size <= 32_000_000) {
          for (const [codec, name] of codecs()) {
            try {
              sizes[codec] = await compressedSize(blob, name);
            } catch {
              /* leave it unmeasured */
            }
            if (seq !== this.sizeSeq) return;
          }
        }
        if (seq === this.sizeSeq) store.set({ sizes });
      },
      text.length > 1_000_000 ? 700 : 200,
    );
  }

  /** Keeps the secondary views (convert, compare) in step with the document. */
  private afterDoc() {
    const v = this.settings.view;
    if (v === 'format') this.scheduleFormat(this.ed.text.length > 1_000_000 ? 250 : 60);
    else if (v === 'convert') this.scheduleConvert(150);
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
    return !!this.res?.root && this.parsed === this.ed.text && !this.jwt;
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
    if (!this.synced) return;
    const n = nodeAt(this.res!.root, this.ed.caret, this.ed.text);
    if (!n || n === this.sel) return;
    this.setSel(n);
    this.tree.select(n, { scroll: true });
    this.ed.setScope(-1, -1);
  };

  private updateBrackets() {
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
    const root = this.fresh()?.root ?? this.good?.root;
    if (!root) return this.toast('Paste or open valid JSON first', 'info');
    try {
      const { toXlsx } = await import('../convert/xlsx');
      const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
      this.saveBlob(await toXlsx(records(root), { sheetName: base.slice(0, 31) || 'Sheet1' }), `${base}.xlsx`);
    } catch {
      this.toast("Couldn't create the Excel file", 'err');
    }
  }

  // ── Commands: documents ────────────────────────────────────────────────

  load(text: string, name: string | null, persist = true) {
    this.persistEnabled = persistenceAfterLoad(this.persistEnabled, persist);
    this.resetNext = true;
    store.set({ fileName: name });
    if (persist) write(KEYS.file, name);
    this.ed.setValue(text, 0);
    this.analyze();
    this.ed.el.scrollTop = 0;
    if (persist) this.persistSoon();
  }

  openFile(target: 1 | 2 = 1) {
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
      this.load(text, f.name);
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

  sample() {
    this.load(SAMPLE, 'sample.json');
    this.toast('Loaded a sample. Try the tree, table and search.', 'info');
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
    if (!n) return this.toast('Select a node first', 'info');
    void this.copy(copyText(n, this.indent), n.t >= ARR ? 'Copied value as JSON' : 'Copied value');
  }

  copyPath(n: JNode | null = this.sel) {
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
      const data = await toBase64Url(this.jwt ? this.ed.text.trim() : formatDoc(this.ed.text, r, ''));
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
      this.load(text, /\.json$/i.test(name) ? name : name + '.json');
      if (this.settings.autoFormat) this.autoFormat();
      this.toast(`Loaded ${url.hostname}`, 'ok');
    } catch {
      this.toast("Couldn't fetch. The server must allow cross-origin requests (CORS).", 'err');
    }
  }

  // ── Commands: view ─────────────────────────────────────────────────────

  setView(view: View) {
    const prev = this.settings.view;
    if (this.query && prev !== view) this.findIn(prev, '');
    this.setSettings(view === 'compare' && prev !== 'compare' ? { view, prevView: prev } : { view });
    if (this.query) requestAnimationFrame(() => (this.settings.view === 'compare' ? this.closeFind() : this.refind(true)));
    if (view === 'table') {
      const root = this.good?.root ?? null;
      const base = this.sel ? (this.sel.t >= ARR ? this.sel : this.sel.u) : root;
      this.tableShow(base);
    } else this.table.setNode(null);
    if (view === 'tree') requestAnimationFrame(() => this.tree.render(true));
    if (view === 'format') this.scheduleFormat(0);
    if (view === 'convert') this.scheduleConvert(0);
    if (view === 'compare') {
      store.set({ docText: this.ed.text, cmpText: this.ed2.text });
      requestAnimationFrame(() => {
        this.ed2.render(true);
        if (!this.ed2.text) this.ed2.focus();
      });
    } else this.compareMarks(null, null);
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

  setFormat(patch: Partial<Pick<Settings, 'minify' | 'sortKeys'>>) {
    this.setSettings(patch);
    if (this.settings.view !== 'format') this.setView('format');
    else this.scheduleFormat(0);
  }

  private scheduleFormat(delay: number) {
    clearTimeout(this.fmtTimer);
    this.fmtTimer = window.setTimeout(this.runFormat, delay);
  }

  /** The formatted output for the current settings (from the last valid parse). */
  private output(): string {
    const r = this.good;
    if (!r?.root) return '';
    const s = this.settings;
    return formatDoc(this.goodText, r, s.minify ? '' : this.indent, s.sortKeys);
  }

  private runFormat = () => {
    if (this.settings.view !== 'format') return;
    const out = this.output();
    this.fmt.setText(out, jsonRow, true);
    // Size of the shown variant is measured; the other differs only by whitespace,
    // which is computed from the tree (no second format of big documents).
    const bytes = byteLength(out);
    const extra = this.good?.root ? prettyExtra(this.good.root, this.indent.length) : 0;
    const minify = this.settings.minify;
    store.set({
      fmt: { lines: this.fmt.lineCount, pretty: out ? (minify ? bytes + extra : bytes) : 0, minified: out ? (minify ? bytes : bytes - extra) : 0 },
    });
  };

  /** Replaces the input with the Format view's output (undoable). */
  useOutput() {
    const r = this.fresh();
    if (!r?.root) return this.toast(r ? "Can't do that yet. Fix the error first." : 'Nothing to format yet', r ? 'err' : 'info');
    const s = this.settings;
    const fixed = this.fixed(r);
    this.transform(
      (res, t) => formatDoc(t, res, s.minify ? '' : this.indent, s.sortKeys),
      () => (s.minify ? 'Minified input' : 'Formatted input') + fixed,
    );
  }

  copyOutput() {
    const out = this.fmt.text || this.output();
    if (!out) return this.toast('Nothing to copy yet', 'info');
    void this.copy(out, this.settings.minify ? 'Copied minified JSON' : 'Copied formatted JSON');
  }

  downloadOutput() {
    const out = this.fmt.text || this.output();
    if (!out) return this.toast('Nothing to download yet', 'info');
    const base = (store.get().fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '');
    this.save(out, `${base}${this.settings.minify ? '.min' : ''}.json`, 'application/json');
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
      this.conv = await import('../convert');
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
      const out =
        info.id === 'xlsx' || info.id === 'csv'
          ? (await import('../convert/xlsx')).toCsv(records(root))
          : mod.convert(root, info.id, { rootName: s.rootName || 'Root', tsStyle: s.tsStyle, csharpLib: s.csharpLib });
      this.code.setText(out, (line) => mod.highlightCode(line, info.lang));
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
        const { toXlsx } = await import('../convert/xlsx');
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
    store.set({ find: { ...store.get().find, total: r.total, index: r.index } });
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
    if (this.settings.view !== 'tree') this.setView('tree');
    this.tree.focus();
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
    write(KEYS.settings, JSON.stringify(this.settings));
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
        .then(async (reg) => {
          // Load the lazy features once (idle, after startup) so they're cached for
          // offline use and survive a deploy while this tab stays open.
          await Promise.all([
            import('../convert'),
            import('../convert/import'),
            import('../convert/xlsx'),
            import('../json/smart'),
          ]).catch(() => {});
          // Hand the SW every asset this page loaded so the app works offline right away.
          const urls = performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((u) => u.startsWith(location.origin) && !u.includes('/_vercel/'));
          reg.active?.postMessage({ type: 'cache', urls: [location.origin + '/', ...urls] });
        })
        .catch(() => {});
    };
    if (document.readyState === 'complete') setTimeout(go, 1000);
    else window.addEventListener('load', () => setTimeout(go, 1000), { once: true });
  }
}
