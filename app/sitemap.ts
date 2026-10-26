import type { MetadataRoute } from 'next';
import { POSTS } from './(en)/blogs/posts';
import { ERROR_GUIDES } from './(en)/json-errors/errors';
import { PAGE_DATES, latest } from './(en)/dates';
import { TOOL_PAGES } from '@/lib/tool-pages';
import { sitemapLanguages } from '@/lib/i18n/server';
import { SITE } from '@/lib/site';

// Dates come from the content (app/(en)/dates.ts and each post, guide and tool page): literals,
// not `new Date()`, so this route has no sync IO and prerenders under `cacheComponents`.
const updated = (path: keyof typeof PAGE_DATES) => PAGE_DATES[path].updated;
/** A listing changes with its entries. */
const listing = (path: keyof typeof PAGE_DATES, entries: { updated: string }[]) => latest([updated(path), ...entries.map((e) => e.updated)]);

/** A page and its translations, each listing the whole hreflang cluster. */
const cluster = (path: string, entry: Omit<MetadataRoute.Sitemap[number], 'url'>) => {
  const languages = sitemapLanguages(path);
  return Object.values(languages)
    .filter((url, i, all) => all.indexOf(url) === i)
    .map((url) => ({ url, ...entry, alternates: { languages } }));
};

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE}/json-errors`,
      lastModified: listing('/json-errors', ERROR_GUIDES),
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    ...ERROR_GUIDES.map((guide) => ({
      url: `${SITE}/json-errors/${guide.slug}`,
      lastModified: guide.updated,
      changeFrequency: 'monthly' as const,
      priority: 0.75,
    })),
    ...cluster('/', {
      lastModified: updated('/'),
      changeFrequency: 'weekly',
      priority: 1,
    }),
    {
      url: `${SITE}/blogs`,
      lastModified: listing('/blogs', POSTS),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...POSTS.map((post) => ({
      url: `${SITE}/blogs/${post.slug}`,
      lastModified: post.updated,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    {
      url: `${SITE}/about`,
      lastModified: updated('/about'),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE}/privacy`,
      lastModified: updated('/privacy'),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE}/integrate`,
      lastModified: updated('/integrate'),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE}/resources`,
      lastModified: listing('/resources', [PAGE_DATES['/resources/json-reference'], PAGE_DATES['/resources/json-examples']]),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE}/resources/json-reference`,
      lastModified: updated('/resources/json-reference'),
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    {
      url: `${SITE}/resources/json-examples`,
      lastModified: updated('/resources/json-examples'),
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    ...cluster('/tools', {
      lastModified: listing('/tools', TOOL_PAGES),
      changeFrequency: 'monthly',
      priority: 0.9,
    }),
    ...TOOL_PAGES.flatMap((page) =>
      cluster(`/tools/${page.slug}`, {
        lastModified: page.updated,
        changeFrequency: 'monthly',
        priority: 0.8,
      }),
    ),
  ];
}
