// Flatten and unflatten (Convert targets, /tools/json-flatten): the page's preset, the options in the ⋯ menu,
// the note above the output, Use as input (Ctrl+Enter) flipping the direction, Undo, conflicts and the switch
// to the other direction, on a desktop and a phone.
import { defaults, test } from '../../lib/api.mjs';
import { MOD, setDoc, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 800, tags: ['flatten'] });

/** The Convert output, as Copy gives it (the code view draws only the lines on screen). */
async function output(page) {
  await page.evaluate(() => (window.__clip = null));
  await page.locator('.app:visible .vbar button[aria-label="Copy"]').click();
  return until(page, () => window.__clip, null, { timeout: 10_000 });
}

/** Waits until the output is `want` (a conversion runs after each change). */
const outputIs = async (page, want) => {
  for (let i = 0; i < 40; i++) {
    const got = await output(page);
    if (got === want) return got;
    await page.waitForTimeout(50);
  }
  return output(page);
};

const note = (page) => page.evaluate(() => {
  const b = window.__vis('.view .banner');
  return b ? { text: b.querySelector('.b-msg')?.textContent ?? '', warn: b.classList.contains('warn'), private: !!b.closest('.ph-no-capture') } : null;
});
const noteIs = (page, re) => until(page, ([s, f]) => new RegExp(s, f).test(window.__vis('.view .banner .b-msg')?.textContent ?? ''), [re.source, re.flags], { timeout: 10_000 });
const target = (page) => page.evaluate(() => window.__vis('.vmain select')?.value ?? null);
const openMenu = async (page) => {
  await page.locator('.app:visible .vbar button[aria-label="More options"]').click();
  await until(page, () => !!window.__vis('.menu'), null, { timeout: 5000 });
};
const closeMenu = (page) => page.keyboard.press('Escape');
/** Picks a menu option (Copy closes the menu: it opens again as needed). */
const choose = async (page, role, name, group) => {
  if (!(await page.evaluate(() => !!window.__vis('.menu')))) await openMenu(page);
  await (group ? page.locator('.menu').getByRole('group', { name: group }) : page.locator('.menu')).locator(`[role=${role}]`, { hasText: name }).click();
};

test('flatten page: options, notes, Use as input, Undo, conflicts', async (t) => {
  const { page } = t;
  await t.open('/tools/json-flatten');
  t.check((await target(page)) === 'flatten', 'the page opens on Flat JSON (flatten)', await target(page));
  const sample = await output(page);
  t.check(sample?.includes('"user.roles[0]": "admin"') && sample.includes('"id": 9007199254740993') && sample.includes('"tags": []'), 'the sample flattens, big number and empty array kept', sample?.slice(0, 200));

  const doc = '{"user.name":"Ada","a":{"b":[1,{"c":null}]},"e":{}}';
  t.assert(await setDoc(page, doc), 'pasted a document');
  t.check((await outputIs(page, '{\n  "user\\\\.name": "Ada",\n  "a.b[0]": 1,\n  "a.b[1].c": null,\n  "e": {}\n}')).includes('user\\\\.name'), 'a key with a dot is escaped');
  t.check(!!(await noteIs(page, /^Escaped 1 key with a backslash/)), 'the note says a key was escaped');
  const n = await note(page);
  t.check(n && !n.warn && n.private, 'the note is an info note, in the PRIVATE viewer', n);

  // Options: separator, array indexes, custom separator, escapes, depth.
  await openMenu(page);
  for (const label of ['Separator', 'Custom separator', 'Array indexes', 'Escape keys', 'Depth', 'Use as input']) t.check(await page.locator('.menu').getByText(label, { exact: true }).count() > 0, `menu: ${label}`);
  await choose(page, 'menuitemradio', /^\/$/);
  t.check((await outputIs(page, '{\n  "user.name": "Ada",\n  "a/b[0]": 1,\n  "a/b[1]/c": null,\n  "e": {}\n}')).includes('"user.name"'), 'separator /: the dotted key needs no escape');
  await choose(page, 'menuitemradio', /^None$/);
  t.check((await outputIs(page, '{\n  "user.name": "Ada",\n  "a/b": [\n    1,\n    {\n      "c": null\n    }\n  ],\n  "e": {}\n}')).includes('"a/b": ['), 'array indexes None: arrays stay whole');
  await choose(page, 'menuitemradio', /^a\[0\]$/);
  await page.locator('.menu input.mi-input').fill('->');
  t.check((await outputIs(page, '{\n  "user.name": "Ada",\n  "a->b[0]": 1,\n  "a->b[1]->c": null,\n  "e": {}\n}')).includes('a->b[1]->c'), 'a typed separator applies after a pause');
  await choose(page, 'menuitemradio', /^\.$/);
  await choose(page, 'menuitemcheckbox', 'Escape keys');
  t.check(!!(await noteIs(page, /^1 key won't unflatten to the same place: "user\.name" · Turn on Escape keys/)), 'escapes off: the note warns, naming the key');
  t.check((await note(page))?.warn === true, 'escapes off: a warning');
  await choose(page, 'menuitemcheckbox', 'Escape keys');
  await choose(page, 'menuitemradio', /^1$/, 'Depth');
  t.check((await outputIs(page, '{\n  "user\\\\.name": "Ada",\n  "a.b": [\n    1,\n    {\n      "c": null\n    }\n  ],\n  "e": {}\n}')).includes('"a.b": ['), 'depth 1: deeper values stay nested');
  await choose(page, 'menuitemradio', /^All$/, 'Depth');
  await closeMenu(page);

  // Use as input (Ctrl+Enter): the flat JSON replaces the input and Unflatten shows the document again.
  const flat = await outputIs(page, '{\n  "user\\\\.name": "Ada",\n  "a.b[0]": 1,\n  "a.b[1].c": null,\n  "e": {}\n}');
  await page.locator('#input').focus();
  await page.keyboard.press(`${MOD}+Enter`);
  t.check(!!(await until(page, (f) => document.getElementById('input').value === f, flat)), 'Ctrl+Enter: the flat JSON is the input');
  // (Before Copy, whose own toast would replace it.)
  t.check(!!(await until(page, () => /Flattened input · (Ctrl\+|⌘)Z to undo/.test(window.__vis('.toasts')?.textContent ?? ''))), 'a toast says so, with Undo');
  t.check(!!(await until(page, () => window.__vis('.vmain select')?.value === 'unflatten')), 'Ctrl+Enter: the target is Nested JSON (unflatten)');
  t.check((await outputIs(page, JSON.stringify(JSON.parse(doc), null, 2))) === JSON.stringify(JSON.parse(doc), null, 2), 'unflatten gives the document back');
  await page.locator('#input').focus();
  await page.keyboard.press(`${MOD}+z`);
  t.check(!!(await until(page, (d) => document.getElementById('input').value === d, doc)), 'Ctrl+Z restores the input');

  // Unflatten: a conflict is an error naming both keys; nested input offers the other direction.
  t.assert(await setDoc(page, '{"a":1,"a.b":2}'), 'pasted clashing keys');
  t.check(!!(await until(page, () => /Keys "a" and "a\.b" conflict: one holds a value, the other goes inside it/.test(window.__vis('#view-convert .cv-note')?.textContent ?? ''))), 'the conflict is shown instead of an output');
  t.assert(await setDoc(page, '{"a":{"b":1}}'), 'pasted nested JSON');
  t.check(!!(await noteIs(page, /^This JSON has no flat keys to unflatten$/)), 'nested input: the note says there is nothing to unflatten');
  await page.locator('.view .banner button', { hasText: 'Flatten instead' }).click();
  t.check(!!(await until(page, () => window.__vis('.vmain select')?.value === 'flatten')), 'Flatten instead switches the target');
  t.check((await outputIs(page, '{\n  "a.b": 1\n}')) === '{\n  "a.b": 1\n}', 'and flattens');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('flatten on a phone: the menu fits and its controls work', { mobile: true }, async (t) => {
  const { page } = t;
  await t.open('/tools/json-flatten');
  await openMenu(page);
  const box = await page.evaluate(() => {
    const m = window.__vis('.menu').getBoundingClientRect();
    const over = [...window.__vis('.menu').querySelectorAll('.mi, .mi-opts button, input')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.textContent || e.tagName);
    return { left: m.left, right: m.right, width: innerWidth, over };
  });
  t.check(box.left >= 0 && box.right <= box.width + 0.5, 'the menu is inside the screen', box);
  t.check(!box.over.length, 'no option overflows', box.over);
  await choose(page, 'menuitemradio', /^_$/);
  let out = '';
  for (let i = 0; i < 40 && !out.includes('"user_address_city"'); i++) out = (await output(page)) ?? '';
  t.check(out.includes('"user_address_city": "London"') && out.includes('"orders[0]_price": 12.50'), 'separator _ applies', out.slice(0, 200));
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('flatten: a typed separator shows only in masked elements, and a broken edit is never replaced', async (t) => {
  const { page } = t;
  await t.open('/tools/json-flatten');
  await openMenu(page);
  await page.locator('.menu input.mi-input').fill('SECRET');
  // (It applies after a pause.)
  await until(page, () => /SECRET/.test(document.querySelector('#view-convert')?.textContent ?? ''), null, { timeout: 10_000 });
  // Session replay masks .ph-no-capture: no text outside it may carry the separator (the menu's a.0 example did).
  const leaks = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.includes('SECRET') && !n.parentElement.closest('.ph-no-capture')) out.push(n.parentElement.outerHTML.slice(0, 120));
    for (const el of document.querySelectorAll('[aria-label],[title],[data-tip]')) for (const a of ['aria-label', 'title', 'data-tip']) if (el.getAttribute(a)?.includes('SECRET') && !el.closest('.ph-no-capture')) out.push(`${a}: ${el.outerHTML.slice(0, 120)}`);
    return out;
  });
  t.check(!leaks.length, 'no unmasked text or label shows the typed separator', leaks);
  t.check(await page.locator('.menu [role=menuitemradio]', { hasText: /^a\.0$/ }).count() === 1, 'the array style example stays a.0 for a typed separator');
  await closeMenu(page);
  t.check((await output(page))?.includes('"userSECRETname": "Ada"'), 'the typed separator applies');

  // Ctrl+Enter on a broken edit: the edit stays (the Convert view keeps showing the last valid document's output).
  await choose(page, 'menuitemradio', /^\.$/);
  await closeMenu(page);
  t.assert(await setDoc(page, '{"a":{"b":1}}'), 'pasted a document');
  t.check((await outputIs(page, '{\n  "a.b": 1\n}')) === '{\n  "a.b": 1\n}', 'it flattens');
  t.assert(await setDoc(page, '{"a":{', 'input', { valid: false }), 'broke it');
  await page.locator('#input').focus();
  await page.keyboard.press(`${MOD}+Enter`);
  t.check(!!(await until(page, () => /Fix the error first/.test(window.__vis('.toasts')?.textContent ?? ''))), 'a toast says to fix the error first');
  t.check((await page.evaluate(() => document.getElementById('input').value)) === '{"a":{', 'the broken edit is still the input');
  t.check((await target(page)) === 'flatten', 'still flattening');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});
