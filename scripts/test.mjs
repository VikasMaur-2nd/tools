// Zero-dependency test runner: compiles the framework-free TypeScript under
// lib/ plus tests/**/*.test.ts to CommonJS in .test-build/ with the repo's own
// TypeScript compiler, then runs the compiled tests with `node --test`.
//
//   pnpm test                                 # everything
//   pnpm test --test-name-pattern=parser      # extra args go to `node --test`

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.test-build');
const ts = createRequire(import.meta.url)('typescript');

/** Plain-TS source dirs (no React / DOM-store code). Missing dirs are skipped. */
const SRC_DIRS = ['lib/json', 'lib/convert'];
const EXCLUDE = new Set(['lib/engine/store.ts', 'lib/engine/instance.ts']);
const IMPORTS_REACT = /\bfrom\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"]|\brequire\(\s*['"]react['"]/;

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
const files = [
  ...SRC_DIRS.flatMap((d) => walk(join(root, d), isTs)),
  ...walk(join(root, 'tests'), (name) => name.endsWith('.test.ts')),
].filter((f) => !EXCLUDE.has(rel(f)) && !IMPORTS_REACT.test(readFileSync(f, 'utf8')));

const tests = files.filter((f) => rel(f).startsWith('tests/'));
if (!tests.length) {
  console.log('No tests found in tests/**/*.test.ts');
  process.exit(0);
}

const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  // same libs as the app's tsconfig (these modules run in the browser)
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: ['node'],
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  rootDir: root,
  outDir: out,
  baseUrl: root,
  paths: { '@/*': ['./*'] },
  sourceMap: true,
  noEmitOnError: true,
};

rmSync(out, { recursive: true, force: true });
const program = ts.createProgram(files, options);

// Emitted CommonJS can't resolve the `@/` alias at runtime: rewrite it to a relative path.
const writeFile = (file, text, bom) => {
  if (file.endsWith('.js')) {
    text = text.replace(/require\("@\/([^"]+)"\)/g, (_, p) => {
      let r = relative(dirname(file), join(out, p)).split(sep).join('/');
      if (!r.startsWith('.')) r = './' + r;
      return `require(${JSON.stringify(r)})`;
    });
  }
  ts.sys.writeFile(file, text, bom);
};
const emit = program.emit(undefined, writeFile);
const diags = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
if (diags.length) {
  const host = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' };
  console.error(ts.formatDiagnosticsWithColorAndContext(diags, host));
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'package.json'), '{ "type": "commonjs" }\n');

const compiled = tests.map((f) => join(out, relative(root, f)).replace(/\.ts$/, '.js'));
const run = spawnSync(process.execPath, ['--test', '--enable-source-maps', ...process.argv.slice(2), ...compiled], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
