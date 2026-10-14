import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_PAGES } from '../lib/tool-pages';

test('dedicated tool pages have unique slugs and working presets', () => {
  const slugs = TOOL_PAGES.map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const page of TOOL_PAGES) {
    assert.match(page.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(page.preset.initialText, `${page.slug} needs a worked example`);
    assert.ok(page.faqs.length >= 3, `${page.slug} needs visible FAQs`);
  }
});

test('conversion pages select a converter target and import pages select an importer', () => {
  for (const slug of ['json-to-typescript', 'json-to-zod', 'json-schema-generator', 'json-to-go', 'json-to-python', 'json-to-yaml', 'json-to-csv', 'json-to-xml', 'json-to-excel']) {
    const page = TOOL_PAGES.find((entry) => entry.slug === slug);
    assert.ok(page?.preset.settings?.view === 'convert', slug);
    assert.ok(page?.preset.settings?.target, slug);
  }
  for (const slug of ['yaml-to-json', 'csv-to-json', 'xml-to-json']) {
    const page = TOOL_PAGES.find((entry) => entry.slug === slug);
    assert.ok(page?.preset.initialImport, slug);
    assert.equal(page?.preset.settings?.view, 'format', slug);
  }
});

