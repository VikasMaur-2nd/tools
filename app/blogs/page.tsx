import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '../content-shell';
import { blogPageLd, jsonLdScript, SITE_NAME, SOCIAL_IMAGE } from '../seo';
import { Arrow, PostCard } from './post-card';
import { POSTS } from './posts';

const TITLE = 'JSON blog: guides, tips and history';
const DESCRIPTION =
  'Practical JSON guides for developers: format and validate JSON, fix syntax errors and learn where the format came from. Free from Tool Kumar.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/blogs' },
  openGraph: {
    type: 'website',
    url: '/blogs',
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION, images: ['/twitter-image.png'] },
};

export default function BlogsPage() {
  return (
    <ContentShell current="blogs">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript({ '@context': 'https://schema.org', '@graph': [blogPageLd] }) }} />
      <header className="page-head">
        <p className="eyebrow">Tool Kumar blog</p>
        <h1>JSON guides, tips and history</h1>
        <p className="lede">
          Clear, practical writing for developers who read, debug and ship JSON every day. Each post links to the free{' '}
          <Link href="/">JSON viewer</Link>, so you can try every example as you read.
        </p>
      </header>

      <div className="post-grid">
        {POSTS.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>

      <aside className="cta-band" aria-label="Try the JSON viewer">
        <div>
          <p className="cta-title">Format, validate and repair JSON in your browser</p>
          <p>Free, private and offline-ready. Nothing you paste is uploaded.</p>
        </div>
        <Link className="button" href="/">
          Open the JSON viewer <Arrow />
        </Link>
      </aside>
    </ContentShell>
  );
}
