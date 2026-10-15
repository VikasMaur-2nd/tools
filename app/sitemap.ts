import type { MetadataRoute } from 'next';
import { POSTS } from './blogs/posts';
import { ERROR_GUIDES } from './json-errors/errors';
import { TOOL_PAGES } from '@/lib/tool-pages';

// Bump when the page content meaningfully changes. A literal (not `new Date()`)
// keeps this route free of sync IO so it prerenders under `cacheComponents`.
const LAST_MODIFIED = '2026-10-13';
const HOME_LAST_MODIFIED = '2026-10-15';
const RESOURCES_LAST_MODIFIED = '2026-10-14';
const TOOLS_LAST_MODIFIED = '2026-10-14';
const ERRORS_LAST_MODIFIED = '2026-10-14';
const ERROR_GUIDES_LAST_MODIFIED = '2026-10-15';
/** Tool pages whose content changed after TOOLS_LAST_MODIFIED, and when. */
const TOOL_UPDATES: Record<string, string> = Object.fromEntries(
  ['json-validator', 'json-minifier', 'json-diff', 'json-schema-generator', 'json-to-go', 'json-to-csv', 'json-to-xml', 'json-to-excel', 'jwt-decoder', 'json-to-toml', 'toml-to-json', 'secure-json-formatter', 'jsonl-viewer', 'jsonl-to-csv', 'json-escape', 'json-repair'].map((slug) => [slug, '2026-10-15']),
);
const SITE = 'https://tools.vikasmaur.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...['/json-errors', ...ERROR_GUIDES.map(guide => `/json-errors/${guide.slug}`)].map(path => ({
      url: `${SITE}${path}`,
      lastModified: path === '/json-errors' ? ERRORS_LAST_MODIFIED : ERROR_GUIDES_LAST_MODIFIED,
      changeFrequency: 'monthly' as const,
      priority: 0.75,
    })),
    {
      url: SITE,
      lastModified: HOME_LAST_MODIFIED,
      changeFrequency: 'weekly',
      priority: 1,
    },
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
      lastModified: LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.5,
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
    {
      url: `${SITE}/tools`,
      lastModified: TOOLS_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    ...TOOL_PAGES.map((page) => ({
      url: `${SITE}/tools/${page.slug}`,
      lastModified: TOOL_UPDATES[page.slug] ?? TOOLS_LAST_MODIFIED,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
