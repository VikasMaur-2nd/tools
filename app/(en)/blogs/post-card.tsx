import Link from 'next/link';
import { highlightCode } from '@/lib/convert/highlight';
import { formatDate } from '../dates';
import type { Post } from './posts';

export function Arrow() {
  return (
    <svg className="arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A post teaser; the whole card is clickable through the title link. */
export function PostCard({ post, level = 2 }: { post: Post; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <article className="post-card">
      <div className="post-cover" aria-hidden="true">
        <span className="post-file">{post.slug}.json</span>
        <pre dangerouslySetInnerHTML={{ __html: highlightCode(post.sample, 'json') }} />
      </div>
      <div className="post-body">
        <p className="post-meta">
          {post.category} · {post.minutes} min read
        </p>
        <H className="post-title">
          <Link href={`/blogs/${post.slug}`}>{post.title}</Link>
        </H>
        <p className="post-excerpt">{post.excerpt}</p>
        <p className="post-foot">
          <time dateTime={post.published}>{formatDate(post.published)}</time>
          <span className="post-read" aria-hidden="true">
            Read <Arrow />
          </span>
        </p>
      </div>
    </article>
  );
}
