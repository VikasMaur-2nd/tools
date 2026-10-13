import type { Metadata, Viewport } from 'next';
import { Analytics } from '@/components/Analytics';
import './globals.css';

const SITE = 'https://tools.vikasmaur.com';
const TITLE = 'JSON Formatter & Validator — Free, Private JSON Viewer Online';
const DESCRIPTION =
  'Free, fast JSON formatter, viewer and validator. Beautify, minify, repair and explore JSON in a tree or table view. No upload, no ads — runs in your browser and works offline.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'JSON Viewer & Formatter',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'JSON Viewer & Formatter',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: 'JSON Viewer', statusBarStyle: 'black-translucent' },
  category: 'developer tools',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d10' },
  ],
};

// Runs before first paint: applies a manually chosen theme and the saved panel
// split, and flags returning visitors so empty states don't flash.
const BOOT = `try{var d=document.documentElement,l=localStorage,t=l.getItem('jf:theme');if(t==='light'||t==='dark')d.dataset.theme=t;var s=JSON.parse(l.getItem('jf:settings')||'{}').split;if(s>=.2&&s<=.8)d.style.setProperty('--split',s*100+'%');if(l.getItem('jf:doc'))d.dataset.doc=''}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
