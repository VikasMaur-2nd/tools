/**
 * A huge document in the worker: its index, built a window at a time (step), and every query of API.md
 * answered from it. Each query starts at a checkpoint, seeks with the skeleton (a second instance: the index
 * may still be growing) and parses at most about a MiB in full, with the normal path's parsers (tape.wasm, or
 * the JS tape parser), on a text made of the document's bytes and a few brackets (see `region`, `pageOf`).
 */
import { decodeString } from '../json/decode';
import { clip, keyLabel, MAX_INDENT, primText, quote } from '../json/format';
import { lazyResult } from '../json/lazy';
import { MAX_DEPTH } from '../json/parser';
import { childCount, endOf, KEY_INDEX, KEY_NAME, keyKindOf, keyOf, kindOf, nextOf, nodeAtOffset, parentOf, receiver, sizeOf, startOf, valueKindOf, valueOf, VALUE_DECODE, VALUE_FALSE, VALUE_SLICE, W, type SentTape, type Tape } from '../json/tape';
import { wasmTape, type ByteSource } from '../json/tape-wasm';
import { CachedSource, afterBreaks, content, nextBreak, textOf } from './bytes';
import { byteBefore, duplicates, exactError, lineCol, nameAt, prefixOf, type Parse, type Problem } from './errors';
import { HugeIndex, type Big } from './index';
import { lengthOf, Pieces, type Piece as EditPiece } from './pieces';
import { Tail } from './tail';
import { utf16Units, utf8At, utf8Table } from './utf8';
import { Wait } from './wait';
import { DONE, DW, FAIL, FRONT, FW, NEED, S_AFTER, S_COLON, S_TOP, S_VALUE, STOP, Skeleton, W_AFTER, W_CHILD, W_CLOSE, W_MEMORY, type State } from './skeleton';
import { ARR, BOOL, LIST, NUL, NUM, OBJ, STR, type Bytes, type FindBatch, type FindOptions, type HugeError, type HugeLines, type HugeLocation, type HugeNode, type HugeOptions, type HugePage, type HugeProblem, type HugeProgress, type HugeStatus, type HugeSummary, type Seg } from './types';

/** The parsers queries use: tape.wasm's module (null without WebAssembly) and the JS tape parser. */
export interface Parsers {
  wasm: WebAssembly.Module | null;
  parse: Parse;
}

const LINES_FILE = /\.(jsonl|ndjson)$/i;
/** rules.ts MULTI: the normal path's notice for several top-level values. */
const MULTI = 'Multiple top-level values (wrapped in an array)';
/** A page's text stops at the first child past this many bytes. */
const PAGE_BYTES = 4 << 20;
/** Window of the query skeleton (seeks stop within ~1 MiB: a small window reads less past the stop). */
const QUERY_WINDOW = 1 << 18;
/** Parsed regions kept for the Format view and locate (bytes of text and tape, about). */
const REGION_BUDGET = 64 << 20;
/** Big children of a page given a preview (at most), and the time spent on them (ms). */
const PREVIEWS = 64;
const PREVIEW_MS = 60;
/** Characters of a big string's preview. */
const PREVIEW_CHARS = 1024;
/** An object an edit is in that is at most this big is read again from its start, so its names are all checked again. */
const DUP_SCAN = 1 << 20;
/** The first window when reading again after an edit (it grows: see steps). */
const REREAD_WINDOW = 1 << 16;
/** Bytes read again a millisecond, about (a window no bigger than the time left: HugeDoc.steps). */
const REREAD_PER_MS = 1 << 17;
/** Bytes past an edit read again with checkpoints close together (HugeDoc.dense), for the next keystroke. */
const DENSE_PAST = 1 << 17;
/** Bytes before a failure from which its error is placed (nearFail), when a value ends there. */
const NEAR_FAIL = 2048;
/** Stats of a parse (lib.rs stats()). */
const STATS = 19;

/** One change of an edit: bytes [a, b) of the document (as it is then) replaced by `put`. */
export interface EditOp {
  a: number;
  b: number;
  put: readonly EditPiece[];
}
/** What a big string shows of itself in a pretty line (bytes). */
const PREVIEW = 1 << 12;

const stubText = (kind: number) => (kind === OBJ ? '{}' : kind === ARR ? '[]' : '""');

/** The token a window cut (lib.rs P_*). */
const P_STR = 1;
const P_KEY = 2;
const P_SCALAR = 3;

/**
 * Where reading has got to while the document isn't all read (indexing, stopped, or broken): queries read no
 * further than `pos`, and `s` (the indexer's state there: its open containers and their children so far) says
 * what is still open. `part`/`partStart`: a token cut there (a string, name or number being read).
 */
interface Front {
  pos: number;
  s: State;
  part: number;
  partStart: number;
}

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
  /** A stretch ending near the front: where the front was when it was made. */
  front?: number;
}

export class HugeDoc {
  /** The document: the file's bytes (after a byte order mark) with the edits (pieces.ts). */
  readonly src: Pieces;
  readonly bom: number;
  readonly index = new HugeIndex();
  done = false;
  /** Indexing was stopped: what's read stays browsable. */
  stopped = false;
  error: HugeError | null = null;
  /** Where reading has got to (null: all read). */
  private front: Front | null = null;
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
  /** Time big children's previews may take in a page (ms): tests make it unbounded, so a page is the same however busy the machine is. */
  private previewMs: number;

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
    tune: { window?: number; queryWindow?: number; pageBytes?: number; previewMs?: number; index?: ByteSource & { has(at: number, len: number): boolean } } = {},
  ) {
    this.queryWindow = tune.queryWindow ?? QUERY_WINDOW;
    this.previewMs = tune.previewMs ?? PREVIEW_MS;
    this.pageBytes = tune.pageBytes ?? PAGE_BYTES;
    const c = content(file);
    // (A source that keeps its own blocks (bytes.ts BlockSource) isn't cached again.)
    this.src = new Pieces((file as { cached?: boolean }).cached ? c.src : new CachedSource(c.src));
    this.bom = c.bom;
    this.lines = LINES_FILE.test(options.name ?? '');
    this.big = options.big ?? 1 << 18;
    this.ix = new Skeleton(huge);
    this.q = new Skeleton(huge);
    this.front = { pos: 0, s: this.index.state(0), part: 0, partStart: -1 };
    if (c.utf16) {
      this.utf16 = true;
      this.final = new Float64Array(STATS);
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
    this.every = options.every ?? 1 << 20;
    this.everyNow = this.every;
    this.dense = Math.max(64, Math.min(this.every, this.every >> 6));
    if (!this.ix.start(indexSrc, { window: tune.window, every: this.every, big: this.big, dups: options.dups ?? true, maxDepth: MAX_DEPTH, lines: this.lines })) {
      this.final = new Float64Array(STATS);
      this.done = true;
      this.error = { msg: 'Not enough memory to parse this document', line: 1, col: 1, pos: 0, kind: 'error' };
    }
  }

  /**
   * The document was saved to `file` (in place): it reads that from now on, nothing edited. Its index is the
   * same (the file is the document, byte for byte, with the same byte order mark).
   */
  rebase(file: ByteSource) {
    const c = content(file);
    this.src.rebase((file as { cached?: boolean }).cached ? c.src : new CachedSource(c.src));
    this.regions.clear();
    this.regionBytes = 0;
  }

  /** Bytes of the file the document would be (with its byte order mark). */
  get size(): number {
    return this.src.size + this.bom;
  }

  private utf16 = false;
  /** Values of this many bytes or more are in the directory. */
  private readonly big: number;

  // ── Indexing ──────────────────────────────────────────────────────────

  /** Reads windows until `until` (a performance.now() value) or the end: true once the whole document is read. */
  step(until: number): boolean {
    if (this.stopped) return true;
    try {
      return this.steps(until);
    } finally {
      this.moved();
    }
  }

  /** Where reading has got to, after a step. */
  private moved() {
    if (this.done && !this.error) {
      this.front = null;
      return;
    }
    const st = this.stats();
    const s = this.ix.snapshot();
    // (Broken: what's read is what comes before both where the skeleton stopped and where the error is.)
    const pos = this.failed ? this.failed.at : this.error ? Math.min(this.error.pos, this.failedAt >= 0 ? this.failedAt : this.error.pos) : this.ix.pos;
    this.front = { pos, s, part: st[12], partStart: st[13] };
  }

  /** Whether the error is the parser's fatal error itself (the normal path's status puts it before an issue at the same place). */
  private errorSelf = false;

  /** The error, kept without what only the status needs. */
  private problem(p: Problem): HugeError {
    this.errorSelf = !!p.self;
    this.errorMulti = !!p.multi;
    const { self: _self, multi: _multi, ...e } = p;
    void _self;
    void _multi;
    return e;
  }

  /** Whether the parse that placed the error noted several top-level values at the same place. */
  private errorMulti = false;

  /** Stops indexing where it is: what's read stays browsable (`done` stays false). */
  stop() {
    if (this.done || this.edited) return;
    this.stopped = true;
  }

  /** Where the skeleton failed (-1: it didn't), and the line breaks before it. */
  private failedAt = -1;
  private failLines = 0;

  /** Line breaks read (to where the parse failed, if it did). */
  private breaks(st: Float64Array): number {
    return this.done && this.failedAt >= 0 ? this.failLines : st[9];
  }

  /** The skeleton failed: where, why, and its place there (the error is made from it, maybe after a Wait). */
  private failed: { at: number; why: number; anchor: [number, number, number]; outer: number } | null = null;
  /** Where the outermost container open at the failure starts (-1: none, at the top level), for secondValue. */
  private failOuter = -1;

  /**
   * Work owed to the next step (so a step that needs blocks not read yet throws its Wait with nothing half done,
   * and runs again): reading again (an edit, or past a re-sync), finishing (the end facts).
   */
  private pendingRead = false;
  private pendingFinish = false;

  private steps(until: number): boolean {
    while (!this.done) {
      if (this.pendingFinish) {
        this.finish();
        continue;
      }
      if (this.pendingRead) {
        this.readAgain();
        this.pendingRead = false;
        continue;
      }
      if (this.failed) {
        this.fail();
        continue;
      }
      // (Not read yet: the caller reads ahead (indexAt) and steps again.)
      if (this.indexHas && !this.indexHas(this.ix.pos, Math.min(this.ix.window, this.src.size - this.ix.pos))) return false;
      // (Stopped in its window at an old checkpoint that wasn't the same: on in that window. Reading again: a window
      // up to just past where it may re-sync (no more read than needed), else from small ones twice as big each time.)
      let win: number | undefined;
      if (this.edited && !this.resumeIx) {
        const to = this.cand >= 0 ? this.tail!.ix.pos[this.cand] : -1;
        // (Whole 64-byte blocks: a window that doesn't end the document carries stage 1's state at a block's end.)
        // (Never more than the window it was made with.)
        win = Math.min(this.ix.window, to > this.ix.pos ? Math.max(REREAD_WINDOW, (to - this.ix.pos + 4096 + 63) & ~63) : this.rewin);
        this.rewin = Math.min(this.ix.window, this.rewin * 2);
        // (No more than there's time for before `until`: a keystroke's is short, and a window can't be stopped.)
        if (until < Infinity) win = Math.min(win, Math.max(REREAD_WINDOW, Math.floor((until - performance.now()) * REREAD_PER_MS) & ~63));
      }
      // (Checkpoints close together near the last edit, as opened past it.)
      const every = this.edited && this.ix.pos < this.denseUntil ? this.dense : this.every;
      if (every !== this.everyNow) {
        this.ix.every(every);
        this.everyNow = every;
      }
      const r = this.resumeIx ? this.ix.resume() : this.ix.step(win);
      this.resumeIx = false;
      const out = this.ix.drain();
      this.index.addCheckpoints(out.ck);
      this.index.addBig(out.dir);
      for (const v of out.warn) this.pairs.push(v);
      if (this.edited) this.readUpTo = r === FAIL ? this.ix.failPos : r === STOP ? this.ix.snapshot().pos : this.ix.pos;
      if (r === NEED) {
        if (performance.now() >= until) return false;
        continue;
      }
      if (r === STOP && this.ix.why === W_AFTER) {
        this.trySync();
        continue;
      }
      this.final = this.ix.stats();
      if (r === FAIL) {
        this.failed = { at: this.ix.failPos, why: this.ix.why, anchor: this.ix.failAt, outer: this.ix.snapshot().frames[0]?.start ?? -1 };
        if (this.edited) this.keepPairs(this.failed.at);
        continue;
      }
      // (Read to the end: the old index past here is of no use, but for the pairs the indexer couldn't find again.)
      if (this.edited) this.keepPairs(Infinity);
      this.tail = null;
      this.pendingFinish = true;
    }
    return true;
  }

  /** The error where the skeleton failed (the JS parser places it: it may throw a Wait, then this runs again). */
  private fail() {
    const { at, why, anchor, outer } = this.failed!;
    this.failedAt = at;
    this.failOuter = outer;
    // (Lines as stored up to where the parse failed: how far a parse runs past it depends on its windows. The
    // skeleton's count there, when it has one.)
    this.failLines = why !== W_MEMORY && anchor[1] >= 0 ? anchor[1] : lineCol(this.src, this.index, at).line - 1;
    const second = this.edited ? this.secondValue() : this.final![14];
    this.error =
      why === W_MEMORY
        ? { msg: 'Not enough memory to parse this document', ...lineCol(this.src, this.index, at), pos: at, kind: 'error' }
        : // (A second top-level value begun before: the normal path reads them all as JSON Lines then.)
          this.problem(exactError(this.src, this.index, at, anchor, this.parsers.parse, this.lines || (second >= 0 && second < at), this.nearFail(at)));
    this.failed = null;
    this.pendingFinish = true;
  }

  /**
   * A state shortly before the failure at `at` to place the error from (the JS parser then reads a few KiB, not a
   * megabyte or two: typing makes many errors): after the first value that ends NEAR_FAIL bytes or less before it,
   * as a checkpoint is (after a value), inside a container. Not right after a string that ends next to the failure
   * (repairing, the JS parser may read that string again: `"a" b`); null then, or if none: from the checkpoint
   * before, as ever.
   */
  private nearFail(at: number): State | null {
    const k = this.index.at(at);
    if (k < 0) return null;
    const q = this.at(this.index.state(k));
    q.limit = at + 1;
    q.target(-1);
    q.stopAfter(Math.max(this.index.pos[k], at - NEAR_FAIL));
    if (q.go() !== STOP || q.why !== W_AFTER) return null;
    const s = q.snapshot();
    // (Inside a container: at the top level, what follows a value depends on what went before, which a stand-in
    // for it doesn't carry: "Text after the JSON value was ignored", several values.)
    if (s.pos >= at || !s.frames.length) return null;
    if (byteBefore(this.src, s.pos) === 34) {
      // (Another value ends before the failure: this string isn't next to it.)
      q.stopAfter(s.pos + 1);
      if (q.go() !== STOP || q.why !== W_AFTER || q.snapshot().pos >= at) return null;
    }
    return s;
  }

  private finish() {
    // (The end facts first: they may need blocks (a Wait), and then this runs again.)
    if (this.edited) this.endFacts();
    this.done = true;
    this.pendingFinish = false;
    this.ms = performance.now() - this.t0;
    // (Regions parsed while reading may end where the document did then.)
    this.regions.clear();
    this.regionBytes = 0;
  }

  /** The file byte the indexing pass reads next (for a read-ahead source), and how many it reads at a time; null once edited (it reads the document then). */
  get indexAt(): [number, number] | null {
    return this.edited ? null : [this.ix.pos + this.bom, this.ix.window];
  }

  private stats(): Float64Array {
    return this.final ?? this.ix.stats();
  }

  progress(): HugeProgress {
    const st = this.stats();
    return { bytes: this.front ? this.front.pos : this.src.size, size: this.src.size, nodes: st[1], records: st[3], lines: st[9], ms: performance.now() - this.t0 };
  }

  /** The top-level values are viewed as an array of them: several, or JSON Lines by name (the normal path wraps those even when one). */
  private get multi(): boolean {
    // (Reading again after an edit: as many as there were, until it's known.)
    const n = this.done ? this.stats()[3] : Math.max(this.stats()[3], this.edited ? this.topHint : 0);
    return n > 1 || (this.lines && n > 0);
  }

  summary(): HugeSummary {
    const st = this.stats();
    const records = st[3];
    const multi = this.multi;
    // Duplicate names, confirmed and placed as they come (the first 500: the rest only counted as more).
    if (this.checked < this.pairs.length && this.warnings.length < 500) {
      const upTo = Math.min(this.pairs.length, this.checked + 2 * (500 - this.warnings.length));
      this.warnings.push(...duplicates(this.src, this.index, this.pairs.slice(this.checked, upTo)));
      this.checked = upTo;
    }
    return {
      size: this.size,
      bom: this.bom,
      done: this.done,
      stopped: this.stopped,
      root: this.root(),
      records,
      multi,
      jsonl: multi && st[7] === 1,
      nodes: st[1],
      depth: st[4],
      lines: this.breaks(st) + 1,
      prettyLines: st[1] + st[2] + (multi ? 2 : 0),
      error: this.error,
      status: this.status(),
      warnings: this.warnings.slice(0, 500),
      moreWarnings: this.warnings.length >= 500,
      unchecked: st[8],
      ms: this.done ? this.ms : performance.now() - this.t0,
      indexBytes: this.index.bytes,
    };
  }

  /**
   * The normal path's status bar (Engine.statusOf / linesStatus) once the document is read: its first problem;
   * for several top-level values in a file not named .jsonl that aren't JSON Lines (rules.ts jsonLines), the
   * notice "Multiple top-level values (wrapped in an array)" at the second value, as the normal path gives it;
   * else valid (with its first duplicate-name warning, JSON Lines records). null while reading.
   */
  private status(): HugeStatus | null {
    if (!this.done) return null;
    const st = this.stats();
    const e = this.error;
    const records = st[3];
    const second = st[14];
    const blank = { msg: null, line: 0, col: 0, pos: 0, warnings: 0, more: false, jsonl: null };
    void records;
    const notice = !this.lines && second >= 0 && !(st[7] === 1 && !e && records > 1);
    // (At the same place as the first problem: the notice comes first, unless that is the fatal error itself.)
    if (notice && (!e || second < e.pos || (second === e.pos && this.errorMulti && !this.errorSelf))) {
      // (Its first issue, before any error: an error later makes the status an error, with this message.)
      return { ...blank, kind: e && e.kind === 'error' ? 'error' : 'fixable', msg: MULTI, ...lineCol(this.src, this.index, second), pos: second };
    }
    if (e) return { ...blank, kind: e.kind, msg: e.msg, line: e.line, col: e.col, pos: e.pos };
    const w = this.warnings[0];
    const jsonl = this.multi ? records : null;
    return w ? { ...blank, kind: 'valid', msg: w.msg, line: w.line, col: w.col, pos: w.pos, warnings: this.warnings.length, more: this.warnings.length >= 500, jsonl } : { ...blank, kind: 'valid', jsonl };
  }

  /** The LIST of top-level values (its records so far while reading). */
  private list(): HugeNode {
    const st = this.stats();
    const all = !this.front;
    return { kind: LIST, start: 0, end: all ? this.src.size : -1, depth: -1, key: null, count: st[3], ...(!all && { partial: true }), pretty: 0, prettyLines: all ? st[1] + st[2] + 2 : null, big: true };
  }

  /** The front's open container at depth `d` that starts at `start`, as a node (its children so far), or null if it isn't open there. */
  private openNode(d: number, start: number, kind: number, key: Seg | null): HugeNode | null {
    const f = this.front?.s.frames[d];
    if (!f || f.start !== start) return null;
    const multi = this.multi ? 1 : 0;
    return { kind, start, end: -1, depth: d, key, count: f.count, partial: true, pretty: f.nodes + f.closers + multi, prettyLines: null, big: true };
  }

  /** The only top-level value, or the LIST of them. */
  private root(): HugeNode | null {
    // (Before the first value is read: a container from its first byte, so the first rows come at once.)
    if (this.stats()[3] === 0 && (this.done || this.lines)) return null;
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
      // Still being read (its children so far), not read yet, or whole (small: read to its end).
      const open = this.openNode(0, at, kind, null);
      if (open) return open;
      if (this.front && this.front.pos <= at) return { kind, start: at, end: -1, depth: 0, key: null, count: 0, partial: true, pretty: 0, prettyLines: null, big: true };
      return { ...this.measure(ix.state(0), 0, at, kind, null), big: true };
    }
    // A string or scalar: once read (a long string is then in the directory).
    if (this.front) return null;
    const page = this.pageOf(this.list(), 0, 1);
    return page && page.nodes.length ? { ...page.nodes[0], key: null } : null;
  }

  private ofBig(b: Big, key: Seg | null): HugeNode {
    const multi = this.multi ? 1 : 0;
    const lines = b.kind >= ARR && b.count > 0 ? b.endNodes + b.endClosers - (b.nodes + b.closers) + 1 : 1;
    return { kind: b.kind, start: b.start, end: b.end, depth: b.depth, key, count: b.kind >= ARR ? b.count : 0, pretty: b.nodes + b.closers + multi, prettyLines: lines, big: true };
  }

  // ── Edits ─────────────────────────────────────────────────────────────

  /** Old checkpoints past an edit, to re-sync with (tail.ts). */
  private tail: Tail | null = null;
  /** The tail checkpoint the indexer tries to re-sync at next (-1: none: it reads on). */
  private cand = -1;
  /** Open containers that began before this byte (the edit being read again) may have other counts at a re-sync. */
  private syncFrom = Infinity;
  /**
   * An object an edit is in (open where the indexer first stops past the edit's start, `holdAt`): no re-sync
   * while it is open, so its names after the edit are checked against the edit's (if it isn't big: DUP_SCAN).
   */
  private hold: { d: number; start: number } | null = null;
  private holdAt = -1;
  /** The indexer stopped inside its window (a re-sync tried there): it runs on in it. */
  private resumeIx = false;
  /** Window bytes while reading again (from REREAD_WINDOW at each restore, doubling). */
  private rewin = REREAD_WINDOW;
  /**
   * Bytes between checkpoints: as opened, and `dense` while reading again from before the last edit to DENSE_PAST
   * after it (`denseUntil`), so the next keystroke there reads again from a few KiB before it to a few KiB after
   * (typing in the Format view: a few dozen more checkpoints a place); `everyNow`: the indexer's now.
   */
  private every = 1 << 20;
  private dense = 1 << 14;
  private everyNow = 1 << 20;
  private denseUntil = -1;
  /** Where the indexer last started reading again, and its live checkpoint then; how far it has read since its tail was made. */
  private readStart = 0;
  private readUpTo = -1;
  private restartK = 0;
  /** Edited: whole-document facts come from the index then (endFacts). */
  private edited = false;
  /** Names the duplicate check skipped in the indexer's runs before its current one (opening, then each reading again). */
  private skipped = 0;
  /** Where the second top-level value starts (-1: none; -2: to be found again since an edit). */
  private second = -2;
  /** Top-level values before the edit (the view stays a list while they're read again). */
  private topHint = 0;

  /** Whether the document can be edited now: all read (valid or not), or being read again after an edit. */
  get editable(): boolean {
    return !this.utf16 && !this.stopped && (this.done || this.edited);
  }

  /**
   * Applies `ops` in order (each replaces bytes [a, b) of the document as it is then by its pieces), then reads
   * again from before the first change until the index is the document's (re-synced with the old one) or `until`
   * (a performance.now() value); indexing then goes on in steps (step()), as while opening. Returns per op the
   * pieces it took out (putting them back undoes it), and whether the document is all read again.
   */
  edit(ops: readonly EditOp[], until = Infinity): { removed: EditPiece[][]; done: boolean } {
    if (!this.editable) throw new Error('Not ready');
    for (const o of ops) if (!(o.a >= 0 && o.a <= o.b)) throw new RangeError('Out of range');
    let cut = false;
    const removed: EditPiece[][] = [];
    for (const o of ops) {
      if (o.b > this.src.size) throw new RangeError('Out of range');
      cut = this.apply(o.a, o.b, o.put) || cut;
      removed.push(this.src.splice(o.a, o.b, o.put));
      this.tail?.replaced(o.a, o.b, lengthOf(o.put));
      this.denseUntil = o.a + lengthOf(o.put) + DENSE_PAST;
    }
    if (cut) {
      // (Read again from the next step: nothing past the index's new end is read meanwhile.)
      this.unread();
      this.pendingRead = true;
    } else if (this.cand >= 0) {
      // (Ahead of the indexer: the same candidate, unless it died.)
      this.cand = this.nextCand(-Infinity, this.cand - 1);
      this.aim();
    }
    this.regions.clear();
    this.regionBytes = 0;
    // (The changes are made: a step that waits for blocks is the caller's to go on with (step()), never this again.)
    let done = false;
    try {
      done = this.step(until);
    } catch (e) {
      if (!(e instanceof Wait)) throw e;
    }
    return { removed, done };
  }

  /** Not all read any more (from the index's last live checkpoint on): the document's facts, error and end to be found again. */
  private unread() {
    this.done = false;
    this.pendingFinish = false;
    this.final = null;
    this.error = null;
    this.failed = null;
    this.failedAt = -1;
    this.errorSelf = false;
    this.errorMulti = false;
    const live = this.index;
    this.front = { pos: live.pos[live.n - 1], s: live.state(live.n - 1), part: 0, partStart: -1 };
  }

  /** The index before change [a, b): whether it was cut back (so the indexer reads again from its new end). */
  private apply(a: number, b: number, put: readonly EditPiece[]): boolean {
    void b;
    if (!this.edited) {
      this.edited = true;
      const f = this.final ?? this.ix.stats();
      this.second = f[14];
      this.topHint = f[3];
      this.indexHas = null;
      this.ix.use(this.src);
    }
    void put;
    if (this.second === -1 || a <= this.second) this.second = -2;
    // (Past what the indexer has read: only the tail moves.)
    if (!this.done && a >= this.ix.pos) return false;
    // (An old tail's counts are older than the live checkpoints moved in front of it: marked apart.)
    this.cut(this.index.at(a - 1), this.tail !== null);
    return true;
  }

  /** The outermost object open at live checkpoint `k` that isn't bigger than DUP_SCAN: the live checkpoint before it, its depth, start and container's start. */
  private objectAt(k: number): { k: number; d: number; start: number; parent: number } | null {
    const live = this.index;
    for (let d = 0; d < live.depth[k]; d++) {
      const o = live.frame(k, d);
      if (live.frames[o] !== OBJ) continue;
      const start = live.frames[o + 2];
      const big = live.bigAt(start) ?? this.tail?.ix.bigAt(start) ?? null;
      if (big && big.end - big.start > DUP_SCAN) continue;
      return { k: live.at(start), d, start, parent: d > 0 ? live.frames[live.frame(k, d - 1) + 2] : -1 };
    }
    return null;
  }

  /**
   * Moves the live checkpoints after `k` (and the directory records and duplicate pairs past it) to the front of
   * the tail. `mark`: the old tail's counts are those of an older document than these (an edit while reading
   * again): a mark (an empty dirty stretch) between them makes each re-sync on its own.
   */
  private cut(k: number, mark = false) {
    const live = this.index;
    // (Reading again, an edit before where it has got to: the old tail's pairs it read past but couldn't find again
    // (their first name before where it started) are kept first, or they'd go with the old document's.)
    if (this.tail && this.readUpTo > this.readStart) this.keepPairs(this.readUpTo);
    const old = this.tail;
    const t = new Tail(old ? old.end : this.done && !this.error && this.final ? { kind: 'done', final: this.final.slice() } : { kind: 'open' });
    const last = live.n - 1;
    t.ix.appendRange(live, k + 1, last + 1, true);
    const p0 = live.pos[k];
    for (let j = live.dirBefore(p0); j < live.nd; j++) t.ix.copyBig(live, j);
    let pj = 0;
    while (pj < this.pairs.length && this.pairs[pj] < p0) pj += 2;
    t.pairs = this.pairs.slice(pj);
    this.pairs.length = pj;
    if (old) {
      if (mark) {
        const F = live.pos[last] + 1;
        t.dirty.push(F, F);
        for (let j = 0; j < old.dirty.length; j += 2) {
          const e = old.dirty[j + 1];
          if (e <= F) continue;
          const st = Math.max(F, old.dirty[j]);
          if (st === F && t.dirty[t.dirty.length - 1] === F) t.dirty[t.dirty.length - 1] = e;
          else t.dirty.push(st, e);
        }
      } else t.dirty = old.dirty.slice();
      // (What the indexer has read past since the old tail was made is in the index already: its checkpoints,
      // records and pairs before there are of an older document.)
      const F0 = this.readUpTo;
      // (Positions grow along the tail: the ones dropped are a run at its start.)
      let j0 = old.next;
      while (j0 < old.ix.n && (old.ix.pos[j0] < F0 || (mark && old.ix.pos[j0] < live.pos[last] + 1))) j0++;
      const at = t.ix.n;
      t.ix.appendRange(old.ix, j0, old.ix.n, true);
      for (let j = j0; j < old.ix.n; j++) if (old.dead[j]) t.setDead(at + j - j0, true);
      for (let j = old.nextBig; j < old.ix.nd; j++) if (old.ix.dir[j * DW + 1] > F0) t.ix.copyBig(old.ix, j);
      for (let j = old.nextPair; j < old.pairs.length; j += 2) if (old.pairs[j] >= F0) t.pairs.push(old.pairs[j], old.pairs[j + 1]);
    }
    live.truncate(k);
    this.tail = t;
    this.readUpTo = -1;
    // (Placed warnings past the cut are placed again.)
    this.warnings = this.warnings.filter((w) => w.pos < p0);
    this.checked = Math.min(this.checked, this.pairs.length);
  }

  /**
   * Reads again from the last live checkpoint, or from the start of a small object open there (its names, before
   * and after the edit, all checked again).
   */
  private readAgain() {
    const live = this.index;
    // (A small object open there: from the checkpoint before it, so it opens again and all its names are checked;
    // reading that stretch costs what seeking to its start would.)
    const o = this.objectAt(live.n - 1);
    if (o && o.k < live.n - 1) this.cut(o.k);
    const s = live.state(live.n - 1);
    this.pullBack(s.pos);
    this.restore(s);
    this.restartK = live.n - 1;
    this.readStart = s.pos;
    this.syncFrom = this.tail && this.tail.dirty.length ? this.tail.dirty[0] : Infinity;
    this.hold = null;
    this.holdAt = this.syncFrom < Infinity ? this.syncFrom : -1;
    this.cand = this.nextCand(s.pos, -1);
    this.aim();
    this.unread();
    this.moved();
  }

  /**
   * The indexer from state `s` (a checkpoint, or a seek's state past the last live one: its stretch's facts are
   * in it), with the document's facts before it.
   */
  private restore(s: State, carry = false) {
    this.skipped += this.ix.stats()[8];
    if (!this.ix.restore(s, carry)) throw new Error('Out of memory');
    this.readUpTo = s.pos;
    this.rewin = REREAD_WINDOW;
    const live = this.index;
    let ok = !carry || s.lok === 1;
    let first = -1;
    for (let k = 1; k < live.n; k++) {
      if (!live.lok[k]) ok = false;
      if (first < 0 && live.sep[k] >= 0) first = live.sep[k];
    }
    this.ix.facts(ok, first >= 0 ? first : carry ? s.sep : -1, s.top >= 2 ? this.secondValue() : -1, this.pairs.length / 2);
    this.resumeIx = false;
  }

  /** The next tail checkpoint after byte `after` (past `k`) to re-sync at: alive, and not inside the object held. */
  private nextCand(after: number, k: number): number {
    const t = this.tail;
    if (!t) return -1;
    const T = t.ix;
    const h = this.hold;
    for (let j = Math.max(t.next, k + 1); j < T.n; j++) {
      // (Not before the dirty stretch it reads again for: re-reading what was just taken would take it again.)
      if (t.dead[j] || T.pos[j] <= after || T.pos[j] < this.syncFrom) continue;
      if (h && T.depth[j] > h.d && T.frames[T.frame(j, h.d) + 2] === h.start) continue;
      return j;
    }
    return -1;
  }

  /** The tail's directory records and duplicate pairs before byte `pos` (where the indexer reads again from): the document's, back in the index. */
  private pullBack(pos: number) {
    const t = this.tail;
    if (!t) return;
    const T = t.ix;
    let r = t.nextBig;
    for (; r < T.nd && T.dir[r * DW + 1] <= pos; r++) this.index.copyBig(T, r);
    t.nextBig = r;
    const P = t.pairs;
    let j = t.nextPair;
    for (; j < P.length && P[j] < pos; j += 2) this.pairs.push(P[j], P[j + 1]);
    t.nextPair = j;
  }

  /** The indexer stops at the edit's start (to see what it's in), then at the candidate's byte (or reads on). */
  private aim() {
    this.ix.target(-1);
    this.ix.stopAfter(this.holdAt >= 0 ? this.holdAt : this.cand >= 0 ? this.tail!.ix.pos[this.cand] : -1);
  }

  /** The outermost object open in `s` that isn't big (bigger than DUP_SCAN): no re-sync until it closes. */
  private holdOf(s: State): { d: number; start: number } | null {
    for (let d = 0; d < s.frames.length; d++) {
      const f = s.frames[d];
      if (f.kind !== OBJ) continue;
      const big = this.index.bigAt(f.start) ?? this.tail?.ix.bigAt(f.start) ?? null;
      if (big && big.end - big.start > DUP_SCAN) continue;
      return { d, start: f.start };
    }
    return null;
  }

  /** The indexer stopped: past the edit's start (what it's in), or at or after the candidate: the same state there (the old index is the document's again), or on to the next. */
  private trySync() {
    const s = this.ix.snapshot();
    if (this.holdAt >= 0) {
      this.holdAt = -1;
      this.hold = this.holdOf(s);
      this.cand = this.nextCand(s.pos - 1, -1);
    }
    const k = this.cand;
    const T = this.tail?.ix;
    if (k >= 0 && s.pos === T!.pos[k] && this.same(s, k) && this.ended(s)) return this.take(s, this.ix.stats(), k);
    if (!(k >= 0 && T!.pos[k] > s.pos)) this.cand = this.nextCand(s.pos, k);
    this.aim();
    this.resumeIx = true;
  }

  /**
   * Whether the value before state `s` (stopped right after it) ended there: at the top level a number or literal
   * ends at the next byte, which may not end it (`0y`: a fresh read fails at the `y` with no checkpoint before it,
   * where an old checkpoint after a string, `"…"y`, has moved). Inside a container the stop is at a comma or a
   * closing bracket. (Bytes not at hand: not here.)
   */
  private ended(s: State): boolean {
    if (s.frames.length || s.pos <= 0) return true;
    let b: Uint8Array;
    try {
      b = this.src.read(s.pos - 1, 2);
    } catch (e) {
      if (e instanceof Wait) return false;
      throw e;
    }
    const prev = b[0];
    // (After a string or a container, or past whitespace: ended before.)
    if (prev === 34 || prev === 93 || prev === 125 || prev === 32 || prev === 9 || prev === 10 || prev === 13) return true;
    if (b.length < 2) return true;
    const next = b[1];
    return next === 32 || next === 9 || next === 10 || next === 13 || next === 44 || next === 93 || next === 125;
  }

  /** Whether state `s` is tail checkpoint `k`'s: the same state and open containers (kinds, starts, names; children unless they began before the edit). */
  private same(s: State, k: number): boolean {
    const T = this.tail!.ix;
    if (T.st[k] !== s.state || T.depth[k] !== s.frames.length) return false;
    // (Several top-level values: whether each is on lines of its own after here depends on the lines the last one
    // started and ended on, which must have moved as the rest did.)
    const end = this.tail!.end;
    if (s.frames.length === 0 || this.lines || this.topHint > 1 || s.top > 1 || (end.kind === 'done' && end.final[3] > 1)) {
      const dl = s.lines - T.lines[k];
      if (s.topLine !== T.topLine[k] + dl) return false;
      const was = T.lastTopLine[k];
      if (s.lastTopLine < 0 ? was >= 0 : s.lastTopLine !== was + dl) return false;
    }
    const F = T.frames;
    for (let d = 0; d < s.frames.length; d++) {
      const o = T.frame(k, d);
      const f = s.frames[d];
      if (F[o] !== f.kind || F[o + 2] !== f.start || F[o + 3] !== f.key) return false;
      if (f.start >= this.syncFrom && F[o + 1] !== f.count) return false;
    }
    return true;
  }

  /**
   * Re-synced at tail checkpoint `k` (state `s` there now): the tail from it up to the next dirty stretch becomes
   * the index again, its counts moved by what changed (the same for all of it: the bytes in between are the same).
   */
  private take(s: State, st: Float64Array, k: number) {
    const t = this.tail!;
    const T = t.ix;
    const live = this.index;
    const old = T.state(k);
    const dn = s.nodes - old.nodes;
    const dc = s.closers - old.closers;
    const dl = s.lines - old.lines;
    const du = s.u16 - old.u16;
    const dt = s.top - old.top;
    const dcount = s.frames.map((f, d) => f.count - old.frames[d].count);
    const same = (d: number, start: number) => d < s.frames.length && s.frames[d].start === start;
    const lineU16 = (v: number) => (v === old.lineU16 ? s.lineU16 : v + du);
    const topLine = (v: number) => (v === old.topLine ? s.topLine : v + dl);
    const lastTop = (v: number) => (v < 0 ? v : v === old.lastTopLine ? s.lastTopLine : v + dl);
    // The stretch: up to the last checkpoint before the next dirty one.
    const nd = t.dirtyAfter(s.pos);
    const limit = nd >= 0 ? t.dirty[nd] : Infinity;
    let m = k;
    for (let j = k + 1; j < T.n && T.pos[j] < limit; j++) if (!t.dead[j]) m = j;
    // (Containers open there without a record: one an edit made big gets one once their ends are known: endFacts.)
    for (let d = 0; d < s.frames.length; d++) if (!T.bigAt(s.frames[d].start) && !live.bigAt(s.frames[d].start)) this.unsized.add(d + ':' + s.frames[d].start);
    // Checkpoint k as the indexer has it, then the rest moved.
    live.addState(s, st[15]);
    // The rest in bulk (no dead ones between: they're in dirty stretches), then their counts moved.
    const base = live.n;
    live.appendRange(T, k + 1, m + 1, false);
    const F = live.frames;
    for (let j = base; j < live.n; j++) {
      live.nodes[j] += dn;
      live.closers[j] += dc;
      live.lines[j] += dl;
      live.u16[j] += du;
      live.lineU16[j] = lineU16(live.lineU16[j]);
      live.top[j] += dt;
      live.topLine[j] = topLine(live.topLine[j]);
      live.lastTopLine[j] = lastTop(live.lastTopLine[j]);
      const from = live.from[j];
      for (let d = from, o = live.fr[j] * FW; d < live.depth[j]; d++, o += FW) {
        if (same(d, F[o + 2])) {
          F[o + 1] += dcount[d];
          F[o + 4] = s.frames[d].nodes;
          F[o + 5] = s.frames[d].closers;
        } else {
          F[o + 4] += dn;
          F[o + 5] += dc;
        }
      }
    }
    // (The last stretch, when the old end is the document's: all that's left.)
    const all = nd < 0 && t.end.kind === 'done' && dt === 0;
    const mEnd = all ? Infinity : T.pos[m];
    let r = t.nextBig;
    for (; r < T.nd && T.dir[r * DW + 1] <= s.pos; r++);
    for (; r < T.nd && T.dir[r * DW + 1] <= mEnd; r++) {
      // (Begun before checkpoint k: one of the containers open there, or it's an old one that's gone; one an edit
      // made smaller than `big` isn't in the directory any more.)
      if (T.dir[r * DW] < s.pos && (!same(T.dir[r * DW + 3], T.dir[r * DW]) || T.dir[r * DW + 1] - T.dir[r * DW] < this.big)) continue;
      live.copyBig(T, r, (g) => {
        if (g[0] >= s.pos) {
          g[5] += dn;
          g[6] += dc;
        } else if (same(g[3], g[0])) {
          g[4] += dcount[g[3]];
          g[5] = s.frames[g[3]].nodes;
          g[6] = s.frames[g[3]].closers;
        }
        g[7] += dn;
        g[8] += dc;
      });
    }
    t.nextBig = r;
    // Duplicate pairs: old ones the indexer couldn't find again (their first name before where it started), then the stretch's.
    this.keepPairs(s.pos);
    const P = t.pairs;
    const add: number[] = [];
    let j = t.nextPair;
    for (; j < P.length && P[j] <= mEnd; j += 2) add.push(P[j], P[j + 1]);
    t.nextPair = j;
    if (add.length) this.addPairs(add);
    t.next = m + 1;
    // Dirty stretches passed.
    t.dirty = t.dirty.filter((_, i) => t.dirty[i | 1] > s.pos);
    if (nd >= 0) {
      // On from the last of them to the next dirty stretch.
      this.pendingRead = true;
    } else if (all) {
      // The end, as it was (counts moved).
      const fin = (t.end as { final: Float64Array }).final.slice();
      fin[1] += dn;
      fin[2] += dc;
      fin[3] += dt;
      fin[9] += dl;
      fin[10] += du;
      fin[11] = lineU16(fin[11]);
      fin[8] = 0;
      this.tail = null;
      this.final = fin;
      this.pendingFinish = true;
    } else {
      // Its end changed (the top-level values), or isn't known: read on from the last of them.
      this.tail = null;
      this.pendingRead = true;
    }
  }

  /**
   * Child `i` of container `node` (or of the LIST): where it starts (an object member: its name's quote), its
   * value's span, and its name's end (the byte after its closing quote; -1: not an object's); null if there's none.
   */
  memberOf(node: HugeNode, i: number): { start: number; value: number; end: number; keyEnd: number } | null {
    if (node.kind < ARR || i < 0) return null;
    const at = this.seek(this.box(node), i);
    if (!at || at.closed) return null;
    const page = this.pageOf(node, i, 1, { previews: false });
    const n = page?.nodes[0];
    if (!n || n.end < 0) return null;
    const start = at.s.pos;
    return { start, value: n.start, end: n.end, keyEnd: node.kind === OBJ ? nameEnd(this.src, start) : -1 };
  }

  /**
   * The tail's duplicate pairs before byte `upTo` the indexer couldn't find again, reading from where it started
   * (their first name is before there, in an object it didn't read from its start): kept, unless an edit is on them.
   */
  private keepPairs(upTo: number) {
    const t = this.tail;
    if (!t) return;
    const P = t.pairs;
    const add: number[] = [];
    let j = t.nextPair;
    for (; j < P.length && P[j] < upTo; j += 2) if (P[j] >= this.readStart && P[j + 1] < this.readStart && !inStretch(t.dirty, P[j])) add.push(P[j], P[j + 1]);
    t.nextPair = j;
    if (add.length) this.addPairs(add);
  }

  /** Adds duplicate pairs (sorted by name) to those read after where the indexer started. */
  private addPairs(add: number[]) {
    const P = this.pairs;
    let i = 0;
    while (i < P.length && P[i] < this.readStart) i += 2;
    const rest: [number, number][] = [];
    for (let j = i; j < P.length; j += 2) rest.push([P[j], P[j + 1]]);
    for (let j = 0; j < add.length; j += 2) rest.push([add[j], add[j + 1]]);
    // (A name found again against a later one of its object's, and kept against an earlier one: one warning, the
    // earliest's, as when opening.)
    rest.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    P.length = i;
    for (let j = 0; j < rest.length; j++) if (!j || rest[j][0] !== rest[j - 1][0]) P.push(rest[j][0], rest[j][1]);
    this.warnings = this.warnings.filter((w) => w.pos < this.readStart);
    this.checked = Math.min(this.checked, i);
  }

  /** Containers open where the index re-synced that had no directory record (depth:start): see endFacts. */
  private unsized = new Set<string>();

  /** The directory record of the container at depth `d` that starts at byte `start`, read to its close (null: it doesn't close). */
  private recordOf(d: number, start: number): Float64Array | null {
    const ix = this.index;
    const open = (k: number) => ix.depth[k] > d && ix.frames[ix.frame(k, d) + 2] === start;
    // (From the last checkpoint it's open at, or the one before it.)
    let lo = ix.at(start);
    let hi = ix.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (open(mid)) lo = mid;
      else if (ix.pos[mid] <= start) lo = mid;
      else hi = mid - 1;
    }
    const q = this.at(ix.state(lo));
    q.limit = Infinity;
    q.target(d + 1, start);
    if (q.go() !== STOP || q.why !== W_CLOSE) return null;
    const e = q.snapshot();
    const f = e.frames[d];
    return Float64Array.of(start, e.pos + 1, f.kind, d, f.count, f.nodes, f.closers, e.nodes, e.closers, d > 0 ? e.frames[d - 1].start : -1);
  }

  /** The whole document's facts once it's all read again: from the index (each checkpoint's stretch) and the last stretch. */
  private endFacts() {
    // Containers an edit made big that close past where it re-synced: their records.
    for (const u of this.unsized) {
      const [d, start] = u.split(':').map(Number);
      if (this.index.bigAt(start)) continue;
      const r = this.recordOf(d, start);
      if (r && r[1] - r[0] >= this.big) this.index.insertBig(r);
    }
    this.unsized.clear();
    const f = this.final!;
    const live = this.index;
    let deep = f[18];
    let ok = f[16] === 1;
    for (let k = 1; k < live.n; k++) {
      if (live.deepest[k] > deep) deep = live.deepest[k];
      if (!live.lok[k]) ok = false;
    }
    f[4] = deep;
    f[7] = ok ? 1 : 0;
    // (The runs before the last one's (added at each restore), and the last one's.)
    f[8] = this.skipped + this.ix.stats()[8];
    this.second = -2;
    f[14] = this.secondValue();
  }

  /** Where the second top-level value starts (-1: none), found again after an edit (reading from the checkpoint before it). */
  private secondValue(): number {
    if (this.second !== -2) return this.second;
    // (All read, valid, one top-level value: none. Broken, a second one may have begun before the error.)
    if (this.final && this.final[3] < 2 && !this.error && !this.failed) return (this.second = -1);
    const live = this.index;
    const k = Math.max(0, live.lastAtMost(live.top, 1));
    // (Broken inside the first value, still open since a checkpoint in it: none began before the error.)
    const outer = this.failed ? this.failed.outer : this.failedAt >= 0 ? this.failOuter : -1;
    if (outer >= 0 && live.top[k] === 1 && live.depth[k] > 0 && live.frames[live.frame(k, 0) + 2] === outer) return (this.second = -1);
    const q = this.at(live.state(k));
    q.limit = Infinity;
    q.target(0, -1, 1);
    const r = q.go();
    this.second = r === STOP && q.why === W_CHILD ? q.snapshot().pos : -1;
    return this.second;
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
    if (b.d === 0) return Math.max(0, Math.min(this.lastK, ix.lastAtMost(ix.top, i)));
    const k1 = ix.at(b.start) + 1;
    let k2 = this.lastK;
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

  /** The query skeleton, from state `s`: it reads no further than the front (FRONT there). */
  private at(s: State): Skeleton {
    const q = this.q;
    if (!q.start(this.src, { window: this.queryWindow, maxDepth: MAX_DEPTH }) || !q.restore(s)) throw new Error('Out of memory');
    q.limit = this.front ? this.front.pos : Infinity;
    return q;
  }

  /**
   * Child `i` of `b`: the state before it (an object member: before its name), or where `b` closes (`closed`);
   * null if it isn't read yet (or the document ends or breaks first).
   */
  private seek(b: Box, i: number, at?: State): { s: State; closed: boolean } | null {
    const q = this.at(at ?? this.index.state(this.from(b, i)));
    q.target(b.d, b.start, i, this.cutOf(b));
    if (q.go() !== STOP) return null;
    const s = q.snapshot();
    // (Stopped at the front's cut: child i isn't whole yet.)
    if (q.why === W_CHILD && this.countIn(s, b) < i) return null;
    return { s, closed: q.why === W_CLOSE };
  }

  /** Whether `b` is open at the front, and the innermost there (its children are what's being read). */
  private openAt(b: Box): { open: boolean; innermost: boolean } {
    const f = this.front;
    if (!f) return { open: false, innermost: false };
    const fr = f.s.frames;
    const open = b.d === 0 || (fr.length >= b.d && fr[b.d - 1].start === b.start);
    return { open, innermost: open && fr.length === b.d };
  }

  /**
   * The child of `b` still being read at the front: a container (its children so far) or a long string, which
   * pages show as a stub; null if none.
   */
  private openChild(b: Box): { start: number; kind: number; count: number } | null {
    const f = this.front;
    const o = this.openAt(b);
    if (!f || !o.open) return null;
    const fr = f.s.frames;
    if (fr.length > b.d) return { start: fr[b.d].start, kind: fr[b.d].kind, count: fr[b.d].count };
    if (f.part === P_STR) return { start: f.partStart, kind: STR, count: 0 };
    return null;
  }

  /**
   * The byte from which children of `b` aren't whole yet (no child starting there or later is read): the front,
   * or the start of a member or number being read when `b` is the innermost container there; -1: no limit.
   */
  private cutOf(b: Box): number {
    const f = this.front;
    if (!f) return -1;
    const o = this.openAt(b);
    if (o.innermost) {
      const fr = f.s.frames;
      // A member whose name is read but not its value (a number being read, or nothing yet): before its name.
      // (Its value a string being read: a stub, the page's last.)
      if (b.d > 0 && fr[b.d - 1].kind === OBJ && (f.s.state === S_COLON || f.s.state === S_VALUE) && fr[b.d - 1].key >= 0 && f.part !== P_STR && f.part !== P_KEY) return fr[b.d - 1].key;
      // A name, or an item that is a number, being read: before it.
      if (f.part === P_KEY || f.part === P_SCALAR) return f.partStart;
    }
    return f.pos;
  }

  /**
   * The container at depth `d` that starts at byte `start` after state `s`, read to its closing bracket: its end,
   * children and pretty lines (null if the document ends or breaks first).
   */
  private measure(s: State, d: number, start: number, kind: number, key: Seg | null): HugeNode {
    const big = this.index.bigAt(start);
    if (big) return this.ofBig(big, key);
    // Still being read: its children so far.
    const open = this.openNode(d, start, kind, key);
    if (open) return open;
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
    const page = node ? this.pageOf(node, from, count) : null;
    if (page) return page.page;
    // (None read yet past `from`: more may come while reading.)
    const more = !!node && node.kind >= ARR && this.openAt(this.box(node)).open;
    return { container: node, from, count: 0, more, tape: emptySent(), text: '', stubs: [], map: new Float64Array(0) };
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

  /**
   * `opts.at`: a state before the container's first child (its value's first byte), so child 0 needs no seek;
   * `opts.budget`: bytes of text (else PAGE_BYTES); `opts.previews`: the big children's previews (HugeNode.preview).
   */
  private pageOf(node: HugeNode, from: number, count: number, opts: { at?: State; budget?: number; previews?: boolean } = {}): { page: HugePage; nodes: HugeNode[] } | null {
    if (node.kind < ARR) return null;
    const b = this.box(node);
    const first = this.seek(b, from, from === 0 ? opts.at : undefined);
    if (!first) return null;
    const pieces: Piece[] = [];
    const stubs: { index: number; key: Seg | null; at?: State }[] = [];
    let cur = first.s.pos;
    let end = cur;
    let more = false;
    let got = from;
    // Ends at the front (what's read so far): its children are counted from its text.
    let atFront = false;
    // The child being read at the front (a stub, the page's last), and where children stop being whole.
    const open = this.openChild(b);
    const cut = this.cutOf(b);
    if (!first.closed) {
      const q = this.q;
      // (Big children are stubs: their bytes don't count.)
      let limit = cur + (opts.budget ?? this.pageBytes);
      const kids = this.bigKids(b, cur);
      let nb = kids.next().value as Big | undefined;
      // (The child being read comes after every closed one.)
      const stubAt = () => (nb ? nb.start : open && open.start >= cur ? open.start : -1);
      for (;;) {
        q.target(b.d, b.start, from + count, cut >= 0 ? Math.min(limit, cut) : limit, stubAt());
        const r = q.go();
        if (r === DONE && b.d === 0) {
          // The top level ends with the document.
          end = this.src.size;
          got = q.snapshot().top;
          break;
        }
        if (r === FRONT) {
          end = cut >= 0 ? cut : this.front!.pos;
          atFront = true;
          more = true;
          break;
        }
        if (r === STOP && q.why === W_CHILD && open && !nb && q.snapshot().pos === open.start && this.countIn(q.snapshot(), b) < from + count) {
          // The child being read: a stub with its children so far; nothing after it is read yet.
          const s = q.snapshot();
          const n = this.countIn(s, b);
          const key = node.kind === OBJ ? nameAt(this.src, s.frames[b.d - 1].key) : n;
          const partial = open.kind === STR ? { kind: STR, start: open.start, end: -1, depth: node.depth + 1, key, count: 0, partial: true, pretty: -1, prettyLines: null, big: true } : this.openNode(node.depth + 1, open.start, open.kind, key);
          const fake: Big & { node?: HugeNode } = { start: open.start, end: -1, kind: open.kind, depth: node.depth + 1, count: open.count, nodes: 0, closers: 0, endNodes: 0, endClosers: 0, parent: b.start, node: partial ?? undefined };
          stubs.push({ index: n, key, at: s });
          pieces.push([cur, s.pos], fake);
          cur = end = s.pos;
          got = n + 1;
          more = true;
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
          stubs.push({ index: n, key: node.kind === OBJ ? nameAt(this.src, s.frames[b.d - 1].key) : n, at: s });
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
            if ((r2 === DONE && b.d === 0) || r2 === FRONT) {
              // (It ends the document, or what's read so far: the page ends with it.)
              end = cur;
              got = n + 1;
              more = r2 === FRONT;
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
    const n = atFront ? childCount(t, 0) : got - from;
    // Items numbered from `from`; the stubs' nodes.
    const kids: number[] = [];
    for (let c = 1, e = nextOf(t, 0); c < e && kids.length < n; c = nextOf(t, c)) kids.push(c);
    if (from + n < 0x7fffffff) for (const c of kids) if (keyKindOf(t, c) === KEY_INDEX) t.nodes[c * W + 4] += from;
    const depth = node.depth + 1;
    const nodes = kids.map((c) => this.nodeIn(built, t, c, depth, keyKindOf(t, c) === KEY_NAME ? (keyOf(t, c) as string) : (keyOf(t, c) as number)));
    // Big children's previews (their rows), within a time budget.
    const t0 = opts.previews === false ? 0 : performance.now();
    const stubPairs: [number, HugeNode][] = stubs.map((x, j) => {
      const n = { ...nodes[x.index - from], key: x.key };
      if (opts.previews !== false && j < PREVIEWS && performance.now() - t0 < this.previewMs) {
        const pv = this.previewOf(n, x.at);
        if (pv !== undefined) n.preview = pv;
      }
      nodes[x.index - from] = n;
      return [kids[x.index - from], n];
    });
    const o = this.openAt(b);
    const container = o.open ? (node.kind === LIST ? this.list() : (this.openNode(node.depth, node.start, node.kind, node.key) ?? node)) : !more && node.count === null ? { ...node, count: got } : node;
    const pairs = new Float64Array((built.map.length / 3) * 2);
    for (let j = 0, o = 0; j < built.map.length; j += 3, o += 2) {
      pairs[o] = built.map[j];
      pairs[o + 1] = built.map[j + 1];
    }
    const page: HugePage = { container, from, count: kids.length, more, tape: sendTape(t), text: built.text, stubs: stubPairs, map: pairs };
    return { page, nodes };
  }

  /**
   * What a big child's row shows: a container's first children as lazy.ts Filler.preview (format.ts preview) writes
   * them; a string's decoded start (cut, with …). `at`: the state at its first byte.
   */
  private previewOf(n: HugeNode, at?: State): string | undefined {
    if (n.kind === STR) return this.stringStart(n.start, n.end, PREVIEW_CHARS);
    if (n.kind < ARR) return undefined;
    const isObj = n.kind === OBJ;
    if (n.count === 0) return isObj ? '{}' : '[]';
    const page = this.pageOf(n, 0, 32, { at, budget: 8192, previews: false });
    if (!page) return undefined;
    const t = receiverTape(page.page);
    const root = lazyResult(t, page.page.text).root;
    const list = root ? (root.v as import('../json/parser').JNode[]) : [];
    const stubs = new Map(page.page.stubs);
    let s = isObj ? '{' : '[';
    for (let i = 0; i < list.length; i++) {
      if (s.length > 90) {
        s += ', …';
        break;
      }
      const c = list[i];
      const big = c.zi !== undefined ? stubs.get(c.zi) : undefined;
      let v: string;
      if (big) v = big.kind === OBJ ? (big.count ? '{…}' : '{}') : big.kind === ARR ? (big.count ? '[…]' : '[]') : JSON.stringify(clip(this.stringStart(big.start, big.end, 48, false), 40));
      else v = c.t === OBJ ? ((c.v as unknown[]).length ? '{…}' : '{}') : c.t === ARR ? ((c.v as unknown[]).length ? '[…]' : '[]') : primText(c, 40);
      s += (i ? ', ' : '') + (isObj ? keyLabel(clip(c.key as string, 40)) + ': ' + v : v);
    }
    // (More children than the page held, all shown: more follow.)
    if (s.length <= 90 && list.length && list.length < (n.count ?? 0)) s += ', …';
    return s + (isObj ? '}' : ']');
  }

  /** The start of the string token at `start` (to `end`; -1: still being read), decoded: `max` characters, `…` if cut. */
  private stringStart(start: number, end: number, max: number, ellipsis = true): string {
    // (Up to 6 bytes a character: \uXXXX.)
    const want = Math.min(end > 0 ? end - start : Infinity, 6 * max + 16, this.src.size - start);
    let token = textOf(this.src, start, want);
    const whole = end > 0 && want >= end - start;
    // (Cut inside an escape or a character: dropped.)
    if (!whole) token = token.replace(/\\(u[0-9a-fA-F]{0,3})?$/, '').replace(/\uFFFD$/, '');
    let v = decodeString(token, 0);
    const cut = !whole || v.length > max;
    if (v.length > max) v = v.slice(0, (v.charCodeAt(max - 1) & 0xfc00) === 0xd800 ? max - 1 : max);
    return cut && ellipsis ? v + '…' : v;
  }

  /** A node of a parsed text, whole in it (a stub: its big value), as a HugeNode (its pretty line not known: -1). */
  private nodeIn(b: Built, t: Tape, i: number, depth: number, key: Seg | null, pretty = -1): HugeNode {
    const kind = kindOf(t, i);
    const at = startOf(t, i);
    const stub = b.stubs.get(at);
    if (stub) return stub.node ? { ...stub.node, key } : this.ofBig(stub, key);
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

  /**
   * The last checkpoint queries read from: the index's last, or (broken) the last at or before the error, which can
   * be before where the parse failed (a string the normal path closes earlier): checkpoints past it are unread.
   */
  private get lastK(): number {
    const ix = this.index;
    const f = this.front;
    return f && this.error && ix.pos[ix.n - 1] > f.pos ? ix.at(f.pos) : ix.n - 1;
  }

  /** The last checkpoint at or before pretty line `l` (before JSON Lines' opening line). */
  private checkpointOfLine(l: number): number {
    let lo = 0;
    let hi = this.lastK;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.prettyAt(mid) <= l) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The stretch from checkpoint `k` to the next (or the end; the last while reading: see frontRegion), parsed. */
  private region(k: number): Region | null {
    const hit = this.regions.get(k);
    const ix = this.index;
    const lastK = this.lastK;
    if (k > lastK) return null;
    const last = k === lastK;
    // (A stretch near the front ends where reading had got to: made again once reading has gone 512 KiB further.)
    if (hit && (!hit.front || (this.front && this.front.pos - hit.front < 1 << 19 && lastK === k))) {
      this.regions.delete(k);
      this.regions.set(k, hit);
      return hit;
    }
    if (hit) {
      this.regions.delete(k);
      this.regionBytes -= hit.bytes;
    }
    if (last && this.front) {
      // (Broken: up to the error when a value ends right before it, so the pretty lines run up to it.)
      const r = this.frontRegion(k, this.front.pos - (1 << 16), !!this.error);
      if (r) this.keep(r);
      return r;
    }
    if (last && (!this.done || this.error)) return null;
    const r = this.parseRegion(k, ix.state(k), last ? null : ix.state(k + 1), last ? 0 : ix.low[k + 1]);
    if (r) this.keep(r);
    return r;
  }

  private keep(r: Region) {
    this.regions.set(r.k, r);
    this.regionBytes += r.bytes;
    while (this.regionBytes > REGION_BUDGET && this.regions.size > 1) {
      const [key, old] = this.regions.entries().next().value!;
      this.regions.delete(key);
      this.regionBytes -= old.bytes;
    }
  }

  /**
   * The stretch from the last checkpoint `k` to the first place a value ends at or after byte `after` before the
   * front (or, failing that, the first after the checkpoint); null if none is read yet.
   */
  private frontRegion(k: number, after: number, toFront = false): Region | null {
    const s = this.index.state(k);
    const tries = after > s.pos + 1 ? [after, s.pos + 1] : [s.pos + 1];
    if (toFront && this.front) tries.unshift(this.front.pos);
    for (const a of tries) {
      const q = this.at(s);
      // (Broken, all read: the byte at the error ends a token right before it, as when it was read.)
      if (this.error && this.done && this.front) q.limit = Math.min(this.src.size, this.front.pos + 1);
      q.target(-1);
      q.stopAfter(a);
      const r = q.go();
      let e: State | null = r === STOP && q.why === W_AFTER ? q.snapshot() : null;
      // Broken: the front is where the error is; a value that ends right before it ends a stretch there (wherever
      // the checkpoints are).
      if (!e && r === FRONT && this.error) {
        const f = q.snapshot();
        const st = q.stats();
        if ((f.state === S_AFTER || f.state === S_TOP) && st[12] === 0 && f.pos > s.pos && f.pos >= a) e = f;
      }
      if (e) {
        const reg = this.parseRegion(k, s, e, q.stats()[15]);
        if (reg) reg.front = this.front ? this.front.pos : 0;
        return reg;
      }
    }
    return null;
  }

  /** Stretch [s, e) parsed (e null: to the end). `low`: the lowest depth in between (0: the top level). */
  private parseRegion(k: number, s: State, e: State | null, low: number): Region | null {
    const ix = this.index;
    const to = e ? e.pos : this.src.size;
    // A stretch from the very start that stays inside the first value (most documents' first stretch: the first
    // pretty lines, a locate near the start) goes to tape.wasm as a one-item array, the same tape the JS parser's
    // JSON Lines mode makes of it (text one later), 4–5× sooner, without waiting for the JS parser.
    const one = s.top === 0 && s.frames.length === 0 && s.state !== S_AFTER && s.state !== S_TOP && !!e && e.top === 1 && e.frames.length > 0 && !!this.parsers.wasm;
    const prefix = (one ? '[' : '') + prefixOf(s, byteBefore(this.src, s.pos));
    const close = e ? e.frames.map((f) => (f.kind === OBJ ? '}' : ']')).reverse().join('') : '';
    const suffix = one ? close + ']' : close;
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
    const wrap = s.frames.length === 0 || !e || e.frames.length === 0 || low === 0;
    const t = wrap && !one ? this.parsers.parse(built.text, { lines: true }) : ((this.parsers.wasm && wasmTape(this.parsers.wasm, built.text)) || this.parsers.parse(built.text));
    if (t.head.error) return null;
    const synth = (wrap ? 1 : 0) + s.frames.length + (s.state === S_AFTER || s.state === S_TOP ? 1 : 0);
    const end = built.text.length - close.length - (one ? 1 : 0);
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
    return { ...built, k, tape: t, synth, wrap, end, s, e, lines: lines.slice(0, n), depth: depths.slice(0, n), next: e ? e.pos : -1, bytes: built.text.length * 2 + t.count * W * 4 + n * 8 + 1024 };
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
    // (While reading, or before an error: the lines read so far, as the summary counts them; the last few, past
    // the last place a stretch can end, come once more is read: fewer lines than asked then.)
    const total = this.done && !this.error ? st[1] + st[2] + (multi ? 2 : 0) : st[1] + st[2] + (multi ? 1 : 0);
    void ix;
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
      if (multi && (line === 0 || (line === total - 1 && this.done && !this.error))) {
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

  /**
   * Lines [from, from + count) of the text as stored, each cut at `max` bytes. Nothing past what's read (the front:
   * indexing, stopped, or the error) is read: a line that goes on past it ends there, cut[k] = 2 (its length so far).
   */
  rawLines(from: number, count: number, max: number): HugeLines {
    const ix = this.index;
    const st = this.stats();
    const limit = this.front ? this.front.pos : this.src.size;
    const total = this.done ? this.breaks(st) + 1 : (this.front ? this.front.s.lines : ix.lines[ix.n - 1]) + 1;
    const n = Math.max(0, Math.min(count, total - from));
    const text: string[] = [];
    const cut = new Uint8Array(n);
    const length = new Float64Array(n);
    const pos = new Float64Array(n);
    // The first line's start: after the from-th break, counted from the last checkpoint before it.
    let at = 0;
    if (from > 0 && n > 0) {
      const k = Math.max(0, Math.min(this.lastK, ix.lastAtMost(ix.lines, from - 1)));
      at = afterBreaks(this.src, ix.pos[k], from - ix.lines[k], limit);
    }
    let j = 0;
    if (at >= 0 && at <= limit) {
      for (; j < n; ) {
        const lineEnd = this.lineEnd(from + j, at, limit);
        const len = lineEnd - at;
        text.push(textOf(this.src, at, Math.min(len, max)));
        cut[j] = lineEnd >= limit && limit < this.src.size ? 2 : len > max ? 1 : 0;
        length[j] = len;
        pos[j] = at;
        j++;
        if (lineEnd >= limit) break;
        at = afterBreaks(this.src, lineEnd, 1, limit);
      }
    }
    return { from, text, cut: cut.subarray(0, j), length: length.subarray(0, j), pos: pos.subarray(0, j), total };
  }

  /** Where line `line` (starting at byte `at`) ends: at its break, or `limit` (the end, or what's read). */
  private lineEnd(line: number, at: number, limit: number): number {
    const ix = this.index;
    // From the last checkpoint still on this line (a long line is crossed by checkpoints, not read).
    const k = Math.min(this.lastK, ix.lastAtMost(ix.lines, line));
    let from = k >= 0 && ix.pos[k] > at ? ix.pos[k] : at;
    // (Big strings hold no line break: skipped.)
    for (;;) {
      const g = ix.bigFrom(from);
      const big = g < ix.bigCount ? ix.big(g) : null;
      const until = big && big.kind === STR && big.start < limit ? big.start : limit;
      const b = nextBreak(this.src, from, until);
      if (b >= 0) return b;
      if (until >= limit) return limit;
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

  /**
   * The containers open in state `s` at depths [0, d) as nodes, with their index in their own container (the
   * LIST first in JSON Lines). Each is in the directory (big), still being read (its children so far), or small:
   * read to its close, innermost first, in one run (every container around a big one is big).
   */
  private frameChain(s: State, d: number): { node: HugeNode; index: number }[] {
    const multi = this.multi;
    const path = this.framePath(s, d);
    const off = multi ? 1 : 0;
    const keyOfFrame = (j: number): Seg | null => (j === 0 ? (multi ? path[0] : null) : path[off + j - 1]);
    const nodes: HugeNode[] = new Array(d);
    let q: Skeleton | null = null;
    let running = true;
    for (let j = d - 1; j >= 0; j--) {
      const f = s.frames[j];
      const big = this.index.bigAt(f.start);
      const known = big ? this.ofBig(big, keyOfFrame(j)) : this.openNode(j, f.start, f.kind, keyOfFrame(j));
      if (known) {
        nodes[j] = known;
        running = false;
        continue;
      }
      let node: HugeNode = { kind: f.kind, start: f.start, end: -1, depth: j, key: keyOfFrame(j), count: null, pretty: -1, prettyLines: null, big: false };
      if (running) {
        if (!q) q = this.at(s);
        q.target(j + 1, f.start);
        if (q.go() === STOP && q.why === W_CLOSE) {
          const e = q.snapshot();
          const g = e.frames[j];
          node = { ...node, end: e.pos + 1, count: g.count, pretty: f.nodes + f.closers + off, prettyLines: e.nodes + e.closers - (f.nodes + f.closers) + (g.count > 0 ? 1 : 0) };
        } else running = false;
      }
      nodes[j] = node;
    }
    const out: { node: HugeNode; index: number }[] = multi ? [{ node: this.list(), index: 0 }] : [];
    for (let j = 0; j < d; j++) out.push({ node: nodes[j], index: j === 0 ? (multi ? s.top - 1 : 0) : s.frames[j - 1].count - 1 });
    return out;
  }

  /** The container open at depth `d` in state `s` (a region's start, or the front), as a location. */
  private frameLocation(s: State, d: number): HugeLocation {
    const chain = this.frameChain(s, d + 1);
    const self = chain.pop()!;
    const path = this.framePath(s, d);
    const node = { ...self.node, key: path.length ? path[path.length - 1] : null };
    const parent = chain.length ? chain[chain.length - 1].node : null;
    return { path, node, parent, index: self.index, chain, ...lineCol(this.src, this.index, s.frames[d].start) };
  }

  /** Pretty line of node `i` of region `r`. */
  private lineOf(r: Region, i: number): number {
    const lines = r.lines;
    for (let a = 0; a < lines.length; a++) if (lines[a] === i) return this.prettyAt(r.k) + a + (this.multi ? 1 : 0);
    return -1;
  }

  /** Node `i` of region `r` as a HugeNode (one open at the region's end read to its closing bracket, or its children so far). */
  private regionNode(r: Region, i: number, depth: number, key: Seg | null): HugeNode {
    const t = r.tape;
    if (kindOf(t, i) >= ARR && endOf(t, i) > r.end && !r.stubs.has(startOf(t, i))) return this.measure(r.s, depth, byteOf(r, startOf(t, i)), kindOf(t, i), key);
    return this.nodeIn(r, t, i, depth, key, this.lineOf(r, i));
  }

  /** The value at byte `pos`: the deepest whose text holds it (a property name: its value), with its path. */
  locate(pos: Bytes): HugeLocation | null {
    const ix = this.index;
    if (pos < 0 || pos >= this.src.size) return null;
    // (Not read yet.)
    if (this.front && pos >= this.front.pos) return null;
    let k = Math.min(ix.at(pos), this.lastK);
    // (Right after a value, at the comma or bracket where a checkpoint is, or at the top level at a separator (not
    // the next value's start, `}{`): the value is the region before's, wherever checkpoints are.)
    if (k > 0 && ix.pos[k] === pos && (ix.st[k] === S_AFTER || ix.st[k] === S_TOP)) {
      const [c, n] = this.src.read(pos - 1, 2);
      const space = (x: number) => x === 32 || x === 9 || x === 10 || x === 13;
      if (!space(c) && (ix.st[k] === S_AFTER || n === 44 || space(n))) k--;
    }
    // After the last checkpoint while reading: a stretch to the first clean place past `pos`, if any before the front.
    let r = k === this.lastK && this.front ? this.frontRegion(k, pos) : this.region(k);
    // (Stopped at the start of the top-level value at `pos`: that value is wanted.)
    if (r && r.front !== undefined && r.e && r.e.pos === pos && r.e.state === S_TOP) {
      r = this.frontRegion(k, pos + 1);
      // (None that goes past it (it breaks first): what's open at the front.)
      if (r && r.e && r.e.pos <= pos) r = null;
    }
    if (!r || pos > (r.e ? r.e.pos : this.src.size)) return this.frontLocation(pos);
    const t = r.tape;
    const off = offsetOf(r, pos, this.src);
    if (off < 0) return this.frontLocation(pos);
    const i = nodeAtOffset(t, off, r.text);
    const base = r.wrap ? 1 : 0;
    const nf = r.s.frames.length;
    const multi = this.multi;
    if (i < r.synth) {
      // Between values of a container open at the region's start: that container (or the top level).
      if (i >= base && i < base + nf) return this.frameLocation(r.s, i - base);
      if (nf > 0 && i === r.synth - 1 && r.s.state === S_AFTER) return this.frameLocation(r.s, nf - 1);
      return multi ? { path: [], node: this.list(), parent: null, index: 0, chain: [], line: 1, col: 1 } : null;
    }
    // Up to the first node whose container is one of the synthetic ones.
    const local: number[] = [];
    for (let c = i; c >= r.synth; c = parentOf(t, c)) local.push(c);
    local.reverse();
    const p0 = parentOf(t, local[0]);
    let path: Seg[];
    let index0: number;
    let above: { node: HugeNode; index: number }[];
    if (p0 >= base && p0 < base + nf) {
      const d = p0 - base;
      const f = r.s.frames[d];
      index0 = f.count - 1 + localIndex(t, local[0]);
      path = this.framePath(r.s, d);
      path.push(f.kind === OBJ ? (keyOf(t, local[0]) as string) : index0);
      above = this.frameChain(r.s, d + 1);
    } else if (r.wrap && p0 === 0) {
      const before = nf > 0 || r.s.state === S_TOP ? 1 : 0;
      index0 = r.s.top - before + localIndex(t, local[0]);
      path = multi ? [index0] : [];
      above = multi ? [{ node: this.list(), index: 0 }] : [];
    } else return null;
    for (let j = 1; j < local.length; j++) {
      const c = local[j];
      path.push(keyKindOf(t, c) === KEY_NAME ? (keyOf(t, c) as string) : localIndex(t, c));
    }
    const off0 = multi ? 1 : 0;
    const depthOf = (j: number) => path.length - off0 - (local.length - 1 - j);
    const keyAt = (j: number): Seg | null => {
      const at = path.length - (local.length - 1 - j) - 1;
      return at >= 0 ? path[at] : null;
    };
    // The containers in the region above it.
    const chain = above.slice();
    for (let j = 0; j < local.length - 1; j++) chain.push({ node: this.regionNode(r, local[j], depthOf(j), keyAt(j)), index: j === 0 ? index0 : localIndex(t, local[j]) });
    const node = this.regionNode(r, i, depthOf(local.length - 1), keyAt(local.length - 1));
    const parent = chain.length ? chain[chain.length - 1].node : null;
    const index = local.length > 1 ? localIndex(t, i) : index0;
    return { path, node, parent, index, chain, ...lineCol(this.src, ix, node.start) };
  }

  /** Byte `pos` in what's read past the last place a stretch could end (a value being read): the innermost container open at the front around it. */
  private frontLocation(pos: Bytes): HugeLocation | null {
    const f = this.front;
    if (!f) return null;
    const fr = f.s.frames;
    let d = fr.length - 1;
    while (d >= 0 && fr[d].start > pos) d--;
    if (d < 0) return this.multi ? { path: [], node: this.list(), parent: null, index: 0, chain: [], line: 1, col: 1 } : null;
    return this.frameLocation(f.s, d);
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
          // (No previews: only the path's node is wanted.)
          const page = this.pageOf(node, from, 1000, { previews: false });
          if (!page) return null;
          next = page.nodes.find((n) => n.key === key);
          if (!page.page.more || !page.page.count) break;
          from += page.page.count;
        }
      } else {
        if (typeof seg !== 'number' && !/^\d+$/.test(seg)) return null;
        next = this.pageOf(node, Number(seg), 1, { previews: false })?.nodes[0];
      }
      if (!next) return null;
      node = next;
    }
    return node.kind === LIST ? { path: [], node, parent: null, index: 0, chain: [], line: 1, col: 1 } : this.locate(node.start);
  }

  /** Bytes [at, at + len), yielding the Waits of blocks not read yet (find runs as a generator: it can't be asked again). */
  private *reading(at: number, len: number): Generator<{ wait: Wait }, Uint8Array, void> {
    for (;;) {
      try {
        return this.src.read(at, len);
      } catch (e) {
        if (!(e instanceof Wait)) throw e;
        yield { wait: e };
      }
    }
  }

  // ── Text ──────────────────────────────────────────────────────────────

  text(start: Bytes, end: Bytes, max: number): { text: string; cut: boolean } {
    const stop = Math.min(end, this.src.size);
    const e = Math.min(stop, start + max);
    return { text: textOf(this.src, start, e - start), cut: e < stop };
  }

  // ── Find ──────────────────────────────────────────────────────────────

  /** Finds `query` (its UTF-8 bytes): batches of matches as the search goes, the last `done`. */
  *find(query: string, o: FindOptions): Generator<FindBatch | { wait: Wait }, void, void> {
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
    // (Small reads first: "find next" usually stops soon; then up to 4 MiB a read.)
    let chunk = 1 << 16;
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
          const buf = yield* this.reading(lo, Math.min(hi + len - 1, size) - lo);
          const ms: number[] = [];
          scanWindow(buf, lower, cs, first, firstU, hi - lo, (i) => ms.push(lo + i));
          const found: number[] = [];
          for (let m = ms.length - 1; m >= 0 && total < limit; m--, total++) found.push(ms[m]);
          scanned += hi - lo;
          hi = lo;
          chunk = Math.min(1 << 22, chunk * 4);
          if (found.length) yield { matches: Float64Array.from(found), length: len, scanned, done: false };
        }
      } else {
        for (let lo = a; lo < b && total < limit; ) {
          const hi = Math.min(b, lo + chunk);
          const buf = yield* this.reading(lo, Math.min(hi + len - 1, size) - lo);
          const found: number[] = [];
          scanWindow(buf, lower, cs, first, firstU, hi - lo, (i) => {
            if (total < limit) {
              found.push(lo + i);
              total++;
            }
          });
          scanned += hi - lo;
          lo = hi;
          chunk = Math.min(1 << 22, chunk * 4);
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
  /** Offsets in text of the strings standing for big values (stubs), with their records (one still being read: its node). */
  stubs: Map<number, Big & { node?: HugeNode }>;
  /** Per piece, null if ASCII (a unit a byte), else bytes at every STRIDE units of it (made when first asked). */
  wide: (Float64Array | null | undefined)[];
}

/** UTF-16 units between the byte offsets a wide piece keeps. */
const STRIDE = 256;

type Piece = string | [number, number] | (Big & { node?: HugeNode });

/** A text of pieces: byte ranges of `src` (decoded as the page decodes a file), strings, and stubs for big values. */
/** The byte after the closing quote of the string whose opening quote is at `at`. */
function nameEnd(src: ByteSource, at: number): number {
  for (let p = at + 1; p < src.size; ) {
    const b = src.read(p, Math.min(1 << 16, src.size - p));
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 92) i++;
      else if (b[i] === 34) return p + i + 1;
    }
    // (An escape's backslash at the end of a read: its character is the next read's first.)
    p += b.length + (b.length && b[b.length - 1] === 92 && !evenBackslashes(b) ? 1 : 0);
  }
  return src.size;
}

/** Whether the backslashes ending `b` pair up (none escapes what follows). */
function evenBackslashes(b: Uint8Array): boolean {
  let n = 0;
  for (let i = b.length - 1; i >= 0 && b[i] === 92; i--) n++;
  return n % 2 === 0;
}

/** Whether byte `pos` is in one of the [start, end) pairs of `d`. */
function inStretch(d: number[], pos: number): boolean {
  for (let j = 0; j < d.length; j += 2) if (pos >= d[j] && pos < d[j + 1]) return true;
  return false;
}

function build(src: ByteSource, pieces: Piece[]): Built {
  const parts: string[] = [];
  const map: number[] = [];
  const stubs = new Map<number, Big & { node?: HugeNode }>();
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
    wide = /[^\0-\x7f]/.test(b.text.slice(at, end)) ? utf8Table(b.text, at, end, STRIDE) : null;
    b.wide[lo] = wide;
  }
  // (utf8.ts: the page's rule too.)
  return wide ? byte + utf8At(b.text, wide, at, off, STRIDE) : byte + off - at;
}

/** The offset in a built text of document byte `pos`: in a piece, or in the stub standing for the big value holding it (-1: neither). */
function offsetOf(b: Built, pos: number, src: ByteSource): number {
  const m = b.map;
  for (let j = 0; j < m.length; j += 3) {
    const byte = m[j + 1];
    if (byte >= 0 && pos >= byte && pos < byte + m[j + 2]) return m[j] + utf16Units(src.read(byte, pos - byte));
  }
  for (const [at, big] of b.stubs) if (pos >= big.start && pos <= big.end) return pos === big.end ? at + 2 : at + 1;
  // (At the very end of a piece.)
  for (let j = 0; j < m.length; j += 3) if (m[j + 1] >= 0 && pos === m[j + 1] + m[j + 2]) return m[j] + utf16Units(src.read(m[j + 1], m[j + 2]));
  return -1;
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

/** A page's tape, as the page receives it. */
function receiverTape(p: HugePage): Tape {
  return receiver(p.tape)(Infinity)!;
}

function emptySent(): SentTape {
  return { nodes: new Int32Array(0), count: 0, text: new Uint16Array(0), offsets: new Int32Array(1), keyCount: 0, extraAt: new Int32Array(0), big: [], head: { issues: [], warnings: [], error: null, nodes: 0, depth: 0, exact: true, multi: false } };
}

