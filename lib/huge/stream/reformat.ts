/**
 * Streamed Pretty / Minify / JSON Lines of a huge document: the walker's tokens written again, byte for byte
 * what the normal path makes for the same document (format.ts `stringify` / `reindent`, convert/data.ts
 * `toJSONL`): numbers and literals as written, strings as `quote(JSON.parse(token))` (escapes JSON.stringify
 * writes the same way kept, others decoded; invalid UTF-8 as U+FFFD, as the page reads a file), duplicate
 * names kept, empty containers as `{}` / `[]`, several top-level values as one array of them.
 */
import { MAX_INDENT } from '../../json/format';
import type { Bytes } from './out';
import { ARR, ESC, HI, NUL, OBJ, PART, type Visitor } from './walk';

const decoder = new TextDecoder();
const WORD = [new Uint8Array([110, 117, 108, 108]), new Uint8Array([102, 97, 108, 115, 101]), new Uint8Array([116, 114, 117, 101])];

/** Escapes JSON.stringify writes as they are written: \" \\ \b \f \n \r \t. */
const KEPT = new Uint8Array(256);
for (const c of '"\\bfnrt') KEPT[c.charCodeAt(0)] = 1;

/** Whether b[a, e) is UTF-8 a decoder reads without replacing anything. */
export function validUtf8(b: Uint8Array, a: number, e: number): boolean {
  let i = a;
  while (i < e) {
    const c = b[i];
    if (c < 0x80) {
      i++;
      continue;
    }
    if (c < 0xc2) return false;
    if (c < 0xe0) {
      if (i + 1 >= e || (b[i + 1] & 0xc0) !== 0x80) return false;
      i += 2;
      continue;
    }
    if (c < 0xf0) {
      if (i + 2 >= e) return false;
      const c1 = b[i + 1];
      if ((c1 & 0xc0) !== 0x80 || (b[i + 2] & 0xc0) !== 0x80) return false;
      if ((c === 0xe0 && c1 < 0xa0) || (c === 0xed && c1 >= 0xa0)) return false;
      i += 3;
      continue;
    }
    if (c < 0xf5) {
      if (i + 3 >= e) return false;
      const c1 = b[i + 1];
      if ((c1 & 0xc0) !== 0x80 || (b[i + 2] & 0xc0) !== 0x80 || (b[i + 3] & 0xc0) !== 0x80) return false;
      if ((c === 0xf0 && c1 < 0x90) || (c === 0xf4 && c1 >= 0x90)) return false;
      i += 4;
      continue;
    }
    return false;
  }
  return true;
}

/** Whether string token b[a, e) is written as it stands: its escapes are ones JSON.stringify writes alike, its bytes valid UTF-8. */
export function asWritten(b: Uint8Array, a: number, e: number, flags: number): boolean {
  if (flags & ESC) {
    for (let i = a; i < e; i++) {
      if (b[i] === 92) {
        if (!KEPT[b[i + 1]]) return false;
        i++;
      }
    }
  }
  return !(flags & HI) || validUtf8(b, a, e);
}

/** The decoded value of string token b[a, e) (raw text between the quotes). */
export function decodeString(b: Uint8Array, a: number, e: number, flags: number): string {
  if (!flags) {
    // (ASCII without escapes: a byte a character.)
    if (e - a < 64) {
      let s = '';
      for (let i = a; i < e; i++) s += String.fromCharCode(b[i]);
      return s;
    }
    return decoder.decode(b.subarray(a, e));
  }
  const text = decoder.decode(b.subarray(a, e));
  return flags & ESC ? (JSON.parse('"' + text + '"') as string) : text;
}

/** Writes string token b[a, e) as the normal path writes it, quotes included. */
export function writeString(out: Bytes, b: Uint8Array, a: number, e: number, flags: number) {
  if (!flags || asWritten(b, a, e, flags)) {
    out.byte(34);
    out.bytes(b, a, e);
    out.byte(34);
    return;
  }
  out.text(JSON.stringify(decodeString(b, a, e, flags)));
}

const SIMPLE: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * A string too long to keep whole, written as it comes: its raw pieces decoded (a character or an escape cut
 * between pieces waits for the next), each written as JSON.stringify writes it (a high surrogate at a piece's
 * end waits too: JSON.stringify writes a pair alone otherwise).
 */
class Parted {
  private dec = new TextDecoder();
  private raw = '';
  private high = '';

  piece(out: Bytes, b: Uint8Array, a: number, e: number, last: boolean) {
    const text = this.raw + this.dec.decode(b.subarray(a, e), { stream: !last });
    let s = this.high;
    let from = 0;
    let k = text.indexOf('\\');
    this.raw = '';
    while (k >= 0) {
      s += text.slice(from, k);
      const c = text[k + 1];
      if (c === undefined || (c === 'u' && k + 6 > text.length)) {
        if (last) throw new Error('Invalid JSON');
        this.raw = text.slice(k);
        from = text.length;
        break;
      }
      if (c === 'u') {
        s += String.fromCharCode(parseInt(text.slice(k + 2, k + 6), 16));
        from = k + 6;
      } else {
        const v = SIMPLE[c];
        if (v === undefined) throw new Error('Invalid JSON');
        s += v;
        from = k + 2;
      }
      k = text.indexOf('\\', from);
    }
    if (from < text.length) s += text.slice(from);
    this.high = '';
    if (!last && s.length) {
      const h = s.charCodeAt(s.length - 1);
      if (h >= 0xd800 && h <= 0xdbff) {
        this.high = s[s.length - 1];
        s = s.slice(0, -1);
      }
    }
    if (s) out.text(JSON.stringify(s).slice(1, -1));
  }
}

export interface ReformatOptions {
  /** The indent unit ('' minified). */
  indent: string;
  /** JSON Lines (toJSONL): each item of a top-level array a line of minified JSON, or the document as one line. */
  lines?: boolean;
}

/** Writes a document again (a Visitor of walk.ts): Pretty (an indent), Minify ('') or JSON Lines. */
export class Reformat implements Visitor {
  /** Open containers written. */
  private d = 0;
  /** Per depth: no item written there yet. */
  private first = new Uint8Array(64);
  private afterKey = false;
  private readonly pretty: boolean;
  private readonly unit: Uint8Array;
  private readonly lines: boolean;
  /** Lines mode: the top-level array whose items are the lines (not written itself). */
  private list = false;
  private pads: Uint8Array[] = [];
  private parted: Parted | null = null;

  constructor(
    readonly out: Bytes,
    o: ReformatOptions,
  ) {
    this.lines = !!o.lines;
    this.pretty = !this.lines && o.indent.length > 0;
    this.unit = new TextEncoder().encode(this.lines ? '' : o.indent);
  }

  /** A line break and the indentation of depth `d`. */
  private pad(d: number) {
    const unit = this.unit;
    if (d * unit.length > MAX_INDENT) throw new RangeError('Nesting is too deep to format');
    const out = this.out;
    if (d < 256) {
      let p = this.pads[d];
      if (!p) {
        p = new Uint8Array(1 + d * unit.length);
        p[0] = 10;
        for (let k = 0; k < d; k++) p.set(unit, 1 + k * unit.length);
        this.pads[d] = p;
      }
      out.bytes(p, 0, p.length);
      return;
    }
    out.byte(10);
    for (let k = 0; k < d; k++) out.bytes(unit, 0, unit.length);
  }

  /** An item (a value, or a member's name) starts at the current depth: its separator. */
  private item() {
    const d = this.d;
    if (d === 0 || (this.list && d === 1)) return;
    if (this.first[d]) this.first[d] = 0;
    else this.out.byte(44);
    if (this.pretty) this.pad(d);
  }

  private value() {
    if (this.afterKey) this.afterKey = false;
    else this.item();
  }

  /** A value ended: in lines mode, a record's line ends. */
  private ended() {
    if (this.list && this.d === 1) this.out.byte(10);
  }

  open(kind: number) {
    this.value();
    if (this.lines && this.d === 0 && kind === ARR) {
      this.list = true;
      this.d = 1;
      return;
    }
    this.out.byte(kind === OBJ ? 123 : 91);
    const d = ++this.d;
    if (d >= this.first.length) {
      const f = new Uint8Array(this.first.length * 2);
      f.set(this.first);
      this.first = f;
    }
    this.first[d] = 1;
  }

  close(kind: number) {
    if (this.list && this.d === 1) {
      this.d = 0;
      return;
    }
    const d = this.d;
    if (!this.first[d] && this.pretty) this.pad(d - 1);
    this.out.byte(kind === OBJ ? 125 : 93);
    this.d = d - 1;
    this.ended();
  }

  key(b: Uint8Array, a: number, e: number, flags: number) {
    if (flags & PART) this.endParted(b, a, e);
    else {
      this.item();
      writeString(this.out, b, a, e, flags);
    }
    this.out.byte(58);
    if (this.pretty) this.out.byte(32);
    this.afterKey = true;
  }

  str(b: Uint8Array, a: number, e: number, flags: number) {
    if (flags & PART) this.endParted(b, a, e);
    else {
      this.value();
      writeString(this.out, b, a, e, flags);
    }
    this.ended();
  }

  num(b: Uint8Array, a: number, e: number) {
    this.value();
    this.out.bytes(b, a, e);
    this.ended();
  }

  lit(kind: number, v: boolean) {
    this.value();
    const w = kind === NUL ? WORD[0] : v ? WORD[2] : WORD[1];
    this.out.bytes(w, 0, w.length);
    this.ended();
  }

  part(b: Uint8Array, a: number, e: number, key: boolean) {
    if (!this.parted) {
      if (key) this.item();
      else this.value();
      this.out.byte(34);
      this.parted = new Parted();
    }
    this.parted.piece(this.out, b, a, e, false);
  }

  private endParted(b: Uint8Array, a: number, e: number) {
    this.parted!.piece(this.out, b, a, e, true);
    this.parted = null;
    this.out.byte(34);
  }

  /** The document ended: lines mode ends a document that wasn't an array with its line break. */
  finish() {
    if (this.lines && !this.list) this.out.byte(10);
  }
}
