/**
 * JWT (JWS compact) decoding, without signature verification. Small and
 * synchronous: the editor treats a pasted token as a document of its own, and
 * the tree's value hints label string values that hold one.
 */
import { parse } from './parser';
import { quote, stringify } from './format';

const isoOf = (ms: number) => (Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : undefined);


const LUT = new Int8Array(128).fill(-1);
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
for (let i = 0; i < 64; i++) LUT[B64.charCodeAt(i)] = i;
let utf8: TextDecoder | undefined;

/** Unpadded base64url → UTF-8 text; null on a bad alphabet, length or UTF-8 sequence. */
function b64urlText(s: string): string | null {
  const n = s.length;
  if (n % 4 === 1) return null;
  const out = new Uint8Array((n * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? LUT[c] : -1;
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = acc >> bits;
    }
  }
  try {
    return (utf8 ??= new TextDecoder('utf-8', { fatal: true })).decode(out);
  } catch {
    return null;
  }
}

// header.payload.signature (JWS compact), optional "Bearer " prefix
const JWT = /^(?:[Bb]earer\s+)?(eyJ[\w-]*)\.([\w-]+)\.([\w-]*)$/;

/** Exactly two dots (5-part JWE has four), found natively before any regex work. */
function jwtParts(s: string): RegExpExecArray | null {
  const a = s.indexOf('.');
  const b = a < 0 ? -1 : s.indexOf('.', a + 1);
  return b < 0 || s.indexOf('.', b + 1) >= 0 ? null : JWT.exec(s.trim());
}

/** Cheap structural check: three base64url parts, header starting with `eyJ` (`{"`). */
export const isJwt = (s: string) => jwtParts(s) !== null;

export interface JwtClaims {
  exp?: string;
  iat?: string;
  nbf?: string;
  expired?: boolean;
}

export interface DecodedJwt {
  header: unknown;
  payload: unknown;
  signature: string;
  claims: JwtClaims;
}

export interface Decoded extends DecodedJwt {
  /** decoded header / payload JSON text */
  h: string;
  p: string;
  exp?: number;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export function decode(token: string, now: number): Decoded | null {
  const m = jwtParts(token);
  if (!m || m[3].length % 4 === 1) return null;
  const h = b64urlText(m[1]);
  if (h === null) return null;
  const p = b64urlText(m[2]);
  if (p === null) return null;
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(h);
    payload = JSON.parse(p);
  } catch {
    return null;
  }
  if (!isObj(header)) return null;
  const claims: JwtClaims = {};
  let exp: number | undefined;
  if (isObj(payload)) {
    for (const k of ['exp', 'iat', 'nbf'] as const) {
      const v = payload[k];
      const iso = typeof v === 'number' ? isoOf(v * 1000) : undefined;
      if (iso) claims[k] = iso;
    }
    if (claims.exp) {
      exp = payload.exp as number;
      claims.expired = exp * 1000 <= now;
    }
  }
  return { header, payload, signature: m[3], claims, h, p, exp };
}

/**
 * Decodes a JWS-compact JWT (surrounding whitespace / "Bearer " allowed).
 * Returns null for anything else, including 5-part JWE tokens. Does not verify
 * the signature. `exp`/`iat`/`nbf` (NumericDate seconds) become ISO strings.
 */
export function decodeJwt(token: string, now = Date.now()): DecodedJwt | null {
  const d = decode(token, now);
  return d && { header: d.header, payload: d.payload, signature: d.signature, claims: d.claims };
}

/**
 * Pretty document `{"header", "payload", "signature", "_claims"}` for the editor.
 * Header and payload go through the lossless parser, so big numbers, key order
 * and duplicate keys survive. `_claims` is omitted when there are none.
 */
export function jwtToJson(token: string, indent: string, now = Date.now()): string | null {
  const d = decode(token, now);
  return d && toJson(d, indent);
}

function toJson(d: Decoded, indent: string): string {
  const nl = indent ? '\n' + indent : '';
  const colon = indent ? ': ' : ':';
  const nest = (json: string) => {
    const root = parse(json).root;
    const t = root ? stringify(root, indent) : json;
    return indent ? t.split('\n').join(nl) : t;
  };
  let out =
    '{' + nl + '"header"' + colon + nest(d.h) + ',' + nl + '"payload"' + colon + nest(d.p) + ',' + nl + '"signature"' + colon + quote(d.signature);
  const keys = Object.keys(d.claims) as (keyof JwtClaims)[];
  if (keys.length) {
    out += ',' + nl + '"_claims"' + colon + '{';
    keys.forEach((k, i) => (out += (i ? ',' : '') + nl + indent + quote(k) + colon + JSON.stringify(d.claims[k])));
    out += nl + '}';
  }
  return out + (indent ? '\n' : '') + '}';
}

/** A whole input that is one JWT: its decoded document plus where each part sits in the text. */
export interface JwtInput {
  /** The decoded document (as {@link jwtToJson}). */
  json: string;
  alg?: string;
  /** `exp` in NumericDate seconds, when present. */
  exp?: number;
  /** Offsets: "Bearer " prefix start, header start, payload start, signature start, signature end. Dots sit just before payload and signature. */
  at: [number, number, number, number, number];
}

/**
 * The input as a JWT, or null. Bails out on the first character for anything
 * that isn't one, so it costs nothing on ordinary documents.
 */
export function readJwt(text: string, indent: string, now = Date.now()): JwtInput | null {
  if (text.length > 1_000_000) return null;
  let i = 0;
  while (i < text.length && text.charCodeAt(i) <= 32) i++;
  const c = text.charCodeAt(i);
  if (c !== 101 && c !== 66 && c !== 98) return null; // e (eyJ…) or Bearer
  const m = jwtParts(text);
  const d = m && decode(text, now);
  if (!m || !d) return null;
  const h = i + m[0].length - (m[1].length + m[2].length + m[3].length + 2);
  const p = h + m[1].length + 1;
  const s = p + m[2].length + 1;
  const alg = (d.header as Record<string, unknown>).alg;
  return { json: toJson(d, indent), alg: typeof alg === 'string' ? alg : undefined, exp: d.exp, at: [i, h, p, s, s + m[3].length] };
}

/** Compact non-negative duration: 45s, 12m, 2h, 3d, 1y. */
export const compact = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return s < 60
    ? s + 's'
    : s < 3600
      ? ((s / 60) | 0) + 'm'
      : s < 86400
        ? ((s / 3600) | 0) + 'h'
        : s < 31536000
          ? ((s / 86400) | 0) + 'd'
          : ((s / 31536000) | 0) + 'y';
};
