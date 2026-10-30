/*
 * Values read back from the source text: a tape (tape.ts) keeps no copy of a string with escapes or a
 * loosely written number, only where it is. These decode it exactly as the parsers read it.
 */
import { normalizeNumber } from './parser';

const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);

/**
 * The value of the string whose opening quote is at `start`, decoded as the parser reads it (it must have
 * parsed: nothing is reported). `max`: only its first `max` units, decoding no further.
 */
export function decodeString(src: string, start: number, max = Infinity): string {
  const q0 = src.charCodeAt(start);
  const q = q0 === 0x201c || q0 === 0x201d ? 0x201d : q0 === 0x2018 || q0 === 0x2019 ? 0x2019 : q0;
  const q2 = q0 === 0x201c || q0 === 0x201d ? 0x201c : q0 === 0x2018 || q0 === 0x2019 ? 0x2018 : q0;
  const n = src.length;
  let i = start + 1;
  let seg = i;
  let out = '';
  // Plain characters that still fit under `max` after `seg`.
  let room = max;
  for (;;) {
    if (i >= n) return cut(out + src.slice(seg, i), max);
    const c = src.charCodeAt(i);
    if (c === q || c === q2) return cut(out + src.slice(seg, i), max);
    if (c !== 92) {
      if (i - seg >= room) return out + src.slice(seg, i);
      i++;
      continue;
    }
    out += src.slice(seg, i);
    if (out.length >= max) return cut(out, max);
    const e = src.charCodeAt(++i);
    i++;
    switch (e) {
      case 34:
        out += '"';
        break;
      case 92:
        out += '\\';
        break;
      case 47:
        out += '/';
        break;
      case 98:
        out += '\b';
        break;
      case 102:
        out += '\f';
        break;
      case 110:
        out += '\n';
        break;
      case 114:
        out += '\r';
        break;
      case 116:
        out += '\t';
        break;
      case 117:
        if (isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1)) && isHex(src.charCodeAt(i + 2)) && isHex(src.charCodeAt(i + 3))) {
          out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
          i += 4;
        } else out += 'u';
        break;
      default:
        if (i > n) return cut(out, max);
        if (e === 120 && isHex(src.charCodeAt(i)) && isHex(src.charCodeAt(i + 1))) {
          out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
          i += 2;
        } else if (e === 10 || e === 13) {
          if (e === 13 && src.charCodeAt(i) === 10) i++;
        } else out += String.fromCharCode(e);
    }
    seg = i;
    room = max - out.length;
  }
}

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** The value of the loosely written number src.slice(start, end), as the parser gives it: hexadecimal in decimal, others normalized. */
export function decodeNumber(src: string, start: number, end: number): string {
  let k = start;
  let c = src.charCodeAt(k);
  if (c === 45 || c === 43) c = src.charCodeAt(++k);
  if (c === 48) {
    const x = src.charCodeAt(k + 1);
    if (x === 120 || x === 88) return (src.charCodeAt(start) === 45 ? '-' : '') + BigInt('0x' + src.slice(k + 2, end)).toString();
  }
  return normalizeNumber(src.slice(start, end));
}

