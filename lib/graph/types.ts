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
  /** Selects and shows the root ('start') or the lowest card ('end'). */
  jump(to: 'start' | 'end'): void;
  /**
   * The graph as an image. Rejects when it is too big for the format.
   * `onReduced`: the browser couldn't make an image that big (iPhones and iPads), so it is width × height px.
   */
  exportImage(opts: GraphExport, onReduced?: (width: number, height: number) => void): Promise<Blob>;
  /** What an export would produce (null: no graph). */
  exportPreview(opts: GraphExport): Promise<ExportPreview | null>;
  destroy(): void;
}

export type GraphViewCtor = new (host: HTMLElement, ev: GraphEvents) => GraphViewApi;

export interface GraphExport {
  format: 'png' | 'jpeg' | 'svg';
  /** The whole graph, what's on screen, or the selected card's branch. */
  area: 'all' | 'view' | 'branch';
  /** The canvas colour, none, or a CSS colour. JPEG has no transparency (it gets the canvas colour). */
  background: 'theme' | 'transparent' | string;
  /** Pixels per CSS px for PNG and JPEG (reduced to fit the size limits). */
  scale: number;
}

export interface ExportPreview {
  /** Size of the image in px (SVG: at 1×). */
  width: number;
  height: number;
  cards: number;
  /** The requested scale didn't fit and was reduced. */
  reduced: boolean;
  /** Image px per graph px at 100% (text is unreadably small well below 1). SVG: 1. */
  scale: number;
  /** A card is selected, so 'branch' is possible. */
  branch: boolean;
  /** Why this export can't be made (a toast-ready English sentence). */
  error?: string;
  /** Which limit it is over: the image size, or the number of cards an SVG may hold (maxCards). */
  limit?: 'size' | 'cards';
  maxCards?: number;
}
