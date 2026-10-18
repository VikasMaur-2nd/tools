'use client';

import { Analytics as VercelAnalytics } from '@vercel/analytics/next';
import { analyticsAllowed } from '@/lib/analytics';
import { cleanUrl } from '@/lib/analytics/url';

/**
 * Vercel Web Analytics (page views). Share links carry JSON in the URL hash and
 * `?url=` can name a private API, so both are removed; nothing is sent once the
 * visitor turned analytics off on the privacy page. PostHog starts from
 * instrumentation-client.ts.
 */
export function Analytics() {
  return <VercelAnalytics beforeSend={(event) => (analyticsAllowed() ? { ...event, url: cleanUrl(event.url) } : null)} />;
}
