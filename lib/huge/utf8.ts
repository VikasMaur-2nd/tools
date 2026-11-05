/**
 * Document bytes ↔ UTF-16 offsets in text copied from the document: one rule for the worker's built texts
 * (doc.ts: locate, resolve, pretty positions, what's copied, saved and edited) and the page's (page.ts: spans).
 *
 * Bytes of a range of text are counted so that ranges add up, whichever units they start and end at: a surrogate
 * pair is 4 at its first half and 0 at its second (a lone half is 3, as TextEncoder writes U+FFFD). A table of the
 * bytes at every `step` units finds an offset's byte in at most `step` units; a pair cut by a step is no trap.
 */

/** UTF-8 bytes of `s[from, to)`. */
export function utf8Bytes(s: string, from = 0, to = s.length): number {
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
  return n;
}

/** The offset in `s` where its first `bytes` UTF-8 bytes end (on past a character they cut into; -1: past its end). */
export function utf16Of(s: string, bytes: number): number {
  let i = 0;
  for (; i < s.length && bytes > 0; i++) {
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

/** UTF-16 units of UTF-8 bytes `b` (whole characters: 2 for a 4-byte one, 1 for the others). */
export function utf16Units(b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) n++;
    else if (c >= 0xc0) n += c >= 0xf0 ? 2 : 1;
  }
  return n;
}
