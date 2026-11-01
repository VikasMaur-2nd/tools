// What every test does with a tool's page: open it in a new profile, paste, press the tool's format control, wait
// for the complete result, read it, and record the network. Adapters (../adapters) only say where things are.
import zlib from 'node:zlib';
import { chromium, firefox, webkit } from 'playwright-core';
import { INPAGE } from './inpage.mjs';
import { AD_DOMAINS } from './ad-domains.mjs';

export const ENGINES = { chromium, firefox, webkit };
export const DESKTOP = { width: 1920, height: 1080 };
export const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(engine) {
  // Headed (a real window on Xvfb): no headless shell, nothing disguised.
  return ENGINES[engine].launch({ headless: false });
}

/** A new profile: no cache, cookies or storage. */
export async function newContext(browser, engine, { phone = false } = {}) {
  const context = await browser.newContext({
    ...(phone ? PHONE : { viewport: DESKTOP }),
    locale: 'en-US',
    timezoneId: 'America/New_York',
    ...(engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
    acceptDownloads: true,
  });
  await context.addInitScript(INPAGE);
  return context;
}

/** The registrable domain (eTLD+1) of a host, enough for counting third parties. */
const TWO_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.in', 'co.jp', 'com.br', 'co.nz', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'cloudfront.net', 'azureedge.net', 'blogspot.com', 'appspot.com', 'workers.dev']);
export function registrable(host) {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (/^\d+$/.test(parts.at(-1))) return host; // an IP address
  const two = parts.slice(-2).join('.');
  return parts.slice(TWO_LEVEL.has(two) ? -3 : -2).join('.');
}
const isAd = (host) => AD_DOMAINS.some((d) => host === d || host.endsWith('.' + d));

/**
 * Records every request, request body and WebSocket message of a context. `window(fn)` collects what is sent while
 * fn runs (plus `afterMs`), and reports whether the marker or a large body went out.
 */
export function captureNetwork(context, { site }) {
  const own = registrable(site);
  const all = [];
  const popups = [];
  let mark = null; // { marker, bigBody, hits: [] } while a privacy window is open
  const checkBody = (url, body, how) => {
    if (!mark) return;
    // The body as sent, and decompressed if it is gzip, deflate or brotli (replay and analytics scripts compress).
    const texts = [body ? body.toString('latin1') : ''];
    if (body && body.length > 64) {
      for (const un of [zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync, zlib.brotliDecompressSync]) {
        try {
          texts.push(un(body).toString('latin1'));
        } catch {}
      }
    }
    const variants = [mark.marker, encodeURIComponent(mark.marker), Buffer.from(mark.marker).toString('base64'), Buffer.from(mark.marker).toString('base64url')];
    const found = variants.find((v) => url.includes(v) || texts.some((t) => t.includes(v)));
    if (found) mark.hits.push({ url: url.slice(0, 200), how, why: texts.length > 1 && !texts[0].includes(found) && !url.includes(found) ? 'marker (compressed)' : 'marker' });
    else if (body && body.length > mark.bigBody) mark.hits.push({ url: url.slice(0, 200), how, why: `body of ${body.length} bytes` });
  };
  context.on('request', (req) => {
    const url = req.url();
    if (!/^https?:/.test(url)) return;
    const host = new URL(url).hostname;
    const entry = { url: url.slice(0, 300), host, method: req.method(), type: req.resourceType(), thirdParty: registrable(host) !== own, ad: isAd(host), bytes: 0, at: Date.now() };
    all.push(entry);
    let body = null;
    try {
      body = req.postDataBuffer();
    } catch {}
    checkBody(url, body, req.method());
    req.response().then(() => req.sizes()).then((s) => (entry.bytes = s.responseBodySize + s.responseHeadersSize)).catch(() => {});
  });
  context.on('page', (p) => {
    popups.push({ at: Date.now() });
    p.on('websocket', (ws) => ws.on('framesent', (f) => checkBody(ws.url(), Buffer.from(typeof f.payload === 'string' ? f.payload : f.payload), 'websocket')));
  });
  return {
    all,
    popups,
    async window(marker, bigBody, fn, afterMs = 5000) {
      mark = { marker, bigBody, hits: [] };
      try {
        return await fn();
      } finally {
        await sleep(afterMs);
        this.lastHits = mark.hits;
        mark = null;
      }
    },
    summary() {
      const third = new Set(all.filter((r) => r.thirdParty).map((r) => registrable(r.host)));
      return {
        requests: all.length,
        bytes: all.reduce((s, r) => s + r.bytes, 0),
        thirdPartyDomains: [...third].sort(),
        adRequests: all.filter((r) => r.ad).length,
        adDomains: [...new Set(all.filter((r) => r.ad).map((r) => registrable(r.host)))].sort(),
        popups: popups.length - 1, // the first page is ours
      };
    },
  };
}

/** Opens the tool: load, a short settle, the adapter's own readiness check, and the consent dialog if any. */
export async function openTool(context, adapter, { phone = false } = {}) {
  const page = await context.newPage();
  try {
    return await openPage(page, adapter, { phone });
  } catch (e) {
    e.page = page; // so the caller can still take a screenshot
    throw e;
  }
}

async function openPage(page, adapter, { phone }) {
  const crashed = { value: false };
  page.on('crash', () => (crashed.value = true));
  // A tool may report errors in an alert(): keep the message, then close the dialog.
  page.__dialogs = [];
  page.on('dialog', (d) => {
    page.__dialogs.push(d.message());
    d.dismiss().catch(() => {});
  });
  const t0 = Date.now();
  // The page's own document first; ads can keep the load event waiting for a long time, so it gets 20 s more.
  await page.goto(adapter.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
  await quiet(page, 1000, 5000);
  const interruptions = [];
  if (adapter.consent) {
    const btn = page.locator(adapter.consent).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      interruptions.push('consent dialog');
    }
  }
  if (adapter.ready) await adapter.ready(page, { phone });
  await page.locator(adapter.input.click ?? adapter.input.sel).first().waitFor({ state: 'visible', timeout: 30_000 });
  page.__interruptions = interruptions;
  const covered = await page.evaluate((sel) => window.__fmt?.covered(sel), adapter.input.click ?? adapter.input.sel).catch(() => null);
  if (covered && covered !== 'missing' && covered !== 'hidden') interruptions.push(`input covered by ${covered}`);
  return { page, crashed, openMs: Date.now() - t0, interruptions };
}

/** Waits until no new request has started for `idleMs`, at most `maxMs`. */
export async function quiet(page, idleMs, maxMs) {
  let last = Date.now();
  const on = () => (last = Date.now());
  page.on('request', on);
  const end = Date.now() + maxMs;
  while (Date.now() < end && Date.now() - last < idleMs) await sleep(100);
  page.off('request', on);
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Puts text on the clipboard (outside any timing) and focuses the input. */
export async function stage(page, adapter, text) {
  if (page.__dialogs) page.__dialogs.length = 0;
  await focusInput(page, adapter);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

export async function focusInput(page, adapter) {
  const target = page.locator(adapter.input.click ?? adapter.input.sel).first();
  if (adapter.input.focus) return adapter.input.focus(page);
  try {
    await target.click({ timeout: 10_000, position: adapter.input.clickAt }).catch(async (e) => {
      if (!(await dismissOverlay(page))) throw e;
      await target.click({ timeout: 10_000, position: adapter.input.clickAt });
    });
  } catch (e) {
    // Something covers the input (an ad, a banner): focus its text area directly, which a person would reach by
    // closing the overlay, and note the overlay. This is outside any timing.
    const covered = /intercepts pointer events/.test(e.message) ? (e.message.match(/<[^>]{0,120}>/)?.[0] ?? 'an element') : null;
    const ok = await page
      .locator(adapter.input.sel)
      .first()
      .evaluate((box) => {
        const el = box.matches('textarea, [contenteditable=true]') ? box : box.querySelector('textarea, [contenteditable=true], .cm-content');
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      })
      .catch(() => false);
    if (!ok) throw e;
    (page.__interruptions ??= []).push(covered ? `input covered by ${covered}` : 'input could not be clicked');
  }
}

/**
 * Closes a full-page ad (Google's "vignette" and similar) the way a person would, with its own close button, and
 * notes it as an interruption. Returns true if one was closed.
 */
export async function dismissOverlay(page) {
  // Only inside ad frames, never the tool's own page (whose Close buttons belong to the tool).
  for (const frame of page.frames().filter((f) => f !== page.mainFrame())) {
    const close = frame.locator('#dismiss-button, [aria-label="Close ad"]').first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 3000 }).catch(() => {});
      await sleep(500);
      (page.__interruptions ??= []).push('full-page ad');
      return true;
    }
  }
  return false;
}

/** Clicks; if something covers the target, closes a full-page ad (if that is what covers it) and clicks again. */
export async function clickThrough(page, target, { timeout = 10_000, tap = false } = {}) {
  const act = (ms) => (tap ? target.tap({ timeout: ms }) : target.click({ timeout: ms }));
  try {
    return await act(Math.min(timeout, 8000));
  } catch (e) {
    if (!/intercepts pointer events|Timeout/.test(e.message) || !(await dismissOverlay(page))) throw e;
    return act(timeout);
  }
}

/** The tool's format control: a selector, or a function that picks one on the live page (a site that shows
 * different layouts to different visitors). */
export async function formatControl(page, adapter) {
  return typeof adapter.format === 'function' ? adapter.format(page) : page.locator(adapter.format).first();
}

/**
 * Waits until the pasted text has landed in the input (its last characters are on the input's last lines), the
 * moment a person would press Format. Inputs that can't be read wait a fixed 300 ms instead.
 */
export async function landed(page, adapter, text, timeoutMs = 30_000) {
  // The input has the pasted text when it has as many lines and its last two lines end the same way (the last
  // 60 characters; a minified document is one long line).
  const lines = text.split('\n');
  const tail = lines.slice(-2).join('\n').slice(-60);
  const readable = await page.evaluate(([k, s]) => { try { window.__fmt.io(k, s).lines(); return true; } catch { return false; } }, [adapter.input.kind, adapter.input.sel]).catch(() => false);
  if (!readable) return null;
  const r = await page.evaluate(
    ([k, s, count, chars, t, ms]) => window.__fmt.waitFor(() => {
      if (window.__fmt.state.halt) return true; // the result is already complete (formatted on paste)
      const end = window.__fmt.io(k, s).tail(3);
      const text = end.text.replace(/\n$/, '');
      if (end.length !== null) return (end.length === chars || end.length === chars + 1) && text.endsWith(t);
      return (end.lines === count || (end.lines === count + 1 && end.text.endsWith('\n'))) && text.endsWith(t);
    }, ms),
    [adapter.input.kind, adapter.input.sel, lines.length, text.length, tail, timeoutMs],
  );
  return r.done ? r.checkedAt : null;
}

/** A person's pause between seeing the pasted text and clicking Format; not counted in the timing. */
export const CLICK_PAUSE_MS = 300;

const outputOf = (adapter) => (adapter.output === 'input' ? adapter.input : adapter.output);

/**
 * The timed action: select all, paste (Ctrl+V), press the format control, wait for the complete result.
 * `endMarker` is a string that only the end of the document holds. Returns times from the paste key press.
 */
export async function pasteAndFormat(page, adapter, { text, endMarker, timeoutMs, tap = false }) {
  const out = outputOf(adapter);
  await page.keyboard.press(`${MOD}+A`);
  await page.evaluate(() => window.__fmt.arm());
  const check = adapter.done ?? { kind: out.kind, sel: out.sel };
  const waiter = page.evaluate(
    ([c, marker, timeout]) => {
      const f = window.__fmt;
      // On success the check also sets state.halt, which ends a pending wait for the paste to land.
      const done = (ok) => (ok && (f.state.halt = true), ok);
      if (c.fn) {
        const fn = new Function('marker', c.fn).bind(null, marker);
        return f.waitFor(() => done(fn()), timeout);
      }
      return f.waitFor(() => {
        const end = f.io(c.kind, c.sel).tail(16);
        return done(end.multiline && end.text.includes(marker));
      }, timeout);
    },
    [check, endMarker, timeoutMs],
  );
  let finished = false;
  waiter.then(() => (finished = true), () => (finished = true));
  await page.keyboard.press(`${MOD}+V`);
  let landedAt = null;
  if (adapter.format) {
    landedAt = await landed(page, adapter, text, timeoutMs);
    if (!finished) await sleep(CLICK_PAUSE_MS);
  }
  // A tool that formats on paste may be done before the click: then there is nothing to click (protocol 5).
  if (adapter.format && !finished) {
    if (adapter.formatAction) {
      await adapter.formatAction(page, { tap }).catch((e) => {
        throw new Error('format control: ' + String(e.message).split('\n')[0]);
      });
    } else {
      const btn = await formatControl(page, adapter);
      await clickThrough(page, btn, { timeout: timeoutMs, tap }).catch((e) => {
        throw new Error('format control: ' + String(e.message).split('\n')[0]);
      });
    }
  }
  // A full-page ad can swallow the click (jsonviewer.stack.hu shows one on Format): a person closes it and presses
  // Format again. The time keeps running from the first click.
  if (adapter.format) {
    for (let tries = 0; tries < 3 && !finished; ) {
      await Promise.race([waiter, sleep(1500)]);
      if (finished) break;
      if (await dismissOverlay(page)) {
        tries++;
        if (!finished) {
          if (adapter.formatAction) await adapter.formatAction(page, { tap }).catch(() => {});
          else await clickThrough(page, await formatControl(page, adapter), { timeout: 10_000, tap }).catch(() => {});
        }
      } else if (!(await page.evaluate(() => 1).then(() => true, () => false))) break;
    }
  }
  const r = await waiter;
  const f = await page.evaluate(() => window.__fmt.disarm());
  // With a format control: (paste → pasted text in the input) + (click → complete result); the pause between is the
  // person's, not the tool's. An input that can't be read counts its paste as instant. Without one: paste → result.
  let ms = null;
  const formattedOnPaste = r.done && f.pasteAt !== null && (f.clickAt === null || f.clickAt > r.checkedAt);
  if (r.done && f.pasteAt !== null) {
    if (!adapter.format || formattedOnPaste) ms = r.at - f.pasteAt;
    else ms = (landedAt !== null ? Math.max(0, landedAt - f.pasteAt) : 0) + (r.at - f.clickAt);
  }
  return { done: r.done, ms, totalMs: r.done && f.pasteAt !== null ? r.at - f.pasteAt : null, freezeMs: f.maxGap, waitError: r.error ?? null, pasteSeen: f.pasteAt !== null, clickSeen: f.clickAt !== null, landedSeen: landedAt !== null, formattedOnPaste };
}

/** For the small cases: paste, format, then wait until the output stops changing (or an error shows). */
export async function pasteSmall(page, adapter, { text, settleMs = 600, timeoutMs = 10_000, onTick = null } = {}) {
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.press(`${MOD}+V`);
  if (text && adapter.format) {
    // A tool that reformats the input on paste never shows the text as pasted: give up waiting after 3 s.
    await landed(page, adapter, text, Math.min(timeoutMs, 3000));
    await sleep(CLICK_PAUSE_MS);
  } else await sleep(150);
  const press = async () => {
    if (adapter.formatAction) await adapter.formatAction(page, {});
    else if (adapter.format) await clickThrough(page, await formatControl(page, adapter), { timeout: 10_000 });
  };
  await press();
  if (adapter.format) {
    // A full-page ad that swallowed the click: close it and press again, as a person would.
    await sleep(800);
    if (await dismissOverlay(page)) await press();
  }
  const end = Date.now() + timeoutMs;
  let prev = null;
  let stableSince = Date.now();
  while (Date.now() < end) {
    await sleep(150);
    if (onTick) await onTick();
    const now = await readOutput(page, adapter).catch((e) => ({ error: e.message }));
    const key = JSON.stringify([now.text?.length, now.text?.slice(0, 200), now.text?.slice(-200), now.error]);
    if (key !== prev) (prev = key), (stableSince = Date.now());
    else if (Date.now() - stableSince >= settleMs) break;
  }
}

export async function readOutput(page, adapter) {
  const out = outputOf(adapter);
  if (adapter.readOutput) return { text: await adapter.readOutput(page) };
  return { text: await page.evaluate(([k, s]) => window.__fmt.io(k, s).value(), [out.kind, out.sel]) };
}

/** What the tool shows about an error: visible message text and the lines its editors mark. */
export async function readError(page, adapter) {
  if (adapter.readError) return adapter.readError(page);
  const sels = [].concat(adapter.error ?? []);
  const texts = [];
  for (const sel of sels) {
    for (const el of await page.locator(sel).all()) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const isBox = await el.evaluate((e) => e.matches('textarea, input')).catch(() => false);
      texts.push(((isBox ? await el.inputValue().catch(() => '') : await el.innerText().catch(() => '')) || '').trim().slice(0, 1500));
    }
  }
  const lines = await page
    .evaluate(
      ([a, b]) => [a, b].filter(Boolean).flatMap((x) => { try { return window.__fmt.io(x.kind, x.sel).markers(); } catch { return []; } }),
      [adapter.input, adapter.output === 'input' ? null : adapter.output],
    )
    .catch(() => []);
  // Only text that reads like an error report counts (a "Copied" toast or a "Valid JSON" badge does not).
  texts.push(...(page.__dialogs ?? []).map((m) => `[dialog] ${m}`));
  // Some tools write the error into the output pane instead of a message area: short text there that isn't JSON.
  if (adapter.output && adapter.output !== 'input' && !adapter.readOutput) {
    const shown = await page.evaluate(([k, s]) => { try { const v = window.__fmt.io(k, s).value(); return v.length < 1500 ? v : null; } catch { return null; } }, [adapter.output.kind, adapter.output.sel]).catch(() => null);
    if (shown && !/^\s*[[{"\d-]|^\s*(true|false|null)\s*$/.test(shown)) texts.push(shown.trim());
  }
  const kept = texts.filter((t) => ERRORISH.test(t) && !/^\s*(?:✓\s*)?valid json\.?\s*$/i.test(t));
  return { text: kept.join('\n').slice(0, 2000), lines: [...new Set(lines)] };
}

export const ERRORISH = /error|invalid|unexpected|expect|not allowed|not strict|not valid|missing|illegal|unterminated|unclosed|bad |fail|issue|problem|wrong|parse|syntax|\bln\s*\d|line\s*\d/i;

/** Line numbers a message names: "line 14", "Ln 14", "row 14", "(14:3)", "14:3". */
export function linesInText(text) {
  const out = new Set();
  for (const re of [/\bline\s*(?:no\.?|number|#|:)?\s*(\d+)/gi, /\bln\s*:?\s*(\d+)/gi, /\brow\s*:?\s*(\d+)/gi, /\(\s*(\d+)\s*:\s*\d+\s*\)/g, /\b(\d+):\d+\b/g]) {
    for (const m of text.matchAll(re)) out.add(Number(m[1]));
  }
  return [...out];
}

export async function shot(page, path) {
  await page.screenshot({ path, type: 'jpeg', quality: 55, timeout: 10_000 }).catch(() => {});
}

/**
 * Reads a tool's result through its own Copy control. First a sentinel is copied from a scratch text box with a real
 * Ctrl+C, then the tool's Copy control is clicked, then the clipboard is pasted back into the scratch box (trusted
 * keyboard copy and paste work in every engine without clipboard permissions). Still the sentinel: the copy failed.
 */
export async function copyOut(page, copySel) {
  const SENTINEL = '__fmt_sentinel__';
  const scratch = (value) =>
    page.evaluate((v) => {
      let t = document.getElementById('__fmt_scratch');
      if (!t) {
        t = document.createElement('textarea');
        t.id = '__fmt_scratch';
        t.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0.01;z-index:2147483647';
        document.body.append(t);
      }
      t.value = v;
      t.focus();
      t.select();
    }, value);
  await scratch(SENTINEL);
  await page.keyboard.press(`${MOD}+C`);
  await page.evaluate(() => document.getElementById('__fmt_scratch')?.remove());
  await page.locator(copySel).first().click({ timeout: 10_000 });
  // Copying tens of megabytes takes a while: paste again every second, for up to 30 s, until it has arrived.
  for (let waited = 0; waited <= 30_000; waited += 1000) {
    await sleep(waited ? 1000 : 400);
    await scratch('');
    await page.keyboard.press(`${MOD}+V`);
    await sleep(300);
    const text = await page.evaluate(() => {
      const t = document.getElementById('__fmt_scratch');
      const v = t.value;
      t.remove();
      return v;
    });
    if (text !== SENTINEL && text !== '') return text;
  }
  throw new Error('the Copy control did not put the result on the clipboard within 30 s');
}

/** Reads a tool's result through its own Download control (for results too big to pass through the clipboard). */
export async function downloadOut(page, sel) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator(sel).first().click({ timeout: 10_000 })]);
  const { readFile } = await import('node:fs/promises');
  return readFile(await download.path(), 'utf8');
}

/** Like window.__fmt.verify, for a result read in Node. */
export async function verifyText(text) {
  const { createHash } = await import('node:crypto');
  let min;
  try {
    min = JSON.stringify(JSON.parse(text));
  } catch {
    return { ok: false, why: 'output is not valid JSON', length: text.length };
  }
  return { ok: true, length: text.length, sha256: createHash('sha256').update(min).digest('hex') };
}
