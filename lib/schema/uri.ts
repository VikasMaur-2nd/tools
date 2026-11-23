/**
 * URI references for `$id` and `$ref` (RFC 3986 §5: parsing, resolution against a base, dot segments) and JSON
 * Pointer fragments (RFC 6901). Nothing here touches the network.
 */

interface Parts {
  scheme: string | null;
  authority: string | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

const RE = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

function parts(uri: string): Parts {
  const m = RE.exec(uri)!;
  return { scheme: m[1] ?? null, authority: m[2] ?? null, path: m[3], query: m[4] ?? null, fragment: m[5] ?? null };
}

function removeDots(path: string): string {
  const out: string[] = [];
  let input = path;
  while (input) {
    if (input.startsWith('../')) input = input.slice(3);
    else if (input.startsWith('./')) input = input.slice(2);
    else if (input.startsWith('/./')) input = input.slice(2);
    else if (input === '/.') input = '/';
    else if (input.startsWith('/../')) {
      input = input.slice(3);
      out.pop();
    } else if (input === '/..') {
      input = '/';
      out.pop();
    } else if (input === '.' || input === '..') input = '';
    else {
      const start = input[0] === '/' ? 1 : 0;
      const j = input.indexOf('/', start);
      const seg = j < 0 ? input : input.slice(0, j);
      out.push(seg);
      input = j < 0 ? '' : input.slice(j);
    }
  }
  return out.join('');
}

function join(p: Parts): string {
  let s = '';
  if (p.scheme !== null) s += p.scheme + ':';
  if (p.authority !== null) s += '//' + p.authority;
  s += p.path;
  if (p.query !== null) s += '?' + p.query;
  if (p.fragment !== null) s += '#' + p.fragment;
  return s;
}

/** Whether `uri` has a scheme (it can be a base). */
export const isAbsolute = (uri: string) => parts(uri).scheme !== null;

/** `ref` resolved against `base` (RFC 3986 §5.2.2); a base without a scheme leaves relative references relative. */
export function resolveUri(base: string, ref: string): string {
  const r = parts(ref);
  const b = parts(base);
  const t: Parts = { scheme: null, authority: null, path: '', query: null, fragment: r.fragment };
  if (r.scheme !== null) {
    t.scheme = r.scheme;
    t.authority = r.authority;
    t.path = removeDots(r.path);
    t.query = r.query;
  } else {
    t.scheme = b.scheme;
    if (r.authority !== null) {
      t.authority = r.authority;
      t.path = removeDots(r.path);
      t.query = r.query;
    } else {
      t.authority = b.authority;
      if (r.path === '') {
        t.path = b.path;
        t.query = r.query !== null ? r.query : b.query;
      } else {
        if (r.path.startsWith('/')) t.path = removeDots(r.path);
        else {
          const merged = b.authority !== null && b.path === '' ? '/' + r.path : b.path.slice(0, b.path.lastIndexOf('/') + 1) + r.path;
          t.path = b.scheme !== null || b.authority !== null ? removeDots(merged) : merged;
        }
        t.query = r.query;
      }
    }
  }
  return join(t);
}

const UNRESERVED = /%([0-9A-Fa-f]{2})/g;

/** A comparable form: lower-case scheme and host, unreserved characters decoded, hex digits upper-case, no empty fragment. */
export function normalizeUri(uri: string): string {
  const p = parts(uri);
  if (p.scheme) p.scheme = p.scheme.toLowerCase();
  if (p.authority) p.authority = p.authority.toLowerCase();
  const fix = (s: string) =>
    s.replace(UNRESERVED, (m, h: string) => {
      const c = parseInt(h, 16);
      return /[A-Za-z0-9\-._~]/.test(String.fromCharCode(c)) ? String.fromCharCode(c) : '%' + h.toUpperCase();
    });
  p.path = fix(p.path);
  if (p.query !== null) p.query = fix(p.query);
  if (p.fragment === '') p.fragment = null;
  if (p.authority !== null && p.path === '') p.path = '/';
  return join(p);
}

/** The URI without its fragment, and the fragment ('' for none). */
export function splitFragment(uri: string): [string, string] {
  const i = uri.indexOf('#');
  return i < 0 ? [uri, ''] : [uri.slice(0, i), uri.slice(i + 1)];
}

/** A JSON Pointer's reference tokens (null: not a pointer: it must be '' or start with '/', and '~' only as ~0 or ~1). */
export function pointerTokens(ptr: string): string[] | null {
  if (ptr === '') return [];
  if (ptr[0] !== '/') return null;
  const out: string[] = [];
  for (const t of ptr.slice(1).split('/')) {
    if (/~(?![01])/.test(t)) return null;
    out.push(t.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return out;
}

/** One reference token, escaped for a JSON Pointer. */
export const escapeToken = (t: string | number) => String(t).replace(/~/g, '~0').replace(/\//g, '~1');

/** A JSON Pointer from tokens. */
export const pointer = (tokens: readonly (string | number)[]) => tokens.map((t) => '/' + escapeToken(t)).join('');

/** A URI fragment decoded (null: a broken percent-encoding). */
export function decodeFragment(frag: string): string | null {
  try {
    return decodeURIComponent(frag);
  } catch {
    return null;
  }
}
