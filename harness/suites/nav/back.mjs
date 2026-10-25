// Leaving the tool and coming back (client navigation, history back/forward) with documents of every
// size. Next.js keeps the page you left hidden in the DOM and remounts the tool when you return, so
// the engine, editors and views are rebuilt on DOM they already changed.
import { defaults, test } from '../../lib/api.mjs';
import { stalls } from '../../lib/perf.mjs';

defaults({ engines: 'all', tags: ['nav'], timeout: 180_000 });

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';


/** Longest main-thread stall over `ms` while the page sits idle. */
const stallOver = async (page, ms) => (await stalls(page, () => page.waitForTimeout(ms))).maxGap;

/** Back to `path` after history.back(), tool ready again. */
async function backTo(t, path) {
  const engines = await t.app.engineCount(t.page);
  await t.page.evaluate(() => history.back());
  await t.page.waitForFunction((p) => location.pathname === p, path, { timeout: 60_000, polling: 50 });
  if (path !== '/privacy') await t.app.waitEngine(t.page, { after: engines, timeout: 60_000 });
}

const DOCS = { tiny: 'rows-100', '1.7mb': 'rows-15000', '6.9mb': 'rows-60000', pretty10: 'bench-10mb-pretty', '25mb': 'bench-25mb' };

for (const [name, doc] of Object.entries(DOCS)) {
  const big = name === 'pretty10' || name === '25mb';
  // Stall limits are wall-clock: documents big enough to stall run alone, not next to other heavy checks.
  const alone = name === '6.9mb' || big;
  test(`${name} document survives /privacy, Back and Forward`, { ...(alone ? { slots: 'all' } : {}), ...(big ? { tags: ['slow'], timeout: 600_000 } : {}) }, async (t) => {
    const { page } = t;
    let closed = false;
    page.on('close', () => (closed = true));
    await t.open('/');
    await t.app.openFile(page, doc);
    const s0 = await t.app.waitValid(page, { timeout: 120_000 });
    t.assert(/^Valid JSON/.test(s0), `${name}: loaded`, s0);
    const h0 = await t.app.docHash(page);
    t.check(!!h0, `${name}: read the document`, h0);
    for (let round = 1; round <= 2; round++) {
      await t.app.navigate(page, '/privacy');
      const gap = await stallOver(page, 2500);
      t.check(gap < t.budget(1500), `${name} #${round}: /privacy stays responsive`, `longest stall ${Math.round(gap)} ms`);
      await backTo(t, '/');
      const s1 = await t.app.waitValid(page, { timeout: 120_000 }).catch((e) => String(e).slice(0, 100));
      // Seen once on 2026-10-25 (after PR #25): Firefox's 25 MB document wasn't valid again within 2 min
      // of the second Back (15 of 16 checks passed). A slow re-parse or a Firefox-only hang: investigate.
      const ff25 = t.engine === 'firefox' && name === '25mb' && round === 2 ? { known: 'Firefox: 25 MB not valid again after the second Back within 2 min (investigate)' } : {};
      t.check(!closed && /^Valid JSON/.test(s1), `${name} #${round}: back on / and valid`, s1, ff25);
      if (closed) return;
      t.check((await t.app.docHash(page)) === h0, `${name} #${round}: same document after Back`);
      if (round === 1) {
        await page.evaluate(() => history.forward());
        await page.waitForURL('**/privacy', { timeout: 60_000 });
        await backTo(t, '/');
        const s2 = await t.app.waitValid(page, { timeout: 120_000 }).catch((e) => String(e).slice(0, 100));
        t.check(/^Valid JSON/.test(s2), `${name} #${round}: Forward then Back`, s2);
      }
    }
    for (const v of ['tree', 'table', 'graph', 'convert', 'format']) {
      const ok = await t.app.view(page, v).then(() => true, () => false);
      t.check(ok, `${name}: ${v} view opens after Back`);
    }
    // Typing and undo still work on the remounted editor.
    await page.locator('.app:visible .ed').first().click({ position: { x: 120, y: 30 } });
    await page.keyboard.press(`${MOD}+Home`);
    await page.keyboard.insertText(' ');
    const he = await waitHash(t, (h) => h !== h0);
    t.check(he && Number(he.split(':')[0]) === Number(h0.split(':')[0]) + 1, `${name}: typing works after Back`, { he, h0 });
    await page.locator('.app:visible .ed').first().click({ position: { x: 120, y: 30 } });
    await page.keyboard.press(`${MOD}+z`);
    const hu = await waitHash(t, (h) => h === h0);
    t.check(hu === h0, `${name}: undo works after Back`, { hu, h0 });
  });
}

/** Reads the document hash until `ok(hash)` (edits apply asynchronously in the big-document editor). */
async function waitHash(t, ok, ms = 15_000) {
  const end = Date.now() + ms;
  let h;
  do {
    h = await t.app.docHash(t.page);
    if (ok(h)) return h;
    await t.page.waitForTimeout(200);
  } while (Date.now() < end);
  return h;
}

test('Compare keeps the modified document after /privacy and Back', async (t) => {
  const { page } = t;
  await t.open('/');
  await t.app.openFile(page, 'rows-15000');
  await t.app.waitValid(page, { timeout: 120_000 });
  await t.app.view(page, 'compare');
  await page.locator('#input2').waitFor({ state: 'attached' });
  await t.app.setText(page, JSON.stringify({ hello: 'compare', n: [1, 2, 3] }), 'input2');
  await page.waitForFunction(() => /compare/.test(document.querySelector('#input2')?.closest('.ed')?.textContent ?? ''), null, { timeout: 30_000 });
  await t.app.navigate(page, '/privacy');
  await backTo(t, '/');
  const view = await page
    .waitForFunction(() => !!window.__vis('#view-compare'), null, { timeout: 30_000, polling: 50 })
    .then(() => true, () => false);
  t.check(view, 'still in Compare after Back');
  const txt = await page.evaluate(() => window.__vis('#input2')?.closest('.ed')?.textContent ?? '');
  t.check(/compare/.test(txt), 'modified document still there', txt.slice(0, 80));
});

test('a tool page with a 6.9 MB document: /privacy stays responsive and Back works', { slots: 'all' }, async (t) => {
  const { page } = t;
  let closed = false;
  page.on('close', () => (closed = true));
  await t.open('/tools/json-validator');
  await t.app.openFile(page, 'rows-60000');
  await t.app.waitValid(page, { timeout: 120_000 });
  await t.app.navigate(page, '/privacy');
  const gap = await stallOver(page, 2500);
  t.check(gap < t.budget(1500), '/privacy responsive', `longest stall ${Math.round(gap)} ms`);
  await backTo(t, '/tools/json-validator');
  // A tool page loads its own sample on every visit (by the owner's choice), so only liveness counts here.
  const s = await t.app.waitParsed(page, { timeout: 60_000 }).catch((e) => String(e).slice(0, 100));
  t.check(!closed, 'alive after Back', s);
});

test('/integrate: the link builder keeps its document after /privacy and Back', async (t) => {
  const { page } = t;
  await t.open('/integrate', { tool: false });
  const box = page.locator('.link-builder .ed').first();
  await box.scrollIntoViewIfNeeded();
  await box.click();
  await page.keyboard.press(`${MOD}+a`);
  const big = t.fixtureText('rows-15000');
  await page.evaluate((text) => {
    const ta = document.querySelector('.link-builder .ed textarea');
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (!e.clipboardData) Object.defineProperty(e, 'clipboardData', { value: dt });
    // A synthetic paste doesn't insert text by itself: do what the browser would when nothing handled it.
    if (ta.dispatchEvent(e)) {
      ta.setRangeText(text, 0, ta.value.length, 'end');
      ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: text, bubbles: true }));
    }
  }, big);
  // The builder's link encodes its whole document (its textarea holds only a passage of a big one, and
  // innerText changes with line wrapping), so the link is the document's identity here.
  const link = () => (window.__vis('.link-builder')?.textContent.match(/#a=[\w-]{200,}/) || [''])[0];
  const before = await page.waitForFunction(link, null, { timeout: t.budget(30_000), polling: 100 }).then((h) => h.jsonValue(), () => '');
  t.assert(before, 'the builder made a link for the pasted document');
  await t.app.navigate(page, '/privacy');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.pathname === '/integrate', null, { timeout: 60_000 });
  const after = await page
    .waitForFunction((b) => {
      const l = (window.__vis('.link-builder')?.textContent.match(/#a=[\w-]{200,}/) || [''])[0];
      return l === b && l;
    }, before, { timeout: t.budget(30_000), polling: 100 })
    .then((h) => h.jsonValue(), () => page.evaluate(link));
  t.check(after === before, 'builder box keeps its document after Back', { before: before.slice(0, 40), after: after.slice(0, 40), same: after === before });
});

// Measured 2026-10-25 at load 2: main freezes 17.9 s on the switch to Format, PR #26 takes 0.13 s.
test('leaving Compare with a 6.9 MB modified document does not stall', { slots: 'all', known: (engine) => (engine === 'webkit' ? undefined : "PR #26: on main, Compare's hidden 6.9 MB editor freezes the page ~18 s when you switch to Format") }, async (t) => {
  const { page } = t;
  await t.open('/');
  await t.app.openFile(page, 'rows-100');
  await t.app.waitValid(page);
  await t.app.view(page, 'compare');
  await t.app.paste(page, t.fixtureText('rows-60000'), 'input2');
  // Wait until Compare has taken the document: its summary counts the added records.
  await page.waitForFunction(() => /\+\s?[1-9][\d,.\s]*added/.test(window.__vis('.app')?.textContent ?? ''), null, { timeout: 120_000, polling: 100 });
  const { maxGap } = await stalls(page, async () => {
    await t.app.view(page, 'format');
    await page.waitForTimeout(3000);
  });
  t.check(maxGap < t.budget(1500), 'leaving Compare stays responsive', `longest stall ${Math.round(maxGap)} ms`);
});
