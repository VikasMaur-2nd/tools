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
/** Bytes waiting for the sink before the pass pauses. */
const FULL = 32 << 20;

const encoder = new TextEncoder();

export class Bytes {
  buf = new Uint8Array(BLOCK);
  pos = 0;
  /** Bytes handed on so far (`written` counts the block being filled too). */
  total = 0;
  private queue: Uint8Array[] = [];
  private queued = 0;

  /** Enough waits for the sink: the pass should pause (see Walker.pause). */
  get full() {
    return this.queued >= FULL;
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
    if (len <= 24 && this.pos + len <= this.buf.length) {
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
