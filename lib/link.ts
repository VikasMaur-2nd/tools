/*
 * "View in Tool Kumar" links: a public, stable format other sites use to open
 * a document (or two, compared) in the viewer at `/`.
 *
 *   /#a=<doc>                     open a document
 *   /#a=<doc>&b=<doc>             compare two documents (Compare opens by itself)
 *   /#a=<doc>&view=tree           open in a view: format, tree, table, graph, convert, compare
 *   /#a=<doc>&view=convert&to=go  open Convert with a target (lib/engine/targets.ts ids)
 *   /#handoff                     receive the documents by postMessage from window.opener
 *
 * <doc> is the text compressed with raw DEFLATE (RFC 1951) and encoded as
 * base64url without padding, or an http(s) URL (percent-encoded) to fetch the
 * document from. Everything lives in the fragment, which browsers never send to
 * a server. public/toolkumar.js builds these links for other sites, and
 * /resources/view-in-tool-kumar documents them: keep all three in step.
 */
import { TARGETS } from './engine/targets';
import type { View } from './engine/store';

export const VIEWS: readonly View[] = ['format', 'tree', 'table', 'graph', 'convert', 'compare'];
/** Links we create stay below this many characters (chat apps and browsers cut longer URLs); bigger documents use the handoff. */
export const MAX_LINK = 60_000;
/** A document decompressed from a link may not grow past this (a tiny link can inflate to gigabytes). */
export const MAX_LINK_TEXT = 20_000_000;
/** A document received by handoff may not be longer than this, like a file. */
export const MAX_HANDOFF_TEXT = 300 * 1024 * 1024;

/** Where a linked document comes from: its text, or a URL to fetch it from. */
export type LinkDoc = { text: string } | { url: string };

export interface LinkRequest {
  a?: LinkDoc;
  b?: LinkDoc;
  view?: View;
  /** Convert target id. */
  to?: string;
}

/** A document as a link carries it: still encoded (see `decodeDoc`), or a URL. */
export type LinkSource = { data: string } | { url: string };
/** What a fragment asks for: nothing (an ordinary anchor), a handoff, documents, or something broken. */
export type ParsedLink = null | 'handoff' | 'broken' | { a?: LinkSource; b?: LinkSource; view?: View; to?: string };

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
  return { a, b, view, to };
}

/** The fragment for a request, `#` included. Unknown views and targets are left out. */
export async function linkHash(r: LinkRequest): Promise<string> {
  const parts: string[] = [];
  for (const k of ['a', 'b'] as const) {
    const d = r[k];
    if (d) parts.push(`${k}=${'url' in d ? encodeURIComponent(d.url) : await encodeDoc(d.text)}`);
  }
  if (r.view && VIEWS.includes(r.view) && !(r.view === 'compare' && r.b)) parts.push(`view=${r.view}`);
  if (r.view === 'convert' && r.to && TARGETS.some((t) => t.id === r.to)) parts.push(`to=${r.to}`);
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
export async function decodeDoc(data: string, max = MAX_LINK_TEXT): Promise<string> {
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
  const { a, b, view, to } = data as Record<string, unknown>;
  const ok = (v: unknown) => v === undefined || typeof v === 'string';
  if (!ok(a) || !ok(b) || (a === undefined && b === undefined)) return 'invalid';
  if (((a as string | undefined)?.length ?? 0) > MAX_HANDOFF_TEXT || ((b as string | undefined)?.length ?? 0) > MAX_HANDOFF_TEXT) return 'too_large';
  return {
    a: typeof a === 'string' ? { text: a } : undefined,
    b: typeof b === 'string' ? { text: b } : undefined,
    view: VIEWS.find((v) => v === view),
    to: TARGETS.find((t) => t.id === to)?.id,
  };
}
