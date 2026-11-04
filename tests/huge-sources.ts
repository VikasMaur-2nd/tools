/**
 * Documents of any size made on the fly (nothing on disk, nothing held): huge-file tests and benchmarks read
 * them through ByteSource like a File.
 */
import type { ByteSource } from '../lib/json/tape-wasm';

const enc = new TextEncoder();

/**
 * `[` + `count` records of the same length, `,\n` between them, `\n]`: record i is
 * `{"id":<i in 12 columns>,"name":"item <i, 12 columns>","tags":["a","b",null,true],"v":0.5}`.
 * `broken`: record whose `"v":` loses its colon (the document's only error).
 */
export class Records implements ByteSource {
  readonly size: number;
  /** Bytes of a record (without its separator). */
  readonly len: number;
  private tmpl: Uint8Array;
  private idAt: number;
  private nameAt: number;
  private buf: Uint8Array;

  constructor(
    readonly count: number,
    readonly broken = -1,
    readonly jsonl = false,
  ) {
    const t = '{"id":' + ' '.repeat(12) + ',"name":"item ' + ' '.repeat(12) + '","tags":["a","b",null,true],"v":0.5}';
    this.tmpl = enc.encode(t + (jsonl ? '\n' : ',\n'));
    this.len = t.length;
    this.idAt = 6;
    this.nameAt = t.indexOf('item ') + 5;
    this.size = jsonl ? count * (this.len + 1) : 1 + count * (this.len + 2);
    this.buf = new Uint8Array(this.tmpl.length);
  }

  /** Where record i starts. */
  start(i: number): number {
    return this.jsonl ? i * (this.len + 1) : 1 + i * (this.len + 2);
  }

  /** Record i's text (without its separator). */
  text(i: number): string {
    return new TextDecoder().decode(this.record(i).subarray(0, this.len));
  }

  private record(i: number): Uint8Array {
    const b = this.buf;
    b.set(this.tmpl);
    let n = i;
    for (let k = 11; k >= 0; k--) {
      const d = n === 0 && k < 11 ? 32 : 48 + (n % 10);
      b[this.idAt + k] = d;
      b[this.nameAt + k] = d;
      n = Math.floor(n / 10);
    }
    // (Digits right-aligned: the name's are left-aligned, padded after.)
    const digits = String(i);
    for (let k = 0; k < 12; k++) b[this.nameAt + k] = k < digits.length ? digits.charCodeAt(k) : 32;
    if (i === this.broken) b[this.len - 5] = 32;
    if (!this.jsonl && i === this.count - 1) {
      b[this.len] = 10;
      b[this.len + 1] = 93;
    }
    return b;
  }

  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    const out = new Uint8Array(len);
    const step = this.jsonl ? this.len + 1 : this.len + 2;
    const base = this.jsonl ? 0 : 1;
    const first = Math.max(0, Math.floor((at - base) / step));
    const last = Math.min(this.count - 1, Math.floor((at + len - 1 - base) / step));
    if (last < first) {
      if (!this.jsonl && at === 0 && len > 0) out[0] = 91;
      return out;
    }
    // The records it spans, made from the template (copied doubling), then each one's digits.
    const n = last - first + 1;
    const block = new Uint8Array(n * step);
    block.set(this.tmpl);
    for (let have = step; have < block.length; have *= 2) block.copyWithin(have, 0, Math.min(have, block.length - have));
    for (let r = 0; r < n; r++) {
      const i = first + r;
      const o = r * step;
      let v = i;
      for (let k = 11; k >= 0; k--) {
        block[o + this.idAt + k] = v === 0 && k < 11 ? 32 : 48 + (v % 10);
        v = (v / 10) | 0;
      }
      const digits = String(i);
      for (let k = 0; k < digits.length; k++) block[o + this.nameAt + k] = digits.charCodeAt(k);
      if (i === this.broken) block[o + this.len - 5] = 32;
    }
    if (!this.jsonl && last === this.count - 1) {
      block[(n - 1) * step + this.len] = 10;
      block[(n - 1) * step + this.len + 1] = 93;
    }
    // [at, at + len) of: `[` + the records.
    const from = base + first * step;
    let o = 0;
    if (!this.jsonl && at === 0) out[o++] = 91;
    const a = Math.max(at, from) - from;
    out.set(block.subarray(a, a + len - o), o);
    return out;
  }
}

/** `{"a": "<n x's>", "b": [1, 2]}`: a string bigger than any window. */
export class LongString implements ByteSource {
  readonly size: number;
  private head = enc.encode('{"a": "');
  private tail = enc.encode('", "b": [1, 2]}\n');
  constructor(readonly n: number) {
    this.size = this.head.length + n + this.tail.length;
  }
  read(at: number, len: number): Uint8Array {
    len = Math.max(0, Math.min(len, this.size - at));
    const out = new Uint8Array(len).fill(120);
    const h = this.head.length;
    for (let i = at; i < Math.min(at + len, h); i++) out[i - at] = this.head[i];
    const t0 = h + this.n;
    for (let i = Math.max(at, t0); i < at + len; i++) out[i - at] = this.tail[i - t0];
    return out;
  }
}
