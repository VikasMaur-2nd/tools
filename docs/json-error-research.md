# JSON error guide evidence

Research and local checks on October 14, 2026. Node.js 24.21.0 and Python 3.14.4 were available. Go was not installed.

## /json-errors/unexpected-token-html

Target queries: unexpected token < in json at position 0; doctype is not valid json; unexpected token < json fetch.

- JavaScript / V8: `SyntaxError: Unexpected token '<', "<!DOCTYPE html>" is not valid JSON`. Input: `JSON.parse("<!DOCTYPE html>")`. Reproduced in Node.js 24.21.0.
- Older V8: `Unexpected token < in JSON at position 0`. Input: `HTML starting with <`. V8 8.0 message template, with token < and position 0 substituted. [Source](https://github.com/v8/v8/blob/8.0.426/src/common/message-template.h).
- Python: `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`. Input: `json.loads("<!DOCTYPE html>")`. Reproduced in Python 3.14.4.
- Go / encoding/json: `invalid character '<' looking for beginning of value`. Input: `json.Unmarshal([]byte("<!DOCTYPE html>"), &value)`. Official Go 1.26 scanner source. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- Firefox: `SyntaxError: JSON.parse: unexpected character`. Input: `Non-JSON character at the start`. MDN diagnostic wording, location suffix omitted. [Source](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse).
- C# / System.Text.Json: `'{0}' is an invalid start of a value.`. Input: `Source template; {0} is the offending character`. Official .NET 10 resource string, path and location suffix omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx).
- PHP / json_last_error_msg(): `Syntax error`. Input: `json_decode("<!DOCTYPE html>")`. Official PHP 8.4 JSON_ERROR_SYNTAX message. [Source](https://github.com/php/php-src/blob/PHP-8.4/ext/json/json.c).

## /json-errors/unexpected-end-of-json-input

Target queries: unexpected end of json input how to fix; unexpected end of json input while parsing empty string; json.decoder.jsondecodeerror expecting value line 1 column 1 char 0.

- JavaScript / V8: `SyntaxError: Unexpected end of JSON input`. Input: `JSON.parse("") or JSON.parse('{"id":')`. Reproduced in Node.js 24.21.0.
- Python, empty input: `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`. Input: `json.loads("")`. Reproduced in Python 3.14.4.
- Python, unfinished value: `json.decoder.JSONDecodeError: Expecting value: line 1 column 7 (char 6)`. Input: `json.loads('{"id":')`. Reproduced in Python 3.14.4.
- Go / json.Unmarshal: `unexpected end of JSON input`. Input: `Empty or incomplete JSON bytes`. Official Go 1.26 scanner source. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- Go / Decoder.Decode: `EOF`. Input: `No next value in an empty reader`. io.EOF return in the official Go source; incomplete tokens can produce unexpected EOF. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/stream.go).
- Firefox: `SyntaxError: JSON.parse: unexpected end of data`. Input: `Incomplete JSON input`. MDN diagnostic wording, location suffix omitted. [Source](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse).
- Safari / JavaScriptCore: `JSON Parse error: Unexpected EOF`. Input: `End token encountered where a value is required`. Official WebKit parser message; LiteralParser.h supplies the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/LiteralParser.cpp).
- C# / System.Text.Json: `The input does not contain any JSON tokens. Expected the input to start with a valid JSON token, when isFinalBlock is true.`. Input: `Empty input, source resource string`. Official .NET 10 resource string, path and location suffix omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx).

## /json-errors/undefined-is-not-valid-json

Target queries: undefined is not valid json; [object Object] is not valid json; unexpected token u in json at position 0; unexpected token o in json at position 1.

- JavaScript / V8, missing value: `SyntaxError: "undefined" is not valid JSON`. Input: `JSON.parse(undefined)`. Reproduced in Node.js 24.21.0.
- JavaScript / V8, object value: `SyntaxError: "[object Object]" is not valid JSON`. Input: `JSON.parse({})`. Reproduced in Node.js 24.21.0.
- Older V8: `Unexpected token u in JSON at position 0`. Input: `undefined converted to text`. V8 8.0 message template with u and 0 substituted. [Source](https://github.com/v8/v8/blob/8.0.426/src/common/message-template.h).
- Older V8: `Unexpected token o in JSON at position 1`. Input: `A plain object converted to [object Object]`. V8 8.0 message template with o and 1 substituted. [Source](https://github.com/v8/v8/blob/8.0.426/src/common/message-template.h).
- Python: `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`. Input: `json.loads("undefined"), a string rather than a Python dict`. Reproduced in Python 3.14.4.

## /json-errors/single-quotes-unquoted-keys

Target queries: expecting property name enclosed in double quotes; expecting property name enclosed in double quotes line 1 column 2 char 1; unexpected token ' in json.

- Python: `json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)`. Input: `json.loads("{'id':1}") or json.loads('{id:1}')`. Reproduced in Python 3.14.4.
- JavaScript / V8: `SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)`. Input: `JSON.parse("{'id':1}") or JSON.parse('{id:1}')`. Reproduced in Node.js 24.21.0.
- Firefox: `SyntaxError: JSON.parse: expected property name or '}'`. Input: `JSON.parse("{'foo': 1}")`. Exact example in MDN; location suffix omitted. [Source](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse).
- Java / Jackson: `was expecting double-quote to start field name`. Input: `Unquoted key with default parser settings`. Exact diagnostic fragment from Jackson 2.18 source; exception prefix and location vary. [Source](https://github.com/FasterXML/jackson-core/blob/2.18/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java).
- C# / System.Text.Json: `'{0}' is an invalid start of a property name. Expected a '"'.`. Input: `Source template; {0} is the offending character`. Official .NET 10 resource string, path and location suffix omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx).

## /json-errors/trailing-comma

Target queries: json trailing comma; json trailing comma allowed; json trailing comma error; python json trailing comma.

- JavaScript / V8, array: `SyntaxError: Unexpected token ']', "[1,]" is not valid JSON`. Input: `JSON.parse("[1,]")`. Reproduced in Node.js 24.21.0.
- JavaScript / V8, object: `SyntaxError: Expected double-quoted property name in JSON at position 8 (line 1 column 9)`. Input: `JSON.parse('{"id":1,}')`. Reproduced in Node.js 24.21.0.
- Python 3.14, array: `json.decoder.JSONDecodeError: Illegal trailing comma before end of array: line 1 column 3 (char 2)`. Input: `json.loads("[1,]")`. Reproduced in Python 3.14.4.
- Python 3.14, object: `json.decoder.JSONDecodeError: Illegal trailing comma before end of object: line 1 column 8 (char 7)`. Input: `json.loads('{"id":1,}')`. Reproduced in Python 3.14.4.
- Python 3.13, object: `Expecting property name enclosed in double quotes`. Input: `Trailing comma before }`. Official CPython 3.13 diagnostic text; location depends on input. [Source](https://github.com/python/cpython/blob/v3.13.0/Lib/json/decoder.py).
- Firefox: `SyntaxError: JSON.parse: unexpected character`. Input: `Trailing-comma examples in MDN`. MDN example wording, location suffix omitted. [Source](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse).
- Safari / JavaScriptCore: `JSON Parse error: Unexpected comma at the end of array expression`. Input: `Trailing comma in an array`. Official WebKit parser message and LiteralParser.h prefix. [Source](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/LiteralParser.cpp).
- C# / System.Text.Json: `The JSON array contains a trailing comma at the end which is not supported in this mode. Change the reader options.`. Input: `Array with a trailing comma, default strict mode`. Official .NET 10 resource string, path and location suffix omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx).

## /json-errors/extra-data

Target queries: jsondecodeerror extra data; json decoder jsondecodeerror extra data line 1; python json extra data ndjson.

- Python: `json.decoder.JSONDecodeError: Extra data: line 1 column 4 (char 3)`. Input: `json.loads("{} {}")`. Reproduced in Python 3.14.4.
- JavaScript / V8: `SyntaxError: Unexpected non-whitespace character after JSON at position 3 (line 1 column 4)`. Input: `JSON.parse("{} {}")`. Reproduced in Node.js 24.21.0.
- Firefox: `SyntaxError: JSON.parse: unexpected non-whitespace character after JSON data`. Input: `Content after a complete JSON value`. MDN diagnostic wording, location suffix omitted. [Source](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse).
- Safari / JavaScriptCore: `JSON Parse error: Unexpected content at end of JSON literal`. Input: `Content after a complete JSON value`. Official WebKit parser message and LiteralParser.h prefix. [Source](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/LiteralParser.cpp).
- Go / json.Unmarshal: `invalid character '{' after top-level value`. Input: `json.Unmarshal([]byte("{} {}"), &value)`. Official Go 1.26 scanner source. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- C# / System.Text.Json: `'{0}' is invalid after a single JSON value. Expected end of data.`. Input: `Source template for a second value or suffix`. Official .NET 10 resource string, path and location suffix omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx).

## /json-errors/bad-control-character

Target queries: bad control character in string literal in json; json unescaped newline; invalid control character json python.

- JavaScript / V8: `SyntaxError: Bad control character in string literal in JSON at position 7 (line 1 column 8)`. Input: `JSON.parse on {"x":"a<LF>b"}, where <LF> is U+000A`. Reproduced in Node.js 24.21.0.
- Python: `json.decoder.JSONDecodeError: Invalid control character at: line 1 column 8 (char 7)`. Input: `json.loads on the same literal-LF input`. Reproduced in Python 3.14.4.
- Firefox: `SyntaxError: JSON.parse: bad control character in string literal`. Input: `Unescaped control character inside a string`. MDN diagnostic wording, location suffix omitted. [Source](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/JSON_bad_parse).
- Java / Jackson: `has to be escaped using backslash to be included in`. Input: `Unescaped control character inside a string`. Exact diagnostic fragment; the character description and context surround it. [Source](https://github.com/FasterXML/jackson-core/blob/2.18/src/main/java/com/fasterxml/jackson/core/base/ParserBase.java).
- PHP / json_last_error_msg(): `Control character error, possibly incorrectly encoded`. Input: `JSON_ERROR_CTRL_CHAR`. Official PHP 8.4 message. [Source](https://github.com/php/php-src/blob/PHP-8.4/ext/json/json.c).
- C# / System.Text.Json: `'{0}' is invalid within a JSON string. The string should be correctly escaped.`. Input: `Source template; {0} describes the offending character`. Official .NET 10 resource string, path and location suffix omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx).

## /json-errors/go-invalid-character

Target queries: invalid character '<' looking for beginning of value; invalid character looking for beginning of value golang; go json invalid character BOM.

- Go / encoding/json: `invalid character '<' looking for beginning of value`. Input: `[]byte("<html>")`. Official Go 1.26 scanner and quoteChar source. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- Go / encoding/json: `invalid character 'u' looking for beginning of value`. Input: `[]byte("undefined")`. Official Go 1.26 scanner source. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- Go / encoding/json: `invalid character 'e' looking for beginning of value`. Input: `[]byte("error: unavailable")`. Official Go 1.26 scanner source. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- Go / encoding/json: `invalid character 'ï' looking for beginning of value`. Input: `UTF-8 BOM bytes EF BB BF before {}`. Source-derived: scanner reports first byte EF, quoteChar converts that byte to a quoted character. [Source](https://github.com/golang/go/blob/go1.26.0/src/encoding/json/scanner.go).
- Python: `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`. Input: `json.loads("undefined")`. Reproduced in Python 3.14.4.
- JavaScript / V8: `SyntaxError: "undefined" is not valid JSON`. Input: `JSON.parse("undefined")`. Reproduced in Node.js 24.21.0.

## Query research

Google Autocomplete was fetched with client=firefox. Suggested variants included "unexpected end of json input how to fix", "undefined is not valid json", "doctype is not valid json fetch", "jsondecodeerror extra data", "expecting property name enclosed in double quotes python", "json trailing comma allowed" and "bad control character in string literal in json". Suggestions establish wording, not search volume. No volume or ranking claim is made.

## Scope

The eight guides group causes, not position numbers. The Go guide covers plain-text prefixes, byte-order marks and invalid nested literals, with links to the HTML-response guide. Official .NET source templates and Jackson fragments are labeled rather than presented as full reproduced exceptions. PHP messages use official PHP source. Firefox messages use MDN; Safari messages combine the official parser string with its source-defined prefix.

Requests Read the Docs returned HTTP 403 during the first fetch. The official psf/requests quickstart source was fetched instead to verify response inspection and JSON decoding behavior. The article links to the public documentation URL.

## Verification

- pnpm lint, pnpm test and pnpm build passed. The final build contains prerendered HTML for the hub and all eight guides. All article content, FAQs and metadata are present in those HTML files; the site-wide Cache Components configuration remains enabled.
- Executed 19 JavaScript and 13 Python cause/fix snippets. Invalid examples raise parser errors; corrected examples succeed or explicitly reject an empty input as intended.
- The fetch and requests examples each passed seven mocked response scenarios covering ordinary JSON, a +json media type, HTML, HTTP 500, empty content, extra data and HTTP 204. The fetch example reads the body exactly once.
- Audited all nine HTML pages for a single H1, breadcrumb/FAQ schema, TechArticle schema on explainers, validator links and FAQ answers that match visible content.
- No new client components or dependencies. The explainer client-module references match the existing JSON reference article.
- Go, Firefox, Safari, Java, PHP and .NET were not executed locally. Their diagnostics are source-cited, with fragments/templates clearly labeled.
- Chromium checked the HTML-response and control-character guides at 1440px and 390px in system light and dark mode, with screenshots reviewed. No document overflow. Local first contentful paint ranged from 204 to 664 ms; this is a local smoke measurement, not a field Core Web Vitals or Lighthouse claim.
- The original content header overflowed by 2px at 390px. Reduced mobile link padding and header spacing. Diagnostic tables now scroll within a keyboard-focusable region on narrow screens.
- Verified unique titles, descriptions, canonical URLs and Open Graph metadata on all nine routes; all are listed in the served sitemap and llms.txt.
- Read the installed Next.js 16.4 ensureStatic guide and applied ensureStatic = 'navigation' to the JSON error layout. This validates complete static server output, including metadata, and avoids a streamed fallback for unknown guide slugs.
- After static-output enforcement, an unknown guide slug returns HTTP 404. Rechecked all nine pages and the two browser test pages after the final build.
