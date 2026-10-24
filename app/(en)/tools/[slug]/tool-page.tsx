import type { Metadata } from 'next';
import type { ComponentProps, ReactNode } from 'react';
import type IntentLink from '@/components/IntentLink';
import { notFound } from 'next/navigation';
import type JsonTool from '@/components/JsonTool';
import { StatusLangs } from '@/components/LangSwitch';
import { convert } from '@/lib/convert';
import { diff } from '@/lib/diff/diff';
import { patchText, toPatch } from '@/lib/diff/patch';
import { records, toCsv } from '@/lib/convert/xlsx';
import { importToJson } from '@/lib/convert/import';
import { formatDoc } from '@/lib/json/format';
import { jwtToJson } from '@/lib/json/jwt';
import { ARR, OBJ, STR, kids, parse, type JNode } from '@/lib/json/parser';
import { formatPath, pathOf } from '@/lib/json/path';
import { SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../../seo';
import { SITE } from '@/lib/site';
import { pageSocialImage } from '../../../social-images';
import ContentShell from '../../content-shell';
import { ERROR_GUIDES } from '../../json-errors/errors';
import { TOOL_PAGE_BY_SLUG, TOOL_PAGES, type ToolPage } from '@/lib/tool-pages';
import { localeInfo, localePath, type SiteLocale } from '@/lib/i18n/locales';
import { getLocale } from '@/lib/i18n/locale';
import { alternates, ogLocales, serverT, toolPage } from '@/lib/i18n/server';

export const ensureStatic = 'navigation';

export function generateStaticParams() {
  return TOOL_PAGES.map(({ slug }) => ({ slug }));
}

/** The page in the current language (English routes, or a translation under /<lang>). */
async function getPage(slug: string): Promise<{ page: ToolPage; locale: SiteLocale }> {
  const locale = await getLocale();
  const page = locale === 'en' ? TOOL_PAGE_BY_SLUG.get(slug) : toolPage(locale, slug);
  if (!page) notFound();
  return { page, locale };
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

function pageJsonLd(page: ToolPage, locale: SiteLocale) {
  const t = serverT(locale);
  const url = SITE + localePath(locale, `/tools/${page.slug}`);
  const inLanguage = locale === 'en' ? {} : { inLanguage: localeInfo(locale).lang };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['WebApplication', 'SoftwareApplication'],
        '@id': `${url}#app`,
        name: t('tool.appName', { heading: page.heading }),
        url,
        description: page.description,
        ...inLanguage,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [page.modeLabel, t('tool.feature.local'), t('tool.feature.copy')],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t('site.home'), item: SITE + (locale === 'en' ? '' : `/${locale}`) },
          { '@type': 'ListItem', position: 2, name: t('site.nav.tools'), item: SITE + localePath(locale, '/tools') },
          { '@type': 'ListItem', position: 3, name: page.heading, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        ...inLanguage,
        mainEntity: page.faqs.map(({ question, answer }) => ({
          '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
}

export async function generateMetadata({ params }: PageProps<'/tools/[slug]'>): Promise<Metadata> {
  const { page, locale } = await getPage((await params).slug);
  const path = `/tools/${page.slug}`;
  // Localized pages add og:locale (+ alternates) and a translated image description.
  // A page with its own preview uses it in every language (its title is the description).
  const own = page.image ? pageSocialImage(page.image, page.title) : null;
  const image = own ?? (locale === 'en' ? SOCIAL_IMAGE : { ...SOCIAL_IMAGE, alt: serverT(locale)('site.ogAlt') });
  const og = locale === 'en' ? { images: [image] } : { ...ogLocales(path, locale), images: [image] };
  return {
    title: { absolute: `${page.title} | ${SITE_NAME}` },
    description: page.description,
    keywords: [page.query, ...page.secondary],
    alternates: alternates(path, locale),
    openGraph: { type: 'website', url: localePath(locale, path), siteName: SITE_NAME, title: page.title, description: page.description, ...og },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [own ? own.url : '/twitter-image.png'] },
  };
}

/** "A, B, C." in English; translated pages list the links the way their language does ("A、B、C。"). */
function relatedLinks(page: ToolPage, locale: SiteLocale, Link: typeof IntentLink) {
  const t = serverT(locale);
  const links = page.related.map((slug) => {
    const home = slug === 'home';
    const study = slug === 'privacy-study';
    // Related pages stay in this language where they exist, otherwise link to English.
    const local = home || study || locale === 'en' ? null : toolPage(locale, slug);
    const english = locale !== 'en' && (study || (!home && !local));
    const label = home ? t('site.formatter') : study ? t('tool.study') : (local ?? TOOL_PAGE_BY_SLUG.get(slug))?.heading ?? slug;
    const href = home ? localePath(locale, '/') : study ? '/blogs/json-formatter-privacy-study' : localePath(english ? 'en' : locale, `/tools/${slug}`);
    return <Link key={slug} href={href} {...(english && { hrefLang: 'en', lang: study ? undefined : 'en' })}>{label}</Link>;
  });
  if (locale === 'en') return <>{links.map((link, i) => <span key={i}>{i > 0 ? ', ' : ''}{link}</span>)}.</>;
  const lang = localeInfo(locale).lang;
  let i = 0;
  const parts = new Intl.ListFormat(lang, { type: 'conjunction' }).formatToParts(links.map(() => '\u0000'));
  return <>{parts.map((p, k) => (p.type === 'element' ? links[i++] : <span key={`s${k}`}>{p.value}</span>))}{/^(ja|zh)/.test(lang) ? '。' : '.'}</>;
}

function ToolContent({ page, locale, Link }: { page: ToolPage; locale: SiteLocale; Link: typeof IntentLink }) {
  const output = exampleOutput(page);
  const t = serverT(locale);
  return (
    <ContentShell current="tools" path={`/tools/${page.slug}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(pageJsonLd(page, locale)) }} />
      <header className="page-head tool-page-head">
        <p className="eyebrow">{t('tool.eyebrow')}</p>
        <h1>{page.heading}</h1>
        <p className="lede">{page.intro}</p>
      </header>

      <div className="prose tool-prose">
        <h2>{t('tool.howTo')}</h2>
        <ol>{page.steps.map((step) => <li key={step}>{step}</li>)}</ol>

        <h2>{t('tool.example')}</h2>
        <p>{page.exampleLabel}</p>
        <div className="tool-example-grid">
          <div><h3>{t('tool.input')}{page.sampleName ? ` · ${page.sampleName}` : ''}</h3><pre><code>{page.sample}</code></pre></div>
          <div><h3>{t('tool.output')}</h3><pre><code>{output}</code></pre></div>
        </div>

        {page.sections?.map(({ heading, paragraphs, code }) => <section key={heading}>
          <h2>{heading}</h2>
          {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {code && <pre className="tool-usage"><code>{code}</code></pre>}
        </section>)}

        <h2>{t('tool.options')}</h2>
        <ul>{page.options.map((option) => <li key={option}>{option}</li>)}</ul>

        <h2>{t('tool.private')}</h2>
        <p>{t('tool.privateText')}</p>

        <h2 id="faq">{t('tool.faq', { heading: page.heading })}</h2>
        <dl className="tool-faq">{page.faqs.map(({ question, answer }) => <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>

        {page.guides && <>
          <h2>{t('tool.guides')}</h2>
          <ul>{page.guides.map(({ slug, text }) => <li key={slug}><Link href={errorGuide(slug)} {...(locale !== 'en' && { hrefLang: 'en' })}>{text}</Link></li>)}</ul>
        </>}

        <h2>{t('tool.related')}</h2>
        <p>{relatedLinks(page, locale, Link)}</p>
      </div>
    </ContentShell>
  );
}

export default async function ToolPageRoute(
  { params }: { params: Promise<{ slug: string }> },
  renderTool: (props: ComponentProps<typeof JsonTool>, locale: SiteLocale) => ReactNode,
  Link: typeof IntentLink,
) {
  const { page, locale } = await getPage((await params).slug);
  const langs = <StatusLangs path={`/tools/${page.slug}`} locale={locale} />;
  const tool = renderTool({ preset: page.preset, langs }, locale);
  return <div className="home-page landing-page"><section className="landing-tool" aria-label={serverT(locale)('tool.section', { heading: page.heading })}>{tool}</section><ToolContent page={page} locale={locale} Link={Link} /></div>;
}
