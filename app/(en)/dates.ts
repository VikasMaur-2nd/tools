// When each page's text last changed (ISO dates, YYYY-MM-DD): the sitemap, article dates and the
// visible dates read from here. Set a page's date to the day its text changes (the commit's
// `git log -1 --format=%cs`); metadata and styling don't count. Blog posts (blogs/posts.ts), error
// guides (json-errors/errors.ts) and tool pages (lib/tool-pages.ts) carry their own dates, and a page
// that lists them is as new as its newest entry (app/sitemap.ts). Plain data with no imports.

type Dates = { published?: string; updated: string };

export const PAGE_DATES = {
  '/': { updated: '2026-11-05' },
  '/about': { updated: '2026-10-18' },
  '/privacy': { updated: '2026-11-21' },
  '/integrate': { published: '2026-10-21', updated: '2026-10-23' },
  // The listings' own text; their sitemap dates include their entries.
  '/blogs': { updated: '2026-10-13' },
  '/tools': { updated: '2026-11-21' },
  '/json-errors': { updated: '2026-10-15' },
  '/resources': { updated: '2026-10-14' },
  '/resources/json-reference': { published: '2026-10-14', updated: '2026-10-14' },
  '/resources/json-examples': { published: '2026-10-14', updated: '2026-10-14' },
} satisfies Record<string, Dates>;

/** The newest of some ISO dates. */
export const latest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a));

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

/** `2026-10-13` → `October 13, 2026`. */
export const formatDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));
