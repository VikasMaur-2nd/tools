'use client';

import { useEffect } from 'react';
import NextError from 'next/error';
import { reportError } from '@/lib/analytics';

/** Root-layout crashes bypass the route error boundaries. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { reportError(error, 'react_boundary'); }, [error]);
  return <html lang="en"><body><NextError statusCode={500} /></body></html>;
}
