// The Schema view (JSON Schema validation): the validator page's sample and its six errors, a click or Enter on an
// error selecting it in the document, a keyword selecting the rule in the schema, keyboard navigation, fixing to
// Valid and undoing (Valid, never "Validating…" while a check is on its way), a broken schema, Check formats, the
// phone layout, and from the home page Alt+7, Generate from the document and Close; the view toolbar at the widths
// where its row is full; a German page's strings, also after a failed load; the palette's Generate on a fresh page.
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
  t.check(!!(await waitState(page, /^Valid(?!ating)/)), 'fixing the document shows Valid', await state(page));
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
  t.check(!!(await waitState(page, /^Valid(?!ating)/)), 'format is an annotation by default', await state(page));
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
  t.check(!!schema && schema.includes('"price"'), 'the generated schema is in the schema editor', String(schema).slice(0, 80));
  t.check(!!(await waitState(page, /^Valid(?!ating)/)), 'and the document is valid against it', await state(page));
  await page.locator('.pane-sch [aria-label="Close schema"]').click();
  t.check(await until(page, () => document.querySelector('.pane-sch')?.hidden && !document.getElementById('view-format').hidden, null), 'Close schema goes back to the view before');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('a schema that can\'t be applied is not fully checked, never Valid', async (t) => {
  const { page } = t;
  await t.open('/tools/json-schema-validator');
  t.check((await until(page, (s) => document.querySelectorAll(s).length === 6, ROWS, { timeout: 30_000 })) === true, 'the sample');
  await page.evaluate(() => {
    const ta = document.getElementById('schema-input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, '{"$ref": "https://example.test/missing"}');
  });
  t.check(!!(await waitState(page, /^Not fully checked/)), 'an unresolved $ref: not fully checked', await state(page));
  const row = await page.evaluate((s) => document.querySelector(s)?.textContent ?? '', ROWS);
  t.check(/Can't resolve \$ref https:\/\/example\.test\/missing/.test(row) && /not applied to the document/.test(row), 'the problem says it wasn\'t applied', row);
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('back on the page after another page: the schema editor still validates', async (t) => {
  const { page } = t;
  await t.open('/tools/json-schema-validator');
  t.check((await until(page, (s) => document.querySelectorAll(s).length === 6, ROWS, { timeout: 30_000 })) === true, 'the sample');
  const engines = await t.app.engineCount(page);
  await t.app.navigate(page, '/privacy');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.pathname === '/tools/json-schema-validator', null, { timeout: 60_000, polling: 50 });
  await t.app.waitEngine(page, { after: engines, timeout: 60_000 });
  // (The page left is kept hidden in the DOM: only the shown tool's rows count.)
  t.check((await until(page, (s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent).length === 6, ROWS, { timeout: 30_000 })) === true, 'six errors again');
  // Edits in either editor are validated again.
  await page.evaluate((text) => {
    const ta = [...document.querySelectorAll('#schema-input')].find((el) => el.offsetParent);
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, '{"type": "object"}');
  t.check(!!(await until(page, () => [...document.querySelectorAll('#view-schema .sch-state')].some((el) => el.offsetParent && /^Valid(?!ating)/.test(el.textContent)), null, { timeout: 15_000 })), 'a schema edit after Back is validated');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('a schema file opened over the page\'s sample is saved with its name', async (t) => {
  const { page } = t;
  await t.open('/tools/json-schema-validator');
  t.check((await until(page, (s) => document.querySelectorAll(s).length === 6, ROWS, { timeout: 30_000 })) === true, 'the sample');
  const text = '{\n  "title": "Orders",\n  "type": "array"\n}\n';
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.pane-sch [aria-label="Schema options"]').click();
  await page.getByRole('menuitem', { name: /^Open file/ }).click();
  await (await chooser).setFiles({ name: 'orders.schema.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  t.check(!!(await until(page, (x) => document.getElementById('schema-input')?.value === x, text)), 'the file is in the schema editor');
  // (One record, text and name: lib/schema/controller.ts SCHEMA_KEYS.doc.)
  const saved = await until(page, () => localStorage.getItem('jf:schema-doc') && JSON.parse(localStorage.getItem('jf:schema-doc')), null, { timeout: 5000 });
  t.check(JSON.stringify(saved) === JSON.stringify({ text, file: 'orders.schema.json' }), 'saved, text and name together, without typing', saved);
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('the view toolbar: every view reachable and nothing overlapping, with a document, in English, Russian and German', async (t) => {
  const { page } = t;
  // Viewer widths where the seven tabs, the Format view's control and the icons no longer fit on one row (English
  // overlapped at 1280–1440px windows; Russian, the longest labels, just below its dropdown at 900px). Odd windows
  // give the viewer half a pixel: 1803px makes it 900.5px, between the dropdown's 900px and the wrap's start.
  const cases = [['/', [1100, 1203, 1280, 1360, 1440, 1600]], ['/ru', [1803, 1820, 1900, 1960, 2100]], ['/de', [1803]]];
  const bad = [];
  for (const [path, widths] of cases) {
    await t.open(path);
    t.check(await setDoc(page, JSON.stringify({ id: 1, name: 'Ada', tags: ['a', 'b'] }, null, 2)), `${path}: a document`);
    for (const view of ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+5', 'Alt+7']) {
      await page.keyboard.press(view);
      if (view === 'Alt+7') await until(page, () => !!document.querySelector('.pane-sch:not([hidden])'), null, { timeout: 20_000 });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const r = await page.evaluate(() => {
          const bar = document.querySelector('.pane-view .vbar').getBoundingClientRect();
          const boxes = [...document.querySelectorAll('.pane-view .vbar :is(.tabs, .tabs-pick, .vmain > *, .vicons)')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
          let overlap = 0;
          for (const [i, a] of boxes.entries())
            for (const b of boxes.slice(i + 1)) {
              const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              if (x > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap = Math.max(overlap, Math.round(x));
            }
          const tabs = [...document.querySelectorAll('.pane-view .tabs [role=tab]')].filter((e) => e.getBoundingClientRect().width > 0).length;
          const pick = !!document.querySelector('.pane-view .tabs-pick')?.getBoundingClientRect().width;
          return { overlap, reachable: tabs === 7 || pick, outside: boxes.some((b) => b.right > bar.right + 1), viewer: Math.round(bar.width) };
        });
        if (r.overlap || !r.reachable || r.outside || r.viewer < 200) bad.push(`${path} ${view} ${width}px: ${JSON.stringify(r)}`);
      }
    }
  }
  t.check(!bad.length, 'every view has a tab or the dropdown, and the tabs, the view\'s control and the icons don\'t overlap', bad.slice(0, 6));
  // Where everything fits, one row: no row lost to the toolbar (a 1280px window's viewer is 640px wide).
  await t.open('/');
  t.check(await setDoc(page, JSON.stringify({ id: 1, name: 'Ada', tags: ['a', 'b'] }, null, 2)), '/: a document');
  const rows = [];
  for (const [width, view] of [[1280, 'Alt+2'], [1280, 'Alt+3'], [1280, 'Alt+4'], [1600, 'Alt+1'], [1600, 'Alt+5']]) {
    await page.setViewportSize({ width, height: 800 });
    await page.keyboard.press(view);
    rows.push([width, view, await page.evaluate(() => Math.round(document.querySelector('.pane-view .vbar').getBoundingClientRect().height))]);
  }
  t.check(rows.every(([, , h]) => h <= 46), 'a view whose tabs, control and icons fit keeps a one-row toolbar', rows);
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('a German page: the Schema view and Flatten show their own strings, loaded when they open', async (t) => {
  const { page } = t;
  const asked = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/i18n/')) asked.push(path);
  });
  await t.open('/de/tools/json-schema-validator');
  t.check((await until(page, (s) => document.querySelectorAll(s).length === 6, ROWS, { timeout: 30_000 })) === true, 'the sample\'s six errors');
  // (The view shows at once, in English where its strings aren't in yet: then in German.)
  t.check(!!(await waitState(page, /^6 Fehler/)), 'the header in German', await state(page));
  const first = await until(page, (s) => document.querySelector(s)?.querySelector('.sch-msg')?.textContent === 'Die Pflichteigenschaft "email" fehlt' || document.querySelector(s)?.querySelector('.sch-msg')?.textContent, ROWS);
  t.check(first === true, 'its messages in German', first);
  t.check((await page.evaluate(() => document.querySelector('.sch-fmt')?.textContent ?? '')).includes('Formate prüfen'), 'its options in German');
  // Flatten: Nested JSON (unflatten) of this nested document says there is nothing to unflatten.
  await page.keyboard.press('Alt+5');
  await page.locator('.app:visible .vmain select').selectOption('unflatten');
  const note = await until(page, () => /Verschachteln$/.test(document.querySelector('.view .banner .b-msg')?.textContent ?? '') && document.querySelector('.view .banner .b-msg').textContent, null, { timeout: 15_000 });
  t.check(note === 'Dieses JSON hat keine flachen Schlüssel zum Verschachteln', 'Flatten\'s note in German', note);
  t.check(asked.length === 2 && /^\/i18n\/schema-strings\.de\.[0-9a-f]{12}\.json$/.test(asked[0]) && /^\/i18n\/flatten-strings\.de\.[0-9a-f]{12}\.json$/.test(asked[1]), 'each feature\'s strings fetched once, when it opens: the page\'s language\'s', asked);
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('the palette\'s Generate on a fresh page: the view opens with the generated schema (round 2, finding 4)', async (t) => {
  const { page } = t;
  await t.open('/');
  t.check(await setDoc(page, '{"id": 1, "tags": ["a", "b"]}'), 'a document');
  // (Schema was never opened on this page: the command opens it.)
  await t.app.command(page, 'Generate a JSON Schema and validate against it');
  const schema = await until(page, () => document.getElementById('schema-input')?.value.includes('"$schema"') && document.getElementById('schema-input').value, null, { timeout: 20_000 });
  t.check(!!schema && schema.includes('"tags"'), 'the generated schema is in the schema editor', String(schema).slice(0, 80));
  t.check(!!(await waitState(page, /^Valid(?!ating)/)), 'and the document is valid against it', await state(page));
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

// (The failed request is logged by the browser: the test checks the other errors itself.)
test('a German page whose Schema strings failed to load once: English, then German when the view opens again (round 2, finding 10)', { allowErrors: true }, async (t) => {
  const { page } = t;
  let asked = 0;
  // (The first request for the Schema view's strings fails; the next ones go through.)
  await page.route(/\/i18n\/schema-strings\.de\.[0-9a-f]+\.json/, (route) => (asked++ ? route.continue() : route.fulfill({ status: 404, body: '' })));
  await t.open('/de');
  t.check(await setDoc(page, '{"id": 1}'), 'a document');
  // The view opens at once, in English while its strings are asked for; the request fails.
  const failed = page.waitForResponse((r) => /\/i18n\/schema-strings\.de\./.test(r.url()) && r.status() === 404, { timeout: 20_000 }).then(() => true, () => false);
  await page.keyboard.press('Alt+7');
  t.check(await failed, 'the view asks for its strings when it opens', { asked });
  const english = await until(page, () => (document.querySelector('.sch-fmt')?.textContent ?? '').includes('Check formats'), null, { timeout: 20_000 });
  t.check(english === true, 'the view shows, in English');
  // Closed and opened again: asked for again, and shown in German. (A reopening while the failed request is still
  // being answered waits for that answer: opened again until it is asked for again.)
  for (let i = 0; i < 5 && asked < 2; i++) {
    await page.keyboard.press('Alt+1');
    await page.keyboard.press('Alt+7');
    for (let k = 0; k < 10 && asked < 2; k++) await page.waitForTimeout(100);
  }
  const german = await until(page, () => (document.querySelector('.sch-fmt')?.textContent ?? '').includes('Formate prüfen'), null, { timeout: 20_000 });
  t.check(german === true && asked >= 2, 'opened again: German', { asked });
  t.check(!t.errors.filter((e) => !/404|Failed to load resource/.test(e)).length, 'no page errors', t.errors.slice(0, 3));
});
