import type { ReactNode } from 'react';
import IntentLink from '@/components/IntentLink';
import { POSTS } from './blogs/posts';

/** The app icon, drawn with theme colors so it follows light and dark mode. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" />
      <path d="M4 6H20V12L24 6H28L21.33 16L28 26H24L20 20V26H16V10H12V26H8V10H4Z" />
    </svg>
  );
}

type Section = 'blogs' | 'resources' | 'about' | 'tools';

export default function ContentShell({
  children,
  current,
  progress = false,
}: {
  children: ReactNode;
  current?: Section;
  /** Show a reading progress bar under the header. */
  progress?: boolean;
}) {
  const here = (s: Section) => (current === s ? ('page' as const) : undefined);
  return (
    <div className="content-page">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap site-header-in">
          <IntentLink className="site-brand" href="/" aria-label="Tool Kumar JSON viewer">
            <Logo />
            <span>Tool Kumar</span>
          </IntentLink>
          <nav className="site-nav" aria-label="Main">
            <IntentLink href="/tools" aria-current={here('tools')}>
              Tools
            </IntentLink>
            <IntentLink href="/blogs" aria-current={here('blogs')}>
              Blog
            </IntentLink>
            <IntentLink href="/resources" aria-current={here('resources')}>
              Resources
            </IntentLink>
            <IntentLink href="/about" aria-current={here('about')}>
              About
            </IntentLink>
            <IntentLink className="site-cta" href="/">
              JSON viewer
            </IntentLink>
          </nav>
        </div>
        {progress && <div className="progress" aria-hidden="true" />}
      </header>

      <main id="content" className="wrap site-main">
        {children}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              <IntentLink className="site-brand" href="/">
                <Logo size={22} />
                <span>Tool Kumar</span>
              </IntentLink>
              <p>Private, browser-based JSON tools. Your data never leaves your device.</p>
            </div>
            <nav aria-label="Tools">
              <p className="foot-h">Tools</p>
              <ul>
                <li>
                  <IntentLink href="/">JSON viewer &amp; formatter</IntentLink>
                </li>
                <li>
                  <IntentLink href="/tools">All JSON tools</IntentLink>
                </li>
              </ul>
            </nav>
            <nav aria-label="Blog">
              <p className="foot-h">Blog</p>
              <ul>
                {POSTS.slice(0, 4).map((p) => (
                  <li key={p.slug}>
                    <IntentLink href={`/blogs/${p.slug}`}>{p.title.split(':')[0]}</IntentLink>
                  </li>
                ))}
                <li>
                  <IntentLink href="/blogs">All posts</IntentLink>
                </li>
              </ul>
            </nav>
            <nav aria-label="Resources">
              <p className="foot-h">Resources</p>
              <ul>
                <li>
                  <IntentLink href="/resources/json-reference">JSON syntax reference</IntentLink>
                </li>
                <li>
                  <IntentLink href="/resources/json-examples">JSON examples</IntentLink>
                </li>
                <li>
                  <IntentLink href="/json-errors">JSON error guides</IntentLink>
                </li>
              </ul>
            </nav>
            <nav aria-label="Company">
              <p className="foot-h">Company</p>
              <ul>
                <li>
                  <IntentLink href="/about">About Tool Kumar</IntentLink>
                </li>
              </ul>
            </nav>
          </div>
          <p className="foot-note">© Tool Kumar · Free, no account, works offline.</p>
        </div>
      </footer>
    </div>
  );
}
