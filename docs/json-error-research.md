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
- Python 3.13+, array: `json.decoder.JSONDecodeError: Illegal trailing comma before end of array: line 1 column 3 (char 2)`. Input: `json.loads("[1,]")`. Reproduced in Python 3.14.4; the explicit diagnostic was added in CPython 3.13.0. [Source](https://github.com/python/cpython/blob/v3.13.0/Lib/json/decoder.py).
- Python 3.13+, object: `json.decoder.JSONDecodeError: Illegal trailing comma before end of object: line 1 column 8 (char 7)`. Input: `json.loads('{"id":1,}')`. Reproduced in Python 3.14.4; the explicit diagnostic was added in CPython 3.13.0. [Source](https://github.com/python/cpython/blob/v3.13.0/Lib/json/decoder.py).
- Python 3.12 and earlier, object: `Expecting property name enclosed in double quotes`. Input: `Trailing comma before }`. Official CPython 3.12.0 diagnostic text; location depends on input. [Source](https://github.com/python/cpython/blob/v3.12.0/Lib/json/decoder.py).
- Python 3.12 and earlier, array: `Expecting value`. Input: `Trailing comma before ]`. Official CPython 3.12.0 diagnostic text; location depends on input. [Source](https://github.com/python/cpython/blob/v3.12.0/Lib/json/decoder.py).
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

# Batch 2 (October 15, 2026)

Research and local checks on October 15, 2026 with Node.js 24.21.0 (V8 13.6) and Python 3.14.4. Firefox, JavaScriptCore, Jackson, Spring, .NET, Go, PHP, serde_json and Starlette were not installed; their messages are quoted or derived from source files at pinned release tags (Firefox 158, WebKit webkitgtk-2.54.1, jackson-core/databind 2.8.11 to 3.2.3, Spring Framework 7.0.9, .NET 10.0.0, Json.NET 13.0.4, Go 1.27.0, php-src 8.5.11, serde_json 1.0.154, Starlette 1.8.0). "Source-derived" rows combine a template with the code that fills it; they are not executed transcripts.

Demand evidence came from the public Stack Exchange API (question counts and top questions) and GitHub issue search counts. Google was not queried.

## /json-errors/expecting-comma-delimiter

Target queries: expecting ',' delimiter; json.decoder.jsondecodeerror expecting ',' delimiter; expected ',' or '}' after property value in json at position; json.parse expected ',' or '}' after property value in object; unexpected string in json at position.

- Python: `json.decoder.JSONDecodeError: Expecting ',' delimiter: line 1 column 8 (char 7)`. Input: `json.loads('{"a":1 "b":2}')`. Reproduced in Python 3.14.4.
- Python, missing colon: `json.decoder.JSONDecodeError: Expecting ':' delimiter: line 1 column 6 (char 5)`. Input: `json.loads('{"a" 1}')`. Reproduced in Python 3.14.4.
- Python 2.7, byte strings: `ValueError: Expecting , delimiter`. Input: `json.loads on a str (byte string) with a missing comma`. CPython 2.7.18 C scanner; unicode input quotes the comma. Location suffix omitted. [Source](https://github.com/python/cpython/blob/v2.7.18/Modules/_json.c#L959).
- JavaScript / V8: `SyntaxError: Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)`. Input: `JSON.parse('{"a":1 "b":2}')`. Reproduced in Node.js 24.21.0.
- JavaScript / V8, array: `SyntaxError: Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)`. Input: `JSON.parse('[1 2]')`. Reproduced in Node.js 24.21.0.
- V8 10.2 / Node.js 18: `SyntaxError: Unexpected string in JSON at position 7`. Input: `JSON.parse('{"a":1 "b":2}'); [1 2] gives Unexpected number in JSON at position 3`. V8 10.2 message templates; the position is where the unexpected token starts. [Source](https://github.com/v8/v8/blob/10.2.154.26/src/common/message-template.h#L481-L482).
- Firefox: `SyntaxError: JSON.parse: expected ',' or '}' after property value in object at line 1 column 8 of the JSON data`. Input: `JSON.parse('{"a":1 "b":2}')`. Source-derived from Firefox 158 JSONParser.cpp and its message template. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L264).
- Safari / JavaScriptCore: `JSON Parse error: Expected '}'`. Input: `Missing comma in an object`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/LiteralParser.cpp#L1229).
- Go / encoding/json: `invalid character '"' after object key:value pair`. Input: `json.Unmarshal of {"a":1 "b":2}`. Source-derived from the Go 1.27 scanner. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/scanner.go#L312).
- Java / Jackson: `Unexpected character ('"' (code 34)): was expecting comma to separate Object entries`. Input: `{"a":1 "b":2}`. Source-derived from Jackson 2.22; location suffix omitted. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L2445).
- C# / System.Text.Json: `'"' is invalid after a value. Expected either ',', '}', or ']'.`. Input: `{"a":1 "b":2}`. Official .NET 10 resource template with the quote substituted; path and location omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx#L222).

## /json-errors/invalid-escape

Target queries: bad escaped character in json at position; json.decoder.jsondecodeerror: invalid \escape; json.parse: bad escaped character; invalid \uxxxx escape; bad unicode escape in json at position.

- JavaScript / V8: `SyntaxError: Bad escaped character in JSON at position 12 (line 1 column 13)`. Input: `JSON.parse on {"path":"C:\Users\ada"}`. Reproduced in Node.js 24.21.0.
- JavaScript / V8, \u escape: `SyntaxError: Bad Unicode escape in JSON at position 3 (line 1 column 4)`. Input: `JSON.parse on "\uZZZZ"`. Reproduced in Node.js 24.21.0.
- Python: `json.decoder.JSONDecodeError: Invalid \escape: line 1 column 12 (char 11)`. Input: `json.loads(r'{"path":"C:\Users\ada"}')`. Reproduced in Python 3.14.4.
- Python, \u escape: `json.decoder.JSONDecodeError: Invalid \uXXXX escape: line 1 column 3 (char 2)`. Input: `json.loads(r'"\uZZZZ"')`. Reproduced in Python 3.14.4.
- Firefox: `SyntaxError: JSON.parse: bad escaped character at line 1 column 13 of the JSON data`. Input: `The same path input`. Source-derived from Firefox 158 JSONParser.cpp: reported at the character after the backslash. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L496).
- Safari / JavaScriptCore: `JSON Parse error: Invalid escape character U`. Input: `The same path input`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/LiteralParser.cpp#L1080).
- Go / encoding/json: `invalid character 'U' in string escape code`. Input: `The same path input`. Official Go 1.27 scanner source. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/scanner.go#L364).
- Java / Jackson: `Unrecognized character escape 'U' (code 85)`. Input: `The same path input`. Source-derived from Jackson 2.22; location suffix omitted. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core/base/ParserBase.java#L1388).
- C# / System.Text.Json: `'U' is an invalid escapable character within a JSON string. The string should be correctly escaped.`. Input: `The same path input`. Official .NET 10 resource template with U substituted; path and location omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx#L228).
- C# / Json.NET: `Bad JSON escape sequence: \U.`. Input: `The same path input`. Json.NET 13.0.4 source template; path, line and position suffix omitted. [Source](https://github.com/JamesNK/Newtonsoft.Json/blob/13.0.4/Src/Newtonsoft.Json/JsonTextReader.cs#L1261).
- PHP / json_last_error_msg(): `Syntax error`. Input: `The same path input`. Official PHP 8.5 scanner rule: an invalid escape is JSON_ERROR_SYNTAX. [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json_scanner.re#L255).

## /json-errors/firefox-unexpected-character

Target queries: json.parse: unexpected character at line 1 column 1 of the json data; syntaxerror: json.parse: unexpected character; json.parse: unexpected character at line 1 column 2 of the json data; json.parse: unexpected keyword at line 1 column 1 of the json data.

- Firefox: `SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data`. Input: `JSON.parse("<!DOCTYPE html>")`. Source-derived from Firefox 158 JSONParser.cpp and its message template. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L179).
- Firefox, after a newline: `SyntaxError: JSON.parse: unexpected character at line 2 column 1 of the JSON data`. Input: `JSON.parse("\n<br />")`. Source-derived: lines and columns are counted from 1 up to the rejected character. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L57-L76).
- Firefox, a word: `SyntaxError: JSON.parse: unexpected keyword at line 1 column 1 of the JSON data`. Input: `JSON.parse("not found")`. Source-derived: a word starting with t, f or n that is not true, false or null. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L123).
- Firefox, empty input: `SyntaxError: JSON.parse: unexpected end of data at line 1 column 1 of the JSON data`. Input: `JSON.parse("")`. Source-derived from Firefox 158 JSONParser.cpp. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L98).
- Chrome, Edge, Node.js / V8: `SyntaxError: Unexpected token '<', "<!DOCTYPE html>" is not valid JSON`. Input: `JSON.parse("<!DOCTYPE html>")`. Reproduced in Node.js 24.21.0.
- Safari / JavaScriptCore: `JSON Parse error: Unrecognized token '<'`. Input: `The same input`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/LiteralParser.cpp#L846).
- V8, byte-order mark: `SyntaxError: Unexpected token '﻿', "﻿{"a":1}" is not valid JSON`. Input: `JSON.parse("\uFEFF{\"a\":1}"); the quoted token is an invisible U+FEFF`. Reproduced in Node.js 24.21.0.
- Python, byte-order mark: `json.decoder.JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)`. Input: `json.loads('\ufeff{"a":1}')`. Reproduced in Python 3.14.4.

## /json-errors/php-json-decode-null

Target queries: json_decode returns null; php json_decode null; json_last_error_msg syntax error; json_decode syntax error valid json; jsonexception syntax error.

- PHP / json_last_error_msg(): `Syntax error`. Input: `json_decode("{'id': 1}")`. Official php-src 8.5.11 message; json_last_error() returns 4 (JSON_ERROR_SYNTAX). [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json.c#L159).
- PHP / JSON_THROW_ON_ERROR: `JsonException: Syntax error`. Input: `json_decode($json, flags: JSON_THROW_ON_ERROR)`. Official php-src 8.5.11 source: same message, exception code 4. [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json.c#L191).
- PHP, byte-order mark: `Syntax error`. Input: `"\xEF\xBB\xBF{}", a UTF-8 BOM before the JSON`. php-src 8.5.11 scanner: a UTF-8 character outside a string is a syntax error. [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json_scanner.re#L218).
- PHP, empty string: `Syntax error`. Input: `json_decode('')`. php-src 8.5.11 json_decode: empty input sets JSON_ERROR_SYNTAX. [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json.c#L279).
- PHP, invalid UTF-8: `Malformed UTF-8 characters, possibly incorrectly encoded`. Input: `Windows-1252 bytes such as \xE9 inside a string`. Official php-src 8.5.11 message (JSON_ERROR_UTF8). [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json.c#L161).
- PHP, deep nesting: `Maximum stack depth exceeded`. Input: `Nesting deeper than the depth argument, 512 by default`. Official php-src 8.5.11 message (JSON_ERROR_DEPTH). [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json.c#L153).
- PHP, valid null: `No error`. Input: `json_decode('null') returns null`. Official php-src 8.5.11 message; decoding succeeded. [Source](https://github.com/php/php-src/blob/php-8.5.11/ext/json/json.c#L151).

## /json-errors/dotnet-invalid-start-of-value

Target queries: '<' is an invalid start of a value; system.text.json.jsonexception is an invalid start of a value; unexpected character encountered while parsing value; unexpected character encountered while parsing value: <. path '', line 0, position 0; invalid json primitive.

- C# / System.Text.Json, JsonSerializer: `System.Text.Json.JsonException: '<' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0.`. Input: `JsonSerializer.Deserialize<Item>("<!DOCTYPE html>")`. Source-derived from .NET 10: resource template, reader location and serializer path. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx#L210).
- C# / System.Text.Json, JsonDocument: `'<' is an invalid start of a value. LineNumber: 0 | BytePositionInLine: 0.`. Input: `JsonDocument.Parse("<!DOCTYPE html>")`. Source-derived from .NET 10 ThrowHelper; no path outside the serializer. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/System/Text/Json/ThrowHelper.cs#L383).
- C# / System.Text.Json, byte-order mark: `'0xEF' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0.`. Input: `UTF-8 bytes that still start with EF BB BF, passed as a byte array or span`. Source-derived: bytes that are not printable ASCII are written as 0x and two hex digits. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/System/Text/Json/ThrowHelper.cs#L390-L393).
- C# / Json.NET: `Newtonsoft.Json.JsonReaderException: Unexpected character encountered while parsing value: <. Path '', line 0, position 0.`. Input: `JsonConvert.DeserializeObject<Item>("<!DOCTYPE html>")`. Source-derived from Json.NET 13.0.4: line is 0 until the first token is read. [Source](https://github.com/JamesNK/Newtonsoft.Json/blob/13.0.4/Src/Newtonsoft.Json/JsonTextReader.cs#L763).
- ASP.NET on .NET Framework / JavaScriptSerializer: `Invalid JSON primitive: {0}.`. Input: `Source template; form-encoded or other non-JSON text`. .NET Framework reference source resource string. [Source](https://github.com/microsoft/referencesource/blob/ec9fa9ae770d522a5b5f0607898044b7478574a3/System.Web.Extensions/Resources/AtlasWeb.resx#L195).

## /json-errors/jackson-unrecognized-token

Target queries: jsonparseexception unrecognized token was expecting; unexpected character ('<' (code 60)): expected a valid value; json parse error: unrecognized token; unrecognized token was expecting (json string, number, array, object or token 'null', 'true' or 'false').

- Java / Jackson 2.10+ and 3.x: `Unrecognized token 'undefined': was expecting (JSON String, Number, Array, Object or token 'null', 'true' or 'false')`. Input: `{"id": undefined}`. Source-derived from the Jackson 2.22 template and value list; location suffix omitted. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L3041).
- Java / Jackson 2.10+ and 3.x, symbol: `Unexpected character ('<' (code 60)): expected a valid value (JSON String, Number, Array, Object or token 'null', 'true' or 'false')`. Input: `<!DOCTYPE html>`. Source-derived from Jackson 2.22; location suffix omitted. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L2065).
- Java / Jackson 2.9 and earlier: `Unrecognized token 'undefined': was expecting ('true', 'false' or 'null')`. Input: `{"id": undefined}`. Source-derived from the Jackson 2.9.10 template. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.9.10/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L1899).
- Java / Jackson 2.9, symbol: `Unexpected character ('<' (code 60)): expected a valid value (number, String, array, object, 'true', 'false' or 'null')`. Input: `<!DOCTYPE html>`. Source-derived from the Jackson 2.9.10 template. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.9.10/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L1902).
- Java / Jackson, NaN: `Non-standard token 'NaN': enable `JsonReadFeature.ALLOW_NON_NUMERIC_NUMBERS` to allow`. Input: `{"score": NaN}`. Official Jackson 2.22 source text. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L2043).
- Spring MVC: `JSON parse error: Unrecognized token 'undefined': was expecting (JSON String, Number, Array, Object or token 'null', 'true' or 'false')`. Input: `A @RequestBody with the same body`. Spring Framework 7.0.9 source: JSON parse error: plus the original Jackson message. [Source](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-web/src/main/java/org/springframework/http/converter/json/AbstractJackson2HttpMessageConverter.java#L408).

## /json-errors/circular-structure

Target queries: typeerror: converting circular structure to json; converting circular structure to json --> starting at object with constructor 'object'; converting circular structure to json starting at object with constructor 'clientrequest'; typeerror: cyclic object value; valueerror: circular reference detected.

- JavaScript / V8: `TypeError: Converting circular structure to JSON`. Input: `const a = {}; a.self = a; JSON.stringify(a)`. Reproduced in Node.js 24.21.0; V8 adds the path lines shown in the examples.
- Firefox: `TypeError: cyclic object value`. Input: `The same input`. Official SpiderMonkey message, Firefox 158 source. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/public/friend/ErrorNumbers.msg#L142).
- Safari / JavaScriptCore: `TypeError: JSON.stringify cannot serialize cyclic structures.`. Input: `The same input`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1). [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/JSONObject.cpp#L444).
- Python: `ValueError: Circular reference detected`. Input: `a = {}; a['self'] = a; json.dumps(a)`. Reproduced in Python 3.14.4.
- Python 3.14+, note: `when serializing dict item 'self'`. Input: `Printed under the ValueError`. Reproduced in Python 3.14.4; notes were added in CPython 3.14. [Source](https://github.com/python/cpython/blob/v3.14.0/Modules/_json.c#L1646).
- Go / encoding/json: `json: unsupported value: encountered a cycle via *main.Node`. Input: `json.Marshal of a *Node whose Next field points back to it`. Source-derived from Go 1.27 encode.go; Go starts checking after 1000 nested pointers. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/encode.go#L774).
- C# / System.Text.Json: `A possible object cycle was detected. This can either be due to a cycle or if the object depth is larger than the maximum allowed depth of 64. Consider using ReferenceHandler.Preserve on JsonSerializerOptions to support cycles.`. Input: `Two objects that reference each other`. Official .NET 10 resource string with the default depth of 64; path omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx#L453).
- C# / Json.NET: `Self referencing loop detected for property '{0}' with type '{1}'.`. Input: `Source template`. Json.NET 13.0.4 source template; path suffix omitted. [Source](https://github.com/JamesNK/Newtonsoft.Json/blob/13.0.4/Src/Newtonsoft.Json/Serialization/JsonSerializerInternalWriter.cs#L343).
- Java / Jackson: `Infinite recursion (StackOverflowError)`. Input: `Two entities that reference each other`. Official Jackson 2.22 source text; the reference chain follows. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.3/src/main/java/com/fasterxml/jackson/databind/ser/std/BeanSerializerBase.java#L772).

## /json-errors/bigint-serialize

Target queries: typeerror: do not know how to serialize a bigint; prisma do not know how to serialize a bigint; bigint value can't be serialized in json; json.stringify bigint.

- JavaScript / V8: `TypeError: Do not know how to serialize a BigInt`. Input: `JSON.stringify({ id: 1n })`. Reproduced in Node.js 24.21.0.
- Firefox: `TypeError: BigInt value can't be serialized in JSON`. Input: `The same input`. Official SpiderMonkey message, Firefox 158 source. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/public/friend/ErrorNumbers.msg#L835).
- Safari / JavaScriptCore: `TypeError: JSON.stringify cannot serialize BigInt.`. Input: `The same input`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1). [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/JSONObject.cpp#L422).
- JavaScript, reading a large integer: `No error: the value becomes 9007199254740992`. Input: `JSON.parse('{"id":9007199254740993}').id`. Reproduced in Node.js 24.21.0.

## /json-errors/not-json-serializable

Target queries: object of type datetime is not json serializable; typeerror: object of type is not json serializable; object of type decimal is not json serializable; object of type int64 is not json serializable; out of range float values are not json compliant.

- Python 3.7+: `TypeError: Object of type datetime is not JSON serializable`. Input: `json.dumps({'created': datetime(2026, 10, 15, 9, 30)})`. Reproduced in Python 3.14.4.
- Python 3.14+, note: `when serializing dict item 'created'`. Input: `Printed under the TypeError`. Reproduced in Python 3.14.4; notes were added in CPython 3.14. [Source](https://github.com/python/cpython/blob/v3.14.0/Modules/_json.c#L1646).
- Python 3.6: `TypeError: Object of type 'datetime' is not JSON serializable`. Input: `The same input`. CPython 3.6.0 source template. [Source](https://github.com/python/cpython/blob/v3.6.0/Lib/json/encoder.py#L179).
- Python 3.5 and earlier: `TypeError: datetime.datetime(2026, 10, 15, 9, 30) is not JSON serializable`. Input: `The same input`. Source-derived from CPython 3.5.0: the repr of the value, then the message. [Source](https://github.com/python/cpython/blob/v3.5.0/Lib/json/encoder.py#L180).
- Python, dictionary keys: `TypeError: keys must be str, int, float, bool or None, not tuple`. Input: `json.dumps({(1, 2): 'x'})`. Reproduced in Python 3.14.4.
- Python 3.12+, NaN: `ValueError: Out of range float values are not JSON compliant: nan`. Input: `json.dumps({'x': float('nan')}, allow_nan=False)`. Reproduced in Python 3.14.4.
- Python 3.11 and earlier, NaN: `ValueError: Out of range float values are not JSON compliant`. Input: `The same input`. CPython 3.11.0 C encoder message, without the value. [Source](https://github.com/python/cpython/blob/v3.11.0/Modules/_json.c#L1354).
- JavaScript / V8, reading Python NaN: `SyntaxError: Unexpected token 'N', "{"x": NaN}" is not valid JSON`. Input: `JSON.parse of json.dumps({'x': float('nan')}) output`. Reproduced in Node.js 24.21.0.

## /json-errors/jackson-cannot-deserialize

Target queries: cannot deserialize value of type from object value (token jsontoken.start_object); cannot deserialize value of type java.util.arraylist from object value; mismatchedinputexception cannot deserialize; cannot deserialize instance of out of start_array token; can not deserialize instance of java.util.arraylist out of start_object token.

- Java / Jackson 2.12+ and 3.x, list target: `MismatchedInputException: Cannot deserialize value of type `java.util.ArrayList<com.example.Item>` from Object value (token `JsonToken.START_OBJECT`)`. Input: `readValue("{\"items\":[]}", new TypeReference<List<Item>>() {})`. Source-derived from the Jackson 2.22 template; the type text depends on your class. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.3/src/main/java/com/fasterxml/jackson/databind/DeserializationContext.java#L1580).
- Java / Jackson 2.12+ and 3.x, object target: `Cannot deserialize value of type `com.example.Item` from Array value (token `JsonToken.START_ARRAY`)`. Input: `readValue("[{\"id\":1}]", Item.class)`. Source-derived from the same template. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.3/src/main/java/com/fasterxml/jackson/databind/DeserializationContext.java#L1580).
- Java / Jackson 2.12+ and 3.x, String field: `Cannot deserialize value of type `java.lang.String` from Object value (token `JsonToken.START_OBJECT`)`. Input: `{"address":{"city":"Pune"}} into a String address field`. Source-derived; the reference chain suffix is omitted. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.3/src/main/java/com/fasterxml/jackson/databind/DeserializationContext.java#L1580).
- Java / Jackson 2.10 and 2.11: `Cannot deserialize instance of `java.util.ArrayList<com.example.Item>` out of START_OBJECT token`. Input: `The list example`. Source-derived from the Jackson 2.11.4 template. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.11.4/src/main/java/com/fasterxml/jackson/databind/DeserializationContext.java#L1234).
- Java / Jackson 2.9: `Cannot deserialize instance of `java.util.ArrayList` out of START_OBJECT token`. Input: `The list example`. Source-derived from the Jackson 2.9.10.8 template. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.9.10.8/src/main/java/com/fasterxml/jackson/databind/DeserializationContext.java#L1135).
- Java / Jackson 2.8 and earlier: `Can not deserialize instance of java.util.ArrayList out of START_OBJECT token`. Input: `The list example`. Source-derived from the Jackson 2.8.11 template. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.8.11/src/main/java/com/fasterxml/jackson/databind/DeserializationContext.java#L1118).
- C# / Json.NET: `Cannot deserialize the current JSON object (e.g. {"name":"value"}) into type '{0}' because the type requires a JSON array (e.g. [1,2,3]) to deserialize correctly.`. Input: `An object where a List<T> is expected`. Json.NET 13.0.4 source template; first sentence shown. [Source](https://github.com/JamesNK/Newtonsoft.Json/blob/13.0.4/Src/Newtonsoft.Json/Serialization/JsonSerializerInternalReader.cs#L604).
- Go / encoding/json: `json: cannot unmarshal object into Go value of type []main.Item`. Input: `The list example in Go`. Source-derived from Go 1.27 decode.go. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L136-L141).

## /json-errors/jackson-unrecognized-field

Target queries: unrecognized field not marked as ignorable; unrecognizedpropertyexception unrecognized field; jackson ignore unknown properties; unrecognized property not marked as ignorable.

- Java / Jackson 2.x: `UnrecognizedPropertyException: Unrecognized field "fullName" (class com.example.User), not marked as ignorable (2 known properties: "name", "email")`. Input: `A fullName key read into record User(String name, String email)`. Source-derived from Jackson 2.22; location and reference chain omitted, property order can differ. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.3/src/main/java/com/fasterxml/jackson/databind/exc/UnrecognizedPropertyException.java#L58).
- Java / Jackson 3.x: `Unrecognized property "fullName" (class com.example.User), not marked as ignorable`. Input: `The same input, with FAIL_ON_UNKNOWN_PROPERTIES enabled`. Jackson 3.2.3 source template; known-properties suffix omitted. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-3.2.3/src/main/java/tools/jackson/databind/exc/UnrecognizedPropertyException.java#L50).
- Spring MVC: `JSON parse error: Unrecognized field "fullName" (class com.example.User), not marked as ignorable`. Input: `A mapper with the check enabled`. Spring Framework 7.0.9 prefix; Spring-built mappers disable the check by default. [Source](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-web/src/main/java/org/springframework/http/converter/json/AbstractJackson2HttpMessageConverter.java#L408).
- C# / System.Text.Json: `The JSON property '{0}' could not be mapped to any .NET member contained in type '{1}'.`. Input: `JsonUnmappedMemberHandling.Disallow`. Official .NET 10 resource template; this check is off by default. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx#L500).
- Go / Decoder.DisallowUnknownFields: `json: unknown field "fullName"`. Input: `The same input in Go`. Official Go 1.27 source; this check is off by default. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L741).

## /json-errors/go-cannot-unmarshal

Target queries: json: cannot unmarshal string into go value of type int; json: cannot unmarshal object into go value of type; cannot unmarshal array into go value of type; cannot unmarshal string into go struct field; json: cannot unmarshal number into go struct field of type string.

- Go / encoding/json: `json: cannot unmarshal string into Go struct field User.age of type int`. Input: `{"age":"42"} into a struct with Age int `json:"age"``. Source-derived from Go 1.27 decode.go; the path uses JSON key names. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L136-L141).
- Go, wrapped list: `json: cannot unmarshal object into Go value of type []main.Item`. Input: `{"items":[{"id":1}]} into []Item`. Source-derived from Go 1.27 decode.go. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L136-L141).
- Go, array into one value: `json: cannot unmarshal array into Go value of type main.Item`. Input: `[{"id":1}] into Item`. Source-derived from Go 1.27 decode.go. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L136-L141).
- Go, fraction into an integer: `json: cannot unmarshal number 1.5 into Go struct field Item.id of type int`. Input: `{"id":1.5}`. Source-derived: integer fields include the number literal. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L136-L141).
- Go, number into a string: `json: cannot unmarshal number into Go struct field User.name of type string`. Input: `{"name":42}`. Source-derived from Go 1.27 decode.go. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/decode.go#L136-L141).
- Go with GOEXPERIMENT=jsonv2: `json: cannot unmarshal {value} into Go struct field {path} of type {type}: {detail}`. Input: `Built with the jsonv2 experiment`. Go 1.27 experimental template; values and paths can be worded differently. [Source](https://github.com/golang/go/blob/go1.27.0/src/encoding/json/v2_decode.go#L132-L154).
- C# / System.Text.Json: `The JSON value could not be converted to {0}.`. Input: `"42" into an int property`. Official .NET 10 resource template; path and location omitted. [Source](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Text.Json/src/Resources/Strings.resx#L321).

## Rows added to batch-1 guides

Stack Exchange showed separate demand for these messages, but their intent matches an existing guide, so they were added as rows rather than new pages.

- /json-errors/unexpected-token-html:
  - Safari, React Native / JavaScriptCore: `JSON Parse error: Unrecognized token '<'`. Input: `HTML starting with <`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/LiteralParser.cpp#L846).
  - Java / Jackson: `Unexpected character ('<' (code 60)): expected a valid value (JSON String, Number, Array, Object or token 'null', 'true' or 'false')`. Input: `HTML starting with <`. Source-derived from Jackson 2.22; location suffix omitted. [Source](https://github.com/FasterXML/jackson-core/blob/jackson-core-2.22.3/src/main/java/com/fasterxml/jackson/core/json/ReaderBasedJsonParser.java#L2065).
  - Rust / serde_json: `expected value at line 1 column 1`. Input: `serde_json::from_str on HTML`. Source-derived from serde_json 1.0.154 error.rs and read.rs. [Source](https://github.com/serde-rs/json/blob/v1.0.154/src/error.rs#L362).
- /json-errors/unexpected-end-of-json-input:
  - JavaScript / V8, cut-off string: `SyntaxError: Unterminated string in JSON at position 9 (line 1 column 10)`. Input: `JSON.parse('{"a":"abc')`. Reproduced in Node.js 24.21.0.
  - Python, cut-off string: `json.decoder.JSONDecodeError: Unterminated string starting at: line 1 column 6 (char 5)`. Input: `json.loads('{"a":"abc')`. Reproduced in Python 3.14.4.
  - Firefox: `SyntaxError: JSON.parse: unexpected end of data at line 1 column 1 of the JSON data`. Input: `JSON.parse("")`. Source-derived from Firefox 158 JSONParser.cpp and its message template. [Source](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_158_0_RELEASE/js/src/vm/JSONParser.cpp#L98).
  - Java / Jackson: `MismatchedInputException: No content to map due to end-of-input`. Input: `readValue on an empty string or stream`. Official Jackson 2.22 source message; location suffix omitted. [Source](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.3/src/main/java/com/fasterxml/jackson/databind/ObjectMapper.java#L5144).
  - Rust / serde_json: `EOF while parsing a value at line 1 column 0`. Input: `serde_json::from_str on ""`. Source-derived from serde_json 1.0.154 error.rs and read.rs. [Source](https://github.com/serde-rs/json/blob/v1.0.154/src/error.rs#L357).
- /json-errors/undefined-is-not-valid-json:
  - Python, already decoded: `TypeError: the JSON object must be str, bytes or bytearray, not dict`. Input: `json.loads({'id': 1})`. Reproduced in Python 3.14.4.
  - Safari / JavaScriptCore: `JSON Parse error: Unexpected identifier "undefined"`. Input: `JSON.parse(undefined)`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/LiteralParser.cpp#L1282).
- /json-errors/single-quotes-unquoted-keys:
  - Safari / JavaScriptCore: `JSON Parse error: Single quotes (') are not allowed in JSON`. Input: `JSON.parse("{'id':1}")`. JavaScriptCore source (WebKit tag webkitgtk-2.54.1) with the JSON Parse error prefix. [Source](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.1/Source/JavaScriptCore/runtime/LiteralParser.cpp#L769).
  - Rust / serde_json: `key must be a string at line 1 column 2`. Input: `serde_json::from_str on {'id':1}`. Source-derived from serde_json 1.0.154 error.rs and read.rs. [Source](https://github.com/serde-rs/json/blob/v1.0.154/src/error.rs#L371).
- /json-errors/extra-data:
  - Rust / serde_json: `trailing characters at line 1 column 4`. Input: `serde_json::from_str on "{} {}"`. Source-derived from serde_json 1.0.154 error.rs and read.rs. [Source](https://github.com/serde-rs/json/blob/v1.0.154/src/error.rs#L382).

## Batch 2 verification

- Every JavaScript and Python cause and fix snippet in the twelve new guides was extracted from errors.ts and run as written; invalid examples raise the stated error and the corrected examples print the stated output. Every row marked "Reproduced in" was compared with live output character for character.
- Java, Go, C# and PHP snippets were not compiled (no toolchains installed). They use only APIs named in the cited sources and official documentation.
- Serialization guides omit the input-position section; type-mismatch guides replace it with a section on comparing the JSON shape in the viewer.
