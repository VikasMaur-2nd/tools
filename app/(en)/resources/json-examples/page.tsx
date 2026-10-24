import Link from 'next/link';
import { PAGE_DATES } from '../../dates';
import { Code, ResourceArticle, resourceMetadata } from '../resource';

const TITLE = 'JSON examples for APIs, configuration and tests';
const DESCRIPTION =
  'Copyable, valid JSON examples for API responses, application configuration and nested data. Download the files or inspect them in the private browser viewer.';
const PATH = '/resources/json-examples';

export const metadata = resourceMetadata({ title: TITLE, description: DESCRIPTION, path: PATH, ...PAGE_DATES[PATH] });

export default function JsonExamplesPage() {
  return (
    <ResourceArticle
      title={TITLE}
      lede={DESCRIPTION}
      path={PATH}
      keywords={['JSON examples', 'JSON API response example', 'JSON config example', 'sample JSON', 'download JSON']}
      toc={[
        { id: 'api-response', label: 'API response' },
        { id: 'configuration', label: 'Application configuration' },
        { id: 'nested-data', label: 'Nested and tabular data' },
        { id: 'use-examples', label: 'Use these files' },
      ]}
    >
      <p>
        These examples are small enough to read in a tutorial and realistic enough to use in a test, mock response or code review. They
        use fictional data. Every downloadable file is valid JSON and can be opened in the <Link href="/">Tool Kumar viewer</Link>.
      </p>

      <h2 id="api-response">API response</h2>
      <p>
        A paginated response often combines a list with metadata. Keeping the items in an array gives clients a stable place to iterate,
        while the page object records how to request the next result.
      </p>
      <Code>{`{
  "data": [
    {"id": "usr_1042", "name": "Asha Rao", "role": "editor"},
    {"id": "usr_1043", "name": "Noah Chen", "role": "reviewer"}
  ],
  "page": {
    "number": 1,
    "size": 2,
    "total": 2,
    "next": null
  }
}`}</Code>
      <p><a href="/examples/api-response.json" download>Download api-response.json</a></p>

      <h2 id="configuration">Application configuration</h2>
      <p>
        Configuration documents work well when each setting has one clear type. Keep secrets out of files that will be committed or
        shared. Use environment variables or a secret store for credentials.
      </p>
      <Code>{`{
  "app": {
    "name": "Canvas",
    "port": 8080,
    "debug": false
  },
  "features": {
    "comments": true,
    "uploads": false
  },
  "allowedOrigins": ["https://example.com"]
}`}</Code>
      <p><a href="/examples/app-config.json" download>Download app-config.json</a></p>

      <h2 id="nested-data">Nested and tabular data</h2>
      <p>
        JSON can represent nested objects and arrays without flattening them into column names. This shape is useful for testing tree
        viewers, table conversion and code generators.
      </p>
      <Code>{`{
  "orderId": "ord_7021",
  "customer": {"name": "Mina Patel", "country": "IN"},
  "lines": [
    {"sku": "notebook-a5", "quantity": 2, "price": 6.5},
    {"sku": "pen-blue", "quantity": 3, "price": 1.25}
  ],
  "paid": true
}`}</Code>
      <p><a href="/examples/nested-order.json" download>Download nested-order.json</a></p>

      <h2 id="use-examples">Use these files</h2>
      <p>
        The downloadable fixture files are dedicated to the public domain under <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>. Copy, adapt and include them in documentation or tests without asking for permission.
      </p>
      <ul>
        <li>Paste an example into the <Link href="/">JSON viewer</Link> to format it, search it or switch to a table view.</li>
        <li>Use the downloads as fixtures in parser tests, documentation snippets or API mock responses.</li>
        <li>Link to this page when a reader needs a short, valid document that demonstrates a real data shape.</li>
      </ul>
      <aside className="note">
        <p><strong>Privacy reminder:</strong> the examples contain fictional values. Treat real customer data as sensitive and check your destination before uploading it to any service.</p>
      </aside>
    </ResourceArticle>
  );
}
