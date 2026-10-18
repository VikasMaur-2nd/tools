// Every blog post, newest first. The listing, article headers, sitemap and
// JSON-LD all read from here, so a new post only needs an entry and a page.
// Plain data with no imports: `seo.ts` imports this file.

export interface Post {
  slug: string;
  title: string;
  description: string;
  /** Shorter summary for cards. */
  excerpt: string;
  category: string;
  /** ISO dates (YYYY-MM-DD). */
  published: string;
  updated: string;
  minutes: number;
  keywords: string[];
  /** A small JSON document shown on the post's card. */
  sample: string;
  citations?: string[];
}

export const POSTS: Post[] = [
  {
    slug: 'large-file-json-benchmark',
    title: 'Large JSON benchmark: opening, typing and number fidelity',
    description: "Six JSON tools tested for opening, typing, memory and number fidelity, with minified and prettified files and a dated Tool Kumar before-and-after.",
    excerpt: "Three attempts per opening size, plus editing and size checks. Includes failures and the hardware change between the original and latest study.",
    category: 'Research',
    published: '2026-10-17',
    updated: "2026-10-18",
    minutes: 20,
    keywords: ['large JSON file viewer', 'JSON formatter benchmark', '50 MB JSON file', 'JSON number precision', 'JSON viewer memory'],
    sample: `{
  "file": "50 MB",
  "check": ["open", "search", "edit"]
}`,
    citations: ['https://www.rfc-editor.org/rfc/rfc8259'],
  },
  {
    slug: 'json-formatter-privacy-study',
    title: 'Do online JSON formatters upload your data? A 12-tool canary test',
    description:
      'We tested twelve popular online JSON viewers and formatters with a unique fake canary document to see what left the browser, which third-party hosts loaded and whether offline use worked.',
    excerpt: 'A dated, reproducible canary test of twelve JSON tools, including Tool Kumar, with raw network data you can download.',
    category: 'Research',
    published: '2026-10-14',
    updated: '2026-10-15',
    minutes: 10,
    keywords: ['JSON formatter privacy', 'online JSON viewer security', 'JSON tool data upload', 'private JSON formatter', 'browser privacy test'],
    sample: `{
  "marker": "TK-PRIVACY-CANARY-...",
  "fake": true
}`,
    citations: [
      'https://labs.watchtowr.com/stop-putting-your-passwords-into-random-websites-yes-seriously-you-are-the-problem/',
      'https://thehackernews.com/2025/11/years-of-jsonformatter-and-codebeautify.html',
      'https://securityaffairs.com/185150/security/thousands-of-sensitive-secrets-published-on-jsonformatter-and-codebeautify.html',
    ],
  },
  {
    slug: 'json-formatting-guide',
    title: 'How to format and validate JSON: a practical guide',
    description:
      'Learn what valid JSON looks like, how to find syntax errors and how to format JSON so people and programs can read it.',
    excerpt: 'Understand valid JSON, track down syntax errors and choose readable formatting for APIs, config files and logs.',
    category: 'Guide',
    published: '2026-10-13',
    updated: '2026-10-15',
    minutes: 6,
    keywords: ['format JSON', 'validate JSON', 'JSON syntax error', 'JSON formatter', 'common JSON errors'],
    sample: `{
  "valid": true,
  "indent": 2,
  "errors": []
}`,
  },
  {
    slug: 'origin-of-json',
    title: 'The origin of JSON: the story behind the format',
    description:
      'Follow JSON from JavaScript object notation and early browser messaging to RFC 8259, ECMA-404 and the format used by APIs today.',
    excerpt: 'Follow JSON from a small browser messaging idea to the language-independent standard behind modern APIs.',
    category: 'History',
    published: '2026-10-13',
    updated: '2026-10-13',
    minutes: 9,
    keywords: ['JSON history', 'JSON origin', 'Douglas Crockford', 'JSON standard', 'RFC 8259'],
    sample: `{
  "name": "JavaScript Object Notation",
  "standards": ["RFC 8259", "ECMA-404"]
}`,
    citations: [
      'https://www.rfc-editor.org/rfc/rfc8259',
      'https://ecma-international.org/publications-and-standards/standards/ecma-404/',
      'https://www.json.org/json-en.html',
      'https://www.crockford.com/json.html',
    ],
  },
];

export function getPost(slug: string): Post {
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) throw new Error(`Unknown post: ${slug}`);
  return post;
}

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

/** `2026-10-13` → `October 13, 2026`. */
export const formatDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));
