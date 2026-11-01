// The data-safety cases (protocol 5.1) and error cases (5.2). Each is pasted into a tool as written here.
// `node cases.mjs` writes them to cases/ as files you can open or paste by hand (cases/README.md says what each
// checks); the harness imports them from here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const words = 'alpha bravo cedar delta ember fjord grove harbor island jasper kettle lumen maple nectar orbit pixel '.repeat(70_000);

/** Valid JSON whose data must come out unchanged. `docs` holds more than one document when a case has several. */
export const DATA_CASES = [
  { id: 'big-integer', checks: '12345678901234567890 stays exactly that', docs: ['{"id":12345678901234567890,"name":"big"}'] },
  { id: 'max-safe-plus-one', checks: '9007199254740993 is not rounded to 9007199254740992', docs: ['{"value":9007199254740993,"next":9007199254740994}'] },
  { id: 'long-decimal', checks: 'a decimal with more digits than a double keeps them', docs: ['{"value":0.10000000000000000555111512312578270211815834045}'] },
  { id: 'number-spelling', checks: '1.0, 1.50, 1E+2, -0 and 0.5e1 keep their spelling', docs: ['{"a":1.0,"b":1.50,"c":1E+2,"d":-0,"e":0.5e1}'] },
  { id: 'huge-exponent', checks: '1e400 and 1e-400 are not turned into Infinity, 0, null or an error', docs: ['{"huge":1e400,"tiny":1e-400}'] },
  { id: 'duplicate-keys', checks: 'both members of a duplicated key are kept', docs: ['{"a":1,"a":2,"b":3}'] },
  { id: 'key-order', checks: 'keys keep their order (JavaScript objects move integer-like keys first)', docs: ['{"zebra":1,"apple":2,"10":3,"2":4,"mango":5}'] },
  {
    id: 'unicode',
    checks: 'emoji, CJK, right-to-left text, combining marks, U+2028, escaped characters and a lone surrogate survive',
    docs: ['{"emoji":"🚀 👩‍💻","cjk":"東京 서울","rtl":"مرحبا שלום","combining":"é ñ","escaped":"\\u00e9\\u4e2d","separator":"a\\u2028b","lone":"x\\ud800y"}'],
  },
  { id: 'escapes', checks: 'every JSON escape keeps its meaning', docs: ['{"s":"quote\\" backslash\\\\ slash\\/ b\\b f\\f n\\n r\\r t\\t nul\\u0000 end"}'] },
  { id: 'proto-key', checks: 'a "__proto__" key, a "constructor" key and an empty key survive', docs: ['{"__proto__":{"polluted":true},"constructor":1,"":"empty key"}'] },
  { id: 'top-level-scalar', checks: 'a bare string, number and null are accepted (all valid JSON)', docs: ['"text"', '42', 'null'] },
  { id: 'deep-nesting', checks: '2,000 nested arrays format, or are refused with a clear message, without freezing the tab', docs: ['['.repeat(2000) + '1' + ']'.repeat(2000)] },
  { id: 'long-string', checks: 'a single 1,000,000-character string is kept intact', docs: [`{"s":"${words.slice(0, 1_000_000)}"}`] },
];

const base = (lines) => lines.join('\n');
/** Invalid JSON, one mistake each, with the lines where a helpful tool points (1-based). */
export const ERROR_CASES = [
  {
    id: 'trailing-comma',
    mistake: 'a comma before the closing brace',
    lines: [14, 15],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace",', '  "email": "ada@example.com",', '  "active": true,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5,', '}']),
  },
  {
    id: 'missing-comma',
    mistake: 'two members without a comma between them',
    lines: [3, 4],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace"', '  "email": "ada@example.com",', '  "active": true,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}']),
  },
  {
    id: 'single-quotes',
    mistake: 'a string in single quotes',
    lines: [4],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace",', "  \"email\": 'ada@example.com',", '  "active": true,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}']),
  },
  {
    id: 'unquoted-key',
    mistake: 'a key without quotes',
    lines: [5],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace",', '  "email": "ada@example.com",', '  active: true,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}']),
  },
  {
    id: 'comment',
    mistake: 'a // comment line',
    lines: [6],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace",', '  "email": "ada@example.com",', '  "active": true,', '  // roles below', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}']),
  },
  {
    id: 'unclosed-array',
    mistake: 'the closing ] missing at the end',
    lines: [1, 13, 14],
    text: base(['[', '  {', '    "id": 1,', '    "name": "Ada"', '  },', '  {', '    "id": 2,', '    "name": "Grace"', '  },', '  {', '    "id": 3,', '    "name": "Linus"', '  }']),
  },
  {
    id: 'bad-literal',
    mistake: 'True instead of true',
    lines: [5],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace",', '  "email": "ada@example.com",', '  "active": True,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}']),
  },
  {
    id: 'raw-newline',
    mistake: 'an unescaped line break inside a string',
    lines: [3, 4],
    text: base(['{', '  "id": 1042,', '  "name": "Ada', 'Lovelace",', '  "email": "ada@example.com",', '  "active": true,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}']),
  },
  {
    id: 'extra-bracket',
    mistake: 'an extra } at the end',
    lines: [16],
    text: base(['{', '  "id": 1042,', '  "name": "Ada Lovelace",', '  "email": "ada@example.com",', '  "active": true,', '  "roles": [', '    "admin",', '    "editor"', '  ],', '  "address": {', '    "city": "London",', '    "postcode": "W1"', '  },', '  "score": 98.5', '}', '}']),
  },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('cases/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const readme = ['# Test cases', '', 'Paste any of these into a JSON formatter by hand. Generated by `node cases.mjs`.', '', '## Data safety (valid JSON; the formatted output must keep the same data)', '', '| File | Checks |', '|---|---|'];
  for (const c of DATA_CASES) {
    c.docs.forEach((doc, k) => writeFileSync(new URL(`data-${c.id}${c.docs.length > 1 ? `-${k + 1}` : ''}.json`, dir), doc));
    readme.push(`| \`data-${c.id}${c.docs.length > 1 ? '-1/2/3' : ''}.json\` | ${c.checks} |`);
  }
  readme.push('', '## Error help (invalid JSON; a helpful tool says so and points at one of the listed lines)', '', '| File | Mistake | Lines |', '|---|---|---|');
  for (const c of ERROR_CASES) {
    writeFileSync(new URL(`error-${c.id}.txt`, dir), c.text);
    readme.push(`| \`error-${c.id}.txt\` | ${c.mistake} | ${c.lines.join(', ')} |`);
  }
  writeFileSync(new URL('README.md', dir), readme.join('\n') + '\n');
  console.log(`wrote ${DATA_CASES.reduce((s, c) => s + c.docs.length, 0)} data files and ${ERROR_CASES.length} error files to cases/`);
}
