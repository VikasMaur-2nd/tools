/* What huge mode's React UI shows (components/huge/HugeTool.tsx), published by its HugeSession. */
import type { FindView } from './find';
import type { ValueKind } from './edits';
import type { IndexState, LineMode, Seg } from './source';

export type HugeView = 'format' | 'tree' | 'table' | 'shape' | 'graph' | 'convert' | 'compare';

/** The views' order (tabs, Alt+digits). */
/** Huge mode's views in their tabs' order: the normal tool's (Alt+1 to Alt+6, Graph is Alt+4), then Shape (Alt+7). */
export const HUGE_VIEWS: HugeView[] = ['format', 'tree', 'table', 'graph', 'convert', 'compare', 'shape'];

/** What a "Go to" bar asks for. */
export type Ask = { kind: 'line'; max: number } | { kind: 'index'; max: number; partial: boolean } | { kind: 'path' } | { kind: 'row'; max: number };

export interface HugeUI {
  name: string;
  size: number;
  view: HugeView;
  /** The Format view: pretty or as written. */
  mode: LineMode;
  index: IndexState;
  /** Indexing: bytes per second, and the seconds left (null: not known yet). */
  rate: number;
  eta: number | null;
  /** How long indexing took (ms), once it ended. */
  took: number | null;
  /** The selected value: its path, kind, size in bytes (-1: not indexed that far yet) and item count. */
  sel: { path: string; t: number; bytes: number; count: number; partial: boolean; named: boolean; root: boolean } | null;
  find: FindView & { open: boolean; seq: number };
  ask: Ask | null;
  /** The table's container path and its shape. */
  table: { path: string; rows: number; cols: number; ok: boolean };
  /** The Format view's line count (so far). */
  lines: number;
  /** The graph: the path of its root, whether it can go up, values shown, and whether it is at its limit. */
  graph: { path: string; up: boolean; shown: number; full: boolean } | null;
  /** No value could be read (an error before any): the tree and the table say so. */
  noRoot: boolean;
  /** Editing (null: the source can't edit). */
  edit: EditUI | null;
  /** The edit box, open on a value, a name, or a value to insert. */
  box: EditBox | null;
  /** A value open as text in the normal editor (its dialog): its path, and its text when read. */
  textEdit: { path: Seg[]; label: string; text: string | null; i?: number; at?: number[] } | null;
  /** The edit menu (right click, the menu key): where, and whether the keyboard opened it. */
  menu: { x: number; y: number; keyboard: boolean } | null;
  /** The Format view's text being edited (a window of it), from byte `at`; and where its caret is. */
  fe: { id: number; at: number } | null;
  feInfo: { line: number; col: number; first: number; last: number } | null;
}

export interface EditUI {
  /** Edits can be made now (the document is all read, nothing is being saved). */
  ready: boolean;
  /** The document differs from the file. */
  edited: boolean;
  /** Undo steps (the file bar's "3 changes"). */
  steps: number;
  canUndo: boolean;
  canRedo: boolean;
  /** An edit is being made, or the document read again after it. */
  busy: boolean;
  /** Saving: bytes written of how many, and how. */
  saving: { written: number; size: number } | null;
  /** A kept session of this file, offered: its steps and when it was kept (ms since 1970). */
  restore: { steps: number; time: number } | null;
  /** Closing with unsaved edits: asking first. */
  confirm: boolean;
  /** Saving without the opened file's handle: asking where (overwrite it, or a new file). */
  saveAsk: boolean;
  /** Save writes into the opened file itself (huge mode has its handle). */
  inPlace: boolean;
  /** Whether this tab's edits are kept (one tab keeps a file's at a time): see EditState.keeping. */
  keeping: 'yes' | 'other-tab' | 'other-tab-kept' | 'no';
}

/** The edit box: a value's new value, a member's new name, or a value to insert. */
export interface EditBox {
  mode: 'value' | 'rename' | 'insert';
  /** The value's path (value, rename), or the container's (insert). */
  path: Seg[];
  /** The value's index in its container (value, rename): which member, where names repeat. */
  i?: number;
  /** Its index path, where known (the tree's): which member at every level, where names repeat. */
  indexes?: number[];
  /** That path as shown. */
  label: string;
  /** Insert: where, and whether it's into an object (a name is asked). */
  index: number;
  named: boolean;
  /** What the value is typed as, the text it starts with, and the name (rename, insert into an object). */
  kind: ValueKind;
  text: string;
  name: string;
  /** Where it opens (viewport px: over the row or cell), null: at the top of the view. */
  at: { x: number; y: number; w: number } | null;
}

type Listener = () => void;

export class HugeStore {
  private s: HugeUI;
  private ls = new Set<Listener>();
  constructor(initial: HugeUI) {
    this.s = initial;
  }
  get = () => this.s;
  subscribe = (f: Listener) => {
    this.ls.add(f);
    return () => void this.ls.delete(f);
  };
  set(patch: Partial<HugeUI>) {
    let changed = false;
    for (const k in patch) if (patch[k as keyof HugeUI] !== this.s[k as keyof HugeUI]) changed = true;
    if (!changed) return;
    this.s = { ...this.s, ...patch };
    for (const f of this.ls) f();
  }
}
