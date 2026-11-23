/** The Schema view's example (Try an example) and the validator page's sample: a user record that breaks six rules. */
export const SAMPLE_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "User",
  "type": "object",
  "required": ["id", "name", "email"],
  "properties": {
    "id": { "type": "integer", "minimum": 1 },
    "name": { "type": "string", "minLength": 1 },
    "email": { "type": "string", "format": "email" },
    "age": { "type": "integer", "minimum": 0 },
    "role": { "enum": ["admin", "editor", "viewer"] },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "uniqueItems": true
    },
    "balance": { "type": "number", "multipleOf": 0.01 }
  },
  "additionalProperties": false
}
`;

export const SAMPLE_DOC = `{
  "id": 7,
  "name": "Ada",
  "age": "36",
  "role": "owner",
  "tags": ["admin", "admin"],
  "balance": 19.999,
  "nickname": "ada"
}
`;
