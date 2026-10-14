import Link from 'next/link';
import { Article, Code, postMetadata } from '../article';
import { getPost } from '../posts';

const post = getPost('json-formatter-privacy-study');
export const metadata = postMetadata(post);

const RESULTS = [
  ['JSONFormatter', 'Blocked by browser challenge', '—', '—', '—', '—', '—'],
  ['Code Beautify JSON Viewer', 'No marker observed', '142', '0.77 MB', 'Yes', 'No', 'Tested'],
  ['JSONLint', 'No marker observed', '139', '0.60 MB', 'No', 'No', 'Tested'],
  ['JSON Editor Online', 'Blocked by browser challenge', '—', '—', '—', '—', '—'],
  ['JSON Beautifier', 'No marker observed', '10', '0.62 MB', 'Yes', 'No', 'Tested'],
  ['JSON Viewer Stack', 'No marker observed', '8', '0.18 MB', 'Yes', 'No', 'Tested'],
  ['JSON Formatter Online', 'No marker observed', '2', '0.13 MB', 'No', 'No', 'Tested'],
  ['JSON Hero', 'No marker observed', '6', '0.02 MB', 'No', 'No', 'Tested'],
  ['JSON Compare', 'No marker observed', '10', '0.11 MB', 'No', 'No', 'Tested'],
  ['Tool Kumar', 'No marker observed', '0', '0.00 MB', 'No', 'Yes', 'Tested'],
] as const;

const SOURCES = [
  ['watchTowr Labs, “Stop Putting Your Passwords Into Random Websites” (25 Nov 2025)', 'https://labs.watchtowr.com/stop-putting-your-passwords-into-random-websites-yes-seriously-you-are-the-problem/'],
  ['The Hacker News, “Years of JSONFormatter and CodeBeautify Leaks Expose Thousands of Passwords and API Keys” (25 Nov 2025)', 'https://thehackernews.com/2025/11/years-of-jsonformatter-and-codebeautify.html'],
  ['Security Affairs, “Thousands of sensitive secrets published on JSONFormatter and CodeBeautify” (28 Nov 2025)', 'https://securityaffairs.com/185150/security/thousands-of-sensitive-secrets-published-on-jsonformatter-and-codebeautify.html'],
] as const;

export default function JsonFormatterPrivacyStudyPage() {
  return (
    <Article
      post={post}
      lede="A fake canary document went through ten online JSON viewers and formatters on October 14, 2026. We recorded network requests, third-party hosts, transfer size, save or share controls and an offline reload. The test is a snapshot of what a browser observed from one location; it is not a claim about a service’s intentions or every version of its software."
    >
      <h2 id="headline-findings">What we found</h2>
      <p>
        The canary marker appeared in no outgoing request URL or request body in the eight tools that loaded. Tool Kumar made no
        request to a third-party host and reloaded while the network was disabled after its first visit. Several other tools loaded
        many advertising, analytics or identity hosts even though our fake JSON marker was not present in those requests.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Canary request</th>
              <th scope="col">Third-party hosts</th>
              <th scope="col">Transfer</th>
              <th scope="col">Save/share UI</th>
              <th scope="col">Offline reload</th>
              <th scope="col">Run</th>
            </tr>
          </thead>
          <tbody>
            {RESULTS.map((row) => (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                {row.slice(1).map((cell, i) => <td key={`${row[0]}-${i}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        “No marker observed” means our capture did not find the unique string in a request URL or body after loading the page, pasting the
        document and clicking the first visible format, validate, parse or process control. It does not prove that a tool can never
        upload other input or that a later action has the same behavior. A dash means the browser challenge prevented a fair test.
      </p>

      <h2 id="why-this-test">Why test JSON formatters?</h2>
      <p>
        On November 25, 2025, watchTowr Labs published a report about public saved links on JSONFormatter and CodeBeautify. It says the
        researchers downloaded more than 80,000 saved submissions, covering five years of JSONFormatter and one year of CodeBeautify,
        and identified thousands of secrets. The report lists examples such as Active Directory credentials, cloud keys, CI/CD
        credentials, private keys, JWTs and personal information. It also describes a Save control, predictable saved-link formats and
        a Recent Links page.
      </p>
      <p>
        The Hacker News and Security Affairs covered the same report. Their articles are useful context for the risk of treating a public
        save or share feature like a private scratchpad. Our experiment asks a narrower question: when a user pastes a new document and
        formats it, can a unique fake marker be seen leaving the page during that interaction?
      </p>

      <h2 id="method">Method</h2>
      <ol>
        <li>We selected ten sites that appeared in checks for “JSON formatter”, “JSON viewer”, “JSON validator” or “JSON beautifier”, plus Tool Kumar for the same comparison. Search results vary by location and time.</li>
        <li>In a fresh headless Chromium page, we loaded each URL, waited seven seconds, pasted the same JSON and clicked the first visible control whose label matched format, beautify, validate, parse, submit, process or view.</li>
        <li>The JSON contained only fake values and a run-specific marker: <code>TK-PRIVACY-CANARY-1791949677021-W5</code>. We captured Chrome DevTools Protocol request events, then counted distinct request hosts and encoded transfer bytes for the run.</li>
        <li>We recorded visible Save, Share, Recent Links or public-link language from the loaded page. After the first visit, we disabled the network and reloaded to check whether the page still rendered from its cache or service worker.</li>
        <li>The run used Chromium 145.0.7632.0 on the test host, from an automated environment whose IP location was not asserted. The test date was October 14, 2026 UTC.</li>
      </ol>
      <Code lang="json">{`{
  "study": "json-formatter-privacy",
  "marker": "TK-PRIVACY-CANARY-...",
  "fake": {
    "email": "nobody@example.invalid",
    "token": "not-a-secret"
  }
}`}</Code>
      <p>
        The raw capture is <a href="/research/json-formatter-privacy-study.json" download>available as JSON</a>. It includes timestamps,
        browser version, request counts, host lists, transfer bytes and the exact status recorded for each site. The no-dependency runner
        script and notes are kept with the research files for reproducibility.
      </p>

      <h2 id="interpretation">How to read the table</h2>
      <p>
        A request to the site’s own host can be part of normal server processing. This run did not classify a site as “safe” or “unsafe”,
        inspect server logs, audit source code or test every button. Third-party host counts are a network observation, not a tracker
        verdict. A Save or Share label is a product feature; it does not by itself show whether a document is public, private, encrypted or
        retained for a particular period.
      </p>
      <p>
        Tool Kumar is published by the same team that produced this study, so it is included under the same canary procedure. Its result is
        a measured observation from this run, not a request that readers take our word for it. You can repeat the test yourself and compare
        the downloaded data with your own DevTools capture.
      </p>

      <h2 id="check-yourself">Check any JSON tool yourself</h2>
      <ol>
        <li>Open a fresh private window and create a harmless marker such as <code>TEST-CANARY-2026-XYZ</code>. Never use a real password, API key or customer data.</li>
        <li>Open DevTools, choose the Network panel and enable “Preserve log”. Filter by Fetch/XHR, then paste the canary and run the formatter.</li>
        <li>Search request URLs and request payloads for the marker. Inspect the request host, method and response. A request to a remote host is evidence that data was sent in that request; absence of the marker is evidence only for that exact run and action.</li>
        <li>Look for Save, Share, Recent Links or a generated URL. Treat a URL that reproduces the document as public until the service documents a different access model.</li>
        <li>For offline behavior, visit once, switch DevTools to Offline and reload. A cached shell can still render while a later formatting action may need resources that are not cached.</li>
      </ol>

      <h2 id="limitations">Limitations</h2>
      <p>
        This was one run per site, from one automated browser and one network location. A challenge blocked JSONFormatter and JSON Editor
        Online, and we did not bypass either. We did not create accounts, click a Save control, crawl saved links, inspect server-side
        retention or test mobile browsers. Ad auctions and third-party hosts can change between runs. The results describe this dated
        interaction, not a permanent property of any service.
      </p>

      <h2 id="sources">Sources</h2>
      <ul className="sources">
        {SOURCES.map(([label, href]) => <li key={href}><a href={href} rel="noreferrer">{label}</a></li>)}
      </ul>
      <p>
        If you need to format a document now, <Link href="/">Tool Kumar runs the parser in your browser</Link> and is designed to keep
        the input on your device. You can still verify that claim with the DevTools steps above.
      </p>
    </Article>
  );
}
