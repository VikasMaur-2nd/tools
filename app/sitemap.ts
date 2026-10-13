import type { MetadataRoute } from 'next';

// Bump when the page content meaningfully changes. A literal (not `new Date()`)
// keeps this route free of sync IO so it prerenders under `cacheComponents`.
const LAST_MODIFIED = '2026-10-13';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://tools.vikasmaur.com',
      lastModified: LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
