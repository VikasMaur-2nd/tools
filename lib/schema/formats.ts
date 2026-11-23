/**
 * `format` checks, used only when format assertion is on (by default `format` is an annotation, as 2019-09 and
 * 2020-12 specify). Each follows its RFC: dates and times RFC 3339, e-mail RFC 5321 / 6531, host names RFC 1123 and
 * IDNA2008 (RFC 5890–5893, with UTS #46 mapping for idn-hostname), IP addresses RFC 2673 / 4291, URIs RFC 3986, IRIs
 * RFC 3987, URI templates RFC 6570, JSON Pointers RFC 6901, UUIDs RFC 4122, regexes ECMA-262. Unknown formats pass.
 */
import type { Draft } from './drafts';

// ── dates and times (RFC 3339 §5.6) ───────────────────────────────────────

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:([zZ])|([+-])(\d{2}):(\d{2}))$/;
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function date(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= (mo === 2 && leap(y) ? 29 : DAYS[mo - 1]);
}

function time(s: string): boolean {
  const m = TIME.exec(s);
  if (!m) return false;
  const h = +m[1];
  const mi = +m[2];
  const sec = +m[3];
  if (h > 23 || mi > 59 || sec > 60) return false;
  let off = 0;
  if (!m[4]) {
    const oh = +m[6];
    const om = +m[7];
    if (oh > 23 || om > 59) return false;
    off = (m[5] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  // A leap second is 23:59:60 in UTC.
  return sec < 60 || (((h * 60 + mi - off) % 1440) + 1440) % 1440 === 23 * 60 + 59;
}

function dateTime(s: string): boolean {
  const i = s.search(/[Tt]/);
  return i === 10 && date(s.slice(0, 10)) && time(s.slice(11));
}

const DURATION = /^P(?:(?:\d+D|\d+M(?:\d+D)?|\d+Y(?:\d+M(?:\d+D)?)?)(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S)|\d+W)$/;

// ── IP addresses ──────────────────────────────────────────────────────────

const OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);
const ipv4 = (s: string) => IPV4.test(s);

function ipv6(s: string): boolean {
  if (!/^[0-9A-Fa-f:.]+$/.test(s)) return false;
  let groups = 8;
  let body = s;
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    if (!ipv4(s.slice(lastColon + 1))) return false;
    body = s.slice(0, lastColon + 1) + '0';
    groups = 7;
  }
  const dbl = body.indexOf('::');
  if (dbl >= 0 && body.indexOf('::', dbl + 1) >= 0) return false;
  const parts = (p: string) => (p === '' ? [] : p.split(':'));
  const h16 = (g: string) => /^[0-9A-Fa-f]{1,4}$/.test(g);
  if (dbl < 0) {
    const all = body.split(':');
    return all.length === groups && all.every(h16);
  }
  const a = parts(body.slice(0, dbl));
  const b = parts(body.slice(dbl + 2));
  return a.length + b.length < groups && a.every(h16) && b.every(h16);
}

// ── host names (RFC 1123, IDNA2008: RFC 5890–5893, UTS #46) ────────────────

/** Punycode (RFC 3492). */
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, first: boolean) {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

const digitValue = (c: number) => (c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : BASE);
const digitChar = (d: number) => String.fromCharCode(d + 22 + 75 * +(d < 26));

/** Decodes a Punycode label body (null: not valid Punycode). */
export function punyDecode(input: string): number[] | null {
  const out: number[] = [];
  const b = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(0, b); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    out.push(c);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let idx = b > 0 ? b + 1 : 0; idx < input.length; ) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (idx >= input.length) return null;
      const digit = digitValue(input.charCodeAt(idx++));
      if (digit >= BASE) return null;
      i += digit * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (w > 0x7fffffff) return null;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    if (n > 0x10ffff) return null;
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return out;
}

/** Encodes code points as a Punycode label body. */
export function punyEncode(cps: number[]): string {
  let out = '';
  for (const c of cps) if (c < 0x80) out += String.fromCharCode(c);
  const basic = out.length;
  let h = basic;
  if (basic) out += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (h < cps.length) {
    let m = 0x7fffffff;
    for (const c of cps) if (c >= n && c < m) m = c;
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          out += digitChar(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        out += digitChar(q);
        bias = adapt(delta, h + 1, h === basic);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

const cpsOf = (s: string) => Array.from(s, (c) => c.codePointAt(0)!);
const inRange = (c: number, ranges: readonly number[]) => {
  for (let i = 0; i < ranges.length; i += 2) if (c >= ranges[i] && c <= ranges[i + 1]) return true;
  return false;
};

const P = {
  letterDigit: /^[\p{Ll}\p{Lu}\p{Lo}\p{Nd}\p{Lm}\p{Mn}\p{Mc}]$/u,
  unassigned: /^\p{Cn}$/u,
  ignorable: /^[\p{Default_Ignorable_Code_Point}\p{White_Space}\p{Noncharacter_Code_Point}]$/u,
  mark: /^\p{M}$/u,
  nsm: /^[\p{Mn}\p{Me}]$/u,
  letter: /^[\p{L}\p{Mc}]$/u,
  greek: /^\p{Script=Greek}$/u,
  hebrew: /^\p{Script=Hebrew}$/u,
  japanese: /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]$/u,
};
const is = (re: RegExp, c: number) => re.test(String.fromCodePoint(c));

const EXC_PVALID = [0xdf, 0x3c2, 0x6fd, 0x6fe, 0xf0b, 0x3007];
const EXC_CONTEXTO = [0xb7, 0x375, 0x5f3, 0x5f4, 0x30fb];
const EXC_DISALLOWED = [0x640, 0x7fa, 0x302e, 0x302f, 0x3031, 0x3032, 0x3033, 0x3034, 0x3035, 0x303b];
const OLD_HANGUL = [0x1100, 0x11ff, 0xa960, 0xa97f, 0xd7b0, 0xd7ff];
const IGNORABLE_BLOCKS = [0x20d0, 0x20ff, 0x1d100, 0x1d1ff, 0x1d200, 0x1d24f];
const VIRAMA = new Set([
  0x94d, 0x9cd, 0xa4d, 0xacd, 0xb4d, 0xbcd, 0xc4d, 0xccd, 0xd3b, 0xd3c, 0xd4d, 0xdca, 0xe3a, 0xeba, 0xf84, 0x1039, 0x103a, 0x1714, 0x1715,
  0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0x1bf2, 0x1bf3, 0x2d7f, 0xa806, 0xa82c, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed, 0x10a3f,
  0x11046, 0x11070, 0x1107f, 0x110b9, 0x11133, 0x11134, 0x111c0, 0x11235, 0x112ea, 0x1134d, 0x11442, 0x114c2, 0x115bf, 0x1163f, 0x116b6,
  0x1172b, 0x11839, 0x1193d, 0x1193e, 0x119e0, 0x11a34, 0x11a47, 0x11a99, 0x11c3f, 0x11d44, 0x11d45, 0x11d97,
]);

type Idna = 'PVALID' | 'CONTEXTJ' | 'CONTEXTO' | 'DISALLOWED';

/** A code point's IDNA2008 property, derived as RFC 5892 §3 does, from the engine's Unicode data. */
function idnaProperty(c: number): Idna {
  if (EXC_PVALID.includes(c)) return 'PVALID';
  if (EXC_CONTEXTO.includes(c) || (c >= 0x660 && c <= 0x669) || (c >= 0x6f0 && c <= 0x6f9)) return 'CONTEXTO';
  if (EXC_DISALLOWED.includes(c)) return 'DISALLOWED';
  if (is(P.unassigned, c)) return 'DISALLOWED';
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2d) return 'PVALID';
  if (c === 0x200c || c === 0x200d) return 'CONTEXTJ';
  if (inRange(c, OLD_HANGUL)) return 'DISALLOWED';
  const s = String.fromCodePoint(c);
  if (s.normalize('NFKC').toLowerCase().normalize('NFKC') !== s) return 'DISALLOWED';
  if (is(P.ignorable, c)) return 'DISALLOWED';
  if (inRange(c, IGNORABLE_BLOCKS)) return 'DISALLOWED';
  return is(P.letterDigit, c) ? 'PVALID' : 'DISALLOWED';
}

type Bidi = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'CS' | 'ET' | 'ON' | 'BN' | 'NSM';

/** An approximation of Bidi_Class for the code points a label can hold (JavaScript has no Bidi_Class escape). */
function bidiClass(c: number): Bidi {
  if ((c >= 0x30 && c <= 0x39) || (c >= 0x6f0 && c <= 0x6f9)) return 'EN';
  if ((c >= 0x660 && c <= 0x669) || c === 0x66b || c === 0x66c || c === 0x6dd || c === 0x8e2) return 'AN';
  if (c === 0x2d || c === 0x2b) return 'ES';
  if (c === 0x2e || c === 0x2c || c === 0x3a || c === 0x2f) return 'CS';
  if (c === 0x200c || c === 0x200d) return 'BN';
  if (is(P.nsm, c)) return 'NSM';
  if ((c >= 0x590 && c <= 0x5ff) || (c >= 0x7c0 && c <= 0x85f) || (c >= 0xfb1d && c <= 0xfb4f) || (c >= 0x10800 && c <= 0x10fff) || (c >= 0x1e800 && c <= 0x1edff)) return 'R';
  if ((c >= 0x600 && c <= 0x7bf) || (c >= 0x860 && c <= 0x8ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff) || (c >= 0x1ee00 && c <= 0x1eeff)) return 'AL';
  if (is(P.letter, c) || is(P.letterDigit, c)) return 'L';
  return 'ON';
}

const RIGHT_JOINING = [
  0x622, 0x625, 0x627, 0x627, 0x629, 0x629, 0x62f, 0x632, 0x648, 0x648, 0x671, 0x673, 0x675, 0x677, 0x688, 0x699, 0x6c0, 0x6c0, 0x6c3, 0x6cb,
  0x6cd, 0x6cd, 0x6cf, 0x6cf, 0x6d2, 0x6d3, 0x6d5, 0x6d5, 0x6ee, 0x6ef, 0x759, 0x75b, 0x76b, 0x76c, 0x771, 0x771, 0x773, 0x774, 0x778, 0x779,
  0x710, 0x710, 0x715, 0x719, 0x71e, 0x71e, 0x728, 0x728, 0x72a, 0x72a, 0x72c, 0x72c, 0x72f, 0x72f, 0x74d, 0x74d,
];

/** An approximation of Joining_Type: R and D for Arabic, Syriac and N'Ko letters, T for marks, U otherwise. */
function joiningType(c: number): 'R' | 'D' | 'L' | 'T' | 'U' {
  if (is(P.nsm, c) || c === 0x200b) return 'T';
  if (inRange(c, RIGHT_JOINING)) return 'R';
  if (c === 0x621 || c === 0x674) return 'U';
  if (((c >= 0x620 && c <= 0x6ff) || (c >= 0x710 && c <= 0x74f) || (c >= 0x750 && c <= 0x77f) || (c >= 0x7ca && c <= 0x7ea) || (c >= 0x8a0 && c <= 0x8c9)) && is(P.letter, c)) return 'D';
  return 'U';
}

/** RFC 5892 Appendix A: whether the CONTEXTJ / CONTEXTO code point at `i` is allowed where it is. */
function contextOk(cps: number[], i: number): boolean {
  const c = cps[i];
  const before = cps[i - 1];
  const after = cps[i + 1];
  if (c === 0x200d) return before !== undefined && VIRAMA.has(before);
  if (c === 0x200c) {
    if (before !== undefined && VIRAMA.has(before)) return true;
    let j = i - 1;
    while (j >= 0 && joiningType(cps[j]) === 'T') j--;
    if (j < 0 || !['L', 'D'].includes(joiningType(cps[j]))) return false;
    let k = i + 1;
    while (k < cps.length && joiningType(cps[k]) === 'T') k++;
    return k < cps.length && ['R', 'D'].includes(joiningType(cps[k]));
  }
  if (c === 0xb7) return before === 0x6c && after === 0x6c;
  if (c === 0x375) return after !== undefined && is(P.greek, after);
  if (c === 0x5f3 || c === 0x5f4) return before !== undefined && is(P.hebrew, before);
  if (c === 0x30fb) return cps.some((x) => x !== 0x30fb && is(P.japanese, x));
  if (c >= 0x660 && c <= 0x669) return !cps.some((x) => x >= 0x6f0 && x <= 0x6f9);
  if (c >= 0x6f0 && c <= 0x6f9) return !cps.some((x) => x >= 0x660 && x <= 0x669);
  return false;
}

/** The Bidi rule (RFC 5893 §2) for one label of a domain name that has right-to-left labels. */
function bidiOk(cps: number[]): boolean {
  const cls = cps.map(bidiClass);
  const first = cls[0];
  let end = cls.length - 1;
  while (end > 0 && cls[end] === 'NSM') end--;
  if (first === 'R' || first === 'AL') {
    if (!cls.every((x) => ['R', 'AL', 'AN', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM'].includes(x))) return false;
    if (!['R', 'AL', 'EN', 'AN'].includes(cls[end])) return false;
    return !(cls.includes('EN') && cls.includes('AN'));
  }
  if (first !== 'L') return false;
  if (!cls.every((x) => ['L', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM'].includes(x))) return false;
  return cls[end] === 'L' || cls[end] === 'EN';
}

const isRtlLabel = (cps: number[]) => cps.some((c) => ['R', 'AL', 'AN'].includes(bidiClass(c)));
const LDH = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** A U-label's code points by IDNA2008 (RFC 5891 §5.4). */
function uLabelOk(cps: number[]): boolean {
  const s = String.fromCodePoint(...cps);
  if (s.normalize('NFC') !== s) return false;
  if (cps[0] === 0x2d || cps[cps.length - 1] === 0x2d) return false;
  if (cps[2] === 0x2d && cps[3] === 0x2d) return false;
  if (is(P.mark, cps[0])) return false;
  for (let i = 0; i < cps.length; i++) {
    const p = idnaProperty(cps[i]);
    if (p === 'DISALLOWED') return false;
    if ((p === 'CONTEXTJ' || p === 'CONTEXTO') && !contextOk(cps, i)) return false;
  }
  return true;
}

/** One label in its ASCII form (null: invalid): an LDH label, or an A-label whose U-label is valid. */
function asciiLabel(label: string, idna: boolean, ulabels: number[][]): string | null {
  if (/^xn--/i.test(label)) {
    if (!idna) return LDH.test(label) && label.length <= 63 ? label : null;
    const body = label.slice(4).toLowerCase();
    const cps = punyDecode(body);
    if (!cps || !cps.length || cps.every((c) => c < 0x80) || punyEncode(cps) !== body || !uLabelOk(cps)) return null;
    ulabels.push(cps);
    return label.length <= 63 ? label : null;
  }
  if (/^[\x00-\x7f]*$/.test(label)) {
    if (!LDH.test(label) || label.length > 63) return null;
    if (idna && label[2] === '-' && label[3] === '-') return null;
    return label;
  }
  return null;
}

/** RFC 1123 host name; from draft-07 on its A-labels must be valid (RFC 5890). */
function hostname(s: string, draft: Draft): boolean {
  if (!s || s.length > 253) return false;
  const idna = draft >= 7;
  const ulabels: number[][] = [];
  for (const label of s.split('.')) if (asciiLabel(label, idna, ulabels) === null) return false;
  return !ulabels.some(isRtlLabel) || ulabels.every(bidiOk);
}

/** UTS #46 mapping, approximately: separators to '.', NFKC with case folding, ignorables (not ZWJ / ZWNJ) dropped. */
function mapIdn(s: string): string {
  return s
    .replace(/[。．｡]/g, '.')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{Default_Ignorable_Code_Point}/gu, (c) => (c === '\u200c' || c === '\u200d' ? c : ''))
    .normalize('NFC');
}

function idnHostname(s: string): boolean {
  if (!s || /[\s]/u.test(s) || /[^\u0000-\u{10ffff}]/u.test(s)) return false;
  if (/[\ud800-\udfff]/.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) return false;
  const mapped = mapIdn(s);
  let total = 0;
  const all: number[][] = [];
  const labels = mapped.split('.');
  for (const label of labels) {
    if (!label) return false;
    let ascii: string | null;
    if (/^xn--/.test(label) || /^[\x00-\x7f]*$/.test(label)) {
      const before = all.length;
      ascii = asciiLabel(label, true, all);
      if (ascii !== null && all.length === before) all.push(cpsOf(label));
    } else {
      const cps = cpsOf(label);
      if (!uLabelOk(cps)) return false;
      all.push(cps);
      ascii = 'xn--' + punyEncode(cps);
      if (ascii.length > 63) return false;
    }
    if (ascii === null) return false;
    total += ascii.length + 1;
  }
  if (total - 1 > 253) return false;
  return !all.some(isRtlLabel) || all.every(bidiOk);
}

// ── e-mail (RFC 5321 Mailbox, RFC 6531 for idn-email) ──────────────────────

const ATEXT = "A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~";
const DOT_ATOM = new RegExp(`^[${ATEXT}]+(?:\\.[${ATEXT}]+)*$`);
const DOT_ATOM_U = new RegExp(`^[${ATEXT}\\u{80}-\\u{10FFFF}]+(?:\\.[${ATEXT}\\u{80}-\\u{10FFFF}]+)*$`, 'u');
const QUOTED = /^"(?:[\x20\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"$/;
const QUOTED_U = /^"(?:[\x20\x21\x23-\x5b\x5d-\x7e\u{80}-\u{10FFFF}]|\\[\x20-\x7e\u{80}-\u{10FFFF}])*"$/u;
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

function email(s: string, idn: boolean, draft: Draft): boolean {
  if (idn && /[\ud800-\udfff]/.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) return false;
  // The local part may be quoted and hold '@': the domain is what follows the last '@'.
  const at = s.lastIndexOf('@');
  if (at <= 0) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (utf8Len(local) > 64) return false;
  if (!(idn ? DOT_ATOM_U.test(local) || QUOTED_U.test(local) : DOT_ATOM.test(local) || QUOTED.test(local))) return false;
  if (domain.startsWith('[')) {
    if (!domain.endsWith(']')) return false;
    const lit = domain.slice(1, -1);
    if (/^ipv6:/i.test(lit)) return ipv6(lit.slice(5));
    return ipv4(lit);
  }
  if (!domain || domain.length > 253) return false;
  if (idn) return idnHostname(domain);
  return domain.split('.').every((l) => l.length <= 63 && LDH.test(l)) && (draft < 7 || hostname(domain, draft));
}

// ── URIs and IRIs (RFC 3986, RFC 3987) ─────────────────────────────────────

const UCS = '\\u{A0}-\\u{D7FF}\\u{F900}-\\u{FDCF}\\u{FDF0}-\\u{FFEF}\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}\\u{D0000}-\\u{DFFFD}\\u{E1000}-\\u{EFFFD}';
const PRIVATE_USE = '\\u{E000}-\\u{F8FF}\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}';

function uriSets(iri: boolean) {
  const unres = `A-Za-z0-9\\-._~${iri ? UCS : ''}`;
  const sub = "!$&'()*+,;=";
  const pct = '%[0-9A-Fa-f]{2}';
  const chars = (extra: string) => new RegExp(`^(?:[${unres}${sub}${extra}]|${pct})*$`, 'u');
  return {
    userinfo: chars(':'),
    regName: chars(''),
    segment: chars(':@'),
    segmentNc: chars('@'),
    query: iri ? chars(`:@/?${PRIVATE_USE}`) : chars(':@/?'),
    fragment: chars(':@/?'),
    future: new RegExp(`^v[0-9A-Fa-f]+\\.[${unres}${sub}:]+$`, 'u'),
  };
}
const URI_SETS = uriSets(false);
const IRI_SETS = uriSets(true);
const URI_PARTS = /^(?:([A-Za-z][A-Za-z0-9+\-.]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/su;
const AUTHORITY = /^(?:([^@]*)@)?(\[[^\]]*\]|[^:\[\]]*)(?::([0-9]*))?$/su;

function uri(s: string, iri: boolean, needScheme: boolean): boolean {
  const sets = iri ? IRI_SETS : URI_SETS;
  const m = URI_PARTS.exec(s);
  if (!m) return false;
  const [, scheme, authority, path, query, fragment] = m;
  if (needScheme && !scheme) return false;
  if (authority !== undefined) {
    const a = AUTHORITY.exec(authority);
    if (!a) return false;
    const [, user, host] = a;
    if (user !== undefined && !sets.userinfo.test(user)) return false;
    if (host.startsWith('[')) {
      const inner = host.slice(1, -1);
      if (!ipv6(inner) && !sets.future.test(inner)) return false;
    } else if (!sets.regName.test(host)) return false;
    if (path && !path.startsWith('/')) return false;
  }
  const segs = path.split('/');
  // A relative reference's first segment can't hold ':' (it would read as a scheme).
  if (!scheme && authority === undefined && segs[0] && !sets.segmentNc.test(segs[0])) return false;
  if (authority === undefined && path.startsWith('//')) return false;
  if (!segs.every((x) => sets.segment.test(x))) return false;
  if (query !== undefined && !sets.query.test(query)) return false;
  if (fragment !== undefined && !sets.fragment.test(fragment)) return false;
  return true;
}

// ── URI templates (RFC 6570, level 4) ──────────────────────────────────────

const VARSPEC = /^(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9][0-9]{0,3}|\*)?$/;
// (RFC 6570 leaves out the apostrophe, but its errata and the test suite allow it.)
const LITERAL = /^(?:[^\x00-\x20"%<>\\^`{|}\x7f]|%[0-9A-Fa-f]{2})*$/u;

function uriTemplate(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    const lit = open < 0 ? s.slice(i) : s.slice(i, open);
    if (!LITERAL.test(lit) || lit.includes('}')) return false;
    if (open < 0) return true;
    const close = s.indexOf('}', open);
    if (close < 0) return false;
    let expr = s.slice(open + 1, close);
    if (/^[+#./;?&=,!@|]/.test(expr)) expr = expr.slice(1);
    if (!expr || !expr.split(',').every((v) => VARSPEC.test(v))) return false;
    i = close + 1;
  }
  return true;
}

// ── the rest ──────────────────────────────────────────────────────────────

const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/u;
const RELATIVE_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~[01])*)*)$/u;
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

function regex(s: string): boolean {
  try {
    new RegExp(s, 'u');
    return true;
  } catch {
    return false;
  }
}

/** The formats checked when format assertion is on; any other format name passes. */
export const FORMAT_NAMES = [
  'date-time', 'date', 'time', 'duration', 'email', 'idn-email', 'hostname', 'idn-hostname', 'ipv4', 'ipv6',
  'uri', 'uri-reference', 'iri', 'iri-reference', 'uri-template', 'json-pointer', 'relative-json-pointer', 'regex', 'uuid',
] as const;

/** Whether string `s` is in `format` (true for formats not listed above). */
export function checkFormat(format: string, s: string, draft: Draft): boolean {
  switch (format) {
    case 'date-time': return dateTime(s);
    case 'date': return date(s);
    case 'time': return time(s);
    case 'duration': return DURATION.test(s);
    case 'email': return email(s, false, draft);
    case 'idn-email': return email(s, true, draft);
    case 'hostname': return hostname(s, draft);
    case 'idn-hostname': return idnHostname(s);
    case 'ipv4': return ipv4(s);
    case 'ipv6': return ipv6(s);
    case 'uri': return uri(s, false, true);
    case 'uri-reference': return uri(s, false, false);
    case 'iri': return uri(s, true, true);
    case 'iri-reference': return uri(s, true, false);
    case 'uri-template': return uriTemplate(s);
    case 'json-pointer': return JSON_POINTER.test(s);
    case 'relative-json-pointer': return RELATIVE_POINTER.test(s);
    case 'regex': return regex(s);
    case 'uuid': return UUID.test(s);
    default: return true;
  }
}

export const knownFormat = (f: string) => (FORMAT_NAMES as readonly string[]).includes(f);
