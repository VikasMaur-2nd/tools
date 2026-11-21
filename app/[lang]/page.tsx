import type { Metadata } from 'next';
import LocalizedTool from '@/components/LocalizedTool';
import { StatusLangs } from '@/components/LangSwitch';
import { localeInfo } from '@/lib/i18n/locales';
import { getLocale } from '@/lib/i18n/locale';
import { clientUi, serverT, stringFiles } from '@/lib/i18n/server';
import { homeJsonLd, jsonLdScript } from '../(en)/seo';
import SeoContent from '../(en)/seo-content';
import { pageMetadata } from '../page-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = serverT(locale);
  return pageMetadata({ path: '/', locale, title: t('home.title'), fullTitle: true, description: t('home.description') });
}

/** The homepage in a language: the app, then the same introduction as English. */
export default async function LocalizedHome() {
  const locale = await getLocale();
  return (
    <main className="home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd(locale)) }} />
      <LocalizedTool ui={clientUi(locale)} files={stringFiles(locale)} lang={localeInfo(locale).lang} langs={<StatusLangs path="/" locale={locale} />} />
      <SeoContent locale={locale} />
    </main>
  );
}
