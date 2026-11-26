// The service worker (public/sw.js) against real production builds: offline after a first visit, a deploy
// while a tab is open, and a deploy with a file missing. A proxy is the site the browser sees: it forwards
// to one build at a time (a deploy switches it), can 404 single files, and goes offline by cutting every
// connection. Build A is `default`, A′ is `redeploy` (the same code, a few chunks with new hashes).
// Ported from ~/.cache/rv/c/sw-offline.mjs: 40 default checks plus 3 swupdate and 8 upgrade checks.
// Four added preflight assertions bring those to 55 checks per engine; the deploy clean-up scenarios
// (toolpage: a deploy seen only on a tool page; rollback: A, A′, then A again; homeretry: a shell that
// failed to follow a tool page, tried again) add 33: 88.
// Every wait is on the worker (a probe the proxy adds to /sw.js reports its unfinished waitUntil work) or
// on the cache, never on time.
import { defaults } from '../../lib/api.mjs';
import { readFileSync } from 'node:fs';
import {
  CACHE_NAME, POLL, WATCH_POSTS, cacheKeys, cachedText, closure, missingFromCache, opened, serveVariant, startProxy, swIdle, swVersion, test, unreachable, until, waitInCache,
} from './_helpers.mjs';

// HARNESS_OFFLINE_IMMUTABLE=1: the same checks against production's file layout, /_next/static/immutable/
// (the `immutable` and `immutable-redeploy` builds: see VARIANTS in harness/lib/build.mjs).
const IMMUTABLE = !!process.env.HARNESS_OFFLINE_IMMUTABLE;
const BUILD = IMMUTABLE ? 'immutable' : 'default';
const REDEPLOY = IMMUTABLE ? 'immutable-redeploy' : 'redeploy';

defaults({ engines: 'all', serviceWorkers: 'allow', allowErrors: true, tags: ['offline'], timeout: 300_000, variant: BUILD });

const DOC = JSON.stringify({ users: [{ id: 1, name: 'Ada', tags: ['a', 'b'] }, { id: 2, name: 'Grace', tags: [] }], total: 2 }, null, 2);
/**
 * A big broken file (~2.8 MB: the analysis worker takes it). The worker parses it with its JavaScript tape
 * parser, a chunk of its own loaded the first time a document isn't strict JSON: here offline, from the cache.
 */
const BROKEN = '// export\n[' + Array.from({ length: 52_000 }, (_, i) => `{"id":${i},"name":"item ${i}","tags":["a","b"],"ok":true}`).join(',\n') + ',]';
/** Errors of an offline page that are just the network being gone. */
const NETWORK = /_vercel\/insights|ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|ERR_CONNECTION|Failed to load resource|NetworkError|net::|fetch|Load failed|Cannot load https?:|The network connection was lost|Could not connect/i;

/**
 * Firefox's report of a load a service worker answered but the page had cancelled (it navigated away while the
 * body streamed in): Gecko logs this when copying the worker's response into the cancelled request fails. A
 * rejected respondWith() reads differently ("passed a promise to FetchEvent.respondWith() that rejected").
 */
const CANCELLED = /Failed to load ‘([^’]+)’\. A ServiceWorker intercepted the request and encountered an unexpected error/;

async function checkErrors(t, scenario) {
  const details = await Promise.all(t.platformConsoleErrors);
  let at = 0;
  const errors = t.errors.map((e) => e === 'console: Error' ? `console: ${details[at++] || 'Error'}` : e);
  // (Only for a request the page itself cancelled: any other load that fails this way still counts.)
  const cancelled = (e) => { const m = CANCELLED.exec(e); return !!m && t.platformAborted.has(m[1]); };
  const relevant = errors.filter((e) => !NETWORK.test(e) && !cancelled(e));
  t.check(!relevant.length, `${scenario}: no page errors`, relevant.slice(0, 3));
}

/**
 * The lazily loaded features in a page that has just opened (before its warm-up loads them): the graph,
 * Convert to every format, the Excel writer and the YAML reader are each their own chunk.
 */
async function features(t, page, label, { broken = false } = {}) {
  const unavailable = (detail) => {
    for (const feature of ['graph view', 'Convert to every format', 'Excel download', 'YAML import']) {
      t.check(false, `${label}: ${feature}`, detail);
    }
  };
  // The tool must have started before a document is typed: the editor is in the server's HTML, so it shows
  // before hydration, and text typed then is lost. A landing page also loads its own sample one task after
  // the tool starts (the JSON validator's is invalid), which would replace text typed in between: hence the
  // engine's mark (or, on builds before it, waitEngine's own rule), then one more task.
  const started = await t.app.waitEngine(page, { timeout: t.budget(15_000) }).then(() => page.evaluate(() => new Promise((r) => setTimeout(r, 0))).then(() => true), () => false);
  const input = started && await page.locator('.app:visible #input').waitFor({ timeout: t.budget(5000) }).then(() => true, () => false);
  if (input) await t.app.setText(page, DOC);
  const ready = input && await t.app.waitValid(page, { timeout: t.budget(5000) }).then(() => true, () => false);
  if (!ready) {
    return unavailable('The cached shell could not start its engine');
  }
  // (The view is remembered: a tab that opened Compare leaves the next one in it.)
  const close = page.locator('.pane-cmp .toolbar button[aria-label="Close compare"]');
  if (await close.isVisible().catch(() => false)) {
    const closed = await close.click({ timeout: t.budget(1000) }).then(() => true, (e) => { t.log(String(e)); return false; });
    if (!closed) return unavailable('The saved Compare view could not hydrate or close with the cached chunks');
  }
  const errToast = () => page.locator('.toast.err').count();

  await t.app.view(page, 'graph');
  const graph = await page.waitForFunction(() => window.__vis('#view-graph .gv-ctl') ? 'ready' : window.__vis('.toast.err') ? 'error' : false, null, { ...POLL, timeout: t.budget(15_000) }).then(async (h) => (await h.jsonValue()) === 'ready', () => false);
  t.check(graph && !(await errToast()), `${label}: graph view`);

  await t.app.view(page, 'convert');
  const select = page.locator('.app:visible .vmain select');
  const targets = await select.locator('option').evaluateAll((os) => os.map((o) => o.value)).catch(() => []);
  // CSV and Excel intentionally show identical previews. Separate them so a changed
  // output proves each selection finished instead of accepting the previous target.
  targets.sort((a, b) => Number(a === 'xlsx') - Number(b === 'xlsx'));
  const bad = [];
  let shown = await select.inputValue().catch(() => null);
  let prev = null;
  for (const target of targets) {
    if (target !== shown) await select.selectOption(target);
    // The output for this target: text that differs from the last one, no spinner.
    const text = await page
      .waitForFunction(
        (prev) => {
          const v = document.getElementById('view-convert');
          const txt = v && !v.hidden ? v.innerText.trim() : '';
          const error = v?.querySelector('.cv-note');
          return (error?.textContent || (txt.length > 10 && txt !== prev && !document.querySelector('.vmain .spin') && txt));
        },
        prev,
        { ...POLL, timeout: t.budget(15_000) },
      )
      .then((h) => h.jsonValue(), () => null);
    if (!text || /couldn.t|failed|error|cannot load|unable to load|importing a module script/i.test(text.slice(0, 200))) bad.push(target);
    prev = text ?? prev;
    shown = target;
  }
  if (bad.length) t.log(label, 'failed Convert targets', bad);
  t.check(targets.length >= 15 && !bad.length && !(await errToast()), `${label}: Convert to every format (${targets.length})`, bad.join(' '));

  const dl = page.waitForEvent('download', { timeout: t.budget(15_000) }).then((d) => d.suggestedFilename(), () => null);
  await t.app.command(page, 'Export to Excel');
  const name = await dl;
  t.check(!!name && name.endsWith('.xlsx') && !(await errToast()), `${label}: Excel download`, String(name));

  // A YAML file opens as itself, read as YAML: the Format view shows its JSON.
  await t.app.view(page, 'format');
  await page.setInputFiles('.app:visible input[type=file]', { name: 'people.yaml', mimeType: 'text/yaml', buffer: Buffer.from('people:\n  - name: Ada\n    born: 1815\n  - name: Grace\n') });
  const yaml = await page.waitForFunction(() => /^Valid YAML/.test(window.__vis('.sb-l')?.textContent ?? '') && /"born": 1815/.test(document.getElementById('view-format')?.textContent || ''), null, { ...POLL, timeout: t.budget(15_000) }).then(() => true, () => false);
  t.check(yaml && !(await errToast()), `${label}: YAML import`);
  // Undone, the JSON document is back, read as JSON (so the next tab, which opens the saved one, gets JSON too).
  await t.app.command(page, 'Undo');
  const undone = await t.app.waitValid(page, { timeout: t.budget(5000) }).then(() => true, () => false);
  t.check(undone, `${label}: Undo brings the JSON document back`);

  if (!broken) return;
  await t.app.view(page, 'format');
  await page.setInputFiles('.app:visible input[type=file]', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(BROKEN) });
  const st = await t.app.waitStatus(page, /^(?!Parsing)(?!Ready)(?!.*…)./, { timeout: t.budget(60_000) }).catch(() => t.app.status(page));
  const repaired = await page.waitForFunction(() => /"name": "item 0"/.test(document.getElementById('view-format')?.textContent || ''), null, { ...POLL, timeout: t.budget(30_000) }).then(() => true, () => false);
  t.check(!/^Valid JSON/.test(st) && /issue|comment|comma|fixed/i.test(st) && repaired && !(await errToast()), `${label}: a big broken file is repaired and shown`, `${st.slice(0, 100)} | shown ${repaired}`);
  // (A big document makes the page load more of its code when idle: let that finish before the page moves on,
  // or Firefox reports the cancelled loads as errors from the service worker's fetch.)
  await quiet(page);
}

/** Waits until the page has loaded nothing for half a second (at most 15 s). */
const quiet = (page) => page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

/** Opens '/' through the proxy and waits until the worker has cached what this first visit gives it. */
async function firstVisit(t, proxy) {
  await t.context.addInitScript(WATCH_POSTS);
  await t.page.goto(proxy.origin + '/', { waitUntil: 'load' });
  // Installed, the page has posted what it loaded (after its warm-up), and the worker is done with it all.
  await swIdle(t.page, { posted: true, timeout: 90_000 });
}

test('fresh: after one visit, the shell, visited pages and lazy features work offline', async (t) => {
  const proxy = await startProxy({ A: t.base });
  try {
    const home = await closure(t.base);
    await firstVisit(t, proxy);
    const page = t.page;
    const missing = await missingFromCache(page, ['/', ...home.all]);
    t.check(!missing.length, 'fresh: the shell and every chunk it can load are cached', `${missing.length} of ${home.all.length + 1} missing: ${missing.slice(0, 4).join(' ')}`);
    for (const path of ['/tools/json-validator', '/es']) {
      // (What the page loads when idle (tooltips, the sample) is let finish: leaving cancels it, which Firefox
      // reports as an error from the worker's fetch.)
      await quiet(page);
      await page.goto(proxy.origin + path, { waitUntil: 'load' });
      t.assert(await waitInCache(page, [path]), `fresh: the visited ${path} page is cached`);
      await swIdle(page);
    }
    const keys = await cacheKeys(page);
    t.log(`cached: ${keys.length} entries; visited pages ${['/tools/json-validator', '/es'].filter((p) => keys.includes(p)).join(' ')}`);

    proxy.offline();
    const p2 = await t.context.newPage();
    const home2 = await opened(p2, proxy.origin, '/');
    t.check(home2.ok && home2.tool === 1, 'fresh offline: / opens', home2);
    await features(t, p2, 'fresh offline /', { broken: true });
    const tool = await opened(p2, proxy.origin, '/tools/json-validator');
    t.check(tool.ok && tool.tool === 1, 'fresh offline: a visited tool page opens', tool);
    const es = await opened(p2, proxy.origin, '/es');
    t.check(es.ok && es.lang === 'es' && es.tool === 1, 'fresh offline: a localized page opens', es);
    const p3 = await t.context.newPage();
    const es2 = await opened(p3, proxy.origin, '/es/tools/json-validator');
    t.check(es2.ok && es2.lang === 'es', 'fresh offline: an unvisited localized tool page falls back to its home', es2);
    const other = await opened(p3, proxy.origin, '/tools/json-diff');
    t.check(other.ok && other.tool === 1, 'fresh offline: an unvisited page falls back to the shell', other);
    await features(t, p3, 'fresh offline (fallback page)', { broken: true });
    await checkErrors(t, 'fresh');
  } finally {
    proxy.close();
  }
});

/**
 * Lets the page's first 'cache' post through (links' code, posted as soon as the worker is ready) and drops the
 * warm-up's (the one naming the page itself, after every feature has loaded): a visit that went offline before it.
 */
const EARLY_POSTS_ONLY = () => {
  if (typeof ServiceWorker === 'undefined') return;
  const post = ServiceWorker.prototype.postMessage;
  ServiceWorker.prototype.postMessage = function (msg, ...rest) {
    if (msg && msg.type === 'cache') {
      if (msg.urls.includes(location.origin + '/')) return (window.__swDropped = (window.__swDropped || 0) + 1);
      window.__swPosted = (window.__swPosted || 0) + 1;
    }
    return post.call(this, msg, ...rest);
  };
};

test('link: offline before the warm-up has cached the features, a share link still opens', async (t) => {
  // (lib/link.ts loads when a link is opened; it came with the warm-up's pass, so a cached shell offline before
  // that left the link in the address bar and the old document on screen, saying nothing.)
  const proxy = await startProxy({ A: t.base });
  try {
    await t.context.addInitScript(EARLY_POSTS_ONLY);
    await t.page.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(t.page, { posted: true, timeout: 90_000 });
    proxy.offline();
    const { deflateRawSync } = await import('node:zlib');
    const doc = '{"shared":"offline","n":9007199254740993}';
    const p2 = await t.context.newPage();
    const home = await opened(p2, proxy.origin, '/#a=' + deflateRawSync(doc).toString('base64url'));
    t.check(home.ok && home.tool === 1, 'link offline: the cached shell opens', home);
    const shown = await p2.waitForFunction(() => /"shared": "offline"/.test(document.getElementById('input')?.value ?? ''), null, { ...POLL, timeout: t.budget(15_000) }).then(() => true, () => false);
    const toast = await p2.evaluate(() => window.__vis('.toast')?.textContent ?? '');
    t.check(shown && !/Couldn.t open the link/.test(toast), 'link offline: the linked document opens', toast);
    t.check(await p2.evaluate(() => location.hash) === '', 'link offline: the link leaves the address bar');
    await checkErrors(t, 'link');
  } finally {
    proxy.close();
  }
});

test('localized: after one visit, the Schema view and Flatten show their own strings offline', async (t) => {
  const proxy = await startProxy({ A: t.base });
  try {
    await t.context.addInitScript(WATCH_POSTS);
    const page = t.page;
    // A first visit to a German tool page (its Schema view opens with the sample); Flatten is never opened.
    await page.goto(proxy.origin + '/de/tools/json-schema-validator', { waitUntil: 'load' });
    await swIdle(page, { posted: true, timeout: 90_000 });
    const dicts = (await cacheKeys(page)).filter((k) => k.startsWith('/i18n/'));
    t.check(dicts.length === 3 && dicts.every((k) => /^\/i18n\/(huge|schema|flatten)-strings\.de\.[0-9a-f]{12}\.json$/.test(k)), 'localized: the page\'s own three dictionaries are cached, no other language\'s', dicts);

    proxy.offline();
    const p2 = await t.context.newPage();
    const de = await opened(p2, proxy.origin, '/de/tools/json-schema-validator');
    t.check(de.ok && de.lang === 'de' && de.tool === 1, 'localized offline: the visited page opens', de);
    // (The result, not "Validierung" while it runs.)
    const head = await p2.waitForFunction(() => /Fehler/.test(window.__vis('#view-schema .sch-state')?.textContent ?? '') && window.__vis('#view-schema .sch-state').textContent, null, { ...POLL, timeout: t.budget(20_000) }).then((h) => h.jsonValue(), () => p2.evaluate(() => window.__vis('#view-schema .sch-state')?.textContent ?? ''));
    t.check(/^6 Fehler/.test(head), 'localized offline: the Schema view in German', head);
    await t.app.view(p2, 'convert');
    await p2.locator('.app:visible .vmain select').selectOption('unflatten');
    // (The note shows at once, in English until Flatten's strings are in: from the cache, here.)
    const note = await p2.waitForFunction(() => /Verschachteln$/.test(window.__vis('.view .banner .b-msg')?.textContent ?? '') && window.__vis('.view .banner .b-msg').textContent, null, { ...POLL, timeout: t.budget(15_000) }).then((h) => h.jsonValue(), () => p2.evaluate(() => window.__vis('.view .banner .b-msg')?.textContent ?? ''));
    t.check(note === 'Dieses JSON hat keine flachen Schlüssel zum Verschachteln', 'localized offline: Flatten in German, never opened online', note);
    await checkErrors(t, 'localized');
  } finally {
    proxy.close();
  }
});

test("deploy: a tab open during a deploy keeps its build offline; new tabs get the new one", { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  const proxy = await startProxy({ A, A2: t.base });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    const onlyA = a.all.filter((p) => !a2.all.includes(p));
    const onlyA2 = a2.all.filter((p) => !a.all.includes(p));
    t.log(`build A ${a.all.length} files, A' ${a2.all.length}, A-only ${onlyA.length}, A'-only ${onlyA2.length} (${onlyA2.filter((p) => !a2.named.includes(p)).length} of them lazy)`);
    t.assert(onlyA2.some((p) => a2.named.includes(p)), "the redeploy's HTML names files build A doesn't have", onlyA2);

    await firstVisit(t, proxy);
    const oldTab = t.page;
    const updateNotice = oldTab.locator('.toast', { hasText: 'A new version is ready' }).waitFor({ timeout: t.budget(60_000) }).then(() => true, () => false);

    proxy.deploy('A2');
    const visitor = await t.context.newPage();
    await visitor.goto(proxy.origin + '/', { waitUntil: 'load' });
    const swapped = await until(() => visitor.evaluate(
        async ([name, named]) => {
          const r = await (await caches.open(name)).match('/', { ignoreVary: true });
          const s = r ? await r.text() : '';
          return named.every((p) => s.includes(p));
        },
        [CACHE_NAME, a2.named],
      ), { timeout: t.budget(60_000), what: 'the new shell' })
      .then(() => true, () => false);
    t.check(swapped, 'deploy: the new shell replaces the old one once its files are cached');
    // This navigation may have received stale A while its refresh installed A'. Reload the
    // now-committed shell before waiting for that build's own warm-up/cache message. (Its idle loads are let
    // finish first: Firefox reports each one a reload cancels as an error from the worker's fetch.)
    await quiet(visitor);
    await visitor.reload({ waitUntil: 'load' });
    await swIdle(visitor, { posted: true, timeout: 90_000 });
    const missingA2 = await missingFromCache(visitor, a2.all);
    t.check(!missingA2.length, 'deploy: every file of the new build, lazy ones included, is cached', missingA2.slice(0, 3));
    const told = await updateNotice;
    t.check(told, 'deploy: the open tab is told a new version is ready');

    proxy.offline();
    const lost = await unreachable(oldTab, a.all);
    t.check(!lost.length, 'deploy offline: the old tab still gets every file of its build (lazy ones included)', `${lost.length} missing ${lost.slice(0, 3).join(' ')}`);
    // The old tab opens a feature it hadn't loaded yet.
    await oldTab.getByRole('tab', { name: 'Compare' }).click();
    const cmp = await oldTab.locator('#input2').first().waitFor({ timeout: t.budget(15_000) }).then(() => true, () => false);
    t.check(cmp, 'deploy offline: the old tab opens Compare');
    const fresh = await t.context.newPage();
    const o2 = await opened(fresh, proxy.origin, '/');
    t.check(o2.ok && o2.tool === 1, 'deploy offline: a new tab opens the new build', o2);
    await features(t, fresh, 'deploy offline, new build');

    // The old tabs close: the old build's files go (checked when a page posts what it loaded, or on a visit).
    // (Once their loads are done: see the reload above.)
    await Promise.all([quiet(oldTab), quiet(visitor)]);
    await oldTab.close();
    await visitor.close();
    proxy.offline(false);
    const later = await t.context.newPage();
    await later.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(later, { posted: true });
    const left = (await cacheKeys(later)).filter((p) => onlyA.includes(p));
    t.check(!left.length, "deploy: once the old tabs are closed, the old build's files are deleted", `${left.length} left of ${onlyA.length}`);
    t.check(!(await cacheKeys(later)).includes('/sw.js?retired'), 'deploy: the retired record is gone with them');
    proxy.offline();
    const last = await t.context.newPage();
    const o3 = await opened(last, proxy.origin, '/');
    t.check(o3.ok && o3.tool === 1, 'deploy offline after cleanup: the new build opens', o3);
    await features(t, last, 'deploy offline after cleanup');
    await checkErrors(t, 'deploy');
  } finally {
    proxy.close();
  }
});

test('fail404: a deploy with a file missing leaves the cached build whole offline', { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  const proxy = await startProxy({ A, A2: t.base });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    await firstVisit(t, proxy);
    // A deploy whose HTML names a file the server doesn't have (yet).
    const broken = a2.named.find((p) => p.endsWith('.js') && !a.all.includes(p));
    t.assert(broken, "the redeploy's HTML names a script build A doesn't have");
    proxy.deploy('A2');
    proxy.net.fail.add(broken);
    const v = await t.context.newPage();
    await v.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(v); // the shell refresh this visit started has finished (or given up)
    const shell = (await cachedText(v, '/')) || '';
    const kept = a.named.every((p) => shell.includes(p)) && !shell.includes(broken);
    t.check(kept, 'fail404: the old shell stays when a file of the new one 404s', broken);
    proxy.offline();
    const p3 = await t.context.newPage();
    const o = await opened(p3, proxy.origin, '/');
    t.check(o.ok && o.tool === 1, 'fail404 offline: / opens (old build)', o);
    await features(t, p3, 'fail404 offline');
    await checkErrors(t, 'fail404');
  } finally {
    proxy.close();
  }
});

async function updateWorker(page) {
  // A navigation through the old worker can still have a refresh/cache event in
  // flight when the page reaches `load`.  The browser keeps a replacement in
  // `waiting` until those old-worker events finish, even though the new script
  // called skipWaiting().  Drain that work before asking for the update so the
  // activation wait observes the lifecycle rather than an unrelated fetch race.
  await swIdle(page, { posted: true, timeout: 90_000 });
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error('The first visit did not register a worker');
    await reg.update();
  });
  // The update promise can resolve as soon as the replacement is installed;
  // the old worker may still be finishing a fetch event from the navigation.
  // Let that event drain before waiting for the replacement to activate.
  await swIdle(page);
  // Observe the replacement even if this engine reports it as waiting or
  // activating for a while; a navigation below makes the controller change
  // observable and the following check still requires A2 to control the page.
  await swVersion(page, 'A2', { active: true, candidate: true });
  // Adoption of a replacement and controllerchange can straddle navigation.
  // The old upgrade script also reloads until the new worker's shell is served.
  await page.reload({ waitUntil: 'load' });
  await swVersion(page, 'A2');
  await swIdle(page);
}

async function newShell(t, page, named) {
  return until(async () => {
    const html = await cachedText(page, '/');
    return html && named.every((p) => html.includes(p));
  }, { timeout: t.budget(30_000), what: 'the updated worker to cache the new shell' }).then(() => true, () => false);
}

test('swupdate: a worker update first seen on a tool page installs the new shell and preserves old tabs', { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  const proxy = await startProxy({ A, A2: t.base }, { workerVersions: true });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    await firstVisit(t, proxy);
    const oldTab = t.page;
    proxy.deploy('A2');
    const visitor = await t.context.newPage();
    // Commit is enough to begin the app warm-up.  Waiting for `load` here lets
    // the delayed service-worker registration activate during provisional
    // navigation in WebKit, which can cancel that navigation.
    await visitor.goto(proxy.origin + '/tools/json-validator', { waitUntil: 'commit' });
    await updateWorker(visitor);
    t.check(await newShell(t, visitor, a2.named), 'swupdate: the new worker brings in the new shell');
    proxy.offline();
    const lost = await unreachable(oldTab, a.all);
    t.check(!lost.length, 'swupdate offline: the old tab still gets every file of its build', lost);
    await checkErrors(t, 'swupdate');
  } finally {
    t.log('worker responses', proxy.net.workers);
    proxy.close();
  }
});

test('upgrade: the frozen production worker upgrades without breaking its cached tabs', { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  // Keep the old worker fixed as app code changes. Reuse build A for its HTML and
  // assets, so the migration needs only the same two builds as a normal deploy.
  const legacyWorker = readFileSync(new URL('./fixtures/legacy-sw.js', import.meta.url), 'utf8');
  const proxy = await startProxy({ BASE: A, A2: t.base }, { initial: 'BASE', workerVersions: true, legacyWorker });
  try {
    const a2 = await closure(t.base);
    await firstVisit(t, proxy);
    const oldTab = t.page;
    const oldFiles = (await cacheKeys(oldTab)).filter((p) => p.startsWith('/_next/static/'));
    proxy.deploy('A2');
    const visitor = await t.context.newPage();
    await visitor.goto(proxy.origin + '/', { waitUntil: 'commit' });
    await updateWorker(visitor);
    t.check(await newShell(t, visitor, a2.named), 'upgrade: the new worker brings in the new shell');
    await swIdle(visitor, { posted: true });
    const missing = await missingFromCache(visitor, a2.all);
    t.log(`new build files not cached yet: ${missing.length}`);
    proxy.offline();
    const lost = await unreachable(oldTab, oldFiles);
    t.check(!lost.length, 'upgrade offline: the old tab still gets every file it had cached', lost, t.engine === 'webkit' ? { known: "legacy: the pre-PR #26 worker deletes the old build's later-loaded chunks as soon as it sees a new shell; in WebKit it does so before the new worker takes over (fixed in today's worker, which retires them)" } : undefined);
    const fresh = await t.context.newPage();
    const o = await opened(fresh, proxy.origin, '/');
    t.check(o.ok && o.tool === 1, 'upgrade offline: a new tab opens the new build', o);
    await features(t, fresh, 'upgrade offline');
    await checkErrors(t, 'upgrade');
  } finally {
    t.log('worker responses', proxy.net.workers);
    proxy.close();
  }
});

test('toolpage: a deploy seen on a tool page brings the shell along, keeps the old tab whole, then cleans up', { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  const proxy = await startProxy({ A, A2: t.base });
  const TOOL = '/tools/json-validator';
  try {
    const [a, a2, aTool, a2Tool] = await Promise.all([closure(A), closure(t.base), closure(A, TOOL), closure(t.base, TOOL)]);
    const newFiles = new Set([...a2.all, ...a2Tool.all]);
    const onlyA = [...new Set([...a.all, ...aTool.all])].filter((p) => !newFiles.has(p));
    t.assert(onlyA.length, "build A has files the redeploy doesn't", onlyA);
    // The visitor only ever opens the tool page: '/' comes with the worker, at build A.
    await t.context.addInitScript(WATCH_POSTS);
    await t.page.goto(proxy.origin + TOOL, { waitUntil: 'load' });
    await swIdle(t.page, { posted: true, timeout: 90_000 });
    const oldTab = t.page;
    t.assert(await waitInCache(oldTab, ['/', TOOL]), 'toolpage: the tool page and the shell are cached');
    const oldFiles = (await cacheKeys(oldTab)).filter((p) => p.startsWith('/_next/static/'));

    proxy.deploy('A2');
    const visitor = await t.context.newPage();
    await visitor.goto(proxy.origin + TOOL, { waitUntil: 'load' });
    t.check(await newShell(t, visitor, a2.named), 'toolpage: the shell follows the tool page to the new build, never opened');
    await swIdle(visitor, { posted: true, timeout: 90_000 });
    proxy.offline();
    const lost = await unreachable(oldTab, oldFiles);
    t.check(!lost.length, 'toolpage offline: the old tab still gets every file of its build', `${lost.length} missing ${lost.slice(0, 3).join(' ')}`);

    // The tabs open at the deploy close (the visitor's too: it may reach a route sharing a chunk with build A):
    // build A's leftovers go at the next visit.
    await Promise.all([quiet(oldTab), quiet(visitor)]);
    await oldTab.close();
    await visitor.close();
    proxy.offline(false);
    const later = await t.context.newPage();
    await later.goto(proxy.origin + TOOL, { waitUntil: 'load' });
    await swIdle(later, { posted: true });
    const left = (await cacheKeys(later)).filter((p) => onlyA.includes(p));
    t.check(!left.length, "toolpage: once the tabs open at the deploy are closed, the old build's files are deleted", `${left.length} left of ${onlyA.length}: ${left.slice(0, 3).join(' ')}`);
    const missing = await missingFromCache(later, a2Tool.all);
    t.check(!missing.length, "toolpage: every file of the new build's tool page is cached", missing.slice(0, 3));
    proxy.offline();
    const off = await t.context.newPage();
    const o = await opened(off, proxy.origin, TOOL);
    t.check(o.ok && o.tool === 1, 'toolpage offline after cleanup: the tool page opens', o);
    await features(t, off, 'toolpage offline after cleanup');
    const home = await opened(off, proxy.origin, '/');
    t.check(home.ok && home.tool === 1, 'toolpage offline after cleanup: the shell opens', home);
    await checkErrors(t, 'toolpage');
  } finally {
    proxy.close();
  }
});

test("rollback: a deploy back to the previous build keeps both builds' tabs whole offline, then each build's leftovers go", { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  const proxy = await startProxy({ A, A2: t.base });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    const onlyA = a.all.filter((p) => !a2.all.includes(p));
    const onlyA2 = a2.all.filter((p) => !a.all.includes(p));
    await firstVisit(t, proxy);
    const tabA = t.page;
    // The redeploy: a visit to '/' brings it in (it gets build A's shell meanwhile); reloaded, that tab runs A2.
    proxy.deploy('A2');
    const tabA2 = await t.context.newPage();
    await tabA2.goto(proxy.origin + '/', { waitUntil: 'load' });
    t.assert(await newShell(t, tabA2, a2.named), 'rollback: the redeploy is cached');
    await quiet(tabA2);
    await tabA2.reload({ waitUntil: 'load' });
    await swIdle(tabA2, { posted: true, timeout: 90_000 });
    // Rolled back: build A again, seen on '/' by another tab. Build A's files, retired for build A's tab, are the shell's again.
    proxy.deploy('A');
    const back = await t.context.newPage();
    await back.goto(proxy.origin + '/', { waitUntil: 'load' });
    t.check(await newShell(t, back, a.named), 'rollback: the previous build is the cached shell again');
    await swIdle(back);
    proxy.offline();
    const lostA = await unreachable(tabA, a.all);
    t.check(!lostA.length, "rollback offline: build A's tab still gets every file of its build", lostA.slice(0, 3));
    const lostA2 = await unreachable(tabA2, a2.all);
    t.check(!lostA2.length, "rollback offline: the redeploy's tab still gets every file of its build", lostA2.slice(0, 3));

    // Build A's tabs close: build A stays (the cached shell needs it), and so does the redeploy while its tab is open.
    await Promise.all([quiet(tabA), quiet(back)]);
    await tabA.close();
    await back.close();
    proxy.offline(false);
    const p1 = await t.context.newPage();
    await p1.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(p1, { posted: true });
    const keys = new Set(await cacheKeys(p1));
    t.check(a.all.every((p) => keys.has(p)), 'rollback: build A, needed by the cached shell again, stays whole', a.all.filter((p) => !keys.has(p)).slice(0, 3));
    t.check(onlyA2.every((p) => keys.has(p)), "rollback: the redeploy's files stay while its tab is open", onlyA2.filter((p) => !keys.has(p)).slice(0, 3));
    // Its tab closes: they go.
    await quiet(tabA2);
    await tabA2.close();
    const p2 = await t.context.newPage();
    await p2.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(p2, { posted: true });
    const after = await cacheKeys(p2);
    const left = after.filter((p) => onlyA2.includes(p));
    t.check(!left.length, "rollback: once its tab is closed, the redeploy's files are deleted", `${left.length} left of ${onlyA2.length}`);
    t.check(!after.includes('/sw.js?retired') && onlyA.every((p) => after.includes(p)), 'rollback: build A is whole and no retired record is left');
    proxy.offline();
    const off = await t.context.newPage();
    const o = await opened(off, proxy.origin, '/');
    t.check(o.ok && o.tool === 1, 'rollback offline after cleanup: / opens', o);
    await features(t, off, 'rollback offline after cleanup');
    await checkErrors(t, 'rollback');
  } finally {
    proxy.close();
  }
});

test("homeretry: a shell that couldn't follow a tool page to its new build follows on the next visit", { variant: REDEPLOY }, async (t) => {
  const A = (await serveVariant(BUILD)).base;
  const proxy = await startProxy({ A, A2: t.base });
  const TOOL = '/tools/json-validator';
  try {
    const a2 = await closure(t.base);
    await t.context.addInitScript(WATCH_POSTS);
    await t.page.goto(proxy.origin + TOOL, { waitUntil: 'load' });
    await swIdle(t.page, { posted: true, timeout: 90_000 });
    t.assert(await waitInCache(t.page, ['/', TOOL]), 'homeretry: the tool page and the shell are cached');
    // The redeploy, while '/' fails: a new tab gets the tool page from the network, but the shell can't follow.
    proxy.deploy('A2');
    proxy.net.fail.add('/');
    const visitor = await t.context.newPage();
    await visitor.goto(proxy.origin + TOOL, { waitUntil: 'load' });
    await swIdle(visitor, { posted: true, timeout: 90_000 });
    const kept = (await cachedText(visitor, '/')) || '';
    t.check(!!kept && !a2.named.every((p) => kept.includes(p)), "homeretry: while '/' fails, the cached shell stays the one that works");
    // '/' answers again: the next visit to the same build's tool page brings the shell along.
    proxy.net.fail.delete('/');
    await quiet(visitor);
    await visitor.reload({ waitUntil: 'load' });
    t.check(await newShell(t, visitor, a2.named), 'homeretry: the next visit to the tool page brings the shell to the new build');
    await swIdle(visitor, { posted: true, timeout: 90_000 });
    await checkErrors(t, 'homeretry');
  } finally {
    proxy.close();
  }
});
