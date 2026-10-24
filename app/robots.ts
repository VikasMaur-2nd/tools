import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

// Static: prerendered at build time to /robots.txt.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
