// A lossless JSON reader (RFC 8259) for grading the data-safety cases: numbers keep the exact text they were
// written with, strings are decoded (lone surrogates kept), objects keep member order and duplicate keys. Nothing
// here goes through JSON.parse, so a big integer or a duplicate key can't be lost by the reader itself.
//
//   read(text)            → { value } or { error, line, column }
//   compare(want, got)    → { grade: 'pass' | 'spelling' | 'changed', notes: [...] }
//
// Values: { type: 'object', members: [[key, value], …] } | { type: 'array', items: [...] }
//       | { type: 'string', value } | { type: 'number', raw } | { type: 'true' | 'false' | 'null' }

export function read(text) {
  let i = 0;
  const n = text.length;
  const fail = (msg) => {
    const before = text.slice(0, i);
    const line = before.split('\n').length;
    throw Object.assign(new Error(msg), { line, column: i - before.lastIndexOf('\n') });
  };
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const value = (depth) => {
    if (depth > 100_000) fail('too deep');
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const members = [];
      ws();
      if (text[i] === '}') return i++, { type: 'object', members };
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a key');
        const key = string();
        ws();
        if (text[i++] !== ':') fail('expected :');
        members.push([key, value(depth + 1)]);
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') return i++, { type: 'object', members };
        else fail('expected , or }');
      }
    }
    if (c === '[') {
      i++;
      const items = [];
      ws();
      if (text[i] === ']') return i++, { type: 'array', items };
      for (;;) {
        items.push(value(depth + 1));
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') return i++, { type: 'array', items };
        else fail('expected , or ]');
      }
    }
    if (c === '"') return { type: 'string', value: string() };
    for (const lit of ['true', 'false', 'null']) if (text.startsWith(lit, i)) return (i += lit.length), { type: lit };
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 4096));
    if (!m || !m[0] || m[0] === '-') fail('unexpected character');
    i += m[0].length;
    return { type: 'number', raw: m[0] };
  };
  const string = () => {
    i++; // "
    let out = '';
    let start = i;
    for (;;) {
      if (i >= n) fail('unterminated string');
      const c = text.charCodeAt(i);
      if (c === 34) break;
      if (c < 32) fail('control character in string');
      if (c !== 92) {
        i++;
        continue;
      }
      out += text.slice(start, i);
      const e = text[i + 1];
      const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
      if (simple !== undefined) {
        out += simple;
        i += 2;
      } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
        i += 6;
      } else fail('bad escape');
      start = i;
    }
    out += text.slice(start, i);
    i++; // "
    return out;
  };
  try {
    const v = value(0);
    ws();
    if (i < n) fail('text after the document');
    return { value: v };
  } catch (e) {
    return { error: e.message, line: e.line, column: e.column };
  }
}

/** The exact decimal value of a JSON number literal, as sign + digits + exponent: `1.50` and `15e-1` agree. */
export function exactValue(raw) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  let digits = (m[2] + (m[3] ?? '')).replace(/^0+/, '');
  let exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
  if (!digits) return '0';
  while (digits.endsWith('0')) (digits = digits.slice(0, -1)), exp++;
  return `${m[1]}${digits}e${exp}`;
}

/** Grades a tool's output against the input, protocol section 5.1. */
export function compare(want, got, path = '$', notes = []) {
  const changed = (why) => notes.push({ path, kind: 'changed', why });
  if (want.type !== got.type) {
    changed(`${want.type} became ${got.type}${got.type === 'number' ? ` ${got.raw}` : got.type === 'string' ? ` ${JSON.stringify(got.value).slice(0, 40)}` : ''}`);
  } else if (want.type === 'number') {
    if (want.raw !== got.raw) {
      if (exactValue(want.raw) === exactValue(got.raw)) notes.push({ path, kind: 'spelling', why: `${want.raw} written as ${got.raw}` });
      else changed(`${want.raw} became ${got.raw}`);
    }
  } else if (want.type === 'string') {
    if (want.value !== got.value) changed(`string ${JSON.stringify(want.value).slice(0, 40)} became ${JSON.stringify(got.value).slice(0, 40)}`);
  } else if (want.type === 'array') {
    if (want.items.length !== got.items.length) changed(`${want.items.length} items became ${got.items.length}`);
    else want.items.forEach((w, k) => compare(w, got.items[k], `${path}[${k}]`, notes));
  } else if (want.type === 'object') {
    const wk = want.members.map(([k]) => k);
    const gk = got.members.map(([k]) => k);
    if (wk.length !== gk.length) changed(`${wk.length} members (${wk.map((k) => JSON.stringify(k)).join(', ')}) became ${gk.length} (${gk.map((k) => JSON.stringify(k)).join(', ')})`);
    else if (wk.some((k, j) => k !== gk[j])) changed(`key order ${wk.map((k) => JSON.stringify(k)).join(', ')} became ${gk.map((k) => JSON.stringify(k)).join(', ')}`);
    else want.members.forEach(([k, w], j) => compare(w, got.members[j][1], `${path}[${JSON.stringify(k)}]`, notes));
  }
  if (path !== '$') return { notes };
  const grade = notes.some((x) => x.kind === 'changed') ? 'changed' : notes.length ? 'spelling' : 'pass';
  return { grade, notes };
}
