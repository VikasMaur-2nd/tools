import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Run the real startup/opt-out logic with a deferred SDK and browser events. */
function session(visibilityState = 'visible', prerendering = false, storageFails = false) {
  const target = new EventTarget();
  const storage = new Map<string, string>();
  // (A private window or a full quota: reading works, writing throws.)
  const write = (fn: () => void) => {
    if (storageFails) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    fn();
  };
  const timers: (() => void)[] = [];
  const reports: { error: unknown; props: { error_source: string } }[] = [];
  let clock = 0;
  let loads = 0;
  const calls: string[] = [];
  const sdkState = { optedOut: false };
  const ph = {
    captureException: (error: unknown, props: { error_source: string }) => reports.push({ error, props }),
    has_opted_out_capturing: () => sdkState.optedOut,
    opt_out_capturing: () => calls.push('opt_out'), stopSessionRecording: () => calls.push('stop_recording'),
    opt_in_capturing: () => calls.push('opt_in'), startSessionRecording: () => calls.push('start_recording'),
  };
  const sent: string[] = [];
  const sdk = {
    initPostHog: (_token: string, _ingest: string, seenHidden?: boolean) => {
      loads++;
      if (seenHidden) sent.push('$pageview');
      return ph;
    },
    sender: () => (event: string) => { sent.push(event); },
  };
  const exports: {
    startAnalytics?: () => void;
    setAnalyticsEnabled?: (on: boolean) => void;
    reportError?: (error: unknown, source?: string) => void;
    track?: (event: string, props: Record<string, unknown>) => void;
    analyticsAllowed?: () => boolean;
    analyticsState?: () => string;
  } = {};
  const source = readFileSync(resolve(process.cwd(), 'lib/analytics/index.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const navigator = { userAgent: 'Browser', webdriver: false, globalPrivacyControl: false };
  const window = { setTimeout: (fn: () => void) => timers.push(fn), requestIdleCallback: (fn: () => void) => fn() };
  const page = new EventTarget();
  const document = { readyState: 'loading', visibilityState, prerendering, addEventListener: page.addEventListener.bind(page) };
  runInNewContext(js, {
    exports, require: () => sdk, window, navigator, Event, Date,
    performance: { now: () => clock }, requestIdleCallback: window.requestIdleCallback,
    document, location: { hostname: 'tools.vikasmaur.com' },
    process: { env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_test', NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' } },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => write(() => storage.set(k, v)),
      removeItem: (k: string) => write(() => storage.delete(k)),
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  const fire = (type: string, props = {}) => target.dispatchEvent(Object.assign(new Event(type), props));
  const ready = async () => {
    fire('load');
    clock += 5000;
    for (const tick of timers.splice(0)) tick();
    // The dynamic import is compiled into a promise and a deferred require.
    await new Promise<void>((done) => setImmediate(done));
  };
  const settle = () => new Promise<void>((done) => setImmediate(done));
  const hide = async () => {
    document.visibilityState = 'hidden';
    document.prerendering = false;
    page.dispatchEvent(new Event('visibilitychange'));
    await settle();
  };
  const show = async () => {
    document.visibilityState = 'visible';
    document.prerendering = false;
    page.dispatchEvent(new Event('visibilitychange'));
    await settle();
  };
  return { api: exports as Required<typeof exports>, reports, ready, fire, hide, show, navigator, loads: () => loads, calls, sdkState, sent, storage };
}

test('early errors and rejections wait for the SDK, and duplicate errors report once', async () => {
  const s = session();
  s.api.startAnalytics();
  const error = new TypeError('private input');
  s.fire('error', { error });
  s.fire('error', { error });
  s.fire('unhandledrejection', { reason: 'private rejected value' });
  assert.equal(s.reports.length, 0);
  await s.ready();
  assert.equal(s.loads(), 1);
  assert.equal(s.reports.length, 2);
  assert.equal(s.reports[0].props.error_source, 'unhandled_error');
  assert.equal(s.reports[1].props.error_source, 'unhandled_rejection');
  s.api.reportError(error, 'react_boundary');
  assert.equal(s.reports.length, 2);
});

test('privacy mode clears queued errors and prevents loading or later reporting', async () => {
  const s = session();
  s.api.startAnalytics();
  s.fire('error', { error: new Error('private input') });
  s.api.setAnalyticsEnabled(false);
  await s.ready();
  s.fire('unhandledrejection', { reason: new Error('another private input') });
  assert.equal(s.loads(), 0);
  assert.equal(s.reports.length, 0);
});

test('browser opt-out prevents error collection', async () => {
  const s = session();
  s.navigator.globalPrivacyControl = true;
  s.api.startAnalytics();
  s.api.reportError(new Error('private input'));
  await s.ready();
  assert.equal(s.loads(), 0);
  assert.equal(s.reports.length, 0);
});

test('error storms are capped and resource errors are ignored', async () => {
  const s = session();
  s.api.startAnalytics();
  await s.ready();
  s.fire('error', { message: 'private resource URL' });
  for (let i = 0; i < 50; i++) s.fire('error', { error: new Error('private input') });
  assert.equal(s.reports.length, 10);
});

test('error collection can resume after opting out during SDK startup', async () => {
  const s = session();
  s.api.startAnalytics();
  s.api.setAnalyticsEnabled(false);
  await s.ready();
  s.api.setAnalyticsEnabled(true);
  await s.ready();
  s.api.reportError(new Error('private input'), 'conversion');
  assert.equal(s.loads(), 1);
  assert.equal(s.reports.length, 1);
});

test('turning analytics off in another tab stops this one', async () => {
  const s = session();
  s.api.startAnalytics();
  await s.ready();
  s.fire('storage', { key: 'jf:analytics', newValue: 'off' });
  assert.deepEqual(s.calls, ['opt_out', 'stop_recording']);
});

test('turning analytics off holds on this page when the browser refuses to store it', async () => {
  const s = session('visible', false, true);
  s.api.startAnalytics();
  s.api.track('feature_used', { feature: 'copy_output' });
  s.api.setAnalyticsEnabled(false);
  assert.equal(s.storage.get('jf:analytics'), undefined, 'storage refused it');
  // Vercel Web Analytics asks analyticsAllowed() before every page view.
  assert.equal(s.api.analyticsAllowed(), false);
  assert.equal(s.api.analyticsState(), 'off');
  s.api.track('feature_used', { feature: 'copy_input' });
  s.api.reportError(new Error('private input'));
  await s.ready();
  assert.equal(s.loads(), 0, 'PostHog never starts');
  assert.equal(s.reports.length, 0);
  assert.deepEqual(s.sent, []);
  // And back on, still without storage.
  s.api.setAnalyticsEnabled(true);
  assert.equal(s.api.analyticsAllowed(), true);
  await s.ready();
  assert.equal(s.loads(), 1);
});

test('turning analytics on holds on this page when the browser refuses to forget the old choice', async () => {
  const s = session('visible', false, true);
  s.storage.set('jf:analytics', 'off');
  assert.equal(s.api.analyticsAllowed(), false);
  s.api.setAnalyticsEnabled(true);
  assert.equal(s.storage.get('jf:analytics'), 'off', 'storage refused it');
  assert.equal(s.api.analyticsAllowed(), true);
  assert.equal(s.api.analyticsState(), 'on');
  await s.ready();
  assert.equal(s.loads(), 1);
});

test('a choice made in another tab replaces the one kept on this page', async () => {
  const s = session();
  s.api.setAnalyticsEnabled(false);
  assert.equal(s.api.analyticsAllowed(), false);
  s.storage.delete('jf:analytics');
  s.fire('storage', { key: 'jf:analytics', newValue: null });
  assert.equal(s.api.analyticsAllowed(), true);
  s.storage.set('jf:analytics', 'off');
  s.fire('storage', { key: 'jf:analytics', newValue: 'off' });
  assert.equal(s.api.analyticsAllowed(), false);
});

test("PostHog's opt-out stored by an earlier page gives way to the site's choice", async () => {
  const s = session();
  s.sdkState.optedOut = true;
  s.api.startAnalytics();
  await s.ready();
  assert.deepEqual(s.calls, ['opt_in']);
});

test('actions while analytics is off are never sent, even after turning it back on', async () => {
  const s = session();
  s.api.startAnalytics();
  s.api.setAnalyticsEnabled(false);
  s.api.track('feature_used', { feature: 'copy_output' });
  s.api.setAnalyticsEnabled(true);
  await s.ready();
  assert.deepEqual(s.sent, []);
});

test("the privacy page's inline copy of the analytics state gives the same answers on its own", () => {
  const source = readFileSync(resolve(process.cwd(), 'lib/analytics/index.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { stateFrom?: (configured: boolean) => string } = {};
  runInNewContext(js, { exports, require: () => ({}), process: { env: {} } });
  const inline = String(exports.stateFrom);
  const cases: [string, { pref?: string; host?: string; ua?: string; gpc?: boolean; dnt?: string; webdriver?: boolean; configured?: boolean }, string][] = [
    ['on', {}, 'on'],
    ['turned off here', { pref: 'off' }, 'off'],
    ['not configured', { configured: false }, 'unavailable'],
    ['Global Privacy Control', { gpc: true }, 'browser'],
    ['Do Not Track', { dnt: '1' }, 'browser'],
    ['another host', { host: 'preview.vercel.app' }, 'unavailable'],
    ['a crawler', { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }, 'unavailable'],
    ['automation', { webdriver: true }, 'unavailable'],
    ['local testing', { pref: 'debug', host: 'localhost' }, 'on'],
  ];
  for (const [what, c, want] of cases) {
    // Only browser globals: the inline script has nothing else.
    const globals = {
      localStorage: { getItem: () => c.pref ?? null },
      navigator: { userAgent: c.ua ?? 'Mozilla/5.0', webdriver: c.webdriver ?? false, globalPrivacyControl: c.gpc ?? false, doNotTrack: c.dnt ?? null },
      window: {},
      location: { hostname: c.host ?? 'tools.vikasmaur.com' },
    };
    assert.equal(runInNewContext(`(${inline})(${c.configured ?? true})`, globals), want, what);
  }
});

test('a page that is hidden loads PostHog at once and sends what was queued', async () => {
  const s = session();
  s.api.startAnalytics();
  s.api.track('feature_used', { feature: 'copy_output' });
  assert.equal(s.loads(), 0);
  await s.hide();
  assert.equal(s.loads(), 1);
  // PostHog itself skips the page view of a hidden page; this one was seen, so it is sent.
  assert.deepEqual(s.sent, ['$pageview', 'feature_used']);
});

test('a tab opened in the background loads PostHog without claiming a page view', async () => {
  const s = session('hidden');
  s.api.startAnalytics();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(s.loads(), 1);
  assert.deepEqual(s.sent, []);
});

test('a page Chrome is prerendering waits, then counts once the visitor opens and leaves it', async () => {
  const s = session('hidden', true);
  s.api.startAnalytics();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(s.loads(), 0);
  await s.show();
  await s.hide();
  assert.equal(s.loads(), 1);
  assert.deepEqual(s.sent, ['$pageview']);
});

test('hiding the page loads nothing once analytics is off', async () => {
  const s = session();
  s.api.startAnalytics();
  s.api.setAnalyticsEnabled(false);
  await s.hide();
  assert.equal(s.loads(), 0);
  const optedOut = session();
  optedOut.navigator.globalPrivacyControl = true;
  optedOut.api.startAnalytics();
  await optedOut.hide();
  assert.equal(optedOut.loads(), 0);
});
