/**
 * Product analytics, the always-loaded half: about 1.5 KB that queues events
 * until PostHog (./posthog.ts, its own chunk, with the allow-lists, rounding
 * and redaction) has loaded, a while after the page is idle. Nothing loads,
 * and nothing is sent, when the visitor turned analytics off (privacy page),
 * the browser sends Global Privacy Control or Do Not Track, the page is driven
 * by automation, no project token is configured, or the host isn't the
 * production site.
 */
import type { EventName, Events, Via } from './events';
import type { ErrorSource } from './exceptions';

/**
 * Class for every element that shows document content (editors, file names,
 * outputs, paths). Session replay records it as an empty box and never reads
 * inside it; autocapture (off anyway) ignores it.
 */
export const PRIVATE = 'ph-no-capture';

const TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? '';
const INGEST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '';
const SITE_HOST = 'tools.vikasmaur.com';
/** 'off' = the visitor turned analytics off; 'debug' = send from any host (local testing). */
const PREF = 'jf:analytics';
const CHANGE = 'jf:analytics-change';
/** How long the visitor has to pause before PostHog loads. */
const QUIET = 2500;
const BOTS = /bot\/|bot;|crawl|spider|slurp|lighthouse|headless|prerender|pagespeed/i;

type Lazy = typeof import('./posthog');
type Ph = ReturnType<Lazy['initPostHog']>;
let ph: Ph | null = null;
/** Cleans an event (./events.ts allow-lists) and sends it; set once PostHog has loaded. */
let send: ((event: string, props: Record<string, unknown>, at?: Date) => void) | null = null;
let started = false;
let booting = false;
/** Whether events are being collected on this page (./load.ts checks it before watching the editor). */
export const collecting = () => started;
/** Events before PostHog loads. Only kept in memory, and cleaned like every other event before sending. */
const queue: { event: string; props: Record<string, unknown>; at: Date }[] = [];
const errorQueue: { error: unknown; source: ErrorSource }[] = [];
const reportedErrors = new WeakSet<object>();
let errorWindow = 0;
let errorCount = 0;

const pref = () => {
  try {
    return localStorage.getItem(PREF);
  } catch {
    return null;
  }
};

/** The browser asks sites not to track (Global Privacy Control, or the older Do Not Track). */
export function browserOptOut(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1' || n.msDoNotTrack === '1';
}

export type AnalyticsState = 'on' | 'off' | 'browser' | 'unavailable';

/** What the privacy page shows: on, turned off here, refused by the browser, or not set up on this host. */
export function analyticsState(): AnalyticsState {
  if (!TOKEN || !INGEST) return 'unavailable';
  const p = pref();
  if (p === 'off') return 'off';
  if (browserOptOut()) return 'browser';
  // PostHog drops crawler, audit and automation traffic anyway: don't download it for them.
  if (p !== 'debug' && (location.hostname !== SITE_HOST || navigator.webdriver || BOTS.test(navigator.userAgent))) return 'unavailable';
  return 'on';
}

/** Calls `cb` when the analytics choice changes (this tab or another). */
export function onAnalyticsChange(cb: () => void) {
  addEventListener(CHANGE, cb);
  addEventListener('storage', cb);
  return () => {
    removeEventListener(CHANGE, cb);
    removeEventListener('storage', cb);
  };
}

/** Stops collecting on this page: drops queued events, opts PostHog out and stops the recording. */
function stop() {
  queue.length = 0;
  errorQueue.length = 0;
  if (ph) {
    // Opt out first: stopping the recorder flushes its buffer, which must then be refused too.
    ph.opt_out_capturing();
    ph.stopSessionRecording();
  }
}

/** Turns analytics on or off in this browser (both PostHog and Vercel Web Analytics). */
export function setAnalyticsEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(PREF);
    else localStorage.setItem(PREF, 'off');
  } catch {}
  dispatchEvent(new Event(CHANGE));
  if (!on) stop();
  else if (ph) {
    ph.opt_in_capturing();
    ph.startSessionRecording();
  } else if (started) void boot().catch(() => {});
  else startAnalytics(0);
}

/** For Vercel Web Analytics' beforeSend: false once the visitor turned analytics off. */
export const analyticsAllowed = () => pref() !== 'off';

// ── How an action was triggered ──────────────────────────────────────────────

let lastInput: { via: Via; at: number } = { via: 'other', at: 0 };
let forced: Via | null = null;

const via = (): Via => forced ?? (performance.now() - lastInput.at < 1500 ? lastInput.via : 'other');

/** Runs `fn` with its events attributed to `v` (the command palette). */
export function withVia<T>(v: Via, fn: () => T): T {
  const prev = forced;
  forced = v;
  try {
    return fn();
  } finally {
    forced = prev;
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** Queues or sends an event as is (it is cleaned in ./posthog.ts). For ./load.ts and `track`. */
export function emit(event: string, props: Record<string, unknown>) {
  if (!started) return;
  const p = { via: via(), ...props };
  if (send) send(event, p);
  else if (queue.length < 100) queue.push({ event, props: p, at: new Date() });
}

type Auto = 'via';
type Props<K extends EventName> = Omit<Events[K], Extract<keyof Events[K], Auto>> & Partial<Pick<Events[K], Extract<keyof Events[K], Auto>>>;

/** Records one event. Properties outside the event's allow-list, or that aren't plain tokens, are dropped before sending. */
export function track<K extends Exclude<EventName, 'json_loaded'>>(event: K, props: Props<K>) {
  emit(event, props);
}

/**
 * PostHog Error Tracking, through its captureException API. Errors wait in memory
 * for the idle-loaded SDK; before_send rebuilds their payload without any message
 * or document data. Bound volume to 10 per minute and report an Error object once.
 */
export function reportError(error: unknown, source: ErrorSource = 'manual') {
  try {
    if (typeof window === 'undefined' || analyticsState() !== 'on') return;
    if (!started) startAnalytics(0);
    if (error && typeof error === 'object') {
      if (reportedErrors.has(error)) return;
      reportedErrors.add(error);
    }
    const now = Date.now();
    if (now - errorWindow >= 60_000) { errorWindow = now; errorCount = 0; }
    if (errorCount >= 10) return;
    errorCount++;
    if (ph) ph.captureException(error, { error_source: source });
    else if (errorQueue.length < 10) errorQueue.push({ error, source });
  } catch {
    // Error reporting must never break the application or recursively report itself.
  }
}

// ── Loading PostHog ──────────────────────────────────────────────────────────

async function boot() {
  if (ph || booting) return;
  booting = true;
  try {
    const lazy = await import('./posthog');
    if (analyticsState() !== 'on') return;
    ph = lazy.initPostHog(TOKEN, INGEST);
    // PostHog keeps its own opt-out from an earlier page; the site's choice (now on) is what counts.
    if (ph.has_opted_out_capturing()) ph.opt_in_capturing();
    // Local testing (see .env.example): the instance is reachable from the console.
    if (pref() === 'debug') (window as Window & { posthog?: Ph }).posthog = ph;
    send = lazy.sender(ph);
    for (const q of queue.splice(0)) send(q.event, q.props, q.at);
    for (const q of errorQueue.splice(0)) ph.captureException(q.error, { error_source: q.source });
  } finally {
    booting = false;
  }
}

/**
 * Starts analytics for this page view: events are queued from now on, and
 * PostHog itself loads at least `delay` ms after the page has loaded, once the
 * visitor has paused (no click or key for QUIET ms) and the browser is idle.
 * Starting it costs a few long tasks on a slow phone (the SDK, then the first
 * replay snapshot), so they never land on the first paint or mid-typing.
 */
export function startAnalytics(delay = 3000) {
  if (started || typeof window === 'undefined' || analyticsState() !== 'on') return;
  started = true;
  // Turned off in another tab: stop here too.
  addEventListener('storage', (e) => {
    if (e.key === PREF && e.newValue === 'off') stop();
  });
  // Installed synchronously before hydration; SDK autocapture stays off to avoid duplicates.
  addEventListener('error', (e: ErrorEvent) => {
    // Resource-load failures have no Error and may name a private URL. Ignore those.
    if (e.error != null) reportError(e.error, 'unhandled_error');
  });
  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => reportError(e.reason, 'unhandled_rejection'));
  const input = (e: Event) => {
    lastInput = { via: e.type === 'keydown' ? 'keyboard' : 'pointer', at: performance.now() };
  };
  addEventListener('pointerdown', input, { capture: true, passive: true });
  addEventListener('keydown', input, { capture: true, passive: true });
  const go = () => {
    const t0 = performance.now();
    const run = () => void boot().catch(() => {});
    const tick = () => {
      const now = performance.now();
      if (now - t0 < delay || now - lastInput.at < QUIET) return void window.setTimeout(tick, 500);
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
      else run();
    };
    tick();
  };
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}
