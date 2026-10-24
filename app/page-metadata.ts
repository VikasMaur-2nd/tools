import type { Metadata } from 'next';
import { localeInfo, localePath, type SiteLocale } from '@/lib/i18n/locales';
import { alternates, ogLocales, serverT } from '@/lib/i18n/server';
import { SITE_NAME } from './(en)/seo';
import { englishSocialImages } from './social-images';

/*
 * Every page's <head>: title, description, canonical and hreflang, Open Graph
 * and Twitter cards. Next.js merges metadata shallowly, so a page that sets
 * openGraph replaces the root layout's whole object: building it here in one
 * place keeps og:locale, the language alternates and the versioned images on
 * every page.
 */

type SocialImage = { url: string; alt: string; type: string; width: number; height: number };

/** The site-wide preview in a language: one versioned file, its description translated. */
export function socialImages(locale: SiteLocale): { openGraph: SocialImage; twitter: SocialImage } {
  if (locale === 'en') return englishSocialImages;
  const alt = serverT(locale)('site.ogAlt');
  return { openGraph: { ...englishSocialImages.openGraph, alt }, twitter: { ...englishSocialImages.twitter, alt } };
}

/** Paths that exist in other languages (lib/i18n/server.ts pathLocales): the rest are English only. */
const translated = (path: string) => path === '/' || path === '/tools' || path.startsWith('/tools/');

export function pageMetadata({
  path,
  locale = 'en',
  title,
  fullTitle = false,
  description,
  keywords,
  image,
  article,
}: {
  /** The English path ('/tools/json-validator'); a translation's URL adds its language. */
  path: string;
  locale?: SiteLocale;
  /** Without the site name: the <title> adds " | Tool Kumar" unless `fullTitle`. Cards show it as is (og:site_name names the site). */
  title: string;
  fullTitle?: boolean;
  description: string;
  keywords?: string[];
  /** The page's own preview (social-images.ts pageSocialImage), in every language. Default: the site-wide one. */
  image?: SocialImage;
  /** Articles: ISO dates, section and tags. */
  article?: { published: string; updated: string; section?: string; tags?: string[] };
}): Metadata {
  const images = image ? { openGraph: image, twitter: image } : socialImages(locale);
  return {
    title: fullTitle ? { absolute: title } : title,
    description,
    ...(keywords && { keywords }),
    alternates: translated(path) ? alternates(path, locale) : { canonical: path },
    openGraph: {
      url: localePath(locale, path),
      siteName: SITE_NAME,
      title,
      description,
      ...(translated(path) ? ogLocales(path, locale) : { locale: localeInfo(locale).og }),
      images: [images.openGraph],
      ...(article
        ? { type: 'article' as const, publishedTime: article.published, modifiedTime: article.updated, authors: [SITE_NAME], section: article.section, tags: article.tags }
        : { type: 'website' as const }),
    },
    twitter: { card: 'summary_large_image', title, description, images: [images.twitter] },
  };
}
