/**
 * Redaction applied in the browser before anything reaches PostHog. Pure
 * functions (tested in tests/analytics.test.ts); lib/analytics/posthog.ts wires
 * them into the SDK.
 */
import { EVENT_PROPS } from './events';
import { cleanUrl } from './url';
import { exceptionProps } from './exceptions';
import { PRIVATE_LABELS } from './index';

export { cleanUrl };

/** PostHog's own events that we allow; exceptions have a separate, stricter sanitizer. */
const SDK_EVENTS = new Set(['$pageview', '$pageleave', '$web_vitals', '$$heatmap', '$snapshot', '$opt_in', '$exception']);

const allowedEvent = (name: string) => SDK_EVENTS.has(name) || name in EVENT_PROPS;

/** Properties that may hold element text or attributes; we never want them, whatever enables them. */
const DROP_PROPS = new Set(['$elements', '$elements_chain', '$el_text', '$external_click_url', '$copy_type', '$selected_content',
  // Search terms PostHog reads from a search engine's referrer.
  'ph_keyword', '$initial_ph_keyword', '$session_entry_ph_keyword']);

type Props = Record<string, unknown>;

/**
 * Cleans every URL-like string, nested objects included (web vitals carry the
 * page URL a level down), and URL-like keys too (heatmap data is keyed by URL;
 * entries whose keys clean to the same URL are merged).
 */
function cleanValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return cleanUrl(v);
  if (!v || typeof v !== 'object' || depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => cleanValue(x, depth + 1));
  const out: Props = {};
  for (const [key, x] of Object.entries(v)) {
    if (DROP_PROPS.has(key)) continue;
    const k = cleanUrl(key);
    const c = cleanValue(x, depth + 1);
    const prev = out[k];
    out[k] = Array.isArray(prev) && Array.isArray(c) ? [...prev, ...c] : c;
  }
  return out;
}

const cleanProps = (props: Props) => cleanValue(props, 0) as Props;

/** Minimal shape of PostHog's CaptureResult that we touch. */
export interface CaptureLike {
  event: string;
  properties?: Props;
  $set?: Props;
  $set_once?: Props;
  $unset?: string[];
}

/** `before_send`: drop events we don't send on purpose, strip URLs everywhere else. */
export function beforeSend<T extends CaptureLike>(e: T | null, scripts: ReadonlySet<string> = new Set()): T | null {
  if (!e || !allowedEvent(e.event)) return null;
  if (e.event === '$exception') {
    const properties = exceptionProps(e.properties ?? {}, scripts);
    if (!properties) return null;
    const out = { ...e, properties };
    delete out.$set;
    delete out.$set_once;
    delete out.$unset;
    return out;
  }
  // Recordings: their URLs are already masked by the recorder config; leave the payload alone.
  if (e.event === '$snapshot') return e;
  const out = { ...e };
  if (e.properties) out.properties = cleanProps(e.properties);
  if (e.$set) out.$set = cleanProps(e.$set);
  if (e.$set_once) out.$set_once = cleanProps(e.$set_once);
  return out;
}

/** Same as rrweb's own masking: every non-space character becomes '*'. */
const stars = (s: string) => s.replace(/\S/g, '*');

/**
 * Readable attributes that hold the site's own wording (tooltips, accessible
 * names, placeholders): kept, like the text, unless the element is marked
 * PRIVATE_LABELS (its tooltip mentions the document, e.g. "34% smaller").
 * Attributes of elements that show the document are never recorded (PRIVATE).
 */
const LABEL_ATTRS = new Set([
  'title', 'alt', 'placeholder', 'label', 'data-tip',
  'aria-label', 'aria-description', 'aria-valuetext', 'aria-placeholder', 'aria-roledescription', 'aria-keyshortcuts',
]);

/** Masked: what a visitor typed (value, except a dropdown's own options), a file name to save (download), embedded documents. */
const DATA_ATTRS = new Set(['value', 'download', 'srcdoc', 'content']);

/** Data attributes the page's CSS needs to draw a recording correctly. */
const SAFE_DATA = new Set(['data-theme', 'data-doc', 'data-tip-up', 'data-a', 'data-state', 'data-side']);

/**
 * `session_recording.maskAttributeFn`: keeps the attributes that shape the page
 * (class, style, role, ARIA states, SVG geometry…) and the site's labels, and
 * masks the ones that can carry a visitor's data. Links keep their path; data:,
 * blob: and javascript: URLs, query strings and fragments never survive.
 */
export function maskAttribute(name: string, value: string, el?: Element | null): string {
  const n = name.toLowerCase();
  if (LABEL_ATTRS.has(n)) return el?.closest?.(`.${PRIVATE_LABELS}`) ? stars(value) : value;
  if (DATA_ATTRS.has(n)) return n === 'value' && (el?.tagName === 'OPTION' || el?.tagName === 'SELECT') ? value : stars(value);
  if (n.startsWith('data-')) return SAFE_DATA.has(n) ? value : stars(value);
  if (n === 'href' || n === 'src' || n === 'action' || n === 'poster' || n === 'xlink:href') {
    const v = value.trim();
    if (/^(?:data|blob|javascript|file):/i.test(v)) return '';
    if (/^https?:\/\//i.test(v)) return cleanUrl(v);
    return v.split(/[?#]/)[0];
  }
  if (n === 'srcset') return '';
  return value;
}
