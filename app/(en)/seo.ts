import { localeInfo, type SiteLocale } from '@/lib/i18n/locales';
import { serverT, toolPage, type UiKey } from '@/lib/i18n/server';
import { SITE } from '@/lib/site';
import { POSTS } from './blogs/posts';

export const SITE_NAME = 'Tool Kumar';
export const JSON_TOOL_DESCRIPTION =
  'View, visualize, format, validate, repair and compare JSON online. Tool Kumar runs in your browser, keeps data on your device and works offline.';
/** The site-wide preview image, for structured data (the <head> uses its versioned URL: app/page-metadata.ts). */
export const SOCIAL_IMAGE_URL = `${SITE}/opengraph-image.png`;

/** The homepage FAQ (visible content and FAQPage data) in a language. */
export const faqEntries = (locale: SiteLocale = 'en') => {
  const t = serverT(locale);
  return ([1, 2, 3, 4] as const).map((i) => ({ question: t(`home.faq.${i}.q`), answer: t(`home.faq.${i}.a`) }));
};

export const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE}/#organization`,
  name: SITE_NAME,
  url: SITE,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE}/icon-512.png`,
    width: 512,
    height: 512,
  },
} as const;

const baseGraph = [
  ORGANIZATION,
  {
    '@type': 'WebSite',
    '@id': `${SITE}/#website`,
    url: SITE,
    name: SITE_NAME,
    description: JSON_TOOL_DESCRIPTION,
    publisher: { '@id': `${SITE}/#organization` },
    inLanguage: 'en-US',
  },
] as const;

/** The homepage's app and FAQ entities; each language's homepage is its own page. */
export function homeJsonLd(locale: SiteLocale = 'en') {
  const t = serverT(locale);
  const url = locale === 'en' ? SITE : `${SITE}/${locale}`;
  const id = locale === 'en' ? `${SITE}/` : url;
  const inLanguage = locale === 'en' ? {} : { inLanguage: localeInfo(locale).lang };
  const list = (key: UiKey) => t(key).split(/\s*,\s*/);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseGraph,
      {
        '@type': ['WebApplication', 'SoftwareApplication'],
        '@id': `${id}#json-viewer`,
        name: t('home.appName'),
        alternateName: list('home.alternateNames'),
        url,
        description: t('home.description'),
        ...inLanguage,
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: t('home.subCategory'),
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': `${SITE}/#organization` },
        featureList: [...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((i) => t(`home.feature.${i}`)), toolPage(locale, 'json-visualizer')?.modeLabel].filter(Boolean),
      },
      {
        '@type': 'FAQPage',
        '@id': `${id}#faq`,
        ...inLanguage,
        mainEntity: faqEntries(locale).map(({ question, answer }) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
}

/** Shared entities only. Page-specific schemas are rendered on their page. */
export const siteJsonLd = { '@context': 'https://schema.org', '@graph': baseGraph } as const;

const BLOG = `${SITE}/blogs`;
const postUrl = (slug: string) => `${BLOG}/${slug}`;

export const blogPageLd = {
  '@type': 'CollectionPage',
  '@id': `${BLOG}#page`,
  url: BLOG,
  name: 'JSON guides, tips and history',
  description: 'Practical guides to formatting, validating and working with JSON.',
  isPartOf: { '@id': `${SITE}/#website` },
  inLanguage: 'en-US',
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: POSTS.map((post, i) => ({ '@type': 'ListItem', position: i + 1, url: postUrl(post.slug), name: post.title })),
  },
};

/**
 * An article and its breadcrumb trail (Home › the page that lists it › the
 * article), the same for blog posts, resources and error guides. `fields`
 * adds the article type's own properties (keywords, citations…).
 */
export function articleJsonLd({ type, path, title, description, published, updated, parent, fields }: {
  type: 'BlogPosting' | 'TechArticle';
  path: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  parent: { name: string; path: string };
  fields?: Record<string, unknown>;
}) {
  const url = SITE + path;
  return [
    {
      '@type': type,
      '@id': `${url}#article`,
      headline: title,
      description,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      image: SOCIAL_IMAGE_URL,
      datePublished: published,
      dateModified: updated,
      author: { '@id': `${SITE}/#organization` },
      publisher: { '@id': `${SITE}/#organization` },
      isPartOf: { '@id': `${SITE}${parent.path}#page` },
      inLanguage: 'en-US',
      ...fields,
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: parent.name, item: SITE + parent.path },
        { '@type': 'ListItem', position: 3, name: title, item: url },
      ],
    },
  ];
}

/** Blog posts' place in the breadcrumbs and structured data. */
export const BLOG_PARENT = { name: 'Blog', path: '/blogs' };

export const postJsonLd = (post: (typeof POSTS)[number]) => ({
  '@context': 'https://schema.org',
  '@graph': articleJsonLd({
    type: 'BlogPosting',
    path: `/blogs/${post.slug}`,
    title: post.title,
    description: post.description,
    published: post.published,
    updated: post.updated,
    parent: BLOG_PARENT,
    fields: {
      articleSection: post.category,
      keywords: post.keywords,
      timeRequired: `PT${post.minutes}M`,
      ...(post.citations && { citation: post.citations }),
    },
  }),
});

export const aboutPageLd = {
  '@type': 'AboutPage',
  '@id': `${SITE}/about#page`,
  url: `${SITE}/about`,
  name: `About ${SITE_NAME}`,
  description: 'How Tool Kumar works and how it handles JSON documents.',
  about: { '@id': `${SITE}/#organization` },
  mainEntity: ORGANIZATION,
  inLanguage: 'en-US',
} as const;

export function jsonLdScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
