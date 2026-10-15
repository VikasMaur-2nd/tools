import { Icon } from './icons';
import { localeInfo, localePath, type SiteLocale } from '@/lib/i18n/locales';
import { pathLocales, serverT } from '@/lib/i18n/server';

/*
 * Language switchers: plain crawlable links (`hreflang` + `lang`, names in their
 * own language) to the same page in every language it exists in. Server-rendered
 * and JavaScript-free; changing language is a full page load either way, since
 * each language has its own root layout.
 */

function links(path: string, locale: SiteLocale) {
  return pathLocales(path).map((l) => {
    const info = localeInfo(l);
    return (
      <li key={l}>
        <a href={localePath(l, path)} hrefLang={info.hreflang} lang={info.lang} aria-current={l === locale ? 'page' : undefined}>
          {info.name}
        </a>
      </li>
    );
  });
}

/** Footer row of the content pages. Renders nothing for a page that exists in one language only. */
export function FooterLangs({ path, locale }: { path: string; locale: SiteLocale }) {
  if (pathLocales(path).length < 2) return null;
  const label = serverT(locale)('site.lang');
  return (
    <nav className="foot-langs" aria-label={label}>
      <Icon name="globe" size={15} />
      <ul>{links(path, locale)}</ul>
    </nav>
  );
}

/** Compact menu for the app's status bar (a native disclosure: no script, Esc-free but keyboard and screen-reader friendly). */
export function StatusLangs({ path, locale }: { path: string; locale: SiteLocale }) {
  if (pathLocales(path).length < 2) return null;
  const t = serverT(locale);
  const info = localeInfo(locale);
  return (
    <details className="sb-lang">
      <summary className="sb-btn" aria-label={t('site.lang.current', { language: info.name })} title={t('site.lang')}>
        <Icon name="globe" size={14} />
        <span className="sb-lang-id" aria-hidden="true">
          {locale.toUpperCase()}
        </span>
      </summary>
      <ul className="sb-lang-menu">{links(path, locale)}</ul>
    </details>
  );
}
