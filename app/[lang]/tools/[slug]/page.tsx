import LocalizedTool from '@/components/LocalizedTool';
import IntentLink from '@/components/IntentLink';
import { clientUi, toolPages } from '@/lib/i18n/server';
import { isLocale, localeInfo } from '@/lib/i18n/locales';
import ToolPageRoute from '../../../(en)/tools/[slug]/tool-page';

// A tool page in a language: the English page renders the locale of the route,
// so both stay one implementation. Only translated pages are generated; any
// other slug is a 404 (never English content under a localized URL).
export { generateMetadata } from '../../../(en)/tools/[slug]/tool-page';

export default function Page(props: PageProps<'/[lang]/tools/[slug]'>) {
  return ToolPageRoute(props, (toolProps, locale) => <LocalizedTool {...toolProps} ui={clientUi(locale)} lang={localeInfo(locale).lang} />, IntentLink);
}

export const ensureStatic = 'navigation';

export function generateStaticParams({ params }: { params: { lang: string } }) {
  const pages = isLocale(params.lang) ? toolPages(params.lang) : [];
  // Cache Components needs at least one value; an untranslated slug renders the 404.
  return (pages.length ? pages : [{ slug: 'json-validator' }]).map(({ slug }) => ({ slug }));
}
