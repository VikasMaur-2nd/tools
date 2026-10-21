import type { Metadata } from 'next';
import Link from 'next/link';
import LinkBuilder from '@/components/LinkBuilder';
import { TARGETS } from '@/lib/engine/targets';
import { Code } from '../blogs/article';
import ContentShell from '../content-shell';
import { SITE, SITE_NAME, SOCIAL_IMAGE, jsonLdScript } from '../seo';
import { SAMPLE_COMPARE_LINK, SAMPLE_VIEW_LINK } from './samples';

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

const POINTS = [
  { title: 'Nothing is uploaded', text: 'The JSON travels inside the link, after the #. Browsers never send that part to a server.' },
  { title: 'Compare two documents', text: 'Add a second document and the link opens Compare, with every change listed by JSON path.' },
  { title: 'Any size', text: 'Too big for a link? toolkumar.js hands the document to a new tab, browser to browser.' },
];

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
    <ContentShell>
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

      <section className="ig-section" aria-labelledby="builder">
        <h2 id="builder">Make your button</h2>
        <p className="ig-sub">Paste a document, or the URL of one. Everything is built in this page; nothing you paste is sent anywhere.</p>
        <LinkBuilder />
      </section>

      <ul className="ig-points">
        {POINTS.map((p) => (
          <li key={p.title}>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </li>
        ))}
      </ul>

      <div className="ig-docs prose">
        <h2 id="format">How the link works</h2>
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
        <p>
          Valid JSON opens formatted, so compact documents make the shortest links. Invalid JSON opens as written with the error marked, which makes
          links handy in bug reports. A URL is fetched by the reader&apos;s browser, so its server must allow cross-origin requests (CORS); public
          GitHub files and most public APIs do.
        </p>

        <h2 id="code">Create links in code</h2>
        <p>
          <a href="/toolkumar.js">toolkumar.js</a> is a 5 KB script with no dependencies (MIT license). Load it from this site or copy it into your
          project:
        </p>
        <Code lang="html">{`<script src="https://tools.vikasmaur.com/toolkumar.js"></script>
<script>
  const href = await ToolKumar.link({ json: response, view: 'tree' });
  const diff = await ToolKumar.link({ json: before, compare: after });
  const remote = await ToolKumar.link({ url: 'https://api.example.com/v1/users' });
</script>`}</Code>
        <p>
          <code>json</code> and <code>compare</code> take a JSON string, kept exactly as written, or any value, serialized with{' '}
          <code>JSON.stringify</code>. Without the script:
        </p>
        <Code lang="javascript">{`// Node.js
import { deflateRawSync } from 'node:zlib';
const link = 'https://tools.vikasmaur.com/#a=' + deflateRawSync(JSON.stringify(data)).toString('base64url');`}</Code>
        <Code lang="python">{`# Python
import base64, json, zlib

z = zlib.compressobj(9, zlib.DEFLATED, -15)  # -15: raw DEFLATE
raw = z.compress(json.dumps(data, separators=(",", ":")).encode()) + z.flush()
link = "https://tools.vikasmaur.com/#a=" + base64.urlsafe_b64encode(raw).decode().rstrip("=")`}</Code>

        <h2 id="big-documents">Big documents</h2>
        <p>
          Links work best below about 60,000 characters, a few hundred kilobytes of typical JSON; chat apps and some browsers cut longer URLs. For
          anything bigger, call <code>ToolKumar.open</code> straight from a click. It opens a new tab and hands the document over with{' '}
          <code>postMessage</code>:
        </p>
        <Code lang="javascript">{`button.addEventListener('click', () => {
  ToolKumar.open({ json: hugeResponseText, view: 'table' })
    .catch((error) => console.warn(error.message)); // a blocked tab, for example
});`}</Code>
        <p>
          Don&apos;t await anything before calling it, or the browser blocks the tab. If your page sends{' '}
          <code>Cross-Origin-Opener-Policy: same-origin</code>, use <code>same-origin-allow-popups</code> so the two tabs can talk.
        </p>
        <details className="ig-more">
          <summary>The handoff protocol, without the script</summary>
          <p>
            Open <code>https://tools.vikasmaur.com/#handoff</code> with <code>window.open</code>. When the tab is ready it posts{' '}
            <code>{'{ toolkumar: "ready", version: 1 }'}</code> to your page. Reply to that tab with{' '}
            <code>{'{ toolkumar: "open", a, b, view, to }'}</code>, where <code>a</code> and <code>b</code> are document text. It answers{' '}
            <code>{'{ toolkumar: "opened" }'}</code> or <code>{'{ toolkumar: "error", reason }'}</code>. The tab listens only to the page that opened
            it, takes one request and stops listening after two minutes.
          </p>
        </details>

        <h2 id="privacy">Privacy and security</h2>
        <ul>
          <li>Documents stay in the link&apos;s fragment, which browsers don&apos;t send to servers. Tool Kumar removes it from the address bar once the document is open.</li>
          <li>A handed-over document goes from one browser tab to another and never touches a server.</li>
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
