// Doubling a document by pasting it at its end, then undoing (ports of selftest/resumable/ux/append.mjs with
// MODE=double STEPS=10, and ux/undo.mjs). After each paste: the status settles with the doubled line count, the
// editor stays editable (the big-document editor past its thresholds, never the quiet view) and doesn't change
// later on its own. Then every Ctrl+Z takes back one paste. (The read-only state these once watched for was
// removed in PR #14: every document is editable now.)
import { defaults, test } from '../../lib/api.mjs';
import * as H from './_helpers.mjs';

defaults({ tags: ['slow'], slots: 'all', timeout: 600_000 });

/** The 600-user document, kept in the page (window.__text grows with every paste), and a freeze recorder. */
const SETUP = () => {
  window.__doc = JSON.stringify({ users: Array.from({ length: 600 }, (_, k) => ({ id: k, name: 'User ' + k, email: `u${k}@example.com`, roles: ['a', 'b'], active: k % 2 === 0 })) }, null, 2);
  window.__text = window.__doc;
  const w = (window.__w = { gaps: [] });
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (now - last > 50) w.gaps.push([Math.round(last), Math.round(now - last)]);
    last = now;
    setTimeout(tick, 10);
  };
  setTimeout(tick, 10);
  return { chars: window.__doc.length, lines: window.__doc.split('\n').length };
};

const state = (page) =>
  page.evaluate(() => {
    const m = window.__ed.mode();
    const lines = (window.__vis('.statusbar .stats')?.textContent || '').match(/([\d,]+) lines?/)?.[1];
    return { surface: m.surface, quiet: m.quiet, status: (window.__vis('.statusbar .st')?.textContent || '').trim().slice(0, 40), lines: lines ? +lines.replace(/,/g, '') : null };
  });

/** Waits until the stats show `lines` lines and the status no longer says Parsing…; true if they did. */
const settleAt = (page, lines, timeout) =>
  page
    .waitForFunction((n) => {
      const m = (window.__vis('.statusbar .stats')?.textContent || '').match(/([\d,]+) lines?/);
      return m && +m[1].replace(/,/g, '') === n && !/^Parsing/.test((window.__vis('.statusbar .st')?.textContent || '').trim());
    }, lines, { timeout, polling: 50 })
    .then(() => true, () => false);

/** The state, if it stays the same for `ms` (the old checks looked again 3 s later); else the state it changed to. */
async function stays(page, ms) {
  const first = await state(page);
  const changed = await page
    .waitForFunction((f) => {
      const m = window.__ed.mode();
      const lines = (window.__vis('.statusbar .stats')?.textContent || '').match(/([\d,]+) lines?/)?.[1];
      const now = { surface: m.surface, quiet: m.quiet, status: (window.__vis('.statusbar .st')?.textContent || '').trim().slice(0, 40), lines: lines ? +lines.replace(/,/g, '') : null };
      return JSON.stringify(now) !== JSON.stringify(f) && now;
    }, first, { timeout: ms, polling: 50 })
    .then((h) => h.jsonValue(), () => null);
  return { first, changed };
}

/**
 * Pastes the document at its end `steps` times (doubling it), checking each step, then undoes `undos` times.
 * `click`: click into the editor before each paste (ux/undo.mjs did; ux/append.mjs didn't).
 */
async function doubling(t, { steps, undos, click, maxChars = Infinity, freezes = false }) {
  const { page } = t;
  const k = H.slow(t);
  await H.installHelpers(page);
  await t.open('/');
  const base = await page.evaluate(SETUP);
  await H.pasteStored(page, '__doc', { whole: true });
  t.check(await settleAt(page, base.lines, 60_000 * k), 'the first paste settles', await state(page));
  const lines = [base.lines];
  let chars = base.chars;
  for (let s = 1; s <= steps; s++) {
    if (click) await page.locator('.ed:visible').first().click({ position: { x: 300, y: 80 } });
    await page.keyboard.press('Control+End');
    const before = await page.evaluate(() => performance.now());
    await page.evaluate(() => {
      window.__add = '\n' + window.__text;
      window.__text += window.__add;
    });
    await H.pasteStored(page, '__add');
    chars = chars * 2 + 1;
    lines.push(lines[s - 1] * 2);
    const want = lines[s];
    const t0 = Date.now();
    const settled = await settleAt(page, want, 180_000 * k);
    const ms = Date.now() - t0;
    const where = `paste ${s} (${(chars / 1e6).toFixed(1)} MB)`;
    t.check(settled, `${where}: the status settles with the doubled line count`, { want, ...(await state(page)) });
    const { first, changed } = await stays(page, 1500);
    t.check(!first.quiet, `${where}: the editor stays editable (no quiet view)`, first);
    if (chars >= 250_000 || want >= 30_000) t.check(first.surface, `${where}: the big-document editor has taken over`, first);
    t.check(!changed, `${where}: the editor's state doesn't change later on its own`, { first, changed });
    if (freezes) {
      const gaps = await page.evaluate((b) => window.__w.gaps.filter(([at]) => at > b).map(([, d]) => d), before);
      const longest = Math.max(0, ...gaps);
      t.metric('longest freeze', longest);
      t.log(`${where}: settled in ${ms} ms, longest freeze ${longest} ms, ${JSON.stringify(first)}`);
    } else t.log(`${where}: settled in ${ms} ms, ${JSON.stringify(first)}`);
    if (chars > maxChars) break;
  }
  // Undo: each Ctrl+Z takes back one paste.
  for (let u = 1; u <= undos; u++) {
    if (click) await page.locator('.ed:visible').first().click({ position: { x: 300, y: 80 } });
    await page.keyboard.press('Control+z');
    const want = lines[lines.length - 1 - u];
    const t0 = Date.now();
    const settled = await settleAt(page, want, 180_000 * k);
    const st = await state(page);
    t.check(settled, `undo ${u}: takes back one paste (${want} lines)`, st);
    t.check(!st.quiet, `undo ${u}: the editor stays editable`, st);
    t.log(`undo ${u}: ${Date.now() - t0} ms, ${JSON.stringify(st)}`);
  }
}

test('doubling past 60 MB by pasting at the end, then 3 undos', { engines: ['chromium'] }, (t) => doubling(t, { steps: 10, undos: 3, click: false, maxChars: 60e6, freezes: true }));

test('doubling past 16M characters by pasting at the end, then 3 undos', { engines: ['chromium', 'firefox'] }, (t) => doubling(t, { steps: 8, undos: 3, click: true }));
