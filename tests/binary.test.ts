import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksBinary } from '../lib/engine/asks';

const utf8 = (bytes: Uint8Array | number[]) => new TextDecoder().decode(Uint8Array.from(bytes));
const hex = (h: string) => utf8(Buffer.from(h, 'hex'));
let seed = 3;
const random = (n: number) => Array.from({ length: n }, () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed >>> 24));

test('binary files are told apart from text', () => {
  // Headers of an ELF, a PNG, a zip, an MP4 and a gzip file, then compressed-looking bytes.
  for (const h of ['7f454c46020101000000000000000000', '89504e470d0a1a0a0000000d49484452', '504b0304140000000000', '0000002066747970', '1f8b0800000000000003']) {
    assert.ok(looksBinary(hex(h) + utf8(random(4000))), h);
  }
  // Random bytes with no NUL in the first 64K still read as mostly U+FFFD and control characters.
  const noNul = random(70_000).map((b) => b || 1);
  assert.ok(looksBinary(utf8(noNul)));
  // A PDF: a text header, then binary streams.
  assert.ok(looksBinary('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Length 4000 /Filter /FlateDecode >>\nstream\n' + utf8(random(4000).map((b) => b || 1))));
});

test('text, odd as it may be, is not binary', () => {
  for (const s of ['', '{"a":1}', ' \n\t ', '{"name":"Zoë","city":"東京","e":"🚀"}', 'a,b\n1,2\n', '﻿{"a":1}', '{"a":1}\u0000\u0000\u0000', 'x\fy']) assert.equal(looksBinary(s), false, JSON.stringify(s));
  // A few undecodable bytes in strings (a file saved as Latin-1, say) and a stray control character.
  const latin1 = '[' + Array.from({ length: 500 }, (_, i) => `{"id":${i},"name":"Fran�ois","note":"caf�"}`).join(',') + ']';
  assert.equal(looksBinary(latin1), false);
  assert.equal(looksBinary('{"a":"b\u0001"}'), false);
});

test('a NUL inside the text is binary; NUL padding at its end is not', () => {
  assert.equal(looksBinary('{"a":\u00001}'), true);
  assert.equal(looksBinary('{"a":1}' + '\u0000'.repeat(4096)), false);
});
