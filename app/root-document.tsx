import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@/components/Analytics';
import { localeInfo, type SiteLocale } from '@/lib/i18n/locales';
import { serverT } from '@/lib/i18n/server';
import { SITE } from '@/lib/site';
import { jsonLdScript, siteJsonLd } from './(en)/seo';
import { socialImage } from './page-metadata';
import './globals.css';
import './content.css';

/*
 * Everything the two root layouts share ((en)/layout.tsx for English at the
 * root, [lang]/layout.tsx for the translations): font, theme boot script,
 * analytics, metadata defaults and the site-wide JSON-LD. Keep them here so
 * the languages cannot drift apart.
 */

// Code font: self-hosted at build time (no requests to Google), preloaded, and
// cached offline by the service worker like every other asset.
const code = JetBrains_Mono({ subsets: ['latin'], variable: '--font-code', display: 'swap' });

const verification: NonNullable<Metadata['verification']> = {
  // Search Console ownership token (public by design: it is served in every page's <head>).
  google: process.env.GOOGLE_SITE_VERIFICATION || 'F40WCLXMCnx44iMDDlW8Uwqi2UhCM7eMomg9v48zMAE',
  ...(process.env.BING_SITE_VERIFICATION ? { other: { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } } : {}),
};

/** Root metadata defaults; pages set their own canonical, hreflang and social text on top. */
export function rootMetadata(locale: SiteLocale): Metadata {
  const t = serverT(locale);
  const title = t('home.title');
  const description = t('home.description');
  return {
    metadataBase: new URL(SITE),
    title: { default: title, template: '%s | Tool Kumar' },
    description,
    applicationName: 'Tool Kumar',
    keywords: t('home.keywords').split(/\s*,\s*/),
    authors: [{ name: 'Tool Kumar' }],
    creator: 'Tool Kumar',
    publisher: 'Tool Kumar',
    classification: 'Developer tools',
    // Origin only, even to this site: analytics requests through the proxy never carry the page's query string.
    referrer: 'strict-origin',
    ...(locale === 'en' && { alternates: { canonical: '/' } }),
    openGraph: {
      type: 'website',
      url: locale === 'en' ? '/' : `/${locale}`,
      siteName: 'Tool Kumar',
      title,
      description,
      locale: localeInfo(locale).og,
      images: [socialImage(locale)],
    },
    // X reads the Open Graph image (app/page-metadata.ts).
    twitter: { card: 'summary_large_image', images: [] },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
    formatDetection: { telephone: false, email: false, address: false },
    appleWebApp: { capable: true, title: 'Tool Kumar', statusBarStyle: 'black-translucent' },
    category: 'developer tools',
    ...(Object.keys(verification).length > 0 ? { verification } : {}),
  };
}

export const rootViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

// Runs before first paint: applies a manually chosen theme and the saved panel
// split, and flags returning visitors so empty states don't flash.
const BOOT = `try{var d=document.documentElement,l=localStorage,t=l.getItem('jf:theme');if(t==='light'||t==='dark')d.dataset.theme=t;var o=JSON.parse(l.getItem('jf:settings')||'{}'),s=o.split,c=o.splitCmp;if(s>=.2&&s<=.8)d.style.setProperty('--split',s*100+'%');if(c>=.4&&c<=.85)d.style.setProperty('--split-c',c*100+'%');if(l.getItem('jf:doc'))d.dataset.doc=''}catch(e){}`;

export function RootDocument({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  return (
    <html lang={localeInfo(locale).lang} dir="ltr" className={code.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(siteJsonLd) }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
