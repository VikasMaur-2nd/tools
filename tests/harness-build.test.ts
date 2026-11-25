import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The harness's own code for the offline checks and its builds (harness/suites/platform/_helpers.mjs,
// harness/lib/build.mjs).
type Closure = (base: string, page?: string) => Promise<{ named: string[]; all: string[] }>;
const helpers = () => import(join(process.cwd(), 'harness/suites/platform/_helpers.mjs')) as Promise<{ closure: Closure }>;

/** Serves `files` (path → body) on a free port, HEAD too; resolves its origin and a close(). */
function serve(files: Record<string, string>) {
  const server = createServer((req, res) => {
    const body = files[(req.url ?? '/').split('?')[0]];
    if (body === undefined) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': /\.js$/.test(req.url ?? '') ? 'text/javascript' : 'text/html' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise<{ base: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    }),
  );
}

test("the offline checks' closure counts what scripts name root-relative too (huge mode's wasm), as the worker does", async () => {
  const { closure } = await helpers();
  const s = await serve({
    '/': '<script src="/_next/static/immutable/chunks/main.js"></script>',
    '/_next/static/immutable/chunks/main.js': 'x.l("static/immutable/chunks/lazy.js");w(new URL("/_next/static/immutable/media/huge.wasm"));d("/_next/static/chunks/")',
    '/_next/static/immutable/chunks/lazy.js': 'lazy()',
    '/_next/static/immutable/media/huge.wasm': 'wasm',
  });
  try {
    const { all } = await closure(s.base, '/');
    assert.deepEqual(all, ['/_next/static/immutable/chunks/lazy.js', '/_next/static/immutable/chunks/main.js', '/_next/static/immutable/media/huge.wasm']);
  } finally {
    s.close();
  }
});

type Build = {
  buildEnv(variant: string, base?: Record<string, string>): Record<string, string>;
  variantKey(variant: string, read?: (file: string) => string): string;
  legacy(dir: string): boolean;
};
const build = () => import(join(process.cwd(), 'harness/lib/build.mjs')) as Promise<Build>;

test("a harness build never inherits an adapter or a deployment id: only an immutable variant gets the harness's adapter", async () => {
  const { buildEnv } = await build();
  const outer = { PATH: '/bin', NEXT_ADAPTER_PATH: '/elsewhere/adapter.mjs', NEXT_DEPLOYMENT_ID: 'dpl_1', NEXT_PUBLIC_X: '1' };
  const env = buildEnv('default', outer);
  assert.equal(env.PATH, '/bin');
  assert.ok(!('NEXT_ADAPTER_PATH' in env) && !('NEXT_DEPLOYMENT_ID' in env) && !('NEXT_PUBLIC_X' in env), JSON.stringify(env));
  const imm = buildEnv('immutable', outer);
  assert.match(imm.NEXT_ADAPTER_PATH, /harness\/lib\/immutable-adapter\.mjs$/);
  assert.ok(!('NEXT_DEPLOYMENT_ID' in imm));
});

test("an immutable build's key counts its adapter by contents, not by where it is", async () => {
  const { variantKey } = await build();
  assert.equal(variantKey('default'), '');
  const one = variantKey('immutable', () => 'export default { name: "a" }');
  assert.equal(variantKey('immutable', () => 'export default { name: "a" }'), one, 'the same adapter: the same build');
  assert.notEqual(variantKey('immutable', () => 'export default { name: "b" }'), one, 'an edited one: a new build');
  assert.notEqual(variantKey('immutable-redeploy', () => 'export default { name: "a" }'), one);
});

test('a build of code before the engine mark is told apart in either chunk layout', async () => {
  const { legacy } = await build();
  const dir = mkdtempSync(join(tmpdir(), 'harness-legacy-'));
  try {
    const chunks = (immutable: boolean, text: string) => {
      const d = join(dir, '.next', 'static', ...(immutable ? ['immutable', 'chunks'] : ['chunks']));
      rmSync(join(dir, '.next'), { recursive: true, force: true });
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'a.js'), text);
    };
    chunks(false, 'old()');
    assert.equal(legacy(dir), true);
    chunks(false, 'performance.mark("tk:engine")');
    assert.equal(legacy(dir), false);
    chunks(true, 'old()');
    assert.equal(legacy(dir), true, 'an old ref built in the immutable layout');
    chunks(true, 'performance.mark("tk:engine")');
    assert.equal(legacy(dir), false);
    rmSync(join(dir, '.next'), { recursive: true, force: true });
    assert.equal(legacy(dir), false, 'no chunks at all: not told legacy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
