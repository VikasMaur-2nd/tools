import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { highlightCode } from '@/lib/convert/highlight';
import { codeWithLinks } from '@/lib/link-code';
import ContentShell, { Logo } from '../content-shell';
import { jsonLdScript, postJsonLd, SITE_NAME, SOCIAL_IMAGE } from '../seo';
import { Arrow, PostCard } from './post-card';
import { POSTS, formatDate, type Post } from './posts';

export function postMetadata(post: Post): Metadata {
  const url = `/blogs/${post.slug}`;
  const title = `${post.title} | ${SITE_NAME}`;
  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      siteName: SITE_NAME,
      title,
      description: post.description,
      publishedTime: post.published,
      modifiedTime: post.updated,
      authors: [SITE_NAME],
      section: post.category,
      tags: post.keywords,
      images: [SOCIAL_IMAGE],
    },
    twitter: { card: 'summary_large_image', title, description: post.description, images: ['/twitter-image.png'] },
  };
}

/**
 * A syntax-highlighted, line-numbered code block, rendered on the server (no
 * client JS). `error` marks a 1-based line the text refers to; `links` colours
 * Tool Kumar links in it by part (lib/link-colors.ts).
 */
export function Code({ children, lang = 'json', error, links }: { children: string; lang?: string; error?: number; links?: boolean }) {
  // Neither lets a span cross a line break, so lines split cleanly. (`links`: Tool Kumar links coloured by part.)
  const html = (links ? codeWithLinks : highlightCode)(children, lang)
    .split('\n')
    .map((line, i) => `<span class="${i + 1 === error ? 'ln ln-err' : 'ln'}">${line}</span>`)
    .join('\n');
  return (
    <figure className="code">
      <figcaption>{lang.toUpperCase()}</figcaption>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </figure>
  );
}

type Heading = ReactElement<{ id: string; children: ReactNode }>;

const isSection = (node: ReactNode): node is Heading =>
  isValidElement<{ id?: unknown }>(node) && node.type === 'h2' && typeof node.props.id === 'string';

/**
 * Layout for a blog post. The table of contents is built from the `<h2 id>`
 * elements passed directly as children.
 */
export function Article({ post, lede, children }: { post: Post; lede: ReactNode; children: ReactNode }) {
  const toc = Children.toArray(children).filter(isSection);
  const related = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
  return (
    <ContentShell current="blogs" progress>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(postJsonLd(post)) }} />
      <article className="article">
        <header className="article-head">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li>
                <Link href="/blogs">Blog</Link>
              </li>
            </ol>
          </nav>
          <p className="eyebrow">{post.category}</p>
          <h1>{post.title}</h1>
          <p className="lede">{lede}</p>
          <div className="byline">
            <Logo size={36} />
            <p>
              <span className="byline-name">{SITE_NAME}</span>
              <span className="byline-meta">
                <time dateTime={post.published}>{formatDate(post.published)}</time>
                {post.updated !== post.published && (
                  <>
                    {' · Updated '}
                    <time dateTime={post.updated}>{formatDate(post.updated)}</time>
                  </>
                )}
                {` · ${post.minutes} min read`}
              </span>
            </p>
          </div>
        </header>

        <div className="article-grid">
          <div className="article-main">
            <div className="prose">{children}</div>
            <aside className="cta-card" aria-label="Try the JSON viewer">
              <p className="cta-title">Try it on your own JSON</p>
              <p>
                Paste a document or open a local file to format, validate and repair it, then explore it as a tree or table. No
                account, no upload, and it works offline after the first visit.
              </p>
              <Link className="button" href="/">
                Open the JSON viewer <Arrow />
              </Link>
            </aside>
          </div>
          {toc.length > 0 && (
            <nav className="toc" aria-labelledby="toc-title">
              <p id="toc-title">On this page</p>
              <ol>
                {toc.map((h) => (
                  <li key={h.props.id}>
                    <a href={`#${h.props.id}`}>{h.props.children}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="related" aria-labelledby="related-title">
          <h2 id="related-title">Keep reading</h2>
          <div className="post-grid">
            {related.map((p) => (
              <PostCard key={p.slug} post={p} level={3} />
            ))}
          </div>
        </section>
      )}
    </ContentShell>
  );
}
