// The first second after the page loads, before its idle loads finish (the command palette, the context menu,
// tooltips, the JWT reader, the file reader and WebMCP's tools come in then). Each check acts as soon as the editor
// is in the page, without waiting for the tool to be ready; in Chromium the CPU is slowed down (6×) so the window
// is wide. Whatever was asked for must still happen (a moment later is fine), and nothing may throw.
import { defaults, test } from '../../lib/api.mjs';
import { paste, view } from '../../lib/app.mjs';
import { until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker', 'early'], timeout: 120_000, allowErrors: true });

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const DOC = JSON.stringify({ name: 'early', list: [1, 2, { deep: true }], note: 'x' }, null, 2);
// HS256, exp in 2027-09.
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc5MDgxMjgwMCwiZXhwIjoxODIyMzQ4ODAwfQ.8cC1krME5G5HZQKPQy8oBEQueQ60R5UgQLB1iXcLpBs';

/**
 * Opens `path` and returns as soon as the input editor is in the page: no wait for the tool. Collects page errors.
 * Chromium's CPU runs 6× slower (the idle loads come later, so the window is wide).
 */
async function early(t, path = '/') {
  const { page } = t;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  if (t.engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  }
  await page.goto(t.base + path, { waitUntil: 'commit' });
  await page.waitForSelector('#input', { state: 'attached', timeout: 60_000 });
  return errors;
}

const status = (page) => page.evaluate(() => window.__vis('.sb-l .st')?.textContent ?? window.__vis('.sb-l')?.textContent ?? '');
/** Waits up to `timeout` for `fn` (in the page) to be truthy; null when it never was. */
const soon = (page, fn, arg, timeout = 20_000) => until(page, fn, arg, { timeout }).catch(() => null);

test('typed before the tool is ready: the text is kept and read', async (t) => {
  const { page } = t;
  const errors = await early(t);
  await page.locator('#input').focus();
  await page.keyboard.insertText(DOC);
  const st = await soon(page, () => /^Valid JSON/.test(window.__vis('.sb-l .st')?.textContent ?? '') || null);
  t.check(!!st, 'the status says Valid JSON', await status(page));
  const text = await page.evaluate(() => document.getElementById('input').value);
  t.check(text === DOC, 'the editor holds exactly what was typed', text.slice(0, 80));
  t.check(!errors.length, 'no page errors', errors);
});

test('shortcuts in the first second: the palette, a view, Find and Format in place', async (t) => {
  const { page } = t;
  const errors = await early(t);
  await page.locator('#input').focus();
  await page.keyboard.insertText(DOC.replace(/\s+/g, ''));
  // The command palette at once.
  await page.keyboard.press(`${MOD}+k`);
  const palette = await soon(page, () => !!window.__vis('.palette input') || null);
  t.check(!!palette, 'mod+K opens the command palette', null);
  if (palette) await page.keyboard.press('Escape');
  await soon(page, () => !window.__vis('.palette input') || null, null, 5000);
  // A view by its key, then Find in it.
  await page.locator('#input').focus();
  await page.keyboard.press('Alt+2');
  const tree = await soon(page, () => (window.__vis('.app [role=tab][aria-controls="view-tree"]')?.getAttribute('aria-selected') === 'true' && (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 0) || null);
  t.check(!!tree, 'Alt+2 shows the tree', null);
  await page.keyboard.press(`${MOD}+f`);
  const find = await soon(page, () => !!window.__vis('.findbar input') || null);
  t.check(!!find, 'mod+F opens Find', null);
  if (find) await page.keyboard.press('Escape');
  // Format in place from the editor.
  await page.locator('#input').focus();
  await page.keyboard.press('Shift+Alt+F');
  const formatted = await soon(page, (want) => document.getElementById('input').value === want || null, DOC);
  t.check(!!formatted, 'Shift+Alt+F formats the input in place', await page.evaluate(() => document.getElementById('input').value.slice(0, 60)));
  t.check(!errors.length, 'no page errors', errors);
});

test('right-click in the first second: the editor menu opens with its items', async (t) => {
  const { page } = t;
  const errors = await early(t);
  await page.locator('#input').focus();
  await page.keyboard.insertText(DOC);
  const box = await page.locator('#input').boundingBox();
  await page.mouse.click(box.x + 40, box.y + 20, { button: 'right' });
  const items = await soon(page, () => { const m = document.querySelector('.menu.ctx'); return m && m.querySelectorAll('.mi').length ? m.querySelectorAll('.mi').length : null; });
  t.check(!!items, 'the context menu opens, with items', items);
  if (items) await page.keyboard.press('Escape');
  t.check(!errors.length, 'no page errors', errors);
});

test('the pointer already on a button when the page loads: its tooltip shows', async (t) => {
  const { page } = t;
  const errors = await early(t);
  // The share button is in the page from the start (its tooltip once the tooltip code is in).
  const btn = page.locator('.app:visible button[data-tip]').first();
  await btn.waitFor({ state: 'visible', timeout: 60_000 });
  const tip = await btn.getAttribute('data-tip');
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  // Not moved again: the tooltip has to come for a pointer that was already there.
  const shown = await soon(page, (want) => { const t = document.querySelector('.tip'); return (t?.classList.contains('in') && t.textContent.includes(want)) || null; }, tip, 15_000);
  t.check(!!shown, `the tooltip "${tip}" shows without moving the pointer again`, await page.evaluate(() => ({ made: !!document.querySelector('.tip'), in: document.querySelector('.tip')?.classList.contains('in') ?? false })));
  t.check(!errors.length, 'no page errors', errors);
});

test('a JWT pasted in the first second: its JWT status, not a JSON error', async (t) => {
  const { page } = t;
  const errors = await early(t);
  await page.locator('#input').focus();
  await paste(page, JWT);
  const st = await soon(page, () => (/^JWT · HS256/.test(window.__vis('.sb-l')?.textContent ?? '') ? window.__vis('.sb-l').textContent : null));
  t.check(!!st, 'the status says JWT · HS256', await status(page));
  t.check(!errors.length, 'no page errors', errors);
});

test('a share link holding a JWT, opened cold: its JWT status', async (t) => {
  const { page } = t;
  const { deflateRawSync } = await import('node:zlib');
  const data = deflateRawSync(Buffer.from(JWT), { level: 9 }).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const errors = await early(t, `/#a=${data}`);
  const st = await soon(page, () => (/^JWT · HS256/.test(window.__vis('.sb-l')?.textContent ?? '') ? window.__vis('.sb-l').textContent : null), null, 30_000);
  t.check(!!st, 'the status says JWT · HS256', await status(page));
  t.check(!errors.length, 'no page errors', errors);
});

test('a file opened in the first second: it loads (the file reader comes in on first use)', async (t) => {
  const { page } = t;
  const errors = await early(t);
  await page.locator('.app input[type=file]').first().setInputFiles({ name: 'early.json', mimeType: 'application/json', buffer: Buffer.from(DOC) });
  const st = await soon(page, () => /^Valid JSON/.test(window.__vis('.sb-l .st')?.textContent ?? '') || null, null, 30_000);
  t.check(!!st, 'the status says Valid JSON', await status(page));
  const text = await page.evaluate(() => document.getElementById('input').value);
  t.check(text === DOC, 'the editor holds the file', text.slice(0, 80));
  t.check(!errors.length, 'no page errors', errors);
});

const WEBMCP = { channel: 'chromium', args: ['--enable-features=WebMCPTesting', '--enable-blink-features=WebMCP'] };

test('WebMCP tools called right after the page loads: open, read, decode a JWT', { engines: ['chromium'], launch: WEBMCP }, async (t) => {
  const { page } = t;
  const errors = await early(t);
  // The first moment the page offers any tool: call them at once, as an agent polling for tools would.
  let tools = 0;
  for (const end = Date.now() + 30_000; !tools && Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    tools = await page.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0).catch(() => 0);
  }
  t.assert(tools > 0, 'the page offers its tools', tools);
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const tool = (await document.modelContext.getTools()).find((x) => x.name === name);
      if (!tool) return { threw: `no tool ${name}` };
      try {
        const r = await document.modelContext.executeTool(tool, args);
        return { text: typeof r === 'string' ? r : JSON.stringify(r) };
      } catch (e) {
        return { threw: String(e).slice(0, 200) };
      }
    }, [name, args]);
  const opened = await call('open_json', { text: DOC, name: 'early.json' });
  t.check(!opened.threw && !/^Error/.test(opened.text ?? ''), 'open_json answers', opened);
  const value = await call('get_json_value', { path: '$.list[2].deep' });
  t.check(/true/.test(value.text ?? ''), 'get_json_value reads the document just opened', value);
  await call('open_json', { text: JWT });
  const jwt = await call('decode_jwt');
  t.check(/"name": "Ada Lovelace"/.test(jwt.text ?? ''), 'decode_jwt decodes the token', jwt);
  t.check(!errors.length, 'no page errors', errors);
});

test('views clicked in the first second: Tree, Table and Graph each show the document', async (t) => {
  const { page } = t;
  const errors = await early(t);
  await page.locator('#input').focus();
  await page.keyboard.insertText(DOC);
  for (const v of ['tree', 'table', 'graph']) {
    await view(page, v, { timeout: 60_000 }).catch(() => null);
    const shown = await soon(page, (v) => {
      const el = window.__vis(`#view-${v}`);
      if (!el) return null;
      if (v === 'tree') return (el.querySelector('.tv-rows')?.childElementCount ?? 0) > 0 || null;
      if (v === 'table') return (el.querySelector('.tb-rows')?.childElementCount ?? 0) > 0 || !el.querySelector('.tb-empty')?.hidden || null;
      return !!el.querySelector('canvas') || null;
    }, v, 30_000);
    t.check(!!shown, `the ${v} view shows the document`, null);
  }
  t.check(!errors.length, 'no page errors', errors);
});
