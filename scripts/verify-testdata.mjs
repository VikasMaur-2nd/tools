// Node 24 type stripping imports the same generator the browser worker uses.
// Streams every published fixture through node:crypto without writing fixture files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateFixture } from '../lib/testdata/generate.ts';
import { PUBLISHED_FIXTURES } from '../lib/testdata/published.ts';

for (const fixture of PUBLISHED_FIXTURES) {
  const hash = createHash('sha256');
  let bytes = 0, maxChunkBytes = 0;
  const started = performance.now();
  const summary = await generateFixture(fixture, chunk => {
    hash.update(chunk);
    bytes += chunk.length;
    maxChunkBytes = Math.max(maxChunkBytes, chunk.length);
  });
  assert.deepEqual(summary, { bytes: fixture.bytes, records: fixture.records, sha256: fixture.sha256 }, fixture.key);
  assert.equal(bytes, fixture.bytes);
  assert.equal(hash.digest('hex'), fixture.sha256);
  console.log(JSON.stringify({ key: fixture.key, ...summary, match: true, maxChunkBytes, seconds: +(performance.now() - started).toFixed(3) / 1000 }));
}
