import { Article, Code, postMetadata } from '../article';
import { getPost } from '../posts';
import { jsonLdScript } from '../../seo';
import { SITE } from '@/lib/site';
import scores from '@/public/research/best-json-formatter/scores.json';
import selection from '@/public/research/best-json-formatter/serp/selection.json';
import { ScoreBars, SpeedChart } from './charts';
import styles from './study.module.css';

const post = getPost('best-json-formatter');
export const metadata = postMetadata(post);

/** Everything on this page is read from the published files, so the page and the downloads can't disagree. */
const R = '/research/best-json-formatter';
/** The fields of scores.json this page reads (written by kit/score.mjs). */
type Seconds = Record<string, number | string | null>;
type Tool = {
  id: string;
  name: string;
  url: string;
  publisher: boolean;
  blocked: string | null;
  total: number | null;
  totals: Record<string, number> | null;
  ranks?: Record<string, number>;
  range: { min: number; max: number; missing: string[]; rankBest: number; rankWorst: number } | null;
  categories: Record<'data' | 'speed' | 'privacy' | 'ease' | 'page', number | null>;
  details: {
    data: Record<string, string | null>;
    speedSeconds: Seconds;
    speedRuns: Record<string, number>;
    freezeSeconds: Seconds;
    firefoxSeconds: Seconds;
    sendsJson: boolean;
    thirdPartyDomains: number | null;
    offline: boolean | null;
    errors: Record<string, { detected: boolean; rightLine: boolean; message: string | null } | null>;
    features: Record<string, boolean>;
    easeParts: Record<string, number | null>;
    lcpSeconds: number | null;
    pageMB: number | null;
    cls: number | null;
    ads: boolean;
    interruptions: string[];
    keyboard: { inputName: string | null; controlName: string | null; keyboardFormat: boolean } | null;
  };
  notes: string[];
};
const TOOLS = scores.tools as unknown as Tool[];
const RANKED = TOOLS.filter((t) => t.total !== null);
const UNRANKED = TOOLS.filter((t) => t.total === null);
const CATEGORIES = [
  ['data', 'Data safety', 25],
  ['speed', 'Speed', 25],
  ['privacy', 'Privacy', 20],
  ['ease', 'Ease of use', 20],
  ['page', 'Page & access', 10],
] as const;
const DATA_CASES = Object.keys(TOOLS[0].details.data);
const ERROR_CASES = Object.keys(TOOLS[0].details.errors);
const FEATURES = ['indent', 'minify', 'tree', 'search', 'sortKeys', 'copy', 'download', 'openFile', 'loadUrl', 'darkMode', 'repair', 'convert'] as const;
const FEATURE_LABEL: Record<(typeof FEATURES)[number], string> = {
  indent: 'Indent choice', minify: 'Minify', tree: 'Tree view', search: 'Search', sortKeys: 'Sort keys', copy: 'One-click copy',
  download: 'Download', openFile: 'Open a file', loadUrl: 'Load a URL', darkMode: 'Dark mode', repair: 'Repair', convert: 'Convert',
};
const GRADE: Record<string, [string, string]> = {
  pass: ['✓', 'Kept exactly'],
  spelling: ['≈', 'Same value, spelling changed'],
  refused: ['!', 'Refused with a message'],
  changed: ['✗', 'Data changed'],
  rejected: ['✗', 'Rejected valid JSON'],
  'no output': ['✗', 'No output'],
  untested: ['–', 'Not tested'],
};

const secs = (v: number | string | null | undefined) => (v === null || v === undefined ? '–' : v === 'failed' ? 'failed' : `${Number(v) < 1 ? Number(v).toFixed(2) : Number(v).toFixed(1)} s`);
const pts = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toFixed(1));
const name = (t: Tool) => (t.publisher ? `${t.name} (publisher)` : t.name);
/** Short names for the narrow column headers of the result matrices. */
const SHORT: Record<string, string> = {
  'jsonformatter-org': 'jsonformatter.org', curiousconcept: 'Curious Concept', jsoneditoronline: 'JSON Editor Online', codebeautify: 'Code Beautify',
  jsonlint: 'JSONLint', 'jsonviewer-stack': 'jsonviewer.stack.hu', 'jsonbeautify-com': 'jsonbeautify.com', 'jsonbeautify-org': 'jsonbeautify.org',
  jsonchecker: 'JSON Checker', 'static-app': 'static.app', 'jsonbeautifier-org': 'jsonbeautifier.org', 'jsonviewer-io': 'jsonviewer.io', 'tool-kumar': 'Tool Kumar',
};
const short = (t: Tool) => SHORT[t.id] ?? t.name;
const by = <K extends keyof Tool['categories']>(k: K) => [...RANKED].sort((a, b) => (b.categories[k] ?? 0) - (a.categories[k] ?? 0));

const PUBLISHER = TOOLS.find((t) => t.publisher);
/** The data-safety pattern of JSON.parse + JSON.stringify: these six cases changed and number spelling normalised. */
const PARSE_CASES = ['big-integer', 'max-safe-plus-one', 'long-decimal', 'huge-exponent', 'duplicate-keys', 'key-order'];
const MEASURED_DATA = TOOLS.filter((t) => t.categories.data !== null);
const JSON_PARSE_PATTERN = MEASURED_DATA.filter((t) => PARSE_CASES.every((c) => t.details.data[c] === 'changed') && t.details.data['number-spelling'] === 'spelling');
const FULL_DATA = MEASURED_DATA.filter((t) => t.categories.data === 25);
/** Why each unranked tool is unranked, in plain words (the details are in the protocol's amendments 3–5). */
const UNRANKED_WHY: Record<string, string> = {
  curiousconcept: 'it formats on its server, which refused our unmodified browser (HTTP 403) everywhere we tried; we did not work around it.',
  'jsonformatter-org': 'its 50 MB runs never got started: with the file loaded, the page and its ads took our 7 GB cloud machine down.',
  codebeautify: 'its 50 MB runs never got started: with the file loaded, the page and its ads took our 7 GB cloud machine down.',
  jsonlint: 'its editor often did not load within 60 seconds on our cloud machines, so its error and feature checks, and three data cases, could not be measured.',
  'jsonbeautify-com': 'its server was down (Cloudflare error 522) during much of the measurement, so its WebKit check could not be measured.',
};
const ALT_WEIGHTS = Object.keys(scores.weights).filter((k) => k !== 'Default');
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Every tool that shares the best value of `score` (ties are listed together). */
function best(score: (t: Tool) => number | null, lowerIsBetter = false): Tool[] {
  const scored: [Tool, number][] = [];
  for (const t of RANKED) {
    const v = score(t);
    if (v !== null && Number.isFinite(v)) scored.push([t, v]);
  }
  if (!scored.length) return [];
  const top = lowerIsBetter ? Math.min(...scored.map((x) => x[1])) : Math.max(...scored.map((x) => x[1]));
  return scored.filter((x) => x[1] === top).map((x) => x[0]);
}
const num = (v: number | string | null | undefined) => (typeof v === 'number' ? v : null);
const fastest50 = best((t) => num(t.details.speedSeconds['50mb']), true);
const bestOther = RANKED.filter((t) => !t.publisher)[0];
const PICKS: [string, Tool[], string | null][] = [
  ['Best overall', RANKED.filter((t) => t.ranks?.Default === 1), 'the highest total score'],
  ['Best not made by us', bestOther ? [bestOther] : [], bestOther ? `${pts(bestOther.total)} points` : null],
  ['Kept every data case exactly', RANKED.filter((t) => t.categories.data === 25), null],
  ['Fastest with a 50 MB file', fastest50, fastest50[0] ? `median ${secs(fastest50[0].details.speedSeconds['50mb'])} in Chromium` : null],
  ['Most private', best((t) => t.categories.privacy), 'the most privacy points'],
  ['Best error messages', best((t) => t.details.easeParts.errors), 'the most error cases noticed and placed on the right line'],
  ['Most features', best((t) => Object.values(t.details.features).filter(Boolean).length), 'the most of the twelve features we looked for'],
];

/** The ranking as an ordered list, and the published results as a dataset (alongside the post's own JSON-LD). */
const STUDY_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'ItemList',
      '@id': `${SITE}/blogs/best-json-formatter#ranking`,
      name: 'Online JSON formatters ranked by the study',
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      numberOfItems: RANKED.length,
      itemListElement: RANKED.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: t.url })),
    },
    {
      '@type': 'Dataset',
      '@id': `${SITE}/blogs/best-json-formatter#data`,
      name: 'Online JSON formatter study: raw results and scores',
      description: 'Every measured run of the study (speed, data safety, error help, privacy, page and accessibility checks) as JSON lines, the computed scores, the pre-registered protocol and the replication kit.',
      url: `${SITE}/blogs/best-json-formatter`,
      creator: { '@type': 'Organization', name: 'Tool Kumar', url: SITE },
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}${R}/scores.json` },
        { '@type': 'DataDownload', encodingFormat: 'text/markdown', contentUrl: `${SITE}${R}/protocol.md` },
      ],
    },
  ],
};

export default function BestJsonFormatterPage() {
  const winner = RANKED[0];
  return (
    <Article
      post={post}
      lede={
        <>
          We tested the {TOOLS.length} online JSON formatters that search engines show most for “JSON formatter” and four related searches, with the same
          scripted test for every tool: whether your data comes out unchanged, how fast it formats 100 KB to 50 MB, whether your JSON leaves the browser,
          how well errors are explained, and how the page itself behaves. The rules and the scoring were committed before the first measurement.
        </>
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(STUDY_LD) }} />
      <aside className="note" aria-label="Disclosure">
        <p>
          <strong>Disclosure.</strong> This study is published by Tool Kumar, which makes one of the tested tools. It is tested and scored with the same
          scripts as every other tool, its release was frozen during the measurement, and the ranking is published whatever its place.{' '}
          <a href={`${R}/protocol.md`}>The pre-registered protocol</a>, every script and all raw data are downloadable below, so you can check our work
          or run it yourself.
        </p>
      </aside>

      <h2 id="ranking">The ranking</h2>
      <p>
        {winner ? (
          <>
            <strong>{winner.name}</strong> scored highest overall with {pts(winner.total)} of 100 points.
          </>
        ) : null}{' '}
        Scores are out of 100: data safety 25, speed 25, privacy 20, ease of use 20, page and accessibility 10. Tools within one point of each other
        share a rank.
      </p>
      <div className="table-wrap">
        <table className={styles.ranking}>
          <caption className="sr-only">Overall scores of the tested JSON formatters</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Tool</th>
              <th scope="col">Total</th>
              {CATEGORIES.map(([k, label, max]) => (
                <th scope="col" key={k}>
                  {label}
                  <span className={styles.max}> /{max}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RANKED.map((t) => (
              <tr key={t.id} className={t.publisher ? styles.publisher : undefined}>
                <td>{t.ranks?.Default}</td>
                <th scope="row">
                  <a href={t.url} rel="noreferrer">{name(t)}</a>
                </th>
                <td className={styles.total}>{pts(t.total)}</td>
                {CATEGORIES.map(([k]) => (
                  <td key={k}>{pts(t.categories[k])}</td>
                ))}
              </tr>
            ))}
            {UNRANKED.map((t) => (
              <tr key={t.id}>
                <td>–</td>
                <th scope="row">
                  <a href={t.url} rel="noreferrer">{t.name}</a>
                </th>
                <td colSpan={CATEGORIES.length + 1} className={styles.unranked}>
                  Not ranked: {t.notes.join('; ').replace(/^not ranked: /, '')}
                  {t.range && <> · between {pts(t.range.min)} and {pts(t.range.max)} points</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ScoreBars tools={RANKED} categories={CATEGORIES} />
      {PUBLISHER && (
        <p className="note">
          <strong>Read this with the conflict of interest in mind.</strong> {PUBLISHER.name}, the publisher’s tool,{' '}
          {PUBLISHER.ranks?.Default ? <>ranked {ordinal(PUBLISHER.ranks.Default)} with {pts(PUBLISHER.total)} points</> : <>is not ranked</>}
          {PUBLISHER.ranks && (
            <>
              {' '}(under the four alternative weightings: {ALT_WEIGHTS.map((k) => ordinal(PUBLISHER.ranks?.[k] ?? 0)).join(', ')})
            </>
          )}
          . We chose the five categories, and Tool Kumar was built around several of them: keeping data exact, keeping it in the browser, working
          offline. The categories and weights were fixed before any measurement, but someone else might weigh things this study does not test at all,
          such as saving and sharing documents online, JSON Schema validation, collaboration or a browser extension. Every number here can be checked
          against the raw data and rerun with the kit.
        </p>
      )}

      {UNRANKED.length > 0 && (
        <>
          <h3 id="unranked">Tools we could not rank</h3>
          <p>
            Some tools could not be measured completely, for reasons stated below. We don’t guess the missing parts: each range is the tool’s total with
            every missing piece at zero and at full marks, so its true score lies inside it.
          </p>
          <ul>
            {UNRANKED.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>: {UNRANKED_WHY[t.id] ?? t.notes.join('; ').replace(/^not ranked: /, '')}
                {t.range && (
                  <>
                    {' '}
                    Its score would be between {pts(t.range.min)} and {pts(t.range.max)} points, which would place it{' '}
                    {t.range.rankBest === t.range.rankWorst ? <>{ordinal(t.range.rankBest)}</> : <>between {ordinal(t.range.rankBest)} and {ordinal(t.range.rankWorst)}</>}.
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 id="picks">Which one should you use?</h2>
      <ul>
        {PICKS.map(([label, list, why]) => (
          <li key={label}>
            <strong>{label}:</strong> {list.length ? list.map((t) => t.name).join(', ') : 'no tool'}
            {why ? <> — {why}</> : null}.
          </li>
        ))}
      </ul>

      <h2 id="data-safety">Does your data come out unchanged?</h2>
      <p>
        A formatter should only change whitespace. We pasted {DATA_CASES.length} small documents that trip up common shortcuts and compared the output with
        the input using a reader that keeps numbers exactly as written. {JSON_PARSE_PATTERN.length} of the {MEASURED_DATA.length} tools we could test changed
        data in exactly the way JavaScript’s <code>JSON.parse</code> does, which suggests they run your document through it. It stores every number as a
        64-bit float and every object as a JavaScript object: integers above 9,007,199,254,740,991 are rounded, very long decimals lose digits, duplicate
        keys collapse into one, and keys that look like integers move to the front. {FULL_DATA.map((t) => t.name).join(', ')} kept every case exactly.
      </p>
      <Code lang="json">{`{"id":12345678901234567890}  →  {"id": 12345678901234567000}  rounded
{"zebra":1,"10":2,"2":3}     →  {"2": 3, "10": 2, "zebra": 1}  moved
{"a":1,"a":2}                →  {"a": 2}                       lost`}</Code>
      <div className="table-wrap">
        <table className={styles.matrix}>
          <caption className="sr-only">Data-safety results per case and tool</caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              {RANKED.map((t) => (
                <th scope="col" key={t.id}>
                  {short(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DATA_CASES.map((c) => (
              <tr key={c}>
                <th scope="row">
                  <code>{c}</code>
                </th>
                {RANKED.map((t) => {
                  const g = t.details.data[c] ?? 'untested';
                  const [mark, label] = GRADE[g] ?? ['?', g];
                  return (
                    <td key={t.id} className={styles[`g-${g.replace(' ', '-')}`]} title={label}>
                      <span aria-hidden="true">{mark}</span>
                      <span className="sr-only">{label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        ✓ kept exactly · ≈ same value, spelling changed (for example <code>1.0</code> → <code>1</code>) · ! refused with a message (deep nesting only) · ✗
        changed, rejected or no output. The cases are <a href={`${R}/kit/cases/README.md`}>listed with their files</a> so you can paste them into any tool.
      </p>

      <h2 id="speed">Speed and big files</h2>
      <p>
        Each run opens the tool in a new browser profile, pastes a minified file with the keyboard and presses the tool’s format button. We time from
        the paste to the moment the complete result is on screen; the pause a person would take before clicking is not counted. Medians of five runs in
        Chromium; a run that fails or passes the time limit counts as infinitely slow, so a tool that fails three of five runs shows “failed”. Runs where
        the site was down or our own setup stalled before the paste are not counted either way.
      </p>
      <SpeedChart tools={RANKED} />
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Median time to format, Chromium and Firefox</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">100 KB</th>
              <th scope="col">1 MB</th>
              <th scope="col">10 MB</th>
              <th scope="col">50 MB</th>
              <th scope="col">Longest freeze, 1 MB</th>
              <th scope="col">Firefox 1 MB</th>
            </tr>
          </thead>
          <tbody>
            {by('speed').map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                <td>{secs(t.details.speedSeconds['100kb'])}</td>
                <td>{secs(t.details.speedSeconds['1mb'])}</td>
                <td>{secs(t.details.speedSeconds['10mb'])}</td>
                <td>{secs(t.details.speedSeconds['50mb'])}</td>
                <td>{secs(t.details.freezeSeconds['1mb'])}</td>
                <td>{secs(t.details.firefoxSeconds['1mb'])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="privacy">Does your JSON leave the browser?</h2>
      <p>
        Every test file holds a unique marker. We recorded every request, request body and WebSocket message each page sent, decompressed what was
        compressed, and searched for the marker. We also counted the other companies’ domains each page contacts and checked whether the tool still
        works offline after one visit.
      </p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Privacy results</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Sends your JSON</th>
              <th scope="col">Third-party domains</th>
              <th scope="col">Ads</th>
              <th scope="col">Works offline</th>
            </tr>
          </thead>
          <tbody>
            {by('privacy').map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                <td>{t.details.sendsJson ? 'Yes' : 'No'}</td>
                <td>{t.details.thirdPartyDomains ?? '–'}</td>
                <td>{t.details.ads ? 'Yes' : 'No'}</td>
                <td>{t.details.offline === null ? '–' : t.details.offline ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {UNRANKED.filter((t) => t.blocked).map((t) => (
        <p key={t.id}>
          {t.name} is not ranked (its server refused our browser), but what its page did is measured: it{' '}
          {t.details.sendsJson ? 'sent the pasted JSON to its own server to format it' : 'did not send the pasted JSON anywhere we could see'}, and
          contacted {t.details.thirdPartyDomains ?? 'an unknown number of'} other companies’ domains.
        </p>
      ))}
      <p>
        Two notes on the third-party count. Tool Kumar’s page sends usage analytics (Vercel Web Analytics and PostHog) through its own domain, so they
        don’t appear as third parties here; what we measured is that none of its requests carried the test file. And the count is what the page contacted
        from our cloud machines, ads included: it changes with every ad auction.
      </p>
      <p className="note">
        “Sends your JSON” means a request carried the test file’s unique marker, or a body at least half the size of the pasted text. Sending JSON to a
        server is not wrong in itself, but the document then leaves your device; tools that format in the browser never need to.
      </p>

      <h2 id="ease">Errors, features and other browsers</h2>
      <p>
        We pasted {ERROR_CASES.length} documents with one common mistake each. A tool earns half a point for saying the JSON is invalid and half for naming
        or marking the right line. Features count only when the control was on the page, and worked where we could check it, on test day.
      </p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Error help and features</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Errors noticed</th>
              <th scope="col">Right line</th>
              <th scope="col">Features (of 12)</th>
              <th scope="col">Phone</th>
              <th scope="col">Firefox</th>
              <th scope="col">WebKit</th>
            </tr>
          </thead>
          <tbody>
            {by('ease').map((t) => {
              const errs = Object.values(t.details.errors);
              const f = Object.values(t.details.features).filter(Boolean).length;
              const e = t.details.easeParts;
              return (
                <tr key={t.id}>
                  <th scope="row">{t.name}</th>
                  <td>{errs.filter((x) => x?.detected).length} of {errs.length}</td>
                  <td>{errs.filter((x) => x?.rightLine).length} of {errs.length}</td>
                  <td>{f}</td>
                  <td>{e.phoneWorks ? (e.phoneFits ? 'Works' : 'Works, cramped') : 'No'}</td>
                  <td>{e.firefox ? 'Works' : 'No'}</td>
                  <td>{e.webkit ? 'Works' : 'No'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className={styles.matrix}>
          <caption className="sr-only">Features found on each tool</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {RANKED.map((t) => (
                <th scope="col" key={t.id}>
                  {short(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f}>
                <th scope="row">{FEATURE_LABEL[f]}</th>
                {RANKED.map((t) => {
                  const has = t.details.features[f];
                  return (
                    <td key={t.id} className={has ? styles['g-pass'] : styles['g-none']}>
                      <span aria-hidden="true">{has ? '✓' : '·'}</span>
                      <span className="sr-only">{has ? 'Yes' : 'No'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="page">The page itself</h2>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Page load, weight and accessibility</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Largest paint</th>
              <th scope="col">Page weight</th>
              <th scope="col">Layout shift</th>
              <th scope="col">Interruptions</th>
              <th scope="col">Keyboard only</th>
            </tr>
          </thead>
          <tbody>
            {by('page').map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                <td>{secs(t.details.lcpSeconds)}</td>
                <td>{t.details.pageMB === null ? '–' : `${t.details.pageMB.toFixed(1)} MB`}</td>
                <td>{t.details.cls ?? '–'}</td>
                <td>{t.details.interruptions.length ? t.details.interruptions.join(', ') : 'None'}</td>
                <td>{t.details.keyboard?.keyboardFormat ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        Page weight is the median of five visits. JSON Checker’s varied from 1.8 to 98.7 MB between identical visits from our cloud machines; from an
        ordinary server we saw 2.4 MB, most of it Cloudflare’s bot check, which treats cloud machines with more suspicion.
      </p>

      <h2 id="weights">Does the ranking depend on our weights?</h2>
      <p>
        Any weighting is a judgment. Before measuring, we fixed four alternatives and report the rank of every tool under each, so you can see whether
        the order holds.
      </p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Rank under alternative weights</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              {Object.keys(scores.weights).map((k) => (
                <th scope="col" key={k}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RANKED.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                {Object.keys(scores.weights).map((k) => (
                  <td key={k}>{t.ranks?.[k] ?? '–'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="method">How we chose and tested the tools</h2>
      <ol>
        <li>
          <strong>Selection.</strong> We recorded the first results page of Google and Bing for “json formatter”, “json beautifier”, “json viewer”, “json
          validator” and “format json online”, kept free tools you can paste into, and took the {selection.take} sites that appeared in the most of those ten
          lists, plus Tool Kumar. <a href={`${R}/serp/selection.json`}>The lists and the count</a> are published with screenshots.
        </li>
        <li>
          <strong>Machines.</strong> Every measured run happened on GitHub Actions’ standard Linux runner (2 CPUs, about 7 GB of memory), in real
          Chromium, Firefox and WebKit windows driven by Playwright, with nothing disguised and no ad blocking. Every speed job ran every tool, so each
          tool got the same share of each machine; each job records its processor.
        </li>
        <li>
          <strong>Files.</strong> The speed files are generated from a fixed seed — realistic API records, minified, exactly 100,000, 1,000,000,
          10,000,000 and 50,000,000 bytes — so nothing large has to be downloaded and anyone can check the bytes against our SHA-256 list.
        </li>
        <li>
          <strong>Fairness.</strong> Each tool has a small adapter that says only where to paste, which button formats and where results and errors
          appear. Default settings everywhere. Tools were visited in a seeded random order in every repetition.
        </li>
        <li>
          <strong>Changes.</strong> Everything we had to decide after the protocol was written is listed, dated, under{' '}
          <a href={`${R}/protocol.md#deviations`}>Deviations</a>.
        </li>
      </ol>

      <h2 id="changes">How the study changed while it ran</h2>
      <p>
        We published the rules before measuring, so here is everything that did not go to plan. Each item is dated, with its reasons, in the protocol’s{' '}
        <a href={`${R}/protocol.md#deviations`}>Deviations</a>.
      </p>
      <ul>
        <li>
          <strong>Google blocked the cloud runners</strong> with a CAPTCHA, so its five result lists were read in an ordinary browser window instead, from
          a server in India with Google’s US settings. Bing’s lists came from US runners as planned.
        </li>
        <li>
          <strong>The first measured run was set aside</strong>, except its Firefox runs, which are used only to check that each tool works in
          Firefox at 100 KB and 1 MB. It showed that our own harness failed some runs: pages busy with ads stopped
          answering while we put the test file on the clipboard, clicks gave up too early on big pastes, and our “is it done?” check read whole text boxes on
          every frame, which could slow the page it measured. We fixed the harness for every tool and measured again. That, and two later repeats, raised
          the study’s cloud budget from 500 to about 920 minutes; it used 909.
        </li>
        <li>
          <strong>Runs that said nothing about the tool were repeated, not scored:</strong> jsonbeautify.com’s server was down (Cloudflare error 522)
          several times during the measurement, and on some ad-heavy pages the 2-CPU runner was too busy to even paste. A page that loaded but whose input
          never became usable does count as a failure: that is what a visitor would see.
        </li>
        <li>
          <strong>Four decisions were made after seeing results,</strong> and each helps one tool. JSON Editor Online warns above 10.5 MB that text mode
          may crash the browser; we click its <em>Open anyway</em> and keep the clock running, rather than calling the warning a failure. A 73 KB request
          from JSON Checker’s page to Cloudflare’s bot check is not counted as uploading your JSON (it did not contain the test marker). And Tool Kumar’s
          phone check, which looks at the screen because its view draws only visible rows, now also accepts the last line number, because on a narrow
          screen the final long string pushed the end marker out of view. Finally, our keyboard check misread accessible names containing a colon; reading
          every tool’s names again changed only one, JSON Editor Online’s Format button.
        </li>
        <li>
          <strong>Five tools could not be ranked,</strong> each for a stated reason, listed under <a href="#unranked">the ranking</a> with the range
          their score would fall in. Two machines were shut down by 50 MB files on ad-heavy pages; their results come from the jobs’ logs.
        </li>
        <li>
          <strong>Tool Kumar was not changed during the study:</strong> its live build was the same before and after measuring, and its last release
          was on October 30, before the study began.
        </li>
      </ul>

      <h2 id="replicate">Run it yourself</h2>
      <p>
        You need Node.js 22 or newer and pnpm. The kit has one dependency, Playwright, and generates every test file locally.
      </p>
      <Code lang="sh">{`pnpm install --ignore-workspace
pnpm exec playwright-core install chromium firefox
node generate.mjs          # 100 KB … 50 MB test files, checked against fixtures.sha256.json
node run.mjs smoke --tools jsonformatter-org
node run.mjs speed --sizes 100kb,1mb --reps 3
node score.mjs out/results`}</Code>
      <ul>
        <li>
          <a href={`${R}/protocol.md`}>protocol.md</a>: what is tested and how it is scored, with every deviation.
        </li>
        <li>
          <a href={`${R}/kit/README.md`}>Replication kit</a>: the generator, cases, adapters, harness, scorer and the GitHub Actions workflow.
        </li>
        <li>
          <a href={`${R}/scores.json`}>scores.json</a>: every number on this page. <a href={`${R}/results/README.md`}>results/</a>: every run as JSON lines, with each machine and log.
        </li>
      </ul>

      <h2 id="limitations">Limitations</h2>
      <p>
        Websites change, ads differ by visit and location, and a 2-CPU cloud runner is slower than most laptops: compare tools within this study, not with
        your own stopwatch. We did not test paid plans, signed-in features, browser extensions, desktop apps or real phones (the phone test is an
        emulated phone in Chromium), and Safari only through its Linux engine.
      </p>
    </Article>
  );
}
