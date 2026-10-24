import type { Metadata } from 'next';
import IntentLink from '@/components/IntentLink';
import ContentShell from '../content-shell';
import { jsonLdScript } from '../seo';
import { pageMetadata } from '../../page-metadata';
import { SITE } from '@/lib/site';
import { localeInfo, localePath } from '@/lib/i18n/locales';
import { getLocale } from '@/lib/i18n/locale';
import { serverT, toolPages } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = serverT(locale);
  return pageMetadata({ path: '/tools', locale, title: t('hub.title'), description: t('hub.description') });
}

export default async function ToolsPage() {
  const locale = await getLocale();
  const t = serverT(locale);
  const TITLE = t('hub.title');
  const DESCRIPTION = t('hub.description');
  const TOOL_PAGES = toolPages(locale);
  const url = (path: string) => SITE + localePath(locale, path);
  const home = locale === 'en' ? SITE : url('/');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${url('/tools')}#page`, url: url('/tools'), name: TITLE, description: DESCRIPTION, isPartOf: { '@id': `${SITE}/#website` }, ...(locale !== 'en' && { inLanguage: localeInfo(locale).lang }), mainEntity: { '@type': 'ItemList', itemListElement: TOOL_PAGES.map((page, i) => ({ '@type': 'ListItem', position: i + 1, name: page.heading, url: url(`/tools/${page.slug}`) })) } },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: t('site.home'), item: home }, { '@type': 'ListItem', position: 2, name: t('site.nav.tools'), item: url('/tools') }] },
    ],
  };
  return (
    <ContentShell current="tools" path="/tools">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="page-head">
        <p className="eyebrow">{t('hub.eyebrow')}</p>
        <h1>{t('hub.h1')}</h1>
        <p className="lede">{t('hub.lede')}</p>
      </header>
      <section className="tool-grid" aria-label={t('hub.gridLabel')}>
        <article className="tool-card"><p className="resource-kind">{t('hub.formatterKind')}</p><h2><IntentLink href={localePath(locale, '/')}>{t('site.formatter')}</IntentLink></h2><p>{t('hub.formatterText')}</p><IntentLink className="resource-arrow" href={localePath(locale, '/')}>{t('hub.open')} <span aria-hidden="true">→</span></IntentLink></article>
        {TOOL_PAGES.map((page) => <article className="tool-card" key={page.slug}><p className="resource-kind">{page.modeLabel}</p><h2><IntentLink href={localePath(locale, `/tools/${page.slug}`)}>{page.heading}</IntentLink></h2><p>{page.description}</p><IntentLink className="resource-arrow" href={localePath(locale, `/tools/${page.slug}`)}>{t('hub.open')} <span aria-hidden="true">→</span></IntentLink></article>)}
      </section>
    </ContentShell>
  );
}
