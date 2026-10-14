'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';

/**
 * A Link that prefetches on intent (hover, keyboard focus, touch start) rather
 * than when it scrolls into view. Content pages carry many links, and handling
 * their viewport prefetches competes with hydration on a slow phone; a fetch
 * that starts at touch or hover still lands before most clicks complete.
 */
export default function IntentLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const warm = () => router.prefetch(typeof href === 'string' ? href : (href.pathname ?? '/'));
  return <Link href={href} prefetch={false} onMouseEnter={warm} onFocus={warm} onTouchStart={warm} {...rest} />;
}
