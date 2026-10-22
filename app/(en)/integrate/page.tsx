import type { Metadata } from 'next';
import Link from 'next/link';
import { CODE_LANG_SCRIPT } from '@/components/CodeLang';
import LinkBuilder from '@/components/LinkBuilder';
import { TARGETS } from '@/lib/engine/targets';
import { Code } from '../blogs/article';
import ContentShell from '../content-shell';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../seo';
import CodeSnippet from './code-snippet';
import { SAMPLE_COMPARE_LINK, SAMPLE_VIEW_LINK } from './samples';
import { HANDOFF_SNIPPET, HANDOFF_SNIPPET_TS, LINK_SNIPPET, LINK_SNIPPET_TS } from './snippets';

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

const LOGOS = [
  { id: 'black', label: 'Black, for light backgrounds' },
  { id: 'white', label: 'White, for dark backgrounds' },
] as const;

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
          <h2>Small to large JSON, up to a few MB</h2>
          <p>A link with the JSON inside it, for READMEs, docs, issues and web pages. Nothing to install. Roughly 1 to 10 MB of JSON fits, depending on how well it compresses.</p>
          <span className="ig-method-more">How links work <span className="arrow" aria-hidden="true">→</span></span>
        </a>
        <a className="ig-method" href="#handoff">
          <p className="ig-method-kind">Via handoff</p>
          <h2>JSON of any size</h2>
          <p>A short function for your web app: one click opens Tool Kumar in a new tab and passes the JSON to it inside the browser. No link to outgrow.</p>
          <span className="ig-method-more">How handoff works <span className="arrow" aria-hidden="true">→</span></span>
        </a>
      </div>

      <section className="ig-section" aria-labelledby="builder">
        <h2 id="builder">Make your button</h2>
        <p className="ig-sub">Paste a document, or the URL of one. Everything is built in this page; nothing you paste is sent anywhere.</p>
        <LinkBuilder />
      </section>

      <section className="ig-section" aria-labelledby="logo">
        <h2 id="logo">Logo for your own buttons</h2>
        <p className="ig-sub">Prefer your own button style? Use the Tool Kumar logo in it, linked to Tool Kumar.</p>
        <div className="ig-logos">
          {LOGOS.map((l) => (
            <div className={`ig-logo ig-logo-${l.id}`} key={l.id}>
              <div className="ig-logo-tile">
                {/* The same drawing as public/brand/tool-kumar-logo-*.svg, inline: no request for a preview. */}
                <svg width="64" height="64" viewBox="0 0 32 32" role="img" aria-label={`Tool Kumar logo, ${l.id}`}>
                  <rect width="32" height="32" rx="7" fill={l.id === 'black' ? '#0a0a0a' : '#ffffff'} />
                  <path fill={l.id === 'black' ? '#ffffff' : '#0a0a0a'} d="M4 6H20V12L24 6H28L21.33 16L28 26H24L20 20V26H16V10H12V26H8V10H4Z" />
                </svg>
              </div>
              <div className="ig-logo-info">
                <p className="ig-logo-name">{l.label}</p>
                <p className="ig-logo-dl">
                  {(['svg', 'png', 'webp'] as const).map((f) => (
                    <a key={f} href={`/brand/tool-kumar-logo-${l.id}.${f}`} download aria-label={`Download the ${l.id} logo as ${f.toUpperCase()}`}>
                      {f.toUpperCase()}
                    </a>
                  ))}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="ig-note">SVG scales to any size; PNG and WebP are 512 × 512 with a transparent background around the rounded tile.</p>
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
          Tool Kumar sets no limit on links; browsers do. We measured the longest link each one opens when it is clicked. Because the JSON is
          compressed, a link holds several times its own length in JSON:
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Browser</th><th scope="col">Longest link it opens</th><th scope="col">JSON that fits, roughly</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">Firefox</th><td>about 1 MB</td><td>1 MB of JSON full of base64 data, 3 to 4 MB of typical API data, up to 9 MB of repetitive logs</td></tr>
              <tr><th scope="row">Chrome, Edge</th><td>about 2 MB</td><td>about twice as much: 2 to 18 MB</td></tr>
              <tr><th scope="row">Safari</th><td>about 2 MB (measured on WebKit)</td><td>like Chrome</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          A longer link doesn&apos;t open at all: the browser shows a blank page or ignores the click. The builder above shows each link&apos;s length.
          Valid JSON opens formatted, so compact JSON makes the shortest links.
        </p>
        <h3>Sharing in chats and email</h3>
        <p>
          Chat apps allow far less per message than browsers: about 2,000 characters on Discord and 40,000 on Slack. Two ways to share bigger JSON:
        </p>
        <ul>
          <li>
            <strong>Link to where the JSON is hosted.</strong> Put it in a GitHub Gist or any file a browser can fetch, then link to its address:{' '}
            <code>{"'https://tools.vikasmaur.com/#a=' + encodeURIComponent(url)"}</code>. The link stays short whatever the size, and Tool Kumar
            fetches the file when it opens.
          </li>
          <li>
            <strong>Use the handoff from your web app</strong> (below): a button in your app opens Tool Kumar with the JSON, with no link at all.
          </li>
        </ul>
        <h3>Make links in your code</h3>
        <p>Copy this function into your project. It runs in browsers and in Node.js 18 or later, with no dependencies:</p>
        {/* Picks JavaScript or TypeScript for every code block below before they paint. */}
        <script dangerouslySetInnerHTML={{ __html: CODE_LANG_SCRIPT }} />
        <CodeSnippet name="toolKumarLink" js={LINK_SNIPPET} ts={LINK_SNIPPET_TS} />
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
        <CodeSnippet name="openInToolKumar" js={HANDOFF_SNIPPET} ts={HANDOFF_SNIPPET_TS} />
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
          The JSON goes from one tab to the other inside the browser, with no link involved, so it can be as big as a browser tab handles: a few hundred MB, the same as opening a file. The tab listens only to
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
