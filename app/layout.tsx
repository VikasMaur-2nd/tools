import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@/components/Analytics';
import { jsonLdScript, siteJsonLd } from './seo';
import './globals.css';
import './content.css';

const SITE = 'https://tools.vikasmaur.com';

// Code font: self-hosted at build time (no requests to Google), preloaded, and
// cached offline by the service worker like every other asset.
const code = JetBrains_Mono({ subsets: ['latin'], variable: '--font-code', display: 'swap' });
const TITLE = 'Free JSON Viewer & Formatter | Tool Kumar';
const DESCRIPTION =
  'View, format, validate, repair, minify and compare JSON online for free. Tool Kumar runs in your browser, keeps data on your device and works offline.';

const verification: Metadata['verification'] = {
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
  ...(process.env.BING_SITE_VERIFICATION ? { other: { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } } : {}),
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: '%s | Tool Kumar' },
  description: DESCRIPTION,
  applicationName: 'Tool Kumar',
  keywords: ['JSON viewer', 'JSON formatter', 'JSON validator', 'JSON beautifier', 'format JSON online', 'JSON editor'],
  authors: [{ name: 'Tool Kumar' }],
  creator: 'Tool Kumar',
  publisher: 'Tool Kumar',
  classification: 'Developer tools',
  referrer: 'strict-origin-when-cross-origin',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Tool Kumar',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'Tool Kumar JSON viewer and formatter',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/twitter-image.png'],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: 'Tool Kumar', statusBarStyle: 'black-translucent' },
  category: 'developer tools',
  ...(Object.keys(verification).length > 0 ? { verification } : {}),
};

export const viewport: Viewport = {
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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" dir="ltr" className={code.variable} suppressHydrationWarning>
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
