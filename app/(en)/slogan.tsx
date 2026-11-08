import type { ReactNode } from 'react';
import type { SiteLocale } from '@/lib/i18n/locales';
import { serverT } from '@/lib/i18n/server';

/**
 * The site's slogan and its paragraph: under the app on the homepage, above the footer on every other page.
 * `children` is the link to the measurements (each page passes its own kind of link).
 */
export default function Slogan({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  const t = serverT(locale);
  return (
    <div className="slogan">
      <p className="slogan-title">{t('site.slogan.title')}</p>
      <p className="slogan-text">
        {t('site.slogan.text')} {children}
      </p>
    </div>
  );
}
