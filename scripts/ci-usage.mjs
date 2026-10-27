// GitHub Actions minutes for this repository: what this month's runs were billed, what's left of the
// 1,000-minute monthly budget (harness/CI.md), and the guard every job of .github/workflows/check.yml
// starts with. No dependencies.
//
//   pnpm ci:usage            this month's billed minutes, what's left, and what each kind of run costs
//   pnpm ci:usage --runs     also every run this month
//   node scripts/ci-usage.mjs --guard   (CI) fails the job when this run would take the month past the budget,
//                                       else writes what the job runs for the workflow's steps. The run is
//                                       CHECK_LEVEL, CHECK_ENGINES, CHECK_SUITES and CHECK_URL (check.yml's
//                                       inputs); CHECK_JOB_ENGINE in the per-engine jobs. perf.yml's runs are
//                                       level perf: CHECK_SUITES its checks (";"-separated), CHECK_PERF_MINUTES
//                                       what one of its jobs takes.
//
// The token is GITHUB_TOKEN or GH_TOKEN, else `gh auth token` for the repository's owner.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const BUDGET = 1000;
const ENGINES = ['chromium', 'firefox', 'webkit'];
const LEVELS = ['unit', 'quick', 'smoke', 'e2e', 'full', 'perf'];

// Minutes of each part of a job on GitHub's 2-core Linux runner, measured on PR #29's runs (October 2026);
// the browser sets are this machine's recorded test times on two slots, which the runner matched, plus 10 %.
// A suites filter is costed as the whole set: the guard runs before anything is installed, so it can't
// count the tests a filter matches. Each job is rounded up to a whole minute, like the bill.
const COST = {
  setup: 0.6, // job setup, checkout, this guard, pnpm and Node from the cache, pnpm install
  unit: 1.5, // unit tests, two files at a time
  quick: 2, // lint (~15 s), typecheck (~10 s), unit tests
  build: 1, // a production build without a cache (41 s), or restoring and saving the cached one
  variant: 0.6, // each further build variant (analytics mock, redeploy)
  browsers: { chromium: 0.4, firefox: 0.4, webkit: 0.7 }, // OS packages (12, 18, 34 s) and the browser download
  smoke: 0.4, // 18 smoke checks in Chromium
  suites: { chromium: 10, firefox: 11, webkit: 10.5 }, // every browser check except big documents, one engine
  perf: 12, // a perf.yml job past its setup: two builds and one check run for each (inputs.minutes overrides)
};

const { values: o } = parseArgs({ options: { guard: { type: 'boolean' }, runs: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
if (o.help) {
  console.log('pnpm ci:usage [--runs]   this month\'s GitHub Actions minutes against the 1,000-minute budget');
  process.exit(0);
}

/** What a check run does, from check.yml's inputs. The workflow's steps follow it (--guard writes it for them). */
function plan({ level = 'smoke', engines = 'chromium', suites = '', url = '', perfMinutes = '' }) {
  if (!LEVELS.includes(level)) throw new Error(`unknown level "${level}" (${LEVELS.join(', ')})`);
  if (level === 'perf') {
    // perf.yml: a job per engine and check, after a job that plans them.
    const list = [...new Set(engines.split(/[\s,]+/).filter(Boolean))];
    for (const e of list) if (!ENGINES.includes(e)) throw new Error(`unknown engine "${e}" (${ENGINES.join(', ')})`);
    const checks = suites.split(';').map((c) => c.trim()).filter(Boolean);
    if (!list.length || !checks.length) throw new Error('level perf needs engines and checks');
    return { level, engines: list, suites, url: '', code: null, split: false, checks: checks.length, minutes: Number(perfMinutes) || COST.perf };
  }
  const browsers = ['e2e', 'full'].includes(level);
  const list = level === 'smoke' ? ['chromium'] : browsers ? [...new Set(engines.split(/[\s,]+/).filter(Boolean))] : [];
  for (const e of list) if (!ENGINES.includes(e)) throw new Error(`unknown engine "${e}" (${ENGINES.join(', ')})`);
  if (browsers && !list.length) throw new Error(`level ${level} needs engines`);
  const code = url || level === 'e2e' ? null : level === 'unit' ? 'unit' : 'quick';
  // The whole functional set in several engines runs as one job per engine, after a job that builds.
  const split = browsers && !suites && list.length > 1;
  return { level, engines: list, suites, url, code, split };
}

function estimate(p) {
  if (p.level === 'perf') return Math.ceil(COST.setup) + p.engines.reduce((s, e) => s + p.checks * Math.ceil(COST.setup + COST.browsers[e] + p.minutes), 0);
  const builds = p.url || !p.engines.length ? 0 : COST.build + (p.level === 'smoke' ? 0 : COST.variant * (p.engines.includes('chromium') ? 2 : 1));
  const checks = (engines) => engines.reduce((s, e) => s + COST.browsers[e] + (p.level === 'smoke' ? COST.smoke : COST.suites[e]), 0);
  const jobs = [COST.setup + (p.code ? COST[p.code] : 0) + builds + (p.split ? 0 : checks(p.engines))];
  if (p.split) for (const e of p.engines) jobs.push(COST.setup + checks([e]));
  return jobs.reduce((s, m) => s + Math.ceil(m), 0);
}

/** The same checks on our own machine. */
function localCommand(p) {
  if (p.level === 'perf') return `pnpm perf ${p.suites.split(';').map((c) => JSON.stringify(c.trim())).join(' ')} --ref <ref> --base <base> -e ${p.engines}`;
  if (p.url) return `pnpm e2e ${p.level === 'smoke' ? '--smoke' : `${p.suites} -e ${p.engines}`} --url ${p.url}`.replace(/  +/g, ' ');
  const code = p.code === 'unit' ? `pnpm test ${p.suites}`.trim() : p.code ? 'pnpm lint && pnpm typecheck && pnpm test' : '';
  const e2e = !p.engines.length ? '' : p.level === 'smoke' ? 'pnpm e2e --smoke' : `pnpm e2e ${p.suites} -e ${p.engines}`.replace(/  +/g, ' ');
  return [code, e2e].filter(Boolean).join(' && ');
}

/** A run's plan from its name, "check · <level> · <engines> · <suites or all> · <ref, #PR or url>" (check.yml's run-name). */
function parseTitle(title) {
  const m = /^check · (\w+) · (.+?) · (.*) · (.*)$/.exec(title || '');
  try {
    return m && plan({ level: m[1], engines: m[2], suites: m[3] === 'all' ? '' : m[3], url: /^https?:/.test(m[4]) ? m[4] : '' });
  } catch {
    return null;
  }
}

// ── GitHub ──────────────────────────────────────────────────────────────────────────────────────
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(sh('git', ['remote', 'get-url', 'origin']));
  if (!m) throw new Error('origin is not a GitHub repository');
  return m[1];
}
const REPO = repository();
function token() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  // Other sessions may switch gh's active account: ask for the owner's token first.
  for (const args of [['auth', 'token', '--user', REPO.split('/')[0]], ['auth', 'token']]) {
    try {
      return sh('gh', args);
    } catch {}
  }
  throw new Error('no GitHub token: set GH_TOKEN or log in with gh auth login');
}
const TOKEN = token();

async function api(path) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'ci-usage' },
    });
    if (r.ok) return r.json();
    if (r.status >= 500 && attempt < 2) {
      await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub API ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

const minutes = (ms) => Math.ceil(Math.max(0, ms) / 60_000);

/**
 * Billed minutes of a run: each job's time on its runner, rounded up to a whole minute, as GitHub bills
 * Linux runners. (The run timing API's `billable` reports 0 ms for finished runs here, so it can't be used.)
 */
async function billed(run) {
  if (run.conclusion === 'skipped') return 0;
  let total = 0;
  for (let page = 1; ; page++) {
    const { jobs } = await api(`/actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${page}`);
    for (const j of jobs) if (j.started_at) total += minutes((j.completed_at ? Date.parse(j.completed_at) : Date.now()) - Date.parse(j.started_at));
    if (jobs.length < 100) return total;
  }
}

/** Every run since the 1st of this month (UTC) and its minutes; runs still going count their estimate. */
async function usage() {
  const now = new Date();
  const since = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const runs = [];
  for (let page = 1; ; page++) {
    const r = await api(`/actions/runs?created=%3E%3D${since}&per_page=100&page=${page}`);
    runs.push(...r.workflow_runs);
    if (r.workflow_runs.length < 100) break;
  }
  const self = process.env.GITHUB_RUN_ID;
  const todo = runs.filter((r) => String(r.id) !== self);
  const rows = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < todo.length) {
        const run = todo[next++];
        const done = run.status === 'completed';
        const p = done ? null : parseTitle(run.display_title);
        const used = await billed(run);
        rows.push({ run, minutes: p ? Math.max(used, estimate(p)) : used, pending: !done });
      }
    }),
  );
  rows.sort((a, b) => Date.parse(a.run.created_at) - Date.parse(b.run.created_at));
  return { month: now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), rows, used: rows.reduce((s, r) => s + r.minutes, 0) };
}

const n = (x) => x.toLocaleString('en-US');

// ── Guard (CI) ──────────────────────────────────────────────────────────────────────────────────
if (o.guard) {
  const env = process.env;
  const summary = (md) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
  let p;
  try {
    p = plan({ level: env.CHECK_LEVEL, engines: env.CHECK_ENGINES || 'chromium', suites: (env.CHECK_SUITES || '').trim(), url: (env.CHECK_URL || '').trim(), perfMinutes: env.CHECK_PERF_MINUTES });
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
  const cost = estimate(p);
  const local = `\`${localCommand(p)}\``;
  let u;
  try {
    u = await usage();
  } catch (e) {
    summary(`### Budget unknown: nothing ran\n\nThis month's Actions usage couldn't be read (${e.message}), so the ${n(BUDGET)}-minute budget can't be checked. Retry later, or run ${local} locally.`);
    console.log(`::error::Actions usage unreadable (${e.message}); run ${local} locally`);
    process.exit(1);
  }
  const after = u.used + cost;
  if (after > BUDGET) {
    summary(`### Budget reached: nothing ran\n\n${n(u.used)} of ${n(BUDGET)} billed minutes are used in ${u.month}, and this run needs about ${n(cost)} more. Run ${local} locally.`);
    console.log(`::error::budget reached: ${n(u.used)} of ${n(BUDGET)} minutes used in ${u.month}, this run needs ~${cost}; run ${local} locally`);
    process.exit(1);
  }
  summary(`Budget: ${n(u.used)} of ${n(BUDGET)} minutes used in ${u.month}, this run about ${n(cost)}, ${n(BUDGET - after)} left after it.`);
  console.log(`budget: ${n(u.used)} used in ${u.month} + ~${cost} for this run = ${n(after)} of ${n(BUDGET)}`);
  // What this job runs; the workflow's steps follow it. The first job builds for the per-engine jobs.
  const job = env.CHECK_JOB_ENGINE;
  const work = {
    CHECK_CODE: job ? '' : p.code || '',
    CHECK_BUILD: String(!p.url && (!!job || p.engines.length > 0)),
    CHECK_BUILD_ONLY: String(!job && p.split && !p.url),
    CHECK_RUN_ENGINES: job || (p.split ? '' : p.engines.join(',')),
    CHECK_ALL_ENGINES: p.engines.join(','),
  };
  console.log(Object.entries(work).map(([k, v]) => `${k}=${v}`).join(' '));
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, Object.entries(work).map(([k, v]) => `${k}=${v}\n`).join(''));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `split=${p.split}\nengines=${JSON.stringify(p.split ? p.engines : ['-'])}\n`);
  process.exit(0);
}

// ── Report (local) ──────────────────────────────────────────────────────────────────────────────
const u = await usage();
const pending = u.rows.filter((r) => r.pending);
console.log(`GitHub Actions for ${REPO}, ${u.month} (UTC)`);
console.log(`  ${n(u.used)} of ${n(BUDGET)} billed minutes used, ${n(Math.max(0, BUDGET - u.used))} left · ${u.rows.length} runs${pending.length ? ` (${pending.length} still going, counted at their estimate)` : ''}`);
if (o.runs)
  for (const { run, minutes: m, pending: p } of u.rows)
    console.log(`  ${String(m).padStart(4)}${p ? '~' : ' '} ${run.created_at.slice(0, 10)}  ${(run.conclusion || run.status).padEnd(10)} ${run.display_title}  ${run.html_url}`);
console.log('\nWhat a run costs (estimate, billed minutes):');
for (const [what, inputs] of [
  ['unit           unit tests', { level: 'unit' }],
  ['quick          lint, typecheck, unit tests', { level: 'quick' }],
  ['smoke          quick + build + smoke checks', { level: 'smoke' }],
  ['e2e firefox    every browser check in Firefox', { level: 'e2e', engines: 'firefox' }],
  ['e2e webkit     every browser check in WebKit', { level: 'e2e', engines: 'webkit' }],
  ['full           quick + every browser check, Chromium', { level: 'full', engines: 'chromium' }],
  ['full (ci:full) quick + every browser check, 3 engines', { level: 'full', engines: ENGINES.join(',') }],
  ['perf           one perf check A/B (perf.yml), one engine, 12-minute job', { level: 'perf', engines: 'chromium', suites: 'a check' }],
])
  console.log(`  ${String(estimate(plan(inputs))).padStart(4)}  ${what}`);
console.log('\nDispatch: gh workflow run check.yml -f level=<level> [-f engines=firefox,webkit] [-f suites="editor features"] [-f ref=<branch>]');
console.log('          gh workflow run perf.yml -f checks="<check>; <check>" -f ref=<branch> [-f base=main] [-f engines=chromium,firefox] [-f minutes=12]');
