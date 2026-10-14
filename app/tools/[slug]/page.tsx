import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonTool from '@/components/JsonTool';
import { convert } from '@/lib/convert';
import { toCsv } from '@/lib/convert/xlsx';
import { importToJson } from '@/lib/convert/import';
import { formatDoc } from '@/lib/json/format';
import { decodeJwt } from '@/lib/json/smart';
import { parse } from '@/lib/json/parser';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../../seo';
import ContentShell from '../../content-shell';
import { TOOL_PAGE_BY_SLUG, TOOL_PAGES, type ToolPage } from '@/lib/tool-pages';

export const ensureStatic = 'navigation';

export function generateStaticParams() {
  return TOOL_PAGES.map(({ slug }) => ({ slug }));
}

function getPage(slug: string): ToolPage {
  const page = TOOL_PAGE_BY_SLUG.get(slug);
  if (!page) notFound();
  return page;
}

function prettyJson(text: string) {
  const result = parse(text);
  if (!result.root || result.error) return text;
  return formatDoc(text, result, '  ');
}

function importedExample(text: string, format: 'yaml' | 'csv' | 'xml') {
  const result = importToJson(text, format, '  ');
  return 'json' in result ? prettyJson(result.json) : `Import error: ${result.error}`;
}

function exampleOutput(page: ToolPage) {
  if (page.slug === 'json-validator') {
    const result = parse(page.sample);
    const issue = result.error ?? result.issues[0];
    const p = issue?.p ?? 0;
    const before = page.sample.slice(0, p);
    const line = before.split('\n').length;
    const col = p - (before.lastIndexOf('\n') + 1) + 1;
    return `Invalid JSON\nLine ${line}, column ${col}: ${issue?.m ?? 'invalid syntax'}`;
  }
  if (page.slug === 'json-diff') return '- "role": "admin"\n+ "role": "editor"';
  if (page.slug === 'jwt-decoder') return JSON.stringify(decodeJwt(page.sample, 1700000000000), null, 2);
  if (page.slug === 'yaml-to-json') return importedExample(page.sample, 'yaml');
  if (page.slug === 'csv-to-json') return importedExample(page.sample, 'csv');
  if (page.slug === 'xml-to-json') return importedExample(page.sample, 'xml');
  const root = parse(page.sample).root;
  if (!root) return page.sample;
  const target = page.preset.settings?.target;
  if (target === 'xlsx') return toCsv(root);
  if (target === 'csv') return toCsv(root);
  if (target) return convert(root, target, { rootName: 'Root', tsStyle: 'interface' });
  if (page.slug === 'json-minifier') return formatDoc(page.sample, parse(page.sample), '');
  return formatDoc(page.sample, parse(page.sample), '  ');
}

function pageJsonLd(page: ToolPage) {
  const url = `${SITE}/tools/${page.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['WebApplication', 'SoftwareApplication'],
        '@id': `${url}#app`,
        name: `Tool Kumar ${page.heading}`,
        url,
        description: page.description,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [page.modeLabel, 'Local browser processing', 'Copy and download output'],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Tools', item: `${SITE}/tools` },
          { '@type': 'ListItem', position: 3, name: page.heading, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: page.faqs.map(({ question, answer }) => ({
          '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
}

export async function generateMetadata({ params }: PageProps<'/tools/[slug]'>): Promise<Metadata> {
  const page = getPage((await params).slug);
  return {
    title: { absolute: `${page.title} | ${SITE_NAME}` },
    description: page.description,
    keywords: [page.query, ...page.secondary],
    alternates: { canonical: `/tools/${page.slug}` },
    openGraph: { type: 'website', url: `/tools/${page.slug}`, title: page.title, description: page.description, images: [SOCIAL_IMAGE] },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: ['/twitter-image.png'] },
  };
}

function ToolContent({ page }: { page: ToolPage }) {
  const output = exampleOutput(page);
  return (
    <ContentShell current="tools">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(pageJsonLd(page)) }} />
      <header className="page-head tool-page-head">
        <p className="eyebrow">Tool Kumar tool</p>
        <h1>{page.heading}</h1>
        <p className="lede">{page.intro}</p>
      </header>

      <div className="prose tool-prose">
        <h2>How to use this tool</h2>
        <ol>{page.steps.map((step) => <li key={step}>{step}</li>)}</ol>

        <h2>Worked example</h2>
        <p>{page.exampleLabel}</p>
        <div className="tool-example-grid">
          <div><h3>Input{page.sampleName ? ` · ${page.sampleName}` : ''}</h3><pre><code>{page.sample}</code></pre></div>
          <div><h3>Output</h3><pre><code>{output}</code></pre></div>
        </div>

        <h2>Options and edge cases</h2>
        <ul>{page.options.map((option) => <li key={option}>{option}</li>)}</ul>

        <h2>Private by default</h2>
        <p>Your document stays in this browser. Tool Kumar parses, converts and creates downloads on your device, with no account or upload step.</p>

        <h2 id="faq">{page.heading} questions</h2>
        <dl className="tool-faq">{page.faqs.map(({ question, answer }) => <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>

        <h2>Related tools</h2>
        <p>{page.related.map((slug, i) => <span key={slug}>{i > 0 ? ', ' : ''}<Link href={`/tools/${slug}`}>{TOOL_PAGE_BY_SLUG.get(slug)?.heading ?? slug}</Link></span>)}.</p>
      </div>
    </ContentShell>
  );
}

export default async function ToolPageRoute({ params }: PageProps<'/tools/[slug]'>) {
  const page = getPage((await params).slug);
  return <><div className="landing-tool"><JsonTool preset={page.preset} /></div><ToolContent page={page} /></>;
}
