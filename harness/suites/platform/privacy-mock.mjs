// Transport regressions found while porting the browser canary. No browser is needed.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { defaults, test } from '../../lib/api.mjs';
import { ROOT } from '../../lib/env.mjs';
import { ensureMock, eventsIn, TAG_HEADER } from '../../lib/posthog-mock.mjs';

defaults({ page: false, variant: 'posthog-mock', engines: ['chromium'], tags: ['privacy'] });

test('the mock decodes unload forms and isolates headerless beacons from concurrent visitors', async (t) => {
  const mock = await ensureMock({ dist: join(ROOT, 'node_modules/posthog-js/dist') });
  const visitors = [0, 1].map(() => ({ tag: `mock-${randomUUID()}`, window: randomUUID() }));
  const post = async (body, headers = {}) => {
    const r = await fetch(mock.base + '/e/', { method: 'POST', headers, body });
    await r.text();
    if (!r.ok) throw new Error(`Mock ingestion returned ${r.status}`);
  };
  await Promise.all(visitors.map((v) => post(JSON.stringify({ event: 'mock_start', properties: { $window_id: v.window } }), { [TAG_HEADER]: v.tag })));
  await Promise.all(visitors.map((v) => {
    let json = JSON.stringify({ batch: [{ event: 'mock_leave', properties: { $window_id: v.window } }] });
    // No base64 padding. The old decoder appended garbage from compression=base64
    // in this case and silently hid the whole batch from eventsIn().
    while (Buffer.byteLength(json) % 3) json += ' ';
    return post(new URLSearchParams({ data: Buffer.from(json).toString('base64'), compression: 'base64' }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  }));
  for (const v of visitors) {
    const events = eventsIn(await mock.requests(v.tag));
    t.check(events.length === 2 && events[1].event === 'mock_leave', 'the unpadded form beacon is decoded and attributed', events);
    t.check(events.every((e) => e.properties.$window_id === v.window), 'a concurrent visitor cannot enter this tag', events);
  }
  const v = visitors[0];
  await post(gzipSync(JSON.stringify({ event: 'mock_gzip', properties: { $window_id: v.window } })), { 'content-encoding': 'gzip' });
  t.check(eventsIn(await mock.requests(v.tag)).some((e) => e.event === 'mock_gzip'), 'gzip requests are decoded before attribution');
  const needle = `header-${randomUUID()}`;
  await post('{}', { [TAG_HEADER]: v.tag, 'x-mock-privacy-probe': needle });
  t.check((await mock.search(needle)).some((hit) => hit.tag === v.tag), 'privacy searches include request headers');
});
