import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_DATES, formatDate, latest } from '../app/(en)/dates';
import { POSTS } from '../app/(en)/blogs/posts';
import { ERROR_GUIDES } from '../app/(en)/json-errors/errors';
import { TOOL_PAGES } from '../lib/tool-pages';

/*
 * Every page's dates live with its content (app/(en)/dates.ts, posts, error
 * guides, tool pages); the sitemap, article metadata, JSON-LD and visible
 * dates all derive from them, so they can no longer disagree.
 */

const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

const records: [string, { published?: string; updated: string }][] = [
  ...Object.entries(PAGE_DATES),
  ...POSTS.map((p) => [`/blogs/${p.slug}`, p] as [string, typeof p]),
  ...ERROR_GUIDES.map((g) => [`/json-errors/${g.slug}`, g] as [string, typeof g]),
  ...TOOL_PAGES.map((p) => [`/tools/${p.slug}`, p] as [string, typeof p]),
];

test('every page has a real ISO date, never before it was published', () => {
  for (const [path, { published, updated }] of records) {
    assert.ok(isDay(updated), `${path}: updated ${updated}`);
    if (published !== undefined) {
      assert.ok(isDay(published), `${path}: published ${published}`);
      assert.ok(published <= updated, `${path}: updated ${updated} before published ${published}`);
    }
  }
  // Pages that show a publication date must have one.
  for (const g of ERROR_GUIDES) assert.ok(isDay(g.published), g.slug);
  for (const path of ['/integrate', '/resources/json-reference', '/resources/json-examples'] as const) assert.ok(isDay(PAGE_DATES[path].published), path);
});

test('dates format and compare as days', () => {
  assert.equal(formatDate('2026-10-14'), 'October 14, 2026');
  assert.equal(formatDate('2026-01-01'), 'January 1, 2026');
  assert.equal(latest(['2026-10-13', '2026-10-24', '2026-10-15']), '2026-10-24');
});
