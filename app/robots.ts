import type { MetadataRoute } from 'next';

const SITE = 'https://tools.vikasmaur.com';

// Static: prerendered at build time to /robots.txt.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
