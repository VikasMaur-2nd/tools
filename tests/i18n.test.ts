import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_PAGES } from '../lib/tool-pages';
import { LOCALES } from '../lib/i18n/locales';
import { pageHash, textHash } from '../lib/i18n/page-text';
import { EN, fill } from '../lib/i18n/ui';
import { translator } from '../lib/i18n/translate';

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
const clientFiles = [...walk('components'), ...walk('lib/engine'), 'lib/i18n/translate.ts', 'lib/json/smart.ts', 'lib/json/parser.ts', 'lib/convert/import.ts', 'lib/convert/xlsx.ts', 'lib/diff/diff.ts'].filter(
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
    const pieces = v.split(/\{\w+\}/).filter((p) => p.trim().length >= 3);
    if (!(pieces.length ? pieces : [v]).every((p) => corpus.includes(p))) unused.push(`${k}: ${JSON.stringify(v)}`);
  }
  assert.deepEqual(dup, [], 'the browser looks strings up by their English text, so two keys cannot share one');
  assert.deepEqual(unused, [], 'strings the code no longer shows: update the English text in lib/i18n/en/ui.json (same key: translations get flagged as stale) or remove the key');
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
