// Interactions while a 50 MB document is parsed in steps in the Tree view (port of
// selftest/resumable/interact.mjs): switch to another view, type a character, load another file, or run a
// command mid-parse. Each must end with the right document shown and a final status.
import { defaults, test } from '../../lib/api.mjs';
import { slow } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['slow'], slots: 'all', timeout: 240_000 });

const st = (page) => page.evaluate(() => (window.__vis('.statusbar .st')?.textContent ?? '').trim());
const stats = (page) => page.evaluate(() => (window.__vis('.statusbar .stats')?.textContent ?? '').trim());

/** Opens the tool in the Tree view, opens the 50 MB file and waits until it is parsing (with a percentage). */
async function startParsing(t, what) {
  await t.context.addInitScript(() => localStorage.setItem('jf:settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('jf:settings') || '{}'), view: 'tree' })));
  await t.open('/');
  await t.app.openFile(t.page, 'bench-50mb');
  const parsing = await t.page.waitForFunction(() => /^Parsing/.test(window.__vis('.statusbar .st')?.textContent.trim() ?? ''), null, { timeout: 30_000 * slow(t), polling: 25 }).then(() => true, () => false);
  t.check(parsing, `${what}: the status says Parsing… while the document parses`, await st(t.page));
  // Mid-parse: once a percentage shows, the parse is under way (the old check waited 300 ms).
  const progressing = await t.page.waitForFunction(() => /^Parsing…\s*[1-9]\d?\s*%/.test(window.__vis('.statusbar .st')?.textContent.trim() ?? ''), null, { timeout: t.budget(10_000), polling: 25 }).then(() => true, () => false);
  t.assert(progressing, `${what}: the action starts during a partial parse`, await st(t.page));
  t.log(`acting at: ${await st(t.page)}`);
}

/** The status once parsing is over. */
const waitFinal = (t, ms) =>
  t.page.waitForFunction(() => {
    const s = window.__vis('.statusbar .st')?.textContent.trim() ?? '';
    return s && !/^(Parsing|Ready)/.test(s) && s;
  }, null, { timeout: ms * slow(t), polling: 25 }).then((h) => h.jsonValue(), () => 'TIMEOUT');

test('switching to Table mid-parse ends valid with the 50 MB document', async (t) => {
  await startParsing(t, 'view');
  await t.app.view(t.page, 'table', { timeout: 60_000 * slow(t) });
  const s = await waitFinal(t, 60_000);
  t.check(/Valid JSON/.test(s), 'switching to Table mid-parse still ends valid', s);
  const shown = await t.page.waitForFunction(() => /meta|data|export/.test(document.querySelector('#view-table')?.textContent || ''), null, { timeout: 20_000 * slow(t), polling: 25 }).then(() => true, () => false);
  t.check(shown, 'the Table shows the new document');
  t.check(/3,180,144 nodes/.test(await stats(t.page)), "the node count is the 50 MB file's", await stats(t.page));
});

test('an edit mid-parse ends with the edited 50 MB document analysed', async (t) => {
  await startParsing(t, 'type');
  const box = await t.page.evaluate(() => {
    const b = window.__vis('.ed').getBoundingClientRect();
    return { x: b.left + 200, y: b.top + 40 };
  });
  await t.page.mouse.click(box.x, box.y);
  await t.page.keyboard.press('Control+Home');
  for (let i = 0; i < 3; i++) await t.page.keyboard.press('ArrowRight');
  await t.page.keyboard.insertText('Q');
  const s = await waitFinal(t, 90_000);
  t.check(/Valid JSON/.test(s), 'an edit mid-parse ends with the edited document analysed', s);
  const key = await t.page.waitForFunction(() => document.querySelector('#view-tree')?.textContent?.includes('mQeta'), null, { timeout: 20_000 * slow(t), polling: 25 }).then(() => true, () => false);
  t.check(key, 'the Tree shows the edited key (mQeta)');
});

test('another file loaded mid-parse replaces the 50 MB one', async (t) => {
  await startParsing(t, 'reload');
  await t.app.openFile(t.page, 'bench-1mb');
  const s = await waitFinal(t, 60_000);
  t.check(/Valid JSON/.test(s), 'another file loaded mid-parse ends valid', s);
  const second = await t.page.waitForFunction(() => /64,090 nodes/.test(window.__vis('.statusbar .stats')?.textContent ?? ''), null, { timeout: 20_000 * slow(t), polling: 25 }).then(() => true, () => false);
  // And stays so: the dropped first parse must not come back with its numbers once everything has settled.
  if (second) await t.app.waitValid(t.page, { timeout: 30_000 * slow(t) }).catch(() => {});
  await t.page.waitForFunction(() => !window.__vis('.sizes.stale') && !/…/.test(window.__vis('.sb-l')?.textContent ?? ''), null, { timeout: 30_000 * slow(t), polling: 25 }).catch(() => {});
  t.check(second && /64,090 nodes/.test(await stats(t.page)), "the stats are the second file's (the first parse was dropped)", await stats(t.page));
});

test('a command that needs nodes (Collapse all) finishes the parse at once', async (t) => {
  await startParsing(t, 'command');
  await t.app.command(t.page, 'Collapse all', { timeout: t.budget(10_000) });
  const s = await waitFinal(t, 30_000);
  t.check(/Valid JSON/.test(s), 'Collapse all mid-parse ends valid', s);
});
