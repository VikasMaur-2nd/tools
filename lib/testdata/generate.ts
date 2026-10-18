import { Sha256 } from './sha256.ts';

const SEED = 20261015;

function mulberry32(seed: number) {
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
] as const;
const STREETS = ['Hauptstraße', 'Rua Augusta', 'ul. Floriańska', 'Main Street', 'Rue de Rivoli', 'Bahnhofstrasse', 'Laugavegur', 'İstiklal Caddesi'];
const TAGS = ['vip', 'beta', 'newsletter', 'churn-risk', 'b2b', 'early-adopter', 'support:priority', 'région-nord', '常連', 'test'];
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'refunded', 'cancelled'];
const CURRENCIES = ['EUR', 'USD', 'BRL', 'JPY', 'PLN', 'INR'];
const LOCALES = ['de-DE', 'pt-BR', 'pl-PL', 'ja-JP', 'ru-RU', 'en-US', 'fr-FR', 'tr-TR', 'ar-EG'];
const NOTES = [
  'Leave at the "back" door',
  'Call first\nGate code: 4521',
  'Fragile ✓ — handle with care',
  'Path C:\\orders\\archive',
  'Gift 🎁 for Zoë',
  'Rückruf erbeten',
  '配達前に電話してください',
  'Tab\tseparated\tnote',
];
const BIGINT_BASE = 9007199254740993n; // 2^53 + 1: cannot be represented exactly as a JS number

function makeRecord(i: number, rnd: () => number) {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  const first = pick(FIRST);
  const last = pick(LAST);
  const [city, country, lat, lng] = pick(CITIES);
  const created = new Date(Date.UTC(2019, 0, 1) + Math.floor(rnd() * 2200 * 86400) * 1000 + Math.floor(rnd() * 86400) * 1000);
  const orderCount = Math.floor(rnd() * 4);
  const orders = [];
  for (let o = 0; o < orderCount; o++) {
    const itemCount = 1 + Math.floor(rnd() * 3);
    const items = [];
    let total = 0;
    for (let k = 0; k < itemCount; k++) {
      const qty = 1 + Math.floor(rnd() * 5);
      const price = Math.round(rnd() * 20000) / 100;
      total += qty * price;
      items.push({ sku: `SKU-${hex(6).toUpperCase()}`, qty, price, discount: rnd() < 0.2 ? Math.round(rnd() * 30) / 100 : null });
    }
    orders.push({
      order_id: `ORD-${i}-${o + 1}`,
      status: pick(STATUSES),
      currency: pick(CURRENCIES),
      total: Math.round(total * 100) / 100,
      items,
      note: rnd() < 0.35 ? pick(NOTES) : null,
    });
  }
  const tagCount = Math.floor(rnd() * 4);
  const tags = [];
  for (let t = 0; t < tagCount; t++) tags.push(pick(TAGS));
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

// Big integers are emitted as bare JSON numbers (not strings), as many real APIs do.
const encode = (value: unknown) => JSON.stringify(value).replace(/"__BIG__(\d+)"/g, '$1');

export type FixtureOptions = { targetBytes: number; pretty?: boolean };
export type FixtureSummary = { bytes: number; records: number; sha256: string };
export type FixtureProgress = { phase: 'counting' | 'writing'; fraction: number };

const meta = (n: number) => encode({ export: 'customers', generator: 'tk-large-json-bench v1', marker: 'TKLB-7F3A-MARKER', generated_at: '2026-10-15T00:00:00Z', record_count: n, schema_version: 3 });
const probe = (id: number) => encode({ ...makeRecord(id, mulberry32(42)), search_probe: 'TKLB-NEEDLE-LAST' });

/** Source-only indentation of minified JSON. State survives fragment boundaries, even inside strings. */
export function sourceIndenter() {
  let depth = 0, quoted = false, escaped = false, opened = false;
  return (src: string) => {
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      const close = c === '}' || c === ']';
      if (opened) {
        parts.push(src.slice(start, i));
        if (!close) parts.push('\n', '  '.repeat(depth));
        opened = false;
        start = i;
        if (close) { depth--; continue; }
      }
      if (c === '"') quoted = true;
      else if (c === '{' || c === '[') { depth++; opened = true; }
      else if (close) {
        parts.push(src.slice(start, i), '\n', '  '.repeat(--depth), c);
        start = i + 1;
      } else if (c === ',' || c === ':') {
        parts.push(src.slice(start, i + 1), c === ':' ? ' ' : '\n' + '  '.repeat(depth));
        start = i + 1;
      }
    }
    parts.push(src.slice(start));
    return parts.join('');
  };
}

/**
 * The study's exact conservative fit algorithm, in two bounded-memory passes.
 * The sink is awaited for backpressure. Retain chunks only when making a Blob.
 * Node 24 can import this module directly with TypeScript type stripping.
 */
export async function generateFixture(
  options: FixtureOptions,
  write: (chunk: Uint8Array<ArrayBuffer>) => void | Promise<void>,
  progress?: (value: FixtureProgress) => void,
): Promise<FixtureSummary> {
  const { targetBytes, pretty = false } = options;
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 1000 || targetBytes > 1_000_000_000) {
    throw new Error('Choose a whole byte size between 1 KB and 1 GB.');
  }
  const encoder = new TextEncoder();
  const reserved = encoder.encode(`{"meta":${meta(9999999)},"data":[],"next_cursor":null}`).length + encoder.encode(probe(9999999)).length + 1;
  let rnd = mulberry32(SEED), sourceBytes = 0, records = 1;
  progress?.({ phase: 'counting', fraction: 0 });
  for (let i = 1; ; i++) {
    const length = encoder.encode(encode(makeRecord(i, rnd))).length + 1;
    if (sourceBytes + length + reserved > targetBytes) break;
    sourceBytes += length;
    records++;
    if ((i & 255) === 0) progress?.({ phase: 'counting', fraction: Math.min(1, sourceBytes / targetBytes) });
  }
  rnd = mulberry32(SEED);
  const indent = pretty ? sourceIndenter() : (src: string) => src;
  const hash = new Sha256();
  let pending = '', bytes = 0;
  const flush = async () => {
    if (!pending) return;
    const chunk = encoder.encode(pending);
    pending = '';
    bytes += chunk.length;
    hash.update(chunk);
    await write(chunk);
  };
  pending += indent(`{"meta":${meta(records)},"data":[`);
  for (let i = 1; i <= records; i++) {
    pending += indent((i > 1 ? ',' : '') + (i === records ? probe(i) : encode(makeRecord(i, rnd))));
    if (pending.length >= 65536) {
      await flush();
      progress?.({ phase: 'writing', fraction: i / records });
    }
  }
  pending += indent('],"next_cursor":null}');
  await flush();
  progress?.({ phase: 'writing', fraction: 1 });
  return { bytes, records, sha256: hash.digest() };
}
