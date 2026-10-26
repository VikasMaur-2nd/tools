import Link from 'next/link';
import { PAGE_DATES } from '../../dates';
import { Code, ResourceArticle, resourceMetadata } from '../resource';

const TITLE = 'JSON syntax reference: values, strings, numbers and objects';
const DESCRIPTION =
  'A practical JSON syntax reference based on RFC 8259 and ECMA-404. Learn the value types, string escapes, number rules and common invalid forms.';
const PATH = '/resources/json-reference';

export const metadata = resourceMetadata({ title: TITLE, description: DESCRIPTION, path: PATH, ...PAGE_DATES[PATH] });

export default function JsonReferencePage() {
  return (
    <ResourceArticle
      title={TITLE}
      lede={DESCRIPTION}
      path={PATH}
      keywords={['JSON syntax', 'JSON reference', 'JSON data types', 'RFC 8259', 'ECMA-404', 'valid JSON']}
      toc={[
        { id: 'value-types', label: 'The six JSON value types' },
        { id: 'objects-arrays', label: 'Objects and arrays' },
        { id: 'strings', label: 'Strings and escapes' },
        { id: 'numbers', label: 'Numbers' },
        { id: 'common-mistakes', label: 'Common invalid forms' },
        { id: 'sources', label: 'Standards and sources' },
      ]}
    >
      <p>
        JSON is a text format for serialized data. It is small enough to read by hand and strict enough for programs to parse the same
        document in many languages. This page follows the syntax in <a href="https://www.rfc-editor.org/rfc/rfc8259">RFC 8259</a> and
        <a href="https://ecma-international.org/publications-and-standards/standards/ecma-404/"> ECMA-404</a>.
      </p>

      <h2 id="value-types">The six JSON value types</h2>
      <p>
        A JSON value is an object, array, string, number, <code>true</code>, <code>false</code> or <code>null</code>. A JSON text can
        contain any one of these values, although API responses commonly use an object or an array at the top level.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Type</th><th scope="col">Example</th><th scope="col">Notes</th></tr></thead>
          <tbody>
            <tr><th scope="row">Object</th><td><code>{'{"id": 42}'}</code></td><td>Unordered name/value pairs inside curly braces.</td></tr>
            <tr><th scope="row">Array</th><td><code>[1, 2, 3]</code></td><td>Ordered values inside square brackets.</td></tr>
            <tr><th scope="row">String</th><td><code>&quot;hello&quot;</code></td><td>Unicode text enclosed by double quotes.</td></tr>
            <tr><th scope="row">Number</th><td><code>-12.5e2</code></td><td>Decimal notation with an optional fraction and exponent.</td></tr>
            <tr><th scope="row">Boolean</th><td><code>true</code></td><td>Lowercase <code>true</code> or <code>false</code>.</td></tr>
            <tr><th scope="row">Null</th><td><code>null</code></td><td>The lowercase literal <code>null</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <Code>{`{
  "name": "Ada Lovelace",
  "active": true,
  "roles": ["author", "mathematician"],
  "address": null
}`}</Code>

      <h2 id="objects-arrays">Objects and arrays</h2>
      <p>
        An object starts with <code>{'{'}</code> and ends with <code>{'}'}</code>. Each member has a double-quoted name, a colon and a
        value. Separate members with commas. An array starts with <code>[</code> and ends with <code>]</code>; separate its values with
        commas.
      </p>
      <Code>{`{
  "users": [
    {"id": 1, "name": "Asha"},
    {"id": 2, "name": "Noah"}
  ]
}`}</Code>
      <p>
        Names in an object SHOULD be unique. When a document repeats a name, parsers disagree about whether the first value, last value
        or every value wins. If you need predictable behavior, remove duplicates before shipping the document. Tool Kumar keeps duplicate
        keys visible and flags them while you inspect the file.
      </p>

      <h2 id="strings">Strings and escapes</h2>
      <p>
        Strings use double quotes. A quote, backslash or control character must be escaped. The short escapes are <code>{'\\"'}</code>,
        <code>\\</code>, <code>\/</code>, <code>\b</code>, <code>\f</code>, <code>\n</code>, <code>\r</code> and <code>\t</code>.
        A Unicode escape uses exactly four hexadecimal digits, such as <code>\u00e9</code> for <code>é</code>.
      </p>
      <Code>{`{
  "quote": "She said \\\"hello\\\".",
  "path": "C:\\\\work\\\\data.json",
  "lineBreak": "first line\\nsecond line",
  "accent": "\\u00e9"
}`}</Code>
      <p>
        JSON strings can contain Unicode characters directly. Escape a character when the receiving system requires it or when an escaped
        form makes the document easier to transport. Do not use single quotes around JSON strings.
      </p>

      <h2 id="numbers">Numbers</h2>
      <p>
        A JSON number may have a minus sign, an integer, an optional fraction and an optional exponent. The integer cannot have a
        leading zero unless it is exactly zero. JSON has no <code>NaN</code>, <code>Infinity</code> or hexadecimal number literal.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Valid</th><th scope="col">Invalid</th><th scope="col">Why</th></tr></thead>
          <tbody>
            <tr><td><code>0</code>, <code>-7</code></td><td><code>+7</code></td><td>A plus sign is not allowed at the start.</td></tr>
            <tr><td><code>12.5</code></td><td><code>12.</code></td><td>A fraction needs at least one digit after the dot.</td></tr>
            <tr><td><code>6.02e23</code></td><td><code>6e</code></td><td>An exponent needs digits, with an optional sign.</td></tr>
            <tr><td><code>0.25</code></td><td><code>025</code></td><td>Nonzero integers cannot start with a zero.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        JSON itself does not set a precision limit. A programming language may round large numbers when it loads them into a native
        number type. Keep identifiers and exact decimal values as strings when the consumer cannot preserve their digits.
      </p>

      <h2 id="common-mistakes">Common invalid forms</h2>
      <p>
        JavaScript object literals look similar to JSON, but they allow syntax that JSON does not. Comments, trailing commas, single
        quotes, unquoted names, <code>undefined</code>, <code>NaN</code> and functions belong to JavaScript, not standard JSON.
      </p>
      <Code>{`// invalid JSON: comments are not part of the format
{
  name: 'Ada',
  "roles": ["author",],
}`}</Code>
      <p>
        The <Link href="/">Tool Kumar JSON viewer</Link> reports the first error with its line and column. It can also offer repairs for
        common JSON-like input while leaving the original text available for review. Read the <Link href="/blogs/json-formatting-guide">formatting and validation guide</Link> for a step-by-step workflow.
      </p>

      <h2 id="sources">Standards and sources</h2>
      <p>
        Use the standards when a parser, API contract or data exchange needs a precise definition. The examples on this page are original
        educational examples and do not contain user data.
      </p>
      <ul className="sources">
        <li><a href="https://www.rfc-editor.org/rfc/rfc8259">RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format</a></li>
        <li><a href="https://ecma-international.org/publications-and-standards/standards/ecma-404/">ECMA-404: The JSON Data Interchange Syntax</a></li>
        <li><a href="https://www.json.org/json-en.html">JSON.org syntax diagram and overview</a></li>
        <li><a href="https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/JSON">MDN: Working with JSON</a></li>
      </ul>
    </ResourceArticle>
  );
}
