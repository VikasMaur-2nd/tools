/**
 * Flatten and unflatten: nested JSON ⇄ one object whose keys are paths (Convert's "Flat JSON" and
 * "Nested JSON" targets). Values are written from their source text, so numbers keep every digit.
 *
 * Paths. Object keys are joined with the separator ("." by default). Array items are written `a[0]`
 * (`arrays: 'bracket'`, the default), as another key `a.0` (`'dot'`), or not at all (`'keep'`: arrays stay
 * whole values). Empty objects and arrays are values (`{}`, `[]`), as are null, booleans, numbers and strings.
 * `depth` (flatten) joins that many levels at most: 1 gives keys of two parts, deeper values stay nested.
 *
 * Escapes (`escape`, on by default). Flatten puts a backslash before each character of a key that a path would
 * misread: every `\`, every `[` (bracket style), separator characters where they would read as the separator,
 * and the first digit of an all-digit key in an object whose keys are all digits (dot style, where they would
 * read as an array). Unflatten reads a backslash before `\`, `[`, `]`, a digit or a separator character as
 * that character, part of the key; any other backslash is itself. Without escapes, keys stay as they are and
 * backslashes are plain characters.
 *
 * Roots. An object flattens to one flat object. An array is a list of records (as CSV rows are): each item is
 * flattened on its own. Any other value, and an empty object or array, stays as it is. In bracket style an
 * array under an empty top-level key stays whole too: its paths, `[0]`…, would read as a top-level array.
 * Unflatten reads the same shapes, so unflatten(flatten(x)) is x, for every option, except where flatten says
 * it isn't: duplicate keys, and keys that need escapes while they are off.
 *
 * Unflatten. A path's parts nest in key order. A part becomes an array item when every key under the same
 * parent is an index: `[n]` in bracket style, an unescaped `n` in dot style (0 or 1 to 999,999,999 without
 * leading zeros; anything else, `01` say, is a key). Items go in index order; missing ones are filled with null
 * (at most 1,000,000 in all, after which such an array stays an object keyed by its indexes). Keys that
 * contradict each other (the same path twice, a value with keys inside it, an array and an object at one path)
 * are errors that name both keys: nothing is ever dropped. Output is built as text, never as JavaScript objects,
 * so keys such as "__proto__" are just keys.
 *
 * Both run in steps (flattenSteps, unflattenSteps: generators that yield every 1,024 items or so), so the page
 * can convert a big document in short slices between keystrokes (lib/convert/index.ts convert, with `live`).
 *
 * Messages are English: the page translates them by their text (lib/i18n/translate.ts).
 */
import { ARR, BOOL, MAX_WALK_DEPTH, NUL, NUM, OBJ, STR, kids, type JNode } from '../json/parser';
import { MAX_TEXT, clip, quote, stringify, tooLarge, tooLong } from '../json/format';

export type FlatArrays = 'bracket' | 'dot' | 'keep';

export interface FlatOptions {
  /** Joins the keys of a path: 1 to 8 characters, none of them a digit, `\`, `[` or `]`. */
  sep: string;
  arrays: FlatArrays;
  escape: boolean;
  /** Flatten: levels of nesting joined into keys (0: all). */
  depth: number;
}

export const FLAT_DEFAULTS: FlatOptions = { sep: '.', arrays: 'bracket', escape: true, depth: 0 };

export interface FlatResult {
  /** The JSON ('' when there is an error). */
  text: string;
  /** What to know about it, in English, parts joined with " · " ('' for nothing). */
  note: string;
  /** The note says the result won't convert back to the input as it is. */
  warn: boolean;
  /** The input reads as the other direction's (flat JSON to flatten, nested JSON to unflatten). */
  flip: boolean;
  /** Why there is no result ('' for none). */
  error: string;
}

/** A path part: a key, or an array index (dot style: a key that reads as one). */
export type Part = string | number;

/** A separator can't hold digits, backslashes or brackets: paths use them for indexes and escapes. */
export const validSep = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 8 && !/[\\[\]0-9]/.test(s);

/** An array index in a path: 0, or 1 to 999,999,999 without leading zeros. */
const INDEX = /^(?:0|[1-9]\d{0,8})$/;
/** Missing array items unflatten fills with null, at most (a stray `a[999999999]` must not make a billion). */
const HOLES = 1_000_000;

export function flatOptions(o?: Partial<FlatOptions>): FlatOptions {
  return {
    sep: validSep(o?.sep) ? o.sep : '.',
    arrays: o?.arrays === 'dot' || o?.arrays === 'keep' ? o.arrays : 'bracket',
    escape: o?.escape !== false,
    depth: Math.max(0, Math.floor(Number(o?.depth)) || 0),
  };
}

/**
 * `msg` with its {placeholders} filled in one pass, by a function: a key is any text, `{b}` or `$&` included,
 * and neither a later placeholder nor String.replace's patterns may read it as theirs.
 */
const fill = (msg: string, p: Record<string, string>) => msg.replace(/\{(\w+)\}/g, (m, k: string) => p[k] ?? m);
const count = (n: number, one: string, other: string, p?: Record<string, string>) => fill(n === 1 ? one : other, { ...p, n: n.toLocaleString('en-US') });
/** A key in a message: quoted, and cut short (a key can be any length). */
const shown = (k: string) => JSON.stringify(clip(k, 60));
const failed = (error: string): FlatResult => ({ text: '', note: '', warn: false, flip: false, error });

/** A conversion in steps: a generator that yields now and then, returning its result at the end. */
export type Steps<T> = Generator<void, T, void>;
/** Steps yield every this many items (a mask: 1,024). */
const EVERY = 1023;
/** Runs steps to the end. */
function finish<T>(g: Steps<T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** A scalar's JSON, or a whole object or array, indented to sit at `pad`. */
function valueText(n: JNode, pad: string): string {
  switch (n.t) {
    case NUL:
      return 'null';
    case BOOL:
      return n.v ? 'true' : 'false';
    case NUM:
      return n.v as string;
    case STR:
      return quote(n.v as string);
  }
  const s = stringify(n, '  ');
  return pad ? s.replace(/\n/g, '\n' + pad) : s;
}

/** A character class of `chars`, written as \u escapes so any character (a lone surrogate too) is safe in it. */
const charClass = (chars: string) => new RegExp('[' + [...new Set(chars.split(''))].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + ']');

/** Reads a flat key as path parts (see the module comment). */
export function pathParts(key: string, opts?: Partial<FlatOptions>): Part[] {
  return [...reader(flatOptions(opts))(key)];
}

/** A key's path parts, in one array that each call reuses (millions of keys: no garbage). */
function reader(o: FlatOptions): (p: string) => Part[] {
  const { sep, escape } = o;
  const bracket = o.arrays === 'bracket';
  const dot = o.arrays === 'dot';
  const L = sep.length;
  const s0 = sep.charCodeAt(0);
  const sepChars = new Set(Array.from(sep, (_, i) => sep.charCodeAt(i)));
  // \ [ ] digits and the separator's characters are escaped by a backslash; anything else isn't.
  const escapable = (c: number) => c === 92 || c === 91 || c === 93 || (c >= 48 && c <= 57) || sepChars.has(c);
  const parts: Part[] = [];
  /**
   * An index at `i` (bracket style): `[n]` followed by the end, the separator or another `[`. Its end, or -1:
   * `a[01]`, `a[x]` and `a[0]b` are keys.
   */
  const index = (p: string, i: number) => {
    let j = i + 1;
    while (j < p.length && j - i <= 10) {
      const c = p.charCodeAt(j);
      if (c < 48 || c > 57) break;
      j++;
    }
    const digits = j - i - 1;
    if (!digits || digits > 9 || p.charCodeAt(j) !== 93 || (digits > 1 && p.charCodeAt(i + 1) === 48)) return -1;
    j++;
    return j === p.length || p.charCodeAt(j) === 91 || (p.charCodeAt(j) === s0 && p.startsWith(sep, j)) ? j : -1;
  };
  return (p) => {
    parts.length = 0;
    const n = p.length;
    let i = 0;
    // (A path that starts with an index is in a top-level array.)
    let key = true;
    if (bracket && p.charCodeAt(0) === 91) {
      const e = index(p, 0);
      if (e > 0) {
        parts.push(+p.slice(1, e - 1));
        i = e;
        key = false;
      }
    }
    for (;;) {
      if (!key) {
        // After an index: the end, another index, or the separator and a key.
        if (i >= n) return parts;
        if (p.charCodeAt(i) === 91) {
          const e = index(p, i);
          if (e > 0) {
            parts.push(+p.slice(i + 1, e - 1));
            i = e;
            continue;
          }
          // (`[0][x]`: a key starts at the bracket.)
        } else i += L;
        key = true;
      }
      let s = '';
      let from = i;
      let lit = false;
      while (i < n) {
        const c = p.charCodeAt(i);
        if (c === 92 && escape && i + 1 < n && escapable(p.charCodeAt(i + 1))) {
          s += p.slice(from, i);
          from = i + 1;
          i += 2;
          lit = true;
          continue;
        }
        if (c === s0 && p.startsWith(sep, i)) break;
        if (c === 91 && bracket && index(p, i) > 0) break;
        i++;
      }
      s += p.slice(from, i);
      parts.push(dot && !lit && INDEX.test(s) ? +s : s);
      if (i >= n) return parts;
      if (p.charCodeAt(i) === 91) key = false;
      else i += L;
    }
  };
}

// ── Flatten ──────────────────────────────────────────────────────────────────

/** Nested JSON to flat JSON (see the module comment). */
export const flatten = (root: JNode, opts?: Partial<FlatOptions>): FlatResult => finish(flattenSteps(root, opts));

/** flatten, in steps. */
export function* flattenSteps(root: JNode, opts?: Partial<FlatOptions>): Steps<FlatResult> {
  const f = new Flattener(flatOptions(opts));
  try {
    let text: string;
    const items = root.t === ARR ? kids(root) : null;
    if (items?.length) {
      // A list of records, as CSV rows are: each item flattened on its own.
      text = '[';
      for (let i = 0; i < items.length; i++) {
        text += (i ? ',\n  ' : '\n  ') + (yield* f.one(items[i], '  '));
        if (text.length > MAX_TEXT) throw tooLong();
      }
      text += '\n]';
    } else text = yield* f.one(root, '');
    return f.result(text, yield* looksFlat(root, f.o), root.t < ARR);
  } catch (e) {
    if (tooLarge(e)) return failed('The result is too large');
    throw e;
  }
}

class Flattener {
  readonly o: FlatOptions;
  private readonly bracket: boolean;
  private readonly dot: boolean;
  private readonly keep: boolean;
  private readonly sepChars: Set<number>;
  /** Characters that may need an escape. */
  private readonly special: RegExp;
  /** Without escapes: reads each path back, to find the ones that don't read as written. */
  private readonly read: ((p: string) => Part[]) | null;
  private escaped = 0;
  private dups = 0;
  private unsafe = 0;
  private example = '';
  /** Items done, for yielding now and then. */
  private n = 0;
  /** Without escapes: unflatten's budget of missing items, spent as it would spend it (see misread). */
  private budget = HOLES;

  constructor(o: FlatOptions) {
    this.o = o;
    this.bracket = o.arrays === 'bracket';
    this.dot = o.arrays === 'dot';
    this.keep = o.arrays === 'keep';
    this.sepChars = new Set(Array.from(o.sep, (_, i) => o.sep.charCodeAt(i)));
    this.special = charClass('\\' + (this.bracket ? '[' : '') + o.sep);
    this.read = o.escape ? null : reader(o);
  }

  /** Dot style: an object whose keys all read as array indexes (an array, when unflattened). */
  private digitKeys(n: JNode) {
    if (!this.dot || n.t !== OBJ) return false;
    for (const c of kids(n)) if (!INDEX.test(c.key as string)) return false;
    return true;
  }

  /**
   * Without escapes, dot style: whether unflatten turns this all-digit object into an array (it keeps one whose
   * missing items its budget can't fill an object, keyed as it is). Asked in the order unflatten builds them.
   */
  private misread(n: JNode) {
    if (!this.digitKeys(n)) return false;
    const list = kids(n);
    let max = -1;
    for (const c of list) max = Math.max(max, +(c.key as string));
    const holes = max + 1 - list.length;
    if (holes > this.budget) return false;
    this.budget -= Math.max(0, holes);
    return true;
  }

  /** Counts the keys an object repeats. */
  private countDups(n: JNode) {
    if (n.t !== OBJ) return;
    const list = kids(n);
    if (list.length < 2) return;
    if (list.length <= 8) {
      for (let i = 1; i < list.length; i++) {
        for (let j = 0; j < i; j++) {
          if (list[i].key === list[j].key) {
            this.dups++;
            break;
          }
        }
      }
    } else this.dups += list.length - new Set(list.map((c) => c.key)).size;
  }

  private escapeKey(k: string, digits: boolean): string {
    if (digits) {
      // (All digits: nothing else in it needs an escape.)
      this.escaped++;
      return '\\' + k;
    }
    if (!this.special.test(k)) return k;
    const sep = this.o.sep;
    const L = sep.length;
    let out = '';
    let from = 0;
    let any = false;
    for (let i = 0; i < k.length; i++) {
      const c = k.charCodeAt(i);
      // A separator here, or the start of one that what follows the key would complete.
      if (c === 92 || (c === 91 && this.bracket) || (this.sepChars.has(c) && (k.startsWith(sep, i) || (k.length - i < L && sep.startsWith(k.slice(i)))))) {
        out += k.slice(from, i) + '\\';
        from = i;
        any = true;
      }
    }
    if (!any) return k;
    this.escaped++;
    return out + k.slice(from);
  }

  /** One flat object of `root` (an object or array), or `root` itself when it has nothing to flatten. */
  *one(root: JNode, pad: string): Steps<string> {
    if (root.t < ARR || !kids(root).length || (this.keep && root.t === ARR)) return valueText(root, pad);
    const { sep, depth, escape } = this.o;
    const { bracket, keep, read } = this;
    const inner = pad + '  ';
    let out = '{';
    let first = true;
    // The open containers: their items, whether they are objects, the item next, their path, whether their keys
    // get the all-digits escape, and whether what is under them won't unflatten back (a key misread without
    // escapes). `parts`: their real path parts (to check paths, see read).
    const lists: JNode[][] = [kids(root)];
    const objs: boolean[] = [root.t === OBJ];
    const at: number[] = [0];
    const paths: (string | null)[] = [null];
    const digits: boolean[] = [escape && this.digitKeys(root)];
    const bad: boolean[] = [!escape && this.misread(root)];
    const parts: Part[][] | null = read ? [[]] : null;
    this.countDups(root);
    while (lists.length) {
      if (!(++this.n & EVERY)) yield;
      const d = lists.length - 1;
      const list = lists[d];
      if (at[d] === list.length) {
        lists.pop();
        objs.pop();
        at.pop();
        paths.pop();
        digits.pop();
        bad.pop();
        parts?.pop();
        continue;
      }
      const c = list[at[d]++];
      const pre = paths[d];
      let path: string;
      if (objs[d]) {
        const k = c.key as string;
        const t = escape ? this.escapeKey(k, digits[d]) : k;
        path = pre === null ? t : pre + sep + t;
      } else {
        const i = c.key as number;
        path = bracket ? (pre ?? '') + '[' + i + ']' : pre === null ? String(i) : pre + sep + i;
      }
      // (Bracket style: `{"": [1]}` would flatten to "[0]", which reads as a top-level array, so it stays whole.)
      const emptyTop = bracket && d === 0 && objs[0] && c.key === '' && c.t === ARR;
      if (c.t >= ARR && (depth === 0 || d < depth) && !(keep && c.t === ARR) && !emptyTop && kids(c).length) {
        const misread = !escape && this.misread(c);
        lists.push(kids(c));
        objs.push(c.t === OBJ);
        at.push(0);
        paths.push(path);
        digits.push(escape && this.digitKeys(c));
        bad.push(bad[d] || misread);
        parts?.push([...parts[d], c.key as Part]);
        this.countDups(c);
        continue;
      }
      if ((bad[d] || (read && !this.same(read(path), parts![d], c.key as Part))) && !this.unsafe++) this.example = path;
      out += (first ? '\n' : ',\n') + inner + quote(path) + ': ' + valueText(c, inner);
      first = false;
      if (out.length > MAX_TEXT) throw tooLong();
    }
    return first ? '{}' : out + '\n' + pad + '}';
  }

  /** Whether a path read back gives its parts (dot style: an index-like key reads as a number; see digitKeys). */
  private same(got: Part[], parent: Part[], last: Part) {
    if (got.length !== parent.length + 1) return false;
    const eq = this.dot ? (a: Part, b: Part) => String(a) === String(b) : (a: Part, b: Part) => a === b;
    for (let i = 0; i < parent.length; i++) if (!eq(got[i], parent[i])) return false;
    return eq(got[parent.length], last);
  }

  /** `flip`: the input looks flat already (see looksFlat). */
  result(text: string, flip: boolean, single: boolean): FlatResult {
    // (Flat JSON flattened again only gains escapes: what it needs is the other direction.)
    const notes: string[] = [];
    if (flip) notes.push('This looks like flat JSON already');
    else if (single) notes.push('A single value has no keys to flatten');
    if (this.dups) notes.push(count(this.dups, "{n} duplicate key: the result won't unflatten to the same document", "{n} duplicate keys: the result won't unflatten to the same document"));
    // (Only keys misread without escapes are unsafe: escapes would keep them apart.)
    if (this.unsafe) notes.push(count(this.unsafe, "{n} key won't unflatten to the same place: {key}", "{n} keys won't unflatten to the same place, such as {key}", { key: shown(this.example) }), 'Turn on Escape keys to keep them apart');
    if (this.escaped && !flip) notes.push(count(this.escaped, 'Escaped {n} key with a backslash so that Unflatten restores it', 'Escaped {n} keys with a backslash so that Unflatten restores them'));
    return { text, note: notes.join(' · '), warn: !!(this.dups || this.unsafe), flip, error: '' };
  }
}

/**
 * Flat JSON already: an object (or a list of objects) whose values are all scalars or empty, with a key that
 * reads as a path of several parts.
 */
function* looksFlat(root: JNode, o: FlatOptions): Steps<boolean> {
  const objs = root.t === OBJ ? [root] : root.t === ARR ? kids(root) : [];
  if (!objs.length) return false;
  const read = reader(o);
  let path = false;
  let n = 0;
  for (const obj of objs) {
    if (obj.t !== OBJ) return false;
    for (const c of kids(obj)) {
      if (!(++n & EVERY)) yield;
      if (c.t >= ARR && kids(c).length) return false;
      if (!path && read(c.key as string).length > 1) path = true;
    }
  }
  return path;
}

// ── Unflatten ────────────────────────────────────────────────────────────────

/** An object or array being built: its keys in the order first seen. */
class Box {
  readonly keys: string[] = [];
  /** Items: a box, or a value (the flat key's own node: its key names it in messages). */
  readonly vals: (Box | JNode)[] = [];
  /** Key → item, once there are more than a few (a short list is searched faster than a map is made). */
  private map: Map<string, number> | null = null;
  /** Bracket style: 0 undecided, 1 an array, 2 an object. */
  kind = 0;
  /** Dot style: every key is an index. */
  num = true;
  /** The key that made it, and the one that put its first item (messages). */
  readonly from: string;
  first = '';
  constructor(from: string) {
    this.from = from;
  }

  find(name: string): number {
    if (this.map) return this.map.get(name) ?? -1;
    const keys = this.keys;
    for (let i = 0; i < keys.length; i++) if (keys[i] === name) return i;
    return -1;
  }

  add(name: string, v: Box | JNode) {
    const i = this.keys.length;
    this.keys.push(name);
    this.vals.push(v);
    if (this.map) this.map.set(name, i);
    else if (i === 8) this.map = new Map(this.keys.map((k, j) => [k, j]));
  }
}

const SAME = 'Keys {a} and {b} give the same path';
const INSIDE = 'Keys {a} and {b} conflict: one holds a value, the other goes inside it';
const KIND = 'Keys {a} and {b} conflict: one makes an array, the other an object';

/** Flat JSON to nested JSON (see the module comment). */
export const unflatten = (root: JNode, opts?: Partial<FlatOptions>): FlatResult => finish(unflattenSteps(root, opts));

/** unflatten, in steps. */
export function* unflattenSteps(root: JNode, opts?: Partial<FlatOptions>): Steps<FlatResult> {
  const u = new Unflattener(flatOptions(opts));
  try {
    let text: string;
    const items = root.t === ARR ? kids(root) : null;
    if (items?.length) {
      // A list of flat records, as CSV rows with dotted columns give: each item unflattened on its own.
      text = '[';
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        text += (i ? ',\n  ' : '\n  ') + (it.t === OBJ ? yield* u.one(it, '  ') : valueText(it, '  '));
        if (text.length > MAX_TEXT) throw tooLong();
      }
      text += '\n]';
    } else if (root.t === OBJ) text = yield* u.one(root, '');
    else {
      if (root.t < ARR) u.single = true;
      text = valueText(root, '');
    }
    return u.result(text);
  } catch (e) {
    if (tooLarge(e)) return failed('The result is too large');
    throw e;
  }
}

class Unflattener {
  private readonly bracket: boolean;
  private readonly dot: boolean;
  private readonly read: (p: string) => Part[];
  private conflicts = 0;
  private firstConflict = '';
  private deep = false;
  private holes = 0;
  private sparse = 0;
  private budget = HOLES;
  /** A key read as a path of several parts; a value with something inside. */
  private paths = false;
  private nested = false;
  single = false;
  /** Items done, for yielding now and then. */
  private n = 0;

  constructor(o: FlatOptions) {
    this.bracket = o.arrays === 'bracket';
    this.dot = o.arrays === 'dot';
    this.read = reader(o);
  }

  *one(obj: JNode, pad: string): Steps<string> {
    const root = new Box('');
    for (const c of kids(obj)) {
      if (!(++this.n & EVERY)) yield;
      const key = c.key as string;
      const parts = this.read(key);
      if (parts.length > MAX_WALK_DEPTH) {
        this.deep = true;
        continue;
      }
      if (parts.length > 1) this.paths = true;
      if (c.t >= ARR && kids(c).length) this.nested = true;
      this.put(root, parts, c, key);
    }
    return this.conflicts || this.deep ? '' : yield* this.write(root, pad);
  }

  private conflict(msg: string, a: string, b: string) {
    if (!this.conflicts++) this.firstConflict = fill(msg, { a: shown(a), b: shown(b) });
  }

  private put(start: Box, parts: Part[], n: JNode, key: string) {
    let box = start;
    for (let j = 0; ; j++) {
      const part = parts[j];
      const isNum = typeof part === 'number';
      if (this.bracket) {
        const kind = isNum ? 1 : 2;
        if (box.kind && box.kind !== kind) return this.conflict(KIND, box.first, key);
        box.kind = kind;
      } else if (!isNum) box.num = false;
      const name = isNum ? String(part) : part;
      const last = j === parts.length - 1;
      const at = box.find(name);
      if (at < 0) {
        if (!box.keys.length) box.first = key;
        if (last) return box.add(name, n);
        const next = new Box(key);
        box.add(name, next);
        box = next;
        continue;
      }
      const v = box.vals[at];
      if (!(v instanceof Box)) return this.conflict(last ? SAME : INSIDE, v.key as string, key);
      if (last) return this.conflict(INSIDE, v.from, key);
      box = v;
    }
  }

  /** A box's items in output order (null: a missing item), and its keys (null for an array). */
  private layout(b: Box): [(Box | JNode | null)[], string[] | null] {
    const arr = this.bracket ? b.kind === 1 : this.dot && b.num;
    if (!arr) return [b.vals, b.keys];
    let max = -1;
    for (const k of b.keys) max = Math.max(max, +k);
    const holes = max + 1 - b.keys.length;
    if (holes > this.budget) {
      this.sparse++;
      return [b.vals, b.keys];
    }
    this.budget -= holes;
    this.holes += holes;
    const slots: (Box | JNode | null)[] = new Array(max + 1).fill(null);
    for (let i = 0; i < b.keys.length; i++) slots[+b.keys[i]] = b.vals[i];
    return [slots, null];
  }

  private *write(root: Box, pad: string): Steps<string> {
    if (!root.keys.length) return '{}';
    let out = '';
    // The open boxes: their items, keys (null for an array), next item, and indents (their own, their items').
    const slots: (Box | JNode | null)[][] = [];
    const names: (string[] | null)[] = [];
    const at: number[] = [];
    const pads: string[] = [];
    const inners: string[] = [];
    const open = (b: Box, p: string) => {
      const [s, k] = this.layout(b);
      slots.push(s);
      names.push(k);
      at.push(0);
      pads.push(p);
      inners.push(p + '  ');
      out += k ? '{\n' : '[\n';
    };
    open(root, pad);
    while (slots.length) {
      if (!(++this.n & EVERY)) yield;
      const d = slots.length - 1;
      const i = at[d]++;
      const list = slots[d];
      const keys = names[d];
      if (i === list.length) {
        out += '\n' + pads[d] + (keys ? '}' : ']');
        slots.pop();
        names.pop();
        at.pop();
        pads.pop();
        inners.pop();
        continue;
      }
      const inner = inners[d];
      if (i) out += ',\n';
      out += inner;
      if (keys) out += quote(keys[i]) + ': ';
      const v = list[i];
      if (v === null) out += 'null';
      else if (v instanceof Box) open(v, inner);
      else out += valueText(v, inner);
      if (out.length > MAX_TEXT) throw tooLong();
    }
    return out;
  }

  result(text: string): FlatResult {
    if (this.conflicts) return failed(this.firstConflict + (this.conflicts > 1 ? ' · ' + count(this.conflicts - 1, '{n} more conflict', '{n} more conflicts') : ''));
    if (this.deep) return failed('Nesting is too deep to convert');
    const notes: string[] = [];
    const flip = !this.paths && this.nested;
    if (flip) notes.push('This JSON has no flat keys to unflatten');
    else if (this.single) notes.push('A single value has no keys to unflatten');
    if (this.holes) notes.push(count(this.holes, 'Filled {n} missing array item with null', 'Filled {n} missing array items with null'));
    if (this.sparse) notes.push(count(this.sparse, '{n} array has indexes too far apart and stays an object', '{n} arrays have indexes too far apart and stay objects'));
    return { text, note: notes.join(' · '), warn: !!(this.holes || this.sparse), flip, error: '' };
  }
}
