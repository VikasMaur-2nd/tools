import type { Metadata } from 'next';
import LocalizedTool from '@/components/LocalizedTool';
import { StatusLangs } from '@/components/LangSwitch';
import { localeInfo } from '@/lib/i18n/locales';
import { getLocale } from '@/lib/i18n/locale';
import { alternates, clientUi, ogLocales, serverT } from '@/lib/i18n/server';
import { SOCIAL_IMAGE, SITE_NAME, homeJsonLd, jsonLdScript } from '../(en)/seo';
import SeoContent from '../(en)/seo-content';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = serverT(locale);
  const title = t('home.title');
  const description = t('home.description');
  return {
    title: { absolute: title },
    description,
    alternates: alternates('/', locale),
    openGraph: { type: 'website', url: `/${locale}`, siteName: SITE_NAME, title, description, ...ogLocales('/', locale), images: [{ ...SOCIAL_IMAGE, alt: t('site.ogAlt') }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image.png'] },
  };
}

/** The homepage in a language: the app, then the same introduction as English. */
export default async function LocalizedHome() {
  const locale = await getLocale();
  return (
    <main className="home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd(locale)) }} />
      <LocalizedTool ui={clientUi(locale)} lang={localeInfo(locale).lang} langs={<StatusLangs path="/" locale={locale} />} />
      <SeoContent locale={locale} />
    </main>
  );
}
