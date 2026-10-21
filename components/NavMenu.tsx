'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The content pages' section links on narrow screens: a native disclosure that
 * also closes on navigation, a click outside and Esc (which returns focus to
 * its button). Wide screens show the same links inline instead (app/content.css).
 */
export default function NavMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const outside = (e: PointerEvent) => {
      if (d.open && !d.contains(e.target as Node)) d.open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !d.open) return;
      d.open = false;
      d.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, []);

  return (
    <details ref={ref} className="nav-menu">
      <summary aria-label={label}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </summary>
      <div className="nav-menu-panel">{children}</div>
    </details>
  );
}
