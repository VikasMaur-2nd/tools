/** JSON Schema drafts: which `$schema` names each, what each calls them, and which keywords each defines. */

/** draft-04, draft-06, draft-07, 2019-09, 2020-12, by number (ordered: a later draft is a bigger number). */
export type Draft = 4 | 6 | 7 | 2019 | 2020;

export const DRAFT_NAME: Record<Draft, string> = { 4: 'draft-04', 6: 'draft-06', 7: 'draft-07', 2019: '2019-09', 2020: '2020-12' };

/** The draft a `$schema` value names (null: none of these; 3: draft-03, which isn't supported). */
export function draftOf(uri: string): Draft | 3 | null {
  const u = uri.trim().replace(/^https?:\/\//i, '').replace(/#$/, '').toLowerCase();
  if (u === 'json-schema.org/draft/2020-12/schema') return 2020;
  if (u === 'json-schema.org/draft/2019-09/schema') return 2019;
  if (u === 'json-schema.org/draft-07/schema') return 7;
  if (u === 'json-schema.org/draft-06/schema') return 6;
  if (u === 'json-schema.org/draft-04/schema') return 4;
  if (u === 'json-schema.org/draft-03/schema') return 3;
  if (u === 'json-schema.org/schema') return 2020;
  return null;
}

/** Keywords whose value is one schema. */
export function singleSchemaKeywords(d: Draft): string[] {
  const k = ['additionalProperties', 'not'];
  if (d <= 2019) k.push('additionalItems');
  if (d >= 6) k.push('contains', 'propertyNames');
  if (d >= 7) k.push('if', 'then', 'else');
  if (d >= 2019) k.push('unevaluatedItems', 'unevaluatedProperties', 'contentSchema');
  if (d === 2020) k.push('items');
  return k;
}

/** Keywords whose value is an array of schemas. */
export function arraySchemaKeywords(d: Draft): string[] {
  const k = ['allOf', 'anyOf', 'oneOf'];
  if (d === 2020) k.push('prefixItems');
  return k;
}

/** Keywords whose value is an object of schemas (`definitions` is read in every draft: schemas written for 2019-09 and later still use it). */
export function mapSchemaKeywords(d: Draft): string[] {
  const k = ['properties', 'patternProperties', 'definitions'];
  if (d >= 2019) k.push('$defs', 'dependentSchemas');
  return k;
}

/** Every keyword the draft defines (others are ignored, as the specification says, and listed as unknown). */
export function knownKeywords(d: Draft): Set<string> {
  const k = new Set([
    '$ref', '$schema', 'title', 'description', 'default', 'enum', 'type', 'format',
    'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern',
    'items', 'additionalItems', 'maxItems', 'minItems', 'uniqueItems', 'maxProperties', 'minProperties', 'required',
    'properties', 'patternProperties', 'additionalProperties', 'dependencies', 'definitions', 'allOf', 'anyOf', 'oneOf', 'not',
  ]);
  if (d === 4) k.add('id');
  if (d >= 6) for (const x of ['$id', 'const', 'contains', 'propertyNames', 'examples']) k.add(x);
  if (d >= 7) for (const x of ['if', 'then', 'else', '$comment', 'contentMediaType', 'contentEncoding', 'readOnly', 'writeOnly']) k.add(x);
  if (d >= 2019) {
    // (`dependencies` stays: 2019-09 split it in two, but schemas still use it and validators still read it.)
    for (const x of ['$anchor', '$defs', '$vocabulary', 'dependentRequired', 'dependentSchemas', 'unevaluatedItems', 'unevaluatedProperties', 'minContains', 'maxContains', 'contentSchema', 'deprecated']) k.add(x);
  }
  if (d === 2019) k.add('$recursiveRef').add('$recursiveAnchor');
  if (d === 2020) {
    k.add('$dynamicRef').add('$dynamicAnchor').add('prefixItems');
    k.delete('additionalItems');
  }
  return k;
}
