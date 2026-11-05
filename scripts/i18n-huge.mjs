// Write huge mode's dictionaries, lib/i18n/huge/<locale>.json: English text → translation for the strings
// only huge mode shows (lib/i18n/client-dict.ts isHugeKey), from lib/i18n/<locale>/ui.json. They are loaded
// when a huge file opens (lib/i18n/translate.ts `huge`), so localized pages don't carry them.
// usage: node scripts/i18n-huge.mjs      (also run by scripts/i18n-sync.mjs; `pnpm test` checks they're current)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../lib/i18n/locales.ts';
import { hugeDict } from '../lib/i18n/client-dict.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

/** The file a locale's dictionary is written as (compact: it ships as is). */
export const hugeFile = (en, tr) => JSON.stringify(hugeDict(en, tr)) + '\n';

export function writeHugeDicts() {
  const en = read('lib/i18n/en/ui.json');
  for (const { id } of LOCALES) {
    const text = hugeFile(en, read(`lib/i18n/${id}/ui.json`));
    writeFileSync(join(root, 'lib/i18n/huge', `${id}.json`), text);
    console.log(`lib/i18n/huge/${id}.json: ${Object.keys(JSON.parse(text)).length} strings, ${Buffer.byteLength(text)} B`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeHugeDicts();
