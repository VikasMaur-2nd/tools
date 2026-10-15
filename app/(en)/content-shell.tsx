import type { ReactNode } from 'react';
import IntentLink from '@/components/IntentLink';
import { FooterLangs } from '@/components/LangSwitch';
import { localePath } from '@/lib/i18n/locales';
import { getLocale } from '@/lib/i18n/locale';
import { serverT } from '@/lib/i18n/server';
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

export default async function ContentShell({
  children,
  current,
  progress = false,
  path,
}: {
  children: ReactNode;
  current?: Section;
  /** Show a reading progress bar under the header. */
  progress?: boolean;
  /** The page's English path, for the language switcher (pages that exist in one language leave it out). */
  path?: string;
}) {
  const here = (s: Section) => (current === s ? ('page' as const) : undefined);
  const locale = await getLocale();
  const t = serverT(locale);
  const to = (p: string) => localePath(locale, p);
  // Sections that are not translated link to the English pages, marked as such.
  const en = locale === 'en' ? {} : { hrefLang: 'en', title: t('site.englishOnly') };
  return (
    <div className="content-page">
      <a className="skip" href="#content">
        {t('site.skip')}
      </a>
      <header className="site-header">
        <div className="wrap site-header-in">
          <IntentLink className="site-brand" href={to('/')} aria-label={t('site.brand')}>
            <Logo />
            <span>Tool Kumar</span>
          </IntentLink>
          <nav className="site-nav" aria-label={t('site.nav.main')}>
            <IntentLink href={to('/tools')} aria-current={here('tools')}>
              {t('site.nav.tools')}
            </IntentLink>
            <IntentLink href="/blogs" aria-current={here('blogs')} {...en}>
              {t('site.nav.blog')}
            </IntentLink>
            <IntentLink href="/resources" aria-current={here('resources')} {...en}>
              {t('site.nav.resources')}
            </IntentLink>
            <IntentLink href="/about" aria-current={here('about')} {...en}>
              {t('site.nav.about')}
            </IntentLink>
            <IntentLink className="site-cta" href={to('/')}>
              {t('site.cta')}
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
              <IntentLink className="site-brand" href={to('/')}>
                <Logo size={22} />
                <span>Tool Kumar</span>
              </IntentLink>
              <p>{t('site.footer.tagline')}</p>
            </div>
            <nav aria-label={t('site.footer.tools')}>
              <p className="foot-h">{t('site.footer.tools')}</p>
              <ul>
                <li>
                  <IntentLink href={to('/')}>{t('site.footer.viewer')}</IntentLink>
                </li>
                <li>
                  <IntentLink href={to('/tools')}>{t('site.footer.allTools')}</IntentLink>
                </li>
              </ul>
            </nav>
            <nav aria-label={t('site.footer.blog')}>
              <p className="foot-h">{t('site.footer.blog')}</p>
              <ul>
                {POSTS.slice(0, 4).map((p) => (
                  <li key={p.slug}>
                    <IntentLink href={`/blogs/${p.slug}`} {...en} {...(locale !== 'en' && { lang: 'en' })}>
                      {p.title.split(':')[0]}
                    </IntentLink>
                  </li>
                ))}
                <li>
                  <IntentLink href="/blogs" {...en}>
                    {t('site.footer.allPosts')}
                  </IntentLink>
                </li>
              </ul>
            </nav>
            <nav aria-label={t('site.footer.resources')}>
              <p className="foot-h">{t('site.footer.resources')}</p>
              <ul>
                <li>
                  <IntentLink href="/resources/json-reference" {...en}>
                    {t('site.footer.reference')}
                  </IntentLink>
                </li>
                <li>
                  <IntentLink href="/resources/json-examples" {...en}>
                    {t('site.footer.examples')}
                  </IntentLink>
                </li>
                <li>
                  <IntentLink href="/json-errors" {...en}>
                    {t('site.footer.errors')}
                  </IntentLink>
                </li>
              </ul>
            </nav>
            <nav aria-label={t('site.footer.company')}>
              <p className="foot-h">{t('site.footer.company')}</p>
              <ul>
                <li>
                  <IntentLink href="/about" {...en}>
                    {t('site.footer.about')}
                  </IntentLink>
                </li>
              </ul>
            </nav>
          </div>
          {path && <FooterLangs path={path} locale={locale} />}
          <p className="foot-note">{t('site.footer.note')}</p>
        </div>
      </footer>
    </div>
  );
}
