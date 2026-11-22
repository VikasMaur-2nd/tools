import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateImport, type Place } from '../lib/convert/import';
import { PLACES_WORKER_MIN, locateSource, placeKey, placeOf, type PlacesHost } from '../lib/schema/places';
import type { SourceRequest } from '../lib/engine/source.worker';

// The Schema view's error places in an input in another format (lib/schema/places.ts, review 2 finding 6): a big
// input's found in the engine's source worker, never on the page; a small one's on the page.

function host(text: string, worker = true) {
  const posted: SourceRequest[] = [];
  const here: unknown[][] = [];
  const e: PlacesHost = {
    ed: { text },
    source: { locateImport: (...a: Parameters<typeof locateImport>) => (here.push(a), locateImport(...a)) },
    sourceWorker: () => (worker ? { postMessage: (m) => void posted.push(m) } : null),
    placesIn: null,
  };
  return { e, posted, here };
}

test('a big input\'s places are found in the worker, a small one\'s on the page; asked of a worker that ends: nothing', async () => {
  const csv = 'id,name\n' + Array.from({ length: 12_000 }, (_, i) => `${i},user ${i}`).join('\n') + '\n';
  assert.ok(csv.length >= PLACES_WORKER_MIN);
  const big = host(csv);
  const got = locateSource(big.e, 'csv', { header: true }, ['/5/name'], [false]);
  assert.deepEqual([big.posted.length, big.posted[0].locate, big.posted[0].text === csv, big.here.length], [1, { pointers: ['/5/name'], keys: [false] }, true, 0]);
  const reply: Place[] = [{ p: 42, exact: true }];
  big.e.placesIn!({ seq: big.posted[0].seq, places: reply });
  assert.deepEqual(await got, reply);
  // The worker ends (fails, or is stopped for a newer conversion) with a request on its way: that one answers null.
  const lost = locateSource(big.e, 'csv', { header: true }, ['/5/name'], [false]);
  big.e.placesIn!(null);
  assert.equal(await lost, null);
  // No worker: none.
  assert.equal(await locateSource(host(csv, false).e, 'csv', { header: true }, ['/5/name'], [false]), null);
  // A small input: on the page, no worker asked.
  const small = host('id,name\n1,Ada\n');
  assert.deepEqual(await locateSource(small.e, 'csv', { header: true }, ['/0/name'], [false]), [{ p: 10, exact: true }]);
  assert.deepEqual([small.here.length, small.posted.length], [1, 0]);
});

test('an error\'s place is looked up by its pointer and whether it is about the property name, everywhere (CI 45009714466)', () => {
  const places = new Map([[placeKey({ pointer: '/0/a', key: false }), 'cell'], [placeKey({ pointer: '/0/a', key: true }), 'header']]);
  assert.deepEqual([placeOf(places, { pointer: '/0/a', key: false }), placeOf(places, { pointer: '/0/a', key: true }), placeOf(places, { pointer: '/1/a', key: false }), placeOf(null, { pointer: '/0/a', key: false })], ['cell', 'header', undefined, undefined]);
  // The Schema view reads the places only through placeOf: its labels and its click and Enter alike (a lookup by
  // pointer alone found nothing, so a click selected nothing in the editor).
  const view = readFileSync(join(process.cwd(), 'components/SchemaView.tsx'), 'utf8');
  assert.deepEqual(view.match(/places\??\.get\(/g) ?? [], []);
  assert.ok((view.match(/placeOf\(places, row\.e\)/g) ?? []).length >= 2);
});
