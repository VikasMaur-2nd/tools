import Link from 'next/link';
import type { Metadata } from 'next';
import ContentShell from '../content-shell';
import { jsonLdScript, SITE, SITE_NAME, SOCIAL_IMAGE } from '../seo';
import { ERROR_GUIDES, HUB_FAQ } from './errors';
import { Faq, faqJsonLd } from './error-article';

const TITLE = 'JSON errors: exact messages, causes and fixes';
const DESCRIPTION = 'Find the cause of JSON parse, serialization and type errors in JavaScript, Python, Java, Go, PHP and .NET, with exact messages by runtime and code to fix them.';
export const metadata: Metadata = {
  title: TITLE, description: DESCRIPTION, alternates: { canonical: '/json-errors' },
  openGraph: { type: 'website', url: '/json-errors', siteName: SITE_NAME, title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION, images: [SOCIAL_IMAGE] },
  twitter: { card: 'summary_large_image', title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION, images: ['/twitter-image.png'] },
};

export default function JsonErrorsHub() {
  const url = `${SITE}/json-errors`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${url}#page`, url, name: TITLE, description: DESCRIPTION,
        isPartOf: { '@id': `${SITE}/#website` }, inLanguage: 'en-US',
        mainEntity: { '@type': 'ItemList', itemListElement: ERROR_GUIDES.map((guide, index) => ({
          '@type': 'ListItem', position: index + 1, name: guide.title, url: `${url}/${guide.slug}`,
        })) },
      },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'JSON errors', item: url },
      ] },
      faqJsonLd(HUB_FAQ, url),
    ],
  };
  return (
    <ContentShell current="resources">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="page-head">
        <nav className="breadcrumbs" aria-label="Breadcrumb"><ol><li><Link prefetch={false} href="/">Home</Link></li><li aria-current="page">JSON errors</li></ol></nav>
        <p className="eyebrow">JSON troubleshooting</p>
        <h1>JSON errors: find the cause and fix the input</h1>
        <p className="lede">Start with the message you saw. Each guide explains what triggers it, with reproduced JavaScript and Python errors, cited diagnostics from other runtimes and code to fix the cause.</p>
      </header>
      <section className="resource-grid" aria-label="JSON error guides">
        {ERROR_GUIDES.map(guide => <article className="resource-card" key={guide.slug}>
          <p className="resource-kind">Error guide</p><h2><Link prefetch={false} href={`/json-errors/${guide.slug}`}>{guide.title}</Link></h2>
          <p>{guide.description}</p><p className="resource-arrow" aria-hidden="true">Read the fix →</p>
        </article>)}
      </section>
      <div className="prose">
        <h2>Check the input before changing the parser</h2>
        <p>For API failures, read the actual response body and check status and Content-Type. For file failures, inspect the saved text. A message at position zero often means the wrong data reached the parser. A message later in the document can point to a missing separator or an unescaped character.</p>
        <p>Paste the original text into the <Link prefetch={false} href="/tools/json-validator">JSON validator</Link> to inspect its line and column. Read the <Link prefetch={false} href="/resources/json-reference">syntax reference</Link> when you need to check a rule. Tool Kumar keeps parsing on your device.</p>
        <h2 id="faq">Frequently asked questions</h2><Faq entries={HUB_FAQ} />
      </div>
      <aside className="cta-band" aria-label="Validate JSON"><div>
        <p className="cta-title">Have the failing input?</p><p>Find syntax errors and inspect the original text in the browser.</p>
      </div><Link prefetch={false} className="button" href="/tools/json-validator">Open the JSON validator <span className="arrow" aria-hidden="true">→</span></Link></aside>
    </ContentShell>
  );
}
