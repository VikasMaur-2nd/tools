// Production builds, addressed by content. A build's key is the git tree of the files that affect it
// (the working tree, uncommitted edits included, minus harness/tests/docs), so a second run with the
// same code reuses the first one's build, worktrees with the same code share one, and a run that
// edits only tests never rebuilds. Builds live in CACHE/builds/<key>, never in the checkout's .next,
// so a server keeps working while another run builds newer code next to it.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { DIRS, ROOT } from './env.mjs';
import { withLock } from './lock.mjs';

/** Paths that never change what `next build` produces. */
const NOT_BUILT = ['harness', 'tests', 'docs', 'scripts', '.github', 'README.md', 'AGENTS.md', 'CLAUDE.md'];
const KEEP_BUILDS = Number(process.env.HARNESS_KEEP_BUILDS || 6);
const CACHE_LOCK = join(DIRS.builds, '.cache.lock');
const leases = new Set();
process.on('exit', () => {
  for (const file of leases) rmSync(file, { force: true });
});

// Protect builds from lookup until process exit, including the gap before serve().
function pin(key) {
  const file = join(DIRS.builds, `${key}.use-${process.pid}`);
  writeFileSync(file, '');
  leases.add(file);
}

function inUse(key) {
  const prefix = `${key}.use-`;
  let used = false;
  for (const name of readdirSync(DIRS.builds).filter((n) => n.startsWith(prefix))) {
    const pid = Number(name.slice(prefix.length));
    try {
      if (!Number.isInteger(pid) || pid <= 0) continue;
      process.kill(pid, 0);
      used = true;
    } catch (e) {
      if (e.code === 'ESRCH') rmSync(join(DIRS.builds, name), { force: true });
      else used = true;
    }
  }
  return used;
}

/**
 * Build-time settings. `default` is what a visitor gets minus analytics and origin-trial tokens.
 * A variant is a separate build: Next.js bakes NEXT_PUBLIC_* values into the bundles.
 */
export const VARIANTS = {
  default: {},
  // PostHog pointed at the local mock in harness/lib/posthog-mock.mjs (privacy suites). lib/analytics reads
  // the token and the host; next.config.ts rewrites /relay/* to the host, so the mock's port is fixed here.
  'posthog-mock': { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_harness_canary', NEXT_PUBLIC_POSTHOG_HOST: 'http://127.0.0.1:4610' },
  // A redeploy of `default` (offline suite): nothing a visitor sees changes, but the value is inlined into
  // the lazily loaded PostHog chunk (lib/analytics/posthog.ts), so that chunk and the chunks naming it get
  // new hashes, like a real deploy. Identical code alone gives byte-identical chunks (only BUILD_ID differs).
  redeploy: { NEXT_PUBLIC_POSTHOG_UI_HOST: 'https://redeploy.harness.invalid' },
};
const SCRUB = /^(NEXT_PUBLIC_|WEBMCP_ORIGIN_TRIAL$|POSTHOG_|VERCEL)/;

const git = (args, opts = {}) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

/** Tree hash of `ref` (a commit) or of the working tree when ref is omitted, without the NOT_BUILT paths. */
export function treeOf(ref) {
  const index = join(DIRS.tmp, `index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    if (ref) git(['read-tree', ref], { env });
    else {
      // Start from the real index so `git add` only hashes files whose stat changed.
      // Preserve the index time: Git uses it to detect same-timestamp, same-size edits.
      cpSync(resolve(ROOT, git(['rev-parse', '--git-path', 'index'])), index, { preserveTimestamps: true });
      git(['add', '-A', '--', '.', ...NOT_BUILT.map((p) => `:(top,exclude)${p}`)], { env });
    }
    git(['rm', '-r', '--cached', '-q', '-f', '--ignore-unmatch', '--', ...NOT_BUILT], { env }); // -f: only the temporary index changes
    return git(['write-tree'], { env });
  } finally {
    rmSync(index, { force: true });
  }
}

export const describeRef = (ref) => (ref ? git(['rev-parse', '--short', ref]) : 'working tree');

/**
 * A production build of `ref` (default: the working tree) in the given variant; built once per key.
 * Returns { dir, key }.
 */
export async function ensureBuild({ ref, variant = 'default', log = console.log } = {}) {
  if (!Object.hasOwn(VARIANTS, variant)) throw new Error(`unknown build variant: ${variant}`);
  const tree = treeOf(ref);
  const key = `${tree.slice(0, 16)}-${variant}`;
  const dir = join(DIRS.builds, key);
  const done = () => existsSync(join(dir, '.next', 'BUILD_ID')) && existsSync(join(dir, '.harness-built'));
  const reused = await withLock(CACHE_LOCK, () => {
    pin(key);
    if (!done()) return false;
    touch(dir);
    return true;
  });
  if (reused) {
    return { dir, key, reused: true, legacy: legacy(dir) };
  }
  await withLock(join(DIRS.builds, `${key}.lock`), async () => {
    if (done()) return;
    const t0 = Date.now();
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // Snapshot of exactly the hashed tree: no untracked secrets (.env.local), no stale .next.
    const tar = spawnSync('sh', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', 'harness-archive', tree, dir], { cwd: ROOT, encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`git archive: ${tar.stderr}`);
    // A completed seed cannot be pruned while it is copied.
    await withLock(CACHE_LOCK, () => seedCache(dir));
    log(`  build ${key}: installing`);
    run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--reporter=silent'], dir, {});
    log(`  build ${key}: next build (${describeRef(ref)})`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SCRUB.test(k)));
    Object.assign(env, VARIANTS[variant], { NEXT_TELEMETRY_DISABLED: '1' });
    // On a machine shared by several agents, HARNESS_HEAVY_LOCK names a lock file that serialises
    // builds with everyone else's (flock --close: the lock isn't inherited by anything the build starts).
    const next = [process.execPath, join(dir, 'node_modules/next/dist/bin/next'), 'build'];
    const lock = process.env.HARNESS_HEAVY_LOCK;
    const [cmd, ...args] = lock ? ['flock', '--close', lock, ...next] : next;
    await runAsync(cmd, args, dir, env, join(dir, 'build.log'));
    writeFileSync(join(dir, '.harness-built'), JSON.stringify({ ref: ref || null, tree, variant, ms: Date.now() - t0 }));
    log(`  build ${key}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await withLock(CACHE_LOCK, () => prune(key));
  });
  return { dir, key, reused: false, legacy: legacy(dir) };
}

/**
 * True for builds of code older than the engine's `tk:engine` performance mark (commits before the
 * harness, e.g. `--base origin/main` until it merges): checks then wait the old way for the tool.
 */
function legacy(dir) {
  const chunks = join(dir, '.next', 'static', 'chunks');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.js')) files.push(join(d, e.name));
    }
  };
  try {
    walk(chunks);
  } catch {
    return false;
  }
  return !files.some((f) => readFileSync(f, 'latin1').includes('tk:engine'));
}

/** Turbopack's cache from the newest earlier build makes this one incremental (about half the time). */
function seedCache(dir) {
  const prev = builds().find((b) => b.dir !== dir && existsSync(join(b.dir, '.harness-built')) && existsSync(join(b.dir, '.next', 'cache')));
  if (!prev) return;
  try {
    cpSync(join(prev.dir, '.next', 'cache'), join(dir, '.next', 'cache'), { recursive: true });
  } catch {
    rmSync(join(dir, '.next', 'cache'), { recursive: true, force: true });
  }
}

function builds() {
  return readdirSync(DIRS.builds, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ dir: join(DIRS.builds, e.name), key: e.name, at: statSync(join(DIRS.builds, e.name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
}
const touch = (dir) => {
  const now = new Date();
  utimesSync(dir, now, now);
};
function prune(keep) {
  for (const b of builds().slice(KEEP_BUILDS)) if (b.key !== keep && !inUse(b.key)) rmSync(b.dir, { recursive: true, force: true });
}

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}:\n${(r.stderr || r.stdout).slice(-3000)}`);
}
function runAsync(cmd, args, cwd, env, logFile) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => {
      writeFileSync(logFile, out);
      if (code === 0) resolve();
      else reject(new Error(`next build failed (exit ${code}), log: ${logFile}\n${out.slice(-3000)}`));
    });
  });
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const servers = new Set();
const stopAll = () => {
  for (const p of servers) p.kill('SIGKILL');
};
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

/** `next start` for a build directory on a free port; stops when the harness exits. Returns { base, stop }. */
export async function serve(dir, { port } = {}) {
  const requestedPort = port;
  for (let attempt = 0; ; attempt++) {
    try {
      return await startServer(dir, requestedPort || await freePort());
    } catch (e) {
      if (requestedPort || attempt >= 4 || !String(e).includes('EADDRINUSE')) throw e;
    }
  }
}

async function startServer(dir, port) {
  const base = `http://127.0.0.1:${port}`;
  // Start next directly, not through pnpm: a killed pnpm wrapper leaves the server holding the port.
  const p = spawn(process.execPath, [join(dir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: dir,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.add(p);
  let err = '';
  let output = '';
  let spawnError = null;
  p.on('error', (e) => (spawnError = e));
  p.stdout.on('data', (d) => (output = (output + d).slice(-4000)));
  p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
  const closed = new Promise((resolve) => p.once('close', () => {
    servers.delete(p);
    resolve();
  }));
  const stop = async () => {
    if (p.exitCode !== null || p.signalCode !== null || spawnError) return closed;
    // Keep the child registered until it exits, including when stop() isn't awaited.
    const timer = setTimeout(() => p.kill('SIGKILL'), 2000);
    timer.unref();
    p.kill('SIGTERM');
    await closed;
    clearTimeout(timer);
  };
  const t0 = Date.now();
  try {
    for (;;) {
      if (spawnError) throw spawnError;
      if (p.exitCode !== null || p.signalCode !== null) throw new Error(`next start exited (${p.exitCode ?? p.signalCode}): ${err.slice(-2000)}`);
      // Only probe after our child is ready. A different process may have won the port.
      if (/Ready in/.test(output)) {
        try {
          const r = await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2000) });
          await r.body?.cancel();
          if (r.ok) break;
        } catch {}
      }
      if (Date.now() - t0 > 60_000) throw new Error(`next start did not answer within 60 s: ${err.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return {
    base,
    dir,
    stop,
  };
}

export function readBuildInfo(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, '.harness-built'), 'utf8'));
  } catch {
    return null;
  }
}
