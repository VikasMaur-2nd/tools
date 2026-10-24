import { descriptor } from '@/lib/webmcp/descriptor';
import { SITE } from '@/lib/badge';

// Static: prerendered at build time (reads nothing at request time).
export function GET() {
  return Response.json(descriptor(SITE), {
    headers: {
      // Public facts about the site, readable from any page or tool.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
