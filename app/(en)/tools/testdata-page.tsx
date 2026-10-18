import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentShell from '../content-shell';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../seo';
import { TESTDATA_PAGES } from '@/lib/testdata/pages';

type Page = (typeof TESTDATA_PAGES)[number];
export function testdataMetadata(page: Page): Metadata {
  const url = `/tools/${page.slug}`;
  return {
    title: { absolute: `${page.heading} | ${SITE_NAME}` },
    description: page.description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title: page.heading, description: page.description, siteName: SITE_NAME, images: [SOCIAL_IMAGE] },
    twitter: { card: 'summary_large_image', title: page.heading, description: page.description, images: ['/twitter-image.png'] },
  };
}

export function TestdataPage({ page, children }: { page: Page; children: ReactNode }) {
  const url = `${SITE}/tools/${page.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['WebApplication', 'SoftwareApplication'], '@id': `${url}#app`, url,
        name: page.heading, description: page.description, inLanguage: 'en-US',
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': `${SITE}/#organization` },
      },
      {
        '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Tools', item: `${SITE}/tools` },
          { '@type': 'ListItem', position: 3, name: page.heading, item: url },
        ],
      },
    ],
  };
  return <ContentShell current="tools">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
    <header className="page-head">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><ol><li><Link href="/">Home</Link></li><li><Link href="/tools">Tools</Link></li></ol></nav>
      <p className="eyebrow">Benchmark tools</p>
      <h1>{page.heading}</h1>
      <p className="lede">{page.intro}</p>
    </header>
    {children}
    <div className="prose">
      <p>Nothing is uploaded or stored on our server. Read the <Link href="/blogs/large-file-json-benchmark">large-file JSON benchmark</Link> for the test method and published results.</p>
      <p>{page.slug === 'json-test-file-generator' ? <>To test whether a formatter preserves numbers and duplicate members, use the <Link href="/tools/json-precision-checker">JSON precision checker</Link>.</> : <>To repeat the performance tests, create a reproducible file with the <Link href="/tools/json-test-file-generator">JSON test file generator</Link>.</>}</p>
    </div>
  </ContentShell>;
}
