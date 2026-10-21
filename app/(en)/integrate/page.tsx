import type { Metadata } from 'next';
import Link from 'next/link';
import LinkBuilder from '@/components/LinkBuilder';
import { TARGETS } from '@/lib/engine/targets';
import { Code } from '../blogs/article';
import ContentShell from '../content-shell';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../seo';
import CodeSnippet from './code-snippet';
import { SAMPLE_COMPARE_LINK, SAMPLE_VIEW_LINK } from './samples';
import { HANDOFF_SNIPPET, LINK_SNIPPET } from './snippets';

const TITLE = 'Integrate: add "View in Tool Kumar" buttons and links';
const DESCRIPTION =
  'Add a "View in Tool Kumar" or "Compare in Tool Kumar" button to docs, READMEs, bug reports and apps. The link carries the JSON itself, so nothing is uploaded. Free, no sign-up, no API key.';
const PATH = '/integrate';
const UPDATED = '2026-10-21';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { type: 'website', url: PATH, siteName: SITE_NAME, title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION, images: [SOCIAL_IMAGE] },
  twitter: { card: 'summary_large_image', title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION, images: ['/twitter-image.png'] },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle',
      '@id': `${SITE}${PATH}#article`,
      headline: TITLE,
      description: DESCRIPTION,
      url: `${SITE}${PATH}`,
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}${PATH}` },
      image: `${SITE}${SOCIAL_IMAGE.url}`,
      datePublished: UPDATED,
      dateModified: UPDATED,
      author: { '@id': `${SITE}/#organization` },
      publisher: { '@id': `${SITE}/#organization` },
      keywords: ['View in Tool Kumar', 'open JSON in viewer link', 'JSON viewer button', 'share JSON link', 'JSON diff link', 'embed JSON viewer'],
      inLanguage: 'en-US',
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${SITE}${PATH}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Integrate', item: `${SITE}${PATH}` },
      ],
    },
  ],
};

function Badge({ kind, href }: { kind: 'view' | 'compare'; href: string }) {
  const label = kind === 'view' ? 'View in Tool Kumar' : 'Compare in Tool Kumar';
  return (
    <a href={href}>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={`/badges/${kind}-in-tool-kumar-dark.svg`} />
        <img src={`/badges/${kind}-in-tool-kumar.svg`} alt={label} width={kind === 'view' ? 158 : 180} height={28} />
      </picture>
    </a>
  );
}

export default function IntegratePage() {
  return (
    <ContentShell current="integrate">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="ig-hero">
        <p className="eyebrow">Integrate</p>
        <h1>Open your JSON in Tool Kumar with one click</h1>
        <p className="lede">
          Add a button or a link to docs, READMEs, bug reports or your own app. Readers land in the viewer with the document formatted, validated and
          open in the view you chose. No sign-up, no API key.
        </p>
        <div className="ig-badges">
          <Badge kind="view" href={SAMPLE_VIEW_LINK} />
          <Badge kind="compare" href={SAMPLE_COMPARE_LINK} />
        </div>
      </header>

      <div className="ig-methods">
        <a className="ig-method" href="#via-link">
          <p className="ig-method-kind">Via link</p>
          <h2>JSON up to about 200 KB</h2>
          <p>A link with the JSON inside it. Put it in a README, docs, an issue, an email or a chat. Nothing to install; it works anywhere a link does.</p>
          <span className="ig-method-more">How links work <span className="arrow" aria-hidden="true">→</span></span>
        </a>
        <a className="ig-method" href="#handoff">
          <p className="ig-method-kind">Via handoff</p>
          <h2>JSON above 200 KB</h2>
          <p>A short function for your web app: one click opens Tool Kumar in a new tab and passes the JSON to it inside the browser. No size limit.</p>
          <span className="ig-method-more">How handoff works <span className="arrow" aria-hidden="true">→</span></span>
        </a>
      </div>

      <section className="ig-section" aria-labelledby="builder">
        <h2 id="builder">Make your button</h2>
        <p className="ig-sub">Paste a document, or the URL of one. Everything is built in this page; nothing you paste is sent anywhere.</p>
        <LinkBuilder />
      </section>

      <div className="ig-docs prose">
        <h2 id="via-link">1. Via link</h2>
        <p>
          Every link points to the home page. The documents and options follow the <code>#</code> as <code>name=value</code> pairs joined by{' '}
          <code>&amp;</code>:
        </p>
        <Code lang="text">{`https://tools.vikasmaur.com/#a=<document>&view=tree
https://tools.vikasmaur.com/#a=<original>&b=<modified>`}</Code>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><code>a</code></th>
                <td>The document: its text compressed with raw DEFLATE and encoded as base64url without padding, or a percent-encoded <code>http(s)</code> URL to fetch it from.</td>
              </tr>
              <tr>
                <th scope="row"><code>b</code></th>
                <td>Optional. A second document in the same form. Two documents open in Compare.</td>
              </tr>
              <tr>
                <th scope="row"><code>view</code></th>
                <td>Optional. <code>format</code>, <code>tree</code>, <code>table</code>, <code>graph</code>, <code>convert</code> or <code>compare</code>. Without it, readers keep the view they last used.</td>
              </tr>
              <tr>
                <th scope="row"><code>to</code></th>
                <td>Optional, with <code>view=convert</code>: {TARGETS.map((t, i) => <span key={t.id}>{i ? ', ' : ''}<code>{t.id}</code></span>)}.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>How big a link can be</h3>
        <p>
          Keep links under about 60,000 characters: chat apps, email clients and some browsers cut longer ones. Compression makes that roughly 200 KB
          of JSON full of IDs and random values, and 500 KB or more of repetitive data such as logs. The builder above shows the exact length.
          Valid JSON opens formatted, so compact JSON makes the shortest links.
        </p>
        <h3>Make links in your code</h3>
        <p>Copy this function into your project. It runs in browsers and in Node.js 18 or later, with no dependencies:</p>
        <CodeSnippet lang="javascript" code={LINK_SNIPPET} name="toolKumarLink" />
        <Code lang="javascript">{`const link = await toolKumarLink(response, { view: 'tree' });
const diff = await toolKumarLink(before, { compare: after });`}</Code>
        <p>
          A link to a URL needs no compression: <code>{"'https://tools.vikasmaur.com/#a=' + encodeURIComponent(url)"}</code>. The reader&apos;s browser
          fetches it, so its server must allow cross-origin requests (CORS); public GitHub files and most public APIs do. In other languages:
        </p>
        <Code lang="javascript">{`// Node.js, synchronous
import { deflateRawSync } from 'node:zlib';
const link = 'https://tools.vikasmaur.com/#a=' + deflateRawSync(JSON.stringify(data)).toString('base64url');`}</Code>
        <Code lang="python">{`# Python
import base64, json, zlib

z = zlib.compressobj(9, zlib.DEFLATED, -15)  # -15: raw DEFLATE
raw = z.compress(json.dumps(data, separators=(",", ":")).encode()) + z.flush()
link = "https://tools.vikasmaur.com/#a=" + base64.urlsafe_b64encode(raw).decode().rstrip("=")`}</Code>

        <h2 id="handoff">2. Via handoff, for bigger JSON</h2>
        <p>
          When the JSON is too big for a link, open Tool Kumar from your web app and pass the JSON to it directly. Copy this function into your
          code:
        </p>
        <CodeSnippet lang="javascript" code={HANDOFF_SNIPPET} name="openInToolKumar" />
        <p>Call it straight from a click, without awaiting anything first, or the browser blocks the new tab:</p>
        <Code lang="javascript">{`button.addEventListener('click', () => {
  openInToolKumar(hugeResponseText, { view: 'table' })
    .catch((error) => console.warn(error.message)); // a blocked tab, for example
});`}</Code>
        <h3>How it works</h3>
        <ol>
          <li>Your page opens <code>https://tools.vikasmaur.com/#handoff</code> in a new tab.</li>
          <li>When Tool Kumar is ready, it tells your page with <code>{'{ toolkumar: "ready", version: 1 }'}</code>.</li>
          <li>
            Your page sends <code>{'{ toolkumar: "open", a, b, view, to }'}</code> to that tab, where <code>a</code> and <code>b</code> are the JSON
            text.
          </li>
          <li>Tool Kumar opens it and answers <code>{'{ toolkumar: "opened" }'}</code>, or <code>{'{ toolkumar: "error", reason }'}</code>.</li>
        </ol>
        <p>
          The JSON goes from one tab to the other inside the browser, so size is limited only by the reader&apos;s memory. The tab listens only to
          the page that opened it, accepts one request and stops listening after two minutes. If your page sends{' '}
          <code>Cross-Origin-Opener-Policy: same-origin</code>, use <code>same-origin-allow-popups</code> so the two tabs can talk.
        </p>

        <h2 id="privacy">Privacy and security</h2>
        <ul>
          <li>Documents stay in the link&apos;s fragment, which browsers don&apos;t send to servers. Tool Kumar removes it from the address bar once the document is open.</li>
          <li>A handed-over document goes from one browser tab to the other and never touches a server.</li>
          <li>A linked document replaces what the reader had open, and one undo brings that back. Links can&apos;t run code: documents are only shown as text.</li>
          <li>Anyone with a link can read the document in it, so share links to sensitive data only with people who may see it.</li>
          <li>
            Our analytics record only that a document arrived by link or handover, never the link or its document. See the{' '}
            <Link href="/privacy">privacy page</Link>.
          </li>
        </ul>
        <p>
          Inside the viewer, <strong>Share</strong> makes these links too: it copies a link to the open document in its current view, or to both
          documents while you compare them. <Link href="/">Open the viewer</Link>.
        </p>
      </div>
    </ContentShell>
  );
}
