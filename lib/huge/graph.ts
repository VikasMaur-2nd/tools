/*
 * Huge mode's Graph: the part being explored, a root (the selected container, or the file's root) a few levels
 * deep, read from the source's pages and shown by the normal tool's GraphView (lib/graph), never more than
 * MAX_NODES values.
 *
 * `Explored` is that part: each container shows its first items (a page), a "+N more" row stands for the rest
 * (click or Enter reads the next page), and a container past the levels read shows its size until opened
 * (Enter, double click). It is turned into plain JNodes for the view at each change (a few thousand at most:
 * the view keeps its camera and the cards collapsed by path), with the stand-ins' texts given to the graph
 * model as value notes (setValueNotes).
 */
import { ARR, BOOL, JNode, NUM, OBJ, STR, type Kind } from '../json/parser';
import { rt } from '../i18n/ui';
import type { GraphExport, GraphViewApi } from '../graph/types';
import type { HugeNode, HugeSource, Seg } from './source';

/** Items read at first under the root, and under the containers below it. */
export const ROOT_PAGE = 50;
export const PAGE = 20;
/** Levels of containers read at first (the root's items, theirs…): a record's own arrays and objects show their items. */
export const LEVELS = 4;
/** Values shown at most. */
export const MAX_NODES = 2000;

/** A value of the explored part: its items read so far (null: not read yet). */
export class ExNode {
  kids: ExNode[] | null = null;
  /** The JNode it was last shown as. */
  j: JNode | null = null;
  constructor(
    public h: HugeNode,
    readonly parent: ExNode | null,
  ) {}

  /** Items not read (yet). */
  get more() {
    return this.kids ? Math.max(0, this.h.count - this.kids.length) : 0;
  }
}

/** What a build gives the view: the root, and what each JNode stands for. */
export interface Built {
  root: JNode;
  /** JNode → the value it shows. */
  of: Map<JNode, ExNode>;
  /** "+N more" rows → the container whose next items they stand for. */
  more: Map<JNode, ExNode>;
  /** The stand-ins' texts, for the graph model. */
  notes: WeakMap<JNode, string>;
}

const sizeText = (h: HugeNode) => {
  const n = rt.num(h.count) + (h.partial ? '+' : '');
  return h.t === OBJ ? `{${n}}` : `[${n}]`;
};

export class Explored {
  readonly root: ExNode;
  size = 1;

  /** `path`: the root's path in the document. */
  constructor(
    private readonly src: Pick<HugeSource, 'children'>,
    root: HugeNode,
    readonly path: Seg[],
  ) {
    this.root = new ExNode(root, null);
  }

  /** Room left under MAX_NODES. */
  get room() {
    return Math.max(0, MAX_NODES - this.size);
  }

  /** Reads `n` more items of `ex` (its first ones if none are read). Returns how many came (0: none, or no room). */
  async more(ex: ExNode, n = ex === this.root ? ROOT_PAGE : PAGE, signal?: AbortSignal): Promise<number> {
    if (ex.h.t < ARR) return 0;
    const have = ex.kids ?? [];
    const want = Math.min(n, this.room, Math.max(0, ex.h.count - have.length));
    if (!want) {
      ex.kids ??= [];
      return 0;
    }
    const got = await this.src.children(ex.h, have.length, want, signal);
    ex.kids = have.concat(got.map((h) => new ExNode(h, ex)));
    this.size += got.length;
    return got.length;
  }

  /** Reads the first `levels` levels under `from` (each container's first page), breadth first, within MAX_NODES. */
  async expand(from: ExNode = this.root, levels = LEVELS, signal?: AbortSignal) {
    let level = [from];
    for (let d = 0; d < levels && level.length && this.room; d++) {
      const next: ExNode[] = [];
      for (const ex of level) {
        if (!this.room) break;
        if (ex.h.t >= ARR && ex.h.count && !ex.kids) await this.more(ex, undefined, signal);
        for (const k of ex.kids ?? []) if (k.h.t >= ARR && k.h.count) next.push(k);
      }
      level = next;
    }
  }

  /** Reads what `old` (the same root, read before) had read: each container's items as far as it had them. */
  async replay(old: Explored, signal?: AbortSignal) {
    let level: [ExNode, ExNode][] = [[old.root, this.root]];
    while (level.length && this.room) {
      const next: [ExNode, ExNode][] = [];
      for (const [was, now] of level) {
        if (!was.kids || !this.room) continue;
        if (now.h.t >= ARR && !now.kids) await this.more(now, was.kids.length, signal);
        for (const k of was.kids) {
          const m = now.kids?.find((x) => x.h.key === k.h.key && x.h.at === k.h.at);
          if (m) next.push([k, m]);
        }
      }
      level = next;
    }
  }

  /** The value at `rel` (a path from the root), if it was read. */
  find(rel: readonly Seg[]): ExNode | null {
    let ex: ExNode | null = this.root;
    for (const seg of rel) {
      ex = ex?.kids?.find((k) => k.h.key === seg || (typeof seg === 'string' && typeof k.h.key === 'number' && String(k.h.key) === seg)) ?? null;
      if (!ex) return null;
    }
    return ex;
  }

  /** `ex`'s path in the document. */
  pathOf(ex: ExNode): Seg[] {
    const rel: Seg[] = [];
    for (let p: ExNode | null = ex; p && p.parent; p = p.parent) rel.push(p.h.key as Seg);
    return [...this.path, ...rel.reverse()];
  }

  /** The part as JNodes for the graph view. */
  build(): Built {
    const of = new Map<JNode, ExNode>();
    const more = new Map<JNode, ExNode>();
    const notes = new WeakMap<JNode, string>();
    const make = (ex: ExNode, parent: JNode | null, d: number): JNode => {
      const h = ex.h;
      const key = parent ? h.key : (h.key ?? undefined);
      let j: JNode;
      if (h.t >= ARR) {
        const list: JNode[] = [];
        j = new JNode(h.t, list, Math.max(0, h.at), d, parent, key);
        if (ex.kids) {
          for (const k of ex.kids) list.push(make(k, j, d + 1));
          const left = ex.more;
          if (left) {
            // (Its card's size: the container's, not the rows read.)
            notes.set(j, sizeText(h));
            // "+N more": an empty array standing for the next items (its row reads them).
            const stand = new JNode(ARR as Kind, [], Math.max(0, h.end), d + 1, j, h.t === ARR ? ex.kids.length : '…');
            notes.set(stand, h.partial ? rt('+{n} more so far', { n: rt.num(left) }) : rt('+{n} more', { n: rt.num(left) }));
            more.set(stand, ex);
            list.push(stand);
          }
        } else if (h.count) notes.set(j, sizeText(h));
      } else {
        const v = h.t === STR ? h.text : h.t === NUM ? h.text : h.t === BOOL ? h.text === 'true' : null;
        j = new JNode(h.t, v, Math.max(0, h.at), d, parent, key);
      }
      j.e = h.end < 0 ? j.s : h.end;
      ex.j = j;
      of.set(j, ex);
      return j;
    };
    const root = make(this.root, null, 0);
    return { root, of, more, notes };
  }
}

/** What the graph asks of the session. */
export interface GraphHost {
  src: HugeSource;
  /** The value chosen in the graph (its path in the document). */
  select(h: HugeNode, path: Seg[]): void;
  copy(h: HugeNode, path: Seg[], what: 'value' | 'path'): void;
  escape(): void;
  /** The shown part changed (its root's path, how many values). */
  changed(rootPath: Seg[], shown: number, full: boolean): void;
  failed(e: unknown): void;
}

type GraphModule = typeof import('../graph/view');

/** The Graph view of huge mode: an Explored part in a GraphView. */
export class HugeGraph {
  private view: GraphViewApi | null = null;
  private part: Explored | null = null;
  private built: Built | null = null;
  private setNotes: GraphModule['setValueNotes'] | null = null;
  private active = false;
  private seq = 0;
  private dead = false;
  /** The selection to show once the part is built (its path in the document). */
  private want: Seg[] | null = null;
  private media = matchMedia('(prefers-color-scheme: dark)');

  constructor(
    private readonly el: HTMLElement,
    private readonly host: GraphHost,
  ) {
    el.addEventListener('keydown', this.onKey);
    this.media.addEventListener('change', this.themeChanged);
  }

  private async load(): Promise<GraphViewApi | null> {
    if (this.view) return this.view;
    // (Through the view's module only: importing the model on its own would split it from the modules it's bundled with.)
    const { GraphView, setValueNotes }: GraphModule = await import('../graph/view');
    if (this.dead) return null;
    this.setNotes = setValueNotes;
    this.view = new GraphView(this.el, {
      select: (n, how) => this.onSelect(n, how),
      open: (n) => void this.onOpen(n),
      copy: (n, what) => {
        const ex = this.built?.of.get(n);
        if (ex && this.part) this.host.copy(ex.h, this.part.pathOf(ex), what);
      },
      escape: () => this.host.escape(),
    });
    return this.view;
  }

  /**
   * Shows the part from `root` (at `path`): its first levels, read now. `select`: the path to select after;
   * `reset`: a new part (the camera fits it), else the same one read again (the camera stays).
   */
  async show(root: HugeNode, path: Seg[], select: Seg[] | null = null, reset = true) {
    const seq = ++this.seq;
    const view = await this.load();
    if (!view || seq !== this.seq) return;
    const part = new Explored(this.host.src, root, path);
    const old = this.part;
    try {
      // (The same part read again: as far as it was read; a new one: its first levels.)
      if (!reset && old && old.path.length === path.length && old.path.every((x, k) => x === path[k])) await part.replay(old);
      else await part.expand();
    } catch (e) {
      if (seq === this.seq && !this.dead) this.host.failed(e);
      return;
    }
    if (seq !== this.seq || this.dead) return;
    this.part = part;
    this.want = select;
    this.draw(reset);
  }

  /** The root shown and its path (null: none yet). */
  get rootPath(): Seg[] | null {
    return this.part?.path ?? null;
  }

  /** Is the value at `path` in the part shown? */
  has(path: readonly Seg[]): boolean {
    const p = this.part;
    if (!p || path.length < p.path.length || p.path.some((s, k) => String(s) !== String(path[k]))) return false;
    return !!p.find(path.slice(p.path.length));
  }

  /** Selects the value at `path` if it is shown. */
  select(path: readonly Seg[] | null) {
    const p = this.part;
    if (!p || !this.view || !path) return;
    if (!this.has(path)) return;
    const ex = p.find(path.slice(p.path.length));
    if (ex?.j) this.view.select(ex.j, { scroll: true });
  }

  /** Builds the JNodes and hands them to the view (`reset`: a new part: the camera fits it). */
  private draw(reset: boolean) {
    const p = this.part;
    if (!p || !this.view) return;
    const built = (this.built = p.build());
    this.setNotes?.(built.notes);
    this.view.setRoot(built.root, reset, p.size, this.active);
    if (this.want) {
      const want = this.want;
      this.want = null;
      this.select(want);
    }
    this.host.changed(p.path, p.size, !p.room);
  }

  private onSelect(n: JNode, how: 'pointer' | 'key' | 'search') {
    const b = this.built;
    if (!b || !this.part) return;
    const parent = b.more.get(n);
    // (A click on "+N more" reads them; arrow keys only pass over it: Enter reads them.)
    if (parent) {
      if (how === 'pointer') void this.readMore(parent);
      return;
    }
    const ex = b.of.get(n);
    if (ex) this.host.select(ex.h, this.part.pathOf(ex));
  }

  private async onOpen(n: JNode) {
    const b = this.built;
    if (!b) return;
    const parent = b.more.get(n);
    if (parent) return this.readMore(parent);
    const ex = b.of.get(n);
    // A container not read yet: its first levels now.
    if (ex && ex.h.t >= ARR && ex.h.count && !ex.kids) return this.readUnder(ex);
  }

  /** "+N more": the next page of `ex`'s items; the first of them is selected. */
  private async readMore(ex: ExNode) {
    const p = this.part;
    if (!p) return;
    const seq = this.seq;
    const before = ex.kids?.length ?? 0;
    try {
      const got = await p.more(ex);
      if (seq !== this.seq || this.dead) return;
      if (!got) return this.full();
    } catch (e) {
      if (!this.dead) this.host.failed(e);
      return;
    }
    const first = ex.kids?.[before];
    this.want = first ? p.pathOf(first) : null;
    this.draw(false);
    // (The session, the tree and the path bar follow: the view selects it without saying so.)
    if (first) this.host.select(first.h, p.pathOf(first));
  }

  /** A container shown by its size: its first levels. */
  private async readUnder(ex: ExNode) {
    const p = this.part;
    if (!p) return;
    const seq = this.seq;
    try {
      await p.expand(ex, 2);
    } catch (e) {
      if (!this.dead) this.host.failed(e);
      return;
    }
    if (seq !== this.seq || this.dead) return;
    if (!ex.kids?.length) return this.full();
    this.want = p.pathOf(ex);
    this.draw(false);
    this.host.select(ex.h, p.pathOf(ex));
  }

  /** No room left: said in the toolbar (the host's `changed` has `full`). */
  private full() {
    const p = this.part;
    if (p) this.host.changed(p.path, p.size, true);
  }

  /** Reads the part again (counts that grew while indexing): the camera and `select` stay. */
  async refresh(root: HugeNode, select: Seg[] | null) {
    const p = this.part;
    if (!p) return;
    await this.show(root, p.path, select, false);
  }

  activate() {
    this.active = true;
    this.view?.activate();
  }

  deactivate() {
    this.active = false;
    this.view?.deactivate();
  }

  focus() {
    this.view?.focus();
  }

  fit() {
    this.view?.fit();
  }

  zoomBy(f: number) {
    this.view?.zoomBy(f);
  }

  collapseAll() {
    this.view?.collapseAll();
  }

  exportImage(opts: GraphExport) {
    return this.view ? this.view.exportImage(opts) : Promise.reject(new Error('No graph'));
  }

  private themeChanged = () => {
    requestAnimationFrame(() => !this.dead && this.view?.themeChanged());
  };

  /** The page's theme changed (Light, Dark, System). */
  theme() {
    this.themeChanged();
  }

  /** U: up a level; R: the selected value as the root (the session does both: see HugeSession.graphUp/graphFrom). */
  onUp: () => void = () => undefined;
  onFrom: () => void = () => undefined;

  private onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.key === 'u' || e.key === 'U') this.onUp();
    else if (e.key === 'r' || e.key === 'R') this.onFrom();
    else return;
    e.preventDefault();
  };

  destroy() {
    this.dead = true;
    this.seq++;
    this.el.removeEventListener('keydown', this.onKey);
    this.media.removeEventListener('change', this.themeChanged);
    this.setNotes?.(null);
    this.view?.destroy();
    this.view = null;
  }
}
