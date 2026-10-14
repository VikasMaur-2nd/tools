import type { MetadataRoute } from 'next';
import { POSTS } from './blogs/posts';
import { TOOL_PAGES } from '@/lib/tool-pages';

// Bump when the page content meaningfully changes. A literal (not `new Date()`)
// keeps this route free of sync IO so it prerenders under `cacheComponents`.
const LAST_MODIFIED = '2026-10-13';
const RESOURCES_LAST_MODIFIED = '2026-10-14';
const SITE = 'https://tools.vikasmaur.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE,
      lastModified: LAST_MODIFIED,
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
      lastModified: LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    ...TOOL_PAGES.map((page) => ({
      url: `${SITE}/tools/${page.slug}`,
      lastModified: LAST_MODIFIED,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
