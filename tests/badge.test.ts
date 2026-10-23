import test from 'node:test';
import assert from 'node:assert/strict';
import { snippet } from '../lib/badge';

/* The buttons around a link that /integrate's builder and the viewer's Share menu copy. */

const href = 'https://tools.vikasmaur.com/#a=QUJD&view=tree';

test('the link alone, or a button around it in Markdown or HTML', () => {
  assert.equal(snippet('link', href, 'view'), href);
  assert.equal(
    snippet('markdown', href, 'view'),
    `[![View in Tool Kumar](https://tools.vikasmaur.com/badges/view-in-tool-kumar.svg)](${href})`,
  );
  assert.equal(
    snippet('html', href, 'view'),
    '<a href="https://tools.vikasmaur.com/#a=QUJD&amp;view=tree"><picture><source media="(prefers-color-scheme: dark)" srcset="https://tools.vikasmaur.com/badges/view-in-tool-kumar-dark.svg">' +
      '<img src="https://tools.vikasmaur.com/badges/view-in-tool-kumar.svg" alt="View in Tool Kumar" width="158" height="28"></picture></a>',
  );
});

test('compare links get the Compare button; colours; another site for the images', () => {
  assert.match(snippet('markdown', href, 'compare'), /^\[!\[Compare in Tool Kumar\]\(https:\/\/tools\.vikasmaur\.com\/badges\/compare-in-tool-kumar\.svg\)\]/);
  assert.match(snippet('html', href, 'compare', 'white'), /^<a href="[^"]+"><img src="[^"]+compare-in-tool-kumar-dark\.svg" alt="Compare in Tool Kumar" width="180" height="28"><\/a>$/);
  assert.match(snippet('markdown', href, 'view', 'white'), /view-in-tool-kumar-dark\.svg/);
  assert.equal(snippet('markdown', 'http://localhost:3000/#a=x', 'view', 'auto', 'http://localhost:3000'), '[![View in Tool Kumar](http://localhost:3000/badges/view-in-tool-kumar.svg)](http://localhost:3000/#a=x)');
});
