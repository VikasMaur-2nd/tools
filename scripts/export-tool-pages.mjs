// Export the translatable text of lib/tool-pages.ts as JSON for translators.
// usage: node scripts/export-tool-pages.mjs [out.json]   (default: print a summary only)
// Each page carries `hash`: the hash of its English text. Translators copy it unchanged; `pnpm test`
// compares it with the current English page to report stale translations (lib/i18n/page-text.ts).
import { writeFileSync } from 'node:fs';
import { TOOL_PAGES } from '../lib/tool-pages.ts';
import { pageHash, pageText } from '../lib/i18n/page-text.ts';

const [out] = process.argv.slice(2);
const pages = {};
for (const p of TOOL_PAGES) {
  pages[p.slug] = {
    hash: pageHash(p),
    ...pageText(p),
    ...(p.sections?.some((s) => s.code) ? { _codeBlocks_doNotTranslate: p.sections.filter((s) => s.code).map((s) => ({ section: s.heading, code: s.code })) } : {}),
    _sample_doNotTranslate: p.sample,
  };
}
const words = JSON.stringify(Object.values(pages).map(({ hash, _sample_doNotTranslate, _codeBlocks_doNotTranslate, ...t }) => t)).split(/\s+/).length;
if (out) writeFileSync(out, JSON.stringify(pages, null, 2) + '\n');
console.log(`${Object.keys(pages).length} pages, ~${words} words${out ? ` -> ${out}` : ''}`);
