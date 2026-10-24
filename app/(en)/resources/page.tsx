import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '../content-shell';
import { jsonLdScript } from '../seo';
import { pageMetadata } from '../../page-metadata';
import { SITE } from '@/lib/site';

const TITLE = 'JSON developer resources: reference, examples and guides';
const DESCRIPTION =
  'Citable JSON resources for developers: a syntax reference, reusable API examples, formatting guidance and the history of the format.';

export const metadata: Metadata = pageMetadata({ path: '/resources', title: TITLE, description: DESCRIPTION });

const resources = [
  {
    href: "/json-errors",
    kind: "Troubleshooting",
    title: "JSON error messages and fixes",
    description: "Exact runtime messages, reproducible causes and fixes for HTML responses, empty input, quoting and other JSON parsing failures.",
  },
  {
    href: '/resources/json-reference',
    kind: 'Reference',
    title: 'JSON syntax reference',
    description: 'A standards-based guide to values, objects, arrays, strings, numbers, whitespace and common JSON mistakes.',
  },
  {
    href: '/resources/json-examples',
    kind: 'Examples',
    title: 'JSON examples for APIs and tests',
    description: 'Small, valid documents for API responses, application configuration and nested data, with downloadable files.',
  },
  {
    href: '/blogs/json-formatting-guide',
    kind: 'Guide',
    title: 'How to format and validate JSON',
    description: 'A practical walkthrough for finding syntax errors, choosing indentation and repairing loose JSON safely.',
  },
  {
    href: '/blogs/origin-of-json',
    kind: 'History',
    title: 'The origin of JSON',
    description: 'The story from early browser messaging to RFC 8259, ECMA-404 and the format used by APIs today.',
  },
];

export default function ResourcesPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${SITE}/resources#page`,
        url: `${SITE}/resources`,
        name: TITLE,
        description: DESCRIPTION,
        isPartOf: { '@id': `${SITE}/#website` },
        inLanguage: 'en-US',
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: resources.map((resource, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: resource.title,
            url: `${SITE}${resource.href}`,
          })),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE }, { '@type': 'ListItem', position: 2, name: 'Resources', item: `${SITE}/resources` }],
      },
    ],
  };

  return (
    <ContentShell current="resources">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="page-head">
        <p className="eyebrow">Tool Kumar resources</p>
        <h1>JSON resources you can cite and reuse</h1>
        <p className="lede">
          Standards-based explanations and small examples for documentation, code reviews, API work and classroom notes. Start with the{' '}
          <Link href="/resources/json-reference">JSON syntax reference</Link> or download a <Link href="/resources/json-examples">ready-made example</Link>.
        </p>
      </header>

      <section className="resource-grid" aria-label="JSON resources">
        {resources.map((resource) => (
          <article className="resource-card" key={resource.href}>
            <p className="resource-kind">{resource.kind}</p>
            <h2><Link href={resource.href}>{resource.title}</Link></h2>
            <p>{resource.description}</p>
            <p className="resource-arrow" aria-hidden="true">Read resource →</p>
          </article>
        ))}
      </section>

      <aside className="cta-band" aria-label="Try the JSON viewer">
        <div>
          <p className="cta-title">Have a document to inspect?</p>
          <p>Format, validate, repair, compare and convert JSON in your browser. Your input stays on your device.</p>
        </div>
        <Link className="button" href="/">Open the JSON viewer <span className="arrow" aria-hidden="true">→</span></Link>
      </aside>
    </ContentShell>
  );
}
