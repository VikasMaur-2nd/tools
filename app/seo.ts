import { POSTS } from './blogs/posts';

export const SITE = 'https://tools.vikasmaur.com';
export const SITE_NAME = 'Tool Kumar';
export const JSON_TOOL_NAME = 'Tool Kumar JSON Viewer & Formatter';
export const JSON_TOOL_DESCRIPTION =
  'View, format, validate, repair, minify and compare JSON online for free. Tool Kumar runs in your browser, keeps data on your device and works offline.';
export const SOCIAL_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: 'Tool Kumar JSON viewer and formatter',
} as const;

export const FAQ_ENTRIES = [
  {
    question: 'What is a JSON viewer?',
    answer: 'A JSON viewer displays structured JSON in a readable format, often with a collapsible tree, search and validation.',
  },
  {
    question: 'How do I format JSON online?',
    answer: 'Paste your JSON into Tool Kumar. The formatter creates an indented view, while the validator reports syntax errors.',
  },
  {
    question: 'Is this JSON viewer private?',
    answer: 'Yes. Parsing and formatting happen in your browser, so your document does not need to leave your device.',
  },
  {
    question: 'Can I validate a large JSON file?',
    answer: 'Yes. The viewer is designed for large documents and keeps the input local while it parses the file.',
  },
] as const;

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

const applicationJsonLd = {
  '@type': ['WebApplication', 'SoftwareApplication'],
  '@id': `${SITE}/#json-viewer`,
  name: JSON_TOOL_NAME,
  alternateName: ['JSON Viewer', 'JSON Formatter', 'JSON Validator', 'JSON Beautifier'],
  url: SITE,
  description: JSON_TOOL_DESCRIPTION,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'JSON viewer and formatter',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': `${SITE}/#organization` },
  featureList: [
    'JSON formatter and beautifier',
    'JSON validator with line and column errors',
    'Repair for common JSON mistakes',
    'Collapsible tree and table views',
    'Search keys and values and copy JSON paths',
    'Minify and sort keys',
    'Compare JSON documents',
    'Convert JSON to other formats',
    'Works offline and keeps documents on the device',
  ],
} as const;

export const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    ...baseGraph,
    applicationJsonLd,
    {
      '@type': 'BreadcrumbList',
      '@id': `${SITE}/#breadcrumb`,
      itemListElement: [{ '@type': 'ListItem', position: 1, name: 'JSON viewer', item: SITE }],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE}/#faq`,
      mainEntity: FAQ_ENTRIES.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    },
  ],
} as const;

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

export const postJsonLd = (post: (typeof POSTS)[number]) => ({
  '@context': 'https://schema.org',
  '@graph': [
  {
    '@type': 'BlogPosting',
    '@id': `${postUrl(post.slug)}#article`,
    headline: post.title,
    description: post.description,
    url: postUrl(post.slug),
    mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl(post.slug) },
    image: `${SITE}/opengraph-image.png`,
    articleSection: post.category,
    keywords: post.keywords,
    timeRequired: `PT${post.minutes}M`,
    datePublished: post.published,
    dateModified: post.updated,
    author: { '@id': `${SITE}/#organization` },
    publisher: { '@id': `${SITE}/#organization` },
    isPartOf: { '@id': `${BLOG}#page` },
    inLanguage: 'en-US',
    ...(post.citations && { citation: post.citations }),
  },
  {
    '@type': 'BreadcrumbList',
    '@id': `${postUrl(post.slug)}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: BLOG },
      { '@type': 'ListItem', position: 3, name: post.title, item: postUrl(post.slug) },
    ],
  },
  ],
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
