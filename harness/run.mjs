#!/usr/bin/env node
// Browser and performance checks for Tool Kumar. See harness/README.md.
//
//   pnpm e2e [filter…] [options]     functional checks (a production build of the working tree)
//   pnpm perf [filter…] [options]    timing checks, serial; --base <ref> compares against another commit
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { CACHE, CORES, DIRS, ENGINES, ROOT } from './lib/env.mjs';
import { beginSuite, registered } from './lib/api.mjs';
import { describeRef, ensureBuild, serve } from './lib/build.mjs';
import { closeBrowsers, ensureBrowsers, getBrowser } from './lib/browsers.mjs';
import { runJobs } from './lib/runner.mjs';
import { compare, round, summary } from './lib/stats.mjs';

const { values: o, positionals: filters } = parseArgs({
  allowPositionals: true,
  options: {
    perf: { type: 'boolean' },
    engine: { type: 'string', short: 'e' },
    tag: { type: 'string', multiple: true },
    'skip-tag': { type: 'string', multiple: true },
    smoke: { type: 'boolean' },
    slow: { type: 'boolean' },
    url: { type: 'string' },
    workers: { type: 'string', short: 'j' },
    retries: { type: 'string' },
    repeat: { type: 'string' },
    bail: { type: 'boolean' },
    list: { type: 'boolean' },
    json: { type: 'string' },
    headed: { type: 'boolean' },
    base: { type: 'string' },
    ref: { type: 'string' },
    legacy: { type: 'boolean' },
    rounds: { type: 'string' },
    baseline: { type: 'string' },
    'save-baseline': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (o.help) {
  console.log(readFileSync(join(ROOT, 'harness/README.md'), 'utf8'));
  process.exit(0);
}
if (o.headed) process.env.HEADED = '1';
const PERF = !!o.perf;
const list = (s) => (s ? s.flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean) : []);
const onlyEngines = o.smoke && !o.engine ? ['chromium'] : list(o.engine && [o.engine]);
const tags = o.smoke ? ['smoke', ...list(o.tag)] : list(o.tag);
const skipTags = list(o['skip-tag']);

// ── Suites ──────────────────────────────────────────────────────────────────────────────────────
const SUITES = join(ROOT, 'harness/suites');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.mjs') && !e.name.startsWith('_') ? [join(dir, e.name)] : [],
  );
for (const file of walk(SUITES).sort()) {
  beginSuite(relative(SUITES, file).replace(/\.mjs$/, ''), file);
  await import(file);
}

const match = (t) => {
  if (!filters.length) return true;
  const id = t.id.toLowerCase();
  return filters.some((f) => t.suite === f || t.suite.startsWith(f + '/') || id.includes(f.toLowerCase()));
};
const selected = registered().filter((t) => {
  const tt = t.opts.tags;
  if (PERF !== tt.includes('perf')) return false;
  if (tt.includes('slow') && !o.slow && !filters.length) return false;
  if (tags.length && !tags.some((x) => tt.includes(x))) return false;
  if (skipTags.some((x) => tt.includes(x))) return false;
  return match(t);
});
const enginesOf = (t) => {
  const e = t.opts.engines === 'all' ? ENGINES : t.opts.engines || ['chromium'];
  return onlyEngines.length ? e.filter((x) => onlyEngines.includes(x)) : e;
};

if (o.list) {
  for (const t of selected) console.log(`${t.id}  [${enginesOf(t).join(', ')}]${t.opts.tags.length ? '  #' + t.opts.tags.join(' #') : ''}`);
  console.log(`${selected.length} tests`);
  process.exit(0);
}
if (!selected.length) {
  console.log('No tests match.');
  process.exit(filters.length || tags.length ? 1 : 0);
}

// ── Targets ─────────────────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const engines = [...new Set(selected.flatMap(enginesOf))];
const pages = selected.some((t) => t.opts.page !== false);
// Browsers start while the build runs.
if (pages) {
  ensureBrowsers(engines);
  for (const e of engines) getBrowser(e).catch(() => {});
}
const variants = [...new Set(selected.map((t) => t.opts.variant || 'default'))];
const targets = {};
if (o.url) {
  targets.default = { name: 'url', base: o.url.replace(/\/$/, ''), legacy: !!o.legacy };
  const skipped = variants.filter((v) => v !== 'default');
  if (skipped.length) console.log(`  --url: skipping tests that need the ${skipped.join(', ')} build`);
} else {
  for (const variant of variants) {
    const b = await ensureBuild({ ref: o.ref, variant, log: (m) => console.log(m) });
    const s = await serve(b.dir);
    if (b.legacy) console.log(`  build ${b.key} predates the tk:engine mark: checks wait the old way for the tool`);
    targets[variant] = { legacy: b.legacy, name: o.ref ? `${variant === 'default' ? '' : variant + ' '}${describeRef(o.ref)}` : variant === 'default' ? 'current' : variant, base: s.base, dir: b.dir, key: b.key, reused: b.reused };
  }
}
let baseTarget = null;
if (PERF && o.base) {
  const b = await ensureBuild({ ref: o.base, log: (m) => console.log(m) });
  const s = await serve(b.dir);
  baseTarget = { name: `base ${describeRef(o.base)}`, base: s.base, dir: b.dir, key: b.key, legacy: b.legacy };
}
const setupMs = Date.now() - t0;
const describeTarget = (t) => `${t.name} ${t.base}${t.key ? ` (build ${t.key}${t.reused ? ', reused' : ''})` : ''}`;
console.log(`  targets: ${Object.values(targets).map(describeTarget).join('; ')}${baseTarget ? '; ' + describeTarget(baseTarget) : ''}  [setup ${(setupMs / 1000).toFixed(1)} s]`);

// ── Jobs ────────────────────────────────────────────────────────────────────────────────────────
const jobs = [];
const runnable = selected.filter((t) => targets[t.opts.variant || 'default']);
if (!PERF) {
  const repeat = Number(o.repeat || 1);
  for (const test of runnable) for (const engine of enginesOf(test)) for (let i = 0; i < repeat; i++) jobs.push({ test, engine, target: targets[test.opts.variant || 'default'] });
} else {
  // Interleaved: every round runs each test on every target, alternating which target goes first,
  // so a busy minute on the machine hits both sides alike.
  const rounds = Number(o.rounds || 5);
  for (let r = 0; r < rounds; r++)
    for (const test of runnable)
      for (const engine of enginesOf(test)) {
        if (r >= (test.opts.rounds ?? Infinity)) continue; // e.g. deterministic byte counts need one round
        const sides = baseTarget ? [baseTarget, targets[test.opts.variant || 'default']] : [targets[test.opts.variant || 'default']];
        if (r % 2) sides.reverse();
        for (const target of sides) jobs.push({ test, engine, target, round: r });
      }
}

const slots = PERF ? 1 : Number(o.workers || process.env.HARNESS_WORKERS || CORES);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(DIRS.results, runId);
const loadStart = loadavg()[0];
console.log(`  ${jobs.length} jobs, ${PERF ? 'serial' : `${slots} at a time`}, load ${loadStart.toFixed(1)} on ${CORES} cores${PERF && loadStart > CORES ? '  (busy machine: compare medians, not single runs)' : ''}`);

const ICON = { pass: '✓', fail: '✗', flaky: '~', known: '·' };
let done = 0;
const results = await runJobs(jobs, {
  slots,
  outDir,
  ordered: PERF,
  retries: Number(o.retries || 0),
  bail: !!o.bail,
  onResult(r) {
    done++;
    const extra = PERF ? `${r.target}  ` : '';
    console.log(`${ICON[r.status]} ${r.engine.padEnd(8)} ${extra}${r.id}  (${r.checks} checks, ${(r.ms / 1000).toFixed(1)} s)  [${done}/${jobs.length}]`);
    for (const f of r.status === 'known' ? r.failures.slice(0, 2) : r.failures) console.log(`    ✗ ${f.what}${f.detail === undefined ? '' : '  ' + JSON.stringify(f.detail).slice(0, 600)}`);
    for (const k of r.known) console.log(`    · known: ${k.what} (${k.known})`);
    for (const k of r.knownFixed) console.log(`    ! passes now, drop "known": ${k.what} (${k.known})`);
    if (r.knownTest) console.log(r.status === 'known' ? `    · known failure: ${r.knownTest}` : `    ! passes now, drop the test's "known": ${r.knownTest}`);
    if (r.status === 'fail' && r.logs.length) console.log('    log: ' + r.logs.slice(-8).join('\n         '));
    if (r.screenshot) console.log(`    screenshot: ${r.screenshot}`);
  },
});
await closeBrowsers();

// ── Report ──────────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.status === 'fail');
const flaky = results.filter((r) => r.status === 'flaky');
const knownTests = results.filter((r) => r.status === 'known');
const checks = results.reduce((s, r) => s + r.checks, 0);
const knownCount = results.reduce((s, r) => s + r.known.length, 0);
const wall = (Date.now() - t0) / 1000;
const report = { runId, mode: PERF ? 'perf' : 'e2e', filters, engines, targets, base: baseTarget, wallSeconds: wall, setupSeconds: setupMs / 1000, load: [loadStart, loadavg()[0]], cores: CORES, results };

let perfTable = [];
if (PERF) perfTable = perfReport(results);
mkdirSync(DIRS.results, { recursive: true });
writeFileSync(join(outDir, 'results.json'), JSON.stringify(report, null, 1));
writeFileSync(join(DIRS.results, `latest-${report.mode}.json`), JSON.stringify(report));
if (o.json) writeFileSync(o.json, JSON.stringify(report, null, 1));
if (o['save-baseline']) saveBaseline(o['save-baseline'], results);

console.log(
  `\n${failed.length ? '✗' : '✓'} ${results.length - failed.length - flaky.length - knownTests.length} passed, ${failed.length} failed${flaky.length ? `, ${flaky.length} flaky` : ''}${knownTests.length ? `, ${knownTests.length} known` : ''} · ${checks} checks${knownCount ? ` (${knownCount} known failures)` : ''} · ${wall.toFixed(1)} s (setup ${(setupMs / 1000).toFixed(1)} s) · results ${relative(process.cwd(), outDir) || outDir}`,
);
if (process.env.GITHUB_STEP_SUMMARY) githubSummary();
process.exit(failed.length ? 1 : 0);

// ── Perf helpers ────────────────────────────────────────────────────────────────────────────────
function collect(rs) {
  const by = {};
  for (const r of rs)
    for (const [name, m] of Object.entries(r.metrics)) {
      const k = `${r.id} [${r.engine}] ${name}`;
      ((by[k] ||= { unit: m.unit, sides: {} }).sides[r.target] ||= []).push(...m.values);
    }
  return by;
}

function perfReport(rs) {
  const by = collect(rs);
  let baseline = null;
  if (o.baseline) {
    const f = join(CACHE, 'baselines', `${o.baseline}.json`);
    if (existsSync(f)) baseline = JSON.parse(readFileSync(f, 'utf8'));
    else console.log(`  no baseline "${o.baseline}" yet (save one with --save-baseline ${o.baseline})`);
  }
  const rows = [];
  console.log('\nmetric'.padEnd(72) + 'median   p90      n   change');
  for (const [k, m] of Object.entries(by)) {
    const sides = Object.entries(m.sides);
    const cand = sides.find(([name]) => !name.startsWith('base '))?.[1] || [];
    const base = sides.find(([name]) => name.startsWith('base '))?.[1] || baseline?.[k]?.values;
    const s = summary(cand);
    let change = '';
    if (base?.length) {
      const c = compare(base, cand);
      change = `${c.change > 0 ? '+' : ''}${round(c.change * 100)} % vs ${round(c.base)} (${c.verdict}, noise ±${round(c.noise * 100)} %)`;
      rows.push({ metric: k, unit: m.unit, ...c });
    } else rows.push({ metric: k, unit: m.unit, cand: s.p50 });
    console.log(`${k.slice(0, 70).padEnd(70)}  ${String(round(s.p50)).padStart(7)} ${String(round(s.p90)).padStart(7)} ${String(s.n).padStart(4)}   ${change}`);
  }
  return rows;
}

function saveBaseline(name, rs) {
  const by = collect(rs);
  const out = {};
  for (const [k, m] of Object.entries(by)) {
    const cand = Object.entries(m.sides).find(([n]) => !n.startsWith('base '))?.[1];
    if (cand) out[k] = { unit: m.unit, values: cand, at: new Date().toISOString() };
  }
  mkdirSync(join(CACHE, 'baselines'), { recursive: true });
  writeFileSync(join(CACHE, 'baselines', `${name}.json`), JSON.stringify(out, null, 1));
  console.log(`  baseline "${name}" saved (${Object.keys(out).length} metrics)`);
}

function githubSummary() {
  let md = `### ${PERF ? 'Performance' : 'Browser checks'}: ${failed.length ? `${failed.length} failed` : 'all passed'}\n\n${results.length} jobs · ${checks} checks · ${wall.toFixed(0)} s\n\n`;
  if (failed.length) md += failed.map((r) => `- ✗ **${r.id}** (${r.engine}): ${r.failures.map((f) => f.what).join('; ')}`).join('\n') + '\n';
  if (perfTable.length) md += '\n| metric | base | now | change |\n|---|---|---|---|\n' + perfTable.map((r) => `| ${r.metric} | ${round(r.base) ?? ''} | ${round(r.cand)} | ${r.change === undefined ? '' : `${round(r.change * 100)} % (${r.verdict})`} |`).join('\n') + '\n';
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

