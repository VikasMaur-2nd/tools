'use client';

import { createContext, type ContextType, type ReactNode } from 'react';

// Keep the error boundary independent of the editor's translator and JSON engine.
// English by default; translated root layouts provide their language (lib/i18n/server.ts errorText).
export const ErrorText = createContext({
  title: 'Something went wrong',
  /** A document is saved in this browser. */
  text: 'Your JSON is saved in this browser. Try again, and if it keeps happening, reload the page.',
  /** None is (none was open, it was too big to save, or storage failed). */
  unsaved: "Try again, and if it keeps happening, reload the page. JSON you had open here isn't saved in this browser, so you may need to paste or open it again.",
  retry: 'Try again',
  reload: 'Reload',
});

export function ErrorTextProvider({ value, children }: { value: ContextType<typeof ErrorText>; children: ReactNode }) {
  return <ErrorText value={value}>{children}</ErrorText>;
}
