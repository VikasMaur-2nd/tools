// Crossing the long-line threshold while editing (port of selftest/longline/switch.mjs): paste a 6,000-character
// line into a pretty document (native editor → big-document editor), type in it, undo it (native again), redo;
// the document must be exact at every step.
import { defaults, test } from '../../lib/api.mjs';
import { edMode, installHelpers, json, model, slow, stepErrors, waitCursor, waitModel, withTmp } from './_helpers.mjs';

defaults({ engines: 'all', allowErrors: true });

/** The old pretty-10k.json: line-10k (a bare array of bench records) pretty-printed losslessly (big integers stay exact). */
function pretty10k(t) {
  const { parse, formatDoc } = json();
  const line = t.fixtureText('line-10k');
  return formatDoc(line, parse(line), '  ');
}

const pasteText = (page, text) =>
  page.evaluate((t) => {
    const ta = window.__ed.ta();
    const d = new DataTransfer();
    d.setData('text/plain', t);
    const ce = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ce, 'clipboardData', { value: d });
    if (ta.dispatchEvent(ce)) {
      ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    }
  }, text);

const surfaceIs = (page, want, timeout) =>
  page.waitForFunction((w) => window.__ed.mode().surface === w, want, { timeout, polling: 25 }).then(() => true, () => false);

test('a pasted long line switches to the big-document editor and back on undo, exactly', async (t) => {
  const { page } = t;
  const errs = stepErrors(t);
  const k = slow(t);
  const base = pretty10k(t);
  await installHelpers(page);
  await t.open('/');
  await withTmp(async (tmp) => {
    await t.app.openFile(page, tmp(base, 'pretty-10k.json'));
    await t.app.waitValid(page);
  });
  const box = await page.evaluate(() => {
    const r = window.__ed.ed().getBoundingClientRect();
    return { x: r.left + 200, y: r.top + 60 };
  });
  await page.mouse.click(box.x, box.y);
  const mode = async () => ((await edMode(page)).surface ? 'fast' : 'native');
  t.check((await mode()) === 'native', `pretty ${Math.round(base.length / 1000)} KB opens in the native editor`, await mode());

  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await waitCursor(page, [2, 1], { timeout: 3000 * k });
  const at = base.indexOf('\n') + 1;
  const long = '"' + 'x'.repeat(3000) + '日本語🙂' + 'y'.repeat(3000) + '",';
  await pasteText(page, long);
  t.check(await surfaceIs(page, true, 10_000 * k), 'a pasted 6,000-character line switches to the big-document editor', await mode());
  const want = base.slice(0, at) + long + base.slice(at);
  const caret = await waitCursor(page, [2, long.length + 1], { timeout: 3000 * k });
  t.check(caret?.[0] === 2 && caret?.[1] === long.length + 1, 'the status bar shows the caret after the pasted line', caret);

  await page.keyboard.type('abc');
  const typed = want.slice(0, at + long.length) + 'abc' + want.slice(at + long.length);
  const w = await waitModel(page, typed, { timeout: 5000 * k });
  const got = await model(page);
  t.check(w.ok && got === typed, 'document exact after typing', { len: [got.length, typed.length] });
  const where = got.indexOf('abc');
  t.check(where === at + long.length, 'typing after the switch lands at the caret (end of the pasted line)', { where, want: at + long.length });

  for (let i = 0; i < 2; i++) await page.keyboard.press('Control+z');
  const undone = await waitModel(page, base, { timeout: 5000 * k });
  t.check(undone.ok, 'undo restores the original', (await model(page)).length);
  t.check(await surfaceIs(page, false, 5000 * k), 'back to the native editor once the long line is gone', await mode());
  await page.keyboard.press('Control+y');
  t.check(await surfaceIs(page, true, 5000 * k), 'redo brings the long line and the big-document editor back', await mode());
  const redone = await waitModel(page, want, { timeout: 5000 * k });
  t.check(redone.ok, 'redo restores the pasted line exactly', (await model(page)).length);
  errs.done();
});
