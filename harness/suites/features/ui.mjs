// UI fixes from the 2026-10-24 review (PR #26): tooltips that state document facts are PRIVATE, the
// /integrate builder's link stays tied to its inputs (and survives a compression failure and an editor
// that can't load), the graph export dialog's keys and every export, and graph find counts.
// Ported from rv/c/ui-checks.mjs (39 checks; its find group printed counts for comparing builds, which
// are checks here).
import { defaults, test } from '../../lib/api.mjs';
import { loadText, setDoc, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 800, tags: ['ui'] });


/** Settles after a key press: React has committed and focus effects have run. */
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Page errors, without WebKit's "ResizeObserver loop" warning on opening Compare (on main too). */
const errorsOk = (t, what = 'no page errors', also = /$^/) => {
  const errs = t.errors.filter((e) => !/ResizeObserver loop/.test(e) && !also.test(e));
  t.check(!errs.length, what, errs.slice(0, 3));
};

// ── Tooltips ────────────────────────────────────────────────────────────────────────────────────

const tip = (page) => page.evaluate(() => { const t = document.querySelector('.tip'); return t ? { text: t.textContent, priv: t.classList.contains('ph-no-capture'), shown: t.classList.contains('in') } : null; });
/** Hovers (or focuses) and waits for the tooltip to show `re`. */
const tipFor = (page, re) => until(page, ([s, f]) => { const t = document.querySelector('.tip'); return t?.classList.contains('in') && new RegExp(s, f).test(t.textContent); }, [re.source, re.flags], { timeout: 5000 }).then(() => tip(page));

test('tooltips: document facts are PRIVATE, site text is not', { allowErrors: true }, async (t) => {
  const { page } = t;
  await t.open('/');
  // Every state a session recorder could see (it reads the DOM on MutationObserver callbacks), from when the
  // tooltip element is made (once the page is idle).
  t.assert(await until(page, () => !!document.querySelector('.tip'), null, { timeout: 10_000 }), 'the tooltip element is made');
  await page.evaluate(() => {
    window.__tipStates = [];
    const t = document.querySelector('.tip');
    new MutationObserver(() => window.__tipStates.push({ text: t.textContent, priv: t.classList.contains('ph-no-capture') })).observe(t, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  t.assert(await setDoc(page, JSON.stringify({ a: 1, b: 'x', list: Array.from({ length: 40 }, (_, i) => ({ i, v: 'some value ' + i })) }, null, 2)), 'the document is in');
  await page.getByRole('tab', { name: 'Format' }).click();
  await until(page, () => !!window.__vis('.sb-l .sz-min'), null, { timeout: 10_000 });
  // (Where the button is exposed: in a crowded toolbar the Find icon can lie over its centre.)
  await t.app.hoverExposed(page, page.getByRole('radio', { name: /Minify/ }));
  const m = await tipFor(page, /% smaller/);
  t.check(!!m && /% smaller/.test(m.text) && m.priv && m.shown, 'tooltips: Minify\'s "N% smaller" is PRIVATE', m);
  await page.hover('.statusbar .sz-min');
  const s = await tipFor(page, /smaller than the input/);
  t.check(!!s && /smaller than the input/.test(s.text) && s.priv, 'tooltips: a size tooltip ("…% smaller than the input") is PRIVATE', s);
  await t.app.hoverExposed(page, page.getByRole('radio', { name: /Pretty/ }));
  const p = await tipFor(page, /^Indented and readable$/);
  t.check(!!p && p.text === 'Indented and readable' && !p.priv, 'tooltips: a site tooltip right after is public again', p);
  await page.getByRole('tab', { name: 'Compare' }).click();
  await until(page, () => !!window.__vis('.pane-cmp .ed-body'), null, { timeout: 10_000 });
  await setDoc(page, JSON.stringify({ a: '1', b: 'x', c: 2, list: [] }), 'input2');
  await until(page, () => !!window.__vis('.cmp-k-changed'), null, { timeout: 10_000 });
  await page.hover('.cmp-k-changed');
  const c = await tipFor(page, /type change/);
  t.check(!!c && /type change/.test(c.text) && c.priv, 'tooltips: a Compare count tooltip ("1 type change") is PRIVATE', c);
  // Keyboard focus shows tooltips too.
  await page.mouse.move(2, 2);
  await page.locator('button[aria-label="All commands"]').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const k = await tipFor(page, /^All commands$/);
  t.check(!!k && k.text === 'All commands' && !k.priv, 'tooltips: a site tooltip on keyboard focus is public', k);
  const states = await page.evaluate(() => window.__tipStates);
  const bad = states.filter((x) => /% smaller|type change/.test(x.text) && !x.priv);
  t.check(states.length > 4 && !bad.length, 'tooltips: no observed moment shows private text without PRIVATE', `${states.length} states, ${bad.length} bad`);
  errorsOk(t, 'tooltips: no page errors');
});

// ── The /integrate builder ──────────────────────────────────────────────────────────────────────

/** The builder's state: can the link be copied or opened, which link, the preview, the check line. */
const STATE = () => {
  window.__bstate = () => {
    const copy = document.querySelector('.lb-copy');
    const open = document.querySelector('.lb-open');
    const prev = document.querySelector('.lb-preview a');
    return {
      copy: copy ? !copy.disabled : null,
      open: open ? open.tagName === 'A' && !!open.getAttribute('href') : null,
      href: open && open.tagName === 'A' ? open.getAttribute('href') : '',
      badge: prev ? prev.getAttribute('href') || '' : null,
      empty: document.querySelector('.lb-preview .lb-empty')?.textContent || '',
      error: document.querySelector('.lb-result .lb-error')?.textContent || '',
      check: document.querySelector('.lb-check')?.textContent || '',
    };
  };
};
const state = (page) => page.evaluate(() => window.__bstate());
/** Records every state the builder shows (each DOM change and each frame) until stopRecording. */
const record = (page) =>
  page.evaluate(() => {
    const rec = (window.__rec = []);
    const push = () => {
      const s = window.__bstate();
      const last = rec[rec.length - 1];
      if (!last || JSON.stringify(last) !== JSON.stringify(s)) rec.push(s);
    };
    push();
    const mo = new MutationObserver(push);
    mo.observe(document.querySelector('.link-builder'), { subtree: true, childList: true, attributes: true, characterData: true });
    const frame = () => {
      push();
      if (window.__rec === rec) requestAnimationFrame(frame);
      else mo.disconnect();
    };
    requestAnimationFrame(frame);
  });
const stopRecording = (page) => page.evaluate(() => { const r = window.__rec; window.__rec = null; return r; });

async function builder(t) {
  const { page } = t;
  await t.context.addInitScript(STATE);
  await t.open('/integrate', { tool: false });
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  t.assert(await until(page, () => document.querySelectorAll('.link-builder .lb-ed .ed-gl').length >= 1 && !!document.querySelector('.lb-preview a[href]'), null, { timeout: 20_000 }), 'the builder is ready');
}

test('builder: the link stays tied to its inputs', async (t) => {
  const { page } = t;
  await builder(t);
  const first = await state(page);
  t.check(first.copy && first.open && first.href.startsWith('https://tools.vikasmaur.com/#'), 'builder: a link is made for the sample', first);
  // Typing: from the moment the boxes change until the new link is made, the old one can't be copied or opened.
  await page.locator('.link-builder .lb-ed').first().click();
  await page.keyboard.press('Control+End');
  await record(page);
  await page.keyboard.type(' ');
  await until(page, (h) => { const s = window.__bstate(); return s.copy && s.open && s.href !== h && s.href.length > 30; }, first.href, { timeout: 10_000 });
  const seen = await stopRecording(page);
  const last = await state(page);
  const blocked = seen.filter((x) => !x.copy && !x.open).length;
  t.check(blocked > 0, 'builder: while a new link is made, Copy and Open are off', `${blocked} of ${seen.length} states blocked`);
  t.check(last.copy && last.open && last.href !== first.href && last.href.length > 30, 'builder: then the new link is usable', last);
  t.check(seen.every((x) => x.badge !== null || x.empty === 'Making the link…'), 'builder: the old link stays in view meanwhile (no flash)', seen.filter((x) => x.badge === null).slice(0, 2));
  // A big document (compressed in a worker): once it is in the box, the old link is never usable again.
  const big = JSON.stringify(Array.from({ length: 70_000 }, (_, i) => ({ id: i, name: 'Customer ' + i, email: `user${i}@example.com`, tags: ['a', 'b', 'c'], score: i * 1.37 })));
  await record(page);
  await page.locator('.link-builder input[type=file]').first().setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(big) });
  await until(page, (h) => { const s = window.__bstate(); return s.copy && s.href && s.href !== h; }, last.href, { timeout: 60_000 });
  const samples = await stopRecording(page);
  const inAt = samples.findIndex((x) => /Checking/.test(x.check) || x.check !== samples[0].check);
  const stale = inAt < 0 ? -1 : samples.slice(inAt).filter((x) => (x.copy || x.open) && x.href === last.href).length;
  const making = samples.some((x) => x.empty === 'Making the link…');
  const done = samples[samples.length - 1];
  t.check(inAt >= 0 && stale === 0, 'builder: once a big document is in, its old link is never usable', `in at state ${inAt}, ${stale} stale-usable, "Making the link…" ${making ? 'shown' : 'not needed'}`);
  t.check(done.copy && done.open && done.href !== last.href, 'builder: then its link is usable', { copy: done.copy, open: done.open });
});

test('builder: a compression failure shows its error and leaves no old link', { allowErrors: true }, async (t) => {
  const { page } = t;
  await builder(t);
  await page.evaluate(() => {
    window.CompressionStream = class {
      constructor() {
        throw new TypeError('no compression');
      }
    };
  });
  await page.locator('.link-builder .lb-ed').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await until(page, () => /cannot compress links/.test(window.__bstate().error), null, { timeout: 5000 });
  const st = await state(page);
  t.check(/cannot compress links/.test(st.error) && !st.copy && !st.open && st.badge === null, 'builder: a failed compression shows its error and leaves no old link to use', st);
  errorsOk(t, 'builder (compression): no page errors', /no compression/);
});

// (Chromium logs each aborted script load as a console error: those are this test's doing.)
test("builder: the plain box works when the editor's code can't load", { allowErrors: true }, async (t) => {
  const { page } = t;
  await t.context.addInitScript(STATE);
  await t.open('/integrate', { tool: false });
  // From now on, no more scripts load (offline before the editor was cached).
  let failed = false;
  page.on('requestfailed', (r) => /\/_next\/static\/chunks\/.+\.js/.test(r.url()) && (failed = true));
  await page.route('**/_next/static/chunks/*.js', (r) => r.abort());
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  // The box asks for the editor once in view: wait until that load failed (or the editor came anyway).
  await until(page, () => !!document.querySelector('.link-builder .lb-ed .ed-gl')?.childElementCount, null, { timeout: 3000 });
  if (!failed) await page.waitForEvent('requestfailed', { timeout: 10_000 }).catch(() => {});
  await frames(page);
  const plain = await page.evaluate(() => !document.querySelector('.link-builder .lb-ed .ed-gl')?.childElementCount);
  const before = await state(page);
  const ta = page.locator('.link-builder .lb-ed textarea').first();
  await ta.click();
  await ta.fill('{"broken": tru');
  await until(page, (c) => { const s = window.__bstate().check; return s !== c && /fixes|Ln \d/.test(s); }, before.check, { timeout: 5000 });
  const bad = await state(page);
  await ta.fill('{"plain": "box", "n": 2}');
  await until(page, (h) => { const s = window.__bstate(); return /Valid JSON/.test(s.check) && s.copy && s.href !== h; }, before.href, { timeout: 5000 });
  const good = await state(page);
  const out = await page.locator('.link-builder .lb-ed-out textarea').inputValue();
  t.check(plain, 'builder (no editor): the box stayed plain');
  t.check(bad.check !== before.check && /fixes|Ln \d/.test(bad.check) && /Valid JSON/.test(good.check), 'builder (no editor): typing in it is checked', `${before.check} | ${bad.check} | ${good.check}`);
  t.check(good.copy && good.href !== before.href && out.includes(good.href.slice(0, 40)), 'builder (no editor): and makes its link', good.href.slice(0, 60));
  errorsOk(t, 'builder (no editor): no page errors', /Failed to load resource/);
});

// ── Graph: the export dialog, every export, big graphs, find ───────────────────────────────────

const SMALL = JSON.stringify({ users: [{ id: 1, name: 'Ada', roles: ['author', 'mathematician'] }, { id: 2, name: 'Grace', tags: { a: 1 } }], total: 2 }, null, 2);

async function graph(t, load) {
  const { page } = t;
  await t.open('/');
  t.assert(await load(), 'the document is in');
  await page.getByRole('tab', { name: 'Graph' }).click();
  await until(page, () => !!window.__vis('#view-graph .gv-ctl:not([hidden])') && !!document.querySelector('#view-graph .gv-note')?.hidden, null, { timeout: 60_000 });
}
/** Opens the export dialog from the palette ("Export graph image"), as the old check did. */
async function openExport(t) {
  await t.app.command(t.page, 'Export graph image');
  await t.page.locator('.gx-form').waitFor({ timeout: 10_000 });
}
const group = (page, label) => page.locator(`.gx-form [role=radiogroup][aria-label="${label}"]`);
const active = (page) => page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), group: document.activeElement?.closest('[role=radiogroup]')?.getAttribute('aria-label'), checked: document.activeElement?.getAttribute('aria-checked') }));
const press = async (page, key) => {
  await page.keyboard.press(key);
  await frames(page);
};

test('graph export dialog: one Tab stop per choice, arrows move it', async (t) => {
  const { page } = t;
  await graph(t, () => setDoc(page, SMALL));
  await openExport(t);
  const stops = await page.evaluate(() => [...document.querySelectorAll('.gx-form [role=radio]')].filter((b) => !b.disabled && b.tabIndex >= 0).map((b) => b.closest('[role=radiogroup]').getAttribute('aria-label')));
  t.check(JSON.stringify(stops) === JSON.stringify([...new Set(stops)]) && stops.length === 4, 'export dialog: one Tab stop per choice', stops);
  await group(page, 'File type').locator('[aria-checked=true]').focus();
  const start = await active(page);
  await press(page, 'ArrowRight');
  const a1 = await active(page);
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  const a3 = await active(page);
  t.check(a1.checked === 'true' && a1.text !== start.text && a3.text === start.text && a3.checked === 'true', 'export dialog: arrows move the choice and the focus, wrapping round', `${start.text} → ${a1.text} → … → ${a3.text}`);
  await press(page, 'Tab');
  const t1 = await active(page);
  t.check(t1.group === 'Area' && t1.checked === 'true', 'export dialog: Tab goes to the next choice, on its chosen option', t1);
  // No card selected: "Selected branch" is disabled, and the arrows skip it.
  const branchOff = await group(page, 'Area').getByRole('radio', { name: 'Selected branch' }).isDisabled();
  await press(page, 'ArrowLeft');
  const t2 = await active(page);
  t.check(branchOff && t2.text === 'Visible area' && t2.checked === 'true', 'export dialog: arrows skip a disabled option', t2);
  await press(page, 'ArrowRight');
  // JPEG: Transparent is disabled.
  await group(page, 'File type').getByRole('radio', { name: 'JPEG' }).click();
  await group(page, 'Background').getByRole('radio', { name: 'White' }).click();
  await press(page, 'ArrowRight');
  const t3 = await active(page);
  t.check(t3.group === 'Background' && t3.text === 'Theme', 'export dialog: with JPEG, arrows skip Transparent', t3);
});

test('graph export: every format and area downloads an image', async (t) => {
  const { page } = t;
  await graph(t, () => setDoc(page, SMALL));
  // Select a card (for "Selected branch").
  await page.locator('#view-graph').focus();
  await press(page, 'ArrowDown');
  await press(page, 'ArrowRight');
  for (const format of ['PNG', 'JPEG', 'SVG']) {
    for (const area of ['Whole graph', 'Visible area', 'Selected branch']) {
      await openExport(t);
      await group(page, 'File type').getByRole('radio', { name: format }).click();
      await group(page, 'Area').getByRole('radio', { name: area }).click();
      await group(page, 'Background').getByRole('radio', { name: 'Theme' }).click();
      const dl = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
      await page.getByRole('button', { name: 'Download' }).click({ timeout: 10_000 });
      const d = await dl;
      const path = d && (await d.path().catch(() => null));
      const { size } = path ? await import('node:fs').then((fs) => fs.statSync(path)) : { size: 0 };
      const name = d ? d.suggestedFilename() : '';
      t.check(size > 300 && name.endsWith(format === 'JPEG' ? '.jpg' : '.' + format.toLowerCase()), `export: ${format}, ${area}`, `${name} ${size} B`);
      await until(page, () => !document.querySelector('.gx-form'), null, { timeout: 5000 });
    }
  }
});

// Big graphs: SVG says why it can't, PNG of the visible area still works (the whole of it is too tall
// for any image). One long array (rows, not cards), then many cards.
for (const [what, make] of [
  ['a 300k-item array', () => Array.from({ length: 300_000 }, (_, i) => i * 1.5)],
  ['30k cards', () => Array.from({ length: 30_000 }, (_, id) => ({ id }))],
]) {
  test(`graph export of ${what}: SVG refused with a reason, PNG works`, { timeout: 120_000 }, async (t) => {
    const { page } = t;
    const text = JSON.stringify(make());
    await graph(t, () => loadText(page, 'big.json', text, { timeout: 60_000 }));
    await openExport(t);
    await until(page, () => /card/.test(document.querySelector('.gx-info')?.textContent ?? ''), null, { timeout: 30_000 });
    await group(page, 'File type').getByRole('radio', { name: 'SVG' }).click();
    await group(page, 'Area').getByRole('radio', { name: 'Whole graph' }).click();
    const t0 = Date.now();
    await until(page, () => document.querySelector('.gx-info')?.classList.contains('err'), null, { timeout: 10_000 });
    const info = await page.locator('.gx-info').innerText();
    const off = await page.getByRole('button', { name: 'Download' }).isDisabled();
    const ok = off && /too large for SVG|Too many cards/.test(info);
    t.check(ok, `export (${what}): SVG refused with a reason`, `${info} (${Date.now() - t0} ms)`);
    await group(page, 'File type').getByRole('radio', { name: 'PNG' }).click();
    await group(page, 'Area').getByRole('radio', { name: 'Visible area' }).click();
    // (The click waits for Download to be enabled again: the PNG preview is ready.)
    const dl = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Download' }).click({ timeout: 10_000 });
    const d = await dl;
    const path = d && (await d.path().catch(() => null));
    const { size } = path ? await import('node:fs').then((fs) => fs.statSync(path)) : { size: 0 };
    t.check(size > 1000, `export (${what}): PNG of the visible area works`, `${size} B in ${Date.now() - t1} ms`);
  });
}

const FIND_WORDS = ['Alpha', 'beta', 'Gamma', 'delta', 'EPSILON'];
const findRecords = () => Array.from({ length: 6000 }, (_, i) => ({ id: i, name: `${FIND_WORDS[i % 5]} item ${i}`, ok: i % 3 === 0, v: i % 7 ? null : 'Straße İstanbul ' + i, n: i * 1.5 }));
// What PR #26's build and main both answered, in every engine (the old script compared them).
const FIND_WANT = { alpha: '1 of 1,200', Alpha: '1 of 1,200', 'item 12': '1 of 111', true: '5 of 2,000', null: '11 of 5,142', straße: '3 of 858', i̇stanbul: '3 of 858', '1.5': '2 of 300', zzz: 'No results', '$[3].name': '1 of 1', '$[*].name': 'Concrete paths only' };

test('graph find: counts for a set of queries', async (t) => {
  const { page } = t;
  await graph(t, () => loadText(page, 'find.json', JSON.stringify(findRecords())));
  await findCounts(t, FIND_WANT);
});

test('graph find on a document the worker parsed (a tape): the same counts', async (t) => {
  const { page } = t;
  // Over 2 MB, so a worker parses it and the graph is built from its tape. The padding matches no query.
  const doc = JSON.stringify([...findRecords(), ...Array.from({ length: 9000 }, () => ({ q: 'x'.repeat(200) }))]);
  await graph(t, () => loadText(page, 'find-big.json', doc));
  await findCounts(t, FIND_WANT);
  errorsOk(t);
});

async function findCounts(t, want) {
  const { page } = t;
  for (const [q, count] of Object.entries(want)) {
    await page.keyboard.press('Control+f');
    const input = page.locator('.findbar input');
    await input.fill(q);
    const got = await until(page, (c) => window.__vis('.findbar .count')?.textContent === c, count, { timeout: 5000 }).then(() => page.locator('.findbar .count').innerText());
    t.check(got === count, `find "${q}": ${count}`, got);
    await page.keyboard.press('Escape');
    await page.locator('#view-graph').focus();
  }
}
