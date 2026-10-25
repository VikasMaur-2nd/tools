// Privacy canary: marker strings go everywhere a visitor can put data (the editors, file names, Find,
// Convert's root name, Compare, share links, URLs, /integrate's builder), and no marker may reach PostHog
// (a mock that turns every risky remote setting on) in any request: events, recordings or URLs.
// Ported from ~/.cache/rv/c/canary.mjs (one 23-step script) as parallel tests. Each test ends its page
// visits with the recording delivered up to the last step (leavePage), so a clean verdict is never just a
// recording that didn't arrive; positive checks (site text and events do arrive) guard the same way.
import { defaults, test } from '../../lib/api.mjs';
import {
  ANALYTICS, MOD, POLL, REMOTE, analytics, checkNoLeaks, checkPrivateBoxes, checkTooltipFacts, eventsIn, leavePage, markers, recordingText,
  remoteJson, snapshotsIn, waitPostHog, waitTip, waitVisible, watchRelay,
} from './_helpers.mjs';

defaults({ ...ANALYTICS, tags: ['privacy'], timeout: 120_000 });

const TIP_FACTS = 'PR #26: the shared tooltip shows document facts to session replay (it gets PRIVATE there)';

/** Replaces the input editor's document the way Ctrl+A, Ctrl+V does. */
async function pasteDoc(t, text, which = 'input') {
  await t.page.focus(`#${which}`);
  await t.page.keyboard.press(`${MOD}+a`);
  await t.app.paste(t.page, text, which);
}

/** Every event queued so far has reached the mock: a last action whose event can only come after them. */
async function eventsSent(t, a) {
  const since = await a.mock.mark();
  await t.app.command(t.page, 'Keyboard shortcuts');
  await a.waitEvent((e) => e.event === 'feature_used' && e.properties?.feature === 'shortcuts', { since });
  await t.page.keyboard.press('Escape');
}

const hasEvent = (events, name, props = {}) => events.some((e) => e.event === name && Object.entries(props).every(([k, v]) => e.properties?.[k] === v));

test('canary: editor, file, tree, table, Find, Convert, copy and Compare', async (t) => {
  const K = markers(['key', 'value', 'typed', 'file', 'fileBody', 'find', 'query', 'root', 'cmp', 'err', 'dup']);
  const a = await analytics(t);
  const page = t.page;
  await t.open(`/?utm_source=canarytest&ref=${K.query}`);
  await waitPostHog(page);
  // A console line with a marker: the recorder must not pick it up.
  await page.evaluate((k) => console.log('console canary ' + k), K.value);

  await pasteDoc(t, JSON.stringify({ [K.key]: K.value, list: [1, 2, { nested: K.value }], email: 'nobody@example.invalid' }, null, 2));
  await t.app.waitValid(page);

  // Typing (then undo).
  await page.focus('#input');
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(` ${K.typed}`);
  await t.app.waitStatus(page, /Ln \d+, Col \d+/);
  await page.keyboard.press(`${MOD}+z`);
  await t.app.waitParsed(page);

  // Invalid JSON: a duplicate key, and a marker in the parser's message; its status-bar entry hovered.
  await pasteDoc(t, `{"${K.dup}": 1, "${K.dup}": 2, "x": ${K.err}}`);
  await t.app.waitStatus(page, /Ln \d+, Col \d+/);
  await page.hover('.statusbar .st');

  // A file with a marker in its name and its body.
  await page.setInputFiles('.app:visible input[type=file]', {
    name: `${K.file}-customers.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ [K.fileBody]: K.fileBody, rows: Array.from({ length: 50 }, (_, i) => ({ i, v: K.fileBody })) })),
  });
  await t.app.waitValid(page);

  // Tree: select a node, hover another. Table.
  await t.app.view(page, 'tree');
  await page.locator('.app:visible .tv-rows > :nth-child(2)').click();
  await page.locator('.app:visible .tv-rows > :nth-child(3)').hover();
  await t.app.view(page, 'table');

  // Find, in the tree.
  await t.app.view(page, 'tree');
  await page.keyboard.press(`${MOD}+f`);
  await waitVisible(page, '.findbar input');
  await page.keyboard.type(K.find);
  await waitVisible(page, '.findbar .count', { text: /\S/ });
  await page.keyboard.press('Escape');

  // Convert to Go with a marker as the root type's name.
  await t.app.view(page, 'convert');
  await page.selectOption('.app:visible .vmain select', 'go');
  await waitVisible(page, '#view-convert', { text: /struct/ });
  await page.click('.app:visible .vicons .menu-wrap > button');
  await page.fill('.mi-input', K.root);
  await waitVisible(page, '#view-convert', { text: new RegExp(K.root, 'i') });
  await page.keyboard.press('Escape');

  // Copy the output.
  await page.evaluate(() => (window.__clip = null));
  await page.click('.app:visible .vicons button[aria-label^="Copy"]');
  await page.waitForFunction(() => window.__clip != null, null, POLL);

  // Compare with a marker document.
  await t.app.view(page, 'compare');
  await t.app.paste(page, JSON.stringify({ [K.cmp]: K.cmp }), 'input2');
  await waitVisible(page, '.cmp-row');

  await eventsSent(t, a);
  const cookies = await t.context.cookies();
  const storage = await page.evaluate(() => Object.keys(localStorage));
  await leavePage(page, a);

  const reqs = await a.requests();
  const events = eventsIn(reqs);
  const snap = await recordingText(a);
  t.log('events', JSON.stringify(events.reduce((m, e) => ((m[e.event] = (m[e.event] || 0) + 1), m), {})), 'localStorage', storage.join(' '));
  t.check(hasEvent(events, '$pageview'), 'PostHog gets the page view');
  t.check(hasEvent(events, 'json_loaded', { source: 'paste' }) && hasEvent(events, 'json_loaded', { source: 'file' }), 'PostHog gets json_loaded for the paste and the file');
  t.check(hasEvent(events, 'convert_target_selected', { target: 'go' }), 'PostHog gets the Convert target');
  t.check(snapshotsIn(reqs).length > 0, 'PostHog gets the recording');
  for (const label of ['Input options', 'Pretty', 'Minify', 'Blog', 'Privacy', 'Integrate']) t.check(snap.includes(label), `site text "${label}" shows in the recording`);
  t.check(!cookies.length, 'no cookies (PostHog keeps its anonymous ID in localStorage)', cookies.map((c) => c.name));
  checkPrivateBoxes(t, snap);
  await checkNoLeaks(t, a, K);
});

test('canary: status-bar warning, JWT, context menu, graph export dialog and Minify', async (t) => {
  const K = markers(['dupWarn', 'alg', 'jwt', 'key', 'value']);
  const a = await analytics(t);
  const page = t.page;
  await t.open('/');
  await waitPostHog(page);

  // Valid JSON with a duplicate key: the status-bar warning and its tooltip.
  await pasteDoc(t, `{"${K.dupWarn}": 1, "${K.dupWarn}": 2, "ok": true}`);
  await t.app.waitValid(page);
  await page.hover('.statusbar .st-link');

  // A JWT with markers in its header and payload.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: K.alg, typ: 'JWT' });
  const payload = b64({ sub: K.jwt, exp: Math.floor(Date.now() / 1000) + 3600 });
  await pasteDoc(t, `${header}.${payload}.c2ln`);
  await t.app.waitParsed(page);

  // Right-click a tree node (the context menu).
  await pasteDoc(t, JSON.stringify({ [K.key]: { [K.value]: [1, 2, 3] } }, null, 2));
  await t.app.waitValid(page);
  await t.app.view(page, 'tree');
  await page.locator('.app:visible .tv-rows > :nth-child(2)').click({ button: 'right' });
  await waitVisible(page, '.menu.ctx');
  await page.keyboard.press('Escape');

  // The graph and its Export image dialog.
  await t.app.view(page, 'graph');
  await waitVisible(page, '#view-graph .gv-ctl');
  await t.app.command(page, 'Export image');
  await waitVisible(page, '.gx');
  await page.keyboard.press('Escape');
  await t.app.view(page, 'format');

  // Minify: sizes and the "smaller" tooltip.
  await page.getByRole('radio', { name: /Minify/ }).hover();
  await waitTip(page, /smaller/);

  await eventsSent(t, a);
  await leavePage(page, a);
  const snap = await recordingText(a);
  t.check(snap.length > 0, 'PostHog gets the recording');
  checkPrivateBoxes(t, snap);
  checkTooltipFacts(t, snap, TIP_FACTS);
  // The JWT's own text (its segments are base64, so a marker inside wouldn't show as is).
  await checkNoLeaks(t, a, K, { 'the JWT header': header, 'the JWT payload': payload });
});

test('canary: tooltips with document facts stay out of recordings, site tooltips show', async (t) => {
  const a = await analytics(t);
  const page = t.page;
  await t.open('/');
  await waitPostHog(page);
  await pasteDoc(t, JSON.stringify({ a: 1, b: 'x', list: Array.from({ length: 40 }, (_, i) => ({ i, v: 'some value ' + i })) }, null, 2));
  await t.app.waitValid(page);
  await t.app.view(page, 'format');

  const tips = {};
  await page.getByRole('radio', { name: /Minify/ }).hover();
  tips.minify = await waitTip(page, /% smaller/);
  await page.hover('.statusbar .sz-min');
  tips.size = await waitTip(page, /Minified/);
  // A site tooltip straight after: shown in recordings again.
  await page.getByRole('radio', { name: /Pretty/ }).hover();
  tips.site = await waitTip(page, /Indented and readable/);
  await t.app.view(page, 'compare');
  await t.app.paste(page, JSON.stringify({ a: '1', b: 'x', c: 2, list: [] }), 'input2');
  await waitVisible(page, '.cmp-chip.cmp-k-changed');
  await page.hover('.cmp-chip.cmp-k-changed');
  tips.compare = await waitTip(page, /type change/);
  await page.hover('.cmp-chip.cmp-k-added');
  await page.mouse.move(5, 400);
  await page.hover('button[aria-label="All commands"]');
  tips.site2 = await waitTip(page, /All commands/);
  t.log('tips', JSON.stringify(tips));
  await page.click('.pane-cmp .toolbar button[aria-label="Close compare"]');

  await eventsSent(t, a);
  await leavePage(page, a);
  const snap = await recordingText(a);
  t.check(snap.includes('Indented and readable'), 'a site tooltip ("Indented and readable") shows in the recording');
  t.check(snap.includes('All commands'), 'a site tooltip ("All commands") shows in the recording after a private one');
  checkTooltipFacts(t, snap, TIP_FACTS);
  checkPrivateBoxes(t, snap);
});

/** Pastes into the builder's nth editor once its editor has taken over the box (it loads on first sight). */
async function builderPaste(page, i, text) {
  const ta = page.locator('.link-builder .ed').nth(i).locator('textarea');
  await ta.focus();
  await page.waitForFunction((i) => document.querySelectorAll('.link-builder .ed')[i]?.classList.contains('hl-on'), i, POLL);
  await ta.focus();
  await page.keyboard.press(`${MOD}+a`);
  await ta.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

const builderOutput = (page) => page.evaluate(() => document.querySelector('.link-builder .lb-ed-out textarea')?.value ?? '');

test('canary: /integrate builder (invalid and valid JSON, file, Compare two, URLs, every format)', async (t) => {
  const K = markers(['lbErr', 'lbJson', 'lbFile', 'lbCmp', 'lbUrl', 'lbUrlB']);
  const a = await analytics(t);
  const page = t.page;
  await t.open('/integrate', { tool: false });
  await waitPostHog(page);

  await builderPaste(page, 0, `[1, 2]]${K.lbErr}`);
  await waitVisible(page, '.link-builder .lb-check-err');
  await page.locator('.lb-check').first().hover();
  await builderPaste(page, 0, JSON.stringify({ [K.lbJson]: K.lbJson }));
  await waitVisible(page, '.link-builder .lb-check-ok');
  const before = await builderOutput(page);
  await page.locator('.link-builder input[type=file]').first().setInputFiles({ name: `${K.lbFile}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ [K.lbFile]: 1 })) });
  await page.waitForFunction((b) => (document.querySelector('.link-builder .lb-ed-out textarea')?.value ?? '') !== b, before, POLL);
  for (const f of ['HTML', 'Link', 'Markdown']) {
    const r = page.getByRole('radio', { name: f, exact: true });
    await r.click();
    await page.waitForFunction((el) => el.getAttribute('aria-checked') === 'true', await r.elementHandle(), POLL);
  }
  await page.getByRole('radio', { name: 'Compare two' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.link-builder .lb-ed:not(.lb-ed-out)').length >= 2, null, POLL);
  await builderPaste(page, 1, JSON.stringify({ [K.lbCmp]: K.lbCmp }));
  await page.waitForFunction(() => document.querySelectorAll('.link-builder .lb-check-ok').length >= 2, null, POLL);
  const urls = page.getByRole('radio', { name: 'URL', exact: true });
  await urls.nth(0).click();
  await page.locator('.link-builder input[type=url]').first().fill(`https://example.com/${K.lbUrl}.json`);
  await urls.nth(1).click();
  await page.locator('.link-builder input[type=url]').nth(1).fill(`https://example.com/${K.lbUrlB}.json`);
  await waitVisible(page, 'a.lb-open');
  await page.mouse.move(400, 300, { steps: 5 });
  await page.locator('a.lb-open').hover();

  await leavePage(page, a);
  const snap = await recordingText(a);
  t.check(snap.includes('Make your button'), 'site text "Make your button" shows in the recording');
  checkPrivateBoxes(t, snap);
  await checkNoLeaks(t, a, K);
});

test('canary: share link, Load from URL, and opening the share link', async (t) => {
  const K = markers(['share', 'url']);
  const a = await analytics(t);
  const page = t.page;
  await remoteJson(t.context, { [`${K.url}.json`]: JSON.stringify({ [K.url]: K.url }) });
  await t.open('/');
  await waitPostHog(page);

  await pasteDoc(t, JSON.stringify({ [K.share]: K.share }));
  await t.app.waitValid(page);
  await page.evaluate(() => (window.__clip = null));
  await page.click('.app:visible .pane-ed .toolbar button[aria-label="Share"]');
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  const link = await (await page.waitForFunction(() => window.__clip, null, POLL)).jsonValue();
  t.assert(/#[aj]=/.test(link), 'Share makes a link with the document in its fragment', link.slice(0, 80));

  // Load JSON from URL (the dialog), a URL with a marker.
  const since = await a.mock.mark();
  await t.app.command(page, 'Load JSON from URL');
  await page.locator('.palette input[type=url]').fill(`${REMOTE}/${K.url}.json`);
  await page.keyboard.press('Enter');
  await a.waitEvent((e) => e.event === 'json_loaded' && e.properties?.source === 'url', { since });
  await leavePage(page, a);

  // The share link, opened (the document is in the URL fragment).
  await page.goto(link, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  await waitPostHog(page);
  await t.app.waitValid(page);
  await a.waitEvent((e) => e.event === 'json_loaded' && e.properties?.source === 'link');
  await leavePage(page, a);

  await checkNoLeaks(t, a, K, { "the share link's fragment": link.split('#')[1].slice(0, 80) });
});

test('canary: a ?url= link naming a URL with a marker', async (t) => {
  const K = markers(['urlParam']);
  const a = await analytics(t);
  const page = t.page;
  await remoteJson(t.context, { [`${K.urlParam}.json`]: JSON.stringify({ [K.urlParam]: [1, 2, 3] }) });
  await t.open(`/?url=${encodeURIComponent(`${REMOTE}/${K.urlParam}.json`)}`);
  await waitPostHog(page);
  await t.app.waitValid(page);
  await a.waitEvent((e) => e.event === 'json_loaded' && e.properties?.source === 'link_url');
  await leavePage(page, a);
  await checkNoLeaks(t, a, K);
});

test('the privacy switch turns analytics off, and nothing is sent while off', async (t) => {
  const a = await analytics(t);
  const page = t.page;
  const relay = watchRelay(t.context);
  await t.open('/privacy', { tool: false });
  await waitPostHog(page, { recording: false });
  await a.waitEvent('$pageview');
  const sw = page.locator('.switch');
  await page.waitForFunction(() => document.querySelector('.switch')?.getAttribute('aria-checked') === 'true', null, POLL);
  await sw.click();
  await page.waitForFunction(() => document.querySelector('.switch').getAttribute('aria-checked') === 'false', null, { ...POLL, timeout: 5000 }).catch(() => {});
  const after = await sw.getAttribute('aria-checked');
  const pref = await page.evaluate(() => localStorage.getItem('jf:analytics'));
  t.check(after === 'false', 'the switch turns off', after);
  t.check(pref === 'off', 'the choice is kept in this browser', pref);
  await page.evaluate(() => sessionStorage.setItem('harness-optout', '1'));
  // From here on nothing may leave: wait for what was already on its way, then mark.
  await relay.idle();
  const sentBefore = relay.started.length;
  const mark = await a.mock.mark();

  // The tool page while off, next to a page with analytics on that does the same: once that one has sent its
  // page view (PostHog loads a while after the page, once the visitor pauses), this one would have too.
  const ctl = await t.newPage();
  const c = await analytics(t, { context: ctl.context, name: 'control' });
  await Promise.all([t.open('/'), t.app.open(ctl.page, t.base, '/')]);
  await Promise.all(
    [page, ctl.page].map(async (p) => {
      await p.focus('#input');
      await p.keyboard.type('{"off": true}');
    }),
  );
  await c.waitEvent('$pageview', { timeout: 60_000 });
  const late = relay.started.slice(sentBefore);
  t.check(!late.length, 'the browser sends nothing to the relay once analytics is off', late);
  const got = await a.requests(mark);
  t.check(!got.length, 'nothing reaches PostHog while off', got.map((r) => `${r.method} ${r.path}`).slice(0, 5));
  t.check(await page.evaluate(() => !window.posthog), 'PostHog does not load while off');
});
