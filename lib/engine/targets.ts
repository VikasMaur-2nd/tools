/** Convert targets (metadata only: the converters themselves are lazy-loaded). */
export interface TargetInfo {
  id: string;
  label: string;
  group: 'Types' | 'Data';
  ext: string;
  /** Language id understood by `highlightCode`. */
  lang: string;
  mime: string;
}

export const TARGETS: TargetInfo[] = [
  { id: 'typescript', label: 'TypeScript', group: 'Types', ext: 'ts', lang: 'typescript', mime: 'text/plain' },
  { id: 'zod', label: 'Zod schema', group: 'Types', ext: 'ts', lang: 'typescript', mime: 'text/plain' },
  { id: 'json-schema', label: 'JSON Schema', group: 'Types', ext: 'schema.json', lang: 'json', mime: 'application/json' },
  { id: 'csharp', label: 'C#', group: 'Types', ext: 'cs', lang: 'csharp', mime: 'text/plain' },
  { id: 'dart', label: 'Dart', group: 'Types', ext: 'dart', lang: 'dart', mime: 'text/plain' },
  { id: 'java', label: 'Java', group: 'Types', ext: 'java', lang: 'java', mime: 'text/plain' },
  { id: 'python', label: 'Python (Pydantic)', group: 'Types', ext: 'py', lang: 'python', mime: 'text/plain' },
  { id: 'go', label: 'Go', group: 'Types', ext: 'go', lang: 'go', mime: 'text/plain' },
  { id: 'kotlin', label: 'Kotlin', group: 'Types', ext: 'kt', lang: 'kotlin', mime: 'text/plain' },
  { id: 'swift', label: 'Swift', group: 'Types', ext: 'swift', lang: 'swift', mime: 'text/plain' },
  { id: 'php', label: 'PHP', group: 'Types', ext: 'php', lang: 'php', mime: 'text/plain' },
  { id: 'rust', label: 'Rust (serde)', group: 'Types', ext: 'rs', lang: 'rust', mime: 'text/plain' },
  { id: 'csv', label: 'CSV', group: 'Data', ext: 'csv', lang: 'csv', mime: 'text/csv' },
  { id: 'xlsx', label: 'Excel (.xlsx)', group: 'Data', ext: 'xlsx', lang: 'csv', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { id: 'yaml', label: 'YAML', group: 'Data', ext: 'yaml', lang: 'yaml', mime: 'text/yaml' },
  { id: 'xml', label: 'XML', group: 'Data', ext: 'xml', lang: 'xml', mime: 'application/xml' },
  { id: 'toml', label: 'TOML', group: 'Data', ext: 'toml', lang: 'toml', mime: 'text/plain' },
];

export const targetInfo = (id: string) => TARGETS.find((t) => t.id === id) ?? TARGETS[0];
