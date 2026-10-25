// WebMCP (lib/webmcp): an AI agent in the browser calls the JSON tool's 12 functions. Needs the full
// Chromium with WebMCP switched on (the headless shell has no flag for it). Tools are called the way an
// agent's browser does, through document.modelContext.executeTool.
// Ported from ~/.cache/webmcp-test/e2e.mjs (27 checks) and e2e-dl.mjs (12 checks) as parallel tests.
import { readFileSync } from 'node:fs';
import { defaults, test } from '../../lib/api.mjs';
import { MOD, POLL, waitVisible } from './_helpers.mjs';

const WEBMCP = { channel: 'chromium', args: ['--enable-features=WebMCPTesting', '--enable-blink-features=WebMCP'] };
defaults({ engines: ['chromium'], launch: WEBMCP, tags: ['webmcp'], timeout: 90_000 });

/** Waits until the page offers `n` tools (they register once the page is idle). */
const waitTools = (page, n = 12, timeout = 20_000) =>
  page.waitForFunction(async (n) => (await document.modelContext?.getTools?.())?.length === n, n, { ...POLL, timeout });
const toolCount = (page) => page.evaluate(async () => (await document.modelContext.getTools()).length);

/** Calls a tool as an agent would; returns its text (Chrome passes string results through as they are). */
const exec = (page, name, args = {}) =>
  page.evaluate(
    async ([name, args]) => {
      const t = (await document.modelContext.getTools()).find((x) => x.name === name);
      if (!t) return `no tool ${name}`;
      try {
        return await document.modelContext.executeTool(t, args);
      } catch {
        // (Chrome's first builds took the arguments as JSON text.)
        return document.modelContext.executeTool(t, JSON.stringify(args));
      }
    },
    [name, args],
  );

/** Polls a tool until its answer matches `re` (an action's effect lands a moment after the key press). */
async function untilTool(page, name, re, timeout = 10_000) {
  const t0 = Date.now();
  let r;
  while (!re.test((r = await exec(page, name)))) {
    if (Date.now() - t0 > timeout) break;
    await new Promise((res) => setTimeout(res, 25));
  }
  return r;
}

const selectedView = (page) => page.evaluate(() => window.__vis('.pane-view [role="tab"][aria-selected="true"]')?.textContent?.trim() ?? '');
/** Waits until the selected view's tab reads `re`; returns whether it did. */
const waitView = (page, re, timeout = 10_000) =>
  page
    .waitForFunction(([s, f]) => new RegExp(s, f).test(window.__vis('.pane-view [role="tab"][aria-selected="true"]')?.textContent ?? ''), [re.source, re.flags], { ...POLL, timeout })
    .then(() => true, () => false);
const waitToast = (page, re, timeout = 10_000) =>
  page
    .waitForFunction(([s, f]) => new RegExp(s, f).test(window.__vis('.toast')?.textContent ?? ''), [re.source, re.flags], { ...POLL, timeout })
    .then(() => true, () => false);
const viewText = (page) => page.evaluate(() => window.__vis('.pane-view')?.textContent ?? '');
const waitViewText = (page, needle, timeout = 10_000) =>
  page.waitForFunction((n) => (window.__vis('.pane-view')?.textContent ?? '').includes(n), needle, { ...POLL, timeout }).then(() => true, () => false);

test('the tools load only where the browser has WebMCP', async (t) => {
  // The same page in a browser without WebMCP (the shared headless shell) and in this one.
  const plain = await t.newPage({ launch: {} });
  const scripts = (page) => {
    const js = new Set();
    page.on('request', (r) => r.resourceType() === 'script' && js.add(new URL(r.url()).pathname));
    return js;
  };
  const off = scripts(plain.page);
  const on = scripts(t.page);
  await Promise.all([t.app.open(plain.page, t.base, '/'), t.open('/')]);
  await waitTools(t.page);
  // Without WebMCP the page schedules nothing for agents; give it the same idle moment the tools wait for.
  await plain.page.evaluate(() => new Promise((r) => requestIdleCallback(() => r(), { timeout: 2000 })));
  t.check(await plain.page.evaluate(() => !document.modelContext && !navigator.modelContext), 'the plain browser has no WebMCP');
  const extra = [...on].filter((u) => !off.has(u));
  t.log(`scripts without WebMCP: ${off.size}, with: ${on.size}, extra: ${extra.join(' ')}`);
  t.check(extra.length >= 1, 'the tools come in a script only browsers with WebMCP load', extra);
  // The tools' definitions are in those scripts, and in none a visitor without WebMCP downloads.
  const holds = async (path) => (await (await fetch(t.base + path)).text()).includes('get_json_value');
  const inExtra = (await Promise.all(extra.map(holds))).some(Boolean);
  const inPlain = (await Promise.all([...off].map(async (p) => ((await holds(p)) ? p : null)))).filter(Boolean);
  t.check(inExtra, 'the extra script holds the tools');
  t.check(!inPlain.length, 'no script of the page without WebMCP holds the tools', inPlain);
});

test('open, undo, redo, repair, format, convert, read, compare and show', async (t) => {
  const page = t.page;
  await t.open('/');
  await waitTools(page);
  t.check((await toolCount(page)) === 12, '12 tools registered');

  // Something the user typed first, to undo back to.
  await page.click('.app:visible .ed');
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type('{"mine":1}');
  await t.app.waitValid(page);

  let r = await exec(page, 'open_json', { text: '{"b":1,"a":[1,2,],}', name: 'agent.json', view: 'tree' });
  t.check(await waitView(page, /tree/i), 'open_json: tree view shown', await selectedView(page));
  t.check(await waitToast(page, /AI agent/), 'open_json: toast says the agent opened it', await page.evaluate(() => window.__vis('.toast')?.textContent));
  t.check(/Not valid JSON yet: 2 issues/.test(r), 'open_json: result lists the issues', r);

  await page.click('.app:visible .ed');
  await page.keyboard.press(`${MOD}+z`);
  r = await untilTool(page, 'check_json', /an object with 1 key/);
  t.check(/an object with 1 key/.test(r), "undo brings back the user's document", r);
  await page.keyboard.press(`${MOD}+Shift+z`);
  r = await untilTool(page, 'check_json', /2 issues/);
  t.check(/2 issues/.test(r), "redo brings back the agent's document", r);

  r = await exec(page, 'repair_json');
  t.check(/The document now reads:\n\{\n {2}"b": 1,\n {2}"a": \[\n {4}1,\n {4}2\n {2}\]\n\}$/.test(r), 'repair_json repairs in place', r);
  r = await exec(page, 'check_json');
  t.check(/^Valid JSON/.test(r), 'after repair the document is valid', r);

  r = await exec(page, 'format_json', { style: 'minified', sort_keys: true });
  t.check(r === '{"a":[1,2],"b":1}', 'format_json returns minified sorted output', r);
  t.check(await waitView(page, /format/i), 'format_json shows the Format view', await selectedView(page));
  t.check(await waitViewText(page, '{"a":[1,2],"b":1}'), 'the Format view shows the same output', (await viewText(page)).slice(0, 200));
  await exec(page, 'format_json', { style: 'pretty', sort_keys: false });

  r = await exec(page, 'convert_json', { to: 'go', root_name: 'Thing' });
  t.check(/type Thing struct/.test(r), 'convert_json returns Go', r);
  t.check(await waitView(page, /convert/i), 'convert_json shows Convert', await selectedView(page));
  t.check(await waitViewText(page, 'type Thing struct'), 'the Convert view shows the same code', (await viewText(page)).slice(0, 200));

  r = await exec(page, 'get_json_value', { path: '$.a[1]' });
  t.check(/^\$\.a\[1\] is a number\.\n\nValue:\n2$/.test(r), 'get_json_value reads $.a[1]', r);

  r = await exec(page, 'compare_json', { modified: '{"a":[1,3],"b":1}' });
  t.check(/changed \$\.a\[1\]: 2 → 3/.test(r), 'compare_json lists the change', r);
  const comparing = await page.waitForFunction(() => window.__vis('.app')?.classList.contains('comparing'), null, { ...POLL, timeout: 10_000 }).then(() => true, () => false);
  t.check(comparing, 'compare_json opens Compare');

  r = await exec(page, 'show_view', { view: 'graph' });
  t.check((await waitView(page, /graph/i)) && r === 'Showing the graph view.', 'show_view graph', `${await selectedView(page)} ${r}`);
});

test('import YAML, decode a JWT, and a bad argument explained', async (t) => {
  const page = t.page;
  await t.open('/');
  await waitTools(page);
  await exec(page, 'open_json', { text: 'name: Ada\nage: 36\n' });
  let r = await exec(page, 'import_to_json', { from: 'yaml' });
  t.check(/\{\n {2}"name": "Ada",\n {2}"age": 36\n\}/.test(r), 'import_to_json turns YAML into JSON', r);
  t.check(await waitToast(page, /Converted YAML to JSON · Ctrl\+Z to undo/), 'import_to_json toast offers undo', await page.evaluate(() => window.__vis('.toast')?.textContent));

  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc5MDgxMjgwMCwiZXhwIjoxODIyMzQ4ODAwfQ.8cC1krME5G5HZQKPQy8oBEQueQ60R5UgQLB1iXcLpBs';
  await exec(page, 'open_json', { text: jwt });
  r = await exec(page, 'decode_jwt');
  t.check(/"name": "Ada Lovelace"/.test(r), 'decode_jwt', r);

  r = await exec(page, 'convert_json', { to: 'cobol' });
  t.check(/^Error: to must be one of/.test(r), 'a bad argument comes back as an explanation', r);
});

test('a big output is cut with a note', { slots: 2 }, async (t) => {
  const page = t.page;
  await t.open('/');
  await waitTools(page);
  // About 7 MB of records, made in the page.
  const opened = await page.evaluate(async () => {
    const rows = [];
    for (let i = 0; i < 60000; i++) rows.push({ id: i, name: 'user ' + i, email: `u${i}@example.com`, tags: ['a', 'b'], profile: { city: 'London', score: i * 1.5 } });
    const t = (await document.modelContext.getTools()).find((x) => x.name === 'open_json');
    return document.modelContext.executeTool(t, { text: JSON.stringify(rows), name: 'big.json', view: 'format' });
  });
  t.log('open big →', opened.slice(0, 120));
  const r = await exec(page, 'format_json', {});
  t.check(/\[Cut at 50,000 of [\d,]+ characters/.test(r), 'big output is cut with a note', r.slice(-200));
  const v = await exec(page, 'get_json_value', { path: '$[59999].profile' });
  t.check(/"score": 89998\.5/.test(v), 'get_json_value reads the last record of the big document', v.slice(0, 200));
});

test('the tools leave with the JSON tool and come back with it; they work on a landing page', async (t) => {
  const page = t.page;
  await t.open('/');
  await waitTools(page);
  await page.locator('a[href="/privacy"]:visible').first().click();
  await page.waitForURL('**/privacy');
  const left = await waitTools(page, 0, 10_000).then(() => true, () => false);
  t.check(left, 'no tools on /privacy (client navigation)', String(await toolCount(page)));
  await page.goBack();
  const back = await waitTools(page, 12).then(() => true, () => false);
  t.check(back, 'tools back on /', String(await toolCount(page)));

  await t.open('/tools/json-to-typescript');
  await waitTools(page);
  const r = await exec(page, 'convert_json', { to: 'zod' });
  t.check(/z\.object/.test(r), 'tools work on a landing page', r.slice(0, 200));
});

test('download_file: the document, formatted, converted, Excel and graph images', async (t) => {
  const page = t.page;
  /** The file an action downloads: { name, path }, or null when none comes. */
  const download = async (action) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }).catch(() => null), action()]);
    return d && { name: d.suggestedFilename(), path: await d.path() };
  };
  await t.open('/');
  await waitTools(page);
  const doc = '[{"id":1,"name":"Ada","role":"admin"},{"id":2,"name":"Lin","role":"editor"}]';
  await exec(page, 'open_json', { text: doc, name: 'team.json', view: 'tree' });

  let r;
  let d = await download(async () => (r = await exec(page, 'download_file', { what: 'document' })));
  t.check(d?.name === 'team.json' && readFileSync(d.path, 'utf8') === doc, 'document download: team.json with the text', `${JSON.stringify(d)} ${r}`);

  await exec(page, 'format_json', { style: 'minified' });
  d = await download(() => exec(page, 'download_file', { what: 'formatted' }));
  t.check(d?.name === 'team.min.json' && readFileSync(d.path, 'utf8') === doc, 'formatted download follows the Format view: team.min.json', JSON.stringify(d));
  await exec(page, 'format_json', { style: 'pretty' });

  d = await download(() => exec(page, 'download_file', { what: 'converted', to: 'go' }));
  const convert = await waitView(page, /convert/i);
  t.check(d?.name === 'team.go' && /type .* struct/.test(readFileSync(d.path, 'utf8')) && convert, 'converted download: team.go, and Convert shows Go', `${JSON.stringify(d)} ${await selectedView(page)}`);

  d = await download(async () => (r = await exec(page, 'download_file', { what: 'excel', name: 'Team sheet' })));
  t.check(d?.name === 'Team sheet.xlsx' && readFileSync(d.path).subarray(0, 2).toString() === 'PK', 'excel download: Team sheet.xlsx, a zip', `${JSON.stringify(d)} ${r}`);

  d = await download(async () => (r = await exec(page, 'download_file', { what: 'graph', image_format: 'svg' })));
  t.check(d?.name === 'team.svg' && readFileSync(d.path, 'utf8').includes('<svg'), 'graph download: team.svg, an SVG', `${JSON.stringify(d)} ${r}`);
  d = await download(async () => (r = await exec(page, 'download_file', { what: 'graph' })));
  t.check(d?.name === 'team.png' && readFileSync(d.path).subarray(1, 4).toString() === 'PNG', 'graph download: team.png, a PNG', `${JSON.stringify(d)} ${r}`);
});

test("share_link: the page's own link, a Markdown button, and the link opens the document", async (t) => {
  const page = t.page;
  await t.open('/');
  await waitTools(page);
  const doc = '[{"id":1,"name":"Ada","role":"admin"},{"id":2,"name":"Lin","role":"editor"}]';
  await exec(page, 'open_json', { text: doc, name: 'team.json', view: 'tree' });
  await exec(page, 'show_view', { view: 'table' });
  let r = await exec(page, 'share_link');
  const toolUrl = r.split('\n')[1];
  t.check(toolUrl?.startsWith(`${t.base}/#`), 'share_link returns a link', r);

  await page.evaluate(() => (window.__clip = null));
  await t.app.command(page, 'Copy share link');
  const copied = await (await page.waitForFunction(() => window.__clip, null, { ...POLL, timeout: 10_000 })).jsonValue();
  t.check(copied === toolUrl, "the page's own Share still works and makes the same link", `${copied?.slice(0, 80)} vs ${toolUrl?.slice(0, 80)}`);
  t.check(await waitToast(page, /Share link copied\. The data lives in the link, not on a server\./), 'its toast is unchanged', await page.evaluate(() => window.__vis('.toast')?.textContent));
  r = await exec(page, 'share_link', { as: 'markdown' });
  t.check(new RegExp(`^\\[!\\[View in Tool Kumar\\]\\(${t.base.replace(/[.]/g, '\\.')}/badges/`, 'm').test(r), 'markdown button', r);

  const p2 = await t.context.newPage();
  await p2.goto(toolUrl, { waitUntil: 'commit' });
  await waitTools(p2);
  const back = await exec(p2, 'format_json', { style: 'minified' });
  t.check(back === doc, 'the link opens the same document in a new tab', back);
});
