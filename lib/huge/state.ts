/* What huge mode's React UI shows (components/huge/HugeTool.tsx), published by its HugeSession. */
import type { FindView } from './find';
import type { IndexState, LineMode } from './source';

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
  sel: { path: string; t: number; bytes: number; count: number; partial: boolean } | null;
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
