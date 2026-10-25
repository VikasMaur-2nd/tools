// Helpers that know Tool Kumar's page: waiting for the tool, loading documents, running commands,
// reading the status bar. Every wait polls inside the page for a condition, never a fixed sleep.
//
// Next.js keeps up to three pages you left in the DOM, hidden (cacheComponents + React Activity), so a
// page can hold several tools. Helpers here act on the visible one.
import { fixture } from './fixtures.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// In the page, window.__vis(sel) is the visible element matching sel (installed by browsers.mjs).

/** Engines started on this page so far (the tool remounts on every client navigation back to it). */
export const engineCount = (page) => page.evaluate(() => performance.getEntriesByName('tk:engine').length);

/**
 * Waits until the tool's engine has started more than `after` times. Builds older than the mark
 * (window.__tkLegacy, set by the runner) get the old rule instead: page loaded, editor present, 1.5 s.
 */
export async function waitEngine(page, { after = 0, timeout = 30_000 } = {}) {
  await page.waitForFunction(
    (n) => {
      if (performance.getEntriesByName('tk:engine').length > n) return true;
      if (!window.__tkLegacy || document.readyState !== 'complete' || !window.__vis('#input')) return false;
      window.__tkSince ??= performance.now();
      if (performance.now() - window.__tkSince < 1500) return false;
      window.__tkSince = undefined;
      return true;
    },
    after,
    { timeout, polling: 25 },
  );
}

/**
 * Opens `path` and, on pages with the tool, waits until it answers input.
 * Returns the response. `tool: false` for pages without the JSON tool.
 */
export async function open(page, base, path = '/', { tool = true, timeout = 30_000 } = {}) {
  const res = await page.goto(base + path, { waitUntil: tool ? 'commit' : 'load', timeout });
  if (tool) await waitEngine(page, { timeout });
  return res;
}

/** Text of the visible status bar's left part ("Valid JSON · 1.2 MB …", "Parsing… 40 %", "Ready"). */
export const status = (page) => page.evaluate(() => window.__vis('.sb-l')?.textContent ?? '');

/** Waits for the status to match `re`; returns it. */
export async function waitStatus(page, re, { timeout = 60_000 } = {}) {
  const handle = await page.waitForFunction(
    ([src, flags]) => {
      const t = window.__vis('.sb-l')?.textContent ?? '';
      return new RegExp(src, flags).test(t) && t;
    },
    [re.source, re.flags],
    { timeout, polling: 25 },
  );
  return handle.jsonValue();
}

/** Waits until the document is parsed and valid (JSON or JSON Lines). */
export const waitValid = (page, opts) => waitStatus(page, /^(?:Valid JSON|JSON Lines)(?!.*…)/, opts);
/** Waits until parsing finished, valid or not. */
export const waitParsed = (page, opts) => waitStatus(page, /^(?!Parsing)(?!Ready)(?!.*…)./, opts);

/** Replaces the text of an editor the way a paste does (fine for documents up to ~200 KB). */
export async function setText(page, text, which = 'input') {
  await page.evaluate(
    ([t, w]) => {
      const ta = document.getElementById(w);
      ta.focus();
      ta.value = t;
      ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
    },
    [text, which],
  );
}

/** A real paste event with `text` on the focused editor (the path Ctrl+V takes, without the clipboard). */
export async function paste(page, text, which = 'input') {
  await page.evaluate(
    ([t, w]) => {
      const ta = document.getElementById(w);
      ta.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt }); // Firefox drops it
      ta.dispatchEvent(ev);
    },
    [text, which],
  );
}

/** Opens a fixture (by name) or a file (by absolute path) through the tool's file input, like Open file. */
export async function openFile(page, nameOrPath) {
  const file = nameOrPath.startsWith('/') ? nameOrPath : fixture(nameOrPath);
  const input = page.locator('.app:visible input[type=file]');
  await input.setInputFiles(file);
  return file;
}

/** Runs a command from the command palette by its label, e.g. 'Copy input to clipboard'. */
export async function command(page, label) {
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${MOD}+k`);
  const box = page.locator('.palette input');
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  await box.fill(label);
  await page.waitForFunction(
    (l) => {
      const id = document.querySelector('.palette input')?.getAttribute('aria-activedescendant');
      return id && document.getElementById(id)?.textContent.toLowerCase().includes(l.toLowerCase());
    },
    label,
    { timeout: 10_000, polling: 25 },
  );
  await page.keyboard.press('Enter');
}

/** Clipboard text the page wrote last (the clipboard is stubbed: see browsers.mjs). */
export const clipboard = (page) => page.evaluate(() => window.__clip);

/**
 * "length:fnv1a" of an editor's whole document, read through the tool's own Copy command, so it works
 * for documents of any size and any editor mode.
 */
export async function docHash(page, which = 'input', { timeout = 30_000 } = {}) {
  await page.evaluate(() => (window.__clip = null));
  await command(page, which === 'input' ? 'Copy input to clipboard' : 'Copy modified JSON');
  const h = await page.waitForFunction(
    () => {
      const t = window.__clip;
      if (t == null) return null;
      let h = 0x811c9dc5;
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
      return `${t.length}:${(h >>> 0).toString(16)}`;
    },
    null,
    { timeout, polling: 50 },
  );
  return h.jsonValue();
}

/** Same hash as docHash, computed in Node for a string. */
export function hashText(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return `${t.length}:${(h >>> 0).toString(16)}`;
}

export const VIEWS = ['format', 'tree', 'table', 'graph', 'convert', 'compare'];

/**
 * Switches the output view and waits until its panel shows. Narrow output panes (phones, the three
 * columns of Compare) show a dropdown instead of the tabs; both are handled.
 */
export async function view(page, name, { timeout = 30_000 } = {}) {
  const tab = page.locator(`.app:visible [role=tab][aria-controls="view-${name}"]:visible`);
  if (await tab.count()) await tab.first().click();
  else await page.locator('.app:visible .tabs-pick select:visible').first().selectOption(name);
  await page.waitForFunction(
    (n) => {
      const panel = window.__vis(`#view-${n}`);
      return !!panel && !panel.hidden;
    },
    name,
    { timeout, polling: 25 },
  );
}

/** Text of the visible element matching `sel`. */
export const text = (page, sel) => page.evaluate((s) => window.__vis(s)?.textContent ?? null, sel);

/** Current pathname (hidden Activity pages keep their DOM, so check where you are before asserting). */
export const where = (page) => page.evaluate(() => location.pathname);

/** Clicks the visible link to `href` and waits for the URL (a client navigation). */
export async function navigate(page, href, { timeout = 60_000 } = {}) {
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForURL(`**${href}`, { timeout });
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
