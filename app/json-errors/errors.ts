/** Server-only editorial data. Diagnostics are tied to an input and a runtime/source. */
export type ErrorGuide = {
  slug: string;
  title: string;
  description: string;
  meaning: string;
  queries: string[];
  messages: { runtime: string; text: string; input: string; source?: string; evidence: string }[];
  causes: { title: string; text: string; code: string; lang: string }[];
  steps: string[];
  fixes: { title: string; text: string; code: string; lang: string }[];
  faq: { question: string; answer: string }[];
  related: string[];
  http?: boolean;
};

export const SOURCES = {
  mdn: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse',
  oldV8: 'https://github.com/v8/v8/blob/8.0.426/src/common/message-template.h',
  python: 'https://docs.python.org/3/library/json.html',
  python313: 'https://github.com/python/cpython/blob/v3.13.0/Lib/json/decoder.py',
  python312: 'https://github.com/python/cpython/blob/v3.12.0/Lib/json/decoder.py',
  go: 'https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go',
  goDocs: 'https://pkg.go.dev/encoding/json',
  safari: 'https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/LiteralParser.cpp',
  safariPrefix: 'https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/LiteralParser.h',
  jackson: 'https://github.com/FasterXML/jackson-core/blob/2.18/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java',
  dotnet: 'https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx',
  php: 'https://github.com/php/php-src/blob/PHP-8.4/ext/json/json.c',
  fetch: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
  requests: 'https://requests.readthedocs.io/en/latest/user/quickstart/#json-response-content',
  rfc: 'https://www.rfc-editor.org/rfc/rfc8259',
  ecma: 'https://ecma-international.org/publications-and-standards/standards/ecma-404/',
};
const node = 'Reproduced in Node.js 24.21.0';
const python = 'Reproduced in Python 3.14.4';

export const ERROR_GUIDES: ErrorGuide[] = [
  {
    slug: 'unexpected-token-html',
    title: "Unexpected token '<' / DOCTYPE is not valid JSON",
    description: 'Fix JSON parsing failures caused by HTML responses. Inspect the response status, content type and body before parsing in JavaScript, Python or Go.',
    queries: ['unexpected token < in json at position 0', 'doctype is not valid json', 'unexpected token < json fetch'],
    meaning: 'The JSON parser received a body that starts with HTML, often a DOCTYPE declaration or an HTML tag. The parser stops at the first < because that character cannot begin a JSON value. The response may be a login page, a missing-route page or a proxy error. A successful HTTP status alone does not prove that the body is JSON.',
    messages: [
      { runtime: 'JavaScript / V8', text: `SyntaxError: Unexpected token '<', "<!DOCTYPE html>" is not valid JSON`, input: 'JSON.parse("<!DOCTYPE html>")', evidence: node },
      { runtime: 'Older V8', text: 'Unexpected token < in JSON at position 0', input: 'HTML starting with <', source: SOURCES.oldV8, evidence: 'V8 8.0 message template, with token < and position 0 substituted' },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("<!DOCTYPE html>")', evidence: python },
      { runtime: 'Go / encoding/json', text: "invalid character '<' looking for beginning of value", input: 'json.Unmarshal([]byte("<!DOCTYPE html>"), &value)', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected character', input: 'Non-JSON character at the start', source: SOURCES.mdn, evidence: 'MDN diagnostic wording, location suffix omitted' },
      { runtime: 'C# / System.Text.Json', text: "'{0}' is an invalid start of a value.", input: 'Source template; {0} is the offending character', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
      { runtime: 'PHP / json_last_error_msg()', text: 'Syntax error', input: 'json_decode("<!DOCTYPE html>")', source: SOURCES.php, evidence: 'Official PHP 8.4 JSON_ERROR_SYNTAX message' },
    ],
    causes: [
      { title: 'The URL resolves to the application shell', text: 'A relative API URL can hit the frontend server. A catch-all route then returns index.html, sometimes with status 200. Verify the full request URL in the Network panel.', lang: 'javascript', code: `const body = '<!DOCTYPE html>'; // body returned by the wrong route\nJSON.parse(body);` },
      { title: 'Authentication redirects to a login page', text: 'Fetch normally follows redirects. An expired session can turn an API request into a final HTML login response. Check response.url and response.redirected, then fix the session or API authentication behavior.', lang: 'javascript', code: `const body = '<html><form>Sign in</form></html>';\nJSON.parse(body);` },
      { title: 'A server or proxy returns an HTML error', text: 'A missing endpoint, gateway failure or server exception can return an HTML error page. Fetch resolves for HTTP 404 and 500, so the caller must check response.ok.', lang: 'python', code: `import json\nbody = '<html><h1>502 Bad Gateway</h1></html>'\njson.loads(body)` },
    ],
    steps: [
      'Inspect the final request URL, redirects, HTTP status and Content-Type in the browser Network panel or client logs.',
      'Read the body as text once. Inspect a short preview in a local debugging session, with credentials and personal data removed.',
      'Correct the URL, authentication or server failure. Make the API return JSON for the response your client expects.',
      'Check status and media type before parsing. application/json and media types ending in +json are JSON types, but the body still has to contain valid JSON.',
    ],
    fixes: [],
    http: true,
    faq: [
      { question: 'Why does DOCTYPE appear in a JSON error?', answer: 'DOCTYPE starts an HTML document. Its appearance in a JSON error means the body passed to the parser contains HTML. Inspect the endpoint and response body before changing the JSON parser.' },
      { question: 'Can this happen with HTTP 200?', answer: 'Yes. A frontend fallback or login page can return HTML with status 200. Check both the status and Content-Type, then inspect the actual body.' },
      { question: 'Should I remove the < character?', answer: 'No. Removing the first character cannot turn an HTML page into the intended JSON response. Fix the request or server response.' },
      { question: 'Does Accept: application/json guarantee JSON?', answer: 'No. Accept expresses a client preference. The server can still return another media type, so check the response Content-Type and body.' },
    ],
    related: ['unexpected-end-of-json-input', 'go-invalid-character'],
  },
  {
    slug: 'unexpected-end-of-json-input',
    title: 'Unexpected end of JSON input: empty or truncated data',
    description: 'Find and fix empty responses and truncated JSON behind Unexpected end of JSON input, Python Expecting value at char 0 and Go EOF errors.',
    queries: ['unexpected end of json input how to fix', 'unexpected end of json input while parsing empty string', 'json.decoder.jsondecodeerror expecting value line 1 column 1 char 0'],
    meaning: 'The parser reached the end before it could read a complete JSON value. An empty string has no value at all. A truncated object, array or string starts a value but never finishes it. Python also reports Expecting value at char 0 for HTML and other invalid prefixes, so that message alone does not prove the input is empty.',
    messages: [
      { runtime: 'JavaScript / V8', text: 'SyntaxError: Unexpected end of JSON input', input: 'JSON.parse("") or JSON.parse(\'{"id":\')', evidence: node },
      { runtime: 'Python, empty input', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("")', evidence: python },
      { runtime: 'Python, unfinished value', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 7 (char 6)', input: 'json.loads(\'{"id":\')', evidence: python },
      { runtime: 'Go / json.Unmarshal', text: 'unexpected end of JSON input', input: 'Empty or incomplete JSON bytes', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'Go / Decoder.Decode', text: 'EOF', input: 'No next value in an empty reader', source: 'https://github.com/golang/go/blob/go1.26.0/src/encoding/json/stream.go', evidence: 'io.EOF return in the official Go source; incomplete tokens can produce unexpected EOF' },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected end of data', input: 'Incomplete JSON input', source: SOURCES.mdn, evidence: 'MDN diagnostic wording, location suffix omitted' },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Unexpected EOF', input: 'End token encountered where a value is required', source: SOURCES.safari, evidence: 'Official WebKit parser message; LiteralParser.h supplies the JSON Parse error prefix' },
      { runtime: 'C# / System.Text.Json', text: 'The input does not contain any JSON tokens. Expected the input to start with a valid JSON token, when isFinalBlock is true.', input: 'Empty input, source resource string', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
    ],
    causes: [
      { title: 'A response has no body', text: 'A 204 No Content response, a HEAD response or an empty file cannot be parsed as JSON. Handle a documented no-body result before calling the parser.', lang: 'javascript', code: `JSON.parse('');\n// Also fails: a whitespace-only body\nJSON.parse('   ');` },
      { title: 'A write or transfer ends before the value is complete', text: 'An interrupted file write or response can leave a key without its value or a container without its closing delimiter. Compare the actual bytes with what the producer intended to send.', lang: 'python', code: `import json\njson.loads('{"id":')` },
      { title: 'Code builds only part of the JSON text', text: 'String concatenation can omit a closing bracket, quote or brace. Serialize the completed data structure instead of assembling its JSON text by hand.', lang: 'javascript', code: `const text = '{"items":[' + '1,2';\nJSON.parse(text);` },
    ],
    steps: [
      'Inspect the raw text and its length. For HTTP input, inspect status and headers before parsing.',
      'Handle a documented 204 or HEAD response without parsing. Reject an empty body when the API contract requires JSON.',
      'For incomplete data, fix the producer, file write or transfer. Wait for the complete body; a network chunk is not necessarily one JSON document.',
      'Use a serializer to produce the complete value, then validate the saved or received text.',
    ],
    http: true,
    fixes: [
      { title: 'Serialize a complete value in JavaScript', text: 'Only treat missing content as an empty collection if the API contract explicitly defines that behavior. Otherwise report the missing body.', lang: 'javascript', code: `const text = JSON.stringify({ items: [1, 2] });\nconst data = JSON.parse(text);` },
      { title: 'Check a local Python input before loading it', text: 'An empty input is different from the valid JSON literal null. Report empty input instead of silently replacing it.', lang: 'python', code: `import json\ntext = ''  # replace with the file or response body\nif not text.strip():\n    raise ValueError('Expected JSON, received an empty body')\ndata = json.loads(text)` },
    ],
    faq: [
      { question: 'Is an empty string valid JSON?', answer: 'A body containing zero characters is invalid JSON. A body containing two double-quote characters is a valid JSON string with an empty value.' },
      { question: 'Should I parse a 204 response?', answer: 'No. HTTP 204 means No Content. Handle it as a no-body result according to your API contract.' },
      { question: 'Does Python Expecting value at char 0 always mean empty input?', answer: 'No. Python also reports it for an HTML response or another invalid first character. Inspect the raw text to tell the causes apart.' },
      { question: 'Can I fix truncation by adding a closing brace?', answer: 'Only if you know the complete intended data. A missing brace may be one symptom of lost values. Recover the complete file or response before changing it.' },
    ],
    related: ['unexpected-token-html', 'undefined-is-not-valid-json', 'extra-data'],
  },
  {
    slug: 'undefined-is-not-valid-json',
    title: '"undefined" or "[object Object]" is not valid JSON',
    description: 'Fix JSON.parse calls that receive undefined or an already-parsed object. Learn when to parse, when to stringify and how to guard missing storage values.',
    queries: ['undefined is not valid json', '[object Object] is not valid json', 'unexpected token u in json at position 0', 'unexpected token o in json at position 1'],
    meaning: 'JSON.parse expects JSON text and converts its argument to a string. undefined becomes the text undefined, and a plain object normally becomes [object Object]. Neither text is JSON. This usually means a value is missing or the caller tried to parse data that a library already decoded. Other primitive arguments can parse after coercion, but relying on coercion hides the input contract.',
    messages: [
      { runtime: 'JavaScript / V8, missing value', text: 'SyntaxError: "undefined" is not valid JSON', input: 'JSON.parse(undefined)', evidence: node },
      { runtime: 'JavaScript / V8, object value', text: 'SyntaxError: "[object Object]" is not valid JSON', input: 'JSON.parse({})', evidence: node },
      { runtime: 'Older V8', text: 'Unexpected token u in JSON at position 0', input: 'undefined converted to text', source: SOURCES.oldV8, evidence: 'V8 8.0 message template with u and 0 substituted' },
      { runtime: 'Older V8', text: 'Unexpected token o in JSON at position 1', input: 'A plain object converted to [object Object]', source: SOURCES.oldV8, evidence: 'V8 8.0 message template with o and 1 substituted' },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("undefined"), a string rather than a Python dict', evidence: python },
    ],
    causes: [
      { title: 'The expected property is absent', text: 'An absent property returns undefined. Check where the text should have been assigned, including asynchronous code and changed response shapes.', lang: 'javascript', code: `const response = {};\nJSON.parse(response.payload);` },
      { title: 'The response is already parsed', text: 'Response.json() returns the decoded JavaScript value. Use that value directly. Calling JSON.parse again converts an object to an unrelated string.', lang: 'javascript', code: `const data = { id: 1 }; // for example, await response.json()\nJSON.parse(data);` },
      { title: 'Storage contains the literal text undefined', text: 'setItem converts values to strings. Writing an undefined value stores invalid JSON. A missing localStorage key returns null, which is a separate case.', lang: 'javascript', code: `localStorage.setItem('settings', undefined);\nJSON.parse(localStorage.getItem('settings'));` },
    ],
    steps: [
      'Inspect typeof value and the value immediately before the failing parse call.',
      'If the value is already an object, use it directly. If your contract requires text, require a string and reject a missing value.',
      'Serialize objects with JSON.stringify when writing storage or sending JSON text. Validate that the value exists before storing it.',
      'Guard missing localStorage keys explicitly. Choose defaults based on your application, then parse only the stored text.',
    ],
    fixes: [
      { title: 'Parse text once and guard storage', text: 'The storage check distinguishes a missing key from an existing malformed entry. Handle malformed stored text explicitly in your application rather than silently discarding it.', lang: 'javascript', code: `const value = { theme: 'dark' };\nlocalStorage.setItem('settings', JSON.stringify(value));\nconst raw = localStorage.getItem('settings');\nconst settings = raw === null ? { theme: 'system' } : JSON.parse(raw);\n\nfunction parseJsonText(text) {\n  if (typeof text !== 'string') {\n    throw new TypeError('Expected JSON text');\n  }\n  return JSON.parse(text);\n}` },
      { title: 'Keep Python objects and JSON text separate', text: 'requests.Response.json() returns a decoded Python value. json.loads accepts JSON text, bytes or bytearray; use json.dumps to serialize a Python object.', lang: 'python', code: `import json\ndata = {"id": 1}\ntext = json.dumps(data)\nrestored = json.loads(text)\n# For an HTTP response: data = r.json()\n# Use data directly; do not call json.loads(data).` },
    ],
    faq: [
      { question: 'Is undefined a JSON value?', answer: 'No. JSON supports objects, arrays, strings, numbers, true, false and null. JavaScript undefined has no JSON literal.' },
      { question: 'Should I stringify an object and immediately parse it?', answer: 'If you already have the object and need to read it, use it directly. Stringify when a storage or transport boundary requires JSON text. A stringify-and-parse round trip can lose unsupported values and change types.' },
      { question: 'Does a missing localStorage key cause this error?', answer: 'A missing key returns null, and JSON.parse(null) returns null through string coercion. An entry containing the literal text undefined does cause this error. Check the actual stored value.' },
      { question: 'Why did JSON.stringify return undefined?', answer: 'JSON.stringify(undefined) returns JavaScript undefined rather than a JSON string. It also returns undefined for a top-level function or symbol. Check that your input is serializable before storing the result.' },
    ],
    related: ['unexpected-end-of-json-input', 'single-quotes-unquoted-keys'],
  },
  {
    slug: 'single-quotes-unquoted-keys',
    title: 'Expecting property name enclosed in double quotes',
    description: 'Fix single-quoted strings and unquoted keys in JSON. Compare exact Python and JavaScript errors and serialize objects without unsafe quote replacement.',
    queries: ['expecting property name enclosed in double quotes', 'expecting property name enclosed in double quotes line 1 column 2 char 1', "unexpected token ' in json"],
    meaning: 'Every JSON object property name must be a string enclosed in double quotes. String values also need double quotes. A JavaScript object literal or Python dictionary display can use syntax that looks like JSON but is not JSON text. The reported position is where the parser expected a quoted property name; a trailing comma can also produce a property-name error.',
    messages: [
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)', input: `json.loads("{'id':1}") or json.loads('{id:1}')`, evidence: python },
      { runtime: 'JavaScript / V8', text: "SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)", input: `JSON.parse("{'id':1}") or JSON.parse('{id:1}')`, evidence: node },
      { runtime: 'Firefox', text: "SyntaxError: JSON.parse: expected property name or '}'", input: `JSON.parse("{'foo': 1}")`, source: SOURCES.mdn, evidence: 'Exact example in MDN; location suffix omitted' },
      { runtime: 'Java / Jackson', text: 'was expecting double-quote to start field name', input: 'Unquoted key with default parser settings', source: SOURCES.jackson, evidence: 'Exact diagnostic fragment from Jackson 2.18 source; exception prefix and location vary' },
      { runtime: 'C# / System.Text.Json', text: `'{0}' is an invalid start of a property name. Expected a '"'.`, input: 'Source template; {0} is the offending character', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
    ],
    causes: [
      { title: 'A Python dictionary was converted with str', text: 'str(dict) produces Python syntax. Use json.dumps to produce JSON, including the correct quoting and boolean/null literals.', lang: 'python', code: `import json\ntext = str({'id': 1})\njson.loads(text)` },
      { title: 'A JavaScript object literal was copied as text', text: 'JavaScript permits unquoted identifier keys and single-quoted strings. JSON permits neither. JSON.stringify writes the correct JSON form.', lang: 'javascript', code: `JSON.parse("{id: 'Ada'}");` },
      { title: 'A configuration file uses a different format', text: 'A file written with single-quoted keys may be intended for a permissive configuration parser. Confirm its format before feeding it to a strict JSON parser.', lang: 'json', code: `{'name': 'Ada', 'active': true}` },
    ],
    steps: [
      'Read the reported property name and the character before it. If the preceding comma is directly before }, check the trailing-comma guide.',
      'Use double quotes for every key and string value when editing a small JSON document.',
      'Fix the producer with JSON.stringify in JavaScript or json.dumps in Python.',
      'Validate the complete result. Avoid replacing every apostrophe with a quote because apostrophes can belong inside string values.',
    ],
    fixes: [
      { title: 'Serialize the JavaScript object', text: 'Single quotes can delimit a JavaScript source string. The resulting JSON text still needs double quotes around JSON keys and string values.', lang: 'javascript', code: `const text = JSON.stringify({ name: "O'Connor", active: true });\nconst data = JSON.parse(text);\n// text is {"name":"O'Connor","active":true}` },
      { title: 'Serialize the Python dictionary', text: 'json.dumps preserves apostrophes inside values and converts Python True and None to the corresponding JSON literals.', lang: 'python', code: `import json\ntext = json.dumps({"name": "O'Connor", "active": True, "note": None})\ndata = json.loads(text)` },
    ],
    faq: [
      { question: 'Can JSON use single quotes?', answer: 'No. JSON keys and string values use double quotes. An apostrophe is allowed as ordinary content inside a double-quoted JSON string.' },
      { question: 'Why is a valid JavaScript object invalid JSON?', answer: 'JavaScript object literal syntax permits unquoted keys and single quotes. JSON is a separate text format with stricter syntax. Serialize the object with JSON.stringify.' },
      { question: 'Should I replace every single quote with a double quote?', answer: 'No. That can damage names, apostrophes and escaped content inside values. Serialize the source object or correct the syntax with knowledge of the document.' },
      { question: 'Can a trailing comma cause the same error?', answer: 'Yes. After a comma in an object, the parser expects another quoted property name. If the next character is the closing brace, remove the trailing comma.' },
    ],
    related: ['trailing-comma', 'undefined-is-not-valid-json', 'bad-control-character'],
  },
  {
    slug: 'trailing-comma',
    title: 'JSON trailing comma errors in objects and arrays',
    description: 'Remove trailing commas that strict JSON parsers reject. See version-specific JavaScript, Python and .NET messages and generate valid JSON with serializers.',
    queries: ['json trailing comma', 'json trailing comma allowed', 'json trailing comma error', 'python json trailing comma'],
    meaning: 'A comma separates two members of an object or two elements of an array. A comma directly before the closing brace or bracket leaves the next member or element missing. Standard JSON disallows it even though JavaScript and some configuration formats accept it. Different parsers can report a missing property name or an unexpected closing bracket.',
    messages: [
      { runtime: 'JavaScript / V8, array', text: `SyntaxError: Unexpected token ']', "[1,]" is not valid JSON`, input: 'JSON.parse("[1,]")', evidence: node },
      { runtime: 'JavaScript / V8, object', text: 'SyntaxError: Expected double-quoted property name in JSON at position 8 (line 1 column 9)', input: 'JSON.parse(\'{"id":1,}\')', evidence: node },
      { runtime: 'Python 3.13+, array', text: 'json.decoder.JSONDecodeError: Illegal trailing comma before end of array: line 1 column 3 (char 2)', input: 'json.loads("[1,]")', source: SOURCES.python313, evidence: 'Reproduced in Python 3.14.4; explicit diagnostic added in official CPython 3.13.0 source' },
      { runtime: 'Python 3.13+, object', text: 'json.decoder.JSONDecodeError: Illegal trailing comma before end of object: line 1 column 8 (char 7)', input: 'json.loads(\'{"id":1,}\')', source: SOURCES.python313, evidence: 'Reproduced in Python 3.14.4; explicit diagnostic added in official CPython 3.13.0 source' },
      { runtime: 'Python 3.12 and earlier, object', text: 'Expecting property name enclosed in double quotes', input: 'Trailing comma before }', source: SOURCES.python312, evidence: 'Official CPython 3.12.0 diagnostic text; location depends on input' },
      { runtime: 'Python 3.12 and earlier, array', text: 'Expecting value', input: 'Trailing comma before ]', source: SOURCES.python312, evidence: 'Official CPython 3.12.0 diagnostic text; location depends on input' },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected character', input: 'Trailing-comma examples in MDN', source: SOURCES.mdn, evidence: 'MDN example wording, location suffix omitted' },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Unexpected comma at the end of array expression', input: 'Trailing comma in an array', source: SOURCES.safari, evidence: 'Official WebKit parser message and LiteralParser.h prefix' },
      { runtime: 'C# / System.Text.Json', text: 'The JSON array contains a trailing comma at the end which is not supported in this mode. Change the reader options.', input: 'Array with a trailing comma, default strict mode', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
    ],
    causes: [
      { title: 'A JavaScript array was pasted into a JSON file', text: 'The final comma in a JavaScript array literal can be convenient for editing, but it must be absent in JSON text.', lang: 'javascript', code: `JSON.parse('[1,2,]');` },
      { title: 'An object member was deleted without removing its comma', text: 'After removing the last property, inspect the property now at the end of the object.', lang: 'python', code: `import json\njson.loads('{"id":1,}')` },
      { title: 'A template adds a comma after every item', text: 'A loop that appends a comma to each value leaves one extra comma at the end. Build the array and serialize it instead.', lang: 'javascript', code: `const text = '[' + [1, 2].map(n => n + ',').join('') + ']';\nJSON.parse(text);` },
    ],
    steps: [
      'Find the closing } or ] near the reported position. Check whether its previous non-whitespace character is a comma.',
      'Remove that separator while leaving commas between members or elements intact.',
      'Replace manual JSON templates with a serializer. Confirm whether the file is standard JSON or a deliberately permissive configuration format.',
      'Validate the whole document again. Do not remove comma characters globally because commas can occur inside strings.',
    ],
    fixes: [
      { title: 'Generate an array with JSON.stringify', text: 'The serializer inserts separators between values and never appends a trailing comma.', lang: 'javascript', code: `const text = JSON.stringify([1, 2]);\nconst values = JSON.parse(text);\n// text is [1,2]` },
      { title: 'Generate an object with json.dumps', text: 'Use the JSON module instead of a loop that writes individual members and separators.', lang: 'python', code: `import json\ntext = json.dumps({"id": 1})\ndata = json.loads(text)` },
    ],
    faq: [
      { question: 'Are trailing commas allowed in JSON?', answer: 'No. RFC 8259 and ECMA-404 allow commas between members or elements, with no comma after the final member or element.' },
      { question: 'Why does my editor accept a trailing comma?', answer: 'The editor may use a permissive mode or treat the file as JSONC or JavaScript. Acceptance by an editor does not make the text valid standard JSON.' },
      { question: 'Should I enable AllowTrailingCommas in .NET?', answer: 'Use it only if your input contract deliberately permits that extension. For JSON exchanged across runtimes, remove the comma so strict parsers can read the document.' },
      { question: 'Why does Python report different trailing-comma errors?', answer: 'Python 3.13 and later name an illegal trailing comma explicitly. Python 3.12 and earlier report a property-name error for objects or Expecting value for arrays. Each identifies the comma before the closing delimiter.' },
    ],
    related: ['single-quotes-unquoted-keys', 'extra-data'],
  },
  {
    slug: 'extra-data',
    title: 'JSONDecodeError: Extra data and multiple JSON values',
    description: 'Fix Python JSONDecodeError: Extra data and JavaScript errors after a JSON value. Distinguish one JSON document from NDJSON and parse each format correctly.',
    queries: ['jsondecodeerror extra data', 'json decoder jsondecodeerror extra data line 1', 'python json extra data ndjson'],
    meaning: 'The parser completed one JSON value and then found another non-whitespace character. A single JSON document contains one top-level value. Two adjacent objects, an NDJSON stream or a log suffix cannot be loaded as one document with json.loads or JSON.parse. First identify the format; wrapping unrelated text in an array is not a general fix.',
    messages: [
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Extra data: line 1 column 4 (char 3)', input: 'json.loads("{} {}")', evidence: python },
      { runtime: 'JavaScript / V8', text: 'SyntaxError: Unexpected non-whitespace character after JSON at position 3 (line 1 column 4)', input: 'JSON.parse("{} {}")', evidence: node },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected non-whitespace character after JSON data', input: 'Content after a complete JSON value', source: SOURCES.mdn, evidence: 'MDN diagnostic wording, location suffix omitted' },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Unexpected content at end of JSON literal', input: 'Content after a complete JSON value', source: SOURCES.safari, evidence: 'Official WebKit parser message and LiteralParser.h prefix' },
      { runtime: 'Go / json.Unmarshal', text: "invalid character '{' after top-level value", input: 'json.Unmarshal([]byte("{} {}"), &value)', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'C# / System.Text.Json', text: "'{0}' is invalid after a single JSON value. Expected end of data.", input: 'Source template for a second value or suffix', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
    ],
    causes: [
      { title: 'Two documents were concatenated', text: 'Appending JSON objects to a file does not produce one larger JSON object. If the consumer expects one document, serialize an array containing the records.', lang: 'python', code: `import json\njson.loads('{} {}')` },
      { title: 'An NDJSON file was loaded as ordinary JSON', text: 'NDJSON contains one complete JSON value per record line. Loading all lines in one call fails after the first record. Confirm the producer contract before using a line parser.', lang: 'javascript', code: `const text = '{"id":1}\\n{"id":2}';\nJSON.parse(text);` },
      { title: 'A log line or suffix follows the JSON', text: 'Debug output mixed into stdout or a response body makes the complete document invalid. Send logs to stderr or a separate logger and keep the JSON channel clean.', lang: 'python', code: `import json\njson.loads('{"ok":true}\\nrequest finished')` },
    ],
    steps: [
      'Inspect the first unexpected character after the completed value. Determine whether it begins another JSON value or is an unrelated suffix.',
      'For one-document APIs and files, fix the producer to return one value, often an array of records.',
      'For documented NDJSON, parse each record line separately. Do not split pretty-printed multiline JSON into lines.',
      'For other streams of JSON values, use a streaming decoder and consume every value. Do not discard the suffix after the first successful parse.',
    ],
    fixes: [
      { title: 'Parse known NDJSON in JavaScript', text: 'This small example treats empty lines as ignorable. Each nonempty line must contain a complete value. A large stream should be processed incrementally instead of split into an array.', lang: 'javascript', code: `const text = '{"id":1}\\n{"id":2}\\n';\nconst records = text.split(/\\r?\\n/)\n  .filter(line => line.trim() !== '')\n  .map(line => JSON.parse(line));\n// One ordinary document instead:\nconst document = JSON.stringify(records);` },
      { title: 'Read an NDJSON file one record at a time in Python', text: 'Iterating the file avoids loading the entire stream into memory. Include the record number when a line fails. This accepts blank lines by policy.', lang: 'python', code: `import json\nwith open('records.ndjson', encoding='utf-8') as stream:\n    for number, line in enumerate(stream, 1):\n        if not line.strip():\n            continue\n        try:\n            record = json.loads(line)\n        except json.JSONDecodeError as error:\n            raise ValueError(f'Invalid record on line {number}') from error\n        print(record)` },
      { title: 'Decode a sequence of JSON values in Go', text: 'Decoder.Decode reads the next value. Keep decoding until io.EOF; a single successful Decode does not establish that the rest of the input is empty.', lang: 'go', code: `package main\n\nimport (\n    "encoding/json"\n    "fmt"\n    "io"\n    "strings"\n)\n\nfunc main() {\n    dec := json.NewDecoder(strings.NewReader("{} {}"))\n    for {\n        var value any\n        err := dec.Decode(&value)\n        if err == io.EOF { break }\n        if err != nil { panic(err) }\n        fmt.Println(value)\n    }\n}` },
    ],
    faq: [
      { question: 'Is NDJSON valid as one JSON document?', answer: 'An NDJSON stream with multiple records is not one JSON document. Each record line contains a JSON value. Use an NDJSON reader or parse the documented record lines separately.' },
      { question: 'Can I ignore everything after the first object?', answer: 'Only if the format explicitly defines that behavior. Otherwise you can lose records or hide corrupt output. Fix the producer or consume the complete stream.' },
      { question: 'Should I wrap the data in square brackets?', answer: 'If you control the producer and want one document, serialize an array of the records. Simply adding brackets around adjacent objects is insufficient because array elements also need commas.' },
      { question: 'Can Go decode several top-level values?', answer: 'json.Decoder can read successive values through repeated Decode calls. json.Unmarshal validates one complete JSON document and rejects an additional top-level value.' },
    ],
    related: ['trailing-comma', 'unexpected-end-of-json-input', 'bad-control-character'],
  },
  {
    slug: 'bad-control-character',
    title: 'Bad control character in string literal in JSON',
    description: 'Fix unescaped newlines, tabs and other control characters inside JSON strings. See exact JavaScript and Python errors and use serializers to escape values.',
    queries: ['bad control character in string literal in json', 'json unescaped newline', 'invalid control character json python'],
    meaning: 'A JSON string contains an unescaped control character in the range U+0000 through U+001F. Common cases are a literal newline, tab or carriage return inside the quotes. Whitespace between JSON tokens is allowed, but those same characters inside a string must use escapes such as backslash-n or a Unicode escape. Escaping changes the serialized text while preserving the decoded string value.',
    messages: [
      { runtime: 'JavaScript / V8', text: 'SyntaxError: Bad control character in string literal in JSON at position 7 (line 1 column 8)', input: 'JSON.parse on {"x":"a<LF>b"}, where <LF> is U+000A', evidence: node },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Invalid control character at: line 1 column 8 (char 7)', input: 'json.loads on the same literal-LF input', evidence: python },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: bad control character in string literal', input: 'Unescaped control character inside a string', source: SOURCES.mdn, evidence: 'MDN diagnostic wording, location suffix omitted' },
      { runtime: 'Java / Jackson', text: 'has to be escaped using backslash to be included in', input: 'Unescaped control character inside a string', source: 'https://github.com/FasterXML/jackson-core/blob/2.18/src/main/java/com/fasterxml/jackson/core/base/ParserBase.java', evidence: 'Exact diagnostic fragment; the character description and context surround it' },
      { runtime: 'PHP / json_last_error_msg()', text: 'Control character error, possibly incorrectly encoded', input: 'JSON_ERROR_CTRL_CHAR', source: SOURCES.php, evidence: 'Official PHP 8.4 message' },
      { runtime: 'C# / System.Text.Json', text: "'{0}' is invalid within a JSON string. The string should be correctly escaped.", input: 'Source template; {0} describes the offending character', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
    ],
    causes: [
      { title: 'A multiline value was inserted into a template', text: 'A template literal contains a real line feed. Inserting it between JSON quotes leaves that line feed unescaped.', lang: 'javascript', code: `const text = \`{"x":"a\\nb"}\`;\nJSON.parse(text);` },
      { title: 'The source language consumed the backslash', text: 'In an ordinary Python source string, backslash-n becomes a newline before json.loads sees the text. A raw string preserves the JSON escape.', lang: 'python', code: `import json\njson.loads('{"x":"a\\nb"}')  # Python turns \\n into a literal newline` },
      { title: 'A raw tab or carriage return entered a quoted value', text: 'Pasting a tab or interpolating text with carriage returns into manually generated JSON can introduce the same error. Serialize the original value instead.', lang: 'javascript', code: `const text = '{"x":"a' + String.fromCharCode(9) + 'b"}';\nJSON.parse(text);` },
    ],
    steps: [
      'Inspect the original string near the reported position. Make invisible characters visible with JSON.stringify(text) in JavaScript or repr(text) in Python.',
      'Identify whether the character is inside a quoted value. Newlines outside strings can be valid formatting whitespace.',
      'Serialize the original data structure so the serializer escapes control characters. When editing JSON text directly, replace a literal newline inside a string with the two characters backslash and n.',
      'Parse the result and check that the decoded value still contains the intended newline or tab.',
    ],
    fixes: [
      { title: 'Let JavaScript escape the original string', text: 'The value contains a real newline. JSON.stringify writes its escaped representation, and JSON.parse restores that newline in the decoded value.', lang: 'javascript', code: `const value = { x: 'a\\nb' };\nconst text = JSON.stringify(value);\nconsole.log(text); // {"x":"a\\nb"}\nconst data = JSON.parse(text);\nconsole.log(data.x === value.x); // true` },
      { title: 'Use json.dumps or a raw JSON literal in Python', text: 'The raw source string preserves backslash-n for the JSON parser. For generated data, json.dumps is the safer choice.', lang: 'python', code: `import json\nvalue = {"x": "a\\nb"}\ntext = json.dumps(value)\nassert json.loads(text) == value\n\n# A hand-written JSON literal with a JSON escape:\ndata = json.loads(r'{"x":"a\\nb"}')` },
    ],
    faq: [
      { question: 'Can JSON strings contain newlines?', answer: 'The decoded string can contain a newline. The JSON text must represent it with an escape such as backslash-n. A literal line feed between the string quotes is invalid.' },
      { question: 'Are newlines between object members allowed?', answer: 'Yes. Line feed, carriage return, tab and space can separate JSON tokens. The restriction applies to unescaped control characters inside strings.' },
      { question: 'Should I use Python strict=False?', answer: 'strict=False allows raw control characters inside strings, but the input remains outside standard JSON. Fix the producer when the document must work across strict parsers.' },
      { question: 'Why did adding a backslash not fix my source string?', answer: 'Your source language may consume the escape before the JSON parser receives it. Inspect the resulting text. Use a serializer, or preserve the backslash with the appropriate source-string syntax.' },
    ],
    related: ['single-quotes-unquoted-keys', 'extra-data'],
  },
  {
    slug: 'go-invalid-character',
    title: "Go JSON: invalid character looking for beginning of value",
    description: 'Diagnose unexpected prefixes, plain-text errors and byte-order marks in Go JSON input. Check HTTP bodies and use SyntaxError.Offset to locate the bad byte.',
    queries: ["invalid character '<' looking for beginning of value", 'invalid character looking for beginning of value golang', 'go json invalid character BOM'],
    meaning: 'Go encoding/json found a byte that cannot start the value it was about to read. The quoted byte describes what actually arrived. A < often starts HTML, u can start the invalid literal undefined, and an unexpected leading byte can indicate a byte-order mark or the wrong encoding. The error can occur at the start of a document or at a nested value, so inspect SyntaxError.Offset before assuming byte one is wrong.',
    messages: [
      { runtime: 'Go / encoding/json', text: "invalid character '<' looking for beginning of value", input: '[]byte("<html>")', source: SOURCES.go, evidence: 'Official Go 1.26 scanner and quoteChar source' },
      { runtime: 'Go / encoding/json', text: "invalid character 'u' looking for beginning of value", input: '[]byte("undefined")', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'Go / encoding/json', text: "invalid character 'e' looking for beginning of value", input: '[]byte("error: unavailable")', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'Go / encoding/json', text: "invalid character 'ï' looking for beginning of value", input: 'UTF-8 BOM bytes EF BB BF before {}', source: SOURCES.go, evidence: 'Source-derived: scanner reports first byte EF, quoteChar converts that byte to a quoted character' },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("undefined")', evidence: python },
      { runtime: 'JavaScript / V8', text: 'SyntaxError: "undefined" is not valid JSON', input: 'JSON.parse("undefined")', evidence: node },
    ],
    causes: [
      { title: 'The body is a plain-text service error', text: 'A service can send a status message instead of the expected JSON body. Inspect status and Content-Type before decoding. For a body starting with <, follow the HTML-response guide.', lang: 'go', code: `var value any\nerr := json.Unmarshal([]byte("error: unavailable"), &value)\nfmt.Println(err)` },
      { title: 'A UTF-8 byte-order mark precedes the document', text: 'A UTF-8 BOM is the byte sequence EF BB BF. JSON producers must not add a BOM to networked JSON. If a documented legacy file has one, remove precisely that prefix at the file boundary.', lang: 'go', code: `body := append([]byte{0xef, 0xbb, 0xbf}, []byte("{}")...)\nvar value any\nerr := json.Unmarshal(body, &value)\nfmt.Println(err)` },
      { title: 'A JavaScript-only literal appears as a nested value', text: 'undefined is not a JSON literal. Correct the source object or use null only when the application meaning is actually a missing value.', lang: 'go', code: `var value any\nerr := json.Unmarshal([]byte(\`{"value":undefined}\`), &value)\nfmt.Println(err)` },
    ],
    steps: [
      'Inspect the status, media type and a short body preview for HTTP input. For a file, inspect the first bytes in hexadecimal.',
      'Use errors.As to read *json.SyntaxError.Offset. It counts bytes read and is not the same as a Unicode character index.',
      'Fix plain-text or HTML service errors at the source. For a known legacy file, remove only a confirmed UTF-8 BOM; decode other encodings deliberately before parsing.',
      'Use json.Marshal to produce JSON and json.Unmarshal to validate a single complete document. For a stream, use repeated Decoder.Decode calls.',
    ],
    http: true,
    fixes: [
      { title: 'Locate the byte and handle a confirmed file BOM', text: 'This complete example handles a known file boundary. Removing arbitrary invalid bytes can hide corrupted input, so do not use a general character filter.', lang: 'go', code: `package main\n\nimport (\n    "bytes"\n    "encoding/json"\n    "errors"\n    "fmt"\n)\n\nfunc main() {\n    body := append([]byte{0xef, 0xbb, 0xbf}, []byte("{}")...)\n    body = bytes.TrimPrefix(body, []byte{0xef, 0xbb, 0xbf})\n    var value any\n    if err := json.Unmarshal(body, &value); err != nil {\n        var syntax *json.SyntaxError\n        if errors.As(err, &syntax) {\n            fmt.Printf("JSON error after byte %d: %v\\n", syntax.Offset, err)\n        }\n        return\n    }\n    fmt.Println(value)\n}` },
    ],
    faq: [
      { question: 'What does invalid character < mean in Go?', answer: 'The parser encountered < where a JSON value was required. If the body starts with HTML, inspect the endpoint, redirects and HTTP status. Do not remove the tag and try to parse the page.' },
      { question: 'Does this always mean the first byte is invalid?', answer: 'No. It can occur wherever a value is expected, including after an object colon or array comma. Read SyntaxError.Offset to locate the byte.' },
      { question: 'Why can a UTF-8 BOM appear as ï in the error?', answer: 'Go scans bytes. Its error formatter converts the first BOM byte, hexadecimal EF, to a quoted character. Inspect the raw bytes to confirm the full EF BB BF prefix.' },
      { question: 'Does a successful Decode validate the whole response?', answer: 'One Decode reads one value. To require a single complete document, use json.Unmarshal on the full body or check that a second Decode returns io.EOF.' },
    ],
    related: ['unexpected-token-html', 'unexpected-end-of-json-input', 'extra-data', 'undefined-is-not-valid-json'],
  },
];

export const HUB_FAQ = [
  { question: 'How do I identify the cause of a JSON parse error?', answer: 'Inspect the exact text passed to the parser, then read the reported line, column or offset. Check the HTTP response status and Content-Type when the text came from an API. The same message can have more than one cause.' },
  { question: 'Why do runtimes show different JSON error messages?', answer: 'Each parser defines its own diagnostic wording, and messages change across versions. JSON standards define valid syntax, not a required error message. Match the input and cause as well as the wording.' },
  { question: 'Can I validate JSON without uploading it?', answer: 'Yes. Tool Kumar parses the document in your browser and reports syntax issues with line and column information. Its validator and repair tools keep the input on your device.' },
];
