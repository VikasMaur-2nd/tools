import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
