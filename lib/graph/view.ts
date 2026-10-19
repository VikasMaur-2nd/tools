/*
 * PLACEHOLDER: the real graph view (canvas renderer + interaction) replaces
 * this file. It exists so the engine integration can load and drive the
 * GraphViewApi before the renderer lands. It only reports what it would draw.
 */
import type { JNode } from '../json/parser';
import { buildModel } from './model';
import { layoutGraph } from './layout';
import { charWidth, readTheme } from './theme';
import type { FindResult, GraphEvents, GraphViewApi } from './types';

export class GraphView implements GraphViewApi {
  private host: HTMLElement;
  private root: JNode | null = null;
  private nodes = 0;
  private dirty = true;

  constructor(host: HTMLElement, ev: GraphEvents) {
    this.host = host;
    void ev;
  }
  setRoot(root: JNode | null, _reset: boolean, nodes: number, active: boolean) {
    this.root = root;
    this.nodes = nodes;
    this.dirty = true;
    if (active) this.activate();
  }
  activate() {
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.root) {
      this.host.textContent = '';
      return;
    }
    const m = buildModel(this.root, charWidth(readTheme(this.host).font), this.nodes);
    const L = layoutGraph(m);
    this.host.textContent = `Graph placeholder: ${m.n} cards, ${m.rows} rows, ${Math.round(L.width)} × ${Math.round(L.height)} px`;
  }
  deactivate() {}
  select() {}
  search(): FindResult {
    return { total: 0, index: -1 };
  }
  step(): FindResult {
    return { total: 0, index: -1 };
  }
  expandAll() {}
  collapseAll() {}
  expandTo() {}
  fit() {}
  zoomBy() {}
  focus() {
    this.host.focus();
  }
  themeChanged() {}
  exportImage(): Promise<Blob> {
    return Promise.reject(new Error('not implemented'));
  }
  destroy() {
    this.host.textContent = '';
  }
}
