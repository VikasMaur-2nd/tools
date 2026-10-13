/**
 * JSON → spreadsheet: shared tabulation, RFC 4180 CSV and a hand-written
 * Office Open XML (.xlsx) writer with its own ZIP container. Zero dependencies.
 */
import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids } from '../json/parser';
import { stringify, toValue } from '../json/format';

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

/** Nested value as one cell: arrays of primitives joined with ", " (dot mode), else minified JSON. */
const nested = (n: JNode, dot: boolean): Cell => {
  if (n.t < ARR) return n;
  const k = kids(n);
  if (dot && n.t === ARR && k.every((c) => c.t < ARR)) return k.map((c) => (c.t === NUL ? 'null' : text(c))).join(', ');
  return stringify(n, '');
};

function table(root: JNode, flatten: Flatten): Table {
  const dot = flatten === 'dot';
  const h: string[] = [];
  const r: Cell[][] = [];
  const idx = new Map<string, number>();
  const col = (k: string) => {
    let j = idx.get(k);
    if (j === undefined) idx.set(k, (j = h.push(k) - 1));
    return j;
  };
  let vc = -1;
  const valCol = () => (vc < 0 ? (vc = h.push('value') - 1) : vc);
  const put = (row: Cell[], n: JNode, path: string) => {
    if (dot && n.t === OBJ && kids(n).length) for (const c of kids(n)) put(row, c, path + '.' + c.key);
    else row[col(path)] = nested(n, dot);
  };
  const props = (row: Cell[], o: JNode) => {
    for (const c of kids(o)) put(row, c, c.key as string);
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
    }
  } else if (root.t === OBJ) {
    const list = kids(root);
    if (list.length && list.every((c) => c.t === OBJ)) {
      h.push('key');
      for (const c of list) {
        const row: Cell[] = [c.key as string];
        props(row, c);
        r.push(row);
      }
    } else {
      h.push('key', 'value');
      const walk = (n: JNode, path: string) => {
        if (dot && n.t === OBJ && kids(n).length) for (const c of kids(n)) walk(c, path + '.' + c.key);
        else r.push([path, nested(n, dot)]);
      };
      for (const c of list) walk(c, c.key as string);
    }
  } else {
    h.push('value');
    r.push([root]);
  }
  return { h, r };
}

/**
 * Turns any JSON value into a header + rows grid (shared by CSV / XLSX export).
 * Array of objects → union of keys (first-seen order); array of primitives →
 * "value"; array of arrays → columns by position; object of objects → "key"
 * column + union of keys; other objects → key/value rows. Nested objects become
 * dot paths (`flatten: 'dot'`) or minified JSON (`'json'`). Missing → null;
 * numbers that a JS number can't hold exactly stay strings.
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

/** RFC 4180 CSV (CRLF line endings). null/missing → empty field, "" → `""`. Numbers keep their exact source text. */
export function toCsv(root: JNode, opts: CsvOptions = {}): string {
  const d = opts.delimiter ?? ',';
  const { h, r } = table(root, opts.flatten ?? 'dot');
  const re = new RegExp('["\\r\\n' + (d === '\t' ? '\\t' : d) + ']');
  const f = (s: string) => (re.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  let out = opts.bom ? '\ufeff' : '';
  if (h.length) out += h.map(f).join(d) + '\r\n';
  for (const row of r) {
    let line = '';
    for (let j = 0; j < h.length; j++) {
      const c = row[j];
      const s = text(c);
      line += (j ? d : '') + (s === '' && c !== undefined && (typeof c === 'string' || c.t === STR) ? '""' : f(s));
    }
    out += line + '\r\n';
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

/** Excel keeps 15 significant digits: longer integer parts (IDs, big ints) and non-finite values are written as text. */
const numeric = (raw: string) => {
  let k = 0;
  const neg = raw.charCodeAt(0) === 45 ? 1 : 0;
  for (k = neg; k < raw.length; k++) {
    const c = raw.charCodeAt(k);
    if (c < 48 || c > 57) break;
  }
  return k - neg <= 15 && (k === raw.length || Number.isFinite(Number(raw)));
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
          s += numeric(t) ? P[j] + rn + '"><v>' + t + '</v></c>' : P[j] + rn + '" t="inlineStr">' + istr(t) + '</c>';
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
