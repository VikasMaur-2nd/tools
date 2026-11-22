/*
 * "View in Tool Kumar" links: a public, stable format other sites use to open
 * a document (or two, compared) in the viewer at `/`.
 *
 *   /#a=<doc>                     open a document
 *   /#a=<doc>&b=<doc>             compare two documents (Compare opens by itself)
 *   /#a=<doc>&view=tree           open in a view: format, tree, table, graph, convert, compare
 *   /#a=<doc>&view=convert&to=go  open Convert with a target (lib/engine/targets.ts ids)
 *   /#a=<doc>&in=yaml             document a is YAML (yaml, csv, xml, toml): it opens as itself, its JSON in the views
 *   /#a=<doc>&view=convert&to=flatten&sep=%2F&arrays=dot&depth=2&escape=0
 *                                 flatten's (and unflatten's) options, only with those targets: sep (1 to 8
 *                                 characters, percent-encoded; no digits, backslashes or brackets), arrays (bracket,
 *                                 dot, keep), depth (1 to 3; 0, all levels, is the default), escape (0 or 1)
 *   /#handoff                     receive the documents by postMessage from window.opener
 *
 * <doc> is the text compressed with raw DEFLATE (RFC 1951) and encoded as
 * base64url without padding, or an http(s) URL (percent-encoded) to fetch the
 * document from. Everything lives in the fragment, which browsers never send to
 * a server. /integrate documents this and publishes copy-paste functions that
 * build links and do the handoff (app/(en)/integrate/snippets.ts): keep them in step.
 *
 * A link to flatten or unflatten opens with exactly its options: the defaults for those it leaves out (Share writes
 * only the others). They are for that visit: the reader's own saved options are back on the next one. Values that
 * aren't valid are ignored, never an error.
 */
import { TARGETS, isFlat } from './engine/targets';
import { SOURCE_FORMATS } from './engine/rules';
import type { FlatSettings, SourceFormat, View } from './engine/store';

const VIEWS: readonly View[] = ['format', 'tree', 'table', 'graph', 'convert', 'compare'];
/**
 * The largest document a tab opens, however it arrives: a file, a link or a handoff.
 * Links themselves have no length limit of ours (browsers have theirs: about 2 MB of
 * address in Chrome, 1 MB in Firefox); this guard stops a tiny link that inflates
 * to gigabytes while it decompresses.
 */
export const MAX_DOCUMENT = 300 * 1024 * 1024;
/**
 * The largest document a share link opens without asking. A link compresses its document,
 * hundreds of times for repetitive JSON: a 130 KB link (it fits a README badge) can hold
 * 100 MB of numbers, more values than a tab holds. Real links stay well under this (a 2 MB
 * link, the longest browsers open, of JSON compressed 10 times is 20 MB).
 */
export const LINK_DOCUMENT = 32 * 1024 * 1024;

/**
 * The longest link browsers open, measured on 2026-10-22 (Playwright 1.64; links clicked
 * and window.open): Firefox 1 MiB, Chromium and WebKit 2 MiB. Only used to warn: Tool Kumar
 * never refuses to make a link.
 */
const FIREFOX_LINK = 1024 * 1024;
const BROWSER_LINK = 2 * 1024 * 1024;
/**
 * The longest link Chrome and Edge take pasted into the address bar: they keep the first
 * 500 × 1024 characters of a paste and drop the rest (Chromium's kMaxClipboardTextLength,
 * chrome/browser/ui/omnibox/clipboard_utils.cc). Clicked, the same link opens. Firefox's
 * address bar takes a paste whole.
 */
export const PASTED_LINK = 500 * 1024;

/** Which browsers can open a link this many characters long ('click': all, but not pasted into Chrome's or Edge's address bar). */
export function linkReach(length: number): 'all' | 'click' | 'not-firefox' | 'none' {
  return length <= PASTED_LINK ? 'all' : length <= FIREFOX_LINK ? 'click' : length <= BROWSER_LINK ? 'not-firefox' : 'none';
}

/** Where a linked document comes from: its text, or a URL to fetch it from. */
export type LinkDoc = { text: string } | { url: string };

export interface LinkRequest {
  a?: LinkDoc;
  b?: LinkDoc;
  view?: View;
  /** Convert target id. */
  to?: string;
  /** What document a is (absent: JSON, or what its URL's file name says). */
  in?: Exclude<SourceFormat, 'json'>;
  /** Flatten's and unflatten's options (with those targets): a link writes those that aren't the defaults. */
  flat?: FlatSettings;
}

/** A document as a link carries it: still encoded (see `decodeDoc`), or a URL. */
export type LinkSource = { data: string } | { url: string };
/** What a fragment asks for: nothing (an ordinary anchor), a handoff, documents, or something broken. */
export type ParsedLink = null | 'handoff' | 'broken' | { a?: LinkSource; b?: LinkSource; view?: View; to?: string; in?: Exclude<SourceFormat, 'json'>; flat?: FlatSettings };

/** A format a link names for its document (`in`), other than JSON. */
const sourceIn = (v: unknown) => SOURCE_FORMATS.find((f): f is Exclude<SourceFormat, 'json'> => f !== 'json' && f === v);

/**
 * Flatten's options from a link or a handoff: the valid ones, the defaults for the rest (lib/convert/flat.ts
 * FLAT_DEFAULTS; a separator is 1 to 8 characters, none of them a digit, a backslash or a bracket).
 */
const flatOf = (sep: unknown, arrays: unknown, depth: unknown, escape: unknown): FlatSettings => ({
  sep: typeof sep === 'string' && /^[^\\[\]\d]{1,8}$/.test(sep) ? sep : '.',
  arrays: arrays === 'dot' || arrays === 'keep' ? arrays : 'bracket',
  escape: escape !== false,
  depth: depth === 1 || depth === 2 || depth === 3 ? depth : 0,
});

const DATA = /^[A-Za-z0-9_-]+$/;
const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** Reads a fragment (`location.hash`). */
export function parseLink(hash: string): ParsedLink {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h === 'handoff') return 'handoff';
  if (!/(?:^|&)[ab]=/.test(h)) return null;
  const p = new URLSearchParams(h);
  const doc = (k: 'a' | 'b'): LinkSource | undefined | false => {
    const v = p.get(k);
    if (v === null) return undefined;
    if (isUrl(v)) return { url: v };
    return DATA.test(v) && { data: v };
  };
  const a = doc('a');
  const b = doc('b');
  if (a === false || b === false || (!a && !b)) return 'broken';
  const view = VIEWS.find((v) => v === p.get('view'));
  const to = TARGETS.find((t) => t.id === p.get('to'))?.id;
  const fmt = a ? sourceIn(p.get('in')) : undefined;
  // (The separator decoded as written, not as a form: "+" is a plus, and a broken %-escape is left out.)
  let sep: string | undefined;
  try {
    sep = decodeURIComponent(/(?:^|&)sep=([^&]*)/.exec(h)?.[1] ?? '');
  } catch {}
  const depth = p.get('depth');
  const flat = to && isFlat(to) ? flatOf(sep, p.get('arrays'), depth?.length === 1 ? +depth : 0, p.get('escape') !== '0') : undefined;
  return { a, b, view, to, ...(fmt && { in: fmt }), ...(flat && { flat }) };
}

/** The fragment for a request, `#` included. Unknown views and targets are left out. */
export async function linkHash(r: LinkRequest): Promise<string> {
  const parts: string[] = [];
  for (const k of ['a', 'b'] as const) {
    const d = r[k];
    if (d) parts.push(`${k}=${'url' in d ? encodeURIComponent(d.url) : await encodeDoc(d.text)}`);
  }
  if (r.view && VIEWS.includes(r.view) && !(r.view === 'compare' && r.b)) parts.push(`view=${r.view}`);
  if (r.view === 'convert' && r.to && TARGETS.some((t) => t.id === r.to)) {
    parts.push(`to=${r.to}`);
    if (isFlat(r.to)) {
      const f = flatOf(r.flat?.sep, r.flat?.arrays, r.flat?.depth, r.flat?.escape);
      // (A separator that can't be percent-encoded, a lone surrogate, is left out.)
      try {
        if (f.sep !== '.') parts.push('sep=' + encodeURIComponent(f.sep));
      } catch {}
      if (f.arrays !== 'bracket') parts.push('arrays=' + f.arrays);
      if (f.depth) parts.push('depth=' + f.depth);
      if (!f.escape) parts.push('escape=0');
    }
  }
  if (r.a && sourceIn(r.in)) parts.push(`in=${r.in}`);
  return '#' + parts.join('&');
}

/** Raw DEFLATE, base64url without padding. */
export async function encodeDoc(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class LinkTooLarge extends Error {}

/** The text of an encoded document. Throws on broken data, and LinkTooLarge once it inflates past `max` bytes. */
export async function decodeDoc(data: string, max = MAX_DOCUMENT): Promise<string> {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const reader = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      void reader.cancel();
      throw new LinkTooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** Handoff messages, all tagged `toolkumar` so other postMessage traffic is ignored. */
export const HANDOFF_VERSION = 1;
export type HandoffReply = { toolkumar: 'ready'; version: number } | { toolkumar: 'opened' } | { toolkumar: 'error'; reason: 'invalid' | 'too_large' };

/** A handoff `open` message as a request, or the reason it can't be one (null: not a Tool Kumar message). */
export function readHandoff(data: unknown): LinkRequest | 'invalid' | 'too_large' | null {
  if (!data || typeof data !== 'object' || (data as { toolkumar?: unknown }).toolkumar !== 'open') return null;
  const { a, b, view, to, in: fmt, sep, arrays, depth, escape } = data as Record<string, unknown>;
  const ok = (v: unknown) => v === undefined || typeof v === 'string';
  if (!ok(a) || !ok(b) || (a === undefined && b === undefined)) return 'invalid';
  if (((a as string | undefined)?.length ?? 0) > MAX_DOCUMENT || ((b as string | undefined)?.length ?? 0) > MAX_DOCUMENT) return 'too_large';
  const target = TARGETS.find((t) => t.id === to)?.id;
  return {
    a: typeof a === 'string' ? { text: a } : undefined,
    b: typeof b === 'string' ? { text: b } : undefined,
    view: VIEWS.find((v) => v === view),
    to: target,
    ...(typeof a === 'string' && sourceIn(fmt) && { in: sourceIn(fmt) }),
    // (As a link's, but a number and a boolean.)
    ...(target && isFlat(target) && { flat: flatOf(sep, arrays, depth, escape) }),
  };
}
