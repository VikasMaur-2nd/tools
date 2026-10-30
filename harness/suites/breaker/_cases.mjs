// The tricky small documents shared by the breaker suites (inputs.mjs checks each one; big-strict.mjs
// repeats them into a document big enough for the worker's parser).
export const CASES = {
  // Keys an object-backed implementation would trip over.
  'proto-keys': '{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"toString":"s","hasOwnProperty":null,"valueOf":[],"__defineGetter__":0}',
  // Numbers no JS number holds: they must keep their source text everywhere.
  numbers: '[1e400,-0,1.0000000000000000000001,123456789012345678901234567890123,9007199254740993,-1e-400,0.1e1,1E+2,0,-0.0,5e-324,1.5e-10,100000000000000000000000]',
  // Duplicate keys at two levels; JSON.parse would keep only the last one.
  dupes: '{"a":1,"a":2,"b":{"c":1,"c":{"d":2}},"a":3}',
  // Integer-like keys JS objects would reorder, an empty key and a space key.
  'key-order': '{"10":"ten","2":"two","-1":"minus","01":"zero-one","":"empty"," ":"space","b":1,"a":2}',
  // Hard text: bidi controls, ZWJ emoji, combining marks, raw U+2028/2029, escapes of every kind.
  unicode: JSON.stringify({ 'k‮RLO': 'v‮evil‬', '👨‍👩‍👧‍👦': 'Z͓͑͒ ǟ é', ls: 'a b c', esc: '\b\f\n\r\t"\\/', ctl: '\u0001\u001f', astral: '😀𝓐' }).replace('"esc"', '"es\\u0063"').replace('😀', '\\ud83d\\ude00').replace('}', ',"lone":"\\ud800 \\udfff","nul":"\\u0000"}'),
  // Mixed array items, empty containers, nested empties.
  mixed: '[1,"a",null,true,false,{"a":1},[1,2],{"b":[]},[],{},[[]],[{}],-0.5,""]',
  // Records whose keys differ (table columns, optional fields in types).
  records: '[{"id":1,"name":"Ada","tags":["x","y"],"addr":{"city":"London","zip":"N1"}},{"id":2,"name":"Lin","active":false},{"id":3,"name":null,"addr":{"city":"Oslo"},"extra":[1,{"deep":true}]}]',
  // HTML in keys and values: must stay text in every view.
  html: '{"<img src=x onerror=window.__xss=1>":"<script>window.__xss=2</script>","a\\"b":"</textarea><svg onload=window.__xss=3>","&amp;":"&lt;b&gt;"}',
  // Top-level scalars.
  'scalar-string': '"just a string with \\"quotes\\" and \\u00e9"',
  'scalar-number': '-12.50e+3',
  'scalar-null': 'null',
  // Loose JSON the tool repairs: comments, trailing commas, quotes, Python literals, NaN, hex.
  loose: "{\n  // comment\n  name: 'Ada', /* block */\n  ok: True,\n  none: None,\n  n: NaN,\n  inf: -Infinity,\n  hex: 0x1F,\n  list: [1, 2,],\n}",
  // Nested 40 levels, alternating objects and arrays.
  nested: Array.from({ length: 40 }, (_, i) => (i % 2 ? '[' : `{"l${i}":`)).join('') + '"bottom"' + Array.from({ length: 40 }, (_, i) => (39 - i) % 2 ? ']' : '}').join(''),
};
