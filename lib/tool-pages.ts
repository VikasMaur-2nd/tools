import type { EnginePreset } from './engine/engine';

export type ToolPage = {
  slug: string;
  query: string;
  secondary: string[];
  title: string;
  description: string;
  heading: string;
  intro: string;
  modeLabel: string;
  preset: EnginePreset;
  sample: string;
  sampleName?: string;
  exampleLabel: string;
  steps: string[];
  options: string[];
  faqs: { question: string; answer: string }[];
  related: string[];
  sections?: { heading: string; paragraphs: string[]; code?: string }[];
};

const json = '{"name":"Ada","age":36,"active":true,"tags":["json","tools"],"profile":{"city":"London"}}';
const records = '{"users":[{"id":1,"name":"Ada","role":"admin"},{"id":2,"name":"Lin","role":"editor"}]}';
const invalid = '{"name":"Ada","age":36,}';
const yaml = 'name: Ada\nage: 36\nactive: true\ntags:\n  - json\n  - tools\n';
const csv = 'id,name,role\n1,Ada,admin\n2,Lin,editor\n';
const xml = '<users><user><id>1</id><name>Ada</name></user><user><id>2</id><name>Lin</name></user></users>';
const jwt = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjMiLCJuYW1lIjoiQWRhIiwiaWF0IjoxNTE2MjM5MDIyfQ.';

const convertPreset = (target: string): EnginePreset => ({ settings: { view: 'convert', target, rootName: 'Root' }, initialText: json, initialFileName: 'example.json' });
const formatPreset = (minify = false): EnginePreset => ({ settings: { view: 'format', minify }, initialText: json, initialFileName: 'example.json' });

export const TOOL_PAGES: ToolPage[] = [
  {
    slug: 'json-validator', query: 'json validator', secondary: ['validate json online', 'json syntax checker'],
    title: 'JSON validator with line and column errors', description: 'Validate JSON online in your browser. Find syntax errors, trailing commas and repairable issues without uploading sensitive data.',
    heading: 'JSON validator', intro: 'Paste JSON to check whether it follows the standard syntax. Tool Kumar marks the exact line and column and offers repairs for common loose JSON.', modeLabel: 'Validation and error view', preset: { settings: { view: 'format' }, initialText: invalid, initialFileName: 'invalid-example.json' }, sample: invalid, exampleLabel: 'This sample has a trailing comma. The validator points to the comma after 36.', steps: ['Paste the document into the input pane.', 'Read the error banner and jump to its location.', 'Fix the character or choose Repair input when the issue is safe to correct.'], options: ['Checks objects, arrays, strings, numbers, booleans and null.', 'Reports trailing commas, comments and other fixable input issues separately.', 'Use the formatted view to confirm the repaired result.'], faqs: [{ question: 'What does a JSON validator check?', answer: 'It checks JSON syntax, including quotes, commas, brackets, numbers and the allowed value types.' }, { question: 'Can it repair invalid JSON?', answer: 'It can repair common issues such as trailing commas and single quotes, then shows the result as an undoable edit.' }, { question: 'Where does validation happen?', answer: 'The parser runs locally in your browser. Tool Kumar does not need a server request.' }], related: ['home', 'json-minifier', 'json-schema-generator']
  },
  {
    slug: 'json-minifier', query: 'json minifier', secondary: ['minify json online', 'compress json'],
    title: 'JSON minifier for compact API payloads', description: 'Minify JSON online and copy a compact payload. Tool Kumar keeps key order and large numeric values while processing the file locally.',
    heading: 'JSON minifier', intro: 'Remove insignificant whitespace from JSON before sending it over a wire or storing it in a fixture. The readable input remains on the left.', modeLabel: 'Minified JSON view', preset: formatPreset(true), sample: json, exampleLabel: 'The minifier removes indentation and line breaks while keeping every value.', steps: ['Paste valid JSON.', 'The output switches to one compact line.', 'Copy or download the minified JSON.'], options: ['Switch back to pretty output at any time.', 'Sort keys only when your consumer does not depend on insertion order.', 'The parser preserves source digits instead of rounding large integers.'], faqs: [{ question: 'Does minification change JSON data?', answer: 'No. It removes whitespace outside strings. Values, key names and order remain the same.' }, { question: 'Will strings be changed?', answer: 'No. Whitespace inside quoted strings stays intact.' }, { question: 'Can I validate while minifying?', answer: 'Yes. The status bar reports whether the input is valid before the compact output is produced.' }], related: ['home', 'json-validator', 'json-to-csv']
  },
  {
    slug: 'json-diff', query: 'json diff', secondary: ['compare json', 'json comparison tool'],
    title: 'JSON diff tool for comparing two documents', description: 'Compare two JSON documents side by side. Tool Kumar highlights changed values and keeps both inputs local in your browser.',
    heading: 'JSON diff', intro: 'Paste an original document and a modified document to see what changed. The compare view keeps the two editors aligned and marks additions, removals and edits.', modeLabel: 'Compare view', preset: { settings: { view: 'compare' }, initialText: '{"name":"Ada","role":"admin"}', initialFileName: 'original.json' }, sample: '{"name":"Ada","role":"admin"}\n\nModified:\n{"name":"Ada","role":"editor"}', exampleLabel: 'In this example the role value changes from admin to editor.', steps: ['Paste the original JSON in the first pane.', 'Paste the modified JSON in the second pane.', 'Review highlighted changes and copy either document when finished.'], options: ['Both documents are parsed before comparison.', 'Formatting differences are easier to read after formatting each side.', 'Use valid JSON on both sides for structural tree comparison.'], faqs: [{ question: 'Can I compare two JSON files?', answer: 'Yes. Open a file in each compare pane, or paste both documents.' }, { question: 'Does the diff send files to a server?', answer: 'No. Parsing and comparison happen in the browser.' }, { question: 'Can it compare nested arrays?', answer: 'Yes. Nested objects and arrays are parsed and shown in the compare view.' }], related: ['home', 'json-validator', 'json-schema-generator']
  },
  {
    slug: 'json-to-typescript', query: 'json to typescript', secondary: ['json to typescript interface', 'json converter typescript'],
    title: 'JSON to TypeScript converter with interfaces', description: 'Convert JSON to TypeScript interfaces or types online. Paste an example and get code with inferred nested shapes in your browser.',
    heading: 'JSON to TypeScript', intro: 'Turn a representative JSON response into TypeScript declarations. The converter follows nested objects and arrays so the generated types match the sample shape.', modeLabel: 'TypeScript output', preset: convertPreset('typescript'), sample: json, exampleLabel: 'The output below is generated from the sample JSON by Tool Kumar.', steps: ['Paste a representative JSON response.', 'Choose TypeScript in the convert view.', 'Set the root name, then copy or download the declarations.'], options: ['Use interface or type syntax from the TypeScript style setting.', 'Rename the root type to match your API resource.', 'Optional and union inference follows the values present in the sample.'], faqs: [{ question: 'Does JSON to TypeScript handle nested objects?', answer: 'Yes. Nested objects become named declarations and arrays use the inferred item type.' }, { question: 'Can I choose an interface or type?', answer: 'Yes. The TypeScript style setting switches the generated declaration form.' }, { question: 'Is the JSON uploaded?', answer: 'No. Conversion uses the local parser and converter in your browser.' }], related: ['json-to-zod', 'json-schema-generator', 'json-to-go']
  },
  {
    slug: 'json-to-zod', query: 'json to zod', secondary: ['json to zod schema', 'generate zod from json'],
    title: 'JSON to Zod schema generator', description: 'Generate a Zod schema from JSON online. Tool Kumar infers nested objects and arrays locally and lets you copy the TypeScript result.',
    heading: 'JSON to Zod', intro: 'Paste example JSON and get a Zod schema you can add to a TypeScript project. The generated checks mirror the values and nesting in your sample.', modeLabel: 'Zod schema output', preset: convertPreset('zod'), sample: json, exampleLabel: 'Tool Kumar generates this schema from the sample object.', steps: ['Paste the JSON shape your application receives.', 'Open the convert view and choose Zod schema.', 'Change the root name and copy the generated code.'], options: ['Nested objects become nested z.object calls.', 'Arrays use the inferred item schema.', 'The output is code only. Add project-specific refinements such as email or minimum length yourself.'], faqs: [{ question: 'Does this create a complete API validator?', answer: 'It creates a Zod schema for the sample shape. Add refinements for rules that the sample cannot reveal.' }, { question: 'How are nulls handled?', answer: 'Null values become z.null() in the generated schema.' }, { question: 'Can I rename the root schema?', answer: 'Yes. Set the root name in the converter toolbar.' }], related: ['json-to-typescript', 'json-schema-generator', 'json-validator']
  },
  {
    slug: 'json-schema-generator', query: 'json schema generator', secondary: ['generate json schema from json', 'json to schema'],
    title: 'JSON Schema generator from an example', description: 'Generate JSON Schema from a JSON example. Tool Kumar infers properties, arrays and primitive types in your browser with no upload.',
    heading: 'JSON Schema generator', intro: 'Use a representative JSON document to create a draft JSON Schema. The result describes the observed shape and gives you a starting point for validation.', modeLabel: 'JSON Schema output', preset: convertPreset('json-schema'), sample: json, exampleLabel: 'The schema is generated from the sample object, including nested profile and tags.', steps: ['Paste an example document.', 'Choose JSON Schema in the convert view.', 'Review the inferred properties and save the schema.'], options: ['Nested objects and arrays are represented recursively.', 'The generator describes observed types. Add required fields and constraints for your API contract.', 'Use the validator page to check JSON syntax before generating.'], faqs: [{ question: 'Does the generator mark every property required?', answer: 'It describes the observed properties. Review required fields for your API contract before publishing the schema.' }, { question: 'Which draft does it use?', answer: 'The output declares JSON Schema Draft 2020-12 with standard type and properties keywords.' }, { question: 'Can it infer array item shapes?', answer: 'Yes. Arrays of objects produce an items schema based on the observed object shape.' }], related: ['json-validator', 'json-to-typescript', 'json-to-zod']
  },
  {
    slug: 'json-to-go', query: 'json to go', secondary: ['json to golang struct', 'json to go struct'],
    title: 'JSON to Go struct converter', description: 'Convert JSON to Go structs with nested types and JSON tags. Tool Kumar runs the conversion in your browser and keeps the input local.',
    heading: 'JSON to Go', intro: 'Generate Go struct definitions from a JSON example. Names are converted to exported Go identifiers and tags preserve the original keys.', modeLabel: 'Go output', preset: convertPreset('go'), sample: json, exampleLabel: 'These structs come from the sample JSON and its nested profile object.', steps: ['Paste JSON from the response you model.', 'Choose Go in the convert view.', 'Copy the generated structs into your package and review names.'], options: ['Root and nested type names are inferred from keys.', 'JSON tags preserve keys that do not match Go naming.', 'Review time, decimal and nullable fields because JSON examples cannot express all domain rules.'], faqs: [{ question: 'Does the converter add JSON tags?', answer: 'Yes. Each field keeps its source key in a json struct tag.' }, { question: 'How are nested objects handled?', answer: 'They become separate named structs referenced by the parent struct.' }, { question: 'Can I change the root name?', answer: 'Yes. Set the root name in the converter toolbar.' }], related: ['json-to-typescript', 'json-to-python', 'json-schema-generator']
  },
  {
    slug: 'json-to-python', query: 'json to python', secondary: ['json to pydantic', 'json to python class'],
    title: 'JSON to Python model converter', description: 'Convert JSON to Python Pydantic models. Tool Kumar infers nested fields and keeps your sample data in the browser while generating code.',
    heading: 'JSON to Python', intro: 'Turn a JSON response into Python Pydantic model definitions. Use the generated code as a typed starting point, then add domain validation.', modeLabel: 'Python output', preset: convertPreset('python'), sample: json, exampleLabel: 'The Python models below are generated from the sample JSON.', steps: ['Paste a JSON object or API response.', 'Choose Python (Pydantic) in the convert view.', 'Set a root name and copy the model definitions.'], options: ['Nested objects become nested BaseModel classes.', 'Lists and optional values follow the observed sample.', 'Review date, decimal and union rules for production data.'], faqs: [{ question: 'Does it generate Pydantic models?', answer: 'Yes. The Python target emits Pydantic BaseModel definitions with typed fields.' }, { question: 'What happens to JSON keys with hyphens?', answer: 'The converter creates a valid Python field name and keeps the source key with an alias when needed.' }, { question: 'Can I use a single JSON record?', answer: 'Yes. A single object is enough to infer a model. Use a broad sample when fields vary.' }], related: ['json-to-go', 'json-to-typescript', 'json-schema-generator']
  },
  {
    slug: 'json-to-yaml', query: 'json to yaml', secondary: ['convert json to yaml', 'json yaml converter'],
    title: 'JSON to YAML converter', description: 'Convert JSON to YAML online with a local, lossless parser. Paste an object or array and copy clean YAML for configuration and docs.',
    heading: 'JSON to YAML', intro: 'Convert JSON data into readable YAML without sending it to a server. The converter handles nested objects, arrays, strings, booleans, nulls and numbers.', modeLabel: 'YAML output', preset: convertPreset('yaml'), sample: json, exampleLabel: 'This YAML is produced by the built-in JSON to YAML converter.', steps: ['Paste valid JSON.', 'Choose YAML in the convert view.', 'Copy the YAML or download it for a config file.'], options: ['Indentation follows the converter output and nested arrays remain readable.', 'Quoted strings stay strings when YAML could otherwise infer a different type.', 'Review YAML-specific anchors or application tags because the converter emits plain data YAML.'], faqs: [{ question: 'Can I convert nested JSON to YAML?', answer: 'Yes. Objects and arrays are emitted recursively with readable indentation.' }, { question: 'Are large JSON numbers preserved?', answer: 'The parser keeps source number text while converting, so large integers are not rounded by JavaScript.' }, { question: 'Can YAML be imported back to JSON?', answer: 'Yes. Use the YAML to JSON page to parse plain YAML back into formatted JSON.' }], related: ['yaml-to-json', 'json-to-csv', 'home']
  },
  {
    slug: 'yaml-to-json', query: 'yaml to json', secondary: ['convert yaml to json', 'yaml converter json'],
    title: 'YAML to JSON converter in your browser', description: 'Convert YAML to formatted JSON online. Tool Kumar parses plain YAML locally, reports errors and keeps the converted document on your device.',
    heading: 'YAML to JSON', intro: 'Paste a YAML document and turn it into JSON for an API, test fixture or debugging session. The importer handles mappings, sequences, scalars and quoted values.', modeLabel: 'YAML import to JSON', preset: { settings: { view: 'format' }, initialText: yaml, initialFileName: 'example.yaml', initialImport: 'yaml' }, sample: yaml, sampleName: 'example.yaml', exampleLabel: 'The formatted JSON below is produced by importing this YAML sample.', steps: ['Paste YAML or open a .yaml or .yml file.', 'Choose YAML → JSON when the importer detects YAML.', 'Review the formatted JSON, then copy or download it.'], options: ['Plain mappings and sequences become JSON objects and arrays.', 'Quoted values remain strings; unquoted numbers and booleans become JSON values.', 'Anchors, custom tags and executable YAML are outside the plain-data importer.'], faqs: [{ question: 'Does the importer support YAML lists?', answer: 'Yes. Indented dash items become JSON arrays, including arrays nested inside objects.' }, { question: 'What YAML features are unsupported?', answer: 'The importer focuses on plain data. Custom tags, anchors and application-specific directives may need a YAML library.' }, { question: 'Can I open a YAML file?', answer: 'Yes. Use Open file and Tool Kumar detects .yaml and .yml extensions before importing.' }], related: ['json-to-yaml', 'csv-to-json', 'xml-to-json']
  },
  {
    slug: 'json-to-csv', query: 'json to csv', secondary: ['convert json to csv', 'json csv converter'],
    title: 'JSON to CSV converter for records', description: 'Convert an array of JSON records to CSV online. Tool Kumar flattens nested fields into dotted columns and keeps the export local.',
    heading: 'JSON to CSV', intro: 'Turn JSON records into a spreadsheet-friendly CSV. The converter finds the main array of objects, creates columns and quotes values that contain commas or line breaks.', modeLabel: 'CSV output', preset: { settings: { view: 'convert', target: 'csv' }, initialText: records, initialFileName: 'users.json' }, sample: records, exampleLabel: 'This CSV is generated from the users array in the sample document.', steps: ['Paste an array of objects or an API response containing one.', 'Choose CSV in the convert view.', 'Copy the preview or download the CSV file.'], options: ['Nested object keys become dotted column names such as profile.city.', 'Arrays are kept as compact JSON inside a cell when they cannot become columns.', 'The largest suitable object array is selected from a response wrapper.'], faqs: [{ question: 'What JSON shape works best for CSV?', answer: 'Use an array of objects. The converter also finds the largest object array inside a response wrapper such as users or data.' }, { question: 'How are nested objects represented?', answer: 'Nested properties become dotted column names, which keeps the CSV rectangular.' }, { question: 'Are commas and quotes escaped?', answer: 'Yes. CSV fields are quoted and embedded quotes are doubled according to standard CSV rules.' }], related: ['csv-to-json', 'json-to-excel', 'home']
  },
  {
    slug: 'csv-to-json', query: 'csv to json', secondary: ['convert csv to json', 'csv json converter'],
    title: 'CSV to JSON converter with type inference', description: 'Convert CSV to JSON online. Tool Kumar detects columns, parses numbers and booleans, and keeps the imported result in your browser.',
    heading: 'CSV to JSON', intro: 'Paste CSV or open a .csv file to create a JSON array of records. The importer reads quoted fields and infers simple numbers, booleans and nulls.', modeLabel: 'CSV import to JSON', preset: { settings: { view: 'format' }, initialText: csv, initialFileName: 'example.csv', initialImport: 'csv' }, sample: csv, sampleName: 'example.csv', exampleLabel: 'The JSON below is generated by importing the CSV sample.', steps: ['Paste CSV with a header row.', 'Choose CSV → JSON when the detector identifies the input.', 'Review the array and copy or download the JSON.'], options: ['Comma, semicolon, tab and pipe delimiters are detected.', 'Quoted fields may contain commas and line breaks.', 'Empty unquoted fields become null; quoted empty fields stay empty strings.'], faqs: [{ question: 'Does CSV to JSON read quoted commas?', answer: 'Yes. The importer tracks quoted fields so commas inside a value stay inside that value.' }, { question: 'How are numbers detected?', answer: 'Unquoted cells matching JSON number syntax become numbers. Quote a value when it must remain a string.' }, { question: 'Can I open a TSV file?', answer: 'Yes. The same importer detects tab-separated files and converts them to JSON records.' }], related: ['json-to-csv', 'home', 'yaml-to-json']
  },
  {
    slug: 'json-to-xml', query: 'json to xml', secondary: ['convert json to xml', 'json xml converter'],
    title: 'JSON to XML converter for nested data', description: 'Convert JSON to XML online. Tool Kumar maps objects and arrays to readable XML in your browser and keeps the source document private.',
    heading: 'JSON to XML', intro: 'Create XML from a JSON object or array for a legacy endpoint, feed or integration test. Keys become element names and repeated array items become repeated elements.', modeLabel: 'XML output', preset: convertPreset('xml'), sample: json, exampleLabel: 'The XML is generated from the sample object with Root as the document element.', steps: ['Paste valid JSON.', 'Choose XML in the convert view.', 'Set the root name if the receiving system expects a specific element.'], options: ['Object keys become XML elements.', 'Arrays emit repeated child elements.', 'Values are escaped as XML text, including ampersands and angle brackets.'], faqs: [{ question: 'How are JSON arrays represented in XML?', answer: 'Array values become repeated elements under their property name.' }, { question: 'Can I change the root element?', answer: 'Yes. Set the root name in the converter toolbar.' }, { question: 'Does it preserve JSON null?', answer: 'Null values are emitted as empty elements. Check the receiving schema if it needs an explicit nil attribute.' }], related: ['xml-to-json', 'json-to-yaml', 'home']
  },
  {
    slug: 'xml-to-json', query: 'xml to json', secondary: ['convert xml to json', 'xml json converter'],
    title: 'XML to JSON converter for simple documents', description: 'Convert XML to formatted JSON online. Tool Kumar parses elements and attributes locally and shows the result without uploading the source file.',
    heading: 'XML to JSON', intro: 'Paste an XML document or open a local file to turn elements into JSON objects. Repeated sibling elements become arrays, which works well for data-focused XML.', modeLabel: 'XML import to JSON', preset: { settings: { view: 'format' }, initialText: xml, initialFileName: 'example.xml', initialImport: 'xml' }, sample: xml, sampleName: 'example.xml', exampleLabel: 'The JSON below is generated by importing the two repeated user elements.', steps: ['Paste XML or open an .xml file.', 'Choose XML → JSON when the detector identifies XML.', 'Review the object and copy the formatted JSON.'], options: ['Repeated child names become arrays.', 'Attributes are kept with the importer’s attribute representation.', 'The importer handles data XML. Mixed-content documents may need a domain-specific XML parser.'], faqs: [{ question: 'Do repeated XML elements become arrays?', answer: 'Yes. Repeated siblings are grouped into a JSON array.' }, { question: 'Are XML attributes preserved?', answer: 'Yes. Attributes are represented in the imported object so their values remain available.' }, { question: 'Can I open an XML file?', answer: 'Yes. Tool Kumar detects .xml files in the file picker and offers XML to JSON.' }], related: ['json-to-xml', 'yaml-to-json', 'home']
  },
  {
    slug: 'json-to-excel', query: 'json to excel', secondary: ['convert json to xlsx', 'json excel converter'],
    title: 'JSON to Excel converter with local XLSX export', description: 'Export JSON records to an Excel XLSX file online. Tool Kumar builds the workbook in your browser and never uploads your data.',
    heading: 'JSON to Excel', intro: 'Turn an array of JSON records into an .xlsx workbook. The same record flattening used by the CSV export gives you a clean sheet for review or sharing.', modeLabel: 'Excel export', preset: { settings: { view: 'convert', target: 'xlsx' }, initialText: records, initialFileName: 'users.json' }, sample: records, exampleLabel: 'The preview uses the same record columns that the XLSX download receives.', steps: ['Paste an array of records or an API response with one.', 'Choose Excel in the convert view.', 'Download the generated .xlsx workbook.'], options: ['Nested fields become dotted columns.', 'A response wrapper is searched for the largest object array.', 'The workbook is created with browser APIs and does not leave the device.'], faqs: [{ question: 'Can I export nested JSON to Excel?', answer: 'Yes. Nested properties become dotted columns so each record fits a worksheet row.' }, { question: 'Does the tool upload my data?', answer: 'No. XLSX generation runs locally in the browser.' }, { question: 'What if my JSON is one object?', answer: 'The exporter uses the object or the largest nested array of objects it can find. Arrays of records produce the most useful sheet.' }], related: ['json-to-csv', 'csv-to-json', 'home']
  },
  {
    slug: 'jwt-decoder', query: 'jwt decoder', secondary: ['decode jwt online', 'jwt decode online'],
    title: 'JWT decoder for header, payload and claims', description: 'Decode a JWT online without sending the token to a server. Tool Kumar shows the header, payload, signature text and readable time claims.',
    heading: 'JWT decoder', intro: 'Paste a compact JWT to inspect its header and payload. Decoding does not verify the signature, so use the result for inspection and debugging rather than authentication.', modeLabel: 'Decoded JWT JSON', preset: { settings: { view: 'format' }, initialText: jwt, initialFileName: 'token.jwt', decodeJwt: true }, sample: jwt, sampleName: 'example.jwt', exampleLabel: 'Tool Kumar decodes this unsigned example token into header, payload, signature and claims.', steps: ['Paste a JWT or include a Bearer prefix.', 'Review the decoded header and payload.', 'Check exp, iat and nbf values, then verify the signature in your own application.'], options: ['The decoder accepts JWS compact tokens with three parts.', 'It does not verify the signature or fetch a key.', 'Numeric date claims are shown as readable ISO times in the decoded view.'], faqs: [{ question: 'Does decoding a JWT verify it?', answer: 'No. Decoding only reads the base64url header and payload. Signature verification must happen with the issuer’s key in your application.' }, { question: 'Is my token sent anywhere?', answer: 'No. Decoding runs in the browser and the token stays on your device.' }, { question: 'Can it decode a Bearer token?', answer: 'Yes. The decoder accepts a token with an optional Bearer prefix.' }], related: ['json-validator', 'home', 'json-diff']
  },
  {
    "slug": "json-to-dart",
    "query": "json to dart",
    "secondary": [
      "json to dart model",
      "json to dart null safety"
    ],
    "title": "JSON to Dart models with null safety and JSON methods",
    "description": "Convert JSON to null-safe Dart classes with constructors, fromJson and toJson. Generate nested Flutter models locally without uploading your sample.",
    "heading": "JSON to Dart",
    "intro": "Generate Dart models for a Flutter API response. The output has final fields, const constructors, a fromJson factory and a toJson method for each nested class.",
    "modeLabel": "JSON to Dart output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "dart",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "JSON keys such as user-id map to camelCase fields. The generated JSON methods keep the original keys.",
      "Integer and fractional prices merge into double. The decoder casts through num and calls toDouble, so both sample values work.",
      "Null plus a string produces String?. A field seen only as null stays dynamic because its intended type is unknown.",
      "Dates stay String. Review DateTime parsing yourself. Dart compiled for the web cannot represent every large integer exactly."
    ],
    "faqs": [
      {
        "question": "Does this generate json_serializable annotations?",
        "answer": "No. It writes the fromJson and toJson methods directly. There are no @JsonSerializable annotations, part files or build_runner step."
      },
      {
        "question": "How does it handle null safety?",
        "answer": "Nulls and fields missing in some records make inferred fields nullable. Non-null fields use required constructor arguments. Null-only fields use dynamic."
      },
      {
        "question": "Can it convert arrays of nested objects?",
        "answer": "Yes. The sample produces List<Item>, maps each input element through Item.fromJson and calls toJson on each item when encoding."
      },
      {
        "question": "Do I need a Flutter package?",
        "answer": "The generated models use Dart core types. Decode response text with dart:convert, then call Root.fromJson."
      }
    ],
    "sections": [
      {
        "heading": "Use the model in Flutter",
        "paragraphs": [
          "Import dart:convert and paste the generated classes into a model file. Pass the decoded response map to Root.fromJson. jsonEncode calls the generated toJson method.",
          "If your project already uses json_serializable, adapt the fields to that workflow rather than maintaining two sets of generated JSON methods."
        ],
        "code": "import 'dart:convert';\n\nfinal model = Root.fromJson(jsonDecode(responseBody) as Map<String, dynamic>);\nfinal text = jsonEncode(model.toJson());"
      }
    ],
    "related": [
      "json-to-swift",
      "json-to-kotlin",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-kotlin",
    "query": "json to kotlin data class",
    "secondary": [
      "json to kotlin converter",
      "json to kotlin dto"
    ],
    "title": "JSON to Kotlin data classes for kotlinx.serialization",
    "description": "Generate Kotlin data classes from JSON with @Serializable and @SerialName. Infer nested models, lists and nullable fields in your browser.",
    "heading": "JSON to Kotlin data classes",
    "intro": "Turn example JSON into data classes for kotlinx.serialization. Nested objects get their own classes, arrays become List values and renamed fields keep their wire names through @SerialName.",
    "modeLabel": "JSON to Kotlin data classes output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "kotlin",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "The generator emits @Serializable on each data class and imports kotlinx.serialization annotations. It does not emit Moshi @Json or Gson @SerializedName.",
      "Integers use Long, fractions use Double and null-only or mixed values use JsonElement. Nullable fields default to null.",
      "Integers beyond signed 64-bit range become Double, which can lose precision. Use strings or a custom serializer for exact identifiers.",
      "Date strings remain String. A single sample cannot tell whether a field is required in every API response."
    ],
    "faqs": [
      {
        "question": "Which Kotlin serialization library does it use?",
        "answer": "kotlinx.serialization. The output uses @Serializable and adds @SerialName when a Kotlin property differs from its JSON key."
      },
      {
        "question": "Can I use it with Moshi?",
        "answer": "The field types can help you start a model, but the annotations target kotlinx.serialization. Replace them and configure Moshi code generation if your Android app uses Moshi."
      },
      {
        "question": "How are missing and null fields handled?",
        "answer": "Fields missing from some array records or observed as null become nullable and default to null. Required non-null fields have no default."
      },
      {
        "question": "Does it create Kotlin DTOs for Android?",
        "answer": "Yes. It creates data classes suitable as DTOs. Configure the Kotlin serialization compiler plugin and the JSON runtime in your project."
      }
    ],
    "sections": [
      {
        "heading": "Decode an Android API response",
        "paragraphs": [
          "Enable the Kotlin serialization compiler plugin and add the kotlinx.serialization JSON dependency in your app. Use the generated Root type with Json.decodeFromString.",
          "ignoreUnknownKeys allows new server fields without failing. Set it only when your API policy allows unknown fields."
        ],
        "code": "import kotlinx.serialization.json.Json\n\nval json = Json { ignoreUnknownKeys = true }\nval model = json.decodeFromString<Root>(responseBody)"
      }
    ],
    "related": [
      "json-to-java",
      "json-to-dart",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-swift",
    "query": "json to swift model",
    "secondary": [
      "json to swift codable",
      "json to swift struct"
    ],
    "title": "JSON to Swift Codable model generator",
    "description": "Convert JSON to Swift Codable structs with CodingKeys, nested models and optional properties. Generate and copy the code locally in your browser.",
    "heading": "JSON to Swift models",
    "intro": "Generate Swift structs that conform to Codable. The converter adds CodingKeys when property names differ from the JSON, so a key such as user-id still decodes into userId.",
    "modeLabel": "JSON to Swift models output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "swift",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "Integers infer Int, fractional values infer Double and integers beyond signed 64-bit range infer Decimal. Check target-platform limits and decimal precision.",
      "Nulls or missing fields become optional properties. A null-only or mixed shape uses the generated JSONValue helper when needed.",
      "JSONValue stores numbers as Double, so use explicit types for exact monetary values or very large IDs.",
      "Date strings remain String. If you change a field to Date, configure JSONDecoder.dateDecodingStrategy for the API format."
    ],
    "faqs": [
      {
        "question": "Does it generate classes or structs?",
        "answer": "Structs conforming to Codable, with let properties and nested model types. It imports Foundation."
      },
      {
        "question": "When does it add CodingKeys?",
        "answer": "When a property name changes, it emits a CodingKeys enum that maps Swift identifiers back to the original JSON keys."
      },
      {
        "question": "How does it handle null?",
        "answer": "Observed nulls and missing fields produce optional properties. Unknown or mixed values use a Codable JSONValue enum, added only when referenced."
      },
      {
        "question": "Can I use JSONDecoder directly?",
        "answer": "Yes. Copy the generated structs into your project and decode Root.self from Data. Review optional fields and date types first."
      }
    ],
    "sections": [
      {
        "heading": "Decode with JSONDecoder",
        "paragraphs": [
          "Use JSONDecoder with the generated Root struct. Codable also supports encoding the same model with JSONEncoder.",
          "Keep the default key strategy for this output. Its CodingKeys already contain wire names, including created_at."
        ],
        "code": "let model = try JSONDecoder().decode(Root.self, from: responseData)\nlet encoded = try JSONEncoder().encode(model)"
      }
    ],
    "related": [
      "json-to-dart",
      "json-to-kotlin",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-java",
    "query": "json to java",
    "secondary": [
      "json to java class",
      "json to java pojo"
    ],
    "title": "JSON to Java records with Jackson field mappings",
    "description": "Generate Java records from JSON with nested records, typed lists and Jackson @JsonProperty mappings. Review the code locally without uploading your input.",
    "heading": "JSON to Java",
    "intro": "Convert an API example into Java records for Jackson. The root is one public record, and nested records live inside it so you can save the output in Root.java.",
    "modeLabel": "JSON to Java output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "java",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "This target emits records, not mutable POJOs with setters. Use Java 16 or newer and a Jackson version that supports records, such as 2.12 or newer.",
      "Renamed or reserved record components get @JsonProperty with the original key. Nested object arrays become List<Item>.",
      "Integers use long, large integers beyond signed 64-bit use BigInteger and fractions use double. Nullable primitives use boxed types such as Long.",
      "Null-only or mixed fields use Object. Dates remain String. Use BigDecimal and a reviewed mapping when exact decimal arithmetic matters."
    ],
    "faqs": [
      {
        "question": "Does JSON to Java generate POJOs?",
        "answer": "It generates immutable Java records. If you need Java 8 POJOs, setters or a no-argument constructor, adapt the output or use a generator for that model style."
      },
      {
        "question": "Which JSON library does it target?",
        "answer": "Jackson. The converter imports @JsonProperty when it needs to preserve a key that differs from a Java component name."
      },
      {
        "question": "Can I save all nested types in one file?",
        "answer": "Yes. The public root record contains nested public records, so the default object output fits in Root.java."
      },
      {
        "question": "How do I deserialize the record?",
        "answer": "Use ObjectMapper.readValue(responseBody, Root.class) with Jackson record support. Review date handling and numeric limits for your API."
      }
    ],
    "sections": [
      {
        "heading": "Use the record with Jackson",
        "paragraphs": [
          "Save the default output as Root.java. Jackson constructs record components from the JSON properties. A nested record such as Item is available as Root.Item.",
          "The output contains no package declaration. Add the package used by your application. Register your usual Jackson modules if you change dates to java.time types."
        ],
        "code": "import com.fasterxml.jackson.databind.ObjectMapper;\n\nRoot model = new ObjectMapper().readValue(responseBody, Root.class);"
      }
    ],
    "related": [
      "json-to-kotlin",
      "json-to-csharp",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-csharp",
    "query": "json to c# class",
    "secondary": [
      "json to c# converter",
      "json to c# model"
    ],
    "title": "JSON to C# classes for System.Text.Json",
    "description": "Generate C# classes from JSON with required properties, nullable types and JsonPropertyName attributes. Convert nested models in your browser.",
    "heading": "JSON to C# classes",
    "intro": "Generate C# models for System.Text.Json. The default output gives each property a JsonPropertyName attribute and uses required for fields present in every sample record.",
    "modeLabel": "JSON to C# classes output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "csharp",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "The default is System.Text.Json. The existing library setting can switch attributes to Newtonsoft.Json JsonProperty and unknown values to JToken.",
      "Generated required members need C# 11 or newer. Nullable reference syntax assumes nullable annotations are enabled.",
      "Integers use long, integers beyond signed 64-bit use decimal, and fractions use double. decimal also has a finite range; choose a custom representation for larger values.",
      "A nullable field can still be required when every record contains its key. Required presence and accepting null are separate rules. Dates remain string."
    ],
    "faqs": [
      {
        "question": "Does it use System.Text.Json or Newtonsoft.Json?",
        "answer": "System.Text.Json by default, with JsonPropertyName attributes. The converter library setting can emit Newtonsoft.Json JsonProperty attributes instead."
      },
      {
        "question": "Which C# version does the output require?",
        "answer": "C# 11 or newer for required members. Enable nullable reference types to use string? and other reference annotations as intended."
      },
      {
        "question": "Why can a required property also be nullable?",
        "answer": "The key appears in every sample record, but its value can be null. For example, required string? Note models presence separately from the value type."
      },
      {
        "question": "Does it generate lists and nested classes?",
        "answer": "Yes. Arrays of objects become List<Item>, and each nested shape gets a generated class."
      }
    ],
    "sections": [
      {
        "heading": "Deserialize with System.Text.Json",
        "paragraphs": [
          "Copy the classes into your .NET project and enable nullable annotations. JsonPropertyName attributes map PascalCase properties to the exact input keys.",
          "Use a .NET version whose System.Text.Json supports required members, such as .NET 7 or newer. Configure serializer options for your application."
        ],
        "code": "using System.Text.Json;\n\nRoot? model = JsonSerializer.Deserialize<Root>(responseBody);"
      }
    ],
    "related": [
      "json-to-java",
      "json-to-typescript",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-rust",
    "query": "json to rust struct",
    "secondary": [
      "json to rust serde",
      "json to rust type"
    ],
    "title": "JSON to Rust structs with serde derives",
    "description": "Generate Rust structs from JSON with serde Serialize and Deserialize, key renames, Vec fields and Option types. Conversion runs locally in your browser.",
    "heading": "JSON to Rust structs",
    "intro": "Generate public Rust structs with Debug, Clone, Serialize and Deserialize derives. JSON keys become snake_case fields with serde rename attributes when the wire name differs.",
    "modeLabel": "JSON to Rust structs output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "rust",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "Arrays become Vec and nullable typed fields become Option. Fields missing in some records add skip_serializing_if = \"Option::is_none\".",
      "Unknown, null-only or mixed values use serde_json::Value. Renames preserve punctuation and reserved Rust words use raw identifiers when possible.",
      "Integers use i64 or i128 beyond signed 64-bit. Fractions use f64. Review serde_json support and numeric range before accepting very large integers.",
      "Dates remain String. Exact decimal money needs a domain type and serializer; a JSON example cannot supply those rules."
    ],
    "faqs": [
      {
        "question": "Does the generator include serde derives?",
        "answer": "Yes. It imports serde::{Deserialize, Serialize} and derives Debug, Clone, Serialize and Deserialize for structs."
      },
      {
        "question": "Are JSON names preserved?",
        "answer": "Yes. It emits serde rename attributes where needed, and can use rename_all = \"camelCase\" when that reduces per-field mappings."
      },
      {
        "question": "How are null and absent values represented?",
        "answer": "Typed nullable or absent fields use Option<T>. Unknown and null-only fields use serde_json::Value, which can itself hold JSON null."
      },
      {
        "question": "Can I deserialize the result with serde_json?",
        "answer": "Yes. Add serde with its derive feature and serde_json to your Rust project, then deserialize into the generated Root type."
      }
    ],
    "sections": [
      {
        "heading": "Use the structs with serde_json",
        "paragraphs": [
          "Enable the derive feature on your serde dependency and add serde_json in Cargo.toml. Copy the structs into a module and deserialize the response.",
          "Sample-based inference does not set application validation rules. Check ranges, required fields and timestamps before treating the decoded model as trusted input."
        ],
        "code": "let model: Root = serde_json::from_str(&response_body)?;\nlet text = serde_json::to_string(&model)?;"
      }
    ],
    "related": [
      "json-to-go",
      "json-to-java",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-php",
    "query": "json to php class",
    "secondary": [
      "json to php array",
      "json to php associative array"
    ],
    "title": "JSON to PHP classes with typed readonly properties",
    "description": "Generate PHP 8.1 classes from JSON with readonly constructor properties and fromArray methods. Learn how to decode JSON to models or associative arrays.",
    "heading": "JSON to PHP classes",
    "intro": "Generate PHP 8.1 or newer classes with typed readonly properties promoted in the constructor. Each class has a fromArray method that maps the original JSON keys and builds nested objects.",
    "modeLabel": "JSON to PHP classes output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "php",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "This output comes from the built-in converter. The two item prices infer a floating-point field; the null and string notes infer a nullable field.",
    "steps": [
      "Paste a representative response, including records whose fields differ.",
      "Review the generated output and change the root name if needed.",
      "Copy or download the code, then check the types against your API contract."
    ],
    "options": [
      "The output starts with declare(strict_types=1) and emits final classes. Nested object arrays get PHPDoc item types and array_map construction.",
      "Nullable values use ?type; a null-only or mixed field uses mixed. Dates stay string.",
      "Integers use int and integers beyond signed 64-bit use float. That can lose precision. Review PHP platform limits and decode large IDs as strings when needed.",
      "There is no toArray or JsonSerializable implementation. Add explicit serialization if you need original JSON keys when encoding the classes."
    ],
    "faqs": [
      {
        "question": "Can I convert JSON to a PHP associative array?",
        "answer": "Yes, using PHP itself: json_decode($json, true, 512, JSON_THROW_ON_ERROR). This generator emits typed model classes rather than a PHP array literal."
      },
      {
        "question": "Which PHP version does the generated code need?",
        "answer": "PHP 8.1 or newer for readonly promoted properties. The output also uses typed properties, named arguments and strict_types."
      },
      {
        "question": "How do nested objects become classes?",
        "answer": "fromArray calls the nested class fromArray method. Arrays of nested objects use array_map, with item types recorded in PHPDoc."
      },
      {
        "question": "Does it preserve keys when encoding back to JSON?",
        "answer": "The fromArray method preserves input mappings. The output has no custom encoder, so json_encode on these objects uses property names. Add JsonSerializable or a toArray method if you need the original wire keys."
      }
    ],
    "sections": [
      {
        "heading": "Choose an array or a typed model",
        "paragraphs": [
          "For a PHP associative array, json_decode with true is enough. To use the generated models, pass that array to Root::fromArray. JSON_THROW_ON_ERROR reports malformed input.",
          "If an ID exceeds PHP_INT_MAX, JSON_BIGINT_AS_STRING can preserve its digits, but you must change the corresponding generated float property to string. An inferred float is not an exact ID type."
        ],
        "code": "$data = json_decode($responseBody, true, 512, JSON_THROW_ON_ERROR);\n$model = Root::fromArray($data);"
      }
    ],
    "related": [
      "json-to-python",
      "json-to-java",
      "json-schema-generator"
    ]
  },
  {
    "slug": "json-to-toml",
    "query": "json to toml",
    "secondary": [
      "json to toml converter",
      "json to toml online"
    ],
    "title": "JSON to TOML converter with tables and arrays",
    "description": "Convert JSON to TOML tables and arrays of tables locally. See how nulls and integers outside the TOML 64-bit range affect the output.",
    "heading": "JSON to TOML",
    "intro": "Turn JSON configuration into TOML tables. Nested objects become table headers and arrays of objects become arrays of tables. Review the output comments for values TOML cannot represent.",
    "modeLabel": "JSON to TOML output",
    "preset": {
      "settings": {
        "view": "convert",
        "target": "toml",
        "rootName": "Root"
      },
      "initialText": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
      "initialFileName": "example.json"
    },
    "sample": "{\n  \"user-id\": 42,\n  \"profile\": {\n    \"city\": \"London\",\n    \"created_at\": \"2026-10-14T09:00:00Z\"\n  },\n  \"items\": [\n    {\n      \"price\": 12,\n      \"note\": null\n    },\n    {\n      \"price\": 12.5,\n      \"note\": \"gift\"\n    }\n  ]\n}",
    "exampleLabel": "The generated TOML has a [profile] table and two [[items]] tables. The null note is omitted with a comment.",
    "steps": [
      "Paste valid JSON configuration.",
      "Review the TOML tables and any comments about omitted or changed values.",
      "Copy or download the TOML, then validate it against your application configuration schema."
    ],
    "options": [
      "TOML has no null value. Null properties are omitted with a comment, and null elements inside arrays or inline objects are dropped. This conversion can change the data.",
      "Integers outside signed 64-bit range are written as quoted strings with an explanatory comment.",
      "A top-level array or scalar is wrapped under the root name, which is root by default, because a TOML document must be a table.",
      "Strings remain strings, including date-looking values. Keys with spaces are quoted."
    ],
    "faqs": [
      {
        "question": "Is JSON to TOML lossless?",
        "answer": "Not for every document. TOML has no null, and integers must fit signed 64-bit. The exporter omits nulls and quotes out-of-range integers, with comments explaining those changes."
      },
      {
        "question": "How are arrays of objects represented?",
        "answer": "They become arrays of tables, such as [[items]], with one table for each object."
      },
      {
        "question": "Can I convert back to JSON?",
        "answer": "Yes. Use TOML to JSON for the edited config. Omitted null values cannot be recovered automatically."
      },
      {
        "question": "Can a top-level JSON array become TOML?",
        "answer": "Yes. The converter wraps it under the root name because TOML requires a table at the document root."
      }
    ],
    "sections": [
      {
        "heading": "Move a config into a TOML-based stack",
        "paragraphs": [
          "Use the output for data accepted by a TOML-consuming application, then check that application's schema. Rust Cargo.toml and Python pyproject.toml require specific tables and keys; converting a shape does not create those project files for you.",
          "In this example, each item is a separate [[items]] table. The first note is omitted because it is null. Compare with the source before saving.",
          "If preserving nulls matters, keep JSON or use YAML rather than silently accepting a changed config."
        ]
      }
    ],
    "related": [
      "toml-to-json",
      "json-to-yaml",
      "json-validator"
    ]
  },
  {
    "slug": "toml-to-json",
    "query": "toml to json",
    "secondary": [
      "toml to json converter",
      "toml to json online"
    ],
    "title": "TOML to JSON converter for configuration files",
    "description": "Convert TOML tables, arrays of tables and scalar values to formatted JSON locally. Open a TOML file, inspect the result and download JSON.",
    "heading": "TOML to JSON",
    "intro": "Paste TOML configuration or open a .toml file to see it as formatted JSON. The importer reads tables, dotted keys, arrays, inline tables and TOML strings in your browser.",
    "modeLabel": "TOML import to JSON",
    "preset": {
      "settings": {
        "view": "format"
      },
      "initialText": "title = \"API client\"\nretries = 3\n[server]\nhost = \"localhost\"\nenabled = true\n[[users]]\nname = \"Ada\"\n[[users]]\nname = \"Lin\"\n",
      "initialFileName": "example.toml",
      "initialImport": "toml"
    },
    "sample": "title = \"API client\"\nretries = 3\n[server]\nhost = \"localhost\"\nenabled = true\n[[users]]\nname = \"Ada\"\n[[users]]\nname = \"Lin\"\n",
    "sampleName": "example.toml",
    "exampleLabel": "The server table becomes an object and the repeated users tables become an array of objects.",
    "steps": [
      "Paste TOML or open a .toml file.",
      "Choose TOML to JSON when prompted, then review the converted document.",
      "Copy or download JSON for the receiving application."
    ],
    "options": [
      "TOML date and time values become JSON strings. They do not become executable date objects.",
      "Integer digits are preserved, including hexadecimal, octal and binary integers converted to decimal notation. Consumers using JavaScript Number can still round large values.",
      "TOML inf and nan become null because JSON has no non-finite number values.",
      "Comments and table formatting disappear. Duplicate keys and invalid syntax produce an import error."
    ],
    "faqs": [
      {
        "question": "Does it read arrays of tables?",
        "answer": "Yes. Repeated [[users]] headers produce a JSON array of objects."
      },
      {
        "question": "What happens to TOML dates?",
        "answer": "They become JSON strings. The importer normalizes a date-time separator to T and a trailing lowercase z to Z."
      },
      {
        "question": "Can I import Cargo.toml or pyproject.toml?",
        "answer": "Yes. Open the file or paste its TOML content. The result represents its data; it does not convert package-manager conventions into a different ecosystem."
      },
      {
        "question": "Can it preserve comments?",
        "answer": "No. JSON has no comments. Use the original TOML file if you need its comments or layout."
      }
    ],
    "sections": [
      {
        "heading": "Read TOML data as JSON",
        "paragraphs": [
          "A [server] table becomes a server object. [[users]] headers become records in the users array. This is useful when inspecting a config or sending its data to a JSON API.",
          "Converting a Cargo.toml or pyproject.toml file changes the format, not the meaning of its package or dependency settings. Review the destination schema before using the output."
        ]
      }
    ],
    "related": [
      "json-to-toml",
      "yaml-to-json",
      "json-validator"
    ]
  },
  {
    "slug": "offline-json-formatter",
    "query": "offline json formatter",
    "secondary": [
      "json formatter offline download",
      "offline json formatter windows"
    ],
    "title": "Offline JSON formatter for Windows, Mac and mobile",
    "description": "Install Tool Kumar as a JSON formatter app or use a cached browser tab offline. Learn setup steps, offline checks, local storage and how updates arrive.",
    "heading": "Offline JSON formatter",
    "intro": "Format JSON without an internet connection after the first online visit has finished caching the app. You can keep it in a browser tab or install it as a web app on supported platforms.",
    "modeLabel": "Formatted JSON",
    "preset": {
      "settings": {
        "view": "format",
        "minify": false
      },
      "initialText": "{\"user-id\":42,\"display name\":\"Ada\",\"class\":true,\"profile\":{\"city\":\"London\",\"created_at\":\"2026-10-14T09:00:00Z\"},\"items\":[{\"sku\":\"A1\",\"price\":12,\"note\":null},{\"sku\":\"B2\",\"price\":12.5,\"note\":\"gift\"}],\"metadata\":null}",
      "initialFileName": "example.json"
    },
    "sample": "{\"user-id\":42,\"display name\":\"Ada\",\"class\":true,\"profile\":{\"city\":\"London\",\"created_at\":\"2026-10-14T09:00:00Z\"},\"items\":[{\"sku\":\"A1\",\"price\":12,\"note\":null},{\"sku\":\"B2\",\"price\":12.5,\"note\":\"gift\"}],\"metadata\":null}",
    "exampleLabel": "The same local formatter produces this output online or after its application assets have been cached for offline use.",
    "steps": [
      "Open Tool Kumar while connected and wait a few seconds after the page finishes loading. Allow the browser to store site data.",
      "Open DevTools, choose Network, change the throttling menu to Offline and reload the homepage. On a phone, enable airplane mode and reload.",
      "Paste the sample and confirm formatted output appears. Test conversion too if you need it, then return Network to its usual setting."
    ],
    "options": [
      "Installation is optional. The service worker makes the cached homepage work in a normal browser tab too.",
      "The app caches its homepage, JavaScript, styles, fonts, icons and conversion modules. Visited full pages can be cached; an uncached page falls back to the homepage.",
      "Remote URL loading needs a connection. Analytics and cross-origin requests are not cached. Offline internal navigation can also fall back because Next.js route data is not cached.",
      "Offline use depends on the browser retaining site storage. Clearing site data, private browsing policies or storage eviction can remove the app cache."
    ],
    "faqs": [
      {
        "question": "Is there an offline JSON formatter download for Windows or Mac?",
        "answer": "Install Tool Kumar from Chrome or Edge, or use Add to Dock in Safari on supported macOS versions. It is a web app, not a separate .exe or .dmg download."
      },
      {
        "question": "Can desktop Firefox use it offline?",
        "answer": "Yes, when service workers and site storage are enabled and the first visit has finished caching. Desktop Firefox does not have a built-in PWA installation flow; keep the site in a tab or bookmark it."
      },
      {
        "question": "Can I use the formatter in airplane mode?",
        "answer": "Yes, after an online visit has cached the app. Reload the homepage and test with a sample before relying on it without a connection."
      },
      {
        "question": "How does the offline app update?",
        "answer": "An online homepage load refreshes the cached shell and its assets. When a changed asset set is ready, an open tab offers a Reload message. Close and reopen or reload to use the new version."
      },
      {
        "question": "Where is my JSON stored?",
        "answer": "User-edited JSON is saved in this browser's localStorage when it fits the 2,500,000-character limit. Compare text, file name, settings and theme can also be stored. The service worker cache stores application resources."
      }
    ],
    "sections": [
      {
        "heading": "Install on Windows, macOS, Linux or ChromeOS",
        "paragraphs": [
          "In Chrome, open the browser menu and choose Cast, save, and share, then Install page as app. An install icon may also appear in the address bar. In Edge, choose Settings and more, Apps, then Install this site as an app. Menu labels vary by browser version.",
          "On macOS Sonoma or newer, Safari offers File, Add to Dock. Open the app once while online and run the offline check before disconnecting. Installation does not replace the caching step.",
          "Desktop Firefox has no built-in PWA installation flow. You can still use the cached site offline in Firefox when service workers are enabled."
        ]
      },
      {
        "heading": "Install on iPhone, iPad or Android",
        "paragraphs": [
          "On iOS or iPadOS, open the site in Safari, tap Share and choose Add to Home Screen. Enable Open as Web App if your version offers that switch, then tap Add.",
          "On Android, open the site in Chrome, tap the menu and choose Install app or Add to Home screen. Open it online first and wait for caching before enabling airplane mode."
        ]
      },
      {
        "heading": "Check caching and clear local data",
        "paragraphs": [
          "In Chromium DevTools, Application, Service Workers shows the registered worker. Cache Storage shows the json-viewer cache, and Local Storage shows the jf: keys. The cache holds app assets; localStorage can hold your edited document.",
          "To remove both, close other Tool Kumar tabs, then use Application, Storage, Clear site data, including local storage, cache storage and service workers. Other browsers provide equivalent site-data controls in their settings. You will need an online visit before offline use works again."
        ]
      },
      {
        "heading": "Use sensitive JSON offline",
        "paragraphs": [
          "Test offline mode with a harmless sample first. Once the app works with networking disabled, paste sensitive data. Browser extensions with page access can still read it. Clear the site data when you finish on a shared device."
        ]
      }
    ],
    "related": [
      "secure-json-formatter",
      "home",
      "privacy-study"
    ]
  },
  {
    "slug": "secure-json-formatter",
    "query": "secure json formatter",
    "secondary": [
      "safe json formatter",
      "is json formatter safe"
    ],
    "title": "Secure JSON formatter with browser-local processing",
    "description": "Inspect JSON locally with no document upload or account. Verify Network requests yourself and read the analytics, storage and CSP limits before handling secrets.",
    "heading": "Secure JSON formatter",
    "intro": "Tool Kumar parses and formats your document in the browser. Pasting JSON does not submit it to a server, and no account is needed. The site does use Vercel Web Analytics, so privacy claims should separate document processing from page telemetry.",
    "modeLabel": "Formatted JSON",
    "preset": {
      "settings": {
        "view": "format",
        "minify": false
      },
      "initialText": "{\"user-id\":42,\"display name\":\"Ada\",\"class\":true,\"profile\":{\"city\":\"London\",\"created_at\":\"2026-10-14T09:00:00Z\"},\"items\":[{\"sku\":\"A1\",\"price\":12,\"note\":null},{\"sku\":\"B2\",\"price\":12.5,\"note\":\"gift\"}],\"metadata\":null}",
      "initialFileName": "example.json"
    },
    "sample": "{\"user-id\":42,\"display name\":\"Ada\",\"class\":true,\"profile\":{\"city\":\"London\",\"created_at\":\"2026-10-14T09:00:00Z\"},\"items\":[{\"sku\":\"A1\",\"price\":12,\"note\":null},{\"sku\":\"B2\",\"price\":12.5,\"note\":\"gift\"}],\"metadata\":null}",
    "exampleLabel": "The same local formatter produces this output online or after its application assets have been cached for offline use.",
    "steps": [
      "Open DevTools and select Network. Wait for the page to finish loading, then clear the request list.",
      "Paste harmless JSON with a unique marker such as network-check-7 and edit a value. The formatter should update without a request containing that marker.",
      "Inspect any new requests, especially their Payload tabs. Check both Fetch/XHR and All, since analytics can use beacon requests. This takes about 30 seconds with a small sample."
    ],
    "options": [
      "The parser, code generators and download creation run locally. Opening a local file does not upload it.",
      "Vercel Web Analytics records page views. In production, its script is served from this origin at /_vercel/insights/script.js and telemetry uses /_vercel/insights; the wrapper removes URL fragments before events are sent. No document-content events are configured in the code.",
      "A shared link puts JSON in the URL fragment. The fragment is not sent in an HTTP request, but anyone who has the full link can read the document. Avoid sharing secrets.",
      "Load from URL explicitly fetches the chosen endpoint in your browser. That endpoint sees a request. A ?url= link can also trigger remote loading; use paste or a local file for sensitive work."
    ],
    "faqs": [
      {
        "question": "Is this JSON formatter safe for confidential data?",
        "answer": "It processes documents locally, with no paste upload. You still need to trust the delivered code, your browser and extensions. For secrets, verify the requests, use a tested offline tab and clear local storage afterward."
      },
      {
        "question": "Does the site use analytics?",
        "answer": "Yes. Vercel Web Analytics records page telemetry. The wrapper strips URL fragments, and the application has no configured event that sends editor contents. Analytics requests are separate from local JSON processing."
      },
      {
        "question": "What does the Content Security Policy protect?",
        "answer": "The page CSP blocks framing, restricts base URLs to this origin and blocks embedded objects. It has no script-src or connect-src directive, so it does not restrict all scripts or network destinations."
      },
      {
        "question": "Does my JSON remain after I close the tab?",
        "answer": "User-edited documents up to 2,500,000 characters can persist in this browser's localStorage, along with compare text and settings. Clear site data on shared devices. Visiting a preset page alone does not replace the saved homepage document."
      },
      {
        "question": "Can I paste JWTs or API keys?",
        "answer": "Use a harmless sample to verify offline operation first, then prefer an offline tab for secrets. Extensions with access to the page can still read the editor. A decoded JWT is not a verified token, and a leaked key should be revoked."
      }
    ],
    "sections": [
      {
        "heading": "What browser-local processing protects",
        "paragraphs": [
          "A formatter that uploads JSON gives a server access to the document. Here, parsing and formatting use the browser parser code, and generated downloads use local browser APIs. The ordinary paste flow has no request that carries the document.",
          "The Network check above verifies the current session. It does not prove what every future version will do. Repeat it after updates when the data warrants that care."
        ]
      },
      {
        "heading": "Analytics and third-party requests",
        "paragraphs": [
          "The site uses Vercel Web Analytics to record page views, not document contents. In production, the analytics script loads from /_vercel/insights/script.js on this same origin and sends page telemetry through /_vercel/insights. URL fragments are stripped by the application wrapper before events are sent. Avoid putting secrets in URL paths or query parameters.",
          "The code font is self-hosted at build time, so using this page does not request a font from Google. The source audit found no other analytics integration. A user-requested remote URL fetch is an exception to the normal local input flow."
        ]
      },
      {
        "heading": "Read the actual security headers",
        "paragraphs": [
          "The page Content-Security-Policy is shown below. It blocks embedding this page in a frame, changing its base URL to another origin and loading object/embed content. It does not set script-src, default-src or connect-src on pages.",
          "Other configured headers include nosniff, X-Frame-Options: DENY, strict-origin-when-cross-origin and a Permissions-Policy disabling camera, microphone, geolocation, payment and USB. The service-worker response has a separate, stricter CSP."
        ],
        "code": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
      },
      {
        "heading": "Handle JWTs, API keys and saved documents",
        "paragraphs": [
          "Disable unneeded extensions with page access. Confirm the cached app works with networking disabled before pasting a token or key. Keep secrets out of share links, screenshots and browser URL queries.",
          "User edits can remain in localStorage, which is not an encrypted secrets vault. Close other Tool Kumar tabs and clear the site's local storage, cache storage and service worker through browser site-data settings after sensitive work.",
          "Use a JWT decoder to inspect claims, then verify signatures in your own application. If a credential has already been exposed, revoke or rotate it; formatting cannot undo disclosure."
        ]
      }
    ],
    "related": [
      "offline-json-formatter",
      "jwt-decoder",
      "home",
      "privacy-study"
    ]
  }
];

export const TOOL_PAGE_BY_SLUG = new Map(TOOL_PAGES.map((page) => [page.slug, page]));
