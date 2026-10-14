import type { ReactNode } from 'react';

// Next 16.4 validates complete static output, including metadata, at build time.
export const ensureStatic = 'navigation';

export default function JsonErrorsLayout({ children }: { children: ReactNode }) {
  return children;
}
