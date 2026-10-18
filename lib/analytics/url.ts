/**
 * A URL without its fragment (share links carry the whole document there) and
 * without query parameters (`?url=` can name a private API), except utm_*
 * campaign tags. Anything that isn't an http(s) URL is returned unchanged.
 * Its own module: Vercel Web Analytics' wrapper needs it on the critical path.
 */
export function cleanUrl(raw: string): string {
  if (!/^https?:\/\//i.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.split(/[?#]/)[0];
  }
  const keep = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (/^utm_[a-z]+$/i.test(k)) keep.append(k, v);
  });
  const q = keep.toString();
  return url.origin + url.pathname + (q ? '?' + q : '');
}
