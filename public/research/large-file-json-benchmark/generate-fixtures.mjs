#!/usr/bin/env node
// Deterministic generator for the large-JSON benchmark fixtures.
// Usage: node generate-fixtures.mjs <outDir>
// Writes bench-1mb.json, bench-10mb.json, bench-50mb.json (minified, UTF-8, no BOM)
// and prints their byte size, record count and SHA-256. Same output on every run and machine.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] || '.';
mkdirSync(outDir, { recursive: true });

// Sizes are decimal megabytes; each file is the largest whole number of records that fits.
const ORIGINAL_TARGETS = [['bench-tiny.json', 4_000], ['bench-1mb.json', 1_000_000], ['bench-10mb.json', 10_000_000], ['bench-50mb.json', 50_000_000]];
const TARGETS = process.argv[3] ? process.argv[3].split(',').map(n=>[`bench-${n}mb.json`,Number(n)*1_000_000]) : ORIGINAL_TARGETS;
const SEED = 20261015;

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

function makeRecord(i, rnd) {
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const hex = n => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
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
const encode = value => JSON.stringify(value).replace(/"__BIG__(\d+)"/g, '$1');

for (const [file, target] of TARGETS) {
  const rnd = mulberry32(SEED); // same record stream for every size: smaller files are prefixes of larger ones
  const meta = n => encode({ export: 'customers', generator: 'tk-large-json-bench v1', marker: 'TKLB-7F3A-MARKER', generated_at: '2026-10-15T00:00:00Z', record_count: n, schema_version: 3 });
  // Reserve room for the wrapper and the final probe record, then add records while they fit.
  const parts = [];
  let bytes = 0;
  const wrapperBytes = Buffer.byteLength(`{"meta":${meta(9999999)},"data":[],"next_cursor":null}`);
  const probe = id => encode({ ...makeRecord(id, mulberry32(42)), search_probe: 'TKLB-NEEDLE-LAST' });
  const probeBytes = Buffer.byteLength(probe(9999999)) + 1;
  for (let i = 1; ; i++) {
    const rec = encode(makeRecord(i, rnd));
    const len = Buffer.byteLength(rec) + 1;
    if (bytes + len + wrapperBytes + probeBytes > target) break;
    parts.push(rec);
    bytes += len;
  }
  parts.push(probe(parts.length + 1));
  const text = `{"meta":${meta(parts.length)},"data":[${parts.join(',')}],"next_cursor":null}`;
  JSON.parse(text); // must be valid JSON
  writeFileSync(join(outDir, file), text);
  const sha256 = createHash('sha256').update(text).digest('hex');
  console.log(JSON.stringify({ file, bytes: Buffer.byteLength(text), records: parts.length, sha256 }));
}
