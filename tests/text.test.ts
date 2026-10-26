import test from 'node:test';
import assert from 'node:assert/strict';
import { asciiText, bytesText } from '../lib/json/text';

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

test('file bytes decode the same in every browser: UTF-8 (BOM dropped), UTF-16 by its BOM, bad bytes as U+FFFD', () => {
  const doc = '{"name":"Zoë","city":"東京","n":1,"e":"😀"}';
  assert.equal(bytesText(enc(doc)), doc);
  assert.equal(bytesText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(doc)])), doc);
  assert.equal(bytesText(utf16(doc, true)), doc);
  assert.equal(bytesText(utf16(doc, false)), doc);
  assert.equal(bytesText(new Uint8Array([0x7b, 0xff, 0x7d])), '{�}');
  assert.equal(bytesText(new Uint8Array(0)), '');
  const big = 'x'.repeat(100_003);
  assert.equal(bytesText(enc(big)), big);
});

test('asciiText gives the same text from bytes and UTF-16 units', () => {
  const s = Array.from({ length: 70_000 }, (_, i) => String.fromCharCode(32 + (i % 95))).join('');
  const u16 = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
  assert.equal(asciiText(u16), s);
  assert.equal(asciiText(enc(s)), s);
  assert.equal(asciiText(new Uint16Array(0)), '');
});
