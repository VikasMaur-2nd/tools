import IntentLink from '@/components/IntentLink';
import { localePath } from '@/lib/i18n/locales';
import { getLocale } from '@/lib/i18n/locale';
import { serverT } from '@/lib/i18n/server';
import ContentShell from '../(en)/content-shell';

/** 404 inside a language: untranslated or unknown pages under /<lang>/… */
export default async function NotFound() {
  const locale = await getLocale();
  const t = serverT(locale);
  return (
    <ContentShell>
      <header className="page-head">
        <h1>{t('notFound.title')}</h1>
        <p className="lede">{t('notFound.text')}</p>
      </header>
      <p className="hero-actions">
        <IntentLink className="btn primary lg" href={localePath(locale, '/')}>
          {t('notFound.home')}
        </IntentLink>{' '}
        <IntentLink className="btn lg" href={localePath(locale, '/tools')}>
          {t('notFound.tools')}
        </IntentLink>
      </p>
    </ContentShell>
  );
}
