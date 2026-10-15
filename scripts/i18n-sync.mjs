// Copy translations from the translators' folder into the repo, cleaned and validated.
// usage: node scripts/i18n-sync.mjs [locale ...] [--from <dir>]
//   default locales: all of lib/i18n/locales.ts; default dir: /home/ubuntu/seo-ops/i18n
// Reads <dir>/<locale>/ui.json and <dir>/<locale>/tool-pages.json (each optional) and writes
// lib/i18n/<locale>/ui.json and tool-pages.json in English key order, without notes. For every
// interface string it records which English text it was translated from (lib/i18n/ui-source.json),
// so `pnpm test` can tell when the English changes later. Exit 1 when a file has errors (nothing
// is written for that file).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../lib/i18n/locales.ts';
import { textHash } from '../lib/i18n/page-text.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
const from = fromAt >= 0 ? args.splice(fromAt, 2)[1] : '/home/ubuntu/seo-ops/i18n';
const locales = args.length ? args : LOCALES.map((l) => l.id);

const en = JSON.parse(readFileSync(join(root, 'lib/i18n/en/ui.json'), 'utf8'));
const isNote = (k) => k.startsWith('_') || k.endsWith('._context');
const PLURAL = /\.(zero|one|two|few|many|other)$/;
const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');
const tags = (s) => (s.match(/<\/?\w+>/g) ?? []).sort().join(' ');
const sourcePath = join(root, 'lib/i18n/ui-source.json');
const source = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, 'utf8')) : {};
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
let failed = false;

const PAGE_FIELDS = ['hash', 'title', 'description', 'heading', 'query', 'secondary', 'intro', 'modeLabel', 'exampleLabel', 'steps', 'options', 'faqs', 'guides', 'sections'];

for (const locale of locales) {
  const info = LOCALES.find((l) => l.id === locale);
  if (!info) throw new Error(`unknown locale ${locale}`);
  const cats = new Intl.PluralRules(info.lang).resolvedOptions().pluralCategories;

  const uiFile = join(from, locale, 'ui.json');
  if (existsSync(uiFile)) {
    const tr = JSON.parse(readFileSync(uiFile, 'utf8'));
    const out = {};
    const hashes = {};
    const errors = [];
    for (const [key, src] of Object.entries(en)) {
      if (isNote(key)) continue;
      const m = PLURAL.exec(key);
      if (m) {
        if (m[1] !== 'other') continue;
        const base = key.slice(0, -6);
        for (const c of cats) {
          const v = tr[`${base}.${c}`];
          if (typeof v !== 'string' || !v.trim()) continue;
          if (!holders(v).split(' ').every((h) => !h || holders(src).includes(h))) errors.push(`${base}.${c}: unknown placeholder`);
          out[`${base}.${c}`] = v;
        }
        if (out[`${base}.other`]) hashes[base] = textHash(`${en[base + '.one'] ?? ''}|${src}`);
        continue;
      }
      const v = tr[key];
      if (typeof v !== 'string' || !v.trim()) continue;
      if (holders(v) !== holders(src)) errors.push(`${key}: placeholders ${holders(v) || '-'} ≠ ${holders(src) || '-'}`);
      if (tags(v) !== tags(src)) errors.push(`${key}: link tags differ`);
      out[key] = v;
      hashes[key] = textHash(src);
    }
    if (errors.length) {
      failed = true;
      console.log(`${locale}/ui.json: ${errors.length} errors, not copied`);
      for (const e of errors) console.log(`  ERROR ${e}`);
    } else {
      write(join(root, 'lib/i18n', locale, 'ui.json'), out);
      source[locale] = hashes;
      const total = Object.keys(en).filter((k) => !isNote(k) && !/\.(one|zero|two|few|many)$/.test(k)).length;
      console.log(`${locale}/ui.json: ${Object.keys(hashes).length}/${total} strings`);
    }
  } else console.log(`${locale}/ui.json: not delivered yet`);

  const pagesFile = join(from, locale, 'tool-pages.json');
  if (existsSync(pagesFile)) {
    const tr = JSON.parse(readFileSync(pagesFile, 'utf8'));
    const out = {};
    const errors = [];
    for (const [slug, page] of Object.entries(tr)) {
      const clean = {};
      for (const f of PAGE_FIELDS) if (page[f] !== undefined) clean[f] = page[f];
      for (const f of ['hash', 'title', 'description', 'heading', 'query', 'intro', 'modeLabel', 'exampleLabel']) if (typeof clean[f] !== 'string' || !clean[f].trim()) errors.push(`${slug}.${f}: missing`);
      for (const f of ['secondary', 'steps', 'options', 'faqs']) if (!Array.isArray(clean[f])) errors.push(`${slug}.${f}: not an array`);
      if (clean.sections) clean.sections = clean.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs }));
      if (clean.guides) clean.guides = clean.guides.map((g) => ({ slug: g.slug, text: g.text }));
      out[slug] = clean;
    }
    if (errors.length) {
      failed = true;
      console.log(`${locale}/tool-pages.json: ${errors.length} errors, not copied`);
      for (const e of errors) console.log(`  ERROR ${e}`);
    } else {
      write(join(root, 'lib/i18n', locale, 'tool-pages.json'), out);
      console.log(`${locale}/tool-pages.json: ${Object.keys(out).length} pages`);
    }
  } else console.log(`${locale}/tool-pages.json: not delivered yet`);
}

write(sourcePath, Object.fromEntries(Object.keys(source).sort().map((l) => [l, source[l]])));
process.exit(failed ? 1 : 0);
