// The command palette closes and the caret is where it was (REVIEW-3 D2). Chromium gives the focus back to the
// editor's textarea, not its selection: its caret at 0. Then a key was lost (the native textarea), or typed at the
// start of the big-document editor's passage, the caret moved there. Each document: the caret deep in it, the
// palette opened and closed with Esc, then with a command that doesn't move it, then a key: typed at the caret.
import { defaults, test } from '../../lib/api.mjs';
import { closePalette, command, openPalette } from '../../lib/app.mjs';
import { cursor, installHelpers, waitCursor } from './_helpers.mjs';
import { MOD, loadText, until } from '../features/_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['editor'] });

/** The status bar's Ln, Col once it has caught up with the caret (two equal readings 100 ms apart). */
async function steady(page) {
  let last = null;
  for (let k = 0; k < 50; k++) {
    const c = await cursor(page);
    if (c && last && c[0] === last[0] && c[1] === last[1]) return c;
    last = c;
    await page.waitForTimeout(100);
  }
  return last;
}

const items = Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `item number ${i}`, tags: ['a', 'b'], ok: i % 2 === 0 }));
const DOCS = [
  ['a 300 KB minified line', 'min.json', JSON.stringify(items), true],
  ['40,000 short lines', 'lines.json', '[\n' + Array.from({ length: 40000 }, () => '1').join(',\n') + '\n]', true],
  ['a small document', 'small.json', JSON.stringify(items.slice(0, 120), null, 2), false],
];

for (const [what, name, text, big] of DOCS) {
  test(`the palette closed: the caret stays where it was (${what})`, async (t) => {
    const { page } = t;
    await installHelpers(page);
    await t.open('/');
    t.assert(await loadText(page, name, text), `${name} is open`);
    if (big) t.assert(await until(page, () => /surface/.test(window.__vis('.pane-ed .ed')?.className ?? ''), null, { timeout: 15_000 }), 'the big-document editor');
    else t.assert(!(await page.evaluate(() => /surface|vmode/.test(window.__vis('.pane-ed .ed')?.className ?? ''))), 'the native textarea');
    await page.locator('.pane-ed .ed-body').first().click({ position: { x: 60, y: 20 } });
    // Deep in the document: near its end, inside a line.
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await until(page, () => { const c = window.__ed.cursor(); return c && c[0] + c[1] > 3; }, null, { timeout: 5000 });
    const at = await steady(page);
    t.assert(at && at[0] + at[1] > 3, 'the caret deep in it', at);
    for (const how of ['Esc', 'a command']) {
      for (let k = 0; k < 2; k++) {
        const before = await steady(page);
        if (how === 'Esc') {
          await openPalette(page);
          await page.keyboard.press('Escape');
          await closePalette(page);
        } else await command(page, 'Copy input to clipboard');
        await page.keyboard.type('X');
        const want = [before[0], before[1] + 1];
        const got = await waitCursor(page, want);
        t.check(JSON.stringify(got) === JSON.stringify(want), `${how} (${k + 1}): the key typed at the caret`, { before, got });
        await page.keyboard.press('Backspace');
        await waitCursor(page, before);
      }
    }
  });
}
