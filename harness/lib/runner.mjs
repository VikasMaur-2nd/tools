// Runs jobs (test × engine × target) on a pool of parallel slots, longest first, using each test's
// duration from earlier runs, so the run ends when its longest chain does instead of on a straggler.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import * as app from './app.mjs';
import { openPage } from './browsers.mjs';
import { CORES, DIRS } from './env.mjs';
import { fixture, fixtureText } from './fixtures.mjs';

const DURATIONS = join(DIRS.results, 'durations.json');
const TIMEOUT_SCALE = Number(process.env.HARNESS_TIMEOUT_SCALE || 1);
const ENGINE_SLOWNESS = { chromium: 1, firefox: 1.5, webkit: 2 };

let durations = {};
try {
  durations = JSON.parse(readFileSync(DURATIONS, 'utf8'));
} catch {}

export const jobKey = (job) => `${job.test.id} [${job.engine}]`;
const expected = (job) => durations[jobKey(job)] ?? 5000 * (ENGINE_SLOWNESS[job.engine] || 1);

class Failure extends Error {}

/** The object a test function receives. */
function context(job, target, outDir) {
  const checks = [];
  const metrics = {};
  const extra = [];
  const t = {
    engine: job.engine,
    base: target.base,
    target,
    app,
    fixture,
    fixtureText,
    page: null,
    context: null,
    errors: [],
    checks,
    metrics,
    outDir,
    /** Opens a path of the target and (unless tool: false) waits for the tool. */
    open: (path = '/', opts) => app.open(t.page, target.base, path, opts),
    /**
     * A soft check: the test goes on and fails at the end. Returns cond. `{ known: 'why' }` marks a
     * failure that is already tracked (an open PR fixes it): reported, but the test doesn't fail.
     */
    check(cond, what, detail, { known } = {}) {
      checks.push({ ok: !!cond, what, detail: cond ? undefined : detail, known: known || undefined });
      return !!cond;
    },
    /** A hard check: stops the test. */
    assert(cond, what, detail) {
      if (!t.check(cond, what, detail)) throw new Failure(what);
    },
    /** Records a measurement (perf). Several values per name are kept. */
    metric(name, value, unit = 'ms') {
      (metrics[name] ||= { unit, values: [] }).values.push(value);
    },
    /**
     * A time budget for responsiveness checks, stretched on an overloaded machine (load above the core
     * count) and by HARNESS_TIMEOUT_SCALE, so a busy host doesn't fail checks that a real bug still trips.
     */
    budget: (ms) => ms * TIMEOUT_SCALE * Math.max(1, loadavg()[0] / CORES),
    log: (...a) => job.logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    /** Another page in a new context of the same browser; closed after the test. */
    async newPage(opts = {}) {
      const p = await openPage(job.engine, { ...job.test.opts, ...opts });
      extra.push(p);
      return p;
    },
    _extra: extra,
  };
  return t;
}

async function runOne(job, target, outDir) {
  const { test, engine } = job;
  const o = test.opts;
  const t = context(job, target, outDir);
  const t0 = performance.now();
  let error = null;
  let pageSet = null;
  const timeout = (o.timeout || 60_000) * (ENGINE_SLOWNESS[engine] > 1.5 ? 2 : 1) * TIMEOUT_SCALE;
  let timer;
  try {
    if (o.page !== false) {
      pageSet = await openPage(engine, o);
      Object.assign(t, { page: pageSet.page, context: pageSet.context, errors: pageSet.errors });
    }
    await Promise.race([
      test.fn(t),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timed out after ${Math.round(timeout / 1000)} s`)), timeout);
      }),
    ]);
  } catch (e) {
    error = e instanceof Failure ? null : e;
    if (error) t.checks.push({ ok: false, what: 'threw', detail: String(error.stack || error).split('\n').slice(0, 4).join('\n') });
  } finally {
    clearTimeout(timer);
  }
  const extraErrors = t._extra.flatMap((p) => p.errors);
  const errs = [...t.errors, ...extraErrors];
  if (errs.length && !o.allowErrors) t.checks.push({ ok: false, what: 'no page errors', detail: errs.slice(0, 5) });
  const failed = t.checks.filter((c) => !c.ok && !c.known);
  const known = t.checks.filter((c) => !c.ok && c.known);
  const knownFixed = t.checks.filter((c) => c.ok && c.known);
  let shot = null;
  if (failed.length && pageSet && !pageSet.page.isClosed()) {
    shot = join(outDir, `${test.id.replace(/[^\w.-]+/g, '_')}-${engine}.png`);
    await pageSet.page.screenshot({ path: shot, timeout: 5000 }).catch(() => (shot = null));
  }
  await Promise.all([pageSet, ...t._extra].filter(Boolean).map((p) => p.context.close().catch(() => {})));
  return {
    id: test.id,
    engine,
    target: target.name,
    status: failed.length ? 'fail' : 'pass',
    ms: Math.round(performance.now() - t0),
    checks: t.checks.length,
    failures: failed,
    known: known.map((c) => ({ what: c.what, known: c.known, detail: c.detail })),
    knownFixed: knownFixed.map((c) => ({ what: c.what, known: c.known })),
    metrics: t.metrics,
    logs: job.logs,
    screenshot: shot,
  };
}

/**
 * Runs jobs [{ test, engine, target }] with `slots` in parallel. onResult(result) is called as each
 * finishes. Jobs with opts.slots === 'all' run alone.
 */
export async function runJobs(jobs, { slots, outDir, onResult, retries = 0, bail = false, ordered = false }) {
  mkdirSync(outDir, { recursive: true });
  const queue = ordered ? [...jobs] : [...jobs].sort((a, b) => expected(b) - expected(a));
  const results = [];
  let free = slots;
  let stop = false;
  const need = (job) => (job.test.opts.slots === 'all' ? slots : Math.min(slots, job.test.opts.slots || 1));
  await new Promise((resolve) => {
    let running = 0;
    const pump = () => {
      if ((stop || !queue.length) && running === 0) return resolve();
      while (!stop && queue.length) {
        // Take the longest job that fits; a job that needs every slot waits for the pool to drain.
        const i = queue.findIndex((j) => need(j) <= free);
        if (i < 0) break;
        const job = queue.splice(i, 1)[0];
        const n = need(job);
        free -= n;
        running++;
        (async () => {
          let r;
          for (let attempt = 0; ; attempt++) {
            job.logs = [];
            r = await runOne(job, job.target, outDir);
            if (r.status === 'pass' || attempt >= retries) {
              if (attempt > 0 && r.status === 'pass') r.status = 'flaky';
              break;
            }
          }
          durations[jobKey(job)] = r.ms;
          results.push(r);
          onResult?.(r);
          if (bail && r.status === 'fail') stop = true;
          free += n;
          running--;
          pump();
        })();
      }
    };
    pump();
  });
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(DURATIONS, 'utf8')); // another run may have written meanwhile
  } catch {}
  writeFileSync(`${DURATIONS}.${process.pid}`, JSON.stringify({ ...saved, ...durations }));
  renameSync(`${DURATIONS}.${process.pid}`, DURATIONS);
  return results;
}
