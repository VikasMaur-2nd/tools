'use client';

import { createContext, type ContextType, type ReactNode } from 'react';

// Keep the error boundary independent of the editor's translator and JSON engine.
export const ErrorText = createContext({
  title: 'Something went wrong',
  text: 'Your JSON is saved in this browser. Try again, and if it keeps happening, reload the page.',
  retry: 'Try again',
  reload: 'Reload',
});

export function ErrorTextProvider({ value, children }: { value: ContextType<typeof ErrorText>; children: ReactNode }) {
  return <ErrorText value={value}>{children}</ErrorText>;
}
