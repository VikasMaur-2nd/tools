/**
 * Exact decimal numbers for JSON Schema's numeric keywords. The parser keeps every number as its source text, so
 * `multipleOf: 0.01` on 19.99, `maximum: 18446744073709551615` or 1e308 are decided on the digits, never on a
 * rounded double: value = (neg ? -1 : 1) × digits × 10^exp, with `digits` free of leading and trailing zeros
 * ("" for zero, which is never negative).
 */
export interface Dec {
  neg: boolean;
  digits: string;
  exp: number;
}

const ZERO: Dec = { neg: false, digits: '', exp: 0 };
const NUM = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A JSON number's text as a Dec (null: not a number; exponents past ±2^53 are refused rather than rounded). */
export function dec(text: string): Dec | null {
  const m = NUM.exec(text);
  if (!m) return null;
  const e = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(e)) return null;
  const frac = m[3] ?? '';
  let digits = m[2] + frac;
  let exp = e - frac.length;
  let a = 0;
  while (a < digits.length && digits.charCodeAt(a) === 48) a++;
  let b = digits.length;
  while (b > a && digits.charCodeAt(b - 1) === 48) b--;
  if (a === b) return ZERO;
  exp += digits.length - b;
  digits = digits.slice(a, b);
  if (!Number.isSafeInteger(exp)) return null;
  return { neg: m[1] === '-', digits, exp };
}

export const isZero = (d: Dec) => d.digits === '';

/** Whether the value is a whole number (1.0, 1e2 and 10e-1 are). */
export const isWhole = (d: Dec) => d.exp >= 0;

/** -1, 0 or 1 as a < b, a = b, a > b. */
export function cmp(a: Dec, b: Dec): number {
  if (isZero(a) && isZero(b)) return 0;
  if (isZero(a)) return b.neg ? 1 : -1;
  if (isZero(b)) return a.neg ? -1 : 1;
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const m = cmpAbs(a, b);
  return a.neg ? -m : m;
}

/** Compares magnitudes: the position of the leading digit first, then the digits. */
function cmpAbs(a: Dec, b: Dec): number {
  const ma = a.digits.length + a.exp;
  const mb = b.digits.length + b.exp;
  if (ma !== mb) return ma < mb ? -1 : 1;
  const n = Math.max(a.digits.length, b.digits.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.digits.length ? a.digits.charCodeAt(i) : 48;
    const y = i < b.digits.length ? b.digits.charCodeAt(i) : 48;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** b^e mod m for BigInts, e ≥ 0 (a billion-digit exponent costs ~30 multiplications). */
function powMod(b: bigint, e: number, m: bigint): bigint {
  let r = 1n % m;
  let x = b % m;
  let k = e;
  while (k > 0) {
    if (k % 2 === 1) r = (r * x) % m;
    x = (x * x) % m;
    k = Math.floor(k / 2);
  }
  return r;
}

/**
 * Whether a / b is a whole number (b > 0). With a = da × 10^ea and b = db × 10^eb, that is db | da × 10^(ea − eb).
 * For ea < eb it never is: `da` has no trailing zero, so 10^(eb − ea) can't divide it.
 */
export function isMultiple(a: Dec, b: Dec): boolean {
  if (isZero(a)) return true;
  const k = a.exp - b.exp;
  if (k < 0) return false;
  const db = BigInt(b.digits);
  if (db === 1n) return true;
  return (BigInt(a.digits) % db) * powMod(10n, k, db) % db === 0n;
}

/** The value as short text: the digits with the decimal point placed, or scientific notation when that is shorter. */
export function decText(d: Dec): string {
  if (isZero(d)) return '0';
  const sign = d.neg ? '-' : '';
  const n = d.digits.length;
  if (d.exp >= 0 && d.exp <= 21) return sign + d.digits + '0'.repeat(d.exp);
  if (d.exp < 0 && -d.exp < n) return sign + d.digits.slice(0, n + d.exp) + '.' + d.digits.slice(n + d.exp);
  if (d.exp < 0 && -d.exp - n <= 6) return sign + '0.' + '0'.repeat(-d.exp - n) + d.digits;
  const e = d.exp + n - 1;
  return sign + d.digits[0] + (n > 1 ? '.' + d.digits.slice(1) : '') + 'e' + (e < 0 ? '' : '+') + e;
}

/** A canonical key: equal numbers (1, 1.0, 1e0, 10e-1) give the same text. */
export const decKey = (d: Dec) => (isZero(d) ? '0' : `${d.neg ? '-' : ''}${d.digits}e${d.exp}`);
