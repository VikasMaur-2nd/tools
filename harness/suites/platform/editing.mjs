// Browser regressions for the shared helpers needed by the privacy ports.
import { defaults } from '../../lib/api.mjs';
import { MOD, test, waitVisible } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['platform'] });

test('paste replaces native text and Compare can switch back through its narrow picker', async (t) => {
  await t.page.goto(t.base + '/', { waitUntil: 'load' });
  await waitVisible(t.page, '.app .ed.hl-on');
  const first = '{"answer":42}';
  await t.app.paste(t.page, first);
  await t.app.waitValid(t.page);
  t.check(await t.app.docHash(t.page) === t.app.hashText(first), 'a small paste inserts the whole document');
  const next = '{"answer":43,"name":"Ada"}';
  await t.page.focus('#input');
  await t.page.keyboard.press(`${MOD}+a`);
  await t.app.paste(t.page, next);
  await t.app.waitValid(t.page);
  t.check(await t.app.docHash(t.page) === t.app.hashText(next), 'a selected document is replaced once');
  await t.app.view(t.page, 'compare');
  t.check(await t.page.locator('.app:visible #input2').isVisible(), 'Compare opens when the tab bar becomes a picker');
  // The panes must finish their first layout before reversing the resize.
  await t.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await t.app.view(t.page, 'format');
  t.check(await t.app.docHash(t.page) === t.app.hashText(next), 'the picker returns to Format with the document intact');
});
