/*
 * The copy-paste functions /integrate publishes. Other sites paste them into
 * their own code (there is no script to load from us), so they must stay
 * small, dependency-free and readable. tests/link.test.ts runs LINK_SNIPPET
 * against lib/link.ts, and the handoff against a real tab in the e2e kit.
 */
import { TARGETS } from '@/lib/engine/targets';

/** Method 1: builds a link that carries the JSON. Browsers and Node.js 18+. */
export const LINK_SNIPPET = `// A link that opens \`json\` in Tool Kumar: a JSON string (kept as
// written) or any value. Options: compare (a second document, opens
// Compare), schema (a JSON Schema: opens the Schema view, validating
// json against it), view ('tree', 'table', 'graph'…), to (Convert
// target), and with to 'flatten' or 'unflatten': sep (default '.'),
// arrays ('dot' or 'keep'; default a[0]), depth (1 to 3; default all),
// escape (false).
async function toolKumarLink(json, options = {}) {
  const { compare, schema, view, to, sep, arrays, depth, escape } = options;
  const encode = async (value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const stream = new Blob([text]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary)
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  };
  let hash = 'a=' + (await encode(json));
  if (schema !== undefined) hash += '&b=' + (await encode(schema)) + '&view=schema';
  else if (compare !== undefined) hash += '&b=' + (await encode(compare));
  if (view && schema === undefined) hash += '&view=' + view;
  if (to) hash += '&to=' + to;
  // (A separator with half an emoji can't be encoded: it is left out.)
  try {
    if (sep) hash += '&sep=' + encodeURIComponent(sep);
  } catch {}
  if (arrays) hash += '&arrays=' + arrays;
  if (depth) hash += '&depth=' + depth;
  if (escape === false) hash += '&escape=0';
  return 'https://tools.vikasmaur.com/#' + hash;
}`;

/** Method 2: opens a tab and hands the JSON over with postMessage, for documents too big for a link. */
export const HANDOFF_SNIPPET = `// Opens \`json\` in a new Tool Kumar tab, any size. Call it straight
// from a click. Options: compare, schema, view, to, sep, arrays, depth,
// escape (as for links). Resolves with the tab once Tool Kumar has the
// document.
function openInToolKumar(json, options = {}) {
  const { compare, schema, view, to, sep, arrays, depth, escape } = options;
  const origin = 'https://tools.vikasmaur.com';
  const text = (value) => typeof value === 'string' || value === undefined
    ? value : JSON.stringify(value);
  const tab = window.open(origin + '/#handoff', '_blank');
  if (!tab) return Promise.reject(new Error('The browser blocked the tab'));
  return new Promise((resolve, reject) => {
    const fail = (why) => done(new Error('Tool Kumar: ' + why));
    const timer = setTimeout(() => fail('no answer'), 60000);
    function done(error) {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      if (error) reject(error);
      else resolve(tab);
    }
    function onMessage(e) {
      if (e.source !== tab || e.origin !== origin) return;
      const kind = e.data && e.data.toolkumar;
      if (kind === 'ready') {
        const a = text(json);
        const b = text(schema === undefined ? compare : schema);
        const v = schema === undefined ? view : 'schema';
        tab.postMessage({ toolkumar: 'open', a, b, view: v, to, sep, arrays, depth, escape }, origin);
      } else if (kind === 'opened') done();
      else if (kind === 'error') fail(e.data.reason);
    }
    addEventListener('message', onMessage);
  });
}`;

/*
 * TypeScript versions. Both declare the same options `interface`, which
 * TypeScript merges, so pasting both functions into one file still compiles.
 * tests/link.test.ts type-checks each one alone and both together (strict).
 */
const ids = TARGETS.map((t) => `'${t.id}'`);
const targetLines: string[] = [];
for (let i = 0; i < ids.length; i += 5) targetLines.push(`    | ${ids.slice(i, i + 5).join(' | ')}`);

const OPTIONS_TS = `interface ToolKumarOptions {
  /** A second document: the link opens Compare. */
  compare?: unknown;
  /** A JSON Schema: the link opens the Schema view, validating the document against it. */
  schema?: unknown;
  view?: 'format' | 'tree' | 'table' | 'graph' | 'convert' | 'compare' | 'schema';
  /** Convert target, with view: 'convert'. */
  to?:
${targetLines.join('\n')};
  /** With to: 'flatten' or 'unflatten': what joins the keys (default '.'). */
  sep?: string;
  /** Array indexes as a.0 ('dot') or none ('keep'); default a[0]. */
  arrays?: 'bracket' | 'dot' | 'keep';
  /** Levels joined into keys (default: all). */
  depth?: 1 | 2 | 3;
  /** false: keys stay as written (default: escaped with backslashes). */
  escape?: boolean;
}`;

export const LINK_SNIPPET_TS = `${OPTIONS_TS}

// A link that opens \`json\` in Tool Kumar: a JSON string (kept as
// written) or any value.
async function toolKumarLink(
  json: unknown,
  options: ToolKumarOptions = {},
): Promise<string> {
  const { compare, schema, view, to, sep, arrays, depth, escape } = options;
  const encode = async (value: unknown): Promise<string> => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const stream = new Blob([text]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary)
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  };
  let hash = 'a=' + (await encode(json));
  if (schema !== undefined) hash += '&b=' + (await encode(schema)) + '&view=schema';
  else if (compare !== undefined) hash += '&b=' + (await encode(compare));
  if (view && schema === undefined) hash += '&view=' + view;
  if (to) hash += '&to=' + to;
  // (A separator with half an emoji can't be encoded: it is left out.)
  try {
    if (sep) hash += '&sep=' + encodeURIComponent(sep);
  } catch {}
  if (arrays) hash += '&arrays=' + arrays;
  if (depth) hash += '&depth=' + depth;
  if (escape === false) hash += '&escape=0';
  return 'https://tools.vikasmaur.com/#' + hash;
}`;

export const HANDOFF_SNIPPET_TS = `${OPTIONS_TS}

// Opens \`json\` in a new Tool Kumar tab, any size. Call it straight
// from a click. Resolves with the tab once Tool Kumar has the document.
function openInToolKumar(
  json: unknown,
  options: ToolKumarOptions = {},
): Promise<Window> {
  const { compare, schema, view, to, sep, arrays, depth, escape } = options;
  const origin = 'https://tools.vikasmaur.com';
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' || value === undefined
      ? value
      : JSON.stringify(value);
  const tab = window.open(origin + '/#handoff', '_blank');
  if (!tab) return Promise.reject(new Error('The browser blocked the tab'));
  return new Promise<Window>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== tab || e.origin !== origin) return;
      const data = e.data as { toolkumar?: string; reason?: string } | null;
      if (data?.toolkumar === 'ready') {
        const a = text(json);
        const b = text(schema === undefined ? compare : schema);
        const v = schema === undefined ? view : 'schema';
        tab.postMessage({ toolkumar: 'open', a, b, view: v, to, sep, arrays, depth, escape }, origin);
      } else if (data?.toolkumar === 'opened') done();
      else if (data?.toolkumar === 'error') fail(data.reason ?? 'error');
    };
    const done = (error?: Error) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      if (error) reject(error);
      else resolve(tab);
    };
    const fail = (why: string) => done(new Error('Tool Kumar: ' + why));
    const timer = setTimeout(() => fail('no answer'), 60000);
    addEventListener('message', onMessage);
  });
}`;
