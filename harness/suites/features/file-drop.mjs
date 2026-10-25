// Files into JSON boxes: /integrate's builder (Open file, drag and drop, one document and Compare two, a
// 5 MB file, a real file drag in Chromium) and the viewer's Compare editor (Open file in its menu, drops
// on its column and on the input). Ported from selftest/filedrop/check.mjs (27 checks in Chromium, 25
// elsewhere). Drags are script-made DragEvents with real Files: what the page's handlers see.
import { defaults, test } from '../../lib/api.mjs';
import { loadavg } from 'node:os';
import { stalls } from '../../lib/perf.mjs';
import { MOD, doc, docOf, docText, inputText, poll, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 900, tags: ['files'] });

const small = docText('small.json');
const other = docText('other.json');

/** /integrate with the builder in view and both of its editors loaded. */
async function builder(t) {
  const { page } = t;
  await t.open('/integrate', { tool: false, timeout: 60_000 });
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  t.assert(await until(page, () => document.querySelectorAll('.link-builder .ed.hl-on').length === 2, null, { timeout: 60_000 }), 'the builder is ready');
}
const boxText = (page, i = 0) => page.evaluate((i) => document.querySelectorAll('.link-builder .lb-input .ed textarea')[i]?.value ?? null, i);
const waitBox = (page, want, i = 0, timeout = 8000) => poll(async () => (await boxText(page, i)) === want, { timeout });
const status = (page, i = 0) => page.evaluate((i) => document.querySelectorAll('.lb-check')[i]?.textContent?.trim() ?? '', i);
const href = (page) => page.evaluate(() => document.querySelector('.lb-open')?.getAttribute('href') ?? '');
/** The link once it carries `want` as document k. */
const waitLink = (page, want, k = 'a', timeout = 8000) =>
  poll(async () => {
    const h = await href(page);
    try {
      return h && docOf(h, k) === want ? h : null;
    } catch {
      return null;
    }
  }, { timeout });
const openFile = async (page, file, button = page.locator('.lb-file').first()) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(file);
};
const hints = (page) => page.evaluate(() => ({ hints: document.querySelectorAll('.lb-drop-hint').length, over: [...document.querySelectorAll('.lb-drop')].map((d) => d.classList.contains('lb-over')) }));

/** Drop-area state once `ok(state)` holds (React renders after the drag events), or the last state after `ms`. */
async function waitHints(page, ok, ms = 3000) {
  const end = Date.now() + ms;
  let h = await hints(page);
  while (!ok(h) && Date.now() < end) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    h = await hints(page);
  }
  return h;
}
/** State after two frames, for checks that something does NOT appear. */
const settledHints = async (page) => (await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))), hints(page));

/** A drag event of `type` on sel ('box:N' for the Nth box's editor), carrying a file or text. */
const drag = (page, type, sel, name, text, kind = 'file') =>
  page.evaluate(
    ([type, sel, name, text, kind]) => {
      const dt = (window.__dt ??= new DataTransfer());
      if (type === 'dragenter' && !dt.items.length) {
        if (kind === 'file') dt.items.add(new File([text], name, { type: 'application/json' }));
        else dt.setData('text/plain', text);
      }
      const box = /^box:(\d)$/.exec(sel);
      const el = box ? document.querySelectorAll('.lb-input > .lb-drop')[+box[1]].querySelector('.ed') : document.querySelector(sel);
      const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      const res = { prevented: e.defaultPrevented, effect: dt.dropEffect };
      if (type === 'drop') window.__dt = null;
      return res;
    },
    [type, sel, name, text, kind],
  );

test('builder: Open file, undo, a CSV file, URL mode', async (t) => {
  const { page } = t;
  await builder(t);
  const sample = await boxText(page);
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.lb-file')].map((b) => [b.textContent.trim(), b.getAttribute('aria-label')]));
  t.check(buttons.length === 1 && buttons[0][0] === 'Open file', 'one document: one Open file button', buttons);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.lb-file').first().click()]);
  const accept = await page.evaluate(() => document.querySelector('.lb-drop input[type=file]')?.accept);
  t.check(/\.json/.test(accept) && /\.csv/.test(accept), 'the picker offers JSON and the formats the viewer converts', accept);
  await chooser.setFiles(doc('small.json'));
  t.check(await waitBox(page, small), 'Open file puts the file in the box', (await boxText(page))?.slice(0, 60));
  await until(page, () => /Valid JSON/.test(document.querySelector('.lb-check')?.textContent ?? ''), null, { timeout: 8000 });
  t.check(!!(await waitLink(page, small)), 'the link carries the file', (await href(page)).slice(0, 60));
  t.check(await page.evaluate(() => !!document.activeElement?.closest('.lb-drop')), 'the box has focus after opening');
  // Undo brings the sample back.
  await page.keyboard.press(`${MOD}+z`);
  t.check(await waitBox(page, sample, 0, 3000), 'undo brings back what was there', (await boxText(page))?.slice(0, 40));

  // CSV: converted to JSON, as the viewer's Open file does.
  await openFile(page, doc('people.csv'));
  const csv = await poll(async () => { const x = await boxText(page); return x && x.includes('"Ada"') ? x : null; }, { timeout: 8000 });
  let first = null;
  try {
    first = JSON.parse(csv)[0];
  } catch {}
  t.check(first?.name === 'Ada' && first?.age === 36, 'a CSV file opens as JSON', csv?.slice(0, 80));

  // URL mode: a file switches the box to JSON.
  await page.getByRole('radio', { name: 'URL' }).first().click();
  await until(page, () => !!document.querySelector('.lb-drop input[type=url]'), null, { timeout: 5000 });
  await openFile(page, doc('small.json'));
  const mode = () => page.evaluate(() => document.querySelector('.lb-drop [role=radio][aria-checked=true]')?.textContent);
  const json = await poll(async () => (await mode()) === 'JSON' && (await boxText(page)) === small, { timeout: 8000 });
  t.check(json, 'URL mode: a file switches the box to JSON with the file in it', await mode());
});

test('builder: dropping files on Compare two', async (t) => {
  const { page } = t;
  await builder(t);
  await page.getByRole('radio', { name: 'Compare two' }).click();
  await until(page, () => document.querySelectorAll('.link-builder .lb-input .ed.hl-on').length === 2, null, { timeout: 10_000 });
  const two = await page.evaluate(() => [...document.querySelectorAll('.lb-file')].map((b) => b.getAttribute('aria-label')));
  t.check(two.length === 2 && /Original/.test(two[0]) && /Modified/.test(two[1]), 'Compare two: an Open file for each box', two);
  const origBefore = await boxText(page, 0);
  // Into the page: both boxes show where to drop.
  await drag(page, 'dragenter', 'h1', 'other.json', other);
  let h = await waitHints(page, (x) => x.hints === 2);
  t.check(h.hints === 2 && !h.over.some(Boolean), 'files over the page: both boxes show a drop area', h);
  // Over a heading: no drop there. (Only Firefox lets a script-made drag event keep a dropEffect; the
  // real drag in Chromium is the next test.)
  const outside = await drag(page, 'dragover', 'h1', 'other.json', other);
  t.check(outside.prevented && (t.engine !== 'firefox' || outside.effect === 'none'), 'outside the boxes a drop is refused (the page stays)', outside);
  // Over the Modified box.
  await drag(page, 'dragenter', 'box:1', 'other.json', other);
  const inside = await drag(page, 'dragover', 'box:1', 'other.json', other);
  h = await waitHints(page, (x) => x.over[1] && !x.over[0]);
  t.check(inside.prevented && (t.engine !== 'firefox' || inside.effect === 'copy'), 'over a box a drop is a copy', inside);
  t.check(h.over[1] && !h.over[0], 'the box under the pointer is marked', h);
  await drag(page, 'drop', 'box:1', 'other.json', other);
  await drag(page, 'dragleave', 'h1', 'other.json', other);
  t.check(await waitBox(page, other, 1), 'the dropped file opens in the Modified box', (await boxText(page, 1))?.slice(0, 40));
  h = await waitHints(page, (x) => x.hints === 0);
  t.check((await boxText(page, 0)) === origBefore, 'the Original box keeps its text');
  t.check(h.hints === 0, 'the drop areas go away after the drop', h);
  t.check(!!(await waitLink(page, other, 'b')), 'the comparison link carries the dropped file as b');
  // A drag that leaves the window: the drop areas go away.
  await drag(page, 'dragenter', 'h1', 'other.json', other);
  await drag(page, 'dragleave', 'h1', 'other.json', other);
  h = await waitHints(page, (x) => x.hints === 0);
  t.check(h.hints === 0, 'a drag that leaves the page clears the drop areas', h);
  // Text dragged (not a file): no drop areas, the editor's own text drop is left alone.
  await page.evaluate(() => (window.__dt = null));
  await drag(page, 'dragenter', '.lb-drop .ed', '', 'some text', 'text');
  h = await settledHints(page);
  const textOver = await drag(page, 'dragover', '.lb-drop .ed', '', 'some text', 'text');
  t.check(h.hints === 0 && !textOver.prevented, 'dragged text: no drop areas, left to the browser', { h, textOver });
  await page.evaluate(() => (window.__dt = null));
});

// The longest stall is wall-clock: the test runs alone, and t.budget stretches the limit on a busy machine.
test('builder: a 5 MB one-line file', { slots: 'all' }, async (t) => {
  const { page } = t;
  const bigFile = doc('user-5mb.json');
  const big = docText('user-5mb.json');
  await builder(t);
  // Main-thread stalls while it opens, checks and makes the link: the page keeps responding.
  const t0 = Date.now();
  const { result: bigLink, maxGap } = await stalls(page, async () => {
    await openFile(page, bigFile);
    return poll(async () => { const x = await href(page); return x.length > 500_000 ? x : null; }, { timeout: 30_000 });
  });
  const took = Date.now() - t0;
  let carried = false;
  try {
    carried = !!bigLink && docOf(bigLink) === big;
  } catch {}
  t.check(carried, 'a 5 MB file: the link carries it', { took, len: bigLink?.length });
  // (The old script read the status the moment the link appeared; the check finishes in steps, so wait for it.)
  const st = await until(page, () => /Valid JSON/.test(document.querySelector('.lb-check')?.textContent ?? '') && document.querySelector('.lb-check').textContent, null, { timeout: 30_000 });
  t.check(/Valid JSON/.test(st || ''), 'a 5 MB file: checked valid', st || (await status(page)));
  const limit = Math.round(t.budget(400));
  t.check(maxGap < limit, 'a 5 MB file: no long freeze', { longest: Math.round(maxGap), limit, load: loadavg()[0].toFixed(1) });
  t.log(`5 MB file: link in ${took} ms, longest stall ${Math.round(maxGap)} ms (limit ${limit} ms)`);
});

test('builder: a real file drag from outside the browser', { engines: ['chromium'] }, async (t) => {
  const { page } = t;
  await builder(t);
  // DevTools Input.dispatchDragEvent: the drag a file from the desktop makes.
  const cdp = await page.context().newCDPSession(page);
  const at = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const data = { items: [], files: [doc('other.json')], dragOperationsMask: 1 };
  const realDrop = async (p) => {
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: p.x, y: p.y, data });
  };
  await page.locator('.lb-drop .ed').first().scrollIntoViewIfNeeded();
  const url0 = page.url();
  const before = await boxText(page);
  // Outside the boxes: nothing happens, the page stays. (Headless Chromium never navigates on an
  // unhandled file drop, so this shows the box is untouched and the drop areas are gone.)
  await realDrop(await at('.lb-result .lb-preview'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  t.check(page.url() === url0 && (await hints(page)).hints === 0 && (await boxText(page)) === before, 'real drag, dropped outside a box: the page stays as it was', page.url());
  await realDrop(await at('.lb-drop .ed'));
  t.check(await waitBox(page, other), 'real drag, dropped on the box: the file opens in it', (await boxText(page))?.slice(0, 40));
});

test("viewer: the Compare editor's Open file and drops", { allowErrors: true }, async (t) => {
  const { page } = t;
  await t.open('/');
  await page.getByRole('tab', { name: 'Compare' }).click();
  await until(page, () => document.querySelector('.pane-cmp') && !document.querySelector('.pane-cmp').hidden, null, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Modified document options' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Open file' }).click()]);
  await chooser.setFiles(doc('other.json'));
  t.check(await poll(async () => (await inputText(page, 'input2')) === other, { timeout: 8000 }), "viewer: the Compare editor's Open file loads the modified document", (await inputText(page, 'input2'))?.slice(0, 40));
  const appDrop = (sel, name, text) =>
    page.evaluate(
      ([sel, name, text]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: 'application/json' }));
        const el = window.__vis(sel);
        for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      [sel, name, text],
    );
  await appDrop('.pane-cmp .ed', 'small.json', small);
  t.check(await poll(async () => (await inputText(page, 'input2')) === small, { timeout: 8000 }), 'viewer: a file dropped on the Compare column loads as the modified document');
  await appDrop('#input', 'other.json', other);
  t.check(await poll(async () => (await inputText(page)).includes('"modified"'), { timeout: 8000 }), 'viewer: a file dropped on the input loads as the original', (await inputText(page))?.slice(0, 40));
  // (WebKit's "ResizeObserver loop" warning on opening Compare is on main too.)
  const errs = t.errors.filter((e) => !/ResizeObserver loop/.test(e));
  t.check(!errs.length, 'no page errors', errs.slice(0, 3));
});
