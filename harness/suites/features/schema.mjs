// The Schema view (JSON Schema validation): the validator page's sample and its six errors, a click or Enter on an
// error selecting it in the document, a keyword selecting the rule in the schema, keyboard navigation, fixing to
// Valid and undoing (Valid, never "Validating…" while a check is on its way), a broken schema, Check formats, the
// phone layout, and from the home page Alt+7, Generate from the document and Close; the view toolbar at the widths
// where its row is full; a German page's strings, also after a failed load; the palette's Generate on a fresh page;
// share links with a schema; errors' places in YAML and CSV input; remote $refs fetched only when asked; the official
// meta-schemas resolved from the app's own copy.
import { defaults, test } from '../../lib/api.mjs';
import { MOD, docOf, enc, resetClip, setDoc, until, waitClip } from './_helpers.mjs';

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
  // (Compare and Schema at 1280px: a 434px viewer, where main's narrow rule wraps; their toolbar has no control.)
  for (const [width, view] of [[1280, 'Alt+2'], [1280, 'Alt+3'], [1280, 'Alt+4'], [1600, 'Alt+1'], [1600, 'Alt+5'], [1280, 'Alt+6'], [1280, 'Alt+7']]) {
    await page.setViewportSize({ width, height: 800 });
    await page.keyboard.press(view);
    rows.push([width, view, await page.evaluate(() => Math.round(document.querySelector('.pane-view .vbar').getBoundingClientRect().height))]);
  }
  t.check(rows.every(([, , h]) => h <= 46), 'a view whose tabs, control and icons fit keeps a one-row toolbar', rows);
  // Compare and Schema have no control there: no box at all, not an empty flex line under main's narrow wrap.
  const empty = [];
  for (const view of ['Alt+6', 'Alt+7']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press(view);
    empty.push(await page.evaluate(() => document.querySelector('.pane-view .vbar .vmain')?.getClientRects().length ?? 0));
  }
  t.check(empty.every((n) => n === 0), 'an empty view control takes no row', empty);
  // A long path shortens rather than taking a row: the Tree view with a deep value selected (CI's fonts are wider
  // than some hosts': the path must never decide it).
  await page.setViewportSize({ width: 1280, height: 800 });
  t.check(await setDoc(page, JSON.stringify({ data: [{ id: 1 }, { id: 2 }, { name: { first: 'Ingrid', last: 'Haddad' }, account_number: 9007199254764750 }] }, null, 2)), '/: a deep document');
  await page.keyboard.press('Alt+2');
  await page.evaluate(() => {
    const ta = document.getElementById('input');
    const p = ta.value.indexOf('Ingrid');
    ta.focus();
    ta.setSelectionRange(p, p);
  });
  await page.keyboard.press('ArrowRight');
  const deep = await until(page, () => (document.querySelector('.pane-view .vbar .path')?.textContent ?? '').length > 15 && document.querySelector('.pane-view .vbar .path').textContent, null, { timeout: 10_000 });
  const bar = await page.evaluate(() => {
    const vbar = document.querySelector('.pane-view .vbar');
    const boxes = [...vbar.querySelectorAll(':is(.tabs, .vmain > *, .vicons)')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    const overlap = boxes.some((a, i) => boxes.slice(i + 1).some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
    return { h: Math.round(vbar.getBoundingClientRect().height), overlap };
  });
  t.check(!!deep && bar.h <= 46 && !bar.overlap, 'a long path shortens: one row, nothing overlapping', { deep, ...bar });
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

test('a document that can\'t be read as its format: the panel says to fix it, never "Validating…" (round 4, finding 3)', async (t) => {
  const { page } = t;
  await t.open('/');
  t.check(await setDoc(page, '{"id": 1}'), 'a document');
  await page.keyboard.press('Alt+7');
  await page.locator('.pane-sch [aria-label="Schema options"]').click();
  await page.getByRole('menuitem', { name: 'Generate from the document' }).click();
  t.check(!!(await waitState(page, /^Valid(?!ating)/)), 'valid against its generated schema', await state(page));
  // Read as XML, then "<root>": not XML yet.
  await page.locator('.pane-ed .fmt-pick select').selectOption('xml');
  await page.evaluate(() => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, '<root>');
  });
  const fix = await until(page, () => (document.querySelector('#view-schema .sch-empty')?.textContent ?? '').includes('Fix the document on the left to validate it') && !/Validating/.test(document.querySelector('#view-schema .sch-state')?.textContent ?? ''), null, { timeout: 15_000 });
  t.check(fix === true, 'the panel says to fix the document', await page.evaluate(() => [document.querySelector('#view-schema .sch-state')?.textContent, document.querySelector('#view-schema .sch-empty')?.textContent]));
  // Fixed: validated again.
  await page.evaluate(() => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, '<root><id>1</id></root>');
  });
  t.check(!!(await until(page, () => /^(Valid(?!ating)|\d+ errors?|Not fully)/.test(document.querySelector('#view-schema .sch-state')?.textContent ?? ''), null, { timeout: 15_000 })), 'the XML read: validated', await state(page));
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('Schema open, another page, then Back: the result shows again, not "Validating…" (round 4, finding 4)', async (t) => {
  const { page } = t;
  await t.open('/');
  t.check(await setDoc(page, '{"id": 1, "tags": ["a"]}'), 'a document');
  await page.keyboard.press('Alt+7');
  await page.locator('.pane-sch [aria-label="Schema options"]').click();
  await page.getByRole('menuitem', { name: 'Generate from the document' }).click();
  t.check(!!(await waitState(page, /^Valid(?!ating)/)), 'validated', await state(page));
  const engines = await t.app.engineCount(page);
  await t.app.navigate(page, '/privacy');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.pathname === '/', null, { timeout: 60_000, polling: 50 });
  await t.app.waitEngine(page, { after: engines, timeout: 60_000 });
  const shown = await until(page, () => [...document.querySelectorAll('#view-schema .sch-state')].some((el) => el.offsetParent && /^Valid(?!ating)/.test(el.textContent)), null, { timeout: 15_000 });
  t.check(shown === true, 'Valid again after Back', await page.evaluate(() => [...document.querySelectorAll('#view-schema .sch-state')].map((el) => el.textContent)));
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('Share from the Schema view carries the schema and its options; the link opens them, a schema by URL too (D)', async (t) => {
  const { page } = t;
  await t.open('/');
  t.check(await setDoc(page, '{"id": "7", "email": "not-an-email"}'), 'a document');
  await page.keyboard.press('Alt+7');
  await page.evaluate((text) => {
    const ta = document.getElementById('schema-input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, '{\n  "properties": {\n    "id": { "type": "integer" },\n    "email": { "format": "email" }\n  }\n}\n');
  await page.locator('.sch-fmt').click();
  t.check(!!(await waitState(page, /^2 errors/)), 'two errors, formats checked', await state(page));
  await resetClip(page);
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  const url = await waitClip(page);
  const hash = url ? new URL(url).hash : '';
  t.check(/&view=schema/.test(hash) && /&formats=1/.test(hash) && !/draft=/.test(hash), 'the link names the Schema view and Check formats', hash.replace(/=[\w-]{12,}/g, '=…'));
  t.check(!!url && docOf(url, 'b') === '{"properties":{"id":{"type":"integer"},"email":{"format":"email"}}}', 'b is the schema, minified', url && docOf(url, 'b'));
  // Opened in a fresh tab: the document, the schema in its editor, formats on, the same two errors.
  const p2 = await t.context.newPage();
  await p2.goto(url, { waitUntil: 'commit' });
  await t.app.waitEngine(p2);
  const opened = await until(p2, () => (document.getElementById('schema-input')?.value ?? '').includes('"format": "email"') && /^2 errors/.test(document.querySelector('#view-schema .sch-state')?.textContent ?? ''), null, { timeout: 20_000 });
  t.check(opened === true, 'the schema in the schema editor, validated: 2 errors', await p2.evaluate(() => [document.querySelector('#view-schema .sch-state')?.textContent, document.getElementById('schema-input')?.value.slice(0, 40)]));
  t.check((await p2.evaluate(() => document.querySelector('.sch-fmt')?.getAttribute('aria-pressed'))) === 'true', 'Check formats is on');
  await p2.close();
  // An old link: b and no view is Compare's document, as before.
  await page.goto(`${t.base}/#a=${enc('[1]')}&b=${enc('[2]')}`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  t.check(!!(await until(page, () => !document.querySelector('.pane-cmp')?.hidden && document.getElementById('input2')?.value.includes('2'), null, { timeout: 15_000 })), 'b without a view opens Compare');
  // A schema by URL, fetched as a document's is; its file name shows.
  await page.route('https://schemas.example.test/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"type": "array", "items": {"type": "number"}}' }));
  await page.goto(`${t.base}/#a=${enc('[1, "x"]')}&b=${encodeURIComponent('https://schemas.example.test/numbers.schema.json')}&view=schema&draft=draft-07`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  const fetched = await until(page, () => /^1 error/.test(document.querySelector('#view-schema .sch-state')?.textContent ?? '') && document.querySelector('.pane-sch .fname')?.textContent, null, { timeout: 20_000 });
  t.check(fetched === 'Schemanumbers.schema.json', 'the fetched schema, named, validated: 1 error', fetched);
  t.check((await page.evaluate(() => document.querySelector('.pane-sch select')?.value)) === '7', 'the draft the link names is picked');
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

test('input in another format: errors show and select their places in it, YAML and CSV, a missing CSV cell near its row (E)', async (t) => {
  const { page } = t;
  await t.open('/');
  await page.locator('.pane-ed .fmt-pick select').selectOption('yaml');
  const yaml = 'name: Ada\nage: "36"\ntags:\n  - admin\n  - 7\n';
  await page.evaluate((text) => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, yaml);
  await page.keyboard.press('Alt+7');
  await page.evaluate((text) => {
    const ta = document.getElementById('schema-input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, '{"properties": {"age": {"type": "integer"}, "tags": {"items": {"type": "string"}}}}');
  t.check(!!(await waitState(page, /^2 errors/)), 'two errors', await state(page));
  const at = await until(page, (s) => {
    const all = [...document.querySelectorAll(s)].map((r) => r.querySelector('.sch-at')?.textContent ?? '');
    return all.length === 2 && all.every((x) => /Ln \d/.test(x)) && all;
  }, ROWS, { timeout: 10_000 });
  t.check(JSON.stringify(at) === JSON.stringify(['/age · Ln 2, Col 1', '/tags/1 · Ln 5, Col 3']), 'each error at its line in the YAML', at);
  await page.locator(`${ROWS}[data-i="0"] .sch-msg`).click();
  t.check((await selected(page)) === 'input:age: "36"', 'a click selects it in the YAML', await selected(page));
  await page.locator('.sch-list').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  t.check((await selected(page)) === 'input:- 7', 'Enter does too', await selected(page));
  // CSV: a cell, and a record without the cell (near its row).
  await page.locator('.pane-ed .fmt-pick select').selectOption('csv');
  await page.evaluate((text) => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, 'id,email\nx1,a@b.c\n2\n');
  await page.evaluate((text) => {
    const ta = document.getElementById('schema-input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, '{"items": {"properties": {"id": {"type": "integer"}, "email": {"type": "string"}}}}');
  const csv = await until(page, (s) => {
    const all = [...document.querySelectorAll(s)].map((r) => r.querySelector('.sch-at')?.textContent ?? '');
    return all.length === 2 && all.every((x) => /Ln \d/.test(x)) && all;
  }, ROWS, { timeout: 15_000 });
  t.check(JSON.stringify(csv) === JSON.stringify(['/0/id · Ln 2, Col 1', '/1/email · near Ln 3']), 'a CSV cell, and a missing one near its record', csv);
  await page.locator(`${ROWS}[data-i="0"] .sch-msg`).click();
  t.check((await selected(page)) === 'input:x1', 'a click selects the cell', await selected(page));
  t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
});

// (The 404 asked for on purpose is logged by the browser: the test checks the other errors itself.)
test('remote $refs: nothing fetched until asked; then each schema once, what it refers to offered next, failures said', { allowErrors: true }, async (t) => {
  const { page } = t;
  const requests = [];
  const site = {
    '/user.json': { type: 'object', properties: { id: { $ref: 'id.json' } } },
    '/id.json': { type: 'integer' },
  };
  await page.route('https://schemas.example.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const body = site[path];
    return route.fulfill(body ? { status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/schema+json' }, body: JSON.stringify(body) } : { status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' });
  });
  await t.open('/');
  t.check(await setDoc(page, '{"id": "x"}'), 'a document');
  await page.keyboard.press('Alt+7');
  await page.evaluate((text) => {
    const ta = document.getElementById('schema-input');
    ta.focus();
    ta.select();
    document.execCommand('insertText', false, text);
  }, JSON.stringify({ allOf: [{ $ref: 'https://schemas.example.test/user.json' }, { $ref: 'https://schemas.example.test/missing.json#/$defs/x' }] }));
  t.check(!!(await waitState(page, /^Not fully checked/)), 'not fully checked', await state(page));
  const urls = () => page.evaluate(() => [...document.querySelectorAll('.sch-remote .sch-urls li')].map((li) => li.textContent));
  const offered = await until(page, () => document.querySelectorAll('.sch-remote .sch-urls li').length === 2, null, { timeout: 5000 });
  t.check(offered === true && JSON.stringify(await urls()) === JSON.stringify(['https://schemas.example.test/user.json', 'https://schemas.example.test/missing.json']), 'the URLs are listed, without fragments', await urls());
  await page.waitForTimeout(500);
  t.check(requests.length === 0, 'nothing is requested before the click', requests);
  // Fetched: user.json resolves; missing.json says why; id.json, which user.json refers to, is offered next.
  await page.getByRole('button', { name: 'Fetch referenced schemas' }).click();
  const next = await until(page, () => {
    const items = [...document.querySelectorAll('.sch-remote .sch-urls li')].map((li) => li.textContent);
    return items.length === 2 && items.some((x) => x.startsWith('https://schemas.example.test/id.json')) && items;
  }, null, { timeout: 15_000 });
  t.check(!!next && next.some((x) => /missing\.json.*Request failed: 404/.test(x)), 'the failed one says why; the next one is offered', next);
  t.check(JSON.stringify([...requests].sort()) === JSON.stringify(['/missing.json', '/user.json']), 'each fetched once, nothing else', requests);
  t.check(/^Not fully checked/.test(await state(page)), 'still not fully checked', await state(page));
  // Asked again: id.json comes (missing.json is asked again too); id "x" isn't an integer.
  await page.getByRole('button', { name: 'Fetch referenced schemas' }).click();
  t.check(!!(await waitState(page, /^1 error/)), 'id.json applied: one error', await state(page));
  t.check(JSON.stringify([...requests].sort()) === JSON.stringify(['/id.json', '/missing.json', '/missing.json', '/user.json']), 'id.json once, the failed one retried', requests);
  // Dismissed: the offer goes.
  await page.getByRole('button', { name: 'Dismiss' }).first().click();
  t.check(!!(await until(page, () => !document.querySelector('.sch-remote'), null, { timeout: 5000 })), 'dismissed');
  t.check(!t.errors.filter((e) => !/404|Failed to load resource/.test(e)).length, 'no page errors', t.errors.slice(0, 3));
});

test('official meta-schemas: a $ref to one resolves from the app\'s own copy, by http or https; nothing asked of json-schema.org, nothing offered', async (t) => {
  const { page } = t;
  const outside = [];
  await page.context().route(/^https?:\/\/json-schema\.org\//, (route) => {
    outside.push(route.request().url());
    return route.abort();
  });
  await t.open('/');
  // A schema as the document: a type that doesn't exist, a negative minLength in a subschema.
  t.check(await setDoc(page, '{"type": "objekt", "properties": {"a": {"minLength": -1}}}'), 'a document');
  await page.keyboard.press('Alt+7');
  const setSchema = (text) =>
    page.evaluate((x) => {
      const ta = document.getElementById('schema-input');
      ta.focus();
      ta.select();
      document.execCommand('insertText', false, x);
    }, text);
  const rows = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((r) => r.textContent), ROWS);
  for (const url of ['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft/2020-12/schema']) {
    await setSchema(JSON.stringify({ $ref: url }));
    t.check(!!(await waitState(page, /^2 errors/, 20_000)), `${url}: both errors, the subschema's too`, await state(page));
    const list = await rows();
    t.check(list.some((r) => r.includes('/type')) && list.some((r) => r.includes('/properties/a/minLength')), `${url}: at /type and /properties/a/minLength`, list);
    t.check(!(await page.evaluate(() => !!document.querySelector('.sch-remote') || /Can't resolve/.test(document.getElementById('view-schema')?.textContent ?? ''))), `${url}: nothing unresolved, nothing offered`);
  }
  t.check(outside.length === 0, 'nothing asked of json-schema.org', outside);
});
