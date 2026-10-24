import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import ArticleFrame from '../article-frame';
import { Code } from '../blogs/article';
import { PAGE_DATES, formatDate } from '../dates';
import { articleJsonLd } from '../seo';
import { pageMetadata } from '../../page-metadata';

type Dates = { published: string; updated: string };
type ResourcePath = '/resources/json-reference' | '/resources/json-examples';

export function resourceMetadata({ title, description, path, published, updated }: { title: string; description: string; path: string } & Dates): Metadata {
  return pageMetadata({ path, title, description, article: { published, updated } });
}

const PARENT = { name: 'Resources', path: '/resources' };

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
  path: ResourcePath;
  keywords: string[];
  toc: { id: string; label: string }[];
  children: ReactNode;
}) {
  const { published, updated } = PAGE_DATES[path];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': articleJsonLd({ type: 'TechArticle', path, title, description: lede, published, updated, parent: PARENT, fields: { keywords } }),
  };
  return (
    <ArticleFrame
      section="resources"
      jsonLd={jsonLd}
      parent={PARENT}
      eyebrow="JSON resource"
      title={title}
      lede={lede}
      byline={<><time dateTime={updated}>{formatDate(updated)}</time> · Maintained reference</>}
      toc={toc}
      cta={{
        name: 'Try the JSON viewer',
        title: 'Check an example in the viewer',
        text: 'Paste an example or open a local file to format, validate and inspect it. Documents stay in your browser.',
        href: '/',
        action: <>Open the JSON viewer <span className="arrow" aria-hidden="true">→</span></>,
      }}
    >
      {children}
    </ArticleFrame>
  );
}

export { Code };
