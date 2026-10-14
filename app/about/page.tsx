import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '../content-shell';
import { aboutPageLd, jsonLdScript, SITE_NAME, SOCIAL_IMAGE } from '../seo';

export const metadata: Metadata = {
  title: { absolute: 'About Tool Kumar' },
  description:
    'Learn how Tool Kumar works, why JSON stays in your browser and what to expect from this private developer tool.',
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    url: '/about',
    title: `About ${SITE_NAME}`,
    description: 'A private, browser-based JSON viewer and developer tool from Tool Kumar.',
    images: [SOCIAL_IMAGE],
  },
  twitter: { card: 'summary_large_image', title: `About ${SITE_NAME}`, description: 'A private, browser-based JSON viewer and developer tool from Tool Kumar.', images: ['/twitter-image.png'] },
};

export default function AboutPage() {
  return (
    <ContentShell current="about">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript({ '@context': 'https://schema.org', '@graph': [aboutPageLd] }) }} />
      <header className="page-head">
        <p className="eyebrow">About Tool Kumar</p>
        <h1>Private tools that keep your data close</h1>
        <p className="lede">
          Tool Kumar is a browser-based developer tool site. The first tool is a JSON viewer and formatter for inspecting, validating
          and repairing JSON without an upload step.
        </p>
      </header>

      <div className="prose">
        <h2>How the JSON viewer handles your data</h2>
        <p>
          The editor parses and formats documents in your browser. It does not need an account, and the JSON you paste or open is not
          sent to a Tool Kumar server for processing. Recent work can be restored from this browser when you return to the app.
        </p>
        <p>
          The viewer also supports offline use after the app has loaded. You can inspect large documents, search values, compare files and
          export results without moving the source JSON to another service.
        </p>

        <h2>What we publish</h2>
        <p>
          The <Link href="/blogs">Tool Kumar blog</Link> explains practical JSON and developer workflow topics. Each guide links to the tool
          so you can test the examples yourself. The <Link href="/">JSON viewer</Link> remains free to use.
        </p>
        <p>
          Our <Link href="/resources">JSON resources</Link> provide a standards-based syntax reference and original example files for
          developers, writers and teachers to cite or reuse.
        </p>

        <h2>Start with JSON</h2>
        <p>
          <Link href="/">Open the JSON viewer</Link> or read <Link href="/blogs/json-formatting-guide">how to format and validate JSON</Link> before
          you begin.
        </p>
      </div>
    </ContentShell>
  );
}
