// Real keyboard-shortcut bursts with no pauses, on documents of any size (port of selftest/fuzz/torture.mjs):
// select all / cut / paste / undo / redo / type over / delete, over and over; the document must come out exact
// after every burst, and the status must end valid.
//
// Real Ctrl+C/X/V use the browser's clipboard, which all contexts of a browser process share, so each test runs
// in a browser of its own.
import { defaults, test } from '../../lib/api.mjs';
import * as H from './_helpers.mjs';

defaults({ page: false });

async function torture(t, name, rounds) {
  const k = H.slow(t);
  const original = H.asLoaded(t.fixtureText(name));
  const big = original.length > 2_000_000;
  const { page } = await H.isolatedPage(t, { width: 1280, height: 800 });
  const kb = page.keyboard;
  await t.app.open(page, t.base, '/');
  await t.app.openFile(page, name);
  await t.app.waitParsed(page, { timeout: (big ? 180_000 : 60_000) * k });
  await H.focusEditor(page, { timeout: (big ? 60_000 : 15_000) * k });

  const press = async (...keys) => {
    for (const key of keys) await kb.press(key);
  };
  // (A big paste reaches the editor after its output is drawn: wait for it.)
  const wait = (big ? 60_000 : 15_000) * k;
  const check = async (want, what) => {
    const w = await H.waitModel(page, want, { timeout: wait });
    if (w.ok) return t.check(true, what);
    return t.check(false, what, H.firstDiff(await H.model(page), want, 12));
  };
  const twice = original + original;
  const t0 = Date.now();
  // (The mouse put the caret somewhere: these all start from select all or Ctrl+Home, so it doesn't matter.)
  for (let round = 0; round < rounds; round++) {
    // 1. Select all, cut, paste, over and over.
    for (let i = 0; i < 6; i++) await press('Control+a', 'Control+x', 'Control+v');
    await check(original, `r${round} 6 × (select all, cut, paste)`);
    // 2. Select all, cut, then undo the cut; redo it; undo again.
    await press('Control+a', 'Control+x', 'Control+z');
    await check(original, `r${round} cut then undo`);
    await press('Control+y', 'Control+z');
    await check(original, `r${round} cut, undo, redo, undo`);
    // 3. Select all, type over everything, undo.
    await press('Control+a');
    await kb.type('x');
    await press('Control+z');
    await check(original, `r${round} type over all then undo`);
    // 4. Select all, delete, undo; Backspace, undo.
    await press('Control+a', 'Delete', 'Control+z', 'Control+a', 'Backspace', 'Control+z');
    await check(original, `r${round} delete all / backspace all then undo`);
    // 5. Copy all, go to the end, paste (the document twice), undo.
    if (original.length * 2 <= 16_000_000) {
      await press('Control+a', 'Control+c', 'Control+End', 'Control+v');
      await check(twice, `r${round} copy all, paste at end`);
      await press('Control+z');
      await check(original, `r${round} undo the doubling`);
    }
    // 6. From the start, select to the end by keyboard, cut, paste; select a few rows, cut, paste.
    await press('Control+Home', 'Shift+Control+End', 'Control+x', 'Control+v');
    await check(original, `r${round} shift+ctrl+end, cut, paste`);
    await press('Control+Home', 'ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+End', 'Control+x', 'Control+v');
    await check(original, `r${round} rows cut, paste`);
    // 7. Cut everything, paste twice, undo once: the document once.
    await press('Control+a', 'Control+x', 'Control+v', 'Control+v');
    if (original.length * 2 <= 16_000_000) await check(twice, `r${round} cut all, paste twice`);
    await press('Control+z');
    await check(original, `r${round} paste twice then undo one`);
    // 8. Undo everything from here, then redo everything: same document. (Only where the history holds 4
    // whole-document steps: it keeps the last 60M characters, so on a huge document the undos stop early while
    // the redos still redo the paste undone above.)
    if (original.length * 4 <= 60_000_000) {
      for (let i = 0; i < 4; i++) await press('Control+z');
      for (let i = 0; i < 4; i++) await press('Control+y');
      await check(original, `r${round} undo 4, redo 4`);
    }
  }
  const st = await t.app.waitValid(page, { timeout: (big ? 90_000 : 45_000) * k }).catch(() => t.app.status(page));
  t.check(/^Valid JSON/.test(st), 'status says valid', st.slice(0, 120));
  t.log(`${rounds} rounds in ${((Date.now() - t0) / 1000).toFixed(0)} s, big-document editor: ${(await H.edMode(page)).surface}`);
}

test('shortcut bursts on small-mix (2 rounds)', { engines: ['chromium', 'webkit'], timeout: 240_000 }, (t) => torture(t, 'small-mix', 2));
test('shortcut bursts on mix-one-line (2 rounds)', { engines: ['firefox'], timeout: 240_000 }, (t) => torture(t, 'mix-one-line', 2));
test('shortcut bursts on a 50 MB document (1 round)', { engines: ['chromium'], tags: ['slow'], slots: 'all', timeout: 600_000 }, (t) => torture(t, 'bench-50mb', 1));
test('shortcut bursts on a 25 MB document (1 round)', { engines: ['firefox'], tags: ['slow'], slots: 'all', timeout: 600_000 }, (t) => torture(t, 'bench-25mb', 1));
