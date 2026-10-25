// A big broken file opened in the Format view (analysed in the worker), then every view (port of
// selftest/viewstats/views.mjs): each shows the new document and the status keeps the error.
import { defaults, test } from '../../lib/api.mjs';
import { slow } from './_helpers.mjs';

defaults({ engines: ['chromium', 'firefox'], tags: ['slow'], timeout: 180_000 });

const VIEWS = [
  // [tab name, panel, what shows the document]
  ['Tree', 'tree', /meta|export|records|customers/],
  ['Table', 'table', /meta|export|records|customers/],
  ['Graph', 'graph', /\[canvas\]/],
  ['Format', 'format', /meta/],
];

test('a broken 10 MB file: every view shows it and the status keeps the error', async (t) => {
  const { page } = t;
  const k = slow(t);
  await t.open('/');
  await t.app.openFile(page, 'bench-10mb-broken');
  // Settled: not parsing, no "…" readout, and (a broken file) not valid. A valid status never matches, so it
  // times out and the check below shows it.
  const st = await t.app.waitStatus(page, /^(?!Parsing)(?!Ready)(?!Valid JSON)(?!.*…)./, { timeout: 90_000 * k }).catch(() => t.app.status(page));
  t.check(!/^(Valid JSON|Parsing|Ready)/.test(st), 'a broken file shows its error', st.slice(0, 120));
  for (const [name, id, shows] of VIEWS) {
    const tab = page.getByRole('tab', { name, exact: true });
    if (!t.check((await tab.count()) > 0, `a ${name} tab exists`)) continue;
    await tab.first().click();
    const shown = await page
      .waitForFunction(
        ([id, src]) => {
          const el = document.getElementById(`view-${id}`);
          const txt = el ? (el.textContent || '') + (el.querySelector('canvas') ? ' [canvas]' : '') : '';
          return new RegExp(src).test(txt);
        },
        [id, shows.source],
        { timeout: 30_000 * k, polling: 25 },
      )
      .then(() => true, () => false);
    t.check(shown, `${name} shows the new document`, await page.evaluate((id) => document.getElementById(`view-${id}`)?.textContent.slice(0, 80), id));
    const st2 = await t.app.status(page);
    t.check(!/^Valid JSON/.test(st2), `${name}: the status still shows the error`, st2.slice(0, 80));
  }
});
