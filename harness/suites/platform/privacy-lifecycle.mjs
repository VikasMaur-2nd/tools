// Ports /tmp/phlive/{beacon3,leave,cases,cls2}.mjs. These were diagnostic scripts with
// no assertions. Their observations are now checks against the local PostHog mock.
import { defaults } from '../../lib/api.mjs';
import {
  ANALYTICS, POLL, analytics, flushRecording, setVisibility,
  test, waitPostHog, watchRelay,
} from './_helpers.mjs';

defaults({ ...ANALYTICS, timeout: 180_000, tags: ['privacy'] });

const probeBeacons = () => {
  const send = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, body) => {
    const ok = send(url, body);
    if (String(url).includes('/relay/')) {
      const log = JSON.parse(sessionStorage.getItem('harness-beacons') || '[]');
      log.push({ path: new URL(url, location.href).pathname, bytes: body?.size ?? body?.length ?? 0, ok });
      sessionStorage.setItem('harness-beacons', JSON.stringify(log));
    }
    return ok;
  };
};

test('beacon3: leaving a page delivers queued actions and its pageleave', async (t) => {
  const a = await analytics(t);
  await t.context.addInitScript(probeBeacons);
  await t.open('/');
  await t.app.command(t.page, 'Load sample JSON');
  await t.app.waitValid(t.page);
  await waitPostHog(t.page);
  await a.waitEvent('$pageview');
  // Flush the potentially >64 KB first replay snapshot before unloading, as the canary does.
  await flushRecording(t.page, a);
  await t.app.command(t.page, 'Keyboard shortcuts');
  await t.page.goto(t.base + '/privacy', { waitUntil: 'load' });
  t.log('unload beacons', await t.page.evaluate(() => sessionStorage.getItem('harness-beacons')));
  await a.waitEvent('$pageleave');
  const events = await a.events();
  const beacons = await t.page.evaluate(() => JSON.parse(sessionStorage.getItem('harness-beacons') || '[]'));
  const eventBeacons = beacons.filter((b) => /\/(?:e|i\/v0\/e)\//.test(b.path));
  t.check(events.some((e) => e.event === '$pageview'), 'the pageview reaches the mock');
  t.check(events.some((e) => e.event === 'json_loaded' && e.properties?.source === 'sample'), 'the pre-boot sample event reaches the mock');
  t.check(events.some((e) => e.event === 'feature_used' && e.properties?.feature === 'shortcuts'), 'the action queued just before leaving reaches the mock');
  t.check(eventBeacons.some((b) => b.ok && b.bytes > 0), 'the browser accepts an event beacon', beacons);
  t.check(events.some((e) => e.event === '$pageleave'), 'the pageleave beacon reaches the mock');
});

test('leave: pagehide sends pageleave with pageview and batching enabled', async (t) => {
  const a = await analytics(t);
  await t.open('/');
  await waitPostHog(t.page);
  await a.waitEvent('$pageview');
  await flushRecording(t.page, a);
  const mark = await a.mock.mark();
  const config = await t.page.evaluate(() => {
    const c = window.posthog.config;
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    return { leave: c.capture_pageleave, view: c.capture_pageview, batching: c.request_batching };
  });
  const leave = await a.waitEvent('$pageleave', { since: mark });
  t.check(config.leave === true && config.view === 'history_change', 'page views and leaves are enabled', config);
  t.check(config.batching === true, 'event batching is enabled', config);
  t.check(leave.properties?.$pathname === '/', 'pagehide delivers the page left', leave.properties?.$pathname);
});

test('cases: an idle visitor sends a pageview without interacting', async (t) => {
  const a = await analytics(t);
  await t.open('/');
  const event = await a.waitEvent('$pageview');
  t.check(event.properties?.$pathname === '/', 'the idle pageview reaches the mock');
});

test('cases: GPC blocks PostHog while a matching visitor sends events', async (t) => {
  const a = await analytics(t, { gpc: true });
  const relay = watchRelay(t.context);
  const ctl = await t.newPage();
  const control = await analytics(t, { context: ctl.context, name: 'gpc-control' });
  await Promise.all([t.open('/'), t.app.open(ctl.page, t.base, '/')]);
  await control.waitEvent('$pageview');
  t.check(!(await t.page.evaluate(() => !!window.posthog)), 'PostHog does not load with GPC');
  t.check(!relay.started.length, 'GPC sends no relay requests', relay.started);
  t.check(!(await a.requests()).length, 'nothing from the GPC visitor reaches the mock');
});

test('cases: hiding a page before the SDK boots delivers its queued work', async (t) => {
  const a = await analytics(t);
  // Keep the quiet-period gate closed until the explicit visibility change.
  await t.context.addInitScript(() => {
    const input = () => {
      if (document.visibilityState === 'hidden') return;
      dispatchEvent(new Event('pointerdown'));
      requestAnimationFrame(input);
    };
    requestAnimationFrame(input);
  });
  await t.open('/');
  await t.app.paste(t.page, '{"leaving":true}');
  await t.app.waitValid(t.page);
  t.check(await t.page.evaluate(() => !window.posthog), 'the SDK has not booted while input continues');
  await setVisibility(t.page, 'hidden');
  await a.waitEvent('$pageview');
  await a.waitEvent((e) => e.event === 'json_loaded' && e.properties?.source === 'paste');
  t.check((await a.events()).some((e) => e.event === '$pageview'), 'a seen page sends its pageview when hidden');
  t.check((await a.events()).some((e) => e.event === 'json_loaded'), 'the document event queued before boot is delivered');
});

test('cases: continuous input defers the SDK, then hiding the page flushes it', async (t) => {
  const a = await analytics(t);
  await t.context.addInitScript(() => {
    const input = () => {
      if (window.__stopInput) return;
      dispatchEvent(new Event('pointerdown'));
      requestAnimationFrame(input);
    };
    requestAnimationFrame(input);
  });
  const ctl = await t.newPage();
  const control = await analytics(t, { context: ctl.context, name: 'busy-control' });
  await Promise.all([t.open('/'), t.app.open(ctl.page, t.base, '/')]);
  await t.app.paste(t.page, '{"a":[1,2,3],"b":{"c":true}}');
  await t.app.waitValid(t.page);
  await t.app.command(t.page, 'Format input in place');
  // The idle control provides the observation window for the negative assertions.
  await control.waitEvent('$pageview');
  t.check(await t.page.evaluate(() => !window.posthog), 'input prevents the expensive SDK from loading');
  t.check(!(await a.requests()).length, 'queued actions stay in the browser during input');
  await setVisibility(t.page, 'hidden');
  await a.waitEvent('$pageview');
  await a.waitEvent((e) => e.event === 'json_loaded' && e.properties?.source === 'paste');
  await a.waitEvent((e) => e.event === 'feature_used' && e.properties?.feature === 'format_input');
  await t.page.evaluate(() => { window.__stopInput = true; });
  const events = await a.events();
  t.check(events.some((e) => e.event === '$pageview'), 'hiding delivers the pageview');
  t.check(events.some((e) => e.event === 'json_loaded'), 'hiding delivers the paste');
  t.check(events.some((e) => e.event === 'feature_used' && e.properties?.feature === 'format_input'), 'hiding delivers Format');
});

const layoutProbe = () => {
  window.__privacyCLS = 0;
  const add = (entries) => {
    for (const e of entries) if (!e.hadRecentInput) window.__privacyCLS += e.value;
  };
  window.__privacyObserver = new PerformanceObserver((list) => add(list.getEntries()));
  window.__privacyObserver.observe({ type: 'layout-shift', buffered: true });
  window.__privacyLayout = () => {
    const notes = [...document.querySelectorAll('.consent-note [data-note]')].filter((el) => getComputedStyle(el).display !== 'none');
    return { notes: notes.map((el) => el.textContent), knob: getComputedStyle(document.querySelector('.switch-knob')).transform, state: document.documentElement.dataset.analytics };
  };
  addEventListener('DOMContentLoaded', () => { window.__privacyFirst = window.__privacyLayout(); }, { once: true });
};

for (const [state, pref, gpc] of [['unavailable', null, false], ['on', 'debug', false], ['off', 'off', false], ['browser', 'debug', true]]) {
  test(`cls2: mobile privacy page starts in ${state} without moving during hydration`, { mobile: true, context: { userAgent: ANALYTICS.context.userAgent, deviceScaleFactor: 3 } }, async (t) => {
    const a = await analytics(t, { pref, gpc });
    await t.context.addInitScript(layoutProbe);
    const warnings = [];
    t.page.on('console', (m) => { if (/hydrat|did not match|mismatch/i.test(m.text())) warnings.push(m.text()); });
    await t.open('/privacy', { tool: false });
    await t.page.waitForFunction(() => document.querySelector('.switch')?.disabled === false, null, POLL);
    await t.page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    if (state === 'on') await a.waitEvent('$pageview');
    const r = await t.page.evaluate(() => {
      for (const e of window.__privacyObserver.takeRecords()) if (!e.hadRecentInput) window.__privacyCLS += e.value;
      return { first: window.__privacyFirst, now: window.__privacyLayout(), cls: window.__privacyCLS };
    });
    t.check(r.first.state === state, 'the initial HTML selects the correct analytics state', r);
    t.check(r.first.notes.length === 1 && r.first.notes[0] === r.now.notes[0], 'the consent note stays the same through hydration', r);
    t.check(r.first.knob === r.now.knob, 'the switch does not move during hydration', r);
    t.check(r.now.state === state, 'the hydrated analytics state is correct', r);
    t.check(r.cls === 0, 'the mobile privacy page has zero layout shift', r.cls);
    t.check(!warnings.length, 'hydration produces no mismatch warnings', warnings);
  });
}

test('cls2: client navigation selects one correct privacy note', { mobile: true }, async (t) => {
  await analytics(t, { pref: null });
  await t.open('/about', { tool: false });
  await t.app.navigate(t.page, '/privacy');
  await t.page.waitForFunction(() => document.querySelector('.switch')?.disabled === false, null, POLL);
  const r = await t.page.evaluate(() => ({
    state: document.documentElement.dataset.analytics,
    notes: [...document.querySelectorAll('.consent-note [data-note]')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.getAttribute('data-note')),
  }));
  t.check(r.state === 'unavailable', 'client navigation selects the local-build state', r);
  t.check(r.notes.length === 1 && r.notes[0] === r.state, 'client navigation displays exactly its matching note', r);
});
