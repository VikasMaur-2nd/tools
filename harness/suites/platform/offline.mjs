// The service worker (public/sw.js) against real production builds: offline after a first visit, a deploy
// while a tab is open, and a deploy with a file missing. A proxy is the site the browser sees: it forwards
// to one build at a time (a deploy switches it), can 404 single files, and goes offline by cutting every
// connection. Build A is `default`, A′ is `redeploy` (the same code, a few chunks with new hashes).
// Ported from ~/.cache/rv/c/sw-offline.mjs: 40 default checks plus 3 swupdate and 8 upgrade checks.
// Four added preflight assertions bring the committed suite to 55 checks per engine.
// Every wait is on the worker (a probe the proxy adds to /sw.js reports its unfinished waitUntil work) or
// on the cache, never on time.
import { defaults } from '../../lib/api.mjs';
import { readFileSync } from 'node:fs';
import {
  CACHE_NAME, POLL, WATCH_POSTS, cacheKeys, cachedText, closure, missingFromCache, opened, serveVariant, startProxy, swIdle, swVersion, test, unreachable, until, waitInCache,
} from './_helpers.mjs';

defaults({ engines: 'all', serviceWorkers: 'allow', allowErrors: true, tags: ['offline'], timeout: 300_000 });

const FOLLOW = 'PR #26: the worker caches every chunk a page can load once it has settled (main caches only what pages loaded)';
const RETIRE = "PR #26: a deploy retires the old build's files until its tabs close (main deletes them at once)";
const WHOLE = 'PR #26: a new shell replaces the old one only once every file it names is cached (main swaps it in when one 404s)';

const DOC = JSON.stringify({ users: [{ id: 1, name: 'Ada', tags: ['a', 'b'] }, { id: 2, name: 'Grace', tags: [] }], total: 2 }, null, 2);
/** Errors of an offline page that are just the network being gone. */
const NETWORK = /_vercel\/insights|ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|ERR_CONNECTION|Failed to load resource|NetworkError|net::|fetch|Load failed|Cannot load https?:|The network connection was lost|Could not connect/i;

function checkErrors(t, scenario, known) {
  const relevant = t.errors.filter((e) => !NETWORK.test(e));
  // A missing cached module can also surface as an unhandled ChunkLoadError or a
  // WebKit blob-worker error. Keep these failures visible under their causal PR.
  const missingChunk = relevant.length && relevant.every((e) => /ChunkLoadError: Failed to load chunk|Cannot load blob:https?:.*due to access control checks/.test(e));
  t.check(!relevant.length, `${scenario}: no page errors`, relevant.slice(0, 3), known && missingChunk ? { known } : undefined);
}

/**
 * The lazily loaded features in a page that has just opened (before its warm-up loads them): the graph,
 * Convert to every format, the Excel writer and the YAML importer are each their own chunk.
 * `known`: these fail because of that known bug (a chunk the worker should have cached).
 */
async function features(t, page, label, known) {
  const unavailable = (detail) => {
    for (const feature of ['graph view', 'Convert to every format', 'Excel download', 'YAML import']) {
      t.check(false, `${label}: ${feature}`, detail, known ? { known } : undefined);
    }
  };
  // Checking a document proves hydration completed and also works on pre-harness
  // builds that do not emit the tk:engine instrumentation mark.
  const input = await page.locator('.app:visible #input').waitFor({ timeout: t.budget(5000) }).then(() => true, () => false);
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
  const opts = known ? { known } : undefined;

  await t.app.view(page, 'graph');
  const graph = await page.waitForFunction(() => window.__vis('#view-graph .gv-ctl') ? 'ready' : window.__vis('.toast.err') ? 'error' : false, null, { ...POLL, timeout: t.budget(15_000) }).then(async (h) => (await h.jsonValue()) === 'ready', () => false);
  t.check(graph && !(await errToast()), `${label}: graph view`, undefined, opts);

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
  t.check(targets.length >= 15 && !bad.length && !(await errToast()), `${label}: Convert to every format (${targets.length})`, bad.join(' '), opts);

  const dl = page.waitForEvent('download', { timeout: t.budget(15_000) }).then((d) => d.suggestedFilename(), () => null);
  await t.app.command(page, 'Export to Excel');
  const name = await dl;
  t.check(!!name && name.endsWith('.xlsx') && !(await errToast()), `${label}: Excel download`, String(name), opts);

  await page.setInputFiles('.app:visible input[type=file]', { name: 'people.yaml', mimeType: 'text/yaml', buffer: Buffer.from('people:\n  - name: Ada\n    born: 1815\n  - name: Grace\n') });
  const yaml = await page.waitForFunction(() => /"born": 1815/.test(document.getElementById('input').value), null, { ...POLL, timeout: t.budget(15_000) }).then(() => true, () => false);
  t.check(yaml && !(await errToast()), `${label}: YAML import`, undefined, opts);
}

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
    t.check(!missing.length, 'fresh: the shell and every chunk it can load are cached', `${missing.length} of ${home.all.length + 1} missing: ${missing.slice(0, 4).join(' ')}`, { known: FOLLOW });
    const lazyKnown = missing.length ? FOLLOW : undefined;
    for (const path of ['/tools/json-validator', '/es']) {
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
    await features(t, p2, 'fresh offline /', lazyKnown);
    const tool = await opened(p2, proxy.origin, '/tools/json-validator');
    t.check(tool.ok && tool.tool === 1, 'fresh offline: a visited tool page opens', tool);
    const es = await opened(p2, proxy.origin, '/es');
    t.check(es.ok && es.lang === 'es' && es.tool === 1, 'fresh offline: a localized page opens', es);
    const p3 = await t.context.newPage();
    const es2 = await opened(p3, proxy.origin, '/es/tools/json-validator');
    t.check(es2.ok && es2.lang === 'es', 'fresh offline: an unvisited localized tool page falls back to its home', es2);
    const other = await opened(p3, proxy.origin, '/tools/json-diff');
    t.check(other.ok && other.tool === 1, 'fresh offline: an unvisited page falls back to the shell', other);
    await features(t, p3, 'fresh offline (fallback page)', lazyKnown);
    checkErrors(t, 'fresh', lazyKnown);
  } finally {
    proxy.close();
  }
});

test("deploy: a tab open during a deploy keeps its build offline; new tabs get the new one", { variant: 'redeploy' }, async (t) => {
  const A = (await serveVariant('default')).base;
  const proxy = await startProxy({ A, A2: t.base });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    const onlyA = a.all.filter((p) => !a2.all.includes(p));
    const onlyA2 = a2.all.filter((p) => !a.all.includes(p));
    t.log(`build A ${a.all.length} files, A' ${a2.all.length}, A-only ${onlyA.length}, A'-only ${onlyA2.length} (${onlyA2.filter((p) => !a2.named.includes(p)).length} of them lazy)`);
    t.assert(onlyA2.some((p) => a2.named.includes(p)), "the redeploy's HTML names files build A doesn't have", onlyA2);

    await firstVisit(t, proxy);
    const oldTab = t.page;
    const lazyKnown = (await missingFromCache(oldTab, a.all)).length ? FOLLOW : undefined;
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
    // now-committed shell before waiting for that build's own warm-up/cache message.
    await visitor.reload({ waitUntil: 'load' });
    await swIdle(visitor, { posted: true, timeout: 90_000 });
    const missingA2 = await missingFromCache(visitor, a2.all);
    t.check(!missingA2.length, 'deploy: every file of the new build, lazy ones included, is cached', missingA2.slice(0, 3), { known: FOLLOW });
    const told = await updateNotice;
    t.check(told, 'deploy: the open tab is told a new version is ready');

    proxy.offline();
    const lost = await unreachable(oldTab, a.all);
    t.check(!lost.length, 'deploy offline: the old tab still gets every file of its build (lazy ones included)', `${lost.length} missing ${lost.slice(0, 3).join(' ')}`, { known: RETIRE });
    // The old tab opens a feature it hadn't loaded yet.
    await oldTab.getByRole('tab', { name: 'Compare' }).click();
    const cmp = await oldTab.locator('#input2').first().waitFor({ timeout: t.budget(15_000) }).then(() => true, () => false);
    t.check(cmp, 'deploy offline: the old tab opens Compare', undefined, lost.length ? { known: RETIRE } : undefined);
    const fresh = await t.context.newPage();
    const o2 = await opened(fresh, proxy.origin, '/');
    t.check(o2.ok && o2.tool === 1, 'deploy offline: a new tab opens the new build', o2);
    await features(t, fresh, 'deploy offline, new build', missingA2.length ? FOLLOW : lazyKnown);

    // The old tabs close: the old build's files go (checked when a page posts what it loaded, or on a visit).
    await oldTab.close();
    await visitor.close();
    proxy.offline(false);
    const later = await t.context.newPage();
    await later.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(later, { posted: true });
    const left = (await cacheKeys(later)).filter((p) => onlyA.includes(p));
    t.check(!left.length, "deploy: once the old tabs are closed, the old build's files are deleted", `${left.length} left of ${onlyA.length}`, { known: RETIRE });
    t.check(!(await cacheKeys(later)).includes('/sw.js?retired'), 'deploy: the retired record is gone with them');
    proxy.offline();
    const last = await t.context.newPage();
    const o3 = await opened(last, proxy.origin, '/');
    t.check(o3.ok && o3.tool === 1, 'deploy offline after cleanup: the new build opens', o3);
    await features(t, last, 'deploy offline after cleanup', missingA2.length ? FOLLOW : lazyKnown);
    checkErrors(t, 'deploy', lost.length ? RETIRE : missingA2.length ? FOLLOW : undefined);
  } finally {
    proxy.close();
  }
});

test('fail404: a deploy with a file missing leaves the cached build whole offline', { variant: 'redeploy' }, async (t) => {
  const A = (await serveVariant('default')).base;
  const proxy = await startProxy({ A, A2: t.base });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    await firstVisit(t, proxy);
    const lazyKnown = (await missingFromCache(t.page, a.all)).length ? FOLLOW : undefined;
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
    t.check(kept, 'fail404: the old shell stays when a file of the new one 404s', broken, { known: WHOLE });
    proxy.offline();
    const p3 = await t.context.newPage();
    const o = await opened(p3, proxy.origin, '/');
    t.check(o.ok && o.tool === 1, 'fail404 offline: / opens (old build)', o, kept ? undefined : { known: WHOLE });
    await features(t, p3, 'fail404 offline', kept ? lazyKnown : WHOLE);
    checkErrors(t, 'fail404', kept ? lazyKnown : WHOLE);
  } finally {
    proxy.close();
  }
});

async function updateWorker(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error('The first visit did not register a worker');
    await reg.update();
  });
  await swVersion(page, 'A2');
  await swIdle(page);
}

async function newShell(t, page, named) {
  return until(async () => {
    const html = await cachedText(page, '/');
    return html && named.every((p) => html.includes(p));
  }, { timeout: t.budget(30_000), what: 'the updated worker to cache the new shell' }).then(() => true, () => false);
}

test('swupdate: a worker update first seen on a tool page installs the new shell and preserves old tabs', { variant: 'redeploy' }, async (t) => {
  const A = (await serveVariant('default')).base;
  const proxy = await startProxy({ A, A2: t.base }, { workerVersions: true });
  try {
    const [a, a2] = await Promise.all([closure(A), closure(t.base)]);
    await firstVisit(t, proxy);
    const oldTab = t.page;
    proxy.deploy('A2');
    const visitor = await t.context.newPage();
    await visitor.goto(proxy.origin + '/tools/json-validator', { waitUntil: 'load' });
    await updateWorker(visitor);
    t.check(await newShell(t, visitor, a2.named), 'swupdate: the new worker brings in the new shell');
    proxy.offline();
    const lost = await unreachable(oldTab, a.all);
    t.check(!lost.length, 'swupdate offline: the old tab still gets every file of its build', lost, { known: RETIRE });
    checkErrors(t, 'swupdate', lost.length ? RETIRE : undefined);
  } finally {
    proxy.close();
  }
});

test('upgrade: the frozen production worker upgrades without breaking its cached tabs', { variant: 'redeploy' }, async (t) => {
  const A = (await serveVariant('default')).base;
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
    await visitor.goto(proxy.origin + '/', { waitUntil: 'load' });
    await updateWorker(visitor);
    t.check(await newShell(t, visitor, a2.named), 'upgrade: the new worker brings in the new shell');
    await visitor.reload({ waitUntil: 'load' });
    await swIdle(visitor, { posted: true });
    const missing = await missingFromCache(visitor, a2.all);
    proxy.offline();
    const lost = await unreachable(oldTab, oldFiles);
    t.check(!lost.length, 'upgrade offline: the old tab still gets every file it had cached', lost, { known: RETIRE });
    const fresh = await t.context.newPage();
    const o = await opened(fresh, proxy.origin, '/');
    t.check(o.ok && o.tool === 1, 'upgrade offline: a new tab opens the new build', o);
    await features(t, fresh, 'upgrade offline', missing.length ? FOLLOW : undefined);
    checkErrors(t, 'upgrade', lost.length ? RETIRE : missing.length ? FOLLOW : undefined);
  } finally {
    proxy.close();
  }
});
