/**
 * Where a streamed pass writes: bytes gathered in blocks (1 MiB), handed to a sink a block at a time. The pass
 * is synchronous within a chunk of input; the blocks it fills wait in a queue the driver drains (awaiting the
 * sink) between chunks, and a visitor pauses the walker when too much is waiting (`full`).
 */

/** A pass's output: blocks of bytes in order. The sink may keep a block it is given (it is never written again). */
export interface Sink {
  write(b: Uint8Array): void | Promise<void>;
  /** All written: commit (a file appears only now where it can). */
  close(): Promise<void>;
  /** Stopped: nothing is kept. */
  abort(): Promise<void>;
}

const BLOCK = 1 << 20;
/** Bytes waiting for the sink before the pass pauses (with one token's output and a block, what may wait at most). */
const FULL_BYTES = 8 << 20;
export const FULL = FULL_BYTES;

const encoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** A first block for outputs that are mostly small (Split's parts, a cell's scratch): later ones are BLOCK. */
export const SMALL = 64 << 10;

export class Bytes {
  buf = new Uint8Array(BLOCK);
  pos = 0;
  /** Bytes handed on so far (`written` counts the block being filled too). */
  total = 0;
  private queue: Uint8Array[] = [];
  private queued = 0;
  /** Told when FULL bytes wait for the sink: the job pauses its walker then (after the token being written). */
  onFull: (() => void) | null = null;

  /** `first`: the first block's size (later ones are 1 MiB). */
  constructor(first = BLOCK) {
    if (first !== BLOCK) this.buf = new Uint8Array(first);
  }

  /** Enough waits for the sink: the pass should pause (see Walker.pause). */
  get full() {
    return this.queued >= FULL_BYTES;
  }

  /** Bytes written in all. */
  get written() {
    return this.total + this.pos;
  }

  private next() {
    if (this.pos) {
      this.queue.push(this.pos === this.buf.length ? this.buf : this.buf.subarray(0, this.pos));
      this.queued += this.pos;
      this.total += this.pos;
      if (this.queued >= FULL_BYTES && this.onFull) this.onFull();
    }
    this.buf = new Uint8Array(BLOCK);
    this.pos = 0;
  }

  byte(c: number) {
    if (this.pos === this.buf.length) this.next();
    this.buf[this.pos++] = c;
  }

  /** b[a, e). */
  bytes(b: Uint8Array, a: number, e: number) {
    const len = e - a;
    // (Short runs copied in a loop: a view for set() would cost more.)
    if (len <= 64 && this.pos + len <= this.buf.length) {
      const o = this.buf;
      let p = this.pos;
      for (let k = a; k < e; k++) o[p++] = b[k];
      this.pos = p;
      return;
    }
    let at = a;
    while (at < e) {
      if (this.pos === this.buf.length) this.next();
      const n = Math.min(e - at, this.buf.length - this.pos);
      this.buf.set(b.subarray(at, at + n), this.pos);
      this.pos += n;
      at += n;
    }
  }

  /** A string's UTF-8 bytes. */
  text(s: string) {
    // (Short ASCII: a byte a character; else encoded in place, a block at a time.)
    if (s.length <= 64 && this.pos + s.length <= this.buf.length) {
      let p = this.pos;
      const o = this.buf;
      let k = 0;
      for (; k < s.length; k++) {
        const c = s.charCodeAt(k);
        if (c >= 0x80) break;
        o[p++] = c;
      }
      if (k === s.length) {
        this.pos = p;
        return;
      }
    }
    let rest = s;
    while (rest.length) {
      if (this.buf.length - this.pos < 4) this.next();
      const r = encoder.encodeInto(rest, this.buf.subarray(this.pos));
      this.pos += r.written;
      rest = rest.slice(r.read);
    }
  }

  /** Emptied: what was written is dropped. */
  reset() {
    this.queue = [];
    this.queued = 0;
    this.pos = 0;
    this.total = 0;
  }

  /** Room for `n` more bytes in `buf` from `pos` (a new block if not): for writers that fill it themselves. */
  room(n: number) {
    if (this.pos + n > this.buf.length) {
      this.next();
      if (n > this.buf.length) this.buf = new Uint8Array(n);
    }
  }

  /** Everything written so far as text, the buffer emptied (a scratch buffer, reused for small values). */
  takeText(): string {
    let s: string;
    if (!this.queue.length) s = textDecoder.decode(this.buf.subarray(0, this.pos));
    else {
      const parts: string[] = [];
      for (const b of this.queue) parts.push(textDecoder.decode(b, { stream: true }));
      parts.push(textDecoder.decode(this.buf.subarray(0, this.pos)));
      s = parts.join('');
    }
    this.queue = [];
    this.queued = 0;
    this.pos = 0;
    this.total = 0;
    return s;
  }

  /** Hands what is waiting to `sink` (in order), the block being filled too. */
  async drain(sink: Sink) {
    this.next();
    const q = this.queue;
    this.queue = [];
    this.queued = 0;
    for (const b of q) await sink.write(b);
  }
}

/** A sink that keeps everything (tests, small results). */
export class MemorySink implements Sink {
  parts: Uint8Array[] = [];
  closed = false;
  aborted = false;
  write(b: Uint8Array) {
    this.parts.push(b);
  }
  async close() {
    this.closed = true;
  }
  async abort() {
    this.aborted = true;
    this.parts = [];
  }
  bytes(): Uint8Array {
    let n = 0;
    for (const p of this.parts) n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
  text() {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(this.bytes());
  }
}
