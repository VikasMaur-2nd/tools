/**
 * CSV / TSV / YAML / XML / TOML → JSON text. Zero dependencies, browser-safe.
 * Numbers are carried as their source digits, so big integers survive exactly.
 */
import { normalizeNumber, tooDeep } from '../json/parser';
import { quote } from '../json/format';

export type Format = 'json' | 'csv' | 'tsv' | 'yaml' | 'xml' | 'toml' | 'unknown';
export type ImportFormat = 'csv' | 'tsv' | 'yaml' | 'xml' | 'toml';
export type ImportResult = { json: string } | { error: string; line?: number; col?: number };

/** A number kept as JSON number text. */
class Num {
  constructor(readonly r: string) {}
}
type V = null | boolean | string | Num | V[] | Map<string, V>;

class PErr {
  constructor(
    readonly m: string,
    readonly p: number,
  ) {}
}
function fail(m: string, p: number): never {
  throw new PErr(m, p);
}

const isWs = (c: number) => c === 32 || c === 9;

function emit(v: V, indent: string): string {
  let out = '';
  const nl = indent ? '\n' : '';
  const colon = indent ? ': ' : ':';
  const pads = [''];
  const w = (v: V, d: number) => {
    if (v === null) out += 'null';
    else if (typeof v === 'boolean') out += v ? 'true' : 'false';
    else if (typeof v === 'string') out += quote(v);
    else if (v instanceof Num) out += v.r;
    else {
      const arr = Array.isArray(v);
      if (!(arr ? v.length : v.size)) {
        out += arr ? '[]' : '{}';
        return;
      }
      const inner = pads[d + 1] ?? (pads[d + 1] = pads[d] + indent);
      out += (arr ? '[' : '{') + nl + inner;
      let first = true;
      for (const e of v) {
        if (!first) out += ',' + nl + inner;
        first = false;
        if (arr) w(e as V, d + 1);
        else {
          const [k, x] = e as [string, V];
          out += quote(k) + colon;
          w(x, d + 1);
        }
      }
      out += nl + pads[d] + (arr ? ']' : '}');
    }
  };
  w(v, 0);
  return out;
}

/** `\x` / `\u` / `\U` escape payload at `p` (len hex digits) → string, or null. */
const hexEsc = (s: string, p: number, len: number): string | null => {
  const h = s.slice(p, p + len);
  if (h.length < len || !/^[\da-fA-F]+$/.test(h)) return null;
  const cp = parseInt(h, 16);
  return cp > 0x10ffff ? null : String.fromCodePoint(cp);
};

// ── detection ────────────────────────────────────────────────────────────

const EXT: Record<string, Format> = {
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json', ndjson: 'json', geojson: 'json', har: 'json', ipynb: 'json', webmanifest: 'json',
  csv: 'csv', tsv: 'tsv', tab: 'tsv', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', svg: 'xml', rss: 'xml', atom: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', wsdl: 'xml', plist: 'xml', kml: 'xml', gpx: 'xml', xlf: 'xml', resx: 'xml', csproj: 'xml',
};
const DELIMS = [44, 59, 9, 124];

/** Most consistent delimiter among , ; TAB | over the first lines, and the share of lines that agree. */
function sniff(s: string): [string, number] {
  const counts: number[][] = [];
  let row = [0, 0, 0, 0];
  let inQ = false;
  let any = false;
  const lim = Math.min(s.length, 65536);
  for (let i = 0; i < lim && counts.length < 20; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) {
      inQ = !inQ;
      any = true;
    } else if (inQ) continue;
    else if (c === 10 || c === 13) {
      if (any) counts.push(row);
      row = [0, 0, 0, 0];
      any = false;
    } else {
      any = true;
      const k = DELIMS.indexOf(c);
      if (k >= 0) row[k]++;
    }
  }
  if (any && lim === s.length && counts.length < 20) counts.push(row);
  let best = 0;
  let score = 0;
  let share = 0;
  for (let k = 0; k < 4; k++) {
    const f = counts.length ? counts[0][k] : 0;
    if (!f) continue;
    let same = 0;
    for (const r of counts) if (r[k] === f) same++;
    const sc = (same / counts.length) * 1000 + f;
    if (sc > score) {
      score = sc;
      best = k;
      share = same / counts.length;
    }
  }
  return [String.fromCharCode(DELIMS[best]), share];
}

/** Cheap format guess; a known file extension wins. */
export function detectFormat(text: string, fileName?: string): Format {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName ?? '')?.[1].toLowerCase();
  if (ext && Object.hasOwn(EXT, ext)) return EXT[ext];
  if (fileName && /(^|[\\/])(Cargo\.lock|Pipfile|poetry\.lock|uv\.lock)$/.test(fileName)) return 'toml';
  const s = text.slice(0, 16384).replace(/^\ufeff/, '').trimStart();
  if (!s) return 'unknown';
  const c = s[0];
  if (c === '<') return 'xml';
  if (c === '{') return 'json';
  const kv = /^[ \t]*[\w"'-][\w.\-"' ]*=[ \t]*\S/m;
  if (c === '[') return /^\[\[?[\w."' -]+\]\]?[ \t]*(#.*)?$/m.test(s.split('\n', 1)[0]) && kv.test(s) ? 'toml' : 'json';
  if (/^(---|%YAML)(\s|$)/.test(s)) return 'yaml';
  if (/^\/[/*]/.test(s)) return 'json';
  const line = s.split('\n').find((l) => l.trim() && !/^\s*#/.test(l)) ?? '';
  if (/^\[\[?[\w."' -]+\]\]?\s*(#.*)?$/.test(line) || /^[\w"'-][\w.\-"' ]*=\s*\S/.test(line)) return 'toml';
  if (/^\s*-(\s|$)/.test(line) || /^\s*("[^"]*"|'[^']*'|[^\s#'"{[,][^#,]*?):(\s|$)/.test(line)) return 'yaml';
  const [d, share] = sniff(s);
  if (line.includes(d) && share >= 0.8) return d === '\t' ? 'tsv' : 'csv';
  if (/^("|-?\d|(true|false|null)\s*$)/.test(s)) return 'json';
  return 'unknown';
}

// ── CSV / TSV ────────────────────────────────────────────────────────────

const CSV_NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/** JSON text for one CSV field. Unquoted: number / boolean / null inference; quoted: string. */
const csvCell = (f: string, quoted: boolean): string => {
  if (quoted) return quote(f);
  if (f === '') return 'null';
  const t = f.charCodeAt(0) <= 32 || f.charCodeAt(f.length - 1) <= 32 ? f.trim() : f;
  const c = t.charCodeAt(0);
  if ((c >= 48 && c <= 57) || c === 45) {
    if (CSV_NUM.test(t)) {
      let k = c === 45 ? 1 : 0;
      while (t.charCodeAt(k) >= 48 && t.charCodeAt(k) <= 57) k++;
      // > 15 integer digits: IDs / card / phone numbers → keep as text
      if (k - (c === 45 ? 1 : 0) <= 15) return t;
    }
  } else if (c === 116 || c === 84) {
    if (t === 'true' || t === 'TRUE' || t === 'True') return 'true';
  } else if (c === 102 || c === 70) {
    if (t === 'false' || t === 'FALSE' || t === 'False') return 'false';
  }
  return quote(f);
};

function csv(src: string, delim: string | null, indent: string): string {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const hint = /^sep=(.)\r?\n/.exec(src.slice(i, i + 8));
  if (hint) {
    delim = hint[1];
    i += hint[0].length;
  }
  const d = (delim ?? sniff(src.slice(i))[0]).charCodeAt(0);
  const n = src.length;
  const nl = indent ? '\n' : '';
  const colon = indent ? ': ' : ':';
  const p1 = nl + indent;
  const p2 = p1 + indent;
  let keys: string[] | null = null;
  const qk: string[] = [];
  let seen: Set<string> = new Set();
  let quoteAll = -1;
  let out = '[';
  let count = 0;
  const addKey = (k: string) => {
    let name = k.trim() || 'column_' + ((keys as string[]).length + 1);
    for (let x = 2; seen.has(name); x++) name = (k.trim() || 'column') + '_' + x;
    seen.add(name);
    (keys as string[]).push(name);
    qk.push(p2 + quote(name) + colon);
  };
  let row: string[] = [];
  let q: boolean[] = [];
  for (;;) {
    let f: string;
    let quoted = false;
    if (src.charCodeAt(i) === 34) {
      quoted = true;
      const st = i++;
      f = '';
      for (;;) {
        const e = src.indexOf('"', i);
        if (e < 0) fail('Unterminated quoted field: missing closing "', st);
        f += src.slice(i, e);
        i = e + 1;
        if (src.charCodeAt(i) !== 34) break;
        f += '"';
        i++;
      }
      // lenient: text between the closing quote and the next delimiter is kept
      let j = i;
      while (j < n && src.charCodeAt(j) !== d && src.charCodeAt(j) !== 10 && src.charCodeAt(j) !== 13) j++;
      if (j > i) f += src.slice(i, j);
      i = j;
    } else {
      let j = i;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === d || c === 10 || c === 13) break;
        j++;
      }
      f = src.slice(i, j);
      i = j;
    }
    row.push(f);
    q.push(quoted);
    const c = src.charCodeAt(i);
    if (c === d) {
      i++;
      continue;
    }
    if (row.length > 1 || row[0] !== '' || q[0]) {
      if (!keys) {
        keys = [];
        seen = new Set();
        for (const k of row) addKey(k);
      } else {
        if (quoteAll < 0) quoteAll = q.every(Boolean) ? 1 : 0;
        while (keys.length < row.length) addKey('');
        out += (count++ ? ',' : '') + p1 + '{';
        for (let j = 0; j < keys.length; j++) {
          const v = j < row.length ? (quoteAll && q[j] && row[j] !== '' ? csvCell(row[j], false) : csvCell(row[j], q[j])) : 'null';
          out += (j ? ',' + qk[j] : qk[j]) + v;
        }
        out += (keys.length ? p1 : '') + '}';
      }
    }
    if (i >= n) break;
    i += c === 13 && src.charCodeAt(i + 1) === 10 ? 2 : 1;
    if (i >= n) break;
    row = [];
    q = [];
  }
  return count ? out + nl + ']' : '[]';
}

// ── YAML ─────────────────────────────────────────────────────────────────

const YESC: Record<string, string> = {
  '0': '\x00', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
};

/** YAML 1.2 core-schema resolution of a plain scalar. Leading-zero integers stay strings. */
function yScalar(t: string): V {
  switch (t) {
    case '': case '~': case 'null': case 'Null': case 'NULL':
      return null;
    case 'true': case 'True': case 'TRUE':
      return true;
    case 'false': case 'False': case 'FALSE':
      return false;
  }
  const c = t.charCodeAt(0);
  if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
    if (/^[-+]?\d+$/.test(t)) return /^[-+]?0\d/.test(t) ? t : new Num(t.replace(/^\+/, ''));
    if (/^0x[\da-fA-F]+$|^0o[0-7]+$/.test(t)) return new Num(BigInt(t).toString());
    if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(t)) return new Num(normalizeNumber(t));
    if (/^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/.test(t)) return null;
  }
  return t;
}

function yaml(src: string): V {
  const n = src.length;
  let i = 0;
  const anchors = new Map<string, V>();
  const at = (p: number) => src.charCodeAt(p);
  function f(m: string, p = i): never {
    return fail(m, p);
  }
  const sepAt = (p: number) => p >= n || isWs(at(p)) || at(p) === 10;
  const flowInd = (c: number) => c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  const col = (p: number) => {
    let s = p;
    while (s > 0 && at(s - 1) !== 10) s--;
    return p - s;
  };
  const docMark = (p: number) => (p === 0 || at(p - 1) === 10) && (src.startsWith('---', p) || src.startsWith('...', p)) && sepAt(p + 3);
  const dash = (p: number) => at(p) === 45 && sepAt(p + 1);
  const sp = () => {
    while (isWs(at(i))) i++;
  };
  const comment = () => {
    if (at(i) === 35) while (i < n && at(i) !== 10) i++;
  };
  const eolRest = () => {
    sp();
    comment();
    if (i < n && at(i) !== 10) f('Unexpected content after the value');
  };
  /** Skips blank lines and comments up to the next content (block context: no tab indentation). */
  const skip = () => {
    let tab = false;
    for (;;) {
      const c = at(i);
      if (c === 32) i++;
      else if (c === 9) {
        tab = true;
        i++;
      } else if (c === 10) {
        tab = false;
        i++;
      } else if (c === 35) comment();
      else break;
    }
    if (tab && i < n) f('Tabs are not allowed for indentation. Use spaces');
  };
  /** Position of the ':' if the line at p starts with an implicit key, else -1. */
  const keyEnd = (p: number): number => {
    const q = at(p);
    if (q === 34 || q === 39) {
      let j = p + 1;
      for (;;) {
        const c = at(j);
        if (j >= n || c === 10) return -1;
        if (c === q) {
          if (q === 39 && at(j + 1) === 39) {
            j += 2;
            continue;
          }
          break;
        }
        j += c === 92 && q === 34 ? 2 : 1;
      }
      j++;
      while (isWs(at(j))) j++;
      return at(j) === 58 ? j : -1;
    }
    if (q === 91 || q === 123 || q === 35) return -1;
    for (let j = p; j < n; j++) {
      const c = at(j);
      if (c === 10) return -1;
      if (c === 58 && sepAt(j + 1)) return j;
      if (c === 35 && isWs(at(j - 1))) return -1;
    }
    return -1;
  };
  const props = () => {
    let anchor = '';
    let tag = '';
    for (;;) {
      const c = at(i);
      if (c !== 38 && c !== 33) return [anchor, tag];
      const s = i;
      while (i < n && !sepAt(i) && !(c === 38 && i > s && flowInd(at(i)))) i++;
      if (c === 38) {
        anchor = src.slice(s + 1, i);
        if (!anchor) f('Expected an anchor name after &', s);
      } else tag = src.slice(s, i);
      sp();
    }
  };
  const alias = (): V => {
    const s = ++i;
    while (i < n && !sepAt(i) && !flowInd(at(i))) i++;
    const name = src.slice(s, i);
    const v = anchors.get(name);
    if (v === undefined) f(`Unknown alias *${name} : anchors must be defined (&${name}) before use`, s - 1);
    return v as V;
  };
  const quoted = (q: number): string => {
    const s = i++;
    let out = '';
    let seg = i;
    for (;;) {
      if (i >= n) f('Unterminated quoted string', s);
      const c = at(i);
      if (c === q) {
        out += src.slice(seg, i);
        i++;
        if (q === 39 && at(i) === 39) {
          seg = i++;
          continue;
        }
        return out;
      }
      if (c === 92 && q === 34) {
        out += src.slice(seg, i);
        const e = src[++i];
        i++;
        if (e === '\n') {
          while (isWs(at(i))) i++;
        } else if (e === 'x' || e === 'u' || e === 'U') {
          const len = e === 'x' ? 2 : e === 'u' ? 4 : 8;
          const v = hexEsc(src, i, len);
          if (v === null) f(`Invalid escape \\${e}`, i - 2);
          out += v;
          i += len;
        } else {
          if (!Object.hasOwn(YESC, e)) f(`Invalid escape sequence \\${e ?? ''}`, i - 2);
          out += YESC[e];
        }
        seg = i;
        continue;
      }
      if (c === 10) {
        out += src.slice(seg, i).replace(/[ \t]+$/, '');
        let breaks = 0;
        do {
          i++;
          breaks++;
          while (isWs(at(i))) i++;
        } while (at(i) === 10);
        if (docMark(i)) f('Unterminated quoted string', s);
        out += breaks > 1 ? '\n'.repeat(breaks - 1) : ' ';
        seg = i;
        continue;
      }
      i++;
    }
  };
  /** One line of a block plain scalar (stops at EOL or " #"), trailing spaces trimmed. */
  const plainLine = () => {
    const s = i;
    let e = i;
    while (i < n) {
      const c = at(i);
      if (c === 10 || (c === 35 && isWs(at(i - 1)))) break;
      i++;
      if (!isWs(c)) e = i;
    }
    return src.slice(s, e);
  };
  const plain = (ind: number, asStr: boolean): V => {
    const c = at(i);
    if (c === 64 || c === 96) f(`Plain values cannot start with '${src[i]}'. Wrap the value in quotes`);
    let t = plainLine();
    while (at(i) === 10) {
      let p = i;
      let q = p;
      let breaks = 0;
      for (;;) {
        breaks++;
        q = p + 1;
        while (isWs(at(q))) q++;
        if (at(q) !== 10) break;
        p = q;
      }
      if (q >= n || at(q) === 35 || q - p - 1 <= ind || docMark(q)) break;
      const k = keyEnd(q);
      if (k >= 0) f('Bad indentation of a mapping entry', q);
      i = q;
      t += breaks > 1 ? '\n'.repeat(breaks - 1) : ' ';
      t += plainLine();
    }
    return asStr ? t : yScalar(t);
  };
  const blockScalar = (ind: number): string => {
    const fold = at(i++) === 62;
    let chomp = 0;
    let explicit = 0;
    for (let k = 0; k < 2; k++) {
      const c = at(i);
      if ((c === 43 || c === 45) && !chomp) {
        chomp = c === 43 ? 1 : -1;
        i++;
      } else if (c >= 49 && c <= 57 && !explicit) {
        explicit = c - 48;
        i++;
      }
    }
    sp();
    comment();
    if (i < n && at(i) !== 10) f('Invalid block scalar header: expected |, >, an optional +/- and indentation digit');
    let bi = explicit ? Math.max(ind, 0) + explicit : -1;
    let out = '';
    let empty = 0;
    let more = false;
    let first = true;
    let p = i < n ? i + 1 : n;
    while (p < n) {
      let q = p;
      while (at(q) === 32 && (bi < 0 || q - p < bi)) q++;
      if (at(q) === 10 || q >= n) {
        empty++;
        p = q + 1;
        continue;
      }
      if (bi < 0) {
        if (q - p <= ind) break;
        bi = q - p;
      } else if (q - p < bi) break;
      if (docMark(p)) break;
      let e = q;
      while (e < n && at(e) !== 10) e++;
      const line = src.slice(p + bi, e);
      if (!fold) out += '\n'.repeat(first ? empty : empty + 1);
      else if (isWs(at(p + bi))) {
        more = true;
        out += '\n'.repeat(first ? empty : empty + 1);
      } else if (more) {
        more = false;
        out += '\n'.repeat(empty + 1);
      } else if (empty) out += '\n'.repeat(empty);
      else if (!first) out += ' ';
      out += line;
      first = false;
      empty = 0;
      p = e + 1;
    }
    i = Math.min(p, n);
    if (chomp > 0) out += '\n'.repeat(first ? empty : empty + 1);
    else if (!chomp && !first) out += '\n';
    return out;
  };
  const fws = () => {
    for (;;) {
      const c = at(i);
      if (c === 32 || c === 9 || c === 10) i++;
      else if (c === 35 && (isWs(at(i - 1)) || at(i - 1) === 10)) comment();
      else return;
    }
  };
  let rawKey: string | null = null;
  const flowNode = (): V => {
    fws();
    const [anchor, tag] = props();
    fws();
    rawKey = null;
    const c = at(i);
    let v: V;
    if (c === 91 || c === 123) v = flow();
    else if (c === 34 || c === 39) v = quoted(c);
    else if (c === 42) v = alias();
    else {
      const s = i;
      let e = i;
      while (i < n) {
        const d = at(i);
        if (flowInd(d) || (d === 58 && (sepAt(i + 1) || flowInd(at(i + 1)))) || (d === 35 && (isWs(at(i - 1)) || at(i - 1) === 10))) break;
        i++;
        if (!isWs(d) && d !== 10) e = i;
      }
      const t = src.slice(s, e).replace(/[ \t]*\n\s*/g, ' ');
      rawKey = t;
      v = tag === '!!str' ? t : yScalar(t);
    }
    if (anchor) anchors.set(anchor, v);
    return v;
  };
  const keyOf = (v: V, p: number): string => {
    if (rawKey !== null) return rawKey;
    if (v instanceof Map || Array.isArray(v)) f('Collections cannot be used as mapping keys', p);
    return v instanceof Num ? v.r : String(v);
  };
  const flow = (): V => {
    const s = i;
    const isMap = at(i++) === 123;
    const close = isMap ? 125 : 93;
    const a: V[] = [];
    const m = new Map<string, V>();
    for (;;) {
      fws();
      if (i >= n || docMark(i)) f(`Unterminated flow ${isMap ? "mapping: missing '}'" : "sequence: missing ']'"}`, s);
      if (at(i) === close) {
        i++;
        break;
      }
      const kp = i;
      const k = flowNode();
      const key = rawKey;
      fws();
      if (at(i) === 58) {
        i++;
        fws();
        const v = at(i) === 44 || at(i) === close ? null : flowNode();
        rawKey = key;
        const ks = keyOf(k, kp);
        if (isMap) {
          if (m.has(ks)) f(`Duplicate key "${ks}"`, kp);
          m.set(ks, v);
        } else a.push(new Map([[ks, v]]));
      } else if (isMap) {
        const ks = keyOf(k, kp);
        if (m.has(ks)) f(`Duplicate key "${ks}"`, kp);
        m.set(ks, null);
      } else a.push(k);
      fws();
      if (at(i) === 44) i++;
      else if (at(i) !== close) f(i >= n ? `Unterminated flow ${isMap ? "mapping: missing '}'" : "sequence: missing ']'"}` : `Expected ',' or '${isMap ? '}' : ']'}'`, i >= n ? s : i);
    }
    return isMap ? m : a;
  };
  const MAP = 1;
  const SEQ = 2;
  const node = (ind: number, ctx: number): V => {
    sp();
    const [anchor, tag] = props();
    let fresh = ctx === 0;
    let has = true;
    if (i >= n || at(i) === 10 || at(i) === 35) {
      // the value starts on a following line (or is empty)
      comment();
      skip();
      const c = i < n && !docMark(i) ? col(i) : -2;
      fresh = true;
      has = c > ind || (ctx === MAP && c === ind && dash(i));
    }
    let v: V = null;
    if (has) {
      const c = at(i);
      if (dash(i)) {
        if (!fresh && ctx === MAP) f('A sequence cannot start on the same line as its key. Move it to the next line');
        v = seq(col(i));
      } else if (c === 124 || c === 62) v = blockScalar(ind);
      else if (c === 42) {
        v = alias();
        eolRest();
      } else if (c === 63 && sepAt(i + 1)) f('Complex mapping keys (?) are not supported');
      else if (keyEnd(i) >= 0) {
        if (!fresh && ctx === MAP) f('Mapping values are not allowed here. Quote the value if it contains ": "', keyEnd(i));
        v = map(col(i));
      } else if (c === 91 || c === 123) {
        v = flow();
        eolRest();
      } else if (c === 34 || c === 39) {
        v = quoted(c);
        eolRest();
      } else v = plain(ind, tag === '!!str');
    }
    if (anchor) anchors.set(anchor, v);
    return v;
  };
  const map = (c: number): Map<string, V> => {
    const m = new Map<string, V>();
    let merged: Set<string> | null = null;
    for (;;) {
      const kp = i;
      if (at(i) === 63 && sepAt(i + 1)) f('Complex mapping keys (?) are not supported');
      const ce = keyEnd(i);
      if (ce < 0) f(dash(i) ? 'Expected a mapping key, found a sequence item. Check the indentation' : 'Expected a mapping key (key: value)');
      const q = at(i);
      let ke = ce;
      while (isWs(at(ke - 1))) ke--;
      const k = q === 34 || q === 39 ? quoted(q) : src.slice(i, ke);
      i = ce + 1;
      if (k === '<<' && q !== 34 && q !== 39) {
        const v = node(c, MAP);
        for (const s of Array.isArray(v) ? v : [v]) {
          if (!(s instanceof Map)) return f('A merge key (<<) needs a mapping or a list of mappings', kp);
          for (const [x, y] of s)
            if (!m.has(x)) {
              m.set(x, y);
              (merged ??= new Set()).add(x);
            }
        }
      } else {
        if (m.has(k) && !merged?.delete(k)) f(`Duplicate key "${k}"`, kp);
        m.set(k, node(c, MAP));
      }
      skip();
      if (i >= n || docMark(i)) break;
      const c2 = col(i);
      if (c2 < c) break;
      if (c2 > c) f('Bad indentation of a mapping entry');
    }
    return m;
  };
  const seq = (c: number): V[] => {
    const a: V[] = [];
    for (;;) {
      i++;
      a.push(node(c, SEQ));
      skip();
      if (i >= n || docMark(i)) break;
      const c2 = col(i);
      if (c2 < c || (c2 === c && !dash(i))) break;
      if (c2 > c) f('Bad indentation of a sequence item');
    }
    return a;
  };

  const docs: V[] = [];
  for (;;) {
    skip();
    while (at(i) === 37 && col(i) === 0) {
      while (i < n && at(i) !== 10) i++;
      skip();
    }
    if (i >= n) break;
    if (docMark(i)) {
      const end = at(i) === 46;
      i += 3;
      if (end) {
        eolRest();
        continue;
      }
    }
    anchors.clear(); // anchors belong to their document
    docs.push(node(-1, 0));
    skip();
    if (i < n && !docMark(i)) f(col(i) ? 'Bad indentation: this line is indented more than its block' : 'Unexpected content after the document');
  }
  return docs.length > 1 ? docs : (docs[0] ?? null);
}

// ── XML ──────────────────────────────────────────────────────────────────

const ENT = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);
const decode = (s: string) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[\da-fA-F]+|#\d+|[A-Za-z][\w.-]*);/g, (m, e: string) => {
        if (e[0] !== '#') return ENT.get(e) ?? m;
        const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      });

/**
 * xmltodict convention: `{root: …}`; attributes → "@name"; repeated child
 * elements → arrays; text-only elements → string; text next to attributes or
 * children → "#text"; empty elements → null. Text is trimmed; values stay strings.
 */
function xml(src: string): V {
  const n = src.length;
  let i = 0;
  interface Frame {
    name: string;
    m: Map<string, V> | null;
    text: string;
    p: number;
  }
  const stack: Frame[] = [];
  let root = null as Map<string, V> | null;
  const NAME = /[A-Za-z_:\u00c0-\uffff][\w.:\u00b7\u00c0-\uffff-]*/y;
  const at = (p: number) => src.charCodeAt(p);
  function f(m: string, p = i): never {
    return fail(m, p);
  }
  const name = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) return '';
    i += m[0].length;
    return m[0];
  };
  const ws = () => {
    while (isWs(at(i)) || at(i) === 10) i++;
  };
  const close = (fr: Frame) => {
    const t = fr.text.trim();
    let v: V = t || null;
    if (fr.m) {
      if (t) fr.m.set('#text', t);
      v = fr.m;
    }
    const par = stack[stack.length - 1];
    if (!par) {
      root = new Map([[fr.name, v]]);
      return;
    }
    const m = par.m ?? (par.m = new Map());
    if (!m.has(fr.name)) m.set(fr.name, v);
    else {
      const prev = m.get(fr.name) as V;
      if (Array.isArray(prev)) prev.push(v);
      else m.set(fr.name, [prev, v]);
    }
  };
  const skipTo = (end: string, what: string) => {
    const e = src.indexOf(end, i);
    if (e < 0) f(`Unterminated ${what}`);
    i = e + end.length;
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    if (end > i) {
      const top = stack[stack.length - 1];
      if (top) top.text += decode(src.slice(i, end));
      else {
        const k = src.slice(i, end).search(/\S/);
        if (k >= 0) f(root ? 'Unexpected text after the root element' : 'Text is not allowed before the root element', i + k);
      }
    }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) skipTo('-->', 'comment: missing -->');
    else if (src.startsWith('<![CDATA[', i)) {
      const top = stack[stack.length - 1];
      if (!top) f('CDATA is only allowed inside an element');
      const e = src.indexOf(']]>', i + 9);
      if (e < 0) f('Unterminated CDATA section: missing ]]>');
      top.text += src.slice(i + 9, e);
      i = e + 3;
    } else if (src.startsWith('<?', i)) skipTo('?>', 'processing instruction: missing ?>');
    else if (src.startsWith('<!', i)) {
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = at(j);
        if (c === 60 && src.startsWith('<!--', j)) {
          const e = src.indexOf('-->', j + 4);
          j = e < 0 ? n : e + 2;
        } else if (c === 91) depth++;
        else if (c === 93) depth--;
        else if (c === 62 && depth <= 0) break;
        else if (c === 34 || c === 39) {
          const e = src.indexOf(src[j], j + 1);
          j = e < 0 ? n : e;
        }
      }
      if (j >= n) f('Unterminated declaration: missing >');
      i = j + 1;
    } else if (at(i + 1) === 47) {
      i += 2;
      const nm = name();
      ws();
      if (at(i) !== 62) f(nm ? `Expected '>' to end </${nm}>` : 'Invalid closing tag');
      i++;
      const fr = stack.pop();
      if (!fr) f(`Unexpected closing tag </${nm}>`, lt);
      else if (fr.name !== nm) f(`Mismatched closing tag </${nm}>: expected </${fr.name}>`, lt);
      else close(fr);
    } else {
      i++;
      const nm = name();
      if (!nm) f(`Invalid character after '<'. Escape it as &lt;`, lt);
      if (!stack.length && root) f('Only one root element is allowed', lt);
      const fr: Frame = { name: nm, m: null, text: '', p: lt };
      let self = false;
      for (;;) {
        const sp = i;
        ws();
        const c = at(i);
        if (c === 62) {
          i++;
          break;
        }
        if (c === 47 && at(i + 1) === 62) {
          i += 2;
          self = true;
          break;
        }
        if (i >= n) f(`Unterminated tag <${nm}>: missing >`, lt);
        if (sp === i) f(`Expected whitespace, '>' or '/>' in <${nm}>`);
        const ap = i;
        const an = name();
        if (!an) f(`Unexpected '${src[i]}' in <${nm}>`);
        ws();
        if (at(i) !== 61) f(`Expected '=' after attribute ${an}`);
        i++;
        ws();
        const q = src[i];
        if (q !== '"' && q !== "'") f(`Attribute values must be quoted (${an}="…")`);
        const e = src.indexOf(q, i + 1);
        if (e < 0) f('Unterminated attribute value');
        const m = fr.m ?? (fr.m = new Map());
        if (m.has('@' + an)) f(`Duplicate attribute ${an}`, ap);
        m.set('@' + an, decode(src.slice(i + 1, e).replace(/[\t\n\r]/g, ' ')));
        i = e + 1;
      }
      if (self) close(fr);
      else stack.push(fr);
    }
  }
  const top = stack[stack.length - 1];
  if (top) f(`Unclosed element <${top.name}>`, top.p);
  if (!root) f('No root element found', 0);
  return root;
}

// ── TOML ─────────────────────────────────────────────────────────────────

const DT = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$|^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function toml(src: string): V {
  const n = src.length;
  let i = 0;
  const root = new Map<string, V>();
  let cur = root;
  // tables defined by [headers] / created by dotted keys / immutable (inline tables, static arrays) / arrays of tables
  const defined = new Set<object>();
  const dotted = new Set<object>();
  const frozen = new Set<object>();
  const aot = new Set<object>();
  const at = (p: number) => src.charCodeAt(p);
  function f(m: string, p = i): never {
    return fail(m, p);
  }
  const ws = () => {
    while (isWs(at(i))) i++;
  };
  const wsnl = () => {
    for (;;) {
      ws();
      if (at(i) === 35) while (i < n && at(i) !== 10) i++;
      if (at(i) !== 10) return;
      i++;
    }
  };
  const eol = () => {
    ws();
    if (at(i) === 35) while (i < n && at(i) !== 10) i++;
    if (i < n && at(i) !== 10) f(`Unexpected '${src[i]}': expected a new line after the value`);
  };
  const esc = (): string => {
    const c = src[i++];
    const simple = 'btnfre"\\'.indexOf(c);
    if (simple >= 0) return '\b\t\n\f\r\x1b"\\'[simple];
    const len = c === 'x' ? 2 : c === 'u' ? 4 : c === 'U' ? 8 : 0;
    const v = len ? hexEsc(src, i, len) : null;
    if (v === null) return f(`Invalid escape sequence \\${c ?? ''}`, i - 2);
    i += len;
    return v;
  };
  const str = (key: boolean): string => {
    const s = i;
    const q = at(i);
    const multi = at(i + 1) === q && at(i + 2) === q;
    if (multi && key) f('Multi-line strings cannot be used as keys');
    i += multi ? 3 : 1;
    if (multi && at(i) === 10) i++;
    let out = '';
    let seg = i;
    for (;;) {
      const c = at(i);
      if (i >= n || (c === 10 && !multi)) f('Unterminated string', s);
      if (c === q) {
        if (!multi) {
          out += src.slice(seg, i++);
          return out;
        }
        let run = 0;
        while (at(i + run) === q) run++;
        if (run >= 3) {
          if (run > 5) f('Too many quotes at the end of a multi-line string', i + 5);
          out += src.slice(seg, i + run - 3);
          i += run;
          return out;
        }
        i += run;
        continue;
      }
      if (c === 92 && q === 34) {
        out += src.slice(seg, i++);
        let j = i;
        while (isWs(at(j))) j++;
        if (multi && at(j) === 10) {
          i = j;
          while (isWs(at(i)) || at(i) === 10) i++;
        } else out += esc();
        seg = i;
        continue;
      }
      if ((c < 32 && c !== 9 && c !== 10) || c === 127) f('Control characters must be escaped in strings');
      i++;
    }
  };
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      ws();
      const c = at(i);
      if (c === 34 || c === 39) parts.push(str(true));
      else {
        const s = i;
        while (/[\w-]/.test(src[i] ?? '')) i++;
        if (s === i) f(i >= n || at(i) === 10 ? 'Expected a key' : `Invalid character '${src[i]}' in key. Quote the key`);
        parts.push(src.slice(s, i));
      }
      ws();
      if (at(i) !== 46) return parts;
      i++;
    }
  };
  const array = (): V[] => {
    const s = i++;
    const a: V[] = [];
    for (;;) {
      wsnl();
      if (at(i) === 93) {
        i++;
        break;
      }
      if (i >= n) f("Unterminated array: missing ']'", s);
      a.push(value());
      wsnl();
      if (at(i) === 44) i++;
      else if (at(i) !== 93) f(`Expected ',' or ']' in array, found ${i >= n ? 'end of input' : `'${src[i]}'`}`);
    }
    frozen.add(a);
    return a;
  };
  const inline = (): Map<string, V> => {
    i++;
    const m = new Map<string, V>();
    wsnl();
    while (at(i) !== 125) {
      keyval(m);
      wsnl();
      if (at(i) === 44) {
        i++;
        wsnl();
      } else if (at(i) !== 125) f(`Expected ',' or '}' in inline table, found ${i >= n ? 'end of input' : `'${src[i]}'`}`);
    }
    i++;
    frozen.add(m);
    return m;
  };
  const value = (): V => {
    const c = at(i);
    if (c === 34 || c === 39) return str(false);
    if (c === 91) return array();
    if (c === 123) return inline();
    const s = i;
    const stop = () => {
      for (let c = at(i); i < n && c !== 32 && c !== 9 && c !== 10 && c !== 44 && c !== 93 && c !== 125 && c !== 35; c = at(++i));
    };
    stop();
    if (/^\d{4}-\d{2}-\d{2}$/.test(src.slice(s, i)) && at(i) === 32 && /^\d{2}:/.test(src.slice(i + 1, i + 4))) {
      i++;
      stop();
    }
    const t = src.slice(s, i);
    if (!t) f(i >= n || at(i) === 10 ? 'Expected a value' : `Unexpected '${src[i]}': expected a value`);
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^[+-]?(inf|nan)$/.test(t)) return null;
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(t)) return new Num(t.replace(/_|^\+/g, ''));
    if (/^0x[\da-fA-F](_?[\da-fA-F])*$|^0o[0-7](_?[0-7])*$|^0b[01](_?[01])*$/.test(t)) return new Num(BigInt(t.replace(/_/g, '')).toString());
    if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(t)) return new Num(t.replace(/_|^\+/g, ''));
    if (DT.test(t)) return t.replace(/^(\d{4}-\d{2}-\d{2})[Tt ]/, '$1T').replace(/z$/, 'Z');
    return f(/^[+-]?\d/.test(t) ? `Invalid number '${t}'` : `Invalid value '${t}': strings must be quoted`, s);
  };
  const keyval = (t: Map<string, V>) => {
    const kp = i;
    const path = key();
    if (at(i) !== 61) f(`Expected '=' after the key, found ${i >= n || at(i) === 10 ? 'end of line' : `'${src[i]}'`}`);
    i++;
    ws();
    const v = value();
    let m = t;
    for (let k = 0; k < path.length - 1; k++) {
      let x = m.get(path[k]);
      if (x === undefined) {
        x = new Map();
        m.set(path[k], x);
        dotted.add(x);
      } else if (!(x instanceof Map) || !dotted.has(x) || frozen.has(x)) f(`Cannot add keys to "${path.slice(0, k + 1).join('.')}": it is already defined`, kp);
      m = x as Map<string, V>;
    }
    const last = path[path.length - 1];
    if (m.has(last)) f(`Duplicate key "${path.join('.')}"`, kp);
    m.set(last, v);
  };
  /** Walks a header path, creating implicit tables; returns the parent of the last segment. */
  const walk = (path: string[], kp: number): Map<string, V> => {
    let m = root;
    for (let k = 0; k < path.length - 1; k++) {
      let x = m.get(path[k]);
      if (x === undefined) m.set(path[k], (x = new Map()));
      else if (Array.isArray(x) && aot.has(x)) x = x[x.length - 1];
      if (!(x instanceof Map) || frozen.has(x)) f(`Cannot extend "${path.slice(0, k + 1).join('.')}": it is already defined as a value`, kp);
      m = x as Map<string, V>;
    }
    return m;
  };

  for (;;) {
    wsnl();
    if (i >= n) break;
    if (at(i) === 91) {
      const kp = i;
      const isArr = at(i + 1) === 91;
      i += isArr ? 2 : 1;
      const path = key();
      if (at(i) !== 93 || (isArr && at(i + 1) !== 93)) f(`Expected '${isArr ? ']]' : ']'}' to close the table header`);
      i += isArr ? 2 : 1;
      const parent = walk(path, kp);
      const last = path[path.length - 1];
      let x = parent.get(last);
      const name = path.join('.');
      if (isArr) {
        if (x === undefined) {
          parent.set(last, (x = []));
          aot.add(x);
        } else if (!Array.isArray(x) || !aot.has(x)) f(`Cannot define [[${name}]]: "${name}" is already defined and is not an array of tables`, kp);
        const t = new Map<string, V>();
        (x as V[]).push(t);
        cur = t;
      } else {
        if (x === undefined) parent.set(last, (x = new Map()));
        else if (!(x instanceof Map) || defined.has(x) || dotted.has(x) || frozen.has(x)) f(`Table [${name}] is defined more than once`, kp);
        defined.add(x as object);
        cur = x as Map<string, V>;
      }
    } else keyval(cur);
    eol();
  }
  return root;
}

// ── entry point ──────────────────────────────────────────────────────────

/** Converts CSV / TSV / YAML / XML / TOML text to JSON text (`indent` '' = minified). */
export function importToJson(text: string, format: ImportFormat, indent: string): ImportResult {
  let src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    if (format === 'csv' || format === 'tsv') return { json: csv(src, format === 'tsv' ? '\t' : null, indent) };
    src = src.replace(/\r\n?/g, '\n');
    const v = format === 'yaml' ? yaml(src) : format === 'xml' ? xml(src) : toml(src);
    return { json: emit(v, indent) };
  } catch (e) {
    if (e instanceof PErr) {
      let line = 1;
      let ls = 0;
      for (let k = src.indexOf('\n'); k >= 0 && k < e.p; k = src.indexOf('\n', k + 1)) {
        line++;
        ls = k + 1;
      }
      return { error: e.m, line, col: e.p - ls + 1 };
    }
    if (e instanceof RangeError || tooDeep(e)) return { error: /string length/i.test((e as Error).message) ? 'The result is too large' : 'Nesting is too deep to convert' };
    throw e;
  }
}
