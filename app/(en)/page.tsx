import JsonTool from '@/components/JsonTool';
import { homeJsonLd, jsonLdScript } from './seo';
import SeoContent from './seo-content';

export default function Page() {
  return (
    <main className="home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd) }} />
      <JsonTool />
      <SeoContent />
    </main>
  );
}
