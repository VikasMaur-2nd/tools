import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_PAGES } from '../lib/tool-pages';
import { LOCALES } from '../lib/i18n/locales';
import { persistenceAfterChange, persistenceAfterLoad } from '../lib/engine/rules';

test('dedicated tool pages have unique slugs and working presets', () => {
  const slugs = TOOL_PAGES.map((page) => page.slug);
  assert.equal(slugs.includes('json-formatter'), false);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const page of TOOL_PAGES) {
    assert.match(page.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(page.preset.initialText, `${page.slug} needs a worked example`);
    assert.ok(page.faqs.length >= 3, `${page.slug} needs visible FAQs`);
  }
});

test('formatter intent stays on the homepage', () => {
  assert.ok(TOOL_PAGES.some((page) => page.related.includes('home')));
  assert.equal(TOOL_PAGES.some((page) => page.slug === 'json-formatter'), false);
});

test('landing presets never replace saved documents, but user changes persist', () => {
  let enabled = false;
  enabled = persistenceAfterLoad(enabled, false);
  assert.equal(enabled, false, 'preset load leaves home-page persistence disabled');
  enabled = persistenceAfterChange(enabled, 'set');
  assert.equal(enabled, false, 'programmatic preset changes remain private');
  enabled = persistenceAfterChange(enabled, 'input');
  assert.equal(enabled, true, 'typing enables normal persistence');
  assert.equal(persistenceAfterChange(true, 'set'), true, 'later programmatic changes persist after a user edit');
  assert.equal(persistenceAfterLoad(true, false), true, 'normal homepage persistence stays enabled');
});

test('conversion pages select a converter target and import pages select an importer', () => {
  for (const slug of ['json-to-typescript', 'json-to-zod', 'json-schema-generator', 'json-to-go', 'json-to-python', 'json-to-yaml', 'json-to-csv', 'json-to-xml', 'json-to-excel', 'json-to-dart', 'json-to-kotlin', 'json-to-swift', 'json-to-java', 'json-to-csharp', 'json-to-rust', 'json-to-php', 'json-to-toml']) {
    const page = TOOL_PAGES.find((entry) => entry.slug === slug);
    assert.ok(page?.preset.settings?.view === 'convert', slug);
    assert.ok(page?.preset.settings?.target, slug);
  }
  for (const slug of ['yaml-to-json', 'csv-to-json', 'xml-to-json', 'toml-to-json']) {
    const page = TOOL_PAGES.find((entry) => entry.slug === slug);
    assert.equal(page?.preset.input, slug.slice(0, -'-to-json'.length), slug);
    assert.equal(page?.preset.settings?.view, 'format', slug);
  }
});

// Keep generator wording tied to the output users actually receive from each preset.
test('new language pages emit the documented models from their nested samples', async () => {
  const { convert } = await import('../lib/convert');
  const { parse } = await import('../lib/json/parser');
  const cases = [
    ['json-to-dart', 'dart', 'factory Root.fromJson', 'Map<String, dynamic> toJson()', 'final String? note;', "json['user-id']"],
    ['json-to-kotlin', 'kotlin', '@Serializable', 'data class Root(', '@SerialName("user-id")', 'val note: String? = null'],
    ['json-to-swift', 'swift', 'struct Root: Codable', 'enum CodingKeys: String, CodingKey', 'case userId = "user-id"', 'let note: String?'],
    ['json-to-java', 'java', 'public record Root(', '@JsonProperty("user-id")', 'List<Item> items', 'public record Item(double price, String note)'],
    ['json-to-csharp', 'csharp', 'using System.Text.Json.Serialization;', '[JsonPropertyName("user-id")]', 'required List<Item> Items', 'required string? Note'],
    ['json-to-rust', 'rust', '#[derive(Debug, Clone, Serialize, Deserialize)]', '#[serde(rename = "user-id")]', 'pub items: Vec<Item>', 'pub note: Option<String>'],
    ['json-to-php', 'php', 'declare(strict_types=1);', 'public readonly array $items', 'public static function fromArray', "$data['user-id']"],
  ];
  for (const [slug, target, ...expected] of cases) {
    const page = TOOL_PAGES.find((entry) => entry.slug === slug);
    assert.ok(page, slug);
    assert.equal(page.preset.settings?.target, target);
    assert.equal(page.preset.initialText, page.sample);
    const parsed = parse(page.sample);
    assert.ok(parsed.root && !parsed.error, slug);
    const output = convert(parsed.root, target, { rootName: 'Root' });
    for (const text of expected) assert.ok(output.includes(text), `${slug}: ${text}`);
  }
});

test('TOML pages demonstrate tables and disclose lossy values', async () => {
  const { convert } = await import('../lib/convert');
  const { parse } = await import('../lib/json/parser');
  const { importToJson } = await import('../lib/convert/import');
  const exporter = TOOL_PAGES.find((page) => page.slug === 'json-to-toml')!;
  const importer = TOOL_PAGES.find((page) => page.slug === 'toml-to-json')!;
  const output = convert(parse(exporter.sample).root!, 'toml', { rootName: 'Root' });
  assert.ok(output.includes('[profile]'));
  assert.equal(output.match(/\[\[items\]\]/g)?.length, 2);
  assert.ok(output.includes('# note = null (omitted: TOML has no null)'));
  assert.equal(importer.preset.input, 'toml');
  const imported = importToJson(importer.sample, 'toml', '  ');
  assert.ok('json' in imported);
  assert.deepEqual(JSON.parse(imported.json), {
    title: 'API client', retries: 3, server: { host: 'localhost', enabled: true }, users: [{ name: 'Ada' }, { name: 'Lin' }],
  });
});

test('all pages have distinct search metadata and resolvable related links', () => {
  for (const key of ['title', 'description', 'query'] as const) {
    assert.equal(new Set(TOOL_PAGES.map((page) => page[key])).size, TOOL_PAGES.length, key);
  }
  const slugs = new Set(TOOL_PAGES.map((page) => page.slug));
  for (const page of TOOL_PAGES) {
    assert.equal(page.secondary.length, 2, page.slug);
    assert.ok(page.faqs.length <= 5, page.slug);
    for (const related of page.related) {
      assert.ok(slugs.has(related) || related === 'home' || related === 'privacy-study', `${page.slug}: ${related}`);
    }
  }
  for (const slug of ['offline-json-formatter', 'secure-json-formatter']) {
    const page = TOOL_PAGES.find((entry) => entry.slug === slug)!;
    assert.equal(page.preset.settings?.view, 'format');
    assert.equal(page.preset.settings?.minify, false);
    assert.ok(page.related.includes('privacy-study'));
    assert.ok(page.related.includes(slug === 'offline-json-formatter' ? 'secure-json-formatter' : 'offline-json-formatter'));
  }
});

test('JSON visualizer landing page keeps its search-facing coverage', () => {
  const page = TOOL_PAGES.find((entry) => entry.slug === 'json-visualizer')!;
  assert.ok(page.title.startsWith('JSON visualizer'));
  assert.ok(`${page.title} | Tool Kumar`.length <= 60);
  assert.ok(page.description.length <= 155);
  assert.equal(page.faqs.length, 5);
  assert.equal(page.sections?.length, 3);
  assert.ok(page.sections?.some((section) => /tree|table/i.test(section.heading)));
  assert.ok(page.sections?.some((section) => /large JSON/i.test(section.heading)));
  assert.ok(page.sections?.some((section) => /export/i.test(section.heading)));
  assert.deepEqual(page.related.slice(0, 4), ['large-json-viewer', 'json-path-finder', 'json-to-table', 'json-validator']);
  assert.ok(page.related.includes('privacy-study'));
});

test('localized JSON visualizer metadata stays within search snippet limits', () => {
  for (const { id } of LOCALES) {
    const pages = JSON.parse(readFileSync(join(process.cwd(), 'lib/i18n', id, 'tool-pages.json'), 'utf8')) as Record<string, { title: string; description: string }>;
    const page = pages['json-visualizer'];
    assert.ok(page, id);
    assert.ok(`${page.title} | Tool Kumar`.length <= 60, `${id} title`);
    assert.ok(page.description.length <= 155, `${id} description`);
  }
});

// The schema page explains required properties with real generator output.
test('schema generator section shows the generated schema for its sample', async () => {
  const { convert } = await import('../lib/convert');
  const { parse } = await import('../lib/json/parser');
  const page = TOOL_PAGES.find((entry) => entry.slug === 'json-schema-generator')!;
  const [, sample, schema] = /^Input:\n(.*)\n\nGenerated schema:\n([\s\S]*)$/.exec(page.sections![0].code!)!;
  assert.equal(schema, convert(parse(sample).root!, 'json-schema', { rootName: 'Root' }).trimEnd());
  assert.match(schema, /"required": \["id", "email"\]/);
});
