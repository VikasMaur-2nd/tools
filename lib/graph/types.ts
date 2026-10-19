/*
 * The contract between the engine and the graph view (lib/graph/view.ts,
 * loaded on demand the first time the Graph tab opens).
 */
import type { JNode } from '../json/parser';

export interface GraphEvents {
  /** The user selected an entry (card or row): the engine moves the editor caret and the path bar. */
  select(n: JNode, how: 'pointer' | 'key' | 'search'): void;
  /** Enter / double-click on a value: show it in the editor. */
  open(n: JNode): void;
  copy(n: JNode, what: 'value' | 'path'): void;
  /** Escape: back to the editor. */
  escape(): void;
}

export interface FindResult {
  total: number;
  index: number;
  note?: string;
}

export interface GraphViewApi {
  /**
   * A new document tree (null: none). `reset`: a different document (forget
   * collapsed cards, fit the camera); otherwise the same document edited
   * (keep the camera and collapsed cards by path where possible). An
   * inactive view only records the root and builds when activated.
   */
  setRoot(root: JNode | null, reset: boolean, nodes: number, active: boolean): void;
  /** The view was shown: build if needed, draw, start listening. */
  activate(): void;
  /** The view was hidden: stop drawing, drop caches that can be rebuilt. */
  deactivate(): void;
  /** Selection from elsewhere (editor caret, tree). `scroll` brings it into view. */
  select(n: JNode | null, opts?: { scroll?: boolean; center?: boolean }): void;
  /** Find: highlights matches in keys and values; `$.path` / `/pointer` jump to a node. */
  search(q: string, jump: boolean): FindResult;
  step(dir: 1 | -1): FindResult;
  expandAll(): void;
  collapseAll(): void;
  /** Shows `level` columns of cards (1 = the root only). */
  expandTo(level: number): void;
  /** Zoom to show the whole graph (or as much as stays readable). */
  fit(): void;
  zoomBy(factor: number): void;
  focus(): void;
  /** Colours come from CSS variables; call after the theme changes. */
  themeChanged(): void;
  /** The graph as an image. Rejects when it is too big for the format. */
  exportImage(kind: 'png' | 'svg'): Promise<Blob>;
  destroy(): void;
}

export type GraphViewCtor = new (host: HTMLElement, ev: GraphEvents) => GraphViewApi;
