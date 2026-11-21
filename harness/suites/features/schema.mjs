// The Schema view (JSON Schema validation): the validator page's sample and its six errors, a click or Enter on an
// error selecting it in the document, a keyword selecting the rule in the schema, keyboard navigation, fixing to
// Valid and undoing, a broken schema, Check formats, the phone layout, and from the home page Alt+7, Generate from
// the document and Close.
import { defaults, test } from '../../lib/api.mjs';
import { MOD, setDoc, until } from './_helpers.mjs';

defaults({ engines: ['chromium'], width: 1280, height: 900, tags: ['schema'] });

const ROWS = '.sch-list [data-i]';
const state = (page) => page.evaluate(() => document.querySelector('#view-schema .sch-state')?.textContent ?? '');
const waitState = (page, re, timeout = 15_000) => until(page, (src) => new RegExp(src).test(document.querySelector('#view-schema .sch-state')?.textContent ?? '') && document.querySelector('#view-schema .sch-state').textContent, re.source, { timeout });
/** The editor that has the focus, and the text it has selected. */
const selected = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a instanceof HTMLTextAreaElement ? `${a.id}:${a.value.slice(a.selectionStart, a.selectionEnd)}` : `${a?.tagName}`;
  });

const FIXED = '{\n  "id": 7,\n  "name": "Ada",\n  "email": "ada@example.com",\n  "age": 36,\n  "role": "admin",\n  "tags": ["admin"],\n  "balance": 19.99\n}\n';

test('the validator page: six errors, jumps, keyboard, fixed to Valid, undo, a broken schema, formats', async (t) => {
  const { page } = t;
  await t.open('/tools/json-schema-validator');
  t.check((await until(page, (s) => document.querySelectorAll(s).length === 6, ROWS, { timeout: 30_000 })) === true, 'the sample shows six errors');
  t.check(/6 errors/.test(await state(page)), 'the header counts them', await state(page));
  const rows = await page.evaluate((s) => [...document.querySelectorAll(s)].map((r) => r.querySelector('.sch-msg').textContent + ' @ ' + r.querySelector('.sch-at').textContent), ROWS);
  t.check(rows[0] === 'Missing required property "email" @ (root) · Ln 1, Col 1' && rows[1] === 'Expected integer, got string @ /age · Ln 4, Col 10' && rows[4].startsWith('Must be a multiple of 0.01'), 'messages and locations', rows);
  t.check(await page.evaluate(() => document.querySelector('.pane-sch .sch-draft')?.textContent) === '2020-12', 'the draft comes from $schema');

  // A click on an error selects its value in the document; its keyword button selects the rule in the schema.
  await page.locator(`${ROWS}[data-i="1"] .sch-msg`).click();
  t.check((await selected(page)) === 'input:"36"', 'a click selects the value in the document', await selected(page));
  await page.locator(`${ROWS}[data-i="2"] .sch-kw`).click();
  t.check((await selected(page)) === 'schema-input:"enum"', 'the keyword button selects the rule in the schema', await selected(page));

  // Keyboard: Home, arrows, Enter.
  await page.locator('.sch-list').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  t.check((await page.evaluate(() => document.querySelector('.sch-list')?.getAttribute('aria-activedescendant'))) === 'sch-r2', 'arrows move through the errors');
  await page.keyboard.press('Enter');
  t.check((await selected(page)) === 'input:"owner"', 'Enter selects it in the document', await selected(page));

  // Fixed: Valid. Undo brings the errors back.
  await page.evaluate((text) => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, FIXED);
  t.check(!!(await waitState(page, /^Valid/)), 'fixing the document shows Valid', await state(page));
  t.check(/matches the schema \(2020-12\)/.test(await page.evaluate(() => document.querySelector('#view-schema .sch-empty')?.textContent ?? '')), 'with the draft');
  await page.keyboard.press(`${MOD}+z`);
  t.check(!!(await waitState(page, /6 errors/)), 'Undo brings the errors back', await state(page));

  // A schema that isn't JSON: its own state, then undone.
  await page.evaluate(() => {
    const ta = document.getElementById('schema-input');
    ta.focus();
    ta.setSelectionRange(0, 0);
    document.execCommand('insertText', false, 'x');
  });
  const broken = await until(page, () => (document.querySelector('#view-schema .sch-empty')?.textContent ?? '').includes('The schema is not valid JSON') && document.querySelector('#view-schema .sch-empty').textContent, null);
  t.check(!!broken, 'a broken schema says so, with where', broken);
  await page.keyboard.press(`${MOD}+z`);
  t.check(!!(await waitState(page, /6 errors/)), 'Undo in the schema editor restores it', await state(page));

  // Check formats: an invalid email is an error only when asked.
  await page.evaluate((text) => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, FIXED.replace('ada@example.com', 'not-an-email'));
  t.check(!!(await waitState(page, /^Valid/)), 'format is an annotation by default', await state(page));
  await page.locator('.sch-fmt').click();
  t.check(!!(await waitState(page, /1 error/)), 'Check formats finds the bad email', await state(page));
  t.check((await page.evaluate((s) => document.querySelector(s)?.querySelector('.sch-msg')?.textContent, ROWS)) === 'Must be a valid email', 'with its message');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('on a phone: the three panes stack and the errors show', { mobile: true, width: 390, height: 844 }, async (t) => {
  const { page } = t;
  await t.open('/tools/json-schema-validator');
  t.check((await until(page, (s) => document.querySelectorAll(s).length === 6, ROWS, { timeout: 30_000 })) === true, 'six errors');
  const boxes = await page.evaluate(() => ['.pane-ed', '.pane-sch', '.pane-view'].map((s) => document.querySelector(s).getBoundingClientRect()).map((r) => [Math.round(r.top), Math.round(r.height), Math.round(r.width)]));
  t.check(boxes.every(([, h, w]) => h > 100 && w >= 380) && boxes[0][0] < boxes[1][0] && boxes[1][0] < boxes[2][0], 'document, schema and results stacked, each full width', boxes);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.pane-sch .toolbar, .sch-head')].map((el) => el.scrollWidth - el.clientWidth));
  t.check(overflow.every((x) => x <= 1), 'no toolbar overflows', overflow);
  t.check(await page.evaluate(() => [...document.querySelectorAll('.tabs-pick select option')].some((o) => o.value === 'schema' && o.selected)), 'the view dropdown shows Schema');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('home: Alt+7 opens Schema, Generate from the document, Close goes back', async (t) => {
  const { page } = t;
  await t.open('/');
  t.check(await setDoc(page, '{"id": 1, "tags": ["a", "b"], "price": 9.5}'), 'a document');
  await page.keyboard.press('Alt+7');
  t.check(!!(await until(page, () => (document.querySelector('#view-schema .sch-empty')?.textContent ?? '').includes('Validate JSON against a JSON Schema'), null, { timeout: 20_000 })), 'an empty schema explains what to do');
  await page.getByRole('button', { name: 'Generate from the document' }).click();
  const schema = await until(page, () => document.getElementById('schema-input')?.value.includes('"$schema"') && document.getElementById('schema-input').value, null);
  t.check(!!schema && schema.includes('"price"'), 'the generated schema is in the schema editor', schema?.slice(0, 80));
  t.check(!!(await waitState(page, /^Valid/)), 'and the document is valid against it', await state(page));
  await page.locator('.pane-sch [aria-label="Close schema"]').click();
  t.check(await until(page, () => document.querySelector('.pane-sch')?.hidden && !document.getElementById('view-format').hidden, null), 'Close schema goes back to the view before');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});
