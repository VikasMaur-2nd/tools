'use client';

import { useContext, useEffect, useSyncExternalStore } from 'react';
import { PRIVATE, reportError } from '@/lib/analytics';
import { ErrorText } from '@/lib/i18n/errors';

/**
 * Where the editor saves the document (lib/engine/engine.ts, KEYS.doc). It
 * only saves documents up to 2.5 million characters, and removes the entry when
 * a document is too big or a write fails, so the entry is there exactly when
 * the app can bring the user's document back.
 */
const SAVED_DOC = 'jf:doc';

const hasSavedDoc = () => {
  try {
    return !!localStorage.getItem(SAVED_DOC);
  } catch {
    return false;
  }
};
const onStorage = (change: () => void) => {
  window.addEventListener('storage', change);
  return () => window.removeEventListener('storage', change);
};
const notSaved = () => false;

/** Last-resort fallback of both root layouts' error boundaries, in the page's language. */
export default function ErrorScreen({ error, retry }: { error: Error; retry: () => void }) {
  const text = useContext(ErrorText);
  // Read again after mounting (React checks the value once effects run): the
  // editor saves its document as the failed page unmounts.
  const saved = useSyncExternalStore(onStorage, hasSavedDoc, notSaved);
  useEffect(() => {
    reportError(error, 'react_boundary');
    console.error(error);
  }, [error]);
  return (
    <div className="error-screen" role="alert">
      <div className="error-screen-in">
        <h1>{text.title}</h1>
        {/* Whether a document is saved says something about it (over 2.5 million characters, or none open). */}
        <p className={`lead ${PRIVATE}`}>{saved ? text.text : text.unsaved}</p>
        <div className="hero-actions">
          <button type="button" className="btn primary lg" onClick={() => retry()}>
            {text.retry}
          </button>
          <button type="button" className="btn lg" onClick={() => location.reload()}>
            {text.reload}
          </button>
        </div>
      </div>
    </div>
  );
}
