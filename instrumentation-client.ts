// Runs before hydration on every page (Next.js convention, as PostHog's Next.js guide recommends).
// This only arms analytics: PostHog itself loads later, once the page is idle (lib/analytics).
import { startAnalytics } from './lib/analytics';

startAnalytics();
