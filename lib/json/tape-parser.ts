/**
 * The JSON parser, building a tape (see tape.ts) instead of a JNode tree: no object or string
 * per value, so a document costs its tape (20 bytes per value) and little else while it parses.
 *
 * It gives exactly what parser.ts gives (the reference: same nodes, values, issues, warnings,
 * error, counts and flags; tests/tape-parser.test.ts checks it on every corpus and a fuzzer) in two
 * layers that share one state:
 * - A port of parser.ts (the "tolerant" parser) that does the same work in the same order, with
 *   node indexes in place of JNodes and values left in the source.
 * - A fast path for strict JSON (fast()): tight loops on locals over the same state. It stops at
 *   the first thing it doesn't take (anything loose, a closing call(…), the end of the top-level
 *   value) at a point where the tolerant parser has that very state (before a value, after one,
 *   or at a property name), and the tolerant parser goes on from there; the fast path takes over
 *   again a few values later. Nothing is parsed twice, and the output can't tell who parsed what.
 *
 * Nesting is limited only by memory (open containers are in the tape itself, plus 4 bytes per
 * level), unless `maxDepth` says otherwise.
 */
import { decodeNumber, decodeString } from './decode';
import { ARR, BOOL, NUL, NUM, OBJ, PASSES, STR, unescaped, type Issue, type ParseOptions, type Unescaped } from './parser';
import {
  KEY_INDEX,
  KEY_NAME,
  KEY_NONE,
  SIZE_BIG,
  VALUE_DECODE,
  VALUE_EXTRA,
  VALUE_FALSE,
  VALUE_NONE,
  VALUE_NULL,
  VALUE_RAW,
  VALUE_SLICE,
  VALUE_TRUE,
  W,
  emptyTape,
  fitted,
  valueOf,
  type Tape,
} from './tape';

export { decodeNumber, decodeString };

export interface TapeOptions extends ParseOptions {
  /** Deepest nesting parsed (the root is 0): deeper fails with "Nesting is too deep to parse". Default: as deep as memory allows. */
  maxDepth?: number;
}

/** A parse in steps (see `parser`). Dropping it cancels the parse. */
export interface TapeParser {
  /** Parses until the document is done (its tape; later calls return it again) or `until`, a `performance.now()` value, has passed (undefined). */
  step(until: number): Tape | undefined;
  /** The source offset reached so far (several top-level values: it goes over the first one twice). */
  at(): number;
}

class ParseError {
  p: number;
  m: string;
  constructor(p: number, m: string) {
    this.p = p;
    this.m = m;
  }
}

const MAX_ISSUES = 500;
/** Values parsed between looks at the clock. */
const STEP = 1024;
/** No depth limit. */
const UNLIMITED = 0x7fffffff;
// What comes next in the container being filled (see `cur`).
const FIRST = 0;
const VALUE = 1;
const AFTER = 2;
// value(): a call(…), whose argument comes next. fillObj/fillArr: the container closed; the run's values are used up.
const CALL = -2;
const CLOSED = -3;
const PAUSED = -4;
// str(): what a string has.
const ESCAPED = 1;
const CONTROL = 2;
const CUT = 4;
const INNER = 8;
/** Tolerant values at most between two tries of the fast path. */
const MAX_TOLERANT = 4096;

const isDigit = (c: number) => c >= 48 && c <= 57;
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
const isSmartQuote = (c: number) => c === 0x201c || c === 0x201d || c === 0x2018 || c === 0x2019;
const isExoticSpace = (c: number) =>
  c === 0xa0 ||
  c === 0xfeff ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200b) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000;
const isIdentStart = (c: number) =>
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  c === 95 ||
  c === 36 ||
  (c > 127 && !isExoticSpace(c) && !isSmartQuote(c));
const isIdent = (c: number) => isIdentStart(c) || isDigit(c);
const isKeyChar = (c: number) => isIdent(c) || c === 45 || c === 46;
const startsValue = (c: number) =>
  c === 123 ||
  c === 91 ||
  c === 34 ||
  c === 39 ||
  c === 96 ||
  c === 45 ||
  c === 43 ||
  c === 46 ||
  isDigit(c) ||
  isIdentStart(c) ||
  isSmartQuote(c);
/** A character that starts a strict JSON value (and that whitespace or comments never start). */
const startsStrict = (c: number) => c === 34 || c === 123 || c === 91 || c === 45 || (c >= 48 && c <= 57) || c === 116 || c === 102 || c === 110;

const INT_KEY = /^(?:0|[1-9]\d{0,9})$/;
/** JSON whitespace. */
const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/** parser.ts's isCanonical(src.slice(a, e)) (`String(Number(raw)) === raw`), without the slice. */
function canonicalAt(s: string, a: number, e: number): boolean {
  const neg = s.charCodeAt(a) === 45;
  const b = neg ? a + 1 : a;
  if (e - b > 15 || (neg && e - a === 2 && s.charCodeAt(b) === 48)) return false;
  let dot = false;
  for (let k = a; k < e; k++) {
    const c = s.charCodeAt(k);
    if (c === 101 || c === 69) return false;
    if (c === 46) dot = true;
  }
  if (!dot) return true;
  if (s.charCodeAt(e - 1) === 48) return false;
  // /^-?0\.000000/
  if (e - b >= 8 && s.charCodeAt(b) === 48 && s.charCodeAt(b + 1) === 46) {
    for (let k = b + 2; k < b + 8; k++) if (s.charCodeAt(k) !== 48) return true;
    return false;
  }
  return true;
}

/** INT_KEY.test(src.slice(a, e)) for a property name that starts with a digit. */
function intKeyAt(s: string, a: number, e: number): boolean {
  const len = e - a;
  if (len === 1) return true;
  if (s.charCodeAt(a) === 48 || len > 10) return false;
  for (let k = a + 1; k < e; k++) {
    const c = s.charCodeAt(k);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// ── API ──────────────────────────────────────────────────────────────────

/** Parses `text` in one go. */
export function parse(text: string, { lines: jsonLines = false, maxDepth: deepest = UNLIMITED, repair = false }: TapeOptions = {}): Tape {
  // (In runs all the same: the engine then optimizes the fast path as a function, rather than only
  // the loop it is in, which takes longer and is less sure.)
  begin(text, jsonLines, 65536, deepest);
  if (!repair) return steps(Infinity)!;
  const ps = new Passes(text, jsonLines, 65536, deepest);
  for (let t: Tape | null = null; ps.next(t); ) {
    t = steps(Infinity)!;
    if (!t.head.error) return ps.done(t);
  }
  return ps.plain!;
}

/**
 * Parses `text` in steps: call `step` with a deadline until it returns the tape. `every`: values
 * (and closed containers) between looks at the clock; tests stop after each one. With `repair`,
 * the passes of parse() one after the other (at() starts over with each).
 */
export function parser(text: string, { lines: jsonLines = false, maxDepth: deepest = UNLIMITED, repair = false }: TapeOptions = {}, every = STEP): TapeParser {
  begin(text, jsonLines, every, deepest);
  const ps = repair ? new Passes(text, jsonLines, every, deepest) : null;
  ps?.next(null);
  const state = save();
  let result: Tape | undefined;
  const step = (until: number): Tape | undefined => {
    if (result) return result;
    load(state);
    const t = steps(until);
    if (!t) save(state);
    else if (!ps || !t.head.error) result = ps ? ps.done(t) : t;
    else if (ps.next(t)) save(state);
    else result = ps.plain!;
    return result;
  };
  return { step, at: () => (result ? text.length : ps?.u && PASSES[ps.k][0] ? ps.u.map[state.i] : state.i) };
}

/** parser.ts's Passes: the passes of one parse with `repair` (PASSES). */
class Passes {
  k = -1;
  u: Unescaped | null | undefined = undefined;
  /** The tape of the text as is. */
  plain: Tape | undefined;
  constructor(
    readonly text: string,
    readonly lines: boolean,
    readonly every: number,
    readonly deepest: number,
  ) {}

  /** Begins the next pass after one that failed with `t` (null: the first): false if none is left. */
  next(t: Tape | null): boolean {
    for (;;) {
      this.k++;
      // (The text as is gives what the first pass gave if it repaired nothing.)
      if (this.k === 1 && !turnedLast) {
        this.plain = t!;
        continue;
      }
      if (this.k === 2) this.plain ??= t!;
      if (this.k >= PASSES.length) return false;
      const [esc, fix, quote, text] = PASSES[this.k];
      if (esc && (this.u ??= unescaped(this.text)) === null) return false;
      begin(esc ? this.u!.d : this.text, this.lines, this.every, this.deepest);
      fixing = fix;
      quoting = quote;
      prose = text;
      return true;
    }
  }

  /** Tape `t` of the current pass, as the tape of the parse. */
  done(t: Tape): Tape {
    return PASSES[this.k][0] ? remap(t, this.u!) : t;
  }
}

/** parser.ts's remap(): tape `t` of `u.d` with its offsets in the source (values it can't read back from there in `extra`). */
function remap(t: Tape, u: Unescaped): Tape {
  const m = u.map;
  const T = t.nodes;
  let extra = t.extra;
  for (let k = 0; k < t.count; k++) {
    const o = k * W;
    const vk = (T[o] >> 5) & 7;
    if (vk === VALUE_SLICE || vk === VALUE_RAW || vk === VALUE_DECODE) {
      (extra ??= new Map()).set(k, valueOf(t, k, u.d) as string);
      T[o] = (T[o] & ~(7 << 5)) | (VALUE_EXTRA << 5);
    }
    T[o + 1] = m[T[o + 1]];
    T[o + 2] = m[T[o + 2]];
  }
  const head = t.head;
  for (const x of head.issues) x.p = m[x.p];
  for (const x of head.warnings) x.p = m[x.p];
  head.issues.push({ p: u.at, m: 'JSON written as a string (escaped quotes): read with its escapes undone' });
  head.issues.sort((a, b) => a.p - b.p);
  if (head.issues.length > MAX_ISSUES) head.issues.length = MAX_ISSUES;
  head.exact = false;
  return { ...t, extra };
}

/** A small document that takes every path of the fast path. */
const WARM =
  '{"id":1,"name":"a b","esc":"q\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9","ok":true,"no":false,"x":null,"n":-1.5e3,"f":0.25,"z":0,"E":1E+2,"e2":2e-1,' +
  '"o":{},"l":[],"t":[1,"s",[2,3],{"a":{"a":1},"a":2}],"\\u0041":1,"7":2,"id":3,"w":{"k1":1,"k2":2,"k3":3,"k4":4,"k5":5,"k6":6,"k7":7,' +
  '"k8":8,"k9":9,"k10":{"k1":0},"k11":1,"k12":2,"k13":3,"k14":4,"k15":5,"k16":6,"k17":7,"k1":8}}';

/**
 * Runs every path of the parser on small documents (a few milliseconds), with both kinds of strings
 * engines keep (Latin-1 and UTF-16), so that the engine then optimizes it knowing them all. Call it
 * when idle, before the first big parse: else that parse runs slower code for a while each time it
 * takes a path for the first time.
 */
export function warmUp(): void {
  for (const doc of ['[' + WARM + ',\n ' + WARM + ' ]', '[' + WARM + ',\n "\u0100", ' + WARM + ' ]']) {
    parse(doc);
    parse(WARM + '\n' + WARM + '\r\n' + WARM + '\n');
    parse('{"a": [1,, 2], // c\n b: NaN, "c": f({"d": [1, 2]})}');
    const p = parser(doc, {}, 5);
    while (!p.step(0));
  }
}

// ── The parse being run ──────────────────────────────────────────────────
// As in parser.ts, one parse runs at a time and its state lives in these variables while it
// runs; a parse in steps keeps them in a State object in between.

const NONE = new Int32Array(0);

let src = '';
let n = 0;
let lines = false;
let every = STEP;
let maxDepth = UNLIMITED;
let i = 0;
let nodes = 0;
let depth = 0;
let exact = true;
let multi = false;
let issues: Issue[] = [];
let warnings: Issue[] = [];
// The container being filled (`wrap` at the top level: -1, or node 0 when JSON Lines are wrapped
// in an array), its depth (-1 at the top level of a document not wrapped), and what comes next in
// it (FIRST: a property name, or an item, at i; VALUE: the value of property `nextKey`, or the next
// item; AFTER: what follows a finished value, `ret` at the top level).
let cur = -1;
let curD = -1;
let mode = VALUE;
let nextKey = 0;
let ret = -1;
// Values (and closed containers) left in this run.
let left = 0;
// Open JSONP calls(…), innermost last: their argument's depth, and where the call starts.
let callD: number[] = [];
let callS: number[] = [];
// value() returned a container whose children come next.
let opened = false;
let fence = false;
let before = 0;
let start = 0;
let root = -1;
let wrap = -1;
/** 0: not started, 1: the top-level value, 2: JSON Lines (every top-level value, wrapped in an array). */
let phase = 0;
/** Values the tolerant parser takes before the fast path tries again (more while it keeps stopping at once). */
let tol = 1;
/** Repairing (ParseOptions.repair, after the parse failed without): the tolerant parser only. */
let fixing = false;
/** parser.ts's `quoting`, `prose`, `turned` and `turnedLast`. */
let quoting = false;
let prose = false;
let turned = false;
let turnedLast = false;

// The tape: W numbers per node in T (see tape.ts), `count` in use.
let T: Int32Array<ArrayBuffer> = NONE;
let count = 0;
let keys: string[] = [];
let big: Map<number, number> | null = null;
let extra: Map<number, string> | null = null;
// Where T last grew (see grow()).
let grownAt = 0;
let grownCount = 0;

// Property names: an open-addressing table of key index + 1 by hash (slot 0: empty), and per key its
// hash, length, source offset (where its text is in the source as is, else -1), and the last node
// with it as its key (or about to be: see dup()).
let kTable = NONE;
let kHash = NONE;
let kLen = NONE;
let kPos = NONE;
let lastSeen = NONE;
// The fast path guesses each property name before reading it, from the name that followed the
// previous one last time (or came first at that depth): per key, that next name (-1: none yet).
let follows = NONE;

// Per depth: children so far of the open container there, the first property name of the last
// object there and, while a member's value is a container, the member's name (for the guesses), and
// the key sets of wide objects (see dup()).
let cc = NONE;
let firsts = NONE;
let kd = NONE;
let sets: Map<number, KeySet> = new Map();

interface KeySet {
  /** The object (node index). */
  owner: number;
  keys: Set<number>;
  /** Its next member to add, and members added. */
  next: number;
  added: number;
}

function begin(text: string, jsonLines: boolean, perRun: number, deepest: number) {
  src = text;
  n = text.length;
  lines = jsonLines;
  every = perRun;
  maxDepth = deepest;
  i = nodes = depth = before = start = phase = 0;
  exact = true;
  multi = opened = fence = false;
  issues = [];
  warnings = [];
  cur = curD = ret = root = wrap = -1;
  mode = VALUE;
  nextKey = 0;
  callD = [];
  callS = [];
  tol = 1;
  fixing = quoting = prose = turned = false;
  T = NONE;
  count = grownAt = grownCount = 0;
  keys = [];
  big = extra = null;
  kTable = kHash = kLen = kPos = lastSeen = follows = cc = firsts = kd = NONE;
  sets = new Map();
  if (text) {
    cc = new Int32Array(64);
    firsts = new Int32Array(64);
    kd = new Int32Array(64);
    restart();
  }
}

/** Empties the tape and its property names (JSON Lines start over). */
function restart() {
  count = grownAt = grownCount = 0;
  keys = [];
  big = extra = null;
  kTable = new Int32Array(64);
  kHash = new Int32Array(32);
  kLen = new Int32Array(32);
  kPos = new Int32Array(32);
  lastSeen = new Int32Array(32);
  follows = new Int32Array(32);
  firsts.fill(-1);
  sets = new Map();
}

interface State {
  src: string;
  n: number;
  lines: boolean;
  every: number;
  maxDepth: number;
  i: number;
  nodes: number;
  depth: number;
  exact: boolean;
  multi: boolean;
  issues: Issue[];
  warnings: Issue[];
  cur: number;
  curD: number;
  mode: number;
  nextKey: number;
  ret: number;
  callD: number[];
  callS: number[];
  fence: boolean;
  before: number;
  start: number;
  root: number;
  wrap: number;
  phase: number;
  tol: number;
  fixing: boolean;
  quoting: boolean;
  prose: boolean;
  turned: boolean;
  T: Int32Array<ArrayBuffer>;
  count: number;
  keys: string[];
  big: Map<number, number> | null;
  extra: Map<number, string> | null;
  grownAt: number;
  grownCount: number;
  kTable: Int32Array<ArrayBuffer>;
  kHash: Int32Array<ArrayBuffer>;
  kLen: Int32Array<ArrayBuffer>;
  kPos: Int32Array<ArrayBuffer>;
  lastSeen: Int32Array<ArrayBuffer>;
  follows: Int32Array<ArrayBuffer>;
  cc: Int32Array<ArrayBuffer>;
  firsts: Int32Array<ArrayBuffer>;
  kd: Int32Array<ArrayBuffer>;
  sets: Map<number, KeySet>;
}

/** The running parse's state, into `state` (a new object without it). */
function save(state?: State): State {
  const s: State = {
    src,
    n,
    lines,
    every,
    maxDepth,
    i,
    nodes,
    depth,
    exact,
    multi,
    issues,
    warnings,
    cur,
    curD,
    mode,
    nextKey,
    ret,
    callD,
    callS,
    fence,
    before,
    start,
    root,
    wrap,
    phase,
    tol,
    fixing,
    quoting,
    prose,
    turned,
    T,
    count,
    keys,
    big,
    extra,
    grownAt,
    grownCount,
    kTable,
    kHash,
    kLen,
    kPos,
    lastSeen,
    follows,
    cc,
    firsts,
    kd,
    sets,
  };
  return state ? Object.assign(state, s) : s;
}

function load(s: State) {
  ({
    src,
    n,
    lines,
    every,
    maxDepth,
    i,
    nodes,
    depth,
    exact,
    multi,
    issues,
    warnings,
    cur,
    curD,
    mode,
    nextKey,
    ret,
    callD,
    callS,
    fence,
    before,
    start,
    root,
    wrap,
    phase,
    tol,
    fixing,
    quoting,
    prose,
    turned,
    T,
    count,
    keys,
    big,
    extra,
    grownAt,
    grownCount,
    kTable,
    kHash,
    kLen,
    kPos,
    lastSeen,
    follows,
    cc,
    firsts,
    kd,
    sets,
  } = s);
  opened = false;
}

/** Runs the loaded parse: its tape, or undefined when `until` has passed. */
function steps(until: number): Tape | undefined {
  try {
    if (phase === 0) {
      if (src.charCodeAt(0) === 0xfeff) {
        fix(0, 'Unexpected byte order mark (BOM)');
        i = 1;
      }
      ws();
      // parser.ts: with repairs, prose before a code fence is ignored.
      if (prose && i < n && !src.startsWith('```', i) && isText(i)) {
        const f = fenceLine(i);
        if (f >= 0) {
          fix(i, 'Text before the code fence was ignored');
          turned = true;
          i = f;
        }
      }
      if (src.startsWith('```', i)) {
        fix(i, 'Markdown code fences are not part of JSON');
        i = eol(i);
        fence = true;
        ws();
      }
      if (i >= n) return finish(null);
      before = issues.length;
      start = i;
      phase = 1;
    }
    for (;;) {
      left = every;
      if (drive()) return finish(null);
      if (performance.now() >= until) return undefined;
    }
  } catch (e) {
    if (e instanceof ParseError) return finish({ p: e.p, m: e.m });
    // Only memory can run out here: nothing recurses.
    if (e instanceof RangeError) return finish({ p: i, m: 'Not enough memory to parse this document' });
    throw e;
  }
}

/** Parses `left` values (or closes as many containers), or less if the document is done (true): the fast path wherever it can, the tolerant parser elsewhere. */
function drive(): boolean {
  for (;;) {
    if (!fixing && (mode !== AFTER || cur >= 0)) {
      const was = left;
      fast();
      if (left < 0) return false;
      // It stopped at something loose: if it does again at once, give the tolerant parser longer runs.
      tol = was - left >= 32 ? 1 : Math.min(tol * 2, MAX_TOLERANT);
    }
    const outer = left;
    const run1 = tol < outer ? tol : outer;
    left = run1;
    if (run()) return true;
    left = outer - run1;
    if (left <= 0) return false;
  }
}

function finish(error: Issue | null): Tape {
  if (error) root = -1;
  issues.sort((a, b) => a.p - b.p);
  // A wrapped document is not the source text, so the native formatting fast path can't apply.
  exact = exact && root >= 0 && !issues.length && !warnings.length && !multi;
  const head = { issues, warnings, error, nodes, depth, exact, multi: multi && root >= 0 };
  const tape: Tape = root >= 0 ? { nodes: fitted(T, count), count, keys, big, extra, head } : emptyTape(head);
  turnedLast = turned;
  // Nothing of it stays here.
  begin('', false, STEP, UNLIMITED);
  return tape;
}

// ── The tape ─────────────────────────────────────────────────────────────

/** T with room for `need` numbers, grown to about what the whole document needs (from how dense it has been), so the tape is copied once or twice at most. */
function grow(need: number, at: number, used: number): Int32Array<ArrayBuffer> {
  const have = T.length / W;
  let want: number;
  if (have === 0) want = 4096;
  else {
    // Nodes per character so far, and since the last growth (a document may get denser).
    const rate = Math.max(used / Math.max(at, 1), (used - grownCount) / Math.max(at - grownAt, 1));
    // (A small document gets more room to spare: its density varies more, and growing again costs
    // more than the room: big allocations are slow in WebKit.)
    want = Math.max(Math.ceil(used + (n - at) * rate * (1.04 + Math.min(0.2, 1e6 / n))) + 1024, Math.ceil(have * 1.125));
  }
  // At most one node per character, plus the array JSON Lines are wrapped in.
  want = Math.max(Math.min(want, n + 2), Math.ceil(need / W));
  const next = new Int32Array(want * W);
  next.set(T.subarray(0, used * W));
  grownAt = at;
  grownCount = used;
  T = next;
  return next;
}

/** A new node (the end and size of a container are set when it closes): its index. */
function node(kind: number, vk: number, s: number, e: number, d: number, u: number, kk: number, key: number): number {
  const o = count * W;
  if (o + W > T.length) grow(o + W, i, count);
  T[o] = kind | (kk << 3) | (vk << 5) | 256;
  T[o + 1] = s;
  T[o + 2] = e;
  T[o + 3] = u;
  T[o + 4] = key;
  if (u >= 0) cc[d - 1]++;
  return count++;
}

/** A container at depth `d` opened: its children are counted from 0. */
function enter(d: number) {
  if (d >= cc.length) {
    const size = Math.max(cc.length * 2, d + 1);
    const grown = (a: Int32Array<ArrayBuffer>, fill: number) => {
      const b = new Int32Array(size).fill(fill, a.length);
      b.set(a);
      return b;
    };
    cc = grown(cc, 0);
    firsts = grown(firsts, -1);
    kd = grown(kd, -1);
  }
  cc[d] = 0;
}

/** Sets container `p`'s size: every node since it is in its subtree. */
function sized(p: number, used: number) {
  const size = used - p;
  const o = p * W;
  if (size < SIZE_BIG) T[o] = (T[o] & 0xff) | (size << 8);
  else {
    (big ??= new Map()).set(p, size);
    T[o] = (T[o] & 0xff) | (SIZE_BIG << 8);
  }
}

const sizeAt = (c: number) => {
  const s = T[c * W] >>> 8;
  return s < SIZE_BIG ? s : big!.get(c)!;
};

/** Node `v`'s value can't be read back from where it now starts (a call(…) took its place): keep it in `extra`. */
function held(v: number) {
  const o = v * W;
  const meta = T[o];
  const vk = (meta >> 5) & 7;
  if (vk !== VALUE_SLICE && vk !== VALUE_RAW && vk !== VALUE_DECODE) return;
  const s = T[o + 1];
  const e = T[o + 2];
  const num = (meta & 7) === NUM;
  const v2 =
    vk === VALUE_SLICE ? (num ? src.slice(s, e) : src.slice(s + 1, e - 1)) : vk === VALUE_RAW ? src.slice(s, e) : num ? decodeNumber(src, s, e) : decodeString(src, s);
  (extra ??= new Map()).set(v, v2);
  T[o] = (meta & ~(7 << 5)) | (VALUE_EXTRA << 5);
}

// ── Property names ───────────────────────────────────────────────────────

const mix = (h: number) => {
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return h ^ (h >>> 16);
};

function hashText(t: string): number {
  let h = 0;
  for (let k = 0; k < t.length; k++) h = (Math.imul(h, 31) + t.charCodeAt(k)) | 0;
  return h;
}

function hashRange(s: string, a: number, e: number): number {
  let h = 0;
  for (let k = a; k < e; k++) h = (Math.imul(h, 31) + s.charCodeAt(k)) | 0;
  return h;
}

/** The key index of the property name s.slice(a, e) (written without escapes), whose hash is `h`. */
function internRange(s: string, a: number, e: number, h: number): number {
  const len = e - a;
  const mask = kTable.length - 1;
  for (let slot = mix(h) & mask; ; slot = (slot + 1) & mask) {
    const x = kTable[slot];
    if (x === 0) return addKey(s.slice(a, e), h, a, slot);
    const k = x - 1;
    if (kHash[k] !== h || kLen[k] !== len) continue;
    const b = kPos[k];
    let j = 0;
    if (b >= 0) while (j < len && s.charCodeAt(a + j) === s.charCodeAt(b + j)) j++;
    else {
      const t = keys[k];
      while (j < len && s.charCodeAt(a + j) === t.charCodeAt(j)) j++;
    }
    if (j === len) return k;
  }
}

/** The key index of property name `t`. */
function internText(t: string): number {
  const h = hashText(t);
  const len = t.length;
  const mask = kTable.length - 1;
  for (let slot = mix(h) & mask; ; slot = (slot + 1) & mask) {
    const x = kTable[slot];
    if (x === 0) return addKey(t, h, -1, slot);
    const k = x - 1;
    if (kHash[k] !== h || kLen[k] !== len) continue;
    const b = kPos[k];
    let j = 0;
    if (b >= 0) while (j < len && t.charCodeAt(j) === src.charCodeAt(b + j)) j++;
    else {
      const u = keys[k];
      while (j < len && t.charCodeAt(j) === u.charCodeAt(j)) j++;
    }
    if (j === len) return k;
  }
}

function addKey(t: string, h: number, pos: number, slot: number): number {
  const k = keys.length;
  keys.push(t);
  if (k === kHash.length) {
    const size = k * 2;
    const grown = (a: Int32Array<ArrayBuffer>) => {
      const b = new Int32Array(size);
      b.set(a);
      return b;
    };
    kHash = grown(kHash);
    kLen = grown(kLen);
    kPos = grown(kPos);
    lastSeen = grown(lastSeen);
    follows = grown(follows);
  }
  kHash[k] = h;
  kLen[k] = t.length;
  kPos[k] = pos;
  lastSeen[k] = -1;
  follows[k] = -1;
  kTable[slot] = k + 1;
  if ((k + 1) * 2 > kTable.length) {
    const table = new Int32Array(kTable.length * 2);
    const mask = table.length - 1;
    for (let j = 0; j <= k; j++) {
      let s = mix(kHash[j]) & mask;
      while (table[s] !== 0) s = (s + 1) & mask;
      table[s] = j + 1;
    }
    kTable = table;
  }
  return k;
}

/**
 * Whether object `p` (at depth `pd`, `m` members so far) already has a member named `k`. Mostly
 * one look at the last node named `k`: none in `p`'s subtree means no, one that is `p`'s member
 * means yes; one deeper in `p` means looking at `p`'s members (in a set once there are 16).
 */
function dup(p: number, pd: number, m: number, k: number): boolean {
  const last = lastSeen[k];
  if (last <= p) return false;
  if (T[last * W + 3] === p) return true;
  if (m < 16) {
    for (let c = p + 1, j = 0; j < m; j++, c += sizeAt(c)) if (T[c * W + 4] === k) return true;
    return false;
  }
  let set = sets.get(pd);
  if (!set || set.owner !== p) sets.set(pd, (set = { owner: p, keys: new Set(), next: p + 1, added: 0 }));
  for (; set.added < m; set.added++, set.next += sizeAt(set.next)) set.keys.add(T[set.next * W + 4]);
  return set.keys.has(k);
}

const duplicate = (at: number, k: number) => {
  if (warnings.length < MAX_ISSUES) {
    const key = keys[k];
    warnings.push({ p: at, m: `Duplicate key "${key.length > 40 ? key.slice(0, 40) + '…' : key}"` });
  }
};

// ── The fast path ────────────────────────────────────────────────────────

/**
 * Parses strict JSON from the current state, with everything in locals, until `left` runs out or
 * it meets what it doesn't take. Each step is a unit that it either finishes or doesn't start: a
 * value, a comma and what follows it up to the next value or property name, a property name and
 * its colon, a closing bracket. So when it stops, the state is the tolerant parser's own at that
 * point (before a value: VALUE; at a property name: FIRST; after a value: AFTER), and the
 * tolerant parser goes on as if it had parsed everything itself.
 */
function fast(): void {
  const s = src;
  const top = wrap;
  // A container closing at this depth closes calls(…) too: the tolerant parser does that. (No leaf
  // here can: the tolerant parser takes a call's argument right after the call, and the calls of
  // a leaf with it, so only a container argument still has its calls open while it fills.)
  const callTop = callD.length !== 0 ? callD[callD.length - 1] : -2;
  const deepest = maxDepth;
  const quote = quoting;
  let t = T;
  let at = i;
  let cnt = count;
  let p = cur;
  let pd = curD;
  let md = mode;
  let k = nextKey;
  let nd = nodes;
  let mx = depth;
  let ex = exact;
  let budget = left;
  let depths = cc;
  let names = kd;
  let first = firsts;
  let obj = p >= 0 && (t[p * W] & 7) === OBJ;
  let kb = p < 0 ? 0 : obj ? KEY_NAME << 3 : KEY_INDEX << 3;
  let m = pd >= 0 ? depths[pd] : 0;

  for (;;) {
    if (md === VALUE) {
      if (--budget < 0) break;
      let c = s.charCodeAt(at);
      while (c <= 32 && (c === 32 || c === 10 || c === 13 || c === 9)) c = s.charCodeAt(++at);
      const d = pd + 1;
      if (d > deepest) {
        budget++;
        break;
      }
      const o = cnt * W;
      if (o + W > t.length) t = grow(o + W, at, cnt);
      let meta: number;
      let e: number;
      if (c === 34) {
        const r = strictString(s, at + 1);
        if (r === -1) {
          budget++;
          break;
        }
        if (r >= 0) {
          meta = STR | (VALUE_SLICE << 5);
          e = r + 1;
        } else {
          meta = STR | (VALUE_DECODE << 5);
          e = ~r + 1;
        }
        // Repairing unescaped quotes: one followed by a word is the tolerant parser's.
        if (quote) {
          let x = e;
          let f = s.charCodeAt(x);
          while (f === 32 || f === 9) f = s.charCodeAt(++x);
          if ((f >= 65 && f <= 90) || (f >= 97 && f <= 122) || f === 95 || f === 36 || f > 127) {
            budget++;
            break;
          }
        }
      } else if ((c >= 48 && c <= 57) || c === 45) {
        let j = at;
        let ch = c;
        if (ch === 45) ch = s.charCodeAt(++j);
        if (ch === 48) {
          ch = s.charCodeAt(++j);
          // (Leading zeros, hexadecimal.)
          if ((ch >= 48 && ch <= 57) || ch === 120 || ch === 88) {
            budget++;
            break;
          }
        } else if (ch >= 49 && ch <= 57) {
          do ch = s.charCodeAt(++j);
          while (ch >= 48 && ch <= 57);
        } else {
          budget++;
          break;
        }
        if (ch === 46) {
          ch = s.charCodeAt(++j);
          if (!(ch >= 48 && ch <= 57)) {
            budget++;
            break;
          }
          do ch = s.charCodeAt(++j);
          while (ch >= 48 && ch <= 57);
        }
        if (ch === 101 || ch === 69) {
          ch = s.charCodeAt(++j);
          if (ch === 43 || ch === 45) ch = s.charCodeAt(++j);
          if (!(ch >= 48 && ch <= 57)) {
            budget++;
            break;
          }
          do ch = s.charCodeAt(++j);
          while (ch >= 48 && ch <= 57);
        }
        if (ex && !canonicalAt(s, at, j)) ex = false;
        meta = NUM | (VALUE_SLICE << 5);
        e = j;
      } else if (c === 123 || c === 91) {
        let j = at + 1;
        let ch = s.charCodeAt(j);
        while (ch <= 32 && (ch === 32 || ch === 10 || ch === 13 || ch === 9)) ch = s.charCodeAt(++j);
        if (ch === (c === 123 ? 125 : 93)) {
          // Empty: finished at once.
          meta = (c === 123 ? OBJ : ARR) | (VALUE_NONE << 5);
          e = j + 1;
        } else if (c === 123 ? ch === 34 : startsStrict(ch)) {
          // Open: its first property name or item comes next.
          t[o] = (c === 123 ? OBJ : ARR) | kb | (VALUE_NONE << 5) | 256;
          t[o + 1] = at;
          t[o + 2] = at;
          t[o + 3] = p;
          t[o + 4] = obj ? k : m;
          nd++;
          if (d > mx) mx = d;
          if (pd >= 0) {
            depths[pd] = m + 1;
            names[pd] = k;
          }
          if (d >= depths.length) {
            enter(d);
            depths = cc;
            names = kd;
            first = firsts;
          }
          p = cnt++;
          pd = d;
          m = 0;
          obj = c === 123;
          kb = obj ? KEY_NAME << 3 : KEY_INDEX << 3;
          at = j;
          md = obj ? FIRST : VALUE;
          continue;
        } else {
          budget++;
          break;
        }
      } else if (c === 116 && s.charCodeAt(at + 1) === 114 && s.charCodeAt(at + 2) === 117 && s.charCodeAt(at + 3) === 101 && ends(s.charCodeAt(at + 4))) {
        meta = BOOL | (VALUE_TRUE << 5);
        e = at + 4;
      } else if (c === 102 && s.charCodeAt(at + 1) === 97 && s.charCodeAt(at + 2) === 108 && s.charCodeAt(at + 3) === 115 && s.charCodeAt(at + 4) === 101 && ends(s.charCodeAt(at + 5))) {
        meta = BOOL | (VALUE_FALSE << 5);
        e = at + 5;
      } else if (c === 110 && s.charCodeAt(at + 1) === 117 && s.charCodeAt(at + 2) === 108 && s.charCodeAt(at + 3) === 108 && ends(s.charCodeAt(at + 4))) {
        meta = NUL | (VALUE_NULL << 5);
        e = at + 4;
      } else {
        budget++;
        break;
      }
      // A finished leaf (or empty container).
      t[o] = meta | kb | 256;
      t[o + 1] = at;
      t[o + 2] = e;
      t[o + 3] = p;
      t[o + 4] = obj ? k : m;
      at = e;
      cnt++;
      nd++;
      m++;
      if (d > mx) mx = d;
      md = AFTER;
      continue;
    }

    if (md === FIRST) {
      // A property name of object p at `at`, and its colon.
      const q = at;
      if (s.charCodeAt(q) !== 34) break;
      let key = -1;
      let j = 0;
      let esc = false;
      // The guess: the name that followed the previous member's last time (or came first here).
      const guess = m === 0 ? first[pd] : k >= 0 && k < keys.length ? follows[k] : -1;
      if (guess >= 0) {
        const b = kPos[guess];
        const len = kLen[guess];
        if (b >= 0 && s.charCodeAt(q + 1 + len) === 34) {
          let x = 0;
          while (x < len && s.charCodeAt(q + 1 + x) === s.charCodeAt(b + x)) x++;
          if (x === len) {
            key = guess;
            j = q + 1 + len;
          }
        }
      }
      if (key < 0) {
        const r = strictString(s, q + 1);
        if (r === -1) break;
        esc = r < 0;
        j = esc ? ~r : r;
      }
      let r = j + 1;
      let ch = s.charCodeAt(r);
      while (ch <= 32 && (ch === 32 || ch === 10 || ch === 13 || ch === 9)) ch = s.charCodeAt(++r);
      if (ch !== 58) break;
      if (key < 0) key = esc ? internText(decodeString(s, q)) : internRange(s, q + 1, j, hashRange(s, q + 1, j));
      if (ex && (esc || (s.charCodeAt(q + 1) >= 48 && s.charCodeAt(q + 1) <= 57 && intKeyAt(s, q + 1, j)))) ex = false;
      const last = lastSeen[key];
      if (last > p && (t[last * W + 3] === p || dup(p, pd, m, key))) duplicate(q, key);
      lastSeen[key] = cnt;
      if (m === 0) first[pd] = key;
      else if (k >= 0 && k < keys.length) follows[k] = key;
      k = key;
      at = r + 1;
      md = VALUE;
      continue;
    }

    // AFTER a value in p.
    if (p === top) {
      // The top-level value is done: the tolerant parser looks at what follows. (Not reading past the
      // end here keeps the engine from optimizing for that only to undo it at the end of every parse.)
      if (top < 0) {
        ret = 0;
        break;
      }
      // JSON Lines: the next line's value (the tolerant parser takes the second one: it reports the wrapping).
      let j = at;
      let c = j < s.length ? s.charCodeAt(j) : -1;
      while (c <= 32 && (c === 32 || c === 10 || c === 13 || c === 9)) c = ++j < s.length ? s.charCodeAt(j) : -1;
      if (m < 2 || !startsStrict(c)) break;
      at = j;
      md = VALUE;
      continue;
    }
    let j = at;
    let c = s.charCodeAt(j);
    while (c <= 32 && (c === 32 || c === 10 || c === 13 || c === 9)) c = s.charCodeAt(++j);
    if (c === 44) {
      let q = j + 1;
      let ch = s.charCodeAt(q);
      while (ch <= 32 && (ch === 32 || ch === 10 || ch === 13 || ch === 9)) ch = s.charCodeAt(++q);
      if (obj ? ch !== 34 : !startsStrict(ch)) break;
      at = q;
      md = obj ? FIRST : VALUE;
      continue;
    }
    if (c === (obj ? 125 : 93)) {
      if (pd === callTop || --budget < 0) break;
      // p closes: a finished value in its container.
      const po = p * W;
      t[po + 2] = at = j + 1;
      const size = cnt - p;
      if (size < SIZE_BIG) t[po] = (t[po] & 0xff) | (size << 8);
      else sized(p, cnt);
      p = t[po + 3];
      pd--;
      if (pd >= 0) {
        m = depths[pd];
        k = names[pd];
      } else m = 0;
      obj = p >= 0 && (t[p * W] & 7) === OBJ;
      kb = p < 0 ? 0 : obj ? KEY_NAME << 3 : KEY_INDEX << 3;
      continue;
    }
    break;
  }

  i = at;
  count = cnt;
  cur = p;
  curD = pd;
  if (pd >= 0) depths[pd] = m;
  mode = md;
  nextKey = k;
  nodes = nd;
  depth = mx;
  exact = ex;
  left = budget;
}

/**
 * The strict JSON string whose text starts at `j`: the index of its closing quote, or its
 * complement (~index, negative) if it has escapes; -1 if it isn't strict JSON (or doesn't end).
 */
function strictString(s: string, j: number): number {
  let esc = false;
  for (;;) {
    const c = s.charCodeAt(j);
    if (c === 34) return esc ? ~j : j;
    if (c === 92) {
      const e = s.charCodeAt(j + 1);
      if (e === 117) {
        if (!(isHex(s.charCodeAt(j + 2)) && isHex(s.charCodeAt(j + 3)) && isHex(s.charCodeAt(j + 4)) && isHex(s.charCodeAt(j + 5)))) return -1;
        j += 6;
      } else if (e === 34 || e === 92 || e === 47 || e === 98 || e === 102 || e === 110 || e === 114 || e === 116) j += 2;
      else return -1;
      esc = true;
      continue;
    }
    // (NaN past the end, too.)
    if (!(c >= 32)) return -1;
    j++;
  }
}

/** Whether `c` can follow true, false or null (parser.ts's word(): not part of a longer name; anything non-ASCII is left to the tolerant parser). */
const ends = (c: number) => !(c > 127 || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36);

// ── The tolerant parser (parser.ts, writing the tape) ────────────────────

const fix = (p: number, m: string) => {
  if (issues.length < MAX_ISSUES) issues.push({ p, m });
};
const fail = (p: number, m: string): never => {
  throw new ParseError(p, m);
};
const describe = (p: number) => {
  const cp = src.codePointAt(p) ?? 0;
  if (cp < 32 || cp === 127) return `control character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return `'${String.fromCodePoint(cp)}'`;
};
const eol = (p: number) => {
  const j = src.indexOf('\n', p);
  return j < 0 ? n : j;
};
const atLineStart = (p: number) => {
  let k = p - 1;
  while (k >= 0 && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k--;
  return k < 0 || src.charCodeAt(k) === 10 || src.charCodeAt(k) === 13;
};

const ws = () => {
  for (;;) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9) {
      i++;
    } else if (c === 47) {
      const c2 = src.charCodeAt(i + 1);
      if (c2 === 47) {
        fix(i, 'Comments are not allowed in JSON');
        i = eol(i);
      } else if (c2 === 42) {
        fix(i, 'Comments are not allowed in JSON');
        const j = src.indexOf('*/', i + 2);
        i = j < 0 ? n : j + 2;
      } else return;
    } else if (c === 35 && (atLineStart(i) || src.charCodeAt(i - 1) === 32 || src.charCodeAt(i - 1) === 9)) {
      fix(i, 'Comments are not allowed in JSON');
      i = eol(i);
    } else if (c === 11 || c === 12 || (c > 127 && isExoticSpace(c))) {
      fix(i, `Invalid whitespace character U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
      i++;
    } else return;
  }
};

const word = (w: string) => {
  if (src.startsWith(w, i) && !isIdent(src.charCodeAt(i + w.length))) {
    i += w.length;
    return true;
  }
  return false;
};

/** A leaf ending here. */
const leaf = (t: number, vk: number, s: number, d: number, u: number, kk: number, key: number) => node(t, vk, s, i, d, u, kk, key);

/** A leaf ending here whose value `v` the source can't give back (repairs): kept in `extra`. */
const kept = (t: number, v: string, s: number, d: number, u: number, kk: number, key: number) => {
  const nd = leaf(t, VALUE_EXTRA, s, d, u, kk, key);
  (extra ??= new Map()).set(nd, v);
  return nd;
};

/** The leaf of a string from `s` that str() just read (`found`). */
const strLeaf = (found: number, s: number, d: number, u: number, kk: number, key: number) =>
  found & (CUT | INNER) ? kept(STR, textOf(s, found), s, d, u, kk, key) : leaf(STR, found & ESCAPED ? VALUE_DECODE : VALUE_SLICE, s, d, u, kk, key);

/** Goes over an escape (i is after the backslash), reporting what parser.ts does. */
const esc = () => {
  const c = src.charCodeAt(i++);
  switch (c) {
    case 34:
    case 92:
    case 47:
    case 98:
    case 102:
    case 110:
    case 114:
    case 116:
      return;
    case 117:
      if (isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1)) && isHex(src.charCodeAt(i + 2)) && isHex(src.charCodeAt(i + 3))) {
        i += 4;
        return;
      }
      fix(i - 2, 'Invalid unicode escape: expected \\u followed by 4 hex digits');
      return;
  }
  if (i > n) {
    // (Repairing: the string ends with this backslash, at the end of the input.)
    if (fixing) {
      i = n;
      return;
    }
    fail(i - 2, 'Unterminated string: missing closing quote');
  }
  if (c === 120 && isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1))) {
    fix(i - 2, 'Invalid escape \\x: use \\u00XX instead');
    i += 2;
    return;
  }
  if (c === 10 || c === 13) {
    fix(i - 2, 'Line continuations are not allowed in JSON strings');
    if (c === 13 && src.charCodeAt(i) === 10) i++;
    return;
  }
  fix(i - 2, `Invalid escape sequence \\${String.fromCharCode(c)}`);
};

/**
 * Goes over a string starting at the opening quote; `q`/`q2` are the accepted closing quotes.
 * ESCAPED if it has escapes (its value is not the text between the quotes), | CONTROL if it has
 * control characters, | CUT if repairing closed it where it has no closing quote (it ends at i),
 * | INNER if repairing kept quotes inside it.
 */
const str = (q: number, q2: number): number => {
  const s = i;
  let found = 0;
  i++;
  for (;;) {
    if (i >= n) {
      if (fixing) {
        fix(n, 'Missing closing quote: the string was closed at the end of the input');
        return found | CUT;
      }
      fail(s, 'Unterminated string: missing closing quote');
    }
    const c = src.charCodeAt(i);
    if (c === q || c === q2) {
      // parser.ts: with repairs, a quote followed by a word is inside the string.
      if (quoting && q === 34 && wordAfter(i + 1)) {
        fix(i, 'Unescaped quote inside a string (kept in it)');
        turned = true;
        found |= INNER;
        i++;
        continue;
      }
      i++;
      if (fixing && !(found & ESCAPED)) {
        const k = unclosed(s + 1, i - 1);
        if (k >= 0) {
          fix(k, `Missing closing quote: the string was closed before the '${src[k]}'`);
          i = k;
          return found | CUT;
        }
      }
      return found;
    }
    if (c === 92) {
      i++;
      esc();
      found |= ESCAPED;
      continue;
    }
    if (c < 32) {
      if (fixing && (c === 10 || c === 13)) {
        fix(i, 'Missing closing quote: the string was closed at the end of the line');
        return found | CUT;
      }
      fix(i, c === 10 || c === 13 ? 'Line breaks inside strings must be escaped as \\n' : 'Control characters inside strings must be escaped');
      found |= CONTROL;
    }
    i++;
  }
};

/** parser.ts's unclosed(): repairing, where a string without escapes ([a, e), closing quote at e) should end, or -1. */
const unclosed = (a: number, e: number): number => {
  let j = e + 1;
  while (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9) j++;
  const f = src.charCodeAt(j);
  if (!(f === 34 || f === 39 || f === 96 || isSmartQuote(f) || isIdent(f))) return -1;
  for (let k = a; k < e; k++) {
    const c = src.charCodeAt(k);
    if (c === 44 || c === 125 || c === 93) {
      while (issues.length && issues[issues.length - 1].p >= k) issues.pop();
      return k;
    }
  }
  return -1;
};

/** The value of the string str() just read from `s` (`found`: what str() returned). */
const textOf = (s: number, found: number): string =>
  found & CUT
    ? found & ESCAPED
      ? decodeUntil(s, i)
      : src.slice(s + 1, i)
    : found & INNER
      ? decodeUntil(s, i - 1)
      : found & ESCAPED
        ? decodeString(src, s)
        : src.slice(s + 1, i - 1);

/** parser.ts's wordAfter(): whether a word starts at `p`, after spaces or tabs on the same line. */
const wordAfter = (p: number): boolean => {
  while (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9) p++;
  return isIdentStart(src.charCodeAt(p));
};

/** parser.ts's LITERALS: words that stand for values. */
const LITERALS = new Set(['true', 'false', 'null', 'True', 'TRUE', 'False', 'FALSE', 'None', 'NULL', 'Null', 'nil', 'undefined', 'NaN', 'Infinity', 'tru', 'ture', 'treu', 'rtue', 'fals', 'flase', 'fasle', 'fales', 'nul', 'nulll', 'nill', 'nll']);

/** parser.ts's isText(): whether the text at `p` is prose rather than a value. */
const isText = (p: number): boolean => {
  const c = src.charCodeAt(p);
  if (c === 125 || c === 93) return false;
  if (!startsValue(c)) return true;
  if (!isIdentStart(c)) return false;
  let e = p;
  while (e < n && isIdent(src.charCodeAt(e))) e++;
  if (LITERALS.has(src.slice(p, e))) return false;
  while (src.charCodeAt(e) === 32 || src.charCodeAt(e) === 9) e++;
  return src.charCodeAt(e) !== 40;
};

/** parser.ts's fenceLine(): where a line starting with ``` begins from `p` on, or -1. */
const fenceLine = (p: number): number => {
  for (let k = src.indexOf('```', p); k >= 0; k = src.indexOf('```', k + 3)) {
    let j = k - 1;
    while (j >= 0 && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9)) j--;
    if (j < 0 || src.charCodeAt(j) === 10 || src.charCodeAt(j) === 13) return k;
  }
  return -1;
};

/** decodeString() of a string that repairing cut at `end` (it has no closing quote): parser.ts's str() and esc() up to there. */
function decodeUntil(start: number, end: number): string {
  let k = start + 1;
  let seg = k;
  let out = '';
  while (k < end) {
    if (src.charCodeAt(k) !== 92) {
      k++;
      continue;
    }
    out += src.slice(seg, k);
    const e = src.charCodeAt(k + 1);
    k += 2;
    // (A backslash that ends the input stands for nothing.)
    if (k > end) {
      seg = k = end;
      break;
    }
    switch (e) {
      case 34:
        out += '"';
        break;
      case 92:
        out += '\\';
        break;
      case 47:
        out += '/';
        break;
      case 98:
        out += '\b';
        break;
      case 102:
        out += '\f';
        break;
      case 110:
        out += '\n';
        break;
      case 114:
        out += '\r';
        break;
      case 116:
        out += '\t';
        break;
      case 117:
        if (isHex(src.charCodeAt(k)) && isHex(src.charCodeAt(k + 1)) && isHex(src.charCodeAt(k + 2)) && isHex(src.charCodeAt(k + 3))) {
          out += String.fromCharCode(parseInt(src.slice(k, k + 4), 16));
          k += 4;
        } else out += 'u';
        break;
      default:
        if (e === 120 && isHex(src.charCodeAt(k)) && isHex(src.charCodeAt(k + 1))) {
          out += String.fromCharCode(parseInt(src.slice(k, k + 2), 16));
          k += 2;
        } else if (e === 10 || e === 13) {
          if (e === 13 && src.charCodeAt(k) === 10) k++;
        } else out += String.fromCharCode(e);
    }
    seg = k;
  }
  return out + src.slice(seg, end);
}

/** A string's value (a property name). */
const strText = (q: number, q2: number): string => {
  const s = i;
  return textOf(s, str(q, q2));
};

/** Goes over a number: VALUE_SLICE if its value is its text, VALUE_DECODE if it is written loosely. */
const num = (): number => {
  const s = i;
  let clean = true;
  let c = src.charCodeAt(i);
  if (c === 45 || c === 43) {
    if (c === 43) {
      fix(i, "Numbers can't start with '+'");
      clean = false;
    }
    c = src.charCodeAt(++i);
  }
  if (c === 48) {
    c = src.charCodeAt(++i);
    if (c === 120 || c === 88) {
      const hs = ++i;
      while (isHex(src.charCodeAt(i))) i++;
      if (i === hs) fail(i, 'Invalid hexadecimal number');
      fix(s, 'Hexadecimal numbers are not allowed in JSON');
      return VALUE_DECODE;
    }
    if (isDigit(c)) {
      fix(s, "Numbers can't have leading zeros");
      clean = false;
      while (isDigit(src.charCodeAt(i))) i++;
    }
  } else if (c >= 49 && c <= 57) {
    do c = src.charCodeAt(++i);
    while (isDigit(c));
  } else if (c === 46 && isDigit(src.charCodeAt(i + 1))) {
    fix(i, 'Numbers need a digit before the decimal point');
    clean = false;
  } else {
    fail(i, i >= n ? 'Unexpected end of input: expected a number' : `Invalid number: unexpected ${describe(i)}`);
  }
  c = src.charCodeAt(i);
  if (c === 46) {
    c = src.charCodeAt(++i);
    if (isDigit(c)) {
      do c = src.charCodeAt(++i);
      while (isDigit(c));
    } else {
      fix(i - 1, 'Numbers need a digit after the decimal point');
      clean = false;
    }
  }
  if (c === 101 || c === 69) {
    c = src.charCodeAt(++i);
    if (c === 43 || c === 45) c = src.charCodeAt(++i);
    if (!isDigit(c)) fail(i, 'Expected a digit in the exponent');
    do c = src.charCodeAt(++i);
    while (isDigit(c));
  }
  if (exact && !canonicalAt(src, s, i)) exact = false;
  return clean ? VALUE_SLICE : VALUE_DECODE;
};

const looseKey = (c: number): string => {
  if (c === 39) {
    fix(i, 'Property names must use double quotes');
    return strText(39, 39);
  }
  if (c === 0x201c || c === 0x201d) {
    fix(i, 'Property names must use straight double quotes (")');
    return strText(0x201d, 0x201c);
  }
  if (c === 0x2018 || c === 0x2019) {
    fix(i, 'Property names must use straight double quotes (")');
    return strText(0x2019, 0x2018);
  }
  if (c === 96) {
    fix(i, 'Property names must use double quotes');
    return strText(96, 96);
  }
  if (isIdentStart(c) || isDigit(c) || c === 45) {
    const s = i;
    while (i < n && isKeyChar(src.charCodeAt(i))) i++;
    fix(s, 'Property names must be wrapped in double quotes');
    return src.slice(s, i);
  }
  if (i >= n) fail(i, 'Unexpected end of input: expected a property name');
  return fail(i, `Expected a property name in double quotes, found ${describe(i)}`);
};

/** At `c` (not `]`) in an array, after `[` or a comma: true if an item is next, false if empty slots ran into `]` (consumed). */
const item = (c: number): boolean => {
  while (c === 44) {
    fix(i, 'Missing value in array');
    i++;
    ws();
    c = src.charCodeAt(i);
    if (c === 93) {
      i++;
      return false;
    }
  }
  return true;
};

/** A value that isn't strict JSON at `c`; CALL when it is a call(…), whose argument is the value to parse next. */
const loose = (c: number, d: number, u: number, kk: number, key: number): number => {
  const s = i;
  if (c === 39) {
    fix(i, 'Strings must use double quotes');
    return strLeaf(str(39, 39), s, d, u, kk, key);
  }
  if (c === 0x201c || c === 0x201d) {
    fix(i, 'Strings must use straight double quotes (")');
    return strLeaf(str(0x201d, 0x201c), s, d, u, kk, key);
  }
  if (c === 0x2018 || c === 0x2019) {
    fix(i, 'Strings must use straight double quotes (")');
    return strLeaf(str(0x2019, 0x2018), s, d, u, kk, key);
  }
  if (c === 96) {
    fix(i, 'Strings must use double quotes');
    return strLeaf(str(96, 96), s, d, u, kk, key);
  }
  if (c === 43 || c === 45 || c === 46) {
    if (fixing && c === 46 && kk === KEY_NAME && src.startsWith('...', i)) {
      fix(s, "Placeholder '...' (null)");
      i += 3;
      return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
    }
    if (c !== 46 && src.startsWith('Infinity', i + 1)) {
      fix(s, 'Infinity is not valid JSON (replaced with null)');
      i += 9;
      return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
    }
    return leaf(NUM, num(), s, d, u, kk, key);
  }
  if (isIdentStart(c)) {
    while (i < n && isIdent(src.charCodeAt(i))) i++;
    const w = src.slice(s, i);
    switch (w) {
      case 'True':
      case 'TRUE':
        fix(s, `Use lowercase true instead of ${w}`);
        return leaf(BOOL, VALUE_TRUE, s, d, u, kk, key);
      case 'False':
      case 'FALSE':
        fix(s, `Use lowercase false instead of ${w}`);
        return leaf(BOOL, VALUE_FALSE, s, d, u, kk, key);
      case 'None':
      case 'NULL':
      case 'Null':
      case 'nil':
        fix(s, `Use null instead of ${w}`);
        return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
      case 'undefined':
      case 'NaN':
      case 'Infinity':
        fix(s, `${w} is not valid JSON (replaced with null)`);
        return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
      // Typos of the literals: repair to what was obviously meant.
      case 'tru':
      case 'ture':
      case 'treu':
      case 'rtue':
        fix(s, `Unexpected '${w}'. Did you mean true?`);
        return leaf(BOOL, VALUE_TRUE, s, d, u, kk, key);
      case 'fals':
      case 'flase':
      case 'fasle':
      case 'fales':
        fix(s, `Unexpected '${w}'. Did you mean false?`);
        return leaf(BOOL, VALUE_FALSE, s, d, u, kk, key);
      case 'nul':
      case 'nulll':
      case 'nill':
      case 'nll':
        fix(s, `Unexpected '${w}'. Did you mean null?`);
        return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
    }
    const end = i;
    while (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9) i++;
    if (src.charCodeAt(i) === 40) {
      // JSONP callback(…) or wrappers such as ObjectId("…") / ISODate("…")
      fix(s, `${w}(…) is not valid JSON (only its argument is kept)`);
      i++;
      ws();
      if (src.charCodeAt(i) === 41) {
        i++;
        return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
      }
      // Its argument takes this value's place (same depth, container and key): see closeCalls().
      callD.push(d);
      callS.push(s);
      return CALL;
    }
    i = end;
    while (i < n) {
      const ch = src.charCodeAt(i);
      if (ch === 44 || ch === 125 || ch === 93 || ch === 10 || ch === 13) break;
      // `value // comment` or `value /* comment */` (but keep URLs such as http://x)
      if (ch === 47) {
        const nx = src.charCodeAt(i + 1);
        const pv = src.charCodeAt(i - 1);
        if ((nx === 47 || nx === 42) && (pv === 32 || pv === 9)) break;
      }
      i++;
    }
    let e = i;
    while (e > s && (src.charCodeAt(e - 1) === 32 || src.charCodeAt(e - 1) === 9)) e--;
    const text = src.slice(s, e);
    fix(s, `Unexpected '${text.length > 24 ? text.slice(0, 24) + '…' : text}': strings must be wrapped in double quotes`);
    return node(STR, VALUE_RAW, s, e, d, u, kk, key);
  }
  // Repairing, a property's missing value: null.
  if (fixing && kk === KEY_NAME) {
    if (i >= n) {
      fix(n, 'Unexpected end of input: the value is missing (null)');
      return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
    }
    if (c === 44 || c === 125 || c === 93) {
      fix(i, 'The value is missing (null)');
      return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
    }
  }
  if (i >= n) fail(i, 'Unexpected end of input: expected a value');
  return fail(i, `Unexpected ${describe(i)}: expected a value`);
};

const skipTail = () => {
  for (;;) {
    ws();
    const c = src.charCodeAt(i);
    if (c === 59 || c === 44) {
      fix(i, `Unexpected ${describe(i)}`);
      i++;
    } else if (fence && src.startsWith('```', i)) {
      // closing fence: whatever follows (usually prose) is not part of the document
      i += 3;
      ws();
      if (i < n) fix(i, 'Text after the closing code fence was ignored');
      i = n;
    } else return;
  }
};

/** JSON Lines: true if another top-level value is next (in `wrap`), false at the end. */
const nextLine = (): boolean => {
  ws();
  while (src.charCodeAt(i) === 44 || src.charCodeAt(i) === 59) {
    i++;
    ws();
  }
  if (i >= n || (fence && src.startsWith('```', i))) {
    T[wrap * W + 2] = i;
    sized(wrap, count);
    root = wrap;
    skipTail();
    return false;
  }
  if (cc[0] === 1) fix(i, 'Multiple top-level values (wrapped in an array)');
  return true;
};

/** A finished top-level value: true if the parse is complete. */
const topLevel = (r: number): boolean => {
  if (phase === 2) return !nextLine();
  root = r;
  skipTail();
  // parser.ts: with repairs, prose after the value is ignored, rather than read as JSON Lines.
  if (prose && !lines && i < n && isText(i)) {
    fix(i, 'Text after the JSON value was ignored');
    turned = true;
    i = n;
    return true;
  }
  if ((i < n && startsValue(src.charCodeAt(i))) || lines) {
    // Several top-level values (NDJSON / JSON Lines): re-parse them into one array.
    multi = true;
    issues = issues.slice(0, before);
    warnings = [];
    nodes = 1;
    depth = 0;
    i = start;
    restart();
    wrap = node(ARR, VALUE_NONE, start, start, 0, -1, KEY_NONE, 0);
    enter(0);
    phase = 2;
    return !nextLine();
  }
  if (i < n) {
    let c = src.charCodeAt(i);
    while (c === 125 || c === 93) {
      fix(i, `Unexpected ${describe(i)} after the JSON value`);
      i++;
      ws();
      c = src.charCodeAt(i);
    }
    if (i < n) fail(i, `Unexpected ${describe(i)} after the JSON value`);
  }
  return true;
};

/** An object at `{`: empty (closed), or its first property comes next (`opened`). */
const openObj = (d: number, u: number, kk: number, key: number): number => {
  const nd = node(OBJ, VALUE_NONE, i, i, d, u, kk, key);
  i++;
  ws();
  let c = src.charCodeAt(i);
  while (c === 44) {
    fix(i, 'Unexpected comma');
    i++;
    ws();
    c = src.charCodeAt(i);
  }
  if (c === 125) {
    i++;
    T[nd * W + 2] = i;
  } else {
    opened = true;
    enter(d);
  }
  return nd;
};

/** An array at `[`: empty (closed), or its first item comes next (`opened`). */
const openArr = (d: number, u: number, kk: number, key: number): number => {
  const nd = node(ARR, VALUE_NONE, i, i, d, u, kk, key);
  i++;
  ws();
  const c = src.charCodeAt(i);
  if (c === 93) {
    i++;
    T[nd * W + 2] = i;
  } else if (item(c)) {
    opened = true;
    enter(d);
  } else T[nd * W + 2] = i;
  return nd;
};

/** parser.ts's value() up to a container's first child: a finished value, a container whose first property or item comes next (`opened`), or CALL. */
const value = (d: number, u: number, kk: number, key: number): number => {
  ws();
  const s = i;
  const c = src.charCodeAt(i);
  nodes++;
  if (d > depth) {
    if (d > maxDepth) fail(i, 'Nesting is too deep to parse');
    depth = d;
  }
  if (c === 34) {
    const found = str(34, 34);
    if (fixing) {
      // parser.ts's joined(): strings that follow joined by `+`.
      let v: string | undefined;
      for (;;) {
        let j = i;
        while (isSpace(src.charCodeAt(j))) j++;
        if (src.charCodeAt(j) !== 43) break;
        let k = j + 1;
        while (isSpace(src.charCodeAt(k))) k++;
        if (src.charCodeAt(k) !== 34) break;
        v ??= textOf(s, found);
        fix(j, "Strings joined with '+' (not valid JSON)");
        i = k;
        const s2 = i;
        v += textOf(s2, str(34, 34));
      }
      if (v !== undefined) return kept(STR, v, s, d, u, kk, key);
    }
    return strLeaf(found, s, d, u, kk, key);
  }
  if (c === 123) return openObj(d, u, kk, key);
  if (c === 91) return openArr(d, u, kk, key);
  if (isDigit(c) || (c === 45 && src.charCodeAt(i + 1) !== 73)) return leaf(NUM, num(), s, d, u, kk, key);
  if (c === 116 && word('true')) return leaf(BOOL, VALUE_TRUE, s, d, u, kk, key);
  if (c === 102 && word('false')) return leaf(BOOL, VALUE_FALSE, s, d, u, kk, key);
  if (c === 110 && word('null')) return leaf(NUL, VALUE_NULL, s, d, u, kk, key);
  return loose(c, d, u, kk, key);
};

/** A finished value `v` at depth `d` is the argument of the calls(…) open there: it takes their place. */
const closeCalls = (v: number, d: number): number => {
  while (callD.length !== 0 && callD[callD.length - 1] === d) {
    callD.pop();
    const s = callS.pop()!;
    nodes--;
    ws();
    if (src.charCodeAt(i) === 41) i++;
    else fix(i, "Expected ')'");
    held(v);
    T[v * W + 1] = s;
    T[v * W + 2] = i;
  }
  return v;
};

/**
 * parser.ts's obj() loop for object `p` (at depth `pd`), from `mode`: CLOSED when `p` closes,
 * PAUSED when the run's values are used up (`mode` and `nextKey` keep the place), or a child
 * container whose children come next (`opened`).
 */
const fillObj = (p: number, pd: number): number => {
  const d = pd + 1;
  let m = mode;
  let key = 0;
  for (;;) {
    if (m === VALUE) key = nextKey;
    else {
      let c: number;
      if (m === AFTER) {
        ws();
        c = src.charCodeAt(i);
        if (c === 44) {
          const cp = i++;
          ws();
          c = src.charCodeAt(i);
          while (c === 44) {
            fix(i, 'Unexpected extra comma');
            i++;
            ws();
            c = src.charCodeAt(i);
          }
          if (c === 125) {
            fix(cp, 'Trailing commas are not allowed');
            i++;
            return CLOSED;
          }
          if (i >= n) {
            fix(cp, 'Trailing commas are not allowed');
            fix(n, "Unexpected end of input: missing '}'");
            return CLOSED;
          }
          if (c === 93) {
            fix(cp, 'Trailing commas are not allowed');
            fix(i, "Expected '}' to close the object, found ']'");
            return CLOSED;
          }
        } else if (c === 125) {
          i++;
          return CLOSED;
        } else if (i >= n) {
          fix(n, "Unexpected end of input: missing '}'");
          return CLOSED;
        } else if (c === 93) {
          fix(i, "Expected '}' to close the object, found ']'");
          return CLOSED;
        } else if (c === 34 || c === 39 || c === 96 || isIdentStart(c) || isSmartQuote(c)) {
          fix(i, "Expected ',' between properties");
        } else fail(i, `Expected ',' or '}' after property value, found ${describe(i)}`);
      } else c = src.charCodeAt(i);
      // Repairing: a `...` placeholder for members is skipped.
      if (fixing && c === 46 && src.startsWith('...', i)) {
        fix(i, "Placeholder '...' was skipped");
        i += 3;
        m = AFTER;
        continue;
      }
      // A property name and its colon.
      const ks = i;
      const had = keys.length;
      if (c === 34) {
        const found = str(34, 34);
        // (Only a name written in strict JSON is kept as source text: the fast path matches others against it.)
        key = found & (ESCAPED | CUT | INNER) ? internText(textOf(ks, found)) : found ? internText(src.slice(ks + 1, i - 1)) : internRange(src, ks + 1, i - 1, hashRange(src, ks + 1, i - 1));
      } else key = internText(looseKey(c));
      const name = keys[key];
      // Not natively reproducible: integer-like keys (JS reorders them) and keys written with
      // escapes (V8 13.x JSON.parse can misread "\n" as "\" after seeing a key containing "\").
      if (exact && (i - ks !== name.length + 2 || (isDigit(name.charCodeAt(0)) && INT_KEY.test(name)))) exact = false;
      if (dup(p, pd, cc[pd], key)) duplicate(ks, key);
      // (Its value will be the next node.)
      lastSeen[key] = count;
      ws();
      c = src.charCodeAt(i);
      if (c === 58) i++;
      else if (i >= n) {
        if (!fixing) fail(i, "Unexpected end of input: expected ':' after property name");
        // Repairing: a property cut off after its name is left out (and so is its name, if new).
        fix(ks, `Unexpected end of input: "${name.length > 40 ? name.slice(0, 40) + '…' : name}" has no value (left out)`);
        fix(n, "Unexpected end of input: missing '}'");
        keys.length = had;
        return CLOSED;
      }
      else if (c === 61) {
        fix(i, "Expected ':' after property name");
        i++;
      } else if (startsValue(c)) fix(i, "Expected ':' after property name");
      else fail(i, `Expected ':' after property name, found ${describe(i)}`);
    }
    // Its value.
    if (--left < 0) {
      mode = VALUE;
      nextKey = key;
      return PAUSED;
    }
    let v = value(d, p, KEY_NAME, key);
    while (v === CALL) v = value(d, p, KEY_NAME, key);
    if (opened) return v;
    if (callD.length !== 0) closeCalls(v, d);
    m = AFTER;
  }
};

/** parser.ts's arr() loop for array `p` (at depth `pd`), from `mode` (as fillObj). */
const fillArr = (p: number, pd: number): number => {
  const d = pd + 1;
  let after = mode === AFTER;
  for (;;) {
    if (after) {
      ws();
      let c = src.charCodeAt(i);
      if (c === 44) {
        const cp = i++;
        ws();
        c = src.charCodeAt(i);
        if (c === 93) {
          fix(cp, 'Trailing commas are not allowed');
          i++;
          return CLOSED;
        }
        if (i >= n) {
          fix(cp, 'Trailing commas are not allowed');
          fix(n, "Unexpected end of input: missing ']'");
          return CLOSED;
        }
        if (c === 125) {
          fix(cp, 'Trailing commas are not allowed');
          fix(i, "Expected ']' to close the array, found '}'");
          return CLOSED;
        }
        if (!item(c)) return CLOSED;
      } else if (c === 93) {
        i++;
        return CLOSED;
      } else if (i >= n) {
        fix(n, "Unexpected end of input: missing ']'");
        return CLOSED;
      } else if (c === 125) {
        fix(i, "Expected ']' to close the array, found '}'");
        return CLOSED;
      } else if (startsValue(c)) fix(i, "Expected ',' between array items");
      else fail(i, `Expected ',' or ']' after array item, found ${describe(i)}`);
    }
    // An item (after `[`, value() already went past empty slots).
    if (--left < 0) {
      mode = VALUE;
      return PAUSED;
    }
    // Repairing: a `...` placeholder for items is skipped.
    if (fixing) {
      ws();
      if (src.startsWith('...', i)) {
        fix(i, "Placeholder '...' was skipped");
        i += 3;
        after = true;
        continue;
      }
    }
    const k = cc[pd];
    let v = value(d, p, KEY_INDEX, k);
    while (v === CALL) v = value(d, p, KEY_INDEX, k);
    if (opened) return v;
    if (callD.length !== 0) closeCalls(v, d);
    after = true;
  }
};

/**
 * parser.ts's run(): parses `left` values (or closes as many containers), or less if the document
 * is done (true). One container at a time, children in a loop: nothing recurses.
 */
const run = (): boolean => {
  for (;;) {
    const p = cur;
    let x: number;
    if (p === wrap) {
      // The top level (`wrap` is -1 until JSON Lines wrap their values).
      if (mode === AFTER) x = ret;
      else {
        if (--left < 0) return false;
        const d = curD + 1;
        const kk = p < 0 ? KEY_NONE : KEY_INDEX;
        const key = p < 0 ? 0 : cc[0];
        x = value(d, p, kk, key);
        while (x === CALL) x = value(d, p, kk, key);
        if (!opened) x = closeCalls(x, d);
      }
      if (!opened) {
        ret = -1;
        if (topLevel(x)) return true;
        // JSON Lines: the next value goes in `wrap`.
        cur = wrap;
        curD = 0;
        mode = VALUE;
        continue;
      }
      opened = false;
    } else {
      x = (T[p * W] & 7) === OBJ ? fillObj(p, curD) : fillArr(p, curD);
      if (x === PAUSED) return false;
      if (x === CLOSED) {
        // `p` closed: it is the finished value for its own container.
        T[p * W + 2] = i;
        sized(p, count);
        ret = closeCalls(p, curD);
        cur = T[p * W + 3];
        curD--;
        mode = AFTER;
        if (--left < 0) return false;
        continue;
      }
      opened = false;
    }
    // Into a container: its first property or item comes next.
    cur = x;
    curD++;
    mode = FIRST;
  }
};
