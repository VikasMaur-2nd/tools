import Link from 'next/link';
import ArticleFrame from '../article-frame';
import { Code } from '../blogs/article';
import { formatDate } from '../dates';
import { articleJsonLd } from '../seo';
import { SITE } from '@/lib/site';
import { ERROR_GUIDES, SOURCES, type ErrorGuide } from './errors';
import HttpExamples from './http-examples';

export function Faq({ entries }: { entries: ErrorGuide['faq'] }) {
  return <>{entries.map(({ question, answer }) => <div key={question}><h3>{question}</h3><p>{answer}</p></div>)}</>;
}

export function faqJsonLd(entries: ErrorGuide['faq'], url: string) {
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: entries.map(({ question, answer }) => ({
      '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

const sections = [
  { id: 'meaning', label: 'What the error means' },
  { id: 'messages', label: 'Messages by runtime' },
  { id: 'causes', label: 'Causes and examples' },
  { id: 'fix', label: 'How to fix it' },
  { id: 'position', label: 'Find the exact position' },
  { id: 'faq', label: 'Frequently asked questions' },
  { id: 'related', label: 'Related errors' },
  { id: 'sources', label: 'Sources' },
];

// Serialization errors have no input to locate; binding errors have valid JSON of the wrong shape.
const sectionsFor = (kind: ErrorGuide['kind']) => kind === 'serialize'
  ? sections.filter(section => section.id !== 'position')
  : kind === 'binding'
    ? sections.map(section => section.id === 'position' ? { ...section, label: 'Compare the JSON shape' } : section)
    : sections;

const CTA = {
  parse: { title: 'Check the text you actually received', text: 'Find syntax errors and inspect repairs in your browser. Your document stays on your device.', href: '/tools/json-validator', label: 'Open the JSON validator' },
  serialize: { title: 'Check the JSON you send', text: 'Paste serialized output to confirm it is valid JSON before it leaves your app. Your document stays on your device.', href: '/tools/json-validator', label: 'Open the JSON validator' },
  binding: { title: 'See the shape of your JSON', text: 'Browse the document as a tree and copy the path to any value. Your document stays on your device.', href: '/', label: 'Open the JSON viewer' },
};

const PARENT = { name: 'JSON errors', path: '/json-errors' };

export default function ErrorArticle({ guide }: { guide: ErrorGuide }) {
  const path = `/json-errors/${guide.slug}`;
  const url = SITE + path;
  const citations = [...new Set([
    ...guide.messages.flatMap(message => message.source ? [message.source] : []),
    ...(guide.docs ?? []).map(doc => doc.href),
  ])];
  const hasRuntime = (prefix: string) => guide.messages.some(message => message.runtime.startsWith(prefix));
  const cta = CTA[guide.kind ?? 'parse'];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      ...articleJsonLd({
        type: 'TechArticle', path, title: guide.title, description: guide.description, published: guide.published, updated: guide.updated,
        parent: PARENT, fields: { citation: [...citations, SOURCES.rfc, SOURCES.ecma] },
      }),
      faqJsonLd(guide.faq, url),
    ],
  };
  return (
    <ArticleFrame
      section="resources"
      jsonLd={jsonLd}
      parent={PARENT}
      current={guide.title}
      eyebrow="JSON troubleshooting"
      title={guide.title}
      lede={guide.description}
      byline={<><time dateTime={guide.updated}>{formatDate(guide.updated)}</time> · {guide.checked ?? 'Examples checked in Node 24 and Python 3.14'}</>}
      toc={sectionsFor(guide.kind)}
      cta={{ name: cta.title, title: cta.title, text: cta.text, href: cta.href, action: <>{cta.label} <span className="arrow" aria-hidden="true">→</span></> }}
      prefetch={false}
    >
      <h2 id="meaning">What the error means</h2>
      <p>{guide.meaning}</p>
      <h2 id="messages">Exact messages by runtime</h2>
      <p>Messages depend on the input and runtime version. Node and Python rows were reproduced locally.
        Other rows cite official documentation or source. Rows marked as fragments or templates preserve the
        source wording and are not complete exception transcripts. Browsers and libraries may append location details.</p>
      <div className="table-wrap" role="region" aria-label="Runtime error messages" tabIndex={0}>
        <table className="json-error-table"><thead><tr>
          <th scope="col">Runtime</th><th scope="col">Message</th><th scope="col">Input and evidence</th>
        </tr></thead><tbody>{guide.messages.map((message, index) => <tr key={index}>
          <th scope="row">{message.runtime}</th><td><code>{message.text}</code></td>
          <td><code>{message.input}</code><br />{message.source
            ? <a href={message.source}>{message.evidence}</a> : message.evidence}</td>
        </tr>)}</tbody></table>
      </div>
      <h2 id="causes">Causes you can reproduce</h2>
      {guide.causes.map(cause => <section key={cause.title}>
        <h3>{cause.title}</h3><p>{cause.text}</p><Code lang={cause.lang}>{cause.code}</Code>
        {cause.lang === 'go' && <p>These fragments use <code>encoding/json</code> and <code>fmt</code> inside a Go function. A complete program appears below.</p>}
      </section>)}
      <h2 id="fix">How to fix it</h2>
      <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
      {guide.fixes.map(fix => <section key={fix.title}>
        <h3>{fix.title}</h3><p>{fix.text}</p><Code lang={fix.lang}>{fix.code}</Code>
      </section>)}
      {guide.http && <HttpExamples />}
      {guide.kind === 'binding' && <>
        <h2 id="position">Compare the JSON shape with your types</h2>
        <ol>
          <li>Copy the exact JSON your code received, for example from a log or a failing test.</li>
          <li>Paste it into the <Link prefetch={false} href="/">Tool Kumar JSON viewer</Link>. The document stays in your browser.</li>
          <li>Open the tree at the property named in the error and check whether the value there is an object, an array or a single value. The <Link prefetch={false} href="/tools/json-path-finder">JSON path finder</Link> copies the path to any value.</li>
          <li>Generate types from the same document with a converter listed under related tools, then compare them with your own classes or structs.</li>
        </ol>
      </>}
      {!guide.kind && <>
      <h2 id="position">Find the exact position with Tool Kumar</h2>
      <ol>
        <li>Copy the exact input text, including its original whitespace. For HTTP failures, copy the raw response body.</li>
        <li>Open the <Link prefetch={false} href="/tools/json-validator">Tool Kumar JSON validator</Link> and paste the text. The document stays in your browser.</li>
        <li>Read the line and column in the error or fixable-issue banner. For an invalid document, select <strong>Go to error</strong> to move the caret to that location.</li>
        <li>Inspect the preceding token as well as the marked character. A parser marks where it discovered the problem; the missing quote, separator or value can start earlier.</li>
      </ol>
      <p>Python character offsets are zero-based, while its displayed lines and columns are one-based.
        V8 string positions count UTF-16 code units; Go offsets count bytes read. Unicode text can make these
        offsets differ. Use the original text and its line/column context rather than copying an offset between runtimes.</p>
      <p>Tool Kumar can classify some input as fixable loose JSON. Review a proposed change before using the{' '}
        <Link prefetch={false} href="/tools/json-repair">JSON repair tool</Link>, then validate the result against your API contract.
        For empty input, inspect the producer or response because there is no character to select.</p>
      </>}
      <h2 id="faq">Frequently asked questions</h2><Faq entries={guide.faq} />
      <h2 id="related">Related errors and tools</h2>
      <ul>{guide.related.map(slug => {
        const related = ERROR_GUIDES.find(entry => entry.slug === slug)!;
        return <li key={slug}><Link prefetch={false} href={`/json-errors/${slug}`}>{related.title}</Link></li>;
      })}
        <li><Link prefetch={false} href="/json-errors">All JSON error guides</Link></li>
        <li><Link prefetch={false} href="/resources/json-reference">JSON syntax reference</Link></li>
        {guide.tools?.map(tool => <li key={tool.href}><Link prefetch={false} href={tool.href}>{tool.label}</Link></li>)}
      </ul>
      <h2 id="sources">Standards and diagnostic sources</h2>
      <p><a href={SOURCES.rfc}>RFC 8259</a> and <a href={SOURCES.ecma}>ECMA-404</a> define JSON syntax.
        Diagnostic wording belongs to the parser. The table links each cited message to its source.</p>
      <ul className="sources">
        {(hasRuntime('JavaScript') || hasRuntime('Firefox')) && <li><a href={SOURCES.mdn}>MDN JSON.parse error reference</a></li>}
        {hasRuntime('Python') && <li><a href={SOURCES.python}>Python json documentation and JSONDecodeError attributes</a></li>}
        {guide.http && <li><a href={SOURCES.fetch}>MDN fetch response handling</a></li>}
        {guide.http && <li><a href={SOURCES.requests}>Requests JSON response handling</a></li>}
        {(guide.http || guide.slug === 'extra-data') && <li><a href={SOURCES.goDocs}>Go encoding/json documentation</a></li>}
        {hasRuntime('Safari') && <li><a href={SOURCES.safariPrefix}>WebKit source for the JSON Parse error prefix</a></li>}
        {guide.docs?.map(doc => <li key={doc.href}><a href={doc.href}>{doc.label}</a></li>)}
      </ul>
    </ArticleFrame>
  );
}
