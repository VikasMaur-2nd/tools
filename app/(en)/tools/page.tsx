import type { Metadata } from 'next';
import IntentLink from '@/components/IntentLink';
import ContentShell from '../content-shell';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../seo';
import { TOOL_PAGES } from '@/lib/tool-pages';

const TITLE = 'JSON tools for formatting, conversion and validation';
const DESCRIPTION = 'Use Tool Kumar tools for JSON formatting, validation, diffing, conversion and local file imports. Every tool runs in your browser.';

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: { canonical: '/tools' },
  openGraph: { type: 'website', url: '/tools', siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, images: [SOCIAL_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/twitter-image.png'] },
};

export default function ToolsPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${SITE}/tools#page`, url: `${SITE}/tools`, name: TITLE, description: DESCRIPTION, isPartOf: { '@id': `${SITE}/#website` }, mainEntity: { '@type': 'ItemList', itemListElement: TOOL_PAGES.map((page, i) => ({ '@type': 'ListItem', position: i + 1, name: page.heading, url: `${SITE}/tools/${page.slug}` })) } },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE }, { '@type': 'ListItem', position: 2, name: 'Tools', item: `${SITE}/tools` }] },
    ],
  };
  return (
    <ContentShell current="tools">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="page-head">
        <p className="eyebrow">Tool Kumar tools</p>
        <h1>JSON tools for everyday developer work</h1>
        <p className="lede">Format, validate, compare and convert JSON in your browser. These tools share the same local editor, so your documents stay on your device.</p>
      </header>
      <section className="tool-grid" aria-label="JSON tools">
        <article className="tool-card"><p className="resource-kind">JSON viewer and formatter</p><h2><IntentLink href="/">JSON formatter</IntentLink></h2><p>Format, validate, repair, minify and explore JSON in the main Tool Kumar editor.</p><IntentLink className="resource-arrow" href="/">Open tool <span aria-hidden="true">→</span></IntentLink></article>
        {TOOL_PAGES.map((page) => <article className="tool-card" key={page.slug}><p className="resource-kind">{page.modeLabel}</p><h2><IntentLink href={`/tools/${page.slug}`}>{page.heading}</IntentLink></h2><p>{page.description}</p><IntentLink className="resource-arrow" href={`/tools/${page.slug}`}>Open tool <span aria-hidden="true">→</span></IntentLink></article>)}
      </section>
    </ContentShell>
  );
}
