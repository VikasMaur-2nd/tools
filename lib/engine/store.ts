import { useSyncExternalStore } from 'react';
import type { Seg } from '../json/path';

export type Theme = 'system' | 'light' | 'dark';
export type View = 'format' | 'tree' | 'table' | 'convert' | 'compare';
export type IndentId = '2' | '4' | 'tab';
export type Hint = 'unescape' | 'jwt' | 'yaml' | 'xml' | 'csv' | 'toml' | null;

export interface Settings {
  theme: Theme;
  indent: IndentId;
  view: View;
  /** The view to return to when Compare closes. */
  prevView: Exclude<View, 'compare'>;
  /** Pretty-print minified JSON when it is pasted into an empty editor. */
  autoFormat: boolean;
  /** Editor width as a fraction of the window (0.2 – 0.8). */
  split: number;
  /** Compare mode: width of the two editors together (0.4 – 0.85). */
  splitCmp: number;
  /** Format view: pretty-printed or minified output, keys sorted or as written. */
  minify: boolean;
  sortKeys: boolean;
  /** Convert panel target id, root type name and TypeScript flavour. */
  target: string;
  rootName: string;
  tsStyle: 'interface' | 'type';
}

export type Status =
  | { kind: 'empty' }
  | { kind: 'parsing' }
  | { kind: 'valid'; warnings: number; msg?: string; p?: number; line?: number; col?: number }
  | { kind: 'fixable'; msg: string; p: number; line: number; col: number; count: number }
  | { kind: 'error'; msg: string; p: number; line: number; col: number };

export interface Stats {
  bytes: number;
  lines: number;
  nodes: number;
  depth: number;
  ms: number;
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
  action?: { label: string; run: () => void };
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
  find: { open: boolean; q: string; total: number; index: number; /** bumps when q is set from outside the find bar */ seq: number };
  table: { segs: Seg[]; rows: number; cols: number; ok: boolean };
  /** Smart suggestion for input that isn't JSON (yet). */
  hint: Hint;
  fileName: string | null;
  /** Huge document shown read-only for speed. */
  viewOnly: boolean;
  convert: { loading: boolean; error: string | null; lines: number; bytes: number };
  /** Format view output: line count and the byte size of both variants. */
  fmt: { lines: number; pretty: number; minified: number };
  /** Current document text, published only while the Compare view is open. */
  docText: string;
  /** Compare: the modified document (second editor). */
  cmpText: string;
  cmpFile: string | null;
  palette: false | 'commands' | 'url';
  shortcuts: boolean;
  dragging: boolean;
  toast: Toast | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  indent: '2',
  view: 'format',
  prevView: 'format',
  autoFormat: false,
  split: 0.5,
  splitCmp: 0.66,
  minify: false,
  sortKeys: false,
  target: 'typescript',
  rootName: 'Root',
  tsStyle: 'interface',
};

export const INITIAL: UIState = {
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
  viewOnly: false,
  convert: { loading: false, error: null, lines: 0, bytes: 0 },
  fmt: { lines: 0, pretty: 0, minified: 0 },
  docText: '',
  cmpText: '',
  cmpFile: null,
  palette: false,
  shortcuts: false,
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
