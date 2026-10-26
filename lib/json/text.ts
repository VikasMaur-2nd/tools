/*
 * Text from bytes, one byte a character where possible.
 *
 * Engines keep text whose characters all fit in a byte as a one-byte string: half the memory of
 * UTF-16. Chromium and Safari make one from TextDecoder; Firefox's decoders always make UTF-16 (a
 * 200 MB ASCII file is 400 MB there, and a big document's text is copied to two workers), but it
 * keeps String.fromCharCode's output one byte a character. So in Firefox, ASCII is made that way
 * (about 0.25 s more per 100 MB, for half the memory of every copy).
 */

let GECKO = typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);
/** Tests: run Firefox's way. */
export const geckoForTests = (on: boolean) => {
  GECKO = on;
};
/** Characters per String.fromCharCode call (well inside every engine's argument limit). */
const CHUNK = 32_768;

/** `units` (all below 0x80) as a string, one byte a character in every engine. */
export function asciiText(units: Uint8Array | Uint16Array): string {
  if (!GECKO) {
    if (units instanceof Uint8Array) return new TextDecoder().decode(units);
    const bytes = new Uint8Array(units.length);
    bytes.set(units);
    return new TextDecoder().decode(bytes);
  }
  const parts: string[] = [];
  for (let i = 0; i < units.length; i += CHUNK) parts.push(String.fromCharCode.apply(null, units.subarray(i, i + CHUNK) as unknown as number[]));
  return parts.join('');
}

/** Whether every byte is below 0x80. */
function ascii(bytes: Uint8Array): boolean {
  let hi = 0;
  for (let i = 0; i < bytes.length; i++) hi |= bytes[i];
  return hi < 0x80;
}

/**
 * The text of a file or response body, the same in every browser: UTF-16 when it starts with a UTF-16 byte
 * order mark (as Windows tools write JSON), else UTF-8 (a UTF-8 byte order mark dropped, as Blob.text()
 * does; invalid bytes become U+FFFD). Decoded chunk by chunk as the bytes arrive (each chunk in its own
 * task: the page never freezes on a big file, and its bytes aren't held whole).
 */
export async function readText(body: Blob | Response): Promise<string> {
  const stream = 'stream' in body ? body.stream() : body.body;
  if (!stream) return '';
  const reader = stream.getReader();
  const parts: string[] = [];
  let decoder: TextDecoder | null = null;
  // (A chunk can end inside a character: the decoder keeps it, so ASCII made here waits for it to finish.)
  let pending = false;
  for (let first = true; ; first = false) {
    const { done, value } = await reader.read();
    if (done) break;
    let bytes = value;
    if (first) {
      // A byte order mark that came alone (a stream may start with a 1-byte chunk): read on to see it whole.
      while (bytes.length < 3) {
        const more = await reader.read();
        if (more.done) break;
        const joined = new Uint8Array(bytes.length + more.value.length);
        joined.set(bytes);
        joined.set(more.value, bytes.length);
        bytes = joined;
      }
      const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : '';
      // (A UTF-8 byte order mark is dropped here, so a decoder flushed later doesn't drop a U+FEFF in the text.)
      if (!utf16 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
      decoder = new TextDecoder(utf16 || 'utf-8', { ignoreBOM: !utf16 });
    }
    if (GECKO && decoder!.encoding === 'utf-8' && ascii(bytes)) {
      if (pending) {
        parts.push(decoder!.decode());
        pending = false;
      }
      parts.push(asciiText(bytes));
    } else {
      parts.push(decoder!.decode(bytes, { stream: true }));
      pending = true;
    }
  }
  if (decoder && pending) parts.push(decoder.decode());
  return parts.join('');
}
