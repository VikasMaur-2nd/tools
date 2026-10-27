/**
 * Lossless, tolerant JSON parser.
 *
 * - Produces a node tree that keeps numbers as their exact source text (no
 *   precision loss for big integers / long decimals) and keeps duplicate keys.
 * - Records source offsets for every node so the editor and tree stay in sync.
 * - Parses "loose" JSON (comments, trailing commas, single quotes, unquoted
 *   keys, Python literals, NDJSON, JSONP, code fences, …). Every deviation from
 *   strict JSON is recorded as an issue, so one pass gives both the strict
 *   verdict (first issue = the error a strict parser would report) and a
 *   repaired tree.
 * - Nesting is limited only by memory, and a big document can be parsed in
 *   short steps (`parser`) so the page stays responsive.
 */

export const NUL = 0;
export const BOOL = 1;
export const NUM = 2;
export const STR = 3;
export const ARR = 4;
export const OBJ = 5;
export type Kind = 0 | 1 | 2 | 3 | 4 | 5;

export type Key = string | number | undefined;
export type Val = null | boolean | string | JNode[];

export class JNode {
  /** kind */
  t: Kind;
  /** `v`, or undefined for a container made from a tape whose children aren't made yet (see lazy.ts) */
  _v: Val | undefined;
  /** source start / end offsets */
  s: number;
  e: number;
  /** depth (root = 0) */
  d: number;
  /** parent */
  u: JNode | null;
  /** property name (objects) or index (arrays); undefined for the root */
  key: Key;
  /** expanded in the tree view */
  x = false;
  /** Made from a tape: its tape and source (see lazy.ts), else null. */
  z: TapeLink | null = null;
  /** Its node index in that tape. */
  zi = 0;

  constructor(t: Kind, v: Val | undefined, s: number, d: number, u: JNode | null, key: Key) {
    this.t = t;
    this._v = v;
    this.s = s;
    this.e = s;
    this.d = d;
    this.u = u;
    this.key = key;
  }

  /** value: raw number text, decoded string, boolean, null or children */
  get v(): Val {
    const v = this._v;
    return v === undefined ? this.z!.fill(this) : v;
  }

  set v(v: Val) {
    this._v = v;
  }
}

/**
 * What a node made from a tape knows of it (see lazy.ts). Code that walks a big tree asks it instead:
 * the tape's code loads only when a worker sends a tape, so the views don't import it.
 */
export interface TapeLink {
  /** Makes `n`'s value (a container's children, or a long string's text) and returns it. */
  fill(n: JNode): Val;
  /** The first `max` units of string `n`'s value, decoding no more of it than that. */
  head(n: JNode, max: number): string;
  /** How many nodes of `n`'s subtree are at most `levels` below it. */
  within(n: JNode, levels: number): number;
  /** Calls `f` with the key of each of `n`'s children, without making them. */
  childKeys(n: JNode, f: (key: Key) => void): void;
  /** The tree search (TreeView) under `n`: matching tape indexes, in document order, at most `max`. */
  search(n: JNode, qn: string, cs: boolean, max: number): number[];
  /** The node at tape index `i` under `root` (made with its ancestors), or null. */
  nodeAt(root: JNode, i: number): JNode | null;
  /** Source start of tape index `i`. */
  start(i: number): number;
  /** Start and end offsets of the container `nodeAt(root, off)` is or is in (null: none), making no node. */
  containerAt(off: number): [number, number] | null;
}

export const kids = (n: JNode) => n.v as JNode[];
export const isContainer = (n: JNode) => n.t >= ARR;
/** A stack overflow: "Maximum call stack size exceeded" (RangeError) in Chrome and Safari, "too much recursion" (InternalError) in Firefox. */
export const tooDeep = (e: unknown) => (e instanceof RangeError || (e as Error | null)?.name === 'InternalError') && /call stack|recursion/i.test((e as Error).message);

export interface Issue {
  p: number;
  m: string;
}

export interface ParseResult {
  root: JNode | null;
  /** Non-strict constructs that were tolerated, in source order. */
  issues: Issue[];
  /** Valid but suspicious (duplicate keys). */
  warnings: Issue[];
  /** Unrecoverable error. */
  error: Issue | null;
  nodes: number;
  depth: number;
  /**
   * True when JSON.parse + JSON.stringify would reproduce this document exactly
   * (strict, no duplicate keys, canonical numbers, no integer-like keys that JS
   * would reorder, no escapes in keys); enables the native fast path for
   * formatting.
   */
  exact: boolean;
  /** Several top-level values (or one, with `lines`) were wrapped in one array: NDJSON / JSON Lines. */
  multi: boolean;
}

export interface ParseOptions {
  /** JSON Lines input (a .jsonl / .ndjson file): wrap the values in an array even when there is only one. */
  lines?: boolean;
  /**
   * When the document can't be parsed (an error), parse it again repairing what is left (see
   * `fixing`): strings missing their closing quote, members cut off at the end, missing values,
   * `...` placeholders, strings joined with `+`. Each repair is an issue. A document that parses
   * without repairs gives the same result either way.
   */
  repair?: boolean;
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
/**
 * Deepest nesting parsed, the same in every browser (the recursive parser stopped where the call
 * stack ran out: 2,200 to 25,000 levels). About 270 bytes of tree per level, so at most ~27 MB.
 */
export const MAX_DEPTH = 100_000;

/** The error of a document with no value: empty, or only whitespace, a byte order mark or comments. */
export const NO_VALUE = 'No JSON value';
/**
 * Deepest nesting the features that still walk a tree recursively work on (Convert, Compare and the
 * spreadsheet exports), the same in every browser and far from any stack limit. Their cost grows with the
 * square of the depth (2,000 nested objects convert in about 0.2 s in V8), so a deeper document is refused
 * at once with a clear message rather than after seconds of work or a stack overflow.
 */
export const MAX_WALK_DEPTH = 2_000;

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

const INT_KEY = /^(?:0|[1-9]\d{0,9})$/;
/** JSON whitespace. */
const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/** Whether `String(Number(raw)) === raw`, decided without converting. */
function isCanonical(raw: string): boolean {
  const len = raw.length - (raw.charCodeAt(0) === 45 ? 1 : 0);
  if (len > 15 || raw === '-0') return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 101 || c === 69) return false;
  }
  const dot = raw.indexOf('.');
  if (dot >= 0 && (raw.charCodeAt(raw.length - 1) === 48 || /^-?0\.000000/.test(raw))) return false;
  return true;
}

/** Normalizes a loosely written number (`+1`, `.5`, `1.`, `007`) to valid JSON. */
export function normalizeNumber(raw: string): string {
  let sign = '';
  let r = raw;
  if (r[0] === '+' || r[0] === '-') {
    if (r[0] === '-') sign = '-';
    r = r.slice(1);
  }
  let exp = '';
  const ei = r.search(/[eE]/);
  if (ei >= 0) {
    exp = 'e' + r.slice(ei + 1);
    r = r.slice(0, ei);
  }
  const dot = r.indexOf('.');
  let ip = dot < 0 ? r : r.slice(0, dot);
  const fp = dot < 0 ? '' : r.slice(dot + 1);
  ip = ip.replace(/^0+(?=\d)/, '') || '0';
  return sign + ip + (fp ? '.' + fp : '') + exp;
}

/** A parse in steps (see `parser`). Dropping it cancels the parse. */
export interface Parser {
  /** Parses until the document is done (its result; later calls return it again) or `until`, a `performance.now()` value, has passed (undefined). */
  step(until: number): ParseResult | undefined;
  /** The source offset reached so far (several top-level values: it goes over the first one twice). */
  at(): number;
}

/** Values parsed between looks at the clock. */
const STEP = 1024;
/** Containers filled recursively below where a run starts (see run()): far from any engine's stack limit. */
const LEVELS = 256;
// What comes next in the container being filled (see `cur`).
const FIRST = 0;
const VALUE = 1;
const AFTER = 2;

/** Parses `text` in one go. */
export function parse(text: string, { lines: jsonLines = false, repair = false }: ParseOptions = {}): ParseResult {
  begin(text, jsonLines, STEP);
  if (!repair) return steps(Infinity)!;
  const ps = new Passes(text, jsonLines, STEP);
  for (let r: ParseResult | null = null; ps.next(r); ) {
    r = steps(Infinity)!;
    if (!r.error) return ps.done(r);
  }
  return ps.plain!;
}

/**
 * Parses `text` in steps: call `step` with a deadline until it returns the result. Open
 * containers are kept in the tree itself (each node links to its container) rather than on
 * the call stack, so nesting is limited only by memory and a step can stop between any two
 * values. Each step mirrors the recursive-descent parser this replaced (tests/oracle/parser.ts)
 * in the same order, so the tree, issues, counts and errors are exactly what it gave. `every`:
 * values (and closed containers) between looks at the clock; tests stop after each one. With
 * `repair`, the passes of parse() one after the other (at() starts over with each).
 */
export function parser(text: string, { lines: jsonLines = false, repair = false }: ParseOptions = {}, every = STEP): Parser {
  begin(text, jsonLines, every);
  const ps = repair ? new Passes(text, jsonLines, every) : null;
  ps?.next(null);
  const state = save();
  let result: ParseResult | undefined;
  const step = (until: number): ParseResult | undefined => {
    if (result) return result;
    load(state);
    const r = steps(until);
    if (!r) save(state);
    else if (!ps || !r.error) result = ps ? ps.done(r) : r;
    else if (ps.next(r)) save(state);
    else result = ps.plain!;
    return result;
  };
  return { step, at: () => (result ? text.length : ps?.u && PASSES[ps.k][0] ? ps.u.map[state.i] : state.i) };
}

/**
 * The passes of a parse with `repair`, each [on the text with escapes undone, fixing, quoting,
 * prose]: the first repairs unescaped quotes and prose around the value; if it fails, the text as is
 * (what a parse without repairs gives, kept if every pass fails), then repairing what fails; then
 * the same two on JSON written as a string.
 */
export const PASSES: [boolean, boolean, boolean, boolean][] = [
  [false, false, true, true],
  [false, false, false, false],
  [false, true, false, true],
  [true, false, true, true],
  [true, true, false, true],
];

/** The passes of one parse with `repair`. */
class Passes {
  k = -1;
  u: Unescaped | null | undefined = undefined;
  /** The result of the text as is. */
  plain: ParseResult | undefined;
  constructor(
    readonly text: string,
    readonly lines: boolean,
    readonly every: number,
  ) {}

  /** Begins the next pass after one that failed with `r` (null: the first): false if none is left. */
  next(r: ParseResult | null): boolean {
    for (;;) {
      this.k++;
      // (The text as is gives what the first pass gave if it repaired nothing.)
      if (this.k === 1 && !turnedLast) {
        this.plain = r!;
        continue;
      }
      if (this.k === 2) this.plain ??= r!;
      if (this.k >= PASSES.length) return false;
      const [esc, fix, quote, text] = PASSES[this.k];
      if (esc && (this.u ??= unescaped(this.text)) === null) return false;
      begin(esc ? this.u!.d : this.text, this.lines, this.every);
      fixing = fix;
      quoting = quote;
      prose = text;
      return true;
    }
  }

  /** Result `r` of the current pass, as the result of the parse. */
  done(r: ParseResult): ParseResult {
    return PASSES[this.k][0] ? remap(r, this.u!) : r;
  }
}

/** `text` read as the content of a JSON string (with escapes undone), and where each of its characters (and its end) comes from. */
export interface Unescaped {
  d: string;
  map: Int32Array;
  /** The first escaped quote. */
  at: number;
}

/**
 * `text` with one level of escapes undone, if it is JSON written as a string (every quote is escaped:
 * `{\"a\": 1}`) and every escape is valid; else null. (Ordinary JSON holding an escaped quote in a value
 * isn't: undoing its escapes would cut that value apart.)
 */
export function unescaped(text: string): Unescaped | null {
  const q = text.indexOf('"');
  if (q < 1 || text.charCodeAt(q - 1) !== 92) return null;
  const at = q - 1;
  const map = new Int32Array(text.length + 1);
  let d = '';
  let k = 0;
  let seg = 0;
  for (let j = 0; j < text.length; ) {
    const x = text.charCodeAt(j);
    if (x !== 92) {
      // (A quote not escaped: this is JSON itself, not JSON written as a string.)
      if (x === 34) return null;
      map[k++] = j++;
      continue;
    }
    d += text.slice(seg, j);
    const e = text.charCodeAt(j + 1);
    let c: string;
    let len = 2;
    switch (e) {
      case 34:
        c = '"';
        break;
      case 92:
        c = '\\';
        break;
      case 47:
        c = '/';
        break;
      case 98:
        c = '\b';
        break;
      case 102:
        c = '\f';
        break;
      case 110:
        c = '\n';
        break;
      case 114:
        c = '\r';
        break;
      case 116:
        c = '\t';
        break;
      case 117:
        if (!(isHex(text.charCodeAt(j + 2)) && isHex(text.charCodeAt(j + 3)) && isHex(text.charCodeAt(j + 4)) && isHex(text.charCodeAt(j + 5)))) return null;
        c = String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16));
        len = 6;
        break;
      default:
        return null;
    }
    d += c;
    map[k++] = j;
    j += len;
    seg = j;
  }
  d += text.slice(seg);
  map[k] = text.length;
  return { d, map, at };
}

/** Result `r` of `u.d`, with its offsets in the source, and the issue that says how it was read. */
function remap(r: ParseResult, u: Unescaped): ParseResult {
  const m = u.map;
  const todo = r.root ? [r.root] : [];
  while (todo.length) {
    const x = todo.pop()!;
    x.s = m[x.s];
    x.e = m[x.e];
    if (x.t >= ARR) for (const c of x.v as JNode[]) todo.push(c);
  }
  for (const x of r.issues) x.p = m[x.p];
  for (const x of r.warnings) x.p = m[x.p];
  r.issues.push({ p: u.at, m: 'JSON written as a string (escaped quotes): read with its escapes undone' });
  r.issues.sort((a, b) => a.p - b.p);
  if (r.issues.length > MAX_ISSUES) r.issues.length = MAX_ISSUES;
  r.exact = false;
  return r;
}

// ── The parse being run ──────────────────────────────────────────────────
// One parse runs at a time, so its state lives in these variables while it runs: plain functions
// over them are shared by every parse (the engine optimizes them once, not per parse). A parse in
// steps keeps them in a State object in between (see save() and load()).

let src = '';
let n = 0;
let lines = false;
let every = STEP;
let i = 0;
let nodes = 0;
let depth = 0;
let exact = true;
let multi = false;
let issues: Issue[] = [];
let warnings: Issue[] = [];
// The container being filled (`wrap` at the top level: null, or the array JSON Lines are wrapped
// in) and what comes next in it: its first property or item (FIRST), the value of `nextKey` or the
// next item (VALUE), or what follows `ret`, a finished value it hasn't taken (AFTER). Open
// containers need no stack of their own: each node links to its container (`u`).
let cur: JNode | null = null;
let mode = VALUE;
let nextKey: Key = undefined;
let ret: JNode | null = null;
// Values (and closed containers) left in this run.
let left = 0;
// Per depth, the keys of the open object there once it has 16 (smaller ones are scanned).
let sets: (Set<string> | null)[] = [];
// Open JSONP calls(…), innermost last: their argument's depth, and where the call starts.
let callD: number[] = [];
let callS: number[] = [];
// value() returned a container whose children come next.
let opened = false;
let fence = false;
let before = 0;
let start = 0;
let root: JNode | null = null;
let wrap: JNode | null = null;
/** 0: not started, 1: the top-level value, 2: JSON Lines (every top-level value, wrapped in an array). */
let phase = 0;
/** Repairing (ParseOptions.repair, after the parse failed without). */
let fixing = false;
/** With ParseOptions.repair: a quote followed by a word is inside its string (see str()). */
let quoting = false;
/** With ParseOptions.repair: text that isn't JSON around the value is ignored (see topLevel(), steps()). */
let prose = false;
/** One of `quoting` or `prose` repaired something (and `turnedLast` when the parse that did finished). */
let turned = false;
let turnedLast = false;

function begin(text: string, jsonLines: boolean, perRun: number) {
  src = text;
  n = text.length;
  lines = jsonLines;
  every = perRun;
  i = nodes = depth = before = start = phase = 0;
  exact = true;
  multi = opened = fence = false;
  issues = [];
  warnings = [];
  cur = ret = root = wrap = null;
  mode = VALUE;
  nextKey = undefined;
  sets = [];
  callD = [];
  callS = [];
  fixing = quoting = prose = turned = false;
}

interface State {
  src: string;
  n: number;
  lines: boolean;
  every: number;
  i: number;
  nodes: number;
  depth: number;
  exact: boolean;
  multi: boolean;
  issues: Issue[];
  warnings: Issue[];
  cur: JNode | null;
  mode: number;
  nextKey: Key;
  ret: JNode | null;
  sets: (Set<string> | null)[];
  callD: number[];
  callS: number[];
  fence: boolean;
  before: number;
  start: number;
  root: JNode | null;
  wrap: JNode | null;
  phase: number;
  fixing: boolean;
  quoting: boolean;
  prose: boolean;
  turned: boolean;
}

/** The running parse's state, into `state` (a new object without it). */
function save(state?: State): State {
  const s: State = { src, n, lines, every, i, nodes, depth, exact, multi, issues, warnings, cur, mode, nextKey, ret, sets, callD, callS, fence, before, start, root, wrap, phase, fixing, quoting, prose, turned };
  return state ? Object.assign(state, s) : s;
}

function load(s: State) {
  ({ src, n, lines, every, i, nodes, depth, exact, multi, issues, warnings, cur, mode, nextKey, ret, sets, callD, callS, fence, before, start, root, wrap, phase, fixing, quoting, prose, turned } = s);
  opened = false;
}

/** Runs the loaded parse: its result, or undefined when `until` has passed. */
function steps(until: number): ParseResult | undefined {
  try {
    if (phase === 0) {
      if (src.charCodeAt(0) === 0xfeff) {
        fix(0, 'Unexpected byte order mark (BOM)');
        i = 1;
      }
      ws();
      // With repairs: prose before a code fence (an LLM's reply) is ignored.
      if (prose && i < n && !src.startsWith('```', i) && isText(i)) {
        const f = fenceLine(i);
        if (f >= 0 && proseUntil(i, f)) {
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
    // (A step always makes progress. Short runs keep run() a hot function the engine optimizes as such.)
    while (!run()) if (performance.now() >= until) return undefined;
    return finish(null);
  } catch (e) {
    if (e instanceof ParseError) return finish({ p: e.p, m: e.m });
    if (e instanceof RangeError || (e as Error)?.name === 'InternalError') return finish({ p: i, m: 'Nesting is too deep to parse' });
    throw e;
  }
}

function finish(error: Issue | null): ParseResult {
  // (An editor shows a blank document as empty: its callers check for that before they parse.)
  if (!error && !root) error = { p: n, m: NO_VALUE };
  if (error) root = null;
  issues.sort((a, b) => a.p - b.p);
  // A wrapped document is not the source text, so the native formatting fast path can't apply.
  exact = exact && !!root && !issues.length && !warnings.length && !multi;
  const res = { root, issues, warnings, error, nodes, depth, exact, multi: multi && !!root };
  turnedLast = turned;
  // Nothing of it stays here.
  begin('', false, STEP);
  return res;
}

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

const leaf = (t: Kind, v: Val, s: number, d: number, u: JNode | null, key: Key) => {
  const nd = new JNode(t, v, s, d, u, key);
  nd.e = i;
  return nd;
};

const esc = (): string => {
  const c = src.charCodeAt(i++);
  switch (c) {
    case 34:
      return '"';
    case 92:
      return '\\';
    case 47:
      return '/';
    case 98:
      return '\b';
    case 102:
      return '\f';
    case 110:
      return '\n';
    case 114:
      return '\r';
    case 116:
      return '\t';
    case 117:
      if (isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1)) && isHex(src.charCodeAt(i + 2)) && isHex(src.charCodeAt(i + 3))) {
        const v = parseInt(src.slice(i, i + 4), 16);
        i += 4;
        return String.fromCharCode(v);
      }
      fix(i - 2, 'Invalid unicode escape: expected \\u followed by 4 hex digits');
      return 'u';
  }
  if (i > n) {
    // (Repairing: the string ends with this backslash, at the end of the input.)
    if (fixing) {
      i = n;
      return '';
    }
    fail(i - 2, 'Unterminated string: missing closing quote');
  }
  if (c === 120 && isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1))) {
    fix(i - 2, 'Invalid escape \\x: use \\u00XX instead');
    const v = parseInt(src.slice(i, i + 2), 16);
    i += 2;
    return String.fromCharCode(v);
  }
  if (c === 10 || c === 13) {
    fix(i - 2, 'Line continuations are not allowed in JSON strings');
    if (c === 13 && src.charCodeAt(i) === 10) i++;
    return '';
  }
  fix(i - 2, `Invalid escape sequence \\${String.fromCharCode(c)}`);
  return String.fromCharCode(c);
};

/** Reads a string starting at the opening quote; `q`/`q2` are the accepted closing quotes. */
const str = (q: number, q2 = q): string => {
  const s = i;
  let seg = ++i;
  let out = '';
  let plain = true;
  // (With repairs: where a string with quotes inside closes, see innerClose().)
  let inner = -1;
  for (;;) {
    if (i >= n) {
      if (fixing) {
        fix(n, 'Missing closing quote: the string was closed at the end of the input');
        return out + src.slice(seg, i);
      }
      fail(s, 'Unterminated string: missing closing quote');
    }
    const c = src.charCodeAt(i);
    if (c === q || c === q2) {
      // With repairs: a quote followed by a word (`"say "hi" now"`) is inside the string.
      if (quoting && q === 34 && (i < inner || (inner = innerClose(i)) > i)) {
        fix(i, 'Unescaped quote inside a string (kept in it)');
        turned = true;
        i++;
        continue;
      }
      out += src.slice(seg, i);
      i++;
      if (fixing && plain) {
        const k = unclosed(s + 1, i - 1);
        if (k >= 0) {
          fix(k, `Missing closing quote: the string was closed before the '${src[k]}'`);
          i = k;
          return src.slice(s + 1, k);
        }
      }
      return out;
    }
    if (c === 92) {
      out += src.slice(seg, i);
      i++;
      out += esc();
      seg = i;
      plain = false;
      continue;
    }
    if (c < 32) {
      if (fixing && (c === 10 || c === 13)) {
        fix(i, 'Missing closing quote: the string was closed at the end of the line');
        return out + src.slice(seg, i);
      }
      fix(i, c === 10 || c === 13 ? 'Line breaks inside strings must be escaped as \\n' : 'Control characters inside strings must be escaped');
    }
    i++;
  }
};

/** Whether a word starts at `p`, after spaces or tabs on the same line. */
const wordAfter = (p: number): boolean => {
  while (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9) p++;
  return isIdentStart(src.charCodeAt(p));
};

/** Words that stand for values (the loose ones too, see loose()). */
const LITERALS = new Set(['true', 'false', 'null', 'True', 'TRUE', 'False', 'FALSE', 'None', 'NULL', 'Null', 'nil', 'undefined', 'NaN', 'Infinity', 'tru', 'ture', 'treu', 'rtue', 'fals', 'flase', 'fasle', 'fales', 'nul', 'nulll', 'nill', 'nll']);

/** Whether the text at `p` is prose rather than a value: not a bracket, not what starts a value, or a word that is not a value nor a call(…). */
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

/** Where a line starting with ``` (after spaces) begins from `p` on, or -1. */
const fenceLine = (p: number): number => {
  for (let k = src.indexOf('```', p); k >= 0; k = src.indexOf('```', k + 3)) {
    let j = k - 1;
    while (j >= 0 && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9)) j--;
    if (j < 0 || src.charCodeAt(j) === 10 || src.charCodeAt(j) === 13) return k;
  }
  return -1;
};

/**
 * With repairs, if the quote at `p` is inside its string (`"say "hi" now"`), where the string closes; else -1.
 * Inside: a word follows it, the string goes on to the next quote on the same line with no JSON between
 * (no , : [ ] { } and no escape), and so on until a quote that is followed by what can follow a string
 * (, } ] : or the line's end). Else the quote closes the string as without repairs: `["x" y, "z"]` is three
 * values, `{a: "x" b: "y"}` two members, `"hi "x""` a string and an empty one.
 */
const innerClose = (p: number): number => {
  if (!wordAfter(p + 1)) return -1;
  for (let k = p + 1; k < n; k++) {
    const c = src.charCodeAt(k);
    if (c === 34) {
      if (wordAfter(k + 1)) continue;
      let j = k + 1;
      while (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9) j++;
      const d = src.charCodeAt(j);
      return j >= n || d === 44 || d === 125 || d === 93 || d === 58 || d === 10 || d === 13 ? k : -1;
    }
    if (c === 10 || c === 13 || c === 44 || c === 58 || c === 91 || c === 93 || c === 123 || c === 125 || c === 92) return -1;
  }
  return -1;
};

/**
 * With repairs, whether [p, end) is prose to ignore (around the value): it starts with text that isn't a
 * comment, is text (no control characters or U+FFFD: a binary file isn't prose), opens no container,
 * and none of its lines starts with a value. (`{"a": 1}\nhello\n{"b": 2}`
 * stays three values, `"a"\nb\n"c"` too.)
 */
const proseUntil = (p: number, end: number): boolean => {
  if (!isText(p) || (src.charCodeAt(p) === 47 && (src.charCodeAt(p + 1) === 47 || src.charCodeAt(p + 1) === 42))) return false;
  for (let k = p; k < end; k++) {
    const c = src.charCodeAt(k);
    // (Not a container, nor bytes that aren't text: control characters, U+FFFD from bytes that weren't UTF-8.)
    if (c === 123 || c === 91 || (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 || c === 0xfffd) return false;
    if (c === 10 || c === 13) {
      let j = k + 1;
      while (j < end && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9 || src.charCodeAt(j) === 10 || src.charCodeAt(j) === 13)) j++;
      if (j < end && !isText(j)) return false;
      k = j - 1;
    }
  }
  return true;
};

/**
 * Repairing, a string without escapes whose text is [a, e) and closing quote at e: if what follows
 * the quote can't follow a string (another string or a name: its closing quote was missing, and this
 * quote opened the next string), where the string should end: at its first , } or ]. Else -1.
 */
const unclosed = (a: number, e: number): number => {
  let j = e + 1;
  while (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9) j++;
  const f = src.charCodeAt(j);
  if (!(f === 34 || f === 39 || f === 96 || isSmartQuote(f) || isIdent(f))) return -1;
  for (let k = a; k < e; k++) {
    const c = src.charCodeAt(k);
    if (c === 44 || c === 125 || c === 93) {
      // (Nothing past it was reported: the text has no escapes, and line breaks end it.)
      while (issues.length && issues[issues.length - 1].p >= k) issues.pop();
      return k;
    }
  }
  return -1;
};

const num = (): string => {
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
      return (src.charCodeAt(s) === 45 ? '-' : '') + BigInt('0x' + src.slice(hs, i)).toString();
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
  const raw = src.slice(s, i);
  if (exact && !isCanonical(raw)) exact = false;
  return clean ? raw : normalizeNumber(raw);
};

const looseKey = (c: number): string => {
  if (c === 39) {
    fix(i, 'Property names must use double quotes');
    return str(39);
  }
  if (c === 0x201c || c === 0x201d) {
    fix(i, 'Property names must use straight double quotes (")');
    return str(0x201d, 0x201c);
  }
  if (c === 0x2018 || c === 0x2019) {
    fix(i, 'Property names must use straight double quotes (")');
    return str(0x2019, 0x2018);
  }
  if (c === 96) {
    fix(i, 'Property names must use double quotes');
    return str(96);
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

/** A value that isn't strict JSON at `c`; null when it is a call(…), whose argument is the value to parse next. */
const loose = (c: number, d: number, u: JNode | null, key: Key): JNode | null => {
  const s = i;
  if (c === 39) {
    fix(i, 'Strings must use double quotes');
    return leaf(STR, str(39), s, d, u, key);
  }
  if (c === 0x201c || c === 0x201d) {
    fix(i, 'Strings must use straight double quotes (")');
    return leaf(STR, str(0x201d, 0x201c), s, d, u, key);
  }
  if (c === 0x2018 || c === 0x2019) {
    fix(i, 'Strings must use straight double quotes (")');
    return leaf(STR, str(0x2019, 0x2018), s, d, u, key);
  }
  if (c === 96) {
    fix(i, 'Strings must use double quotes');
    return leaf(STR, str(96), s, d, u, key);
  }
  if (c === 43 || c === 45 || c === 46) {
    if (fixing && c === 46 && typeof key === 'string' && src.startsWith('...', i)) {
      fix(s, "Placeholder '...' (null)");
      i += 3;
      return leaf(NUL, null, s, d, u, key);
    }
    if (c !== 46 && src.startsWith('Infinity', i + 1)) {
      fix(s, 'Infinity is not valid JSON (replaced with null)');
      i += 9;
      return leaf(NUL, null, s, d, u, key);
    }
    return leaf(NUM, num(), s, d, u, key);
  }
  if (isIdentStart(c)) {
    while (i < n && isIdent(src.charCodeAt(i))) i++;
    const w = src.slice(s, i);
    switch (w) {
      case 'True':
      case 'TRUE':
        fix(s, `Use lowercase true instead of ${w}`);
        return leaf(BOOL, true, s, d, u, key);
      case 'False':
      case 'FALSE':
        fix(s, `Use lowercase false instead of ${w}`);
        return leaf(BOOL, false, s, d, u, key);
      case 'None':
      case 'NULL':
      case 'Null':
      case 'nil':
        fix(s, `Use null instead of ${w}`);
        return leaf(NUL, null, s, d, u, key);
      case 'undefined':
      case 'NaN':
      case 'Infinity':
        fix(s, `${w} is not valid JSON (replaced with null)`);
        return leaf(NUL, null, s, d, u, key);
      // Typos of the literals: repair to what was obviously meant.
      case 'tru':
      case 'ture':
      case 'treu':
      case 'rtue':
        fix(s, `Unexpected '${w}'. Did you mean true?`);
        return leaf(BOOL, true, s, d, u, key);
      case 'fals':
      case 'flase':
      case 'fasle':
      case 'fales':
        fix(s, `Unexpected '${w}'. Did you mean false?`);
        return leaf(BOOL, false, s, d, u, key);
      case 'nul':
      case 'nulll':
      case 'nill':
      case 'nll':
        fix(s, `Unexpected '${w}'. Did you mean null?`);
        return leaf(NUL, null, s, d, u, key);
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
        return leaf(NUL, null, s, d, u, key);
      }
      // Its argument takes this value's place (same depth, container and key): see closeCalls().
      callD.push(d);
      callS.push(s);
      return null;
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
    const nd = new JNode(STR, text, s, d, u, key);
    nd.e = e;
    return nd;
  }
  // Repairing, a property's missing value: null.
  if (fixing && typeof key === 'string') {
    if (i >= n) {
      fix(n, 'Unexpected end of input: the value is missing (null)');
      return leaf(NUL, null, s, d, u, key);
    }
    if (c === 44 || c === 125 || c === 93) {
      fix(i, 'The value is missing (null)');
      return leaf(NUL, null, s, d, u, key);
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
  const list = wrap!._v as JNode[];
  ws();
  while (src.charCodeAt(i) === 44 || src.charCodeAt(i) === 59) {
    i++;
    ws();
  }
  if (i >= n || (fence && src.startsWith('```', i))) {
    wrap!.e = i;
    root = wrap;
    skipTail();
    return false;
  }
  if (list.length === 1) fix(i, 'Multiple top-level values (wrapped in an array)');
  return true;
};

/** A finished top-level value: true if the parse is complete. */
const topLevel = (r: JNode): boolean => {
  if (phase === 2) {
    (wrap!._v as JNode[]).push(r);
    return !nextLine();
  }
  root = r;
  skipTail();
  // With repairs: prose after the value (`{"a": 1} that is all`) is ignored, rather than read as JSON Lines.
  if (prose && !lines && i < n && proseUntil(i, n)) {
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
    wrap = new JNode(ARR, [], start, 0, null, undefined);
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
const openObj = (d: number, u: JNode | null, key: Key): JNode => {
  const node = new JNode(OBJ, [], i, d, u, key);
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
    node.e = i;
  } else opened = true;
  return node;
};

/** An array at `[`: empty (closed), or its first item comes next (`opened`). */
const openArr = (d: number, u: JNode | null, key: Key): JNode => {
  const node = new JNode(ARR, [], i, d, u, key);
  i++;
  ws();
  const c = src.charCodeAt(i);
  if (c === 93) {
    i++;
    node.e = i;
  } else if (item(c)) opened = true;
  else node.e = i;
  return node;
};

/**
 * The recursive parser's value() up to a container's first child: a finished value, a container
 * whose first property or item comes next (`opened`), or null for a call(…), whose argument
 * comes next and takes its place.
 */
const value = (d: number, u: JNode | null, key: Key): JNode | null => {
  ws();
  const s = i;
  const c = src.charCodeAt(i);
  nodes++;
  if (d > depth) {
    // Far deeper than real documents: refused (as the call stack used to), so they can't exhaust memory.
    if (d > MAX_DEPTH) fail(i, 'Nesting is too deep to parse');
    depth = d;
  }
  if (c === 34) return leaf(STR, fixing ? joined(str(34)) : str(34), s, d, u, key);
  if (c === 123) return openObj(d, u, key);
  if (c === 91) return openArr(d, u, key);
  if (isDigit(c) || (c === 45 && src.charCodeAt(i + 1) !== 73)) return leaf(NUM, num(), s, d, u, key);
  if (c === 116 && word('true')) return leaf(BOOL, true, s, d, u, key);
  if (c === 102 && word('false')) return leaf(BOOL, false, s, d, u, key);
  if (c === 110 && word('null')) return leaf(NUL, null, s, d, u, key);
  return loose(c, d, u, key);
};

/** Repairing, string `v` just read: with the strings that follow it joined by `+`. */
const joined = (v: string): string => {
  for (;;) {
    let j = i;
    while (isSpace(src.charCodeAt(j))) j++;
    if (src.charCodeAt(j) !== 43) return v;
    let k = j + 1;
    while (isSpace(src.charCodeAt(k))) k++;
    if (src.charCodeAt(k) !== 34) return v;
    fix(j, "Strings joined with '+' (not valid JSON)");
    i = k;
    v += str(34);
  }
};

/** A finished value at depth `v.d` is the argument of the calls(…) open there: it becomes their value. */
const closeCalls = (v: JNode): JNode => {
  while (callD.length !== 0 && callD[callD.length - 1] === v.d) {
    callD.pop();
    const s = callS.pop()!;
    nodes--;
    ws();
    if (src.charCodeAt(i) === 41) i++;
    else fix(i, "Expected ')'");
    v.s = s;
    v.e = i;
  }
  return v;
};

/**
 * The recursive parser's obj() loop for object `p`, from `mode`: returns null when `p` closes, or
 * undefined when the run's values are used up (`cur`, `mode` and `nextKey` keep the place). Child
 * containers are filled recursively up to `levels` deeper; one deeper still is returned for run().
 */
const fillObj = (p: JNode, levels: number): JNode | null | undefined => {
  const list = p._v as JNode[];
  const d = p.d + 1;
  // (Created at its 16th key, so a set at this depth with fewer keys is an earlier object's.)
  let set = list.length >= 16 ? sets[p.d] : null;
  let m = mode;
  let key: string;
  if (m === AFTER) {
    list.push(ret!);
    ret = null;
  }
  for (;;) {
    if (m === VALUE) key = nextKey as string;
    else {
      let c: number;
      if (m === AFTER) {
        if (!set && list.length === 16) sets[p.d] = set = new Set(list.map((x) => x.key as string));
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
            return null;
          }
          if (i >= n) {
            fix(cp, 'Trailing commas are not allowed');
            fix(n, "Unexpected end of input: missing '}'");
            return null;
          }
          if (c === 93) {
            fix(cp, 'Trailing commas are not allowed');
            fix(i, "Expected '}' to close the object, found ']'");
            return null;
          }
        } else if (c === 125) {
          i++;
          return null;
        } else if (i >= n) {
          fix(n, "Unexpected end of input: missing '}'");
          return null;
        } else if (c === 93) {
          fix(i, "Expected '}' to close the object, found ']'");
          return null;
        } else if (c === 34 || c === 39 || c === 96 || isIdentStart(c) || isSmartQuote(c)) {
          fix(i, "Expected ',' between properties");
        } else fail(i, `Expected ',' or '}' after property value, found ${describe(i)}`);
      } else c = src.charCodeAt(i);
      // A property name and its colon.
      // Repairing: a `...` placeholder for members is skipped.
      if (fixing && c === 46 && src.startsWith('...', i)) {
        fix(i, "Placeholder '...' was skipped");
        i += 3;
        m = AFTER;
        continue;
      }
      const ks = i;
      key = c === 34 ? str(34) : looseKey(c);
      // Not natively reproducible: integer-like keys (JS reorders them) and keys written with
      // escapes (V8 13.x JSON.parse can misread "\n" as "\" after seeing a key containing "\").
      if (exact && (i - ks !== key.length + 2 || (isDigit(key.charCodeAt(0)) && INT_KEY.test(key)))) exact = false;
      let dup = false;
      if (set) {
        dup = set.has(key);
        set.add(key);
      } else {
        for (let j = 0; j < list.length; j++) {
          if (list[j].key === key) {
            dup = true;
            break;
          }
        }
      }
      if (dup && warnings.length < MAX_ISSUES) warnings.push({ p: ks, m: `Duplicate key "${key.length > 40 ? key.slice(0, 40) + '…' : key}"` });
      ws();
      c = src.charCodeAt(i);
      if (c === 58) i++;
      else if (i >= n) {
        if (!fixing) fail(i, "Unexpected end of input: expected ':' after property name");
        // Repairing: a property cut off after its name is left out.
        fix(ks, `Unexpected end of input: "${key.length > 40 ? key.slice(0, 40) + '…' : key}" has no value (left out)`);
        fix(n, "Unexpected end of input: missing '}'");
        return null;
      }
      else if (c === 61) {
        fix(i, "Expected ':' after property name");
        i++;
      } else if (startsValue(c)) fix(i, "Expected ':' after property name");
      else fail(i, `Expected ':' after property name, found ${describe(i)}`);
    }
    // Its value.
    if (--left < 0) {
      cur = p;
      mode = VALUE;
      nextKey = key;
      return undefined;
    }
    let v = value(d, p, key);
    while (v === null) v = value(d, p, key);
    if (opened) {
      opened = false;
      if (levels === 0) return v;
      mode = FIRST;
      const x = v.t === OBJ ? fillObj(v, levels - 1) : fillArr(v, levels - 1);
      if (x !== null) return x;
      v.e = i;
    }
    list.push(callD.length === 0 ? v : closeCalls(v));
    m = AFTER;
  }
};

/** The recursive parser's arr() loop for array `p`, from `mode` (as fillObj). */
const fillArr = (p: JNode, levels: number): JNode | null | undefined => {
  const list = p._v as JNode[];
  const d = p.d + 1;
  let after = mode === AFTER;
  if (after) {
    list.push(ret!);
    ret = null;
  }
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
          return null;
        }
        if (i >= n) {
          fix(cp, 'Trailing commas are not allowed');
          fix(n, "Unexpected end of input: missing ']'");
          return null;
        }
        if (c === 125) {
          fix(cp, 'Trailing commas are not allowed');
          fix(i, "Expected ']' to close the array, found '}'");
          return null;
        }
        if (!item(c)) return null;
      } else if (c === 93) {
        i++;
        return null;
      } else if (i >= n) {
        fix(n, "Unexpected end of input: missing ']'");
        return null;
      } else if (c === 125) {
        fix(i, "Expected ']' to close the array, found '}'");
        return null;
      } else if (startsValue(c)) fix(i, "Expected ',' between array items");
      else fail(i, `Expected ',' or ']' after array item, found ${describe(i)}`);
    }
    // An item (after `[`, value() already went past empty slots).
    if (--left < 0) {
      cur = p;
      mode = VALUE;
      return undefined;
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
    const k = list.length;
    let v = value(d, p, k);
    while (v === null) v = value(d, p, k);
    if (opened) {
      opened = false;
      if (levels === 0) return v;
      mode = FIRST;
      const x = v.t === OBJ ? fillObj(v, levels - 1) : fillArr(v, levels - 1);
      if (x !== null) return x;
      v.e = i;
    }
    list.push(callD.length === 0 ? v : closeCalls(v));
    after = true;
  }
};

/**
 * Parses `every` values (or closes as many containers), or less if the document is done (true).
 * Containers are filled recursively, like the recursive parser, but at most LEVELS deep from here,
 * so the call stack can't overflow: deeper ones go on from here, each closed into its container.
 */
const run = (): boolean => {
  left = every;
  for (;;) {
    const p = cur;
    let x: JNode | null | undefined;
    if (p === wrap) {
      // The top level (`wrap` is null until JSON Lines wrap their values).
      if (mode === AFTER) x = ret;
      else {
        if (--left < 0) return false;
        const d = p === null ? 0 : 1;
        const key = p === null ? undefined : (p._v as JNode[]).length;
        x = value(d, p, key);
        while (x === null) x = value(d, p, key);
        if (!opened) x = closeCalls(x);
      }
      if (!opened) {
        ret = null;
        if (topLevel(x!)) return true;
        // JSON Lines: the next value goes in `wrap`.
        cur = wrap;
        mode = VALUE;
        continue;
      }
      opened = false;
    } else {
      const c = p as JNode;
      x = c.t === OBJ ? fillObj(c, LEVELS) : fillArr(c, LEVELS);
      if (x === undefined) return false;
      if (x === null) {
        // `p` closed: it is the finished value for its own container.
        c.e = i;
        ret = closeCalls(c);
        cur = c.u;
        mode = AFTER;
        if (--left < 0) return false;
        continue;
      }
    }
    // Into a container: its first property or item comes next.
    cur = x!;
    mode = FIRST;
  }
};
