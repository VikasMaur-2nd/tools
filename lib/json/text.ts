/*
 * Text from bytes, one byte a character where possible.
 *
 * Engines keep text whose characters all fit in a byte as a one-byte string: half the memory of
 * UTF-16. Chromium and Safari make one from TextDecoder; Firefox's decoders always make UTF-16 (a
 * 200 MB ASCII file is 400 MB there, and a big document's text is copied to two workers), but it
 * keeps String.fromCharCode's output one byte a character. So in Firefox, ASCII is made that way
 * (about 0.25 s more per 100 MB, for half the memory of every copy).
 */

const GECKO = typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);
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
 * The text of a file's bytes, the same in every browser: UTF-16 when it starts with a UTF-16 byte order
 * mark (as Windows tools write JSON), else UTF-8 (a UTF-8 byte order mark dropped, as Blob.text() does;
 * invalid bytes become U+FFFD).
 */
export function bytesText(bytes: Uint8Array): string {
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (b0 === 0xff && b1 === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (b0 === 0xfe && b1 === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (GECKO && ascii(bytes)) return asciiText(bytes);
  return new TextDecoder().decode(bytes);
}

/** The text of a file or response body (see `bytesText`). */
export const readText = async (body: Blob | Response) => bytesText(new Uint8Array(await body.arrayBuffer()));
