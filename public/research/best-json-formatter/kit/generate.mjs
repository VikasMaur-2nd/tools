// Speed-test files (protocol section 4): realistic API-style records, minified on one line, exactly the requested
// number of bytes, from a fixed seed. Anyone running this gets the same bytes; fixtures.sha256.json lists them.
//
//   node generate.mjs                       writes fixtures/100kb.json … 50mb.json and checks them against the list
//   node generate.mjs --sizes 1mb,10mb      only these
//   node generate.mjs --manifest            rewrites fixtures.sha256.json (only when the generator changes)
//
// The files round-trip exactly through JSON.parse + JSON.stringify (every number is printed the way JavaScript
// prints it, every string escaped the way JSON.stringify escapes it, no empty objects or arrays), so a correct
// formatter's output, minified again, gives back the file byte for byte. Each file holds the privacy marker
// (MARKER) near its start and END_MARKER in its last record.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const SIZES = { '100kb': 100_000, '1mb': 1_000_000, '10mb': 10_000_000, '50mb': 50_000_000 };
export const SEED = 20261101;
export const MARKER = 'FMTSTUDY-7Q4K2-CANARY';
export const END_MARKER = 'FMTSTUDY-END-OF-DOCUMENT';

/** mulberry32: small, fast, and identical in every JavaScript engine. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = 'alpha bravo cedar delta ember fjord grove harbor island jasper kettle lumen maple nectar orbit pixel quartz river summit timber umber velvet willow xenon yonder zephyr amber birch canyon dune'.split(' ');
const INTL = ['café', 'Zürich', 'São Paulo', 'Kraków', '東京', '서울', 'Москва', 'مرحبا', 'שלום', 'नमस्ते', 'naïve', 'Ελλάδα', '🚀', '✅', '👩‍💻', 'ﬁ', 'é'];
const CITIES = ['Austin', 'Berlin', 'Chennai', 'Dublin', 'Lagos', 'Lima', 'Osaka', 'Oslo', 'Perth', 'Quito', 'Seoul', 'Tunis', 'Zürich', 'München', 'Kraków', 'São Paulo'];
const COUNTRIES = ['US', 'DE', 'IN', 'IE', 'NG', 'PE', 'JP', 'NO', 'AU', 'EC', 'KR', 'TN', 'CH', 'PL', 'BR'];
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'refunded'];

export function generate(bytes, seed = SEED) {
  const r = rng(seed ^ bytes);
  const int = (n) => Math.floor(r() * n);
  const pick = (a) => a[int(a.length)];
  const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const money = () => Math.round(r() * 100000) / 100;
  const sentence = () => {
    let s = words(3 + int(8));
    if (r() < 0.35) s += ' ' + pick(INTL);
    if (r() < 0.15) s += ' "quoted"';
    if (r() < 0.1) s += '\nsecond line\tafter a tab';
    if (r() < 0.05) s += ' back\\slash';
    return s;
  };
  const record = (i) => ({
    id: 100000 + i,
    uuid: Array.from({ length: 4 }, () => int(0x100000000).toString(16).padStart(8, '0')).join('-'),
    name: `${pick(WORDS)} ${pick(WORDS)}`.replace(/\b\w/g, (c) => c.toUpperCase()),
    email: `${pick(WORDS)}.${int(9999)}@example.com`,
    active: r() < 0.7,
    score: Math.round(r() * 10000) / 100,
    balance: Math.round((r() - 0.3) * 1e7) / 100,
    ratio: r() < 0.1 ? Number((r() * 1e-6).toPrecision(3)) : Number(r().toPrecision(6)),
    tags: Array.from({ length: 1 + int(4) }, () => pick(WORDS)),
    address: {
      street: `${1 + int(9999)} ${pick(WORDS)} street`,
      city: pick(CITIES),
      country: pick(COUNTRIES),
      geo: { lat: Number(((r() - 0.5) * 180).toFixed(6)), lng: Number(((r() - 0.5) * 360).toFixed(6)) },
    },
    orders: Array.from({ length: 1 + int(3) }, (_, k) => ({
      sku: `SKU-${int(1e6).toString().padStart(6, '0')}`,
      qty: 1 + int(9),
      price: money(),
      status: pick(STATUSES),
      shippedAt: r() < 0.5 ? null : new Date(Date.UTC(2026, int(12), 1 + int(28), int(24), int(60))).toISOString(),
      line: k + 1,
    })),
    bio: sentence(),
    createdAt: new Date(Date.UTC(2020 + int(7), int(12), 1 + int(28))).toISOString(),
  });

  // {"meta":{…},"data":[r0,r1,…],"summary":{"records":n,"comment":"…"}}: the comment's words are sized so the whole
  // file is exactly `bytes` long.
  const enc = (s) => Buffer.byteLength(s);
  const head = `{"meta":${JSON.stringify({ generator: 'best-json-formatter study', seed, bytes, marker: MARKER })},"data":[`;
  const tail = (n, comment) => `],"summary":${JSON.stringify({ records: n, comment })}}`;
  const parts = [];
  let size = enc(head);
  for (let i = 0; ; i++) {
    const rec = JSON.stringify(record(i));
    const add = enc(rec) + (parts.length ? 1 : 0);
    if (size + add > bytes - 2500) break; // room for the last record (with its note) and the summary
    parts.push(rec);
    size += add;
  }
  const last = JSON.stringify({ ...record(parts.length), note: END_MARKER });
  parts.push(last);
  size += enc(last) + 1;
  const room = bytes - size - enc(tail(parts.length, ''));
  if (room < 0) throw new Error(`overshot by ${-room} bytes`);
  let comment = '';
  while (comment.length < room) comment += (comment ? ' ' : '') + pick(WORDS);
  comment = comment.slice(0, room).trimEnd().padEnd(room, '.');
  const text = head + parts.join(',') + tail(parts.length, comment);
  if (enc(text) !== bytes) throw new Error(`size ${enc(text)} != ${bytes}`);
  return text;
}

/** Lines when pretty-printed one value per line (any indentation): a tool's complete output has this many. */
export function prettyLines(text) {
  return JSON.stringify(JSON.parse(text), null, 1).split('\n').length;
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: { sizes: { type: 'string' }, out: { type: 'string', default: 'fixtures' }, manifest: { type: 'boolean' } } });
  const here = new URL('.', import.meta.url);
  const names = o.sizes ? o.sizes.split(',') : Object.keys(SIZES);
  const manifestUrl = new URL('fixtures.sha256.json', here);
  const known = o.manifest ? {} : JSON.parse(readFileSync(manifestUrl, 'utf8'));
  mkdirSync(o.out, { recursive: true });
  let bad = 0;
  for (const name of names) {
    const text = generate(SIZES[name]);
    if (JSON.stringify(JSON.parse(text)) !== text) throw new Error(`${name} does not round-trip`);
    const entry = { bytes: SIZES[name], sha256: sha256(text), prettyLines: prettyLines(text) };
    writeFileSync(join(o.out, `${name}.json`), text);
    const ok = o.manifest || (known[name]?.sha256 === entry.sha256 && known[name]?.prettyLines === entry.prettyLines);
    if (!ok) bad++;
    console.log(`${name.padEnd(6)} ${entry.bytes.toLocaleString('en-US').padStart(11)} bytes  ${entry.prettyLines.toLocaleString('en-US').padStart(10)} lines  sha256 ${entry.sha256}  ${o.manifest ? '' : ok ? 'matches' : 'DIFFERS'}`);
    known[name] = entry;
  }
  if (o.manifest) writeFileSync(manifestUrl, JSON.stringify(known, null, 2) + '\n');
  if (bad) {
    console.error(`${bad} file(s) differ from fixtures.sha256.json`);
    process.exit(1);
  }
}
