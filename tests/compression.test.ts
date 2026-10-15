import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { codecs, compressedSize, compressedSizes, fromBase64Url, toBase64Url } from '../lib/engine/sizes';

test('share links made before compression was deferred still decode losslessly', async () => {
  const text = '{"hello":"日本語 👋","n":9007199254740993}';
  const link = 'q1bKSM3JyVeyUno2femzOWterJqn8GH-xG4lHaU8JStLAwNzQ0tLI1MTcxMDS0vjWgA';
  assert.equal(await fromBase64Url(link), text);
  const large = text.repeat(10_000);
  const encoded = await toBase64Url(large);
  assert.match(encoded, /^[\w-]+$/);
  assert.equal(await fromBase64Url(encoded), large);
  await assert.rejects(fromBase64Url('invalid!'));
});

test('deferred size measurements retain the native gzip byte count', async () => {
  const text = '{"hello":"日本語 👋"}\n'.repeat(1_000);
  assert.ok(codecs().some(([codec]) => codec === 'gzip'));
  assert.equal(await compressedSize(new Blob([text]), 'gzip'), gzipSync(text).length);
  assert.equal((await compressedSizes(new Blob([text]), () => true)).gzip, gzipSync(text).length);
  assert.deepEqual(await compressedSizes(new Blob([text]), () => false), {});
});
