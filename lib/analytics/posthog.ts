/**
 * PostHog, configured so that no document content can leave the browser.
 * Loaded on demand by ./index.ts (never on the critical path), only when a
 * project token is configured and the visitor hasn't turned analytics off.
 *
 * Session replay is a DOM recording, so it gets three layers:
 *  1. Every element that shows document data or facts about it (both editors,
 *     file names, the whole viewer, the tree path, the table breadcrumbs, the
 *     status bar's messages, sizes and counts, toasts, the file input) has the
 *     `ph-no-capture` class (PRIVATE in ./index.ts): the recorder replaces it
 *     with an empty box of the same size and never reads inside it. The site's
 *     own text (labels, menus, articles) shows as it is.
 *  2. Everything typed into a field is masked to '*' in the browser, and so
 *     are attributes that can carry it (value, download, data-*); a control
 *     whose tooltip mentions the document has PRIVATE_LABELS.
 *  3. No network bodies, headers or console logs, no canvas.
 * Events go through `beforeSend`: only our own allow-listed events and a few
 * SDK ones survive, with URL fragments and query strings removed.
 */
import posthog, { type CaptureResult, type PostHog, type PostHogConfig } from 'posthog-js';
import { clean, loadedProps, type RawLoad } from './events';
import { beforeSend, cleanUrl, maskAttribute } from './redact';
import { applicationScripts } from './exceptions';

/** Same-origin path that next.config.ts rewrites to the ingestion host. */
const RELAY = '/relay';

/** PostHog's app (for the toolbar's links): derived for US/EU Cloud, or set for self-hosting. */
function uiHost(ingest: string) {
  if (process.env.NEXT_PUBLIC_POSTHOG_UI_HOST) return process.env.NEXT_PUBLIC_POSTHOG_UI_HOST;
  const m = /^https:\/\/(us|eu)\.i\.posthog\.com/.exec(ingest);
  return m ? `https://${m[1]}.posthog.com` : undefined;
}

export function initPostHog(token: string, ingest: string): PostHog {
  const config: Partial<PostHogConfig> = {
    api_host: RELAY,
    ui_host: uiHost(ingest),
    defaults: '2026-05-30',
    // Anonymous only: a random ID in localStorage, no cookies, no person profiles.
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    // Payloads stay readable in DevTools, so anyone can check them for their own data.
    disable_compression: true,
    // Page views and leaves (SPA route changes included), web vitals and heatmap clicks (x/y only).
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_performance: { web_vitals: true, network_timing: false },
    capture_heatmaps: true,
    // Off, whatever the project settings say: these read element text or the clipboard.
    autocapture: false,
    capture_dead_clicks: false,
    rageclick: false,
    // Our early browser listeners call captureException(), covering startup errors too.
    // Keep SDK listeners off to avoid duplicates, and never capture console.error.
    capture_exceptions: false,
    error_tracking: { exception_steps: { enabled: false } },
    enable_recording_console_log: false,
    // PostHog Logs would send raw console output (error messages included) past every filter here.
    logs: { captureConsoleLogs: false, beforeSend: () => null },
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_capture_url_hashes: true,
    mask_personal_data_properties: true,
    custom_personal_data_properties: ['a', 'b'],
    // Features we don't use: nothing extra to download.
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_feature_flags: true,
    before_send: (e: CaptureResult | null) => beforeSend(e, e?.event === '$exception' ? applicationScripts() : undefined),
    session_recording: {
      blockClass: 'ph-no-capture',
      blockSelector: 'input[type="file"]',
      // Every field a visitor types into is masked; dropdowns only offer the site's own choices.
      maskAllInputs: false,
      maskInputOptions: {
        color: true, date: true, 'datetime-local': true, email: true, month: true, number: true, range: true, search: true,
        tel: true, text: true, time: true, url: true, week: true, textarea: true, password: true, select: false,
      },
      maskAttributeFn: (name: string, value: string, el?: Element) => maskAttribute(name, value, el),
      recordHeaders: false,
      recordBody: false,
      captureCanvas: { recordCanvas: false },
      collectFonts: false,
      recordCrossOriginIframes: false,
      compress_events: false,
      // Page URLs in the recording keep their path only; network entries are dropped.
      maskCapturedNetworkRequestFn: (req) => (req.entryType || req.initiatorType ? null : { ...req, name: req.name && cleanUrl(req.name) }),
    },
  };
  posthog.init(token, config);
  const html = document.documentElement;
  posthog.register({
    app_locale: html.lang || 'en',
    display_mode: matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    color_scheme: (html.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light',
    pointer: matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
  });
  return posthog;
}

/** Sends one queued or live event: raw document facts become ranges, then the allow-list applies. */
export function sender(ph: PostHog) {
  return (event: string, props: Record<string, unknown>, at?: Date) => {
    const p = clean(event, event === 'json_loaded' ? loadedProps(props as unknown as RawLoad) : props);
    if (p) ph.capture(event, p, at ? { timestamp: at } : undefined);
  };
}
