// Paths and process settings shared by every part of the harness. Import this before playwright-core:
// it points browsers, their profiles and temporary files at a cache the project owns.
import { existsSync, mkdirSync } from 'node:fs';
import { availableParallelism, homedir, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CI = !!process.env.CI;

/** Everything the harness keeps between runs: browsers, builds, fixtures, results. Safe to delete. */
export const CACHE = resolve(process.env.HARNESS_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tool-kumar-harness'));
export const DIRS = {
  browsers: process.env.PLAYWRIGHT_BROWSERS_PATH || join(CACHE, 'browsers'),
  builds: join(CACHE, 'builds'),
  fixtures: join(CACHE, 'fixtures'),
  results: join(CACHE, 'results'),
  // Browser profiles and downloads. Kept off /tmp, which is a small shared RAM disk on some hosts:
  // Chrome tabs crash with TARGET_CRASHED when it fills up.
  tmp: join(CACHE, 'tmp'),
};
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });

process.env.PLAYWRIGHT_BROWSERS_PATH = DIRS.browsers;
process.env.TMPDIR = DIRS.tmp;
// WebKit's GTK build stalls for seconds looking for an accessibility bus that headless hosts lack.
process.env.NO_AT_BRIDGE ??= '1';
process.env.GTK_A11Y ??= 'none';

export const CORES = availableParallelism();
export const load = () => loadavg()[0];

export const ENGINES = ['chromium', 'firefox', 'webkit'];
export const hasFile = (p) => existsSync(p);
