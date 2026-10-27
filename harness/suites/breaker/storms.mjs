// Interaction storms while a 25 MB document is still loading: a paste, a second file, Undo, Clear,
// view switches, a theme switch, resizes, leaving the page and coming back. The newest action must win,
// the status must describe what the editor holds, every view must show that document, and nothing may
// throw. Plus two tabs of the tool side by side. Tagged slow.
import { readFileSync } from 'node:fs';
import { defaults, test } from '../../lib/api.mjs';
import { command, docHash, hashText, view } from '../../lib/app.mjs';
import { fixture } from '../../lib/fixtures.mjs';
import { load, openBytes, settled, slow, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['slow', 'breaker'], slots: 2, timeout: 600_000 });

const BIG = 'bench-25mb';
const SMALL = '{"small":true,"n":[1,2,3]}';

/** Starts opening the big file and waits until it is visibly loading ("Parsing…"). */
async function startBig(t) {
  const { page } = t;
  await page.locator('.app:visible input[type=file]').setInputFiles(fixture(BIG));
  return until(page, () => /^Parsing/.test(window.__vis('.sb-l')?.textContent ?? '') || null, null, { timeout: 30_000 });
}

/** The status settles on `text` (by raw size) and the editor holds exactly it. */
async function holds(t, text, what) {
  const { page } = t;
  const st = await settled(page, { raw: Buffer.byteLength(text), timeout: 240_000 * slow(t) });
  t.check(!!st, `${what}: the status settles on it`, await page.evaluate(() => window.__vis('.sb-l')?.textContent));
  t.check((await docHash(page, 'input', { timeout: 120_000 })) === hashText(text), `${what}: the editor holds exactly it`);
  return st;
}

/** Every view shows something for the open document (not stale, not the empty prompt). */
async function viewsShow(t, what) {
  const { page } = t;
  for (const v of ['tree', 'table', 'graph', 'format']) {
    await view(page, v, { timeout: 120_000 });
    const ok = await until(page, (v) => {
      const el = window.__vis(`#view-${v}`);
      if (!el || window.__vis('.view.stale')) return null;
      if (v === 'graph') return !!el.querySelector('canvas') && !/Building|Laying out/.test(el.innerText) || null;
      return el.innerText.trim().length > 10 || null;
    }, v, { timeout: 120_000 });
    t.check(!!ok, `${what}: the ${v} view shows the document`);
  }
}

test('a paste while the big file loads wins, and the big file never comes back', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await startBig(t), 'the big file is loading');
  await page.evaluate((s) => {
    const ta = window.__vis('#input');
    ta.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', s);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
    if (ta.dispatchEvent(ev)) {
      ta.setRangeText(s, 0, ta.value.length, 'end');
      ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: s, bubbles: true }));
    }
  }, SMALL);
  // (A paste into a selection-less editor inserts at the caret; select-all first is what users do.)
  const text = await page.evaluate(() => window.__vis('#input')?.value ?? null);
  t.log('editor after paste starts with', text?.slice(0, 60));
  await holds(t, SMALL, 'the pasted document');
  await viewsShow(t, 'after the paste');
});

test('a second file opened while the first loads wins', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await startBig(t), 'the big file is loading');
  await openBytes(page, 'second.json', SMALL);
  await holds(t, SMALL, 'the second file');
  // Long after the first file would have finished, it still hasn't replaced the second.
  await page.waitForTimeout(5000);
  t.check((await docHash(page)) === hashText(SMALL), 'the second file stays');
});

test('Clear while the big file loads leaves an empty editor', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await startBig(t), 'the big file is loading');
  await command(page, 'Clear editor');
  const ready = await until(page, () => /^Ready/.test(window.__vis('.sb-l')?.textContent ?? '') || null, null, { timeout: 60_000 });
  t.check(!!ready, 'the status says Ready');
  await page.waitForTimeout(5000);
  t.check(/^Ready/.test(await page.evaluate(() => window.__vis('.sb-l')?.textContent ?? '')), 'and stays Ready (the load was dropped)');
  t.check((await page.evaluate(() => window.__vis('#input')?.value ?? '')) === '', 'the editor is empty');
});

test('switching views, theme and window size during the load ends with every view showing the file', async (t) => {
  const { page } = t;
  await t.open('/');
  const want = readFileSync(fixture(BIG), 'utf8');
  t.assert(await startBig(t), 'the big file is loading');
  const sizes = [[1280, 800], [390, 844], [1600, 1000], [800, 600]];
  for (let i = 0; i < 8; i++) {
    await view(page, ['tree', 'table', 'graph', 'convert', 'compare', 'format'][i % 6], { timeout: 60_000 }).catch(() => {});
    await command(page, i % 2 ? 'Theme: dark' : 'Theme: light').catch(() => {});
    await page.setViewportSize({ width: sizes[i % 4][0], height: sizes[i % 4][1] });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await holds(t, want, 'the big file');
  await viewsShow(t, 'after the storm');
});

const fileName = (page) => page.evaluate(() => window.__vis('.fname')?.textContent.trim() ?? null);

test('Undo during the load cancels it: the earlier document and its name come back', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await load(page, SMALL, 'small.json'), 'a small document first');
  t.assert(await startBig(t), 'the big file is loading');
  await command(page, 'Undo');
  // The load is dropped and the small document is back (Redo would bring the big one).
  const st = await settled(page, { ready: true, timeout: 240_000 * slow(t) });
  const empty = /^Ready/.test(st?.msg ?? '');
  t.check(!empty, 'the editor is not left empty', st, { known: 'bug, timing-dependent (main: Chromium 2 of 4 runs; t3/optimize-json-memory-performance: Firefox 4 of 4): Undo during a load can leave the editor empty (BREAKER-REPORT F5)' });
  if (!empty) await holds(t, SMALL, 'the earlier document');
  t.check((await fileName(page)) === 'small.json', 'the file name is the earlier one again', await fileName(page), { known: 'bug: Undo during a load keeps the new file name (BREAKER-REPORT F5)' });
  await command(page, 'Redo');
  const want = readFileSync(fixture(BIG), 'utf8');
  if (!empty) await holds(t, want, 'Redo: the big file');
});

test('leaving for /privacy during the load and coming back: the file, or the earlier document under its own name', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await load(page, SMALL, 'small.json'), 'a small document first');
  const want = readFileSync(fixture(BIG), 'utf8');
  t.assert(await startBig(t), 'the big file is loading');
  await t.app.navigate(page, '/privacy');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.pathname === '/', null, { timeout: 60_000 });
  await t.app.waitEngine(page, { after: 1, timeout: 60_000 }).catch(() => {});
  const st = await settled(page, { ready: true, timeout: 240_000 * slow(t) });
  const big = st?.raw && st.raw.replace(/\D/g, '') === '238';
  const name = await fileName(page);
  t.log('after Back:', st, name);
  t.check(big, 'the opened file arrives after Back', st, { known: 'bug: leaving the page during a load drops the file (BREAKER-REPORT F5)' });
  if (big) await holds(t, want, 'the big file after Back');
  else t.check(name === 'small.json', 'otherwise the earlier document keeps its own name', name, { known: 'bug: the dropped file\'s name stays on the earlier document (BREAKER-REPORT F5)' });
});

test('two tabs: a document opened in one is what the other restores, and editing one never changes the other', async (t) => {
  const { page } = t;
  await t.open('/');
  const doc = JSON.stringify({ tab: 1, rows: Array.from({ length: 2000 }, (_, i) => ({ i, s: `row ${i}` })) });
  t.assert(await load(page, doc), 'tab 1 has the document');
  // A second tab of the same browser profile (same localStorage).
  // (The document is saved for other tabs a moment after it changes.)
  await until(page, (n) => (localStorage.getItem('jf:doc')?.length === n) || null, doc.length, { timeout: 10_000 });
  const second = await page.context().newPage();
  await t.app.open(second, t.base, '/');
  const restored = await settled(second, { raw: Buffer.byteLength(doc), timeout: 30_000 });
  t.check(!!restored, 'tab 2 restores the document tab 1 saved', await second.evaluate(() => window.__vis('.sb-l')?.textContent));
  await load(second, SMALL);
  t.check((await docHash(page)) === hashText(doc), 'tab 1 still holds its document after tab 2 changed');
  await page.reload();
  await t.app.waitEngine(page);
  const st = await settled(page, { timeout: 30_000 });
  t.log('after reloading tab 1:', st);
  const h = await docHash(page);
  t.check(h === hashText(SMALL) || h === hashText(doc), 'a reload restores one of the two documents, whole', h);
  await second.close();
});

test('a phone: a 10 MB file opens, every view shows it through the view menu, and the page fits the screen', { mobile: true, width: 390, height: 844 }, async (t) => {
  const { page } = t;
  await t.open('/');
  const want = readFileSync(fixture('bench-10mb'), 'utf8');
  await page.locator('.app:visible input[type=file]').setInputFiles(fixture('bench-10mb'));
  await holds(t, want, 'the 10 MB file');
  await viewsShow(t, 'on a phone');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - 390);
  t.check(overflow <= 1, 'no sideways scrolling', `${overflow}px wider`);
});
