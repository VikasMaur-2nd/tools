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
  /** Omitted for parse errors. Serialization errors have no input position; binding errors have valid JSON of the wrong shape. */
  kind?: 'serialize' | 'binding';
  /** Byline note on how the examples were checked, when not reproduced in Node and Python. */
  checked?: string;
  /** ISO dates (YYYY-MM-DD): first publication, and the last change to the guide's text (sitemap, dateModified, byline). */
  published: string;
  updated: string;
  tools?: { href: string; label: string }[];
  /** Documentation and source links beyond the per-message citations. */
  docs?: { href: string; label: string }[];
};

const FIREFOX = 'https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js';
const JSC = 'https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime';
const JACKSON_CORE = 'https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core';
const DATABIND = (tag: string) => `https://github.com/FasterXML/jackson-databind/blob/jackson-databind-${tag}/src/main/java/com/fasterxml/jackson/databind`;
const STJ = 'https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src';
const NEWTONSOFT = 'https://github.com/JamesNK/Newtonsoft.Json/blob/13.0.4/Src/Newtonsoft.Json';
const GO = 'https://github.com/golang/go/blob/go1.27.0/src/encoding/json';
const PHP = 'https://github.com/php/php-src/blob/php-8.5.11/ext/json';
const SERDE = 'https://github.com/serde-rs/json/blob/v1.0.154/src';

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
  // Pinned to release tags; line anchors point at the quoted template or the code that fills it.
  v8BigInt: 'https://github.com/v8/v8/blob/13.6.233.17/src/common/message-template.h#L63',
  v8CircularPath: 'https://github.com/v8/v8/blob/13.6.233.17/src/json/json-stringifier.cc#L798-L870',
  v8Node18: 'https://github.com/v8/v8/blob/10.2.154.26/src/common/message-template.h#L481-L482',
  firefoxCyclic: `${FIREFOX}/public/friend/ErrorNumbers.msg#L142`,
  firefoxBigInt: `${FIREFOX}/public/friend/ErrorNumbers.msg#L835`,
  firefoxUnexpectedChar: `${FIREFOX}/src/vm/JSONParser.cpp#L179`,
  firefoxKeyword: `${FIREFOX}/src/vm/JSONParser.cpp#L123`,
  firefoxEnd: `${FIREFOX}/src/vm/JSONParser.cpp#L98`,
  firefoxPosition: `${FIREFOX}/src/vm/JSONParser.cpp#L57-L76`,
  firefoxCommaObject: `${FIREFOX}/src/vm/JSONParser.cpp#L264`,
  firefoxBadEscape: `${FIREFOX}/src/vm/JSONParser.cpp#L496`,
  jscUnrecognized: `${JSC}/LiteralParser.cpp#L846`,
  jscSingleQuote: `${JSC}/LiteralParser.cpp#L769`,
  jscEscape: `${JSC}/LiteralParser.cpp#L1080`,
  jscExpectedBrace: `${JSC}/LiteralParser.cpp#L1229`,
  jscIdentifier: `${JSC}/LiteralParser.cpp#L1282`,
  jscBigInt: `${JSC}/JSONObject.cpp#L422`,
  jscCyclic: `${JSC}/JSONObject.cpp#L444`,
  py27Delimiter: 'https://github.com/python/cpython/blob/v2.7.18/Modules/_json.c#L959',
  py35Encoder: 'https://github.com/python/cpython/blob/v3.5.0/Lib/json/encoder.py#L180',
  py36Encoder: 'https://github.com/python/cpython/blob/v3.6.0/Lib/json/encoder.py#L179',
  py311Nan: 'https://github.com/python/cpython/blob/v3.11.0/Modules/_json.c#L1354',
  py314Note: 'https://github.com/python/cpython/blob/v3.14.0/Modules/_json.c#L1646',
  starletteNan: 'https://github.com/encode/starlette/blob/1.8.0/starlette/responses.py#L201',
  jacksonToken: `${JACKSON_CORE}/json/ReaderBasedJsonParser.java#L3041`,
  jacksonChar: `${JACKSON_CORE}/json/ReaderBasedJsonParser.java#L2065`,
  jacksonNaN: `${JACKSON_CORE}/json/ReaderBasedJsonParser.java#L2043`,
  jacksonComma: `${JACKSON_CORE}/json/ReaderBasedJsonParser.java#L2445`,
  jacksonEscape: `${JACKSON_CORE}/base/ParserBase.java#L1388`,
  jackson29Token: 'https://github.com/FasterXML/jackson-core/blob/jackson-core-2.9.10/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L1899',
  jackson29Char: 'https://github.com/FasterXML/jackson-core/blob/jackson-core-2.9.10/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L1902',
  jacksonMismatch: `${DATABIND('2.22.3')}/DeserializationContext.java#L1580`,
  jacksonArrayList: `${DATABIND('2.22.3')}/deser/BasicDeserializerFactory.java#L1869`,
  jackson211: `${DATABIND('2.11.4')}/DeserializationContext.java#L1234`,
  jackson29Mismatch: `${DATABIND('2.9.10.8')}/DeserializationContext.java#L1135`,
  jackson28: `${DATABIND('2.8.11')}/DeserializationContext.java#L1118`,
  jacksonUnknown: `${DATABIND('2.22.3')}/exc/UnrecognizedPropertyException.java#L58`,
  jacksonRecursion: `${DATABIND('2.22.3')}/ser/std/BeanSerializerBase.java#L772`,
  jacksonNoContent: `${DATABIND('2.22.3')}/ObjectMapper.java#L5144`,
  jackson3Unknown: 'https://github.com/FasterXML/jackson-databind/blob/jackson-databind-3.2.3/src/main/java/tools/jackson/databind/exc/UnrecognizedPropertyException.java#L50',
  jackson3UnknownDefault: 'https://github.com/FasterXML/jackson-databind/blob/jackson-databind-3.2.3/src/main/java/tools/jackson/databind/DeserializationFeature.java#L150',
  springPrefix: 'https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-web/src/main/java/org/springframework/http/converter/json/AbstractJackson2HttpMessageConverter.java#L408',
  springUnknown: 'https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-web/src/main/java/org/springframework/http/converter/json/Jackson2ObjectMapperBuilder.java#L799-L800',
  stjInvalidStart: `${STJ}/Resources/Strings.resx#L210`,
  stjAfterValue: `${STJ}/Resources/Strings.resx#L222`,
  stjEscape: `${STJ}/Resources/Strings.resx#L228`,
  stjConvert: `${STJ}/Resources/Strings.resx#L321`,
  stjCycle: `${STJ}/Resources/Strings.resx#L453`,
  stjUnmapped: `${STJ}/Resources/Strings.resx#L500`,
  stjReaderSuffix: `${STJ}/System/Text/Json/ThrowHelper.cs#L383`,
  stjPrintable: `${STJ}/System/Text/Json/ThrowHelper.cs#L390-L393`,
  stjStreamBom: `${STJ}/System/Text/Json/Serialization/StreamReadBufferState.cs#L179-L181`,
  newtonsoftUnexpected: `${NEWTONSOFT}/JsonTextReader.cs#L763`,
  newtonsoftEscape: `${NEWTONSOFT}/JsonTextReader.cs#L1261`,
  newtonsoftObject: `${NEWTONSOFT}/Serialization/JsonSerializerInternalReader.cs#L604`,
  newtonsoftLoop: `${NEWTONSOFT}/Serialization/JsonSerializerInternalWriter.cs#L343`,
  aspnetPrimitive: 'https://github.com/microsoft/referencesource/blob/ec9fa9ae770d522a5b5f0607898044b7478574a3/System.Web.Extensions/Resources/AtlasWeb.resx#L195',
  goUnmarshalType: `${GO}/decode.go#L136-L141`,
  goUnknown: `${GO}/decode.go#L741`,
  goNumber: `${GO}/decode.go#L960`,
  goV2: `${GO}/v2_decode.go#L132-L154`,
  goCycle: `${GO}/encode.go#L774`,
  goAfterPair: `${GO}/scanner.go#L312`,
  goEscape: `${GO}/scanner.go#L364`,
  phpNoError: `${PHP}/json.c#L151`,
  phpDepth: `${PHP}/json.c#L153`,
  phpSyntax: `${PHP}/json.c#L159`,
  phpUtf8: `${PHP}/json.c#L161`,
  phpThrow: `${PHP}/json.c#L191`,
  phpEmpty: `${PHP}/json.c#L279`,
  phpBom: `${PHP}/json_scanner.re#L218`,
  phpEscape: `${PHP}/json_scanner.re#L255`,
  serdeEof: `${SERDE}/error.rs#L357`,
  serdeExpectedValue: `${SERDE}/error.rs#L362`,
  serdeKey: `${SERDE}/error.rs#L371`,
  serdeTrailing: `${SERDE}/error.rs#L382`,
  mdnCyclic: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value',
  mdnBigInt: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable',
  mdnRawJson: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/rawJSON',
  mdnParse: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse',
  prismaBigInt: 'https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types#serializing-bigint',
  dotnetPreserve: 'https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/preserve-references',
  phpDecode: 'https://www.php.net/manual/en/function.json-decode.php',
  phpLastErrorMsg: 'https://www.php.net/manual/en/function.json-last-error-msg.php',
};
const node = 'Reproduced in Node.js 24.21.0';
const python = 'Reproduced in Python 3.14.4';

export const ERROR_GUIDES: ErrorGuide[] = [
  {
    slug: 'unexpected-token-html',
    published: '2026-10-14',
    updated: '2026-10-15',
    title: "Unexpected token '<' / DOCTYPE is not valid JSON",
    description: 'Fix JSON parsing failures caused by HTML responses. Inspect the response status, content type and body before parsing in JavaScript, Python or Go.',
    queries: ['unexpected token < in json at position 0', 'doctype is not valid json', 'unexpected token < json fetch', "json parse error: unrecognized token '<'"],
    meaning: 'The JSON parser received a body that starts with HTML, often a DOCTYPE declaration or an HTML tag. The parser stops at the first < because that character cannot begin a JSON value. The response may be a login page, a missing-route page or a proxy error. A successful HTTP status alone does not prove that the body is JSON.',
    messages: [
      { runtime: 'JavaScript / V8', text: `SyntaxError: Unexpected token '<', "<!DOCTYPE html>" is not valid JSON`, input: 'JSON.parse("<!DOCTYPE html>")', evidence: node },
      { runtime: 'Older V8', text: 'Unexpected token < in JSON at position 0', input: 'HTML starting with <', source: SOURCES.oldV8, evidence: 'V8 8.0 message template, with token < and position 0 substituted' },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("<!DOCTYPE html>")', evidence: python },
      { runtime: 'Go / encoding/json', text: "invalid character '<' looking for beginning of value", input: 'json.Unmarshal([]byte("<!DOCTYPE html>"), &value)', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected character', input: 'Non-JSON character at the start', source: SOURCES.mdn, evidence: 'MDN diagnostic wording, location suffix omitted' },
      { runtime: 'C# / System.Text.Json', text: "'{0}' is an invalid start of a value.", input: 'Source template; {0} is the offending character', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
      { runtime: 'PHP / json_last_error_msg()', text: 'Syntax error', input: 'json_decode("<!DOCTYPE html>")', source: SOURCES.php, evidence: 'Official PHP 8.4 JSON_ERROR_SYNTAX message' },
      { runtime: 'Safari, React Native / JavaScriptCore', text: "JSON Parse error: Unrecognized token '<'", input: 'HTML starting with <', source: SOURCES.jscUnrecognized, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix' },
      { runtime: 'Java / Jackson', text: "Unexpected character ('<' (code 60)): expected a valid value (JSON String, Number, Array, Object or token 'null', 'true' or 'false')", input: 'HTML starting with <', source: SOURCES.jacksonChar, evidence: 'Source-derived from Jackson 2.22; location suffix omitted' },
      { runtime: 'Rust / serde_json', text: 'expected value at line 1 column 1', input: 'serde_json::from_str on HTML', source: SOURCES.serdeExpectedValue, evidence: 'Source-derived from serde_json 1.0.154 error.rs and read.rs' },
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
    related: ['unexpected-end-of-json-input', 'go-invalid-character', 'firefox-unexpected-character', 'dotnet-invalid-start-of-value', 'jackson-unrecognized-token'],
  },
  {
    slug: 'unexpected-end-of-json-input',
    published: '2026-10-14',
    updated: '2026-10-15',
    title: 'Unexpected end of JSON input: empty or truncated data',
    description: 'Find and fix empty responses and truncated JSON behind Unexpected end of JSON input, Python Expecting value at char 0 and Go EOF errors.',
    queries: ['unexpected end of json input how to fix', 'unexpected end of json input while parsing empty string', 'json.decoder.jsondecodeerror expecting value line 1 column 1 char 0', 'json.parse: unexpected end of data at line 1 column 1 of the json data', 'unterminated string starting at', 'no content to map due to end-of-input'],
    meaning: 'The parser reached the end before it could read a complete JSON value. An empty string has no value at all. A truncated object, array or string starts a value but never finishes it. Python also reports Expecting value at char 0 for HTML and other invalid prefixes, so that message alone does not prove the input is empty.',
    messages: [
      { runtime: 'JavaScript / V8', text: 'SyntaxError: Unexpected end of JSON input', input: 'JSON.parse("") or JSON.parse(\'{"id":\')', evidence: node },
      { runtime: 'Python, empty input', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("")', evidence: python },
      { runtime: 'Python, unfinished value', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 7 (char 6)', input: 'json.loads(\'{"id":\')', evidence: python },
      { runtime: 'Go / json.Unmarshal', text: 'unexpected end of JSON input', input: 'Empty or incomplete JSON bytes', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'Go / Decoder.Decode', text: 'EOF', input: 'No next value in an empty reader', source: 'https://github.com/golang/go/blob/go1.26.0/src/encoding/json/stream.go', evidence: 'io.EOF return in the official Go source; incomplete tokens can produce unexpected EOF' },
      { runtime: 'JavaScript / V8, cut-off string', text: 'SyntaxError: Unterminated string in JSON at position 9 (line 1 column 10)', input: `JSON.parse('{"a":"abc')`, evidence: node },
      { runtime: 'Python, cut-off string', text: 'json.decoder.JSONDecodeError: Unterminated string starting at: line 1 column 6 (char 5)', input: `json.loads('{"a":"abc')`, evidence: python },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected end of data at line 1 column 1 of the JSON data', input: 'JSON.parse("")', source: SOURCES.firefoxEnd, evidence: 'Source-derived from Firefox 158 JSONParser.cpp and its message template' },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Unexpected EOF', input: 'End token encountered where a value is required', source: SOURCES.safari, evidence: 'Official WebKit parser message; LiteralParser.h supplies the JSON Parse error prefix' },
      { runtime: 'C# / System.Text.Json', text: 'The input does not contain any JSON tokens. Expected the input to start with a valid JSON token, when isFinalBlock is true.', input: 'Empty input, source resource string', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
      { runtime: 'Java / Jackson', text: 'MismatchedInputException: No content to map due to end-of-input', input: 'readValue on an empty string or stream', source: SOURCES.jacksonNoContent, evidence: 'Official Jackson 2.22 source message; location suffix omitted' },
      { runtime: 'Rust / serde_json', text: 'EOF while parsing a value at line 1 column 0', input: 'serde_json::from_str on ""', source: SOURCES.serdeEof, evidence: 'Source-derived from serde_json 1.0.154 error.rs and read.rs' },
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
    related: ['unexpected-token-html', 'undefined-is-not-valid-json', 'extra-data', 'firefox-unexpected-character'],
    tools: [{ href: '/tools/large-json-viewer', label: 'Find where a large JSON file was cut off' }],
  },
  {
    slug: 'undefined-is-not-valid-json',
    published: '2026-10-14',
    updated: '2026-10-15',
    title: '"undefined" or "[object Object]" is not valid JSON',
    description: 'Fix JSON.parse calls that receive undefined or an already-parsed object. Learn when to parse, when to stringify and how to guard missing storage values.',
    queries: ['undefined is not valid json', '[object Object] is not valid json', 'unexpected token u in json at position 0', 'unexpected token o in json at position 1', 'the json object must be str, bytes or bytearray, not dict', 'json parse error: unexpected identifier "undefined"'],
    meaning: 'JSON.parse expects JSON text and converts its argument to a string. undefined becomes the text undefined, and a plain object normally becomes [object Object]. Neither text is JSON. This usually means a value is missing or the caller tried to parse data that a library already decoded. Other primitive arguments can parse after coercion, but relying on coercion hides the input contract. Python reports the same mistake as a TypeError when json.loads receives a dict or None instead of text.',
    messages: [
      { runtime: 'JavaScript / V8, missing value', text: 'SyntaxError: "undefined" is not valid JSON', input: 'JSON.parse(undefined)', evidence: node },
      { runtime: 'JavaScript / V8, object value', text: 'SyntaxError: "[object Object]" is not valid JSON', input: 'JSON.parse({})', evidence: node },
      { runtime: 'Older V8', text: 'Unexpected token u in JSON at position 0', input: 'undefined converted to text', source: SOURCES.oldV8, evidence: 'V8 8.0 message template with u and 0 substituted' },
      { runtime: 'Older V8', text: 'Unexpected token o in JSON at position 1', input: 'A plain object converted to [object Object]', source: SOURCES.oldV8, evidence: 'V8 8.0 message template with o and 1 substituted' },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)', input: 'json.loads("undefined"), a string rather than a Python dict', evidence: python },
      { runtime: 'Python, already decoded', text: 'TypeError: the JSON object must be str, bytes or bytearray, not dict', input: "json.loads({'id': 1})", evidence: python },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Unexpected identifier "undefined"', input: 'JSON.parse(undefined)', source: SOURCES.jscIdentifier, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix' },
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
    related: ['unexpected-end-of-json-input', 'single-quotes-unquoted-keys', 'firefox-unexpected-character'],
  },
  {
    slug: 'single-quotes-unquoted-keys',
    published: '2026-10-14',
    updated: '2026-10-15',
    title: 'Expecting property name enclosed in double quotes',
    description: 'Fix single-quoted strings and unquoted keys in JSON. Compare exact Python and JavaScript errors and serialize objects without unsafe quote replacement.',
    queries: ['expecting property name enclosed in double quotes', 'expecting property name enclosed in double quotes line 1 column 2 char 1', "unexpected token ' in json", "json parse error: single quotes (') are not allowed in json"],
    meaning: 'Every JSON object property name must be a string enclosed in double quotes. String values also need double quotes. A JavaScript object literal or Python dictionary display can use syntax that looks like JSON but is not JSON text. The reported position is where the parser expected a quoted property name; a trailing comma can also produce a property-name error.',
    messages: [
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)', input: `json.loads("{'id':1}") or json.loads('{id:1}')`, evidence: python },
      { runtime: 'JavaScript / V8', text: "SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)", input: `JSON.parse("{'id':1}") or JSON.parse('{id:1}')`, evidence: node },
      { runtime: 'Firefox', text: "SyntaxError: JSON.parse: expected property name or '}'", input: `JSON.parse("{'foo': 1}")`, source: SOURCES.mdn, evidence: 'Exact example in MDN; location suffix omitted' },
      { runtime: 'Java / Jackson', text: 'was expecting double-quote to start field name', input: 'Unquoted key with default parser settings', source: SOURCES.jackson, evidence: 'Exact diagnostic fragment from Jackson 2.18 source; exception prefix and location vary' },
      { runtime: 'C# / System.Text.Json', text: `'{0}' is an invalid start of a property name. Expected a '"'.`, input: 'Source template; {0} is the offending character', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
      { runtime: 'Safari / JavaScriptCore', text: "JSON Parse error: Single quotes (') are not allowed in JSON", input: `JSON.parse("{'id':1}")`, source: SOURCES.jscSingleQuote, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix' },
      { runtime: 'Rust / serde_json', text: 'key must be a string at line 1 column 2', input: `serde_json::from_str on {'id':1}`, source: SOURCES.serdeKey, evidence: 'Source-derived from serde_json 1.0.154 error.rs and read.rs' },
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
    related: ['trailing-comma', 'undefined-is-not-valid-json', 'bad-control-character', 'expecting-comma-delimiter'],
  },
  {
    slug: 'trailing-comma',
    published: '2026-10-14',
    updated: '2026-10-15',
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
    related: ['single-quotes-unquoted-keys', 'extra-data', 'expecting-comma-delimiter'],
    tools: [{ href: '/tools/json-repair', label: 'Repair a trailing comma locally' }],
  },
  {
    slug: 'extra-data',
    published: '2026-10-14',
    updated: '2026-10-15',
    title: 'JSONDecodeError: Extra data and multiple JSON values',
    description: 'Fix Python JSONDecodeError: Extra data and JavaScript Unexpected non-whitespace character after JSON. Tell one JSON document from NDJSON and parse each correctly.',
    queries: ['jsondecodeerror extra data', 'json decoder jsondecodeerror extra data line 1', 'python json extra data ndjson', 'unexpected non-whitespace character after json at position'],
    meaning: 'The parser completed one JSON value and then found another non-whitespace character. A single JSON document contains one top-level value. Two adjacent objects, an NDJSON stream or a log suffix cannot be loaded as one document with json.loads or JSON.parse. First identify the format; wrapping unrelated text in an array is not a general fix.',
    messages: [
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Extra data: line 1 column 4 (char 3)', input: 'json.loads("{} {}")', evidence: python },
      { runtime: 'JavaScript / V8', text: 'SyntaxError: Unexpected non-whitespace character after JSON at position 3 (line 1 column 4)', input: 'JSON.parse("{} {}")', evidence: node },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected non-whitespace character after JSON data', input: 'Content after a complete JSON value', source: SOURCES.mdn, evidence: 'MDN diagnostic wording, location suffix omitted' },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Unexpected content at end of JSON literal', input: 'Content after a complete JSON value', source: SOURCES.safari, evidence: 'Official WebKit parser message and LiteralParser.h prefix' },
      { runtime: 'Go / json.Unmarshal', text: "invalid character '{' after top-level value", input: 'json.Unmarshal([]byte("{} {}"), &value)', source: SOURCES.go, evidence: 'Official Go 1.26 scanner source' },
      { runtime: 'C# / System.Text.Json', text: "'{0}' is invalid after a single JSON value. Expected end of data.", input: 'Source template for a second value or suffix', source: SOURCES.dotnet, evidence: 'Official .NET 10 resource string, path and location suffix omitted' },
      { runtime: 'Rust / serde_json', text: 'trailing characters at line 1 column 4', input: 'serde_json::from_str on "{} {}"', source: SOURCES.serdeTrailing, evidence: 'Source-derived from serde_json 1.0.154 error.rs and read.rs' },
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
    tools: [
      { href: '/tools/json-to-csv', label: 'Convert an array of JSON records to CSV' },
      { href: '/tools/ndjson-to-json', label: 'Convert NDJSON into one JSON array' },
    ],
  },
  {
    slug: 'bad-control-character',
    published: '2026-10-14',
    updated: '2026-10-15',
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
    related: ['single-quotes-unquoted-keys', 'extra-data', 'invalid-escape'],
  },
  {
    slug: 'go-invalid-character',
    published: '2026-10-14',
    updated: '2026-10-15',
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
    related: ['unexpected-token-html', 'unexpected-end-of-json-input', 'extra-data', 'undefined-is-not-valid-json', 'go-cannot-unmarshal'],
    tools: [{ href: '/tools/json-to-go', label: 'Generate Go structs from valid JSON' }],
  },
  {
    slug: 'expecting-comma-delimiter',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: "Expecting ',' delimiter / Expected ',' or '}' after property value",
    description: "Fix missing commas and unescaped double quotes behind Python Expecting ',' delimiter and JavaScript Expected ',' or '}' errors, with exact messages by runtime.",
    queries: ["expecting ',' delimiter", "json.decoder.jsondecodeerror expecting ',' delimiter", "expected ',' or '}' after property value in json at position", "json.parse expected ',' or '}' after property value in object", 'unexpected string in json at position'],
    meaning: "The parser finished one member of an object, or one element of an array, and expected a comma or the closing bracket next. It found another value instead. Usually a comma is missing between two members. The other common cause is a double quote inside a string value that is not escaped: the parser ends the string at that quote and then meets the rest of the text where a separator should be. Expecting ':' delimiter is the related error for a property name that is not followed by a colon.",
    messages: [
      { runtime: 'Python', text: "json.decoder.JSONDecodeError: Expecting ',' delimiter: line 1 column 8 (char 7)", input: `json.loads('{"a":1 "b":2}')`, evidence: python },
      { runtime: 'Python, missing colon', text: "json.decoder.JSONDecodeError: Expecting ':' delimiter: line 1 column 6 (char 5)", input: `json.loads('{"a" 1}')`, evidence: python },
      { runtime: 'Python 2.7, byte strings', text: 'ValueError: Expecting , delimiter', input: 'json.loads on a str (byte string) with a missing comma', source: SOURCES.py27Delimiter, evidence: 'CPython 2.7.18 C scanner; unicode input quotes the comma. Location suffix omitted' },
      { runtime: 'JavaScript / V8', text: "SyntaxError: Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)", input: `JSON.parse('{"a":1 "b":2}')`, evidence: node },
      { runtime: 'JavaScript / V8, array', text: "SyntaxError: Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)", input: "JSON.parse('[1 2]')", evidence: node },
      { runtime: 'V8 10.2 / Node.js 18', text: 'SyntaxError: Unexpected string in JSON at position 7', input: `JSON.parse('{"a":1 "b":2}'); [1 2] gives Unexpected number in JSON at position 3`, source: SOURCES.v8Node18, evidence: 'V8 10.2 message templates; the position is where the unexpected token starts' },
      { runtime: 'Firefox', text: "SyntaxError: JSON.parse: expected ',' or '}' after property value in object at line 1 column 8 of the JSON data", input: `JSON.parse('{"a":1 "b":2}')`, source: SOURCES.firefoxCommaObject, evidence: 'Source-derived from Firefox 158 JSONParser.cpp and its message template' },
      { runtime: 'Safari / JavaScriptCore', text: "JSON Parse error: Expected '}'", input: 'Missing comma in an object', source: SOURCES.jscExpectedBrace, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix' },
      { runtime: 'Go / encoding/json', text: `invalid character '"' after object key:value pair`, input: 'json.Unmarshal of {"a":1 "b":2}', source: SOURCES.goAfterPair, evidence: 'Source-derived from the Go 1.27 scanner' },
      { runtime: 'Java / Jackson', text: `Unexpected character ('"' (code 34)): was expecting comma to separate Object entries`, input: '{"a":1 "b":2}', source: SOURCES.jacksonComma, evidence: 'Source-derived from Jackson 2.22; location suffix omitted' },
      { runtime: 'C# / System.Text.Json', text: `'"' is invalid after a value. Expected either ',', '}', or ']'.`, input: '{"a":1 "b":2}', source: SOURCES.stjAfterValue, evidence: 'Official .NET 10 resource template with the quote substituted; path and location omitted' },
    ],
    causes: [
      { title: 'A comma is missing between members', text: 'Hand-edited JSON loses a comma when a line is added or moved. The parser only notices at the next member, so here it reports line 3 although the comma belongs at the end of line 2.', lang: 'python', code: `import json
json.loads('{\\n  "a": 1\\n  "b": 2\\n}')
# Expecting ',' delimiter: line 3 column 3 (char 13)` },
      { title: 'A double quote inside a string is not escaped', text: 'The quote before hi closes the string "say ". The parser then finds hi where a comma or closing brace must be. Inside a JSON string a double quote is written as a backslash followed by the quote, which a serializer does for you.', lang: 'javascript', code: `const text = '{"msg":"say "hi""}';
JSON.parse(text);
// Expected ',' or '}' after property value in JSON at position 13` },
      { title: 'Records were joined without separators', text: 'Concatenating objects produces text that is neither one array nor NDJSON. If each record is on its own line by design, read the input as NDJSON instead.', lang: 'javascript', code: `const text = '[' + '{"a":1}' + '{"a":2}' + ']';
JSON.parse(text);
// Expected ',' or ']' after array element in JSON at position 8` },
    ],
    steps: [
      'Open the reported line and column. Check the character there and the end of the member before it: a missing comma belongs after the previous value, not at the reported position.',
      'If the previous value is complete, add the comma. If the parser stopped inside what should be one string, look for an unescaped double quote earlier in that string.',
      'Fix the producer. Build the value as an object or array and serialize it, instead of concatenating JSON fragments or inserting text between quotes.',
      'Validate the whole document again. Hand-edited files often have more than one missing comma.',
    ],
    fixes: [
      { title: 'Let JSON.stringify escape quotes', text: 'The serializer writes the inner quotes as escapes, and parsing restores the original string.', lang: 'javascript', code: `const value = { msg: 'say "hi"' };
const text = JSON.stringify(value);
console.log(text); // {"msg":"say \\"hi\\""}
console.log(JSON.parse(text).msg === value.msg); // true` },
      { title: 'Serialize records with json.dumps', text: 'json.dumps writes the separators. Build the list first instead of writing objects one by one.', lang: 'python', code: `import json
records = [{"a": 1}, {"a": 2}]
text = json.dumps(records)
print(text)  # [{"a": 1}, {"a": 2}]
assert json.loads(text) == records` },
      { title: 'Print the text around a Python error', text: 'JSONDecodeError carries msg, pos, lineno and colno. A slice around pos shows the unescaped quote or the missing comma.', lang: 'python', code: `import json
text = '{"msg":"say "hi""}'
try:
    json.loads(text)
except json.JSONDecodeError as error:
    print(error.msg, error.lineno, error.colno)  # Expecting ',' delimiter 1 14
    print(text[error.pos - 6:error.pos + 5])  # "say "hi""}` },
    ],
    faq: [
      { question: 'Why does the error point to the line after the missing comma?', answer: 'The parser cannot know that a comma is missing until it reads the next member, so it reports where that member starts. Add the comma after the last value of the previous member.' },
      { question: "Can an unescaped quote cause Expecting ',' delimiter?", answer: 'Yes. A double quote inside a value ends the string early, and the rest of the value is read as an unexpected token. Escape the quote, or serialize the value with JSON.stringify or json.dumps.' },
      { question: "What does Expecting ':' delimiter mean?", answer: 'A property name was read, but the next character is not a colon. Look for a missing colon, a missing quote that merged a key with its value, or a value written without a key.' },
      { question: 'Can Tool Kumar add missing commas?', answer: 'The validator marks the position, and its repair inserts a comma between two members or array items when the next one clearly starts. It cannot know where a string with an unescaped quote was meant to end, so review each repair and fix that case at the source.' },
    ],
    related: ['trailing-comma', 'single-quotes-unquoted-keys', 'invalid-escape', 'extra-data'],
    tools: [{ href: '/tools/json-repair', label: 'Repair missing commas and other common mistakes' }],
  },
  {
    slug: 'invalid-escape',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'Bad escaped character in JSON / Invalid \\escape',
    description: "Fix backslashes JSON cannot read, such as Windows paths, regex patterns and \\' escapes. Exact JavaScript, Python, Firefox, Go and .NET messages, with fixes.",
    queries: ['bad escaped character in json at position', 'json.decoder.jsondecodeerror: invalid \\escape', 'json.parse: bad escaped character', 'invalid \\uxxxx escape', 'bad unicode escape in json at position'],
    meaning: "Inside a JSON string, a backslash must start one of nine escapes: \\\" \\\\ \\/ \\b \\f \\n \\r \\t, or \\u followed by exactly four hexadecimal digits. Any other character after a backslash is invalid. The usual sources are Windows paths such as C:\\Users, regular expressions such as \\d, and \\' copied from JavaScript or SQL strings. A \\u escape without four hex digits has its own Unicode-escape message.",
    messages: [
      { runtime: 'JavaScript / V8', text: 'SyntaxError: Bad escaped character in JSON at position 12 (line 1 column 13)', input: 'JSON.parse on {"path":"C:\\Users\\ada"}', evidence: node },
      { runtime: 'JavaScript / V8, \\u escape', text: 'SyntaxError: Bad Unicode escape in JSON at position 3 (line 1 column 4)', input: 'JSON.parse on "\\uZZZZ"', evidence: node },
      { runtime: 'Python', text: 'json.decoder.JSONDecodeError: Invalid \\escape: line 1 column 12 (char 11)', input: `json.loads(r'{"path":"C:\\Users\\ada"}')`, evidence: python },
      { runtime: 'Python, \\u escape', text: 'json.decoder.JSONDecodeError: Invalid \\uXXXX escape: line 1 column 3 (char 2)', input: `json.loads(r'"\\uZZZZ"')`, evidence: python },
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: bad escaped character at line 1 column 13 of the JSON data', input: 'The same path input', source: SOURCES.firefoxBadEscape, evidence: 'Source-derived from Firefox 158 JSONParser.cpp: reported at the character after the backslash' },
      { runtime: 'Safari / JavaScriptCore', text: 'JSON Parse error: Invalid escape character U', input: 'The same path input', source: SOURCES.jscEscape, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix' },
      { runtime: 'Go / encoding/json', text: "invalid character 'U' in string escape code", input: 'The same path input', source: SOURCES.goEscape, evidence: 'Official Go 1.27 scanner source' },
      { runtime: 'Java / Jackson', text: "Unrecognized character escape 'U' (code 85)", input: 'The same path input', source: SOURCES.jacksonEscape, evidence: 'Source-derived from Jackson 2.22; location suffix omitted' },
      { runtime: 'C# / System.Text.Json', text: "'U' is an invalid escapable character within a JSON string. The string should be correctly escaped.", input: 'The same path input', source: SOURCES.stjEscape, evidence: 'Official .NET 10 resource template with U substituted; path and location omitted' },
      { runtime: 'C# / Json.NET', text: 'Bad JSON escape sequence: \\U.', input: 'The same path input', source: SOURCES.newtonsoftEscape, evidence: 'Json.NET 13.0.4 source template; path, line and position suffix omitted' },
      { runtime: 'PHP / json_last_error_msg()', text: 'Syntax error', input: 'The same path input', source: SOURCES.phpEscape, evidence: 'Official PHP 8.5 scanner rule: an invalid escape is JSON_ERROR_SYNTAX' },
    ],
    causes: [
      { title: 'A Windows path was written into JSON by hand', text: 'In JSON text every backslash that belongs to the value is doubled, as in C:\\\\Users\\\\ada. String.raw keeps the single backslashes here, as a file or HTTP body would.', lang: 'javascript', code: `const text = String.raw\`{"path":"C:\\Users\\ada"}\`;
JSON.parse(text);
// Bad escaped character in JSON at position 12` },
      { title: 'A regular expression was copied into a value', text: 'The pattern \\d+ must be written as \\\\d+ inside a JSON string.', lang: 'python', code: `import json
json.loads(r'{"pattern": "\\d+"}')
# Invalid \\escape: line 1 column 14 (char 13)` },
      { title: "A \\' escape came from JavaScript or SQL", text: "An apostrophe needs no escape inside a double-quoted JSON string. Remove the backslash: O'Brien.", lang: 'javascript', code: `JSON.parse(String.raw\`{"name":"O\\'Brien"}\`);
// Bad escaped character in JSON at position 11` },
    ],
    steps: [
      'Find the backslash at the reported position. V8 and Firefox point at the character after it; Python points at the backslash itself.',
      "Decide what the value should contain. A literal backslash, as in a path or a pattern, needs two backslashes in JSON text. A backslash that only escaped an apostrophe in another language should be removed.",
      'Fix the producer: serialize the original string with JSON.stringify, json.dumps or your platform serializer instead of inserting raw text between quotes.',
      "Watch the source-code layer too. In JavaScript and Python a backslash in an ordinary string literal is already an escape, so JSON written by hand in code needs String.raw or a Python raw string.",
    ],
    fixes: [
      { title: 'Serialize paths and patterns in JavaScript', text: 'The JavaScript literals below contain single backslashes after parsing. JSON.stringify doubles them in the JSON text.', lang: 'javascript', code: `const value = { path: 'C:\\\\Users\\\\ada', pattern: '\\\\d+', name: "O'Brien" };
const text = JSON.stringify(value);
console.log(text); // {"path":"C:\\\\Users\\\\ada","pattern":"\\\\d+","name":"O'Brien"}
console.log(JSON.parse(text).path); // C:\\Users\\ada` },
      { title: 'Serialize in Python and use raw strings for literals', text: 'Raw strings keep backslashes for the value; json.dumps escapes them for JSON.', lang: 'python', code: `import json
value = {"path": r"C:\\Users\\ada", "pattern": r"\\d+"}
text = json.dumps(value)
print(text)  # {"path": "C:\\\\Users\\\\ada", "pattern": "\\\\d+"}
assert json.loads(text) == value` },
    ],
    faq: [
      { question: 'Which escapes are valid in JSON?', answer: 'A backslash followed by a double quote, a backslash, a forward slash, b, f, n, r or t, or by u and four hexadecimal digits. Every other character after a backslash is an error in a strict parser.' },
      { question: "Why does \\' fail when JavaScript accepts it?", answer: "JavaScript string literals allow \\' because they can be delimited by single quotes. JSON strings are always double-quoted, so an apostrophe needs no escape and \\' is invalid." },
      { question: 'Should I replace backslashes with forward slashes?', answer: 'Only if the receiver treats them as the same thing, because that changes the data. Escaping the backslash keeps the original value.' },
      { question: 'Does Python strict=False allow invalid escapes?', answer: 'No. strict=False only allows raw control characters inside strings. An invalid escape such as \\U still raises Invalid \\escape.' },
      { question: 'Can Tool Kumar repair invalid escapes?', answer: "The validator marks each invalid escape with its position. Its repair removes the backslash and keeps the next character. That is right for \\' but turns C:\\Users into C:Users, so for paths and patterns fix the producer instead." },
    ],
    related: ['bad-control-character', 'expecting-comma-delimiter', 'single-quotes-unquoted-keys'],
  },
  {
    slug: 'firefox-unexpected-character',
    published: '2026-10-15',
    updated: '2026-10-24',
    title: 'JSON.parse: unexpected character at line 1 column 1 of the JSON data',
    description: 'Decode the Firefox JSON.parse error: what the first character means, how line and column are counted, and the Chrome, Safari and Node wording for the same input.',
    queries: ['json.parse: unexpected character at line 1 column 1 of the json data', 'syntaxerror: json.parse: unexpected character', 'json.parse: unexpected character at line 1 column 2 of the json data', 'json.parse: unexpected keyword at line 1 column 1 of the json data'],
    meaning: "This is Firefox's wording for a JSON.parse failure. Line 1 column 1 means the very first character cannot start a JSON value. A value can only start with {, [, a double quote, a digit, a minus sign, or the first letter of true, false or null. So the text is usually not JSON at all: an HTML page, a PHP warning printed before the JSON, a plain-text error, the word undefined, or an invisible byte-order mark. Firefox counts lines and columns from 1, skips leading spaces and newlines, and reports the character it rejected.",
    messages: [
      { runtime: 'Firefox', text: 'SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data', input: 'JSON.parse("<!DOCTYPE html>")', source: SOURCES.firefoxUnexpectedChar, evidence: 'Source-derived from Firefox 158 JSONParser.cpp and its message template' },
      { runtime: 'Firefox, after a newline', text: 'SyntaxError: JSON.parse: unexpected character at line 2 column 1 of the JSON data', input: 'JSON.parse("\\n<br />")', source: SOURCES.firefoxPosition, evidence: 'Source-derived: lines and columns are counted from 1 up to the rejected character' },
      { runtime: 'Firefox, a word', text: 'SyntaxError: JSON.parse: unexpected keyword at line 1 column 1 of the JSON data', input: 'JSON.parse("not found")', source: SOURCES.firefoxKeyword, evidence: 'Source-derived: a word starting with t, f or n that is not true, false or null' },
      { runtime: 'Firefox, empty input', text: 'SyntaxError: JSON.parse: unexpected end of data at line 1 column 1 of the JSON data', input: 'JSON.parse("")', source: SOURCES.firefoxEnd, evidence: 'Source-derived from Firefox 158 JSONParser.cpp' },
      { runtime: 'Chrome, Edge, Node.js / V8', text: `SyntaxError: Unexpected token '<', "<!DOCTYPE html>" is not valid JSON`, input: 'JSON.parse("<!DOCTYPE html>")', evidence: node },
      { runtime: 'Safari / JavaScriptCore', text: "JSON Parse error: Unrecognized token '<'", input: 'The same input', source: SOURCES.jscUnrecognized, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix' },
      { runtime: 'V8, byte-order mark', text: `SyntaxError: Unexpected token '\uFEFF', "\uFEFF{"a":1}" is not valid JSON`, input: 'JSON.parse("\\uFEFF{\\"a\\":1}"); the quoted token is an invisible U+FEFF', evidence: node },
      { runtime: 'Python, byte-order mark', text: 'json.decoder.JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)', input: `json.loads('\\ufeff{"a":1}')`, evidence: python },
    ],
    causes: [
      { title: 'A < starts an HTML page or a PHP warning', text: 'A login page, an error page or a PHP notice printed with display_errors on starts with <. If a newline comes first, Firefox reports line 2 column 1 instead. The HTML-response guide shows how to find which request returned it.', lang: 'javascript', code: `const body = '<br />\\n<b>Warning</b>: Undefined variable $id';
JSON.parse(body);
// Firefox: JSON.parse: unexpected character at line 1 column 1 of the JSON data` },
      { title: 'A letter starts plain text or undefined', text: 'Text such as Internal Server Error, or the string undefined, starts with a letter that cannot begin a value. A word starting with n, t or f, such as not found, gives unexpected keyword in Firefox.', lang: 'javascript', code: `JSON.parse('Internal Server Error');
// Node: Unexpected token 'I', "Internal S"... is not valid JSON` },
      { title: 'An invisible byte-order mark comes first', text: 'In Node.js, fs.readFileSync(path, "utf8") keeps a UTF-8 BOM as the character U+FEFF, and JSON.parse rejects it. In browsers, response.text() and response.json() remove a leading UTF-8 BOM, so this cause is rarer there.', lang: 'javascript', code: `import { readFileSync, writeFileSync } from 'node:fs';
writeFileSync('bom.json', '\\uFEFF{"a":1}');
JSON.parse(readFileSync('bom.json', 'utf8'));
// SyntaxError: Unexpected token ... is not valid JSON (the token is U+FEFF)` },
    ],
    steps: [
      'Look at the raw text. In DevTools, open the failing request in the Network panel and check its status, Content-Type and response body.',
      'Log the start of the text: console.log(text.slice(0, 80)) shows HTML or a PHP warning by its first tag. Invisible characters need their code points: [...text.slice(0, 8)].map((c) => c.codePointAt(0).toString(16)) lists feff first for a byte-order mark, which JSON.stringify leaves unescaped.',
      'Use the first character: < (3c) means HTML, a letter means plain text or undefined, and feff means a byte-order mark. An empty body gives unexpected end of data instead.',
      'Fix the source: the URL, the session, the server error or the PHP warning. If the column is greater than 1, the text starts as JSON and breaks later, so match the rest of the message to the related guides.',
    ],
    fixes: [
      { title: 'Read the body once and report what arrived', text: 'The error message then shows the first characters instead of a bare position. JSON.stringify escapes quotes and control characters but leaves a byte-order mark and other invisible format characters as they are, so the preview escapes those too.', lang: 'javascript', code: `async function readJson(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}: \${preview(text)}\`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(\`Expected JSON, got \${preview(text)}\`, { cause: error });
  }
}

// The first characters, quoted, with invisible ones written as escapes:
// a byte-order mark shows as \\u{feff}.
function preview(text) {
  return JSON.stringify(text.slice(0, 80))
    .replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, (c) => \`\\\\u{\${c.codePointAt(0).toString(16)}}\`);
}` },
      { title: 'Remove one byte-order mark from a file in Node.js', text: 'Strip only a leading U+FEFF, and only where you read the file.', lang: 'javascript', code: `import { readFileSync } from 'node:fs';
const raw = readFileSync('bom.json', 'utf8');
const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
console.log(JSON.parse(text)); // { a: 1 }` },
    ],
    faq: [
      { question: 'Is this error specific to Firefox?', answer: 'The wording is. Chrome, Edge and Node.js say Unexpected token followed by the character, and Safari says JSON Parse error: Unrecognized token. The input and the fix are the same.' },
      { question: 'Why line 1 column 1 when the response looks like JSON?', answer: 'You may be looking at a different request, or the JSON is preceded by something you cannot see, such as a byte-order mark. Log the code points of the first characters of the exact text you pass to JSON.parse: a byte-order mark is feff.' },
      { question: 'What does unexpected keyword mean?', answer: 'The text starts with t, f or n, but the word is not true, false or null. A plain-text reply such as not found, or a typo such as nul, causes it.' },
      { question: 'What do the other Firefox JSON.parse messages mean?', answer: "expected property name or '}' points to quoting or a trailing comma. expected ',' or '}' after property value in object points to a missing comma or an unescaped quote. bad escaped character and bad control character in string literal point to string escaping. unexpected non-whitespace character after JSON data means extra data, and unexpected end of data means empty or truncated input." },
    ],
    related: ['unexpected-token-html', 'unexpected-end-of-json-input', 'undefined-is-not-valid-json', 'php-json-decode-null', 'expecting-comma-delimiter'],
  },
  {
    slug: 'php-json-decode-null',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'PHP json_decode returns null: Syntax error and other causes',
    description: 'Find out why json_decode returns null with JSON_THROW_ON_ERROR or json_last_error_msg, then fix syntax errors, BOMs, invalid UTF-8 and depth limits.',
    queries: ['json_decode returns null', 'php json_decode null', 'json_last_error_msg syntax error', 'json_decode syntax error valid json', 'jsonexception syntax error'],
    meaning: 'json_decode returns null when decoding fails, and also when the JSON text is literally null. Without flags it does not say why. Pass JSON_THROW_ON_ERROR (PHP 7.3 and later) to get a JsonException, or call json_last_error_msg() right after the call. Syntax error covers most malformed input: a UTF-8 byte-order mark, single quotes, trailing commas, comments, invalid escapes, an empty string or HTML printed before the JSON. Invalid UTF-8 and control characters have their own messages. PHP does not report where the error is.',
    checked: 'PHP messages cited from php-src 8.5.11 source',
    messages: [
      { runtime: 'PHP / json_last_error_msg()', text: 'Syntax error', input: `json_decode("{'id': 1}")`, source: SOURCES.phpSyntax, evidence: 'Official php-src 8.5.11 message; json_last_error() returns 4 (JSON_ERROR_SYNTAX)' },
      { runtime: 'PHP / JSON_THROW_ON_ERROR', text: 'JsonException: Syntax error', input: 'json_decode($json, flags: JSON_THROW_ON_ERROR)', source: SOURCES.phpThrow, evidence: 'Official php-src 8.5.11 source: same message, exception code 4' },
      { runtime: 'PHP, byte-order mark', text: 'Syntax error', input: '"\\xEF\\xBB\\xBF{}", a UTF-8 BOM before the JSON', source: SOURCES.phpBom, evidence: 'php-src 8.5.11 scanner: a UTF-8 character outside a string is a syntax error' },
      { runtime: 'PHP, empty string', text: 'Syntax error', input: "json_decode('')", source: SOURCES.phpEmpty, evidence: 'php-src 8.5.11 json_decode: empty input sets JSON_ERROR_SYNTAX' },
      { runtime: 'PHP, invalid UTF-8', text: 'Malformed UTF-8 characters, possibly incorrectly encoded', input: 'Windows-1252 bytes such as \\xE9 inside a string', source: SOURCES.phpUtf8, evidence: 'Official php-src 8.5.11 message (JSON_ERROR_UTF8)' },
      { runtime: 'PHP, deep nesting', text: 'Maximum stack depth exceeded', input: 'Nesting deeper than the depth argument, 512 by default', source: SOURCES.phpDepth, evidence: 'Official php-src 8.5.11 message (JSON_ERROR_DEPTH)' },
      { runtime: 'PHP, valid null', text: 'No error', input: "json_decode('null') returns null", source: SOURCES.phpNoError, evidence: 'Official php-src 8.5.11 message; decoding succeeded' },
    ],
    causes: [
      { title: 'The text uses JavaScript or Python syntax', text: 'Single quotes, unquoted keys, trailing commas and comments are all reported as Syntax error, without a position.', lang: 'php', code: `<?php
var_dump(json_decode("{'id': 1}")); // NULL
echo json_last_error_msg();         // Syntax error` },
      { title: 'A byte-order mark precedes the JSON', text: 'Files saved as "UTF-8 with BOM" start with the bytes EF BB BF. file_get_contents keeps them, and json_decode rejects them.', lang: 'php', code: `<?php
$json = "\\xEF\\xBB\\xBF" . '{"id": 1}'; // as read from a file saved with a BOM
var_dump(json_decode($json)); // NULL
echo json_last_error_msg();   // Syntax error` },
      { title: 'The text is not UTF-8', text: 'JSON text must be UTF-8. An export in Windows-1252 or ISO-8859-1 fails on its first accented character.', lang: 'php', code: `<?php
$json = "{\\"name\\": \\"Ren\\xE9\\"}"; // é encoded as Windows-1252
var_dump(json_decode($json)); // NULL
echo json_last_error_msg();   // Malformed UTF-8 characters, possibly incorrectly encoded` },
    ],
    steps: [
      'Decode with JSON_THROW_ON_ERROR, or check json_last_error() immediately after json_decode. The next json_encode or json_decode call replaces the stored error.',
      'Inspect the first bytes with bin2hex(substr($json, 0, 16)). efbbbf is a byte-order mark, and 3c is <, the start of HTML or a PHP warning.',
      'Fix syntax errors where the JSON is produced. Strip a byte-order mark only where you read the file, and convert legacy encodings to UTF-8 before decoding.',
      'With exceptions enabled, a null result means the JSON text was null. Without them, compare json_last_error() with JSON_ERROR_NONE.',
    ],
    fixes: [
      { title: 'Decode with exceptions', text: 'The exception message is the same text json_last_error_msg() returns, and its code is the JSON_ERROR_* constant.', lang: 'php', code: `<?php
try {
    $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    error_log('Invalid JSON: ' . $e->getMessage() . ' (code ' . $e->getCode() . ')');
    throw $e;
}` },
      { title: 'Remove a UTF-8 byte-order mark from a file', text: 'str_starts_with needs PHP 8.0 or later.', lang: 'php', code: `<?php
$json = file_get_contents('data.json');
if (str_starts_with($json, "\\xEF\\xBB\\xBF")) {
    $json = substr($json, 3);
}
$data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);` },
      { title: 'Convert a legacy encoding first', text: 'Name the real source encoding. mb_convert_encoding needs the mbstring extension.', lang: 'php', code: `<?php
$json = mb_convert_encoding($legacy, 'UTF-8', 'Windows-1252');
$data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);` },
    ],
    faq: [
      { question: 'Why does json_decode return null for JSON that looks valid?', answer: 'Common reasons are an invisible UTF-8 byte-order mark, text that is not UTF-8, nesting deeper than the depth limit, or JSON that is literally null. Check the error message and the first bytes.' },
      { question: 'Does json_last_error_msg show where the error is?', answer: 'No. PHP reports only the kind of error. Paste the text into a validator to find the line and column.' },
      { question: 'Should I use JSON_INVALID_UTF8_IGNORE or JSON_INVALID_UTF8_SUBSTITUTE?', answer: 'They make decoding succeed by dropping invalid bytes or replacing them with U+FFFD, which changes the data. Prefer converting the text from its real encoding.' },
      { question: 'Why does JSON from a WordPress POST field fail?', answer: 'WordPress adds slashes to request data, so quotes arrive escaped with backslashes. Remove them with wp_unslash() before calling json_decode.' },
    ],
    related: ['firefox-unexpected-character', 'single-quotes-unquoted-keys', 'trailing-comma', 'bad-control-character', 'invalid-escape'],
    tools: [{ href: '/tools/json-to-php', label: 'Generate PHP classes from valid JSON' }],
    docs: [
      { href: SOURCES.phpDecode, label: 'PHP manual: json_decode' },
      { href: SOURCES.phpLastErrorMsg, label: 'PHP manual: json_last_error_msg' },
    ],
  },
  {
    slug: 'dotnet-invalid-start-of-value',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: "C# JSON: '<' is an invalid start of a value / Unexpected character",
    description: "Fix System.Text.Json '<' is an invalid start of a value and Json.NET Unexpected character encountered while parsing value, including Blazor and HttpClient cases.",
    queries: ["'<' is an invalid start of a value", 'system.text.json.jsonexception is an invalid start of a value', 'unexpected character encountered while parsing value', "unexpected character encountered while parsing value: <. path '', line 0, position 0", 'invalid json primitive'],
    meaning: "The .NET JSON reader found a character that cannot start a JSON value. System.Text.Json quotes the character, or its byte in hexadecimal such as 0xEF, and adds the JSON path, a zero-based line number and a byte position. Json.NET (Newtonsoft) names the character, the path, the line and the position. A < almost always means HTML: a wrong URL, a login redirect, an error page or, in Blazor WebAssembly, the app's index.html returned by the fallback route for an unknown path. Other characters point to plain-text errors or form data.",
    checked: 'Messages cited from .NET 10 and Json.NET 13.0.4 source',
    messages: [
      { runtime: 'C# / System.Text.Json, JsonSerializer', text: "System.Text.Json.JsonException: '<' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0.", input: 'JsonSerializer.Deserialize<Item>("<!DOCTYPE html>")', source: SOURCES.stjInvalidStart, evidence: 'Source-derived from .NET 10: resource template, reader location and serializer path' },
      { runtime: 'C# / System.Text.Json, JsonDocument', text: "'<' is an invalid start of a value. LineNumber: 0 | BytePositionInLine: 0.", input: 'JsonDocument.Parse("<!DOCTYPE html>")', source: SOURCES.stjReaderSuffix, evidence: 'Source-derived from .NET 10 ThrowHelper; no path outside the serializer' },
      { runtime: 'C# / System.Text.Json, byte-order mark', text: "'0xEF' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0.", input: 'UTF-8 bytes that still start with EF BB BF, passed as a byte array or span', source: SOURCES.stjPrintable, evidence: 'Source-derived: bytes that are not printable ASCII are written as 0x and two hex digits' },
      { runtime: 'C# / Json.NET', text: "Newtonsoft.Json.JsonReaderException: Unexpected character encountered while parsing value: <. Path '', line 0, position 0.", input: 'JsonConvert.DeserializeObject<Item>("<!DOCTYPE html>")', source: SOURCES.newtonsoftUnexpected, evidence: 'Source-derived from Json.NET 13.0.4: line is 0 until the first token is read' },
      { runtime: 'ASP.NET on .NET Framework / JavaScriptSerializer', text: 'Invalid JSON primitive: {0}.', input: 'Source template; form-encoded or other non-JSON text', source: SOURCES.aspnetPrimitive, evidence: '.NET Framework reference source resource string' },
    ],
    causes: [
      { title: 'Blazor WebAssembly receives index.html', text: 'A hosted Blazor WebAssembly or single-page app serves index.html for unknown paths, usually with status 200, so client-side routing works. A typo in an API path, or an API that is not mapped on the server, then returns that page and GetFromJsonAsync fails on its first <.', lang: 'csharp', code: `// "api/itemz" is not an API route, so the fallback returns index.html
var items = await Http.GetFromJsonAsync<List<Item>>("api/itemz");` },
      { title: 'An error page is read as JSON', text: 'ReadFromJsonAsync reads whatever body arrived and does not look at the status code. A 404, 500 or login page arrives as HTML.', lang: 'csharp', code: `using var response = await http.GetAsync("api/items");
var items = await response.Content.ReadFromJsonAsync<List<Item>>(); // the body is an HTML error page` },
      { title: 'A byte-order mark in a byte array', text: 'Stream-based reading in System.Text.Json skips a UTF-8 BOM. A byte array or span passed directly must not contain one, so its first byte 0xEF is rejected.', lang: 'csharp', code: `byte[] bytes = File.ReadAllBytes("data.json"); // file saved with a BOM
var item = JsonSerializer.Deserialize<Item>(bytes); // '0xEF' is an invalid start of a value` },
    ],
    steps: [
      'Log the status code, Content-Type and the first 200 characters of the body while debugging. ReadAsStringAsync shows exactly what the deserializer received.',
      'In Blazor, open the browser Network panel. A 200 response with text/html for an API path means the request reached the fallback route; fix the path or the server routing.',
      'Check IsSuccessStatusCode and the media type before reading JSON, and handle error pages separately.',
      'For files, read through a stream or File.ReadAllText, which handle a BOM, or strip the three BOM bytes before deserializing a byte array.',
    ],
    fixes: [
      { title: 'Check the response before deserializing', text: 'Accept other JSON media types such as application/problem+json if your API uses them.', lang: 'csharp', code: `using var response = await http.GetAsync("api/items");
var mediaType = response.Content.Headers.ContentType?.MediaType;
if (!response.IsSuccessStatusCode || mediaType != "application/json")
{
    var body = await response.Content.ReadAsStringAsync();
    throw new HttpRequestException(
        $"Expected JSON, got {(int)response.StatusCode} {mediaType}: {body[..Math.Min(body.Length, 200)]}");
}
var items = await response.Content.ReadFromJsonAsync<List<Item>>();` },
      { title: 'Remove a UTF-8 byte-order mark from bytes', text: 'The u8 literal needs C# 11 or later. "\\uFEFF"u8 is the byte sequence EF BB BF.', lang: 'csharp', code: `ReadOnlySpan<byte> json = File.ReadAllBytes("data.json");
if (json.StartsWith("\\uFEFF"u8))
{
    json = json[3..];
}
var item = JsonSerializer.Deserialize<Item>(json);` },
    ],
    faq: [
      { question: 'Why is LineNumber 0?', answer: 'System.Text.Json counts lines and byte positions from zero, so LineNumber: 0 | BytePositionInLine: 0 is the first byte of the input. Json.NET reports line 0, position 0 when the very first character fails.' },
      { question: 'Why does Blazor get index.html with status 200?', answer: 'The host serves index.html for any path it does not recognize so that client-side routes work. An API request to an unknown path gets the same page. Check the request URL and the server endpoint mapping.' },
      { question: 'What does The JSON value could not be converted to System.Int32 mean?', answer: 'The JSON is valid but a value has the wrong type for the C# property, such as "42" for an int. Change the property type, fix the producer, or allow quoted numbers with JsonNumberHandling.AllowReadingFromString.' },
      { question: 'Does ReadFromJsonAsync handle a byte-order mark?', answer: 'Yes. It reads from a stream, and System.Text.Json skips a UTF-8 BOM when it reads a stream. The BOM problem appears when bytes or spans are passed directly.' },
    ],
    related: ['unexpected-token-html', 'firefox-unexpected-character', 'jackson-unrecognized-token', 'go-invalid-character'],
    tools: [{ href: '/tools/json-to-csharp', label: 'Generate C# classes from valid JSON' }],
    docs: [{ href: SOURCES.stjStreamBom, label: 'System.Text.Json source: stream reading skips a UTF-8 BOM' }],
  },
  {
    slug: 'jackson-unrecognized-token',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: "Jackson: Unrecognized token / Unexpected character ('<' (code 60))",
    description: "Diagnose Jackson JsonParseException messages such as Unrecognized token 'abc' and Unexpected character ('<' (code 60)), including Spring JSON parse error responses.",
    queries: ['jsonparseexception unrecognized token was expecting', "unexpected character ('<' (code 60)): expected a valid value", 'json parse error: unrecognized token', "unrecognized token was expecting (json string, number, array, object or token 'null', 'true' or 'false')"],
    meaning: "Jackson's parser reached a place where a JSON value must start and found something else. If the text there looks like a word, Jackson reports Unrecognized token and quotes the word. Otherwise it reports Unexpected character with the character and its code point. The input is usually not JSON (an HTML page, a plain-text error or a form-encoded body), or a value is written without quotes, or it uses a literal from another language such as undefined, True or None. Spring shows the same text after JSON parse error: in a 400 response.",
    checked: 'Messages cited from Jackson 2.9, 2.22 and 3.2 source',
    messages: [
      { runtime: 'Java / Jackson 2.10+ and 3.x', text: "Unrecognized token 'undefined': was expecting (JSON String, Number, Array, Object or token 'null', 'true' or 'false')", input: '{"id": undefined}', source: SOURCES.jacksonToken, evidence: 'Source-derived from the Jackson 2.22 template and value list; location suffix omitted' },
      { runtime: 'Java / Jackson 2.10+ and 3.x, symbol', text: "Unexpected character ('<' (code 60)): expected a valid value (JSON String, Number, Array, Object or token 'null', 'true' or 'false')", input: '<!DOCTYPE html>', source: SOURCES.jacksonChar, evidence: 'Source-derived from Jackson 2.22; location suffix omitted' },
      { runtime: 'Java / Jackson 2.9 and earlier', text: "Unrecognized token 'undefined': was expecting ('true', 'false' or 'null')", input: '{"id": undefined}', source: SOURCES.jackson29Token, evidence: 'Source-derived from the Jackson 2.9.10 template' },
      { runtime: 'Java / Jackson 2.9, symbol', text: "Unexpected character ('<' (code 60)): expected a valid value (number, String, array, object, 'true', 'false' or 'null')", input: '<!DOCTYPE html>', source: SOURCES.jackson29Char, evidence: 'Source-derived from the Jackson 2.9.10 template' },
      { runtime: 'Java / Jackson, NaN', text: "Non-standard token 'NaN': enable `JsonReadFeature.ALLOW_NON_NUMERIC_NUMBERS` to allow", input: '{"score": NaN}', source: SOURCES.jacksonNaN, evidence: 'Official Jackson 2.22 source text' },
      { runtime: 'Spring MVC', text: "JSON parse error: Unrecognized token 'undefined': was expecting (JSON String, Number, Array, Object or token 'null', 'true' or 'false')", input: 'A @RequestBody with the same body', source: SOURCES.springPrefix, evidence: 'Spring Framework 7.0.9 source: JSON parse error: plus the original Jackson message' },
    ],
    causes: [
      { title: 'The body is HTML or plain text', text: 'An error page, a login redirect or a proxy page starts with <, which Jackson reports as Unexpected character. A plain-text message starts with a word and becomes Unrecognized token.', lang: 'java', code: `ObjectMapper mapper = new ObjectMapper();
mapper.readTree("<!DOCTYPE html>");
// Unexpected character ('<' (code 60)): expected a valid value ...
mapper.readTree("Service Unavailable");
// Unrecognized token 'Service': was expecting ...` },
      { title: 'A value has no quotes or comes from another language', text: 'JSON strings need double quotes, and the only literals are true, false and null in lower case. Python True and None, JavaScript undefined and bare words all fail.', lang: 'java', code: `mapper.readTree("{\\"status\\": active}");
// Unrecognized token 'active': was expecting ...
mapper.readTree("{\\"ok\\": True}");
// Unrecognized token 'True': was expecting ...` },
      { title: 'A form-encoded body is sent as JSON', text: 'A client that sends name=Ada&age=36 with Content-Type: application/json makes Jackson read the first word as a token.', lang: 'java', code: `mapper.readTree("name=Ada&age=36");
// Unrecognized token 'name': was expecting ...` },
    ],
    steps: [
      'Capture the exact text Jackson received. The quoted token or character is the first thing that is not JSON, and the location suffix gives its line and column.',
      'For HTML or plain text, fix the URL, authentication or upstream error, and check the HTTP status and Content-Type before calling readValue.',
      'For unquoted values or literals such as True, None, NaN or undefined, fix the producer so it writes standard JSON.',
      'Enable lenient JsonReadFeature options such as ALLOW_SINGLE_QUOTES or ALLOW_NON_NUMERIC_NUMBERS only when you deliberately accept that non-standard input.',
    ],
    fixes: [
      { title: 'Check the HTTP response before parsing', text: 'Uses java.net.http (Java 11 and later) inside a method that declares throws Exception. In Jackson 3, ObjectMapper and JsonNode are in tools.jackson.databind.', lang: 'java', code: `HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder(URI.create("https://example.com/api/items"))
    .header("Accept", "application/json")
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
String type = response.headers().firstValue("Content-Type").orElse("");
if (response.statusCode() / 100 != 2 || !type.startsWith("application/json")) {
    String body = response.body();
    throw new IllegalStateException("Expected JSON, got " + response.statusCode() + " " + type
        + ": " + body.substring(0, Math.min(body.length(), 200)));
}
JsonNode data = new ObjectMapper().readTree(response.body());` },
    ],
    faq: [
      { question: 'What is the difference between Unrecognized token and Unexpected character?', answer: 'Jackson reports Unrecognized token when the unexpected text starts like a Java identifier, and quotes the whole word. Anything else, such as <, a single quote or another symbol, is reported as Unexpected character with its code point.' },
      { question: 'Why does Spring return 400 with JSON parse error?', answer: 'Spring wraps the Jackson exception in HttpMessageNotReadableException and puts JSON parse error: before the original message. The request body is not valid JSON, so log it or reproduce the request to see the token.' },
      { question: 'Which exception class is it?', answer: 'Jackson 2 throws com.fasterxml.jackson.core.JsonParseException. Jackson 3 throws tools.jackson.core.exc.StreamReadException. The message text is the same.' },
      { question: 'Can Jackson accept single quotes or NaN?', answer: 'Yes, with JsonReadFeature.ALLOW_SINGLE_QUOTES, ALLOW_UNQUOTED_FIELD_NAMES or ALLOW_NON_NUMERIC_NUMBERS enabled on a JsonMapper builder. Use them only when your input contract allows that syntax, because other parsers will still reject it.' },
    ],
    related: ['jackson-cannot-deserialize', 'jackson-unrecognized-field', 'unexpected-token-html', 'single-quotes-unquoted-keys'],
    tools: [{ href: '/tools/json-to-java', label: 'Generate Java records with Jackson annotations from valid JSON' }],
  },
  {
    slug: 'circular-structure',
    kind: 'serialize',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'TypeError: Converting circular structure to JSON',
    description: 'Read the V8 circular path, find the property that closes the loop and serialize plain data instead. Covers Firefox, Safari, Python, Go, .NET and Jackson.',
    queries: ['typeerror: converting circular structure to json', "converting circular structure to json --> starting at object with constructor 'object'", "converting circular structure to json starting at object with constructor 'clientrequest'", 'typeerror: cyclic object value', 'valueerror: circular reference detected'],
    meaning: 'JSON can only describe trees, where each object or array sits inside one parent. JSON.stringify met an object that refers back to itself or to an object it is still serializing, so the output would never end. V8 prints the loop as a path: the --> line is where the cycle starts, each | line is one step, and the --- line names the property that points back. Typical sources are parent links in trees, framework objects such as HTTP requests and sockets, DOM nodes, and ORM entities with two-way relations.',
    messages: [
      { runtime: 'JavaScript / V8', text: 'TypeError: Converting circular structure to JSON', input: 'const a = {}; a.self = a; JSON.stringify(a)', evidence: `${node}; V8 adds the path lines shown in the examples` },
      { runtime: 'Firefox', text: 'TypeError: cyclic object value', input: 'The same input', source: SOURCES.firefoxCyclic, evidence: 'Official SpiderMonkey message, Firefox 158 source' },
      { runtime: 'Safari / JavaScriptCore', text: 'TypeError: JSON.stringify cannot serialize cyclic structures.', input: 'The same input', source: SOURCES.jscCyclic, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1)' },
      { runtime: 'Python', text: 'ValueError: Circular reference detected', input: "a = {}; a['self'] = a; json.dumps(a)", evidence: python },
      { runtime: 'Python 3.14+, note', text: "when serializing dict item 'self'", input: 'Printed under the ValueError', source: SOURCES.py314Note, evidence: 'Reproduced in Python 3.14.4; notes were added in CPython 3.14' },
      { runtime: 'Go / encoding/json', text: 'json: unsupported value: encountered a cycle via *main.Node', input: 'json.Marshal of a *Node whose Next field points back to it', source: SOURCES.goCycle, evidence: 'Source-derived from Go 1.27 encode.go; Go starts checking after 1000 nested pointers' },
      { runtime: 'C# / System.Text.Json', text: 'A possible object cycle was detected. This can either be due to a cycle or if the object depth is larger than the maximum allowed depth of 64. Consider using ReferenceHandler.Preserve on JsonSerializerOptions to support cycles.', input: 'Two objects that reference each other', source: SOURCES.stjCycle, evidence: 'Official .NET 10 resource string with the default depth of 64; path omitted' },
      { runtime: 'C# / Json.NET', text: "Self referencing loop detected for property '{0}' with type '{1}'.", input: 'Source template', source: SOURCES.newtonsoftLoop, evidence: 'Json.NET 13.0.4 source template; path suffix omitted' },
      { runtime: 'Java / Jackson', text: 'Infinite recursion (StackOverflowError)', input: 'Two entities that reference each other', source: SOURCES.jacksonRecursion, evidence: 'Official Jackson 2.22 source text; the reference chain follows' },
    ],
    causes: [
      { title: 'A child keeps a reference to its parent', text: 'Trees with parent links, linked lists and graphs all contain cycles. The --- line names the back-reference, here the parent property of the child.', lang: 'javascript', code: `const parent = { name: 'root' };
const child = { name: 'leaf', parent };
parent.child = child;
JSON.stringify(parent);
// TypeError: Converting circular structure to JSON
//     --> starting at object with constructor 'Object'
//     |     property 'child' -> object with constructor 'Object'
//     --- property 'parent' closes the circle` },
      { title: 'A Node.js HTTP object was serialized', text: 'Requests, responses, sockets and HTTP client errors hold references to each other. Passing one to JSON.stringify, to res.json or to a logger that stringifies prints a path through ClientRequest, Socket or HTTPParser. Serialize the fields you need instead, such as the status code and the body.', lang: 'javascript', code: `import http from 'node:http';
const request = http.get('http://example.com/');
request.on('error', () => {});
JSON.stringify(request);
// TypeError: Converting circular structure to JSON
//     --> starting at object with constructor 'ClientRequest'
//     |     property 'agent' -> object with constructor 'Agent'
//     |     property 'sockets' -> object with constructor 'Object'
//     |     ...
//     |     index 0 -> object with constructor 'Socket'
//     --- property '_httpMessage' closes the circle` },
      { title: 'Two records reference each other', text: 'An ORM or a hand-built model often links a customer to orders and each order back to the customer. Python 3.14 lists the path in notes, from the inner value outward.', lang: 'python', code: `import json
customer = {"name": "Ada"}
order = {"id": 7, "customer": customer}
customer["orders"] = [order]
json.dumps(customer)
# ValueError: Circular reference detected
# when serializing dict item 'customer'
# when serializing list item 0
# when serializing dict item 'orders'` },
    ],
    steps: [
      'Read the path. In V8 the --- line names the property that points back. In Python 3.14 the notes list the path from the inner value outward.',
      'Decide what the receiver needs from that reference. Usually an ID is enough, not the whole parent object.',
      'Serialize plain data built for output: pick the fields, replace back-references with IDs, or give the class a toJSON method that does this.',
      'For logs, use a logger or util.inspect, which marks cycles as [Circular *1] instead of throwing.',
    ],
    fixes: [
      { title: 'Send IDs instead of back-references', text: 'An explicit output shape also keeps internal fields out of the JSON.', lang: 'javascript', code: `const parent = { id: 1, name: 'root', children: [] };
const child = { id: 2, name: 'leaf', parent };
parent.children.push(child);

const text = JSON.stringify({
  id: parent.id,
  name: parent.name,
  children: parent.children.map(c => ({ id: c.id, name: c.name, parentId: c.parent.id })),
});
console.log(text);
// {"id":1,"name":"root","children":[{"id":2,"name":"leaf","parentId":1}]}` },
      { title: 'Replace only real cycles with a replacer', text: 'Use this for diagnostics or when the receiver accepts a placeholder. Unlike a WeakSet of every object seen, it keeps an object that two branches share and replaces only references back to an ancestor. It must be a function expression because it reads this.', lang: 'javascript', code: `function withoutCycles() {
  const ancestors = [];
  return function (key, value) {
    if (typeof value !== 'object' || value === null) return value;
    // \`this\` is the object that holds \`key\`; drop entries that are not its ancestors
    while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
    if (ancestors.includes(value)) return '[Circular]';
    ancestors.push(value);
    return value;
  };
}

const shared = { label: 'shared' };
const node = { a: shared, b: shared };
node.self = node;
console.log(JSON.stringify(node, withoutCycles()));
// {"a":{"label":"shared"},"b":{"label":"shared"},"self":"[Circular]"}` },
      { title: 'Build a Python payload with IDs', text: 'Choose the fields to send and refer to related records by ID.', lang: 'python', code: `import json
customer = {"id": 1, "name": "Ada"}
order = {"id": 7, "customer": customer}
customer["orders"] = [order]
payload = {
    "id": customer["id"],
    "name": customer["name"],
    "orders": [{"id": o["id"], "customer_id": o["customer"]["id"]} for o in customer["orders"]],
}
print(json.dumps(payload))
# {"id": 1, "name": "Ada", "orders": [{"id": 7, "customer_id": 1}]}` },
    ],
    faq: [
      { question: 'What does closes the circle mean?', answer: 'The property on the --- line points back to an object that is already on the path being serialized. Leaving out or replacing that one reference in the output breaks the loop.' },
      { question: 'Why does the error mention ClientRequest, Socket or HTTPParser?', answer: 'A Node.js HTTP object reached JSON.stringify, directly or through res.json, a logger or an HTTP client error that holds the request. Serialize only the data you need, such as the status code and the response body.' },
      { question: 'Is a WeakSet replacer safe?', answer: 'A replacer that drops every object it has seen before also removes shared objects that are not circular, so data disappears silently. Track only the ancestors of the current value, as the replacer above does.' },
      { question: 'How do I fix it in .NET or Java?', answer: 'System.Text.Json: set ReferenceHandler to IgnoreCycles or Preserve. Json.NET: use ReferenceLoopHandling.Ignore. Jackson: use @JsonManagedReference and @JsonBackReference, or @JsonIgnore on the back-reference. A DTO without back-references works everywhere.' },
    ],
    related: ['bigint-serialize', 'not-json-serializable', 'undefined-is-not-valid-json'],
    docs: [
      { href: SOURCES.v8CircularPath, label: 'V8 source: how the circular path is built' },
      { href: SOURCES.mdnCyclic, label: 'MDN: TypeError: cyclic object value' },
      { href: SOURCES.dotnetPreserve, label: 'Microsoft Learn: preserve references and handle cycles in System.Text.Json' },
    ],
  },
  {
    slug: 'bigint-serialize',
    kind: 'serialize',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'TypeError: Do not know how to serialize a BigInt',
    description: 'Serialize BigInt values without losing precision. Choose strings, JSON.rawJSON or a replacer, and read large integer IDs back safely in JavaScript.',
    queries: ['typeerror: do not know how to serialize a bigint', 'prisma do not know how to serialize a bigint', "bigint value can't be serialized in json", 'json.stringify bigint'],
    meaning: 'JSON.stringify has no built-in representation for BigInt, so it throws instead of guessing. JSON text itself allows integers of any length, but a JavaScript number holds integers exactly only up to 9007199254740991 (Number.MAX_SAFE_INTEGER). Converting a BigInt to a number can silently change it. The error usually comes from 64-bit integer database columns that a driver or ORM returns as BigInt, from blockchain libraries, or from values written with the n suffix.',
    messages: [
      { runtime: 'JavaScript / V8', text: 'TypeError: Do not know how to serialize a BigInt', input: 'JSON.stringify({ id: 1n })', evidence: node },
      { runtime: 'Firefox', text: "TypeError: BigInt value can't be serialized in JSON", input: 'The same input', source: SOURCES.firefoxBigInt, evidence: 'Official SpiderMonkey message, Firefox 158 source' },
      { runtime: 'Safari / JavaScriptCore', text: 'TypeError: JSON.stringify cannot serialize BigInt.', input: 'The same input', source: SOURCES.jscBigInt, evidence: 'JavaScriptCore source (WebKit tag webkitgtk-2.54.1)' },
      { runtime: 'JavaScript, reading a large integer', text: 'No error: the value becomes 9007199254740992', input: `JSON.parse('{"id":9007199254740993}').id`, evidence: node },
    ],
    causes: [
      { title: 'A database column arrives as BigInt', text: 'Drivers and ORMs can map 64-bit integer columns to BigInt; the Prisma documentation shows this exact error for its BigInt fields. The object looks normal until it is serialized.', lang: 'javascript', code: `const row = { id: 9007199254740993n, name: 'Ada' }; // for example, a BIGINT column
JSON.stringify(row);
// TypeError: Do not know how to serialize a BigInt` },
      { title: 'A framework serializes the response for you', text: 'Response.json, res.json and similar helpers call JSON.stringify internally, so the stack trace points into the framework rather than your code.', lang: 'javascript', code: `Response.json({ id: 1n });
// TypeError: Do not know how to serialize a BigInt` },
      { title: 'Converting to Number changes the value', text: 'Number() makes the error go away, but integers above Number.MAX_SAFE_INTEGER round to the nearest value a double can hold.', lang: 'javascript', code: 'console.log(Number(9007199254740993n)); // 9007199254740992' },
    ],
    steps: [
      "Find the field that holds a BigInt by checking typeof value === 'bigint' for the values you serialize.",
      'Agree on a wire format with the receiver. A decimal string is the most portable form for IDs; a JSON number is valid, but many clients read it as a double.',
      'Convert at the serialization boundary with a replacer, a toJSON method on your own class, or an output object.',
      'Read large integers back as strings or BigInt; do not let JSON.parse turn them into numbers first.',
    ],
    fixes: [
      { title: 'Send BigInt values as strings', text: 'Every JSON parser can read a string without rounding it. Convert back with BigInt() where you need arithmetic.', lang: 'javascript', code: `const row = { id: 9007199254740993n, name: 'Ada' };
const text = JSON.stringify(row, (key, value) =>
  typeof value === 'bigint' ? value.toString() : value);
console.log(text); // {"id":"9007199254740993","name":"Ada"}
console.log(BigInt(JSON.parse(text).id) === row.id); // true` },
      { title: 'Write an exact JSON number with JSON.rawJSON', text: 'MDN lists JSON.rawJSON as Baseline 2025, and Node.js 24 supports it. The receiver must also read the number without rounding.', lang: 'javascript', code: `const row = { id: 9007199254740993n };
const text = JSON.stringify(row, (key, value) =>
  typeof value === 'bigint' ? JSON.rawJSON(value.toString()) : value);
console.log(text); // {"id":9007199254740993}` },
      { title: 'Read a large integer without rounding', text: 'The third reviver argument, context, holds the source text of each primitive value. Check browser support on MDN before relying on it in browser code.', lang: 'javascript', code: `const text = '{"id":9007199254740993}';
console.log(JSON.parse(text).id); // 9007199254740992
const data = JSON.parse(text, (key, value, context) =>
  key === 'id' ? BigInt(context.source) : value);
console.log(data.id); // 9007199254740993n` },
    ],
    faq: [
      { question: 'Does JSON support big integers?', answer: 'The JSON grammar allows any number of digits. RFC 8259 warns that many implementations use IEEE 754 double precision, so integers outside the range -(2^53)+1 to (2^53)-1 may not be read exactly. Send IDs as strings when you do not control the receiver.' },
      { question: 'Should I add BigInt.prototype.toJSON?', answer: 'It works, but it changes JSON.stringify for every BigInt in the process, including inside libraries, and the receiver still gets a string. A replacer at the call site keeps the decision local.' },
      { question: 'Why not convert with Number()?', answer: 'Number() rounds integers above 9007199254740991. 9007199254740993n becomes 9007199254740992, which is a different ID.' },
      { question: 'Can I inspect large numbers without rounding?', answer: "Tool Kumar's viewer keeps each number's original digits, so 64-bit IDs in a JSON document are shown exactly. JSON.parse in your own code still needs one of the approaches above." },
    ],
    related: ['circular-structure', 'not-json-serializable', 'undefined-is-not-valid-json'],
    tools: [{ href: '/', label: 'Inspect large numbers without rounding in the JSON viewer' }],
    docs: [
      { href: SOURCES.mdnBigInt, label: "MDN: TypeError: BigInt value can't be serialized in JSON" },
      { href: SOURCES.mdnRawJson, label: 'MDN: JSON.rawJSON()' },
      { href: SOURCES.mdnParse, label: 'MDN: JSON.parse() reviver and context' },
      { href: SOURCES.prismaBigInt, label: 'Prisma documentation: serializing BigInt' },
    ],
  },
  {
    slug: 'not-json-serializable',
    kind: 'serialize',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'TypeError: Object of type … is not JSON serializable',
    description: 'Fix Python json.dumps errors for datetime, Decimal, set, bytes, UUID, NumPy values and custom classes, plus NaN values rejected with allow_nan=False.',
    queries: ['object of type datetime is not json serializable', 'typeerror: object of type is not json serializable', 'object of type decimal is not json serializable', 'object of type int64 is not json serializable', 'out of range float values are not json compliant'],
    meaning: "json.dumps converts only dict, list, tuple, str, int, float, bool and None, plus int- and float-derived enums. For any other object it calls the encoder's default method, which raises this TypeError unless you supply a conversion. The type name in the message tells you what to convert. Python 3.14 adds notes such as when serializing dict item 'created' that show where the value was found. A related ValueError, Out of range float values are not JSON compliant, appears for NaN and infinity when allow_nan=False.",
    messages: [
      { runtime: 'Python 3.7+', text: 'TypeError: Object of type datetime is not JSON serializable', input: "json.dumps({'created': datetime(2026, 10, 15, 9, 30)})", evidence: python },
      { runtime: 'Python 3.14+, note', text: "when serializing dict item 'created'", input: 'Printed under the TypeError', source: SOURCES.py314Note, evidence: 'Reproduced in Python 3.14.4; notes were added in CPython 3.14' },
      { runtime: 'Python 3.6', text: "TypeError: Object of type 'datetime' is not JSON serializable", input: 'The same input', source: SOURCES.py36Encoder, evidence: 'CPython 3.6.0 source template' },
      { runtime: 'Python 3.5 and earlier', text: 'TypeError: datetime.datetime(2026, 10, 15, 9, 30) is not JSON serializable', input: 'The same input', source: SOURCES.py35Encoder, evidence: 'Source-derived from CPython 3.5.0: the repr of the value, then the message' },
      { runtime: 'Python, dictionary keys', text: 'TypeError: keys must be str, int, float, bool or None, not tuple', input: "json.dumps({(1, 2): 'x'})", evidence: python },
      { runtime: 'Python 3.12+, NaN', text: 'ValueError: Out of range float values are not JSON compliant: nan', input: "json.dumps({'x': float('nan')}, allow_nan=False)", evidence: python },
      { runtime: 'Python 3.11 and earlier, NaN', text: 'ValueError: Out of range float values are not JSON compliant', input: 'The same input', source: SOURCES.py311Nan, evidence: 'CPython 3.11.0 C encoder message, without the value' },
      { runtime: 'JavaScript / V8, reading Python NaN', text: `SyntaxError: Unexpected token 'N', "{"x": NaN}" is not valid JSON`, input: "JSON.parse of json.dumps({'x': float('nan')}) output", evidence: node },
    ],
    causes: [
      { title: 'Dates, Decimal and UUID values', text: 'datetime, date, Decimal and UUID have no JSON type. Database rows and ORM objects are full of them.', lang: 'python', code: `import json
from datetime import datetime
json.dumps({"created": datetime(2026, 10, 15, 9, 30)})
# TypeError: Object of type datetime is not JSON serializable
# when serializing dict item 'created'` },
      { title: 'Sets, bytes, NumPy values and your own classes', text: 'A set has no JSON form, and bytes need an encoding such as base64. NumPy scalars report their own type names, such as int64 or float32, and arrays report ndarray; convert them with .item() and .tolist(). Instances of your own classes report the class name.', lang: 'python', code: `import json
json.dumps({"tags": {"admin", "staff"}})
# TypeError: Object of type set is not JSON serializable
# when serializing dict item 'tags'` },
      { title: 'NaN or infinity with allow_nan=False', text: "By default json.dumps writes NaN and Infinity, which strict JSON parsers reject. With allow_nan=False it raises instead. Starlette's JSONResponse serializes with allow_nan=False, so a NaN in response data, often from pandas, raises this error.", lang: 'python', code: `import json
json.dumps({"score": float("nan")}, allow_nan=False)
# ValueError: Out of range float values are not JSON compliant: nan
# when serializing dict item 'score'` },
    ],
    steps: [
      'Read the type name and, in Python 3.14 and later, the notes that locate the value.',
      'Choose a JSON form for that type: ISO 8601 strings for dates, strings for Decimal to keep every digit, lists for sets, base64 strings for bytes and str() for UUID.',
      'Convert at the boundary: pass default= to json.dumps, subclass JSONEncoder, or turn your own objects into dicts first.',
      'Replace NaN and infinity with None or a documented value before serializing, and keep allow_nan=False when the output must be standard JSON.',
    ],
    fixes: [
      { title: 'Convert known types with default=', text: 'json.dumps calls the function only for values it cannot serialize. Raise TypeError for anything you did not plan for. sorted() needs set items that can be compared.', lang: 'python', code: `import json
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

def to_json(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")

data = {"created": datetime(2026, 10, 15, 9, 30), "price": Decimal("9.99"),
        "id": UUID(int=1), "tags": {"staff", "admin"}}
print(json.dumps(data, default=to_json))
# {"created": "2026-10-15T09:30:00", "price": "9.99", "id": "00000000-0000-0000-0000-000000000001", "tags": ["admin", "staff"]}` },
      { title: 'Turn your own classes into dicts', text: 'dataclasses.asdict converts a dataclass, including nested dataclasses, into dicts and lists.', lang: 'python', code: `import json
from dataclasses import dataclass, asdict

@dataclass
class User:
    name: str
    active: bool

print(json.dumps(asdict(User("Ada", True))))  # {"name": "Ada", "active": true}` },
      { title: 'Replace NaN and infinity before serializing', text: 'None becomes null. Use a different placeholder only if the receiver expects it.', lang: 'python', code: `import json
import math

row = {"score": float("nan"), "total": 3.5}
clean = {k: None if isinstance(v, float) and not math.isfinite(v) else v for k, v in row.items()}
print(json.dumps(clean, allow_nan=False))  # {"score": null, "total": 3.5}` },
    ],
    faq: [
      { question: 'Why not just use default=str?', answer: 'It turns every unknown object into its str() text, including objects you did not mean to send, such as <__main__.User object at 0x...>. Handle the types you expect and raise TypeError for the rest.' },
      { question: 'How do I serialize NumPy values?', answer: 'Convert scalars with .item() and arrays with .tolist() before calling json.dumps, or do it inside a default= function.' },
      { question: 'Why does json.dumps write NaN when JSON does not allow it?', answer: 'allow_nan defaults to True, and Python then writes the JavaScript names NaN, Infinity and -Infinity. The Python documentation notes that this is not standard JSON. Set allow_nan=False to catch these values.' },
      { question: 'Should I subclass JSONEncoder or pass default=?', answer: 'Both use the same hook. default= is simpler for one call. A JSONEncoder subclass with a default method is easier to reuse, for example through cls= or a framework setting.' },
    ],
    related: ['circular-structure', 'bigint-serialize'],
    tools: [{ href: '/tools/json-to-python', label: 'Generate Pydantic models from a JSON sample' }],
    docs: [
      { href: SOURCES.starletteNan, label: 'Starlette source: JSONResponse uses allow_nan=False' },
    ],
  },
  {
    slug: 'jackson-cannot-deserialize',
    kind: 'binding',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'Jackson: Cannot deserialize value of type from Array or Object value',
    description: 'Fix Jackson MismatchedInputException when JSON arrays, objects and strings do not match your Java types, including the older START_ARRAY and START_OBJECT messages.',
    queries: ['cannot deserialize value of type from object value (token jsontoken.start_object)', 'cannot deserialize value of type java.util.arraylist from object value', 'mismatchedinputexception cannot deserialize', 'cannot deserialize instance of out of start_array token', 'can not deserialize instance of java.util.arraylist out of start_object token'],
    meaning: 'The JSON is valid, but its shape does not match the Java type Jackson was asked to build. from Object value means Jackson found a JSON object where the type expects something else, such as a list. from Array value means it found an array where it expected an object or a single value. The message names the target type and the JSON token. Versions before 2.12 said out of START_OBJECT token or out of START_ARRAY token for the same mismatch.',
    checked: 'Messages cited from Jackson 2.8 to 3.2 source',
    messages: [
      { runtime: 'Java / Jackson 2.12+ and 3.x, list target', text: 'MismatchedInputException: Cannot deserialize value of type `java.util.ArrayList<com.example.Item>` from Object value (token `JsonToken.START_OBJECT`)', input: 'readValue("{\\"items\\":[]}", new TypeReference<List<Item>>() {})', source: SOURCES.jacksonMismatch, evidence: 'Source-derived from the Jackson 2.22 template; the type text depends on your class' },
      { runtime: 'Java / Jackson 2.12+ and 3.x, object target', text: 'Cannot deserialize value of type `com.example.Item` from Array value (token `JsonToken.START_ARRAY`)', input: 'readValue("[{\\"id\\":1}]", Item.class)', source: SOURCES.jacksonMismatch, evidence: 'Source-derived from the same template' },
      { runtime: 'Java / Jackson 2.12+ and 3.x, String field', text: 'Cannot deserialize value of type `java.lang.String` from Object value (token `JsonToken.START_OBJECT`)', input: '{"address":{"city":"Pune"}} into a String address field', source: SOURCES.jacksonMismatch, evidence: 'Source-derived; the reference chain suffix is omitted' },
      { runtime: 'Java / Jackson 2.10 and 2.11', text: 'Cannot deserialize instance of `java.util.ArrayList<com.example.Item>` out of START_OBJECT token', input: 'The list example', source: SOURCES.jackson211, evidence: 'Source-derived from the Jackson 2.11.4 template' },
      { runtime: 'Java / Jackson 2.9', text: 'Cannot deserialize instance of `java.util.ArrayList` out of START_OBJECT token', input: 'The list example', source: SOURCES.jackson29Mismatch, evidence: 'Source-derived from the Jackson 2.9.10.8 template' },
      { runtime: 'Java / Jackson 2.8 and earlier', text: 'Can not deserialize instance of java.util.ArrayList out of START_OBJECT token', input: 'The list example', source: SOURCES.jackson28, evidence: 'Source-derived from the Jackson 2.8.11 template' },
      { runtime: 'C# / Json.NET', text: `Cannot deserialize the current JSON object (e.g. {"name":"value"}) into type '{0}' because the type requires a JSON array (e.g. [1,2,3]) to deserialize correctly.`, input: 'An object where a List<T> is expected', source: SOURCES.newtonsoftObject, evidence: 'Json.NET 13.0.4 source template; first sentence shown' },
      { runtime: 'Go / encoding/json', text: 'json: cannot unmarshal object into Go value of type []main.Item', input: 'The list example in Go', source: SOURCES.goUnmarshalType, evidence: 'Source-derived from Go 1.27 decode.go' },
    ],
    causes: [
      { title: 'The response wraps the list in an object', text: 'Many APIs return {"items": [...]} or {"data": [...]}. Reading that object as a List fails with from Object value.', lang: 'java', code: `record Item(long id) {}

String json = "{\\"items\\":[{\\"id\\":1}]}";
List<Item> items = new ObjectMapper().readValue(json, new TypeReference<List<Item>>() {});
// MismatchedInputException: Cannot deserialize value of type \`java.util.ArrayList<...Item>\` from Object value` },
      { title: 'One value arrives where a list is expected', text: 'Some APIs send a single object or string when there is one result and an array when there are several. A List field then sees an object or a string.', lang: 'java', code: `record Order(List<String> tags) {}

new ObjectMapper().readValue("{\\"tags\\":\\"new\\"}", Order.class);
// MismatchedInputException: Cannot deserialize value of type \`java.util.ArrayList<java.lang.String>\` from String value` },
      { title: 'A field type differs from the JSON value', text: 'A String field cannot hold a nested object, and a single object field cannot hold an array.', lang: 'java', code: `record User(String address) {}

new ObjectMapper().readValue("{\\"address\\":{\\"city\\":\\"Pune\\"}}", User.class);
// Cannot deserialize value of type \`java.lang.String\` from Object value (token \`JsonToken.START_OBJECT\`)` },
    ],
    steps: [
      'Read the target type and the JSON token. The (through reference chain: ...) suffix names the class and property where it failed.',
      'Look at the JSON at that property. An object starts with {, an array with [.',
      'Change the Java type to match: a wrapper record for {"items": [...]}, a List or array for [...], and a nested record for {...}.',
      'If the API really sends either one value or a list, enable ACCEPT_SINGLE_VALUE_AS_ARRAY and document that contract.',
    ],
    fixes: [
      { title: 'Model the wrapper object', text: 'Records need Jackson 2.12 or later. The fragments run in a method that declares throws Exception.', lang: 'java', code: `record Item(long id) {}
record ItemsResponse(List<Item> items) {}

ItemsResponse response = new ObjectMapper()
    .readValue("{\\"items\\":[{\\"id\\":1}]}", ItemsResponse.class);
List<Item> items = response.items();` },
      { title: 'Read a top-level array as a list', text: 'TypeReference keeps the element type, so each element becomes an Item instead of a Map.', lang: 'java', code: `List<Item> items = new ObjectMapper()
    .readValue("[{\\"id\\":1}]", new TypeReference<List<Item>>() {});` },
      { title: 'Accept one value as a one-element list', text: 'Enable this only when the API documents both forms.', lang: 'java', code: `ObjectMapper mapper = JsonMapper.builder()
    .enable(DeserializationFeature.ACCEPT_SINGLE_VALUE_AS_ARRAY)
    .build();
Order order = mapper.readValue("{\\"tags\\":\\"new\\"}", Order.class); // tags = [new]` },
    ],
    faq: [
      { question: 'What do START_OBJECT and START_ARRAY mean?', answer: 'They are Jackson token names for { and [. Newer messages say Object value and Array value instead, and add the token name in parentheses.' },
      { question: 'Why does the message say ArrayList when my code asks for List?', answer: 'Jackson builds an ArrayList for an abstract List type, so the message names the concrete type it tried to create.' },
      { question: 'Is this a JSON syntax error?', answer: 'No. The document parsed successfully. The error is a mismatch between the JSON structure and your Java types, so fix the types or the producer, not the syntax.' },
      { question: 'Should I enable ACCEPT_SINGLE_VALUE_AS_ARRAY globally?', answer: 'Only if every list in your input may arrive as a single value. Otherwise it hides real contract changes. You can enable it per property with @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY).' },
    ],
    related: ['jackson-unrecognized-field', 'jackson-unrecognized-token', 'go-cannot-unmarshal'],
    tools: [
      { href: '/tools/json-to-java', label: 'Generate Java records from the JSON you received' },
      { href: '/tools/json-path-finder', label: 'Find the path to the value that failed' },
    ],
    docs: [{ href: SOURCES.jacksonArrayList, label: 'Jackson source: abstract List is created as ArrayList' }],
  },
  {
    slug: 'jackson-unrecognized-field',
    kind: 'binding',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'Jackson: Unrecognized field, not marked as ignorable',
    description: 'Fix Jackson UnrecognizedPropertyException: map renamed keys, ignore unknown properties on purpose, and know the Jackson 3 and Spring defaults.',
    queries: ['unrecognized field not marked as ignorable', 'unrecognizedpropertyexception unrecognized field', 'jackson ignore unknown properties', 'unrecognized property not marked as ignorable'],
    meaning: "The JSON has a property that matches no field, setter or constructor parameter in the target class, and the mapper is set to fail on unknown properties. Jackson 2 fails by default. Jackson 3 changed the default of DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES to false, and Spring's Jackson2ObjectMapperBuilder also turns it off, so the error mostly comes from a plain Jackson 2 ObjectMapper or a mapper that enables the check on purpose. Decide whether the key is a field you should map, a naming mismatch, or data you can ignore.",
    checked: 'Messages cited from Jackson 2.22 and 3.2 source',
    messages: [
      { runtime: 'Java / Jackson 2.x', text: 'UnrecognizedPropertyException: Unrecognized field "fullName" (class com.example.User), not marked as ignorable (2 known properties: "name", "email")', input: 'A fullName key read into record User(String name, String email)', source: SOURCES.jacksonUnknown, evidence: 'Source-derived from Jackson 2.22; location and reference chain omitted, property order can differ' },
      { runtime: 'Java / Jackson 3.x', text: 'Unrecognized property "fullName" (class com.example.User), not marked as ignorable', input: 'The same input, with FAIL_ON_UNKNOWN_PROPERTIES enabled', source: SOURCES.jackson3Unknown, evidence: 'Jackson 3.2.3 source template; known-properties suffix omitted' },
      { runtime: 'Spring MVC', text: 'JSON parse error: Unrecognized field "fullName" (class com.example.User), not marked as ignorable', input: 'A mapper with the check enabled', source: SOURCES.springPrefix, evidence: 'Spring Framework 7.0.9 prefix; Spring-built mappers disable the check by default' },
      { runtime: 'C# / System.Text.Json', text: "The JSON property '{0}' could not be mapped to any .NET member contained in type '{1}'.", input: 'JsonUnmappedMemberHandling.Disallow', source: SOURCES.stjUnmapped, evidence: 'Official .NET 10 resource template; this check is off by default' },
      { runtime: 'Go / Decoder.DisallowUnknownFields', text: 'json: unknown field "fullName"', input: 'The same input in Go', source: SOURCES.goUnknown, evidence: 'Official Go 1.27 source; this check is off by default' },
    ],
    causes: [
      { title: 'The API added or renamed a field', text: 'Old code meets new JSON. If the field is useful, add it to the class; if it was renamed, map the new name.', lang: 'java', code: `record User(String name, String email) {}

new ObjectMapper().readValue(
    "{\\"name\\":\\"Ada\\",\\"email\\":\\"ada@example.com\\",\\"fullName\\":\\"Ada Lovelace\\"}", User.class);
// Unrecognized field "fullName" (class User), not marked as ignorable` },
      { title: 'JSON uses snake_case and Java uses camelCase', text: 'first_name does not match a firstName component. Map the name or change the naming strategy.', lang: 'java', code: `record Person(String firstName) {}

new ObjectMapper().readValue("{\\"first_name\\":\\"Ada\\"}", Person.class);
// Unrecognized field "first_name" (class Person), not marked as ignorable` },
      { title: 'The JSON carries data the class does not need', text: 'A class that reads a few fields from a large third-party document fails on the first field it does not declare.', lang: 'java', code: `record Repo(String name) {}

new ObjectMapper().readValue("{\\"name\\":\\"tools\\",\\"stars\\":12}", Repo.class);
// Unrecognized field "stars" (class Repo), not marked as ignorable` },
    ],
    steps: [
      'Read the field name and the class. The known-properties list in the message shows what Jackson can map.',
      'Compare it with your class: a new field to add, a naming mismatch to map, or extra data to ignore.',
      'Prefer explicit mapping with @JsonProperty. Ignore unknown properties per class with @JsonIgnoreProperties(ignoreUnknown = true) when the class reads only part of an external document.',
      'When you move to Jackson 3, unknown properties are ignored by default. Enable FAIL_ON_UNKNOWN_PROPERTIES where you rely on strict checking.',
    ],
    fixes: [
      { title: 'Map a renamed or snake_case key', text: 'The annotation renames one property and leaves the others alone.', lang: 'java', code: 'record Person(@JsonProperty("first_name") String firstName, String email) {}' },
      { title: 'Ignore unknown properties for one class', text: 'The rest of your mappers stay strict.', lang: 'java', code: `@JsonIgnoreProperties(ignoreUnknown = true)
record Repo(String name) {}` },
      { title: 'Change the naming strategy or the default for a mapper', text: 'Jackson 2 API; PropertyNamingStrategies needs 2.12 or later. Disable the check only for mappers that read documents you do not control.', lang: 'java', code: `ObjectMapper mapper = JsonMapper.builder()
    .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();` },
    ],
    faq: [
      { question: 'Is it safe to ignore unknown properties?', answer: 'It is common for clients of external APIs, because new fields then do not break you. It also hides typos and renamed fields, which become silently missing values. Keep the check on for your own contracts and in tests.' },
      { question: 'Why does my Spring application not throw this?', answer: "Spring's Jackson2ObjectMapperBuilder disables FAIL_ON_UNKNOWN_PROPERTIES unless you set it, and Jackson 3 disables it by default. A plain new ObjectMapper() in Jackson 2 still fails." },
      { question: 'What changed in Jackson 3?', answer: 'FAIL_ON_UNKNOWN_PROPERTIES defaults to false, and when you enable it the message says Unrecognized property instead of Unrecognized field.' },
      { question: 'Why does the error list known properties?', answer: 'Jackson appends the names it can map so you can spot a naming mismatch, such as firstName against first_name.' },
    ],
    related: ['jackson-cannot-deserialize', 'jackson-unrecognized-token', 'go-cannot-unmarshal'],
    tools: [{ href: '/tools/json-to-java', label: 'Generate Java records with @JsonProperty mappings from the JSON' }],
    docs: [
      { href: SOURCES.jackson3UnknownDefault, label: 'Jackson 3 source: FAIL_ON_UNKNOWN_PROPERTIES defaults to false' },
      { href: SOURCES.springUnknown, label: 'Spring source: Jackson2ObjectMapperBuilder disables FAIL_ON_UNKNOWN_PROPERTIES' },
    ],
  },
  {
    slug: 'go-cannot-unmarshal',
    kind: 'binding',
    published: '2026-10-15',
    updated: '2026-10-15',
    title: 'Go JSON: cannot unmarshal string, object or array into Go value',
    description: 'Fix Go UnmarshalTypeError when JSON strings, numbers, objects or arrays do not match your struct fields. Read the field path, then use string tags or json.Number.',
    queries: ['json: cannot unmarshal string into go value of type int', 'json: cannot unmarshal object into go value of type', 'cannot unmarshal array into go value of type', 'cannot unmarshal string into go struct field', 'json: cannot unmarshal number into go struct field of type string'],
    meaning: 'encoding/json parsed valid JSON but could not store a value in the Go type you passed. The message names the JSON kind it found (string, number, object, array or bool), the struct and field path when the value belongs to a struct field, and the Go type. The field path uses JSON key names. Unmarshal does not stop at this error: it fills the fields it can and returns the first type error, so the destination is partly populated.',
    checked: 'Messages cited from Go 1.27 source',
    messages: [
      { runtime: 'Go / encoding/json', text: 'json: cannot unmarshal string into Go struct field User.age of type int', input: '{"age":"42"} into a struct with Age int `json:"age"`', source: SOURCES.goUnmarshalType, evidence: 'Source-derived from Go 1.27 decode.go; the path uses JSON key names' },
      { runtime: 'Go, wrapped list', text: 'json: cannot unmarshal object into Go value of type []main.Item', input: '{"items":[{"id":1}]} into []Item', source: SOURCES.goUnmarshalType, evidence: 'Source-derived from Go 1.27 decode.go' },
      { runtime: 'Go, array into one value', text: 'json: cannot unmarshal array into Go value of type main.Item', input: '[{"id":1}] into Item', source: SOURCES.goUnmarshalType, evidence: 'Source-derived from Go 1.27 decode.go' },
      { runtime: 'Go, fraction into an integer', text: 'json: cannot unmarshal number 1.5 into Go struct field Item.id of type int', input: '{"id":1.5}', source: SOURCES.goUnmarshalType, evidence: 'Source-derived: integer fields include the number literal' },
      { runtime: 'Go, number into a string', text: 'json: cannot unmarshal number into Go struct field User.name of type string', input: '{"name":42}', source: SOURCES.goUnmarshalType, evidence: 'Source-derived from Go 1.27 decode.go' },
      { runtime: 'Go with GOEXPERIMENT=jsonv2', text: 'json: cannot unmarshal {value} into Go struct field {path} of type {type}: {detail}', input: 'Built with the jsonv2 experiment', source: SOURCES.goV2, evidence: 'Go 1.27 experimental template; values and paths can be worded differently' },
      { runtime: 'C# / System.Text.Json', text: 'The JSON value could not be converted to {0}.', input: '"42" into an int property', source: SOURCES.stjConvert, evidence: 'Official .NET 10 resource template; path and location omitted' },
    ],
    causes: [
      { title: 'A number arrives as a string', text: 'Some APIs quote numbers, especially 64-bit IDs. An int field rejects the string.', lang: 'go', code: `type User struct {
    Age int \`json:"age"\`
}
var u User
err := json.Unmarshal([]byte(\`{"age":"42"}\`), &u)
fmt.Println(err)` },
      { title: 'The JSON wraps the list in an object', text: 'A response such as {"items": [...]} cannot go into a slice. Decode into a struct with an Items field.', lang: 'go', code: `type Item struct {
    ID int \`json:"id"\`
}
var items []Item
err := json.Unmarshal([]byte(\`{"items":[{"id":1}]}\`), &items)
fmt.Println(err)` },
      { title: 'A fraction or out-of-range number targets an integer', text: 'Integer fields reject 1.5 and values that overflow the type. The message includes the number.', lang: 'go', code: `var item Item
err := json.Unmarshal([]byte(\`{"id":1.5}\`), &item)
fmt.Println(err)` },
    ],
    steps: [
      'Read the JSON kind, the field path (Struct.key) and the Go type in the message.',
      'Decide which side is wrong. If the producer sends the wrong type, fix it there; if your struct is wrong, change the field type.',
      'For numbers that are always quoted, add the ,string tag option. For values that may be quoted or not, use json.Number, which accepts both 42 and "42".',
      'Check the error with errors.As and *json.UnmarshalTypeError. Do not use the partly filled value after an error.',
    ],
    fixes: [
      { title: 'Accept quoted numbers with the string option', text: 'The option applies to string, integer, floating-point and boolean fields. An unquoted number is then an error.', lang: 'go', code: `type User struct {
    Age int \`json:"age,string"\` // accepts "42"
}` },
      { title: 'Accept either form with json.Number', text: 'encoding/json stores a quoted valid number in a json.Number field as well as an unquoted one. Convert it with Int64 or Float64.', lang: 'go', code: `type User struct {
    Age json.Number \`json:"age"\` // accepts 42 and "42"
}` },
      { title: 'Model the wrapper and inspect type errors', text: 'A complete program. Field holds the JSON key path, and Value the JSON kind that arrived.', lang: 'go', code: `package main

import (
    "encoding/json"
    "errors"
    "fmt"
)

type Item struct {
    ID int \`json:"id"\`
}

type ItemsResponse struct {
    Items []Item \`json:"items"\`
}

func main() {
    var resp ItemsResponse
    err := json.Unmarshal([]byte(\`{"items":[{"id":1},{"id":"2"}]}\`), &resp)
    var typeErr *json.UnmarshalTypeError
    if errors.As(err, &typeErr) {
        fmt.Printf("field %q: got JSON %s, want %s\\n", typeErr.Field, typeErr.Value, typeErr.Type)
        return
    }
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println(resp.Items)
}` },
    ],
    faq: [
      { question: 'Does Unmarshal stop at the first type error?', answer: 'No. It skips the value that does not fit, keeps decoding, and returns the first UnmarshalTypeError at the end. The other fields are filled, so treat the result as invalid when err is not nil.' },
      { question: 'What does Go struct field User.age mean?', answer: 'User is the Go struct type that holds the field, and age is the path of JSON keys to the value. Nested fields appear as a dotted path, such as items.id.' },
      { question: 'Should I decode into any to avoid the error?', answer: 'Decoding into any accepts every shape, but then each value needs a type check. Prefer a struct that matches the documented JSON, and use json.RawMessage for parts you decode later.' },
      { question: 'Does GOEXPERIMENT=jsonv2 change the message?', answer: 'Yes. With the experiment enabled, encoding/json uses the v2 implementation and formats type errors differently, with extra detail after a colon. The default Go 1.27 build uses the wording shown first.' },
    ],
    related: ['go-invalid-character', 'jackson-cannot-deserialize', 'extra-data'],
    tools: [{ href: '/tools/json-to-go', label: 'Generate Go structs that match the JSON' }],
    docs: [
      { href: SOURCES.goDocs, label: 'Go encoding/json documentation' },
      { href: SOURCES.goNumber, label: 'Go source: json.Number accepts a quoted number' },
    ],
  },
];

export const HUB_FAQ = [
  { question: 'How do I identify the cause of a JSON parse error?', answer: 'Inspect the exact text passed to the parser, then read the reported line, column or offset. Check the HTTP response status and Content-Type when the text came from an API. The same message can have more than one cause.' },
  { question: 'Why do runtimes show different JSON error messages?', answer: 'Each parser defines its own diagnostic wording, and messages change across versions. JSON standards define valid syntax, not a required error message. Match the input and cause as well as the wording.' },
  { question: 'Can I validate JSON without uploading it?', answer: 'Yes. Tool Kumar parses the document in your browser and reports syntax issues with line and column information. Its validator and repair tools keep the input on your device.' },
];
