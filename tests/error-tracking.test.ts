import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Run the real startup/opt-out logic with a deferred SDK and browser events. */
function session() {
  const target = new EventTarget();
  const storage = new Map<string, string>();
  const timers: (() => void)[] = [];
  const reports: { error: unknown; props: { error_source: string } }[] = [];
  let clock = 0;
  let loads = 0;
  const ph = {
    captureException: (error: unknown, props: { error_source: string }) => reports.push({ error, props }),
    opt_out_capturing() {}, stopSessionRecording() {}, opt_in_capturing() {}, startSessionRecording() {},
  };
  const sdk = { initPostHog: () => { loads++; return ph; }, sender: () => () => {} };
  const exports: {
    startAnalytics?: () => void;
    setAnalyticsEnabled?: (on: boolean) => void;
    reportError?: (error: unknown, source?: string) => void;
  } = {};
  const source = readFileSync(resolve(process.cwd(), 'lib/analytics/index.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const navigator = { userAgent: 'Browser', webdriver: false, globalPrivacyControl: false };
  const window = { setTimeout: (fn: () => void) => timers.push(fn), requestIdleCallback: (fn: () => void) => fn() };
  runInNewContext(js, {
    exports, require: () => sdk, window, navigator, Event, Date,
    performance: { now: () => clock }, requestIdleCallback: window.requestIdleCallback,
    document: { readyState: 'loading' }, location: { hostname: 'tools.vikasmaur.com' },
    process: { env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_test', NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' } },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
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
  return { api: exports as Required<typeof exports>, reports, ready, fire, navigator, loads: () => loads };
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
