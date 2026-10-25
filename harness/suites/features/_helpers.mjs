// Helpers shared by the feature suites (right-click menu, file drops, share links, /integrate, UI
// fixes, error screens). Every wait polls inside the page for a condition, never a fixed sleep.
import { mkdirSync, statSync, existsSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { DIRS } from '../../lib/env.mjs';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const SCALE = Number(process.env.HARNESS_TIMEOUT_SCALE || 1);

/**
 * How much slower than usual wall-clock times are right now: HARNESS_TIMEOUT_SCALE, times the CPU
 * oversubscription past 2 runnable tasks per core (load 40 on 4 cores makes a 100 ms task take ~1 s).
 * For checks of responsiveness ("no freeze longer than 400 ms"), which a shared, overloaded machine
 * would otherwise fail without the page doing anything wrong. 1 on a machine that isn't overloaded.
 */
export const loadScale = () => SCALE * Math.max(1, loadavg()[0] / availableParallelism());

/**
 * Chromium only: traces the page's renderer main thread until stop(), which returns its longest task,
 * in CPU time (`cpu`, what the page itself spent: the same on a busy machine) and wall time (`wall`).
 */
export async function traceTasks(page) {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['toplevel', 'devtools.timeline'] }, transferMode: 'ReportEvents' });
  return async function stop() {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end');
    await done;
    await cdp.detach().catch(() => {});
    const started = events.find((e) => e.name === 'TracingStartedInBrowser');
    const pid = started?.args?.data?.frames?.find((f) => f.frame === frameTree.frame.id)?.processId;
    const main = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && e.pid === pid);
    if (!main) return null;
    const tasks = events.filter((e) => e.ph === 'X' && e.name === 'RunTask' && e.pid === main.pid && e.tid === main.tid);
    const ms = (us) => Math.round((us ?? 0) / 1000);
    const byCpu = tasks.reduce((a, e) => ((e.tdur ?? 0) > (a?.tdur ?? -1) ? e : a), null);
    const byWall = tasks.reduce((a, e) => (e.dur > (a?.dur ?? -1) ? e : a), null);
    return { cpu: ms(byCpu?.tdur), wall: ms(byWall?.dur), tasks: tasks.length };
  };
}

/**
 * Waits until `fn(arg)` is truthy in the page and returns its value; on timeout returns the last value
 * instead of throwing, so the check that follows fails with the value as its detail.
 */
export async function until(page, fn, arg, { timeout = 10_000 } = {}) {
  try {
    const h = await page.waitForFunction(fn, arg, { timeout: timeout * SCALE, polling: 25 });
    return await h.jsonValue();
  } catch (e) {
    if (page.isClosed()) throw e;
    if (!/Timeout|timeout/.test(String(e))) throw e;
    return page.evaluate(fn, arg).catch(() => null);
  }
}

/** Same for a Node-side condition (an async function), polled every 25 ms. */
export async function poll(fn, { timeout = 10_000 } = {}) {
  const end = Date.now() + timeout * SCALE;
  let v;
  for (;;) {
    v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ── Documents ──────────────────────────────────────────────────────────────────────────────────

/** What the status bar's raw size shows for `text`, digits only (locale-independent). */
function sizeDigits(textOrBytes) {
  const b = typeof textOrBytes === 'number' ? textOrBytes : Buffer.byteLength(textOrBytes);
  const s = b < 1024 ? `${b}` : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) : (b / 1048576).toFixed(1);
  return s.replace(/\D/g, '');
}

/**
 * Replaces an editor's text as a paste does and waits until the tool has taken it in. For the input:
 * parsed (valid unless `valid: false`) with the new document's size in the status bar. For the Compare
 * editor (input2): its text is in.
 */
export async function setDoc(page, text, which = 'input', { valid = true, timeout = 20_000 } = {}) {
  await page.evaluate(
    ([t, w]) => {
      const ta = document.getElementById(w);
      ta.focus();
      ta.value = t;
      ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
    },
    [text, which],
  );
  if (which !== 'input') {
    return until(page, ([w, n]) => document.getElementById(w)?.value.length === n, [which, text.length], { timeout });
  }
  return waitLoaded(page, text, { valid, timeout });
}

/** Waits until the input holds a parsed document of `bytes` bytes (valid unless valid: false). */
export const waitLoaded = (page, textOrBytes, { valid = true, timeout = 30_000 } = {}) =>
  until(
    page,
    ([digits, valid]) => {
      const st = window.__vis('.sb-l');
      const s = st?.textContent ?? '';
      if (/^(Parsing|Ready)/.test(s) || s.includes('…')) return false;
      if (valid && !st.querySelector('.st.ok')) return false;
      const raw = (st.closest('.statusbar')?.querySelector('.sz-raw')?.textContent ?? '').replace(/\D/g, '');
      return raw === digits && s;
    },
    [sizeDigits(textOrBytes), valid],
    { timeout },
  );

/** Opens `text` as a file named `name` through the visible tool's Open file input and waits for it. */
export async function loadText(page, name, text, opts) {
  await page.locator('.app:visible input[type=file]').setInputFiles({ name, mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/json', buffer: Buffer.from(text) });
  return waitLoaded(page, text, opts);
}

/** The visible input editor's text (the textarea holds the whole document for small ones). */
export const inputText = (page, which = 'input') => page.evaluate((w) => document.getElementById(w).value, which);

// ── Clipboard (stubbed by the harness: writeText stores window.__clip) ─────────────────────────

/** Forgets the last copy, so a following waitClip sees only what comes next. */
export const resetClip = (page) => page.evaluate(() => (window.__clip = null));
/** The next copy (after resetClip), or null after the timeout. */
export const waitClip = (page, opts) => until(page, () => window.__clip, null, { timeout: 5000, ...opts });

/** What navigator.clipboard.readText returns from now on: text, or null for a refused read. */
export const setClipboardRead = (page, text) =>
  page.evaluate((t) => {
    window.__paste = t;
    navigator.clipboard.readText = async () => {
      if (window.__paste === null) throw new DOMException('no', 'NotAllowedError');
      return window.__paste;
    };
  }, text);

/** Records whether the browser's own menu was cancelled (registered after the engine's listener). */
export const watchContextMenu = (page) =>
  page.evaluate(() => {
    window.__prevented = undefined;
    window.addEventListener('contextmenu', (e) => (window.__prevented = e.defaultPrevented));
  });
export const prevented = (page) => page.evaluate(() => window.__prevented);

// ── Right-click menu ──────────────────────────────────────────────────────────────────────────

/**
 * The open menu: position, name, focus and items. An item reads "-Label" when disabled, "Label✓" when
 * checked, and "Label[Choice]" for a row of choices with the chosen one.
 */
export const menu = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.menu.ctx');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const a = document.activeElement;
    return {
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      right: r.right,
      bottom: r.bottom,
      label: m.getAttribute('aria-label'),
      open: m.matches(':popover-open'),
      focus: a === m ? 'menu' : (a?.querySelector('span')?.textContent ?? a?.textContent)?.trim().slice(0, 30),
      items: [...m.querySelectorAll('.mi')].map(
        (b) =>
          (b.disabled ? '-' : '') +
          (b.querySelector('span')?.textContent ?? '') +
          (b.getAttribute('aria-checked') === 'true' ? '✓' : '') +
          (b.classList.contains('mi-row') && b.querySelector('[aria-checked="true"]') ? '[' + [...b.querySelectorAll('[aria-checked="true"]')].map((x) => x.textContent).join() + ']' : ''),
      ),
      foot: m.querySelector('.mi-foot')?.textContent ?? null,
    };
  });

/** Waits for the menu to be open (want) or shut (!want); returns menu() then. */
export async function waitMenu(page, want = true, { timeout = 5000 } = {}) {
  await until(page, (w) => !!document.querySelector('.menu.ctx') === w, want, { timeout });
  return menu(page);
}

/** Right-clicks at a point and waits for the menu. */
export async function rightClick(page, x, y, { wait = true } = {}) {
  await page.mouse.click(x, y, { button: 'right' });
  return wait ? waitMenu(page) : null;
}

/** Right-clicks inside the visible element matching sel (at dx, dy from its corner; default its middle). */
export async function rightClickOn(page, sel, { i = 0, dx, dy, wait = true } = {}) {
  const r = await page.evaluate(
    ([s, i]) => {
      const el = i ? [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length)[i] : window.__vis(s);
      return el?.getBoundingClientRect().toJSON() ?? null;
    },
    [sel, i],
  );
  if (!r) return null;
  return rightClick(page, r.left + (dx ?? Math.min(80, r.width / 2)), r.top + (dy ?? r.height / 2), { wait });
}

/** Clicks a menu item by its whole label and waits for the menu to close. */
export async function pick(page, label) {
  await page.locator(`.menu.ctx .mi:has(> span:text-is("${label}"))`).first().click();
  await waitMenu(page, false);
}

/** Clicks one choice of a row of choices (Show levels 2, View → Diff, Share → Markdown…). */
export async function pickChoice(page, text) {
  await page.locator('.menu.ctx .mi-opts button, .menu.ctx [role=menuitemradio]', { hasText: text }).first().click();
  await waitMenu(page, false);
}

/** The input editor's box and the top-left of its text. */
export const edBox = (page, pane = '.pane-ed') =>
  page.evaluate((p) => {
    const r = window.__vis(`${p} .ed`).getBoundingClientRect();
    const b = window.__vis(`${p} .ed-body`).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, bx: b.left, by: b.top };
  }, pane);
/** Middle of line n of the input editor (10 px padding, 20 px lines). */
export const lineY = (box, n) => box.by + 10 + (n - 1) * 20 + 10;

/** The input textarea's [selectionStart, selectionEnd, focused]. */
export const taSel = (page, which = 'input') =>
  page.evaluate((w) => {
    const t = document.getElementById(w);
    return [t.selectionStart, t.selectionEnd, document.activeElement === t];
  }, which);

/** data-f of the fold pills in an area (input editor: '.pane-ed .ed-fold'; format view: '#view-format .cv-ph'). */
export const pills = (page, sel = '.pane-ed .ed-fold') => page.evaluate((s) => [...document.querySelectorAll(s)].filter((p) => p.getClientRects().length).map((p) => p.dataset.f), sel);

// ── Toasts ─────────────────────────────────────────────────────────────────────────────────────

/** Records every toast text the page shows from now on in window.__toasts. */
export const watchToasts = (page) =>
  page.evaluate(() => {
    const seen = (window.__toasts = []);
    const grab = () => {
      for (const t of document.querySelectorAll('.toast')) {
        const x = t.textContent.trim();
        if (seen[seen.length - 1] !== x) seen.push(x);
      }
    };
    grab();
    new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
/** The same from the page's first paint (an init script: toasts shown while the page loads count too). */
export const TOAST_RECORDER = () => {
  const seen = (window.__toasts = []);
  const grab = () => {
    for (const t of document.querySelectorAll('.toast')) {
      const x = t.textContent.trim();
      if (seen[seen.length - 1] !== x) seen.push(x);
    }
  };
  const start = () => new MutationObserver(grab).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  if (document.documentElement) start();
  else addEventListener('DOMContentLoaded', start);
};
/** Waits until a recorded toast matches re; returns all recorded toasts. */
export const waitToast = (page, re, opts) =>
  until(page, ([s, f]) => (window.__toasts || []).some((t) => new RegExp(s, f).test(t)) && window.__toasts, [re.source, re.flags], opts).then((v) => v || []);
/** Text of the toast on screen now. */
export const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].filter((t) => t.getClientRects().length).map((t) => t.textContent.trim()).join(' | '));

// ── Share links ────────────────────────────────────────────────────────────────────────────────

/** A document as a link fragment value (raw DEFLATE, base64url), as lib/link.ts writes it. */
export const enc = (s) => deflateRawSync(Buffer.from(s)).toString('base64url');
/** The document a share link carries in parameter k ('a' or 'b'). */
export const docOf = (url, k = 'a') => inflateRawSync(Buffer.from(new URLSearchParams(url.slice(url.indexOf('#') + 1)).get(k), 'base64url')).toString();
/** Where Chrome's and Edge's address bar cuts a pasted link (500 × 1024 characters). */
export const PASTED = 500 * 1024;

// ── Generated documents for these suites (kept next to the harness fixtures, never committed) ──

const DIR = join(DIRS.fixtures, 'features-v1');
mkdirSync(DIR, { recursive: true });
const GEN = {
  // A 5 MB one-line array that compresses to a ~520,000-character link: the user's document behind
  // the 512,000-character address-bar cut (selftest/filedrop/big5.json, regenerated byte for byte).
  'user-5mb.json': () => {
    const C = ['Zürich', '東京', 'القاهرة', 'תל אביב', 'मुंबई', 'São Paulo', 'Москва', '서울'];
    return JSON.stringify(
      Array.from({ length: 26000 }, (_, i) => ({ id: i, name: `User ${i}`, email: `user${i}@example.com`, city: C[i % 8], tags: ['alpha', 'beta', i % 3 ? 'gamma' : 'delta'], score: Math.round(i * 3.77 * 10) / 10, active: i % 2 === 0, note: 'The quick brown fox 🦊 jumps over the lazy dog' })),
    );
  },
  'small.json': () => '{\n  "from": "file",\n  "items": [1, 2, 3]\n}\n',
  'other.json': () => '{\n  "modified": true\n}\n',
  'people.csv': () => 'name,age\nAda,36\nAlan,41\n',
};
/** Path of one of the documents above, generated on first use. */
export function doc(name) {
  const file = join(DIR, name);
  if (!existsSync(file)) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, GEN[name]());
    renameSync(tmp, file);
  }
  return file;
}
export const docText = (name) => readFileSync(doc(name), 'utf8');
export const docSize = (name) => statSync(doc(name)).size;

// ── A second origin (for the handoff) ──────────────────────────────────────────────────────────

/** Serves `html` at http://127.0.0.1:<port>/ (another origin than the site); close() when done. */
export function serveHtml(html) {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    s.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }));
  });
}
