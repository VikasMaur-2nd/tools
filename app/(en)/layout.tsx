import type { Metadata, Viewport } from 'next';
import { RootDocument, rootMetadata, rootViewport } from '../root-document';

// English lives at the root; translations have their own root layout in app/[lang].
export const metadata: Metadata = rootMetadata('en');
export const viewport: Viewport = rootViewport;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return <RootDocument locale="en">{children}</RootDocument>;
}
