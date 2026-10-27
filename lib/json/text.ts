/*
 * Text from bytes, one byte a character where possible.
 *
 * Engines keep text whose characters all fit in a byte as a one-byte string: half the memory of
 * UTF-16. Chromium and Safari make one from TextDecoder; Firefox's decoders always make UTF-16 (a
 * 200 MB ASCII file is 400 MB there, and a big document's text is copied to two workers), but it
 * keeps String.fromCharCode's output one byte a character. So in Firefox, ASCII is made that way
 * (about 0.25 s more per 100 MB, for half the memory of every copy).
 */

export let GECKO = typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);
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

