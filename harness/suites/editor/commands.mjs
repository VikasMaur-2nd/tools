// Every view and command from the palette on awkward documents (port of selftest/deep/cmds.mjs): each step
// must be found by the palette, run without page errors, and leave a status that settles (no hang, no size
// readout stuck at "…"). The in-place edits (minify, format, sort) must come back exactly with Undo.
import { defaults, test } from '../../lib/api.mjs';
import { installHelpers, slow, stepErrors, waitSettled } from './_helpers.mjs';

defaults({ engines: 'all', allowErrors: true, timeout: 240_000 });

const TARGETS = ['TypeScript', 'Zod schema', 'JSON Schema', 'C#', 'Dart', 'Java', 'Python (Pydantic)', 'Go', 'Kotlin', 'Swift', 'PHP', 'Rust (serde)', 'CSV', 'Excel (.xlsx)', 'YAML', 'XML', 'TOML', 'JSON Lines (NDJSON)'];
const STEPS = [
  'Output: minified', 'Output: pretty', 'Output: sort keys', 'Output: escaped JSON string', 'Output: pretty', 'Output: sort keys',
  'Copy formatted output', 'Download formatted output',
  'Tree view', 'Expand all', 'Collapse all', 'Expand to level 3', 'Expand all', 'find:a',
  'Table view', 'find:1', 'Graph view', 'Fit graph to screen', 'Go to the end of the graph', 'Download graph as SVG', 'Download graph as PNG',
  ...TARGETS.map((t) => 'JSON to ' + t), 'Copy converted output', 'Download converted output',
  'Compare (diff) two JSON documents', 'Close compare', 'Format view (formatted output)',
  'Collapse all in input', 'Expand all in input', 'Expand nested JSON string',
  'Minify input in place', 'Undo', 'Format input in place', 'Undo', 'Sort input keys A to Z', 'Undo',
  'Repair JSON', 'Escape: convert to a JSON string', 'Unescape: parse stringified JSON',
  'Export to Excel (.xlsx)', 'Copy share link',
];
/** In-place edits whose Undo (the next step) must give the document back exactly. */
const UNDONE = new Set(['Minify input in place', 'Format input in place', 'Sort input keys A to Z']);

/** Runs a palette command; false if the palette never offered it first. */
async function command(page, label, timeout) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const box = page.locator('.palette input');
  if (!(await box.waitFor({ state: 'visible', timeout }).then(() => true, () => false))) return 'the palette did not open';
  await box.fill(label);
  const top = await page
    .waitForFunction(
      (l) => {
        const id = document.querySelector('.palette input')?.getAttribute('aria-activedescendant');
        const text = id && document.getElementById(id)?.textContent;
        return text && text.toLowerCase().includes(l.toLowerCase()) && text;
      },
      label,
      { timeout, polling: 25 },
    )
    .then(() => null, () => page.evaluate(() => document.querySelector('.palette [role=option]')?.textContent ?? '(no options)'));
  if (top !== null) {
    await page.keyboard.press('Escape');
    return `the palette offers "${top.slice(0, 60)}" first`;
  }
  await page.keyboard.press('Enter');
  return null;
}

async function find(page, q, timeout) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');
  const ok = await page
    .waitForFunction(() => document.activeElement?.matches('.findbar input'), null, { timeout, polling: 25 })
    .then(() => true, () => false);
  if (!ok) return 'the find bar did not take focus';
  await page.keyboard.type(q);
  await page.keyboard.press('Enter');
  return null;
}

const DOCS = ['small-mix', 'mid-mix', 'lines', 'broken', 'mix-one-line', 'crlf-bom'];

for (const doc of DOCS) {
  test(`every command on ${doc}`, async (t) => {
    const { page } = t;
    const k = slow(t);
    const errs = stepErrors(t);
    page.on('download', (d) => d.cancel().catch(() => {}));
    await installHelpers(page);
    await t.open('/');
    await t.app.openFile(page, doc);
    const first = await waitSettled(page, { quiet: 300, timeout: 60_000 * k }).catch((e) => `TIMEOUT ${String(e).slice(0, 60)}`);
    t.log(`start | ${first.slice(0, 110)}`);
    t.assert(!/^TIMEOUT/.test(first), 'the document loads and its status settles', first);
    errs.check('open');
    let before = null;
    let edit = null;
    for (const step of STEPS) {
      const t0 = Date.now();
      if (UNDONE.has(step)) [before, edit] = [await t.app.docHash(page), step];
      const problem = step.startsWith('find:') ? await find(page, step.slice(5), 10_000 * k) : await command(page, step, 10_000 * k);
      if (!t.check(problem === null, `${step}: offered by the palette`, problem)) continue;
      const st = await waitSettled(page, { quiet: 250, timeout: 30_000 * k, empty: true }).catch(() => null);
      const ms = Date.now() - t0;
      t.check(st !== null, `${step}: the status settles (no hang, no "…" readout)`, (await t.app.status(page)).slice(0, 120));
      if (ms > 6000) t.log(`${step} took ${ms} ms | ${(st ?? '').slice(0, 100)}`);
      errs.check(step);
      if (step === 'Undo' && before) {
        const after = await t.app.docHash(page);
        t.check(after === before, `Undo after ${edit} restores the document exactly`, { before, after });
        before = null;
      }
    }
    const end = await waitSettled(page, { quiet: 1000, timeout: 30_000 * k, empty: true }).catch(() => 'TIMEOUT');
    t.log(`end | ${end.slice(0, 110)}`);
    t.check(end !== 'TIMEOUT', 'the status settles at the end', end);
    errs.done();
  });
}
