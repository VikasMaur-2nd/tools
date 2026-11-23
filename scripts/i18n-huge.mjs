// Write the dictionaries that load after the page, per locale, from lib/i18n/<locale>/ui.json: huge mode's (the
// strings only huge mode shows: lib/i18n/client-dict.ts isHugeKey), loaded when a huge file opens, and the lazily
// loaded features' (lazyFeature: the Schema view, Flatten), loaded when the feature opens (lib/i18n/translate.ts).
// Each is public/i18n/<name>-strings.<locale>.<hash>.json, named by its content (served as immutable), and
// lib/i18n/strings-files.json lists the current ones. Only the server reads that list: a localized page hands its
// own language's files to the translator (lib/i18n/server.ts stringFiles), so no page's JavaScript carries a table
// of them, and the service worker finds them in the page (public/sw.js) and caches that language's only.
// usage: node scripts/i18n-huge.mjs      (also run by scripts/i18n-sync.mjs; `pnpm test` checks they're current)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../lib/i18n/locales.ts';
import { STRING_FILES, hugeDict, lazyDict } from '../lib/i18n/client-dict.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
/** Where the files go, and the list of them. */
export const DIR = 'public/i18n';
export const LIST = 'lib/i18n/strings-files.json';

/** A locale's file for one name in STRING_FILES (compact: it ships as is). */
export const stringsFile = (en, tr, name) => JSON.stringify(name === 'huge' ? hugeDict(en, tr) : lazyDict(en, tr, name)) + '\n';
/** Its URL: the name, the locale and a hash of the text. */
export const stringsUrl = (name, locale, text) => `/i18n/${name}-strings.${locale}.${createHash('sha256').update(text).digest('hex').slice(0, 12)}.json`;

/** Every locale's files: { [locale]: { [name]: [url, text] } }. */
export function stringFiles() {
  const en = read('lib/i18n/en/ui.json');
  const out = {};
  for (const { id } of LOCALES) {
    const tr = read(`lib/i18n/${id}/ui.json`);
    out[id] = {};
    for (const name of STRING_FILES) {
      const text = stringsFile(en, tr, name);
      out[id][name] = [stringsUrl(name, id, text), text];
    }
  }
  return out;
}

export function writeHugeDicts() {
  const files = stringFiles();
  mkdirSync(join(root, DIR), { recursive: true });
  const keep = new Set();
  const list = {};
  for (const [locale, names] of Object.entries(files)) {
    list[locale] = {};
    for (const [name, [url, text]] of Object.entries(names)) {
      const file = url.slice('/i18n/'.length);
      keep.add(file);
      writeFileSync(join(root, DIR, file), text);
      list[locale][name] = url;
      console.log(`${DIR}/${file}: ${Object.keys(JSON.parse(text)).length} strings, ${Buffer.byteLength(text)} B`);
    }
  }
  // Files of older texts go: the list names the current ones only.
  for (const file of readdirSync(join(root, DIR))) if (!keep.has(file)) rmSync(join(root, DIR, file));
  writeFileSync(join(root, LIST), JSON.stringify(list, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeHugeDicts();
