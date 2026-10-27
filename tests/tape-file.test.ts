import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lf } from '../lib/engine/doc';
import { readText } from '../lib/json/read';
import { fileReading } from '../lib/json/tape-file';
import { parse } from '../lib/json/tape-parser';
import { wasmTape } from '../lib/json/tape-wasm';
import { rng, genLoose } from './oracle/compare';
import { diffTape, genStrict } from './oracle/tape';

// The analysis worker reads a loaded file once (tape-file.ts): each block goes to WebAssembly as it is decoded
// into the text. The text must be readText's exactly (the page's), and the tape the one of that text.
const mod = new WebAssembly.Module(readFileSync(join(__dirname, '..', '..', 'lib', 'json', 'tape.wasm')));
const SEED = Number(process.env.FUZZ_SEED) || 0;
const enc = new TextEncoder();

/** Reads of `bytes` as FileReaderSync would give them, logging each read's length. */
const reader = (bytes: Uint8Array, reads: number[]) => (at: number, len: number) => {
  reads.push(len);
  return bytes.slice(at, at + len);
};

/** `bounded`: no read longer than a block (the documents have no token longer than a window). */
async function check(bytes: Uint8Array<ArrayBuffer>, block: number, window: number, label: string, bounded = true) {
  const want = await readText(new Blob([bytes]));
  const reads: number[] = [];
  const r = fileReading(bytes.length, reader(bytes, reads), block);
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (utf16) {
    assert.equal(r, null, `${label}: UTF-16 is read from its text`);
    return;
  }
  assert.ok(r, label);
  const text = lf(want);
  let made = 0;
  const tape = wasmTape(mod, () => (made++, lf(r.text())), {}, r.bytes, window);
  assert.equal(r.text(), want, `${label}: readText's text`);
  const js = parse(text);
  const strict = js.count > 0 && !js.head.issues.length && !js.head.error && !js.head.multi;
  if (!strict) assert.equal(tape, null, `${label}: not strict JSON`);
  else if (tape) assert.equal(diffTape(js, tape, text), null, label);
  else {
    // (From bytes, what isn't valid UTF-8 is refused: the JS parser parses its text, U+FFFD and all.)
    let valid = true;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      valid = false;
    }
    assert.ok(!valid, `${label}: strict JSON refused`);
  }
  if (tape) assert.equal(made, 1, 'the text made once');
  // Never the whole file at once: a block at a time, or a window when one is bigger.
  if (bounded) assert.ok(reads.every((n) => n <= Math.max(block, window * 4)), `${label}: reads ${Math.max(...reads)}`);
}

test('a file read once, block by block: readText\'s text and the tape of it, every block and window size', async () => {
  const r = rng((SEED || 1) + 61);
  const ENDS = ['\n', '\r\n', '\r'];
  for (let it = 0; it < 400; it++) {
    let doc = it % 3 === 0 ? genLoose(r, 4) : JSON.stringify(JSON.parse(genStrict(r, 4)), null, r.pick([0, 2]));
    if (it % 4 === 1) doc = doc.replace(/\n/g, () => r.pick(ENDS));
    if (it % 5 === 0) doc = doc.replace(/"([a-z])/g, '"é東😀$1');
    let bytes = enc.encode(doc);
    if (it % 7 === 0) bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    if (it % 11 === 0) bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...bytes]);
    if (it % 13 === 0 && bytes.length > 4) bytes[r.int(bytes.length)] = 0xff;
    for (const [block, window] of [[3, 64], [7, 64], [64, 100], [257, 64], [1 << 20, 257]]) await check(bytes, block, window, `iteration ${it}, block ${block}, window ${window}`);
  }
});

test('UTF-16 files, empty ones, and tokens longer than a block', async () => {
  const doc = '{"a": ["é東😀", 1, true]}';
  const le = new Uint8Array(2 + doc.length * 2);
  le.set([0xff, 0xfe]);
  for (let i = 0; i < doc.length; i++) [le[2 + 2 * i], le[3 + 2 * i]] = [doc.charCodeAt(i) & 0xff, doc.charCodeAt(i) >> 8];
  await check(le, 64, 64, 'UTF-16 LE');
  await check(new Uint8Array(0), 64, 64, 'empty');
  await check(new Uint8Array([0xef, 0xbb, 0xbf]), 64, 64, 'only a byte order mark');
  const long = '{"a": "' + 'x'.repeat(5000) + 'é'.repeat(3000) + '", "b": [' + '1,'.repeat(2000) + '2]}';
  for (const block of [16, 100, 4096]) await check(enc.encode(long), block, 64, `long token, block ${block}`, false);
});
