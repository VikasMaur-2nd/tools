// Test documents, generated on first use and kept in the harness cache (never committed). Every
// generator is seeded, so a fixture is byte-identical on every machine and run. Bump VERSION when a
// generator's output changes.
//
//   bench-<size>[-pretty][-nl][-broken]   customer export, sizes tiny 30kb 100kb 300kb 1mb 3mb 5mb 10mb 25mb 50mb.
//                                         Smaller files are prefixes of larger ones; account numbers are
//                                         bare integers above 2^53; marker TKLB-7F3A-MARKER, last record
//                                         has search_probe TKLB-NEEDLE-LAST.
//   line-5k, line-20k                     one-line arrays of bench records (long-line editor).
//   small-mix mid-mix mix-one-line mix-pretty mix-3mb   hard text: every script, emoji sequences,
//                                         zero-width and bidi controls, escapes.
//   crlf-bom, lines (.jsonl), deep, broken, rlo-open    awkward documents.
//   rows-<n>                              n simple user rows ({id,name,email,tags,profile}).
//   deep-objects-<n>, deep-arrays-<n>     nesting n levels deep.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from './env.mjs';

const VERSION = 1;
const DIR = join(DIRS.fixtures, `v${VERSION}`);
mkdirSync(DIR, { recursive: true });

const EXT = { lines: 'jsonl' };
const base = (name) => name.replace(/\.jsonl?$/, '');
const fileName = (name) => `${base(name)}.${EXT[base(name)] || 'json'}`;

/** Path of a fixture file, generating it on first use. */
export function fixture(name) {
  const file = join(DIR, fileName(name));
  if (!existsSync(file)) {
    const text = generate(base(name));
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file); // atomic: parallel runs never see half a file
  }
  return file;
}
export const fixtureText = (name) => readFileSync(fixture(name), 'utf8');
export const fixtureBytes = (name) => statSync(fixture(name)).size;
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function generate(name) {
  let m;
  if ((m = /^bench-(tiny|\d+(?:kb|mb))((?:-pretty|-nl|-broken)*)$/.exec(name))) {
    let text = bench(SIZES[m[1]] ?? size(m[1]), m[2].includes('-pretty'));
    if (m[2].includes('-broken')) {
      const at = text.indexOf('},{', text.length >> 1) + 1;
      text = text.slice(0, at) + ',,' + text.slice(at);
    }
    return m[2].includes('-nl') ? text + '\n' : text;
  }
  if ((m = /^line-(\d+)k$/.exec(name))) return bench(Number(m[1]) * 1000, false, true);
  if ((m = /^rows-(\d+)$/.exec(name))) return rows(Number(m[1]));
  if ((m = /^deep-(objects|arrays)-(\d+)$/.exec(name))) return deep(m[1], Number(m[2]));
  if (MIX[name]) return MIX[name]();
  throw new Error(`unknown fixture "${name}"`);
}

// ── bench-*: the large-file benchmark's customer export ──────────────────────────────────────────

const SIZES = { tiny: 4_000 };
const size = (s) => Number.parseInt(s, 10) * (s.endsWith('mb') ? 1_000_000 : 1_000);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['José', 'Zoë', 'Søren', 'Aiyana', 'Mei', 'Олег', 'Łukasz', 'Ngozi', 'Ana', 'Ömer', 'Priya', 'Hiroshi', 'Fatima', 'Liam', 'Chloé', 'Mateus', 'Ingrid', 'Rahul', 'Yuki', 'Björn'];
const LAST = ['García', 'Müller', 'Nakamura', 'Okafor', 'Kowalski', 'Smith', 'Dubois', 'Иванов', 'Silva', 'Yılmaz', 'Patel', '李', 'Andersson', 'Haddad', "O'Brien", 'Nguyễn', 'Rossi', 'Kim', 'Ferreira', 'Novák'];
const CITIES = [
  ['München', 'DE', 48.1372, 11.5756], ['São Paulo', 'BR', -23.5505, -46.6333], ['Kraków', 'PL', 50.0647, 19.945],
  ['東京', 'JP', 35.6762, 139.6503], ['Москва', 'RU', 55.7558, 37.6173], ['Zürich', 'CH', 47.3769, 8.5417],
  ['Reykjavík', 'IS', 64.1466, -21.9426], ['İstanbul', 'TR', 41.0082, 28.9784], ['القاهرة', 'EG', 30.0444, 31.2357],
  ['Mumbai', 'IN', 19.076, 72.8777], ['Lagos', 'NG', 6.5244, 3.3792], ['Montréal', 'CA', 45.5019, -73.5674],
];
const STREETS = ['Hauptstraße', 'Rua Augusta', 'ul. Floriańska', 'Main Street', 'Rue de Rivoli', 'Bahnhofstrasse', 'Laugavegur', 'İstiklal Caddesi'];
const TAGS = ['vip', 'beta', 'newsletter', 'churn-risk', 'b2b', 'early-adopter', 'support:priority', 'région-nord', '常連', 'test'];
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'refunded', 'cancelled'];
const CURRENCIES = ['EUR', 'USD', 'BRL', 'JPY', 'PLN', 'INR'];
const LOCALES = ['de-DE', 'pt-BR', 'pl-PL', 'ja-JP', 'ru-RU', 'en-US', 'fr-FR', 'tr-TR', 'ar-EG'];
const NOTES = ['Leave at the "back" door', 'Call first\nGate code: 4521', 'Fragile ✓ — handle with care', 'Path C:\\orders\\archive', 'Gift 🎁 for Zoë', 'Rückruf erbeten', '配達前に電話してください', 'Tab\tseparated\tnote'];
const BIGINT_BASE = 9007199254740993n; // 2^53 + 1: no JS number holds it exactly

function makeRecord(i, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  const first = pick(FIRST);
  const last = pick(LAST);
  const [city, country, lat, lng] = pick(CITIES);
  const created = new Date(Date.UTC(2019, 0, 1) + Math.floor(rnd() * 2200 * 86400) * 1000 + Math.floor(rnd() * 86400) * 1000);
  const orders = [];
  for (let o = 0, n = Math.floor(rnd() * 4); o < n; o++) {
    const items = [];
    let total = 0;
    for (let k = 0, c = 1 + Math.floor(rnd() * 3); k < c; k++) {
      const qty = 1 + Math.floor(rnd() * 5);
      const price = Math.round(rnd() * 20000) / 100;
      total += qty * price;
      items.push({ sku: `SKU-${hex(6).toUpperCase()}`, qty, price, discount: rnd() < 0.2 ? Math.round(rnd() * 30) / 100 : null });
    }
    orders.push({ order_id: `ORD-${i}-${o + 1}`, status: pick(STATUSES), currency: pick(CURRENCIES), total: Math.round(total * 100) / 100, items, note: rnd() < 0.35 ? pick(NOTES) : null });
  }
  const tags = [];
  for (let t = 0, n = Math.floor(rnd() * 4); t < n; t++) tags.push(pick(TAGS));
  return {
    id: i,
    uuid: `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(rnd() * 4)]}${hex(3)}-${hex(12)}`,
    account_number: `__BIG__${BIGINT_BASE + BigInt(i) * 7919n}`,
    name: { first, last, display: `${first} ${last}` },
    email: `user${i}@example.com`,
    active: rnd() < 0.8,
    score: Math.round(rnd() * 1e6) / 1e4,
    created_at: created.toISOString(),
    tags,
    address: {
      street: `${pick(STREETS)} ${1 + Math.floor(rnd() * 200)}`,
      city,
      country,
      geo: { lat: Math.round((lat + (rnd() - 0.5) / 10) * 1e5) / 1e5, lng: Math.round((lng + (rnd() - 0.5) / 10) * 1e5) / 1e5 },
    },
    preferences: { locale: pick(LOCALES), theme: rnd() < 0.5 ? 'dark' : rnd() < 0.5 ? 'light' : null, newsletter: rnd() < 0.4 },
    orders,
    bio: rnd() < 0.15 ? `Building things 🚀 since ${2000 + Math.floor(rnd() * 20)}` : null,
  };
}

/** Big integers become bare JSON numbers (not strings), as many real APIs send them. */
const encode = (value, indent) => JSON.stringify(value, null, indent).replace(/"__BIG__(\d+)"/g, '$1');

/** The benchmark export at `target` bytes (minified size; the pretty file holds the same records). */
function bench(target, pretty, bare = false) {
  const rnd = mulberry32(20261015);
  const meta = (n) => ({ export: 'customers', generator: 'tk-large-json-bench v1', marker: 'TKLB-7F3A-MARKER', generated_at: '2026-10-15T00:00:00Z', record_count: n, schema_version: 3 });
  const recs = [];
  const wrapper = bare ? 2 : Buffer.byteLength(`{"meta":${encode(meta(9999999))},"data":[],"next_cursor":null}`);
  const probe = (id) => ({ ...makeRecord(id, mulberry32(42)), search_probe: 'TKLB-NEEDLE-LAST' });
  const probeBytes = bare ? 0 : Buffer.byteLength(encode(probe(9999999))) + 1;
  let bytes = 0;
  for (let i = 1; ; i++) {
    const rec = makeRecord(i, rnd);
    const len = Buffer.byteLength(encode(rec)) + 1;
    if (bytes + len + wrapper + probeBytes > target && recs.length) break;
    recs.push(rec);
    bytes += len;
  }
  if (bare) return encode(recs);
  recs.push(probe(recs.length + 1));
  return encode({ meta: meta(recs.length), data: recs, next_cursor: null }, pretty ? 2 : undefined);
}

// ── Hard text ────────────────────────────────────────────────────────────────────────────────────

export const EXOTIC = [
  '中文汉字', '日本語のテキスト', 'ｶﾀｶﾅ', '한국어 텍스트', 'العربية مرحبا بالعالم', 'עברית שלום', 'हिन्दी क्षत्रिय श्री',
  'தமிழ் உரை', 'ภาษาไทย ก้ำ', 'ქართული', 'Ελληνικά', 'Русский', 'é', 'ǟ', 'Z͓͑͒',
  '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇮🇳🇯🇵🇺🇸', '👍🏽', '🧑🏿‍🦽', '1️⃣', '©️', '\u200b', '\u200c', '\u200d', '\ufeff', '\u00a0', '\u2028',
  '\u2029', '\u3000', 'ＡＢＣ１２３', '𝓐𝓑𝓒', '𐍈𐌰', 'ﷺ', 'ﬁﬂ', 'Ω≈ç√∫', '\u202eRLO\u202c', '\u2066iso\u2069', '\u061c',
  '<script>', '&amp;', '{[(<>)]}', ':,;', '😀😃😄', '🫠', 'ก้ำ', 'ॐ', '\u180e', '\u2066\u2069',
];
/** Characters a JSON string can't hold raw. */
export const UNSAFE = /["\\\u0000-\u001f]/;
export const SAFE = EXOTIC.filter((s) => !UNSAFE.test(s));

function lcg(seed) {
  let s = seed >>> 0;
  return (n) => ((s = (s * 1103515245 + 12345) >>> 0), s % n);
}

/** An array of records full of hard text, about `chars` long. */
export function makeDoc(seed, chars, pretty) {
  const r = lcg(seed);
  const pick = () => EXOTIC[r(EXOTIC.length)];
  const recs = [];
  for (let i = 0, size = 2; size < chars; i++) {
    const rec = {
      id: i, name: `${pick()} ${i}`, note: Array.from({ length: 1 + r(4) }, pick).join(' '), tags: [pick(), pick()],
      esc: 'tab\there "quoted" back\\slash nl\nend \u0001', n: r(1e6) / 7, ok: r(2) === 0, x: null,
      deep: { a: [pick(), { b: pick() }] },
    };
    size += JSON.stringify(rec, null, pretty ? 2 : undefined).length + 1;
    recs.push(rec);
  }
  return JSON.stringify(recs, null, pretty ? 2 : undefined);
}

const MIX = {
  'small-mix': () => makeDoc(41, 60_000, true),
  'mid-mix': () => makeDoc(42, 180_000, false),
  'mix-one-line': () => makeDoc(1, 600_000, false),
  'mix-pretty': () => makeDoc(2, 600_000, true),
  'mix-3mb': () => makeDoc(3, 3_000_000, false),
  'crlf-bom': () => '\ufeff' + makeDoc(21, 400_000, true).replace(/\n/g, '\r\n'),
  lines: () => JSON.parse(makeDoc(22, 600_000, false)).map((x) => JSON.stringify(x)).join('\n') + '\n',
  deep: () => {
    let d = '';
    for (let i = 0; i < 400; i++) d += `{"k${i}":[${JSON.stringify(EXOTIC[i % EXOTIC.length])},`;
    d += '"bottom"' + ']}'.repeat(400);
    return JSON.stringify(Array.from({ length: 60 }, () => JSON.parse(d)));
  },
  broken: () => {
    const t = makeDoc(23, 600_000, false);
    return t.slice(0, 300_000) + ',,,' + t.slice(300_000, 590_000);
  },
  // A right-to-left override inside a key: the caret and selection must still map to the right text.
  'rlo-open': () => makeDoc(24, 600_000, false).replace('"id"', '"x\u202ey",id"'),
};

function rows(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ id: i, name: 'user ' + i, email: `u${i}@example.com`, tags: ['a', 'b'], profile: { city: 'London', score: i * 1.5 } });
  return JSON.stringify(a);
}

function deep(kind, n) {
  return kind === 'arrays' ? '['.repeat(n) + '1' + ']'.repeat(n) : '{"a":'.repeat(n) + '1' + '}'.repeat(n);
}
