/**
 * The validator's errors and schema problems in words (lib/schema reports codes and values). Keyword names, type
 * names and format names stay as they are in a schema; everything else goes through the translator. The tool
 * page's worked example uses the same words (English).
 */
import type { T } from '@/lib/i18n/ui';
import type { Params } from '@/lib/schema/validator';

/** A property name as messages quote it. */
const quoted = (v: string | number) => JSON.stringify(String(v));

/** An instance error's message. */
export function errorText(code: string, params: Params, t: T): string {
  const count = Number(params.count);
  const p = params.name === undefined ? params : { ...params, name: quoted(params.name), ...(params.dep !== undefined && { dep: quoted(params.dep) }) };
  switch (code) {
    case 'type':
      return String(p.expected).includes(', ') ? t('Expected one of {expected}, got {actual}', p) : t('Expected {expected}, got {actual}', p);
    case 'enum':
      return t('Must be one of: {values}', p);
    case 'const':
      return t('Must equal {value}', p);
    case 'multipleOf':
      return t('Must be a multiple of {limit}', p);
    case 'maximum':
      return t('Must be at most {limit}', p);
    case 'exclusiveMaximum':
      return t('Must be less than {limit}', p);
    case 'minimum':
      return t('Must be at least {limit}', p);
    case 'exclusiveMinimum':
      return t('Must be greater than {limit}', p);
    case 'maxLength':
      return t('Too long: length {count}, maximum {limit}', p);
    case 'minLength':
      return t('Too short: length {count}, minimum {limit}', p);
    case 'pattern':
      return t('Must match the pattern {pattern}', p);
    case 'format':
      return t('Must be a valid {format}', p);
    case 'maxItems':
      return t('Too many items: {count}, maximum {limit}', p);
    case 'minItems':
      return t('Too few items: {count}, minimum {limit}', p);
    case 'uniqueItems':
      return t('Items {a} and {b} are equal: items must be unique', p);
    case 'contains':
      return t('Must contain an item that matches contains');
    case 'minContains':
      return t('Too few items match contains: {count}, minimum {limit}', p);
    case 'maxContains':
      return t('Too many items match contains: {count}, maximum {limit}', p);
    case 'additionalItems':
      return t.n(count, 'Item {index} is not allowed: the schema allows {n} item', 'Item {index} is not allowed: the schema allows {n} items', p);
    case 'unevaluatedItems':
      return t('Item {index} is not allowed (unevaluatedItems)', p);
    case 'additionalProperties':
      return t('Property {name} is not allowed', p);
    case 'unevaluatedProperties':
      return t('Property {name} is not allowed (unevaluatedProperties)', p);
    case 'maxProperties':
      return t('Too many properties: {count}, maximum {limit}', p);
    case 'minProperties':
      return t('Too few properties: {count}, minimum {limit}', p);
    case 'required':
      return t('Missing required property {name}', p);
    case 'dependentRequired':
      return t('Missing property {name}, required when {dep} is present', p);
    case 'false':
      return t('No value is allowed here: the schema is false');
    case 'anyOf':
      return t.n(count, 'Matches none of the {n} schema in anyOf', 'Matches none of the {n} schemas in anyOf', p);
    case 'oneOf':
      return t.n(count, 'Matches none of the {n} schema in oneOf', 'Matches none of the {n} schemas in oneOf', p);
    case 'oneOfMany':
      return t('Matches more than one schema in oneOf (#{a} and #{b}): it must match exactly one', p);
    case 'not':
      return t('Must not match the schema in not');
    default:
      return code;
  }
}

/** A schema problem's message. */
export function problemText(code: string, p: Params, t: T): string {
  switch (code) {
    case 'unresolved':
      return p.why === 'remote'
        ? t("Can't resolve $ref {ref}: remote schemas are never fetched. Add it under $defs with its $id.", p)
        : p.why === 'pointer'
          ? t("Can't resolve $ref {ref}: nothing is at that JSON Pointer", p)
          : t("Can't resolve $ref {ref}: no anchor has that name", p);
    case 'refNotSchema':
      return t('$ref {ref} points to a {type}, not a schema', p);
    case 'badRegex':
      return t('Invalid regular expression in {kw}: {pattern}', p);
    case 'badValue':
      return badValue(String(p.expected), p, t);
    case 'notUnique':
      return t('The values of {kw} should be unique', p);
    case 'loop':
      return t('Infinite loop: $ref {ref} applies the same schema to the same value again (skipped)', p);
    case 'draft3':
      return t("draft-03 isn't supported: validated as draft-04");
    case 'unknownSchema':
      return t('Unknown $schema {uri}: validated as {draft}', p);
    case 'idFragment':
      return t('$id {id} has a fragment: from 2019-09 on, name a location with $anchor', p);
    case 'badAnchor':
      return t('{kw} {name} is not a valid anchor name', p);
    case 'duplicateId':
      return t('Two schemas have the $id {id}: the first one is used', p);
    case 'boolSchema4':
      return t('Boolean schemas (true and false) need draft-06 or later');
    case 'notSchema':
      return t('A schema must be an object or a boolean, not a {type}', p);
    case 'duplicateKeyword':
      return t('{kw} appears twice: the last one is used', p);
    case 'itemsArray2020':
      return t('In 2020-12, items takes one schema: for a list of schemas use prefixItems (read as prefixItems)');
    case 'additionalItems2020':
      return t('additionalItems is ignored in 2020-12: use items after prefixItems');
    case 'otherDraft':
      return t('{kw} is a {draft} keyword, ignored in {current}', p);
    case 'unknownKeyword':
      return t('Unknown keyword {kw} is ignored', p);
    case 'nullable':
      return t('nullable is an OpenAPI 3.0 keyword that JSON Schema ignores: add "null" to type instead');
    case 'unknownFormat':
      return t('Format {format} is not checked: it is not a known format', p);
    case 'schemaLoose':
      return t('The schema is not strict JSON: it was read as repaired');
    default:
      return code;
  }
}

function badValue(expected: string, p: Params, t: T): string {
  switch (expected) {
    case 'nonNegativeInteger':
      return t('{kw} must be a non-negative integer', p);
    case 'number':
      return t('{kw} must be a number', p);
    case 'positive':
      return t('{kw} must be a number greater than 0', p);
    case 'string':
      return t('{kw} must be a string', p);
    case 'boolean':
      return t('{kw} must be true or false', p);
    case 'array':
      return t('{kw} must be an array', p);
    case 'object':
      return t('{kw} must be an object', p);
    case 'stringArray':
      return t('{kw} must be an array of strings', p);
    case 'schema':
      return t('{kw} must be a schema (an object or a boolean)', p);
    case 'schemaArray':
      return t('{kw} must be an array of schemas', p);
    case 'schemaArrayNonEmpty':
      return t('{kw} must be a non-empty array of schemas', p);
    case 'schemaObject':
      return t('{kw} must be an object whose values are schemas', p);
    case 'type':
      return t('type must be one of null, boolean, object, array, number, string, integer, or an array of them');
    default:
      return t('{kw} has a value of the wrong type', p);
  }
}
