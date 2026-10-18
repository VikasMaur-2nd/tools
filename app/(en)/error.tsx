'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/analytics';

/** Last-resort fallback: the document is saved locally, so a retry/reload loses nothing. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, 'react_boundary');
    console.error(error);
  }, [error]);
  return (
    <div className="hero" role="alert">
      <div className="hero-in">
        <h1>Something went wrong</h1>
        <p className="lead">Your JSON is saved in this browser. Try again, and if it keeps happening, reload the page.</p>
        <div className="hero-actions">
          <button type="button" className="btn primary lg" onClick={() => retry()}>
            Try again
          </button>
          <button type="button" className="btn lg" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
