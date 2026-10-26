import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentShell, { Logo } from './content-shell';
import { jsonLdScript, SITE_NAME } from './seo';

/** The page that lists an article: its breadcrumb and the article's isPartOf (seo.ts articleJsonLd). */
export type ArticleParent = { name: string; path: string };

/**
 * The layout every article shares (blog posts, resources, error guides):
 * breadcrumbs, heading, byline, the body beside a table of contents, a call to
 * action under the body, and the page's structured data. Rendered on the server.
 */
export default function ArticleFrame({
  section,
  jsonLd,
  parent,
  current,
  eyebrow,
  title,
  lede,
  byline,
  toc,
  cta,
  prefetch,
  children,
  after,
}: {
  section: 'blogs' | 'resources';
  jsonLd: unknown;
  parent: ArticleParent;
  /** The article itself as the breadcrumb's last item. */
  current?: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  /** Dates and reading notes after the site name. */
  byline: ReactNode;
  toc: { id: string; label: ReactNode }[];
  cta: { name: string; title: ReactNode; text: ReactNode; href: string; action: ReactNode };
  /** false: links here don't prefetch (pages that link to many guides). */
  prefetch?: false;
  children: ReactNode;
  /** After the article, inside the page (related posts). */
  after?: ReactNode;
}) {
  return (
    <ContentShell current={section} progress>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <article className="article">
        <header className="article-head">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link prefetch={prefetch} href="/">Home</Link>
              </li>
              <li>
                <Link prefetch={prefetch} href={parent.path}>{parent.name}</Link>
              </li>
              {current && <li aria-current="page">{current}</li>}
            </ol>
          </nav>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          <div className="byline">
            <Logo size={36} />
            <p>
              <span className="byline-name">{SITE_NAME}</span>
              <span className="byline-meta">{byline}</span>
            </p>
          </div>
        </header>

        <div className="article-grid">
          <div className="article-main">
            <div className="prose">{children}</div>
            <aside className="cta-card" aria-label={cta.name}>
              <p className="cta-title">{cta.title}</p>
              <p>{cta.text}</p>
              <Link prefetch={prefetch} className="button" href={cta.href}>
                {cta.action}
              </Link>
            </aside>
          </div>
          {toc.length > 0 && (
            <nav className="toc" aria-labelledby="toc-title">
              <p id="toc-title">On this page</p>
              <ol>
                {toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`}>{item.label}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>
      </article>
      {after}
    </ContentShell>
  );
}
