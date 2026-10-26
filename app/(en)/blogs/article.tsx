import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { highlightCode } from '@/lib/convert/highlight';
import { codeWithLinks } from '@/lib/link-code';
import ArticleFrame from '../article-frame';
import { BLOG_PARENT, postJsonLd } from '../seo';
import { pageMetadata } from '../../page-metadata';
import { Arrow, PostCard } from './post-card';
import { formatDate } from '../dates';
import { POSTS, type Post } from './posts';

export function postMetadata(post: Post): Metadata {
  return pageMetadata({
    path: `/blogs/${post.slug}`,
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    article: { published: post.published, updated: post.updated, section: post.category, tags: post.keywords },
  });
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
  const toc = Children.toArray(children).filter(isSection).map((h) => ({ id: h.props.id, label: h.props.children }));
  const related = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
  return (
    <ArticleFrame
      section="blogs"
      jsonLd={postJsonLd(post)}
      parent={BLOG_PARENT}
      eyebrow={post.category}
      title={post.title}
      lede={lede}
      byline={
        <>
          <time dateTime={post.published}>{formatDate(post.published)}</time>
          {post.updated !== post.published && (
            <>
              {' · Updated '}
              <time dateTime={post.updated}>{formatDate(post.updated)}</time>
            </>
          )}
          {` · ${post.minutes} min read`}
        </>
      }
      toc={toc}
      cta={{
        name: 'Try the JSON viewer',
        title: 'Try it on your own JSON',
        text: 'Paste a document or open a local file to format, validate and repair it, then explore it as a tree or table. No account, no upload, and it works offline after the first visit.',
        href: '/',
        action: <>Open the JSON viewer <Arrow /></>,
      }}
      after={
        related.length > 0 && (
          <section className="related" aria-labelledby="related-title">
            <h2 id="related-title">Keep reading</h2>
            <div className="post-grid">
              {related.map((p) => (
                <PostCard key={p.slug} post={p} level={3} />
              ))}
            </div>
          </section>
        )
      }
    >
      {children}
    </ArticleFrame>
  );
}
