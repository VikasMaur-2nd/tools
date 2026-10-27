// Documents for the breaker suites, generated on first use into the harness cache and never committed.
// Every generator is seeded and streams to disk in chunks, so a 300 MB document never sits in Node's
// memory whole and is byte-identical on every machine. Bump VERSION when an output changes.
//
//   big-<shape>-<n>mb      memory/time shapes, n MB (1 MB = 1,000,000 bytes, within 0.1%):
//                            records  one-line array of customer-like records (strings, numbers, nesting)
//                            pretty   the same records indented by two spaces
//                            deep     records nested 60 levels deep, one after another
//                            strings  long strings full of escapes, emoji and non-Latin text
//                            numbers  one flat array of numbers (integers, decimals, exponents, big ints)
//   wide-keys-<n>k         one object with n thousand keys
//   flat-nums-<n>m         one array of n million small integers
//   one-string-<n>mb       a single JSON string of n MB (escapes and non-ASCII text)
//   one-text-<n>mb         a single JSON string of n MB of non-ASCII text without escapes (a two-byte string)
//   nest-<n>k              n thousand levels of [ ... ]
//   dupes-<n>k             one object whose n thousand keys are all "k"
//   lines-<n>k             n thousand JSON Lines records (.jsonl)
//   blob-<n>mb             random bytes (not text at all)
//   zeros-<n>mb            NUL bytes, one line (a disk image or a sparse file)
//   utf16-bom              a small JSON document saved as UTF-16 LE with a BOM
//   bad-utf8               JSON with invalid UTF-8 byte sequences inside strings
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from '../../lib/env.mjs';

const VERSION = 1;
const DIR = join(DIRS.fixtures, `breaker-v${VERSION}`);
mkdirSync(DIR, { recursive: true });

export const MB = 1_000_000;

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

/** Streams pieces from `make(write)` into `file` through a 4 MB buffer; returns the byte count. */
function stream(file, make) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  let parts = [];
  let pending = 0;
  let total = 0;
  const flush = () => {
    if (!parts.length) return;
    writeSync(fd, Buffer.from(parts.join('')));
    parts = [];
    pending = 0;
  };
  const write = (s) => {
    if (typeof s !== 'string') {
      flush();
      writeSync(fd, s);
      total += s.length;
      return;
    }
    parts.push(s);
    const n = Buffer.byteLength(s);
    total += n;
    pending += n;
    if (pending > 4_000_000) flush();
  };
  write.bytes = () => total;
  try {
    make(write);
    flush();
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file); // atomic: parallel runs never see half a file
  return total;
}

const WORDS = ['alpha', 'Zoë', 'Søren', 'Олег', '東京', 'القاهرة', 'naïve', 'café', 'emoji 🚀', 'tab\tsep', 'quote "q"', 'back\\slash', 'line\nbreak', '👨‍👩‍👧‍👦', 'ｶﾀｶﾅ', 'हिन्दी'];

function record(i, rnd, indent) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rec = {
    id: i,
    uuid: Math.floor(rnd() * 2 ** 32).toString(16).padStart(8, '0') + '-' + Math.floor(rnd() * 2 ** 32).toString(16).padStart(8, '0'),
    name: `${pick(WORDS)} ${i}`,
    active: rnd() < 0.7,
    score: Math.round(rnd() * 1e6) / 1e3,
    tags: [pick(WORDS), pick(WORDS)],
    address: { city: pick(WORDS), zip: String(10000 + Math.floor(rnd() * 89999)), geo: { lat: Math.round(rnd() * 18000) / 100 - 90, lng: Math.round(rnd() * 36000) / 100 - 180 } },
    orders: Array.from({ length: Math.floor(rnd() * 3) }, (_, k) => ({ n: k, total: Math.round(rnd() * 1e5) / 100, note: rnd() < 0.3 ? pick(WORDS) : null })),
  };
  // A bare integer above 2^53 in every record (no JS number holds it exactly).
  return JSON.stringify(rec, null, indent).replace(/("id": ?)(\d+)/, (_, k, n) => `${k}${n}`).replace(/(\n?\s*)\}$/, `,${indent ? '\n' + ' '.repeat(indent * 2) : ''}"big":${9007199254740993n + BigInt(i)}$1}`);
}

const DEEP = 60;
function deepRecord(i, rnd) {
  let s = '';
  for (let d = 0; d < DEEP; d++) s += `{"l${d}":${d % 2 ? '[' : ''}`;
  s += JSON.stringify({ id: i, v: Math.round(rnd() * 1e6) / 1e3, s: WORDS[i % WORDS.length] });
  for (let d = DEEP - 1; d >= 0; d--) s += (d % 2 ? ']' : '') + '}';
  return s;
}

function longString(i, rnd) {
  let s = '';
  while (s.length < 8000) s += WORDS[Math.floor(rnd() * WORDS.length)] + ' ';
  return JSON.stringify(`${i}: ${s}`);
}

function number(i, rnd) {
  const k = i % 5;
  if (k === 0) return String(i);
  if (k === 1) return (Math.round(rnd() * 1e9) / 1e4).toString();
  if (k === 2) return `${Math.floor(rnd() * 9) + 1}.${Math.floor(rnd() * 1e6)}e${Math.floor(rnd() * 40) - 20}`;
  if (k === 3) return `-${Math.floor(rnd() * 1e6)}`;
  return String(9007199254740993n + BigInt(i));
}

/** An array of items from `item(i, rnd)` up to `target` bytes. */
function arrayOf(write, target, item, sep = ',', open = '[', close = ']') {
  const rnd = mulberry32(20261026);
  write(open);
  for (let i = 0; ; i++) {
    const s = (i ? sep : '') + item(i, rnd);
    if (write.bytes() + Buffer.byteLength(s) + close.length > target && i) break;
    write(s);
  }
  write(close);
}

const GEN = {
  big(write, [shape, n]) {
    const target = Number(n) * MB;
    if (shape === 'records') arrayOf(write, target, (i, r) => record(i, r, 0));
    else if (shape === 'pretty') arrayOf(write, target, (i, r) => '  ' + record(i, r, 2).replace(/\n/g, '\n  '), ',\n', '[\n', '\n]');
    else if (shape === 'deep') arrayOf(write, target, deepRecord);
    else if (shape === 'strings') arrayOf(write, target, longString);
    else if (shape === 'numbers') arrayOf(write, target, number);
    else throw new Error(`unknown shape ${shape}`);
  },
  'wide-keys'(write, [n]) {
    write('{');
    for (let i = 0; i < Number(n) * 1000; i++) write(`${i ? ',' : ''}"key_${i}":${i}`);
    write('}');
  },
  'flat-nums'(write, [n]) {
    write('[');
    for (let i = 0; i < Number(n) * 1e6; i++) write(`${i ? ',' : ''}${i % 1000}`);
    write(']');
  },
  'one-string'(write, [n]) {
    const unit = 'abcdefghij ÄÖÜ 東京 \\n \\"q\\" 🚀 '; // escapes stay escaped in the file
    const len = Buffer.byteLength(unit);
    const count = Math.floor((Number(n) * MB - 2) / len);
    write('"');
    const block = unit.repeat(10_000);
    for (let i = 0; i < Math.floor(count / 10_000); i++) write(block);
    write(unit.repeat(count % 10_000));
    write('"');
  },
  'one-text'(write, [n]) {
    const unit = 'abcdefghij ÄÖÜ 東京 🚀 ';
    const count = Math.floor((Number(n) * MB - 2) / Buffer.byteLength(unit));
    write('"');
    const block = unit.repeat(10_000);
    for (let i = 0; i < Math.floor(count / 10_000); i++) write(block);
    write(unit.repeat(count % 10_000));
    write('"');
  },
  nest(write, [n]) {
    const k = Number(n) * 1000;
    write('['.repeat(k) + '1' + ']'.repeat(k));
  },
  dupes(write, [n]) {
    write('{');
    for (let i = 0; i < Number(n) * 1000; i++) write(`${i ? ',' : ''}"k":${i}`);
    write('}');
  },
  lines(write, [n]) {
    const rnd = mulberry32(7);
    for (let i = 0; i < Number(n) * 1000; i++) write(record(i, rnd, 0) + '\n');
  },
  blob(write, [n]) {
    const rnd = mulberry32(99);
    const total = Number(n) * MB;
    for (let at = 0; at < total; at += 1 << 20) {
      const b = Buffer.alloc(Math.min(1 << 20, total - at));
      for (let i = 0; i < b.length; i += 4) b.writeUInt32LE((rnd() * 2 ** 32) >>> 0, Math.min(i, b.length - 4));
      write(b);
    }
  },
  zeros(write, [n]) {
    const total = Number(n) * MB;
    const b = Buffer.alloc(1 << 20);
    for (let at = 0; at < total; at += b.length) write(b.subarray(0, Math.min(b.length, total - at)));
  },
  'utf16-bom'(write) {
    write(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"name":"Zoë","city":"東京","n":1}', 'utf16le')]));
  },
  'bad-utf8'(write) {
    write(Buffer.concat([Buffer.from('{"a":"x'), Buffer.from([0xc3, 0x28, 0xa0, 0xa1, 0xff, 0xfe, 0xed, 0xa0, 0x80]), Buffer.from('y","b":1}')]));
  },
};
const EXT = { lines: 'jsonl', blob: 'bin', zeros: 'img' };

/** Path of a breaker fixture, generated on first use. */
export function bigFixture(name) {
  const m = /^(big|wide-keys|flat-nums|one-string|one-text|nest|dupes|lines|blob|zeros|utf16-bom|bad-utf8)(?:-(.+))?$/.exec(name);
  if (!m) throw new Error(`unknown breaker fixture "${name}"`);
  const args = (m[2] || '').replace(/(mb|k|m)$/, '').split('-');
  const file = join(DIR, `${name}.${EXT[m[1]] || 'json'}`);
  if (!existsSync(file)) stream(file, (w) => GEN[m[1]](w, args));
  return file;
}
export const fixtureSize = (name) => statSync(bigFixture(name)).size;
