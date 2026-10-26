// /integrate's link builder with the viewer's editor (port of selftest/resumable/ie/check.mjs): the JSON box and
// the read-only code box, checks as you type, link colours, a big paste, and a long minified line.
import { defaults, test } from '../../lib/api.mjs';
import { slow } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 900, timeout: 120_000 });

const status = (page) => page.evaluate(() => document.querySelector('.lb-check')?.textContent?.trim() ?? '');
const outText = (page) => page.evaluate(() => document.querySelectorAll('.link-builder .ed textarea')[1]?.value ?? '');
const outHtml = (page) => page.evaluate(() => document.querySelectorAll('.link-builder .ed-hl')[1]?.innerHTML ?? '');
const until = (page, fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms, polling: 25 }).then(() => true, () => false);
const checkIs = (page, src, ms) => until(page, (s) => new RegExp(s).test(document.querySelector('.lb-check')?.textContent?.trim() ?? ''), src, ms);

/** Opens /integrate and waits until the editor has taken over both boxes. */
async function openBuilder(t) {
  await t.open('/integrate', { tool: false });
  await t.page.locator('.link-builder').scrollIntoViewIfNeeded();
  const on = await until(t.page, () => document.querySelectorAll('.link-builder .ed.hl-on').length === 2, null, 15_000 * slow(t));
  t.assert(on, 'the editor takes over the JSON box and the code box', await t.page.evaluate(() => document.querySelectorAll('.link-builder .ed.hl-on').length));
  t.assert(await checkIs(t.page, 'Valid JSON', 15_000 * slow(t)), 'the sample is valid', await status(t.page));
  return t.page.locator('.link-builder .ed').first();
}

/** A synthetic paste of window[key] into the JSON box (the text is made in the page). */
const pasteInto = (page, key) =>
  page.evaluate((key) => {
    const ta = document.querySelector('.link-builder .ed textarea');
    const dt = new DataTransfer();
    dt.setData('text/plain', window[key]);
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: dt });
    ta.dispatchEvent(e);
  }, key);

test('the JSON box checks as you type, the code box is read-only and coloured, every format', async (t) => {
  const { page } = t;
  const k = slow(t);
  const box = await openBuilder(t);
  const hl = await page.evaluate(() => document.querySelector('.link-builder .ed-hl')?.innerHTML ?? '');
  t.check(/class="tk"/.test(hl) && /class="ts"/.test(hl), 'the JSON box has syntax colours');
  // The code box's colours come from a lazily loaded module: wait for them rather than reading at once.
  const coloured = (h) => /class="lk-d"/.test(h) && /class="lk-k"/.test(h) && /class="lk-p"/.test(h);
  let oh = await outHtml(page);
  for (const end = Date.now() + t.budget(10_000); !coloured(oh) && Date.now() < end; oh = await outHtml(page)) await page.waitForTimeout(50);
  t.check(coloured(oh), 'the code box colours Markdown and link parts');
  const before = await outText(page);
  t.check(before.startsWith('[![View in Tool Kumar]'), 'the code box holds the Markdown', before.slice(0, 40));

  // Typing: an error, then fixed.
  await box.click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' :');
  t.check(await checkIs(page, 'Ln \\d+, Col \\d+', 10_000 * k), 'an error shows where it is', await status(page));
  t.check(await until(page, () => !!document.querySelector('.link-builder .ed-hl .me'), null, 5000 * k), 'the error is marked in the box');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace');
  t.check(await checkIs(page, 'Valid JSON', 10_000 * k), 'fixed: valid again', await status(page));
  // Loose JSON: a trailing comma the viewer fixes.
  await page.keyboard.type(' ,');
  t.check(await checkIs(page, 'fixes 1 issue', 10_000 * k), 'loose JSON: the issues the viewer fixes', await status(page));
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  t.check(await until(page, (b) => document.querySelectorAll('.link-builder .ed textarea')[1]?.value === b, before, 10_000 * k), 'the link follows the document (the same again: the same link)');

  // The code box is read-only: typing, Enter, Backspace, undo, paste and cut change nothing (nor the JSON box).
  const json0 = await page.evaluate(() => document.querySelector('.link-builder .ed textarea').value);
  // The link is rebuilt (compressed, async) after earlier edits: take the baseline once it holds still.
  let before2 = await outText(page);
  for (let same = 0, end = Date.now() + t.budget(10_000); same < 3 && Date.now() < end; ) {
    await page.waitForTimeout(100);
    const now = await outText(page);
    same = now === before2 ? same + 1 : 0;
    before2 = now;
  }
  await page.locator('.link-builder .ed').nth(1).click({ position: { x: 200, y: 30 } });
  await page.keyboard.type('xyz');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => {
    const ta = document.querySelectorAll('.link-builder .ed textarea')[1];
    const dt = new DataTransfer();
    dt.setData('text/plain', 'PASTED');
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: dt });
    ta.dispatchEvent(e);
    ta.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
  });
  // (A frame for the events to land; the JSON box unchanged means no link update is on its way either.)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  const after2 = await outText(page);
  const json1 = await page.evaluate(() => document.querySelector('.link-builder .ed textarea').value);
  let at = 0;
  while (at < after2.length && after2[at] === before2[at]) at++;
  t.check(after2 === before2 && json1 === json0, 'the code box stays as it was (typing, Enter, Backspace, undo, paste, cut)', { at, was: before2.slice(Math.max(0, at - 20), at + 40), now: after2.slice(Math.max(0, at - 20), at + 40), jsonBoxChanged: json1 !== json0, status: await status(page) });

  // Formats: HTML and the link, coloured.
  await page.getByRole('radio', { name: 'HTML' }).click();
  t.check(await until(page, () => document.querySelectorAll('.link-builder .ed textarea')[1]?.value.startsWith('<a href="https://tools.vikasmaur.com/#a='), null, 10_000 * k), 'HTML in the code box', (await outText(page)).slice(0, 50));
  t.check(await until(page, () => { const h = document.querySelectorAll('.link-builder .ed-hl')[1]?.innerHTML ?? ''; return /class="lk-n">a</.test(h) && /lk-s">&amp;amp;</.test(h); }, null, 5000 * k), 'HTML tags and &amp; between pairs are coloured', (await outHtml(page)).slice(0, 300));
  await page.getByRole('radio', { name: 'Link', exact: true }).click();
  t.check(await until(page, () => document.querySelectorAll('.link-builder .ed textarea')[1]?.value.startsWith('https://tools.vikasmaur.com/#a='), null, 10_000 * k), 'the link in the code box', (await outText(page)).slice(0, 50));

  // The page's code colours links too.
  const docs = await page.evaluate(() => ({
    pre: document.querySelectorAll('.ig-docs .code .lk-k').length,
    inline: document.querySelectorAll('.ig-docs :not(pre) > code .lk-k').length,
    ph: document.querySelectorAll('.ig-docs .lk-ph').length,
  }));
  t.check(docs.pre >= 8 && docs.inline >= 6 && docs.ph === 3, "links in the page's code and text are coloured by part", docs);
});

test('a 10 MB paste into the JSON box: progress, the link, then typing at the start', { tags: ['slow'] }, async (t) => {
  const { page } = t;
  const k = slow(t);
  const box = await openBuilder(t);
  await page.getByRole('radio', { name: 'Markdown' }).click();
  const big = await page.evaluate(() => {
    window.__big = JSON.stringify(Array.from({ length: 70_000 }, (_, k) => ({ id: k, name: 'Customer ' + k, tags: ['a', 'b'], ok: k % 3 === 0, score: k / 7 })), null, 2);
    return window.__big.length;
  });
  // Every status the check shows, and the page's longest freeze.
  await page.evaluate(() => {
    const w = (window.__w = { gaps: [], seen: [] });
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (now - last > 50) w.gaps.push(Math.round(now - last));
      last = now;
      const st = document.querySelector('.lb-check')?.textContent?.trim() ?? '';
      if (w.seen[w.seen.length - 1] !== st) w.seen.push(st);
      if (!w.stop) setTimeout(tick, 10);
    };
    setTimeout(tick, 10);
  });
  await box.click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('Control+a');
  const t0 = Date.now();
  await pasteInto(page, '__big');
  const done = await until(page, () => (document.querySelector('.lb-preview a')?.getAttribute('href')?.length ?? 0) > 100_000 && /Valid JSON/.test(document.querySelector('.lb-check')?.textContent ?? ''), null, 60_000 * k);
  const took = Date.now() - t0;
  const w = await page.evaluate(() => {
    window.__w.stop = true;
    return window.__w;
  });
  t.check(done, `a ${(big / 1e6).toFixed(1)} MB paste: checked valid and the link made`, { took, status: await status(page) });
  t.check(w.seen.some((x) => /Checking/.test(x)), 'progress shows while it checks', w.seen.slice(0, 6));
  // (The editor's own work on a big paste is measured, not judged here.)
  t.log(`took ${took} ms, longest freeze ${Math.max(0, ...w.gaps)} ms, gaps ${JSON.stringify(w.gaps.slice(0, 14))}`);
  const rowsDrawn = await page.evaluate(() => document.querySelector('.link-builder .ed textarea').closest('.ed').querySelectorAll('.ed-gl > div').length);
  t.check(rowsDrawn > 5, 'the big document shows with line numbers', rowsDrawn);
  // (Coloured a moment after the link appears: up to ~200 ms in WebKit.)
  t.check(await until(page, () => /lk-d/.test(document.querySelectorAll('.link-builder .ed-hl')[1]?.innerHTML ?? ''), null, 5000 * k), 'the long link is coloured in the code box');

  // Typing in the big document: every key is taken (and how long each waited for its frame is logged).
  await page.keyboard.press('Control+Home');
  await page.evaluate(() => {
    window.__keys = [];
    addEventListener('keydown', (e) => { const t = e.timeStamp; requestAnimationFrame(() => setTimeout(() => window.__keys.push(Math.round(performance.now() - t)), 0)); }, { capture: true });
  });
  for (const [i, c] of [...'abc'].entries()) {
    await page.keyboard.type(c);
    await until(page, (n) => window.__keys.length > n, i, 10_000 * k);
  }
  const keys = await page.evaluate(() => window.__keys);
  t.check(keys.length === 3, 'keys in the big document are taken', keys);
  t.log(`keys in the big document, drawn after (ms; the first wakes the quiet view): ${JSON.stringify(keys)}`);
  const typed = await until(page, () => document.querySelector('.link-builder .ed-hl > div')?.textContent?.slice(0, 4) === 'abc[', null, 10_000 * k);
  t.check(typed, 'Ctrl+Home, then "abc": typed at the start', await page.evaluate(() => document.querySelector('.link-builder .ed-hl > div')?.textContent?.slice(0, 4)));
  const follows = await until(page, () => { const s = document.querySelector('.lb-check')?.textContent?.trim() ?? ''; return s && !/Valid JSON|Checking/.test(s); }, null, 30_000 * k);
  t.check(follows, 'and the check follows the edit', await status(page));
});

test('a 1.6 MB minified line keeps the JSON box at its width and draws only what shows', async (t) => {
  const { page } = t;
  const box = await openBuilder(t);
  await box.click({ position: { x: 300, y: 40 } });
  await page.keyboard.press('Control+a');
  const t0 = Date.now();
  await page.evaluate(() => (window.__line = JSON.stringify(Array.from({ length: 30_000 }, (_, k) => ({ id: k, name: 'Customer ' + k, tags: ['a', 'b'] })))));
  await pasteInto(page, '__line');
  await until(page, () => /Valid JSON/.test(document.querySelector('.lb-check')?.textContent ?? '') && (document.querySelector('.link-builder .ed-hl')?.textContent ?? '').includes('Customer 0'), null, 60_000 * slow(t));
  const lay = await page.evaluate(() => {
    const ed = document.querySelector('.link-builder .ed');
    return { width: Math.round(ed.getBoundingClientRect().width), drawn: ed.querySelector('.ed-hl').textContent.length };
  });
  t.check(lay.width < 1000 && lay.drawn > 0 && lay.drawn < 20_000, 'a long minified line: the box keeps its width and draws only what shows', { ...lay, ms: Date.now() - t0 });
});
