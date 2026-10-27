// Helpers for the breaker suites: load any bytes as a file, wait until the tool has settled on them, and
// read every view's exact output (through the tool's own Copy commands where one exists, so the whole
// output is compared, not just the rows on screen). Golden outputs live in golden/<suite>/<case>.json;
// BREAKER_UPDATE=1 rewrites them from the run (Chromium only), review the diff before committing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../../lib/app.mjs';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const SCALE = Number(process.env.HARNESS_TIMEOUT_SCALE || 1);
const HERE = dirname(fileURLToPath(import.meta.url));
export const UPDATE = !!process.env.BREAKER_UPDATE;

/** Rough speed of each engine on big documents. */
export const SLOWNESS = { chromium: 1, firefox: 2, webkit: 2.5 };
export const slow = (t) => SLOWNESS[t.engine] || 1;

/** Waits until `fn(arg)` is truthy in the page and returns it; on timeout returns the last value (or null). */
export async function until(page, fn, arg, { timeout = 10_000, polling = 25 } = {}) {
  try {
    const h = await page.waitForFunction(fn, arg, { timeout: timeout * SCALE, polling });
    return await h.jsonValue();
  } catch (e) {
    if (page.isClosed() || !/timeout/i.test(String(e))) throw e;
    return page.evaluate(fn, arg).catch(() => null);
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

/** Digits of the status bar's raw size for `bytes` (locale-independent). */
export function sizeDigits(bytes) {
  const s = bytes < 1024 ? `${bytes}` : bytes < 1048576 ? (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) : (bytes / 1048576).toFixed(1);
  return s.replace(/\D/g, '');
}

/** What the page holds for a text: no leading BOM, LF line breaks. */
export const asLoaded = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/**
 * The visible tool's state once it has settled: not parsing, no "…", sizes not stale, and (when `raw`
 * is given, in bytes) the raw size shows it. Returns { msg, kind ('ok' | 'warn' | 'err'), raw, min, stats }
 * or null on timeout.
 */
export function settled(page, { raw = null, ready = false, timeout = 30_000 } = {}) {
  return until(
    page,
    ([digits, ready]) => {
      const sb = window.__vis('.statusbar');
      const st = window.__vis('.sb-l');
      const msg = st?.querySelector('.st');
      if (!msg) return null;
      const s = msg.textContent ?? '';
      // In progress: the parsing spinner, the "… min" placeholder, stale sizes. (An error message may hold
      // a "…" of its own: a long unexpected token is cut.)
      if (st.querySelector('.spin') || sb?.querySelector('.sizes.stale, .sizes .sz[aria-hidden="true"]')) return null;
      if (/^Ready/.test(s) && !ready) return null;
      const rawText = sb?.querySelector('.sz-raw')?.textContent ?? '';
      if (digits !== null && rawText.replace(/\D/g, '') !== digits) return null;
      // (Compressed sizes depend on the browser's codecs: Firefox adds brotli. They are left out.)
      return {
        msg: s,
        kind: msg.classList.contains('ok') ? 'ok' : msg.classList.contains('err') ? 'err' : msg.classList.contains('warn') ? 'warn' : '',
        raw: rawText,
        min: sb?.querySelector('.sz-min')?.textContent ?? null,
        stats: st.querySelector('.stats')?.textContent ?? null,
      };
    },
    [raw === null ? null : sizeDigits(raw), ready],
    { timeout },
  );
}

/** Starts recording every toast's text (window.__toasts), so a short-lived one is not missed. */
export const watchToasts = (page) =>
  page.evaluate(() => {
    window.__toasts = [];
    const seen = new WeakSet();
    const scan = () => {
      for (const el of document.querySelectorAll('.toast')) {
        const text = el.textContent.trim();
        if (text && !seen.has(el)) {
          seen.add(el);
          window.__toasts.push(text);
        }
      }
    };
    window.__toastObs?.disconnect();
    window.__toastObs = new MutationObserver(scan);
    window.__toastObs.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
/** Toasts recorded since watchToasts. */
export const seenToasts = (page) => page.evaluate(() => window.__toasts ?? []);

/** Opens bytes (string or Buffer) as a file named `name` through the visible tool's Open file input. */
export async function openBytes(page, name, data, mimeType = 'application/json') {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await page.locator('.app:visible input[type=file]').setInputFiles({ name, mimeType, buffer });
}

/** Clears the input (Clear editor) and waits for "Ready", so the next settled state is the next document's. */
export async function clear(page) {
  await command(page, 'Clear editor');
  await until(page, () => /^Ready/.test(window.__vis('.sb-l')?.textContent ?? '') || null, null, { timeout: 10_000 });
}

/** Opens bytes as `name` after clearing the input and waits until the tool settled on them (any raw size). */
export async function loadAny(page, data, name, { timeout = 30_000, mimeType, ready = false } = {}) {
  await clear(page);
  await watchToasts(page);
  await openBytes(page, name, data, mimeType);
  // (An empty file leaves "Ready": wait for its toast first.)
  if (ready) await until(page, () => (window.__toasts?.length ?? 0) > 0 || null, null, { timeout: 5000 });
  return settled(page, { timeout, ready });
}

/** Opens `text` as `name` and waits until the tool settled on it (raw size checked). */
export async function load(page, text, name = 'doc.json', { timeout = 30_000 } = {}) {
  await openBytes(page, name, text);
  return settled(page, { raw: Buffer.byteLength(asLoaded(text)), timeout });
}

/** The status bar's left text right now. */
export const status = (page) => page.evaluate(() => window.__vis('.sb-l')?.textContent ?? '');
/** The visible toasts' text. */
export const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].filter((t) => t.getClientRects().length).map((t) => t.textContent.trim()));
/** Waits for a toast matching `re`; returns its text or null. */
export const waitToast = (page, re, timeout = 10_000) =>
  until(page, ([s, f]) => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((x) => new RegExp(s, f).test(x)) || null, [re.source, re.flags], { timeout });

// ── Exact outputs ─────────────────────────────────────────────────────────────────────────────

/** Text a palette command copies (the clipboard is stubbed), or null when it copies nothing within `timeout`. */
export async function copied(page, label, { timeout = 15_000 } = {}) {
  await page.evaluate(() => (window.__clip = null));
  await command(page, label, { timeout });
  return until(page, () => window.__clip, null, { timeout });
}

/** The Format view's whole output (Copy formatted output). */
export const formatted = (page) => copied(page, 'Copy formatted output');
/** The input editor's whole text (Copy input to clipboard). */
export const inputText = (page) => copied(page, 'Copy input to clipboard');

/** Rows the tree draws (it draws only what is on screen): text of each treeitem, with its level. */
export const treeRows = (page) =>
  page.evaluate(() => [...(window.__vis('#view-tree')?.querySelectorAll('.tv-rows [role=treeitem]') ?? [])].map((r) => `${'  '.repeat(Number(r.getAttribute('aria-level')) - 1)}${r.textContent}`));

/** The table's header and drawn rows (cells joined by " | "). */
export const tableRows = (page) =>
  page.evaluate(() => {
    const t = window.__vis('#view-table');
    if (!t) return null;
    const empty = t.querySelector('.tb-empty');
    return {
      head: [...t.querySelectorAll('.tb-head [role=columnheader]')].map((x) => x.textContent),
      rows: [...t.querySelectorAll('.tb-rows [role=row]')].map((r) => [...r.children].map((c) => c.textContent).join(' | ')),
      empty: !!empty && !empty.hidden,
    };
  });

/** Selects a Convert target and returns its whole output (Copy converted output). */
export async function converted(page, target, { timeout = 30_000 } = {}) {
  const select = page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') });
  await select.first().selectOption(target);
  // The output for this target is drawn once the converter ran (it is lazy-loaded the first time).
  await until(page, () => !window.__vis('.pane-view .spin') && (window.__vis('#view-convert .cv-rows')?.textContent.length ?? 0) > 0, null, { timeout });
  return copied(page, 'Copy converted output', { timeout });
}

/** Runs `action` and returns the download's file name and bytes (Buffer), or null. */
export async function downloaded(page, action, { timeout = 30_000 } = {}) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: timeout * SCALE }).catch(() => null), action()]);
  if (!dl) return null;
  const path = await dl.path().catch(() => null);
  return { name: dl.suggestedFilename(), bytes: path ? readFileSync(path) : null };
}

/** Text of every <text> in an SVG (the graph's cards), in document order. */
export const svgTexts = (svg) => [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));

// ── Golden outputs ────────────────────────────────────────────────────────────────────────────

/**
 * Compares `actual` (any JSON value) with the golden value `golden/<suite>/<name>.json`. With BREAKER_UPDATE=1
 * a Chromium run writes it instead. Returns whether it matched; the check's detail names the first difference.
 */
export function golden(t, name, actual, what = name, opts = {}) {
  const file = join(HERE, 'golden', `${name}.json`);
  if (UPDATE && t.engine === 'chromium') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(actual, null, 1) + '\n');
    return t.check(true, what);
  }
  if (!existsSync(file)) return t.check(false, what, `no golden file ${name}.json (run with BREAKER_UPDATE=1 -e chromium)`);
  const want = JSON.parse(readFileSync(file, 'utf8'));
  const diff = firstDiff(want, actual);
  return t.check(!diff, what, diff, opts);
}

/** Path and values of the first difference between two JSON values, or null. */
export function firstDiff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    if (typeof a === 'string' && typeof b === 'string') {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      return `${path}: differs at char ${i}: want ${JSON.stringify(a.slice(Math.max(0, i - 30), i + 50))}, got ${JSON.stringify(b.slice(Math.max(0, i - 30), i + 50))} (lengths ${a.length}/${b.length})`;
    }
    return `${path}: want ${JSON.stringify(a)?.slice(0, 200)}, got ${JSON.stringify(b)?.slice(0, 200)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: want ${Array.isArray(a) ? 'array' : 'object'}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) return `${path}.${k}: unexpected ${JSON.stringify(b[k])?.slice(0, 200)}`;
    if (!(k in b)) return `${path}.${k}: missing (want ${JSON.stringify(a[k])?.slice(0, 200)})`;
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** "length:fnv1a" of a string (the same hash as app.hashText). */
export function hash(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return `${t.length}:${(h >>> 0).toString(16)}`;
}

// ── An independent formatter for expected outputs of big documents ──────────────────────────────

/**
 * Strict JSON `text` re-indented with `indent` ('' minifies), keeping every number, string and key
 * exactly as written (`canonical`: strings as JSON.stringify writes their value, as the app does): what the
 * Format view must show, computed without the app's code. Empty
 * containers stay `[]` / `{}`; a key is followed by ": " when indenting. Works on Buffers of any size
 * (returns a hash when `hashOnly`, so a 200 MB output never has to exist as one string).
 */
export function reformat(text, indent, { hashOnly = false, canonical = false } = {}) {
  const parts = [];
  let h = 0x811c9dc5;
  let len = 0;
  const put = (s) => {
    if (hashOnly) {
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
      len += s.length;
    } else parts.push(s);
  };
  const nl = (d) => (indent ? '\n' + indent.repeat(d) : '');
  let depth = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      // The app writes strings canonically (JSON.stringify of the decoded value: "\u0063" becomes "c").
      const lit = text.slice(i, j + 1);
      put(canonical && lit.includes('\\') ? JSON.stringify(JSON.parse(lit)) : lit);
      i = j + 1;
    } else if (c === '{' || c === '[') {
      // An empty container stays on one line.
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === (c === '{' ? '}' : ']')) {
        put(c === '{' ? '{}' : '[]');
        i = j + 1;
      } else {
        depth++;
        put(c + nl(depth));
        i++;
      }
    } else if (c === '}' || c === ']') {
      depth--;
      put(nl(depth) + c);
      i++;
    } else if (c === ',') {
      put(',' + nl(depth));
      i++;
    } else if (c === ':') {
      put(indent ? ': ' : ':');
      i++;
    } else if (c === ' ' || c === '\n' || c === '\r' || c === '\t') i++;
    else {
      let j = i;
      while (j < n && !/[\s,:\]}]/.test(text[j])) j++;
      put(text.slice(i, j));
      i = j;
    }
  }
  return hashOnly ? `${len}:${(h >>> 0).toString(16)}` : parts.join('');
}

// ── The shared heavy-document lock ──────────────────────────────────────────────────────────────

/**
 * Holds the host's heavy-document lock (flock on BREAKER_HEAVY_LOCK, e.g. ~/.cache/mem-work/heavy.lock)
 * until the test ends, so two big-document browsers never run at once on a shared machine. A no-op
 * without the variable (or when the whole run is already wrapped in `flock` on the same file: don't set
 * it then, a second flock on the file would wait for the first).
 */
export async function heavyLock(t) {
  const file = process.env.BREAKER_HEAVY_LOCK;
  if (!file) return;
  const { spawn } = await import('node:child_process');
  // -o: the lock stays with flock itself (not its child), so killing flock always releases it.
  const p = spawn('flock', ['-o', file, 'sh', '-c', 'echo locked; read x'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const release = () => {
    try {
      p.stdin.end();
    } catch {}
    p.kill('SIGKILL');
  };
  // Released with the test's pages, also when the test ends (or times out) while still waiting for it.
  t._extra.push({ context: { close: async () => release() }, errors: [] });
  process.once('exit', release);
  await new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => String(d).includes('locked') && resolve());
    p.on('error', reject);
    p.on('exit', (code) => reject(new Error(`flock exited (${code})`)));
  });
}
