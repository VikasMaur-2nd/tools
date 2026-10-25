// Shared by the editor suites: the input editor's whole document (its "model"), drawn rows, caret placement
// by model offset, clipboard events, status waits, a browser of its own for real clipboard shortcuts, and
// the repo's own JSON formatter for expected outputs.
//
// The input editor has two modes: the native textarea (small documents) and the big-document editor (class
// `surface` on .ed: 250K+ characters, 30K+ lines or a 5,000+ character line), where the textarea holds only a
// passage. A loaded 100K–250K document first shows the quiet view (class `vmode`), which wakes on a click or
// key. Drawn rows are `.ed-hl [data-o]`, each with its model offset.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CACHE, DIRS, ROOT } from '../../lib/env.mjs';
import { command, hashText } from '../../lib/app.mjs';

export { hashText };

/** Rough speed of each engine on this kind of work (headless WebKit is 100–350 ms per key here). */
const SLOWNESS = { chromium: 1, firefox: 1.5, webkit: 3 };
export const slow = (t) => SLOWNESS[t.engine] || 1;

// ── The repo's formatter, compiled once per content hash ───────────────────────────────────────────

let ts = null;
const loaded = new Map();

/** Source files the entries need (relative imports, followed), as [path, text] sorted by path. */
function closure(entries) {
  const seen = new Map();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    const src = readFileSync(join(ROOT, rel), 'utf8');
    seen.set(rel, src);
    if (/from\s+['"]@\//.test(src)) throw new Error(`${rel}: "@/" imports are not supported by the editor suites' compiler`);
    for (const m of src.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const base = join(dirname(rel), m[1] || m[2]);
      const hit = [`${base}.ts`, join(base, 'index.ts'), base].find((c) => existsSync(join(ROOT, c)));
      if (hit) visit(hit);
    }
  };
  for (const e of entries) visit(e);
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * Modules of the repo (e.g. 'lib/json/format.ts'), transpiled with the repo's TypeScript into the harness
 * cache and required; returns their exports merged. The output folder is keyed by the sources' hash, so it
 * is built once per change (TypeScript only loads then) and never depends on `pnpm test` having run.
 */
export function repoModules(entries) {
  const id = entries.join('+');
  if (loaded.has(id)) return loaded.get(id);
  const req = createRequire(join(ROOT, 'package.json'));
  const files = closure(entries);
  const hash = createHash('sha256').update(JSON.parse(readFileSync(req.resolve('typescript/package.json'), 'utf8')).version);
  for (const [rel, src] of files) hash.update(`\0${rel}\0${src}`);
  const dir = join(CACHE, 'editor-js', hash.digest('hex').slice(0, 16));
  if (!existsSync(join(dir, '.done'))) {
    ts ||= req('typescript');
    const tmp = `${dir}.${process.pid}.tmp`;
    rmSync(tmp, { recursive: true, force: true });
    for (const [rel, src] of files) {
      const out = ts.transpileModule(src, {
        fileName: rel,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, isolatedModules: true },
      }).outputText;
      const file = join(tmp, rel.replace(/\.ts$/, '.js'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, out);
    }
    writeFileSync(join(tmp, 'package.json'), '{"type":"commonjs"}');
    writeFileSync(join(tmp, '.done'), '');
    try {
      renameSync(tmp, dir);
    } catch {
      rmSync(tmp, { recursive: true, force: true }); // another run got there first
    }
  }
  const load = createRequire(join(dir, 'package.json'));
  const mod = Object.assign({}, ...entries.map((e) => load(join(dir, e.replace(/\.ts$/, '.js')))));
  loaded.set(id, mod);
  return mod;
}

/** The repo's lossless parser and formatter. */
export const json = () => repoModules(['lib/json/parser.ts', 'lib/json/format.ts']);

/** True when the tool would call the text plain valid JSON (no repairs, not JSON Lines). */
export const strictOf = (ref) => !!(ref.root && !ref.error && !ref.issues.length && !ref.multi);

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────

let tmpN = 0;
/** Writes `text` to a temporary file (under the harness cache, not /tmp) and returns its path. */
export function tmpFile(text, name = 'doc.json') {
  const dir = join(DIRS.tmp, 'editor');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${process.pid}-${++tmpN}-${name}`);
  writeFileSync(file, text);
  return file;
}

/** A document as the page holds it: File.text() drops a leading BOM, the editor makes line breaks LF. */
export const asLoaded = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// ── A browser of its own ───────────────────────────────────────────────────────────────────────────

let isoN = 0;
/**
 * A page in a browser process of its own, closed after the test. Real Ctrl+C / Ctrl+X / Ctrl+V go through
 * the browser's clipboard, which every context of a browser process shares (checked in Chromium, Firefox and
 * WebKit): two tests doing shortcut bursts in the shared browser would paste each other's text.
 */
export async function isolatedPage(t, opts = {}) {
  const launch = { env: { ...process.env, TK_HARNESS_ISOLATE: `${process.pid}-${++isoN}-${Date.now()}` } };
  const p = await t.newPage({ ...opts, launch });
  // Closed with the test's other pages (the runner closes every extra page's context after the test).
  t._extra.push({ context: { close: () => p.browser.close() }, errors: [] });
  await installHelpers(p.page);
  return p;
}

// ── In-page helpers (window.__ed) ──────────────────────────────────────────────────────────────────

const PAGE_HELPERS = () => {
  const fnv = (t) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
    return `${t.length}:${(h >>> 0).toString(16)}`;
  };
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const ta = () => [...document.querySelectorAll('textarea#input')].find((x) => visible(x.closest('.ed'))) || document.getElementById('input');
  const ed = () => ta()?.closest('.ed');
  /** Text nodes of a drawn row that belong to the document (not fold markers, context or end-of-line marks). */
  const own = (n) => !n.parentElement.closest('.ctx, .ed-fold, .meol');
  const charBox = (off) => {
    const e = ed();
    const er = e.getBoundingClientRect();
    for (const row of e.querySelectorAll('.ed-hl [data-o]')) {
      let at = +row.dataset.o;
      const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!own(n)) continue;
        if (off >= at && off < at + n.length) {
          const rg = document.createRange();
          rg.setStart(n, off - at);
          rg.setEnd(n, off - at + 1);
          const b = rg.getClientRects()[0];
          if (!b || !b.width || b.top < er.top + 4 || b.bottom > er.bottom - 4 || b.left < er.left + 56 || b.right > er.right - 16) return null;
          const rb = row.getBoundingClientRect();
          window.__edPoint = { off, row: +row.dataset.o, rowRect: [rb.left, rb.top, rb.width, rb.height], glyph: [b.left, b.top, b.width, b.height] };
          return b;
        }
        at += n.length;
      }
    }
    return null;
  };
  /** What the editor puts on the clipboard for a copy of its selection (a synthetic copy event). */
  const copyEvent = () => {
    const d = new DataTransfer();
    const ce = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(ce, 'clipboardData', { value: d });
    ta().dispatchEvent(ce);
    return d.getData('text/plain');
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.ed-body')) window.__edPress = { x: e.clientX, y: e.clientY, at: e.timeStamp };
  }, { capture: true });
  window.__ed = {
    fnv,
    ta,
    ed,
    mode: () => {
      const e = ed();
      return { surface: e.classList.contains('surface'), quiet: e.classList.contains('vmode'), wrap: e.classList.contains('wrap') };
    },
    status: () => document.querySelector('.statusbar') && [...document.querySelectorAll('.statusbar')].find(visible)?.textContent,
    left: () => [...document.querySelectorAll('.sb-l')].find(visible)?.textContent ?? '',
    cursor: () => [...document.querySelectorAll('.statusbar .cursor')].find(visible)?.textContent.match(/Ln ([\d,]+), Col ([\d,]+)/)?.slice(1).map((x) => +x.replace(/,/g, '')) ?? null,
    copyEvent,
    nativeText: () => ta().value,
    // Model inspection uses the editor's own select-all and copy handlers. Running them in one task
    // keeps a polling read from sending shortcuts to a palette or tab that just took focus.
    modelText: () => {
      const t = ta();
      if (!ed().classList.contains('surface')) return t.value;
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true }));
      const text = copyEvent();
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true, cancelable: true }));
      return text;
    },
    /** Drawn rows: model offset, own text, and layout facts. */
    rows: () => {
      const e = ed();
      const er = e.getBoundingClientRect();
      return [...e.querySelectorAll('.ed-hl [data-o]')].map((row) => {
        let text = '';
        const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) if (own(n)) text += n.data;
        const b = row.getBoundingClientRect();
        return { o: +row.dataset.o, text, fold: !!row.querySelector('.ed-fold'), visible: b.bottom > er.top && b.top < er.bottom, over: row.scrollWidth > row.clientWidth + 2, rect: [b.left, b.top, b.width, b.height] };
      });
    },
    /** A point that puts the caret before (or after) the character at model offset `off`, or null when it isn't drawn in full. */
    point: (off, after) => {
      const b = charBox(off);
      if (!b) return null;
      return { x: after ? b.right - Math.min(2, b.width / 4) : b.left + Math.min(2, b.width / 4), y: b.top + b.height / 2 };
    },
    /**
     * A clipboard event at the editor's textarea; returns what the editor put on the clipboard. In the native
     * editor, the browser's own cut and paste, done the way it does them (the textarea, then input).
     */
    clip: (type, text = '') => {
      const t = ta();
      if (!t.closest('.ed').classList.contains('surface')) {
        const sel = t.value.slice(t.selectionStart, t.selectionEnd);
        if (type === 'copy') return sel;
        const ce = new ClipboardEvent(type, { bubbles: true, cancelable: true });
        const d = new DataTransfer();
        if (type === 'paste') d.setData('text/plain', text);
        Object.defineProperty(ce, 'clipboardData', { value: d });
        // (The editor handles big pastes itself; otherwise the browser would insert the text.)
        if (!t.dispatchEvent(ce)) return sel;
        t.setRangeText(type === 'paste' ? text : '', t.selectionStart, t.selectionEnd, 'end');
        t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type === 'paste' ? 'insertFromPaste' : 'deleteByCut' }));
        return sel;
      }
      const d = new DataTransfer();
      if (type === 'paste') d.setData('text/plain', text);
      const ce = new ClipboardEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ce, 'clipboardData', { value: d });
      t.dispatchEvent(ce);
      return d.getData('text/plain');
    },
    /** Clicks the visible output-pane Copy button (no focus change) and clears the stubbed clipboard first. */
    copyOutput: () => {
      window.__clip = null;
      const b = [...document.querySelectorAll('button[aria-label="Copy"]')].filter(visible).pop();
      b?.click();
      return !!b;
    },
    clipHash: () => (window.__clip == null ? null : fnv(window.__clip)),
  };
};

/** Installs window.__ed in the page now and on every later load. */
export async function installHelpers(page) {
  if (page.__edHelpers) return;
  page.__edHelpers = true;
  await page.context().addInitScript(PAGE_HELPERS);
  await page.evaluate(PAGE_HELPERS).catch(() => {});
}

// ── The editor ─────────────────────────────────────────────────────────────────────────────────────

export const edMode = (page) => page.evaluate(() => window.__ed.mode());
export const statusText = (page) => page.evaluate(() => window.__ed.status() ?? '');
export const leftText = (page) => page.evaluate(() => window.__ed.left());
export const cursor = (page) => page.evaluate(() => window.__ed.cursor());
export const rows = (page) => page.evaluate(() => window.__ed.rows());

/**
 * The whole model, through the editor's own copy of a select-all (the big-document editor), or the
 * textarea (the native one; these checks fold nothing). Like the old checks, a select-all then ArrowLeft:
 * the caret ends at the start in the big-document editor.
 */
export async function model(page) {
  if ((await edMode(page)).quiet) return quietText(page);
  return page.evaluate(() => window.__ed.modelText());
}

/** As model(), but only "length:hash" crosses over for big documents. */
export async function modelHash(page) {
  if ((await edMode(page)).quiet) return hashText(await quietText(page));
  return page.evaluate(() => window.__ed.fnv(window.__ed.modelText()));
}

/** The quiet view keeps the textarea empty: read the document through the tool's Copy input command. */
async function quietText(page) {
  await page.evaluate(() => (window.__clip = null));
  await command(page, 'Copy input to clipboard');
  const h = await page.waitForFunction(() => window.__clip !== null && { text: window.__clip }, null, { timeout: 30_000, polling: 25 });
  return (await h.jsonValue()).text;
}

/** Polls the editor's model until it matches the predicted document. */
export async function waitModel(page, want, { timeout = 15_000 } = {}) {
  const t0 = Date.now();
  if ((await edMode(page)).quiet) await focusEditor(page, { timeout });
  const ok = await page.waitForFunction(
    (hash) => window.__ed.fnv(window.__ed.modelText()) === hash,
    hashText(want),
    { timeout, polling: 25 },
  ).then(() => true, () => false);
  return { ok, ms: Date.now() - t0 };
}

/** Where two strings first differ, with a little context, for failure details. */
export function firstDiff(got, want, ctx = 20) {
  let i = 0;
  while (i < got.length && i < want.length && got[i] === want[i]) i++;
  return { len: [got.length, want.length], at: i, got: JSON.stringify(got.slice(Math.max(0, i - ctx), i + ctx)), want: JSON.stringify(want.slice(Math.max(0, i - ctx), i + ctx)) };
}

/** Line and column (1-based) of model offset `off`, as the status bar shows them. */
export function lineCol(t, off) {
  const ln = t.slice(0, off).split('\n').length;
  const col = off - (t.lastIndexOf('\n', off - 1) + 1) + 1;
  return [ln, col];
}

/** Waits until the status bar's caret reads [ln, col]; returns the last reading. */
export async function waitCursor(page, want, { timeout = 2000 } = {}) {
  const ok = await page
    .waitForFunction(([l, c]) => {
      const at = window.__ed.cursor();
      return at && at[0] === l && at[1] === c;
    }, want, { timeout, polling: 25 })
    .then(() => true, () => false);
  return ok ? want : cursor(page);
}

/**
 * Drawn rows once they show `t` and stopped moving (two equal readings in a row): a render or a scroll
 * after the last action may still be on its way. Returns the rows (the last reading after `timeout`).
 */
export async function stableRows(page, t, { timeout = 3000 } = {}) {
  await page.evaluate(() => { window.__rowsBefore = null; });
  const h = await page.waitForFunction((text) => {
    const rs = window.__ed.rows();
    const key = JSON.stringify(rs.map((r) => [r.o, r.text, r.visible, r.rect]));
    const matches = text === null || rs.every((r) => text.slice(r.o, r.o + r.text.length) === r.text);
    const done = matches && document.fonts.status === 'loaded' && key === window.__rowsBefore;
    window.__rowsBefore = matches ? key : null;
    return done && rs;
  }, t, { timeout, polling: 25 }).catch(() => null);
  return h ? h.jsonValue() : rows(page);
}

/**
 * Waits until the status bar has settled: no "Parsing…", no "…" readout, no size measurement on its way, and
 * the same text for `quiet` ms (an analysis starts up to 500 ms after an edit and shows no "Parsing…" under
 * 1 MB, so a settled status right after an edit may still be the old one). Returns the left part's text.
 */
export async function waitSettled(page, { quiet = 1000, timeout = 60_000, empty = false } = {}) {
  await page.evaluate(() => (window.__settle = null));
  const h = await page.waitForFunction(
    ([quiet, empty]) => {
      const sb = [...document.querySelectorAll('.sb-l')].find((e) => e.getClientRects().length);
      if (!sb) return false;
      const t = sb.textContent;
      const done = !/^Parsing/.test(t) && (empty || !/^Ready/.test(t)) && !t.includes('…') && !sb.querySelector('.sizes.stale');
      const w = (window.__settle ||= { t: null, at: 0 });
      const now = performance.now();
      if (!done || t !== w.t) {
        w.t = done ? t : null;
        w.at = now;
        return false;
      }
      return now - w.at >= quiet && t;
    },
    [quiet, empty],
    { timeout, polling: 25 },
  );
  await page.evaluate(() => (window.__settle = null));
  return h.jsonValue();
}

/** Status stats ("N nodes · depth D") as numbers, or null. */
export function statsOf(status) {
  const m = status.match(/([\d,]+) nodes? · depth (\d+)/);
  return m ? { nodes: +m[1].replace(/,/g, ''), depth: +m[2] } : null;
}

/**
 * Waits until the Format output (copied with the output pane's Copy button) has hash `want`. A huge output can
 * take a while to update. Returns { ok, got, ms }.
 */
export async function waitOutput(page, want, { timeout = 30_000 } = {}) {
  const t0 = Date.now();
  await page.evaluate(() => { window.__outputPoll = { pending: false, got: null }; });
  const ok = await page.waitForFunction((hash) => {
    const poll = window.__outputPoll;
    if (poll.pending && window.__clip === null) poll.pending = false;
    if (poll.pending) {
      poll.got = window.__ed.clipHash();
      poll.pending = false;
      if (poll.got === hash) return true;
    }
    poll.pending = window.__ed.copyOutput();
    return false;
  }, want, { timeout, polling: 25 }).then(() => true, () => false);
  const got = await page.evaluate(() => window.__outputPoll.got);
  return { ok, got, ms: Date.now() - t0 };
}

/** The Format output's text (copied with the output pane's Copy button). */
export async function outputText(page, { timeout = 30_000 } = {}) {
  await page.evaluate(() => window.__ed.copyOutput());
  return page.waitForFunction(() => window.__clip, null, { timeout, polling: 25 }).then((h) => h.jsonValue(), () => null);
}

/** Clicks into the input editor (waking the quiet view) and waits until it is editable. */
export async function focusEditor(page, { x = 220, y = 140, timeout = 15_000 } = {}) {
  const box = await page.evaluate(() => {
    const b = window.__ed.ed().getBoundingClientRect();
    return { x: b.left, y: b.top };
  });
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForFunction(() => !window.__ed.mode().quiet, null, { timeout, polling: 25 });
}

/** Waits until the big-document editor has taken over (its module may still be loading). */
export const waitSurface = (page, { timeout = 15_000 } = {}) =>
  page.waitForFunction(() => window.__ed.mode().surface, null, { timeout, polling: 25 }).then(() => true, () => false);

/** Dispatches a synthetic paste of `text` (kept in the page as window[key], so big texts never cross over). */
export const pasteStored = (page, key, { prefix = '', whole = false } = {}) =>
  page.evaluate(
    ([key, prefix, whole]) => {
      const ta = window.__ed.ta();
      if (whole) {
        ta.focus();
        ta.select();
      }
      const dt = new DataTransfer();
      dt.setData('text/plain', prefix + window[key]);
      const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: dt });
      (document.activeElement && document.activeElement !== document.body ? document.activeElement : ta).dispatchEvent(e);
    },
    [key, prefix, whole],
  );

/**
 * Wraps t.check for a sequence of steps: page errors that appeared since the last call are a failed check
 * named after the step (the test sets allowErrors and calls `done()` at the end for any left over).
 */
export function stepErrors(t, ignore = /$^/) {
  let seen = 0;
  const all = () => [...t.errors, ...t._extra.flatMap((p) => p.errors)].filter((e) => !ignore.test(e));
  return {
    check(step) {
      const errs = all();
      const fresh = errs.slice(seen);
      seen = errs.length;
      return t.check(!fresh.length, `${step}: no page errors`, fresh.slice(0, 3));
    },
    done: () => t.check(all().length === seen, 'no page errors', all().slice(seen, seen + 3)),
  };
}

/** Deletes temporary files when the test ends (pass or fail). */
export async function withTmp(fn) {
  const files = [];
  try {
    return await fn((text, name) => {
      const f = tmpFile(text, name);
      files.push(f);
      return f;
    });
  } finally {
    for (const f of files) rmSync(f, { force: true });
  }
}
