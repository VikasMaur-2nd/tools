/**
 * The site's languages: the only list there is. English lives at the root
 * (no prefix) and is the x-default; every other language lives under
 * /<id>/… with the same English slugs. Adding a language is a new entry here
 * plus its folder of translations in lib/i18n/<id>/ (TypeScript then points
 * at the one catalog line still missing).
 */
export interface LocaleInfo {
  /** URL segment and translation folder. */
  id: string;
  /** The language's name in that language (language switchers). */
  name: string;
  /** `<html lang>` and `inLanguage`. */
  lang: string;
  /** hreflang value in alternates and the sitemap. */
  hreflang: string;
  /** og:locale. */
  og: string;
}

export const ENGLISH = { id: 'en', name: 'English', lang: 'en', hreflang: 'en', og: 'en_US' } as const satisfies LocaleInfo;

export const LOCALES = [
  { id: 'es', name: 'Español', lang: 'es', hreflang: 'es', og: 'es_ES' },
  { id: 'pt', name: 'Português (Brasil)', lang: 'pt-BR', hreflang: 'pt', og: 'pt_BR' },
  { id: 'de', name: 'Deutsch', lang: 'de', hreflang: 'de', og: 'de_DE' },
  { id: 'fr', name: 'Français', lang: 'fr', hreflang: 'fr', og: 'fr_FR' },
  { id: 'ja', name: '日本語', lang: 'ja', hreflang: 'ja', og: 'ja_JP' },
  { id: 'ko', name: '한국어', lang: 'ko', hreflang: 'ko', og: 'ko_KR' },
  { id: 'zh', name: '简体中文', lang: 'zh-Hans', hreflang: 'zh-Hans', og: 'zh_CN' },
  { id: 'ru', name: 'Русский', lang: 'ru', hreflang: 'ru', og: 'ru_RU' },
] as const satisfies readonly LocaleInfo[];

export type Locale = (typeof LOCALES)[number]['id'];
/** A page's language: English or one of the translations. */
export type SiteLocale = Locale | 'en';

export const isLocale = (id: unknown): id is Locale => LOCALES.some((l) => l.id === id);

export const localeInfo = (id: SiteLocale): LocaleInfo => LOCALES.find((l) => l.id === id) ?? ENGLISH;

/** `/tools/x` in a language: English unprefixed, others under /<id>. */
export const localePath = (locale: SiteLocale, path: string) => (locale === 'en' ? path : path === '/' ? `/${locale}` : `/${locale}${path}`);
