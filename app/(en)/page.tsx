import type { Metadata } from 'next';
import JsonTool from '@/components/JsonTool';
import { StatusLangs } from '@/components/LangSwitch';
import { alternates } from '@/lib/i18n/server';
import { homeJsonLd, jsonLdScript } from './seo';
import SeoContent from './seo-content';

export const metadata: Metadata = { alternates: alternates('/', 'en') };

export default function Page() {
  return (
    <main className="home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd()) }} />
      <JsonTool langs={<StatusLangs path="/" locale="en" />} />
      <SeoContent />
    </main>
  );
}
