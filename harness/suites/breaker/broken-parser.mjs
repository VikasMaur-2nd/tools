// The worker's JavaScript tape parser is its own chunk (lib/engine/reindent.worker.ts loadJs): big valid files
// are analysed by WebAssembly alone, and the first file that isn't strict JSON loads it. These open big files
// (analysed in the worker) in that order and in a hurry, and check each shows as it would in a fresh tab.
// (Offline: platform/offline.mjs opens a big broken file in its offline pages.)
import { defaults, test } from '../../lib/api.mjs';

defaults({ engines: 'all', timeout: 180_000 });

const record = (i) => `{"id":${i},"name":"item ${i}","tags":["a","b"],"ok":true}`;
/** ~2.8 MB: past the size the analysis worker takes (engine.ts WORKER_MIN). */
const VALID = '[' + Array.from({ length: 52_000 }, (_, i) => record(i)).join(',\n') + ']';
/** The same with a trailing comma and a comment: repaired, not valid. */
const BROKEN = '// export\n[' + Array.from({ length: 52_000 }, (_, i) => record(i)).join(',\n') + ',]';

const open = (page, name, text) => page.setInputFiles('.app:visible input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(text) });
/** Settled: not parsing and no "…" readout. */
const settled = (t, page) => t.app.waitStatus(page, /^(?!Parsing)(?!Ready)(?!.*…)./, { timeout: t.budget(90_000) }).catch(() => t.app.status(page));
/** The Format view shows the document (its first record, pretty-printed). */
const formatted = (t, page) =>
  page.waitForFunction(() => /"name": "item 0"/.test(document.getElementById('view-format')?.textContent || ''), null, { timeout: t.budget(60_000), polling: 50 }).then(() => true, () => false);

test('a big valid file, then a big broken one: the broken one is repaired and shown, and a valid one after is valid again', async (t) => {
  const { page } = t;
  await t.open('/');
  await open(page, 'valid.json', VALID);
  // (The views' tabs show once there is a document.)
  await t.app.view(page, 'format');
  t.check(/^Valid JSON/.test(await settled(t, page)), 'the valid file is valid', await t.app.status(page));
  await open(page, 'broken.json', BROKEN);
  const st = await settled(t, page);
  t.check(!/^Valid JSON/.test(st) && /issue|comment|comma|fixed|repair/i.test(st), 'the broken file shows what was repaired', st.slice(0, 120));
  t.check(await formatted(t, page), 'the broken file is formatted (repaired)');
  await open(page, 'valid2.json', VALID);
  t.check(/^Valid JSON/.test(await settled(t, page)), 'a valid file after it is valid', await t.app.status(page));
});

test('a big broken file opened while a big valid one is still being analysed: the broken one shows, then the valid one again', async (t) => {
  const { page } = t;
  await t.open('/');
  await open(page, 'small.json', '{"a": 1}');
  await t.app.view(page, 'format');
  // No waiting in between: the second file comes while the first is analysed.
  await open(page, 'valid.json', VALID);
  await open(page, 'broken.json', BROKEN);
  const st = await settled(t, page);
  t.check(!/^Valid JSON/.test(st) && /issue|comment|comma|fixed|repair/i.test(st), 'the broken file shows what was repaired', st.slice(0, 120));
  t.check(await formatted(t, page), 'the broken file is formatted (repaired)');
  await open(page, 'valid.json', VALID);
  await open(page, 'broken.json', BROKEN);
  await open(page, 'valid.json', VALID);
  t.check(/^Valid JSON/.test(await settled(t, page)), 'the last of three files in a row (valid) is what shows', await t.app.status(page));
});
