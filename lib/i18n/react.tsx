'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { EN, type T } from './ui';

/** The page's translator for client components (English unless a localized page provides one). */
export const UiContext = createContext<T>(EN);
export const useT = () => useContext(UiContext);

/** The error boundary's strings: rendered above the page, so localized root layouts provide them here. */
export const ErrorText = createContext({
  title: 'Something went wrong',
  text: 'Your JSON is saved in this browser. Try again, and if it keeps happening, reload the page.',
  retry: 'Try again',
  reload: 'Reload',
});

export function ErrorTextProvider({ value, children }: { value: React.ContextType<typeof ErrorText>; children: ReactNode }) {
  return <ErrorText value={value}>{children}</ErrorText>;
}
