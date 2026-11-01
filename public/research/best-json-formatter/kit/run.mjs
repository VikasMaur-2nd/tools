// Runs the tests of protocol.md section 5 on the tools in adapters/. Every result is one JSON line in
// <out>/results/<suite>-<engine>.jsonl, written as soon as it is known; screenshots of failures go to <out>/shots/.
//
//   xvfb-run -a node run.mjs speed  --engine chromium --sizes 100kb,1mb,10mb,50mb --reps 5
//   xvfb-run -a node run.mjs quality                 data safety, errors, features, keyboard, offline, phone
//   xvfb-run -a node run.mjs webkit                  the WebKit check (5.7)
//   xvfb-run -a node run.mjs smoke --tools jsonformatter-org     a quick look at one tool (small files only)
//
// Options: --tools a,b (adapter ids; default all), --out dir (default out), --seed n (tool order), --only data,errors
// (quality parts), --from n (first repetition, to split a speed run over jobs). On Linux run it under xvfb-run: the browsers are headed.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ADAPTERS } from './adapters/index.mjs';
import { DATA_CASES, ERROR_CASES } from './cases.mjs';
import { END_MARKER, MARKER, SIZES, generate, sha256 } from './generate.mjs';
import { captureNetwork, focusInput, formatControl, launch, linesInText, newContext, openTool, pasteAndFormat, pasteSmall, readError, readOutput, shot, stage } from './lib/harness.mjs';
import { compare, read } from './lib/tokens.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    engine: { type: 'string', default: 'chromium' },
    sizes: { type: 'string', default: '100kb,1mb,10mb,50mb' },
    reps: { type: 'string' },
    from: { type: 'string', default: '1' },
    tools: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string', default: 'out' },
    seed: { type: 'string', default: '20261101' },
  },
});
const suite = positionals[0];
const engine = o.engine;
const tools = o.tools ? o.tools.split(',').map((id) => ADAPTERS.find((a) => a.id === id) ?? fail(`no adapter ${id}`)) : ADAPTERS;
mkdirSync(join(o.out, 'results'), { recursive: true });
mkdirSync(join(o.out, 'shots'), { recursive: true });
const manifest = JSON.parse(readFileSync(new URL('fixtures.sha256.json', import.meta.url), 'utf8'));
const TIMEOUT = { '100kb': 30_000, '1mb': 60_000, '10mb': 120_000, '50mb': 120_000 };

/** A failure's first line, plus Playwright's note of what covered the target, if a click was blocked. */
function why(e) {
  const lines = String(e?.message ?? e).split('\n');
  const cover = lines.find((l) => /intercepts pointer events|not visible|not enabled|not stable/.test(l));
  return (lines[0] + (cover ? ` (${cover.trim()})` : '')).slice(0, 400);
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolves with the promise, or rejects after ms: a frozen page never answers an evaluate. */
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`${what}: no answer within ${Math.round(ms / 1000)} s`)))]);
let fileFor = null;
function record(r) {
  const line = { suite: r.suite ?? suite, engine, at: new Date().toISOString(), ...r };
  appendFileSync(join(o.out, 'results', `${fileFor ?? suite}-${engine}.jsonl`), JSON.stringify(line) + '\n');
  const extra = r.ok === false ? ` FAIL ${r.failure ?? ''}` : r.ms != null ? ` ${(r.ms / 1000).toFixed(3)} s, freeze ${(r.freezeMs / 1000).toFixed(2)} s` : r.grade ? ` ${r.grade}` : '';
  console.log(`[${line.at.slice(11, 19)}] ${line.suite} ${r.tool} ${r.size ?? r.case ?? r.feature ?? ''}${r.rep ? ' #' + r.rep : ''}${r.attempt > 1 ? ' retry' : ''}${extra}`);
}
/** Seeded shuffle (mulberry32), so a rerun visits tools in the same order. */
function shuffle(list, seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- speed

/** One timed run (5.3, plus the page and privacy data of 5.4 and 5.5): a new profile, paste, format, verify. */
async function speedRun(browser, adapter, size, text, { phone = false, offlineFirst = false, cpu = 1 } = {}) {
  const context = await newContext(browser, engine, { phone });
  const net = captureNetwork(context, { site: new URL(adapter.url).hostname });
  const out = { tool: adapter.id, size };
  let page;
  try {
    const opened = await within(openTool(context, adapter, { phone }), 75_000, 'opening the page');
    page = opened.page;
    out.openMs = opened.openMs;
    out.interruptions = opened.interruptions;
    if (offlineFirst) {
      await sleep(5000); // time for a service worker to install and cache
      await context.setOffline(true);
      await within(page.reload({ waitUntil: 'load', timeout: 30_000 }), 40_000, 'offline reload');
      if (adapter.ready) await adapter.ready(page, { phone });
      await page.locator(adapter.input.click ?? adapter.input.sel).first().waitFor({ state: 'visible', timeout: 15_000 });
    }
    if (cpu > 1 && engine === 'chromium') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    }
    await within(stage(page, adapter, text), 60_000, 'putting the file on the clipboard');
    const timeoutMs = TIMEOUT[size] ?? 30_000;
    const r = await net.window(MARKER, text.length / 2, () => within(pasteAndFormat(page, adapter, { text, endMarker: END_MARKER, timeoutMs, tap: phone }), timeoutMs + 20_000, 'formatting'));
    Object.assign(out, { ms: r.ms, totalMs: r.totalMs, freezeMs: r.freezeMs, pasteSeen: r.pasteSeen, clickSeen: r.clickSeen, landedSeen: r.landedSeen, formattedOnPaste: r.formattedOnPaste });
    out.uploads = net.lastHits;
    if (!r.done) throw new Error(r.waitError ? `no complete result (${r.waitError})` : 'no complete result within the time limit');
    if (!r.pasteSeen) throw new Error('the paste key press was not seen');
    if (adapter.format && !r.clickSeen && !r.formattedOnPaste) throw new Error('the format click was not seen');
    // Is the output exactly the same data? (Outside the timing.)
    const v = adapter.verify ? await within(adapter.verify(page), 60_000, 'reading the output') : await within(page.evaluate(([k, s]) => window.__fmt.verify(k, s), [(adapter.output === 'input' ? adapter.input : adapter.output).kind, (adapter.output === 'input' ? adapter.input : adapter.output).sel]), 60_000, 'reading the output');
    out.verified = v.ok && v.sha256 === manifest[size]?.sha256;
    if (!out.verified) throw new Error(`wrong output: ${v.why ?? `data differs (${v.length} characters)`}`);
    const st = await page.evaluate(() => ({ lcp: window.__fmt.state.lcp, cls: window.__fmt.state.cls })).catch(() => ({}));
    Object.assign(out, { lcpMs: st.lcp || null, cls: st.cls ?? null });
    if (phone) {
      const box = adapter.format ? await (await formatControl(page, adapter)).boundingBox().catch(() => null) : null;
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })).catch(() => null);
      out.fits = w && { noSideScroll: w.sw <= w.iw + 1, controlInView: !adapter.format || (!!box && box.x >= -1 && box.x + box.width <= w.iw + 1) };
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.failure = why(e);
    out.uploads ??= net.lastHits ?? []; // a run that timed out still reports what it sent
    page ??= e.page;
    if (page) {
      out.crashed = await within(page.evaluate(() => 1), 5000, 'page').then(() => false, () => true);
      const err = await within(readError(page, adapter), 5000, 'error').catch(() => null);
      if (err?.text) out.toolMessage = err.text.slice(0, 300);
      await shot(page, join(o.out, 'shots', `${suite}-${engine}-${adapter.id}-${size}-${Date.now()}.jpg`));
    }
  } finally {
    out.net = net.summary();
    await within(context.close(), 30_000, 'closing').catch(() => {});
  }
  return out;
}

async function speedSuite(browser) {
  const sizes = o.sizes.split(',');
  const reps = Number(o.reps ?? (engine === 'chromium' ? 5 : 3));
  const texts = {};
  for (const s of sizes) {
    texts[s] = generate(SIZES[s]);
    if (sha256(texts[s]) !== manifest[s].sha256) fail(`${s} differs from fixtures.sha256.json`);
  }
  const stopAt = new Map(); // tool → index of the size it failed twice at
  const uploads = new Set();
  // --from splits the repetitions over jobs (--from 4 --reps 5 runs repetitions 4 and 5); every job runs every tool.
  for (let rep = Number(o.from); rep <= reps; rep++) {
    for (const adapter of shuffle(tools, Number(o.seed) + rep)) {
      for (const [i, size] of sizes.entries()) {
        // A blocked tool (its adapter says why) gets one 1 MB run in the first repetition, for what it sends.
        if (adapter.blocked) {
          if (rep === Number(o.from) && size === '1mb') record({ ...(await speedRun(browser, adapter, size, texts[size])), rep, attempt: 1, blocked: adapter.blocked });
          else record({ tool: adapter.id, size, rep, ok: null, skipped: true, failure: `not tested: ${adapter.blocked}` });
          continue;
        }
        if (stopAt.has(adapter.id) && i >= stopAt.get(adapter.id)) {
          record({ tool: adapter.id, size, rep, ok: false, skipped: true, failure: `skipped: failed twice at ${sizes[stopAt.get(adapter.id)]}` });
          continue;
        }
        if (uploads.has(adapter.id) && SIZES[size] >= 10_000_000 && rep > 1) {
          record({ tool: adapter.id, size, rep, ok: null, skipped: true, failure: 'not repeated: this tool uploads JSON (protocol 5.3)' });
          continue;
        }
        let r;
        for (let attempt = 1; attempt <= 2; attempt++) {
          r = await speedRun(browser, adapter, size, texts[size]);
          record({ ...r, rep, attempt });
          if (r.uploads?.length) uploads.add(adapter.id);
          if (r.ok) break;
        }
        if (!r.ok) stopAt.set(adapter.id, i);
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------------- quality

/** 5.1: every data case, pasted into one page of the tool (reloaded after a failure). */
async function dataSuite(browser, adapter, { cases = DATA_CASES, as = 'data' } = {}) {
  let context, page;
  const open = async () => {
    if (context) await within(context.close(), 20_000, 'closing').catch(() => {});
    context = await newContext(browser, engine);
    ({ page } = await within(openTool(context, adapter), 75_000, 'opening the page'));
  };
  try {
    await open();
  } catch (e) {
    for (const c of cases) record({ suite: as, tool: adapter.id, case: c.id, grade: 'untested', ok: false, failure: String(e.message).split('\n')[0] });
    return;
  }
  for (const c of cases) {
    const docs = [];
    for (const doc of c.docs) {
      let res;
      try {
        const want = read(doc).value;
        const inPlace = adapter.output === 'input';
        const before = inPlace ? null : await within(readOutput(page, adapter), 10_000, 'reading').then((x) => x.text, () => null);
        await within(stage(page, adapter, doc), 20_000, 'clipboard');
        const big = doc.length > 10_000;
        const started = Date.now();
        await within(pasteSmall(page, adapter, { text: doc, timeoutMs: big ? 30_000 : 8_000 }), big ? 45_000 : 20_000, 'formatting');
        const after = (await within(readOutput(page, adapter), 20_000, 'reading')).text ?? '';
        const err = await within(readError(page, adapter), 10_000, 'reading the error');
        const shownError = err.text || err.lines.length ? (err.text || `error marked on line ${err.lines.join(', ')}`).slice(0, 200) : null;
        const changed = inPlace ? after !== doc : after !== before;
        const got = read(after.trim());
        if (changed && !got.error) {
          res = { ...compare(want, got.value), message: shownError };
        } else if (!changed && inPlace && !shownError && !/[[{]/.test(doc)) {
          res = { grade: 'pass', notes: [], message: null }; // a bare scalar formats to itself
        } else if (shownError) {
          res = { grade: c.id === 'deep-nesting' ? 'refused' : 'rejected', notes: [], message: shownError };
        } else if (changed && got.error) {
          res = { grade: 'changed', notes: [{ kind: 'changed', why: `output is not JSON: ${got.error} at line ${got.line}` }], message: null, outputStart: after.slice(0, 120) };
        } else {
          res = { grade: 'no output', notes: [], message: null };
        }
        res.ms = Date.now() - started;
      } catch (e) {
        res = { grade: 'no output', notes: [], failure: why(e) };
        await shot(page, join(o.out, 'shots', `data-${adapter.id}-${c.id}.jpg`));
        await open().catch(() => {});
      }
      docs.push(res);
    }
    // A case with several documents passes only if every one does; the worst grade counts.
    const order = ['changed', 'rejected', 'no output', 'refused', 'spelling', 'pass'];
    const grade = docs.map((d) => d.grade).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    record({ suite: as, tool: adapter.id, case: c.id, grade, docs });
  }
  await within(context.close(), 20_000, 'closing').catch(() => {});
}

/** 5.2: every error case: is it reported, and on the right line? */
async function errorSuite(browser, adapter) {
  const context = await newContext(browser, engine);
  try {
    const { page } = await within(openTool(context, adapter), 75_000, 'opening the page');
    const RESET = '{"reset": true}';
    for (const c of ERROR_CASES) {
      try {
        // A valid document first clears the previous case's error; a message still showing from before (a toast
        // that hasn't faded) is not counted for this case.
        await within(stage(page, adapter, RESET), 20_000, 'clipboard');
        await within(pasteSmall(page, adapter, { text: RESET, timeoutMs: 4000 }), 15_000, 'resetting');
        const before = new Set((await within(readError(page, adapter), 10_000, 'reading the error')).text.split('\n').filter(Boolean));
        await within(stage(page, adapter, c.text), 20_000, 'clipboard');
        // Messages can be brief (a toast) or late: everything shown from the click until 1 s after the output
        // settles counts.
        const lines = new Set();
        const marks = new Set();
        const look = async () => {
          const e = await within(readError(page, adapter), 10_000, 'reading the error').catch(() => null);
          e?.text.split('\n').forEach((l) => l && lines.add(l));
          e?.lines.forEach((n) => marks.add(n));
        };
        await within(pasteSmall(page, adapter, { text: c.text, timeoutMs: 6000, onTick: look }), 40_000, 'formatting');
        await sleep(1000);
        await look();
        const err = { text: [...lines].filter((l) => !before.has(l)).join('\n'), lines: [...marks] };
        const named = linesInText(err.text);
        const detected = Boolean(err.text || err.lines.length || err.repaired);
        const rightLine = detected && [...err.lines, ...named].some((n) => c.lines.includes(n));
        record({ suite: 'errors', tool: adapter.id, case: c.id, detected, rightLine, message: err.text.slice(0, 300), marked: err.lines, named, repaired: err.repaired ?? false });
      } catch (e) {
        record({ suite: 'errors', tool: adapter.id, case: c.id, detected: false, rightLine: false, failure: String(e.message).split('\n')[0] });
      }
    }
  } catch (e) {
    for (const c of ERROR_CASES) record({ suite: 'errors', tool: adapter.id, case: c.id, detected: false, rightLine: false, untested: true, failure: String(e.message).split('\n')[0] });
  } finally {
    await within(context.close(), 20_000, 'closing').catch(() => {});
  }
}

/** 5.9: each feature the adapter names is checked on the live page. */
async function featureSuite(browser, adapter) {
  const context = await newContext(browser, engine);
  try {
    const { page } = await within(openTool(context, adapter), 75_000, 'opening the page');
    for (const [feature, how] of Object.entries(adapter.features ?? {})) {
      let found = false;
      let why = '';
      try {
        if (typeof how === "function") found = Boolean(await within(how(page, adapter), 30_000, feature));
        else found = await page.locator(how).first().isVisible();
      } catch (e) {
        why = String(e.message).split('\n')[0];
      }
      record({ suite: 'features', tool: adapter.id, feature, found, how: typeof how === 'string' ? how : 'script', why });
    }
  } catch (e) {
    record({ suite: 'features', tool: adapter.id, feature: '*', found: false, failure: String(e.message).split('\n')[0] });
  } finally {
    await within(context.close(), 20_000, 'closing').catch(() => {});
  }
}

/** 5.8: accessible names, and the paste-and-format job done with the keyboard alone. */
async function keyboardSuite(browser, adapter) {
  const context = await newContext(browser, engine);
  const res = { suite: 'keyboard', tool: adapter.id };
  try {
    const { page } = await within(openTool(context, adapter), 75_000, 'opening the page');
    const nameOf = async (target) => {
      if (!target) return null;
      const loc = typeof target === 'string' ? page.locator(target).first() : target;
      const snap = await loc.ariaSnapshot({ timeout: 5000 }).catch(() => '');
      const m = /^- \w[\w-]*(?: "((?:[^"\\]|\\.)*)")?/.exec(snap.trim());
      return m?.[1] || null;
    };
    res.inputName = await nameOf(adapter.input.a11y ?? adapter.input.sel);
    res.controlName = adapter.format ? await nameOf(await formatControl(page, adapter)) : 'formats on paste';
    // Keyboard only, from the top of the page.
    const text = generate(SIZES['100kb']);
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    const inInput = () => page.evaluate((sel) => { const box = document.querySelector(sel); return !!box && box.contains(document.activeElement); }, adapter.input.sel);
    let tabs = 0;
    while (tabs < 40 && !(await inInput())) (await page.keyboard.press('Tab'), tabs++);
    res.tabsToInput = (await inInput()) ? tabs : null;
    if (res.tabsToInput !== null) {
      const MOD = 'Control';
      await page.keyboard.press(`${MOD}+A`);
      await page.keyboard.press(`${MOD}+V`);
      await sleep(500);
      if (adapter.format) {
        if (adapter.keyboard?.shortcut) await page.keyboard.press(adapter.keyboard.shortcut);
        else {
          const control = await formatControl(page, adapter);
          const onControl = () => control.evaluate((b) => b === document.activeElement || b.contains(document.activeElement)).catch(() => false);
          let n = 0;
          let escaped = false;
          while (n < 40 && !(await onControl())) {
            const was = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
            await page.keyboard.press('Tab');
            n++;
            const now = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
            if (now === was && !escaped) (await page.keyboard.press('Escape'), (escaped = true));
          }
          res.tabsToControl = (await onControl()) ? n : null;
          if (res.tabsToControl !== null) await page.keyboard.press('Enter');
        }
      }
      const out = adapter.output === 'input' ? adapter.input : adapter.output;
      const done = adapter.done
        ? await page.evaluate(([fn, m]) => window.__fmt.waitFor(new Function('marker', fn).bind(null, m), 15000), [adapter.done.fn, END_MARKER])
        : await page.evaluate(([k, s, m]) => window.__fmt.waitFor(() => { const end = window.__fmt.io(k, s).tail(16); return end.multiline && end.text.includes(m); }, 15000), [out.kind, out.sel, END_MARKER]);
      res.keyboardFormat = done.done;
    } else res.keyboardFormat = false;
    res.ok = true;
  } catch (e) {
    res.ok = false;
    res.failure = String(e.message).split('\n')[0];
  } finally {
    await within(context.close(), 20_000, 'closing').catch(() => {});
  }
  record(res);
}

async function qualitySuite(browser) {
  const parts = (o.only ?? 'data,errors,features,keyboard,offline,phone').split(',');
  const small = generate(SIZES['100kb']);
  for (const adapter of shuffle(tools, Number(o.seed))) {
    if (adapter.blocked) {
      record({ suite: 'blocked', tool: adapter.id, why: adapter.blocked });
      if (parts.includes('features')) await featureSuite(browser, adapter);
      continue;
    }
    if (parts.includes('data')) await dataSuite(browser, adapter);
    if (parts.includes('errors')) await errorSuite(browser, adapter);
    if (parts.includes('features')) await featureSuite(browser, adapter);
    if (parts.includes('keyboard')) await keyboardSuite(browser, adapter);
    if (parts.includes('offline')) record({ suite: 'offline', ...(await speedRun(browser, adapter, '100kb', small, { offlineFirst: true })) });
    if (parts.includes('phone')) for (let rep = 1; rep <= 3; rep++) record({ suite: 'phone', rep, ...(await speedRun(browser, adapter, '100kb', small, { phone: true, cpu: 4 })) });
  }
}

/** 5.7: the 100 KB file, and two data cases whose grades the scorer compares with Chromium's. */
async function webkitSuite(browser) {
  const small = generate(SIZES['100kb']);
  const cases = DATA_CASES.filter((c) => ['big-integer', 'unicode'].includes(c.id));
  for (const adapter of tools.filter((a) => !a.blocked)) {
    record({ suite: 'webkit', ...(await speedRun(browser, adapter, '100kb', small)) });
    await dataSuite(browser, adapter, { cases, as: 'webkit-data' });
  }
}

/** A quick look while writing an adapter: a few cases, two errors, the 100 KB and 1 MB files once. */
async function smokeSuite(browser) {
  for (const adapter of tools) {
    fileFor = 'smoke';
    const keep = DATA_CASES;
    DATA_CASES.splice(0, DATA_CASES.length, ...keep.filter((c) => ['big-integer', 'key-order', 'unicode', 'top-level-scalar'].includes(c.id)));
    await dataSuite(browser, adapter);
    ERROR_CASES.splice(2);
    await errorSuite(browser, adapter);
    await featureSuite(browser, adapter);
    for (const size of ['100kb', '1mb']) record({ suite: 'speed', ...(await speedRun(browser, adapter, size, generate(SIZES[size]))) });
  }
}

const browser = await launch(engine);
console.log(`${suite} · ${engine} ${browser.version()} · ${tools.length} tools`);
try {
  if (suite === 'speed') await speedSuite(browser);
  else if (suite === 'quality') await qualitySuite(browser);
  else if (suite === 'webkit') await webkitSuite(browser);
  else if (suite === 'smoke') await smokeSuite(browser);
  else fail(`unknown suite ${suite}`);
} finally {
  await browser.close().catch(() => {});
}
