/**
 * "Smart value" helpers: JWT decoding, embedded-JSON detection, human hints
 * for primitive values (dates, epochs, colors, links, …) and JSON string
 * escape / unescape.
 *
 * Pure and browser-safe. Every function is O(length) and bails out on the
 * first character(s) that cannot match, so hints are cheap enough to compute
 * while rendering rows.
 */
import { NUM, STR, parse, type JNode } from './parser';
import { formatBytes, quote, stringify } from './format';

const isWs = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

// ── time formatting ──────────────────────────────────────────────────────

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

let rtf: Intl.RelativeTimeFormat | null | undefined;
let dtfDate: Intl.DateTimeFormat | undefined;
let dtfTime: Intl.DateTimeFormat | undefined;

/** "3 days ago" / "in 2 hours" for a signed offset in seconds; `days` = whole-day precision. */
function relTime(sec: number, days = false): string {
  const abs = Math.abs(sec);
  const last = days ? 'day' : 'second';
  for (const [unit, size] of UNITS) {
    // switch to the larger unit a little early: "last year", not "12 months ago"
    if (abs < size * 0.9 && unit !== last) continue;
    const v = Math.round(sec / size);
    if (rtf === undefined) {
      try {
        rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      } catch {
        rtf = null;
      }
    }
    if (rtf) return rtf.format(v, unit);
    const a = Math.abs(v);
    const t = a + ' ' + unit + (a === 1 ? '' : 's');
    return v < 0 ? t + ' ago' : v ? 'in ' + t : days ? 'today' : 'now';
  }
  return '';
}

/** Localized date ("Oct 13, 2026") or date-time with the viewer's time zone. */
function humanDate(ms: number, dateOnly: boolean): string {
  try {
    const f = dateOnly
      ? (dtfDate ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }))
      : (dtfTime ??= new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }));
    return f.format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Compact non-negative duration: 45s, 12m, 2h, 3d, 1y. */
const compact = (sec: number) => {
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

const isoOf = (ms: number) => (Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : undefined);

// ── JWT ──────────────────────────────────────────────────────────────────

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

/** Exactly two dots (5-part JWE has four) — found natively before any regex work. */
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

interface Decoded extends DecodedJwt {
  /** decoded header / payload JSON text */
  h: string;
  p: string;
  exp?: number;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function decode(token: string, now: number): Decoded | null {
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
export function jwtToJson(token: string, indent: string): string | null {
  const d = decode(token, Date.now());
  if (!d) return null;
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

// ── embedded JSON ────────────────────────────────────────────────────────

const MAX_EMBED = 5 * 1024 * 1024;
const pair = (x: number, y: number) => (x === 123 && y === 125) || (x === 91 && y === 93);

/**
 * If a (decoded) string value is itself a JSON object/array — optionally
 * whitespace-padded or double-encoded as a JSON string literal — returns the
 * inner JSON text, else null. Only parses when the first/last non-space
 * characters already pair up as `{}` / `[]`.
 */
export function embeddedJson(s: string): string | null {
  const n = s.length;
  if (n < 2 || n > MAX_EMBED) return null;
  let a = 0;
  let b = n - 1;
  while (a < b && isWs(s.charCodeAt(a))) a++;
  while (b > a && isWs(s.charCodeAt(b))) b--;
  const o = s.charCodeAt(a);
  const c = s.charCodeAt(b);
  if (o === 34 && c === 34 && b - a > 2) {
    // `"{\"a\":1}"`: a string literal that holds JSON
    if (!pair(s.charCodeAt(a + 1), s.charCodeAt(b - 1))) return null;
    try {
      const inner: unknown = JSON.parse(s.slice(a, b + 1));
      return typeof inner === 'string' ? embeddedJson(inner) : null;
    } catch {
      return null;
    }
  }
  if (!pair(o, c)) return null;
  const t = a || b < n - 1 ? s.slice(a, b + 1) : s;
  try {
    JSON.parse(t);
    return t;
  } catch {
    return null;
  }
}

// ── value hints ──────────────────────────────────────────────────────────

export type HintKind =
  | 'date'
  | 'epoch-s'
  | 'epoch-ms'
  | 'color'
  | 'url'
  | 'email'
  | 'uuid'
  | 'jwt'
  | 'base64-image'
  | 'json';

export interface ValueHint {
  kind: HintKind;
  label: string;
}

const ISO = /^(\d{4})-(\d\d)-(\d\d)(?:[Tt ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?([Zz]|[+-]\d\d(?::?\d\d)?)?)?$/;
const EPOCH_S = /^\d{10}(?:\.\d{1,9})?$/;
const EPOCH_MS = /^\d{13}$/;
const HEX = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;
const CFN = /^(rgb|hsl)a?\(([^()]*)\)$/i;
const CARG = /^[+-]?(?:\d+\.?\d*|\.\d+)%?$/;
const URL_RE = /^https?:\/\/([^\s/?#]{1,512})(?:[/?#]\S*)?$/i;
const AUTHORITY = /^(?:[^@]*@)?(\[[\da-f:.]+\]|[^:@]+)(?::\d{1,5})?$/i;
const EMAIL = /^[^\s@"(),:;<>[\\\]]{1,64}@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/i;
const UUID = /^[\da-f]{8}-[\da-f]{4}-([\da-f])[\da-f]{3}-([\da-f])[\da-f]{3}-[\da-f]{12}$/i;
const IMG = /^data:image\/([\w.+-]{1,64})(?:;[\w.+-]{1,64}=[^;,]{0,64}){0,4};base64,/i;
// 100-ns ticks from the Gregorian epoch (UUID v1/v6) → Unix ms
const GREGORIAN_MS = 12219292800000;

function dateHint(s: string, now: number): ValueHint | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = +m[3];
  const timed = m[4] !== undefined;
  const h = timed ? +m[4] : 0;
  const mi = timed ? +m[5] : 0;
  const sec = m[6] ? +m[6] : 0;
  const tz = m[8];
  if (h > 23 || mi > 59 || sec > 59) return null;
  // no offset on a date-time = local time (as in ECMAScript); date-only = a calendar day
  const local = timed && !tz;
  const dt = new Date(0);
  if (local) {
    dt.setFullYear(y, mo, d);
    dt.setHours(h, mi, sec, m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  } else {
    dt.setUTCFullYear(y, mo, d);
    dt.setUTCHours(h, mi, sec, m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  }
  if ((local ? dt.getMonth() : dt.getUTCMonth()) !== mo || (local ? dt.getDate() : dt.getUTCDate()) !== d) return null;
  let ms = dt.getTime();
  if (!timed) {
    const t = new Date(now);
    const days = Math.round((ms - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
    return { kind: 'date', label: humanDate(ms, true) + ' · ' + relTime(days * 86400, true) };
  }
  if (tz && tz.length > 1) {
    const oh = +tz.slice(1, 3);
    const om = tz.length > 3 ? +tz.slice(-2) : 0;
    if (oh > 23 || om > 59) return null;
    ms -= (tz[0] === '-' ? -1 : 1) * (oh * 60 + om) * 60000;
  }
  return { kind: 'date', label: humanDate(ms, false) + ' · ' + relTime((ms - now) / 1000) };
}

/** Unix seconds (10 digits, optional fraction) or milliseconds (13 digits) in 2001–2099. */
function epochHint(raw: string, now: number): ValueHint | null {
  const len = raw.length;
  if (len < 10 || len > 20) return null;
  const isMs = len === 13 && EPOCH_MS.test(raw);
  if (!isMs && !EPOCH_S.test(raw)) return null;
  const ms = isMs ? +raw : Math.round(+raw * 1000);
  if (ms < 1e12 || ms >= 4102444800000) return null;
  let iso = new Date(ms).toISOString();
  if (!isMs && iso.endsWith('.000Z')) iso = iso.slice(0, -5) + 'Z';
  return { kind: isMs ? 'epoch-ms' : 'epoch-s', label: iso + ' · ' + relTime((ms - now) / 1000) };
}

const hex2 = (n: number) => (n < 16 ? '0' : '') + n.toString(16);
const clamp = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);

/** #rgb / #rrggbb / #rrggbbaa → rgb(); rgb() / hsl() → hex. */
function colorHint(s: string): ValueHint | null {
  if (s.length > 64) return null;
  if (HEX.test(s)) {
    let x = s.slice(1);
    if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
    const rgb = parseInt(x.slice(0, 2), 16) + ', ' + parseInt(x.slice(2, 4), 16) + ', ' + parseInt(x.slice(4, 6), 16);
    const a = x.length === 8 ? Math.round(parseInt(x.slice(6), 16) / 2.55) / 100 : 1;
    return { kind: 'color', label: 'Color · ' + (a < 1 ? 'rgba(' + rgb + ', ' + a : 'rgb(' + rgb) + ')' };
  }
  const m = CFN.exec(s);
  if (!m) return null;
  const hsl = m[1].toLowerCase() === 'hsl';
  const args = m[2].trim().split(/\s*[,/]\s*|\s+/);
  if (hsl && args.length) args[0] = args[0].replace(/deg$/i, '');
  if (args.length < 3 || args.length > 4 || !args.every((v) => CARG.test(v))) return null;
  const pct = (i: number) => args[i].endsWith('%');
  const num = (i: number) => parseFloat(args[i]);
  let rgb: number[];
  if (hsl) {
    if (pct(0)) return null;
    const hue = num(0);
    const sat = clamp(num(1) / 100, 1);
    const l = clamp(num(2) / 100, 1);
    const f = (n: number) => {
      const k = (((n + hue / 30) % 12) + 12) % 12;
      return (l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    rgb = [f(0), f(8), f(4)];
  } else rgb = [0, 1, 2].map((i) => (pct(i) ? (num(i) * 255) / 100 : num(i)));
  const a = args.length > 3 ? clamp(pct(3) ? num(3) / 100 : num(3), 1) : 1;
  let hex = '#';
  for (const v of rgb) hex += hex2(Math.round(clamp(v, 255)));
  return { kind: 'color', label: 'Color · ' + hex + (a < 1 ? hex2(Math.round(a * 255)) : '') };
}

function uuidHint(s: string, now: number): ValueHint | null {
  const m = UUID.exec(s);
  if (!m) return null;
  if (/^[0-]+$/.test(s)) return { kind: 'uuid', label: 'UUID (nil)' };
  if (/^[fF-]+$/.test(s)) return { kind: 'uuid', label: 'UUID (max)' };
  const v = m[1];
  if (v < '1' || v > '8' || !/[89ab]/i.test(m[2])) return null;
  const hx = (a: number, b: number) => parseInt(s.slice(a, b), 16);
  const ms =
    v === '7'
      ? hx(0, 8) * 65536 + hx(9, 13)
      : v === '1'
        ? (hx(15, 18) * 2 ** 48 + hx(9, 13) * 2 ** 32 + hx(0, 8)) / 1e4 - GREGORIAN_MS
        : v === '6'
          ? (hx(0, 8) * 2 ** 28 + hx(9, 13) * 2 ** 12 + hx(15, 18)) / 1e4 - GREGORIAN_MS
          : NaN;
  return { kind: 'uuid', label: 'UUID v' + v + (isNaN(ms) ? '' : ' · ' + relTime((ms - now) / 1000)) };
}

function strHint(n: JNode, now: number): ValueHint | null {
  const s = n.v as string;
  const len = s.length;
  if (!len) return null;
  const c = s.charCodeAt(0);
  const lc = c | 32;
  let h: ValueHint | null = null;
  if (len === 36 && s.charCodeAt(8) === 45 && (h = uuidHint(s, now))) return h;
  if (c >= 48 && c <= 57 && len <= 40) {
    if ((s.charCodeAt(4) === 45 && (h = dateHint(s, now))) || (h = epochHint(s, now))) return h;
  }
  if ((c === 35 || lc === 114 || lc === 104) && (h = colorHint(s))) return h;
  if (lc === 104) {
    const m = URL_RE.exec(s);
    const a = m && AUTHORITY.exec(m[1]);
    if (a) return { kind: 'url', label: 'Link · ' + a[1].toLowerCase() };
  }
  if (lc === 100) {
    const m = IMG.exec(s);
    if (m) {
      const body = len - m[0].length;
      const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
      const type = m[1].split('+')[0].toUpperCase();
      return { kind: 'base64-image', label: type + ' image · ' + formatBytes(Math.max(0, ((body * 3) >> 2) - pad)) };
    }
  }
  if (c === 101 || lc === 98 || isWs(c)) {
    const d = decode(s, now);
    if (d) {
      const exp = d.exp;
      const label =
        exp === undefined
          ? 'JWT'
          : d.claims.expired
            ? 'JWT · expired ' + compact(now / 1000 - exp) + ' ago'
            : 'JWT · expires in ' + compact(exp - now / 1000);
      return { kind: 'jwt', label };
    }
  }
  if (len <= 254 && s.indexOf('@') > 0 && EMAIL.test(s)) return { kind: 'email', label: 'Email address' };
  if ((c === 123 || c === 91 || c === 34 || isWs(c)) && isEmbedded(n, s)) {
    return { kind: 'json', label: 'JSON string (' + len + ' chars)' };
  }
  return null;
}

// Verdicts for big strings, so re-rendering a row doesn't re-parse megabytes.
const embedMemo = new WeakMap<JNode, { s: string; ok: boolean }>();

function isEmbedded(n: JNode, s: string): boolean {
  if (s.length < 65536) return embeddedJson(s) !== null;
  const m = embedMemo.get(n);
  if (m && m.s === s) return m.ok;
  const ok = embeddedJson(s) !== null;
  embedMemo.set(n, { s, ok });
  return ok;
}

/**
 * Human hints for a string / number node (tooltips, inline badges). Usually
 * zero or one entry. `now` is injectable for tests.
 */
export function valueHints(n: JNode, now = Date.now()): ValueHint[] {
  const h = n.t === NUM ? epochHint(n.v as string, now) : n.t === STR ? strHint(n, now) : null;
  return h ? [h] : [];
}

// ── JSON string escape / unescape ────────────────────────────────────────

const u4 = (ch: string) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');

/**
 * Text → JSON string-literal content (no surrounding quotes). Also escapes
 * U+2028/U+2029 so the result is safe inside JS/HTML; `ascii` escapes every
 * non-ASCII code unit as \uXXXX.
 */
export function escapeJsonString(text: string, ascii = false): string {
  return JSON.stringify(text)
    .slice(1, -1)
    .replace(ascii ? /[\u007f-\uffff]/g : /[\u2028\u2029]/g, u4);
}

const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
// a valid escape, or a lone backslash (= invalid escape)
const ESC_RE = /\\(?:u([\da-fA-F]{4})|(["\\/bfnrt])|)/g;

/**
 * JSON string-literal content → text. Accepts the literal with or without
 * its surrounding quotes; raw characters pass through, but any invalid escape
 * (`\x`, short `\u`, trailing `\`) yields null.
 */
export function unescapeJsonString(text: string): string | null {
  let s = text;
  const t = text.trim();
  const e = t.length - 1;
  if (e > 0 && t.charCodeAt(0) === 34 && t.charCodeAt(e) === 34) {
    let k = 0; // closing quote must not itself be escaped
    while (t.charCodeAt(e - 1 - k) === 92) k++;
    if (!(k & 1)) s = t.slice(1, e);
  }
  try {
    return JSON.parse('"' + s + '"') as string; // native fast path for strict content
  } catch {
    // raw quotes / control characters, or a bad escape
  }
  let bad = false;
  const out = s.replace(ESC_RE, (_: string, h: string | undefined, c: string | undefined) =>
    h ? String.fromCharCode(parseInt(h, 16)) : c ? ESC[c] : ((bad = true), ''),
  );
  return bad ? null : out;
}
