import type { MetadataRoute } from 'next';
import { POSTS } from './(en)/blogs/posts';
import { ERROR_GUIDES } from './(en)/json-errors/errors';
import { TOOL_PAGES } from '@/lib/tool-pages';
import { sitemapLanguages } from '@/lib/i18n/server';

// Bump when the page content meaningfully changes. A literal (not `new Date()`)
// keeps this route free of sync IO so it prerenders under `cacheComponents`.
const LAST_MODIFIED = '2026-10-13';
const HOME_LAST_MODIFIED = '2026-10-19';
const RESOURCES_LAST_MODIFIED = '2026-10-14';
const TOOLS_LAST_MODIFIED = '2026-10-14';
const TOOLS_INDEX_LAST_MODIFIED = '2026-10-19';
const ERRORS_LAST_MODIFIED = '2026-10-15';
const ERROR_GUIDES_LAST_MODIFIED = '2026-10-15';
/** Tool pages whose content changed after TOOLS_LAST_MODIFIED, and when. */
const TOOL_UPDATES: Record<string, string> = Object.fromEntries(
  ['json-validator', 'json-minifier', 'json-diff', 'json-schema-generator', 'json-to-go', 'json-to-csv', 'json-to-xml', 'json-to-excel', 'jwt-decoder', 'json-to-toml', 'toml-to-json', 'jsonl-viewer', 'jsonl-to-csv', 'json-escape', 'json-repair'].map((slug) => [slug, '2026-10-15']),
);
for (const slug of ['json-visualizer', 'large-json-viewer', 'json-path-finder', 'json-to-table', 'json-validator']) TOOL_UPDATES[slug] = '2026-10-19';
TOOL_UPDATES['secure-json-formatter'] = '2026-10-18';
const PRIVACY_LAST_MODIFIED = '2026-10-18';
const SITE = 'https://tools.vikasmaur.com';

/** A page and its translations, each listing the whole hreflang cluster. */
const cluster = (path: string, entry: Omit<MetadataRoute.Sitemap[number], 'url'>) => {
  const languages = sitemapLanguages(path);
  return Object.values(languages)
    .filter((url, i, all) => all.indexOf(url) === i)
    .map((url) => ({ url, ...entry, alternates: { languages } }));
};

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...['/json-errors', ...ERROR_GUIDES.map(guide => `/json-errors/${guide.slug}`)].map(path => ({
      url: `${SITE}${path}`,
      lastModified: path === '/json-errors' ? ERRORS_LAST_MODIFIED : ERROR_GUIDES_LAST_MODIFIED,
      changeFrequency: 'monthly' as const,
      priority: 0.75,
    })),
    ...cluster('/', {
      lastModified: HOME_LAST_MODIFIED,
      changeFrequency: 'weekly',
      priority: 1,
    }),
    {
      url: `${SITE}/blogs`,
      lastModified: POSTS.reduce((latest, p) => (p.updated > latest ? p.updated : latest), LAST_MODIFIED),
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
      lastModified: PRIVACY_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE}/privacy`,
      lastModified: PRIVACY_LAST_MODIFIED,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE}/resources`,
      lastModified: RESOURCES_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE}/resources/json-reference`,
      lastModified: RESOURCES_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    {
      url: `${SITE}/resources/json-examples`,
      lastModified: RESOURCES_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    ...cluster('/tools', {
      lastModified: TOOLS_INDEX_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.9,
    }),
    ...TOOL_PAGES.flatMap((page) =>
      cluster(`/tools/${page.slug}`, {
        lastModified: TOOL_UPDATES[page.slug] ?? TOOLS_LAST_MODIFIED,
        changeFrequency: 'monthly',
        priority: 0.8,
      }),
    ),
  ];
}
