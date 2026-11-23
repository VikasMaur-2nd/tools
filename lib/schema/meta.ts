/**
 * The official meta-schemas that come with the validator (./meta/meta-schemas.json, copied from json-schema.org by
 * scripts/meta-schemas.mjs): draft-04, draft-06, draft-07, and 2019-09 and 2020-12 with their vocabularies. A `$ref`
 * to one, or a `$schema` naming a vocabulary's, resolves without the network; the worker loads the file the first
 * time a schema names one (./schema.worker.ts).
 */
import { normalizeUri, splitFragment } from './uri';

const VOCABS: [string, string][] = [
  ['2019-09', 'core applicator validation meta-data format content'],
  ['2020-12', 'core applicator unevaluated validation meta-data format-annotation content'],
];

/** Their URLs, as json-schema.org serves them (https, no fragment), in the file's order. */
export const META_URLS: string[] = [
  ...['04', '06', '07'].map((d) => `https://json-schema.org/draft-${d}/schema`),
  ...VOCABS.flatMap(([d, v]) => [`https://json-schema.org/draft/${d}/schema`, ...v.split(' ').map((m) => `https://json-schema.org/draft/${d}/meta/${m}`)]),
];

/** The meta-schema a URI names (http or https, any fragment): its URL in META_URLS, or null. */
export function metaUrl(uri: string): string | null {
  const u = normalizeUri(splitFragment(uri.trim())[0]).replace(/^http:/, 'https:');
  return META_URLS.includes(u) ? u : null;
}
