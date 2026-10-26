// Zero-dependency test runner: transpiles the framework-free TypeScript under lib/ plus tests/ to
// CommonJS in .test-build/ with the repo's own TypeScript, then runs the tests with `node --test`.
//
//   pnpm test                    # every test file
//   pnpm test parser diff        # only test files whose name contains "parser" or "diff"
//   pnpm test --slow             # also the scale tests (TEST_SLOW=1), e.g. 100k-row exports
//   pnpm test --test-name-pattern=resumable   # other --flags go to `node --test`
//
// Files are transpiled one by one (no type checking: `pnpm typecheck` does that for the whole repo)
// and only when their content changed since the last run, so a rerun starts the tests at once.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.test-build');
// TypeScript takes a second or two to load: only when some file changed.
let tsModule;
const ts = () => (tsModule ||= createRequire(import.meta.url)('typescript'));

const EXCLUDE = new Set(['lib/engine/store.ts', 'lib/engine/instance.ts']);
const IMPORTS_REACT = /\bfrom\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"]|\brequire\(\s*['"]react(?:-dom)?(?:\/[^'"]*)?['"]/;

const args = process.argv.slice(2);
// node --test options whose value may follow as the next argument ("--test-name-pattern parser").
const TAKES_VALUE = /^--test-(name-pattern|skip-pattern|concurrency|reporter|reporter-destination|timeout|shard|isolation)$/;
const valueOf = new Set(args.flatMap((a, i) => (TAKES_VALUE.test(a) && args[i + 1] && !args[i + 1].startsWith('-') ? [i + 1] : [])));
const filters = args.filter((a, i) => !a.startsWith('-') && !valueOf.has(i));
const slow = args.includes('--slow');
const nodeArgs = args.filter((a, i) => (a.startsWith('-') && a !== '--slow') || valueOf.has(i));

const walk = (dir, filter, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, acc);
    else if (filter(e.name)) acc.push(p);
  }
  return acc;
};
const rel = (p) => relative(root, p).split(sep).join('/');
const isTs = (name) => name.endsWith('.ts') && !name.endsWith('.d.ts');

const allTests = walk(join(root, 'tests'), (name) => name.endsWith('.test.ts'));
const tests = filters.length ? allTests.filter((f) => filters.some((x) => rel(f).includes(x))) : allTests;
if (!tests.length) {
  console.log(filters.length ? `No test file matches ${filters.join(', ')}` : 'No tests found in tests/**/*.test.ts');
  process.exit(filters.length ? 1 : 0);
}

// ES2022 = 9, CommonJS = 1, react-jsx = 4 (numbers, so TypeScript needn't load to build the key).
const options = { target: 9, module: 1, esModuleInterop: true, jsx: 4, inlineSourceMap: true };
const tsVersion = JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version;
// Changing these options or this file's transpile step must invalidate the cache.
const VERSION = `${tsVersion} ${JSON.stringify(options)} 4`;

// Every non-React TypeScript file in lib/ (tests load some of them by path, e.g. worker modules),
// all of tests/, and whatever else those import (app/ snippets).
const seeds = [...walk(join(root, 'lib'), isTs), ...walk(join(root, 'tests'), isTs)].filter((f) => !EXCLUDE.has(rel(f)));
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const resolveImport = (from, spec) => {
  const base = spec.startsWith('@/') ? join(root, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  return base && ([base, ...(base.endsWith('.js') ? [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx'] : []), `${base}.ts`, `${base}.tsx`, `${base}.json`, join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.json')].find(isFile) ?? null);
};

const cacheFile = join(out, '.cache.json');
let cache = {};
try {
  cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  if (cache.version !== VERSION) cache = {};
} catch {}
// A lost or incompatible manifest cannot tell us which old outputs to remove.
if (cache.version !== VERSION) rmSync(out, { recursive: true, force: true });
const files = cache.files || {};
const seen = new Set();
const outputs = new Set();
const queue = seeds.map((file) => ({ file, imported: false }));
let transpiled = 0;
const t0 = performance.now();
while (queue.length) {
  const { file, imported } = queue.pop();
  if (seen.has(file)) continue;
  const src = readFileSync(file, 'utf8');
  // A skipped seed may still be needed later through an explicit import.
  if (!imported && IMPORTS_REACT.test(src) && !rel(file).startsWith('tests/')) continue;
  seen.add(file);
  if (file.endsWith('.json')) {
    const dest = join(out, rel(file));
    outputs.add(dest);
    const hash = createHash('sha1').update(src).digest('hex');
    if (files[rel(file)]?.hash !== hash || !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
      files[rel(file)] = { hash, imports: [] };
    }
    continue;
  }
  const dest = join(out, rel(file)).replace(/\.tsx?$/, '.js');
  outputs.add(dest);
  const hash = createHash('sha1').update(src).digest('hex');
  const known = files[rel(file)];
  const fresh = known?.hash === hash && existsSync(dest);
  const imports = fresh ? known.imports : ts().preProcessFile(src, true, true).importedFiles.map((i) => i.fileName);
  // Resolve again even when the importer is unchanged: files may have moved or been deleted.
  for (const spec of imports) {
    const dep = resolveImport(file, spec);
    if (dep && !seen.has(dep)) queue.push({ file: dep, imported: true });
  }
  if (fresh) continue;
  let text = ts().transpileModule(src, { compilerOptions: options, fileName: file }).outputText;
  // Emitted CommonJS can't resolve the `@/` alias at runtime: rewrite it to a relative path.
  text = text.replace(/require\((['"])@\/([^'"]+)\1\)/g, (_, quote, p) => {
    let r = relative(dirname(dest), join(out, p)).split(sep).join('/');
    if (!r.startsWith('.')) r = './' + r;
    return `require(${JSON.stringify(r)})`;
  });
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
  files[rel(file)] = { hash, imports };
  transpiled++;
}
// Outputs of deleted sources would still be importable: drop them.
for (const f of Object.keys(files)) {
  if (!seen.has(join(root, f))) {
    const dest = join(out, f).replace(/\.tsx?$/, '.js');
    if (!outputs.has(dest)) rmSync(dest, { force: true });
    delete files[f];
  }
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'package.json'), '{ "type": "commonjs" }\n');
writeFileSync(cacheFile, JSON.stringify({ version: VERSION, files }));
if (transpiled) console.log(`transpiled ${transpiled} file${transpiled === 1 ? '' : 's'} in ${Math.round(performance.now() - t0)} ms`);

const compiled = tests.map((f) => join(out, rel(f)).replace(/\.ts$/, '.js'));
const run = spawnSync(process.execPath, ['--test', '--enable-source-maps', ...nodeArgs, ...compiled], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...(slow ? { TEST_SLOW: '1' } : {}) },
});
process.exit(run.status ?? 1);
