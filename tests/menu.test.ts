import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clean } from '../lib/analytics/events';

/*
 * The right-click menu (components/ContextMenu.tsx). Its behaviour in the
 * editors and views is checked in browsers; here, what it reports and that
 * every label it shows is translated.
 */

const en = JSON.parse(readFileSync('lib/i18n/en/ui.json', 'utf8')) as Record<string, string>;
const english = new Set(Object.values(en));

test('opening the menu reports its area from a fixed list, and items report the menu as their source', () => {
  assert.deepEqual(clean('feature_used', { feature: 'context_menu', value: 'input', via: 'pointer' }), { feature: 'context_menu', via: 'pointer', value: 'input' });
  assert.deepEqual(clean('feature_used', { feature: 'copy_value', via: 'context_menu' }), { feature: 'copy_value', via: 'context_menu' });
});

test('every label the menu shows is in the English dictionary (so it gets translated)', () => {
  const src = readFileSync('components/ContextMenu.tsx', 'utf8');
  // item('Label', …), item(x ? 'A' : 'B', …), label="Label", label={x ? 'A' : 'B'}, the footer and the area names.
  const labels = new Set<string>();
  for (const m of src.matchAll(/item\(\s*'([^']+)'/g)) labels.add(m[1]);
  for (const m of src.matchAll(/(?:item\(|label=\{)[\w.!]+ \? '([^']+)' : '([^']+)'/g)) [m[1], m[2]].forEach((l) => labels.add(l));
  for (const m of src.matchAll(/label="([^"]+)"/g)) labels.add(m[1]);
  for (const m of src.matchAll(/\bt\('([^']+)'\)/g)) labels.add(m[1]);
  for (const m of src.matchAll(/^\s+\w+: '([^']+)',$/gm)) labels.add(m[1]);
  const missing = [...labels].filter((l) => !english.has(l));
  assert.ok(labels.size > 30, `found ${labels.size} labels`);
  assert.deepEqual(missing, []);
});
