import { useSyncExternalStore, type ReactNode } from 'react';
import type { Portal } from '../huge/kit';
import type { ParseResult } from '../json/parser';
import type { Seg } from '../json/path';

export type Theme = 'system' | 'light' | 'dark';
export type View = 'format' | 'tree' | 'table' | 'graph' | 'convert' | 'compare' | 'schema';
/** Compare and Schema: views with a second editor beside the input, whose result the viewer shows. */
export const paired = (v: View) => v === 'compare' || v === 'schema';
export type IndentId = '2' | '4' | 'tab';
/** What the input is read as: JSON, or a format whose JSON the views show (lib/engine/source.ts). */
export type SourceFormat = 'json' | 'yaml' | 'csv' | 'xml' | 'toml';
/** CSV field separator: detected, or one chosen. */
export type CsvDelimiter = 'auto' | ',' | ';' | '\t' | '|';
/** Smart suggestion for input that doesn't read as its format: unescape it, or read it as another format. */
export type Hint = 'unescape' | SourceFormat | null;

export interface Settings {
  theme: Theme;
  indent: IndentId;
  view: View;
  /** The view to return to when Compare or Schema closes. */
  prevView: Exclude<View, 'compare' | 'schema'>;
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
  /** CSV input: the first row names the columns (rows become objects), and unquoted numbers and booleans become JSON ones. */
  csvHeader: boolean;
  csvTypes: boolean;
  /** Convert: flatten and unflatten's options (absent: the defaults, lib/convert/flat.ts FLAT_DEFAULTS). */
  flat?: FlatSettings;
}

export interface FlatSettings {
  /** Joins the keys of a path ('' while one is typed: "." is used). */
  sep: string;
  /** Array items as a[0], as a.0, or kept whole. */
  arrays: 'bracket' | 'dot' | 'keep';
  /** Backslash escapes for keys a path would misread. */
  escape: boolean;
  /** Levels flattened (0: all). */
  depth: number;
}

/** A tool page's starting state. */
export interface EnginePreset {
  settings?: Partial<Settings>;
  initialText?: string;
  initialFileName?: string;
  /** What the sample is read as (default: what its file name says, else JSON). */
  input?: SourceFormat;
  /** The Schema view's sample schema. */
  schema?: string;
}

/** A JWT input: its algorithm and NumericDate claims (seconds), shown live (they age). */
export interface JwtInfo {
  alg?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  /** Not signed (alg "none", or no signature): shown as a warning. */
  unsigned?: boolean;
}

export type Status =
  | { kind: 'empty' }
  /** `progress`: how much of a document parsed here in steps is done (0 to 1). */
  | { kind: 'parsing'; progress?: number }
  /** `more`: the parser stopped listing warnings (MAX_ISSUES), so there are at least `warnings`. */
  /** `src`: the input is in that format, and valid (its JSON is what the views show). */
  | { kind: 'valid'; warnings: number; more?: boolean; msg?: string; p?: number; line?: number; col?: number; jwt?: JwtInfo; jsonl?: number; src?: Exclude<SourceFormat, 'json'> }
  | { kind: 'fixable'; msg: string; p: number; line: number; col: number; count: number }
  /** `src`: the input doesn't read as that format (the error is its importer's). */
  | { kind: 'error'; msg: string; p: number; line: number; col: number; src?: Exclude<SourceFormat, 'json'> };

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
  /** Smart suggestion for input that isn't JSON (yet), or that doesn't read as its format. */
  hint: Hint;
  /** What the input is read as; for CSV, the separator chosen and the one detected (what `auto` reads with). */
  input: { format: SourceFormat; delimiter: CsvDelimiter; detected: string };
  fileName: string | null;
  /** `flat`: flatten and unflatten's note on the output (`warn`: it won't convert back as it is; `flip`: the other direction fits the input). */
  convert: { loading: boolean; error: string | null; lines: number; bytes: number; flat?: { note: string; warn: boolean; flip: boolean } };
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
  /** Huge-file mode's viewer, while a file too big for the editor is open (lib/huge): JsonTool renders it, handing it react-dom's createPortal. */
  huge: ((portal: Portal) => ReactNode) | null;
  /**
   * For the Schema view's editor (components/SchemaView.tsx): a page's sample schema, a schema to generate from the
   * document, or a link's schema (its file name, and its draft and Check formats: lib/link.ts).
   */
  schemaIn: { seq: number; text?: string; sample?: boolean; generate?: boolean; name?: string | null; url?: string; draft?: string; formats?: boolean } | null;
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
  csvHeader: true,
  csvTypes: true,
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
  input: { format: 'json', delimiter: 'auto', detected: ',' },
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
  huge: null,
  schemaIn: null,
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
