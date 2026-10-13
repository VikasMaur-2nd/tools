import Link from 'next/link';
import { Article, Code, postMetadata } from '../article';
import { getPost } from '../posts';

const post = getPost('origin-of-json');

export const metadata = postMetadata(post);

const TIMELINE = [
  ['Late 1990s', 'Richer browser applications create demand for compact structured messages.'],
  ['Around 2000', 'Browser and server work at State Software uses a JSON-like notation based on JavaScript literals.'],
  ['Early 2000s', 'JSON.org gives JavaScript Object Notation a public name and description.'],
  ['2006', 'RFC 4627 documents JSON and registers its media type.'],
  ['2013', 'ECMA-404 publishes a language-independent JSON syntax standard.'],
  ['2014–2017', 'RFC 7159, RFC 8259 and ISO/IEC 21778 clarify the format and its interoperability rules.'],
  ['Today', 'JSON is a common interchange format for APIs, configuration, logs and data tools.'],
] as const;

const SOURCES = [
  ['https://www.json.org/json-en.html', 'JSON.org: Introducing JSON'],
  ['https://www.crockford.com/json.html', 'Douglas Crockford: JSON'],
  ['https://www.rfc-editor.org/rfc/rfc4627', 'RFC 4627: The application/json Media Type for JavaScript Object Notation'],
  ['https://www.rfc-editor.org/rfc/rfc8259', 'RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format'],
  ['https://ecma-international.org/publications-and-standards/standards/ecma-404/', 'ECMA-404: The JSON Data Interchange Syntax'],
] as const;

export default function OriginOfJsonPage() {
  return (
    <Article
      post={post}
      lede="JSON did not begin as a grand standard. It began as a practical answer to a small question: how can a browser and a server pass a structured message to each other without bringing an entire programming language along for the ride?"
    >
      <h2 id="before-json">Before JSON, the web was learning to speak</h2>
      <p>
        In the late 1990s, web pages were becoming less like printed documents and more like applications. A page could ask a server for
        new data, update one part of the screen and keep the rest of the page in place. The browser and server needed a shared way to
        describe records, lists and small values.
      </p>
      <p>
        XML was a serious answer. It could describe nested data, carried a large ecosystem of tools and was already familiar to many
        enterprise teams. It also asked a small browser message to carry opening tags, closing tags and a lot of punctuation. Developers
        wanted the structure, but often wanted to write less of it.
      </p>

      <h2 id="javascript-literals">The clue was already inside JavaScript</h2>
      <p>JavaScript had a compact way to write an object or an array. A developer could describe a person like this:</p>
      <Code>{`{
  "name": "Ada",
  "roles": ["engineer", "writer"]
}`}</Code>
      <p>
        In a JavaScript program, that text could be an object literal. The same shape also worked well as plain data. It was easy for a
        browser to read, easy for a human to inspect and small enough to send over a connection. The important step was to treat the
        shape as a data notation rather than as JavaScript that a browser should execute.
      </p>
      <p>
        That distinction explains many of JSON&apos;s rules. JSON uses double-quoted strings, a small set of value types and no functions.
        Comments, variables and expressions belong to a programming language. They do not belong in a portable data document.
      </p>

      <h2 id="douglas-crockford">Douglas Crockford gives the idea a name</h2>
      <p>
        Around 2000, Douglas Crockford and colleagues at State Software were working on browser and server messaging. They used a
        notation based on JavaScript object and array literals because it fit the job. The notation was not invented from nothing. Its
        punctuation had been part of JavaScript for years. The work was to recognize the useful subset, describe it clearly and give it a
        name people could share.
      </p>
      <p>
        That name was JavaScript Object Notation, or JSON. JSON.org gave the format a public home in the early 2000s. The name pointed to
        its family resemblance to JavaScript while the format itself remained deliberately smaller than JavaScript. A JSON document could
        travel between languages without asking the receiving system to understand JavaScript code.
      </p>

      <h2 id="small-on-purpose">The first JSON was small on purpose</h2>
      <p>
        JSON describes six kinds of value: objects, arrays, strings, numbers, booleans and null. An object maps string names to values. An
        array keeps an ordered list of values. That is enough to represent most messages exchanged by a web application, and the rules
        are short enough to remember.
      </p>
      <p>
        The small grammar also set a boundary. JSON numbers do not define a universal precision model, so languages must decide how to
        store very large or very exact numbers. JSON objects do not promise a meaningful order for their members. A parser may preserve
        the written order, but programs should not use that order as a hidden instruction.
      </p>

      <h2 id="ajax">Browsers turn a notation into a web habit</h2>
      <p>
        As XMLHttpRequest-style applications spread, JSON became a convenient payload for requests and responses. The pattern became
        familiar: the browser sent a small request, the server returned an object or array, and JavaScript used the result to update the
        page. The industry later gave this family of techniques a memorable name, Ajax.
      </p>
      <p>
        JSON won space in that moment because it matched the browser&apos;s native vocabulary. It was shorter than many XML messages, fit
        naturally into JavaScript code and still had enough structure for other languages to parse. It was a useful compromise between
        human readability and machine processing.
      </p>

      <h2 id="standards">From a shared convention to a written standard</h2>
      <p>
        For a while, JSON was mostly a convention described by its community. That changed when the format was written down in formal
        standards. RFC 4627, published in 2006, documented JSON and registered <code>application/json</code> as its media type. It
        described a top-level object or array as the complete JSON text.
      </p>
      <p>
        ECMA-404 followed in 2013 with a language-independent description of the JSON syntax. The IETF later published RFC 7159 in 2014
        and RFC 8259 in 2017. Those revisions clarified interoperability details and allowed any JSON value at the top level, so a
        standalone string, number, boolean or null could also be a JSON text. ISO/IEC 21778:2017 aligned with the same core format.
      </p>

      <h2 id="beyond-javascript">A format that left its first language behind</h2>
      <p>
        JSON&apos;s name kept the memory of JavaScript, but its audience became much larger. Python, Java, Ruby, Go, C#, PHP, Rust and many
        other languages gained JSON parsers and serializers. APIs adopted it because a client could be written in almost any language and
        still exchange the same basic structures.
      </p>
      <blockquote className="pull">
        <p>JSON looks like JavaScript, but it is not JavaScript.</p>
      </blockquote>
      <p>
        That is the quiet twist in the story. A JSON document cannot contain a function, a comment or an undefined value. A valid JSON
        document is data that a program can choose to turn into a native object, record or map. Keeping that boundary clear is what let
        JSON cross language borders.
      </p>

      <h2 id="rules">The rules that still matter today</h2>
      <ul>
        <li>Object keys and strings use double quotes.</li>
        <li>Values are separated with commas, with no trailing comma after the last member or item.</li>
        <li>
          JSON spells the special values <code>true</code>, <code>false</code> and <code>null</code> in lowercase.
        </li>
        <li>Whitespace can change the shape on screen, but it does not change the data.</li>
        <li>
          Comments, <code>NaN</code>, <code>Infinity</code> and unquoted keys are outside standard JSON.
        </li>
        <li>Different languages may handle number precision differently, especially for very large integers.</li>
      </ul>

      <h2 id="why-it-matters">Why the origin story is useful</h2>
      <p>
        Knowing where JSON came from makes its design easier to read. The format is small because it was meant to carry messages, not
        behave like a full programming language. It resembles JavaScript because the browser was its first natural home, then it became
        independent enough to serve every language around it.
      </p>
      <p>
        When a document fails validation, the error is usually a broken part of that small contract: a missing comma, a quote in the wrong
        place or a value JSON never defined. The <Link href="/">Tool Kumar JSON viewer</Link> shows the line and column where the parser
        stops, formats valid input and can repair several common JSON-like mistakes while keeping the work in your browser.
      </p>

      <h2 id="timeline">A short timeline</h2>
      <ol className="timeline">
        {TIMELINE.map(([when, what]) => (
          <li key={when}>
            <strong>{when}</strong>
            <span>{what}</span>
          </li>
        ))}
      </ol>

      <h2 id="sources">Sources and further reading</h2>
      <ul className="sources">
        {SOURCES.map(([href, label]) => (
          <li key={href}>
            <a href={href} rel="noreferrer">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </Article>
  );
}
