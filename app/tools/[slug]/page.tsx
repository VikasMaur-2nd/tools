import type { Metadata } from 'next';
import IntentLink from '@/components/IntentLink';
import { notFound } from 'next/navigation';
import JsonTool from '@/components/JsonTool';
import { convert } from '@/lib/convert';
import { diff } from '@/lib/diff/diff';
import { patchText, toPatch } from '@/lib/diff/patch';
import { records, toCsv } from '@/lib/convert/xlsx';
import { importToJson } from '@/lib/convert/import';
import { formatDoc } from '@/lib/json/format';
import { jwtToJson } from '@/lib/json/jwt';
import { ARR, OBJ, STR, kids, parse, type JNode } from '@/lib/json/parser';
import { formatPath, pathOf } from '@/lib/json/path';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../../seo';
import ContentShell from '../../content-shell';
import { ERROR_GUIDES } from '../../json-errors/errors';
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

/** Link to an error guide; a missing guide fails the build instead of shipping a broken link. */
function errorGuide(slug: string) {
  if (!ERROR_GUIDES.some((guide) => guide.slug === slug)) throw new Error(`Unknown JSON error guide: ${slug}`);
  return `/json-errors/${slug}`;
}

function prettyJson(text: string) {
  const result = parse(text);
  if (!result.root || result.error) return text;
  return formatDoc(text, result, '  ');
}

function importedExample(text: string, format: 'yaml' | 'csv' | 'xml' | 'toml') {
  const result = importToJson(text, format, '  ');
  return 'json' in result ? prettyJson(result.json) : `Import error: ${result.error}`;
}

/** The Table view as text: an index column, then one column per key ({n} / [n] for nested values, · for missing). */
function textTable(root: JNode) {
  const items = kids(root);
  const keys: string[] = [];
  for (const it of items) if (it.t === OBJ) for (const c of kids(it)) if (!keys.includes(String(c.key))) keys.push(String(c.key));
  const cell = (n: JNode | undefined) => (!n ? '·' : n.t === OBJ ? `{${kids(n).length}}` : n.t === ARR ? `[${kids(n).length}]` : String(n.v));
  const grid = [['#', ...keys], ...items.map((it, i) => [String(i), ...keys.map((k) => cell(kids(it).find((c) => c.key === k)))])];
  const widths = keys.map((_, c) => Math.max(...grid.map((row) => row[c + 1].length)));
  return grid.map((row) => [row[0].padEnd(2), ...row.slice(1).map((v, c) => v.padEnd(widths[c]))].join('  ').trimEnd()).join('\n');
}

/** Every leaf value with its path, as the tree's path display shows it. */
function pathList(root: JNode) {
  const out: string[] = [];
  const walk = (n: JNode) => {
    if (n.t >= ARR) for (const c of kids(n)) walk(c);
    else out.push(`${formatPath(pathOf(n))}  ${n.t === STR ? JSON.stringify(n.v) : String(n.v)}`);
  };
  walk(root);
  return out.join('\n');
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
  if (page.slug === 'json-diff') {
    // The patch Copy JSON Patch gives for the sample, with its ignored path.
    const [left, right] = page.sample.replace('Original:\n', '').split('\n\nModified:\n').map((t) => parse(t).root!);
    return patchText(toPatch(diff(left, right, { ignorePaths: ['$.meta.updatedAt'], seed: 1 }).changes), '  ');
  }
  // A fixed clock keeps the prerender static (the sample expires 2027-10-01).
  if (page.slug === 'jwt-decoder') return jwtToJson(page.sample, '  ', Date.UTC(2026, 9, 14)) ?? page.sample;
  if (page.slug === 'yaml-to-json') return importedExample(page.sample, 'yaml');
  if (page.slug === 'csv-to-json') return importedExample(page.sample, 'csv');
  if (page.slug === 'xml-to-json') return importedExample(page.sample, 'xml');
  if (page.slug === 'toml-to-json') return importedExample(page.sample, 'toml');
  if (page.slug === 'jsonl-viewer' || page.slug === 'ndjson-to-json') return formatDoc(page.sample, parse(page.sample, { lines: true }), '  ');
  if (page.slug === 'sort-json-keys') return formatDoc(page.sample, parse(page.sample), '  ', true);
  if (page.slug === 'json-escape') return JSON.stringify(formatDoc(page.sample, parse(page.sample), ''));
  if (page.slug === 'json-to-table') return textTable(parse(page.sample).root!);
  if (page.slug === 'json-path-finder') return pathList(parse(page.sample).root!);
  const root = parse(page.sample).root;
  if (!root) return page.sample;
  const target = page.preset.settings?.target;
  // The tool tabulates the main array of records, as the live CSV / Excel views do.
  if (target === 'xlsx' || target === 'csv') return toCsv(records(root));
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
    openGraph: { type: 'website', url: `/tools/${page.slug}`, siteName: SITE_NAME, title: page.title, description: page.description, images: [SOCIAL_IMAGE] },
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

        {page.sections?.map(({ heading, paragraphs, code }) => <section key={heading}>
          <h2>{heading}</h2>
          {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {code && <pre className="tool-usage"><code>{code}</code></pre>}
        </section>)}

        <h2>Options and edge cases</h2>
        <ul>{page.options.map((option) => <li key={option}>{option}</li>)}</ul>

        <h2>Private by default</h2>
        <p>Your document stays in this browser. Tool Kumar parses, converts and creates downloads on your device, with no account or upload step.</p>

        <h2 id="faq">{page.heading} questions</h2>
        <dl className="tool-faq">{page.faqs.map(({ question, answer }) => <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>

        {page.guides && <>
          <h2>Related error guides</h2>
          <ul>{page.guides.map(({ slug, text }) => <li key={slug}><IntentLink href={errorGuide(slug)}>{text}</IntentLink></li>)}</ul>
        </>}

        <h2>Related tools</h2>
        <p>{page.related.map((slug, i) => {
          const home = slug === 'home';
          const study = slug === 'privacy-study';
          const label = home ? 'JSON formatter' : study ? 'JSON formatter privacy study' : TOOL_PAGE_BY_SLUG.get(slug)?.heading ?? slug;
          const href = home ? '/' : study ? '/blogs/json-formatter-privacy-study' : `/tools/${slug}`;
          return <span key={slug}>{i > 0 ? ', ' : ''}<IntentLink href={href}>{label}</IntentLink></span>;
        })}.</p>
      </div>
    </ContentShell>
  );
}

export default async function ToolPageRoute({ params }: PageProps<'/tools/[slug]'>) {
  const page = getPage((await params).slug);
  return <div className="home-page landing-page"><section className="landing-tool" aria-label={`${page.heading} tool`}><JsonTool preset={page.preset} /></section><ToolContent page={page} /></div>;
}
