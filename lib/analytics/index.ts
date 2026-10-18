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
/** Whether events are being collected on this page (./load.ts checks it before watching the editor). */
export const collecting = () => started;
/** Events before PostHog loads. Only kept in memory, and cleaned like every other event before sending. */
const queue: { event: string; props: Record<string, unknown>; at: Date }[] = [];

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

/** Turns analytics on or off in this browser (both PostHog and Vercel Web Analytics). */
export function setAnalyticsEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(PREF);
    else localStorage.setItem(PREF, 'off');
  } catch {}
  dispatchEvent(new Event(CHANGE));
  if (!on) {
    queue.length = 0;
    if (ph) {
      // Opt out first: stopping the recorder flushes its buffer, which must then be refused too.
      ph.opt_out_capturing();
      ph.stopSessionRecording();
    }
  } else if (ph) {
    ph.opt_in_capturing();
    ph.startSessionRecording();
  } else startAnalytics(0);
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

// ── Loading PostHog ──────────────────────────────────────────────────────────

async function boot() {
  const lazy = await import('./posthog');
  if (analyticsState() !== 'on') return;
  ph = lazy.initPostHog(TOKEN, INGEST);
  // Local testing (see .env.example): the instance is reachable from the console.
  if (pref() === 'debug') (window as Window & { posthog?: Ph }).posthog = ph;
  send = lazy.sender(ph);
  for (const q of queue.splice(0)) send(q.event, q.props, q.at);
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
