// Error-boundary behavior when a render crashes during a large paste. Ported
// from rv/d/error3.mjs (two scenarios, run in every engine).
import { defaults, test } from '../../lib/api.mjs';
import { until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 900, tags: ['errors'], allowErrors: true, timeout: 120_000 });

const PR26_ERROR = 'PR #26: the error screen says whether the open JSON is still saved';
const BIG = JSON.stringify(Array.from({ length: 60_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], ok: true })));

async function crash(t, savedBefore) {
  const { page } = t;
  await t.context.route('**/_next/static/chunks/*.js', async (route) => {
    const response = await route.fetch();
    const source = new TextDecoder().decode(await response.body());
    const js = source.replaceAll('className:"statusbar"', 'className:(self.__boom?(()=>{throw Error("forced test error")})():"statusbar")');
    await route.fulfill({ response, body: js });
  });
  if (savedBefore) await t.context.addInitScript(() => localStorage.setItem('jf:doc', '{"old":1}'));
  await t.open('/');
  if (savedBefore) {
    await t.app.setText(page, '');
    await until(page, () => document.getElementById('input')?.value === '', null, { timeout: 5000 });
  } else {
    await page.evaluate(() => localStorage.removeItem('jf:doc'));
  }
  const savedAtCrash = await page.evaluate(() => localStorage.getItem('jf:doc'));
  await page.evaluate(() => (self.__boom = true));
  await t.app.setText(page, BIG);
  const lead = await until(page, () => document.querySelector('.error-screen .lead, .hero .lead')?.textContent ?? null, null, { timeout: 20_000 });
  const stored = await page.evaluate(() => localStorage.getItem('jf:doc')?.length ?? null);
  return { lead: String(lead ?? ''), savedAtCrash, stored };
}

test('error screen: a saved document remains recoverable after a crash', async (t) => {
  const result = await crash(t, true);
  t.check(/Try again, and if it keeps happening, reload the page/.test(result.lead), 'saved-document crash: retry and reload instructions', result);
  t.check(/JSON you had open here isn\'t saved in this browser/.test(result.lead), 'saved-document crash: the message names the current saved state', result, { known: PR26_ERROR });
});

test('error screen: an unsaved document is identified after a crash', async (t) => {
  const result = await crash(t, false);
  t.check(/Try again, and if it keeps happening, reload the page/.test(result.lead), 'unsaved-document crash: retry and reload instructions', result);
  t.check(/JSON you had open here isn\'t saved in this browser/.test(result.lead), 'unsaved-document crash: the message does not claim the JSON was saved', result, { known: PR26_ERROR });
});
