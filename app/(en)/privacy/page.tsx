import type { Metadata } from 'next';
import Link from 'next/link';
import AnalyticsSwitch from '@/components/AnalyticsSwitch';
import { analyticsConfigured, stateFrom } from '@/lib/analytics';
import { EVENT_PROPS, type EventName } from '@/lib/analytics/events';
import ContentShell from '../content-shell';
import { PAGE_DATES, formatDate } from '../dates';
import { pageMetadata } from '../../page-metadata';

const DESCRIPTION =
  'Tool Kumar processes JSON in your browser and never receives it. See exactly what our analytics measure, what screen recordings leave out and how to turn analytics off.';

export const metadata: Metadata = pageMetadata({ path: '/privacy', title: 'Privacy', description: DESCRIPTION });

/** When each event is sent. Its properties are listed straight from lib/analytics/events.ts. */
const WHEN: Record<EventName, string> = {
  json_loaded: 'A document arrives in an editor (pasted, opened, dropped, loaded from a URL, opened from a link, handed over by another site, or the sample), once it has been checked (or, without its size and validity, when another document replaces it first).',
  view_opened: 'You open Format, Tree, Table, Graph, Convert or Compare.',
  convert_target_selected: 'You pick a Convert language or format.',
  convert_option_changed: 'You change a Convert option: TypeScript interface or type, or the C# JSON library. The root type name you type is never sent.',
  format_option_changed: 'You change the output style, key sorting or indentation.',
  feature_used: 'You use a feature: copy, download, share (as a link or a Markdown or HTML button), repair, find, expand or collapse, wrap lines, theme, graph fit, zoom and jumps to its start or end, graph image export (PNG, JPEG or SVG) or copy, opening the right-click menu (which area it opened in), and similar.',
  command_run: 'You run a command from the command palette (its fixed ID, such as to-typescript).',
  agent_tool_used: 'An AI agent in your browser uses one of the JSON tool’s functions for you. What it sent and what it got back are never included.',
  huge_opened: 'A file too big for the editor opens in large-file mode, once it has been indexed (or stopped, or replaced by another document first). Its name, content and exact size are never included.',
};

const PROPS: Record<string, string> = {
  source: 'how it arrived',
  editor: 'which editor',
  file_kind: 'file type from the extension',
  size: 'size range',
  size_kb: 'size, 2 significant digits',
  validity: 'valid, fixable or invalid',
  error_kind: 'error category',
  issues: 'number of issues, as a range',
  nodes: 'number of values, as a range',
  depth: 'nesting depth',
  parse_ms: 'check time, 2 significant digits',
  jsonl: 'is JSON Lines',
  jwt: 'is a JWT',
  view: 'view',
  via: 'mouse, keyboard, palette, right-click menu or AI agent',
  target: 'language',
  group: 'types or data',
  option: 'which option',
  value: 'chosen value from a fixed list',
  feature: 'which feature',
  level: 'fold level',
  on: 'on or off',
  jsonpath: 'query starts with $',
  command: 'command ID',
  tool: 'which function',
  ok: 'whether it did what was asked',
  outcome: 'indexed, stopped at an error, cancelled or replaced',
  index_ms: 'indexing time, 2 significant digits',
  forced: 'large-file mode forced for testing',
};

const eu = /\beu\./.test(process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '');

/** One screenshot in the page theme: both are in the page, CSS shows one, and only that one loads (lazy), at the width the screen needs. */
function Shot({ name, alt }: { name: 'seen' | 'recorded'; alt: string }) {
  return (
    <>
      {(['light', 'dark'] as const).map((theme) => (
        <picture key={theme} className={`replay-shot ${theme}`}>
          <img
            src={`/privacy/${name}-${theme}.webp`}
            srcSet={`/privacy/${name}-${theme}-700.webp 700w, /privacy/${name}-${theme}.webp 1400w`}
            sizes="(max-width: 740px) 100vw, 700px"
            alt={alt}
            width={1400}
            height={814}
            loading="lazy"
            decoding="async"
          />
        </picture>
      ))}
    </>
  );
}

export default function PrivacyPage() {
  return (
    <ContentShell>
      <header className="page-head">
        <p className="eyebrow">Privacy</p>
        <h1>Your JSON stays on your device</h1>
        <p className="lede">
          Tool Kumar formats, converts and compares documents in your browser, and we never receive them. To learn which features help people, we
          use two analytics tools. This page lists everything they receive and lets you turn them off.
        </p>
      </header>

      {/* Names this browser's analytics state before first paint, so the switch shows its note at once (components/AnalyticsSwitch.tsx). */}
      <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.analytics=(${stateFrom})(${analyticsConfigured})}catch(e){}` }} />
      <AnalyticsSwitch />

      <div className="prose">
        <h2>What happens to your documents</h2>
        <ul>
          <li>Parsing, formatting, converting, comparing and downloads run in your browser. Opening a file reads it locally; nothing is uploaded.</li>
          <li>
            Your last document, the second document in Compare and your settings are kept in this browser’s local storage, so they are still there when
            you come back. Clearing the site’s data removes them.
          </li>
          <li>Load from URL, and a link that names a URL, fetch it straight from your browser. That server sees the request; we don’t.</li>
          <li>
            A share link, or a <Link href="/integrate">View in Tool Kumar</Link> link, carries the document in the part after{' '}
            <code>#</code>. Browsers never send that part to a server, and our analytics remove it.
          </li>
          <li>A site that opens a document in Tool Kumar for you hands it from its tab to ours, inside your browser. It never reaches our server.</li>
          <li>
            An AI agent in your browser, such as the one in ChatGPT’s desktop app, can use the JSON tool for you through named functions (
            <a href="https://webmachinelearning.github.io/webmcp/">WebMCP</a>): open, check, repair, format, convert, compare, download or share a document. The
            functions run in your browser like the buttons do. What they return goes to that agent and its provider, under their privacy terms, as
            anything else the agent reads on the page does. It never reaches us.
          </li>
        </ul>

        <h2>What we never collect</h2>
        <ul>
          <li>Anything inside your documents: text, keys, values or JSON paths</li>
          <li>What you type into Find, JSONPath queries or the type name for generated code</li>
          <li>File names, the URLs you load from and share links</li>
          <li>Original error messages, clipboard contents and exact document sizes</li>
          <li>Your IP address, once your approximate location has been looked up</li>
        </ul>

        <h2>What we measure</h2>
        <h3>Vercel Web Analytics</h3>
        <p>
          Counts page views: the page’s path, the site you came from, your country and the kind of device and browser. It sets no cookies and
          stores nothing in your browser.
        </p>

        <h3>PostHog</h3>
        <p>PostHog shows us which features are used and where people get stuck. It receives:</p>
        <ul>
          <li>
            <strong>Page views and visits:</strong> the page’s path, the site you came from, your browser, operating system, screen size, language, time
            zone, the site’s language, light or dark theme, touch or mouse input and whether it runs as an installed app. Fragments and query parameters are removed from every URL, apart from <code>utm_</code> campaign tags.
          </li>
          <li>
            <strong>Approximate location:</strong> continent, country, region, city, postal code, latitude, longitude and time zone, where available.
            PostHog estimates these from your IP address, then discards the IP address. It may also include an accuracy radius and confidence scores
            for the estimates. This is an IP-based estimate, not your GPS location or an exact street address. We do not request your browser’s
            location permission.
          </li>
          <li>
            <strong>Feature use:</strong> the events in the table below, such as which view or Convert language you pick, which buttons you use and how a
            document arrived.
          </li>
          <li>
            <strong>The shape of a document, rounded:</strong> its size range (for example 10–100 KB) and its size rounded to two significant digits, how
            many values it has (as a range such as 1k–9.9k), how deeply it nests, how long it took to check, whether it is valid and, if it isn’t, the
            kind of error (for example “trailing comma”). Never the error message, because messages can quote your data.
          </li>
          <li>
            <strong>Speed and clicks:</strong> Core Web Vitals, and where on the page people click and move the pointer (heatmaps, positions only).
          </li>
          <li>
            <strong>Application errors:</strong> PostHog Error Tracking receives unexpected browser errors, unhandled promise rejections, React
            rendering failures and failures reported by our conversion, import, export and background processing code. Reports contain a standard
            error category, the part of the app that reported it, and available application script locations with line and column numbers. Every
            original error message is replaced with a fixed privacy message before sending. We remove arbitrary error details, function names,
            source snippets, local variables and error breadcrumbs. Reports can be linked to the same anonymous visit and its recording.
            Normal JSON validation errors are counted by category in the document events below.
          </li>
          <li>
            <strong>Screen recordings</strong>, described in the next section.
          </li>
        </ul>
        <p>
          PostHog keeps a random ID in this browser’s local storage, so a return visit counts as the same visitor. It sets no cookies. There are no
          accounts, so the ID is never linked to a name or an email address.
        </p>

        <h3>Screen recordings, and what they cannot show</h3>
        <p>
          Recordings show us where the interface confuses people: what was clicked, how the panels were arranged, how far a page was scrolled. They
          are put together in your browser, and built so that they cannot contain your documents:
        </p>
        <ul>
          <li>
            Both editors, file names, the JSON path, the table location, the whole output area (formatted output, tree, table, graph, converted code and
            Compare) and everything that describes your document (error messages, sizes, line and node counts, the cursor position and notifications)
            are left out. They appear as empty boxes, and the recorder never reads inside them.
          </li>
          <li>Whatever you type into a field (search, URLs, names) is replaced with asterisks before anything leaves your browser.</li>
          <li>The site’s own text stays readable: buttons, menus, labels, tooltips and the articles and guides you read.</li>
          <li>Recordings contain no network requests, no console messages and no canvas drawings.</li>
        </ul>
        <div className="replay-figure">
          <figure>
            <figcaption>What you see</figcaption>
            <Shot name="seen" alt="The JSON tool with a sample document open: the file name, the editor, the tree view and the status bar are all readable." />
          </figure>
          <figure>
            <figcaption>
              What a recording keeps <span>(striped areas are left out entirely)</span>
            </figcaption>
            <Shot
              name="recorded"
              alt="The same screen as a recording keeps it: the file name, the editor, the tree view, the status message and the cursor position are empty boxes, while the toolbar, the Tree menu and the Integrate, Blog and Privacy links stay readable."
            />
          </figure>
        </div>

        <h2>Every event, and what it carries</h2>
        <p>
          These are all the feature events the site sends to PostHog. The table is built from the
          code that sends them. Every value is a feature name, a choice from a fixed list, a yes or no, or a rounded number. Error Tracking also sends
          {' '}<code>$exception</code> events with the limited details described above.
        </p>
        <div className="table-wrap">
          <table className="privacy-events">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Sent when</th>
                <th scope="col">Carries</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(EVENT_PROPS) as EventName[]).map((name) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{WHEN[name]}</td>
                  <td>{(EVENT_PROPS[name] as readonly string[]).map((p) => PROPS[p] ?? p).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Where the data goes</h2>
        <p>
          Your browser sends analytics through this site to Vercel and PostHog Cloud{' '}
          {eu ? 'EU (stored in Frankfurt, Germany)' : 'US (stored in the United States)'}. PostHog requests are not compressed: they are plain JSON,
          except the few sent as a page closes, which are base64-encoded JSON. You can read every one of
          them in your browser’s developer tools. The{' '}
          <Link href="/tools/secure-json-formatter">secure JSON formatter guide</Link> shows how to check that a marker you paste never appears in a
          request. We use this data only to improve Tool Kumar. We don’t sell it, share it with advertisers or use it for ads.
        </p>

        <h2>Turning analytics off</h2>
        <p>
          Use the switch at the top of this page. It applies to this browser until you clear the site’s data, and it stops both tools: PostHog isn’t
          loaded at all and Vercel counts nothing. In the JSON tool, the same choice is <strong>Privacy mode</strong> in the command palette (Ctrl+K, or
          ⌘K on a Mac). If your browser sends Global Privacy Control or Do Not Track, PostHog never loads, without you doing anything.
        </p>
        <p className="muted">
          Last updated <time dateTime={PAGE_DATES['/privacy'].updated}>{formatDate(PAGE_DATES['/privacy'].updated)}</time>.
        </p>
      </div>
    </ContentShell>
  );
}
