'use client';

import { useSyncExternalStore } from 'react';
import { analyticsState, onAnalyticsChange, setAnalyticsEnabled, type AnalyticsState } from '@/lib/analytics';

const NOTE: Record<AnalyticsState, string> = {
  on: 'On. Thank you: it shows us which features to improve next.',
  off: 'Off. This browser sends nothing to Vercel or PostHog, not even page views.',
  browser:
    'PostHog is off because your browser sends Global Privacy Control or Do Not Track. Vercel still counts anonymous page views unless you switch analytics off.',
  unavailable: 'Analytics is not active on this copy of the site (a local or preview build), so nothing is sent from here.',
};

/** The privacy page's on/off switch for analytics in this browser. */
export default function AnalyticsSwitch() {
  // null on the server: the choice lives in this browser.
  const state = useSyncExternalStore<AnalyticsState | null>(onAnalyticsChange, analyticsState, () => null);
  const on = state === 'on' || state === 'browser';
  return (
    <div className="consent" aria-live="polite">
      <div className="consent-row">
        <span id="consent-label" className="consent-label">
          Analytics in this browser
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={state === null ? undefined : on}
          aria-labelledby="consent-label"
          disabled={state === null}
          onClick={() => setAnalyticsEnabled(!on)}
        >
          <span className="switch-knob" />
        </button>
      </div>
      <p className="consent-note">{state ? NOTE[state] : 'Checking…'}</p>
    </div>
  );
}
