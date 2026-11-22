/**
 * Schemas a schema refers to by URL (a remote `$ref`), fetched only when the visitor asks (the Schema view's Fetch
 * referenced schemas: lib/schema/controller.ts fetchRemote). Each URL is fetched once, without its fragment and
 * without cookies, read up to a size limit and checked to be JSON. Why one failed says what the visitor can do,
 * in the words the app uses when it fetches a document (lib/engine/engine.ts fetchText, fetchFailure).
 */
import { BOOL, OBJ, parse } from '../json/parser';

/** The largest schema fetched (bytes). */
export const REMOTE_MAX_BYTES = 5 * 1024 * 1024;
/** URLs fetched by one click at most (the rest on the next one). */
export const REMOTE_MAX_COUNT = 20;
/** How long one may take (ms). */
export const REMOTE_TIMEOUT = 20_000;

/** Why a URL wasn't fetched. */
export type FetchFailure =
  | { kind: 'status'; status: number; statusText: string }
  | { kind: 'cors' | 'mixed' | 'offline' | 'unreachable' | 'dropped' | 'timeout' | 'tooBig' | 'notJson' | 'notSchema' | 'notHttp' };

export type Fetched = { url: string; text: string } | { url: string; failure: FetchFailure };

/** What fetching needs of the page (tests pass their own). */
export interface FetchEnv {
  fetch: typeof fetch;
  online: () => boolean;
  /** The page's protocol (an https page can't fetch http:// URLs). */
  protocol: string;
}

const pageEnv = (): FetchEnv => ({ fetch: (...a) => fetch(...a), online: () => navigator.onLine !== false, protocol: location.protocol });

/** The URL without its fragment: the document a `$ref` points into. */
export const documentUrl = (url: string) => url.replace(/#.*$/s, '');

/** Hosts an https page may still fetch over http (this device). */
const LOCAL = /^(?:(?:.+\.)?localhost|127(?:\.\d+){3}|\[::1\])$/;

class Failed extends Error {
  constructor(readonly failure: FetchFailure) {
    super(failure.kind);
  }
}

/** The body, decoded as UTF-8, read up to REMOTE_MAX_BYTES (past that: tooBig, the rest isn't downloaded). */
async function body(res: Response): Promise<string> {
  const length = Number(res.headers.get('content-length'));
  if (length > REMOTE_MAX_BYTES) {
    void res.body?.cancel().catch(() => undefined);
    throw new Failed({ kind: 'tooBig' });
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > REMOTE_MAX_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new Failed({ kind: 'tooBig' });
    }
    parts.push(value);
  }
  return new TextDecoder().decode(await new Blob(parts as BlobPart[]).arrayBuffer());
}

/** Fetches one URL; resolves with its text or why it failed (null: `signal` stopped it). */
async function one(url: string, signal: AbortSignal, env: FetchEnv): Promise<Fetched | null> {
  let u: URL;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return { url, failure: { kind: 'notHttp' } };
  }
  // (An https page may only ask this device over http: the browser blocks the rest.)
  if (u.protocol === 'http:' && env.protocol === 'https:' && !LOCAL.test(u.hostname)) return { url, failure: { kind: 'mixed' } };
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal.addEventListener('abort', abort);
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, REMOTE_TIMEOUT);
  let res: Response | null = null;
  try {
    res = await env.fetch(url, { headers: { Accept: 'application/schema+json, application/json, */*' }, credentials: 'omit', signal: stop.signal });
    if (!res.ok) return { url, failure: { kind: 'status', status: res.status, statusText: res.statusText } };
    const text = await body(res);
    const r = parse(text);
    if (!r.root || r.error) return { url, failure: { kind: 'notJson' } };
    // (A schema is one object or boolean: JSON Lines, an array, a number aren't one.)
    if (r.multi || (r.root.t !== OBJ && r.root.t !== BOOL)) return { url, failure: { kind: 'notSchema' } };
    return { url, text };
  } catch (e) {
    if (signal.aborted) return null;
    if (late) return { url, failure: { kind: 'timeout' } };
    if (e instanceof Failed) return { url, failure: e.failure };
    if (res) return { url, failure: { kind: 'dropped' } };
    if (!env.online()) return { url, failure: { kind: 'offline' } };
    // The browser says the same for a server that doesn't allow cross-origin reads and one it can't reach: a reply
    // the page may not read arrives only from a server that is there.
    try {
      await env.fetch(url, { mode: 'no-cors', credentials: 'omit', signal: stop.signal });
      return { url, failure: { kind: 'cors' } };
    } catch {
      return signal.aborted ? null : { url, failure: { kind: late ? 'timeout' : 'unreachable' } };
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    stop.abort(); // (the probe's headers tell enough: no body is wanted)
  }
}

/**
 * Fetches the documents `urls` name (fragments stripped, each once), at most REMOTE_MAX_COUNT, all at once. Resolves
 * in the order asked, or with null once `signal` aborts (nothing of it then counts). `progress`: how many are done.
 */
export async function fetchSchemas(urls: string[], signal: AbortSignal, progress: (done: number) => void = () => undefined, env: FetchEnv = pageEnv()): Promise<Fetched[] | null> {
  const list = [...new Set(urls.map(documentUrl))].slice(0, REMOTE_MAX_COUNT);
  let done = 0;
  const got = await Promise.all(
    list.map((url) =>
      one(url, signal, env).then((r) => {
        if (!signal.aborted) progress(++done);
        return r;
      }),
    ),
  );
  return signal.aborted || got.includes(null) ? null : (got as Fetched[]);
}
