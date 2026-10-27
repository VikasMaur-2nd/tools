import test from 'node:test';
import assert from 'node:assert/strict';
import { asciiText, geckoForTests, readText } from '../lib/json/text';

const bytesText = (bytes: Uint8Array) => readText(new Blob([bytes as BlobPart]));

const enc = (s: string) => new TextEncoder().encode(s);
const utf16 = (s: string, le: boolean) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = le ? 0xff : 0xfe;
  out[1] = le ? 0xfe : 0xff;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + 2 * i + (le ? 0 : 1)] = c & 0xff;
    out[2 + 2 * i + (le ? 1 : 0)] = c >> 8;
  }
  return out;
};

test('file bytes decode the same in every browser: UTF-8 (BOM dropped), UTF-16 by its BOM, bad bytes as U+FFFD', async () => {
  const doc = '{"name":"Zoë","city":"東京","n":1,"e":"😀"}';
  assert.equal(await bytesText(enc(doc)), doc);
  assert.equal(await bytesText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(doc)])), doc);
  assert.equal(await bytesText(utf16(doc, true)), doc);
  assert.equal(await bytesText(utf16(doc, false)), doc);
  assert.equal(await bytesText(new Uint8Array([0x7b, 0xff, 0x7d])), '{�}');
  assert.equal(await bytesText(new Uint8Array(0)), '');
  const big = 'x'.repeat(100_003);
  assert.equal(await bytesText(enc(big)), big);
});

test('asciiText gives the same text from bytes and UTF-16 units', () => {
  const s = Array.from({ length: 70_000 }, (_, i) => String.fromCharCode(32 + (i % 95))).join('');
  const u16 = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
  assert.equal(asciiText(u16), s);
  assert.equal(asciiText(enc(s)), s);
  assert.equal(asciiText(new Uint16Array(0)), '');
});

for (const gecko of [false, true]) test(`readText decodes a stream in chunks: characters and byte order marks split across chunks${gecko ? " (Firefox's way)" : ''}`, async () => {
  geckoForTests(gecko);
  // ASCII runs long enough for whole ASCII chunks between the others, and a U+FEFF inside the text.
  const doc = ('{"name":"Zoë","city":"東京","e":"😀"}' + 'x'.repeat(130) + '\ufeff').repeat(50);
  const chunked = (bytes: Uint8Array, size: number) => new Response(new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
      c.close();
    },
  }));
  for (const size of [1, 2, 3, 5, 64, 100_000]) {
    assert.equal(await readText(chunked(enc(doc), size)), doc, `utf-8 ${size}`);
    assert.equal(await readText(chunked(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(doc)]), size)), doc, `utf-8 BOM ${size}`);
    assert.equal(await readText(chunked(utf16(doc, true), size)), doc, `utf-16le ${size}`);
    assert.equal(await readText(chunked(utf16(doc, false), size)), doc, `utf-16be ${size}`);
    assert.equal(await readText(chunked(new Uint8Array([0x7b, 0xe6, 0x9d, 0x7d]), size)), '{�}', `cut character ${size}`);
  }
  assert.equal(await readText(new Blob([enc(doc)])), doc);
  assert.equal(await readText(new Blob([])), '');
  geckoForTests(false);
});
