import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateFixture, sourceIndenter } from '../lib/testdata/generate';
import { Sha256 } from '../lib/testdata/sha256';
import { PUBLISHED_FIXTURES } from '../lib/testdata/published';
import { FIDELITY, FIDELITY_MINIFIED } from '../lib/testdata/reference';
import { checkPrecision } from '../lib/testdata/precision';
import { reindent } from '../lib/json/format';

test('incremental SHA-256 matches node:crypto across padding and chunk boundaries', () => {
  for (const length of [0, 1, 2, 55, 56, 63, 64, 65, 127, 128, 129, 1000, 65535, 65536, 65537, 3_000_123]) {
    const input = randomBytes(length);
    const expected = createHash('sha256').update(input).digest('hex');
    for (const step of [1, 55, 64, 65, 8191, 65536]) {
      if (length > 100_000 && step < 64) continue;
      const sha = new Sha256();
      for (let i = 0; i < length; i += step) sha.update(input.subarray(i, i + step));
      assert.equal(sha.digest(), expected, `${length} bytes, chunks of ${step}`);
      assert.equal(sha.digest(), expected);
      assert.throws(() => sha.update(new Uint8Array(0)));
    }
  }
});

for (const fixture of PUBLISHED_FIXTURES.filter(f => f.targetBytes <= 1_000_000)) {
  test(`generator matches published ${fixture.key} bytes, records and SHA-256`, async () => {
    const chunks: Uint8Array[] = [];
    const summary = await generateFixture(fixture, chunk => { chunks.push(chunk); });
    assert.deepEqual(summary, { bytes: fixture.bytes, records: fixture.records, sha256: fixture.sha256 });
    const text = Buffer.concat(chunks).toString('utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), fixture.sha256);
    assert.equal(JSON.parse(text).data.length, fixture.records);
    assert.equal(JSON.parse(text).data.at(-1).search_probe, 'TKLB-NEEDLE-LAST');
    if (!fixture.pretty) {
      const indent = sourceIndenter();
      assert.equal(indent(text), reindent(text, '  '));
    }
  });
}

test('source indentation keeps string escapes, duplicate members and numeric literals', () => {
  const src = '{"a":1.0,"a":1e400,"s":"\\u00e9\\/\\\\\\\"","empty":[],"o":{}}';
  const expected = '{\n  "a": 1.0,\n  "a": 1e400,\n  "s": "\\u00e9\\/\\\\\\\"",\n  "empty": [],\n  "o": {}\n}';
  const indent = sourceIndenter();
  assert.equal(Array.from(src, c => indent(c)).join(''), expected);
});

test('custom generation uses the same fit algorithm and bounded chunks', async () => {
  let max = 0, bytes = 0;
  const summary = await generateFixture({ targetBytes: 123_456 }, chunk => { max = Math.max(max, chunk.length); bytes += chunk.length; });
  assert.equal(summary.bytes, bytes);
  assert.ok(bytes <= 123_456);
  assert.ok(max < 100_000);
  const minimum = await generateFixture({ targetBytes: 1000 }, () => {});
  assert.equal(minimum.records, 1);
  assert.ok(minimum.bytes > 1000);
  await assert.rejects(generateFixture({ targetBytes: NaN }, () => {}));
});

test('study reference documents retain their exact bytes', () => {
  for (const [file, text] of [['fidelity.json', FIDELITY], ['fidelity-minified.json', FIDELITY_MINIFIED]]) {
    assert.equal(readFileSync(`tests/fixtures/testdata/${file}`, 'utf8'), text);
  }
  assert.equal(Buffer.byteLength(FIDELITY), 425);
});

test('precision checker separates all seven study value losses from spelling and duplicates', () => {
  const result = checkPrecision(FIDELITY, JSON.stringify(JSON.parse(FIDELITY)));
  assert.equal(result.valid, true);
  assert.deepEqual(result.differences.filter(d => d.kind === 'changed value').map(d => d.path), [
    '$.v_unsafe_odd', '$.v_above_safe', '$.v_id19', '$.v_negative', '$.v_long_decimal', '$.v_money', '$.v_overflow',
  ]);
  assert.equal(result.differences.filter(d => d.kind === 'same value, different spelling').length, 5);
  assert.equal(result.differences.filter(d => d.kind === 'duplicate members').length, 1);
  assert.equal(result.differences.filter(d => d.kind === 'missing path').length, 1);
  assert.deepEqual(checkPrecision(FIDELITY, FIDELITY_MINIFIED).differences, []);
});

test('precision handles exact decimal values, huge exponents, paths, strings and reordered keys', () => {
  assert.equal(checkPrecision('[1.0,1.50,1e2,-0,1e999999999999999999999]', '[1,1.5,100,0,10e999999999999999999998]').differences.every(d => d.kind === 'same value, different spelling'), true);
  assert.deepEqual(checkPrecision('{"b":2,"a":1}', '{"a":1,"b":2}').differences, []);
  const result = checkPrecision('{"s":"é","a":[1,2],"gone":true}', '{"s":"e","a":[1],"new":false}');
  assert.deepEqual(result.differences.map(d => d.kind), ['string changed', 'missing path', 'missing path', 'extra path']);
  assert.equal(checkPrecision('{"a":1,"a":2}', '{"a":1,"a":3}').differences[0].kind, 'changed value');
  for (const retained of [1, 2]) {
    const collapsed = checkPrecision('{"a":1,"a":2}', `{"a":${retained}}`);
    assert.deepEqual(collapsed.differences.map(d => d.kind), ['duplicate members', 'missing path']);
  }
  assert.deepEqual(checkPrecision('{"a":1}', '{"a":1,"a":2}').differences.map(d => d.kind), ['duplicate members', 'extra path']);
});

test('precision rejects invalid JSON and JS display forms explicitly', () => {
  for (const text of ['{a:1}', '{"a":Infinity}', '{"a":NaN}', '{"a":1,}', '{', '', '1\n2']) {
    const result = checkPrecision('{"a":1}', text);
    assert.equal(result.valid, false, text);
    assert.match(result.error!, /not valid JSON/);
  }
  assert.match(checkPrecision('{', '{}').error!, /Original/);
});

test('precision pairs deeply nested duplicate values without re-escaping their contents', () => {
  const nested = '{"x":'.repeat(80) + '1' + '}'.repeat(80);
  const result = checkPrecision(`{"a":${nested},"a":2}`, `{"a":${nested}}`);
  assert.deepEqual(result.differences.map(d => d.kind), ['duplicate members', 'missing path']);
});
