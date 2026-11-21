// Write huge mode's dictionaries, lib/i18n/huge/huge-strings.<locale>.json: English text → translation for the strings
// only huge mode shows (lib/i18n/client-dict.ts isHugeKey), from lib/i18n/<locale>/ui.json. They are loaded
// when a huge file opens (lib/i18n/translate.ts `huge`), so localized pages don't carry them. The name matters:
// the bundler copies each to static/media/huge-strings.<locale>.<hash>.json, and the service worker caches a
// page's own language's file only (public/sw.js).
// It writes the lazily loaded features' dictionaries the same way: lib/i18n/lazy/<feature>-strings.<locale>.json
// (lib/i18n/client-dict.ts lazyFeature: the Schema view, Flatten), loaded when the feature opens (translate.ts `lazy`).
// usage: node scripts/i18n-huge.mjs      (also run by scripts/i18n-sync.mjs; `pnpm test` checks they're current)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../lib/i18n/locales.ts';
import { LAZY_FEATURES, hugeDict, lazyDict } from '../lib/i18n/client-dict.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

/** The file a locale's dictionary is written as (compact: it ships as is). */
export const hugeFile = (en, tr) => JSON.stringify(hugeDict(en, tr)) + '\n';

/** A lazy feature's file for a locale. */
export const lazyFile = (en, tr, feature) => JSON.stringify(lazyDict(en, tr, feature)) + '\n';

export function writeHugeDicts() {
  const en = read('lib/i18n/en/ui.json');
  for (const { id } of LOCALES) {
    const tr = read(`lib/i18n/${id}/ui.json`);
    const text = hugeFile(en, tr);
    writeFileSync(join(root, 'lib/i18n/huge', `huge-strings.${id}.json`), text);
    console.log(`lib/i18n/huge/huge-strings.${id}.json: ${Object.keys(JSON.parse(text)).length} strings, ${Buffer.byteLength(text)} B`);
    for (const f of LAZY_FEATURES) {
      const lazy = lazyFile(en, tr, f);
      writeFileSync(join(root, 'lib/i18n/lazy', `${f}-strings.${id}.json`), lazy);
      console.log(`lib/i18n/lazy/${f}-strings.${id}.json: ${Object.keys(JSON.parse(lazy)).length} strings, ${Buffer.byteLength(lazy)} B`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeHugeDicts();
