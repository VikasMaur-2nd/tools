/**
 * JSON → spreadsheet: shared tabulation, RFC 4180 CSV and a hand-written
 * Office Open XML (.xlsx) writer with its own ZIP container. Zero dependencies.
 */
import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { stringify, toValue } from '../json/format';
import { formulaSafe } from './formula';
import { isDataKey } from './keys';

export type Flatten = 'dot' | 'json';
export type CellValue = string | number | boolean | null;

/** Internal cell: a primitive node (raw number text kept), a derived string, or missing. */
type Cell = JNode | string | undefined;
interface Table {
  h: string[];
  r: Cell[][];
}

const text = (c: Cell): string =>
  c === undefined ? '' : typeof c === 'string' ? c : c.t === NUL ? '' : c.t === BOOL ? (c.v ? 'true' : 'false') : (c.v as string);

/** Nested value as one cell: non-empty arrays of primitives joined with ", " (dot mode), else minified JSON (`[]` as `{}` is). */
const nested = (n: JNode, dot: boolean): Cell => {
  if (n.t < ARR) return n;
  const k = kids(n);
  if (dot && n.t === ARR && k.length && k.every((c) => c.t < ARR)) return k.map((c) => (c.t === NUL ? 'null' : text(c))).join(', ');
  return stringify(n, '');
};

const DOTTED = { dotted: true };
const ESC = /[\\.]/g;

/**
 * What escaped paths (`a\.b`: the key "a.b"; `a.b`: b inside a) read as: plain
 * dotted text, except where different paths would read alike.
 */
function readable(ids: string[]): string[] {
  let out: string[] | null = null;
  // plain names of the escaped ids → their id ('' when several share it)
  const own = new Map<string, string>();
  for (let j = 0; j < ids.length; j++) {
    if (ids[j].indexOf('\\') < 0) continue;
    const s = ids[j].replace(/\\(.)/g, '$1');
    (out ??= ids.slice())[j] = s;
    const o = own.get(s);
    own.set(s, o === undefined || o === ids[j] ? ids[j] : '');
  }
  if (!out) return ids;
  let clash = false;
  for (const o of own.values()) if (!o) clash = true;
  for (let j = 0; j < ids.length && !clash; j++) if (out[j] === ids[j] && own.has(ids[j])) clash = true;
  // escape whatever reads like another path until nothing does (each id is escaped at most once)
  for (let again = clash; again; ) {
    again = false;
    const owner = new Map<string, string>();
    const dup = new Set<string>();
    for (let j = 0; j < ids.length; j++) {
      const o = owner.get(out[j]);
      if (o === undefined) owner.set(out[j], ids[j]);
      else if (o !== ids[j]) dup.add(out[j]);
    }
    for (let j = 0; j < ids.length; j++) {
      if (out[j] !== ids[j] && dup.has(out[j])) {
        out[j] = ids[j];
        again = true;
      }
    }
  }
  return out;
}

/**
 * The grid of `tabulate`. Dotted paths name one place each as long as no key
 * has a dot of its own; when one does, the table is made again with keys
 * escaped (`\.`, `\\`), so values that would share a column keep their own.
 */
function table(root: JNode, flatten: Flatten): Table {
  if (flatten !== 'dot') return grid(root, false, false);
  try {
    return grid(root, true, false);
  } catch (e) {
    if (e !== DOTTED) throw e;
    return grid(root, true, true);
  }
}

/** `esc`: keys escaped in dotted paths; without it, a key with a dot throws DOTTED (see table). */
function grid(root: JNode, dot: boolean, esc: boolean): Table {
  // column ids: dotted paths or keys, named once the table is complete
  let h: string[] = [];
  const r: Cell[][] = [];
  const idx = new Map<string, number>();
  // Unescaped, a path of d keys without dots has d - 1 dots; a key with a dot
  // changes that count or meets a column made by a path of another length. So
  // column depths spot dotted keys without looking at every key of every record.
  const depth: number[] = [];
  const check = dot && !esc;
  const col = (k: string, d: number) => {
    let j = idx.get(k);
    if (j === undefined) {
      if (check) {
        let dots = 0;
        for (let p = k.indexOf('.'); p >= 0; p = k.indexOf('.', p + 1)) dots++;
        if (dots !== d - 1) throw DOTTED;
      }
      idx.set(k, (j = h.push(k) - 1));
      depth[j] = d;
    } else if (check && depth[j] !== d) throw DOTTED;
    return j;
  };
  const escaped = new Map<string, string>();
  /** A key as one segment of a dotted path. */
  const seg = (k: string): string => {
    if (!esc || (k.indexOf('.') < 0 && k.indexOf('\\') < 0)) return k;
    let s = escaped.get(k);
    if (s === undefined) escaped.set(k, (s = k.replace(ESC, '\\$&')));
    return s;
  };
  // the columns added for object keys / non-object items, named after the data's own
  let kc = -1;
  let vc = -1;
  const valCol = () => (vc < 0 ? (vc = h.push('value') - 1) : vc);
  const put = (row: Cell[], n: JNode, path: string, d: number) => {
    if (dot && n.t === OBJ && kids(n).length) for (const c of kids(n)) put(row, c, path + '.' + seg(c.key as string), d + 1);
    else row[col(path, d)] = nested(n, dot);
  };
  const props = (row: Cell[], o: JNode) => {
    for (const c of kids(o)) put(row, c, seg(c.key as string), 1);
  };

  if (root.t === ARR) {
    const items = kids(root);
    if (!items.length) return { h, r };
    if (items.every((c) => c.t === ARR)) {
      // Matrix: a first row of strings is the header (Google Sheets "values" shape).
      let w = 0;
      for (const it of items) w = Math.max(w, kids(it).length);
      const first = kids(items[0]);
      const hasHead = items.length > 1 && first.length === w && first.every((c) => c.t === STR);
      for (let j = 0; j < w; j++) h.push(hasHead ? (first[j].v as string) : String(j + 1));
      for (let i = hasHead ? 1 : 0; i < items.length; i++) r.push(kids(items[i]).map((c) => nested(c, dot)));
      return { h, r };
    } else if (items.some((c) => c.t === OBJ)) {
      for (const it of items) {
        const row: Cell[] = [];
        if (it.t === OBJ) props(row, it);
        else if (it.t !== NUL) row[valCol()] = nested(it, dot);
        r.push(row);
      }
    } else {
      h.push('value');
      for (const it of items) r.push([nested(it, dot)]);
      return { h, r };
    }
  } else if (root.t === OBJ) {
    const list = kids(root);
    if (list.length && list.every((c) => c.t === OBJ)) {
      kc = h.push('key') - 1;
      for (const c of list) {
        const row: Cell[] = [c.key as string];
        props(row, c);
        r.push(row);
      }
    } else {
      // Key / value rows, one per value: dotted keys only matter where two paths read alike,
      // which takes a key with a dot and a path below the top level.
      let dotted = false;
      let deep = false;
      const key = (k: string) => {
        if (!dotted && k.indexOf('.') >= 0) dotted = true;
        return seg(k);
      };
      const walk = (n: JNode, path: string) => {
        if (dot && n.t === OBJ && kids(n).length) {
          deep = true;
          for (const c of kids(n)) walk(c, path + '.' + key(c.key as string));
        } else r.push([path, nested(n, dot)]);
      };
      for (const c of list) walk(c, dot ? key(c.key as string) : (c.key as string));
      if (dotted && deep && !esc) {
        const seen = new Set<string>();
        for (const row of r) {
          if (seen.has(row[0] as string)) throw DOTTED;
          seen.add(row[0] as string);
        }
      }
      if (esc) {
        const keys = readable(r.map((row) => row[0] as string));
        for (let i = 0; i < r.length; i++) r[i][0] = keys[i];
      }
      return { h: ['key', 'value'], r };
    }
  } else {
    h.push('value');
    r.push([root]);
    return { h, r };
  }
  if (esc) h = readable(h);
  if (kc >= 0 || vc >= 0) {
    const j = kc >= 0 ? kc : vc;
    const taken = new Set(h.filter((_, k) => k !== j));
    let name = h[j];
    while (taken.has(name)) name = '_' + name;
    h[j] = name;
  }
  return { h, r };
}

/**
 * An object of objects that are the rows of one table: keyed by data (ids, dates: the objects infer.ts makes
 * dictionaries), or of alike objects (each shares at least half its and the first one's keys between them).
 */
function keyedRows(n: JNode): boolean {
  const l = kids(n);
  if (!l.length || !l.every((c) => c.t === OBJ)) return false;
  if (l.every((c) => isDataKey(c.key as string))) return true;
  if (l.length < 2) return false;
  const first = new Set(kids(l[0]).map((c) => c.key as string));
  return l.every((o) => {
    const ks = kids(o);
    let shared = 0;
    for (const c of ks) if (first.has(c.key as string)) shared++;
    // (shared / union >= 1/2)
    return shared > 0 && shared * 3 >= first.size + ks.length;
  });
}

// An object with an id of its own is one record (an API's wrapper holds records, it isn't one), but for a JSON-RPC
// response's id, which is the call's.
const ID = /^(?:_?id|uuid|guid)$/i;
const oneRecord = (n: JNode) => {
  const l = kids(n);
  return l.some((c) => (c.t === STR || c.t === NUM) && ID.test(c.key as string)) && !l.some((c) => c.key === 'jsonrpc');
};

/**
 * The records a spreadsheet should show: the root, unless it is an object that wraps them: then the largest
 * array of objects within two levels (`data`, `items`, `results`… in API responses). An object of alike objects
 * is a table already (one row per key), and a single record (one with an id) isn't replaced by an array it
 * holds, nor is a record inside the wrapper.
 */
export function records(root: JNode): JNode {
  if (root.t !== OBJ || keyedRows(root) || oneRecord(root)) return root;
  let best: JNode | null = null;
  const consider = (n: JNode) => {
    if (n.t !== ARR) return;
    const list = n.v as JNode[];
    if (!list.length || !list.some((c) => c.t === OBJ)) return;
    if (!best || list.length > (best.v as JNode[]).length) best = n;
  };
  for (const c of root.v as JNode[]) {
    consider(c);
    if (c.t === OBJ && !oneRecord(c)) for (const g of c.v as JNode[]) consider(g);
  }
  return best ?? root;
}

/**
 * Turns any JSON value into a header + rows grid (shared by CSV / XLSX export).
 * Array of objects → union of keys (first-seen order); array of primitives →
 * "value"; array of arrays → columns by position; object of objects → "key"
 * column + union of keys; other objects → key/value rows. Nested objects become
 * dot paths (`flatten: 'dot'`; `\.` for a dot in a key where two paths would
 * read alike) or minified JSON (`'json'`). The added "key" / "value" columns
 * give way to the data's own (`_value`). Missing → null; numbers that a JS
 * number can't hold exactly stay strings.
 */
export function tabulate(root: JNode, flatten: Flatten = 'dot'): { headers: string[]; rows: CellValue[][] } {
  const { h, r } = table(root, flatten);
  const rows = r.map((row) => {
    const o: CellValue[] = [];
    for (let j = 0; j < h.length; j++) {
      const c = row[j];
      o.push(c === undefined ? null : typeof c === 'string' ? c : c.t === NUM ? (toValue(c) as number | string) : (c.v as CellValue));
    }
    return o;
  });
  return { headers: h, rows };
}

export interface CsvOptions {
  flatten?: Flatten;
  delimiter?: ',' | ';' | '\t';
  /** Prepend a UTF-8 BOM so Excel detects the encoding. */
  bom?: boolean;
}

/**
 * RFC 4180 CSV (CRLF line endings). null/missing → empty field, "" → `""`. Numbers keep their exact source text;
 * formula-like text gets a leading ' (formulaSafe). A line is never empty: readers skip blank lines, so a
 * one-column row (or header) with nothing in it is `""` (which reads back as an empty string: CSV has no null).
 */
export function toCsv(root: JNode, opts: CsvOptions = {}): string {
  const d = opts.delimiter ?? ',';
  const { h, r } = table(root, opts.flatten ?? 'dot');
  const re = new RegExp('["\\r\\n' + (d === '\t' ? '\\t' : d) + ']');
  // (Text that would run as a formula is kept as text: see formulaSafe.)
  const f = (s: string) => ((s = formulaSafe(s)), re.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  let out = opts.bom ? '\ufeff' : '';
  if (h.length) out += (h.map(f).join(d) || '""') + '\r\n';
  for (const row of r) {
    let line = '';
    for (let j = 0; j < h.length; j++) {
      const c = row[j];
      const s = text(c);
      line += (j ? d : '') + (s === '' && c !== undefined && (typeof c === 'string' || c.t === STR) ? '""' : f(s));
    }
    out += (line || (h.length ? '""' : '')) + '\r\n';
  }
  return out;
}

// ── XLSX ─────────────────────────────────────────────────────────────────

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ROWS = 1048576;
const MAX_COLS = 16384;
const MAX_CELL = 32767;
const NS = 'http://schemas.openxmlformats.org/';
const MAIN = NS + 'spreadsheetml/2006/main';
const REL = NS + 'officeDocument/2006/relationships';
const PKG = NS + 'package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML specials, characters illegal in XML 1.0 (stripped) and Excel's own `_xHHHH_` escapes (protected).
const XT = /[&<>\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|_x[\da-fA-F]{4}_/;
const XR = new RegExp(XT.source, 'g');
const xe = (s: string) =>
  XT.test(s) ? s.replace(XR, (m) => (m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m.length > 1 ? '_x005F' + m : '')) : s;
const xa = (s: string) => xe(s).replace(/"/g, '&quot;');

/** `<is>` payload for an inline string (truncated to Excel's 32,767-character cell limit). */
const istr = (s: string) => {
  if (s.length > MAX_CELL) s = s.slice(0, (s.charCodeAt(MAX_CELL - 1) & 0xfc00) === 0xd800 ? MAX_CELL - 1 : MAX_CELL);
  const a = s.charCodeAt(0);
  const b = s.charCodeAt(s.length - 1);
  return (a <= 32 || b <= 32 ? '<is><t xml:space="preserve">' : '<is><t>') + xe(s) + '</t></is>';
};

const colName = (j: number) => {
  let s = '';
  for (j++; j > 0; j = ((j - 1) / 26) | 0) s = String.fromCharCode(65 + ((j - 1) % 26)) + s;
  return s;
};

/**
 * Excel holds doubles from about 2.2251e-308 to 9.99999999999999e307 (showing 15
 * digits): numbers a double can't hold exactly, values out of that range and
 * integer parts longer than 15 digits (IDs, big ints) are written as text.
 */
const numeric = (c: JNode) => {
  const raw = c.v as string;
  let k = 0;
  const neg = raw.charCodeAt(0) === 45 ? 1 : 0;
  for (k = neg; k < raw.length; k++) {
    const ch = raw.charCodeAt(k);
    if (ch < 48 || ch > 57) break;
  }
  if (k - neg > 15) return false;
  if (k === raw.length) return true;
  // significant digits: up to 15 always survive a double (as in any number of 16 characters or
  // fewer, sign aside); 16 or 17 only for some values; more never
  let sig = 0;
  if (raw.length - neg > 16) {
    let zeros = 0;
    for (let p = neg; p < raw.length; p++) {
      const ch = raw.charCodeAt(p);
      if (ch === 46) continue;
      if (ch < 48 || ch > 57) break;
      if (ch !== 48) {
        sig += zeros + 1;
        zeros = 0;
      } else if (sig) zeros++;
    }
    if (sig > 17) return false;
  }
  const v = sig > 15 ? toValue(c) : Number(raw);
  if (typeof v !== 'number') return false;
  const a = Math.abs(v);
  // (0 from a non-zero mantissa is an underflow: 1e-999)
  return a === 0 ? /^-?[0.]+(?:[eE]|$)/.test(raw) : a >= 2.2251e-308 && a <= 9.99999999999999e307;
};

const sheetName = (s: string | undefined) => {
  const t = (s ?? '')
    .replace(/[\\/?*:[\]\x00-\x1f]/g, ' ')
    .trim()
    .slice(0, 31)
    .replace(/^'+|'+$/g, '');
  return t && t.toLowerCase() !== 'history' ? t : 'Sheet1';
};

export interface XlsxOptions {
  sheetName?: string;
  flatten?: Flatten;
}

/** Builds a single-sheet .xlsx: bold frozen header with autofilter, typed cells, content-sized columns. */
export async function toXlsx(root: JNode, opts: XlsxOptions = {}): Promise<Blob> {
  const { h, r } = table(root, opts.flatten ?? 'dot');
  const nc = h.length;
  const nr = r.length;
  if (nc > MAX_COLS) throw new Error(`Too many columns for Excel: ${nc.toLocaleString()} (max ${MAX_COLS.toLocaleString()})`);
  if (nr + 1 > MAX_ROWS) throw new Error(`Too many rows for Excel: ${nr.toLocaleString()} (max ${(MAX_ROWS - 1).toLocaleString()})`);
  const name = sheetName(opts.sheetName);
  const enc = new TextEncoder();
  const L: string[] = [];
  const P: string[] = [];
  const w: number[] = [];
  for (let j = 0; j < nc; j++) {
    L.push(colName(j));
    P.push('<c r="' + L[j]);
    w.push(h[j].length * 1.1 + 4);
  }
  // rows are UTF-8 encoded straight into 4 MB buffers (no giant strings, little GC)
  const chunks: Uint8Array[] = [];
  let buf = new Uint8Array(0);
  let pos = 0;
  const put = (s: string) => {
    if (pos + s.length * 3 > buf.length) {
      if (pos) chunks.push(buf.subarray(0, pos));
      buf = new Uint8Array(Math.max(1 << 22, s.length * 3));
      pos = 0;
    }
    pos += enc.encodeInto(s, buf.subarray(pos)).written;
  };
  let s = '';
  if (nc) {
    s = '<row r="1">';
    for (let j = 0; j < nc; j++) s += '<c r="' + L[j] + '1" t="inlineStr" s="1">' + istr(h[j]) + '</c>';
    s += '</row>';
  }
  for (let i = 0; i < nr; i++) {
    const row = r[i];
    const rn = String(i + 2);
    s += '<row r="' + rn + '">';
    for (let j = 0; j < row.length; j++) {
      const c = row[j];
      if (c === undefined) continue;
      let t: string;
      if (typeof c !== 'string' && c.t !== STR) {
        if (c.t === NUL) continue;
        if (c.t === BOOL) {
          s += P[j] + rn + '" t="b"><v>' + (c.v ? '1</v></c>' : '0</v></c>');
          t = c.v ? 'TRUE' : 'FALSE';
        } else {
          t = c.v as string;
          s += numeric(c) ? P[j] + rn + '"><v>' + t + '</v></c>' : P[j] + rn + '" t="inlineStr">' + istr(t) + '</c>';
        }
      } else {
        t = typeof c === 'string' ? c : (c.v as string);
        if (!t) continue;
        s += P[j] + rn + '" t="inlineStr">' + istr(t) + '</c>';
      }
      if (t.length > w[j]) w[j] = t.length;
    }
    put(s + '</row>');
    s = '';
  }
  put(s);
  chunks.push(buf.subarray(0, pos));

  const ref = nc ? 'A1:' + L[nc - 1] + (nr + 1) : 'A1';
  let head = HEAD + `<worksheet xmlns="${MAIN}"><dimension ref="${ref}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0">`;
  if (nc) head += '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
  head += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
  if (nc) {
    head += '<cols>';
    for (let j = 0; j < nc; j++) head += `<col min="${j + 1}" max="${j + 1}" width="${Math.min(60, Math.max(8, Math.round(w[j] * 1.1 + 2))).toFixed(1)}" customWidth="1"/>`;
    head += '</cols>';
  }
  head += '<sheetData>';
  const tail = '</sheetData>' + (nc ? `<autoFilter ref="${ref}"/>` : '') + '</worksheet>';
  const absRef = nc ? `'${xa(name).replace(/'/g, "''")}'!$A$1:$${L[nc - 1]}$${nr + 1}` : '';

  const files: [string, string | Uint8Array[]][] = [
    [
      '[Content_Types].xml',
      HEAD +
        '<Types xmlns="' +
        NS +
        'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ],
    ['_rels/.rels', HEAD + `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      'xl/workbook.xml',
      HEAD +
        `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="${xa(name)}" sheetId="1" r:id="rId1"/></sheets>` +
        (absRef ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${absRef}</definedName></definedNames>` : '') +
        '</workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      HEAD +
        `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      HEAD +
        `<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    ['xl/worksheets/sheet1.xml', [enc.encode(head), ...chunks, enc.encode(tail)]],
  ];
  return blob(await zip(files.map(([n, d]) => [n, typeof d === 'string' ? [enc.encode(d)] : d])), XLSX_MIME);
}

// ── ZIP ──────────────────────────────────────────────────────────────────

// (cast: DOM typings want ArrayBuffer-backed views, Node typings any view)
const blob = (parts: Uint8Array[], type?: string) => new Blob(parts as unknown as ConstructorParameters<typeof Blob>[0], { type });

let CRC: Int32Array | undefined;
const crc32 = (d: Uint8Array, c: number) => {
  let t = CRC;
  if (!t) {
    t = CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      t[n] = x;
    }
  }
  for (let k = 0; k < d.length; k++) c = t[(c ^ d[k]) & 255] ^ (c >>> 8);
  return c;
};

/**
 * DEFLATE via the platform's CompressionStream('gzip'): the gzip trailer also
 * hands us the CRC-32 natively. null when unavailable (→ STORE + JS CRC).
 */
async function gzip(data: Uint8Array[]): Promise<[Uint8Array, number] | null> {
  let cs: CompressionStream;
  try {
    cs = new CompressionStream('gzip');
  } catch {
    return null;
  }
  const parts: Uint8Array[] = [];
  let len = 0;
  const rd = blob(data).stream().pipeThrough(cs).getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value);
    len += value.length;
  }
  const a = new Uint8Array(len);
  len = 0;
  for (const p of parts) {
    a.set(p, len);
    len += p.length;
  }
  // header: 10 bytes + optional FEXTRA / FNAME / FCOMMENT / FHCRC
  const flg = a[3];
  let h = 10;
  if (flg & 4) h += 2 + (a[10] | (a[11] << 8));
  if (flg & 8) while (a[h++]);
  if (flg & 16) while (a[h++]);
  if (flg & 2) h += 2;
  return [a.subarray(h, len - 8), new DataView(a.buffer, len - 8, 4).getUint32(0, true)];
}

/** Minimal ZIP writer (no ZIP64): local headers + data, central directory, end record. */
async function zip(files: [string, Uint8Array[]][]): Promise<Uint8Array[]> {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const out: Uint8Array[] = [];
  const cd: Uint8Array[] = [];
  let off = 0;
  let cdSize = 0;
  for (const [name, data] of files) {
    const size = data.reduce((a, b) => a + b.length, 0);
    let body = data;
    let method = 0;
    let csize = size;
    let crc: number;
    const z = await gzip(data);
    if (z) {
      crc = z[1];
      if (z[0].length < size) {
        body = [z[0]];
        method = 8;
        csize = z[0].length;
      }
    } else {
      crc = -1;
      for (const d of data) crc = crc32(d, crc);
      crc = ~crc >>> 0;
    }
    const nb = enc.encode(name);
    const fill = (v: DataView, o: number) => {
      v.setUint16(o, 20, true); // version needed
      v.setUint16(o + 2, 0x0800, true); // UTF-8 names
      v.setUint16(o + 4, method, true);
      v.setUint16(o + 6, time, true);
      v.setUint16(o + 8, date, true);
      v.setUint32(o + 10, crc, true);
      v.setUint32(o + 14, csize, true);
      v.setUint32(o + 18, size, true);
      v.setUint16(o + 22, nb.length, true);
    };
    const lh = new Uint8Array(30 + nb.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    fill(lv, 4);
    lh.set(nb, 30);
    const ch = new Uint8Array(46 + nb.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    fill(cv, 6);
    cv.setUint32(42, off, true);
    ch.set(nb, 46);
    out.push(lh, ...body);
    cd.push(ch);
    off += lh.length + csize;
    cdSize += ch.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, off, true);
  return [...out, ...cd, end];
}

/** The tabulation's cell rules, for huge mode's streamed CSV (lib/huge/stream/csv.ts), which applies them a record at a time. */
export { text as cellText, nested as nestedCell, readable as readableIds };
export type { Cell as GridCell };
