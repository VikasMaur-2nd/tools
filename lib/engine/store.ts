import { useSyncExternalStore } from 'react';
import type { ParseResult } from '../json/parser';
import type { Seg } from '../json/path';

export type Theme = 'system' | 'light' | 'dark';
export type View = 'format' | 'tree' | 'table' | 'graph' | 'convert' | 'compare';
export type IndentId = '2' | '4' | 'tab';
export type Hint = 'unescape' | 'yaml' | 'xml' | 'csv' | 'toml' | null;

export interface Settings {
  theme: Theme;
  indent: IndentId;
  view: View;
  /** The view to return to when Compare closes. */
  prevView: Exclude<View, 'compare'>;
  /** Pretty-print minified JSON when it is pasted into an empty editor. */
  autoFormat: boolean;
  /** Soft-wrap long lines in the editors and the code views. */
  wrap: boolean;
  /** Editor width as a fraction of the window (0.2 – 0.8). */
  split: number;
  /** Compare mode: width of the two editors together (0.4 – 0.85). */
  splitCmp: number;
  /** Format view: pretty-printed or minified output, keys sorted or as written. */
  minify: boolean;
  sortKeys: boolean;
  /** Format view: show the minified document as one escaped JSON string literal. */
  escape: boolean;
  /** Convert panel target id, root type name, TypeScript flavour and C# JSON library. */
  target: string;
  rootName: string;
  tsStyle: 'interface' | 'type';
  csharpLib: 'stj' | 'newtonsoft';
}

/** A tool page's starting state. */
export interface EnginePreset {
  settings?: Partial<Settings>;
  initialText?: string;
  initialFileName?: string;
  initialImport?: 'yaml' | 'xml' | 'csv' | 'toml';
}

/** A JWT input: its algorithm and NumericDate claims (seconds), shown live (they age). */
export interface JwtInfo {
  alg?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
}

export type Status =
  | { kind: 'empty' }
  /** `progress`: how much of a document parsed here in steps is done (0 to 1). */
  | { kind: 'parsing'; progress?: number }
  | { kind: 'valid'; warnings: number; msg?: string; p?: number; line?: number; col?: number; jwt?: JwtInfo; jsonl?: number }
  | { kind: 'fixable'; msg: string; p: number; line: number; col: number; count: number }
  | { kind: 'error'; msg: string; p: number; line: number; col: number };

export interface Sizes {
  min: number;
  /** Compressed size of the minified document per codec (absent: not measured). */
  gzip?: number;
  brotli?: number;
  zstd?: number;
  /** Measured for an earlier version of the document (a new measurement is on its way). */
  stale: boolean;
}

interface Stats {
  bytes: number;
  lines: number;
  nodes: number;
  depth: number;
  ms: number;
}

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
  action?: { label: string; run: () => void };
}

/** A content area with its own context menu (components/ContextMenu.tsx); `diff`: Compare's differences. */
export type MenuArea = 'input' | 'compare' | 'format' | 'convert' | 'tree' | 'table' | 'graph' | 'diff';

export type DiffAction = 'copyPath' | 'copyLeft' | 'copyRight' | 'show' | 'expand' | 'sub' | 'layout' | 'opt' | 'prev' | 'next' | 'patch';

/** What Compare's differences offer the menu, read when it opens (components/CompareView.tsx). */
export interface DiffMenu {
  /** The row under the pointer (now selected), or the selected one: a change, a line, or unchanged lines folded away. */
  row: { kind: 'change'; left: boolean; right: boolean } | { kind: 'line' | 'gap' } | null;
  /** That row on screen (where a menu opened from the keyboard goes). */
  box: DOMRect | null;
  sub: 'changes' | 'diff';
  /** Wide enough for the side-by-side layout. */
  wide: boolean;
  layout: 'unified' | 'split';
  opts: { keyOrder: boolean; arrayOrder: boolean; ci: boolean };
  /** There are differences to go to (Previous, Next). */
  ok: boolean;
  /** A JSON Patch can be made (the documents could be compared). */
  patch: boolean;
  run(action: DiffAction, arg?: string): void;
  focus(): void;
}

/** The open context menu: what the area under the right click (or the caret) can do there. */
export interface ContextMenu {
  /** Each opening has its own. */
  id: number;
  area: MenuArea;
  /**
   * Where it opens (viewport px): at the pointer, or under the caret or the selected node when opened
   * from the keyboard (`top`: that row's top, for opening above it when there is no room below).
   */
  x: number;
  y: number;
  top: number;
  keyboard: boolean;
  /** The editor holds no document. */
  blank: boolean;
  /** Something is selected for Copy (without it, Copy all). */
  sel: boolean;
  cut: boolean;
  paste: boolean;
  undo: boolean;
  redo: boolean;
  /** The innermost block around the line under the pointer: Fold or Unfold acts on it. */
  fold: { line: number; folded: boolean } | null;
  /** The node under the pointer, now selected: `open` is null for a value that isn't an array or object. */
  node: { open: boolean | null; str: boolean } | null;
  diff: DiffMenu | null;
}

export interface UIState {
  ready: boolean;
  mac: boolean;
  settings: Settings;
  status: Status;
  stats: Stats | null;
  empty: boolean;
  /** Viewer is showing the last valid document while the current text is broken. */
  stale: boolean;
  /** JSONPath of the selected node. */
  path: string | null;
  cursor: { line: number; col: number; sel: number };
  /** Find bar (searches whichever view is open). */
  find: { open: boolean; q: string; total: number; index: number; note?: string; /** bumps when q is set from outside the find bar */ seq: number };
  table: { segs: Seg[]; rows: number; cols: number; ok: boolean };
  /** Smart suggestion for input that isn't JSON (yet). */
  hint: Hint;
  fileName: string | null;
  convert: { loading: boolean; error: string | null; lines: number; bytes: number };
  /** Format view output: line count and the byte size of both variants; `tooLarge`: none could be made (see MAX_TEXT). */
  fmt: { lines: number; pretty: number; minified: number; escaped: number; tooLarge?: boolean };
  /** Wire sizes of the valid document: minified, then compressed by each codec the browser has. */
  sizes: Sizes | null;
  /** Current document text, published only while the Compare view is open. */
  docText: string;
  /** Compare: the modified document (second editor). */
  cmpText: string;
  /** Compare: the engine's parse of the modified document and the text it parsed, while Compare is open (the panel diffs it). */
  cmpParsed: { text: string; result: ParseResult } | null;
  cmpFile: string | null;
  palette: false | 'commands' | 'url';
  shortcuts: boolean;
  /** The graph's export dialog is open. */
  graphExport: boolean;
  menu: ContextMenu | null;
  dragging: boolean;
  toast: Toast | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  indent: '2',
  view: 'format',
  prevView: 'format',
  autoFormat: false,
  wrap: true,
  split: 0.5,
  splitCmp: 0.66,
  minify: false,
  sortKeys: false,
  escape: false,
  target: 'typescript',
  rootName: 'Root',
  tsStyle: 'interface',
  csharpLib: 'stj',
};

const INITIAL: UIState = {
  ready: false,
  mac: false,
  settings: DEFAULT_SETTINGS,
  status: { kind: 'empty' },
  stats: null,
  empty: true,
  stale: false,
  path: null,
  cursor: { line: 1, col: 1, sel: 0 },
  find: { open: false, q: '', total: 0, index: -1, seq: 0 },
  table: { segs: [], rows: 0, cols: 0, ok: false },
  hint: null,
  fileName: null,
  convert: { loading: false, error: null, lines: 0, bytes: 0 },
  fmt: { lines: 0, pretty: 0, minified: 0, escaped: 0 },
  sizes: null,
  docText: '',
  cmpText: '',
  cmpParsed: null,
  cmpFile: null,
  palette: false,
  shortcuts: false,
  graphExport: false,
  menu: null,
  dragging: false,
  toast: null,
};

type Listener = () => void;

class Store {
  private s: UIState = INITIAL;
  private ls = new Set<Listener>();
  get = () => this.s;
  subscribe = (f: Listener) => {
    this.ls.add(f);
    return () => {
      this.ls.delete(f);
    };
  };
  set(patch: Partial<UIState>) {
    let changed = false;
    for (const k in patch) {
      if (patch[k as keyof UIState] !== this.s[k as keyof UIState]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.s = { ...this.s, ...patch };
    for (const f of this.ls) f();
  }
  settings(patch: Partial<Settings>) {
    this.set({ settings: { ...this.s.settings, ...patch } });
  }
}

export const store = new Store();

/** Subscribes a component to one slice of UI state. */
export function useUI<T>(select: (s: UIState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(INITIAL),
  );
}
