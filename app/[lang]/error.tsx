'use client';

import { useContext, useEffect } from 'react';
import { ErrorText } from '@/lib/i18n/errors';

/** Last-resort fallback: the document is saved locally, so a retry/reload loses nothing. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const s = useContext(ErrorText);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="hero" role="alert">
      <div className="hero-in">
        <h1>{s.title}</h1>
        <p className="lead">{s.text}</p>
        <div className="hero-actions">
          <button type="button" className="btn primary lg" onClick={() => retry()}>
            {s.retry}
          </button>
          <button type="button" className="btn lg" onClick={() => location.reload()}>
            {s.reload}
          </button>
        </div>
      </div>
    </div>
  );
}
