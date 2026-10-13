import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from '../blogs/article';
import ContentShell, { Logo } from '../content-shell';
import { jsonLdScript, SITE, SITE_NAME, SOCIAL_IMAGE } from '../seo';

export const RESOURCE_DATE = '2026-10-13';

export function resourceMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      url: path,
      title: `${title} | ${SITE_NAME}`,
      description,
      publishedTime: RESOURCE_DATE,
      modifiedTime: RESOURCE_DATE,
      authors: [SITE_NAME],
      images: [SOCIAL_IMAGE],
    },
    twitter: { card: 'summary_large_image', title: `${title} | ${SITE_NAME}`, description, images: ['/twitter-image.png'] },
  };
}

export function resourceJsonLd({ title, description, path, keywords }: { title: string; description: string; path: string; keywords: string[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: jsonLdScript({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'TechArticle',
              '@id': `${SITE}${path}#article`,
              headline: title,
              description,
              url: `${SITE}${path}`,
              mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}${path}` },
              image: `${SITE}${SOCIAL_IMAGE.url}`,
              datePublished: RESOURCE_DATE,
              dateModified: RESOURCE_DATE,
              author: { '@id': `${SITE}/#organization` },
              publisher: { '@id': `${SITE}/#organization` },
              keywords,
              isPartOf: { '@id': `${SITE}/resources#page` },
              inLanguage: 'en-US',
            },
            {
              '@type': 'BreadcrumbList',
              '@id': `${SITE}${path}#breadcrumb`,
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
                { '@type': 'ListItem', position: 2, name: 'Resources', item: `${SITE}/resources` },
                { '@type': 'ListItem', position: 3, name: title, item: `${SITE}${path}` },
              ],
            },
          ],
        }),
      }}
    />
  );
}

export function ResourceArticle({
  title,
  lede,
  path,
  keywords,
  toc,
  children,
}: {
  title: string;
  lede: string;
  path: string;
  keywords: string[];
  toc: { id: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <ContentShell current="resources" progress>
      {resourceJsonLd({ title, description: lede, path, keywords })}
      <article className="article">
        <header className="article-head">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/resources">Resources</Link></li>
            </ol>
          </nav>
          <p className="eyebrow">JSON resource</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          <div className="byline">
            <Logo size={36} />
            <p>
              <span className="byline-name">{SITE_NAME}</span>
              <span className="byline-meta"><time dateTime={RESOURCE_DATE}>October 13, 2026</time> · Maintained reference</span>
            </p>
          </div>
        </header>

        <div className="article-grid">
          <div className="article-main">
            <div className="prose">{children}</div>
            <aside className="cta-card" aria-label="Try the JSON viewer">
              <p className="cta-title">Check an example in the viewer</p>
              <p>Paste an example or open a local file to format, validate and inspect it. Documents stay in your browser.</p>
              <Link className="button" href="/">Open the JSON viewer <span className="arrow" aria-hidden="true">→</span></Link>
            </aside>
          </div>
          <nav className="toc" aria-labelledby="toc-title">
            <p id="toc-title">On this page</p>
            <ol>
              {toc.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>)}
            </ol>
          </nav>
        </div>
      </article>
    </ContentShell>
  );
}

export { Code };
