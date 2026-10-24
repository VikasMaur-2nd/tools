import { notFound } from 'next/navigation';
import { resourceMetadata } from '../../resources/resource';
import ErrorArticle from '../error-article';
import { ERROR_GUIDES } from '../errors';

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
  return resourceMetadata({ title: guide.title, description: guide.description, path: `/json-errors/${guide.slug}`, published: guide.published, updated: guide.updated });
}

export default async function JsonErrorPage({ params }: { params: Promise<{ slug: string }> }) {
  return <ErrorArticle guide={await getGuide(params)} />;
}
