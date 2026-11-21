import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_PAGES } from '../lib/tool-pages';
import { LOCALES } from '../lib/i18n/locales';
import { pageHash, textHash } from '../lib/i18n/page-text';
import { EN, fill } from '../lib/i18n/ui';
import { translator } from '../lib/i18n/translate';
import { CLIENT as CLIENT_KEYS, LAZY_FEATURES, hugeDict, isHugeKey, lazyDict, lazyFeature, pageDict } from '../lib/i18n/client-dict';
import { parse } from '../lib/json/parser';

/*
 * Translations: dictionary hygiene (fails), translation completeness and
 * freshness (reported, never failing: the English pages keep moving, and a
 * stale translation still says what the page said when it was translated).
 * Pages whose sections changed shape are dropped from their locale until
 * re-translated (lib/i18n/server.ts), so a stale page can never misplace code.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const json = <T = Record<string, string>>(p: string): T => JSON.parse(read(p)) as T;
const en = json('lib/i18n/en/ui.json');
const isNote = (k: string) => k.startsWith('_') || k.endsWith('._context');
const PLURAL = /\.(zero|one|two|few|many|other)$/;
const CLIENT = /^(app|dlg|cmd|cmp|toast|eng|target|parse|import|unit)\./;
/** Strings shipped ahead of the code that uses them (the dev thread's line-wrap branch). */
const RESERVED = new Set(['app.wrapLines', 'cmd.wrap', 'cmd.wrap.terms', 'dlg.wrap']);
/** Messages the code assembles from parts (`Unterminated ${what}`, `… ${on ? 'on' : 'off'}`), so no literal holds the whole text. */
const COMPOSED = new Set(['toast.autoFormatOn', 'toast.autoFormatOff', 'import.flowMap', 'import.flowSeq', 'import.comment', 'import.pi', 'import.arrayCommaEnd', 'import.tableCommaEnd', 'import.equalsEnd']);
const keys = Object.keys(en).filter((k) => !isNote(k));
const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');
const report = (title: string, lines: string[]) => {
  if (lines.length) console.log(`\n${title} (${lines.length})\n${lines.map((l) => `  ${l}`).join('\n')}`);
};

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
};
/** Code that renders strings in the browser, plus the libraries whose English messages it shows. */
const clientFiles = [...walk('components'), ...walk('lib/engine'), ...walk('lib/graph'), ...walk('lib/huge'), 'lib/i18n/translate.ts', 'lib/json/smart.ts', 'lib/json/parser.ts', 'lib/convert/import.ts', 'lib/convert/xlsx.ts', 'lib/convert/flat.ts', 'lib/diff/diff.ts'].filter(
  // Server components translate by stable key instead.
  (f) => !read(f).includes("from '@/lib/i18n/server'"),
);
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
const corpus = unescape(clientFiles.map(read).join('\n'));

test('English dictionary: client strings are unique and still used by the code', () => {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  const unused: string[] = [];
  for (const k of keys) {
    if (!CLIENT.test(k)) continue;
    const v = en[k];
    // Both plural forms of one string are one entry.
    const id = PLURAL.test(k) ? k.replace(PLURAL, '') : k;
    if (seen.has(v) && seen.get(v) !== id) dup.push(`${k} repeats ${seen.get(v)}: ${JSON.stringify(v)}`);
    seen.set(v, id);
    if (RESERVED.has(k) || COMPOSED.has(k) || /\.(zero|one|two|few|many)$/.test(k)) continue;
    // Templates are built from pieces in code: every literal piece must still be there.
    // The parser inserts describe(i) into these templates; verify the complete messages below.
    const template = v.replace('control character U+{code}', '{token}');
    const pieces = template.split(/\{\w+\}/).filter((p) => p.trim().length >= 3);
    if (!(pieces.length ? pieces : [v]).every((p) => corpus.includes(p))) unused.push(`${k}: ${JSON.stringify(v)}`);
  }
  assert.deepEqual(dup, [], 'the browser looks strings up by their English text, so two keys cannot share one');
  assert.deepEqual(unused, [], 'strings the code no longer shows: update the English text in lib/i18n/en/ui.json (same key: translations get flagged as stale) or remove the key');
});

test('English dictionary: a plural string does not share its key with a plain one', () => {
  // ui-source.json records one English hash per key, a plural under its base: "x" and "x.one/.other" would share it,
  // and one of the two would always read as changed since translation.
  const bases = new Set(keys.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')));
  assert.deepEqual([...bases].filter((b) => b in en), [], 'give the plural its own key, e.g. app.fooCount.one / .other');
});

test('huge mode strings: out of every page dictionary, in a dictionary of their own that the translator loads', async () => {
  const hugeTexts = new Set(keys.filter((k) => CLIENT_KEYS.test(k) && isHugeKey(k)).map((k) => en[k]));
  assert.ok(hugeTexts.has('Large file') && hugeTexts.has('Shape'));
  const loaders = read('lib/i18n/translate.ts');
  // translate.ts fetches the file next to it; in the test build that URL is under .test-build: read the source's.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => new Response(readFileSync(fileURLToPath(String(u)).replace(`${sep}.test-build${sep}`, sep)))) as typeof fetch;
  try {
  // A page's dictionary is clientUi (lib/i18n/server.ts, server-only: read, not run here); scripts/verify-i18n.mjs checks built pages too.
  assert.match(read('lib/i18n/server.ts'), /return memo\(`client:\$\{locale\}`, \(\) => pageDict\(/);
  for (const { id, lang } of LOCALES) {
    const tr = json(`lib/i18n/${id}/ui.json`);
    const page = pageDict(en, tr);
    assert.deepEqual(Object.keys(page).filter((s) => hugeTexts.has(s)), [], `${id}: a page's dictionary carries huge mode's strings`);
    const huge = hugeDict(en, tr);
    assert.deepEqual(json<typeof huge>(`lib/i18n/huge/huge-strings.${id}.json`), huge, `lib/i18n/huge/huge-strings.${id}.json is out of date: run pnpm i18n:huge`);
    // translate.ts picks the dictionary by the page's language (<html lang>, e.g. pt-BR, zh-Hans).
    assert.equal(lang.slice(0, 2), id);
    // (The file name matters: the service worker caches a page's own language's huge-strings.<lang>.* only.)
    // (Spelled in two parts: the test runner rewrites that expression wherever it appears.)
    assert.ok(loaders.includes(`${id}: new URL('./huge/huge-strings.${id}.json', ${'import.meta'}.url)`), `translate.ts loads lib/i18n/huge/huge-strings.${id}.json`);
    if (!Object.keys(tr).length) continue;
    // The page's translator, then huge mode's strings added to it (templates included: msg's patterns are made again).
    const t = translator(page, lang);
    assert.equal(t('Large file'), 'Large file');
    assert.equal(t('Indexing {done} of {size}'), 'Indexing {done} of {size}');
    t.msg('Indexing 1 GB of 10 GB'); // (makes msg's patterns from the page's strings alone)
    await t.huge!();
    assert.equal(t('Large file'), huge['Large file'], id);
    assert.equal(t.msg('Indexing 1 GB of 10 GB'), fill(huge['Indexing {done} of {size}'] as string, { done: '1 GB', size: '10 GB' }), id);
    assert.equal(t.n(3, '{n} record', '{n} records'), fill((huge['{n} records'] as Record<string, string>)[new Intl.PluralRules(lang).select(3)], { n: 3 }), id);
    // The page's own strings are still there.
    assert.equal(t('Tree'), tr['app.tree']);
  }
  } finally {
    globalThis.fetch = realFetch;
  }
  // English pages have no dictionary to add.
  assert.equal(EN.huge, undefined);
});

test('lazy features\' strings: out of every page dictionary, in a dictionary of their own per feature that the translator loads', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => new Response(readFileSync(fileURLToPath(String(u)).replace(`${sep}.test-build${sep}`, sep)))) as typeof fetch;
  try {
    const loaders = read('lib/i18n/translate.ts');
    // The tab, the palette's commands and the Convert targets stay with the page.
    for (const k of ['app.schema', 'app.schema.close', 'cmd.schema', 'target.flatten', 'target.unflatten']) assert.equal(lazyFeature(k), null, k);
    assert.equal(lazyFeature('app.schema.valid'), 'schema');
    assert.equal(lazyFeature('eng.flatEscaped.one'), 'flatten');
    for (const { id, lang } of LOCALES) {
      const tr = json(`lib/i18n/${id}/ui.json`);
      const page = pageDict(en, tr);
      for (const f of LAZY_FEATURES) {
        const texts = new Set(keys.filter((k) => CLIENT_KEYS.test(k) && lazyFeature(k) === f).map((k) => en[k]));
        assert.ok(texts.size > 10, `${f}: ${texts.size} strings`);
        assert.deepEqual(Object.keys(page).filter((s) => texts.has(s)), [], `${id}: the page's dictionary carries ${f}'s strings`);
        const dict = lazyDict(en, tr, f);
        assert.deepEqual(json<typeof dict>(`lib/i18n/lazy/${f}-strings.${id}.json`), dict, `lib/i18n/lazy/${f}-strings.${id}.json is out of date: run pnpm i18n:huge`);
        assert.ok(loaders.includes(`${id}: new URL('./lazy/${f}-strings.${id}.json', ${'import.meta'}.url)`), `translate.ts loads lib/i18n/lazy/${f}-strings.${id}.json`);
      }
      if (!Object.keys(tr).length) continue;
      const t = translator(page, lang);
      assert.equal(t('Valid'), 'Valid');
      assert.equal(t.has!('schema'), false);
      await t.lazy!('schema');
      assert.equal(t.has!('schema'), true);
      assert.equal(t('Valid'), lazyDict(en, tr, 'schema').Valid, id);
      await t.lazy!('flatten');
      assert.equal(t('Escape keys'), lazyDict(en, tr, 'flatten')['Escape keys'], id);
      assert.equal(t('Tree'), tr['app.tree']);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('lazy features\' strings are not translated by the rest of the app', () => {
  const texts = new Map(keys.filter((k) => CLIENT_KEYS.test(k) && lazyFeature(k)).map((k) => [en[k], lazyFeature(k)!]));
  const own: Record<string, RegExp> = { schema: /^components\/(SchemaView|schema-messages)\./, flatten: /^components\/FlatItems\./ };
  const used: string[] = [];
  for (const f of clientFiles) {
    for (const m of read(f).matchAll(/(?:\b(?:t|tr|rt)|useT\(\))(?:\.n)?\(\s*(?:[^,()'"]+,\s*)?(['"])((?:\\.|(?!\1).)+)\1/g)) {
      const feature = texts.get(unescape(m[2]));
      if (feature && !own[feature].test(f)) used.push(`${f}: ${unescape(m[2])}`);
    }
  }
  assert.deepEqual(used, [], 'shown outside the feature: leave these keys out of lazyFeature (lib/i18n/client-dict.ts)');
});

test('huge-only strings are not translated by the rest of the app', () => {
  // Strings passed to t() as literals outside huge mode's code must stay in every page's dictionary.
  // (The palette lists huge mode's edit commands, by variable, only while a huge file is open.)
  const hugeTexts = new Set(keys.filter((k) => CLIENT_KEYS.test(k) && isHugeKey(k)).map((k) => en[k]));
  const used: string[] = [];
  for (const f of clientFiles.filter((f) => !/^(components|lib)\/huge\//.test(f))) {
    for (const m of read(f).matchAll(/(?:\b(?:t|tr|rt)|useT\(\))(?:\.n)?\(\s*(?:[^,()'"]+,\s*)?(['"])((?:\\.|(?!\1).)+)\1/g)) if (hugeTexts.has(unescape(m[2]))) used.push(`${f}: ${unescape(m[2])}`);
  }
  assert.deepEqual(used, [], 'shown outside huge mode: leave these keys out of isHugeKey (lib/i18n/client-dict.ts)');
});

test('control-character templates match the parser diagnostics', () => {
  const cases = {
    'parse.badNumberControl': '-\u0001',
    'parse.expectedKeyControl': '{\u0001',
    'parse.colonControl': '{"a"\u0001',
    'parse.afterValueControl': '{"a":1\u0001',
    'parse.afterItemControl': '[1\u0001',
    'parse.expectedValueControl': '\u0001',
    'parse.afterJsonControl': '{}\u0001',
  };
  for (const [key, input] of Object.entries(cases)) {
    assert.equal(parse(input).error?.m, fill(en[key], { code: '0001' }), key);
  }
});

test('English dictionary: every string the code translates is in it', () => {
  const english = new Set(keys.map((k) => en[k]));
  const missing: string[] = [];
  for (const f of clientFiles) {
    const src = read(f);
    // t('…'), tr('…'), rt('…'), useT()('…') and the plural forms of t.n(count, '…', '…').
    for (const m of src.matchAll(/(?:\b(?:t|tr|rt)|useT\(\))\(\s*(['"])((?:\\.|(?!\1).)+)\1/g)) if (!english.has(unescape(m[2]))) missing.push(`${f}: ${m[2]}`);
    for (const m of src.matchAll(/\b(?:t|tr|rt)\.n\([^,]+,\s*(['"])((?:\\.|(?!\1).)+)\1,\s*(['"])((?:\\.|(?!\3).)+)\3/g)) {
      for (const s of [m[2], m[4]]) if (!english.has(unescape(s))) missing.push(`${f}: ${s}`);
    }
  }
  assert.deepEqual(missing, [], 'add these strings to lib/i18n/en/ui.json (then they go to translators)');
});

test('server-side keys are all used', () => {
  const code = [...walk('app'), ...walk('components'), ...walk('lib/i18n')].map(read).join('\n');
  const unused = keys.filter((k) => !CLIENT.test(k) && !code.includes(`'${k}'`) && !/^home\.(faq|feature|tools|how)\.\d/.test(k));
  assert.deepEqual(unused, []);
});

test('translator: English is a pass-through with placeholders and plurals', () => {
  assert.equal(EN('Opened {name}', { name: 'a.json' }), 'Opened a.json');
  assert.equal(EN.n(1, '{n} line', '{n} lines'), '1 line');
  assert.equal(EN.n(2, '{n} line', '{n} lines'), '2 lines');
  assert.equal(EN.msg('Formatted · fixed 2 issues'), 'Formatted · fixed 2 issues');
  assert.equal(fill('Expected \'}\' to close the object'), "Expected '}' to close the object");
});

test('translator: localized lookups, plurals, templates and composed messages', () => {
  const forms = { one: '{n} ligne', many: '{n} de lignes', other: '{n} lignes' };
  const t = translator(
    {
      Format: 'Formater',
      'Opened {name}': '{name} ouvert',
      "Couldn't read {name}": 'Lecture impossible : {name}',
      "Couldn't read {name}: {error}": 'Lecture impossible ({name}) : {error}',
      'Unexpected {token}': '{token} inattendu',
      'control character U+{code}': 'caractère de contrôle U+{code}',
      'Formatted': 'Formaté',
      'fixed {n} issue': { one: '{n} problème corrigé', other: '{n} problèmes corrigés' },
      'fixed {n} issues': { one: '{n} problème corrigé', other: '{n} problèmes corrigés' },
      '{mod}Z to undo': '{mod}Z pour annuler',
      '{n} line': forms,
      '{n} lines': forms,
      '{size} KB': '{size} Ko',
    },
    'fr',
  );
  assert.equal(t('Format'), 'Formater');
  assert.equal(t('Not translated'), 'Not translated');
  assert.equal(t.n(1, '{n} line', '{n} lines'), '1 ligne');
  assert.equal(t.n(3, '{n} line', '{n} lines'), '3 lignes');
  assert.equal(t.n(1000000, '{n} line', '{n} lines'), '1 000 000 de lignes');
  assert.equal(t.msg('Opened data.json'), 'data.json ouvert');
  assert.equal(t.msg("Couldn't read a.yaml: Unexpected control character U+0009"), 'Lecture impossible (a.yaml) : caractère de contrôle U+0009 inattendu');
  assert.equal(t.msg("Couldn't read b.json"), 'Lecture impossible : b.json');
  assert.equal(t.msg('Formatted · fixed 12 issues · Ctrl+Z to undo'), 'Formaté · 12 problèmes corrigés · Ctrl+Z pour annuler');
  assert.equal(t.msg('Something else entirely'), 'Something else entirely');
  assert.equal(t.bytes(2048), '2,0 Ko');
  assert.equal(t.num(1234567), '1 234 567');
});

test('every locale has a translation folder', () => {
  for (const { id } of LOCALES) {
    assert.ok(existsSync(join(root, 'lib/i18n', id, 'ui.json')), `lib/i18n/${id}/ui.json`);
    assert.ok(existsSync(join(root, 'lib/i18n', id, 'tool-pages.json')), `lib/i18n/${id}/tool-pages.json`);
  }
});

test('interface translations: valid, complete and fresh', () => {
  const source = existsSync(join(root, 'lib/i18n/ui-source.json')) ? json<Record<string, Record<string, string>>>('lib/i18n/ui-source.json') : {};
  const errors: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];
  for (const { id, lang } of LOCALES) {
    const tr = json(`lib/i18n/${id}/ui.json`);
    if (!Object.keys(tr).length) {
      missing.push(`${id}: not translated yet (the locale is not published)`);
      continue;
    }
    const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    const lost: string[] = [];
    const old: string[] = [];
    for (const k of keys) {
      const m = PLURAL.exec(k);
      if (m && m[1] !== 'other') continue;
      const base = m ? k.slice(0, -6) : k;
      const variants = m ? cats.map((c) => `${base}.${c}`) : [k];
      for (const v of variants) {
        if (typeof tr[v] !== 'string') lost.push(v);
        else if (!m && holders(tr[v]) !== holders(en[k])) errors.push(`${id} ${v}: placeholders ${holders(tr[v])} ≠ ${holders(en[k])}`);
      }
      const was = source[id]?.[base];
      const now = m ? textHash(`${en[base + '.one'] ?? ''}|${en[k]}`) : textHash(en[k]);
      if (was && was !== now) old.push(base);
    }
    for (const k of Object.keys(tr)) if (!(k in en) && !(PLURAL.test(k) && `${k.replace(PLURAL, '')}.other` in en)) errors.push(`${id} ${k}: not an English key`);
    if (lost.length) missing.push(`${id}: ${lost.length} strings shown in English: ${lost.slice(0, 12).join(', ')}${lost.length > 12 ? ', …' : ''}`);
    if (old.length) stale.push(`${id}: English changed since translation: ${old.join(', ')}`);
  }
  report('Interface strings not translated yet', missing);
  report('Interface strings to re-translate', stale);
  assert.deepEqual(errors, []);
});

test('tool page translations: valid and fresh', () => {
  const errors: string[] = [];
  const stale: string[] = [];
  const dropped: string[] = [];
  const absent: string[] = [];
  for (const { id } of LOCALES) {
    const tr = json<Record<string, { hash: string; title: string; steps: string[]; options: string[]; faqs: unknown[]; sections?: unknown[] }>>(`lib/i18n/${id}/tool-pages.json`);
    if (!Object.keys(tr).length) continue;
    const old: string[] = [];
    for (const page of TOOL_PAGES) {
      const t = tr[page.slug];
      if (!t) {
        absent.push(`${id}/${page.slug}`);
        continue;
      }
      if (!t.title || !Array.isArray(t.steps) || !Array.isArray(t.options) || !Array.isArray(t.faqs)) errors.push(`${id}/${page.slug}: incomplete`);
      if ((t.sections?.length ?? 0) !== (page.sections?.length ?? 0)) dropped.push(`${id}/${page.slug}`);
      else if (t.hash !== pageHash(page)) old.push(page.slug);
    }
    for (const slug of Object.keys(tr)) if (!TOOL_PAGES.some((p) => p.slug === slug)) errors.push(`${id}/${slug}: no such English page`);
    if (old.length) stale.push(`${id}: ${old.join(', ')}`);
  }
  report('Tool pages not translated (not published in that language)', absent);
  report('Tool pages whose English changed since translation (published as translated)', stale);
  report('Tool pages whose sections changed shape (unpublished until re-translated)', dropped);
  assert.deepEqual(errors, []);
});
