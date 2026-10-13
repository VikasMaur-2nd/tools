'use client';

import { Analytics as VercelAnalytics } from '@vercel/analytics/next';

/** Vercel Web Analytics. Share links carry JSON in the URL hash, so it is never sent. */
export function Analytics() {
  return <VercelAnalytics beforeSend={(event) => ({ ...event, url: event.url.split('#')[0] })} />;
}
