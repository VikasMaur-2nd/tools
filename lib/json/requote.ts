/*
 * Re-quoting long JSON strings in place (see format.ts Requoter): installed by importing this module, which
 * only the workers do, as the page's documents are small.
 */
import { installRequoter } from './format';

const HEX = '0123456789abcdef';
/** The highest unit and the UTF-8 bytes the last `requote` wrote. */
let requotedHi = 0;
let requotedBytes = 0;

/**
 * The JSON string token src[a..b] (quotes included) as `quote(JSON.parse(token))` writes it, into `out` from
 * `at` (just counted when `out` is null): its length, or -1 if JSON.parse would refuse it. No string is made,
 * so a string of hundreds of MB costs no copies (`requotedHi`: its highest unit).
 */
function requote(src: string, a: number, b: number, out: Uint16Array | null, at: number): number {
  let len = 0;
  let hi = 0;
  let bytes = 0;
  let k = at;
  const put = (u: number) => {
    if (out) out[k++] = u;
    len++;
    hi |= u;
    // (Surrogates are written in pairs: 4 bytes for the pair.)
    bytes += u < 0x80 ? 1 : u < 0x800 ? 2 : u >= 0xd800 && u <= 0xdfff ? (u <= 0xdbff ? 4 : 0) : 3;
  };
  const esc = (u: number) => {
    put(92);
    put(117);
    put(HEX.charCodeAt((u >> 12) & 15));
    put(HEX.charCodeAt((u >> 8) & 15));
    put(HEX.charCodeAt((u >> 4) & 15));
    put(HEX.charCodeAt(u & 15));
  };
  put(34);
  // A high surrogate waiting for its low half.
  let high = -1;
  for (let i = a + 1; i < b; ) {
    let u = src.charCodeAt(i++);
    if (u === 92) {
      const e = src.charCodeAt(i++);
      switch (e) {
        case 34: case 92: case 47: u = e; break;
        case 98: u = 8; break;
        case 102: u = 12; break;
        case 110: u = 10; break;
        case 114: u = 13; break;
        case 116: u = 9; break;
        case 117: {
          u = 0;
          for (let d = 0; d < 4; d++) {
            const h = src.charCodeAt(i++);
            const v = h >= 48 && h <= 57 ? h - 48 : h >= 97 && h <= 102 ? h - 87 : h >= 65 && h <= 70 ? h - 55 : -1;
            if (v < 0) return -1;
            u = (u << 4) | v;
          }
          break;
        }
        default:
          return -1;
      }
    } else if (u < 32) return -1;
    if (high >= 0) {
      if (u >= 0xdc00 && u <= 0xdfff) {
        put(high);
        put(u);
        high = -1;
        continue;
      }
      esc(high);
      high = -1;
    }
    if (u >= 0xd800 && u <= 0xdbff) high = u;
    else if (u >= 0xdc00 && u <= 0xdfff) esc(u);
    else if (u === 34 || u === 92) { put(92); put(u); }
    else if (u < 32) {
      const short = u === 8 ? 98 : u === 12 ? 102 : u === 10 ? 110 : u === 13 ? 114 : u === 9 ? 116 : 0;
      if (short) { put(92); put(short); } else esc(u);
    } else put(u);
  }
  if (high >= 0) esc(high);
  put(34);
  requotedHi = hi;
  requotedBytes = bytes;
  return len;
}

/** UTF-8 bytes of what `requote` writes for src[a..b], or -1. */
function requoteBytes(src: string, a: number, b: number): number {
  // (A string that runs to the end of the text has no closing quote.)
  return src.charCodeAt(b) !== 34 || requote(src, a, b, null, 0) < 0 ? -1 : requotedBytes;
}


installRequoter({
  min: 65_536,
  write: (src, a, b, out, at) => requote(src, a, b, out, at),
  get hi() {
    return requotedHi;
  },
  bytes: requoteBytes,
});
