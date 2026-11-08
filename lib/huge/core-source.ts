/*
 * HugeSource (./source.ts) over the core's client (./client.ts, docs/huge-files/API.md): what huge mode's
 * views read, answered by the worker's checkpoint index, for files of any size.
 *
 * The core's nodes carry no values: a container's children come as a page (a tape, PageNodes) whose JNodes
 * have them, so a node keeps what it came from (its core node, or its JNode in a page) to read its own
 * children from (a small container's are in its page already: no request). Its positions are bytes; columns
 * on a line are UTF-16 units (colOf/atOf convert).
 */
import { kids, type JNode, type Kind, type TapeLink } from '../json/parser';
import { clip, keyLabel, preview, primText } from '../json/format';
import { HugeClient } from './client';
import { PageNodes } from './page';
import { utf16Of, utf8Bytes } from './utf8';
import { ARR, BOOL, LIST, NUM, OBJ, STR, type HugeEdited, type HugeLocation, type HugeNode as CoreNode, type HugeProgress, type HugeSummary } from './types';
import { CELL, PREVIEW, type Edited, type EditState, type HugeEdits, type HugeLine, type HugeNode, type HugeRow, type HugeSource, type IndexState, type LineMode, type Seg } from './source';

/**
 * A page of children while it is kept (`view` null once let go: see KEEP). Its small containers' children are
 * read from it, with no request to the worker.
 */
interface Kept {
  view: PageNodes | null;
  /** About what holding it costs: its text, its tape, and the strings decoded from it. */
  bytes: number;
}

/**
 * What a container node reads its children from: the core's node (from the worker), and, for one that came whole
 * in a page, that page while it is kept (its node there by tape index: a node holds no JNode, so it doesn't hold
 * its page). A page let go, its containers ask the worker like any other, by their place in the file.
 */
type Ref = { core: CoreNode; kept?: Kept; zi?: number };

/**
 * Bytes of pages kept, by all the views together (tree, table, graph, the selection): past it the pages used
 * longest ago are let go. A page is at most 4 MiB of text; records of a few KB come 200 to a page of ~1 MB.
 */
export const KEEP = 64 << 20;

/** How often the summary (depth, pretty lines, the root's count so far) is asked for while indexing (ms). */
const SUMMARY_EVERY = 1000;

/**
 * `s` as a string of its own. A page's strings are slices of its text (and slices of them are too), which keep
 * all of it alive in every engine: a node keeps only its own characters.
 */
export const own = (s: string): string => (s.length < 2 ? s : (JSON.parse(JSON.stringify(s)) as string));

const aborted = () => new DOMException('Aborted', 'AbortError');
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw aborted();
};

export class CoreSource implements HugeSource {
  readonly name: string;
  readonly size: number;
  readonly doc: HugeClient;
  private st: IndexState;
  private listeners = new Set<(s: IndexState) => void>();
  private refs = new WeakMap<HugeNode, Ref>();
  /** An edit is being read again in steps (progress comes then too, and the summary once it's all read). */
  private rereading = false;
  /** Pages kept, used longest ago first, and their bytes (see KEEP). */
  private kept = new Set<Kept>();
  private keptBytes = 0;
  private readonly keep: number;
  /** The last summary, and the root as the views know it. */
  private last: HugeSummary | null = null;
  /** 1 when the root is the LIST of top-level values (it is depth 0 here, its records 1). */
  private lift = 0;
  private summaryAt = 0;
  private summaryBusy = false;
  private dead = false;

  /**
   * `client`: made with the progress callback it is given (tests pass one over an in-process worker). `keep`:
   * bytes of pages kept (KEEP).
   */
  constructor(file: Blob, name: string, client?: (onProgress: (p: HugeProgress) => void) => HugeClient, keep = KEEP) {
    this.name = name;
    this.keep = keep;
    this.size = file.size;
    this.st = { bytes: 0, done: false, cancelled: false, error: null, status: null, multi: false, jsonl: false, nodes: 0, depth: 0, lines: 0, prettyLines: 0, records: 0 };
    this.doc = client ? client(this.onProgress) : new HugeClient(file, { name }, this.onProgress);
    // (After an edit read on in steps, or a kept session found later: the summary when it is there.)
    this.doc.onSummary = (s) => {
      if (this.dead) return;
      this.rereading = false;
      this.onSummary(s);
    };
    this.doc.ready.then(
      (s) => this.onSummary(s),
      () => {
        if (this.dead) return;
        // (The worker failed: what was read stays browsable; the state says it ended.)
        this.set({ ...this.st, done: true });
      },
    );
  }

  private set(st: IndexState) {
    this.st = st;
    for (const f of this.listeners) f(st);
  }

  private onProgress = (p: HugeProgress) => {
    if (this.dead || ((this.st.done || this.st.cancelled) && !this.rereading)) return;
    this.set({ ...this.st, bytes: p.bytes, nodes: p.nodes, lines: p.lines + 1, records: p.records });
    // Depth and pretty lines come with the summary: asked for now and then.
    const now = performance.now();
    if (!this.summaryBusy && now - this.summaryAt > SUMMARY_EVERY) {
      this.summaryBusy = true;
      this.summaryAt = now;
      this.doc.summary().then(
        (s) => {
          this.summaryBusy = false;
          if (!this.st.done) this.onSummary(s);
        },
        () => (this.summaryBusy = false),
      );
    }
  };

  private onSummary(s: HugeSummary) {
    if (this.dead) return;
    this.last = s;
    this.lift = s.root?.kind === LIST ? 1 : 0;
    const e = s.error;
    const b = s.status;
    const docSize = Math.max(0, s.size - s.bom);
    this.set({
      bytes: s.done ? (e ? Math.min(docSize, e.pos) : docSize) : this.st.bytes,
      docSize,
      edit: { edited: !!s.edited, canUndo: !!s.canUndo, canRedo: !!s.canRedo, version: s.version ?? 0, steps: s.steps ?? 0, session: s.session ?? null, bytes: s.editBytes ?? 0, keeping: s.keeping ?? 'no', setAside: s.setAside ?? null },
      done: s.done,
      cancelled: s.stopped,
      error: e ? { msg: e.msg, at: e.pos, line: e.line, col: e.col } : null,
      // (The normal path's status bar: the error, a fixable issue such as several top-level values, or valid.)
      status: b ? { kind: b.kind, msg: b.msg, at: b.pos, line: b.line, col: b.col, warnings: b.warnings, more: b.more } : null,
      multi: s.multi,
      jsonl: s.jsonl,
      nodes: s.nodes,
      depth: s.depth,
      lines: s.lines,
      prettyLines: s.prettyLines,
      records: s.records,
    });
  }

  state() {
    return this.st;
  }


  onState(f: (s: IndexState) => void) {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  }

  /** Stops indexing: what was read stays browsable (the summary that follows says `stopped`). */
  cancel() {
    if (this.st.done || this.st.cancelled) return;
    void this.doc.stop().catch(() => undefined);
  }

  destroy(): Promise<boolean> {
    this.dead = true;
    this.listeners.clear();
    for (const k of this.kept) k.view = null;
    this.kept.clear();
    this.keptBytes = 0;
    // (Edits not kept yet are kept first: resolves once they are, and the worker has ended, with whether they are.)
    return this.doc.close();
  }

  /** Bytes of pages kept now (KEEP), and how many. */
  get keeping() {
    return { bytes: this.keptBytes, pages: this.kept.size };
  }

  /** Keeps a page just read, letting go of the pages used longest ago past `keep` bytes. */
  private hold(view: PageNodes): Kept {
    const p = view.page;
    const t = p.tape;
    // (The text as UTF-16, the strings decoded from it about as much again, the tape and the offsets map.)
    const bytes = p.text.length * 4 + t.nodes.byteLength + t.text.byteLength + t.offsets.byteLength + t.extraAt.byteLength + p.map.byteLength;
    const k: Kept = { view, bytes };
    this.kept.add(k);
    this.keptBytes += bytes;
    for (const old of this.kept) {
      if (this.keptBytes <= this.keep || old === k) break;
      this.letGo(old);
    }
    return k;
  }

  private letGo(k: Kept) {
    k.view = null;
    this.kept.delete(k);
    this.keptBytes -= k.bytes;
  }

  /** `k` was used: let go of it last. */
  private touch(k: Kept) {
    this.kept.delete(k);
    this.kept.add(k);
  }

  // ── Nodes ───────────────────────────────────────────────────────────────

  /** A node of the views for the core's node `n`, item `i` of its container. */
  private fromCore(n: CoreNode, i: number): HugeNode {
    const list = n.kind === LIST;
    // (Still being read: its count is so far. The core says so, from round 2; count null is the same.)
    const partial = n.kind >= ARR && (!!n.partial || n.count === null);
    const node: HugeNode = {
      at: list ? -1 : n.start,
      end: partial || n.end < 0 ? -1 : list ? this.size : n.end,
      t: (list ? ARR : n.kind) as Kind,
      key: n.key ?? undefined,
      i,
      depth: list ? 0 : n.depth + this.lift,
      count: n.count ?? 0,
      ...(partial && { partial: true }),
      // A big child's preview, from the core (a container's first children; a string's decoded start).
      text: n.preview ?? '',
      ...(n.kind === STR && { clipped: true }),
    };
    this.refs.set(node, { core: n });
    return node;
  }

  /**
   * A node of the views for JNode `j` of kept page `k`, item `i` of its container, at `depth`; a string's text at
   * most `max` characters. Its strings are its own (see `own`), and a container keeps the page only as long as the
   * page is kept.
   */
  private fromPage(k: Kept, view: PageNodes, j: JNode, i: number, depth: number, max = PREVIEW): HugeNode {
    const key = typeof j.key === 'string' ? own(j.key) : (j.key ?? undefined);
    const stub = view.stub(j);
    if (stub) {
      const node = this.fromCore(stub, i);
      node.depth = depth;
      node.key = key;
      return node;
    }
    const [at, end] = view.span(j);
    let text: string;
    let clipped = false;
    if (j.t >= ARR) text = preview(j);
    else if (j.t === STR) {
      const s = j.v as string;
      clipped = s.length > max;
      text = clipped ? s.slice(0, max) : s;
    } else text = j.t === NUM ? (j.v as string) : j.t === BOOL ? (j.v ? 'true' : 'false') : 'null';
    const count = j.t >= ARR ? kids(j).length : 0;
    const node: HugeNode = { at, end, t: j.t, key, i, depth, count, text: own(text), ...(clipped && { clipped: true }) };
    if (j.t >= ARR) {
      // (The core's node for it, from its place: what it reads its children from once the page is let go.)
      const core: CoreNode = { kind: j.t, start: at, end, depth: depth - this.lift, key: key ?? null, count, pretty: -1, prettyLines: null, big: false };
      this.refs.set(node, { core, kept: k, zi: j.zi });
    }
    return node;
  }

  /** A big string's start, for its row (its page has an empty string standing for it). */
  private async stubText(node: HugeNode) {
    const { text } = await this.doc.text(node.at, Math.min(node.end < 0 ? node.at + PREVIEW * 4 : node.end, node.at + PREVIEW * 4), PREVIEW * 4);
    let s = text.startsWith('"') ? text.slice(1) : text;
    try {
      // (Cut inside an escape or a pair: as written.)
      s = JSON.parse('"' + s.replace(/\\[^"\\/bfnrtu]?$|\\u[0-9a-fA-F]{0,3}$/, '').replace(/"$/, '') + '"') as string;
    } catch {
      /* as written */
    }
    node.text = own(s.slice(0, PREVIEW));
    node.clipped = true;
  }

  /** A big container's preview (`{id: 1, name: "Ada", …}`) from its first items, as format.ts preview writes it. */
  private async stubPreview(node: HugeNode, core: CoreNode) {
    const view = new PageNodes(await this.doc.children(core, 0, 24));
    const isObj = node.t === OBJ;
    const list = view.children;
    let s = isObj ? '{' : '[';
    for (let i = 0; i < list.length; i++) {
      if (s.length > 90) {
        s += ', …';
        break;
      }
      const c = list[i];
      const big = view.stub(c);
      const t = big ? big.kind : c.t;
      const empty = big ? big.count === 0 : c.t >= ARR && !kids(c).length;
      const v = t === OBJ ? (empty ? '{}' : '{…}') : t === ARR || t === LIST ? (empty ? '[]' : '[…]') : big ? '"…"' : primText(c, 40);
      s += (i ? ', ' : '') + (isObj ? keyLabel(clip(c.key as string, 40)) + ': ' + v : v);
    }
    if (list.length < node.count && !s.endsWith('…')) s += ', …';
    node.text = own(s + (isObj ? '}' : ']'));
  }

  /** Items [from, from + n) of container `c` as nodes of the views (and the page they are in, while used). */
  private async items(c: HugeNode, from: number, n: number, signal?: AbortSignal): Promise<{ kept: Kept | null; view: PageNodes | null; list: JNode[]; nodes: HugeNode[] }> {
    const ref = this.refs.get(c);
    if (!ref) return { kept: null, view: null, list: [], nodes: [] };
    const k = ref.kept;
    const view = k?.view;
    if (k && view && ref.zi !== undefined) {
      // A small container whose page is kept: its items are there already.
      this.touch(k);
      const all = kids((view.root!.z as TapeLink).at(ref.zi));
      const list = all.slice(Math.max(0, from), from + n);
      return { kept: k, view, list, nodes: list.map((j, i) => this.fromPage(k, view, j, from + i, c.depth + 1)) };
    }
    const page = await this.doc.children(ref.core, Math.max(0, from), n);
    check(signal);
    const pv = new PageNodes(page);
    const kp = this.hold(pv);
    const list = pv.children;
    const nodes = list.map((j, i) => this.fromPage(kp, pv, j, from + i, c.depth + 1));
    // Big children come with their previews; past the core's 64 a page, they are made here.
    const big: Promise<void>[] = [];
    for (const x of nodes) {
      const r = this.refs.get(x);
      if (!r || r.kept || x.partial || x.text) continue;
      if (x.t === STR) big.push(this.stubText(x).catch(() => undefined));
      else if (x.t >= ARR && x.count) big.push(this.stubPreview(x, r.core).catch(() => undefined));
    }
    if (big.length) await Promise.all(big);
    check(signal);
    return { kept: kp, view: pv, list, nodes };
  }

  async root(signal?: AbortSignal): Promise<HugeNode> {
    const s = await this.doc.summary();
    check(signal);
    if (!this.st.done && !this.st.cancelled) this.onSummary(s);
    if (!s.root) throw new Error('No JSON value');
    return this.fromCore(s.root, 0);
  }

  async children(c: HugeNode, from: number, n: number, signal?: AbortSignal): Promise<HugeNode[]> {
    return (await this.items(c, from, n, signal)).nodes;
  }

  /** The nodes from the root down to the one `loc` found (its chain, from the core in one reply). */
  private chainOf(loc: HugeLocation | null): HugeNode[] | null {
    if (!loc) return null;
    if (loc.node.kind === LIST || !loc.chain.length) return [this.fromCore(loc.node, 0)];
    return [...loc.chain.map(({ node, index }) => this.fromCore(node, index)), this.fromCore(loc.node, loc.index)];
  }

  async resolve(path: Seg[], signal?: AbortSignal, at?: number[]) {
    if (!path.length) return [await this.root(signal)];
    const loc = await this.doc.resolve(path, at);
    check(signal);
    return this.chainOf(loc);
  }

  async locate(at: number, signal?: AbortSignal) {
    const loc = await this.doc.locate(at);
    check(signal);
    return this.chainOf(loc) ?? [await this.root(signal)];
  }

  async rows(c: HugeNode, from: number, n: number, cols: number, signal?: AbortSignal): Promise<HugeRow[]> {
    const { kept, view, list, nodes } = await this.items(c, from, n, signal);
    return nodes.map((node, k) => {
      const j = list[k];
      let cells: Map<string, HugeNode> | null = null;
      if (kept && view && node.t === OBJ && !view.stub(j)) {
        cells = new Map();
        const members = kids(j);
        for (let m = 0; m < members.length && cells.size < cols; m++) {
          if (cells.has(members[m].key as string)) continue;
          // (Keyed by the cell's own copy of the name: the member's is a slice of the page.)
          const cell = this.fromPage(kept, view, members[m], m, node.depth + 1, CELL);
          cells.set(cell.key as string, cell);
        }
      }
      return { node, cells };
    });
  }

  // ── Lines ───────────────────────────────────────────────────────────────

  lineCount(mode: LineMode) {
    return mode === 'raw' ? this.st.lines : this.st.prettyLines;
  }

  async lines(mode: LineMode, from: number, n: number, cols: number, indent: string, signal?: AbortSignal): Promise<HugeLine[]> {
    const got = mode === 'raw' ? await this.doc.rawLines(from, n, cols) : await this.doc.prettyLines(from, n, indent, cols);
    check(signal);
    // (cut 1: cut at `cols`, `length` the whole line's; 2: it goes on past the front, `length` so far: still being
    // read, or, once all is read, the error's line ending at the error: as it is, no mark.)
    const reading = !this.st.done;
    return got.text.map((text, k) => {
      const line: HugeLine = got.cut[k] === 2 ? { text, more: 0, at: got.pos[k], ...(reading && { reading: true }) } : { text, more: got.cut[k] ? Math.max(0, got.length[k] - text.length) : 0, at: got.pos[k] };
      // (Invalid bytes on it: what its U+FFFD units stand for, for colOf/atOf.)
      const bad = got.bad?.[k];
      if (bad) line.bad = bad;
      return line;
    });
  }

  async lineOf(mode: LineMode, at: number, signal?: AbortSignal) {
    // (Raw: from the bytes, anywhere once all read, past a broken document's error too.)
    if (mode === 'raw') {
      const line = await this.doc.lineAt(Math.max(0, at));
      check(signal);
      return Math.max(0, line);
    }
    const loc = await this.doc.locate(Math.max(0, at));
    check(signal);
    return loc ? Math.max(0, loc.node.pretty) : 0;
  }

  /** The column (UTF-16 units) of byte `at` on raw line `line` (utf8.ts: the worker's rule). */
  colOf(line: HugeLine, at: number) {
    return at < line.at ? -1 : utf16Of(line.text, at - line.at, line.bad);
  }

  /** The byte of column `col` (UTF-16 units) on raw line `line`. */
  atOf(line: HugeLine, col: number) {
    return line.at + utf8Bytes(line.text, 0, Math.min(col, line.text.length), line.bad);
  }

  // ── Find & values ───────────────────────────────────────────────────────

  find(q: string, from: number, hits: (at: number[], read: number) => void, signal: AbortSignal): Promise<void> {
    if (!q || signal.aborted) return Promise.resolve();
    return new Promise((done) => {
      const stop = this.doc.find(q, { from, caseSensitive: q !== q.toLowerCase(), limit: 100_001 }, (b) => {
        if (signal.aborted) return;
        hits(Array.from(b.matches), b.scanned);
        if (b.done) done();
      });
      signal.addEventListener(
        'abort',
        () => {
          stop();
          done();
        },
        { once: true },
      );
    });
  }

  async raw(n: HugeNode, max: number, signal?: AbortSignal): Promise<string | null> {
    if (n.end < 0) return null;
    const [a, b] = n.at < 0 ? [0, this.size] : [n.at, n.end];
    if (b - a > max) return null;
    const { text, cut } = await this.doc.text(a, b, max);
    check(signal);
    return cut ? null : text;
  }

  async textAt(a: number, b: number, max: number, signal?: AbortSignal) {
    const r = await this.doc.text(a, b, max);
    check(signal);
    return r;
  }

  slice(n: HugeNode): Promise<Blob> {
    const size = this.st.docSize ?? this.size;
    const [a, b] = n.at < 0 ? [0, size] : [n.at, n.end < 0 ? size : n.end];
    return this.doc.slice(a, b);
  }

  // ── Edits ───────────────────────────────────────────────────────────────

  /** The core's node for a node of the views (one read from a page: made from its place in the document). */
  private coreOf(n: HugeNode): CoreNode {
    const r = this.refs.get(n);
    if (r) return r.core;
    return { kind: n.t, start: n.at, end: n.end, depth: n.depth - this.lift, key: n.key ?? null, count: n.count, pretty: -1, prettyLines: null, big: false };
  }

  /** After an edit: pages read before it are stale; the state says what the edit did. */
  private async edited(p: Promise<HugeEdited>): Promise<Edited> {
    const e = await p;
    if (this.dead) return { done: e.done, canUndo: e.canUndo, canRedo: e.canRedo, steps: e.steps };
    this.dropPages();
    if (e.summary) {
      this.rereading = false;
      this.onSummary(e.summary);
    } else {
      // (Read on in steps: progress, then the summary through doc.onSummary.)
      this.rereading = true;
      const was: EditState = this.st.edit ?? { edited: true, canUndo: false, canRedo: false, version: 0, steps: 0, session: null, bytes: 0 };
      this.set({ ...this.st, done: false, status: null, edit: { ...was, edited: true, canUndo: e.canUndo, canRedo: e.canRedo, version: e.version, steps: e.steps } });
    }
    return { done: e.done, canUndo: e.canUndo, canRedo: e.canRedo, steps: e.steps };
  }

  private dropPages() {
    for (const k of this.kept) k.view = null;
    this.kept.clear();
    this.keptBytes = 0;
  }

  readonly edits: HugeEdits = {
    setValue: (node, json) => this.edited(this.doc.setValue(this.coreOf(node), json)),
    rename: (parent, index, name) => this.edited(this.doc.rename(this.coreOf(parent), index, name)),
    remove: (parent, index) => this.edited(this.doc.remove(this.coreOf(parent), index)),
    insert: (parent, index, json, name) => this.edited(this.doc.insert(parent ? this.coreOf(parent) : null, index, json, name)),
    duplicate: (parent, index) => this.edited(this.doc.duplicate(this.coreOf(parent), index)),
    replace: (ops, typing) => this.edited(this.doc.replace(ops, typing)),
    nodeText: (node, max) => this.doc.nodeText(this.coreOf(node), max),
    replaceNode: (node, text) => this.edited(this.doc.replaceNode(this.coreOf(node), text)),
    undo: () => this.edited(this.doc.undo()),
    redo: () => this.edited(this.doc.redo()),
    save: (handle, inPlace, progress) => {
      const r = this.doc.save(handle, inPlace, (x) => progress(x.written, x.size));
      return {
        done: r.done
          .then(async (x) => {
            // (In place: the document reads the saved file now, nothing edited.)
            if (inPlace && handle && !this.dead) {
              this.dropPages();
              this.onSummary(await this.doc.summary());
            }
            return { blob: x.blob ?? null };
          })
          .finally(() => {
            // (Edits wait while saving ('Not ready'): what waits hears the document takes them again, however it ended.)
            if (!this.dead) this.set({ ...this.st });
          }),
        stop: r.stop,
      };
    },
    restoreSession: () => this.edited(this.doc.restoreSession()),
    reofferSession: async () => {
      // (The offer again and nothing set aside come in its summary, or the one pushed once it's read again.)
      const e = await this.doc.reofferSession();
      return e ? this.edited(Promise.resolve(e)) : null;
    },
    dropSession: async (keepEdits = false) => {
      await this.doc.dropSession(keepEdits);
      if (!this.dead) this.onSummary(await this.doc.summary());
    },
  };
}
