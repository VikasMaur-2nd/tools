import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { ErrorTextProvider } from '@/lib/i18n/react';
import { LOCALES, isLocale, type Locale } from '@/lib/i18n/locales';
import { errorText, liveLocales } from '@/lib/i18n/server';
import { RootDocument, rootMetadata, rootViewport } from '../root-document';

// Translated pages: prerendered per language, never rendered per request.
export const ensureStatic = 'navigation';

export function generateStaticParams() {
  const live = liveLocales();
  // Cache Components needs one value per root parameter; with no translations yet it renders a 404.
  return (live.length ? live : [LOCALES[0].id]).map((lang) => ({ lang }));
}

const live = (lang: string): lang is Locale => isLocale(lang) && liveLocales().includes(lang);

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  return live(lang) ? rootMetadata(lang) : { metadataBase: new URL('https://tools.vikasmaur.com') };
}

export const viewport: Viewport = rootViewport;

export default async function LocaleLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!live(lang)) notFound();
  return (
    <RootDocument locale={lang}>
      <ErrorTextProvider value={errorText(lang)}>{children}</ErrorTextProvider>
    </RootDocument>
  );
}
