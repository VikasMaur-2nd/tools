import type { Metadata } from 'next';
import Link from 'next/link';
import { CODE_LANG_SCRIPT } from '@/components/CodeLang';
import LinkBuilder from '@/components/LinkBuilder';
import { TARGETS } from '@/lib/engine/targets';
import { codeWithLinks } from '@/lib/link-code';
import { Code } from '../blogs/article';
import ContentShell from '../content-shell';
import { PAGE_DATES } from '../dates';
import { SOCIAL_IMAGE_URL, jsonLdScript } from '../seo';
import { pageMetadata } from '../../page-metadata';
import { SITE } from '@/lib/site';
import CodeSnippet from './code-snippet';
import { SAMPLE_COMPARE_LINK, SAMPLE_VIEW_LINK } from './samples';
import { HANDOFF_SNIPPET, HANDOFF_SNIPPET_TS, LINK_SNIPPET, LINK_SNIPPET_TS } from './snippets';

const TITLE = 'Integrate: add "View in Tool Kumar" buttons and links';
const DESCRIPTION =
  'Add a "View in Tool Kumar" or "Compare in Tool Kumar" button to docs, READMEs, bug reports and apps. The link carries the JSON itself, so nothing is uploaded. Free, no sign-up, no API key.';
const PATH = '/integrate';

export const metadata: Metadata = pageMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

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
      image: SOCIAL_IMAGE_URL,
      datePublished: PAGE_DATES[PATH].published,
      dateModified: PAGE_DATES[PATH].updated,
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

/** Inline code holding a Tool Kumar link, coloured by part as everywhere on this page (lib/link-colors.ts). */
function LinkCode({ children, lang = 'text' }: { children: string; lang?: string }) {
  return <code dangerouslySetInnerHTML={{ __html: codeWithLinks(children, lang) }} />;
}

/** A link part named on its own (a name, a value): its colour in links. */
function Part({ cls, children }: { cls: string; children: string }) {
  return (
    <code>
      <span className={cls}>{children}</span>
    </code>
  );
}

/** A `name=value` pair of a link, coloured as in links. */
function Pair({ name, value }: { name: string; value: string }) {
  return (
    <code>
      <span className="lk-k">{name}</span>
      <span className="lk-e">=</span>
      <span className="lk-v">{value}</span>
    </code>
  );
}

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
          Every link points to the home page. The documents and options follow the <Part cls="lk-h">#</Part> as{' '}
          <Pair name="name" value="value" />{' '}
          pairs joined by <Part cls="lk-s">&amp;</Part>:
        </p>
        <Code lang="text" links>{`https://tools.vikasmaur.com/#a=<document>&view=tree
https://tools.vikasmaur.com/#a=<original>&b=<modified>
https://tools.vikasmaur.com/#a=<document>&b=<schema>&view=schema`}</Code>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><Part cls="lk-k">a</Part></th>
                <td>The document: its text compressed with raw DEFLATE and encoded as base64url without padding, or a percent-encoded <code>http(s)</code> URL to fetch it from.</td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">b</Part></th>
                <td>
                  Optional. A second document in the same form. Two documents open in Compare. With <Pair name="view" value="schema" />, it is
                  instead the JSON Schema the document is validated against.
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">view</Part></th>
                <td>Optional. <Part cls="lk-v">format</Part>, <Part cls="lk-v">tree</Part>, <Part cls="lk-v">table</Part>, <Part cls="lk-v">graph</Part>, <Part cls="lk-v">convert</Part>, <Part cls="lk-v">compare</Part> or <Part cls="lk-v">schema</Part>. Without it, readers keep the view they last used.</td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">to</Part></th>
                <td>Optional, with <Pair name="view" value="convert" />: {TARGETS.map((t, i) => <span key={t.id}>{i ? ', ' : ''}<Part cls="lk-v">{t.id}</Part></span>)}.</td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">sep</Part></th>
                <td>
                  Optional, with <Pair name="to" value="flatten" /> or <Pair name="to" value="unflatten" />: what joins the keys of a path, 1 to 8 characters
                  with no digits, backslashes or brackets, percent-encoded. The default is a dot.
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">arrays</Part></th>
                <td>Optional, with the same targets: array indexes as <Part cls="lk-v">bracket</Part> (a[0], the default), <Part cls="lk-v">dot</Part> (a.0) or <Part cls="lk-v">keep</Part> (arrays stay whole).</td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">depth</Part></th>
                <td>Optional, with <Pair name="to" value="flatten" />: <Part cls="lk-v">1</Part>, <Part cls="lk-v">2</Part> or <Part cls="lk-v">3</Part> levels joined into keys. The default is all of them.</td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">escape</Part></th>
                <td>
                  Optional, with the same targets: <Part cls="lk-v">0</Part> keeps keys as written, without the backslashes that otherwise mark a dot or
                  bracket inside a key. A link to flatten or unflatten opens with exactly these options, the defaults for those it leaves out, and
                  readers keep their own for their next visit.
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">draft</Part></th>
                <td>
                  Optional, with a schema: the draft for a schema without <code>$schema</code>. <Part cls="lk-v">2020-12</Part> (the default),{' '}
                  <Part cls="lk-v">2019-09</Part>, <Part cls="lk-v">draft-07</Part>, <Part cls="lk-v">draft-06</Part> or <Part cls="lk-v">draft-04</Part>.
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">formats</Part></th>
                <td>Optional, with a schema: <Part cls="lk-v">1</Part> checks <code>format</code> (email, date-time, uri…), which is otherwise an annotation.</td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">in</Part></th>
                <td>
                  Optional. The format of <Part cls="lk-k">a</Part> when it isn&apos;t JSON: <Part cls="lk-v">yaml</Part>, <Part cls="lk-v">csv</Part>,{' '}
                  <Part cls="lk-v">xml</Part> or <Part cls="lk-v">toml</Part>. The document opens as itself, in its own format in the input, and the
                  views show its JSON. Without it, a document is read as JSON, or by its file name when it comes from a URL (.yaml, .csv, .tsv,
                  .xml, .toml).
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">delimiter</Part></th>
                <td>
                  Optional, with <Pair name="in" value="csv" />: what separates the fields, <Part cls="lk-v">comma</Part>,{' '}
                  <Part cls="lk-v">semicolon</Part>, <Part cls="lk-v">tab</Part> or <Part cls="lk-v">pipe</Part>. Without it, the separator is
                  detected, or taken from a first line such as <code>sep=;</code> (as Excel writes it).
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">header</Part></th>
                <td>
                  Optional, with <Pair name="in" value="csv" />: <Part cls="lk-v">0</Part> when the first row is data, not column names: every row
                  becomes an array. By default the first row names the columns and each row after it becomes an object.
                </td>
              </tr>
              <tr>
                <th scope="row"><Part cls="lk-k">types</Part></th>
                <td>
                  Optional, with <Pair name="in" value="csv" />: <Part cls="lk-v">0</Part> keeps every value a string. By default unquoted numbers,
                  true and false become JSON numbers and booleans, and empty fields null. A CSV link opens with exactly these options, the
                  defaults for those it leaves out, for that visit only: readers keep their own CSV settings for their next one.
                </td>
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
        <p>
          Pasting a link into the address bar has a lower limit: Chrome and Edge keep only the first 500 KB (512,000 characters) of what is
          pasted there and drop the rest, so a longer link arrives cut and can&apos;t open. Clicked, the same link opens. Firefox takes a pasted
          link whole. To try a long link, use the builder&apos;s Open link button.
        </p>
        <h3>Sharing in chats and email</h3>
        <p>
          Chat apps allow far less per message than browsers: about 2,000 characters on Discord and 40,000 on Slack. Two ways to share bigger JSON:
        </p>
        <ul>
          <li>
            <strong>Link to where the JSON is hosted.</strong> Put it in a GitHub Gist or any file a browser can fetch, then link to its address:{' '}
            <LinkCode lang="javascript">{"'https://tools.vikasmaur.com/#a=' + encodeURIComponent(url)"}</LinkCode>. The link stays short whatever the size, and Tool Kumar
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
        <Code lang="javascript" links>{`const link = await toolKumarLink(response, { view: 'tree' });
const diff = await toolKumarLink(before, { compare: after });
const checked = await toolKumarLink(response, { schema: userSchema });
const sheet = await toolKumarLink(csvText, { in: 'csv', delimiter: 'semicolon' });`}</Code>
        <p>
          A link to a URL needs no compression: <LinkCode lang="javascript">{"'https://tools.vikasmaur.com/#a=' + encodeURIComponent(url)"}</LinkCode>. The reader&apos;s browser
          fetches it, so its server must allow cross-origin requests (CORS); public GitHub files and most public APIs do. In other languages:
        </p>
        <Code lang="javascript" links>{`// Node.js, synchronous
import { deflateRawSync } from 'node:zlib';
const link = 'https://tools.vikasmaur.com/#a=' + deflateRawSync(JSON.stringify(data)).toString('base64url');`}</Code>
        <Code lang="python" links>{`# Python
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
          <li>Your page opens <LinkCode>{'https://tools.vikasmaur.com/#handoff'}</LinkCode> in a new tab.</li>
          <li>When Tool Kumar is ready, it tells your page with <code>{'{ toolkumar: "ready", version: 1 }'}</code>.</li>
          <li>
            Your page sends <code>{'{ toolkumar: "open", a, b, view, to }'}</code> to that tab, where <code>a</code> and <code>b</code> are the JSON
            text. With <code>to: &quot;flatten&quot;</code> or <code>&quot;unflatten&quot;</code> it may add <code>sep</code>, <code>arrays</code>,{' '}
            <code>depth</code> (a number) and <code>escape</code> (a boolean), as for links.
            With <code>{'view: "schema"'}</code>, <code>b</code> is the JSON Schema. With <code>in</code> (<code>&quot;yaml&quot;</code>,{' '}
            <code>&quot;csv&quot;</code>, <code>&quot;xml&quot;</code> or <code>&quot;toml&quot;</code>), <code>a</code> is text in that format;
            with <code>in: &quot;csv&quot;</code> it may add <code>delimiter</code> (<code>&quot;comma&quot;</code>,{' '}
            <code>&quot;semicolon&quot;</code>, <code>&quot;tab&quot;</code> or <code>&quot;pipe&quot;</code>), and <code>header</code> and{' '}
            <code>types</code> (booleans: <code>false</code> for <Pair name="header" value="0" /> and <Pair name="types" value="0" />),
            also for that visit only.
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
