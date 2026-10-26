// What the error screen says about the document when the app crashes while rendering. Ported from
// rv/d/error3.mjs, whose two scenarios printed what the screen said (main and PR #26 compared by eye);
// here they are checks. The status bar throws on its next render once window.__boom is set (its chunk
// is patched in flight).
import { defaults, test } from '../../lib/api.mjs';
import { until } from './_helpers.mjs';

// The forced crash logs errors on purpose.
defaults({ engines: 'all', width: 1280, height: 900, tags: ['errors'], allowErrors: true, timeout: 120_000 });

const SAVED = 'Your JSON is saved in this browser. Try again, and if it keeps happening, reload the page.';
const UNSAVED = "Try again, and if it keeps happening, reload the page. JSON you had open here isn't saved in this browser, so you may need to paste or open it again.";
// About 3.2 MB: over the 2.5 million characters the tool saves.
const BIG = JSON.stringify(Array.from({ length: 60_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], ok: true })));

/** Pastes `text` into a tool whose status bar then throws; returns what the screen says and what is saved. */
async function crash(t, { savedBefore, text }) {
  const { page } = t;
  let patched = 0;
  await t.context.route('**/_next/static/chunks/*.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const js = source.replaceAll('className:"statusbar"', 'className:(self.__boom?(()=>{throw Error("forced test error")})():"statusbar")');
    if (js !== source) patched++;
    await route.fulfill({ response, body: js });
  });
  // A document saved by an earlier visit (only on the first load of this tab).
  if (savedBefore) await t.context.addInitScript(() => {
    if (!sessionStorage.getItem('x')) {
      sessionStorage.setItem('x', '1');
      localStorage.setItem('jf:doc', '{"old":1}');
    }
  });
  await t.open('/');
  t.assert(patched > 0, 'the status bar can be made to throw');
  // An empty editor first, so the paste re-renders the whole app, which then throws. (Saving the empty
  // editor waits 800 ms: the old document is still saved when the crash comes.)
  if (savedBefore) {
    await t.app.setText(page, '');
    await until(page, () => !!window.__vis('.app.is-empty'), null, { timeout: 5000 });
  }
  const savedAtCrash = await page.evaluate(() => localStorage.getItem('jf:doc'));
  await page.evaluate(() => (self.__boom = true));
  await t.app.setText(page, text);
  const lead = await until(page, () => document.querySelector('.error-screen .lead, .hero .lead')?.textContent ?? null, null, { timeout: 20_000 });
  t.assert(lead, 'the error screen shows');
  return { lead, savedAtCrash };
}
const stored = (page, want) => until(page, (n) => (localStorage.getItem('jf:doc')?.length ?? null) === n, want, { timeout: 5000 }).then(() => page.evaluate(() => localStorage.getItem('jf:doc')?.length ?? null));

test('a 3 MB paste over a saved document: the screen says the JSON is not saved', async (t) => {
  const r = await crash(t, { savedBefore: true, text: BIG });
  t.check(r.savedAtCrash === '{"old":1}', 'a document was saved when the crash came', r.savedAtCrash);
  // The empty editor's save removes the old copy; 3 MB is too big to save.
  const n = await stored(t.page, null);
  t.check(n === null, 'nothing is saved afterwards', n);
  t.check(r.lead === UNSAVED, "the screen says the JSON you had open isn't saved", r.lead);
});

test('a small first paste: the screen says the JSON is saved, and it is', async (t) => {
  const r = await crash(t, { savedBefore: false, text: '{"fresh":true}' });
  t.check(r.savedAtCrash === null, 'nothing was saved when the crash came', r.savedAtCrash);
  // The tool saves the document as it unmounts.
  const n = await stored(t.page, 14);
  t.check(n === 14, 'the pasted document is saved', n);
  t.check(r.lead === SAVED, 'the screen says the JSON is saved', r.lead);
});
