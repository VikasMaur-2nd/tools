/*
 * Reading a file or response body as text (see text.ts for why ASCII is made one byte a character).
 * Loaded when a file or URL is first opened: it isn't part of the first load.
 */
import { asciiText, GECKO } from './text';

/** Work (ms) between yields to the page while reading. */
const SLICE = 12;
/** Bytes decoded at a time. */
const PIECE = 1 << 20;

/** Resolves in a new task (a MessageChannel message: timers would be clamped). */
const nextTask = () => new Promise<void>((done) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    ch.port1.close();
    done();
  };
  ch.port2.postMessage(0);
});

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
  // A stream whose bytes are all there already (a file) hands them over without a task in between: the
  // page gets one back about every frame.
  let until = performance.now() + SLICE;
  for (let first = true; ; first = false) {
    if (performance.now() >= until) {
      await nextTask();
      until = performance.now() + SLICE;
    }
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
    // (A stream may hand over a whole file as one chunk, as Firefox's does: it is decoded a slice at a time.)
    for (let at = 0; at < bytes.length; at += PIECE) {
      if (at && performance.now() >= until) {
        await nextTask();
        until = performance.now() + SLICE;
      }
      const piece = bytes.length > PIECE ? bytes.subarray(at, at + PIECE) : bytes;
      if (GECKO && decoder!.encoding === 'utf-8' && ascii(piece)) {
        if (pending) {
          parts.push(decoder!.decode());
          pending = false;
        }
        parts.push(asciiText(piece));
      } else {
        parts.push(decoder!.decode(piece, { stream: true }));
        pending = true;
      }
    }
  }
  if (decoder && pending) parts.push(decoder.decode());
  return parts.join('');
}
