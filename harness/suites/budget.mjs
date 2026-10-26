// First-load JavaScript stays within harness/budgets.json (gzip bytes per page). Exact and fast, so it
// runs with the smoke set on every change. After a deliberate change, update the file with
//   HARNESS_UPDATE_BUDGETS=1 pnpm e2e budget
// and commit it with the change, so the growth shows in the diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, test } from '../lib/api.mjs';
import { ROOT } from '../lib/env.mjs';
import { firstLoadJs } from '../lib/perf.mjs';

defaults({ tags: ['smoke', 'budget'], page: false, engines: ['chromium'] });

const FILE = join(ROOT, 'harness/budgets.json');
const PAGES = ['/', '/tools/json-validator', '/integrate', '/blogs/origin-of-json', '/privacy'];
// Room for noise-free but harmless churn (a renamed chunk hash, a tweaked string).
const SLACK_BYTES = 256;

test('first-load JavaScript per page stays within harness/budgets.json', async (t) => {
  let budgets = {};
  try {
    budgets = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {}
  const measured = {};
  const all = await Promise.all(PAGES.map((path) => firstLoadJs(t.fetch, t.base, path, { brotli: false })));
  for (const [i, path] of PAGES.entries()) {
    const m = all[i];
    measured[path] = m.gzip;
    t.log(`${path}: ${m.gzip} B gzip in ${m.files} files (budget ${budgets[path] ?? 'none'})`);
    if (!process.env.HARNESS_UPDATE_BUDGETS) t.check(budgets[path] != null && m.gzip <= budgets[path] + SLACK_BYTES, `${path}: ${m.gzip} B gzip within the budget of ${budgets[path]} B`, { measured: m.gzip, budget: budgets[path], over: budgets[path] == null ? null : m.gzip - budgets[path] });
  }
  if (process.env.HARNESS_UPDATE_BUDGETS) {
    writeFileSync(FILE, JSON.stringify(measured, null, 2) + '\n');
    t.log(`wrote ${FILE}`);
  }
});
