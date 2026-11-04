/**
 * A huge document in the worker: its index, built a window at a time (step), and every query of API.md
 * answered from it. Each query starts at a checkpoint, seeks with the skeleton (a second instance: the index
 * may still be growing) and parses at most about a MiB in full, with the normal path's parsers (tape.wasm, or
 * the JS tape parser), on a text made of the document's bytes and a few brackets (see `region`, `pageOf`).
 */
import { decodeString } from '../json/decode';
import { MAX_INDENT, quote } from '../json/format';
import { MAX_DEPTH } from '../json/parser';
import { childCount, endOf, KEY_INDEX, KEY_NAME, keyKindOf, keyOf, kindOf, nextOf, nodeAtOffset, parentOf, sizeOf, startOf, valueKindOf, valueOf, VALUE_DECODE, VALUE_FALSE, VALUE_SLICE, W, type SentTape, type Tape } from '../json/tape';
import { wasmTape, type ByteSource } from '../json/tape-wasm';
import { CachedSource, afterBreaks, content, nextBreak, textOf } from './bytes';
import { byteBefore, duplicates, exactError, lineCol, nameAt, prefixOf, type Parse } from './errors';
import { HugeIndex, type Big } from './index';
import { DONE, FAIL, NEED, S_AFTER, S_TOP, STOP, Skeleton, W_CHILD, W_CLOSE, W_MEMORY, type State } from './skeleton';
import { ARR, BOOL, LIST, NUL, NUM, OBJ, STR, type Bytes, type FindBatch, type FindOptions, type HugeError, type HugeLines, type HugeLocation, type HugeNode, type HugeOptions, type HugePage, type HugeProblem, type HugeProgress, type HugeSummary, type Seg } from './types';

/** The parsers queries use: tape.wasm's module (null without WebAssembly) and the JS tape parser. */
export interface Parsers {
  wasm: WebAssembly.Module | null;
  parse: Parse;
}

const LINES_FILE = /\.(jsonl|ndjson)$/i;
/** A page's text stops at the first child past this many bytes. */
const PAGE_BYTES = 4 << 20;
/** Window of the query skeleton (seeks stop within ~1 MiB: a small window reads less past the stop). */
const QUERY_WINDOW = 1 << 18;
/** Parsed regions kept for the Format view and locate (bytes of text and tape, about). */
const REGION_BUDGET = 64 << 20;
/** What a big string shows of itself in a pretty line (bytes). */
const PREVIEW = 1 << 12;

const stubText = (kind: number) => (kind === OBJ ? '{}' : kind === ARR ? '[]' : '""');

/** A container as the skeleton's target sees it: open containers when it is innermost (0: the top level), and its start. */
interface Box {
  node: HugeNode;
  d: number;
  start: number;
}

/** A parsed stretch of the document from a checkpoint to the next (its pretty lines, the nodes in it). */
interface Region extends Built {
  k: number;
  tape: Tape;
  /** Nodes standing for what is before the region: the JSON Lines wrapper, the containers open at its start, a value before it. */
  synth: number;
  /** Parsed as JSON Lines: node 0 is the wrapper. */
  wrap: boolean;
  /** Where the text after the region (closing brackets) starts. */
  end: number;
  s: State;
  /** The state at the region's end (null: the end of the document). */
  e: State | null;
  /** Pretty lines: per line its node, or -1 - c for container c's closing line; and its depth. */
  lines: Int32Array;
  depth: Int32Array;
  /** Byte of the first token after the region (-1: the end): a comma there gives its last value one. */
  next: number;
  bytes: number;
}

export class HugeDoc {
  readonly src: ByteSource;
  readonly size: number;
  readonly bom: number;
  readonly index = new HugeIndex();
  done = false;
  error: HugeError | null = null;
  private ix: Skeleton;
  private q: Skeleton;
  private final: Float64Array | null = null;
  private pairs: number[] = [];
  private warnings: HugeProblem[] = [];
  private checked = 0;
  private t0 = performance.now();
  private ms = 0;
  private regions = new Map<number, Region>();
  private regionBytes = 0;
  private lines: boolean;

  private queryWindow: number;
  private pageBytes: number;

  /** The indexing pass's source, when it has bytes only once read ahead (prefetch.ts): whether [at, at + len) is here. */
  private indexHas: ((at: number, len: number) => boolean) | null = null;

  /**
   * `file`: the document's bytes for queries (random reads). `tune`: window sizes (tests make them small so every
   * boundary is crossed), and `index`: a source for the indexing pass that reads ahead (else `file`).
   */
  constructor(
    file: ByteSource,
    huge: WebAssembly.Module,
    private readonly parsers: Parsers,
    readonly options: HugeOptions = {},
    tune: { window?: number; queryWindow?: number; pageBytes?: number; index?: ByteSource & { has(at: number, len: number): boolean } } = {},
  ) {
    this.queryWindow = tune.queryWindow ?? QUERY_WINDOW;
    this.pageBytes = tune.pageBytes ?? PAGE_BYTES;
    const c = content(file);
    this.src = new CachedSource(c.src);
    this.size = file.size;
    this.bom = c.bom;
    this.lines = LINES_FILE.test(options.name ?? '');
    this.ix = new Skeleton(huge);
    this.q = new Skeleton(huge);
    if (c.utf16) {
      this.final = new Float64Array(12);
      this.done = true;
      this.error = { msg: 'UTF-16 files are not supported for files this big', line: 1, col: 1, pos: 0, kind: 'error' };
      return;
    }
    // (Indexing reads each byte once, as is: from the read-ahead source if there is one.)
    let indexSrc = c.src;
    if (tune.index) {
      const ahead = tune.index;
      const bom = c.bom;
      indexSrc = { size: ahead.size - bom, read: (at, len) => ahead.read(at + bom, len) };
      this.indexHas = (at, len) => ahead.has(at + bom, len);
    }
    if (!this.ix.start(indexSrc, { window: tune.window, every: options.every ?? 1 << 20, big: options.big ?? 1 << 18, dups: options.dups ?? true, maxDepth: MAX_DEPTH, lines: this.lines })) {
      this.final = new Float64Array(12);
      this.done = true;
      this.error = { msg: 'Not enough memory to parse this document', line: 1, col: 1, pos: 0, kind: 'error' };
    }
  }

  // ── Indexing ──────────────────────────────────────────────────────────

  /** Reads windows until `until` (a performance.now() value) or the end: true once the whole document is read. */
  step(until: number): boolean {
    while (!this.done) {
      // (Not read yet: the caller reads ahead (indexAt) and steps again.)
      if (this.indexHas && !this.indexHas(this.ix.pos, Math.min(this.ix.window, this.src.size - this.ix.pos))) return false;
      const r = this.ix.step();
      const out = this.ix.drain();
      this.index.addCheckpoints(out.ck);
      this.index.addBig(out.dir);
      for (const v of out.warn) this.pairs.push(v);
      if (r === NEED) {
        if (performance.now() >= until) return false;
        continue;
      }
      this.final = this.ix.stats();
      if (r === FAIL) {
        const at = this.ix.failPos;
        this.error =
          this.ix.why === W_MEMORY
            ? { msg: 'Not enough memory to parse this document', ...lineCol(this.src, this.index, at), pos: at, kind: 'error' }
            : exactError(this.src, this.index, at, this.ix.failAt, this.parsers.parse, this.lines);
      }
      this.done = true;
      this.ms = performance.now() - this.t0;
      // (Regions parsed while reading may end where the document did then.)
      this.regions.clear();
      this.regionBytes = 0;
    }
    return true;
  }

  /** The file byte the indexing pass reads next (for a read-ahead source), and how many it reads at a time. */
  get indexAt(): [number, number] {
    return [this.ix.pos + this.bom, this.ix.window];
  }

  private stats(): Float64Array {
    return this.final ?? this.ix.stats();
  }

  progress(): HugeProgress {
    const st = this.stats();
    return { bytes: this.done ? this.src.size : this.ix.pos, size: this.src.size, nodes: st[1], records: st[3], lines: st[9], ms: performance.now() - this.t0 };
  }

  /** The top-level values are viewed as an array of them: several, or JSON Lines by name (the normal path wraps those even when one). */
  private get multi(): boolean {
    const n = this.stats()[3];
    return n > 1 || (this.lines && n > 0);
  }

  summary(): HugeSummary {
    const st = this.stats();
    const records = st[3];
    const multi = this.multi;
    // Duplicate names, confirmed and placed as they come.
    if (this.checked < this.pairs.length) {
      this.warnings.push(...duplicates(this.src, this.index, this.pairs.slice(this.checked)));
      this.checked = this.pairs.length;
    }
    return {
      size: this.size,
      bom: this.bom,
      done: this.done,
      root: this.root(),
      records,
      multi,
      jsonl: multi && st[7] === 1,
      nodes: st[1],
      depth: st[4],
      lines: st[9] + 1,
      prettyLines: st[1] + st[2] + (multi ? 2 : 0),
      error: this.error,
      warnings: this.warnings.slice(0, 500),
      moreWarnings: this.warnings.length >= 500,
      unchecked: st[8],
      ms: this.done ? this.ms : performance.now() - this.t0,
      indexBytes: this.index.bytes,
    };
  }

  /** The LIST of top-level values. */
  private list(): HugeNode {
    const st = this.stats();
    return { kind: LIST, start: 0, end: this.done ? this.src.size : -1, depth: -1, key: null, count: this.done ? st[3] : null, pretty: 0, prettyLines: this.done ? st[1] + st[2] + 2 : null, big: true };
  }

  /** The only top-level value, or the LIST of them. */
  private root(): HugeNode | null {
    if (this.stats()[3] === 0) return null;
    if (this.multi) return this.list();
    const ix = this.index;
    // In the directory; else a container from its first byte (open while being read, or broken: its end unknown).
    if (ix.bigCount) {
      const b = ix.big(0);
      if (b.depth === 0) return this.ofBig(b, null);
    }
    const head = this.src.read(0, Math.min(this.src.size, 4096));
    let at = 0;
    while (at < head.length && (head[at] === 32 || head[at] === 9 || head[at] === 10 || head[at] === 13)) at++;
    const c = head[at];
    if (c === 123 || c === 91) {
      const kind = c === 123 ? OBJ : ARR;
      if (!this.done || this.error) return { kind, start: at, end: -1, depth: 0, key: null, count: null, pretty: 0, prettyLines: null, big: true };
      return { ...this.measure(ix.state(0), 0, at, kind, null), big: true };
    }
    const page = this.error ? null : this.pageOf(this.list(), 0, 1);
    return page && page.nodes.length ? { ...page.nodes[0], key: null } : null;
  }

  private ofBig(b: Big, key: Seg | null): HugeNode {
    const multi = this.multi ? 1 : 0;
    const lines = b.kind >= ARR && b.count > 0 ? b.endNodes + b.endClosers - (b.nodes + b.closers) + 1 : 1;
    return { kind: b.kind, start: b.start, end: b.end, depth: b.depth, key, count: b.kind >= ARR ? b.count : 0, pretty: b.nodes + b.closers + multi, prettyLines: lines, big: true };
  }

  // ── Seeking ───────────────────────────────────────────────────────────

  private box(node: HugeNode): Box {
    return node.kind === LIST ? { node, d: 0, start: -1 } : { node, d: node.depth + 1, start: node.start };
  }

  /** Children of `b` begun at checkpoint `k` (`k` inside it). */
  private countAt(k: number, b: Box): number {
    const ix = this.index;
    return b.d === 0 ? ix.top[k] : ix.frames[ix.frame(k, b.d - 1) + 1];
  }

  /** Children of `b` begun in state `s` (inside it). */
  private countIn(s: State, b: Box): number {
    return b.d === 0 ? s.top : s.frames[b.d - 1].count;
  }

  /** The last checkpoint from which a parse reaches child `i` of `b`: inside it with fewer children begun, or before it. */
  private from(b: Box, i: number): number {
    const ix = this.index;
    if (b.d === 0) return Math.max(0, ix.lastAtMost(ix.top, i));
    const k1 = ix.at(b.start) + 1;
    let k2 = ix.n - 1;
    if (b.node.end >= 0) k2 = Math.min(k2, ix.at(b.node.end - 1));
    else {
      // (Its end not known yet: the checkpoints it is open at are k1… up to the last one where it is.)
      const open = (k: number) => ix.depth[k] >= b.d && ix.frames[ix.frame(k, b.d - 1) + 2] === b.start;
      if (k1 > k2 || !open(k1)) k2 = k1 - 1;
      else {
        let lo = k1;
        let hi = k2;
        while (lo < hi) {
          const mid = (lo + hi + 1) >>> 1;
          if (open(mid)) lo = mid;
          else hi = mid - 1;
        }
        k2 = lo;
      }
    }
    if (k1 > k2 || this.countAt(k1, b) > i) return k1 - 1;
    let lo = k1;
    let hi = k2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.countAt(mid, b) <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The query skeleton, from state `s`. */
  private at(s: State): Skeleton {
    const q = this.q;
    if (!q.start(this.src, { window: this.queryWindow, maxDepth: MAX_DEPTH }) || !q.restore(s)) throw new Error('Out of memory');
    return q;
  }

  /** Child `i` of `b`: the state before it (an object member: before its name), or where `b` closes (`closed`); null if the document ends or breaks first. */
  private seek(b: Box, i: number): { s: State; closed: boolean } | null {
    const q = this.at(this.index.state(this.from(b, i)));
    q.target(b.d, b.start, i);
    if (q.go() !== STOP) return null;
    return { s: q.snapshot(), closed: q.why === W_CLOSE };
  }

  /**
   * The container at depth `d` that starts at byte `start` after state `s`, read to its closing bracket: its end,
   * children and pretty lines (null if the document ends or breaks first).
   */
  private measure(s: State, d: number, start: number, kind: number, key: Seg | null): HugeNode {
    const big = this.index.bigAt(start);
    if (big) return this.ofBig(big, key);
    const q = this.at(s);
    q.target(d + 1, start);
    const multi = this.multi ? 1 : 0;
    if (q.go() !== STOP || q.why !== W_CLOSE) return { kind, start, end: -1, depth: d, key, count: null, pretty: -1, prettyLines: null, big: false };
    const e = q.snapshot();
    const f = e.frames[d];
    return { kind, start, end: e.pos + 1, depth: d, key, count: f.count, pretty: f.nodes + f.closers + multi, prettyLines: e.nodes + e.closers - (f.nodes + f.closers) + (f.count > 0 ? 1 : 0), big: false };
  }

  // ── Pages ─────────────────────────────────────────────────────────────

  /** Children [from, from + count) of `node`. */
  children(node: HugeNode, from: number, count: number): HugePage {
    const page = this.pageOf(node, from, count);
    if (page) return page.page;
    return { container: node, from, count: 0, more: false, tape: emptySent(), text: '', stubs: [], map: new Float64Array(0) };
  }

  /** The big children of `b` from byte `at` on, in order (from the directory). */
  private *bigKids(b: Box, at: number): Generator<Big> {
    const ix = this.index;
    for (let k = ix.bigFrom(at); k < ix.bigCount; k++) {
      const g = ix.big(k);
      if (b.node.end >= 0 && g.start >= b.node.end) return;
      if (g.parent === b.start && g.depth === b.d) yield g;
    }
  }

  private pageOf(node: HugeNode, from: number, count: number): { page: HugePage; nodes: HugeNode[] } | null {
    if (node.kind < ARR) return null;
    const b = this.box(node);
    const first = this.seek(b, from);
    if (!first) return null;
    const pieces: Piece[] = [];
    const stubs: { index: number; key: Seg | null }[] = [];
    let cur = first.s.pos;
    let end = cur;
    let more = false;
    let got = from;
    if (!first.closed) {
      const q = this.q;
      // (Big children are stubs: their bytes don't count.)
      let limit = cur + this.pageBytes;
      const kids = this.bigKids(b, cur);
      let nb = kids.next().value as Big | undefined;
      for (;;) {
        q.target(b.d, b.start, from + count, limit, nb ? nb.start : -1);
        const r = q.go();
        if (r === DONE && b.d === 0) {
          // The top level ends with the document.
          end = this.src.size;
          got = q.snapshot().top;
          break;
        }
        if (r !== STOP) {
          // The document ends or breaks in the page: it ends with the last whole child.
          const last = this.lastWhole(b, first.s, from + count);
          end = Math.max(cur, last.end);
          got = last.count;
          break;
        }
        const s = q.snapshot();
        const n = this.countIn(s, b);
        if (q.why === W_CHILD && n < from + count && nb && s.pos === nb.start) {
          // A big child: a stub, and on after it (from the checkpoint right after it, if it's read yet).
          stubs.push({ index: n, key: node.kind === OBJ ? nameAt(this.src, s.frames[b.d - 1].key) : n });
          pieces.push([cur, s.pos], nb);
          cur = nb.end;
          limit += nb.end - nb.start;
          // (The checkpoint after it is at the next token: only whitespace between.)
          const k = this.index.at(nb.end - 1) + 1;
          if (k < this.index.n && this.index.pos[k] < nb.end + 4096 && this.index.depth[k] === b.d) this.at(this.index.state(k));
          else {
            // (Not read that far yet: read through it.)
            q.target(b.d, b.start, n + 1);
            const r2 = q.go();
            if (r2 === DONE && b.d === 0) {
              end = this.src.size;
              got = n + 1;
              break;
            }
            if (r2 !== STOP) {
              const last = this.lastWhole(b, first.s, from + count);
              end = Math.max(cur, last.end);
              got = last.count;
              break;
            }
            if ((q.why as number) === W_CLOSE) {
              end = q.snapshot().pos;
              got = n + 1;
              break;
            }
            this.at(q.snapshot());
          }
          nb = kids.next().value as Big | undefined;
          continue;
        }
        end = s.pos;
        got = n;
        more = q.why === W_CHILD;
        break;
      }
    }
    if (end > cur) pieces.push([cur, trimEnd(this.src, cur, end)]);
    const list = node.kind === LIST;
    if (!list) {
      pieces.unshift(node.kind === OBJ ? '{' : '[');
      pieces.push(node.kind === OBJ ? '}' : ']');
    }
    const built = build(this.src, pieces);
    const t = list ? this.parsers.parse(built.text, { lines: true }) : ((this.parsers.wasm && wasmTape(this.parsers.wasm, built.text)) || this.parsers.parse(built.text));
    if (!t.count || t.head.error) return null;
    const n = got - from;
    // Items numbered from `from`; the stubs' nodes.
    const kids: number[] = [];
    for (let c = 1, e = nextOf(t, 0); c < e && kids.length < n; c = nextOf(t, c)) kids.push(c);
    if (from + n < 0x7fffffff) for (const c of kids) if (keyKindOf(t, c) === KEY_INDEX) t.nodes[c * W + 4] += from;
    const depth = node.depth + 1;
    const nodes = kids.map((c) => this.nodeIn(built, t, c, depth, keyKindOf(t, c) === KEY_NAME ? (keyOf(t, c) as string) : (keyOf(t, c) as number)));
    const stubPairs: [number, HugeNode][] = stubs.map((x) => [kids[x.index - from], { ...nodes[x.index - from], key: x.key }]);
    const container = !more && node.count === null ? { ...node, count: got } : node;
    const pairs = new Float64Array((built.map.length / 3) * 2);
    for (let j = 0, o = 0; j < built.map.length; j += 3, o += 2) {
      pairs[o] = built.map[j];
      pairs[o + 1] = built.map[j + 1];
    }
    const page: HugePage = { container, from, count: kids.length, more, tape: sendTape(t), text: built.text, stubs: stubPairs, map: pairs };
    return { page, nodes };
  }

  /** A node of a parsed text, whole in it (a stub: its big value), as a HugeNode (its pretty line not known: -1). */
  private nodeIn(b: Built, t: Tape, i: number, depth: number, key: Seg | null, pretty = -1): HugeNode {
    const kind = kindOf(t, i);
    const at = startOf(t, i);
    const stub = b.stubs.get(at);
    if (stub) return this.ofBig(stub, key);
    const start = byteOf(b, at);
    const big = this.index.bigAt(start);
    if (big) return this.ofBig(big, key);
    let lines = 1;
    if (kind >= ARR && sizeOf(t, i) > 1) {
      lines = sizeOf(t, i);
      for (let c = i, last = nextOf(t, i); c < last; c++) if (kindOf(t, c) >= ARR && sizeOf(t, c) > 1) lines++;
    }
    return { kind, start, end: byteOf(b, endOf(t, i)), depth, key, count: kind >= ARR ? childCount(t, i) : 0, pretty, prettyLines: lines, big: false };
  }

  /** Where the children of `b` from state `s` stop being whole (the document ends or breaks there): the end of the last whole one, and how many there are. */
  private lastWhole(b: Box, s: State, max: number): { end: number; count: number } {
    let end = s.pos;
    let n = this.countIn(s, b);
    for (let i = n + 1; i <= max; i++) {
      const q = this.at(s);
      q.target(b.d, b.start, i);
      const r = q.go();
      if (r === DONE && b.d === 0) return { end: this.src.size, count: i };
      if (r !== STOP) break;
      end = q.snapshot().pos;
      n = i;
      if (q.why === W_CLOSE) break;
    }
    return { end, count: n };
  }

  // ── Regions and the pretty form ───────────────────────────────────────

  /** Pretty line of checkpoint `k` (before JSON Lines' opening line). */
  private prettyAt(k: number): number {
    return this.index.nodes[k] + this.index.closers[k];
  }

  /** The last checkpoint at or before pretty line `l` (before JSON Lines' opening line). */
  private checkpointOfLine(l: number): number {
    const ix = this.index;
    let lo = 0;
    let hi = ix.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.prettyAt(mid) <= l) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The stretch from checkpoint `k` to the next (or the end), parsed; null if not read yet. */
  private region(k: number): Region | null {
    const hit = this.regions.get(k);
    if (hit) {
      this.regions.delete(k);
      this.regions.set(k, hit);
      return hit;
    }
    const ix = this.index;
    const last = k === ix.n - 1;
    if (last && (!this.done || this.error)) return null;
    const s = ix.state(k);
    const e = last ? null : ix.state(k + 1);
    const to = e ? e.pos : this.src.size;
    const prefix = prefixOf(s, byteBefore(this.src, s.pos));
    const suffix = e ? e.frames.map((f) => (f.kind === OBJ ? '}' : ']')).reverse().join('') : '';
    // Big strings in it are stubs (their lines show their start).
    const pieces: Piece[] = [prefix];
    let cur = s.pos;
    for (let j = ix.bigFrom(s.pos); j < ix.bigCount; j++) {
      const g = ix.big(j);
      if (g.start >= to) break;
      if (g.kind !== STR || g.start < cur) continue;
      pieces.push([cur, g.start], g);
      cur = g.end;
    }
    pieces.push([cur, to], suffix);
    const built = build(this.src, pieces);
    const wrap = s.frames.length === 0 || !e || e.frames.length === 0 || ix.low[k + 1] === 0;
    const t = wrap ? this.parsers.parse(built.text, { lines: true }) : ((this.parsers.wasm && wasmTape(this.parsers.wasm, built.text)) || this.parsers.parse(built.text));
    if (t.head.error) return null;
    const synth = (wrap ? 1 : 0) + s.frames.length + (s.state === S_AFTER || s.state === S_TOP ? 1 : 0);
    const end = built.text.length - suffix.length;
    // Its pretty lines: every node after the synthetic ones, and the closing line of every container with
    // children that closes in it. Depths are real ones (the wrapper isn't a level).
    const lines = new Int32Array(2 * t.count);
    const depths = new Int32Array(2 * t.count);
    let n = 0;
    const open: number[] = [];
    const ends: number[] = [];
    for (let c = wrap ? 1 : 0; c < (wrap ? 1 : 0) + s.frames.length; c++) {
      open.push(c);
      ends.push(nextOf(t, c));
    }
    const closeTo = (i: number) => {
      while (open.length && ends[ends.length - 1] <= i) {
        const c = open.pop()!;
        ends.pop();
        if (endOf(t, c) <= end && sizeOf(t, c) > 1) {
          lines[n] = -1 - c;
          depths[n++] = open.length;
        }
      }
    };
    const T = t.nodes;
    for (let i = synth; i < t.count; i++) {
      if (open.length && ends[ends.length - 1] <= i) closeTo(i);
      lines[n] = i;
      depths[n++] = open.length;
      const m = T[i * W];
      if ((m & 7) >= ARR && m >>> 8 !== 1) {
        open.push(i);
        ends.push(nextOf(t, i));
      }
    }
    closeTo(Infinity);
    const region: Region = { ...built, k, tape: t, synth, wrap, end, s, e, lines: lines.slice(0, n), depth: depths.slice(0, n), next: e ? e.pos : -1, bytes: built.text.length * 2 + t.count * W * 4 + n * 8 + 1024 };
    this.regions.set(k, region);
    this.regionBytes += region.bytes;
    while (this.regionBytes > REGION_BUDGET && this.regions.size > 1) {
      const [key, old] = this.regions.entries().next().value!;
      this.regions.delete(key);
      this.regionBytes -= old.bytes;
    }
    return region;
  }

  /** Whether node `i` of region `r` has a comma after it in the pretty form. */
  private comma(r: Region, i: number): boolean {
    const t = r.tape;
    const p = parentOf(t, i);
    if (p < 0) return false;
    if (r.wrap && p === 0) {
      // A top-level value: one of the array JSON Lines are written as, unless it's the last.
      if (!this.multi) return false;
      if (nextOf(t, i) < t.count) return true;
      return r.e !== null && this.recordAfter(r.next);
    }
    if (nextOf(t, i) < nextOf(t, p)) return true;
    // Its container goes on after the region: a comma is next if the region ends before one.
    if (endOf(t, p) > r.end && endOf(t, i) <= r.end) return r.next >= 0 && this.src.read(r.next, 1)[0] === 44;
    return false;
  }

  /** Whether another top-level value starts at or after byte `at` (separators and whitespace skipped). */
  private recordAfter(at: number): boolean {
    for (let p = at; p < this.src.size; p += 4096) {
      const b = this.src.read(p, 4096);
      for (let i = 0; i < b.length; i++) {
        const c = b[i];
        if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 44 && c !== 59) return true;
      }
    }
    return false;
  }

  /** Line `a` of region `r`: its text (cut at `max`), full length, its node's byte, and kind (0 value, 1 opens, 2 closes). */
  private lineText(r: Region, a: number, indent: string, max: number, pads: string[]): { text: string; length: number; pos: number; kind: number; cut?: boolean } {
    const t = r.tape;
    const x = r.lines[a];
    const d = r.depth[a] + (this.multi ? 1 : 0);
    while (pads.length <= d) pads.push(pads[pads.length - 1] + indent);
    const pad = pads[d];
    if (x < 0) {
      const c = -1 - x;
      const text = pad + (kindOf(t, c) === OBJ ? '}' : ']') + (this.comma(r, c) ? ',' : '');
      return { text: text.slice(0, max), length: text.length, pos: byteOf(r, endOf(t, c)) - 1, kind: 2 };
    }
    const i = x;
    const kind = kindOf(t, i);
    let head = pad;
    if (keyKindOf(t, i) === KEY_NAME) head += quote(keyOf(t, i) as string) + ': ';
    const tail = this.comma(r, i) ? ',' : '';
    const at = startOf(t, i);
    const stub = r.stubs.get(at);
    const pos = stub ? stub.start : byteOf(r, at);
    if (kind >= ARR) {
      const opens = sizeOf(t, i) > 1;
      const text = head + (kind === OBJ ? (opens ? '{' : '{}') : opens ? '[' : '[]') + (opens ? '' : tail);
      return { text: text.slice(0, max), length: text.length, pos, kind: opens ? 1 : 0 };
    }
    let body: string;
    if (stub) {
      const len = stub.end - stub.start;
      if (len > PREVIEW) {
        // A big string: its start as stored (the line is cut; its length is its bytes').
        const text = (head + textOf(this.src, stub.start, PREVIEW)).slice(0, max);
        return { text, length: head.length + len + tail.length, pos, kind: 0, cut: true };
      }
      // (Small enough to write as the normal path does.)
      const token = textOf(this.src, stub.start, len);
      body = plainToken(token, 0, token.length) ? token : quote(decodeString(token, 0));
    } else if (kind === NUL) body = 'null';
    else if (kind === BOOL) body = valueKindOf(t, i) === VALUE_FALSE ? 'false' : 'true';
    else if (kind === NUM) body = valueOf(t, i, r.text) as string;
    else {
      const e = endOf(t, i);
      const vk = valueKindOf(t, i);
      body = (vk === VALUE_SLICE || vk === VALUE_DECODE) && plainToken(r.text, at, e) ? r.text.slice(at, e) : quote(valueOf(t, i, r.text) as string);
    }
    const length = head.length + body.length + tail.length;
    const text = length <= max ? head + body + tail : (head + body.slice(0, max)).slice(0, max);
    return { text, length, pos, kind: 0 };
  }

  /** Lines [from, from + count) of the pretty form with `indent`, each cut at `max`. */
  prettyLines(from: number, count: number, indent: string, max: number): HugeLines {
    const st = this.stats();
    if (st[4] * indent.length > MAX_INDENT) throw new Error('Nesting is too deep to format');
    const multi = this.multi;
    const ix = this.index;
    // Lines known: all once read; while reading (or before an error), those before the last checkpoint.
    const total = this.done && !this.error ? st[1] + st[2] + (multi ? 2 : 0) : this.prettyAt(ix.n - 1) + (multi ? 1 : 0);
    const n = Math.max(0, Math.min(count, total - from));
    const text: string[] = [];
    const cut = new Uint8Array(n);
    const length = new Float64Array(n);
    const pos = new Float64Array(n);
    const depth = new Int32Array(n);
    const kind = new Uint8Array(n);
    const close = new Float64Array(n).fill(-1);
    const pads = [''];
    const opened = new Map<number, number>();
    let j = 0;
    while (j < n) {
      const line = from + j;
      if (multi && (line === 0 || line === total - 1)) {
        text.push(line === 0 ? '[' : ']');
        length[j] = 1;
        pos[j] = line === 0 ? 0 : this.src.size - 1;
        kind[j] = line === 0 ? 1 : 2;
        if (line === 0) close[j] = this.done && !this.error ? total - 1 : -1;
        j++;
        continue;
      }
      const l = line - (multi ? 1 : 0);
      const k = this.checkpointOfLine(l);
      const r = this.region(k);
      const a0 = l - this.prettyAt(k);
      if (!r || a0 >= r.lines.length) break;
      for (let a = a0; a < r.lines.length && j < n; a++, j++) {
        const x = this.lineText(r, a, indent, max, pads);
        text.push(x.text);
        cut[j] = x.cut || x.length > max ? 1 : 0;
        length[j] = x.length;
        pos[j] = x.pos;
        kind[j] = x.kind;
        depth[j] = r.depth[a] + (multi ? 1 : 0);
        const node = r.lines[a];
        if (x.kind === 1) {
          opened.set(node + r.k * 0x100000000, j);
          const big = r.stubs.get(startOf(r.tape, node)) ?? ix.bigAt(x.pos);
          if (big) close[j] = big.endNodes + big.endClosers + (multi ? 1 : 0);
        } else if (x.kind === 2) {
          const o = opened.get(-1 - node + r.k * 0x100000000);
          if (o !== undefined) close[o] = from + j;
        }
      }
    }
    return { from, text, cut: cut.subarray(0, j), length: length.subarray(0, j), pos: pos.subarray(0, j), depth: depth.subarray(0, j), kind: kind.subarray(0, j), close: close.subarray(0, j), total };
  }

  /** The closing line of opening pretty line `line`, or -1. */
  prettyClose(line: number): number {
    const one = this.prettyLines(line, 1, '', 16);
    if (!one.text.length || one.kind![0] !== 1) return -1;
    if (one.close![0] >= 0) return one.close![0];
    const multi = this.multi ? 1 : 0;
    const node = this.measure(this.index.state(this.index.at(one.pos[0])), one.depth![0] - multi, one.pos[0], OBJ, null);
    return node.pretty >= 0 && node.prettyLines !== null ? node.pretty + node.prettyLines - 1 : -1;
  }

  // ── Raw lines ─────────────────────────────────────────────────────────

  /** Lines [from, from + count) of the text as stored, each cut at `max` bytes. */
  rawLines(from: number, count: number, max: number): HugeLines {
    const ix = this.index;
    const st = this.stats();
    const total = this.done ? st[9] + 1 : ix.lines[ix.n - 1] + 1;
    const n = Math.max(0, Math.min(count, total - from));
    const text: string[] = [];
    const cut = new Uint8Array(n);
    const length = new Float64Array(n);
    const pos = new Float64Array(n);
    // The first line's start: after the from-th break, counted from the last checkpoint before it.
    let at = 0;
    if (from > 0 && n > 0) {
      const k = Math.max(0, ix.lastAtMost(ix.lines, from - 1));
      at = afterBreaks(this.src, ix.pos[k], from - ix.lines[k]);
    }
    let j = 0;
    if (at >= 0) {
      for (; j < n; ) {
        const lineEnd = this.lineEnd(from + j, at);
        const len = lineEnd - at;
        text.push(textOf(this.src, at, Math.min(len, max)));
        cut[j] = len > max ? 1 : 0;
        length[j] = len;
        pos[j] = at;
        j++;
        if (lineEnd >= this.src.size) break;
        at = afterBreaks(this.src, lineEnd, 1);
      }
    }
    return { from, text, cut: cut.subarray(0, j), length: length.subarray(0, j), pos: pos.subarray(0, j), total };
  }

  /** Where line `line` (starting at byte `at`) ends: at its break, or the end. */
  private lineEnd(line: number, at: number): number {
    const ix = this.index;
    // From the last checkpoint still on this line (a long line is crossed by checkpoints, not read).
    const k = ix.lastAtMost(ix.lines, line);
    let from = k >= 0 && ix.pos[k] > at ? ix.pos[k] : at;
    // (Big strings hold no line break: skipped.)
    for (;;) {
      const g = ix.bigFrom(from);
      const big = g < ix.bigCount ? ix.big(g) : null;
      const until = big && big.kind === STR ? big.start : this.src.size;
      const b = nextBreak(this.src, from, until);
      if (b >= 0) return b;
      if (until >= this.src.size) return this.src.size;
      from = big!.end;
    }
  }

  // ── Locating ──────────────────────────────────────────────────────────

  /** The path of the container open at depth `d` in state `s` (JSON Lines: from its record). */
  private framePath(s: State, d: number): Seg[] {
    const path: Seg[] = this.multi ? [s.top - 1] : [];
    for (let j = 0; j < d; j++) {
      const f = s.frames[j];
      path.push(f.kind === OBJ ? nameAt(this.src, f.key) : f.count - 1);
    }
    return path;
  }

  /** The container open at depth `d` at region `r`'s start, as a location. */
  private frameLocation(r: Region, d: number): HugeLocation {
    const s = r.s;
    const f = s.frames[d];
    const path = this.framePath(s, d);
    const key = d === 0 ? null : path[path.length - 1];
    const node = this.measure(s, d, f.start, f.kind, this.multi && d === 0 ? path[0] : key);
    let parent: HugeNode | null = null;
    if (d > 0) {
      const g = s.frames[d - 1];
      parent = this.measure(s, d - 1, g.start, g.kind, d - 1 === 0 ? (this.multi ? s.top - 1 : null) : this.framePath(s, d - 1).pop()!);
    } else if (this.multi) parent = this.list();
    const index = d === 0 ? (this.multi ? s.top - 1 : 0) : s.frames[d - 1].count - 1;
    return { path, node, parent, index, ...lineCol(this.src, this.index, f.start) };
  }

  /** Pretty line of node `i` of region `r`. */
  private lineOf(r: Region, i: number): number {
    const lines = r.lines;
    for (let a = 0; a < lines.length; a++) if (lines[a] === i) return this.prettyAt(r.k) + a + (this.multi ? 1 : 0);
    return -1;
  }

  /** Node `i` of region `r` as a HugeNode (one open at the region's end measured to its closing bracket). */
  private regionNode(r: Region, i: number, depth: number, key: Seg | null): HugeNode {
    const t = r.tape;
    if (kindOf(t, i) >= ARR && endOf(t, i) > r.end && !r.stubs.has(startOf(t, i))) return this.measure(r.s, depth, byteOf(r, startOf(t, i)), kindOf(t, i), key);
    return this.nodeIn(r, t, i, depth, key, this.lineOf(r, i));
  }

  /** The value at byte `pos`: the deepest whose text holds it (a property name: its value), with its path. */
  locate(pos: Bytes): HugeLocation | null {
    const ix = this.index;
    if (pos < 0 || pos >= this.src.size) return null;
    let k = ix.at(pos);
    // (Right after a value, at the comma or bracket where a checkpoint is: the value is the region before's.)
    if (k > 0 && ix.pos[k] === pos && ix.st[k] === S_AFTER) {
      const c = this.src.read(pos - 1, 1)[0];
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) k--;
    }
    const r = this.region(k);
    if (!r) return null;
    const t = r.tape;
    const off = offsetOf(r, pos, this.src);
    if (off < 0) return null;
    const i = nodeAtOffset(t, off, r.text);
    const base = r.wrap ? 1 : 0;
    const nf = r.s.frames.length;
    const multi = this.multi;
    if (i < r.synth) {
      // Between values of a container open at the region's start: that container (or the top level).
      if (i >= base && i < base + nf) return this.frameLocation(r, i - base);
      if (nf > 0 && i === r.synth - 1 && r.s.state === S_AFTER) return this.frameLocation(r, nf - 1);
      return multi ? { path: [], node: this.list(), parent: null, index: 0, line: 1, col: 1 } : null;
    }
    // Up to the first node whose container is one of the synthetic ones.
    const chain: number[] = [];
    for (let c = i; c >= r.synth; c = parentOf(t, c)) chain.push(c);
    chain.reverse();
    const p0 = parentOf(t, chain[0]);
    let path: Seg[];
    let index0: number;
    let parent0: () => HugeNode | null;
    if (p0 >= base && p0 < base + nf) {
      const d = p0 - base;
      const f = r.s.frames[d];
      index0 = f.count - 1 + localIndex(t, chain[0]);
      path = this.framePath(r.s, d);
      path.push(f.kind === OBJ ? (keyOf(t, chain[0]) as string) : index0);
      parent0 = () => this.frameLocation(r, d).node;
    } else if (r.wrap && p0 === 0) {
      const before = nf > 0 || r.s.state === S_TOP ? 1 : 0;
      index0 = r.s.top - before + localIndex(t, chain[0]);
      path = multi ? [index0] : [];
      parent0 = () => (multi ? this.list() : null);
    } else return null;
    for (let j = 1; j < chain.length; j++) {
      const c = chain[j];
      path.push(keyKindOf(t, c) === KEY_NAME ? (keyOf(t, c) as string) : localIndex(t, c));
    }
    const depth = path.length - (multi ? 1 : 0);
    const node = this.regionNode(r, i, depth, chain.length === 1 && !multi && p0 === 0 ? null : path[path.length - 1] ?? null);
    let parent: HugeNode | null;
    let index: number;
    if (chain.length > 1) {
      const p = parentOf(t, i);
      parent = this.regionNode(r, p, depth - 1, chain.length === 2 ? (path.length >= 2 ? path[path.length - 2] : null) : path[path.length - 2]);
      index = localIndex(t, i);
    } else {
      parent = parent0();
      index = index0;
    }
    return { path, node, parent, index, ...lineCol(this.src, ix, node.start) };
  }

  // ── Paths ─────────────────────────────────────────────────────────────

  /** The value at `path` (path.ts resolve's rules: an object's first member with that name), or null. */
  resolve(path: Seg[]): HugeLocation | null {
    let node = this.root();
    if (!node) return null;
    for (const seg of path) {
      if (node.kind < ARR) return null;
      let next: HugeNode | undefined;
      if (node.kind === OBJ) {
        const key = String(seg);
        for (let from = 0; !next; ) {
          const page = this.pageOf(node, from, 1000);
          if (!page) return null;
          next = page.nodes.find((n) => n.key === key);
          if (!page.page.more || !page.page.count) break;
          from += page.page.count;
        }
      } else {
        if (typeof seg !== 'number' && !/^\d+$/.test(seg)) return null;
        next = this.pageOf(node, Number(seg), 1)?.nodes[0];
      }
      if (!next) return null;
      node = next;
    }
    return node.kind === LIST ? { path: [], node, parent: null, index: 0, line: 1, col: 1 } : this.locate(node.start);
  }

  // ── Text ──────────────────────────────────────────────────────────────

  text(start: Bytes, end: Bytes, max: number): { text: string; cut: boolean } {
    const stop = Math.min(end, this.src.size);
    const e = Math.min(stop, start + max);
    return { text: textOf(this.src, start, e - start), cut: e < stop };
  }

  // ── Find ──────────────────────────────────────────────────────────────

  /** Finds `query` (its UTF-8 bytes): batches of matches as the search goes, the last `done`. */
  *find(query: string, o: FindOptions): Generator<FindBatch, void, void> {
    const needle = new TextEncoder().encode(query);
    const len = needle.length;
    const size = this.src.size;
    if (!len || len > size) {
      yield { matches: new Float64Array(0), length: len, scanned: size, done: true };
      return;
    }
    const cs = !!o.caseSensitive || !/[A-Za-z]/.test(query);
    const lower = cs ? needle : needle.map((c) => (c >= 65 && c <= 90 ? c + 32 : c));
    const limit = o.limit ?? 10_000;
    const chunk = 1 << 22;
    let total = 0;
    let scanned = 0;
    const back = !!o.backward;
    const start = Math.max(0, Math.min(size, o.from ?? (back ? size : 0)));
    // From `start` to the end (backward: the start), then the rest, wrapping round.
    const spans: [number, number][] = back ? [[0, start], [start, size]] : [[start, size], [0, start]];
    const first = lower[0];
    const firstU = cs || first < 97 || first > 122 ? first : first - 32;
    for (const [a, b] of spans) {
      if (back) {
        for (let hi = b; hi > a && total < limit; ) {
          const lo = Math.max(a, hi - chunk);
          const buf = this.src.read(lo, Math.min(hi + len - 1, size) - lo);
          const ms: number[] = [];
          scanWindow(buf, lower, cs, first, firstU, hi - lo, (i) => ms.push(lo + i));
          const found: number[] = [];
          for (let m = ms.length - 1; m >= 0 && total < limit; m--, total++) found.push(ms[m]);
          scanned += hi - lo;
          hi = lo;
          if (found.length) yield { matches: Float64Array.from(found), length: len, scanned, done: false };
        }
      } else {
        for (let lo = a; lo < b && total < limit; ) {
          const hi = Math.min(b, lo + chunk);
          const buf = this.src.read(lo, Math.min(hi + len - 1, size) - lo);
          const found: number[] = [];
          scanWindow(buf, lower, cs, first, firstU, hi - lo, (i) => {
            if (total < limit) {
              found.push(lo + i);
              total++;
            }
          });
          scanned += hi - lo;
          lo = hi;
          if (found.length) yield { matches: Float64Array.from(found), length: len, scanned, done: false };
        }
      }
    }
    yield { matches: new Float64Array(0), length: len, scanned: size, done: true };
  }
}

/** Calls `hit(i)` for each match of `needle` (lowercase unless `cs`) starting at i < `n` in `buf`. */
function scanWindow(buf: Uint8Array, needle: Uint8Array, cs: boolean, first: number, firstU: number, n: number, hit: (i: number) => void) {
  const len = needle.length;
  const max = Math.min(n, buf.length - len + 1);
  const verify = (i: number) => {
    for (let j = 1; j < len; j++) {
      let c = buf[i + j];
      if (!cs && c >= 65 && c <= 90) c += 32;
      if (c !== needle[j]) return false;
    }
    return true;
  };
  if (cs || first === firstU) {
    for (let i = buf.indexOf(first); i >= 0 && i < max; i = buf.indexOf(first, i + 1)) if (verify(i)) hit(i);
    return;
  }
  // (Either case of the first letter: two searches, merged.)
  let a = buf.indexOf(first);
  let b = buf.indexOf(firstU);
  while ((a >= 0 && a < max) || (b >= 0 && b < max)) {
    let i: number;
    if (b < 0 || (a >= 0 && a < b)) {
      i = a;
      a = buf.indexOf(first, a + 1);
    } else {
      i = b;
      b = buf.indexOf(firstU, b + 1);
    }
    if (i < max && verify(i)) hit(i);
  }
}

// ── Texts made of the document's bytes ─────────────────────────────────

interface Built {
  text: string;
  /** [offset in text, byte (-1: added text), bytes] at the start of each piece. */
  map: Float64Array;
  /** Offsets in text of the strings standing for big values (stubs), with their records. */
  stubs: Map<number, Big>;
  /** Per piece, null if ASCII (a unit a byte), else bytes at every STRIDE units of it (made when first asked). */
  wide: (Float64Array | null | undefined)[];
}

/** UTF-16 units between the byte offsets a wide piece keeps. */
const STRIDE = 256;

type Piece = string | [number, number] | Big;

/** A text of pieces: byte ranges of `src` (decoded as the page decodes a file), strings, and stubs for big values. */
function build(src: ByteSource, pieces: Piece[]): Built {
  const parts: string[] = [];
  const map: number[] = [];
  const stubs = new Map<number, Big>();
  let at = 0;
  for (const p of pieces) {
    let s: string;
    if (typeof p === 'string') {
      s = p;
      if (s) map.push(at, -1, 0);
    } else if (Array.isArray(p)) {
      s = textOf(src, p[0], p[1] - p[0]);
      if (s) map.push(at, p[0], p[1] - p[0]);
    } else {
      s = stubText(p.kind);
      stubs.set(at, p);
      map.push(at, -1, 0);
    }
    parts.push(s);
    at += s.length;
  }
  return { text: parts.join(''), map: Float64Array.from(map), stubs, wide: [] };
}

/** The document byte of offset `off` of a built text (-1 in added text; a stub: its value's start). */
function byteOf(b: Built, off: number): number {
  const stub = b.stubs.get(off);
  if (stub) return stub.start;
  const m = b.map;
  let lo = 0;
  let hi = m.length / 3 - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (m[mid * 3] <= off) lo = mid;
    else hi = mid - 1;
  }
  let byte = m[lo * 3 + 1];
  // (The end of a piece of the document where added text starts: the piece's end.)
  if (byte < 0 && lo > 0 && m[lo * 3] === off && m[lo * 3 - 2] >= 0) {
    lo--;
    byte = m[lo * 3 + 1];
  }
  if (byte < 0) return -1;
  const at = m[lo * 3];
  let wide = b.wide[lo];
  if (wide === undefined) {
    // (Made once per piece: ASCII is a byte a unit; else the bytes at every STRIDE units.)
    const end = lo + 1 < m.length / 3 ? m[lo * 3 + 3] : b.text.length;
    wide = /[^\0-\x7f]/.test(b.text.slice(at, end)) ? strides(b.text, at, end) : null;
    b.wide[lo] = wide;
  }
  if (!wide) return byte + off - at;
  const k = Math.floor((off - at) / STRIDE);
  return byte + wide[k] + utf8Bytes(b.text, at + k * STRIDE, off);
}

/** Bytes before every STRIDE units of text[a, e). */
function strides(text: string, a: number, e: number): Float64Array {
  const out = new Float64Array(Math.floor((e - a) / STRIDE) + 1);
  for (let k = 1; k < out.length; k++) out[k] = out[k - 1] + utf8Bytes(text, a + (k - 1) * STRIDE, a + k * STRIDE);
  return out;
}

/** The offset in a built text of document byte `pos`: in a piece, or in the stub standing for the big value holding it (-1: neither). */
function offsetOf(b: Built, pos: number, src: ByteSource): number {
  const m = b.map;
  for (let j = 0; j < m.length; j += 3) {
    const byte = m[j + 1];
    if (byte >= 0 && pos >= byte && pos < byte + m[j + 2]) return m[j] + units(src.read(byte, pos - byte));
  }
  for (const [at, big] of b.stubs) if (pos >= big.start && pos <= big.end) return pos === big.end ? at + 2 : at + 1;
  // (At the very end of a piece.)
  for (let j = 0; j < m.length; j += 3) if (m[j + 1] >= 0 && pos === m[j + 1] + m[j + 2]) return m[j] + units(src.read(m[j + 1], m[j + 2]));
  return -1;
}

/** UTF-16 units of UTF-8 bytes (as decoded: a \r\n is two). */
function units(b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) n++;
    else if (c >= 0xc0) n += c >= 0xf0 ? 2 : 1;
  }
  return n;
}

/** UTF-8 bytes of `s[a, e)`. */
function utf8Bytes(s: string, a: number, e: number): number {
  let n = e - a;
  for (let i = a; i < e; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < e && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 2;
      i++;
    } else n += 2;
  }
  return n;
}

/** The end of [at, end) of `src` without the whitespace and the one comma before `end`. */
function trimEnd(src: ByteSource, at: number, end: number): number {
  const from = Math.max(at, end - 4096);
  const b = src.read(from, end - from);
  let i = b.length;
  let comma = false;
  while (i > 0) {
    const c = b[i - 1];
    if (c === 32 || c === 9 || c === 10 || c === 13) i--;
    else if (c === 44 && !comma) {
      comma = true;
      i--;
    } else break;
  }
  return from + i;
}

/** `c`'s place among its parent's children. */
function localIndex(t: Tape, c: number): number {
  const p = parentOf(t, c);
  let k = 0;
  for (let x = p + 1; x < c; x = nextOf(t, x)) k++;
  return k;
}

/** Whether the string token text[a, e) is written as JSON.stringify writes it (pretty.ts plain). */
function plainToken(s: string, a: number, e: number): boolean {
  if (e - a < 2 || s.charCodeAt(a) !== 34 || s.charCodeAt(e - 1) !== 34) return false;
  for (let i = a + 1; i < e - 1; i++) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      const x = s.charCodeAt(++i);
      if (i >= e - 1 || !(x === 34 || x === 92 || x === 98 || x === 102 || x === 110 || x === 114 || x === 116)) return false;
      continue;
    }
    if (c < 0x20 || c === 34) return false;
    if (c >= 0xd800 && c <= 0xdfff) {
      if (c >= 0xdc00 || i + 1 >= e - 1) return false;
      const d = s.charCodeAt(i + 1);
      if (d < 0xdc00 || d > 0xdfff) return false;
      i++;
    }
  }
  return true;
}

/** A tape ready to post (tape-send.ts sendable, without loading it here). */
function sendTape(t: Tape): SentTape {
  const strs = t.extra ? t.keys.concat([...t.extra.values()]) : t.keys;
  let length = 0;
  for (const s of strs) length += s.length;
  const text = new Uint16Array(length);
  const offsets = new Int32Array(strs.length + 1);
  let at = 0;
  for (let k = 0; k < strs.length; k++) {
    offsets[k] = at;
    const s = strs[k];
    for (let j = 0; j < s.length; j++) text[at++] = s.charCodeAt(j);
  }
  offsets[strs.length] = at;
  const extraAt = new Int32Array(t.extra ? [...t.extra.keys()] : []);
  return { nodes: t.nodes.slice(0, t.count * W), count: t.count, text, offsets, keyCount: t.keys.length, extraAt, big: t.big ? [...t.big] : [], head: t.head };
}

function emptySent(): SentTape {
  return { nodes: new Int32Array(0), count: 0, text: new Uint16Array(0), offsets: new Int32Array(1), keyCount: 0, extraAt: new Int32Array(0), big: [], head: { issues: [], warnings: [], error: null, nodes: 0, depth: 0, exact: true, multi: false } };
}

