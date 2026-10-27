/*
 * Compressed sizes, measured with the browser's own encoders
 * (CompressionStream): exact numbers, zero bytes of compression code shipped.
 * gzip is everywhere; brotli and zstd appear where the browser offers them.
 */

export type Codec = 'gzip' | 'brotli' | 'zstd';

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

/** Size in bytes of `blob` compressed with format `name`. */
export async function compressedSize(blob: Blob, name: string): Promise<number> {
  const reader = blob
    .stream()
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
export async function compressedSizes(blob: Blob, current: () => boolean): Promise<Partial<Record<Codec, number>>> {
  const sizes: Partial<Record<Codec, number>> = {};
  for (const [codec, name] of codecs()) {
    if (!current()) break;
    if (codec === 'brotli' && blob.size > BROTLI_MAX) continue;
    try {
      sizes[codec] = await compressedSize(blob, name);
    } catch {
      // Leave encoders this browser cannot run unmeasured.
    }
  }
  return sizes;
}
