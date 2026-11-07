import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { join } from 'node:path';

// The harness's own code (harness/lib/console.mjs): which console messages a browser check doesn't count as page errors.
const load = () => import(join(process.cwd(), 'harness/lib/console.mjs')) as Promise<{ cancelledLoad(text: string, pageUrl: string): boolean }>;

test('a load the browser cancelled is not a page error; a failed or cross-origin one still is', async () => {
  const { cancelledLoad } = await load();
  const page = 'http://127.0.0.1:35433/integrate';
  // As CI logged them (runs 42264389070 and 42268839390): WebKit leaving a tool page while its warm-up workers
  // started, Firefox leaving a page while its font came.
  assert.equal(cancelledLoad('Cannot load http://127.0.0.1:35433/_next/static/chunks/0jpw9shib16oa.js due to access control checks.', page), true);
  assert.equal(cancelledLoad('Cannot load blob:http://127.0.0.1:35433/7ed93c4c-7ede-4fff-b7cc-3395b15e3612 due to access control checks.', page), true);
  const font = '[JavaScript Error: "downloadable font: download failed (font-family: "JetBrains Mono" style:normal weight:100..800 width:100 src index:0): status=2152398850 source: http://127.0.0.1:35433/_next/static/media/71b036adf157cdcf-s.0bp8oijd_gu96.woff2"]';
  assert.equal(cancelledLoad(font, page), true);

  assert.equal(cancelledLoad('Cannot load https://example.com/a.js due to access control checks.', page), false, 'another origin');
  assert.equal(cancelledLoad('Cannot load http://127.0.0.1:9999/a.js due to access control checks.', page), false, 'another port');
  assert.equal(cancelledLoad(font.replace('2152398850', '2152398878'), page), false, 'a font that failed (not found), not cancelled');
  assert.equal(cancelledLoad('TypeError: Load failed', page), false);
  assert.equal(cancelledLoad('Cannot load http://127.0.0.1:35433/a.js due to access control checks.', 'about:blank'), false);
});
