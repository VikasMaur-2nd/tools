import Link from 'next/link';
import LinkBuilder from '@/components/LinkBuilder';
import { TARGETS } from '@/lib/engine/targets';
import { Code, ResourceArticle, resourceMetadata } from '../resource';
import { SAMPLE_COMPARE_LINK, SAMPLE_VIEW_LINK } from './samples';

const TITLE = 'View in Tool Kumar: buttons and links that open JSON in a viewer';
const DESCRIPTION =
  'Add a "View in Tool Kumar" or "Compare in Tool Kumar" button to docs, READMEs and apps. The link carries the JSON itself, so nothing is uploaded. Free, no sign-up, no API key.';
const PATH = '/resources/view-in-tool-kumar';

export const metadata = resourceMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const BADGE = 'https://tools.vikasmaur.com/badges';

export default function ViewInToolKumarPage() {
  return (
    <ResourceArticle
      title={TITLE}
      lede={DESCRIPTION}
      path={PATH}
      keywords={['View in Tool Kumar', 'open JSON in viewer link', 'JSON viewer button', 'share JSON link', 'JSON diff link', 'embed JSON viewer']}
      toc={[
        { id: 'buttons', label: 'The buttons' },
        { id: 'builder', label: 'Build a link' },
        { id: 'format', label: 'How the link works' },
        { id: 'compare', label: 'Link to a comparison' },
        { id: 'code', label: 'Create links in code' },
        { id: 'big-documents', label: 'Big documents: toolkumar.js' },
        { id: 'privacy', label: 'Privacy and security' },
      ]}
    >
      <p>
        API documentation, bug reports and dashboards often show JSON that readers then copy into a viewer by hand. A{' '}
        <strong>View in Tool Kumar</strong> link skips that step: one click opens the document in <Link href="/">Tool Kumar</Link>, formatted and
        validated, in the tree, table, graph or any other view you choose. A <strong>Compare in Tool Kumar</strong> link opens two documents side by
        side with their differences marked.
      </p>
      <p>
        Every link points to the home page, <code>https://tools.vikasmaur.com/</code>. The document travels inside the link, after the <code>#</code>,
        and browsers never send that part to a server. There is nothing to register, no API key and no rate limit.
      </p>

      <h2 id="buttons">The buttons</h2>
      <p>Use a button, or a plain text link if it fits your page better. Each button has a black version for light pages and a white one for dark pages.</p>
      <div className="badge-row">
        <a href={SAMPLE_VIEW_LINK}>
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/badges/view-in-tool-kumar-dark.svg" />
            <img src="/badges/view-in-tool-kumar.svg" alt="View in Tool Kumar" width={158} height={28} />
          </picture>
        </a>
        <a href={SAMPLE_COMPARE_LINK}>
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/badges/compare-in-tool-kumar-dark.svg" />
            <img src="/badges/compare-in-tool-kumar.svg" alt="Compare in Tool Kumar" width={180} height={28} />
          </picture>
        </a>
      </div>
      <div className="table-wrap badge-urls">
        <table>
          <thead>
            <tr><th scope="col">Button</th><th scope="col">For light pages</th><th scope="col">For dark pages</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">View in Tool Kumar</th><td><code>{`${BADGE}/view-in-tool-kumar.svg`}</code></td><td><code>{`${BADGE}/view-in-tool-kumar-dark.svg`}</code></td></tr>
            <tr><th scope="row">Compare in Tool Kumar</th><td><code>{`${BADGE}/compare-in-tool-kumar.svg`}</code></td><td><code>{`${BADGE}/compare-in-tool-kumar-dark.svg`}</code></td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="builder">Build a link</h2>
      <p>
        Paste a document, or the URL of one, and copy the link, the Markdown for a README or the HTML for a web page. The link is built in this
        page; what you paste is not sent anywhere.
      </p>
      <LinkBuilder />
      <p>
        Inside the viewer, the <strong>Share</strong> button does the same for whatever is open: it copies a link to the document in its current
        view, or to both documents while you compare them.
      </p>

      <h2 id="format">How the link works</h2>
      <p>A link is the home page followed by a fragment of <code>name=value</code> pairs joined by <code>&amp;</code>:</p>
      <Code lang="text">{'https://tools.vikasmaur.com/#a=<document>&view=tree'}</Code>
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
              <td>Optional. A second document, in the same form. Two documents open in Compare.</td>
            </tr>
            <tr>
              <th scope="row"><code>view</code></th>
              <td>Optional. <code>format</code>, <code>tree</code>, <code>table</code>, <code>graph</code>, <code>convert</code> or <code>compare</code>. Without it, the reader keeps the view they last used.</td>
            </tr>
            <tr>
              <th scope="row"><code>to</code></th>
              <td>Optional, with <code>view=convert</code>. One of {TARGETS.map((t, i) => <span key={t.id}>{i ? ', ' : ''}<code>{t.id}</code></span>)}.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Valid JSON opens formatted with the reader&apos;s indentation, so compact documents make the shortest links. Invalid JSON opens as written,
        with the error marked, which makes links useful in bug reports too. Unknown names and values are ignored.
      </p>
      <p>
        A URL in <code>a</code> or <code>b</code> is fetched by the reader&apos;s browser, so the server has to allow cross-origin requests
        (CORS). Public files on GitHub (<code>raw.githubusercontent.com</code>) and most public APIs do:
      </p>
      <Code lang="text">{'https://tools.vikasmaur.com/#a=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fmain%2Fdata.json&view=table'}</Code>

      <h2 id="compare">Link to a comparison</h2>
      <p>
        Put the original document in <code>a</code> and the modified one in <code>b</code>. The link opens Compare with both documents in their own
        editors, the differences listed by JSON path and a JSON Patch to copy. Compare ignores key order and formatting, so only real changes show.
      </p>
      <Code lang="text">{'https://tools.vikasmaur.com/#a=<original>&b=<modified>'}</Code>
      <p>
        Comparing two URLs is a quick way to show what changed between two API versions or two releases of a config file. Each side can be text or a
        URL, independently.
      </p>

      <h2 id="code">Create links in code</h2>
      <h3>In the browser or Node.js, with toolkumar.js</h3>
      <p>
        <a href="/toolkumar.js">toolkumar.js</a> is a dependency-free script of about 5 KB (MIT license). Load it from this site or copy it into your
        project. It builds links and opens tabs:
      </p>
      <Code lang="html">{`<script src="https://tools.vikasmaur.com/toolkumar.js"></script>
<script>
  // A link to put in an <a href>
  const href = await ToolKumar.link({ json: response, view: 'tree' });

  // A comparison: Compare opens by itself
  const diff = await ToolKumar.link({ json: before, compare: after });

  // Documents named by URL
  const remote = await ToolKumar.link({ url: 'https://api.example.com/v1/users', compareUrl: 'https://api.example.com/v2/users' });
</script>`}</Code>
      <p>
        <code>json</code> and <code>compare</code> accept a JSON string, kept exactly as written, or any value, which is serialized with{' '}
        <code>JSON.stringify</code>. In Node.js 18 or later, <code>require</code> the file: <code>ToolKumar.link</code> works the same.
      </p>
      <h3>Node.js without the script</h3>
      <Code lang="javascript">{`import { deflateRawSync } from 'node:zlib';

const encode = (text) => deflateRawSync(text).toString('base64url');
const link = \`https://tools.vikasmaur.com/#a=\${encode(JSON.stringify(data))}&view=tree\`;`}</Code>
      <h3>Python</h3>
      <Code lang="python">{`import base64, json, zlib

def encode(text: str) -> str:
    z = zlib.compressobj(9, zlib.DEFLATED, -15)  # -15: raw DEFLATE, no header
    data = z.compress(text.encode("utf-8")) + z.flush()
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

link = "https://tools.vikasmaur.com/#a=" + encode(json.dumps(data, separators=(",", ":"))) + "&view=tree"`}</Code>

      <h2 id="big-documents">Big documents: toolkumar.js</h2>
      <p>
        Links work best up to about 60,000 characters, a few hundred kilobytes of typical JSON. Chat apps and some browsers cut longer URLs. For bigger
        documents, call <code>ToolKumar.open</code> from a click handler. It opens a new tab and hands the documents over with{' '}
        <code>postMessage</code>, browser to browser, so size is limited only by the reader&apos;s memory:
      </p>
      <Code lang="javascript">{`button.addEventListener('click', () => {
  ToolKumar.open({ json: hugeResponseText, view: 'table' })
    .catch((error) => console.warn(error.message)); // a blocked pop-up, for example
});`}</Code>
      <p>Two things to know:</p>
      <ul>
        <li>Call <code>open</code> straight from the click, without awaiting anything first: browsers block tabs opened later.</li>
        <li>
          The handover needs a window handle on both sides. If your page sends <code>Cross-Origin-Opener-Policy: same-origin</code>, use{' '}
          <code>same-origin-allow-popups</code> instead.
        </li>
      </ul>
      <p>
        Without the script, open <code>https://tools.vikasmaur.com/#handoff</code> with <code>window.open</code>. When the tab is ready it posts{' '}
        <code>{'{ toolkumar: "ready", version: 1 }'}</code> to your page. Reply to that tab with{' '}
        <code>{'{ toolkumar: "open", a, b, view, to }'}</code>, where <code>a</code> and <code>b</code> are strings of document text. The tab answers{' '}
        <code>{'{ toolkumar: "opened" }'}</code>, or <code>{'{ toolkumar: "error", reason }'}</code>. It listens only to the page that opened it,
        accepts one request and stops listening after two minutes.
      </p>

      <h2 id="privacy">Privacy and security</h2>
      <ul>
        <li>
          Documents in a link live in the fragment, after <code>#</code>. Browsers don&apos;t send it to our server, and Tool Kumar removes it from
          the address bar as soon as the document is open, so it doesn&apos;t linger in screenshots or bookmarks.
        </li>
        <li>A document handed over by toolkumar.js goes from one browser tab to another. It never touches a server.</li>
        <li>
          A document opened from a link replaces what the reader had open, and one undo brings that back. Nothing in a link can run code: it is
          only ever shown as text.
        </li>
        <li>
          Anyone who has a link can read the document in it. Share links to sensitive documents only with people who may see them, the same as you
          would with the document itself.
        </li>
        <li>
          Our analytics record only that a document arrived by link or handover, never the link or its document. See the{' '}
          <Link href="/privacy">privacy page</Link>.
        </li>
      </ul>
    </ResourceArticle>
  );
}
