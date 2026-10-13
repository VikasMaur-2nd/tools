import Link from 'next/link';

export default function SeoContent() {
  return (
    <section className="sr-only" aria-labelledby="seo-content-title">
      <h2 id="seo-content-title">Free JSON viewer and formatter</h2>
      <p>
        Tool Kumar is a free online JSON viewer, formatter and validator. Paste JSON or open a local file to format it, check
        syntax, repair common mistakes and inspect the result in a readable tree or table.
      </p>
      <h2>JSON tools that run in your browser</h2>
      <ul>
        <li>Format and beautify JSON with readable indentation.</li>
        <li>Validate JSON and jump to the exact line and column with an error.</li>
        <li>Repair comments, trailing commas, single quotes and other common input mistakes.</li>
        <li>Minify JSON, sort keys and copy a clean result.</li>
        <li>Explore nested objects in a collapsible tree or table view.</li>
        <li>Search keys and values, copy JSON paths, compare documents and convert JSON to other formats.</li>
      </ul>
      <h2>How to use the JSON viewer</h2>
      <ol>
        <li>Paste JSON into the input pane or choose a JSON file from your device.</li>
        <li>Read the formatted output, expand the tree or switch to the table view.</li>
        <li>Fix any reported syntax error, then copy or download the result.</li>
      </ol>
      <h2>Private by default</h2>
      <p>
        Your JSON stays in this browser. Tool Kumar does not upload documents to a server, require an account or place ads in
        the editor. The app can continue working offline after it loads.
      </p>
      <h2>JSON viewer questions</h2>
      <dl>
        <dt>What is a JSON viewer?</dt>
        <dd>A JSON viewer displays structured JSON in a readable format, often with a collapsible tree, search and validation.</dd>
        <dt>How do I format JSON online?</dt>
        <dd>Paste your JSON into Tool Kumar. The formatter creates an indented view, while the validator reports syntax errors.</dd>
        <dt>Is this JSON viewer private?</dt>
        <dd>Yes. Parsing and formatting happen in your browser, so your document does not need to leave your device.</dd>
        <dt>Can I validate a large JSON file?</dt>
        <dd>Yes. The viewer is designed for large documents and keeps the input local while it parses the file.</dd>
      </dl>
      <p>
        Learn more in the <Link href="/blogs">Tool Kumar JSON blog</Link>, including a practical guide to formatting and validating JSON and
        the <Link href="/blogs/origin-of-json">origin story of JSON</Link>.
      </p>
    </section>
  );
}
