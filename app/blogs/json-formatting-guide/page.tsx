import Link from 'next/link';
import { Article, Code, postMetadata } from '../article';
import { getPost } from '../posts';

const post = getPost('json-formatting-guide');

export const metadata = postMetadata(post);

export default function JsonFormattingGuidePage() {
  return (
    <Article
      post={post}
      lede="Readable JSON is easier to review, debug and share. Validation comes first, because a formatter cannot reliably interpret a document that is not valid JSON."
    >
      <h2 id="valid-json">What valid JSON looks like</h2>
      <p>
        JSON has a small set of rules. An object uses double-quoted keys, a colon between each key and value, and commas between
        members. Arrays use square brackets. Strings use double quotes. The values can be strings, numbers, booleans, null, objects or
        arrays.
      </p>
      <Code>{`{
  "name": "Ada",
  "active": true,
  "roles": ["admin", "reviewer"]
}`}</Code>
      <p>
        Single quotes, comments, trailing commas and unquoted keys are common in JavaScript, but they are not part of standard JSON. A
        strict parser reports them as errors. If you received a loose JSON-like file, Tool Kumar can identify common mistakes and offer a
        repair action while keeping the original input available.
      </p>

      <h2 id="find-syntax-errors">How to find a JSON syntax error</h2>
      <ol>
        <li>
          Paste the document into the <Link href="/">Tool Kumar JSON viewer</Link>.
        </li>
        <li>Read the error line and column shown below the input.</li>
        <li>Check the character before the reported position. The missing comma or quote often appears immediately before it.</li>
        <li>Format the document again after the fix. Reformatting makes the next error easier to see.</li>
      </ol>
      <p>
        Error positions point to where the parser stopped. That is not always where the mistake began. In this document the comma is
        missing at the end of line 2, but the parser reports line 3, because the next key is where it can no longer continue:
      </p>
      <Code error={3}>{`{
  "name": "Ada"
  "active": true
}`}</Code>
      <aside className="note">
        <p>
          <strong>Tip:</strong> when an error position looks wrong, read backwards from it. Missing commas, quotes and closing brackets
          are usually reported at the token that follows them.
        </p>
      </aside>

      <h2 id="format-json">Format JSON for people and programs</h2>
      <p>
        Use pretty-printed JSON when someone needs to inspect or review a file. Keep indentation consistent, put one member on each line
        and preserve meaningful key order. Use minified JSON for a transport step when size matters and whitespace has no value.
      </p>
      <p>
        Formatting does not change the data. It only changes whitespace. A good JSON formatter should also preserve large numbers, report
        invalid syntax clearly and avoid sending private documents to a remote service. Tool Kumar formats and validates JSON in your
        browser, so the input stays on your device.
      </p>

      <h2 id="common-errors">Common JSON errors and how to fix them</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Mistake</th>
              <th scope="col">Example</th>
              <th scope="col">Fix</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Trailing comma</th>
              <td>
                <code>[1, 2,]</code>
              </td>
              <td>Remove the comma after the last object member or array item.</td>
            </tr>
            <tr>
              <th scope="row">Single quotes</th>
              <td>
                <code>{`{'id': 1}`}</code>
              </td>
              <td>Use double quotes for strings and escape any inner double quotes.</td>
            </tr>
            <tr>
              <th scope="row">Unquoted key</th>
              <td>
                <code>{`{id: 1}`}</code>
              </td>
              <td>
                Write object keys as strings, such as <code>&quot;id&quot;</code>.
              </td>
            </tr>
            <tr>
              <th scope="row">Missing value</th>
              <td>
                <code>{`{"id": }`}</code>
              </td>
              <td>Give every key a value after its colon.</td>
            </tr>
            <tr>
              <th scope="row">Unclosed object or array</th>
              <td>
                <code>{`{"ids": [1, 2}`}</code>
              </td>
              <td>Match every opening brace or bracket with a closing one.</td>
            </tr>
            <tr>
              <th scope="row">Invalid number</th>
              <td>
                <code>NaN</code>, <code>Infinity</code>, <code>012</code>
              </td>
              <td>JSON has no special numbers or leading zeroes. Use a plain number, a string or null.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Every one of these can be checked in the <Link href="/">free JSON viewer and formatter</Link>: it points to the line and column
        of the first error and offers to repair the common ones for you.
      </p>
      <p>
        For the exact syntax rules, see the <Link href="/resources/json-reference">JSON reference</Link>. If you need a file for a test or
        tutorial, start with our <Link href="/resources/json-examples">downloadable JSON examples</Link>.
      </p>
    </Article>
  );
}
