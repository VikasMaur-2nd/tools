import test from 'node:test';
import assert from 'node:assert/strict';
import { warmUrls } from '../lib/engine/warm';

// What a page hands the service worker after its warm-up (lib/engine/warm.ts, review 2 finding 2).

test('the warm-up names the page, its home and the app files it loaded, never what it fetched for the visitor', () => {
  const o = 'https://tools.example';
  const entries = [
    { name: `${o}/_next/static/chunks/a.js`, initiatorType: 'script' },
    { name: `${o}/_next/static/media/font.woff2`, initiatorType: 'css' },
    { name: `${o}/icon-192.png`, initiatorType: 'img' },
    // The app's own files fetched by script: dictionaries, a chunk's asset.
    { name: `${o}/i18n/schema-strings.de.0123456789ab.json`, initiatorType: 'fetch' },
    { name: `${o}/_next/static/media/meta-schemas.abc.json`, initiatorType: 'fetch' },
    // Fetched for the visitor: a schema, a document by URL, an API answer.
    { name: `${o}/schema.json`, initiatorType: 'fetch' },
    { name: `${o}/data/doc.json?x=1`, initiatorType: 'xmlhttprequest' },
    { name: `${o}/api/schema`, initiatorType: 'fetch' },
    { name: `${o}/_vercel/insights/script.js`, initiatorType: 'script' },
    { name: 'https://other.example/x.js', initiatorType: 'script' },
  ];
  assert.deepEqual(warmUrls(entries, o, '/de/tools/json-schema-validator'), [
    `${o}/`,
    `${o}/de`,
    `${o}/de/tools/json-schema-validator`,
    `${o}/_next/static/chunks/a.js`,
    `${o}/_next/static/media/font.woff2`,
    `${o}/icon-192.png`,
    `${o}/i18n/schema-strings.de.0123456789ab.json`,
    `${o}/_next/static/media/meta-schemas.abc.json`,
  ]);
  assert.deepEqual(warmUrls([], o, '/'), [`${o}/`]);
});
