import type { SiteLocale } from '@/lib/i18n/locales';
import { serverT } from '@/lib/i18n/server';

/** The site's slogan in the homepage app until there is a document. Every other page shows it above the footer (content-shell.tsx). */
export default function Slogan({ locale = 'en' }: { locale?: SiteLocale }) {
  const t = serverT(locale);
  return (
    <>
      <p className="wm-title">{t('site.slogan.title')}</p>
      <p className="wm-text">{t('site.slogan.text')}</p>
    </>
  );
}
