// What suite files import. A suite is a module in harness/suites that calls test() at import time.
//
//   import { test, defaults } from '../lib/api.mjs';
//   defaults({ engines: 'all', tags: ['nav'] });            // for every test in this file
//   test('opens a 10 MB file', { tags: ['slow'] }, async (t) => {
//     await t.open('/');
//     await t.app.openFile(t.page, 'bench-10mb');
//     t.check(/^Valid JSON/.test(await t.app.waitValid(t.page)), 'loads');
//   });
//
// Test options (all optional):
//   engines   'all' | ['chromium', 'firefox', 'webkit']          default ['chromium']
//   tags      ['slow'] is left out unless --slow; ['perf'] runs only under `pnpm perf`; ['smoke'] is the quick set
//   page      false: no browser page (HTTP or Node-only checks)
//   mobile, dark, width, height, locale, serviceWorkers ('allow'), clipboard (false), launch, context
//             browser context settings, see browsers.mjs
//   variant   build variant from build.mjs VARIANTS (default 'default')
//   timeout   ms, default 60 000 (WebKit gets twice as long)
//   slots     how many of the run's parallel slots the test takes; 'all' runs it alone (big documents)
//   allowErrors   don't fail on page errors / console errors
//   rounds    perf: at most this many rounds (1 for deterministic measurements such as byte counts)
//   known     'PR #25: …': the whole test is known to fail on this code (a hang an open PR fixes); it is
//             reported as known instead of failing the run, and the report says when it passes again
const registry = [];
let current = null;

export function beginSuite(suite, file) {
  current = { suite, file, defaults: {} };
}

/** Options for every following test in this suite file. */
export function defaults(opts) {
  Object.assign(current.defaults, opts);
}

export function test(name, opts, fn) {
  if (typeof opts === 'function') [fn, opts] = [opts, {}];
  if (!current) throw new Error('test() called outside a suite file');
  const merged = { ...current.defaults, ...opts, tags: [...(current.defaults.tags || []), ...(opts.tags || [])] };
  registry.push({ id: `${current.suite} › ${name}`, suite: current.suite, name, opts: merged, fn, file: current.file });
}

export const registered = () => registry;
