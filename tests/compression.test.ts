import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { codecs, compressedSize, compressedSizes } from '../lib/engine/sizes';

test('deferred size measurements retain the native gzip byte count', async () => {
  const text = '{"hello":"日本語 👋"}\n'.repeat(1_000);
  assert.ok(codecs().some(([codec]) => codec === 'gzip'));
  assert.equal(await compressedSize(new Blob([text]), 'gzip'), gzipSync(text).length);
  assert.equal((await compressedSizes(new Blob([text]), () => true)).gzip, gzipSync(text).length);
  assert.deepEqual(await compressedSizes(new Blob([text]), () => false), {});
});
