/**
 * Streamed CSV of a huge document's records: the text convert/xlsx.ts `toCsv` makes for the same container,
 * a record at a time. Each record (an item of an array or list, a member of an object; a scalar is its own)
 * is made as the normal parser's nodes (`Trees`, bounded by RECORD_MAX), and the tabulation's own cell rules
 * (xlsx.ts `cellText` / `nestedCell` / `readableIds`) decide its cells.
 *
 * Two passes: the first finds the table's kind and columns (the union of dotted paths in first-seen order,
 * escaped where a key has a dot of its own, as toCsv's second try; bounded by MAX_COLUMNS), the second writes
 * the rows. Memory: one record's nodes, the column names, and for key / value rows with dotted keys their
 * names (bounded by MAX_PAIRS).
 */
import { formulaSafe } from '../../convert/formula';
import { cellText, nestedCell, readableIds, type GridCell } from '../../convert/xlsx';
import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids, type Key, type Kind, type Val } from '../../json/parser';
import { Bytes, SMALL } from './out';
import { decodeString, Reformat, validUtf8 } from './reformat';
import { ESC, HI, LONG, type Visitor } from './walk';


export type Flatten = 'dot' | 'json';

export interface CsvOptions {
  flatten?: Flatten;
  delimiter?: ',' | ';' | '\t';
  /** A UTF-8 byte order mark first (Excel reads the encoding from it). */
  bom?: boolean;
}

/** Bytes a record may have (each is made whole to be tabulated). */
export const RECORD_MAX = 32 << 20;
/** Columns a CSV may have. */
export const MAX_COLUMNS = 20_000;
/** Key / value rows remembered (their names depend on all of them when keys have dots). */
const MAX_PAIRS = 300_000;

/** A table that can't be written (a fixed message: it says nothing of the document). */
export class CsvError extends Error {}

const ESCAPE = /[\\.]/g;
const latin = (b: Uint8Array, a: number, e: number) => {
  let s = '';
  for (let k = a; k < e; k++) s += String.fromCharCode(b[k]);
  return s;
};

/** Makes each record of a container as JNodes and hands it to `each` (a Visitor of walk.ts). */
export class Trees implements Visitor {
  /** The container's kind (ARR for a list of top-level values; a scalar's own kind). */
  rootKind = -1;
  private stack: JNode[] = [];
  private name: string | null = null;
  private index = 0;
  private recAt = 0;

  constructor(
    private readonly each: (rec: JNode) => void,
    private readonly max = RECORD_MAX,
  ) {}

  private node(t: Kind, v: Val, at: number): JNode {
    const parent = this.stack.length ? this.stack[this.stack.length - 1] : null;
    let key: Key;
    if (parent ? parent.t === OBJ : this.rootKind === OBJ) {
      key = this.name!;
      this.name = null;
    } else key = parent ? (parent.v as JNode[]).length : this.index;
    const n = new JNode(t, v, at, this.stack.length + 1, parent, key);
    if (parent) (parent.v as JNode[]).push(n);
    else this.recAt = at;
    if (at - this.recAt > this.max) throw new CsvError('A record is too large to convert');
    return n;
  }

  private done(n: JNode) {
    this.index++;
    this.each(n);
  }

  open(kind: number, at: number) {
    if (this.rootKind < 0) {
      this.rootKind = kind;
      return;
    }
    this.stack.push(this.node(kind as Kind, [], at));
  }

  close(_kind: number, end: number) {
    const n = this.stack.pop();
    if (!n) return;
    if (end - this.recAt > this.max) throw new CsvError('A record is too large to convert');
    if (!this.stack.length) this.done(n);
  }

  key(b: Uint8Array, a: number, e: number, flags: number) {
    this.name = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
  }

  private scalar(t: Kind, v: Val, at: number) {
    if (this.rootKind < 0) {
      this.rootKind = t;
      this.done(new JNode(t, v, at, 0, null, undefined));
      return;
    }
    const n = this.node(t, v, at);
    if (!this.stack.length) this.done(n);
  }

  str(b: Uint8Array, a: number, e: number, flags: number, at: number) {
    if (flags & LONG) throw new CsvError('A value is too large to convert');
    this.scalar(STR, decodeString(b, a, e, flags), at);
  }

  num(b: Uint8Array, a: number, e: number, at: number) {
    this.scalar(NUM, latin(b, a, e), at);
  }

  lit(kind: number, v: boolean, at: number) {
    this.scalar(kind === NUL ? NUL : BOOL, kind === NUL ? null : v, at);
  }
}

/** What the first pass finds: the table's kind and columns. */
export interface CsvPlan {
  /** none: no rows; matrix: arrays by position; records: items' paths; values: one column; keyed: an object of objects; pairs: key / value rows; scalar: one value. */
  mode: 'none' | 'matrix' | 'records' | 'values' | 'keyed' | 'pairs' | 'scalar';
  header: string[];
  /** Paths are made with keys escaped (toCsv's second try, when a key has a dot). */
  esc: boolean;
  /** records / keyed: each path's column. */
  cols: Map<string, number>;
  /** The "value" column (records whose items aren't all objects). */
  vc: number;
  /** matrix: the first row is the header. */
  head: boolean;
  /** pairs with escaped keys: each key's name. */
  names: Map<string, string> | null;
  rows: number;
}

/** The first pass: give it each record (`record`), then ask for the plan. */
export class CsvScan {
  readonly dot: boolean;
  // (Not private: CsvColumns, the first pass from tokens, keeps the same books.)
  rootKind = -1;
  items = 0;
  // Arrays.
  allArr = true;
  someObj = false;
  width = 0;
  /** The first record's items (matrix): how many, and their strings (null: one isn't a string). */
  firstLen = 0;
  firstStrs: string[] | null = null;
  vc = -1;
  // Columns: escaped ids (in order), and the plain ones.
  ids: string[] = [];
  plain: string[] = [];
  cols = new Map<string, number>();
  dotted = false;
  overflow = false;
  // Objects.
  allObj = true;
  deep = false;
  pairsDotted = false;
  /** Key / value rows' plain keys (to see two read alike), and every escaped one (their names, then). */
  pairs: Set<string> | null = new Set();
  escs: Set<string> | null = new Set();
  dupPair = false;

  constructor(flatten: Flatten = 'dot') {
    this.dot = flatten === 'dot';
  }

  col(plain: string, esc: string) {
    if (this.cols.has(esc)) return;
    // (Too many: refused if the table needs them, see plan.)
    if (this.ids.length >= MAX_COLUMNS) {
      this.overflow = true;
      return;
    }
    this.cols.set(esc, this.ids.length);
    this.ids.push(esc);
    this.plain.push(plain);
  }

  seg(k: string) {
    return this.dot && (k.indexOf('.') >= 0 || k.indexOf('\\') >= 0) ? k.replace(ESCAPE, '\\$&') : k;
  }

  /** A key / value row's key (a leaf of grid's `walk`). */
  pair(plain: string, esc: string) {
    const p = this.pairs;
    if (!p || !this.escs) return;
    if (p.has(plain)) this.dupPair = true;
    else if (p.size >= MAX_PAIRS) {
      this.pairs = this.escs = null;
      return;
    } else p.add(plain);
    this.escs.add(esc);
  }

  /** The "value" column, made where the first record that needs it is. */
  valueColumn() {
    if (this.vc >= 0) return;
    this.vc = this.ids.length;
    this.ids.push('value');
    this.plain.push('value');
  }

  /** xlsx.ts grid's `put`, finding columns. */
  private put(n: JNode, plain: string, esc: string) {
    if (this.dot && n.t === OBJ && kids(n).length) {
      for (const c of kids(n)) {
        const k = c.key as string;
        if (k.indexOf('.') >= 0) this.dotted = true;
        this.put(c, plain + '.' + k, esc + '.' + this.seg(k));
      }
    } else this.col(plain, esc);
  }

  private props(o: JNode) {
    for (const c of kids(o)) {
      const k = c.key as string;
      if (this.dot && k.indexOf('.') >= 0) this.dotted = true;
      this.put(c, k, this.seg(k));
    }
  }

  /** xlsx.ts grid's key / value `walk`: the rows' keys (plain and escaped), to check they read apart. */
  private walk(n: JNode, plain: string, esc: string) {
    if (this.dot && n.t === OBJ && kids(n).length) {
      this.deep = true;
      for (const c of kids(n)) {
        const k = c.key as string;
        if (k.indexOf('.') >= 0) this.pairsDotted = true;
        this.walk(c, plain + '.' + k, esc + '.' + this.seg(k));
      }
      return;
    }
    this.pair(plain, esc);
  }

  /** The next record (`rootKind`: its container's kind). */
  record(n: JNode, rootKind: number) {
    this.rootKind = rootKind;
    this.items++;
    if (rootKind === ARR) {
      if (n.t === ARR) {
        const list = kids(n);
        if (this.items === 1) {
          this.firstLen = list.length;
          this.firstStrs = list.every((c) => c.t === STR) ? list.map((c) => c.v as string) : null;
        }
        this.width = Math.max(this.width, list.length);
      } else this.allArr = false;
      if (n.t === OBJ) {
        this.someObj = true;
        this.props(n);
      } else if (n.t !== NUL) this.valueColumn();
    } else if (rootKind === OBJ) {
      if (n.t !== OBJ) this.allObj = false;
      else if (this.allObj) this.props(n);
      const k = n.key as string;
      if (this.dot && k.indexOf('.') >= 0) this.pairsDotted = true;
      this.walk(n, k, this.seg(k));
    }
  }

  /** The table, once every record was seen (`rootKind`: the container's, Trees.rootKind). */
  plan(rootKind: number): CsvPlan {
    const plan: CsvPlan = { mode: 'none', header: [], esc: false, cols: new Map(), vc: -1, head: false, names: null, rows: this.items };
    const k = (this.rootKind = rootKind);
    if (k < 0) return plan;
    if (k !== ARR && k !== OBJ) {
      plan.mode = 'scalar';
      plan.header = ['value'];
      return plan;
    }
    let kc = -1;
    if (k === ARR) {
      if (!this.items) return plan;
      if (this.allArr) {
        plan.mode = 'matrix';
        const w = this.width;
        if (w > MAX_COLUMNS) throw new CsvError('Too many columns for a CSV file');
        const first = this.firstStrs;
        plan.head = this.items > 1 && this.firstLen === w && first !== null;
        for (let j = 0; j < w; j++) plan.header.push(plan.head ? first![j] : String(j + 1));
        return plan;
      }
      if (!this.someObj) {
        plan.mode = 'values';
        plan.header = ['value'];
        return plan;
      }
      plan.mode = 'records';
      plan.vc = this.vc;
    } else if (this.items && this.allObj) {
      plan.mode = 'keyed';
      kc = 0;
    } else {
      plan.mode = 'pairs';
      plan.header = ['key', 'value'];
      // (Dotted keys below the top level and two rows that read alike: toCsv's second try, named from all of them.)
      if (this.dot && this.pairsDotted && this.deep && this.dupPair) {
        if (!this.escs) throw new CsvError('Too many values with dotted names for a CSV file');
        plan.esc = true;
        const escs = [...this.escs];
        const names = readableIds(escs);
        plan.names = new Map(escs.map((e, j) => [e, names[j]]));
      }
      return plan;
    }
    if (this.overflow) throw new CsvError('Too many columns for a CSV file');
    const esc = this.dot && this.dotted;
    plan.esc = esc;
    const ids = esc ? this.ids : this.plain;
    const off = kc === 0 ? 1 : 0;
    ids.forEach((id, j) => {
      if (j !== this.vc) plan.cols.set(id, j + off);
    });
    let h = kc === 0 ? ['key', ...ids] : ids.slice();
    if (plan.vc >= 0) plan.vc += off;
    if (esc) h = readableIds(h);
    const j = kc >= 0 ? kc : plan.vc;
    if (j >= 0) {
      const taken = new Set(h.filter((_, x) => x !== j));
      let name = h[j];
      while (taken.has(name)) name = '_' + name;
      h[j] = name;
    }
    plan.header = h;
    return plan;
  }
}

/** A path of records' members (CsvColumns' trie): its plain and escaped text, and whether its column is in. */
interface ColNode {
  plain: string;
  esc: string;
  done: boolean;
  key: Uint8Array;
  kids: Map<string, ColNode> | null;
  order: (ColNode | undefined)[];
}

/**
 * The first pass from the walker's tokens, no records made: what CsvScan.record finds from each record's
 * nodes (the same books, in the same order: a value's columns as grid's `put` visits it, an empty object at
 * its close, before its next sibling), at the walker's speed.
 */
export class CsvColumns implements Visitor {
  private d = 0;
  private name: string | null = null;
  // Per open container (by depth, the container itself 0): its paths for columns and for key / value rows,
  // and whether an object there had a member yet.
  private cp: string[] = [];
  private ce: string[] = [];
  private pp: string[] = [];
  private pe: string[] = [];
  private empty: boolean[] = [];
  private flat: boolean[] = [];
  /** Inside a value that is one cell (an array, or an object in JSON mode): how deep in it. */
  private skip = 0;
  /** The record (depth 1) is an array: its items counted (matrix); the first one's strings kept. */
  private recArr = false;
  private recLen = 0;
  /** Columns are found in this record (an object item, or while every member of an object is one). */
  private cols = false;
  /**
   * An array or list of records: their paths are a trie shared by all records (tn[d]: the object at depth d,
   * tp[d]: its members so far), each name predicted by its position, a column registered once per path: no
   * path text made per value. (Objects' members as records keep the text paths: key / value rows need them.)
   */
  private trie = false;
  private readonly troot: ColNode = { plain: '', esc: '', done: false, key: new Uint8Array(0), kids: null, order: [] };
  private tn: ColNode[] = [];
  private tp: number[] = [];
  private tnext: ColNode | null = null;

  constructor(readonly s: CsvScan) {}

  /** The member path for name b[a, e) of the object at depth d (CsvTokens.child's way). */
  private tchild(d: number, b: Uint8Array, a: number, e: number, flags: number): ColNode {
    const node = this.tn[d];
    const p = this.tp[d]++;
    let c = node.order[p];
    if (c) {
      const kb = c.key;
      if (kb.length === e - a) {
        let k = 0;
        while (k < kb.length && kb[k] === b[a + k]) k++;
        if (k === kb.length) return c;
      }
    }
    const name = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
    c = node.kids?.get(name);
    if (!c) {
      const s = this.s;
      if (s.dot && name.indexOf('.') >= 0) s.dotted = true;
      const top = node === this.troot;
      c = { plain: top ? name : node.plain + '.' + name, esc: top ? s.seg(name) : node.esc + '.' + s.seg(name), done: false, key: b.slice(a, e), kids: null, order: [] };
      (node.kids ??= new Map()).set(name, c);
    }
    if (p < 4096) node.order[p] = c;
    return c;
  }

  /** A leaf at path node `c`: its column (once). */
  private tleaf(c: ColNode) {
    if (c.done) return;
    c.done = true;
    this.s.col(c.plain, c.esc);
  }

  get rootKind() {
    return this.s.rootKind;
  }

  /** A value starts at depth d (d ≥ 1): its kind, and where it is. */
  private value(kind: number) {
    const s = this.s;
    const d = this.d;
    if (d === 1) {
      s.items++;
      const key = this.name ?? '';
      this.name = null;
      this.recArr = false;
      this.cols = false;
      if (s.rootKind === ARR) {
        if (kind === ARR) {
          this.recArr = true;
          this.recLen = 0;
          if (s.items === 1) s.firstStrs = [];
        } else s.allArr = false;
        if (kind === OBJ) {
          s.someObj = true;
          this.cols = true;
          this.tn[1] = this.troot;
          this.tp[1] = 0;
        } else if (kind !== NUL) s.valueColumn();
        this.cp[1] = this.ce[1] = '';
        return;
      }
      // An object container: its members are the records.
      if (kind !== OBJ) s.allObj = false;
      else this.cols = s.allObj;
      if (s.dot && key.indexOf('.') >= 0) s.pairsDotted = true;
      this.cp[1] = this.ce[1] = '';
      this.pp[1] = key;
      this.pe[1] = s.seg(key);
      // (Not an object, or JSON mode: one key / value row.)
      if (kind !== OBJ || !s.dot) s.pair(key, this.pe[1]);
      return;
    }
    // In a record that is an array: its items (matrix cells).
    if (this.recArr) {
      if (d === 2) this.recLen++;
      return;
    }
    const parent = d - 1;
    this.empty[parent] = false;
    const dot = s.dot;
    if (this.trie) {
      // (A member of an object in a record of an array: its path node came with its name.)
      const c = this.tnext!;
      if (kind === OBJ && dot) {
        this.tn[d] = c;
        this.tp[d] = 0;
      } else this.tleaf(c);
      return;
    }
    const k = this.name!;
    this.name = null;
    // Column paths (records, keyed): from the record's members down.
    let cp = '';
    let ce = '';
    if (this.cols) {
      if (dot && k.indexOf('.') >= 0) s.dotted = true;
      cp = parent === 1 ? k : this.cp[parent] + '.' + k;
      ce = parent === 1 ? s.seg(k) : this.ce[parent] + '.' + s.seg(k);
    }
    // Key / value paths: from the member's key down (an object container, dot mode: JSON mode's rows are its members).
    let pp = '';
    let pe = '';
    const pairs = s.rootKind === OBJ && dot;
    if (pairs) {
      if (k.indexOf('.') >= 0) s.pairsDotted = true;
      pp = this.pp[parent] + '.' + k;
      pe = this.pe[parent] + '.' + s.seg(k);
    }
    if (kind === OBJ && dot) {
      // Flattened: its members are the cells (an empty one is a cell itself, at its close).
      this.cp[d] = cp;
      this.ce[d] = ce;
      this.pp[d] = pp;
      this.pe[d] = pe;
      return;
    }
    if (this.cols) s.col(cp, ce);
    if (pairs) s.pair(pp, pe);
  }

  open(kind: number) {
    if (this.skip) {
      this.skip++;
      return;
    }
    if (this.s.rootKind < 0) {
      this.s.rootKind = kind;
      this.trie = kind === ARR;
      this.d = 1;
      return;
    }
    this.value(kind);
    const d = this.d++;
    this.empty[d] = true;
    this.flat[d] = false;
    if (d === 1) {
      // A record: its members are read (objects), or its items counted (arrays of an array: a matrix's rows);
      // else (an array member of an object) it is one row, its contents don't matter here.
      if (kind === OBJ) this.flat[d] = true;
      else if (!this.recArr) {
        this.skip = 1;
        this.d--;
      }
      return;
    }
    if (this.recArr) {
      // (A matrix cell that is a container: one cell; the first row then isn't all strings.)
      if (d === 2 && this.s.items === 1) this.s.firstStrs = null;
      this.skip = 1;
      this.d--;
      return;
    }
    if (kind === OBJ && this.s.dot) {
      this.flat[d] = true;
      return;
    }
    // A cell: its contents don't matter here.
    this.skip = 1;
    this.d--;
  }

  close(kind: number) {
    if (this.skip) {
      this.skip--;
      return;
    }
    const d = --this.d;
    if (d === 0) return;
    const s = this.s;
    if (d === 1) {
      if (this.recArr) {
        if (this.recLen > s.width) s.width = this.recLen;
        if (s.items === 1) s.firstLen = this.recLen;
        this.recArr = false;
        return;
      }
      // An object member of an object container with no members: its own key / value row.
      if (s.rootKind === OBJ && kind === OBJ && s.dot && this.empty[1]) s.pair(this.pp[1], this.pe[1]);
      else if (s.rootKind === OBJ && kind === OBJ && s.dot) s.deep = true;
      return;
    }
    if (kind === OBJ && this.flat[d]) {
      if (this.empty[d]) {
        if (this.trie) this.tleaf(this.tn[d]);
        else if (this.cols) s.col(this.cp[d], this.ce[d]);
        if (s.rootKind === OBJ) s.pair(this.pp[d], this.pe[d]);
      } else if (s.rootKind === OBJ) s.deep = true;
    }
  }

  key(b: Uint8Array, a: number, e: number, flags: number) {
    if (this.skip) return;
    if (this.trie && this.d >= 2 && !this.recArr) this.tnext = this.tchild(this.d - 1, b, a, e, flags);
    else this.name = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
  }

  private scalar(str: (() => string) | null) {
    if (this.skip) return;
    if (this.s.rootKind < 0) {
      this.s.rootKind = NUM;
      this.s.items = 1;
      return;
    }
    if (this.recArr && this.d === 2) {
      this.recLen++;
      const f = this.s.firstStrs;
      if (this.s.items === 1 && f) {
        if (str) f.push(str());
        else this.s.firstStrs = null;
      }
      return;
    }
    this.value(NUM);
  }

  str(b: Uint8Array, a: number, e: number, flags: number) {
    if (flags & LONG && this.recArr && this.s.items === 1 && this.d === 2) throw new CsvError('A value is too large to convert');
    this.scalar(() => decodeString(b, a, e, flags));
  }

  num() {
    this.scalar(null);
  }

  lit(kind: number) {
    if (this.skip) return;
    if (this.s.rootKind < 0) {
      this.s.rootKind = kind;
      this.s.items = 1;
      return;
    }
    if (this.recArr && this.d === 2) return this.scalar(null);
    this.value(kind);
  }
}

/** The second pass: give it each record; it writes the rows (the header first) to `out`. */
export class CsvRows {
  private readonly delim: string;
  private readonly special: RegExp;
  private readonly dot: boolean;
  private skip: boolean;
  /** Rows written. */
  rows = 0;

  constructor(
    private readonly plan: CsvPlan,
    private readonly out: Bytes,
    o: CsvOptions = {},
  ) {
    this.dot = (o.flatten ?? 'dot') === 'dot';
    this.delim = o.delimiter ?? ',';
    this.special = new RegExp('["\\r\\n' + (this.delim === '\t' ? '\\t' : this.delim) + ']');
    this.skip = plan.mode === 'matrix' && plan.head;
    if (o.bom) out.text('\ufeff');
    // (A line is never empty, as toCsv writes it: a one-column header or row with nothing in it is "".)
    if (plan.header.length && plan.mode !== 'none') out.text((plan.header.map((s) => this.f(s)).join(this.delim) || '""') + '\r\n');
  }

  /** toCsv's `f`: formula-like text made safe, then quoted if it must be. */
  private f(s: string) {
    s = formulaSafe(s);
    return this.special.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  private line(row: GridCell[], n: number) {
    let line = '';
    for (let j = 0; j < n; j++) {
      const c = row[j];
      const s = cellText(c);
      line += (j ? this.delim : '') + (s === '' && c !== undefined && (typeof c === 'string' || c.t === STR) ? '""' : this.f(s));
    }
    this.out.text((line || (n ? '""' : '')) + '\r\n');
    this.rows++;
  }

  private seg(k: string) {
    return this.plan.esc && (k.indexOf('.') >= 0 || k.indexOf('\\') >= 0) ? k.replace(ESCAPE, '\\$&') : k;
  }

  private put(row: GridCell[], n: JNode, path: string) {
    if (this.dot && n.t === OBJ && kids(n).length) for (const c of kids(n)) this.put(row, c, path + '.' + this.seg(c.key as string));
    else {
      const j = this.plan.cols.get(path);
      if (j !== undefined) row[j] = nestedCell(n, this.dot);
    }
  }

  private props(row: GridCell[], o: JNode) {
    for (const c of kids(o)) this.put(row, c, this.seg(c.key as string));
  }

  private walk(n: JNode, path: string) {
    if (this.dot && n.t === OBJ && kids(n).length) {
      for (const c of kids(n)) this.walk(c, path + '.' + this.seg(c.key as string));
      return;
    }
    this.line([this.plan.names ? (this.plan.names.get(path) ?? path) : path, nestedCell(n, this.dot)], 2);
  }

  record(n: JNode) {
    const p = this.plan;
    const w = p.header.length;
    switch (p.mode) {
      case 'scalar':
        return this.line([n], 1);
      case 'values':
        return this.line([nestedCell(n, this.dot)], 1);
      case 'matrix':
        if (this.skip) {
          this.skip = false;
          return;
        }
        return this.line(kids(n).map((c) => nestedCell(c, this.dot)), w);
      case 'records': {
        const row: GridCell[] = [];
        if (n.t === OBJ) this.props(row, n);
        else if (n.t !== NUL) row[p.vc] = nestedCell(n, this.dot);
        return this.line(row, w);
      }
      case 'keyed': {
        const row: GridCell[] = [n.key as string];
        this.props(row, n);
        return this.line(row, w);
      }
      case 'pairs':
        return this.walk(n, this.dot ? this.seg(n.key as string) : (n.key as string));
    }
  }
}

// ── Pass 2 from tokens ──────────────────────────────────────────────────────────

/** A cell of a row being made: missing (or null: written ''), or its bytes as written (strings through f(), '' as ""). */
const C_NONE = 0;
const C_RAW = 1;
const utf8 = new TextEncoder();

/** A path within a record (its members' names), and its column (-1: none). */
interface PathNode {
  col: number;
  path: string;
  /** The name's raw bytes (to tell, by position, the name that usually comes there). */
  key: Uint8Array;
  kids: Map<string, PathNode> | null;
  /** The member at each position of the last object here. */
  order: (PathNode | undefined)[];
}

const LIT_TRUE = new TextEncoder().encode('true');
const LIT_NULL = new TextEncoder().encode('null');
const LIT_FALSE = new TextEncoder().encode('false');

/**
 * The second pass straight from the walker's tokens (a Visitor), no records made: the same text as Trees +
 * CsvRows for every table but key / value rows (`supports`). A row's cells wait in column order (strings,
 * numbers and literals that need neither quotes nor the formula guard copied as bytes; others as text through
 * toCsv's own rules; nested values minified as the normal path writes them, a dot-mode array of primitives
 * joined with ", "), and are written when the record ends. A member's column is found through the record's
 * paths, the name at each position predicted from the last record (no path text made per value).
 */
export class CsvTokens implements Visitor {
  /** Rows written. */
  rows = 0;
  static supports(plan: CsvPlan) {
    return plan.mode !== 'pairs';
  }

  private readonly w: number;
  private readonly kind: Uint8Array;
  private readonly rs: Int32Array;
  private readonly re: Int32Array;
  /** Columns set in the row being made (reset after it); the row made as its cells come (in column order), and its next column. */
  private set: number[] = [];
  private inOrder = true;
  private nextCol = 0;
  private arena = new Uint8Array(1 << 12);
  private an = 0;
  private readonly dot: boolean;
  private readonly delim: number;
  private readonly special: RegExp;
  private readonly rowsOut: CsvRows;
  private skip: boolean;
  /** Open containers outside a nested cell (the container itself is 1, a record 2…). */
  private d = 0;
  private rootKind = -1;
  /** The object path at each depth, and how many members it had so far. */
  private nodes: PathNode[] = [];
  private pos: number[] = [];
  private next: PathNode | null = null;
  private readonly root: PathNode;
  /** A matrix row (an array record): the position of its next cell. */
  private matrix = false;
  private mpos = 0;
  /** A keyed table's record key (its row's first cell). */
  private recKey = '';
  private recAt = 0;
  // A nested value being written into one cell: its depth, column, writer, and (dot-mode arrays) its items.
  private cap = 0;
  private capCol = -1;
  /**
   * A dot-mode array's items while all are primitives (toCsv joins them with ", "): their raw bytes, one after
   * another in jb, with each one's [start, end, flags, kind] in jr; jn items. `capJoin` false: not joinable.
   */
  private capJoin = false;
  private jb = new Uint8Array(256);
  private jl = 0;
  private jr = new Int32Array(64);
  private jn = 0;
  private readonly capOut = new Bytes(SMALL);
  private readonly capF: Reformat;

  constructor(
    private readonly plan: CsvPlan,
    private readonly out: Bytes,
    o: CsvOptions = {},
  ) {
    this.dot = (o.flatten ?? 'dot') === 'dot';
    const d = o.delimiter ?? ',';
    this.delim = d.charCodeAt(0);
    this.special = new RegExp('["\\r\\n' + (d === '\t' ? '\\t' : d) + ']');
    // (The header, as CsvRows writes it.)
    this.rowsOut = new CsvRows(plan, out, o);
    this.skip = plan.mode === 'matrix' && plan.head;
    this.w = plan.mode === 'scalar' || plan.mode === 'values' ? 1 : plan.header.length;
    this.kind = new Uint8Array(this.w);
    this.rs = new Int32Array(this.w);
    this.re = new Int32Array(this.w);
    this.root = { col: -1, path: '', key: new Uint8Array(0), kids: null, order: [] };
    this.capF = new Reformat(this.capOut, { indent: '' });
  }

  /** toCsv's `f`. */
  private f(s: string) {
    s = formulaSafe(s);
    return this.special.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  private mark(j: number) {
    this.set.push(j);
  }

  /**
   * Before cell j: while the row's cells come in column order (the usual case), its line is made as they come:
   * the delimiters up to j. A cell before the last one (members out of order, a name twice) makes the row
   * assembled from its cells at its end instead.
   */
  private place(j: number) {
    if (!this.inOrder) return;
    const from = this.nextCol;
    if (j < from) {
      this.inOrder = false;
      return;
    }
    if (this.an + (j - from + 1) > this.arena.length) this.grow(j - from + 1);
    const o = this.arena;
    for (let c = from; c <= j; c++) if (c) o[this.an++] = this.delim;
    this.nextCol = j + 1;
  }

  private none(j: number) {
    if (j < 0) return;
    this.place(j);
    this.kind[j] = C_NONE;
  }

  private raw(j: number, b: Uint8Array, a: number, e: number) {
    if (j < 0) return;
    this.place(j);
    const len = e - a;
    if (this.an + len > this.arena.length) this.grow(len);
    const o = this.arena;
    let p = this.an;
    for (let k = a; k < e; k++) o[p++] = b[k];
    this.rs[j] = this.an;
    this.re[j] = p;
    this.an = p;
    this.kind[j] = C_RAW;
    this.mark(j);
  }

  private text(j: number, s: string) {
    if (j < 0) return;
    this.place(j);
    this.textHere(j, s);
  }

  /** Cell j as text (placed already): '""' if empty, else through toCsv's f, as UTF-8 bytes. */
  private textHere(j: number, s: string) {
    const t = s === '' ? '""' : this.f(s);
    if (this.an + t.length * 3 > this.arena.length) this.grow(t.length * 3);
    const o = this.arena;
    // (ASCII a byte a character; else encoded.)
    let n = 0;
    let p = this.an;
    for (; n < t.length; n++) {
      const c = t.charCodeAt(n);
      if (c >= 0x80) break;
      o[p++] = c;
    }
    if (n < t.length) n = utf8.encodeInto(t, o.subarray(this.an)).written;
    this.rs[j] = this.an;
    this.re[j] = this.an + n;
    this.an += n;
    this.kind[j] = C_RAW;
    this.mark(j);
  }

  private str2(j: number, b: Uint8Array, a: number, e: number, flags: number) {
    if (flags & LONG) throw new CsvError('A value is too large to convert');
    if (j < 0) return;
    this.place(j);
    if (e === a) return this.textHere(j, '');
    if (!(flags & ESC) && (!(flags & HI) || validUtf8(b, a, e))) {
      // (Copied as it is checked: given up at a quote, a line break, the delimiter or a formula's first character.)
      const c = b[a];
      if (c !== 61 && c !== 43 && c !== 45 && c !== 64) {
        const len = e - a;
        if (this.an + len > this.arena.length) this.grow(len);
        const o = this.arena;
        const dl = this.delim;
        let p = this.an;
        let k = a;
        for (; k < e; k++) {
          const x = b[k];
          if (x === dl || x === 34 || x === 13 || x === 10) break;
          o[p++] = x;
        }
        if (k === e) {
          this.rs[j] = this.an;
          this.re[j] = p;
          this.an = p;
          this.kind[j] = C_RAW;
          this.mark(j);
          return;
        }
      }
    }
    this.textHere(j, decodeString(b, a, e, flags));
  }

  private grow(len: number) {
    const g = new Uint8Array(Math.max(this.arena.length * 2, this.an + len + 64));
    g.set(this.arena.subarray(0, this.an));
    this.arena = g;
  }

  /** The row is complete: written (its line as made, or assembled in column order), and emptied. */
  private endRow(end: number) {
    if (end - this.recAt > RECORD_MAX) throw new CsvError('A record is too large to convert');
    const w = this.w;
    if (this.skip) this.skip = false;
    else if (this.inOrder) {
      if (this.an + (w - this.nextCol) + 4 > this.arena.length) this.grow(w - this.nextCol + 4);
      const o = this.arena;
      let p = this.an;
      for (let c = this.nextCol; c < w; c++) if (c) o[p++] = this.delim;
      // (Never an empty line: see CsvRows.)
      if (!p && w) {
        o[p++] = 34;
        o[p++] = 34;
      }
      o[p++] = 13;
      o[p++] = 10;
      this.out.bytes(o, 0, p);
      this.rows++;
    } else {
      const out = this.out;
      const kind = this.kind;
      const arena = this.arena;
      out.room(this.an + w + 4);
      const o = out.buf;
      const p0 = out.pos;
      let p = p0;
      for (let j = 0; j < w; j++) {
        if (j) o[p++] = this.delim;
        if (kind[j] === C_RAW) {
          const re = this.re[j];
          for (let x = this.rs[j]; x < re; x++) o[p++] = arena[x];
        }
      }
      if (p === p0 && w) {
        o[p++] = 34;
        o[p++] = 34;
      }
      o[p++] = 13;
      o[p++] = 10;
      out.pos = p;
      this.rows++;
    }
    for (const j of this.set) this.kind[j] = C_NONE;
    this.set.length = 0;
    this.an = 0;
    this.nextCol = 0;
    this.inOrder = true;
  }

  private startRow(at: number) {
    this.recAt = at;
  }

  /** The member path for name b[a, e) of the object at depth d: the one at that position last time if the name matches. */
  private child(d: number, b: Uint8Array, a: number, e: number, flags: number): PathNode {
    const node = this.nodes[d];
    const p = this.pos[d]++;
    let c = node.order[p];
    if (c) {
      const kb = c.key;
      if (kb.length === e - a) {
        let k = 0;
        while (k < kb.length && kb[k] === b[a + k]) k++;
        if (k === kb.length) return c;
      }
    }
    const name = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
    c = node.kids?.get(name);
    if (!c) {
      const seg = this.plan.esc && (name.indexOf('.') >= 0 || name.indexOf('\\') >= 0) ? name.replace(ESCAPE, '\\$&') : name;
      const path = node === this.root ? seg : node.path + '.' + seg;
      c = { col: this.plan.cols.get(path) ?? -1, path, key: b.slice(a, e), kids: null, order: [] };
      (node.kids ??= new Map()).set(name, c);
    }
    if (p < 4096) node.order[p] = c;
    return c;
  }

  /** An item of a joinable array: its raw bytes kept (a string's as written: decoded only if it must be). */
  private item(b: Uint8Array, a: number, e: number, flags: number, kind: number) {
    const len = e - a;
    if (this.jl + len > this.jb.length) {
      const g = new Uint8Array(Math.max(this.jb.length * 2, this.jl + len));
      g.set(this.jb.subarray(0, this.jl));
      this.jb = g;
    }
    const o = this.jb;
    let p = this.jl;
    for (let k = a; k < e; k++) o[p++] = b[k];
    if (this.jn * 4 + 4 > this.jr.length) {
      const g = new Int32Array(this.jr.length * 2);
      g.set(this.jr);
      this.jr = g;
    }
    const r = this.jr;
    const q = this.jn++ * 4;
    r[q] = this.jl;
    r[q + 1] = p;
    r[q + 2] = flags;
    r[q + 3] = kind;
    this.jl = p;
  }

  /**
   * A joinable array's cell: nestedCell's join of its items' texts with ", ", through toCsv's f. Written as
   * bytes when every item is plain (no escapes, valid UTF-8) and the text can't be a formula; else as text.
   */
  private joined(j: number) {
    if (j < 0) return;
    const n = this.jn;
    const r = this.jr;
    const jb = this.jb;
    const dl = this.delim;
    let plain = n > 0;
    // (Quoted: the ", " has a comma; or an item holds the delimiter, a quote or a line break.)
    let quote = n > 1 && dl === 44;
    // (Its first character: the first item's, or the separator's if that item is empty.)
    if (plain && r[1] > r[0]) {
      const c = jb[r[0]];
      if (c === 61 || c === 43 || c === 45 || c === 64) plain = false;
    }
    // (One empty item: the text is empty, written "" as toCsv writes an empty string.)
    if (plain && n === 1 && r[1] === r[0]) return this.text(j, '');
    for (let k = 0; plain && k < n; k++) {
      const a = r[k * 4];
      const e = r[k * 4 + 1];
      const fl = r[k * 4 + 2];
      if (fl & ESC || (fl & HI && !validUtf8(jb, a, e))) plain = false;
      else if (!quote) for (let x = a; x < e; x++) if (jb[x] === dl || jb[x] === 34 || jb[x] === 13 || jb[x] === 10) quote = true;
    }
    if (!plain) {
      const parts: string[] = [];
      for (let k = 0; k < n; k++) {
        const a = r[k * 4];
        const e = r[k * 4 + 1];
        parts.push(r[k * 4 + 3] === STR ? decodeString(jb, a, e, r[k * 4 + 2]) : latin(jb, a, e));
      }
      this.text(j, parts.join(', '));
      return;
    }
    this.place(j);
    const need = this.jl + n * 2 + 2;
    if (this.an + need > this.arena.length) this.grow(need);
    const o = this.arena;
    let p = this.an;
    this.rs[j] = p;
    if (quote) o[p++] = 34;
    for (let k = 0; k < n; k++) {
      if (k) {
        o[p++] = 44;
        o[p++] = 32;
      }
      const e = r[k * 4 + 1];
      for (let x = r[k * 4]; x < e; x++) o[p++] = jb[x];
    }
    if (quote) o[p++] = 34;
    this.re[j] = p;
    this.an = p;
    this.kind[j] = C_RAW;
    this.mark(j);
  }

  private startCap(col: number, kind: number) {
    this.cap = 1;
    this.capCol = col;
    this.capJoin = this.dot && kind === ARR;
    this.jl = 0;
    this.jn = 0;
    this.capF.open(kind);
  }


  open(kind: number, at: number) {
    if (this.cap) {
      if (this.cap === 1) this.capJoin = false;
      this.cap++;
      this.capF.open(kind);
      return;
    }
    if (this.rootKind < 0) {
      this.rootKind = kind;
      this.d = 1;
      return;
    }
    const d = this.d;
    const mode = this.plan.mode;
    if (d === 1) {
      this.startRow(at);
      if ((mode === 'records' || mode === 'keyed') && kind === OBJ) {
        if (mode === 'keyed') this.text(0, this.recKey);
        this.d = 2;
        this.nodes[2] = this.root;
        this.pos[2] = 0;
        return;
      }
      if (mode === 'matrix') {
        this.matrix = true;
        this.mpos = 0;
        this.d = 2;
        return;
      }
      // (An array record: one cell, its nested value.)
      this.startCap(mode === 'records' ? this.plan.vc : 0, kind);
      return;
    }
    if (this.matrix) {
      this.startCap(this.mpos++, kind);
      return;
    }
    const node = this.next!;
    if (kind === OBJ && this.dot) {
      this.d = d + 1;
      this.nodes[d + 1] = node;
      this.pos[d + 1] = 0;
      return;
    }
    this.startCap(node.col, kind);
  }

  close(kind: number, end: number) {
    if (this.cap) {
      this.capF.close(kind);
      if (--this.cap > 0) return;
      // (An empty array isn't joined: nestedCell writes it as "[]".)
      if (this.capJoin && this.jn) {
        this.capOut.reset();
        this.joined(this.capCol);
      } else this.text(this.capCol, this.capOut.takeText());
      // (The record itself was the nested value: its row is done.)
      if (this.d === 1) this.endRow(end);
      return;
    }
    const d = this.d;
    if (d === 1) {
      this.d = 0;
      return;
    }
    this.d = d - 1;
    if (d === 2) {
      this.matrix = false;
      this.endRow(end);
      return;
    }
    // (A flattened object with no members is a cell of its own: {}.)
    if (this.pos[d] === 0) this.text(this.nodes[d].col, '{}');
  }

  key(b: Uint8Array, a: number, e: number, flags: number) {
    if (this.cap) {
      this.capF.key(b, a, e, flags);
      return;
    }
    if (this.d === 1) this.recKey = flags ? decodeString(b, a, e, flags) : latin(b, a, e);
    else this.next = this.child(this.d, b, a, e, flags);
  }

  /** The column of a scalar starting now; -2: it is a record itself (see recordCol). */
  private scalarAt(): number {
    const d = this.d;
    if (d === 2 && this.matrix) return this.mpos++;
    if (d >= 2) return this.next!.col;
    return -2;
  }

  /** A record that is a scalar (or the document, one scalar): its row begins, and its one cell's column. */
  private recordCol(at: number): number {
    if (this.rootKind < 0) {
      this.rootKind = NUM;
      this.startRow(at);
      return 0;
    }
    this.startRow(at);
    return this.plan.mode === 'records' ? this.plan.vc : 0;
  }

  str(b: Uint8Array, a: number, e: number, flags: number, at: number) {
    if (this.cap) {
      if (flags & LONG) throw new CsvError('A value is too large to convert');
      this.capF.str(b, a, e, flags);
      if (this.cap === 1 && this.capJoin) this.item(b, a, e, flags, STR);
      return;
    }
    if (at - this.recAt > RECORD_MAX) throw new CsvError('A record is too large to convert');
    const j = this.scalarAt();
    if (j !== -2) return this.str2(j, b, a, e, flags);
    this.str2(this.recordCol(at), b, a, e, flags);
    this.endRow(at);
  }

  num(b: Uint8Array, a: number, e: number, at: number) {
    if (this.cap) {
      this.capF.num(b, a, e);
      if (this.cap === 1 && this.capJoin) this.item(b, a, e, 0, NUM);
      return;
    }
    const j = this.scalarAt();
    if (j !== -2) return this.raw(j, b, a, e);
    this.raw(this.recordCol(at), b, a, e);
    this.endRow(at);
  }

  lit(kind: number, v: boolean, at: number) {
    if (this.cap) {
      this.capF.lit(kind, v);
      if (this.cap === 1 && this.capJoin) {
        const w = kind === NUL ? LIT_NULL : v ? LIT_TRUE : LIT_FALSE;
        this.item(w, 0, w.length, 0, BOOL);
      }
      return;
    }
    let j = this.scalarAt();
    const record = j === -2;
    if (record) j = this.recordCol(at);
    if (kind === NUL) this.none(j);
    else if (v) this.raw(j, LIT_TRUE, 0, 4);
    else this.raw(j, LIT_FALSE, 0, 5);
    if (record) this.endRow(at);
  }
}
