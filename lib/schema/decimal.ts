/**
 * Exact decimal numbers for JSON Schema's numeric keywords. The parser keeps every number as its source text, so
 * `multipleOf: 0.01` on 19.99, `maximum: 18446744073709551615` or 1e308 are decided on the digits, never on a
 * rounded double: value = (neg ? -1 : 1) × digits × 10^exp, with `digits` free of leading and trailing zeros
 * ("" for zero, which is never negative). The exponent is a BigInt, so 1e9007199254740993 compares exactly too.
 */
export interface Dec {
  neg: boolean;
  digits: string;
  exp: bigint;
}

const ZERO: Dec = { neg: false, digits: '', exp: 0n };
const NUM = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A JSON number's text as a Dec (null: not a JSON number). */
export function dec(text: string): Dec | null {
  const m = NUM.exec(text);
  if (!m) return null;
  const frac = m[3] ?? '';
  const digits = m[2] + frac;
  let a = 0;
  while (a < digits.length && digits.charCodeAt(a) === 48) a++;
  let b = digits.length;
  while (b > a && digits.charCodeAt(b - 1) === 48) b--;
  if (a === b) return ZERO;
  const shift = digits.length - b - frac.length;
  const exp = m[4] ? BigInt(m[4]) + BigInt(shift) : BigInt(shift);
  return { neg: m[1] === '-', digits: digits.slice(a, b), exp };
}

export const isZero = (d: Dec) => d.digits === '';

/** Whether the value is a whole number (1.0, 1e2 and 10e-1 are). */
export const isWhole = (d: Dec) => d.exp >= 0n;

/** -1, 0 or 1 as a < b, a = b, a > b. */
export function cmp(a: Dec, b: Dec): number {
  if (isZero(a) && isZero(b)) return 0;
  if (isZero(a)) return b.neg ? 1 : -1;
  if (isZero(b)) return a.neg ? -1 : 1;
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const m = cmpAbs(a, b);
  return a.neg ? -m : m;
}

/** Compares magnitudes: the position of the leading digit first (exact, any exponent), then the digits. */
function cmpAbs(a: Dec, b: Dec): number {
  const ma = BigInt(a.digits.length) + a.exp;
  const mb = BigInt(b.digits.length) + b.exp;
  if (ma !== mb) return ma < mb ? -1 : 1;
  const n = Math.max(a.digits.length, b.digits.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.digits.length ? a.digits.charCodeAt(i) : 48;
    const y = i < b.digits.length ? b.digits.charCodeAt(i) : 48;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** b^e mod m for BigInts, e ≥ 0: about log2(e) multiplications. */
function powMod(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n % m;
  let x = b % m;
  let k = e;
  while (k > 0n) {
    if (k & 1n) r = (r * x) % m;
    x = (x * x) % m;
    k >>= 1n;
  }
  return r;
}

/** Exponent gaps past this many bits (10^30,000 and more) aren't worked out: multipleOf says it can't tell. */
const MAX_GAP_BITS = 100_000;

/**
 * Whether a / b is a whole number (b > 0). With a = da × 10^ea and b = db × 10^eb, that is db | da × 10^(ea − eb).
 * For ea < eb it never is: `da` has no trailing zero, so 10^(eb − ea) can't divide it. Null: the exponents are so
 * far apart (a gap of 10^30,000 or more) that the answer isn't computed.
 */
export function isMultiple(a: Dec, b: Dec): boolean | null {
  if (isZero(a)) return true;
  const k = a.exp - b.exp;
  if (k < 0n) return false;
  const db = BigInt(b.digits);
  if (db === 1n) return true;
  if (k.toString(2).length > MAX_GAP_BITS) return null;
  return ((BigInt(a.digits) % db) * powMod(10n, k, db)) % db === 0n;
}

/** The value as short text: the digits with the decimal point placed, or scientific notation when that is shorter. */
export function decText(d: Dec): string {
  if (isZero(d)) return '0';
  const sign = d.neg ? '-' : '';
  const n = d.digits.length;
  if (d.exp >= 0n && d.exp <= 21n) return sign + d.digits + '0'.repeat(Number(d.exp));
  if (d.exp < 0n && -d.exp < BigInt(n)) {
    const at = n + Number(d.exp);
    return sign + d.digits.slice(0, at) + '.' + d.digits.slice(at);
  }
  if (d.exp < 0n && -d.exp - BigInt(n) <= 6n) return sign + '0.' + '0'.repeat(Number(-d.exp) - n) + d.digits;
  const e = d.exp + BigInt(n - 1);
  return sign + d.digits[0] + (n > 1 ? '.' + d.digits.slice(1) : '') + 'e' + (e < 0n ? '' : '+') + e;
}

/** A canonical key: equal numbers (1, 1.0, 1e0, 10e-1) give the same text. */
export const decKey = (d: Dec) => (isZero(d) ? '0' : `${d.neg ? '-' : ''}${d.digits}e${d.exp}`);
