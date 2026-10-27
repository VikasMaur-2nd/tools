/*
 * A file read once for the analysis worker: a block at a time, its bytes going to WebAssembly (tape-wasm.ts,
 * as a ByteSource) while they are decoded into its text the way read.ts reads it. So the file isn't read
 * twice (once for the text, once for WebAssembly), and isn't held whole: one block, and the end of the one
 * before, are kept at a time.
 */
import { TextDecoding } from './read';
import type { ByteSource } from './tape-wasm';

/** Bytes read from the file at a time (a FileReaderSync read costs ~5-20 ms whatever its size in Chromium). */
export const BLOCK = 16 << 20;
/** Bytes of the block before that are kept: WebAssembly reads a token cut by its window again from its start. */
const KEEP = 1 << 20;

export interface FileReading {
  /** The file's bytes for wasmTape, after a UTF-8 byte order mark (as its text has none). */
  bytes: ByteSource;
  /** Its text, as read.ts's readText makes it: the rest of the file is read and decoded first. */
  text(): string;
}

/**
 * A file of `size` bytes read with `read(at, len)` (in a worker: FileReaderSync on a slice), `block` bytes at a
 * time; null for a UTF-16 file (a UTF-16 byte order mark), whose bytes WebAssembly doesn't read.
 */
export function fileReading(size: number, read: (at: number, len: number) => Uint8Array, block = BLOCK): FileReading | null {
  const decoding = new TextDecoding();
  let cur = read(0, Math.min(size, block));
  const first = decoding.start(cur);
  if (decoding.utf16) return null;
  const skip = cur.length - first.length;
  decoding.push(first);
  // `cur` holds the file's bytes [base, base + cur.length); the next block starts at `next`.
  let base = 0;
  let next = cur.length;
  // The end of the block before: [prevAt, base).
  let prev: Uint8Array = new Uint8Array(0);
  let prevAt = 0;
  let scratch = new Uint8Array(0);
  const advance = () => {
    const keep = Math.min(cur.length, KEEP);
    prev = cur.slice(cur.length - keep);
    prevAt = base + cur.length - keep;
    base = next;
    cur = read(next, Math.min(size - next, block));
    next += cur.length;
    decoding.push(cur);
  };
  let text: string | null = null;
  return {
    bytes: {
      size: size - skip,
      read(at, len) {
        const a = at + skip;
        const e = Math.min(size, a + len);
        while (e > base + cur.length && next < size) advance();
        if (a >= base) return cur.subarray(a - base, e - base);
        if (a >= prevAt) {
          // (A window across two blocks: its bytes in one array, the window only copied.)
          if (scratch.length < e - a) scratch = new Uint8Array(e - a);
          const head = prev.subarray(a - prevAt);
          scratch.set(head);
          scratch.set(cur.subarray(0, e - base), head.length);
          return scratch.subarray(0, e - a);
        }
        // (Further back than kept, or a window bigger than a block: read again, not decoded again.)
        return read(a, e - a);
      },
    },
    text() {
      if (text === null) {
        while (next < size) advance();
        text = decoding.end();
      }
      return text;
    },
  };
}
