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
import type { Bytes } from './out';
import { decodeString } from './reformat';
import { LONG, type Visitor } from './walk';

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
  private rootKind = -1;
  private items = 0;
  // Arrays.
  private allArr = true;
  private someObj = false;
  private width = 0;
  private first: JNode | null = null;
  private vc = -1;
  // Columns: escaped ids (in order), and the plain ones.
  private ids: string[] = [];
  private plain: string[] = [];
  private cols = new Map<string, number>();
  private dotted = false;
  private overflow = false;
  // Objects.
  private allObj = true;
  private deep = false;
  private pairsDotted = false;
  private pairs: Map<string, string> | null = new Map();
  private dupPair = false;

  constructor(flatten: Flatten = 'dot') {
    this.dot = flatten === 'dot';
  }

  private col(plain: string, esc: string) {
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

  private seg(k: string) {
    return this.dot && (k.indexOf('.') >= 0 || k.indexOf('\\') >= 0) ? k.replace(ESCAPE, '\\$&') : k;
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
    const p = this.pairs;
    if (!p) return;
    const was = p.get(plain);
    if (was !== undefined) this.dupPair = true;
    else if (p.size >= MAX_PAIRS) this.pairs = null;
    else p.set(plain, esc);
  }

  /** The next record (`rootKind`: its container's kind). */
  record(n: JNode, rootKind: number) {
    this.rootKind = rootKind;
    this.items++;
    if (rootKind === ARR) {
      if (n.t === ARR) {
        if (this.items === 1) this.first = n;
        this.width = Math.max(this.width, kids(n).length);
      } else this.allArr = false;
      if (n.t === OBJ) {
        this.someObj = true;
        this.props(n);
      } else if (n.t !== NUL && this.vc < 0) {
        this.vc = this.ids.length;
        this.ids.push('value');
        this.plain.push('value');
      }
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
        const first = kids(this.first!);
        plan.head = this.items > 1 && first.length === w && first.every((c) => c.t === STR);
        for (let j = 0; j < w; j++) plan.header.push(plan.head ? (first[j].v as string) : String(j + 1));
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
        if (!this.pairs) throw new CsvError('Too many values with dotted names for a CSV file');
        plan.esc = true;
        const escs = [...new Set(this.pairs.values())];
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
    if (plan.header.length && plan.mode !== 'none') out.text(plan.header.map((s) => this.f(s)).join(this.delim) + '\r\n');
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
    this.out.text(line + '\r\n');
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
