import Link from 'next/link';
import { localePath, type SiteLocale } from '@/lib/i18n/locales';
import { rich } from '@/lib/i18n/rich';
import { serverT, toolPage } from '@/lib/i18n/server';
import { faqEntries } from './seo';

export default function SeoContent({ locale = 'en' }: { locale?: SiteLocale }) {
  const t = serverT(locale);
  const graph = toolPage(locale, 'json-visualizer');
  // The blog and resources are English: localized pages mark those links.
  const en = locale === 'en' ? {} : { hrefLang: 'en' };
  const link = (href: string, local = false) => <Link href={local ? localePath(locale, href) : href} {...(local ? {} : en)} />;
  return (
    <section className="seo-content" aria-labelledby="seo-content-title">
      <h2 id="seo-content-title">{t('home.h2')}</h2>
      <p>{t('home.intro')}</p>
      <h2>{t('home.toolsH2')}</h2>
      <ul>
        <li>{t('home.tools.1')}</li>
        {graph && <li><Link href={localePath(locale, '/tools/json-visualizer')}>{graph.heading}</Link>. {graph.intro}</li>}
        <li>{rich(t('home.tools.validator'), { validator: link('/tools/json-validator', true) })}</li>
        {([3, 4, 5] as const).map((i) => (
          <li key={i}>{t(`home.tools.${i}`)}</li>
        ))}
        <li>{rich(t('home.tools.large'), { large: link('/tools/large-json-viewer', true) })}</li>
        <li>{t('home.tools.6')}</li>
      </ul>
      <h2>{t('home.howH2')}</h2>
      <ol>
        {([1, 2, 3] as const).map((i) => (
          <li key={i}>{t(`home.how.${i}`)}</li>
        ))}
      </ol>
      <h2>{t('home.privateH2')}</h2>
      <p>{t('home.private')}</p>
      <h2>{t('home.faqH2')}</h2>
      <dl>
        {faqEntries(locale).map(({ question, answer }) => [<dt key={question}>{question}</dt>, <dd key={answer}>{answer}</dd>])}
      </dl>
      <p>{rich(t('home.more.blog'), { blog: link('/blogs'), origin: link('/blogs/origin-of-json') })}</p>
      <p>{rich(t('home.more.errors'), { errors: link('/json-errors') })}</p>
      <p>{rich(t('home.more.resources'), { reference: link('/resources/json-reference'), examples: link('/resources/json-examples') })}</p>
      <p>{rich(t('home.more.tools'), { tools: link('/tools', true) })}</p>
      <p>{rich(t('home.more.privacy'), { privacy: link('/privacy') })}</p>
    </section>
  );
}
