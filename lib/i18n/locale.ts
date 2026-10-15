import { lang } from 'next/root-params';
import { isLocale, type SiteLocale } from './locales';

/**
 * The current page's language, from the [lang] root segment; English routes
 * have no such segment. Server Components only (route handlers such as the
 * sitemap cannot read root params).
 */
export async function getLocale(): Promise<SiteLocale> {
  const l = await lang();
  return isLocale(l) ? l : 'en';
}
