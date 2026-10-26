import type { Metadata } from 'next';
import { localeInfo, localePath, type SiteLocale } from '@/lib/i18n/locales';
import { alternates, ogLocales, serverT } from '@/lib/i18n/server';
import { SITE_NAME } from './(en)/seo';
import { siteSocialImage } from './social-images';

/*
 * Every page's <head>: title, description, canonical and hreflang, and the
 * social card. Next.js merges metadata shallowly, so a page that sets
 * openGraph replaces the root layout's whole object: building it here in one
 * place keeps og:locale, the language alternates and the versioned image on
 * every page.
 *
 * Keep the head lean: the HTML carries every tag twice (head and RSC
 * payload), and a tool page's HTML must stay within the ~14 KB a new
 * connection sends in its first round trip (past it, Lighthouse's LCP grows
 * by a round trip). So the image goes out once, as og:image: Next.js copies
 * the title and description into twitter:* tags, but `images: []` keeps it
 * from repeating the image there, and X reads og:image when twitter:image is
 * absent.
 */

type SocialImage = { url: string; alt: string; width: number; height: number; type?: string };

/** The site-wide preview in a language: one versioned file, its short description translated. */
export function socialImage(locale: SiteLocale): SocialImage {
  return { ...siteSocialImage, alt: serverT(locale)('site.ogAlt') };
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
      images: [image ?? socialImage(locale)],
      ...(article
        ? { type: 'article' as const, publishedTime: article.published, modifiedTime: article.updated, authors: [SITE_NAME], section: article.section, tags: article.tags }
        : { type: 'website' as const }),
    },
    twitter: { card: 'summary_large_image', images: [] },
  };
}
