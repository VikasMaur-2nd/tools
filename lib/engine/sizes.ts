/*
 * Compressed sizes, measured with the browser's own encoders
 * (CompressionStream): exact numbers, zero bytes of compression code shipped.
 * gzip is everywhere; brotli and zstd appear where the browser offers them.
 */

import { reindenter } from '../json/format';

export type Codec = 'gzip' | 'brotli' | 'zstd';

/** What is measured: bytes as a Blob, or a maker of a fresh stream of them (one per encoder). */
type Source = Blob | (() => ReadableStream<Uint8Array<ArrayBuffer>>);

/** Spec names to try for each codec (the first one the browser accepts wins). */
const NAMES: Record<Codec, string[]> = {
  gzip: ['gzip'],
  brotli: ['brotli', 'br'],
  zstd: ['zstd'],
};

let found: [Codec, string][] | null = null;

/** Codecs this browser can measure, with the format name it accepts. */
export function codecs(): [Codec, string][] {
  if (found) return found;
  found = [];
  if (typeof CompressionStream === 'undefined') return found;
  for (const codec of Object.keys(NAMES) as Codec[]) {
    for (const name of NAMES[codec]) {
      try {
        new CompressionStream(name as CompressionFormat);
        found.push([codec, name]);
        break;
      } catch {
        /* not supported */
      }
    }
  }
  return found;
}

/** Size in bytes of `source` compressed with format `name`. */
export async function compressedSize(source: Source, name: string): Promise<number> {
  const reader = (typeof source === 'function' ? source() : source.stream())
    .pipeThrough(new CompressionStream(name as CompressionFormat))
    .getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return n;
    n += value.byteLength;
  }
}

/**
 * Brotli is measured up to this size (bytes). Firefox's encoder (the only browser offering it) runs at
 * about 0.35 MB/s: a 32 MB document would cost 90 s of CPU after every typing pause.
 */
const BROTLI_MAX = 2_000_000;

/** Stop measuring an obsolete document after the current encoder finishes. */
/** `bytes`: the source's size, when it is a stream. */
export async function compressedSizes(source: Source, current: () => boolean, bytes = (source as Blob).size): Promise<Partial<Record<Codec, number>>> {
  const sizes: Partial<Record<Codec, number>> = {};
  for (const [codec, name] of codecs()) {
    if (!current()) break;
    if (codec === 'brotli' && bytes > BROTLI_MAX) continue;
    try {
      sizes[codec] = await compressedSize(source, name);
    } catch {
      // Leave encoders this browser cannot run unmeasured.
    }
  }
  return sizes;
}

/**
 * The UTF-8 bytes of strict JSON `text` minified (`reindent(text, '')`), made as they are read: neither the
 * minified text nor its bytes are ever held whole (at 100 MB, hundreds of MB the collector may be slow to
 * give back). Errors if `text` doesn't minify.
 */
export function minifiedBytesStream(text: string): ReadableStream<Uint8Array<ArrayBuffer>> {
  const utf16 = new TextDecoder('utf-16le');
  const utf8 = new TextEncoder();
  const out: Uint8Array<ArrayBuffer>[] = [];
  // (A pair split between two pieces is decoded whole: the decoder streams.)
  const run = reindenter(text, '', (units) => out.push(utf8.encode(utf16.decode(units, { stream: true }))));
  let done = false;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(c) {
      while (!out.length && !done) {
        const r = run(performance.now() + 20);
        if (r === null) return c.error(new Error('not JSON'));
        done = r !== undefined;
      }
      if (out.length) c.enqueue(out.shift()!);
      if (done && !out.length) c.close();
    },
  });
}
