import type { Metadata } from 'next';
import JsonTool from '@/components/JsonTool';
import { StatusLangs } from '@/components/LangSwitch';
import { serverT } from '@/lib/i18n/server';
import { pageMetadata } from '../page-metadata';
import { homeJsonLd, jsonLdScript } from './seo';
import SeoContent from './seo-content';

const t = serverT('en');
export const metadata: Metadata = pageMetadata({ path: '/', title: t('home.title'), fullTitle: true, description: t('home.description') });

export default function Page() {
  return (
    <main className="home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd()) }} />
      <JsonTool langs={<StatusLangs path="/" locale="en" />} />
      <SeoContent />
    </main>
  );
}
