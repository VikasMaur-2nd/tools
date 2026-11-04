/*
 * HugeSource over a document small enough to parse whole (see ./source.ts): what drives huge mode's views
 * in unit tests and in browser checks of small files forced into huge mode (localStorage['tk:hugeMin']),
 * until the core's checkpoint index is wired in. It answers every read as the core will (asynchronously,
 * a bounded window at a time) and can play an index that advances at `speed` bytes per second, so counts
 * that grow while indexing, an error found part way, and Cancel can all be seen with a small file.
 *
 * Offsets are UTF-16 units of the text (the same as bytes for ASCII).
 */
import { ARR, BOOL, NUM, OBJ, STR, kids, parse, type JNode } from '../json/parser';
import { clip, preview, quote } from '../json/format';
import { nodeAt } from '../json/path';
import { jsonLines } from '../engine/rules';
import { PREVIEW, type HugeError, type HugeLine, type HugeNode, type HugeRow, type HugeSource, type IndexState, type LineMode, type Seg } from './source';

export interface SmallOptions {
  /** Index speed in bytes per second (Infinity: indexed at once, still reported asynchronously). */
  speed?: number;
  /** Delay before each read answers (ms), as a worker's round trip and a disk read take. */
  latency?: number;
  /** Treat as JSON Lines (a .jsonl / .ndjson file). */
  lines?: boolean;
}

/** A pretty line: its node, depth, and the text after the indent (the comma included). */
interface PrettyLine {
  at: number;
  d: number;
  text: string;
}

const LINES_NAME = /\.(jsonl|ndjson)$/i;
/** Offset of the virtual list of JSON Lines records (its first record starts at 0 too). */
const VIRTUAL = -1;

const aborted = () => new DOMException('Aborted', 'AbortError');

export class SmallSource implements HugeSource {
  readonly name: string;
  readonly size: number;
  private readonly text: string;
  private readonly rootNode: JNode | null;
  private readonly jsonl: boolean;
  private readonly error: HugeError | null;
  /** Start of each line. */
  private readonly ls: number[] = [];
  private readonly pretty: PrettyLine[] = [];
  /** First pretty line of each value, by its offset. */
  private readonly prettyAt = new Map<number, number>();
  /** Every value's start in document order (nodes so far), and the deepest nesting up to each. */
  private readonly starts: number[] = [];
  private readonly depthTo: number[] = [];
  private readonly speed: number;
  private readonly latency: number;
  private st: IndexState;
  private listeners = new Set<(s: IndexState) => void>();
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private began = 0;
  private dead = false;

  constructor(text: string, name: string, options: SmallOptions = {}) {
    this.text = text;
    this.name = name;
    this.size = text.length;
    this.speed = options.speed ?? Infinity;
    this.latency = options.latency ?? 0;
    const asLines = options.lines ?? LINES_NAME.test(name);
    const res = parse(text, { lines: asLines });
    const multi = res.multi && !!res.root;
    this.jsonl = multi && !res.error && jsonLines(text, res);
    // Strict JSON only: what the normal path tolerates with a fix (comments, trailing commas) is an error here.
    const issue = res.error ?? (this.jsonl ? null : res.issues[0] ?? null);
    let root = res.root;
    if (issue && !root) root = parse(text, { lines: asLines, repair: true }).root;
    this.rootNode = root;
    this.error = issue ? { msg: issue.m, at: issue.p, ...this.lineCol(issue.p) } : null;
    this.ls.push(0);
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) this.ls.push(i + 1);
    if (root) this.index(root);
    this.st = { bytes: 0, done: false, cancelled: false, error: null, jsonl: this.jsonl, nodes: 0, depth: 0, lines: 0, prettyLines: 0, records: 0 };
    this.began = Date.now();
    this.timer = setTimeout(this.tick, 0);
  }

  private lineCol(p: number) {
    let line = 1;
    let from = 0;
    for (let i = this.text.indexOf('\n'); i >= 0 && i < p; i = this.text.indexOf('\n', i + 1)) {
      line++;
      from = i + 1;
    }
    return { line, col: p - from + 1 };
  }

  /** Lists every value's start and pretty lines (a small document: done once, whole). */
  private index(root: JNode) {
    const virtual = this.jsonl || (root.u === null && this.isMulti(root));
    const out = this.pretty;
    let deepest = 0;
    const visit = (n: JNode, key: Seg | undefined, d: number, last: boolean) => {
      this.starts.push(n.s);
      deepest = Math.max(deepest, n.d);
      this.depthTo.push(deepest);
      const head = key === undefined || typeof key === 'number' ? '' : quote(key) + ': ';
      const comma = last ? '' : ',';
      this.prettyAt.set(n.s, out.length);
      if (n.t < ARR) {
        out.push({ at: n.s, d, text: head + this.text.slice(n.s, n.e) + comma });
        return;
      }
      const list = kids(n);
      const [o, c] = n.t === OBJ ? ['{', '}'] : ['[', ']'];
      if (!list.length) {
        out.push({ at: n.s, d, text: head + o + c + comma });
        return;
      }
      out.push({ at: n.s, d, text: head + o });
      for (let k = 0; k < list.length; k++) visit(list[k], list[k].key, d + 1, k === list.length - 1);
      // (A closing line is about its container's last byte, as the core has it.)
      out.push({ at: n.e - 1, d, text: c + comma });
    };
    if (virtual) {
      this.prettyAt.set(VIRTUAL, 0);
      const list = kids(root);
      for (let k = 0; k < list.length; k++) visit(list[k], undefined, 0, true);
    } else visit(root, undefined, 0, true);
  }

  /** The root wraps several top-level values (the parser's list for JSON Lines). */
  private isMulti(root: JNode) {
    return this.jsonl && root.t === ARR;
  }

  // ── Index ───────────────────────────────────────────────────────────────

  private tick = () => {
    this.timer = 0;
    if (this.dead || this.st.cancelled) return;
    const want = this.speed === Infinity ? this.size : Math.min(this.size, Math.floor(((Date.now() - this.began) / 1000) * this.speed));
    const err = this.error;
    const stop = err && want >= err.at ? err.at : want;
    const done = stop >= this.size || (!!err && want >= err.at);
    this.st = this.measure(stop, done, done && err ? err : null);
    for (const f of this.listeners) f(this.st);
    if (!done) this.timer = setTimeout(this.tick, 50);
  };

  private measure(bytes: number, done: boolean, error: HugeError | null): IndexState {
    const nodes = upper(this.starts, bytes - 1);
    let prettyLines = 0;
    while (prettyLines < this.pretty.length && this.pretty[prettyLines].at < bytes) prettyLines++;
    const records = this.jsonl && this.rootNode ? kids(this.rootNode).filter((r) => r.s < bytes).length : 0;
    return {
      bytes,
      done,
      cancelled: false,
      error,
      jsonl: this.jsonl,
      nodes,
      depth: nodes ? this.depthTo[nodes - 1] : 0,
      // (An error's line is shown whole: what is around it is what the error is about.)
      lines: done && !error ? this.ls.length : upper(this.ls, error ? bytes : bytes - 1),
      prettyLines: done && !error ? this.pretty.length : prettyLines,
      records,
    };
  }

  state() {
    return this.st;
  }

  onState(f: (s: IndexState) => void) {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  }

  cancel() {
    if (this.st.done || this.st.cancelled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
    this.st = { ...this.st, cancelled: true };
    for (const f of this.listeners) f(this.st);
  }

  destroy() {
    this.dead = true;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Answers after the read's latency (always asynchronously, as a worker does). */
  private later<T>(make: () => T, signal?: AbortSignal): Promise<T> {
    return new Promise((ok, fail) => {
      if (signal?.aborted) return fail(aborted());
      const run = () => {
        if (signal?.aborted) return fail(aborted());
        try {
          ok(make());
        } catch (e) {
          fail(e);
        }
      };
      if (this.latency > 0) setTimeout(run, this.latency);
      else queueMicrotask(run);
    });
  }

  /** How far the index has read: what lies past it isn't known yet. */
  private get reach() {
    return this.st.done && !this.st.error ? Infinity : this.st.bytes;
  }

  private node(n: JNode, i: number, depth: number, virtual = false): HugeNode {
    const reach = this.reach;
    const partial = n.e > reach;
    let count = 0;
    let text: string;
    let clipped = false;
    if (n.t >= ARR) {
      const list = kids(n);
      count = partial ? upperBy(list, reach) : list.length;
      text = virtual || partial ? '' : preview(n);
    } else if (n.t === STR) {
      const s = n.v as string;
      clipped = s.length > PREVIEW;
      text = clipped ? s.slice(0, PREVIEW) : s;
    } else text = n.t === NUM ? (n.v as string) : n.t === BOOL ? (n.v ? 'true' : 'false') : 'null';
    return {
      at: virtual ? VIRTUAL : n.s,
      end: virtual ? (partial ? -1 : this.size) : partial ? -1 : n.e,
      t: n.t,
      key: depth === 0 ? undefined : n.key,
      i,
      depth,
      count,
      ...(partial && { partial: true }),
      text,
      ...(clipped && { clipped: true }),
    };
  }

  private get virtual() {
    return !!this.rootNode && this.isMulti(this.rootNode);
  }

  /** The node at `at` (found down from the root by offset). */
  private nodeAt(at: number, depth: number): JNode | null {
    let n = this.rootNode;
    if (!n || at === VIRTUAL) return n;
    if (!this.virtual && n.s === at && depth === 0) return n;
    for (let d = 0; n && n.t >= ARR; d++) {
      const list = kids(n);
      const k = upperBy(list, at + 1) - 1;
      if (k < 0) return null;
      const c = list[k];
      if (c.s === at && d + 1 === depth) return c;
      if (c.s > at || c.e <= at) return null;
      n = c;
    }
    return null;
  }

  root(signal?: AbortSignal) {
    return this.later(() => {
      const r = this.rootNode;
      if (!r) throw new Error('No JSON value');
      return this.node(r, 0, 0, this.virtual);
    }, signal);
  }

  children(c: HugeNode, from: number, n: number, signal?: AbortSignal) {
    return this.later(() => {
      const p = this.nodeAt(c.at, c.depth);
      if (!p || p.t < ARR) return [];
      const list = kids(p);
      const end = Math.min(from + n, p.e > this.reach ? upperBy(list, this.reach) : list.length);
      const out: HugeNode[] = [];
      for (let k = Math.max(0, from); k < end; k++) out.push(this.node(list[k], k, c.depth + 1));
      return out;
    }, signal);
  }

  resolve(path: Seg[], signal?: AbortSignal) {
    return this.later(() => {
      let n = this.rootNode;
      if (!n) return null;
      const chain = [this.node(n, 0, 0, this.virtual)];
      for (const seg of path) {
        if (n.t < ARR) return null;
        const list = kids(n);
        let k = -1;
        if (n.t === ARR) {
          const i = typeof seg === 'number' ? seg : /^\d+$/.test(seg) ? Number(seg) : -1;
          if (i >= 0 && i < list.length) k = i;
        } else k = list.findIndex((x) => x.key === String(seg));
        if (k < 0 || list[k].s >= this.reach) return null;
        n = list[k];
        chain.push(this.node(n, k, chain.length));
      }
      return chain;
    }, signal);
  }

  locate(at: number, signal?: AbortSignal) {
    return this.later(() => {
      const root = this.rootNode;
      if (!root) return [];
      // The value the editor's caret would select there (a caret on a property name: its value), as the core's locate.
      let n: JNode | null = nodeAt(root, Math.min(at, this.reach), this.text) ?? root;
      if (n.s >= this.reach && n !== root) n = n.u ?? root;
      const up: JNode[] = [];
      for (let x: JNode | null = n; x && x !== root; x = x.u) up.push(x);
      const chain = [this.node(root, 0, 0, this.virtual)];
      for (let k = up.length - 1; k >= 0; k--) {
        const x = up[k];
        const list = kids(x.u as JNode);
        chain.push(this.node(x, upperBy(list, x.s), chain.length));
      }
      return chain;
    }, signal);
  }

  rows(c: HugeNode, from: number, n: number, cols: number, signal?: AbortSignal) {
    return this.later(() => {
      const p = this.nodeAt(c.at, c.depth);
      if (!p || p.t < ARR) return [];
      const list = kids(p);
      const end = Math.min(from + n, p.e > this.reach ? upperBy(list, this.reach) : list.length);
      const out: HugeRow[] = [];
      for (let k = Math.max(0, from); k < end; k++) {
        const item = list[k];
        let cells: Map<string, HugeNode> | null = null;
        if (item.t === OBJ) {
          cells = new Map();
          const members = kids(item);
          for (let m = 0; m < members.length && cells.size < cols; m++) {
            const key = members[m].key as string;
            if (!cells.has(key)) cells.set(key, this.node(members[m], m, c.depth + 2));
          }
        }
        out.push({ node: this.node(item, k, c.depth + 1), cells });
      }
      return out;
    }, signal);
  }

  // ── Lines ───────────────────────────────────────────────────────────────

  lineCount(mode: LineMode) {
    return mode === 'raw' ? this.st.lines : this.st.prettyLines;
  }

  lines(mode: LineMode, from: number, n: number, cols: number, indent: string, signal?: AbortSignal) {
    return this.later(() => {
      const out: HugeLine[] = [];
      const end = Math.min(from + n, this.lineCount(mode));
      for (let k = Math.max(0, from); k < end; k++) {
        let text: string;
        let at: number;
        if (mode === 'raw') {
          at = this.ls[k];
          const e = k + 1 < this.ls.length ? this.ls[k + 1] - 1 : this.size;
          text = this.text.slice(at, e > at && this.text.charCodeAt(e - 1) === 13 ? e - 1 : e);
        } else {
          const p = this.pretty[k];
          at = p.at;
          text = indent.repeat(p.d) + p.text;
        }
        const more = Math.max(0, text.length - cols);
        out.push({ text: more ? clip(text, cols).slice(0, -1) : text, more, at });
      }
      return out;
    }, signal);
  }

  lineOf(mode: LineMode, at: number, signal?: AbortSignal) {
    if (mode === 'raw') return this.later(() => Math.max(0, upper(this.ls, at) - 1), signal);
    return this.locate(at, signal).then((chain) => {
      for (let k = chain.length - 1; k >= 0; k--) {
        const line = this.prettyAt.get(chain[k].at);
        if (line !== undefined) return line;
      }
      return 0;
    });
  }

  // ── Find & values ───────────────────────────────────────────────────────

  async find(q: string, from: number, hits: (at: number[], read: number) => void, signal: AbortSignal) {
    if (!q) return;
    const cs = q !== q.toLowerCase();
    const needle = cs ? q : q.toLowerCase();
    const CHUNK = 4096;
    for (let pos = Math.max(0, from); pos < this.size; pos += CHUNK) {
      await this.later(() => undefined);
      if (signal.aborted) return;
      const end = Math.min(this.size, pos + CHUNK);
      const raw = this.text.slice(pos, Math.min(this.size, end + needle.length - 1));
      const hay = cs ? raw : raw.toLowerCase();
      const found: number[] = [];
      for (let i = hay.indexOf(needle); i >= 0 && pos + i < end; i = hay.indexOf(needle, i + needle.length)) found.push(pos + i);
      hits(found, end);
    }
  }

  raw(n: HugeNode, max: number, signal?: AbortSignal) {
    return this.later(() => {
      const [a, b] = n.at === VIRTUAL ? [0, this.size] : [n.at, n.end];
      if (b < 0) return null;
      return b - a > max ? null : this.text.slice(a, b);
    }, signal);
  }

  blob(n: HugeNode) {
    const [a, b] = n.at === VIRTUAL ? [0, this.size] : [n.at, n.end < 0 ? this.size : n.end];
    return new Blob([this.text.slice(a, b)], { type: 'application/json' });
  }
}

/** How many of the sorted `xs` are at most `v`. */
function upper(xs: ArrayLike<number>, v: number) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many of `list` (in document order) start before `at`. */
function upperBy(list: JNode[], at: number) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

