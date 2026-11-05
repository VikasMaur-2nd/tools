/*
 * HugeSource (./source.ts) over the core's client (./client.ts, docs/huge-files/API.md): what huge mode's
 * views read, answered by the worker's checkpoint index, for files of any size.
 *
 * The core's nodes carry no values: a container's children come as a page (a tape, PageNodes) whose JNodes
 * have them, so a node keeps what it came from (its core node, or its JNode in a page) to read its own
 * children from (a small container's are in its page already: no request). Its positions are bytes; columns
 * on a line are UTF-16 units (colOf/atOf convert).
 */
import { kids, type JNode, type Kind } from '../json/parser';
import { clip, keyLabel, preview, primText } from '../json/format';
import { HugeClient } from './client';
import { PageNodes } from './page';
import { ARR, BOOL, LIST, NUM, OBJ, STR, type HugeLocation, type HugeNode as CoreNode, type HugeProgress, type HugeSummary } from './types';
import { PREVIEW, type HugeLine, type HugeNode, type HugeRow, type HugeSource, type IndexState, type LineMode, type Seg } from './source';

/** What a node was made from: the core's node (read its children from the worker), or a JNode of a page. */
type Ref = { core: CoreNode } | { page: PageNodes; j: JNode };

/** How often the summary (depth, pretty lines, the root's count so far) is asked for while indexing (ms). */
const SUMMARY_EVERY = 1000;

const aborted = () => new DOMException('Aborted', 'AbortError');
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw aborted();
};

/** UTF-8 bytes of the character at `s[i]` (a pair: 4). */
const utf8At = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c < 0x80 ? 1 : c < 0x800 ? 2 : (c & 0xfc00) === 0xd800 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 4 : 3;
};

export class CoreSource implements HugeSource {
  readonly name: string;
  readonly size: number;
  readonly doc: HugeClient;
  private st: IndexState;
  private listeners = new Set<(s: IndexState) => void>();
  private refs = new WeakMap<HugeNode, Ref>();
  /** The last summary, and the root as the views know it. */
  private last: HugeSummary | null = null;
  /** 1 when the root is the LIST of top-level values (it is depth 0 here, its records 1). */
  private lift = 0;
  private summaryAt = 0;
  private summaryBusy = false;
  private dead = false;

  /** `client`: made with the progress callback it is given (tests pass one over an in-process worker). */
  constructor(file: Blob, name: string, client?: (onProgress: (p: HugeProgress) => void) => HugeClient) {
    this.name = name;
    this.size = file.size;
    this.st = { bytes: 0, done: false, cancelled: false, error: null, status: null, multi: false, jsonl: false, nodes: 0, depth: 0, lines: 0, prettyLines: 0, records: 0 };
    this.doc = client ? client(this.onProgress) : new HugeClient(file, { name }, this.onProgress);
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
    if (this.dead || this.st.done || this.st.cancelled) return;
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
    this.set({
      bytes: s.done ? (e ? Math.min(this.size, e.pos) : this.size) : this.st.bytes,
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

  destroy() {
    this.dead = true;
    this.listeners.clear();
    this.doc.close();
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

  /** A node of the views for JNode `j` of a page, item `i` of its container, at `depth`. */
  private fromPage(view: PageNodes, j: JNode, i: number, depth: number): HugeNode {
    const stub = view.stub(j);
    if (stub) {
      const node = this.fromCore(stub, i);
      node.depth = depth;
      node.key = j.key ?? undefined;
      return node;
    }
    const [at, end] = view.span(j);
    let text: string;
    let clipped = false;
    if (j.t >= ARR) text = preview(j);
    else if (j.t === STR) {
      const s = j.v as string;
      clipped = s.length > PREVIEW;
      text = clipped ? s.slice(0, PREVIEW) : s;
    } else text = j.t === NUM ? (j.v as string) : j.t === BOOL ? (j.v ? 'true' : 'false') : 'null';
    const node: HugeNode = { at, end, t: j.t, key: j.key ?? undefined, i, depth, count: j.t >= ARR ? kids(j).length : 0, text, ...(clipped && { clipped: true }) };
    this.refs.set(node, { page: view, j });
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
    node.text = s.slice(0, PREVIEW);
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
    node.text = s + (isObj ? '}' : ']');
  }

  /** Items [from, from + n) of container `c` as nodes of the views. */
  private async items(c: HugeNode, from: number, n: number, signal?: AbortSignal): Promise<{ view: PageNodes | null; list: JNode[]; nodes: HugeNode[] }> {
    const ref = this.refs.get(c);
    if (!ref) return { view: null, list: [], nodes: [] };
    if ('j' in ref) {
      // A small container: its items are in its page already.
      const all = kids(ref.j);
      const list = all.slice(Math.max(0, from), from + n);
      return { view: ref.page, list, nodes: list.map((j, k) => this.fromPage(ref.page, j, from + k, c.depth + 1)) };
    }
    const page = await this.doc.children(ref.core, Math.max(0, from), n);
    check(signal);
    const view = new PageNodes(page);
    const list = view.children;
    const nodes = list.map((j, k) => this.fromPage(view, j, from + k, c.depth + 1));
    // Big children come with their previews; past the core's 64 a page, they are made here.
    const big: Promise<void>[] = [];
    for (const x of nodes) {
      const r = this.refs.get(x);
      if (!r || !('core' in r) || x.partial || x.text) continue;
      if (x.t === STR) big.push(this.stubText(x).catch(() => undefined));
      else if (x.t >= ARR && x.count) big.push(this.stubPreview(x, r.core).catch(() => undefined));
    }
    if (big.length) await Promise.all(big);
    check(signal);
    return { view, list, nodes };
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

  async resolve(path: Seg[], signal?: AbortSignal) {
    if (!path.length) return [await this.root(signal)];
    const loc = await this.doc.resolve(path);
    check(signal);
    return this.chainOf(loc);
  }

  async locate(at: number, signal?: AbortSignal) {
    const loc = await this.doc.locate(at);
    check(signal);
    return this.chainOf(loc) ?? [await this.root(signal)];
  }

  async rows(c: HugeNode, from: number, n: number, cols: number, signal?: AbortSignal): Promise<HugeRow[]> {
    const { view, list, nodes } = await this.items(c, from, n, signal);
    return nodes.map((node, k) => {
      const j = list[k];
      let cells: Map<string, HugeNode> | null = null;
      if (view && node.t === OBJ && !view.stub(j)) {
        cells = new Map();
        const members = kids(j);
        for (let m = 0; m < members.length && cells.size < cols; m++) {
          const key = members[m].key as string;
          if (!cells.has(key)) cells.set(key, this.fromPage(view, members[m], m, node.depth + 1));
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
    return got.text.map((text, k) => ({ text, more: got.cut[k] ? Math.max(0, got.length[k] - text.length) : 0, at: got.pos[k] }));
  }

  async lineOf(mode: LineMode, at: number, signal?: AbortSignal) {
    const loc = await this.doc.locate(Math.max(0, at));
    check(signal);
    if (!loc) return 0;
    return mode === 'raw' ? loc.line - 1 : Math.max(0, loc.node.pretty);
  }

  /** The column (UTF-16 units) of byte `at` on raw line `line`. */
  colOf(line: HugeLine, at: number) {
    let bytes = at - line.at;
    if (bytes < 0) return -1;
    let i = 0;
    for (; i < line.text.length && bytes > 0; i++) {
      const b = utf8At(line.text, i);
      bytes -= b;
      if (b === 4) i++;
    }
    return bytes > 0 ? -1 : i;
  }

  /** The byte of column `col` (UTF-16 units) on raw line `line`. */
  atOf(line: HugeLine, col: number) {
    let at = line.at;
    for (let i = 0; i < Math.min(col, line.text.length); i++) {
      const b = utf8At(line.text, i);
      at += b;
      if (b === 4) i++;
    }
    return at;
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

  blob(n: HugeNode): Blob {
    const [a, b] = n.at < 0 ? [0, this.size] : [n.at, n.end < 0 ? this.size : n.end];
    return this.doc.blob(a, b);
  }
}
