/**
 * Document bytes ↔ UTF-16 offsets in text decoded from them: one rule for the worker's built texts (doc.ts: locate,
 * resolve, pretty positions, what's copied, saved and edited), the page's (page.ts: spans), the lines' columns
 * (core-source.ts) and the Format view's window (text-window.ts).
 *
 * Text is decoded as TextDecoder decodes UTF-8 (the WHATWG "UTF-8 decode"): an invalid byte sequence becomes one
 * U+FFFD per maximal invalid subsequence (a lone continuation byte, a byte that can't start a character, or a
 * character's first bytes cut short by a byte that can't follow them, which is then read again). So a U+FFFD in
 * decoded text stands for 3 bytes (the character itself, EF BF BD) or for 1–3 invalid bytes, which only the bytes
 * tell: where text goes out with invalid bytes in it, `bad` says which of its units are those and how many bytes
 * each was ([unit offset, bytes] pairs, sorted), and the functions here take it.
 *
 * Bytes of a range of text are counted so that ranges add up, whichever units they start and end at: a surrogate
 * pair is 4 at its first half and 0 at its second (a lone half is 3, as TextEncoder writes U+FFFD). A table of the
 * bytes at every `step` units finds an offset's byte in at most `step` units; a pair cut by a step is no trap.
 */

/**
 * The byte sequence at `b[i]` (i < to), as TextDecoder reads `b[…, to)`: its length if it is a valid UTF-8
 * character (1–4), else minus the bytes that make one U+FFFD (the next byte is read again).
 */
export function seqAt(b: Uint8Array, i: number, to: number): number {
  const c = b[i];
  if (c < 0x80) return 1;
  let need: number;
  let lo = 0x80;
  let hi = 0xbf;
  if (c >= 0xc2 && c <= 0xdf) need = 1;
  else if (c >= 0xe0 && c <= 0xef) {
    need = 2;
    if (c === 0xe0) lo = 0xa0;
    else if (c === 0xed) hi = 0x9f;
  } else if (c >= 0xf0 && c <= 0xf4) {
    need = 3;
    if (c === 0xf0) lo = 0x90;
    else if (c === 0xf4) hi = 0x8f;
  } else return -1;
  for (let k = 1; k <= need; k++) {
    if (i + k >= to) return -k;
    const d = b[i + k];
    if (d < lo || d > hi) return -k;
    lo = 0x80;
    hi = 0xbf;
  }
  return need + 1;
}

/** UTF-16 units of `b[from, to)` decoded alone (as TextDecoder decodes it: an invalid sequence is one U+FFFD). */
export function utf16Units(b: Uint8Array, from = 0, to = b.length): number {
  let n = 0;
  for (let i = from; i < to; ) {
    if (b[i] < 0x80) {
      n++;
      i++;
      continue;
    }
    const l = seqAt(b, i, to);
    n += l === 4 ? 2 : 1;
    i += l > 0 ? l : -l;
  }
  return n;
}

/** The byte of `b[from, to)` where its first `units` UTF-16 units end, decoded alone (into a pair: after it). */
export function byteAtUnits(b: Uint8Array, from: number, to: number, units: number): number {
  let u = 0;
  let i = from;
  while (i < to && u < units) {
    if (b[i] < 0x80) {
      u++;
      i++;
      continue;
    }
    const l = seqAt(b, i, to);
    u += l === 4 ? 2 : 1;
    i += l > 0 ? l : -l;
  }
  return i;
}

/**
 * Where decoding `b[from, to)` alone puts a U+FFFD for invalid bytes: [unit offset, byte offset (from `from`),
 * bytes] triples; null if it is valid UTF-8.
 */
export function badOf(b: Uint8Array, from = 0, to = b.length): number[] | null {
  let out: number[] | null = null;
  let u = 0;
  for (let i = from; i < to; ) {
    if (b[i] < 0x80) {
      u++;
      i++;
      continue;
    }
    const l = seqAt(b, i, to);
    if (l < 0) (out ??= []).push(u, i - from, -l);
    u += l === 4 ? 2 : 1;
    i += l > 0 ? l : -l;
  }
  return out;
}

/** `bad` ([unit offset, bytes] pairs) of the text `b[from, to)` decodes to; null if it is valid UTF-8. */
export function badUnits(b: Uint8Array, from = 0, to = b.length): Float64Array | null {
  const t = badOf(b, from, to);
  if (!t) return null;
  const out = new Float64Array((t.length / 3) * 2);
  for (let j = 0, o = 0; j < t.length; j += 3, o += 2) {
    out[o] = t[j];
    out[o + 1] = t[j + 2];
  }
  return out;
}

/** The first pair of `bad` at unit `from` or after (its index in the array; bad.length: none). */
function badFrom(bad: Float64Array, from: number): number {
  let lo = 0;
  let hi = bad.length >> 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bad[mid * 2] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo * 2;
}

/** UTF-8 bytes of `s[from, to)` (`bad`: the units that were invalid bytes, and how many each). */
export function utf8Bytes(s: string, from = 0, to = s.length, bad?: Float64Array | null): number {
  let n = to - from;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if ((c & 0xf800) !== 0xd800) n += 2;
    // (A first half: 4 with its second, which is 0; alone, 3.)
    else if (c < 0xdc00) n += i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 3 : 2;
    else n += i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800 ? -1 : 2;
  }
  if (bad && bad.length) for (let j = badFrom(bad, from); j < bad.length && bad[j] < to; j += 2) n += bad[j + 1] - 3;
  return n;
}

/**
 * The offset in `s` where its first `bytes` UTF-8 bytes end (on past a character they cut into; -1: past its end).
 * `bad`: as utf8Bytes.
 */
export function utf16Of(s: string, bytes: number, bad?: Float64Array | null): number {
  let i = 0;
  let j = bad && bad.length ? 0 : -1;
  for (; i < s.length && bytes > 0; i++) {
    if (j >= 0 && j < bad!.length && bad![j] === i) {
      bytes -= bad![j + 1];
      j += 2;
      continue;
    }
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes -= 1;
    else if (c < 0x800) bytes -= 2;
    else if (c < 0xdc00 && c >= 0xd800 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes -= 4;
      i++;
    } else bytes -= 3;
  }
  return bytes > 0 ? -1 : i;
}

/**
 * `bad` of a text after its units [a, b) were replaced by `len` units of typed text (valid: no invalid bytes): the
 * pairs in [a, b) go, the ones after move by `len - (b - a)`. (For a window of text edited where it is.)
 */
export function badAfterEdit(bad: Float64Array | null | undefined, a: number, b: number, len: number): Float64Array | null {
  if (!bad || !bad.length) return null;
  const out: number[] = [];
  for (let j = 0; j < bad.length; j += 2) {
    if (bad[j] < a) out.push(bad[j], bad[j + 1]);
    else if (bad[j] >= b) out.push(bad[j] + len - (b - a), bad[j + 1]);
  }
  return out.length ? Float64Array.from(out) : null;
}

/** The bytes of `s[from, to)` before every `step` units: out[k] = utf8Bytes(s, from, from + k * step). */
export function utf8Table(s: string, from: number, to: number, step: number): Float64Array {
  const out = new Float64Array(Math.floor((to - from) / step) + 1);
  for (let k = 1; k < out.length; k++) out[k] = out[k - 1] + utf8Bytes(s, from + (k - 1) * step, from + k * step);
  return out;
}

/** utf8Bytes(s, from, off), with `table` = utf8Table(s, from, …, step). */
export function utf8At(s: string, table: Float64Array, from: number, off: number, step: number): number {
  const k = Math.min(table.length - 1, Math.floor((off - from) / step));
  return table[k] + utf8Bytes(s, from + k * step, off);
}
