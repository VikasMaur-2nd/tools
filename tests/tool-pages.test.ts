import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_PAGES } from '../lib/tool-pages';
import { persistenceAfterChange, persistenceAfterLoad } from '../lib/engine/engine';

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
