import { notFound } from 'next/navigation';
import { RESOURCE_DATE, resourceMetadata } from '../../resources/resource';
import ErrorArticle from '../error-article';
import { ERROR_GUIDES, GUIDES_UPDATED } from '../errors';

export function generateStaticParams() {
  return ERROR_GUIDES.map(({ slug }) => ({ slug }));
}

async function getGuide(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  const guide = ERROR_GUIDES.find(entry => entry.slug === slug);
  if (!guide) notFound();
  return guide;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = await getGuide(params);
  const metadata = resourceMetadata({ title: guide.title, description: guide.description, path: `/json-errors/${guide.slug}` });
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, type: 'article' as const, publishedTime: guide.published ?? RESOURCE_DATE, modifiedTime: GUIDES_UPDATED },
  };
}

export default async function JsonErrorPage({ params }: { params: Promise<{ slug: string }> }) {
  return <ErrorArticle guide={await getGuide(params)} />;
}
